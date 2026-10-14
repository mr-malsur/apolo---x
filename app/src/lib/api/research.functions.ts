import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { bindings } from "../bindings.server";

export type ResearchSource = {
  id: string;
  title: string;
  authors: string[];
  year: string;
  abstract: string;
  url: string;
  doi?: string;
  provider: "arXiv" | "Crossref" | "Web search" | "Stack Exchange";
};

const SearchInput = z.object({ query: z.string().trim().min(2).max(400) });
const entityText = (value: string) => value
  .replace(/<[^>]*>/g, " ")
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
  .replace(/\s+/g, " ").trim();
const xmlTag = (block: string, tag: string) => {
  const found = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return found ? entityText(found[1]) : "";
};

async function searchArxiv(query: string): Promise<ResearchSource[]> {
  const url = new URL("https://export.arxiv.org/api/query");
  url.searchParams.set("search_query", `all:${query.replace(/[{}[\]^"~*?:\\]/g, " ").slice(0, 180)}`);
  url.searchParams.set("start", "0"); url.searchParams.set("max_results", "6");
  url.searchParams.set("sortBy", "relevance"); url.searchParams.set("sortOrder", "descending");
  const response = await fetch(url, { headers: { Accept: "application/atom+xml" }, signal: AbortSignal.timeout(9000) });
  if (!response.ok) throw new Error(`arXiv returned ${response.status}`);
  const xml = await response.text();
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/gi)].map((match, i) => {
    const block = match[1];
    const id = xmlTag(block, "id");
    const authors = [...block.matchAll(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/gi)].map(a => entityText(a[1]));
    return { id: `arxiv-${i}-${id}`, title: xmlTag(block, "title"), authors, year: xmlTag(block, "published").slice(0, 4), abstract: xmlTag(block, "summary"), url: id, provider: "arXiv" as const };
  }).filter(source => source.title && source.url);
}

async function searchCrossref(query: string): Promise<ResearchSource[]> {
  const url = new URL("https://api.crossref.org/works");
  url.searchParams.set("query", query.slice(0, 250)); url.searchParams.set("rows", "6");
  url.searchParams.set("select", "DOI,title,author,published,created,abstract,URL,type");
  const response = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "Apollo-X/1.0 (research workspace)" }, signal: AbortSignal.timeout(9000) });
  if (!response.ok) throw new Error(`Crossref returned ${response.status}`);
  const json = await response.json() as { message?: { items?: Array<Record<string, unknown>> } };
  return (json.message?.items ?? []).map((item, i) => {
    const title = Array.isArray(item.title) ? String(item.title[0] ?? "") : "";
    const authors = Array.isArray(item.author) ? item.author.slice(0, 8).map((a: any) => [a.given, a.family].filter(Boolean).join(" ")).filter(Boolean) : [];
    const dateObj = (item.published ?? item.created) as { "date-parts"?: number[][] } | undefined;
    const year = String(dateObj?.["date-parts"]?.[0]?.[0] ?? "");
    const doi = typeof item.DOI === "string" ? item.DOI : undefined;
    const abstract = typeof item.abstract === "string" ? entityText(item.abstract) : "";
    return { id: `crossref-${i}-${doi ?? title}`, title: entityText(title), authors, year, abstract, url: typeof item.URL === "string" ? item.URL : doi ? `https://doi.org/${doi}` : "", doi, provider: "Crossref" as const };
  }).filter(source => source.title && source.url);
}

async function searchWebPages(query: string): Promise<ResearchSource[]> {
  // DuckDuckGo HTML results let the workspace find real tutorials and web
  // articles as well as academic metadata, without requiring a paid key.
  const url = new URL("https://html.duckduckgo.com/html/");
  url.searchParams.set("q", `${query} tutorial article site:w3schools.com OR site:geeksforgeeks.org OR site:developer.mozilla.org OR site:stackoverflow.com`);
  const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; Apollo-X research workspace)", Accept: "text/html" }, signal: AbortSignal.timeout(9000) });
  if (!response.ok) throw new Error(`Web search returned ${response.status}`);
  const html = await response.text();
  const decode = (value: string) => entityText(value.replace(/&nbsp;/g, " ").replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16))));
  const results: ResearchSource[] = [];
  const blocks = [...html.matchAll(/<div class="result[^>]*>([\s\S]*?)(?=<div class="result[^>]*>|$)/gi)];
  for (const [i, match] of blocks.entries()) {
    const block = match[1];
    const anchor = block.match(/<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!anchor) continue;
    let href = anchor[1].replace(/&amp;/g, "&");
    if (href.startsWith("//duckduckgo.com/l/?")) {
      const redirect = new URL(`https:${href}`); href = redirect.searchParams.get("uddg") || href;
    }
    if (!/^https?:\/\//i.test(href) || /duckduckgo\.com/i.test(href)) continue;
    const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>|class="result__snippet"[^>]*>([\s\S]*?)<\/div>/i);
    const snippet = decode((snippetMatch?.[1] || snippetMatch?.[2] || "").replace(/<[^>]*>/g, " "));
    const title = decode(anchor[2].replace(/<[^>]*>/g, " "));
    results.push({ id: `web-${i}-${href}`, title, authors: [], year: "", abstract: snippet, url: href, provider: "Web search" });
    if (results.length >= 8) break;
  }
  return results;
}

async function searchStackExchange(query: string): Promise<ResearchSource[]> {
  const url = new URL("https://api.stackexchange.com/2.3/search/advanced");
  url.searchParams.set("site", "stackoverflow"); url.searchParams.set("order", "desc"); url.searchParams.set("sort", "relevance");
  url.searchParams.set("q", query.slice(0, 180)); url.searchParams.set("pagesize", "5"); url.searchParams.set("filter", "withbody");
  const response = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(9000) });
  if (!response.ok) throw new Error(`Stack Exchange returned ${response.status}`);
  const json = await response.json() as { items?: Array<{ question_id: number; title: string; link: string; body?: string; creation_date?: number; owner?: { display_name?: string } }> };
  return (json.items ?? []).map(item => ({ id: `stackexchange-${item.question_id}`, title: entityText(item.title), authors: item.owner?.display_name ? [item.owner.display_name] : [], year: item.creation_date ? String(new Date(item.creation_date * 1000).getFullYear()) : "", abstract: entityText((item.body || "").replace(/<[^>]*>/g, " ")).slice(0, 1600), url: item.link, provider: "Stack Exchange" as const }));
}

async function findSources(query: string) {
  const results = await Promise.allSettled([searchArxiv(query), searchCrossref(query), searchWebPages(query), searchStackExchange(query)]);
  const sources = results.flatMap(result => result.status === "fulfilled" ? result.value : []);
  const seen = new Set<string>();
  return sources.filter(source => {
    const key = (source.doi || source.title).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key); return true;
  }).slice(0, 18);
}

export const searchResearchPapers = createServerFn({ method: "POST" })
  .validator(SearchInput)
  .handler(async ({ data }) => {
    const sources = await findSources(data.query);
    return { query: data.query, sources, searchedAt: new Date().toISOString(), providers: ["arXiv", "Crossref", "Web search", "Stack Exchange"] };
  });


const SummaryInput = z.object({
  query: z.string().trim().min(2).max(400),
  sources: z.array(z.object({
    id: z.string().max(1000), title: z.string().max(1000), authors: z.array(z.string().max(300)).max(20),
    year: z.string().max(20), abstract: z.string().max(5000), url: z.string().max(3000),
    doi: z.string().max(300).optional(), provider: z.enum(["arXiv", "Crossref", "Web search", "Stack Exchange"]),
  })).min(1).max(18),
});

export const summarizeResearchSources = createServerFn({ method: "POST" })
  .validator(SummaryInput)
  .handler(async ({ data }) => {
    const evidence = data.sources.map((source, index) => `[${index + 1}] ${source.title} (${source.year || "year not listed"}; ${source.provider})\n${source.abstract || "No abstract/snippet available; use title metadata only."}\nSource: ${source.url}`).join("\n\n");
    const apiKey = bindings().OPENAI_API_KEY;
    if (apiKey) {
      try {
        const response = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model: "gpt-4o-mini", temperature: 0.2, messages: [
            { role: "system", content: "You are Apollo-X, a rigorous research synthesis assistant. Synthesize ALL provided records into an overall literature summary. Structure the answer with: Executive summary; recurring findings/themes; differences or tensions; limitations and missing evidence; bottom line. Cite claims inline using [1], [2] matching the supplied numbered records. Never claim to have read full papers if only abstracts/snippets are supplied. Distinguish source-supported findings from cautious inference and say when records lack enough detail." },
            { role: "user", content: `Research question: ${data.query}\n\nSynthesize all ${data.sources.length} retrieved records below. Do not ignore any record; mention when a record has insufficient abstract detail.\n\n${evidence}` },
          ] }), signal: AbortSignal.timeout(25000),
        });
        if (response.ok) {
          const json = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
          const summary = json.choices?.[0]?.message?.content?.trim();
          if (summary) return { summary, mode: "ai-synthesis" as const, sourceCount: data.sources.length };
        } else console.error("Apollo-X synthesis model returned", response.status, await response.text().catch(() => ""));
      } catch (error) { console.error("Apollo-X synthesis failed", error); }
    }
    const records = data.sources.map((source, index) => `**[${index + 1}] ${source.title}**${source.year ? ` (${source.year})` : ""}\n${source.abstract ? source.abstract.slice(0, 900) : "The retrieved record has no abstract or article snippet, so its detailed findings cannot be summarized."}`).join("\n\n");
    const providers = [...new Set(data.sources.map(source => source.provider))].join(", ");
    return { summary: `## Overall research overview\n\n**Question:** ${data.query}\n\nThis evidence digest covers ${data.sources.length} retrieved records from ${providers}. It preserves each record's available abstract or snippet rather than inventing a cross-paper conclusion. A full synthesis of common findings, contradictions, and research gaps requires the AI model to be configured with a server-side OPENAI_API_KEY.\n\n## Retrieved evidence, record by record\n\n${records}\n\n## What to verify next\n\n- Open the original sources to confirm methods, results, and limitations.\n- Compare the study populations, evaluation metrics, and assumptions before treating findings as directly comparable.\n- Records without abstracts/snippets cannot support detailed conclusions.`, mode: "source-digest" as const, sourceCount: data.sources.length };
  });

export const askResearchQuestion = createServerFn({ method: "POST" })
  .validator(SearchInput)
  .handler(async ({ data }) => {
    // Conversational assistant: source retrieval is optional context, not a
    // prerequisite for answering ordinary educational questions.
    const apiKey = bindings().OPENAI_API_KEY;
    let sources: ResearchSource[] = [];
    try { sources = await findSources(data.query); }
    catch (error) { console.error("Apollo-X literature retrieval failed", error); }

    if (apiKey) {
      try {
        const response = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            temperature: 0.35,
            messages: [
              { role: "system", content: "You are Apollo-X, a friendly general-purpose tutor and research assistant. Answer the user's actual question conversationally, like a helpful ChatGPT tutor. Explain concepts in plain language, use examples and steps when helpful, and ask a clarifying question only when needed. Do not turn every question into a literature review. Retrieved papers are optional supporting context: cite them as [1], [2] only when their supplied abstracts genuinely support a claim. You may answer ordinary educational questions from general knowledge; distinguish uncertain or time-sensitive claims. The supplied papers are abstracts/metadata, not full-text papers." },
              { role: "user", content: `Question: ${data.query}\n\nOptional relevant scholarly records (may be empty; do not let them prevent a direct answer):\n${sources.slice(0, 5).map((item, i) => `[${i + 1}] ${item.title} (${item.year || "year not listed"})\n${item.abstract.slice(0, 1800)}\n${item.url}`).join("\n\n") || "No relevant records were retrieved. Answer the question directly from general knowledge."}` },
            ],
          }),
          signal: AbortSignal.timeout(22000),
        });
        if (response.ok) {
          const json = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
          const answer = json.choices?.[0]?.message?.content?.trim();
          if (answer) return { answer, sources, mode: sources.length ? "ai-conversational-grounded" as const : "ai-conversational" as const };
        } else {
          console.error("Apollo-X OpenAI request returned", response.status, await response.text().catch(() => ""));
        }
      } catch (error) { console.error("Apollo-X conversational model request failed", error); }
    }

    // No model key: be transparent rather than pretending to be GPT. Return
    // a helpful source context if available and tell the user what is needed.
    if (sources.length) {
      const evidence = sources.slice(0, 4).map((item, i) => `[${i + 1}] ${item.title} (${item.year || "year not listed"})\n${item.abstract ? item.abstract.slice(0, 650) : "No abstract available."}`).join("\n\n");
      return { answer: `I found related research, but conversational AI is not configured yet. To answer doubts directly like a GPT tutor, add OPENAI_API_KEY to the website's server secrets. For now, here's relevant source context:\n\n${evidence}`, sources, mode: "source-only" as const };
    }
    return { answer: "I can help explain this topic conversationally, but the AI model is not configured and scholarly search did not return supporting records. Add OPENAI_API_KEY in the server secrets to enable direct tutoring answers, then try again.", sources: [], mode: "setup-needed" as const };
  });

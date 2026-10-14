import "@/apollo.css";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { askResearchQuestion, searchResearchPapers, summarizeResearchSources, type ResearchSource } from "@/lib/api/research.functions";

export const Route = createFileRoute("/workspace")({ component: Workspace });
type Section = "Overview" | "Research search" | "Documents" | "Chat" | "Collections" | "Notes" | "Knowledge graph";
type Doc = { id: string; title: string; source: string; pages: number; type: string; status: string; content?: string; size?: number; createdAt?: number };
type WorkspaceNote = { id: number; title: string; body: string; tag: string; collectionId?: string };
type ResearchCollection = { id: string; name: string; createdAt: number; queryHistory: string[]; sourceIds: string[]; readSourceIds: string[]; documentIds: string[]; noteIds: number[] };
const STORAGE_KEY = "apollo-x-workspace-v1";
const navItems: { name: Section; icon: string }[] = [
  { name: "Overview", icon: "⌂" }, { name: "Research search", icon: "⌕" }, { name: "Documents", icon: "▤" }, { name: "Chat", icon: "◌" },
  { name: "Collections", icon: "▦" }, { name: "Notes", icon: "✎" }, { name: "Knowledge graph", icon: "⌘" },
];

const GRAPH_STOP_WORDS = new Set(["the","and","for","with","from","that","this","are","was","using","based","into","their","which","method","methods","study","approach","paper","about","after","before","between","through","have","has","will","can","how","what","when","where","why","your","our","its","these","those","also","more","than","such","not","all","one","two","new","use","used","data","research","results","analysis","system","systems"]);
function findSharedConcepts(a: ResearchSource, b: ResearchSource) {
  const words = (source: ResearchSource) => `${source.title} ${source.abstract}`.toLowerCase().match(/\b[a-z][a-z0-9-]{2,}\b/g) ?? [];
  const aWords = new Set(words(a).filter(word => !GRAPH_STOP_WORDS.has(word)));
  const bWords = new Set(words(b).filter(word => !GRAPH_STOP_WORDS.has(word)));
  return [...aWords].filter(word => bWords.has(word)).sort((x,y) => { const ax = x.length >= 6 ? 1 : 0; const ay = y.length >= 6 ? 1 : 0; return ay-ax || y.length-x.length; });
}

function Workspace() {
  const [active, setActive] = useState<Section>("Overview");
  const [docs, setDocs] = useState<Doc[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [allSources, setAllSources] = useState<ResearchSource[]>([]);
  const [query, setQuery] = useState("");
  const [messages, setMessages] = useState<{ role: "user" | "assistant"; text: string; citations?: string[]; sources?: ResearchSource[]; mode?: string }[]>([
    { role: "assistant", text: "Ask me to explain a concept, clarify a doubt, walk through an example, or discuss research. I answer conversationally when AI is configured, and use papers as supporting evidence rather than treating every question as a paper search." },
  ]);
  const [chatLoading, setChatLoading] = useState(false);
  const [paperQuery, setPaperQuery] = useState("");
  const [paperResults, setPaperResults] = useState<ResearchSource[]>([]);
  const [paperLoading, setPaperLoading] = useState(false);
  const [paperError, setPaperError] = useState("");
  const [paperSearched, setPaperSearched] = useState(false);
  const [overallSummary, setOverallSummary] = useState<{ summary: string; mode: "ai-synthesis" | "source-digest"; sourceCount: number } | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState("");
  const [collections, setCollections] = useState<ResearchCollection[]>([]);
  const [activeCollectionId, setActiveCollectionId] = useState("");
  const [newCollection, setNewCollection] = useState("");
  const [notes, setNotes] = useState<WorkspaceNote[]>([]);
  const [noteTitle, setNoteTitle] = useState("");
  const [noteBody, setNoteBody] = useState("");
  const [search, setSearch] = useState("");
  const [selectedDoc, setSelectedDoc] = useState("");
  const [toast, setToast] = useState("");
  const [graphFilter, setGraphFilter] = useState("All relationships");
  const [selectedGraphSource, setSelectedGraphSource] = useState<ResearchSource | null>(null);
  const [selectedGraphEdge, setSelectedGraphEdge] = useState<{ from: ResearchSource; to: ResearchSource; concepts: string[] } | null>(null);
  const [readingSourceId, setReadingSourceId] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const visibleDocs = useMemo(() => docs.filter(d => (d.title + d.source).toLowerCase().includes(search.toLowerCase())), [docs, search]);
  const notify = (message: string) => { setToast(message); setTimeout(() => setToast(""), 2600); };

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as { docs?: Doc[]; collections?: Array<string | ResearchCollection>; activeCollectionId?: string; notes?: WorkspaceNote[]; messages?: typeof messages; allSources?: ResearchSource[] };
        setDocs(saved.docs ?? []);
        setCollections((saved.collections ?? []).map((item, i) => typeof item === "string" ? ({ id: `legacy-${i}-${item}`, name: item, createdAt: Date.now(), queryHistory: [], sourceIds: [], readSourceIds: [], documentIds: [], noteIds: [] }) : item));
        setActiveCollectionId(saved.activeCollectionId ?? "");
        setNotes(saved.notes ?? []);
        setMessages(saved.messages?.length ? saved.messages : messages);
        setAllSources(saved.allSources ?? []);
        if (saved.docs?.length) setSelectedDoc(saved.docs[0].id);
      }
    } catch (error) { console.error("Could not restore Apollo-X workspace", error); }
    setHydrated(true);
  // Hydrate once; the initial assistant message is the fallback.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ docs, collections, activeCollectionId, notes, messages, allSources })); }
    catch (error) { console.error("Could not save Apollo-X workspace", error); notify("Storage is full; remove large documents or export your notes"); }
  }, [hydrated, docs, collections, activeCollectionId, notes, messages, allSources]);


  function topicKey(name: string) { return name.trim().toLocaleLowerCase().replace(/\s+/g, " "); }
  function topicNameFromQuestion(question: string) {
    const cleaned = question.trim().replace(/^(please\s+)?(explain|teach me|tell me about|what is|what are|who is|how does|how do|how can|why does|why do|can you explain|help me understand)\s+/i, "").replace(/[?!.]+$/g, "").trim();
    return (cleaned.split(/\s+(?:with an example|in simple words|step by step|in detail|briefly)\b/i)[0] || cleaned).slice(0, 60) || "General research";
  }
  function ensureTopicCollection(topic: string) {
    const name = topic.trim().replace(/\s+/g, " ").slice(0, 80) || "General research";
    const existing = collections.find(c => topicKey(c.name) === topicKey(name));
    if (existing) {
      setCollections(old => old.map(c => c.id === existing.id ? { ...c, queryHistory: c.queryHistory.includes(topic) ? c.queryHistory : [...c.queryHistory, topic] } : c));
      setActiveCollectionId(existing.id);
      return existing.id;
    }
    const id = `topic-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
    const collection: ResearchCollection = { id, name, createdAt: Date.now(), queryHistory: [topic], sourceIds: [], readSourceIds: [], documentIds: [], noteIds: [] };
    setCollections(old => [...old, collection]); setActiveCollectionId(id);
    return id;
  }
  function attachSourcesToTopic(topic: string, sources: ResearchSource[]) {
    const existing = collections.find(c => topicKey(c.name) === topicKey(topic));
    const id = existing?.id ?? ensureTopicCollection(topic);
    setCollections(old => old.map(c => c.id === id ? { ...c, queryHistory: c.queryHistory.includes(topic) ? c.queryHistory : [...c.queryHistory, topic], sourceIds: [...new Set([...c.sourceIds, ...sources.map(source => source.id)])] } : c));
    setActiveCollectionId(id);
  }
  function markSourceRead(source: ResearchSource, topic = paperQuery || source.title) {
    attachSourcesToTopic(topic, [source]);
    setCollections(old => old.map(c => c.id === (collections.find(item => topicKey(item.name) === topicKey(topic))?.id ?? activeCollectionId) ? { ...c, readSourceIds: [...new Set([...c.readSourceIds, source.id])] } : c));
    setReadingSourceId(source.id);
  }
  async function addFiles(files: FileList | null) {
    if (!files || !files.length) return;
    const added: Doc[] = [];
    for (const file of Array.from(files)) {
      const isPdf = file.name.toLowerCase().endsWith(".pdf");
      let content = "";
      let pages = 1;
      let status = "Text extracted";
      try {
        if (isPdf) {
          const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
          pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.mjs", import.meta.url).toString();
          const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
          pages = pdf.numPages;
          const pageTexts: string[] = [];
          for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
            const page = await pdf.getPage(pageNo);
            const text = await page.getTextContent();
            pageTexts.push(text.items.map((item: any) => "str" in item ? item.str : "").join(" "));
          }
          content = pageTexts.join("\n\n").trim().slice(0, 25000);
          status = content ? "Text extracted" : "Scanned PDF · OCR needed";
        } else if (/\.(txt|md|csv|json)$/i.test(file.name)) {
          content = await file.text();
          status = "Text extracted";
        } else {
          status = "Stored · text extraction unsupported";
        }
      } catch (error) {
        console.error("Document extraction failed", file.name, error);
        status = "Extraction failed";
      }
      added.push({
        id: "upload-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8),
        title: file.name.replace(/\.[^.]+$/, ""),
        source: `Uploaded locally · ${new Date().toLocaleDateString()}`,
        pages, type: isPdf ? "PDF" : file.name.split(".").pop()?.toUpperCase() || "FILE",
        status, content, size: file.size, createdAt: Date.now(),
      });
    }
    setDocs(old => [...added, ...old]);
    if (activeCollectionId) setCollections(old => old.map(c => c.id === activeCollectionId ? { ...c, documentIds: [...new Set([...c.documentIds, ...added.map(d => d.id)])] } : c));
    setSelectedDoc(added[0]?.id ?? "");
    setActive("Documents");
    notify(`${added.length} file${added.length === 1 ? "" : "s"} added and processed`);
  }
  async function sendMessage() {
    const q = query.trim(); if (!q || chatLoading) return;
    setMessages(old => [...old, { role: "user", text: q }]);
    ensureTopicCollection(topicNameFromQuestion(q));
    setQuery(""); setActive("Chat"); setChatLoading(true);
    try {
      const localDocs = docs.filter(doc => doc.content && doc.content.trim().length > 20);
      const terms = q.toLowerCase().split(/[^a-z0-9]+/).filter(term => term.length > 2);
      const localMatches = localDocs.map(doc => {
        const chunks = (doc.content ?? "").split(/(?<=[.!?])\s+|\n+/).filter(Boolean);
        const ranked = chunks.map(text => ({ text, score: terms.reduce((sum, term) => sum + (text.toLowerCase().includes(term) ? 1 : 0), 0) })).filter(item => item.score > 0).sort((a,b) => b.score-a.score).slice(0, 5);
        return { doc, ranked };
      }).filter(item => item.ranked.length).sort((a,b) => b.ranked[0].score-a.ranked[0].score);
      let result: { answer: string; sources: ResearchSource[]; mode: string } | null = null;
      try { result = await askResearchQuestion({ data: { query: q } }); }
      catch (error) { console.error("External scholarly search failed", error); }
      const localEvidence = localMatches.map(({doc, ranked}) => `**${doc.title}**\n${ranked.map(item => `• ${item.text.slice(0, 700)}`).join("\n")}`).join("\n\n");
      if (localEvidence) {
        const answer = `Evidence found in your uploaded documents:\n\n${localEvidence}${result ? `\n\nExternal literature search: ${result.answer}` : "\n\nExternal literature search is unavailable right now; this response uses only your uploaded document text."}`;
        setMessages(old => [...old, { role: "assistant", text: answer, sources: result?.sources ?? [], mode: result?.mode ?? "local-documents" }]);
        if (result?.sources.length) attachSourcesToTopic(q, result.sources);
      } else if (result) {
        setMessages(old => [...old, { role: "assistant", text: result!.answer, sources: result!.sources, mode: result!.mode }]);
        if (result!.sources.length) attachSourcesToTopic(q, result!.sources);
      } else {
        setMessages(old => [...old, { role: "assistant", text: localDocs.length ? "I couldn't find matching passages in your uploaded documents, and the external scholarly search failed. Try different keywords or check the terminal for the server error." : "The external scholarly search failed, and there are no text-extracted documents in this workspace yet. Upload a text-based PDF or TXT/MD file, or check the VS Code terminal for the server error." }]);
      }
    } finally { setChatLoading(false); }
  }
  async function runPaperSearch(event?: FormEvent) {
    event?.preventDefault();
    const q = paperQuery.trim(); if (q.length < 2 || paperLoading) return;
    setPaperLoading(true); setPaperError(""); setPaperSearched(true);
    try {
      const result = await searchResearchPapers({ data: { query: q } });
      setPaperResults(result.sources);
      setOverallSummary(null); setSummaryError("");
      attachSourcesToTopic(q, result.sources);
      setAllSources(old => { const map = new Map(old.map(source => [source.id, source])); result.sources.forEach(source => map.set(source.id, { ...source, abstract: source.abstract.slice(0, 3500) })); return [...map.values()].slice(-40); });
      if (!result.sources.length) setPaperError("No matching records were returned. Try fewer words or more specific technical terms.");
    } catch (error) {
      console.error(error); setPaperError("The scholarly search service could not be reached. Please try again.");
    } finally { setPaperLoading(false); }
  }
  async function generateOverallSummary() {
    if (!paperResults.length || summaryLoading) return;
    setSummaryLoading(true); setSummaryError("");
    try {
      const result = await summarizeResearchSources({ data: { query: paperQuery.trim(), sources: paperResults } });
      setOverallSummary(result);
    } catch (error) {
      console.error("Apollo-X overall summary failed", error);
      setSummaryError("Could not create the overall summary right now. Please try again.");
    } finally { setSummaryLoading(false); }
  }
  function saveNote() {
    if (!noteTitle.trim() || !noteBody.trim()) { notify("Add a title and note first"); return; }
    const noteId = Date.now();
    setNotes(old => [{ id: noteId, title: noteTitle.trim(), body: noteBody.trim(), tag: "Workspace note", collectionId: activeCollectionId || undefined }, ...old]);
    if (activeCollectionId) setCollections(old => old.map(c => c.id === activeCollectionId ? { ...c, noteIds: [...new Set([...c.noteIds, noteId])] } : c));
    setNoteTitle(""); setNoteBody(""); notify("Note saved in this session");
  }
  function addCollection() {
    const name = newCollection.trim(); if (!name) return;
    const existing = collections.find(c => topicKey(c.name) === topicKey(name));
    if (existing) { setActiveCollectionId(existing.id); notify("That topic module already exists"); setNewCollection(""); return; }
    const id = `topic-${Date.now()}`;
    setCollections(old => [...old, { id, name, createdAt: Date.now(), queryHistory: [], sourceIds: [], readSourceIds: [], documentIds: [], noteIds: [] }]);
    setActiveCollectionId(id); setNewCollection(""); notify(`Created ${name} topic module`);
  }

  const graphSources = useMemo(() => allSources.slice(-18), [allSources]);
  const graphNodes = useMemo(() => graphSources.map((source, i) => {
    const angle = (2 * Math.PI * i) / Math.max(graphSources.length, 1) - Math.PI / 2;
    return { source, x: 500 + 350 * Math.cos(angle), y: 320 + 250 * Math.sin(angle) };
  }), [graphSources]);
  const graphEdges = useMemo(() => graphNodes.flatMap((node, i) => graphNodes.slice(i + 1).flatMap(other => {
    const concepts = findSharedConcepts(node.source, other.source);
    return concepts.length >= 2 ? [{ from: node, to: other, concepts: concepts.slice(0, 4) }] : [];
  })), [graphNodes]);

  return (
    <main className="ax-workspace">
      <aside className="ax-sidebar">
        <Link to="/" className="ax-logo"><span className="ax-mark"><i/><i/><i/><i/></span><span>Apollo<span>-X</span></span></Link>
        <div className="ax-workspace-switch"><span className="ax-switch-icon">R</span><span><b>Retrieval Quality Study</b><small>Research workspace</small></span><span className="ax-switch-chevron">⌄</span></div>
        <button className="ax-new-research" onClick={() => { setActive("Chat"); setQuery(""); }}>＋ <span>New research question</span><kbd>⌘ K</kbd></button>
        <p className="ax-nav-label">WORKSPACE</p>
        <nav className="ax-side-nav" aria-label="Workspace sections">
          {navItems.map(item => <button key={item.name} className={active === item.name ? "active" : ""} onClick={() => setActive(item.name)}><span className="ax-nav-icon">{item.icon}</span><span>{item.name}</span>{item.name === "Documents" && <small>{docs.length}</small>}{item.name === "Notes" && <small>{notes.length}</small>}</button>)}
        </nav>
        <div className="ax-sidebar-bottom"><div className="ax-privacy"><span className="ax-lock">◇</span><span><b>Workspace boundary</b><small>Source scope stays explicit</small></span></div><Link to="/" className="ax-back-home">← Back to Apollo-X</Link></div>
      </aside>
      <section className="ax-main">
        <header className="ax-topbar"><div className="ax-breadcrumb">Workspace <span>/</span> <b>{active}</b></div><div className="ax-top-actions"><span className="ax-scope"><i/> Live scholarly search</span><button className="ax-icon-button" title="Search documents" onClick={() => { setActive("Documents"); setTimeout(() => document.getElementById("ax-doc-search")?.focus(), 20); }}>⌕</button><div className="ax-avatar">MX</div></div></header>
        <div className="ax-page-content">
          {toast && <div className="ax-toast" role="status">✓ {toast}</div>}
          <div className="ax-page-title-row"><div><p className="ax-eyebrow">RETRIEVAL QUALITY STUDY</p><h1>{active === "Overview" ? "Good research starts here." : active}</h1><p className="ax-page-subtitle">{active === "Overview" ? "Your evidence, questions, and open threads in one place." : active === "Chat" ? "Ask across your sources. Keep evidence and uncertainty visible." : active === "Research search" ? "Search live scholarly records from arXiv and Crossref." : active === "Documents" ? "Manage source files and keep their research context together." : active === "Collections" ? "Curate the claims, conflicts, and gaps that matter." : active === "Notes" ? "Capture your thinking next to the evidence that prompted it." : "Explore how documents, claims, concepts, and gaps connect."}</p></div>{active !== "Knowledge graph" && <button className="ax-primary-button" onClick={() => fileRef.current?.click()}>＋ Add documents</button>}</div>
          <input ref={fileRef} type="file" accept=".pdf,.doc,.docx,.txt,.md,.csv" multiple hidden onChange={e => addFiles(e.target.files)} />
          {active === "Overview" && <>
            <div className="ax-stat-grid"><div className="ax-stat-card"><span>Documents</span><b>{String(docs.length).padStart(2,"0")}</b><small>Files in this browser workspace</small><span className="ax-stat-symbol">▤</span></div><div className="ax-stat-card"><span>Research records</span><b>{String(allSources.length).padStart(2,"0")}</b><small>Unique papers retrieved</small><span className="ax-stat-symbol">⌕</span></div><div className="ax-stat-card"><span>Research notes</span><b>{String(notes.length).padStart(2,"0")}</b><small>Notes you have saved</small><span className="ax-stat-symbol conflict-symbol">✎</span></div><div className="ax-stat-card"><span>Collections</span><b>{String(collections.length).padStart(2,"0")}</b><small>Collections you created</small><span className="ax-stat-symbol">▦</span></div></div>
            <div className="ax-overview-grid"><section className="ax-panel ax-recent-panel"><div className="ax-panel-heading"><div><h2>Recent documents</h2><p>Source material in the active workspace</p></div><button className="ax-text-action" onClick={() => setActive("Documents")}>View all ↗</button></div><div className="ax-document-list">{docs.length ? docs.slice(0,4).map(d => <button key={d.id} className="ax-document-row" onClick={() => { setSelectedDoc(d.id); setActive("Documents"); }}><span className="ax-file-icon">{d.type}</span><span className="ax-doc-main"><b>{d.title}</b><small>{d.source} · {d.pages} pages</small></span><span className="ax-indexed">{d.status}</span><span className="ax-row-arrow">↗</span></button>) : <div className="ax-empty-state">No documents yet. Use Add documents to import PDFs or text files.</div>}</div></section>
              <section className="ax-panel ax-activity-panel"><div className="ax-panel-heading"><div><h2>Recent research activity</h2><p>Based on searches and notes you have saved</p></div><span className="ax-live-label">LIVE DATA</span></div>{allSources.slice(0,3).map(source=><button className="ax-thread" key={source.id} onClick={()=>{setQuery(`Review the evidence and limitations in ${source.title}`);setActive("Chat");}}><span className="ax-thread-icon graph-icon">⌕</span><span><b>{source.title}</b><small>{source.provider}{source.year?` · ${source.year}`:""}</small></span><span>↗</span></button>)}{notes.slice(0,2).map(note=><button className="ax-thread" key={note.id} onClick={()=>{setQuery(`Review this note and identify what evidence would support it: ${note.title}. ${note.body}`);setActive("Chat");}}><span className="ax-thread-icon gap-icon">✎</span><span><b>{note.title}</b><small>Saved note · {note.tag}</small></span><span>↗</span></button>)}{!allSources.length&&!notes.length&&<div className="ax-empty-state">Your searches and saved notes will appear here. Start with Research search or add a note.</div>}</section></div>
            <div className="ax-lower-grid"><section className="ax-panel ax-collections-panel"><div className="ax-panel-heading"><div><h2>Your collections</h2><p>Curated research bundles</p></div><button className="ax-text-action" onClick={() => setActive("Collections")}>Manage ↗</button></div>{collections.length ? collections.slice(0,3).map((c,i)=><button className="ax-collection-row" key={c.id} onClick={() => {setActiveCollectionId(c.id);setActive("Collections");}}><span className={"ax-collection-icon ci-" + (i%3)}>▦</span><span><b>{c.name}</b><small>{c.sourceIds.length} papers · {c.documentIds.length} documents · {c.noteIds.length} notes</small></span><span>→</span></button>) : <div className="ax-empty-state">No collections yet. Create one to organize your research.</div>}</section><section className="ax-panel ax-note-preview"><div className="ax-panel-heading"><div><h2>Latest note</h2><p>A thought worth keeping</p></div><button className="ax-text-action" onClick={() => setActive("Notes")}>Open notes ↗</button></div><div className="ax-note-tag">{notes[0]?.tag || "Workspace note"}</div><h3>{notes[0]?.title || "No notes yet"}</h3><p>{notes[0]?.body || "Save a thought from your research."}</p></section></div>
            <div className="ax-demo-notice"><span>i</span><p><b>Live workspace data.</b> Counts reflect your files, saved notes, collections, and research records. Your workspace is saved in this browser on this device; it is not yet synced across devices or users.</p></div>
          </>}
          {active === "Research search" && <section className="ax-panel ax-research-search-view">
            <div className="ax-panel-heading"><div><h2>Search scholarly literature</h2><p>Live scholarly papers, web tutorials, articles, and Stack Overflow results, with links to original sources</p></div><span className="ax-live-label">LIVE SEARCH</span></div>
            <form className="ax-paper-search-form" onSubmit={runPaperSearch}><label htmlFor="ax-paper-query">Research topic or question</label><div><span>⌕</span><input id="ax-paper-query" value={paperQuery} onChange={e=>setPaperQuery(e.target.value)} placeholder="e.g. retrieval augmented generation evaluation"/><button className="ax-primary-button" type="submit" disabled={paperLoading || paperQuery.trim().length<2}>{paperLoading ? "Searching…" : "Search papers ↗"}</button></div><small>Try a topic, method, author, or specific research question.</small></form>
            {paperError && <div className="ax-research-message" role="status">{paperError}</div>}
            {paperLoading && <div className="ax-research-loading"><span className="ax-loading-dot"/> Searching scholarly records…</div>}
            {!paperLoading && paperSearched && paperResults.length>0 && <div className="ax-paper-results"><div className="ax-results-heading"><div><b>{paperResults.length} articles and research records</b><span> · Combined from available scholarly and web sources</span></div><button className="ax-summary-button" type="button" onClick={() => void generateOverallSummary()} disabled={summaryLoading}>{summaryLoading ? "Synthesizing all sources…" : "✳ Generate overall summary"}</button></div>
              {summaryError && <p className="ax-research-message" role="status">{summaryError}</p>}
              {overallSummary && <section className="ax-overall-summary" aria-live="polite"><div className="ax-overall-summary-head"><span className="ax-summary-spark">✳</span><div><p className="ax-eyebrow">APOLLO-X / CROSS-SOURCE SYNTHESIS</p><h3>Overall research summary</h3><small>{overallSummary.sourceCount} retrieved records · {overallSummary.mode === "ai-synthesis" ? "AI synthesis" : "Evidence digest · AI not configured"}</small></div><button type="button" className="ax-summary-copy" onClick={() => {void navigator.clipboard?.writeText(overallSummary.summary).then(() => notify("Summary copied")).catch(() => notify("Copy unavailable in this browser"));}}>Copy summary</button></div><div className="ax-overall-summary-body">{overallSummary.summary.split("\n").map((line,index)=>line.startsWith("## ") ? <h4 key={index}>{line.slice(3)}</h4> : line.startsWith("**") && line.includes("**") ? <p key={index}><b>{line.split("**")[1]}</b>{line.slice(line.indexOf("**",2)+2)}</p> : line.startsWith("- ") ? <p key={index} className="ax-summary-bullet">{line}</p> : line ? <p key={index}>{line}</p> : null)}</div><p className="ax-summary-footnote">The synthesis is limited to the retrieved records and their available abstracts/snippets—not every paper ever published. Follow citations and open original sources before relying on a claim.</p></section>}
              {paperResults.map((source,i)=><article className="ax-paper-result" key={source.id}><span className="ax-paper-result-number">{String(i+1).padStart(2,"0")}</span><div className="ax-paper-result-main"><h3>{source.title}</h3><p className="ax-paper-meta">{source.authors.slice(0,4).join(", ") || "Authors not listed"}{source.year ? ` · ${source.year}` : ""} · {source.provider}</p>{source.abstract ? <p className="ax-paper-abstract">{source.abstract.slice(0,650)}{source.abstract.length>650?"…":""}</p> : <p className="ax-paper-abstract no-abstract">No abstract was provided in this record.</p>}<div className="ax-paper-result-footer"><span>{source.doi ? `DOI: ${source.doi}` : source.provider}</span><a href={source.url} target="_blank" rel="noreferrer">Open original source ↗</a></div></div></article>)}</div>}
            {!paperLoading && !paperSearched && <div className="ax-research-empty"><span>⌕</span><h3>Start with a research question.</h3><p>Search published literature, then ask Apollo-X to compare the evidence it finds.</p><div>{["retrieval augmented generation evaluation","long document question answering","knowledge graphs for literature review"].map(q=><button key={q} onClick={()=>{setPaperQuery(q);setPaperSearched(false);}}>{q} ↗</button>)}</div></div>}
            <div className="ax-demo-notice"><span>i</span><p>Search combines scholarly metadata with web search and Stack Overflow results. Web snippets and abstracts depend on provider availability; open the original source to verify details.</p></div>
          </section>}
          {active === "Documents" && <section className="ax-panel ax-docs-view"><div className="ax-panel-heading"><div><h2>Source library</h2><p>{docs.length} documents available in this session</p></div><div className="ax-search-box"><span>⌕</span><input id="ax-doc-search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search documents" /></div></div><div className="ax-table-head"><span>DOCUMENT</span><span>SOURCE</span><span>PAGES</span><span>STATUS</span><span></span></div>{visibleDocs.map(d=><button key={d.id} className={"ax-doc-table-row " + (selectedDoc===d.id?"selected":"")} onClick={()=>setSelectedDoc(d.id)}><span className="ax-doc-table-title"><span className="ax-file-icon">{d.type}</span><b>{d.title}</b></span><span>{d.source}</span><span>{d.pages}</span><span><i className="ax-status-dot"/> {d.status}</span><span>⋯</span></button>)}{visibleDocs.length===0&&<div className="ax-empty-state">No documents match that search.</div>}<div className="ax-doc-detail"><div><p className="ax-eyebrow">SELECTED SOURCE</p><h3>{docs.find(d=>d.id===selectedDoc)?.title || "Choose a document"}</h3><p>{docs.find(d=>d.id===selectedDoc)?.content ? docs.find(d=>d.id===selectedDoc)?.content?.slice(0,900) + ( (docs.find(d=>d.id===selectedDoc)?.content?.length ?? 0)>900 ? "…" : "") : "No extracted text is available for this file. Text-based PDFs and TXT/MD/CSV files can be searched in Chat."}</p></div><button className="ax-secondary-button" onClick={()=>{const doc=docs.find(d=>d.id===selectedDoc); if(doc?.content) {setQuery(`Summarize the key findings and limitations in ${doc.title}`);setActive("Chat");} else notify("This file has no extracted text yet")}}>Ask about document ↗</button></div><div className="ax-demo-notice"><span>i</span><p>Files and extracted text are stored in this browser on this device. Scanned PDFs require OCR; large files may exceed browser storage limits. No files are uploaded to a remote server.</p></div></section>}
          {active === "Chat" && <div className="ax-chat-layout"><section className="ax-panel ax-chat-panel"><div className="ax-panel-heading"><div><h2>Research conversation</h2><p>Scope: {docs.length} documents in this workspace</p></div><span className="ax-scope"><i/> Internal sources</span></div><div className="ax-chat-messages">{messages.map((m,i)=><div key={i} className={"ax-message " + m.role}><div className="ax-message-avatar">{m.role==="assistant"?<span className="ax-mini-mark"><i/><i/><i/><i/></span>:"MX"}</div><div className="ax-message-content"><span className="ax-message-role">{m.role==="assistant"?(m.mode?.startsWith("ai-conversational")?"APOLLO-X · AI TUTOR":m.mode==="ai-grounded"?"APOLLO-X · SOURCE-GROUNDED":m.mode==="source-only"?"APOLLO-X · SOURCE CONTEXT":m.mode==="setup-needed"?"APOLLO-X · SETUP NEEDED":"APOLLO-X ASSISTANT"):"YOU"}</span><p>{m.text}</p>{m.sources&&m.sources.length>0&&<div className="ax-chat-source-list"><b>Retrieved sources</b>{m.sources.slice(0,6).map((source,index)=><a key={source.id} href={source.url} target="_blank" rel="noreferrer"><span>[{index+1}]</span><span>{source.title}<small>{source.provider}{source.year?` · ${source.year}`:""}</small></span><span>↗</span></a>)}</div>}{m.citations&&<div className="ax-citation-row">{m.citations.map(c=><button key={c} onClick={()=>{setSelectedDoc(c);setActive("Documents")}}>↗ {docs.find(d=>d.id===c)?.title || c}</button>)}</div>}</div></div>)}</div><form className="ax-chat-composer" onSubmit={e=>{e.preventDefault();void sendMessage();}}><textarea value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();void sendMessage();}}} placeholder="Ask any doubt about a topic, request an example, or discuss research..." rows={3}/><div><span>Enter to send · Shift + Enter for a new line</span><button type="submit" disabled={!query.trim()||chatLoading}>{chatLoading?"Searching sources…":"Research question ↗"}</button></div></form><div className="ax-chat-suggestions"><span>Try asking</span><button onClick={()=>setQuery("Compare the evaluation methods and identify conflicts.")}>Compare methods</button><button onClick={()=>setQuery("What evidence gaps remain for long-document retrieval?")}>Find evidence gaps</button><button onClick={()=>setQuery("What does recent research say about privacy risks in retrieval augmented generation?")}>Check privacy risks</button></div></section><aside className="ax-panel ax-chat-context"><h3>Research context</h3><p>Sources currently in scope</p>{docs.slice(0,4).map(d=><div className="ax-context-doc" key={d.id}><span className="ax-file-icon">{d.type}</span><span><b>{d.title}</b><small>{d.pages} pages</small></span></div>)}<div className="ax-context-divider"/><h3>Answer standard</h3><ul><li>Link claims to source passages</li><li>Keep disagreements visible</li><li>Flag missing evidence</li><li>Separate external research</li></ul><div className="ax-demo-notice"><span>i</span><p>Ask general topic doubts here. For GPT-like conversational explanations, configure OPENAI_API_KEY in server secrets; papers are optional context and will be attached to topic modules.</p></div></aside></div>}
          {active === "Collections" && <div className="ax-collections-view"><section className="ax-panel ax-create-collection"><p className="ax-eyebrow">CURATE YOUR RESEARCH</p><h2>Make a collection useful.</h2><p>Group source documents, claims, conflict pairs, saved answers, and open evidence gaps by research question.</p><form onSubmit={e=>{e.preventDefault();addCollection();}}><label htmlFor="new-collection">Collection name</label><input id="new-collection" value={newCollection} onChange={e=>setNewCollection(e.target.value)} placeholder="e.g. Long-document evaluation"/><button className="ax-primary-button" type="submit">Create collection +</button></form></section><div className="ax-collection-grid">{collections.map((c,i)=>{const sources=allSources.filter(source=>c.sourceIds.includes(source.id));const moduleDocs=docs.filter(doc=>c.documentIds.includes(doc.id));const moduleNotes=notes.filter(note=>c.noteIds.includes(note.id)||note.collectionId===c.id);return <article className="ax-panel ax-collection-card ax-topic-module" key={c.id}><div className={"ax-collection-icon ci-" + (i%3)}>▦</div><span className="ax-collection-count">TOPIC MODULE · {new Date(c.createdAt).toLocaleDateString()}</span><h3>{c.name}</h3><p>{c.queryHistory.length} searches · {sources.length} papers · {moduleDocs.length} documents · {moduleNotes.length} notes</p>{c.queryHistory.length>0&&<div className="ax-topic-searches"><b>Search history</b>{c.queryHistory.slice(-5).map((q,qi)=><button key={qi} onClick={()=>{setQuery(q);setActive("Chat");}}>{q}</button>)}</div>}{sources.length>0&&<div className="ax-topic-papers"><b>Research papers</b>{sources.map(source=><div key={source.id} className="ax-topic-paper"><a href={source.url} target="_blank" rel="noreferrer">{source.title} ↗</a><button onClick={()=>{markSourceRead(source,c.name);window.open(source.url,"_blank","noopener,noreferrer");}}>{c.readSourceIds.includes(source.id)?"Read ✓":"Mark read / Open"}</button></div>)}</div>}<div className="ax-collection-card-footer"><span>{c.readSourceIds.length} read · {c.sourceIds.length-c.readSourceIds.length} unread</span><button onClick={()=>{setActiveCollectionId(c.id);setPaperQuery(c.name);setActive("Research search");}}>Search this topic ↗</button></div></article>})}</div></div>}
          {active === "Notes" && <div className="ax-notes-layout"><section className="ax-panel ax-note-editor"><p className="ax-eyebrow">CAPTURE A THOUGHT</p><h2>Keep the reasoning, not just the quote.</h2><form onSubmit={e=>{e.preventDefault();saveNote();}}><label htmlFor="note-title">Note title</label><input id="note-title" value={noteTitle} onChange={e=>setNoteTitle(e.target.value)} placeholder="What do you want to remember?"/><label htmlFor="note-body">Note</label><textarea id="note-body" value={noteBody} onChange={e=>setNoteBody(e.target.value)} rows={5} placeholder="Connect this thought to a claim, conflict, or research gap..."/><button className="ax-primary-button" type="submit">Save note +</button></form></section><section className="ax-notes-list">{notes.map(n=><article className="ax-panel ax-note-card" key={n.id}><div className="ax-note-card-top"><span className="ax-note-tag">{n.tag}</span><span>{new Date(n.id===1?Date.now():n.id).toLocaleDateString()}</span></div><h3>{n.title}</h3><p>{n.body}</p><div className="ax-note-card-footer"><span>Linked to Retrieval Quality Study</span><button onClick={()=>{setQuery("Review this note: " + n.title + ". " + n.body);setActive("Chat");}}>Discuss in chat ↗</button></div></article>)}</section></div>}
          {active === "Knowledge graph" && <section className="ax-panel ax-graph-panel"><div className="ax-panel-heading"><div><h2>Source relationship map</h2><p>{graphNodes.length} retrieved sources · {graphEdges.length} content-similarity connections</p></div><select value={graphFilter} onChange={e=>setGraphFilter(e.target.value)} aria-label="Filter graph relationships"><option>All relationships</option><option>Connections only</option></select></div>
            <div className="ax-graph-legend"><span><i className="legend-agree"/> Shared concepts from titles and retrieved text</span><span>Lines show content similarity only—not agreement, endorsement, or citations.</span></div>
            {graphNodes.length > 0 ? <div className="ax-graph-canvas ax-source-graph"><svg viewBox="0 0 1000 650" role="img" aria-label="Interactive graph of retrieved research papers and web sources"><defs><marker id="ax-sim-arrow" markerWidth="7" markerHeight="7" refX="5" refY="3" orient="auto"><path d="M0,0 L0,6 L6,3 z" fill="var(--ax-graph-edge)"/></marker></defs>
              {(graphFilter === "Connections only" ? graphEdges : graphEdges).map((edge,i)=>{const from=graphNodes.find(node=>node.source.id===edge.from.source.id)!;const to=graphNodes.find(node=>node.source.id===edge.to.source.id)!;return <g key={`${edge.from.source.id}-${edge.to.source.id}`} className="ax-graph-edge-hit" role="button" tabIndex={0} aria-label={`Shared concepts: ${edge.concepts.join(", ")}`} onClick={()=>setSelectedGraphEdge({from:edge.from.source,to:edge.to.source,concepts:edge.concepts})} onKeyDown={event=>{if(event.key==="Enter"||event.key===" ")setSelectedGraphEdge({from:edge.from.source,to:edge.to.source,concepts:edge.concepts});}}><line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="var(--ax-graph-edge)" strokeWidth={selectedGraphEdge?.from.id===edge.from.source.id&&selectedGraphEdge?.to.id===edge.to.source.id?4:1.5} opacity=".72" markerEnd="url(#ax-sim-arrow)"/><line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="transparent" strokeWidth="14"/></g>})}
              {graphNodes.map((node,i)=><g key={node.source.id} className="ax-graph-source-node" role="button" tabIndex={0} aria-label={`Inspect ${node.source.title}`} onClick={()=>setSelectedGraphSource(node.source)} onKeyDown={event=>{if(event.key==="Enter"||event.key===" ")setSelectedGraphSource(node.source);}}><rect x={node.x-82} y={node.y-27} width="164" height="54" rx="9" fill={selectedGraphSource?.id===node.source.id?"var(--ax-graph-topic-bg)":"var(--ax-graph-node-bg)"} stroke={selectedGraphSource?.id===node.source.id?"var(--ax-graph-topic-border)":"var(--ax-graph-node-border)"}/><text x={node.x} y={node.y-7} textAnchor="middle" fill="var(--ax-graph-text)" fontSize="10" fontWeight="700">{node.source.title.length>23?node.source.title.slice(0,22)+"…":node.source.title}</text><text x={node.x} y={node.y+12} textAnchor="middle" fill="var(--ax-graph-muted)" fontSize="9">{node.source.provider}{node.source.year?` · ${node.source.year}`:""}</text></g>)}
            </svg></div> : <div className="ax-empty-state">No retrieved sources yet. Search a topic in Research search first; its actual results will appear here as nodes.</div>}
            {selectedGraphSource && <div className="ax-graph-detail"><div><span className="ax-collection-count">SELECTED SOURCE · {selectedGraphSource.provider}</span><h3>{selectedGraphSource.title}</h3><p>{selectedGraphSource.abstract || "No abstract or snippet was provided by this source."}</p><a href={selectedGraphSource.url} target="_blank" rel="noreferrer">Open original source ↗</a></div><button className="ax-secondary-button" onClick={()=>setSelectedGraphSource(null)}>Close</button></div>}
            {selectedGraphEdge && <div className="ax-graph-detail ax-edge-detail"><div><span className="ax-collection-count">WHY THESE SOURCES ARE CONNECTED</span><h3>{selectedGraphEdge.from.title} ↔ {selectedGraphEdge.to.title}</h3><p>Both retrieved text records contain these shared concepts: <b>{selectedGraphEdge.concepts.join(", ")}</b>.</p><p>This is a lexical similarity signal, not proof that the sources agree. Review both source texts before drawing conclusions.</p><div className="ax-edge-links"><a href={selectedGraphEdge.from.url} target="_blank" rel="noreferrer">Open source A ↗</a><a href={selectedGraphEdge.to.url} target="_blank" rel="noreferrer">Open source B ↗</a></div></div><button className="ax-secondary-button" onClick={()=>setSelectedGraphEdge(null)}>Close</button></div>}
            <div className="ax-demo-notice"><span>i</span><p>Nodes come from actual retrieved search records. Connections require at least two shared non-generic terms from source titles and abstracts/snippets. Citation relationships are not inferred or mixed with similarity edges.</p></div>
          </section>}
        </div>
      </section>
    </main>
  );
}

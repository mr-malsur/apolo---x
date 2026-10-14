// Server-only access to this app's Cloudflare bindings. Each is present ONLY if
// opted into via app.manifest.json (D1 `DB`, R2 `STORAGE`, KV `KV`, and the
// container `CONTAINER`) — so the accessors are optional; guard before use.
// `cloudflare:workers` is the Workers-runtime module that exposes the Worker
// env (bindings) — usable inside any server-side code (server functions,
// server routes). It is NOT bundled; the runtime provides it.
// Import the binding types directly — NOT via the global tsconfig `types` list,
// which would clobber the DOM globals the client/SSR React code relies on.
import type {
  D1Database,
  DurableObjectNamespace,
  KVNamespace,
  R2Bucket,
} from "@cloudflare/workers-types";

type AppEnv = {
  DB?: D1Database;
  STORAGE?: R2Bucket;
  KV?: KVNamespace;
  // The container's Durable Object — present only when "container" is set in
  // the manifest. Reach an instance with env.CONTAINER.getByName(id), then
  // .fetch(). See skills/containers.md.
  CONTAINER?: DurableObjectNamespace;
  HF_ENV?: string;
  APP_SLUG?: string;
  OPENAI_API_KEY?: string;
};

let workerEnv: AppEnv = {};

// Cloudflare exposes this virtual module in production. Local Vite development
// does not, so use a guarded dynamic import and fall back to process env.
try {
  const cloudflare = await import(/* @vite-ignore */ "cloudflare:workers") as { env?: AppEnv };
  workerEnv = cloudflare.env ?? {};
} catch {
  workerEnv = {};
}

export function bindings(): AppEnv {
  const localProcess = (globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> };
  }).process;
  return {
    ...workerEnv,
    OPENAI_API_KEY: workerEnv.OPENAI_API_KEY ?? localProcess?.env?.OPENAI_API_KEY,
    HF_ENV: workerEnv.HF_ENV ?? localProcess?.env?.HF_ENV,
    APP_SLUG: workerEnv.APP_SLUG ?? localProcess?.env?.APP_SLUG,
  };
}

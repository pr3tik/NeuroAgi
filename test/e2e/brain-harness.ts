// test/e2e/brain-harness.ts
// Shared LIVE end-to-end harness for the NeuroAGI brain. This is NOT a test file (no `.test.`
// suffix) — it is imported by e2e specs. It self-loads creds from .env.local at import (never
// printing them); when creds are absent (e.g. CI / Node-20) LIVE=false so specs skip cleanly.
//
// Design goals:
//  - Real execution: invoke the actual API handlers and the actual kernel against the REAL prod DB.
//  - Auth without a JWT: use the documented trusted in-process path (__internalUserId), which a
//    real HTTP request can never set (Vercel only fills headers/body/query from the wire).
//  - Safe on prod: every write lives under a per-test unique namespace; cleanup is a handful of
//    single targeted DELETE statements (NEVER a REST delete loop — see the bulk-delete incident).
import { readFileSync } from "fs";
import { resolve } from "path";
import { postgrestStore } from "../../api/_brain/kernel.ts";

const REPO = process.cwd();
const REF = "wqgxpouhbwhwpzudrptp";

function envFromLocal(key: string): string | undefined {
  for (const f of [".env.local", ".env"]) {
    try {
      const raw = readFileSync(resolve(REPO, f), "utf8");
      const m = raw.match(new RegExp(`^${key}=(.+)$`, "m"));
      if (m?.[1]) return m[1].trim().replace(/^["']|["']$/g, "");
    } catch { /* try next */ }
  }
  return process.env[key];
}

export const SUPABASE_URL = envFromLocal("SUPABASE_URL") || envFromLocal("VITE_SUPABASE_URL");
export const SUPABASE_SERVICE_KEY = envFromLocal("SUPABASE_SERVICE_KEY");
const PAT = envFromLocal("SUPABASE_ACCESS_TOKEN");
export const LIVE = !!(SUPABASE_URL && SUPABASE_SERVICE_KEY);

// Make the creds visible to handlers that read process.env directly.
if (SUPABASE_URL) process.env.SUPABASE_URL = SUPABASE_URL;
if (SUPABASE_SERVICE_KEY) process.env.SUPABASE_SERVICE_KEY = SUPABASE_SERVICE_KEY;

export function conn() { return { url: SUPABASE_URL!, key: SUPABASE_SERVICE_KEY! }; }
export function store() { return postgrestStore(SUPABASE_URL!, SUPABASE_SERVICE_KEY!); }

export function mockRes() {
  return {
    statusCode: 0, body: null as any, _headers: {} as Record<string, any>,
    status(c: number) { this.statusCode = c; return this; },
    json(o: any) { this.body = o; return this; },
    setHeader(k: string, v: any) { this._headers[k] = v; return this; },
    end() { return this; },
  };
}

/**
 * Invoke an API handler as an authenticated caller via the trusted in-process path
 * (__internalUserId — unforgeable from the wire). For an unauthenticated test, omit userId
 * (and pass headers:{} so there's no bearer token) → the handler's real 401 path runs.
 */
export async function invoke(
  handler: Function,
  opts: { userId?: string | null; body?: any; query?: any; headers?: any; method?: string } = {},
) {
  const req: any = { method: opts.method || "POST", headers: opts.headers || {}, query: opts.query || {}, body: opts.body ?? {} };
  if (opts.userId) req.__internalUserId = opts.userId;
  const res = mockRes();
  await handler(req, res);
  return res;
}

/** Management-API SQL (DDL/DML/inspection). Never prints the PAT. Throws on non-2xx. */
export async function sql(query: string): Promise<any> {
  if (!PAT) throw new Error("no SUPABASE_ACCESS_TOKEN in .env.local");
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${PAT}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`sql ${r.status}: ${text.slice(0, 300)}`);
  try { return JSON.parse(text); } catch { return text; }
}

/** A unique namespace so parallel specs never collide. */
export function ns(tag: string) {
  const t = tag.replace(/[^a-z0-9_-]/gi, "").slice(0, 24);
  return {
    tag: t,
    subj: (n: string | number) => `person:e2e:${t}:${n}`,   // agent-controlled subject (kernel path)
    localId: (n: string | number) => `e2e:${t}:${n}`,       // fake product user id (handler path)
    email: (n: string | number) => `e2e-${t}-${n}@neuro.invalid`,
    capName: (n: string | number) => `e2e-${t}-${n}`,
  };
}

/** Targeted cleanup for a tag — single statements only. Safe on prod. */
export async function cleanupTag(tag: string) {
  const t = ns(tag).tag;
  await sql(`
    delete from public.neuro_memory where subject like 'person:e2e:${t}:%';
    delete from public.neuro_memory where subject in (select 'person:'||person_id from public.neuro_person_link where local_id like 'e2e:${t}:%');
    delete from public.neuro_person where id in (select person_id from public.neuro_person_link where local_id like 'e2e:${t}:%');
    delete from public.neuro_person where email like 'e2e-${t}-%@neuro.invalid';
    delete from public.neuro_capability where name like 'e2e-${t}-%';
  `);
}

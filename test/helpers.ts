// Shared test helpers: a chainable Supabase mock, a fake Vercel res, a tiny WAV
// generator (for the live transcription smoke test), and an .env.local key loader.
import { vi } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

// ── Chainable, awaitable Supabase mock ──────────────────────────────────────
// PostgREST query builders are thenable AND chainable. This mock mirrors that:
// from(table).select().eq().limit() etc. all return the builder, and awaiting it
// calls your `router({ table, op, payload, filters })` to produce { data, error }.
// `.calls` records every terminal op so tests can assert what was written.
export function makeSupabaseMock(router: (ctx: any) => any = () => ({ data: null, error: null })) {
  const calls: any[] = [];
  const TERMINALS = ["insert", "upsert", "update", "delete", "select"];
  const FILTERS = ["eq", "neq", "is", "in", "gt", "lt", "gte", "lte", "not", "limit", "order", "match", "range", "maybeSingle", "single", "filter"];

  function builder(ctx: any) {
    const b: any = {};
    const WRITES = ["insert", "upsert", "update", "delete"];
    for (const op of TERMINALS) {
      b[op] = vi.fn((arg: any) => {
        // `.insert(...).select()` / `.update(...).select()` — a trailing select must not
        // downgrade the write op the router keys on.
        if (!(op === "select" && WRITES.includes(ctx.op))) { ctx.op = op; ctx.payload = arg; }
        calls.push({ ...ctx });
        return b;
      });
    }
    for (const f of FILTERS) {
      b[f] = vi.fn((...args: any[]) => { ctx.filters.push([f, ...args]); return b; });
    }
    b.then = (onOk: any, onErr?: any) => Promise.resolve(router(ctx)).then(onOk, onErr);
    return b;
  }

  const client: any = {
    from: vi.fn((table: string) => builder({ table, op: "select", payload: undefined, filters: [] })),
    rpc: vi.fn((name: string, args: any) => {
      const ctx = { table: `rpc:${name}`, op: "rpc", payload: args, filters: [] };
      calls.push({ ...ctx });
      return { then: (onOk: any, onErr?: any) => Promise.resolve(router(ctx)).then(onOk, onErr) };
    }),
    storage: {
      from: vi.fn((bucket: string) => {
        const op = (name: string, payload: any) => {
          const ctx = { table: `storage:${bucket}`, op: name, payload, filters: [] };
          calls.push(ctx);
          return Promise.resolve(router(ctx) ?? { data: null, error: null });
        };
        return {
          createSignedUploadUrl: vi.fn((path: string) => op("createSignedUploadUrl", path)),
          download:              vi.fn((path: string) => op("download", path)),
          remove:                vi.fn((paths: any)   => op("remove", paths)),
          uploadToSignedUrl:     vi.fn(() => Promise.resolve({ data: {}, error: null })),
        };
      }),
    },
  };
  return { client, calls };
}

// ── Fake Vercel (req,res) ───────────────────────────────────────────────────
export function makeRes() {
  const res: any = { statusCode: 200, headers: {}, body: undefined };
  res.setHeader = vi.fn((k: string, v: any) => { res.headers[k] = v; });
  res.status = vi.fn((c: number) => { res.statusCode = c; return res; });
  res.json = vi.fn((o: any) => { res.body = o; return res; });
  res.end = vi.fn((o?: any) => { if (o !== undefined) res.body = o; return res; });
  return res;
}

// ── Minimal valid 16-bit PCM mono WAV (a short sine tone) ───────────────────
export function makeWavBytes(seconds = 0.4, freq = 440, rate = 8000): Uint8Array {
  const n = Math.floor(seconds * rate);
  const dataLen = n * 2;
  const buf = new ArrayBuffer(44 + dataLen);
  const dv = new DataView(buf);
  const ws = (off: number, s: string) => { for (let i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i)); };
  ws(0, "RIFF"); dv.setUint32(4, 36 + dataLen, true); ws(8, "WAVE");
  ws(12, "fmt "); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, rate, true); dv.setUint32(28, rate * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  ws(36, "data"); dv.setUint32(40, dataLen, true);
  for (let i = 0; i < n; i++) dv.setInt16(44 + i * 2, Math.sin((2 * Math.PI * freq * i) / rate) * 0.3 * 32767, true);
  return new Uint8Array(buf);
}

// ── Read a key from process.env, then .env.local / .env (mirrors vite.config) ─
export function loadEnvKey(key: string): string | undefined {
  if (process.env[key]) return process.env[key];
  for (const file of [".env.local", ".env"]) {
    try {
      const raw = readFileSync(resolve(process.cwd(), file), "utf8");
      const m = raw.match(new RegExp(`^${key}=(.+)$`, "m"));
      if (m?.[1]) return m[1].trim().replace(/^["']|["']$/g, "");
    } catch { /* file missing */ }
  }
  return undefined;
}

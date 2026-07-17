// api/_tracesink.ts — persistent gateway trace sink (BE-12): every LLM call the gateway
// makes lands as a row in public.prompt_runs (provider/model/tokens/latency/cost/status),
// keeping the stdout span too so Vercel logs stay useful.
//
// Design constraints:
//   • NEVER throws and NEVER blocks a model call — inserts are fire-and-forget with a
//     small in-memory batch (serverless instances are short-lived, so we flush eagerly).
//   • Lazy Supabase client (no client at module load — Node-20 test runner would crash).
//     [[ci-node20-supabase-import]]
//   • No prompt/response TEXT is persisted — only telemetry + caller metadata. Raw text
//     stays out of the DB by design (threat model: "sensitive logs").
import { createClient } from "@supabase/supabase-js";
import { setTraceSink, type TraceSpan } from "./_gateway.js";

let _client: any = null;
function svc() {
  if (_client) return _client;
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  // createClient can THROW at construction, not just fail a query: on Node < 22 without a
  // global WebSocket, supabase-js eagerly builds its RealtimeClient and throws. This sink
  // never uses realtime (insert-only) and its contract is "NEVER throws / tracing must
  // never break a call" — so a construction failure must degrade to no-op, exactly like a
  // missing env var, not escape as an unhandled rejection through the fire-and-forget
  // flush(). (This is what turned the whole CI test run red under Node 20.)
  try {
    _client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  } catch (e: any) {
    console.error("[tracesink] client init failed — telemetry disabled:", e?.message);
    _client = null;
  }
  return _client;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const asUuid = (v: any) => (typeof v === "string" && UUID_RE.test(v) ? v : null);

function toRow(s: TraceSpan) {
  const m = s.metadata ?? {};
  return {
    trace_id: s.trace_id,
    ts: s.ts,
    task: s.task,
    scope: typeof m.scope === "string" ? m.scope : null,
    user_id: typeof m.user_id === "string" ? m.user_id.slice(0, 128) : null,
    room_id: asUuid(m.room_id),
    session_id: asUuid(m.session_id),
    persona: typeof m.persona === "string" ? m.persona : null,
    provider: s.provider,
    model: s.model,
    input_tokens: s.usage?.input_tokens ?? null,
    output_tokens: s.usage?.output_tokens ?? null,
    cache_read: s.usage?.cache_read_input_tokens ?? null,
    cache_write: s.usage?.cache_creation_input_tokens ?? null,
    latency_ms: Math.round(s.latency_ms),
    cost_usd: s.cost_usd,
    status: s.ok ? "ok" : "error",
    fell_back: s.fell_back,
    attempts: s.attempts,
    error: s.error ? String(s.error).slice(0, 500) : null,
    // metadata minus fields we already lifted into columns; NEVER prompt text.
    metadata: (() => {
      const { scope, user_id, room_id, session_id, persona, ...rest } = m;
      return Object.keys(rest).length ? rest : null;
    })(),
  };
}

let buffer: any[] = [];
let flushing = false;
async function flush() {
  if (flushing || buffer.length === 0) return;
  const sb = svc();
  if (!sb) { buffer = []; return; }          // not configured (tests/local) → drop silently
  flushing = true;
  const rows = buffer.splice(0, 50);
  try {
    const { error } = await sb.from("prompt_runs").insert(rows);
    if (error) console.error("[tracesink] insert failed:", error.message);
  } catch (e: any) {
    console.error("[tracesink] flush failed:", e?.message);
  } finally {
    flushing = false;
    if (buffer.length) void flush();
  }
}

let installed = false;
/** Install the persistent sink (idempotent). Called from the gateway at module load. */
export function installTraceSink() {
  if (installed) return;
  installed = true;
  setTraceSink((span) => {
    try { console.log("[gateway]", JSON.stringify(span)); } catch { /* keep stdout spans */ }
    try {
      buffer.push(toRow(span));
      void flush();                          // eager: serverless instances die young
    } catch { /* tracing must never break a call */ }
  });
}

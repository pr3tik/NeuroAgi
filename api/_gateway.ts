// api/_gateway.ts — the LLM gateway (a `_`-prefixed helper, NOT a Vercel route).
//
// Single choke point for every model call in the system. It sits at the stable
// model-call seam — `(task, messages, system?, tools?) → completion` — and owns the
// cross-cutting concerns that don't belong in any one caller:
//
//   • routing      — a task label → (provider, model) map, env-overridable (PRD §7.1)
//   • prompt cache  — opt-in cache_control breakpoint on the system prefix (Anthropic)
//   • cost          — per-model USD accounting incl. cache-read/write tiers
//   • resilience    — retry w/ backoff on 429/5xx/network, optional model fallback
//   • timeouts      — per-attempt deadline via AbortController
//   • observability — one structured trace span per call, via an injectable sink
//
// It is provider-agnostic: `anthropic` (Messages API) and `groq` (OpenAI-compatible
// chat-completions) are adapters behind one normalized request/response shape. The
// thin HTTP endpoints (api/claude.ts, api/groq.ts) are adapters over `callModel` /
// `openStream`; product handlers should migrate onto `callModel` over time so model
// routing/cost/trace live in exactly one place.
//
// Model-API correctness notes (Anthropic): sonnet-4-6 / opus-4-x / fable-5 reject
// `temperature`/`top_p`/`top_k` and `budget_tokens` with a 400 — we never send them.
// Thinking, when enabled, is always `{type:"adaptive"}` (never budget_tokens) and only
// for models that support it. `temperature` is sent to Groq only (OpenAI-compatible).

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type Provider = "anthropic" | "groq";

// Task labels are the routing keys. Unknown labels fall back to "default".
// Callers pass a label, not a model — that's the whole point of the gateway.
export type Task =
  | "route" | "classify" | "summarize" | "cheap"
  | "tutor" | "default" | "deep" | "reasoning"
  | (string & {});

export interface ChatMessage { role: string; content: any; }

export interface GatewayRequest {
  task?: Task;                       // routing key (default "default")
  model?: string;                    // explicit model override (skips the route table)
  provider?: Provider;               // explicit provider override (else inferred from model)
  messages: ChatMessage[];
  system?: string | any[];           // string OR content-block array (cache_control-capable)
  max_tokens?: number;
  tools?: any[];
  cache?: boolean;                   // add an ephemeral cache breakpoint on the system prefix
  thinking?: boolean;                // opt-in adaptive thinking (Anthropic, supported models)
  temperature?: number;             // Groq only; ignored for Anthropic (would 400)
  fallback?: boolean;                // allow model fallback on failure (default: route's setting)
  timeoutMs?: number;                // per-attempt deadline (default DEFAULT_TIMEOUT_MS)
  maxRetries?: number;               // retries per model on retryable errors (default 2)
  signal?: AbortSignal;              // caller cancellation
  metadata?: Record<string, any>;    // forwarded into the trace span (user_id, scenario, …)
}

export interface NormalizedUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
}

export interface GatewayResult {
  ok: boolean;
  status: number;                    // HTTP-ish status the HTTP adapter can forward
  content: string;                   // joined assistant text
  contentBlocks: any[];              // Anthropic content blocks (tool_use loop); [] for Groq
  stop_reason: string | null;
  usage: NormalizedUsage | null;
  model: string;
  provider: Provider;
  cost_usd: number;
  trace_id: string;
  attempts: number;                  // total upstream attempts across all candidates
  fell_back: boolean;                // a non-primary model produced the result
  error?: string;
  detail?: string;
}

export interface GatewayStream {
  ok: boolean;
  status: number;
  stream: ReadableStream<Uint8Array> | null;  // raw SSE body to pipe to the client
  model: string;
  provider: Provider;
  trace_id: string;
  error?: string;
  detail?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pricing (USD per 1M tokens). Cache read ≈ 0.1× input, cache write ≈ 1.25× input.
// Unknown models price at 0 (cost is best-effort, never throws).
// ─────────────────────────────────────────────────────────────────────────────

const PRICES: Record<string, { in: number; out: number }> = {
  "claude-opus-4-8":            { in: 5,    out: 25 },
  "claude-opus-4-7":            { in: 5,    out: 25 },
  "claude-opus-4-6":            { in: 5,    out: 25 },
  "claude-sonnet-4-6":          { in: 3,    out: 15 },
  "claude-haiku-4-5":           { in: 1,    out: 5  },
  "claude-haiku-4-5-20251001":  { in: 1,    out: 5  },
  "claude-fable-5":             { in: 10,   out: 50 },
  "llama-3.1-8b-instant":       { in: 0.05, out: 0.08 },
};

export function costUSD(model: string, u: NormalizedUsage | null): number {
  if (!u) return 0;
  const p = PRICES[model];
  if (!p) return 0;
  const inRate = p.in / 1e6, outRate = p.out / 1e6;
  return (
    u.input_tokens * inRate +
    u.output_tokens * outRate +
    u.cache_read_input_tokens * inRate * 0.1 +
    u.cache_creation_input_tokens * inRate * 1.25
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Routing — task → (provider, model, fallback). Models are env-overridable so the
// policy can change without a redeploy; ANTHROPIC_MODEL keeps its prior meaning
// (the tutor/default model) for backward compatibility with the old claude proxy.
// Read at CALL time (not module load) so the dev-proxy's per-request env injection
// is always reflected.
// ─────────────────────────────────────────────────────────────────────────────

interface Route { provider: Provider; model: string; fallback?: { provider: Provider; model: string }; thinking?: boolean; }

export function resolveRoute(req: GatewayRequest): Route & { allowFallback: boolean } {
  const env = (k: string) => (process.env[k]?.trim() || undefined);

  // Explicit model override bypasses the table; provider inferred from the id.
  if (req.model) {
    const provider = req.provider ?? inferProvider(req.model);
    return { provider, model: req.model, allowFallback: req.fallback ?? false };
  }

  const HAIKU  = env("ANTHROPIC_MODEL_CHEAP") || "claude-haiku-4-5";
  const SONNET = env("ANTHROPIC_MODEL")       || "claude-sonnet-4-6"; // legacy var = tutor/default
  const OPUS   = env("ANTHROPIC_MODEL_DEEP")  || "claude-opus-4-8";
  const GROQ_MODEL = env("GROQ_MODEL") || "llama-3.1-8b-instant";

  const table: Record<string, Route> = {
    cheap:     { provider: "groq",      model: GROQ_MODEL },
    route:     { provider: "anthropic", model: HAIKU },
    classify:  { provider: "anthropic", model: HAIKU },
    summarize: { provider: "anthropic", model: HAIKU,  fallback: { provider: "groq", model: GROQ_MODEL } },
    tutor:     { provider: "anthropic", model: SONNET, fallback: { provider: "anthropic", model: HAIKU } },
    default:   { provider: "anthropic", model: SONNET, fallback: { provider: "anthropic", model: HAIKU } },
    deep:      { provider: "anthropic", model: OPUS,   fallback: { provider: "anthropic", model: SONNET }, thinking: true },
    reasoning: { provider: "anthropic", model: OPUS,   fallback: { provider: "anthropic", model: SONNET }, thinking: true },
  };

  const route = table[req.task ?? "default"] ?? table.default;
  // Per-request override of provider (rare); else the route's provider.
  const provider = req.provider ?? route.provider;
  // Fallback is on by default for routes that declare one, unless the caller opts out.
  const allowFallback = req.fallback ?? !!route.fallback;
  return { ...route, provider, allowFallback };
}

function inferProvider(model: string): Provider {
  return /^claude[-/]|^anthropic/i.test(model) ? "anthropic" : "groq";
}

function supportsThinking(model: string): boolean {
  // Adaptive thinking is available on sonnet-4-6 / opus-4.x / fable-5 (not haiku, not llama).
  return /claude-(sonnet-4-6|opus-4-[5-9]|opus-4-1[0-9])|claude-fable-5/i.test(model);
}

// ─────────────────────────────────────────────────────────────────────────────
// Trace sink — one structured span per call. Default: structured stdout (captured
// by Vercel logs). Swap in a persistent store (Supabase trace table) via setTraceSink
// without touching the gateway — this is the seam that keeps the gateway DB-free.
// ─────────────────────────────────────────────────────────────────────────────

export interface TraceSpan {
  evt: "llm_call";
  trace_id: string;
  ts: string;
  task: string;
  provider: Provider;
  model: string;
  ok: boolean;
  status: number;
  streamed: boolean;
  latency_ms: number;
  attempts: number;
  fell_back: boolean;
  usage: NormalizedUsage | null;
  cost_usd: number;
  error?: string;
  metadata?: Record<string, any>;
}

let traceSink: (span: TraceSpan) => void = (span) => {
  try { console.log("[gateway]", JSON.stringify(span)); } catch { /* never throw from tracing */ }
};
export function setTraceSink(fn: (span: TraceSpan) => void) { traceSink = fn; }
function emit(span: TraceSpan) { try { traceSink(span); } catch { /* sink must never break a call */ } }

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 2;
const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504, 529]);
const MODEL_ACCESS_FAIL = new Set([403, 404]); // wrong/inaccessible model → try the fallback model

// Anthropic rejects empty-string content; array content (tool_use/tool_result blocks)
// must pass through untouched. Mirrors the original api/claude.ts sanitization.
function sanitizeMessages(messages: ChatMessage[]): ChatMessage[] {
  return (messages || [])
    .filter((m) => m?.role && m?.content != null)
    .map((m) => (Array.isArray(m.content)
      ? { role: m.role, content: m.content }
      : { role: m.role, content: String(m.content).trim() }))
    .filter((m) => (Array.isArray(m.content) ? m.content.length > 0 : (m.content as string).length > 0));
}

function apiKey(provider: Provider): string | undefined {
  return provider === "anthropic" ? process.env.ANTHROPIC_API_KEY : process.env.GROQ_KEY;
}

function modelCeiling(model: string, stream: boolean): number {
  // Streaming can safely request large outputs; non-streaming must stay under SDK/HTTP
  // timeouts. These are conservative caps, not the models' hard maxima.
  if (/opus-4|fable-5/i.test(model)) return stream ? 64_000 : 16_000;
  if (/sonnet-4-6/i.test(model))     return stream ? 64_000 : 16_000;
  return stream ? 32_000 : 8_000; // haiku / llama
}

// Build the provider-specific request body from the normalized request.
function buildBody(provider: Provider, model: string, req: GatewayRequest, stream: boolean, thinkingRoute: boolean): any {
  const messages = sanitizeMessages(req.messages);
  const maxTokens = Math.max(1, Math.min(Number(req.max_tokens) || 1024, modelCeiling(model, stream)));

  if (provider === "groq") {
    // OpenAI-compatible: system folds into the messages array; temperature is allowed.
    const sys = typeof req.system === "string" ? req.system.trim() : "";
    return {
      model,
      messages: [...(sys ? [{ role: "system", content: sys }] : []), ...messages],
      max_tokens: maxTokens,
      temperature: req.temperature ?? 0.7,
      ...(stream ? { stream: true } : {}),
    };
  }

  // Anthropic Messages API.
  const body: any = { model, max_tokens: maxTokens, messages };

  // system: string OR content-block array. With cache:true we ensure an ephemeral
  // breakpoint on the LAST system block (prefix-cache the stable preamble).
  if (Array.isArray(req.system) && req.system.length) {
    body.system = req.cache ? withCacheBreakpoint(req.system) : req.system;
  } else if (typeof req.system === "string" && req.system.trim()) {
    const text = req.system.trim();
    body.system = req.cache
      ? [{ type: "text", text, cache_control: { type: "ephemeral" } }]
      : text;
  }

  if (Array.isArray(req.tools) && req.tools.length) body.tools = req.tools;

  // Adaptive thinking — never budget_tokens (would 400 on these models). Enabled when
  // the caller asks OR the route is a deep/reasoning route, and the model supports it.
  if ((req.thinking || thinkingRoute) && supportsThinking(model)) {
    body.thinking = { type: "adaptive" };
  }

  if (stream) body.stream = true;
  return body;
}

function withCacheBreakpoint(system: any[]): any[] {
  // Place exactly one ephemeral breakpoint on the last block; leave any caller-set
  // breakpoints intact on earlier blocks.
  const out = system.map((b) => ({ ...b }));
  const last = out[out.length - 1];
  if (last && typeof last === "object") last.cache_control = last.cache_control ?? { type: "ephemeral" };
  return out;
}

function endpoint(provider: Provider): string {
  return provider === "anthropic"
    ? "https://api.anthropic.com/v1/messages"
    : "https://api.groq.com/openai/v1/chat/completions";
}

function headers(provider: Provider, key: string): Record<string, string> {
  return provider === "anthropic"
    ? { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" }
    : { "Content-Type": "application/json", Authorization: `Bearer ${key}` };
}

// Combine the caller's signal with a per-attempt timeout into one signal.
function attemptSignal(req: GatewayRequest): AbortSignal {
  const timeout = AbortSignal.timeout(req.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  if (req.signal && typeof (AbortSignal as any).any === "function") {
    return (AbortSignal as any).any([req.signal, timeout]);
  }
  return timeout;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Normalize the per-provider usage object to one shape.
function normalizeUsage(provider: Provider, raw: any): NormalizedUsage | null {
  if (!raw) return null;
  if (provider === "anthropic") {
    return {
      input_tokens: raw.input_tokens ?? 0,
      output_tokens: raw.output_tokens ?? 0,
      cache_read_input_tokens: raw.cache_read_input_tokens ?? 0,
      cache_creation_input_tokens: raw.cache_creation_input_tokens ?? 0,
    };
  }
  return {
    input_tokens: raw.prompt_tokens ?? 0,
    output_tokens: raw.completion_tokens ?? 0,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  };
}

interface AttemptOutcome {
  ok: boolean;
  status: number;
  res?: Response;            // the ok Response (body unconsumed) on success
  errorText?: string;
  attempts: number;          // attempts spent on THIS candidate
  retryable: boolean;        // last failure was retryable/model-access (caller may try next candidate)
}

// One candidate (provider+model) with in-candidate retries on retryable statuses.
async function attemptCandidate(
  provider: Provider, model: string, req: GatewayRequest, stream: boolean, thinkingRoute: boolean, key: string,
): Promise<AttemptOutcome> {
  const body = JSON.stringify(buildBody(provider, model, req, stream, thinkingRoute));
  const url = endpoint(provider);
  const hdrs = headers(provider, key);
  const maxRetries = req.maxRetries ?? DEFAULT_MAX_RETRIES;

  let attempts = 0;
  let lastStatus = 0;
  let lastError = "";

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    attempts++;
    if (attempt > 0) await sleep(backoffMs(attempt)); // exponential backoff w/ jitter
    try {
      const res = await fetch(url, { method: "POST", headers: hdrs, body, signal: attemptSignal(req) });
      if (res.ok) return { ok: true, status: res.status, res, attempts, retryable: false };

      lastStatus = res.status;
      lastError = (await res.text().catch(() => "")).slice(0, 500);

      if (MODEL_ACCESS_FAIL.has(res.status)) {
        // wrong/inaccessible model — retrying the same model won't help; let the driver fall back
        return { ok: false, status: res.status, errorText: lastError, attempts, retryable: true };
      }
      if (!RETRYABLE.has(res.status)) {
        // hard error (400/401/…) — neither retry nor fallback will fix the same body
        return { ok: false, status: res.status, errorText: lastError, attempts, retryable: false };
      }
      // retryable → loop (unless this was the last attempt)
    } catch (err: any) {
      // network failure / timeout / abort — retryable
      lastStatus = 0;
      lastError = err?.name === "TimeoutError" || err?.name === "AbortError" ? "request timed out" : (err?.message ?? "network error");
    }
  }
  return { ok: false, status: lastStatus || 502, errorText: lastError, attempts, retryable: true };
}

function backoffMs(attempt: number): number {
  // 0.5s, 1s, 2s … with light jitter to avoid thundering-herd retries.
  return 500 * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 200);
}

// Build the ordered candidate list: primary, then fallback if allowed.
function candidates(route: Route & { allowFallback: boolean }, req: GatewayRequest): Array<{ provider: Provider; model: string; primary: boolean }> {
  const list = [{ provider: route.provider, model: route.model, primary: true }];
  if (route.allowFallback && route.fallback) {
    list.push({ provider: route.fallback.provider, model: route.fallback.model, primary: false });
  }
  return list;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public: non-streaming call
// ─────────────────────────────────────────────────────────────────────────────

export async function callModel(req: GatewayRequest): Promise<GatewayResult> {
  const trace_id = randomId();
  const started = Date.now();
  const route = resolveRoute(req);
  const task = String(req.task ?? "default");

  const clean = sanitizeMessages(req.messages);
  if (!clean.length) {
    return fail(trace_id, route, task, started, 400, "No valid messages after sanitization", null, 0, false);
  }

  let totalAttempts = 0;
  let lastStatus = 502;
  let lastError = "no upstream attempt";
  let lastDetail = "";

  for (const c of candidates(route, req)) {
    const key = apiKey(c.provider);
    if (!key) {
      lastStatus = 500;
      lastError = `${c.provider === "anthropic" ? "ANTHROPIC_API_KEY" : "GROQ_KEY"} not configured`;
      continue; // a fallback on a different provider may still have a key
    }

    const outcome = await attemptCandidate(c.provider, c.model, req, false, !!route.thinking, key);
    totalAttempts += outcome.attempts;

    if (outcome.ok && outcome.res) {
      const raw = await outcome.res.text();
      let data: any;
      try { data = JSON.parse(raw); }
      catch { lastStatus = 502; lastError = "invalid JSON from provider"; lastDetail = raw.slice(0, 300); continue; }

      const { content, contentBlocks, stop_reason } = parseResponse(c.provider, data);
      const usage = normalizeUsage(c.provider, data.usage);
      const cost = costUSD(c.model, usage);
      const latency = Date.now() - started;

      emit({
        evt: "llm_call", trace_id, ts: new Date().toISOString(), task,
        provider: c.provider, model: c.model, ok: true, status: 200, streamed: false,
        latency_ms: latency, attempts: totalAttempts, fell_back: !c.primary,
        usage, cost_usd: cost, metadata: req.metadata,
      });

      return {
        ok: true, status: 200, content, contentBlocks, stop_reason, usage,
        model: c.model, provider: c.provider, cost_usd: cost, trace_id,
        attempts: totalAttempts, fell_back: !c.primary,
      };
    }

    lastStatus = outcome.status;
    lastError = providerErrorMessage(lastDetail = outcome.errorText ?? "");
    if (!outcome.retryable) break; // hard error → don't try the fallback (same body would fail)
  }

  return fail(trace_id, route, task, started, lastStatus, lastError, null, totalAttempts, false, lastDetail);
}

// ─────────────────────────────────────────────────────────────────────────────
// Public: streaming call — returns the raw SSE body for the HTTP layer to pipe.
// Trace is emitted at first-byte (usage isn't available until the final SSE event).
// ─────────────────────────────────────────────────────────────────────────────

export async function openStream(req: GatewayRequest): Promise<GatewayStream> {
  const trace_id = randomId();
  const started = Date.now();
  const route = resolveRoute(req);
  const task = String(req.task ?? "default");

  if (!sanitizeMessages(req.messages).length) {
    return { ok: false, status: 400, stream: null, model: route.model, provider: route.provider, trace_id, error: "No valid messages after sanitization" };
  }

  let lastStatus = 502, lastError = "no upstream attempt", lastDetail = "";
  let attempts = 0;

  for (const c of candidates(route, req)) {
    const key = apiKey(c.provider);
    if (!key) { lastStatus = 500; lastError = `${c.provider === "anthropic" ? "ANTHROPIC_API_KEY" : "GROQ_KEY"} not configured`; continue; }

    const outcome = await attemptCandidate(c.provider, c.model, req, true, !!route.thinking, key);
    attempts += outcome.attempts;

    if (outcome.ok && outcome.res?.body) {
      emit({
        evt: "llm_call", trace_id, ts: new Date().toISOString(), task,
        provider: c.provider, model: c.model, ok: true, status: 200, streamed: true,
        latency_ms: Date.now() - started, attempts, fell_back: !c.primary,
        usage: null, cost_usd: 0, metadata: req.metadata,
      });
      return { ok: true, status: 200, stream: outcome.res.body, model: c.model, provider: c.provider, trace_id };
    }

    lastStatus = outcome.status;
    lastDetail = outcome.errorText ?? "";
    lastError = providerErrorMessage(lastDetail);
    if (!outcome.retryable) break;
  }

  emit({
    evt: "llm_call", trace_id, ts: new Date().toISOString(), task,
    provider: route.provider, model: route.model, ok: false, status: lastStatus, streamed: true,
    latency_ms: Date.now() - started, attempts, fell_back: false, usage: null, cost_usd: 0,
    error: lastError, metadata: req.metadata,
  });
  return { ok: false, status: lastStatus, stream: null, model: route.model, provider: route.provider, trace_id, error: lastError, detail: lastDetail.slice(0, 300) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal shared bits
// ─────────────────────────────────────────────────────────────────────────────

function parseResponse(provider: Provider, data: any): { content: string; contentBlocks: any[]; stop_reason: string | null } {
  if (provider === "anthropic") {
    const blocks = data.content ?? [];
    return { content: blocks.map((b: any) => b.text ?? "").join(""), contentBlocks: blocks, stop_reason: data.stop_reason ?? null };
  }
  const choice = data.choices?.[0];
  return { content: choice?.message?.content ?? "", contentBlocks: [], stop_reason: choice?.finish_reason ?? null };
}

function providerErrorMessage(detail: string): string {
  try {
    const parsed = JSON.parse(detail);
    return parsed?.error?.message ?? detail.slice(0, 200) ?? "upstream error";
  } catch { return (detail || "upstream error").slice(0, 200); }
}

function fail(
  trace_id: string, route: Route, task: string, started: number,
  status: number, error: string, usage: NormalizedUsage | null, attempts: number, fell_back: boolean, detail = "",
): GatewayResult {
  emit({
    evt: "llm_call", trace_id, ts: new Date().toISOString(), task,
    provider: route.provider, model: route.model, ok: false, status, streamed: false,
    latency_ms: Date.now() - started, attempts, fell_back, usage, cost_usd: 0, error,
  });
  return {
    ok: false, status, content: "", contentBlocks: [], stop_reason: null, usage,
    model: route.model, provider: route.provider, cost_usd: 0, trace_id, attempts, fell_back, error, detail,
  };
}

function randomId(): string {
  try { return (globalThis.crypto as any)?.randomUUID?.() ?? fallbackId(); } catch { return fallbackId(); }
}
function fallbackId(): string { return `g_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`; }

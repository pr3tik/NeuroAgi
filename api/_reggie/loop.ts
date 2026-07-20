// api/_reggie/loop.ts — the tool-use loop: the heart of Reggie. Given a specialist
// config, it drives the standard Anthropic tool-use cycle through the gateway:
//   call model (with the specialist's tools) → if stop_reason=="tool_use", run each
//   tool, feed results back as tool_result blocks → repeat → return the final answer.
// Bounded by maxSteps; a tool that throws becomes an is_error tool_result the model can
// recover from (never crashes the turn); on budget exhaustion it forces one tool-less
// answer.
//
// Two entry points share the same tool logic:
//   • runReggie        — blocking (one callModel per turn), used by the JSON endpoint.
//   • runReggieStream  — streams tokens + tool progress via `emit`, used by the SSE
//     endpoint. Falls back to a blocking turn if a stream can't be opened, so it is
//     never worse than runReggie.
import { callModel, openStream } from "../_gateway.js";
import { REGISTRY, toolSpecs } from "./tools.js";
import { parseAnthropicSSE } from "./streamParse.js";
import type { ToolContext } from "./tools.js";
import type { Specialist } from "./specialists.js";

export interface ReggieEvent { type: string; [k: string]: any; }
export interface ToolCallTrace {
  name: string; input: any; ok: boolean; preview: string;
  // For retrieval tools: which documents the result actually came from — the "search
  // tag" payload. Compact (title/heading/loc only, never passage text).
  sources?: { title: string; heading?: string | null; loc?: string | null }[];
}
export interface RenderableWidget { type: string; data: any; }
export interface ReggieResult { output: string; route: string; trace: ToolCallTrace[]; steps: number; budgetExhausted: boolean; widgets: RenderableWidget[]; }
export interface HistoryTurn { role: "user" | "assistant"; content: string; }

const MAX_STEPS = 6;
const MAX_TOOL_RESULT_CHARS = 20000;
const MAX_HISTORY_TURNS = 10;
// Per-tool wall clock. Tools reach Canvas/Supabase/other model calls; one pathological
// dependency must not hold the whole turn open. A timed-out tool degrades to a recoverable
// is_error tool_result (the model answers around it) instead of stalling the student.
const TOOL_TIMEOUT_MS = 20_000;
// Whole-turn wall clock. The step budget alone bounds ROUND TRIPS, not time — six slow
// steps could run past a minute. On expiry the loop stops requesting tools and forces the
// final answer, so a slow turn degrades to a slightly-less-informed answer, never a hang.
const TURN_BUDGET_MS = 45_000;

// Tools whose result the CLIENT can render as interactive UI (not just text). When one
// runs, the loop surfaces a widget alongside the answer so the tutor can show, e.g., the
// interactive quiz cards instead of a JSON blob. Extends the classic tutor's in-chat UI
// to Reggie without marker-parsing.
const RENDERABLE: Record<string, (out: any) => RenderableWidget | null> = {
  generate_quiz: (out) => {
    const src = out?.quizQuestions ?? out?.questions ?? [];
    const cards = (Array.isArray(src) ? src : [])
      .map((q: any) => ({ q: q.question ?? q.q ?? "", a: q.answer ?? q.a ?? "", options: q.options ?? null, type: q.type ?? null }))
      .filter((c: any) => c.q && c.a);
    return cards.length ? { type: "quiz", data: { cards } } : null;
  },
  navigate: (out) => (out?.page ? { type: "navigate", data: { page: out.page, course: out.course ?? null, mode: out.mode ?? null } } : null),
};

/** Map a tool's raw output to a renderable client widget, or null if it isn't one. */
export function renderableWidget(name: string, out: any): RenderableWidget | null {
  const mk = RENDERABLE[name];
  try { return mk ? mk(out) : null; } catch { return null; }
}

// Sanitize prior conversation turns into a valid Anthropic message prefix: text-only,
// must start with a user turn, roles must alternate (consecutive same-role turns are
// collapsed to the latest), capped to the most recent MAX_HISTORY_TURNS.
function normalizeHistory(history?: HistoryTurn[]): any[] {
  const out: any[] = [];
  for (const m of history || []) {
    if (!m || (m.role !== "user" && m.role !== "assistant")) continue;
    const content = typeof m.content === "string" ? m.content.trim() : "";
    if (!content) continue;
    if (out.length === 0 && m.role !== "user") continue;                 // must open on a user turn
    if (out.length && out[out.length - 1].role === m.role) { out[out.length - 1] = { role: m.role, content }; continue; }
    out.push({ role: m.role, content });
  }
  return out.slice(-MAX_HISTORY_TURNS);
}

// Assemble the initial message list from prior history + the current user message.
function buildMessages(userMessage: string, history?: HistoryTurn[]): any[] {
  const prior = normalizeHistory(history);
  if (prior.length && prior[prior.length - 1].role === "user") prior.pop();   // current message supplies the user turn
  return [...prior, { role: "user", content: String(userMessage) }];
}

/** Mark the last tool_result of a step as a prompt-cache breakpoint.
 *
 *  This is the breakpoint that actually pays here. Tool results are the biggest thing in a
 *  multi-step turn — each is capped at MAX_TOOL_RESULT_CHARS (20k chars ≈ 5-6k tokens) and
 *  every later step re-sends all of them. The system/tools prefix, by contrast, only clears
 *  Anthropic's minimum cacheable size (2048 tokens on Sonnet, 4096 on Haiku) for the widest
 *  specialist; a step that has run even one real tool clears it comfortably.
 *
 *  Anthropic caches by prefix, so a breakpoint here lets step N+1 read tools + system +
 *  every prior message instead of re-prefilling them. */
function markCacheBreakpoint(blocks: any[]): any[] {
  const last = blocks[blocks.length - 1];
  if (last && typeof last === "object") last.cache_control = last.cache_control ?? { type: "ephemeral" };
  return blocks;
}

/** MOVE the message-level breakpoint rather than accumulate one per step.
 *
 *  Anthropic rejects requests carrying more than 4 cache_control blocks, and marking
 *  every step's tool_result left the older marks in `messages` — by step 4 a turn sent
 *  tools(1) + system(1) + 3 marked messages = 5 → API 400 → the whole turn failed
 *  (worst on exactly the multi-step turns this file optimizes). A single moving
 *  breakpoint on the NEWEST tool_result is also the cache-optimal shape: a breakpoint
 *  caches its entire prefix, and lookups match the longest previously-cached prefix,
 *  so each step still reads the prior step's cache and extends it. Steady state is
 *  tools(1) + system(1) + one message mark = 3 ≤ 4, at any number of steps. */
function moveCacheBreakpoint(messages: any[], newResults: any[]): any[] {
  for (const m of messages) {
    if (m?.role === "user" && Array.isArray(m.content)) {
      for (const b of m.content) {
        if (b && typeof b === "object" && b.cache_control) delete b.cache_control;
      }
    }
  }
  return markCacheBreakpoint(newResults);
}

/** Bound a tool invocation by wall clock. The tool itself keeps running (we can't cancel a
 *  handler mid-flight) but the loop stops waiting on it — the turn's latency is capped. */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms);
    p.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
  });
}

/** Retrieval tools: lift the returned passages' identities onto the trace entry so the turn
 *  can report WHERE the answer's data came from (agent-manager aggregates these into the
 *  response's `sources` + the persisted turn log). Identities only — never passage text. */
export function liftSources(toolName: string, content: string): ToolCallTrace["sources"] {
  if (toolName !== "rag_search" && toolName !== "library_search") return undefined;
  try {
    const parsed = JSON.parse(content);
    const passages = parsed?.passages ?? parsed?.results ?? [];
    if (!Array.isArray(passages) || !passages.length) return undefined;
    return passages.slice(0, 8).map((p: any) => ({
      title: String(p.title ?? p.label ?? "Document").slice(0, 120),
      heading: p.heading ? String(p.heading).slice(0, 120) : null,
      loc: p.loc != null ? String(p.loc) : null,
    }));
  } catch { return undefined; }   // non-JSON tool output — no sources
}

/** Invoke one tool → the shape the loop records. Never throws: a failure becomes an
 *  is_error tool_result the model can recover from. */
async function invokeOne(tu: any, ctx: ToolContext): Promise<{ out: any; content: string; isError: boolean }> {
  try {
    const tool = REGISTRY[tu.name];
    if (!tool) throw new Error(`unknown tool: ${tu.name}`);
    const out = await withTimeout(Promise.resolve(tool.invoke(tu.input ?? {}, ctx)), TOOL_TIMEOUT_MS, tu.name);
    let content = JSON.stringify(out ?? null);
    if (content.length > MAX_TOOL_RESULT_CHARS) content = content.slice(0, MAX_TOOL_RESULT_CHARS) + "…[truncated]";
    return { out, content, isError: false };
  } catch (e: any) {
    return { out: null, content: `Tool error: ${e?.message ?? "failed"}`, isError: true };
  }
}

/** Concurrency gate. A step runs its tools in parallel ONLY when every one of them is on
 *  the audited read-only allow-list (ReggieTool.readOnly).
 *
 *  Why an allow-list and not "tools in one turn are independent": the model picks all the
 *  tools of a turn without seeing any result, so they are independent as INPUTS — but that
 *  says nothing about their side effects. This catalog contains real mutations (flashcard
 *  writes, office-hours capture, university-brain contribution, and nudge_friend, which
 *  sends a notification/email). Running those concurrently would newly expose their write
 *  and rate-limit paths to interleaving they have never seen. The latency that actually
 *  hurts is read fan-out (grades + upcoming + rag_search + canvas_*), and that is entirely
 *  within the allow-list, so the conservative rule costs nothing real. Anything unmarked —
 *  including any tool added later — keeps the original serial behavior by default. */
function canRunConcurrently(toolUses: any[]): boolean {
  return toolUses.length > 1 && toolUses.every((tu) => REGISTRY[tu.name]?.readOnly === true);
}

// Execute the tool_use blocks from one assistant turn → an array of tool_result blocks.
// A tool that throws becomes an is_error result (recoverable), never crashes the turn.
// Records each call in `trace` and emits tool_call / tool_result progress events.
//
// Read-only steps run concurrently: a turn calling grades + upcoming + rag_search used to
// cost the SUM of three network round trips (often 4-6s) and now costs the MAX. Emission
// order stays deterministic either way — tool_call events fire up front in the model's
// order, and results/trace are collected by index, never by completion time.
async function runTools(
  toolUses: any[], ctx: ToolContext, trace: ToolCallTrace[], emit?: (e: ReggieEvent) => void, widgets?: RenderableWidget[],
): Promise<any[]> {
  const results: any[] = [];
  // Bookkeeping for one finished tool. Called in the model's tool order on BOTH paths, so
  // trace, widget, source, and tool_result ordering never depends on which call finished
  // first — the concurrent path must produce a byte-identical trace to the serial one.
  const record = (tu: any, { out, content, isError }: { out: any; content: string; isError: boolean }) => {
    if (!isError && widgets) { const w = renderableWidget(tu.name, out); if (w) widgets.push(w); }
    const sources = isError ? undefined : liftSources(tu.name, content);
    trace.push({ name: tu.name, input: tu.input, ok: !isError, preview: content.slice(0, 200), ...(sources ? { sources } : {}) });
    emit?.({ type: "tool_result", name: tu.name, ok: !isError });
    results.push({ type: "tool_result", tool_use_id: tu.id, content, ...(isError ? { is_error: true } : {}) });
  };

  if (canRunConcurrently(toolUses)) {
    // Announce every call up front, then await them together.
    for (const tu of toolUses) emit?.({ type: "tool_call", name: tu.name, input: tu.input });
    const settled = await Promise.all(toolUses.map((tu) => invokeOne(tu, ctx)));
    settled.forEach((r, i) => record(toolUses[i], r));
  } else {
    // Serial path — the original semantics exactly, including the interleaved
    // call→result→call→result event order the client already renders.
    for (const tu of toolUses) {
      emit?.({ type: "tool_call", name: tu.name, input: tu.input });
      record(tu, await invokeOne(tu, ctx));
    }
  }
  return results;
}

export interface RunOpts {
  specialist: Specialist;
  userMessage: string;
  brainContext?: string | null;
  ctx: ToolContext;
  history?: HistoryTurn[];
  emit?: (e: ReggieEvent) => void;
  maxSteps?: number;
  /** Client is in voice mode: teach the model the UI voice-tag protocol and ask for
   *  spoken-length answers (the client parses/strips the tags — see src/lib/voiceTags). */
  voiceMode?: boolean;
}

// Kept server-side (duplicated from src/lib/voiceTags VOICE_TAGS_ADDENDUM in spirit) so
// api/ has no src/ UI import; the tag names MUST stay in sync with parseVoiceTags.
const VOICE_ADDENDUM = [
  '',
  'The student is in VOICE mode: your reply is spoken aloud. Keep it conversational and short (2-4 sentences unless asked for more). You can control the voice UI by embedding bracket tags anywhere in your reply (they are stripped before display/speech):',
  '- [SYNC] when they ask to sync/refresh their Canvas data.',
  '- [GENERATE_FLASHCARDS:<course name>] when they ask you to make flashcards for a course by voice.',
  '- [VOICE:<voice name or description>] when they ask for a different voice.',
  '- [SPEED:<0.7-1.3>] when they ask you to speak faster or slower.',
  '- [TONE:calm|energetic|neutral|serious] when they ask for a different tone.',
  'Only emit a tag when the student explicitly asks for that action. Never mention the tags.',
].join(String.fromCharCode(10));

// Latency discipline, not style. Two rules that each remove real seconds from a turn:
//  1. A pre-tool preamble is generated token-by-token and then DISCARDED (the streaming
//     loop emits `reset` and the client clears it) — pure dead time before the answer.
//  2. Independent tools requested in ONE turn run concurrently (see runTools); the same
//     tools spread across separate turns cost a full extra model round trip each.
const TOOL_DISCIPLINE = [
  "",
  "",
  "Tool discipline: when you need tools, emit the tool calls immediately — do NOT write any text before them (no 'let me check…' preamble; it is discarded). Request every tool you already know you need in the SAME turn so they run in parallel, rather than one per turn. Once you have enough to answer, answer without further tool calls.",
].join(String.fromCharCode(10));

// ── Blocking loop (one callModel per turn) ──────────────────────────────────────
export async function runReggie(opts: RunOpts): Promise<ReggieResult> {
  const { specialist, userMessage, brainContext = null, ctx, history, emit, maxSteps = MAX_STEPS, voiceMode = false } = opts;
  const system = specialist.system({ brainContext }) + TOOL_DISCIPLINE + (voiceMode ? VOICE_ADDENDUM : "");
  const tools = toolSpecs(specialist.tools);
  const messages = buildMessages(userMessage, history);
  const trace: ToolCallTrace[] = [];
  const widgets: RenderableWidget[] = [];
  const deadline = Date.now() + TURN_BUDGET_MS;
  emit?.({ type: "route", route: specialist.key });

  for (let step = 1; step <= maxSteps; step++) {
    // Out of time → stop offering tools and go straight to the forced final answer.
    if (step > 1 && Date.now() > deadline) {
      return forceFinalBlocking(specialist, voiceMode ? "voice" : specialist.task, system, ctx, messages, trace, widgets, step - 1, emit);
    }
    const r = await callModel({
      task: voiceMode ? "voice" : specialist.task, system, tools, messages, max_tokens: 4000,
      cache: true, cacheTools: true,
      metadata: { tool: "reggie", route: specialist.key, user_id: ctx.userId, step },
    });
    if (!r.ok) throw new Error(r.error || `model call failed (status ${r.status})`);

    if (r.stop_reason !== "tool_use") {
      emit?.({ type: "final", output: r.content });
      return { output: r.content, route: specialist.key, trace, steps: step, budgetExhausted: false, widgets };
    }

    messages.push({ role: "assistant", content: r.contentBlocks });
    const toolUses = (r.contentBlocks || []).filter((b: any) => b?.type === "tool_use");
    const results = await runTools(toolUses, ctx, trace, emit, widgets);
    messages.push({ role: "user", content: moveCacheBreakpoint(messages, results) });
  }

  return forceFinalBlocking(specialist, voiceMode ? "voice" : specialist.task, system, ctx, messages, trace, widgets, maxSteps, emit);
}

async function forceFinalBlocking(
  specialist: Specialist, task: string, system: string, ctx: ToolContext, messages: any[], trace: ToolCallTrace[], widgets: RenderableWidget[], maxSteps: number, emit?: (e: ReggieEvent) => void,
): Promise<ReggieResult> {
  // Reuse the turn's REAL system prompt (brain context + voice addendum included) — the
  // old rebuild with brainContext:null silently depersonalized budget-exhausted answers.
  const fin = await callModel({
    task,
    system: system + "\n\nYou have reached the tool-call limit for this turn. Answer now using what you already have; do not request more tools.",
    messages, max_tokens: 2000, cache: true,
    metadata: { tool: "reggie", route: specialist.key, user_id: ctx.userId, final: true },
  });
  const output = fin.ok ? fin.content || "" : "";
  emit?.({ type: "final", output });
  return {
    output: output || "I ran out of tool budget before finishing — could you narrow the question?",
    route: specialist.key, trace, steps: maxSteps, budgetExhausted: true, widgets,
  };
}

// ── Streaming loop — emits token / tool_call / tool_result / reset via `emit` ────
// Streams the model's text as it generates; on a tool_use turn, emits a `reset`
// (the streamed text was a pre-tool preamble → the client clears it) and runs the
// tools, then the next turn streams the real answer. Falls back to a blocking turn if
// a stream can't be opened.
export async function runReggieStream(opts: RunOpts): Promise<ReggieResult> {
  const { specialist, userMessage, brainContext = null, ctx, history, emit, maxSteps = MAX_STEPS, voiceMode = false } = opts;
  const system = specialist.system({ brainContext }) + TOOL_DISCIPLINE + (voiceMode ? VOICE_ADDENDUM : "");
  const tools = toolSpecs(specialist.tools);
  const messages = buildMessages(userMessage, history);
  const trace: ToolCallTrace[] = [];
  const widgets: RenderableWidget[] = [];
  const deadline = Date.now() + TURN_BUDGET_MS;
  let steps = maxSteps;
  emit?.({ type: "route", route: specialist.key });

  for (let step = 1; step <= maxSteps; step++) {
    if (step > 1 && Date.now() > deadline) { steps = step - 1; break; }   // out of time → forced final below
    const meta = { tool: "reggie", route: specialist.key, user_id: ctx.userId, step };
    const turn = await streamTurn({ task: voiceMode ? "voice" : specialist.task, system, tools, messages, max_tokens: 4000, cache: true, cacheTools: true, metadata: meta }, emit);

    if (turn.stop_reason !== "tool_use") {
      emit?.({ type: "final", output: turn.text });
      return { output: turn.text, route: specialist.key, trace, steps: step, budgetExhausted: false, widgets };
    }

    messages.push({ role: "assistant", content: turn.contentBlocks });
    const toolUses = (turn.contentBlocks || []).filter((b: any) => b?.type === "tool_use");
    emit?.({ type: "reset" });                                   // discard the pre-tool preamble on the client
    const results = await runTools(toolUses, ctx, trace, emit, widgets);
    messages.push({ role: "user", content: moveCacheBreakpoint(messages, results) });
  }

  // Budget exhausted (steps or wall clock) → one final tool-less streamed turn.
  const finSystem = system + "\n\nYou have reached the tool-call limit for this turn. Answer now using what you already have; do not request more tools.";
  emit?.({ type: "reset" });
  const fin = await streamTurn({ task: voiceMode ? "voice" : specialist.task, system: finSystem, messages, max_tokens: 2000, cache: true, metadata: { tool: "reggie", route: specialist.key, user_id: ctx.userId, final: true } }, emit);
  const output = fin.text || "I ran out of tool budget before finishing — could you narrow the question?";
  emit?.({ type: "final", output });
  return { output, route: specialist.key, trace, steps, budgetExhausted: true, widgets };
}

// One streamed model turn: open a stream and parse it (emitting token deltas); if the
// stream can't be opened, fall back to a blocking callModel and emit its text at once.
async function streamTurn(req: any, emit?: (e: ReggieEvent) => void): Promise<{ contentBlocks: any[]; stop_reason: string | null; text: string }> {
  const s = await openStream(req);
  if (s.ok && s.stream) {
    if (s.provider === "anthropic") {
      return parseAnthropicSSE(s.stream, (delta) => emit?.({ type: "token", text: delta }));
    }
    try { await s.stream.cancel(); } catch { /* noop */ }   // non-Anthropic SSE shape — don't misparse; fall back
  }
  // Fallback: non-streaming turn.
  const r = await callModel(req);
  if (!r.ok) throw new Error(r.error || `model call failed (status ${r.status})`);
  if (r.content) emit?.({ type: "token", text: r.content });
  return { contentBlocks: r.contentBlocks, stop_reason: r.stop_reason, text: r.content };
}

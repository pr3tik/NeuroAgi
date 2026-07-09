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
export interface ToolCallTrace { name: string; input: any; ok: boolean; preview: string; }
export interface RenderableWidget { type: string; data: any; }
export interface ReggieResult { output: string; route: string; trace: ToolCallTrace[]; steps: number; budgetExhausted: boolean; widgets: RenderableWidget[]; }
export interface HistoryTurn { role: "user" | "assistant"; content: string; }

const MAX_STEPS = 6;
const MAX_TOOL_RESULT_CHARS = 20000;
const MAX_HISTORY_TURNS = 10;

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

// Execute the tool_use blocks from one assistant turn → an array of tool_result blocks.
// A tool that throws becomes an is_error result (recoverable), never crashes the turn.
// Records each call in `trace` and emits tool_call / tool_result progress events.
async function runTools(
  toolUses: any[], ctx: ToolContext, trace: ToolCallTrace[], emit?: (e: ReggieEvent) => void, widgets?: RenderableWidget[],
): Promise<any[]> {
  const results: any[] = [];
  for (const tu of toolUses) {
    emit?.({ type: "tool_call", name: tu.name, input: tu.input });
    let content: string;
    let isError = false;
    try {
      const tool = REGISTRY[tu.name];
      if (!tool) throw new Error(`unknown tool: ${tu.name}`);
      const out = await tool.invoke(tu.input ?? {}, ctx);
      if (widgets) { const w = renderableWidget(tu.name, out); if (w) widgets.push(w); }
      content = JSON.stringify(out ?? null);
      if (content.length > MAX_TOOL_RESULT_CHARS) content = content.slice(0, MAX_TOOL_RESULT_CHARS) + "…[truncated]";
    } catch (e: any) {
      isError = true;
      content = `Tool error: ${e?.message ?? "failed"}`;
    }
    trace.push({ name: tu.name, input: tu.input, ok: !isError, preview: content.slice(0, 200) });
    emit?.({ type: "tool_result", name: tu.name, ok: !isError });
    results.push({ type: "tool_result", tool_use_id: tu.id, content, ...(isError ? { is_error: true } : {}) });
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

// ── Blocking loop (one callModel per turn) ──────────────────────────────────────
export async function runReggie(opts: RunOpts): Promise<ReggieResult> {
  const { specialist, userMessage, brainContext = null, ctx, history, emit, maxSteps = MAX_STEPS, voiceMode = false } = opts;
  const system = specialist.system({ brainContext }) + (voiceMode ? VOICE_ADDENDUM : "");
  const tools = toolSpecs(specialist.tools);
  const messages = buildMessages(userMessage, history);
  const trace: ToolCallTrace[] = [];
  const widgets: RenderableWidget[] = [];
  emit?.({ type: "route", route: specialist.key });

  for (let step = 1; step <= maxSteps; step++) {
    const r = await callModel({
      task: specialist.task, system, tools, messages, max_tokens: 4000,
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
    messages.push({ role: "user", content: results });
  }

  return forceFinalBlocking(specialist, system, ctx, messages, trace, widgets, maxSteps, emit);
}

async function forceFinalBlocking(
  specialist: Specialist, system: string, ctx: ToolContext, messages: any[], trace: ToolCallTrace[], widgets: RenderableWidget[], maxSteps: number, emit?: (e: ReggieEvent) => void,
): Promise<ReggieResult> {
  // Reuse the turn's REAL system prompt (brain context + voice addendum included) — the
  // old rebuild with brainContext:null silently depersonalized budget-exhausted answers.
  const fin = await callModel({
    task: specialist.task,
    system: system + "\n\nYou have reached the tool-call limit for this turn. Answer now using what you already have; do not request more tools.",
    messages, max_tokens: 2000,
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
  const system = specialist.system({ brainContext }) + (voiceMode ? VOICE_ADDENDUM : "");
  const tools = toolSpecs(specialist.tools);
  const messages = buildMessages(userMessage, history);
  const trace: ToolCallTrace[] = [];
  const widgets: RenderableWidget[] = [];
  emit?.({ type: "route", route: specialist.key });

  for (let step = 1; step <= maxSteps; step++) {
    const meta = { tool: "reggie", route: specialist.key, user_id: ctx.userId, step };
    const turn = await streamTurn({ task: specialist.task, system, tools, messages, max_tokens: 4000, metadata: meta }, emit);

    if (turn.stop_reason !== "tool_use") {
      emit?.({ type: "final", output: turn.text });
      return { output: turn.text, route: specialist.key, trace, steps: step, budgetExhausted: false, widgets };
    }

    messages.push({ role: "assistant", content: turn.contentBlocks });
    const toolUses = (turn.contentBlocks || []).filter((b: any) => b?.type === "tool_use");
    emit?.({ type: "reset" });                                   // discard the pre-tool preamble on the client
    const results = await runTools(toolUses, ctx, trace, emit, widgets);
    messages.push({ role: "user", content: results });
  }

  // Budget exhausted → one final tool-less streamed turn.
  const finSystem = system + "\n\nYou have reached the tool-call limit for this turn. Answer now using what you already have; do not request more tools.";
  emit?.({ type: "reset" });
  const fin = await streamTurn({ task: specialist.task, system: finSystem, messages, max_tokens: 2000, metadata: { tool: "reggie", route: specialist.key, user_id: ctx.userId, final: true } }, emit);
  const output = fin.text || "I ran out of tool budget before finishing — could you narrow the question?";
  emit?.({ type: "final", output });
  return { output, route: specialist.key, trace, steps: maxSteps, budgetExhausted: true, widgets };
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

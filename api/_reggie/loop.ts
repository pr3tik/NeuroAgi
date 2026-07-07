// api/_reggie/loop.ts — the tool-use loop: the heart of Reggie. Given a specialist
// config, it drives the standard Anthropic tool-use cycle through the gateway:
//   call model (with the specialist's tools) → if stop_reason=="tool_use", run each
//   tool, feed results back as tool_result blocks → repeat → return the final answer.
// Bounded by maxSteps; a tool that throws becomes an is_error tool_result the model can
// recover from (never crashes the turn); on budget exhaustion it forces one tool-less
// answer. `emit` lets an HTTP layer stream progress later (SSE) without changing this.
import { callModel } from "../_gateway.js";
import { REGISTRY, toolSpecs } from "./tools.js";
import type { ToolContext } from "./tools.js";
import type { Specialist } from "./specialists.js";

export interface ReggieEvent { type: string; [k: string]: any; }
export interface ToolCallTrace { name: string; input: any; ok: boolean; preview: string; }
export interface ReggieResult { output: string; route: string; trace: ToolCallTrace[]; steps: number; budgetExhausted: boolean; }

const MAX_STEPS = 6;
const MAX_TOOL_RESULT_CHARS = 20000;

export async function runReggie(opts: {
  specialist: Specialist;
  userMessage: string;
  brainContext?: string | null;
  ctx: ToolContext;
  emit?: (e: ReggieEvent) => void;
  maxSteps?: number;
}): Promise<ReggieResult> {
  const { specialist, userMessage, brainContext = null, ctx, emit, maxSteps = MAX_STEPS } = opts;
  const system = specialist.system({ brainContext });
  const tools = toolSpecs(specialist.tools);
  const messages: any[] = [{ role: "user", content: String(userMessage) }];
  const trace: ToolCallTrace[] = [];
  emit?.({ type: "route", route: specialist.key });

  for (let step = 1; step <= maxSteps; step++) {
    const r = await callModel({
      task: specialist.task, system, tools, messages, max_tokens: 4000,
      metadata: { tool: "reggie", route: specialist.key, user_id: ctx.userId, step },
    });
    if (!r.ok) throw new Error(r.error || `model call failed (status ${r.status})`);

    if (r.stop_reason !== "tool_use") {
      emit?.({ type: "final", output: r.content });
      return { output: r.content, route: specialist.key, trace, steps: step, budgetExhausted: false };
    }

    // Echo the assistant's tool_use turn, then run each requested tool → tool_result turn.
    messages.push({ role: "assistant", content: r.contentBlocks });
    const toolUses = (r.contentBlocks || []).filter((b: any) => b?.type === "tool_use");
    const results: any[] = [];
    for (const tu of toolUses) {
      emit?.({ type: "tool_call", name: tu.name, input: tu.input });
      let content: string;
      let isError = false;
      try {
        const tool = REGISTRY[tu.name];
        if (!tool) throw new Error(`unknown tool: ${tu.name}`);
        const out = await tool.invoke(tu.input ?? {}, ctx);
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
    messages.push({ role: "user", content: results });
  }

  // Budget exhausted → one final, tool-less turn so the model must answer with what it has.
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
    route: specialist.key, trace, steps: maxSteps, budgetExhausted: true,
  };
}

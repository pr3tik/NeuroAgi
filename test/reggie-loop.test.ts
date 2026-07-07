// @vitest-environment node
// Reggie tool-use loop mechanics, driven by a scripted gateway (stubbed Anthropic):
// tool execution + tool_result feedback + final answer, budget cap, error recovery, events.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

beforeEach(() => { process.env.ANTHROPIC_API_KEY = "test-key"; });
afterEach(() => vi.unstubAllGlobals());

function anthropic(blocks: any[], stop: string) {
  const d = { content: blocks, stop_reason: stop, usage: { input_tokens: 1, output_tokens: 1 } };
  return { ok: true, status: 200, json: async () => d, text: async () => JSON.stringify(d) };
}
// Return each scripted response in turn; repeat the last for any extra calls.
function scripted(seq: Array<() => any>) {
  let i = 0;
  const fn = vi.fn(async () => { const r = seq[Math.min(i, seq.length - 1)](); i++; return r; });
  vi.stubGlobal("fetch", fn);
  return fn;
}

const specialist: any = { key: "test", title: "t", task: "tutor", tools: ["what_if_plan"], system: () => "You are a test tutor." };
const basePlan = { examDate: "2026-08-10", sessions: [{ date: "2026-08-01", topic: "Kinetics", activities: ["read"], estimatedMinutes: 60 }] };

async function load() { vi.resetModules(); return (await import("../api/_reggie/loop.ts")).runReggie; }

describe("reggie tool-use loop", () => {
  it("runs a tool, feeds the result back, then returns the final answer", async () => {
    scripted([
      () => anthropic([{ type: "text", text: "let me compute" }, { type: "tool_use", id: "tu1", name: "what_if_plan", input: { basePlan, changes: { dropTopics: ["Kinetics"] } } }], "tool_use"),
      () => anthropic([{ type: "text", text: "Your projected readiness looks solid." }], "end_turn"),
    ]);
    const runReggie = await load();
    const r = await runReggie({ specialist, userMessage: "what if I drop kinetics", ctx: { userId: "u1" } });
    expect(r.output).toMatch(/projected readiness/i);
    expect(r.steps).toBe(2);
    expect(r.budgetExhausted).toBe(false);
    expect(r.trace).toHaveLength(1);
    expect(r.trace[0]).toMatchObject({ name: "what_if_plan", ok: true });
  });

  it("turns a failing tool into an is_error result and still finishes", async () => {
    scripted([
      () => anthropic([{ type: "tool_use", id: "tu1", name: "nonexistent_tool", input: {} }], "tool_use"),
      () => anthropic([{ type: "text", text: "Sorry, that failed; here's my best answer." }], "end_turn"),
    ]);
    const runReggie = await load();
    const r = await runReggie({ specialist, userMessage: "x", ctx: { userId: "u1" } });
    expect(r.trace[0]).toMatchObject({ name: "nonexistent_tool", ok: false });
    expect(r.trace[0].preview).toMatch(/error/i);
    expect(r.output).toMatch(/best answer/i);
  });

  it("stops at the tool-call budget and forces a tool-less final answer", async () => {
    scripted([() => anthropic([{ type: "text", text: "partial answer" }, { type: "tool_use", id: "tuN", name: "what_if_plan", input: { basePlan, changes: {} } }], "tool_use")]);
    const runReggie = await load();
    const r = await runReggie({ specialist, userMessage: "loop", ctx: { userId: "u1" }, maxSteps: 3 });
    expect(r.budgetExhausted).toBe(true);
    expect(r.steps).toBe(3);
    expect(typeof r.output).toBe("string");
    expect(r.trace.length).toBe(3); // one tool call per step
  });

  it("throws when the model call itself fails (surfaced to the handler as 502)", async () => {
    scripted([() => ({ ok: false, status: 500, json: async () => ({}), text: async () => "upstream down" })]);
    const runReggie = await load();
    await expect(runReggie({ specialist, userMessage: "x", ctx: { userId: "u1" } })).rejects.toThrow();
  });

  it("emits route/tool_call/tool_result/final progress events", async () => {
    scripted([
      () => anthropic([{ type: "tool_use", id: "tu1", name: "what_if_plan", input: { basePlan, changes: {} } }], "tool_use"),
      () => anthropic([{ type: "text", text: "done" }], "end_turn"),
    ]);
    const runReggie = await load();
    const events: string[] = [];
    await runReggie({ specialist, userMessage: "x", ctx: { userId: "u1" }, emit: (e) => events.push(e.type) });
    expect(events).toEqual(expect.arrayContaining(["route", "tool_call", "tool_result", "final"]));
  });
});

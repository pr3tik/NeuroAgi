// @vitest-environment node
// Reggie front-door (agent-manager) tests: validation, brain-context fetch, routing
// (explicit action vs classified 'ask'), blocking response shape, and error handling.
// The loop is mocked (its mechanics are covered in reggie-loop.test.ts) so we test the
// controller wiring in isolation; the router runs for real (keyword/hint tiers, no LLM).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { makeRes } from "./helpers";

const { runReggie, runReggieStream } = vi.hoisted(() => ({ runReggie: vi.fn(), runReggieStream: vi.fn() }));
vi.mock("../api/_reggie/loop.js", () => ({ runReggie, runReggieStream }));

// SSE-capturing fake res (makeRes has no write/flushHeaders).
function makeSSERes() {
  const res: any = { statusCode: 200, headers: {}, written: [] as string[], ended: false };
  res.setHeader = (k: string, v: any) => { res.headers[k] = v; };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (o: any) => { res.body = o; return res; };
  res.write = (s: any) => { res.written.push(String(s)); return true; };
  res.end = (o?: any) => { if (o !== undefined) res.written.push(String(o)); res.ended = true; return res; };
  res.flushHeaders = () => {};
  return res;
}
// tutor-context stubbed as a fake (req,res) handler so callApi captures a brain context.
vi.mock("../api/tutor-context.js", () => ({ default: async (_req: any, res: any) => res.status(200).json({ context: "BRAIN CTX" }) }));

beforeEach(() => {
  runReggie.mockReset();
  runReggie.mockImplementation(async ({ specialist }: any) => ({
    output: `answered by ${specialist.key}`, route: specialist.key,
    trace: [{ name: "x", input: {}, ok: true, preview: "" }], steps: 1, budgetExhausted: false,
  }));
  runReggieStream.mockReset();
  runReggieStream.mockImplementation(async ({ specialist, emit }: any) => {
    emit?.({ type: "route", route: specialist.key });
    emit?.({ type: "token", text: "hi " });
    emit?.({ type: "tool_call", name: "canvas_get_grades", input: {} });
    emit?.({ type: "tool_result", name: "canvas_get_grades", ok: true });
    emit?.({ type: "token", text: "there" });
    emit?.({ type: "final", output: "hi there" });     // must be suppressed in favor of `done`
    return { output: "hi there", route: specialist.key, trace: [{ name: "canvas_get_grades", input: {}, ok: true, preview: "" }], widgets: [{ type: "quiz", data: { cards: [{ q: "Q", a: "A" }] } }], steps: 2, budgetExhausted: false };
  });
});
afterEach(() => vi.unstubAllGlobals());

async function load() { vi.resetModules(); return (await import("../api/agent-manager.ts")).default; }

describe("agent-manager (Reggie front door)", () => {
  it("405 on non-POST; 400 on missing userId or message", async () => {
    const h = await load();
    let res = makeRes(); await h({ method: "GET", body: {} }, res); expect(res.statusCode).toBe(405);
    res = makeRes(); await h({ method: "POST", body: { message: "hi" } }, res); expect(res.statusCode).toBe(400);
    res = makeRes(); await h({ method: "POST", body: { userId: "u1" } }, res); expect(res.statusCode).toBe(400);
  });

  it("classifies a free-form 'ask' (keyword) and returns a blocking result with a tool trace", async () => {
    const h = await load(); const res = makeRes();
    await h({ method: "POST", body: { userId: "u1", message: "what's my grade in bio" } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.route).toBe("insight_explainer");
    expect(res.body.output).toBe("answered by insight_explainer");
    expect(res.body.brainContextUsed).toBe(true);
    expect(Array.isArray(res.body.toolCalls)).toBe(true);
    // the specialist handed to the loop must carry the live brain context
    const passed = runReggie.mock.calls[0][0];
    expect(passed.brainContext).toBe("BRAIN CTX");
    expect(passed.ctx.userId).toBe("u1");
  });

  it("streams SSE (route/token/tool_call/tool_result/done) when stream:true, suppressing the loop's own final", async () => {
    const h = await load();
    const res = makeSSERes();
    await h({ method: "POST", body: { userId: "u1", message: "what's my grade in bio", stream: true } }, res);
    const text = res.written.join("");
    expect(String(res.headers["Content-Type"])).toMatch(/event-stream/);
    for (const ev of ["event: route", "event: token", "event: tool_call", "event: tool_result", "event: done"]) {
      expect(text).toContain(ev);
    }
    expect(text).not.toContain("event: final");            // superseded by done
    expect(text).toContain('"output":"hi there"');
    expect(text).toContain('"brainContextUsed":true');
    expect(text).toContain('"type":"quiz"');               // renderable widget flows through `done`
    expect(res.ended).toBe(true);
    // it used the streaming loop, not the blocking one
    expect(runReggieStream).toHaveBeenCalledTimes(1);
    expect(runReggie).not.toHaveBeenCalled();
  });

  it("passes conversation history through to the loop", async () => {
    const h = await load(); const res = makeRes();
    const history = [{ role: "user", content: "explain kinetics" }, { role: "assistant", content: "reaction rates" }];
    await h({ method: "POST", body: { userId: "u1", message: "and thermo?", history } }, res);
    expect(runReggie.mock.calls[0][0].history).toEqual(history);
  });

  it("passes voiceMode through to the loop (default false)", async () => {
    const h = await load();
    let res = makeRes();
    await h({ method: "POST", body: { userId: "u1", message: "what's my grade in bio", voiceMode: true } }, res);
    expect(runReggie.mock.calls.at(-1)[0].voiceMode).toBe(true);
    res = makeRes();
    await h({ method: "POST", body: { userId: "u1", message: "what's my grade in bio" } }, res);
    expect(runReggie.mock.calls.at(-1)[0].voiceMode).toBe(false);
  });

  it("routes an explicit product action straight to its specialist (no classification)", async () => {
    const h = await load(); const res = makeRes();
    await h({ method: "POST", body: { action: "weekly_plan", userId: "u1", message: "plan my week" } }, res);
    expect(res.body.route).toBe("planner");
  });

  it("returns 502 if the loop throws", async () => {
    runReggie.mockImplementationOnce(async () => { throw new Error("boom"); });
    const h = await load(); const res = makeRes();
    await h({ method: "POST", body: { userId: "u1", message: "what's my grade" } }, res);
    expect(res.statusCode).toBe(502);
    expect(res.body.error).toMatch(/boom/);
  });
});

// @vitest-environment node
// Reggie front-door (agent-manager) tests: validation, brain-context fetch, routing
// (explicit action vs classified 'ask'), blocking response shape, and error handling.
// The loop is mocked (its mechanics are covered in reggie-loop.test.ts) so we test the
// controller wiring in isolation; the router runs for real (keyword/hint tiers, no LLM).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { makeRes } from "./helpers";

const { runReggie } = vi.hoisted(() => ({ runReggie: vi.fn() }));
vi.mock("../api/_reggie/loop.js", () => ({ runReggie }));
// tutor-context stubbed as a fake (req,res) handler so callApi captures a brain context.
vi.mock("../api/tutor-context.js", () => ({ default: async (_req: any, res: any) => res.status(200).json({ context: "BRAIN CTX" }) }));

beforeEach(() => {
  runReggie.mockReset();
  runReggie.mockImplementation(async ({ specialist }: any) => ({
    output: `answered by ${specialist.key}`, route: specialist.key,
    trace: [{ name: "x", input: {}, ok: true, preview: "" }], steps: 1, budgetExhausted: false,
  }));
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

  it("passes conversation history through to the loop", async () => {
    const h = await load(); const res = makeRes();
    const history = [{ role: "user", content: "explain kinetics" }, { role: "assistant", content: "reaction rates" }];
    await h({ method: "POST", body: { userId: "u1", message: "and thermo?", history } }, res);
    expect(runReggie.mock.calls[0][0].history).toEqual(history);
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

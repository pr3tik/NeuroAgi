// @vitest-environment node
// End-to-end latency contract for a Reggie turn, driving the REAL api/agent-manager
// handler (real router, real loop, real tool registry, real canvas-reads handler behind
// the tools) against a stubbed network. Only the network and auth are fake.
//
// The parallelism assertion deliberately measures OBSERVED IN-FLIGHT CONCURRENCY rather
// than wall-clock thresholds: a timing assertion would be flaky on a loaded CI box, while
// "were two Supabase reads open at the same instant" is exactly the property we changed
// and is fully deterministic.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../api/_auth.ts", () => ({
  requireUser: async (req: any) => {
    const id = req?.__internalUserId ?? req?.body?.userId ?? req?.query?.userId;
    return id ? { userId: String(id), authId: "test" } : null;
  },
  requireUserOr401: async (req: any, res: any) => {
    const id = req?.__internalUserId ?? req?.body?.userId ?? req?.query?.userId;
    if (!id) { res?.status?.(401)?.json?.({ error: "auth required" }); return null; }
    return String(id);
  },
}));

// Brain context is exercised in its own suite; here it must simply not be the thing under
// test, so it resolves immediately.
vi.mock("../api/tutor-context.js", () => ({
  default: async (_req: any, res: any) => res.status(200).json({ context: "STUDENT BRAIN STATE: calm" }),
}));

function makeSSERes() {
  const res: any = { statusCode: 200, headers: {}, written: [] as string[], ended: false };
  res.setHeader = (k: string, v: any) => { res.headers[k] = v; };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (o: any) => { res.body = o; return res; };
  res.write = (s: any) => { res.written.push(String(s)); return true; };
  res.end = () => { res.ended = true; return res; };
  res.flushHeaders = () => {};
  return res;
}

const enc = new TextEncoder();
const sse = (frames: any[]) => new ReadableStream<Uint8Array>({
  start(c) { for (const f of frames) c.enqueue(enc.encode(`event: ${f.type}\ndata: ${JSON.stringify(f)}\n\n`)); c.close(); },
});

// Turn 1: the model asks for two READ-ONLY tools at once. Turn 2: it answers.
const TOOL_TURN = () => sse([
  { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "t1", name: "canvas_get_grades" } },
  { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "{}" } },
  { type: "content_block_stop", index: 0 },
  { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "t2", name: "canvas_get_upcoming" } },
  { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: "{}" } },
  { type: "content_block_stop", index: 1 },
  { type: "message_delta", delta: { stop_reason: "tool_use" } },
  { type: "message_stop" },
]);
const FINAL_TURN = () => sse([
  { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
  { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "You're on track " } },
  { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "in Bio." } },
  { type: "content_block_stop", index: 0 },
  { type: "message_delta", delta: { stop_reason: "end_turn" } },
]);

let anthropicBodies: any[];
let inFlight: number;
let maxInFlight: number;
let dbCalls: string[];

function install() {
  anthropicBodies = []; inFlight = 0; maxInFlight = 0; dbCalls = [];
  let modelCall = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: any, init: any) => {
    const u = String(url);

    if (u.includes("api.anthropic.com")) {
      anthropicBodies.push(JSON.parse(init?.body ?? "{}"));
      return { ok: true, status: 200, body: ++modelCall === 1 ? TOOL_TURN() : FINAL_TURN() };
    }

    // Supabase REST — deliberately slow, and instrumented for overlap.
    //
    // Only the reads the TOOLS make are counted. The gateway's trace sink also writes to
    // Supabase (prompt_runs), fire-and-forget, and would otherwise overlap a tool read and
    // make this counter report concurrency that has nothing to do with tool execution.
    const isToolRead = /\/rest\/v1\/(users|courses|assignments)\b/.test(u);
    dbCalls.push(u);
    if (isToolRead) { inFlight++; maxInFlight = Math.max(maxInFlight, inFlight); }
    await new Promise((r) => setTimeout(r, 40));
    if (isToolRead) inFlight--;

    const rows = u.includes("/rest/v1/users") ? [{ id: "u1" }] : [];
    return { ok: true, status: 200, json: async () => rows, text: async () => JSON.stringify(rows) };
  }));
}

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY    = "test-key";
  process.env.SUPABASE_URL         = "http://sb.test";
  process.env.SUPABASE_SERVICE_KEY = "svc";
  install();
});
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

async function runTurn() {
  vi.resetModules();
  const handler = (await import("../api/agent-manager.ts")).default;
  const res = makeSSERes();
  // "what's my grade in bio" hits the router's keyword tier → insight_explainer, whose tool
  // set contains both tools above. No classifier round trip, so the assertions below are
  // about the loop, not the router.
  await handler({ method: "POST", body: { userId: "u1", message: "what's my grade in bio", stream: true } }, res);
  return { res, text: res.written.join("") };
}

describe("Reggie turn — end-to-end latency contract", () => {
  it("completes a two-step tool turn and streams a real answer", async () => {
    const { res, text } = await runTurn();
    expect(res.statusCode).toBe(200);
    expect(String(res.headers["Content-Type"])).toMatch(/event-stream/);
    // The `open` frame precedes everything, so the socket is live before any model work.
    expect(text.indexOf("event: open")).toBeGreaterThanOrEqual(0);
    expect(text.indexOf("event: open")).toBeLessThan(text.indexOf("event: route"));
    expect(text).toContain('"route":"insight_explainer"');
    expect(text).toContain("event: done");
    expect(text).toContain("You're on track in Bio.");
    expect(res.ended).toBe(true);
  });

  it("runs the step's two read-only tools CONCURRENTLY (overlapping DB reads)", async () => {
    const { text } = await runTurn();
    expect(dbCalls.length).toBeGreaterThan(1);
    // canvas-reads is internally sequential (every fetch is awaited), so two of ITS reads
    // can only be open at once if the two tool invocations themselves overlapped.
    expect(maxInFlight).toBeGreaterThan(1);

    // …and the event order the client actually receives: both calls announced, then both
    // results. Serial execution produces call→result→call→result instead.
    const order = [...text.matchAll(/event: (tool_call|tool_result)/g)].map((m) => m[1]);
    expect(order).toEqual(["tool_call", "tool_call", "tool_result", "tool_result"]);
  });

  it("sends cache_control on the tool block and the system prefix, on every model call", async () => {
    await runTurn();
    expect(anthropicBodies.length).toBe(2);
    const toolTurn = anthropicBodies[0];
    expect(toolTurn.tools.at(-1).cache_control).toEqual({ type: "ephemeral" });
    expect(toolTurn.system.at(-1).cache_control).toEqual({ type: "ephemeral" });
    // The cached prefix must be STABLE across the steps of one turn or it never hits.
    expect(JSON.stringify(anthropicBodies[1].system)).toBe(JSON.stringify(toolTurn.system));
  });

  it("cache-breakpoints the tool results, so step 2 reads the prefix instead of re-prefilling", async () => {
    await runTurn();
    // Tool results are the largest thing in a multi-step turn (each capped at ~20k chars)
    // and are re-sent on every later step. This breakpoint is the one that clears
    // Anthropic's minimum cacheable size on every specialist, not just the widest one.
    const toolResults = anthropicBodies[1].messages.at(-1).content;
    expect(toolResults.at(-1).cache_control).toEqual({ type: "ephemeral" });
    // Exactly one breakpoint per step — the cap is 4 per request.
    expect(toolResults.filter((b: any) => b.cache_control).length).toBe(1);
  });

  it("carries the brain context into the cached system prefix", async () => {
    await runTurn();
    const sys = JSON.stringify(anthropicBodies[0].system);
    expect(sys).toContain("STUDENT BRAIN STATE: calm");
  });

  it("feeds both tool results back to the model in the model's own tool order", async () => {
    await runTurn();
    const followUp = anthropicBodies[1].messages.at(-1);
    expect(followUp.role).toBe("user");
    expect(followUp.content.map((b: any) => b.tool_use_id)).toEqual(["t1", "t2"]);
    expect(followUp.content.every((b: any) => b.type === "tool_result")).toBe(true);
  });
});

// @vitest-environment node
// Handler tests for api/exam.ts. Runs through the REAL gateway with a stubbed fetch that
// returns Anthropic-shaped responses (so gateway wiring is exercised too) + stubbed
// PostgREST for source-text resolution. Covers validation, the evaluate_answers
// length/clamp invariants, parseJsonLoose robustness, quiz source resolution, and degrade.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { makeRes } from "./helpers";

beforeEach(() => {
  process.env.SUPABASE_URL = "http://localhost";
  process.env.SUPABASE_SERVICE_KEY = "svc";
  process.env.ANTHROPIC_API_KEY = "test-key";
});
afterEach(() => vi.unstubAllGlobals());

// `anthropicText` is what the model "returns" as its text block. `anthropicOk:false`
// simulates a hard model error (status 400 → no gateway retry, fast).
function stubFetch({ anthropicText = "{}", anthropicOk = true, files = [], courses = [] }: any = {}) {
  const OK = (data: any) => ({ ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) });
  const fn = vi.fn(async (url: any) => {
    const u = String(url);
    if (u.includes("api.anthropic.com")) {
      if (!anthropicOk) return { ok: false, status: 400, json: async () => ({}), text: async () => '{"error":{"message":"bad"}}' };
      return OK({ content: [{ type: "text", text: anthropicText }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } });
    }
    if (u.includes("/rest/v1/courses")) return OK(courses);
    if (u.includes("/rest/v1/files"))   return OK(files);
    return OK([]);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

async function load() {
  vi.resetModules();
  return (await import("../api/exam.ts")).default;
}

describe("exam handler", () => {
  it("405 on non-POST; 400 on unknown action", async () => {
    stubFetch();
    const h = await load();
    let res = makeRes();
    await h({ method: "GET", body: {} }, res);
    expect(res.statusCode).toBe(405);
    res = makeRes();
    await h({ method: "POST", body: { action: "nope" } }, res);
    expect(res.statusCode).toBe(400);
  });

  it("evaluate_answers: 400 on empty items", async () => {
    stubFetch();
    const h = await load(); const res = makeRes();
    await h({ method: "POST", body: { action: "evaluate_answers", items: [] } }, res);
    expect(res.statusCode).toBe(400);
  });

  it("evaluate_answers: pads to items length, clamps score to [0,1], sums total", async () => {
    // model returns ONE result with an out-of-range score, for TWO items
    stubFetch({ anthropicText: '{"results":[{"correct":true,"score":5,"feedback":"great"}]}' });
    const h = await load(); const res = makeRes();
    await h({ method: "POST", body: { action: "evaluate_answers", items: [
      { question: "q1", studentAnswer: "a1" },
      { question: "q2", studentAnswer: "a2" },
    ] } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.results).toHaveLength(2);                 // padded to items length
    expect(res.body.results[0].score).toBe(1);                // 5 clamped to 1
    expect(res.body.results[1]).toEqual({ correct: false, score: 0, feedback: "" });
    expect(res.body.totalScore).toBe(1);
  });

  it("evaluate_answers: degrades to ungraded on model failure (never throws)", async () => {
    stubFetch({ anthropicOk: false });
    const h = await load(); const res = makeRes();
    await h({ method: "POST", body: { action: "evaluate_answers", items: [{ question: "q", studentAnswer: "a" }] } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.results).toEqual([{ correct: false, score: 0, feedback: "ungraded" }]);
    expect(res.body.totalScore).toBe(0);
  });

  it("parseJsonLoose survives prose + code fences around the JSON", async () => {
    stubFetch({ anthropicText: 'Sure, here you go:\n```json\n{"results":[{"correct":true,"score":1,"feedback":"ok"}]}\n```' });
    const h = await load(); const res = makeRes();
    await h({ method: "POST", body: { action: "evaluate_answers", items: [{ question: "q", studentAnswer: "a" }] } }, res);
    expect(res.body.results[0]).toMatchObject({ correct: true, score: 1 });
  });

  it("generate_quiz: 400 with no source, 200 with raw text", async () => {
    const h = await load();
    let res = makeRes();
    stubFetch();
    await h({ method: "POST", body: { action: "generate_quiz", userId: "u1" } }, res);
    expect(res.statusCode).toBe(400);

    res = makeRes();
    stubFetch({ anthropicText: '{"quizQuestions":[{"question":"Q?","type":"short_answer","options":null,"answer":"A"}]}' });
    await h({ method: "POST", body: { action: "generate_quiz", userId: "u1", text: "photosynthesis notes", count: 1 } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.quizQuestions).toHaveLength(1);
  });

  it("generate_quiz: 404 when a documentId resolves no source text", async () => {
    stubFetch({ files: [] });
    const h = await load(); const res = makeRes();
    await h({ method: "POST", body: { action: "generate_quiz", userId: "u1", documentId: "d-missing" } }, res);
    expect(res.statusCode).toBe(404);
  });

  it("generate_plan: 400 missing fields; 200 returns planId + sessions", async () => {
    const h = await load();
    let res = makeRes();
    stubFetch();
    await h({ method: "POST", body: { action: "generate_plan", userId: "u1" } }, res);
    expect(res.statusCode).toBe(400);

    res = makeRes();
    stubFetch({ anthropicText: '{"sessions":[{"date":"2026-08-01","topic":"Cells","activities":["read"],"estimatedMinutes":60}]}' });
    await h({ method: "POST", body: { action: "generate_plan", userId: "u1", courseId: 5, examDate: "2026-08-10" } }, res);
    expect(res.statusCode).toBe(200);
    expect(typeof res.body.planId).toBe("string");
    expect(res.body.sessions).toHaveLength(1);
  });

  it("generate_framework: normalizes edges to the contract's {from,to,relation} (even if the model emits source/target)", async () => {
    stubFetch({ anthropicText: '{"nodes":[{"id":"n1","label":"A"},{"id":"n2","label":"B"}],"edges":[{"source":"n1","target":"n2","relation":"leads to"}]}' });
    const h = await load(); const res = makeRes();
    await h({ method: "POST", body: { action: "generate_framework", userId: "u1", topic: "photosynthesis" } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.nodes).toHaveLength(2);
    expect(res.body.edges).toEqual([{ from: "n1", to: "n2", relation: "leads to" }]);
    expect(res.body.persisted).toBe(false);
  });

  it("generate_framework: passes through native {from,to} edges and drops malformed ones", async () => {
    stubFetch({ anthropicText: '{"nodes":[{"id":"n1","label":"A"}],"edges":[{"from":"n1","to":"n2","relation":"x"},{"relation":"orphan"}]}' });
    const h = await load(); const res = makeRes();
    await h({ method: "POST", body: { action: "generate_framework", userId: "u1", topic: "t" } }, res);
    expect(res.body.edges).toEqual([{ from: "n1", to: "n2", relation: "x" }]); // orphan (no from/to) dropped
  });
});

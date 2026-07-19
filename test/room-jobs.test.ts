// @vitest-environment node
// AI-10/11/12 — the session-end job handlers (api/_roomJobs.ts). These are what the BE-08
// worker drains, and what room-session ?action=review reads back, so the tests pin the
// column contract and the idempotency + refusal behaviours that keep a re-run or an empty
// session from producing junk.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The gateway is mocked so we can control the "model" output and inspect the metadata.
// `result` is the single reply; `queue` (if non-empty) overrides it turn-by-turn so a test
// can drive different outputs across a handler's regenerate loop.
const gw = vi.hoisted(() => ({ result: null as any, queue: [] as any[], calls: [] as any[] }));
vi.mock("../api/_gateway.ts", () => ({
  callModel: async (req: any) => { gw.calls.push(req); return gw.queue.length ? gw.queue.shift() : gw.result; },
}));
// Keep the worker's registerHandler a no-op here — we test the handlers directly.
vi.mock("../api/jobs.ts", () => ({ registerHandler: vi.fn() }));

function R(data: any, opts: { ok?: boolean; status?: number } = {}) {
  const { ok = true, status = 200 } = opts;
  return { ok, status, json: async () => data, text: async () => JSON.stringify(data) };
}
type Call = { url: string; method: string; body?: any };
function stubDb(route: (u: string, method: string, body: any) => any | undefined) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: any, init: any = {}) => {
    const u = String(url);
    const method = String(init.method ?? "GET").toUpperCase();
    const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ url: u, method, body });
    return route(u, method, body) ?? R([]);
  }));
  return calls;
}
const writesTo = (calls: Call[], table: string) =>
  calls.filter(c => (c.method === "POST" || c.method === "PATCH") && c.url.includes(`/${table}`));

const SESSION = "22222222-2222-4222-8222-222222222222";
const ROOM = "11111111-1111-4111-8111-111111111111";

const okModel = (content: string) => ({ ok: true, status: 200, content, trace_id: "t", error: undefined });

// A room with real activity → the handlers proceed. `existingRow` lets a table pretend a row
// already exists (idempotency path). `session` supplies room_ai_sessions lookups.
function routes({
  messages = [{ name: "Priya", body: "why does greedy fail for coin change?" }] as any[],
  board = [{ extracted_text: "greedy: 12+1+1+1 vs 5+5+5" }] as any[],
  sources = [{ document_id: "doc-a" }] as any[],
  docs = [{ id: "doc-a", title: "Lecture 07.pdf" }] as any[],
  session = [{ room_id: ROOM }] as any[],
  brain = [] as any[],
  version = [] as any[],
  existing = {} as Record<string, any[]>,
} = {}) {
  return stubDb((u, method) => {
    if (u.includes("room_messages?")) return R(messages);
    if (u.includes("whiteboard_snapshots?")) return R(board);
    if (u.includes("room_sources?")) return R(sources);
    if (u.includes("rag_documents?")) return R(docs);
    if (u.includes("room_ai_sessions?")) return R(session);
    if (u.includes("student_brains?")) return R(brain);
    if (u.includes("brain_versions?")) return R(version);
    // check-then-write: a GET with select=id probes for an existing row.
    if (method === "GET" && u.includes("select=id")) {
      for (const t of Object.keys(existing)) if (u.includes(`/${t}?`)) return R(existing[t]);
      return R([]);
    }
    if (method === "POST") return R([{ id: "new-row" }]);
    if (method === "PATCH") return R([{ id: "updated-row" }]);
    return undefined;
  });
}

let mod: any;
beforeEach(async () => {
  process.env.SUPABASE_URL = "http://localhost";
  process.env.SUPABASE_SERVICE_KEY = "svc";
  gw.calls = [];
  gw.result = null;
  gw.queue = [];
  vi.resetModules();
  mod = await import("../api/_roomJobs.ts");
});
afterEach(() => vi.unstubAllGlobals());

describe("registerRoomJobHandlers", () => {
  it("registers the session-output job types plus the A5 warm-context handler", async () => {
    const { registerHandler } = await import("../api/jobs.ts");
    (registerHandler as any).mockClear?.();
    mod.registerRoomJobHandlers();
    const types = (registerHandler as any).mock.calls.map((c: any[]) => c[0]);
    expect(new Set(types)).toEqual(new Set([
      "generate_session_summary", "generate_quiz", "propose_brain_update", "warm_brain_context",
    ]));
  });
});

describe("AI-10 generate_session_summary", () => {
  it("writes a group-scope summary and returns its id", async () => {
    gw.result = okModel(JSON.stringify({ objectives: ["distinguish greedy vs DP"], concepts: [{ name: "greedy-choice", explanation: "..." }], examples: [], unresolved: [], citations: ["Lecture 07.pdf"] }));
    const calls = routes();

    const id = await mod.generateSessionSummary({ sessionId: SESSION, roomId: ROOM });

    expect(id).toBe("new-row");
    const [w] = writesTo(calls, "session_summaries");
    expect(w.body).toMatchObject({ session_id: SESSION, scope: "group", user_id: null, status: "complete" });
    expect(w.body.summary.objectives).toEqual(["distinguish greedy vs DP"]);
  });

  it("UPDATES the existing group summary on a re-run instead of inserting a duplicate", async () => {
    gw.result = okModel(JSON.stringify({ objectives: [], concepts: [], examples: [], unresolved: [], citations: [] }));
    const calls = routes({ existing: { session_summaries: [{ id: "sum-1" }] } });

    await mod.generateSessionSummary({ sessionId: SESSION, roomId: ROOM });

    const w = writesTo(calls, "session_summaries");
    expect(w).toHaveLength(1);
    expect(w[0].method).toBe("PATCH");
    expect(w[0].url).toContain("id=eq.sum-1");
  });

  it("writes an empty summary WITHOUT calling the model for a dead-quiet session", async () => {
    const calls = routes({ messages: [], board: [] });

    await mod.generateSessionSummary({ sessionId: SESSION, roomId: ROOM });

    expect(gw.calls).toHaveLength(0);   // never asks a model to invent content from nothing
    expect(writesTo(calls, "session_summaries")[0].body.summary.note).toMatch(/no activity/i);
  });

  it("throws (→ job retries) when the model returns unparseable output", async () => {
    gw.result = okModel("I'm sorry, I can't do that.");
    routes();
    await expect(mod.generateSessionSummary({ sessionId: SESSION, roomId: ROOM })).rejects.toThrow(/unparseable/);
  });

  it("does not read private threads — the group summary must stay group-scoped", async () => {
    gw.result = okModel(JSON.stringify({ objectives: [], concepts: [], examples: [], unresolved: [], citations: [] }));
    const calls = routes();
    await mod.generateSessionSummary({ sessionId: SESSION, roomId: ROOM });
    expect(calls.find(c => c.url.includes("private_messages") || c.url.includes("private_threads"))).toBeUndefined();
  });

  it("requires sessionId and roomId", async () => {
    routes();
    await expect(mod.generateSessionSummary({ sessionId: SESSION })).rejects.toThrow(/roomId required/);
  });
});

describe("AI-11 generate_quiz", () => {
  const fiveGood = JSON.stringify({
    questions: Array.from({ length: 5 }, (_, i) => ({
      question: `Q${i + 1}?`, options: ["A", "B", "C", "D"], correctIndex: i % 4, rationale: "because", evidence: "Lecture 07.pdf",
    })),
  });

  it("persists exactly five validated questions keyed to the student", async () => {
    gw.result = okModel(fiveGood);
    const calls = routes();

    const id = await mod.generateQuiz({ sessionId: SESSION, userId: "priya" });

    expect(id).toBe("new-row");
    const [w] = writesTo(calls, "quiz_sets");
    expect(w.body).toMatchObject({ session_id: SESSION, user_id: "priya" });
    expect(w.body.questions).toHaveLength(5);
  });

  it("regenerates once when the first attempt is not exactly five, then succeeds", async () => {
    const one = JSON.stringify({ questions: [{ question: "q", options: ["A", "B", "C", "D"], correctIndex: 0, rationale: "r" }] });
    gw.queue = [okModel(one), okModel(fiveGood)];   // first attempt invalid, second valid
    const calls = routes();

    const id = await mod.generateQuiz({ sessionId: SESSION, userId: "priya" });

    expect(gw.calls).toHaveLength(2);
    expect(id).toBe("new-row");
    expect(writesTo(calls, "quiz_sets")[0].body.questions).toHaveLength(5);
  });

  it("throws after two invalid attempts rather than persisting a malformed quiz", async () => {
    gw.result = okModel(JSON.stringify({ questions: [{ question: "only one" }] }));
    const calls = routes();
    await expect(mod.generateQuiz({ sessionId: SESSION, userId: "priya" })).rejects.toThrow(/invalid output twice/);
    expect(writesTo(calls, "quiz_sets")).toHaveLength(0);
  });

  it("skips quiz generation for an empty session (returns null, writes nothing)", async () => {
    const calls = routes({ messages: [], board: [] });
    const id = await mod.generateQuiz({ sessionId: SESSION, userId: "priya" });
    expect(id).toBeNull();
    expect(gw.calls).toHaveLength(0);
    expect(writesTo(calls, "quiz_sets")).toHaveLength(0);
  });

  it("throws when its session cannot be found (bad payload / deleted session)", async () => {
    routes({ session: [] });
    await expect(mod.generateQuiz({ sessionId: SESSION, userId: "priya" })).rejects.toThrow(/not found/);
  });
});

describe("AI-12 propose_brain_update", () => {
  const goodPatch = JSON.stringify({ patch: { gaps: [{ topic: "memoization vs tabulation", confidence: 0.6 }] }, evidence: [{ kind: "session", ref: SESSION, note: "conflated the two" }], confidence: 0.7 });

  it("creates a PENDING proposal — it never auto-applies to the Brain", async () => {
    gw.result = okModel(goodPatch);
    const calls = routes();

    const id = await mod.proposeBrainUpdate({ sessionId: SESSION, userId: "priya" });

    expect(id).toBe("new-row");
    const [w] = writesTo(calls, "brain_update_proposals");
    expect(w.body).toMatchObject({ session_id: SESSION, user_id: "priya", status: "pending" });
    expect(w.body.patch.gaps[0].topic).toBe("memoization vs tabulation");
    // Must NEVER write a brain_versions row — that is the accept endpoint's job only.
    expect(writesTo(calls, "brain_versions")).toHaveLength(0);
  });

  it("proposes NOTHING when the model returns an empty patch", async () => {
    gw.result = okModel(JSON.stringify({ patch: {}, evidence: [], confidence: 0.1 }));
    const calls = routes();

    const id = await mod.proposeBrainUpdate({ sessionId: SESSION, userId: "priya" });

    expect(id).toBeNull();
    expect(writesTo(calls, "brain_update_proposals")).toHaveLength(0);
  });

  it("only replaces a still-PENDING proposal — a decided one is left untouched", async () => {
    // The check-then-write filter includes status=eq.pending, so an accepted proposal is
    // invisible to it and a fresh pending row is inserted rather than overwriting the decision.
    gw.result = okModel(goodPatch);
    const calls = routes({ existing: { brain_update_proposals: [] } });

    await mod.proposeBrainUpdate({ sessionId: SESSION, userId: "priya" });

    const probe = calls.find(c => c.method === "GET" && c.url.includes("brain_update_proposals") && c.url.includes("select=id"));
    expect(probe!.url).toContain("status=eq.pending");
  });

  it("clamps a wild confidence into 0..1", async () => {
    gw.result = okModel(JSON.stringify({ patch: { strengths: [{ topic: "recursion", confidence: 0.9 }] }, evidence: [], confidence: 5 }));
    const calls = routes();
    await mod.proposeBrainUpdate({ sessionId: SESSION, userId: "priya" });
    expect(writesTo(calls, "brain_update_proposals")[0].body.confidence).toBe(1);
  });

  it("skips proposal generation for an empty session", async () => {
    const calls = routes({ messages: [], board: [] });
    const id = await mod.proposeBrainUpdate({ sessionId: SESSION, userId: "priya" });
    expect(id).toBeNull();
    expect(gw.calls).toHaveLength(0);
    expect(writesTo(calls, "brain_update_proposals")).toHaveLength(0);
  });
});

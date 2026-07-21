// @vitest-environment node
// Phase J: api/exam-mastery-reminder.ts — finds canvas_quizzes due within the reminder
// window, gets/generates a Deck Signature Analysis profile (Phase G) for context, asks
// one Claude call to estimate mastery, and proposes an "exam_mastery" signal. Covers:
// the happy path, the no-deck-data skip path (marks processed, doesn't retry forever),
// and the CRON_SECRET auth gate.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { makeSupabaseMock, makeRes } from "./helpers";

vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }));
import { createClient } from "@supabase/supabase-js";

beforeEach(() => {
  process.env.SUPABASE_URL = "http://fs";
  process.env.SUPABASE_SERVICE_KEY = "svc";
  process.env.CRON_SECRET = "test-secret";
  process.env.ANTHROPIC_API_KEY = "ak";
});
afterEach(() => vi.unstubAllGlobals());

const quiz = (over: any = {}) => ({
  id: "q1", user_id: "u1", course_id: "c1", external_quiz_id: "ext1",
  title: "CHEM 101 Quarterly Exam",
  due_at: new Date(Date.now() + 2 * 86_400_000).toISOString(),
  topics_generated_at: null,
  ...over,
});
const course = { name: "Chemistry 101", course_code: "CHEM 101" };
const profile = {
  user_id: "u1", course_id: "c1", card_count: 2,
  topics: [{ topic: "Stoichiometry", confidence: 0.65, card_count: 1 }, { topic: "The Mole", confidence: 0.25, card_count: 1 }],
  style_notes: "terse", generated_at: new Date().toISOString(),
};
const anthropicOk = (json: any) => {
  const body = { content: [{ text: JSON.stringify(json) }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 10 } };
  return { ok: true, status: 200, text: async () => JSON.stringify(body), json: async () => body };
};

const planSessions = [
  { date: "2026-07-21", topic: "The Mole", activities: ["review flashcards"], materialIds: [], estimatedMinutes: 60 },
  { date: "2026-07-22", topic: "Stoichiometry", activities: ["practice quiz"], materialIds: [], estimatedMinutes: 60 },
  { date: "2026-07-23", topic: "Mixed review", activities: ["practice quiz"], materialIds: [], estimatedMinutes: 45 },
];

function stubFetch({
  quizzes = [quiz()] as any[], hasProfile = true, hasCards = true,
  assessment = { testedTopics: ["Stoichiometry"], masteryPct: 42, weakestTopics: ["The Mole"] } as any,
  plan = { sessions: planSessions } as any,
} = {}) {
  const fn = vi.fn(async (url: any, opts: any = {}) => {
    const u = String(url); const method = opts.method ?? "GET";
    const R = (data: any) => ({ ok: true, status: 200, json: async () => data, text: async () => "" });
    if (u.includes("api.anthropic.com")) {
      // Two model calls per quiz now: mastery assessment, then the study-plan generation
      // (generatePlanCore). Route by each call's system prompt.
      return String(opts.body ?? "").includes("study planner") ? anthropicOk(plan) : anthropicOk(assessment);
    }
    if (u.includes("/exam_plans") && method === "POST")       return R({});
    if (u.includes("/canvas_quizzes") && method === "GET")   return R(quizzes);
    if (u.includes("/canvas_quizzes") && method === "PATCH") return R({});
    if (u.includes("/courses"))         return R([course]);
    if (u.includes("/deck_profiles") && method === "GET")  return R(hasProfile ? [profile] : []);
    if (u.includes("/deck_profiles") && method === "POST") return R({});
    if (u.includes("/flashcards_v2"))   return R(hasCards ? [{ id: "f1", question: "Q?", answer: "A." }] : []);
    if (u.includes("/srs_reviews"))     return R([]);
    return R([]);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

async function loadHandler() {
  const { client, calls } = makeSupabaseMock();
  vi.resetModules();
  (createClient as any).mockReturnValue(client);
  const mod = await import("../api/exam-mastery-reminder.ts");
  return { handler: mod.default, calls };
}

const auth = () => ({ headers: { authorization: "Bearer test-secret" } });
const proposed = (calls: any[], dedupKey?: string) =>
  calls.some(c => c.table === "proactive_signals" && c.op === "insert" && (!dedupKey || c.payload?.dedup_key === dedupKey));

describe("exam-mastery-reminder handler", () => {
  it("fail-closed: 401 without the cron secret", async () => {
    const { handler } = await loadHandler();
    stubFetch();
    const res = makeRes();
    await handler({ headers: {} }, res);
    expect(res.statusCode).toBe(401);
  });

  it("proposes an exam_mastery signal for a quiz within the window with an existing deck profile", async () => {
    stubFetch();
    const { handler, calls } = await loadHandler();
    const res = makeRes();
    await handler(auth(), res);

    expect(res.body.proposed).toBe(1);
    expect(proposed(calls, "exam_mastery:q1")).toBe(true);
    const call = calls.find(c => c.table === "proactive_signals" && c.payload?.dedup_key === "exam_mastery:q1");
    expect(call.payload.type).toBe("exam_mastery");
    expect(call.payload.body).toContain("42%");
    expect(call.payload.body).toContain("CHEM 101 Quarterly Exam");
  });

  it("skips and marks processed when there are no flashcards to build a profile from (never retries forever)", async () => {
    stubFetch({ hasProfile: false, hasCards: false });
    const { handler, calls } = await loadHandler();
    const res = makeRes();
    await handler(auth(), res);

    expect(res.body.skipped).toBe(1);
    expect(res.body.proposed).toBe(0);
    expect(proposed(calls)).toBe(false);
  });

  it("does nothing when no quizzes are in the reminder window", async () => {
    stubFetch({ quizzes: [] });
    const { handler } = await loadHandler();
    const res = makeRes();
    await handler(auth(), res);

    expect(res.body.proposed).toBe(0);
    expect(res.body.skipped).toBe(0);
  });
});

// ── Proactive study planning (the plan half of the cron) ─────────────────────
describe("proactive study plan generation", () => {
  const signalPayload = (calls: any[]) =>
    calls.find(c => c.table === "proactive_signals" && c.op === "insert")?.payload;

  it("generates a plan, persists it, and attaches it to the signal (weakest topics first)", async () => {
    const fetchFn = stubFetch();
    const { handler, calls } = await loadHandler();
    const res = makeRes();
    await handler({ method: "POST", ...auth() }, res);
    expect(res.statusCode).toBe(200);

    const p = signalPayload(calls);
    expect(p).toBeTruthy();
    expect(p.data.sessionCount).toBe(3);
    expect(typeof p.data.planId).toBe("string");
    expect(p.body).toContain("3-session study plan");
    expect(p.title).toContain("study plan");

    // Persisted to exam_plans via generatePlanCore.
    const persist = fetchFn.mock.calls.find(c => String(c[0]).includes("/exam_plans") && c[1]?.method === "POST");
    expect(persist).toBeTruthy();
    const row = JSON.parse(persist![1].body);
    expect(row.user_id).toBe("u1");
    expect(row.sessions).toHaveLength(3);

    // Weakest topic leads the plan prompt (ordering contract).
    const planCall = fetchFn.mock.calls.find(c => String(c[0]).includes("api.anthropic.com") && String(c[1]?.body).includes("study planner"));
    expect(String(planCall![1].body).indexOf("The Mole")).toBeLessThan(String(planCall![1].body).indexOf("Stoichiometry"));
  });

  it("degrades to the plain reminder when plan generation returns nothing", async () => {
    stubFetch({ plan: { nonsense: true } });   // planner returns no sessions
    const { handler, calls } = await loadHandler();
    const res = makeRes();
    await handler({ method: "POST", ...auth() }, res);
    const p = signalPayload(calls);
    expect(p).toBeTruthy();
    expect(p.data.sessionCount).toBe(0);
    expect(p.data.planId).toBeNull();
    expect(p.body).not.toContain("study plan");
    expect(p.title).not.toContain("study plan");
  });

  it("the widened window catches an exam 4 days out (it's Monday, the test is Friday)", async () => {
    stubFetch({ quizzes: [quiz({ due_at: new Date(Date.now() + 4 * 86_400_000).toISOString() })] });
    const { handler, calls } = await loadHandler();
    const res = makeRes();
    await handler({ method: "POST", ...auth() }, res);
    expect(signalPayload(calls)).toBeTruthy();
    expect(res.body.proposed).toBe(1);
  });
});

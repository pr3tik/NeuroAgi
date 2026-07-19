// @vitest-environment node
// Handler tests for api/office-hours.ts — action-routed (?action=prep|capture).
// Pins CURRENT behavior: method/action routing, field validation, the happy paths
// (Claude call → parsed questions / distilled note → Supabase write), and the
// parseJsonLoose degrade-to-502 path. Auth is mocked (requireUserOr401) the same
// way test/exam.test.ts mocks it — resolve to req.body.userId so callers can still
// drive the userId the handler sees; fetch is stubbed per-test and routed by URL.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../api/_auth.ts", () => ({
  requireUser: async (req: any) => {
    const id = req?.__internalUserId ?? req?.body?.userId ?? req?.query?.userId;
    return id ? { userId: String(id), authId: "test" } : null;
  },
  requireUserOr401: async (req: any, res: any) => {
    const id = req?.__internalUserId ?? req?.body?.userId ?? req?.query?.userId;
    if (!id) { res?.status?.(401)?.json?.({ error: "Authentication required." }); return null; }
    return String(id);
  },
}));

import { makeRes } from "./helpers";

beforeEach(() => {
  process.env.SUPABASE_URL = "http://localhost";
  process.env.SUPABASE_SERVICE_KEY = "svc";
  process.env.ANTHROPIC_API_KEY = "test-key";
  delete process.env.BRAIN_SUPABASE_URL;
  delete process.env.BRAIN_SUPABASE_KEY;
});
afterEach(() => vi.unstubAllGlobals());

// Routes stubbed fetch by URL. `course` defaults to [] (no row found) so the
// course_content branch — which would additionally call userUniversityId()'s own
// fetch to /rest/v1/users — never triggers; keeps the stub focused on office-hours'
// own fetches, matching the "highest-value behavior" scope of this suite.
function stubFetch(opts: any = {}) {
  const {
    anthropicText = "{}",
    anthropicOk = true,
    mindDoc = null,
    impressions = [],
    assignments = [],
    course = [],
    files = [],
    tutorMindUpsertOk = true,
  } = opts;
  const calls: { method: string; url: string; body?: any }[] = [];
  const OK = (data: any) => ({ ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) });
  const fn = vi.fn(async (url: any, init: any = {}) => {
    const u = String(url);
    const method = init.method ?? "GET";
    calls.push({ method, url: u, body: init.body ? JSON.parse(init.body) : undefined });
    if (u.includes("api.anthropic.com")) {
      if (!anthropicOk) return { ok: false, status: 400, json: async () => ({}), text: async () => '{"error":"bad"}' };
      return OK({ content: [{ type: "text", text: anthropicText }] });
    }
    if (u.includes("/rest/v1/tutor_mind")) {
      if (method === "GET") return OK(mindDoc != null ? [{ mind_doc: mindDoc }] : []);
      return tutorMindUpsertOk ? OK([]) : { ok: false, status: 400, text: async () => "upsert failed" };
    }
    if (u.includes("/rest/v1/tutor_impressions")) return OK(impressions);
    if (u.includes("/rest/v1/assignments")) return OK(assignments);
    if (u.includes("/rest/v1/courses")) return OK(course);
    if (u.includes("/rest/v1/files")) return OK(files);
    return OK([]);
  });
  vi.stubGlobal("fetch", fn);
  return { fn, calls };
}

async function load() {
  vi.resetModules();
  return (await import("../api/office-hours.ts")).default;
}

describe("office-hours handler", () => {
  it("405 on non-POST; 400 on missing action; 400 on unknown action", async () => {
    stubFetch();
    const h = await load();

    let res = makeRes();
    await h({ method: "GET", body: {} }, res);
    expect(res.statusCode).toBe(405);

    res = makeRes();
    await h({ method: "POST", body: { userId: "u1" }, query: {} }, res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: "Unknown action. Use ?action=prep|capture" });

    res = makeRes();
    await h({ method: "POST", body: { userId: "u1" }, query: { action: "bogus" } }, res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: "Unknown action. Use ?action=prep|capture" });
  });

  it("prep: missing courseId → 400 (pinned validation message)", async () => {
    stubFetch();
    const h = await load();
    const res = makeRes();
    await h({ method: "POST", body: { userId: "u1", courseName: "Bio 130" }, query: { action: "prep" } }, res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: "userId and courseId required" });
  });

  it("prep: happy path returns Claude's questions + context_used reflecting living-mind presence", async () => {
    const qs = [
      { id: "q1", gap: "confusion about recursion base cases", question: "Can you walk through why my base case fails?", priority: "high", linked_assignment: null },
    ];
    stubFetch({
      anthropicText: JSON.stringify({ questions: qs }),
      mindDoc: "Struggles with recursion.",
      impressions: [{ impression: "Confused about pointers" }],
      assignments: [{ title: "HW3", due_at: "2026-08-01T00:00:00Z", description: "desc", points_possible: 10 }],
    });
    const h = await load();
    const res = makeRes();
    await h({ method: "POST", body: { userId: "u1", courseId: "c1", courseName: "CS101" }, query: { action: "prep" } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.questions).toEqual(qs);
    expect(res.body.context_used).toBe("living mind + impressions + course material");
  });

  it("prep: 502 when Claude's output doesn't parse to a non-empty questions array (degrade path)", async () => {
    stubFetch({ anthropicText: "not json at all" });
    const h = await load();
    const res = makeRes();
    await h({ method: "POST", body: { userId: "u1", courseId: "c1", courseName: "CS101" }, query: { action: "prep" } }, res);
    expect(res.statusCode).toBe(502);
    expect(res.body).toEqual({ error: "question generation returned invalid JSON" });
  });

  it("capture: happy path distills notes, upserts tutor_mind, and returns ok", async () => {
    const { calls } = stubFetch({ anthropicText: "Clarified the recursion base case; confident now." });
    const h = await load();
    const res = makeRes();
    await h(
      { method: "POST", body: { userId: "u1", courseId: "c1", sessionNotes: "We went over recursion base cases.", questionIds: ["q1", "q2"] }, query: { action: "capture" } },
      res
    );
    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.gapUpdate).toBe("Clarified the recursion base case; confident now.");
    expect(res.body.questionsAsked).toBe(2);
    const upsert = calls.find((c) => c.url.includes("/rest/v1/tutor_mind") && c.method === "POST");
    expect(upsert?.body.user_id).toBe("u1");
    expect(upsert?.body.mind_doc).toContain("Clarified the recursion base case");
  });

  it("capture: missing sessionNotes → 400 (pinned validation message)", async () => {
    stubFetch();
    const h = await load();
    const res = makeRes();
    await h({ method: "POST", body: { userId: "u1", courseId: "c1" }, query: { action: "capture" } }, res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: "userId and sessionNotes required" });
  });
});

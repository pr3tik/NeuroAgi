// @vitest-environment node
// Handler tests for api/tutor-context.ts.
//
// Priority: BR-05 Gap 1+2 — the shared-library branch now returns `sources: [{ id, type,
// label }]` grounding chips (courseSourceLabel from api/course-source.ts, real/unmocked
// here so the friendly-label mapping is actually exercised, not assumed). Secondary goal:
// pin a few core current-behavior invariants (auth gate, missing-env short-circuit,
// method gate, sources always an array even when the library branch never fires).
//
// Deps mocked so importing/calling the handler never touches the network:
//  - ./_auth.js         → requireUserOr401 (toggle via `authState.userId`)
//  - ./_brain/kernel.js  → postgrestStore/recall/renderStudentBrainState (kernel memory path
//                          is never actually reached in these scenarios — resolveFschoolPerson
//                          always resolves null below — but the module must still import cleanly)
//  - ./_brain/identity.js → resolveFschoolPerson (always null → legacy context_window path only)
//  - ./rag.js            → embed (used by the strategy-hint fetch's dynamic import)
// Left REAL (pure / no module-load side effects): ./course-source.js (the label mapping under
// test) and ./_reggie/canvasLive.js (userUniversityId — just does a fetch, which the global
// fetch stub answers by URL like every other DB read here).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { makeRes } from "./helpers";

const authState = vi.hoisted(() => ({ userId: "user-1" as string | null }));
vi.mock("../api/_auth.ts", () => ({
  requireUser: async () => (authState.userId ? { userId: authState.userId, authId: "t" } : null),
  requireUserOr401: async (_req: any, res: any) => {
    if (!authState.userId) { res.status(401).json({ error: "Authentication required." }); return null; }
    return authState.userId;
  },
}));

vi.mock("../api/_brain/kernel.ts", () => ({
  postgrestStore: vi.fn(() => ({})),
  recall: vi.fn(async () => []),
  renderStudentBrainState: vi.fn(() => null),
}));

vi.mock("../api/_brain/identity.ts", () => ({
  resolveFschoolPerson: vi.fn(async () => null),
}));

vi.mock("../api/rag.ts", () => ({
  embed: vi.fn(async (xs: string[]) => xs.map(() => new Array(1536).fill(0.01))),
}));

function OK(data: any) { return { ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) }; }
const ANTHROPIC_FAIL = { ok: false, status: 400, json: async () => ({}), text: async () => "" };

async function load() {
  vi.resetModules();
  return (await import("../api/tutor-context.ts")).default;
}

beforeEach(() => {
  authState.userId = "user-1";
  process.env.ANTHROPIC_API_KEY    = "test-anthropic-key";
  process.env.SUPABASE_URL         = "http://example.test";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
  delete process.env.SUPABASE_ANON_KEY;
  delete process.env.BRAIN_SUPABASE_URL;   // Brain DB legacy context_window path stays fully off
  delete process.env.BRAIN_SUPABASE_KEY;
});
afterEach(() => { vi.unstubAllGlobals(); delete process.env.ANTHROPIC_API_KEY; });

describe("tutor-context handler — BR-05 sources (grounding chips)", () => {
  it("returns sources:[{id,type,label}] with friendly labels for a library-triggering query", async () => {
    const rows = [
      { id: "row-syllabus",   content_type: "syllabus",   text: "Syllabus body text",   summary: "Grading breakdown and policies", module_name: null,           week_number: null, seen_by_count: 10 },
      { id: "row-assessment", content_type: "assessment", text: "Assessment body text", summary: "Midterm and final dates",        module_name: null,           week_number: null, seen_by_count: 5  },
      { id: "row-module",     content_type: "module",     text: "Module body text",     summary: "Topic overview",                  module_name: "Cell Biology", week_number: 3,    seen_by_count: 2  },
    ];
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: any) => {
      const u = String(url);
      calls.push(u);
      if (u.includes("api.anthropic.com"))                              return ANTHROPIC_FAIL; // → queryType stays "none"
      if (u.includes("/rest/v1/course_content"))                        return OK(rows);
      if (u.includes("/rest/v1/rpc/find_teaching_strategy_hint"))       return OK([]);
      return OK([]); // users lookups (brain_person_id, university_id) → no rows
    }));

    const handler = await load();
    const res = makeRes();
    await handler(
      { method: "POST", body: { userMessage: "What does the syllabus say about the midterm?", activeCourseId: "course-1" } },
      res,
    );

    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body.sources)).toBe(true);
    expect(res.body.sources.length).toBeGreaterThan(0);
    for (const s of res.body.sources) {
      expect(Object.keys(s).sort()).toEqual(["id", "label", "type"]);
    }

    const syllabus   = res.body.sources.find((s: any) => s.type === "syllabus");
    const assessment = res.body.sources.find((s: any) => s.type === "assessment");
    expect(syllabus?.label).toBe("Course Syllabus");         // BR-05 Gap 1 label map
    expect(assessment?.label).toBe("Assessment Schedule");   // BR-03 assessment type, BR-05 label
    expect(syllabus?.id).toBe("row-syllabus");
    expect(assessment?.id).toBe("row-assessment");

    // The library query itself must be scoped to the shared, non-private library (BR-02).
    const libCall = calls.find((u) => u.includes("/rest/v1/course_content"));
    expect(libCall).toContain("is_private=eq.false");
    expect(libCall).toContain("course_id=eq.course-1");
  });

  it("returns sources: [] (present, not undefined) when the message never triggers a library search", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: any) => {
      const u = String(url);
      if (u.includes("api.anthropic.com")) return ANTHROPIC_FAIL;
      return OK([]);
    }));

    const handler = await load();
    const res = makeRes();
    await handler({ method: "POST", body: { userMessage: "hi there", activeCourseId: "course-1" } }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.sources).toEqual([]);
    expect(res.body).toHaveProperty("strategyHintId", null);
    expect(res.body).toHaveProperty("strategyHintKind", null);
  });
});

describe("tutor-context handler — pinned core behavior", () => {
  it("405s on non-POST", async () => {
    const handler = await load();
    const res = makeRes();
    await handler({ method: "GET", body: {} }, res);
    expect(res.statusCode).toBe(405);
  });

  it("short-circuits with 200 { context: null, reason: 'missing env' } when required env is absent (never reaches auth)", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const handler = await load();
    const res = makeRes();
    await handler({ method: "POST", body: { userMessage: "hello" } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ context: null, reason: "missing env" });
  });

  it("401s when the caller isn't authenticated", async () => {
    authState.userId = null;
    vi.stubGlobal("fetch", vi.fn(async () => OK([])));
    const handler = await load();
    const res = makeRes();
    await handler({ method: "POST", body: { userMessage: "hello" } }, res);
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: "Authentication required." });
  });

  it("returns { context: null } when userMessage is missing (past the auth gate)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => OK([])));
    const handler = await load();
    const res = makeRes();
    await handler({ method: "POST", body: {} }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ context: null });
  });
});

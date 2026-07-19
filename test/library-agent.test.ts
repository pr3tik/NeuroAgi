// @vitest-environment node
// Handler + core-logic tests for api/library-agent.ts — semantic search over the
// shared course_content library. Pins CURRENT behavior:
//   - the keyword-signal "gate" (isLibraryQuery) that guards the passive tutor-context
//     path, and that `force: true` bypasses it (a deliberate tool call already decided
//     this IS a library query);
//   - the happy path: both the active-course and enrolled-courses branches are searched,
//     scored, and merged into ranked snippets/sources;
//   - BR-02: every course_content query filters `is_private=false` — this endpoint reads
//     a table shared across students and must never request private rows (inbox
//     messages, submissions, grades), even though it also builds a lazy service-role
//     Supabase client at first use;
//   - the try/catch around the search degrades to `{found:false,...}` instead of
//     throwing on a Supabase error;
//   - the HTTP handler's method/auth/validation guards, and that it overwrites any
//     client-supplied userId with the authenticated caller's id before querying
//     (IDOR guard — mirrors _auth.ts's documented intent).
//
// library-agent builds its Supabase client lazily (`db()`, on first call) rather than
// at module load, but we still mock @supabase/supabase-js + reset modules per test
// (matching test/extension-content.test.ts's `loadHandler` pattern) so each test gets
// a fresh `_supabase` singleton and a fresh mock. userUniversityId (BR-02 school scoping)
// is mocked directly rather than stubbing its underlying fetch — same approach
// test/extension-content.test.ts uses for course-resolver.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }));
import { createClient } from "@supabase/supabase-js";

// Hoisted so the vi.mock factory below can reference it, and so tests can assert on
// call args (e.g. the IDOR-override test checks which userId this was called with).
const { userUniversityId } = vi.hoisted(() => ({ userUniversityId: vi.fn(async () => null as string | null) }));
vi.mock("../api/_reggie/canvasLive.js", () => ({ userUniversityId }));

// Auth mock: resolves to a fixed authenticated id regardless of the request body, so
// the IDOR-override test can prove the handler ignores/overwrites a client-supplied
// userId. Set req.__noAuth to exercise the 401 path.
vi.mock("../api/_auth.js", () => ({
  requireUserOr401: vi.fn(async (req: any, res: any) => {
    if (req?.__noAuth) { res.status(401).json({ error: "Authentication required." }); return null; }
    return "authed-user-1";
  }),
}));

import { makeSupabaseMock, makeRes } from "./helpers";

beforeEach(() => {
  process.env.SUPABASE_URL = "http://localhost";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
});
afterEach(() => vi.unstubAllGlobals());

async function loadLib(router: (ctx: any) => any, uni: string | null = null) {
  const { client, calls } = makeSupabaseMock(router);
  vi.resetModules();
  (createClient as any).mockReturnValue(client);
  userUniversityId.mockReset();
  userUniversityId.mockResolvedValue(uni);
  const mod = await import("../api/library-agent.ts");
  return { queryLibrary: mod.queryLibrary as any, handler: mod.default as any, calls };
}

// Routes a course_content select by which course filter it carries: `.eq("course_id", x)`
// (the active-course branch) vs `.in("course_id", [...])` (the enrolled-courses branch).
function courseContentRouter(rows: any[]) {
  return (ctx: any) => {
    if (ctx.table !== "course_content" || ctx.op !== "select") return { data: null, error: null };
    const eqCourse = ctx.filters.find((f: any) => f[0] === "eq" && f[1] === "course_id");
    const inCourse = ctx.filters.find((f: any) => f[0] === "in" && f[1] === "course_id");
    if (eqCourse) return { data: rows.filter(r => r.course_id === eqCourse[2]), error: null };
    if (inCourse) return { data: rows.filter(r => (inCourse[2] as string[]).includes(r.course_id)), error: null };
    return { data: [], error: null };
  };
}

const rows = [
  {
    id: "a1", content_type: "syllabus",
    text: "Full syllabus text: grading, policies, syllabus overview.",
    summary: "Syllabus covers exam schedule.",
    concepts: null, module_name: null, week_number: null, professor_name: "Prof X",
    is_private: false, seen_by_count: 10, course_id: "active-1",
  },
  {
    id: "b1", content_type: "lecture",
    text: "Lecture notes on midterm exam material and review.",
    summary: "Midterm exam review lecture notes.",
    concepts: null, module_name: "Week 3", week_number: 3, professor_name: "Prof Y",
    is_private: false, seen_by_count: 2, course_id: "enrolled-2",
  },
];
const LIBRARY_MESSAGE = "What does the syllabus say about the midterm exam?";

describe("queryLibrary", () => {
  it("happy path: merges + ranks results from the active course and enrolled courses", async () => {
    const { queryLibrary, calls } = await loadLib(courseContentRouter(rows));
    const result = await queryLibrary({
      userId: "u1",
      message: LIBRARY_MESSAGE,
      courseIds: ["enrolled-2", "enrolled-3"],
      activeCourseId: "active-1",
    });

    expect(result.found).toBe(true);
    expect(result.snippets.some((s: string) => s.startsWith("[Course Syllabus]"))).toBe(true);
    expect(result.sources.map((s: any) => s.id).sort()).toEqual(["a1", "b1"]);
    // Both branches actually ran (active-course query + enrolled-courses query).
    expect(calls.filter(c => c.table === "course_content").length).toBe(2);
  });

  it("BR-02: every course_content query filters is_private=false — never requests private rows", async () => {
    const { queryLibrary, calls } = await loadLib(courseContentRouter(rows));
    await queryLibrary({
      userId: "u1",
      message: LIBRARY_MESSAGE,
      courseIds: ["enrolled-2"],
      activeCourseId: "active-1",
    });

    const courseContentCalls = calls.filter(c => c.table === "course_content");
    expect(courseContentCalls.length).toBe(2); // active-course branch + enrolled-courses branch
    const isPrivateFilters = courseContentCalls
      .flatMap(c => c.filters)
      .filter((f: any) => f[0] === "eq" && f[1] === "is_private");
    expect(isPrivateFilters.length).toBe(2); // one per branch
    expect(isPrivateFilters.every((f: any) => f[2] === false)).toBe(true);
    expect(isPrivateFilters.some((f: any) => f[2] === true)).toBe(false);
  });

  it("keyword-signal gate: blocks a non-library message unless force=true", async () => {
    const { queryLibrary, calls } = await loadLib(() => ({ data: [], error: null }));
    // No substring of LIBRARY_QUERY_SIGNALS appears in this message.
    const msg = "random pizza toppings recipe ideas today";

    const blocked = await queryLibrary({ userId: "u1", message: msg, courseIds: ["c1"] });
    expect(blocked).toEqual({ found: false, snippets: [], sources: [] });
    expect(calls.length).toBe(0); // gate short-circuited before any Supabase call

    const forced = await queryLibrary({ userId: "u1", message: msg, courseIds: ["c1"], force: true });
    expect(forced).toEqual({ found: false, snippets: [], sources: [] }); // no matching rows, but not gate-blocked
    expect(calls.some(c => c.table === "course_content")).toBe(true); // force bypassed the gate
  });

  it("degrades to not-found (does not throw) when the Supabase query rejects", async () => {
    const { queryLibrary } = await loadLib(() => { throw new Error("db unreachable"); });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await queryLibrary({ userId: "u1", message: "Tell me about the syllabus please", courseIds: ["c1"] });
    expect(result).toEqual({ found: false, snippets: [], sources: [] });
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});

describe("library-agent HTTP handler", () => {
  it("405 on non-POST; 401 when unauthenticated; 400 when message is missing", async () => {
    const { handler } = await loadLib(() => ({ data: [], error: null }));

    let res = makeRes();
    await handler({ method: "GET" }, res);
    expect(res.statusCode).toBe(405);

    res = makeRes();
    await handler({ method: "POST", body: { userId: "u1", message: "hi" }, __noAuth: true }, res);
    expect(res.statusCode).toBe(401);

    res = makeRes();
    await handler({ method: "POST", body: {} }, res); // authed, but no message
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: "userId and message required" });
  });

  it("IDOR guard: overwrites a client-supplied userId with the authenticated caller's id before querying", async () => {
    const { handler } = await loadLib(() => ({ data: [], error: null }));
    const res = makeRes();
    await handler(
      { method: "POST", body: { userId: "someone-elses-id", message: LIBRARY_MESSAGE, courseIds: ["c1"] } },
      res
    );
    expect(res.statusCode).toBe(200);
    expect(userUniversityId).toHaveBeenCalledWith("authed-user-1");
    expect(userUniversityId).not.toHaveBeenCalledWith("someone-elses-id");
  });
});

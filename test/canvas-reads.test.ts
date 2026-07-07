// @vitest-environment node
// Handler tests for api/canvas-reads.ts against a stubbed PostgREST. Covers the
// title->name mapping (the column is `title`, not `name`), course_id grouping, the
// submitted filter, GPA, error propagation, and validation.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { makeRes } from "./helpers";

beforeEach(() => {
  process.env.SUPABASE_URL = "http://localhost";
  process.env.SUPABASE_SERVICE_KEY = "svc";
});
afterEach(() => vi.unstubAllGlobals());

function stubFetch(routes: any = {}) {
  const R = (data: any, ok = true, status = 200) => ({ ok, status, json: async () => data, text: async () => JSON.stringify(data) });
  const fn = vi.fn(async (url: any) => {
    const u = String(url);
    if (u.includes("/rest/v1/courses"))     return R(routes.courses ?? []);
    if (u.includes("/rest/v1/assignments")) return R(routes.assignments ?? []);
    return R([]);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

async function load() {
  vi.resetModules();
  return (await import("../api/canvas-reads.ts")).default;
}

describe("canvas-reads handler", () => {
  it("405 on non-POST", async () => {
    const h = await load(); const res = makeRes();
    await h({ method: "GET", body: {} }, res);
    expect(res.statusCode).toBe(405);
  });

  it("400 without userId", async () => {
    stubFetch();
    const h = await load(); const res = makeRes();
    await h({ method: "POST", body: { action: "grades" } }, res);
    expect(res.statusCode).toBe(400);
  });

  it("grades: maps title->name, groups assignments by course_id, computes GPA", async () => {
    stubFetch({
      courses: [{ id: "c-uuid", canvas_course_id: "111", course_code: "BIO101", name: "Bio", current_score: 92, final_score: null }],
      assignments: [
        { id: "a1", course_id: "c-uuid", title: "Lab 1", score: 9, points_possible: 10, weight: null, weight_achieved: null },
        { id: "a2", course_id: "other",  title: "X",     score: 1, points_possible: 10 },
      ],
    });
    const h = await load(); const res = makeRes();
    await h({ method: "POST", body: { action: "grades", userId: "u1" } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.courses).toHaveLength(1);
    const c = res.body.courses[0];
    expect(c.courseId).toBe("c-uuid");
    expect(c.assignments).toHaveLength(1);          // a2 belongs to another course
    expect(c.assignments[0].name).toBe("Lab 1");    // title -> name
    expect(res.body.gpa).toBe(4.0);                 // 92% -> 4.0
  });

  it("grades: propagates a Supabase error status", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}), text: async () => "" })));
    const h = await load(); const res = makeRes();
    await h({ method: "POST", body: { action: "grades", userId: "u1" } }, res);
    expect(res.statusCode).toBe(500);
  });

  it("upcoming: hides submitted unless includeSubmitted; maps title + courseName", async () => {
    stubFetch({
      assignments: [
        { id: "a1", course_id: "c1", title: "Due soon", due_at: "2999-01-01T00:00:00Z", points_possible: 10, submitted_at: null, missing: false, courses: { name: "Bio" } },
        { id: "a2", course_id: "c1", title: "Done",     due_at: "2999-01-02T00:00:00Z", submitted_at: "2026-01-01T00:00:00Z", courses: { name: "Bio" } },
      ],
    });
    const h = await load();
    let res = makeRes();
    await h({ method: "POST", body: { action: "upcoming", userId: "u1" } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.assignments).toHaveLength(1);
    expect(res.body.assignments[0].name).toBe("Due soon");
    expect(res.body.assignments[0].courseName).toBe("Bio");
    expect(res.body.assignments[0].submitted).toBe(false);

    res = makeRes();
    await h({ method: "POST", body: { action: "upcoming", userId: "u1", includeSubmitted: true } }, res);
    expect(res.body.assignments).toHaveLength(2);
  });

  it("grades: a Canvas courseId filters via canvas_course_id (never id.eq → no uuid-cast 400)", async () => {
    const fn = stubFetch({
      courses: [{ id: "c-uuid", canvas_course_id: "98765", course_code: "BIO", current_score: 80, final_score: null }],
      assignments: [],
    });
    const h = await load(); const res = makeRes();
    await h({ method: "POST", body: { action: "grades", userId: "u1", courseId: 98765 } }, res);
    expect(res.statusCode).toBe(200);
    const courseCall = fn.mock.calls.find((c: any[]) => String(c[0]).includes("/rest/v1/courses"))!;
    expect(String(courseCall[0])).toContain("canvas_course_id=eq.98765");
    expect(String(courseCall[0])).not.toContain("or=(");
    expect(String(courseCall[0])).not.toContain("&id=eq."); // not the uuid branch
  });

  it("upcoming: withinDays=0 still bounds the horizon (not all-future)", async () => {
    const fn = stubFetch({ assignments: [] });
    const h = await load(); const res = makeRes();
    await h({ method: "POST", body: { action: "upcoming", userId: "u1", withinDays: 0 } }, res);
    expect(res.statusCode).toBe(200);
    const call = fn.mock.calls.find((c: any[]) => String(c[0]).includes("/rest/v1/assignments"))!;
    expect(String(call[0])).toContain("due_at=lte.");
  });

  it("unknown action → 400", async () => {
    stubFetch();
    const h = await load(); const res = makeRes();
    await h({ method: "POST", body: { action: "nope", userId: "u1" } }, res);
    expect(res.statusCode).toBe(400);
  });
});

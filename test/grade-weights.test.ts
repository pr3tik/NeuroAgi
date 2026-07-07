// @vitest-environment node
// Handler tests for api/grade-weights.ts. Covers course resolution (canvas id OR db
// uuid), blob match by canvas_course_id, the two 404 paths, the points-based projected
// grade, and persisted:false.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { makeRes } from "./helpers";

beforeEach(() => {
  process.env.SUPABASE_URL = "http://localhost";
  process.env.SUPABASE_SERVICE_KEY = "svc";
});
afterEach(() => vi.unstubAllGlobals());

function stubFetch(routes: any = {}) {
  const R = (data: any) => ({ ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) });
  const fn = vi.fn(async (url: any) => {
    const u = String(url);
    if (u.includes("/rest/v1/users"))       return R(routes.users ?? [{ id: "u1" }]); // userId-exists check
    if (u.includes("/rest/v1/courses"))     return R(routes.courses ?? []);
    if (u.includes("/rest/v1/canvas_data")) return R(routes.canvas_data ?? []);
    if (u.includes("/rest/v1/assignments")) return R(routes.assignments ?? []);
    return R([]);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

async function load() {
  vi.resetModules();
  return (await import("../api/grade-weights.ts")).default;
}

describe("grade-weights handler", () => {
  it("400 without userId/courseId", async () => {
    stubFetch();
    const h = await load(); const res = makeRes();
    await h({ method: "POST", body: { userId: "u1" } }, res);
    expect(res.statusCode).toBe(400);
  });

  it("401 when the userId doesn't exist", async () => {
    stubFetch({ users: [] });
    const h = await load(); const res = makeRes();
    await h({ method: "POST", body: { userId: "ghost", courseId: "111" } }, res);
    expect(res.statusCode).toBe(401);
  });

  it("404 when the course isn't found", async () => {
    stubFetch({ courses: [] });
    const h = await load(); const res = makeRes();
    await h({ method: "POST", body: { userId: "u1", courseId: "111" } }, res);
    expect(res.statusCode).toBe(404);
  });

  it("404 when there's no assignment_groups blob for the course", async () => {
    stubFetch({
      courses: [{ id: "c-uuid", canvas_course_id: "111" }],
      canvas_data: [{ payload: [{ courseId: "999", groups: [{ name: "Exams", weight: 100 }] }] }],
    });
    const h = await load(); const res = makeRes();
    await h({ method: "POST", body: { userId: "u1", courseId: "111" } }, res);
    expect(res.statusCode).toBe(404);
  });

  it("returns category weights + points-based projected grade; persisted:false", async () => {
    stubFetch({
      courses: [{ id: "c-uuid", canvas_course_id: "111" }],
      canvas_data: [{ payload: [{ courseId: "111", groups: [{ name: "Exams", weight: 60 }, { name: "HW", weight: 40 }] }] }],
      assignments: [{ id: "a1", points_possible: 10, score: 8 }, { id: "a2", points_possible: 10, score: 10 }],
    });
    const h = await load(); const res = makeRes();
    await h({ method: "POST", body: { userId: "u1", courseId: "111" } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.groups).toHaveLength(2);
    expect(res.body.groups[0]).toMatchObject({ name: "Exams", weight: 60, assignments: [] });
    expect(res.body.persisted).toBe(false);
    expect(res.body.projectedGrade).toBeCloseTo(90); // (8+10)/(10+10) = 90%
  });

  it("a Canvas courseId resolves via canvas_course_id=eq (no id.eq uuid-cast 400)", async () => {
    const fn = stubFetch({
      courses: [{ id: "c-uuid", canvas_course_id: "111" }],
      canvas_data: [{ payload: [{ courseId: "111", groups: [{ name: "All", weight: 100 }] }] }],
      assignments: [],
    });
    const h = await load(); const res = makeRes();
    await h({ method: "POST", body: { userId: "u1", courseId: "111" } }, res);
    expect(res.statusCode).toBe(200);
    const courseCall = fn.mock.calls.find((c: any[]) => String(c[0]).includes("/rest/v1/courses"))!;
    expect(String(courseCall[0])).toContain("canvas_course_id=eq.111");
    expect(String(courseCall[0])).not.toContain("or=(");
  });

  it("a DB-uuid courseId resolves via id=eq", async () => {
    const uuid = "11111111-2222-3333-4444-555555555555";
    const fn = stubFetch({
      courses: [{ id: uuid, canvas_course_id: "111" }],
      canvas_data: [{ payload: [{ courseId: "111", groups: [{ name: "All", weight: 100 }] }] }],
      assignments: [],
    });
    const h = await load(); const res = makeRes();
    await h({ method: "POST", body: { userId: "u1", courseId: uuid } }, res);
    expect(res.statusCode).toBe(200);
    const courseCall = fn.mock.calls.find((c: any[]) => String(c[0]).includes("/rest/v1/courses"))!;
    expect(String(courseCall[0])).toContain(`id=eq.${uuid}`);
    expect(res.body.projectedGrade).toBeNull(); // no assignments → null
  });
});

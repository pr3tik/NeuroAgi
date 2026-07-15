// @vitest-environment node
// Handler tests for api/canvas-reads.ts against a stubbed PostgREST. Covers the
// title->name mapping (the column is `title`, not `name`), course_id grouping, the
// submitted filter, GPA, error propagation, and validation.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../api/_auth.ts", () => ({
  requireUser: async (req) => { const id = req?.__internalUserId ?? req?.body?.userId ?? req?.body?.fromUserId ?? req?.query?.userId; return id ? { userId: String(id), authId: "test" } : null; },
  requireUserOr401: async (req, res) => { const id = req?.__internalUserId ?? req?.body?.userId ?? req?.body?.fromUserId ?? req?.query?.userId; if (!id) { res?.status?.(401)?.json?.({ error: "auth required" }); return null; } return String(id); },
}));

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
    if (u.includes("/rest/v1/users"))       return R(routes.users ?? [{ id: "u1" }]); // userId-exists check
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

  it("401 without a session (auth is the first gate)", async () => {
    stubFetch();
    const h = await load(); const res = makeRes();
    await h({ method: "POST", body: { action: "grades" } }, res);
    expect(res.statusCode).toBe(401);
  });

  it("401 when the userId doesn't exist", async () => {
    stubFetch({ users: [] });
    const h = await load(); const res = makeRes();
    await h({ method: "POST", body: { action: "grades", userId: "ghost" } }, res);
    expect(res.statusCode).toBe(401);
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

  it("upcoming ALSO returns overdue-unsubmitted work as overdue[] + overdueCount — regression: a 'what's due' answer must never drop/omit overdue items or falsely say caught-up", async () => {
    // Two /assignments queries fire on 'upcoming': the future window, then the overdue one
    // (due_at=lt.now & submitted_at=is.null & manual_done_at=is.null). Distinguish by URL.
    vi.stubGlobal("fetch", vi.fn(async (url: any) => {
      const u = String(url);
      const R = (d: any) => ({ ok: true, status: 200, json: async () => d, text: async () => JSON.stringify(d) });
      if (u.includes("/rest/v1/users")) return R([{ id: "u1" }]);
      if (u.includes("/rest/v1/assignments")) {
        if (u.includes("due_at=lt.") && u.includes("submitted_at=is.null")) {
          return R([{ id: "od1", course_id: "c1", title: "Overdue Essay", due_at: "2020-01-01T00:00:00Z", submitted_at: null, manual_done_at: null, courses: { name: "Bio" } }]);
        }
        return R([{ id: "a1", course_id: "c1", title: "Future HW", due_at: "2999-01-01T00:00:00Z", submitted_at: null, courses: { name: "Bio" } }]);
      }
      return R([]);
    }));
    const h = await load(); const res = makeRes();
    await h({ method: "POST", body: { action: "upcoming", userId: "u1" } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.assignments.map((a: any) => a.name)).toEqual(["Future HW"]);
    expect(res.body.overdueCount).toBe(1);
    expect(res.body.overdue[0]).toMatchObject({ name: "Overdue Essay", overdue: true });
  });

  it("upcoming/overdue treat manual_done_at (app-marked done) as submitted — regression: in-app completions must not resurface", async () => {
    // submitted_at is null (no Canvas submission) but the student marked it done in-app.
    stubFetch({
      assignments: [
        { id: "a1", course_id: "c1", title: "Still open",  due_at: "2999-01-01T00:00:00Z", submitted_at: null, manual_done_at: null,                    courses: { name: "Bio" } },
        { id: "a2", course_id: "c1", title: "Marked done",  due_at: "2999-01-02T00:00:00Z", submitted_at: null, manual_done_at: "2026-01-01T00:00:00Z", courses: { name: "Bio" } },
      ],
    });
    const h = await load();
    // Default upcoming: the app-completed one is hidden and flagged submitted.
    let res = makeRes();
    await h({ method: "POST", body: { action: "upcoming", userId: "u1" } }, res);
    expect(res.body.assignments.map((a: any) => a.name)).toEqual(["Still open"]);
    // status:'all' keeps it but marks submitted:true so the model knows it's done.
    res = makeRes();
    await h({ method: "POST", body: { action: "upcoming", userId: "u1", status: "all" } }, res);
    const done = res.body.assignments.find((a: any) => a.name === "Marked done");
    expect(done.submitted).toBe(true);
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

  it("upcoming (default) queries ONLY the future window — regression: overdue must not be the only thing reachable", async () => {
    const fn = stubFetch({ assignments: [] });
    const h = await load(); const res = makeRes();
    await h({ method: "POST", body: { action: "upcoming", userId: "u1" } }, res);
    const call = fn.mock.calls.find((c: any[]) => String(c[0]).includes("/rest/v1/assignments"))!;
    expect(String(call[0])).toContain("due_at=gte.");
    expect(String(call[0])).toContain("order=due_at.asc");
    expect(res.body.status).toBe("upcoming");
  });

  it("overdue: queries PAST-due work (due_at<now, most-recent first) — this is what surfaces real past-due items", async () => {
    const fn = stubFetch({ assignments: [] });
    const h = await load(); const res = makeRes();
    await h({ method: "POST", body: { action: "upcoming", userId: "u1", status: "overdue" } }, res);
    const u = String(fn.mock.calls.find((c: any[]) => String(c[0]).includes("/rest/v1/assignments"))![0]);
    expect(u).toContain("due_at=lt.");          // PAST due
    expect(u).toContain("order=due_at.desc");   // most recently due first
    expect(u).not.toContain("due_at=gte.");     // NOT the future window
    expect(res.body.status).toBe("overdue");
  });

  it("action:'overdue' is an alias for status:'overdue'", async () => {
    const fn = stubFetch({ assignments: [] });
    const h = await load(); const res = makeRes();
    await h({ method: "POST", body: { action: "overdue", userId: "u1" } }, res);
    const u = String(fn.mock.calls.find((c: any[]) => String(c[0]).includes("/rest/v1/assignments"))![0]);
    expect(u).toContain("due_at=lt.");
    expect(res.body.status).toBe("overdue");
  });

  it("overdue: returns past-due UNSUBMITTED work and always drops submitted (even with includeSubmitted)", async () => {
    stubFetch({ assignments: [
      { id: "a1", course_id: "c1", title: "Weekly Challenge hand in", due_at: "2020-01-01T00:00:00Z", submitted_at: null,                    courses: { name: "eom guidance" } },
      { id: "a2", course_id: "c1", title: "Late but turned in",       due_at: "2020-01-02T00:00:00Z", submitted_at: "2020-02-01T00:00:00Z", courses: { name: "eom guidance" } },
    ] });
    const h = await load(); const res = makeRes();
    await h({ method: "POST", body: { action: "upcoming", userId: "u1", status: "overdue", includeSubmitted: true } }, res);
    expect(res.body.assignments.map((a: any) => a.name)).toEqual(["Weekly Challenge hand in"]);
  });

  it("overdue with withinDays bounds the PAST horizon (due_at >= now-N days)", async () => {
    const fn = stubFetch({ assignments: [] });
    const h = await load(); const res = makeRes();
    await h({ method: "POST", body: { action: "upcoming", userId: "u1", status: "overdue", withinDays: 30 } }, res);
    const u = String(fn.mock.calls.find((c: any[]) => String(c[0]).includes("/rest/v1/assignments"))![0]);
    expect(u).toContain("due_at=lt.");    // upper bound = now
    expect(u).toContain("due_at=gte.");   // lower bound = now - 30d
  });

  it("status:'all' applies no due_at window", async () => {
    const fn = stubFetch({ assignments: [] });
    const h = await load(); const res = makeRes();
    await h({ method: "POST", body: { action: "upcoming", userId: "u1", status: "all" } }, res);
    const u = String(fn.mock.calls.find((c: any[]) => String(c[0]).includes("/rest/v1/assignments"))![0]);
    expect(u).not.toContain("due_at=");
    expect(res.body.status).toBe("all");
  });

  it("status:'all' KEEPS submitted assignments (regression: all must mean everything)", async () => {
    stubFetch({ assignments: [
      { id: "a1", course_id: "c1", title: "Done", due_at: "2020-01-01T00:00:00Z", submitted_at: "2020-02-01T00:00:00Z", courses: { name: "Bio" } },
      { id: "a2", course_id: "c1", title: "Not done", due_at: "2999-01-01T00:00:00Z", submitted_at: null, courses: { name: "Bio" } },
    ] });
    const h = await load(); const res = makeRes();
    await h({ method: "POST", body: { action: "upcoming", userId: "u1", status: "all" } }, res);
    expect(res.body.assignments.map((a: any) => a.name).sort()).toEqual(["Done", "Not done"]);
  });

  it("unknown action → 400", async () => {
    stubFetch();
    const h = await load(); const res = makeRes();
    await h({ method: "POST", body: { action: "nope", userId: "u1" } }, res);
    expect(res.statusCode).toBe(400);
  });
});

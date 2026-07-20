// @vitest-environment node
// F-5 regression: the Canvas→Brain-DB write is server-side, authenticated, and scopes person_id to
// the VERIFIED caller (never the request body). Auth uses the trusted in-process path
// (req.__internalUserId) so no JWT/Supabase client is needed. global.fetch is stubbed.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

function mockRes() {
  return { statusCode: 0, body: null as any, status(c: number) { this.statusCode = c; return this; }, json(o: any) { this.body = o; return this; } };
}

let handler: any;
let calls: { url: string; opts: any }[];

async function load() { return (await import("../api/brain-sync.ts")).default; }

beforeEach(async () => {
  process.env.SUPABASE_URL = "http://prod";
  process.env.SUPABASE_SERVICE_KEY = "prod-svc";
  process.env.BRAIN_SUPABASE_URL = "http://brain";
  process.env.BRAIN_SUPABASE_KEY = "brain-svc";
  calls = [];
  global.fetch = vi.fn(async (url: any, opts: any) => {
    calls.push({ url: String(url), opts });
    if (String(url).includes("/users?")) return { ok: true, json: async () => [{ brain_person_id: "person-XYZ" }] } as any;
    return { ok: true, json: async () => [] } as any; // brain writes
  }) as any;
  handler = await load();
});
afterEach(() => { vi.restoreAllMocks(); vi.resetModules(); });

describe("api/brain-sync (F-5)", () => {
  it("401s without authentication", async () => {
    const res = mockRes();
    await handler({ method: "POST", headers: {}, body: { courses: [] } }, res);
    expect(res.statusCode).toBe(401);
    expect(calls.length).toBe(0);
  });

  it("405s on non-POST", async () => {
    const res = mockRes();
    await handler({ method: "GET", headers: {}, __internalUserId: "u1", body: {} }, res);
    expect(res.statusCode).toBe(405);
  });

  it("degrades gracefully (ok:false, no brain write) when Brain env is unset", async () => {
    delete process.env.BRAIN_SUPABASE_URL;
    const res = mockRes();
    await handler({ method: "POST", headers: {}, __internalUserId: "u1", body: { courses: [{ id: 1, name: "x" }] } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(calls.some((c) => c.url.includes("fschool_"))).toBe(false);
  });

  it("writes under the SERVER-derived person_id and ignores a body-supplied person_id", async () => {
    const res = mockRes();
    await handler({ method: "POST", headers: {}, __internalUserId: "u1", body: {
      person_id: "ATTACKER", brainPersonId: "ATTACKER", // must be ignored
      courses: [{ id: 111, name: "Bio", courseCode: "BIO1", currentScore: 90 }],
      assignments: [{ id: 5, courseId: 111, name: "Lab", dueAt: "2026-07-01T00:00:00Z", submission: { score: 8, missing: false } }],
    } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);

    const courseWrite = calls.find((c) => c.url.includes("fschool_courses"))!;
    const courseRows = JSON.parse(courseWrite.opts.body);
    expect(courseRows[0].person_id).toBe("person-XYZ");   // server-derived
    expect(courseRows[0].person_id).not.toBe("ATTACKER");
    expect(courseWrite.opts.headers.Authorization).toContain("brain-svc"); // service key only server-side

    const assignWrite = calls.find((c) => c.url.includes("fschool_assignments"))!;
    expect(JSON.parse(assignWrite.opts.body)[0].person_id).toBe("person-XYZ");
  });

  it("no-ops when the caller has no brain_person_id (not linked)", async () => {
    global.fetch = vi.fn(async (url: any) =>
      String(url).includes("/users?")
        ? ({ ok: true, json: async () => [{ brain_person_id: null }] } as any)
        : ({ ok: true, json: async () => [] } as any)) as any;
    const res = mockRes();
    await handler({ method: "POST", headers: {}, __internalUserId: "u1", body: { courses: [{ id: 1, name: "x" }] } }, res);
    expect(res.body.ok).toBe(false);
    expect((global.fetch as any).mock.calls.some((c: any[]) => String(c[0]).includes("fschool_"))).toBe(false);
  });
});

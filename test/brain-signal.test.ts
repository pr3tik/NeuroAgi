// @vitest-environment node
// Unit test for api/brain-signal.ts → kernel remember(). Mocks fetch (no DB): asserts a signal
// is written under the caller's RESOLVED GLOBAL subject with the right kind/salience/body, and
// that an unauthenticated caller is rejected. Uses the in-process __internalUserId path (which a
// real HTTP request can never set) to authenticate without a live JWT.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const R = (data: any, ok = true, status = 200) => ({ ok, status, json: async () => data, text: async () => JSON.stringify(data) });
const makeRes = () => ({ statusCode: 0, body: null as any, status(c: number) { this.statusCode = c; return this; }, json(o: any) { this.body = o; return this; } });

beforeEach(() => { process.env.SUPABASE_URL = "http://localhost"; process.env.SUPABASE_SERVICE_KEY = "svc"; });
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

describe("brain-signal → kernel", () => {
  it("remembers a behavioral signal under the caller's global subject", async () => {
    let posted: any = null;
    vi.stubGlobal("fetch", vi.fn(async (url: any, init: any) => {
      const u = String(url);
      if (u.includes("/rest/v1/users") && u.includes("select=")) return R([{ email: "a@b.edu", name: "A", school: null, gpa: null, brain_person_id: "p1" }]);
      if (u.includes("/rest/v1/neuro_person_link")) return R([{ person_id: "p1" }]); // link fast path
      if (u.includes("/rest/v1/neuro_memory") && init?.method === "POST") { posted = JSON.parse(init.body); return R([{ id: "m1", ...posted }]); }
      return R([]);
    }));
    const h = (await import("../api/brain-signal.ts")).default;
    const res = makeRes();
    await h({ method: "POST", __internalUserId: "u1", body: { signalType: "behavioral", source: "fschoolai_chat", payload: { message_length: 42, emotional_tone: "stressed" } } }, res);
    expect(res.body).toMatchObject({ ok: true, id: "m1" });
    expect(posted.subject).toBe("person:p1");
    expect(posted.kind).toBe("signal");
    expect(posted.salience).toBeCloseTo(0.35, 5);
    expect(posted.body).toMatchObject({ signal_type: "behavioral", message_length: 42, emotional_tone: "stressed" });
  });

  it("rejects an unauthenticated caller with 401", async () => {
    const h = (await import("../api/brain-signal.ts")).default;
    const res = makeRes();
    await h({ method: "POST", headers: {}, body: { payload: {} } }, res);
    expect(res.statusCode).toBe(401);
  });
});

// @vitest-environment node
// Waitlist endpoint: join (insert/dedup/position), stats, admin invites (fail-closed),
// and the missing-migration error path. PostgREST count comes from content-range headers.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { makeRes } from "./helpers";

const sent: any[] = [];
vi.mock("resend", () => ({ Resend: class { emails = { send: vi.fn(async (m: any) => { sent.push(m); return {}; }) }; } }));

function R(data: any, opts: { ok?: boolean; status?: number; count?: number } = {}) {
  const { ok = true, status = 200, count } = opts;
  return {
    ok, status,
    json: async () => data,
    text: async () => JSON.stringify(data),
    headers: { get: (k: string) => (k.toLowerCase() === "content-range" && count != null ? `0-0/${count}` : null) },
  };
}

beforeEach(() => {
  process.env.SUPABASE_URL = "http://localhost";
  process.env.SUPABASE_SERVICE_KEY = "svc";
  process.env.RESEND_API_KEY = "re_test";
  process.env.CRON_SECRET = "cron-secret";
  sent.length = 0;
});
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

async function load() { return (await import("../api/waitlist.ts")).default; }

describe("waitlist join", () => {
  it("400 on invalid email", async () => {
    const h = await load(); const res = makeRes();
    await h({ method: "POST", query: { action: "join" }, body: { email: "not-an-email" }, headers: {} }, res);
    expect(res.statusCode).toBe(400);
  });

  it("inserts, computes position from content-range, sends the confirmation email", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: any, init: any) => {
      const u = String(url);
      if (u.includes("email=eq.")) return R([]);                                   // no dedup hit
      if (init?.method === "POST") return R([{ id: "w1", created_at: "2026-07-10T00:00:00Z" }]);
      if (u.includes("created_at=lte.")) return R([], { count: 42 });              // position
      return R([], { count: 137 });                                                // total
    }));
    const h = await load(); const res = makeRes();
    await h({ method: "POST", query: { action: "join" }, body: { email: "Stu@School.EDU", name: "Stu" }, headers: {} }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, alreadyJoined: false, position: 42, total: 137, emailSent: true });
    expect(sent[0].to).toBe("stu@school.edu");                                     // lowercased
    expect(sent[0].subject).toMatch(/#42/);
  });

  it("stamps location from Vercel geo headers onto the insert (city URI-decoded)", async () => {
    const bodies: any[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: any, init: any) => {
      const u = String(url);
      if (u.includes("email=eq.")) return R([]);
      if (init?.method === "POST" && u.includes("/waitlist")) {
        bodies.push(JSON.parse(init.body));
        return R([{ id: "w1", created_at: "2026-07-13T00:00:00Z" }]);
      }
      if (u.includes("created_at=lte.")) return R([], { count: 1 });
      return R([], { count: 1 });
    }));
    const h = await load(); const res = makeRes();
    await h({
      method: "POST", query: { action: "join" }, body: { email: "geo@school.edu" },
      headers: { "x-vercel-ip-country": "CA", "x-vercel-ip-country-region": "ON", "x-vercel-ip-city": "Waterloo%20North" },
    }, res);
    expect(res.statusCode).toBe(200);
    expect(bodies[0]).toMatchObject({ email: "geo@school.edu", country: "CA", region: "ON", city: "Waterloo North" });
  });

  it("geo columns not migrated yet → retries WITHOUT location; the join still succeeds", async () => {
    const bodies: any[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: any, init: any) => {
      const u = String(url);
      if (u.includes("email=eq.")) return R([]);
      if (init?.method === "POST" && u.includes("/waitlist")) {
        const body = JSON.parse(init.body);
        bodies.push(body);
        if ("country" in body) return R({ message: "Could not find the 'country' column of 'waitlist' in the schema cache" }, { ok: false, status: 400 });
        return R([{ id: "w1", created_at: "2026-07-13T00:00:00Z" }]);
      }
      if (u.includes("created_at=lte.")) return R([], { count: 1 });
      return R([], { count: 1 });
    }));
    const h = await load(); const res = makeRes();
    await h({
      method: "POST", query: { action: "join" }, body: { email: "geo2@school.edu" },
      headers: { "x-vercel-ip-country": "CA" },
    }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(bodies).toHaveLength(2);                 // geo attempt, then plain retry
    expect("country" in bodies[1]).toBe(false);
  });

  it("duplicate email → friendly alreadyJoined with the SAME position, no insert, no email", async () => {
    const posts: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: any, init: any) => {
      const u = String(url);
      if (init?.method === "POST") posts.push(u);
      if (u.includes("email=eq.")) return R([{ id: "w1", created_at: "2026-07-01T00:00:00Z", invited_at: null }]);
      if (u.includes("created_at=lte.")) return R([], { count: 7 });
      return R([], { count: 137 });
    }));
    const h = await load(); const res = makeRes();
    await h({ method: "POST", query: { action: "join" }, body: { email: "stu@school.edu" }, headers: {} }, res);
    expect(res.body).toMatchObject({ ok: true, alreadyJoined: true, position: 7 });
    expect(posts).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });

  it("missing table surfaces the migration hint, not a fake success", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => R({ code: "PGRST205" }, { ok: false, status: 404 })));
    const h = await load(); const res = makeRes();
    await h({ method: "POST", query: { action: "join" }, body: { email: "stu@school.edu" }, headers: {} }, res);
    expect(res.statusCode).toBe(502);
    expect(res.body.error).toMatch(/migration/i);
  });
});

describe("waitlist stats + invites", () => {
  it("stats returns the public total", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => R([], { count: 512 })));
    const h = await load(); const res = makeRes();
    await h({ method: "GET", query: { action: "stats" }, headers: {} }, res);
    expect(res.body).toEqual({ total: 512 });
  });

  it("invite is fail-closed: 401 without the secret", async () => {
    const h = await load(); const res = makeRes();
    await h({ method: "POST", query: { action: "invite" }, body: { emails: ["stu@school.edu"] }, headers: {} }, res);
    expect(res.statusCode).toBe(401);
  });

  it("invite sends the ?invite=<id> link and stamps invited_at", async () => {
    const patches: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: any, init: any) => {
      const u = String(url);
      if (init?.method === "PATCH") { patches.push(u); return R([]); }
      if (u.includes("email=eq.stu")) return R([{ id: "w-abc", invited_at: null }]);
      if (u.includes("email=eq.ghost")) return R([]);
      return R([]);
    }));
    const h = await load(); const res = makeRes();
    await h({
      method: "POST", query: { action: "invite" },
      body: { emails: ["stu@school.edu", "ghost@school.edu"] },
      headers: { authorization: "Bearer cron-secret", host: "fschoolai.com" },
    }, res);
    expect(res.body.invited).toBe(1);
    expect(res.body.results).toEqual([
      expect.objectContaining({ email: "stu@school.edu", ok: true }),
      expect.objectContaining({ email: "ghost@school.edu", ok: false, reason: "not on the waitlist" }),
    ]);
    expect(sent[0].html).toContain("/?invite=w-abc");
    expect(patches[0]).toContain("id=eq.w-abc");
  });
});

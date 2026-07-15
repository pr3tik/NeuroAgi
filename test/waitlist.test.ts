// @vitest-environment node
// Waitlist endpoint: join (insert/dedup/position), stats, admin invites (fail-closed),
// and the missing-migration error path. PostgREST count comes from content-range headers.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import { makeRes } from "./helpers";

const sent: any[] = [];
vi.mock("resend", () => ({ Resend: class { emails = { send: vi.fn(async (m: any) => { sent.push(m); return {}; }) }; } }));
vi.mock("../api/_ratelimit.ts", () => ({ rateLimit: async () => true }));   // no-op limiter in tests (its rpc would add a stray POST)

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

  it("inserts UNVERIFIED and sends a verification email (no position, not counted yet)", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: any, init: any) => {
      const u = String(url);
      if (u.includes("email=eq.")) return R([]);                                   // no dedup hit
      if (init?.method === "POST") return R([{ id: "w1", created_at: "2026-07-10T00:00:00Z" }]);
      return R([], { count: 0 });
    }));
    const h = await load(); const res = makeRes();
    await h({ method: "POST", query: { action: "join" }, body: { email: "Stu@School.EDU", name: "Stu" }, headers: {} }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, alreadyJoined: false, needsVerification: true, pending: true, emailSent: true });
    expect(res.body.position).toBeUndefined();                                     // no position until verified
    expect(sent).toHaveLength(1);                                                  // ONLY the verification email
    expect(sent[0].to).toBe("stu@school.edu");                                     // lowercased
    expect(sent[0].subject).toMatch(/confirm/i);
    expect(sent[0].html).toContain("action=verify&token=w1.");                     // signed verify link for this row
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

  it("ignores a forged x-forwarded-host in the verification link (no branded-email open redirect)", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: any, init: any) => {
      const u = String(url);
      if (u.includes("email=eq.")) return R([]);
      if (init?.method === "POST") return R([{ id: "w1", created_at: "2026-07-10T00:00:00Z" }]);
      return R([], { count: 0 });
    }));
    const h = await load(); const res = makeRes();
    await h({ method: "POST", query: { action: "join" }, body: { email: "stu@school.edu" }, headers: { "x-forwarded-host": "evil.com" } }, res);
    expect(sent[0].html).toContain("https://fschoolai.com/api/waitlist?action=verify");
    expect(sent[0].html).not.toContain("evil.com");
  });

  it("duplicate VERIFIED email → alreadyJoined with the SAME position, no insert, no email", async () => {
    const posts: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: any, init: any) => {
      const u = String(url);
      if (init?.method === "POST") posts.push(u);
      if (u.includes("email=eq.")) return R([{ id: "w1", created_at: "2026-07-01T00:00:00Z", invited_at: null, verified_at: "2026-07-02T00:00:00Z" }]);
      if (u.includes("created_at=lte.")) return R([], { count: 7 });
      return R([], { count: 137 });
    }));
    const h = await load(); const res = makeRes();
    await h({ method: "POST", query: { action: "join" }, body: { email: "stu@school.edu" }, headers: {} }, res);
    expect(res.body).toMatchObject({ ok: true, alreadyJoined: true, verified: true, position: 7 });
    expect(posts).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });

  it("duplicate UNVERIFIED email → re-sends the verification link, stays pending, no insert", async () => {
    const posts: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: any, init: any) => {
      const u = String(url);
      if (init?.method === "POST") posts.push(u);
      if (u.includes("email=eq.")) return R([{ id: "w9", created_at: "2026-07-01T00:00:00Z", invited_at: null, verified_at: null }]);
      return R([], { count: 0 });
    }));
    const h = await load(); const res = makeRes();
    await h({ method: "POST", query: { action: "join" }, body: { email: "stu@school.edu" }, headers: {} }, res);
    expect(res.body).toMatchObject({ ok: true, alreadyJoined: false, needsVerification: true, resent: true });
    expect(posts).toHaveLength(0);                                   // no new row
    expect(sent).toHaveLength(1);                                    // re-sent verification
    expect(sent[0].html).toContain("action=verify&token=w9.");
  });

  it("missing table surfaces the migration hint, not a fake success", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => R({ code: "PGRST205" }, { ok: false, status: 404 })));
    const h = await load(); const res = makeRes();
    await h({ method: "POST", query: { action: "join" }, body: { email: "stu@school.edu" }, headers: {} }, res);
    expect(res.statusCode).toBe(502);
    expect(res.body.error).toMatch(/migration/i);
  });
});

describe("waitlist verify", () => {
  const token = (id: string, exp: number) => `${id}.${exp}.${createHmac("sha256", "svc").update(`${id}.${exp}`).digest("base64url")}`;

  it("valid token stamps verified_at (idempotent guard), sends the #position email, redirects", async () => {
    const patches: any[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: any, init: any) => {
      const u = String(url);
      if (init?.method === "PATCH") { patches.push({ u, body: JSON.parse(init.body) }); return R([{ id: "w1" }]); } // representation: we flipped it
      if (u.includes("id=eq.w1") && u.includes("select=")) return R([{ id: "w1", email: "stu@school.edu", name: "Stu", created_at: "2026-07-01T00:00:00Z", verified_at: null }]);
      if (u.includes("created_at=lte.")) return R([], { count: 5 });               // verified-only position
      return R([], { count: 90 });                                                 // verified-only total
    }));
    const h = await load(); const res = makeRes();
    await h({ method: "GET", query: { action: "verify", token: token("w1", Date.now() + 60000) }, headers: { host: "fschoolai.com" } }, res);
    expect(res.statusCode).toBe(302);
    expect(res.headers.Location).toContain("/?verified=1&pos=5");
    expect(patches[0].u).toContain("verified_at=is.null");                         // only-if-null (idempotent)
    expect(patches[0].body).toHaveProperty("verified_at");
    expect(sent.some(m => /#5/.test(m.subject))).toBe(true);                       // position confirmation
    expect(sent.some(m => m.to === "vincent@fschoolai.com")).toBe(true);           // internal notify (verified only)
  });

  it("bad/expired token → friendly HTML page, not a crash or JSON", async () => {
    const h = await load(); const res = makeRes();
    await h({ method: "GET", query: { action: "verify", token: "garbage" }, headers: { host: "fschoolai.com" } }, res);
    expect(res.statusCode).toBe(200);
    expect(String(res.body)).toMatch(/expired/i);
    expect(sent).toHaveLength(0);
  });

  it("forged signature is rejected (can't self-verify without the secret)", async () => {
    const h = await load(); const res = makeRes();
    await h({ method: "GET", query: { action: "verify", token: `w1.${Date.now() + 60000}.forgedsig` }, headers: { host: "fschoolai.com" } }, res);
    expect(res.statusCode).toBe(200);
    expect(String(res.body)).toMatch(/expired/i);
  });

  it("already-verified row is idempotent — no duplicate emails", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: any, init: any) => {
      const u = String(url);
      if (init?.method === "PATCH") return R([]);
      if (u.includes("id=eq.w1") && u.includes("select=")) return R([{ id: "w1", email: "stu@school.edu", name: null, created_at: "2026-07-01T00:00:00Z", verified_at: "2026-07-02T00:00:00Z" }]);
      if (u.includes("created_at=lte.")) return R([], { count: 5 });
      return R([], { count: 90 });
    }));
    const h = await load(); const res = makeRes();
    await h({ method: "GET", query: { action: "verify", token: token("w1", Date.now() + 60000) }, headers: { host: "fschoolai.com" } }, res);
    expect(res.statusCode).toBe(302);
    expect(sent).toHaveLength(0);                                                  // already verified → nothing re-sent
  });

  it("concurrent verify — PATCH flips 0 rows (lost the race to a prefetch) → no duplicate email", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: any, init: any) => {
      const u = String(url);
      if (init?.method === "PATCH") return R([]);                                  // another request already flipped it
      if (u.includes("id=eq.w1") && u.includes("select=")) return R([{ id: "w1", email: "stu@school.edu", name: null, created_at: "2026-07-01T00:00:00Z", verified_at: null }]);
      if (u.includes("created_at=lte.")) return R([], { count: 5 });
      return R([], { count: 90 });
    }));
    const h = await load(); const res = makeRes();
    await h({ method: "GET", query: { action: "verify", token: token("w1", Date.now() + 60000) }, headers: { host: "fschoolai.com" } }, res);
    expect(res.statusCode).toBe(302);                                             // still redirects to success
    expect(sent).toHaveLength(0);                                                 // the racing request emailed, not this one
  });
});

describe("waitlist stats + invites", () => {
  it("stats counts VERIFIED members only", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: any) => { urls.push(String(url)); return R([], { count: 512 }); }));
    const h = await load(); const res = makeRes();
    await h({ method: "GET", query: { action: "stats" }, headers: {} }, res);
    expect(res.body).toEqual({ total: 512 });
    expect(urls[0]).toContain("verified_at=not.is.null");                          // spam/unverified excluded
  });

  it("verify-blast is fail-closed: 401 without the secret", async () => {
    const h = await load(); const res = makeRes();
    await h({ method: "POST", query: { action: "verify-blast" }, headers: {} }, res);
    expect(res.statusCode).toBe(401);
  });

  it("verify-blast sends a link to each un-emailed unverified row + stamps verification_sent_at", async () => {
    const patches: any[] = [];
    let readCount = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: any, init: any) => {
      const u = String(url);
      if (init?.method === "PATCH") { patches.push({ u, body: JSON.parse(init.body) }); return R([]); }
      // first read = the batch of unverified+unsent rows; count read = remaining
      if (u.includes("verified_at=is.null") && u.includes("verification_sent_at=is.null")) {
        if (u.includes("select=id&") || /Range/.test(JSON.stringify(init?.headers || {}))) return R([], { count: 0 });
        if (readCount++ === 0) return R([{ id: "w1", email: "a@x.edu", name: "A" }, { id: "w2", email: "b@x.edu", name: null }]);
        return R([], { count: 0 });
      }
      return R([]);
    }));
    const h = await load(); const res = makeRes();
    await h({ method: "POST", query: { action: "verify-blast" }, headers: { authorization: "Bearer cron-secret", host: "fschoolai.com" } }, res);
    expect(res.body).toMatchObject({ ok: true, sent: 2, remaining: 0 });
    expect(sent).toHaveLength(2);
    expect(sent.every(m => /confirm/i.test(m.subject))).toBe(true);
    expect(sent[0].html).toContain("action=verify&token=w1.");
    expect(sent.some(m => /removed from the list/i.test(m.html))).toBe(true);   // the warning copy
    expect(patches.every(p => "verification_sent_at" in p.body)).toBe(true);    // clock stamped after send
    expect(patches).toHaveLength(2);
  });

  it("purge-unverified is fail-closed + issues ONE filtered DELETE (verified null, sent, past window)", async () => {
    let delUrl = "";
    vi.stubGlobal("fetch", vi.fn(async (url: any, init: any) => {
      if (init?.method === "DELETE") { delUrl = String(url); return R([{ id: "old1" }, { id: "old2" }]); }
      return R([]);
    }));
    const h1 = await load(); const res1 = makeRes();
    await h1({ method: "POST", query: { action: "purge-unverified" }, headers: {} }, res1);
    expect(res1.statusCode).toBe(401);                                          // fail-closed

    const h = await load(); const res = makeRes();
    await h({ method: "POST", query: { action: "purge-unverified" }, headers: { authorization: "Bearer cron-secret" } }, res);
    expect(res.body).toMatchObject({ ok: true, removed: 2 });
    expect(delUrl).toContain("verified_at=is.null");
    expect(delUrl).toContain("verification_sent_at=not.is.null");
    expect(delUrl).toContain("verification_sent_at=lt.");                       // only past the window
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
      if (u.includes("email=eq.stu")) return R([{ id: "w-abc", invited_at: null, verified_at: "2026-07-02T00:00:00Z" }]);
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

  it("invite skips UNVERIFIED rows — verified before eligible", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: any, init: any) => {
      const u = String(url);
      if (init?.method === "PATCH") return R([]);
      if (u.includes("email=eq.pending")) return R([{ id: "w-x", invited_at: null, verified_at: null }]);
      return R([]);
    }));
    const h = await load(); const res = makeRes();
    await h({
      method: "POST", query: { action: "invite" }, body: { emails: ["pending@school.edu"] },
      headers: { authorization: "Bearer cron-secret", host: "fschoolai.com" },
    }, res);
    expect(res.body.invited).toBe(0);
    expect(res.body.results[0]).toMatchObject({ email: "pending@school.edu", ok: false, reason: "not verified" });
    expect(sent).toHaveLength(0);
  });
});

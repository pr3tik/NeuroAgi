// @vitest-environment node
// requireUser(): verifies the caller's JWT (Authorization: Bearer) via GoTrue and maps it to
// the app profile id. Supabase is mocked so no client is built for real.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

let getUserImpl: (t: string) => any;
let authRows: any[];      // rows for the .eq("auth_id",…) lookup
let emailRows: any[];     // rows for the .ilike("email",…) lazy-link lookup
let updates: any[];       // captured .update().eq() writes (the lazy-link)

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: { getUser: (t: string) => getUserImpl(t) },
    from: () => {
      const st: any = { op: "select" };
      const chain: any = {
        select: () => chain,
        update: (v: any) => { st.op = "update"; st.val = v; return chain; },
        eq: (_c: string, v: any) => { if (st.op === "update") { updates.push({ val: st.val, id: v }); return Promise.resolve({ error: null }); } return chain; },
        ilike: () => { st.ilike = true; return chain; },
        limit: async () => (st.ilike ? { data: emailRows } : { data: authRows }),
      };
      return chain;
    },
  }),
}));

beforeEach(() => {
  process.env.SUPABASE_URL = "http://localhost";
  process.env.SUPABASE_SERVICE_KEY = "svc";
  getUserImpl = async () => ({ data: { user: null }, error: { message: "no session" } });
  authRows = []; emailRows = []; updates = [];
});
afterEach(() => { vi.resetModules(); });

async function load() { return await import("../api/_auth.ts"); }

describe("requireUser", () => {
  it("null without an Authorization header", async () => {
    const { requireUser } = await load();
    expect(await requireUser({ headers: {} })).toBeNull();
  });

  it("null on an invalid/expired token", async () => {
    getUserImpl = async () => ({ data: { user: null }, error: { message: "bad jwt" } });
    const { requireUser } = await load();
    expect(await requireUser({ headers: { authorization: "Bearer bad" } })).toBeNull();
  });

  it("resolves a valid token to the caller's profile id", async () => {
    getUserImpl = async () => ({ data: { user: { id: "auth-123" } }, error: null });
    authRows = [{ id: "profile-abc" }];
    const { requireUser } = await load();
    expect(await requireUser({ headers: { authorization: "Bearer good" } })).toEqual({ userId: "profile-abc", authId: "auth-123" });
  });

  it("null when the verified auth user has no linked profile (and no email to link by)", async () => {
    getUserImpl = async () => ({ data: { user: { id: "auth-x" } }, error: null });
    authRows = [];
    const { requireUser } = await load();
    expect(await requireUser({ headers: { authorization: "Bearer good" } })).toBeNull();
  });

  it("lazy-links a legacy account (valid JWT, unlinked email row) and returns its id", async () => {
    getUserImpl = async () => ({ data: { user: { id: "auth-new", email: "legacy@school.edu" } }, error: null });
    authRows = [];                                            // nothing linked to auth-new yet
    emailRows = [{ id: "legacy-profile", auth_id: null }];    // an unlinked row for that email
    const { requireUser } = await load();
    expect(await requireUser({ headers: { authorization: "Bearer good" } })).toEqual({ userId: "legacy-profile", authId: "auth-new" });
    expect(updates).toEqual([{ val: { auth_id: "auth-new" }, id: "legacy-profile" }]);   // it linked
  });

  it("does NOT steal an email row already linked to a DIFFERENT auth_id (no takeover)", async () => {
    getUserImpl = async () => ({ data: { user: { id: "auth-attacker", email: "victim@school.edu" } }, error: null });
    authRows = [];
    emailRows = [{ id: "victim-profile", auth_id: "auth-victim" }];   // belongs to someone else
    const { requireUser } = await load();
    expect(await requireUser({ headers: { authorization: "Bearer good" } })).toBeNull();  // refused
    expect(updates).toEqual([]);                                                          // no write
  });

  // ── Verified-token cache (latency): two network round trips per call, on the hot path of
  // every chat turn. Memoized per token — but never at the cost of correctness.
  it("memoizes a verified token so repeat calls skip the GoTrue round trip", async () => {
    let hits = 0;
    getUserImpl = async () => { hits++; return { data: { user: { id: "auth-123" } }, error: null }; };
    authRows = [{ id: "profile-abc" }];
    const { requireUser } = await load();
    const req = { headers: { authorization: "Bearer good" } };
    expect(await requireUser(req)).toEqual({ userId: "profile-abc", authId: "auth-123" });
    expect(await requireUser(req)).toEqual({ userId: "profile-abc", authId: "auth-123" });
    expect(hits).toBe(1);
  });

  it("never serves a different token from the cache", async () => {
    getUserImpl = async (t: string) => ({ data: { user: { id: `auth-${t}` } }, error: null });
    authRows = [{ id: "profile-abc" }];
    const { requireUser } = await load();
    expect((await requireUser({ headers: { authorization: "Bearer aaa" } }))!.authId).toBe("auth-aaa");
    expect((await requireUser({ headers: { authorization: "Bearer bbb" } }))!.authId).toBe("auth-bbb");
  });

  it("does not cache failures — a just-linked account isn't locked out", async () => {
    getUserImpl = async () => ({ data: { user: { id: "auth-123" } }, error: null });
    authRows = [];                                   // no profile linked yet
    const { requireUser } = await load();
    const req = { headers: { authorization: "Bearer good" } };
    expect(await requireUser(req)).toBeNull();
    authRows = [{ id: "profile-abc" }];              // the row appears (backfill/link)
    expect(await requireUser(req)).toEqual({ userId: "profile-abc", authId: "auth-123" });
  });

  it("never serves a token past its own exp, even inside the TTL", async () => {
    getUserImpl = async () => ({ data: { user: { id: "auth-123" } }, error: null });
    authRows = [{ id: "profile-abc" }];
    const { requireUser } = await load();
    // A well-formed JWT whose exp is already in the past. GoTrue would reject it; the point
    // here is that the CACHE must not extend its life either.
    const b64 = (o: any) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const expired = `h.${b64({ exp: Math.floor(Date.now() / 1000) - 10 })}.s`;
    const req = { headers: { authorization: `Bearer ${expired}` } };
    let hits = 0;
    getUserImpl = async () => { hits++; return { data: { user: { id: "auth-123" } }, error: null }; };
    await requireUser(req);
    await requireUser(req);
    expect(hits).toBe(2);   // re-verified every time; the expired token was never cached
  });

  it("AUTH_CACHE_TTL_MS=0 disables the cache entirely", async () => {
    process.env.AUTH_CACHE_TTL_MS = "0";
    let hits = 0;
    getUserImpl = async () => { hits++; return { data: { user: { id: "auth-123" } }, error: null }; };
    authRows = [{ id: "profile-abc" }];
    const { requireUser } = await load();
    const req = { headers: { authorization: "Bearer good" } };
    await requireUser(req);
    await requireUser(req);
    expect(hits).toBe(2);
    delete process.env.AUTH_CACHE_TTL_MS;
  });

  it("requireUserOr401 sends 401 when unauthenticated", async () => {
    const { requireUserOr401 } = await load();
    const res: any = { statusCode: 0, body: null, status(c: number) { this.statusCode = c; return this; }, json(o: any) { this.body = o; return this; } };
    const r = await requireUserOr401({ headers: {} }, res);
    expect(r).toBeNull();
    expect(res.statusCode).toBe(401);
  });
});

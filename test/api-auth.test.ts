// @vitest-environment node
// requireUser(): verifies the caller's JWT (Authorization: Bearer) via GoTrue and maps it to
// the app profile id. Supabase is mocked so no client is built for real.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

let getUserImpl: (t: string) => any;
let usersRows: any[];

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: { getUser: (t: string) => getUserImpl(t) },
    from: () => ({ select: () => ({ eq: () => ({ limit: async () => ({ data: usersRows }) }) }) }),
  }),
}));

beforeEach(() => {
  process.env.SUPABASE_URL = "http://localhost";
  process.env.SUPABASE_SERVICE_KEY = "svc";
  getUserImpl = async () => ({ data: { user: null }, error: { message: "no session" } });
  usersRows = [];
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
    usersRows = [{ id: "profile-abc" }];
    const { requireUser } = await load();
    expect(await requireUser({ headers: { authorization: "Bearer good" } })).toEqual({ userId: "profile-abc", authId: "auth-123" });
  });

  it("null when the verified auth user has no linked profile", async () => {
    getUserImpl = async () => ({ data: { user: { id: "auth-x" } }, error: null });
    usersRows = [];
    const { requireUser } = await load();
    expect(await requireUser({ headers: { authorization: "Bearer good" } })).toBeNull();
  });

  it("requireUserOr401 sends 401 when unauthenticated", async () => {
    const { requireUserOr401 } = await load();
    const res: any = { statusCode: 0, body: null, status(c: number) { this.statusCode = c; return this; }, json(o: any) { this.body = o; return this; } };
    const r = await requireUserOr401({ headers: {} }, res);
    expect(r).toBeNull();
    expect(res.statusCode).toBe(401);
  });
});

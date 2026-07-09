// @vitest-environment node
// Password-reset flow regression tests (user report: "reset password doesn't work").
// The flow used to piggyback on email_verify_token, so a reset request KILLED a pending
// verification link (and vice versa) — now it uses the dedicated reset_token columns.
// Covers: token minting, confirm-redirect validation + expiry, the final password set
// (GoTrue) + token burn, and the no-collision guarantee.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { makeRes } from "./helpers";

// Stateful fake supabase client: routes .from(table) chains through `router`,
// records update payloads, and exposes auth.admin fns for auth-migrate.
const { fake } = vi.hoisted(() => {
  const fake: any = { rows: {}, updates: [], auth: null };
  const client = {
    from(table: string) {
      const ctx: any = { table, op: "select", payload: null, filters: {} };
      const chain: any = {
        select() { ctx.op = "select"; return chain; },
        update(payload: any) { ctx.op = "update"; ctx.payload = payload; return chain; },
        eq(col: string, val: any) { ctx.filters[col] = val; return chain; },
        maybeSingle: async () => ({ data: fake.rows[ctx.table] ?? null, error: null }),
        then(resolve: any) {          // awaited update chains resolve here
          if (ctx.op === "update") fake.updates.push({ table: ctx.table, payload: ctx.payload, filters: ctx.filters });
          resolve({ data: null, error: null });
        },
      };
      return chain;
    },
    auth: {
      admin: {
        updateUserById: vi.fn(async () => ({ data: {}, error: null })),
        createUser: vi.fn(async () => ({ data: { user: { id: "auth-new" } }, error: null })),
      },
      getUser: vi.fn(async () => ({ data: { user: null }, error: null })),
    },
  };
  fake.client = client;
  return { fake };
});
vi.mock("@supabase/supabase-js", () => ({ createClient: () => fake.client }));
vi.mock("resend", () => ({ Resend: class { emails = { send: vi.fn(async () => ({})) }; } }));

function resWithRedirect() {
  const res: any = makeRes();
  res.redirects = [];
  res.redirect = (loc: string) => { res.redirects.push(loc); return res; };
  res.send = (body: any) => { res.body = body; return res; };
  return res;
}

beforeEach(() => {
  process.env.SUPABASE_URL = "http://localhost";
  process.env.SUPABASE_SERVICE_KEY = "svc";
  process.env.RESEND_API_KEY = "re_test";
  fake.rows = {}; fake.updates = [];
  fake.client.auth.admin.updateUserById.mockClear();
  fake.client.auth.admin.createUser.mockClear();
});
afterEach(() => vi.resetModules());

const FUTURE = new Date(Date.now() + 30 * 60 * 1000).toISOString();
const PAST   = new Date(Date.now() - 5 * 60 * 1000).toISOString();

describe("email?action=reset (mint)", () => {
  it("mints reset_token + expiry and NEVER touches email_verify_token (collision regression)", async () => {
    fake.rows.users = { id: "u1", name: "Sam" };
    const h = (await import("../api/email.ts")).default;
    const res = resWithRedirect();
    await h({ method: "POST", query: { action: "reset" }, body: { email: "sam@x.edu" }, headers: {} }, res);
    expect(res.statusCode).toBe(200);
    const upd = fake.updates.find(u => u.table === "users")!;
    expect(upd.payload.reset_token).toBeTruthy();
    expect(upd.payload.reset_token_expires_at).toBeTruthy();
    expect(upd.payload).not.toHaveProperty("email_verify_token");   // the old collision
    expect(upd.payload).not.toHaveProperty("email_verify_sent_at");
  });

  it("anti-enumeration: unknown email still returns 200 with no update", async () => {
    fake.rows.users = null;
    const h = (await import("../api/email.ts")).default;
    const res = resWithRedirect();
    await h({ method: "POST", query: { action: "reset" }, body: { email: "ghost@x.edu" }, headers: {} }, res);
    expect(res.statusCode).toBe(200);
    expect(fake.updates).toHaveLength(0);
  });
});

describe("email?action=reset-confirm (link click)", () => {
  it("valid unexpired token → redirects into the SPA form", async () => {
    fake.rows.users = { id: "u1", reset_token: "tok1", reset_token_expires_at: FUTURE };
    const h = (await import("../api/email.ts")).default;
    const res = resWithRedirect();
    await h({ method: "GET", query: { action: "reset-confirm", token: "tok1", userId: "u1" }, headers: {} }, res);
    expect(res.redirects[0]).toBe("/?reset=confirm&token=tok1&userId=u1");
  });

  it("wrong or missing token → /?reset=error ; expired → /?reset=expired", async () => {
    const h = (await import("../api/email.ts")).default;
    fake.rows.users = { id: "u1", reset_token: "tok1", reset_token_expires_at: FUTURE };
    let res = resWithRedirect();
    await h({ method: "GET", query: { action: "reset-confirm", token: "WRONG", userId: "u1" }, headers: {} }, res);
    expect(res.redirects[0]).toBe("/?reset=error");

    fake.rows.users = { id: "u1", reset_token: "tok1", reset_token_expires_at: PAST };
    res = resWithRedirect();
    await h({ method: "GET", query: { action: "reset-confirm", token: "tok1", userId: "u1" }, headers: {} }, res);
    expect(res.redirects[0]).toBe("/?reset=expired");

    fake.rows.users = { id: "u1", reset_token: null, reset_token_expires_at: null };
    res = resWithRedirect();
    await h({ method: "GET", query: { action: "reset-confirm", token: "tok1", userId: "u1" }, headers: {} }, res);
    expect(res.redirects[0]).toBe("/?reset=error");   // burned/absent token can't be reused
  });
});

describe("auth-migrate?action=reset (set the password)", () => {
  it("valid token → GoTrue password update + burns reset_token", async () => {
    fake.rows.users = { id: "u1", email: "sam@x.edu", auth_id: "auth-1", reset_token: "tok1", reset_token_expires_at: FUTURE };
    const h = (await import("../api/auth-migrate.ts")).default;
    const res = makeRes();
    await h({ method: "POST", query: { action: "reset" }, body: { userId: "u1", token: "tok1", password: "newpw123" }, headers: {} }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true });
    expect(fake.client.auth.admin.updateUserById).toHaveBeenCalledWith("auth-1", { password: "newpw123" });
    const burn = fake.updates.find(u => u.table === "users" && u.payload.reset_token === null)!;
    expect(burn.payload.reset_token_expires_at).toBeNull();
  });

  it("expired or mismatched token → 401, no GoTrue call", async () => {
    const h = (await import("../api/auth-migrate.ts")).default;
    fake.rows.users = { id: "u1", email: "sam@x.edu", auth_id: "auth-1", reset_token: "tok1", reset_token_expires_at: PAST };
    let res = makeRes();
    await h({ method: "POST", query: { action: "reset" }, body: { userId: "u1", token: "tok1", password: "x".repeat(8) }, headers: {} }, res);
    expect(res.statusCode).toBe(401);

    fake.rows.users = { id: "u1", email: "sam@x.edu", auth_id: "auth-1", reset_token: "tok1", reset_token_expires_at: FUTURE };
    res = makeRes();
    await h({ method: "POST", query: { action: "reset" }, body: { userId: "u1", token: "WRONG", password: "x".repeat(8) }, headers: {} }, res);
    expect(res.statusCode).toBe(401);
    expect(fake.client.auth.admin.updateUserById).not.toHaveBeenCalled();
  });

  it("unmigrated account (no auth_id) → creates + links the GoTrue user", async () => {
    fake.rows.users = { id: "u1", email: "sam@x.edu", auth_id: null, reset_token: "tok1", reset_token_expires_at: FUTURE };
    const h = (await import("../api/auth-migrate.ts")).default;
    const res = makeRes();
    await h({ method: "POST", query: { action: "reset" }, body: { userId: "u1", token: "tok1", password: "newpw123" }, headers: {} }, res);
    expect(res.statusCode).toBe(200);
    expect(fake.client.auth.admin.createUser).toHaveBeenCalledWith({ email: "sam@x.edu", password: "newpw123", email_confirm: true });
    expect(fake.updates.some(u => u.payload.auth_id === "auth-new")).toBe(true);
  });
});

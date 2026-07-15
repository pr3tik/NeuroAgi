// @vitest-environment node
// Regression tests for the bugs found by the live tool-contracts curl sweep
// (2026-07-08): every case here reproduced against real endpoints before the fix.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../api/_auth.ts", () => ({
  requireUser: async (req) => { const id = req?.__internalUserId ?? req?.body?.userId ?? req?.body?.fromUserId ?? req?.query?.userId; return id ? { userId: String(id), authId: "test" } : null; },
  requireUserOr401: async (req, res) => { const id = req?.__internalUserId ?? req?.body?.userId ?? req?.body?.fromUserId ?? req?.query?.userId; if (!id) { res?.status?.(401)?.json?.({ error: "auth required" }); return null; } return String(id); },
}));

import { makeRes, makeSupabaseMock } from "./helpers";

const R = (data: any, ok = true, status = 200) => ({ ok, status, json: async () => data, text: async () => JSON.stringify(data) });

// Top-level mock (vi.mock must not live inside a describe): nudge.ts imports
// supabase-js; give it a chainable in-memory client so the handler runs on Node 20.
const { supa } = vi.hoisted(() => ({ supa: { current: null as any } }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => supa.current.client }));

beforeEach(() => {
  process.env.SUPABASE_URL = "http://localhost";
  process.env.SUPABASE_SERVICE_KEY = "svc";
});
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

// ── brain-person-link: users select must not reference nonexistent created_at ──
// (Live failure: PostgREST 42703 "column users.created_at does not exist" → every
// prod link attempt returned {ok:false, reason:"user fetch failed"}.)
describe("brain-person-link users query (42703 regression)", () => {
  it("selects only real columns and links successfully", async () => {
    process.env.BRAIN_SUPABASE_URL = "http://brain";
    process.env.BRAIN_SUPABASE_KEY = "bkey";
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: any) => {
      const u = String(url); calls.push(u);
      if (u.startsWith("http://localhost/rest/v1/users") && u.includes("select="))
        return R([{ id: "u1", name: "Sam", email: "s@x.edu", school: null, gpa: null, brain_person_id: "bp-1" }]);
      return R([]);
    }));
    const h = (await import("../api/brain-person-link.ts")).default;
    const res = makeRes();
    await h({ method: "POST", body: { userId: "u1" } }, res);
    expect(res.body).toMatchObject({ ok: true, brain_person_id: "bp-1", created: false });
    const usersCall = calls.find((u) => u.includes("/rest/v1/users"))!;
    expect(usersCall).not.toContain("created_at");   // the column that 42703'd prod
  });
});

// ── nudge: must be import-safe + work without RESEND_API_KEY ──
// (Live failure: module-load `new Resend(undefined)` threw → 502 on EVERY request,
// including plain validation, even though the in-app nudge needs no email.)
describe("nudge without RESEND_API_KEY (module-load Resend regression)", () => {
  beforeEach(() => {
    supa.current = makeSupabaseMock((ctx: any) => {
      if (ctx.table === "nudges" && ctx.op === "select") return { data: null, error: null, count: 0 };
      return { data: null, error: null };
    });
  });

  it("validation paths return 400 (not 502)", async () => {
    delete process.env.RESEND_API_KEY;
    const h = (await import("../api/nudge.ts")).default;
    let res = makeRes();
    await h({ method: "POST", body: {} }, res);
    expect(res.statusCode).toBe(401);                 // no caller identity → auth is the first gate
    res = makeRes();
    await h({ method: "POST", body: { fromUserId: "a", toUserId: "a" } }, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/yourself/);
  });

  it("in-app nudge succeeds with emailSent:false when email isn't configured", async () => {
    delete process.env.RESEND_API_KEY;
    const h = (await import("../api/nudge.ts")).default;
    const res = makeRes();
    await h({ method: "POST", body: { fromUserId: "a", toUserId: "b", recipientOnline: false } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ sent: true, emailSent: false });
  });
});

// ── self-write: "NO_UPDATE\n\n<reasoning>" must NOT be written as a mind patch ──
// (Live failure: exact-match guard missed the prefixed reply → model reasoning was
// upserted into tutor_mind as the living-mind doc.)
describe("self-write NO_UPDATE guard (prefix regression)", () => {
  it("treats a NO_UPDATE-prefixed reply as no update (no tutor_mind write)", async () => {
    process.env.ANTHROPIC_API_KEY = "k";
    const writes: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: any, init: any) => {
      const u = String(url);
      if (u.includes("/rest/v1/tutor_mind") && init?.method === "POST") { writes.push(u); return R([]); }
      if (u.includes("/rest/v1/tutor_mind")) return R([{ mind_doc: "existing doc" }]);
      if (u.includes("api.anthropic.com"))
        return R({ content: [{ type: "text", text: "NO_UPDATE\n\nThe student's request was routine." }] });
      return R([]);
    }));
    const h = (await import("../api/self-write.ts")).default;
    const res = makeRes();
    await h({ method: "POST", body: { userId: "u1", recentMessages: [{ role: "user", content: "hi" }] } }, res);
    expect(res.body).toMatchObject({ updated: false });
    expect(writes).toHaveLength(0);   // nothing upserted
  });
});

// ── assignment-reminder: a PostgREST error object must surface, not read as success ──
// (Live failure: users.phone doesn't exist → 42703 error OBJECT → old code said
// "No users with phone numbers" and reported sent:0 success.)
describe("assignment-reminder missing users.phone (42703 regression)", () => {
  it("returns 500 with the real error instead of a fake success", async () => {
    process.env.TWILIO_SID = "sid"; process.env.TWILIO_TOKEN = "tok"; process.env.TWILIO_FROM = "+1000";
    // CRON_SECRET fail-closed check (added after this test was originally written —
    // see CLAUDE.md "Conventions & gotchas") now runs before the rest of the handler,
    // so a valid auth header is needed to actually reach the users.phone code path
    // this test exercises.
    process.env.CRON_SECRET = "test-secret";
    vi.stubGlobal("fetch", vi.fn(async (url: any) => {
      if (String(url).includes("/rest/v1/users"))
        return R({ code: "42703", message: "column users.phone does not exist" });
      return R([]);
    }));
    const h = (await import("../api/assignment-reminder.ts")).default;
    const res = makeRes();
    await h({ method: "GET", query: {}, headers: { authorization: "Bearer test-secret" } }, res);
    expect(res.statusCode).toBe(500);
    expect(res.body.error).toMatch(/users\.phone|users query failed/);
  });
});

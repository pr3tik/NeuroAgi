// @vitest-environment node
// Confirms api/assignment-reminder.ts fails closed on CRON_SECRET, matching its sibling
// crons (api/brain-intervention.ts, api/arbiter.ts). Previously this endpoint had no
// secret check at all — it only checked the non-secret x-vercel-cron header, which any
// caller can set arbitrarily.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { makeRes } from "./helpers";

beforeEach(() => {
  process.env.TWILIO_SID          = "sid";
  process.env.TWILIO_TOKEN        = "token";
  process.env.TWILIO_FROM         = "+15551234567";
  process.env.SUPABASE_URL        = "http://fs";
  process.env.SUPABASE_SERVICE_KEY = "svc";
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => [], text: async () => "" })));
});
afterEach(() => { vi.unstubAllGlobals(); delete process.env.CRON_SECRET; });

async function load() {
  vi.resetModules();
  const mod = await import("../api/assignment-reminder.ts");
  return mod.default;
}

describe("assignment-reminder handler", () => {
  it("fails closed with 500 when CRON_SECRET isn't configured", async () => {
    delete process.env.CRON_SECRET;
    const handler = await load();
    const res = makeRes();
    await handler({ method: "GET", headers: {} }, res);
    expect(res.statusCode).toBe(500);
  });

  it("rejects with 401 when CRON_SECRET is configured but the request has no matching header", async () => {
    process.env.CRON_SECRET = "test-secret";
    const handler = await load();
    const res = makeRes();
    await handler({ method: "GET", headers: {} }, res);
    expect(res.statusCode).toBe(401);
  });

  it("proceeds past the auth gate with a valid Bearer header", async () => {
    process.env.CRON_SECRET = "test-secret";
    const handler = await load();
    const res = makeRes();
    await handler({ method: "GET", headers: { authorization: "Bearer test-secret" } }, res);
    // Reaches the real logic — never rejected by the auth gate itself. (It may still
    // legitimately do anything after that, per the stubbed fetch returning [].)
    expect(res.statusCode).not.toBe(401);
    expect(res.statusCode).not.toBe(500);
  });

  it("excludes app-marked-done work (manual_done_at=is.null) — regression: no SMS about assignments the student already completed", async () => {
    process.env.CRON_SECRET = "test-secret";
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: any) => {
      const u = String(url);
      calls.push(u);
      if (u.includes("/rest/v1/users")) return { ok: true, json: async () => [{ id: "u1", phone: "+15550001111" }], text: async () => "" };
      return { ok: true, json: async () => [], text: async () => "" }; // assignments → none
    }));
    const handler = await load();
    const res = makeRes();
    await handler({ method: "GET", headers: { authorization: "Bearer test-secret" } }, res);
    const assignCall = calls.find(u => u.includes("/rest/v1/assignments"));
    expect(assignCall).toBeTruthy();
    expect(assignCall).toContain("submitted_at=is.null");
    expect(assignCall).toContain("manual_done_at=is.null");
  });
});

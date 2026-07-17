// @vitest-environment node
// Regression test for the brain-scheduler-fast module-load crash: constructing a Supabase client
// with an undefined BRAIN_SUPABASE_URL used to throw at IMPORT, 500-ing this */5 cron on every run.
// No mock of supabase-js on purpose — the point is that importing must NOT construct a client, and
// the handler must return a clean no-op (before any createClient) when the Brain DB is unconfigured.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const makeRes = () => ({ statusCode: 0, body: null as any, status(c: number) { this.statusCode = c; return this; }, json(o: any) { this.body = o; return this; } });

beforeEach(() => {
  process.env.CRON_SECRET = "sek";
  process.env.SUPABASE_URL = "http://x";
  process.env.SUPABASE_SERVICE_KEY = "k";
  delete process.env.BRAIN_SUPABASE_URL;
  delete process.env.BRAIN_SUPABASE_KEY;
});
afterEach(() => vi.resetModules());

describe("brain-scheduler-fast (module-load crash regression)", () => {
  it("imports without constructing a client and no-ops when the Brain DB is unconfigured", async () => {
    const h = (await import("../api/brain-scheduler-fast.ts")).default; // must not throw at import
    const res = makeRes();
    await h({ headers: { authorization: "Bearer sek" }, query: {} }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: false, reason: "brain db not configured" });
  });

  it("401s on a bad cron secret", async () => {
    const h = (await import("../api/brain-scheduler-fast.ts")).default;
    const res = makeRes();
    await h({ headers: { authorization: "Bearer nope" }, query: {} }, res);
    expect(res.statusCode).toBe(401);
  });
});

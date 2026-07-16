// @vitest-environment node
// ipOnly rate limiting: a fully-public endpoint must key by IP even when a (never-validated)
// Bearer token is present — otherwise rotating random tokens mints unlimited fresh buckets and
// the cap is meaningless. Supabase-js is mocked (CI is Node 20 — never build a real client).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { makeRes } from "./helpers";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn(async () => ({ data: true, error: null })) }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ rpc }) }));

beforeEach(() => {
  process.env.SUPABASE_URL = "http://localhost";
  process.env.SUPABASE_SERVICE_KEY = "svc";
  rpc.mockClear();
});
afterEach(() => { vi.resetModules(); });

async function load() { return (await import("../api/_ratelimit.ts")).rateLimit; }

describe("rateLimit ipOnly", () => {
  it("default: a Bearer token buys the generous per-user bucket", async () => {
    const rateLimit = await load();
    const ok = await rateLimit({ headers: { authorization: "Bearer abc", "x-forwarded-for": "9.9.9.9" } }, makeRes(), "b", { anonMax: 5, authMax: 100 });
    expect(ok).toBe(true);
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_max: 100 });
    expect(rpc.mock.calls[0][1].p_key).toMatch(/^b:u:/);
  });

  it("ipOnly: keys by IP + anonMax even when a Bearer token is presented", async () => {
    const rateLimit = await load();
    const ok = await rateLimit({ headers: { authorization: "Bearer rotating-junk", "x-forwarded-for": "9.9.9.9" } }, makeRes(), "b", { anonMax: 5, authMax: 100, ipOnly: true });
    expect(ok).toBe(true);
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_key: "b:ip:9.9.9.9", p_max: 5 });
  });

  it("over the limit → 429 and false", async () => {
    rpc.mockResolvedValueOnce({ data: false, error: null });
    const rateLimit = await load();
    const res = makeRes();
    const ok = await rateLimit({ headers: { "x-forwarded-for": "9.9.9.9" } }, res, "b", { ipOnly: true });
    expect(ok).toBe(false);
    expect(res.statusCode).toBe(429);
  });
});

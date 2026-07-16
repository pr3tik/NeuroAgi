// @vitest-environment node
// BE-08 jobs WORKER (api/jobs.ts) — drains the queue that room-session?action=end fills.
//
// These tests are written against the REAL schema in supabase-studyroom-sprint-migration.sql,
// not an invented one: status is 'queued'|'running'|'done'|'failed'|'dead' (NOT 'pending'),
// the error column is `last_error` (NOT `error`), `output_ref` is a UUID (NOT a jsonb blob),
// and claim_job(p_types text[], p_lease_secs) returns AT MOST ONE job per call.
//
// Mocks stub `fetch` as a PostgREST emulator (same idiom as room-session.test.ts) so the
// assertions pin the actual wire format — a mock that mirrors an imagined schema proves
// nothing, which is exactly how the previous version of this file passed while being wrong.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { makeRes } from "./helpers";

const authState = vi.hoisted(() => ({ userId: "stu-1" as string | null }));
vi.mock("../api/_auth.ts", () => ({
  requireUser: async () => (authState.userId ? { userId: authState.userId, authId: "test" } : null),
  requireUserOr401: async (_req: any, res: any) => {
    if (!authState.userId) { res.status(401).json({ error: "Authentication required." }); return null; }
    return authState.userId;
  },
}));

function R(data: any, opts: { ok?: boolean; status?: number } = {}) {
  const { ok = true, status = 200 } = opts;
  return { ok, status, json: async () => data, text: async () => JSON.stringify(data) };
}

type Call = { url: string; method: string; body?: any };
function stubDb(route: (u: string, method: string, body: any) => any | undefined) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: any, init: any = {}) => {
    const u = String(url);
    const method = String(init.method ?? "GET").toUpperCase();
    const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ url: u, method, body });
    return route(u, method, body) ?? R([]);
  }));
  return calls;
}
const patchesTo = (calls: Call[], frag: string) => calls.filter(c => c.method === "PATCH" && c.url.includes(frag));
const claims = (calls: Call[]) => calls.filter(c => c.url.includes("/rpc/claim_job"));

const SESSION = "22222222-2222-4222-8222-222222222222";
const SUMMARY_ID = "99999999-9999-4999-8999-999999999999";

const job = (over: any = {}) => ({
  id: "job-1", type: "generate_session_summary",
  idempotency_key: `generate_session_summary:${SESSION}`,
  payload: { sessionId: SESSION, roomId: "room-1" },
  status: "running", attempts: 1,
  run_after: "2026-07-17T00:00:00Z", lease_until: "2026-07-17T00:02:00Z",
  last_error: null, output_ref: null, ...over,
});

/** Hand back `queue` one job per claim_job call, then nothing — mirrors the real RPC. */
function queueOf(jobs: any[]) {
  const pending = [...jobs];
  return stubDb((u, method) => {
    if (u.includes("/rpc/claim_job") && method === "POST") {
      const next = pending.shift();
      return R(next ? [next] : []);
    }
    if (u.includes("/jobs?") && method === "PATCH") return R(null, { status: 204 });
    return undefined;
  });
}

let mod: any;
beforeEach(async () => {
  process.env.SUPABASE_URL = "http://localhost";
  process.env.SUPABASE_SERVICE_KEY = "svc";
  process.env.CRON_SECRET = "test-secret";
  authState.userId = "stu-1";
  vi.resetModules();
  mod = await import("../api/jobs.ts");
  mod._clearHandlers();
});
afterEach(() => vi.unstubAllGlobals());

describe("backoffSecs", () => {
  it("grows exponentially across the retry budget", () => {
    expect([1, 2, 3].map(mod.backoffSecs)).toEqual([30, 60, 120]);
  });
});

describe("runJobs — claiming", () => {
  it("only claims types it has a handler for", async () => {
    mod.registerHandler("generate_quiz", async () => null);
    const calls = queueOf([]);

    await mod.runJobs();

    expect(claims(calls)[0].body).toEqual({ p_types: ["generate_quiz"], p_lease_secs: 120 });
  });

  it("claims NOTHING when no handlers are registered", async () => {
    // Otherwise the worker would grab work it cannot do and strand it in 'running'
    // until the lease expired — burning an attempt for nothing, every tick.
    const calls = queueOf([job()]);

    const out = await mod.runJobs();

    expect(out).toEqual({ claimed: 0, results: [] });
    expect(claims(calls)).toHaveLength(0);
  });

  it("stops as soon as the queue is drained rather than spinning to the limit", async () => {
    mod.registerHandler("generate_session_summary", async () => SUMMARY_ID);
    const calls = queueOf([job({ id: "a" })]);   // one job, limit 5

    const out = await mod.runJobs(5);

    expect(out.claimed).toBe(1);
    expect(claims(calls)).toHaveLength(2);   // one that returns the job, one that returns []
  });

  it("drains several jobs in one tick, up to the limit", async () => {
    mod.registerHandler("generate_session_summary", async () => SUMMARY_ID);
    queueOf([job({ id: "a" }), job({ id: "b" }), job({ id: "c" })]);

    const out = await mod.runJobs(2);

    expect(out.claimed).toBe(2);   // capped — 'c' waits for the next tick
  });
});

describe("runJobs — settling", () => {
  it("marks done and stores the produced row's UUID in output_ref", async () => {
    mod.registerHandler("generate_session_summary", async () => SUMMARY_ID);
    const calls = queueOf([job()]);

    const out = await mod.runJobs();

    expect(out.results[0]).toMatchObject({ outcome: "done", output_ref: SUMMARY_ID });
    const [upd] = patchesTo(calls, "/jobs?id=eq.job-1");
    expect(upd.body).toMatchObject({ status: "done", output_ref: SUMMARY_ID, last_error: null, lease_until: null });
  });

  it("accepts a handler that produces no row (output_ref stays null, not undefined)", async () => {
    mod.registerHandler("generate_session_summary", async () => null);
    const calls = queueOf([job()]);

    await mod.runJobs();

    expect(patchesTo(calls, "/jobs?")[0].body.output_ref).toBeNull();
  });

  it("a crashed job goes back to 'failed' (retryable) with a backoff, as the SAME row", async () => {
    // claim_job picks up status in ('queued','failed'), so 'failed' is the retry state.
    // Nothing re-enqueues: the retry reuses the row the crash left behind.
    mod.registerHandler("generate_session_summary", async () => { throw new Error("worker died"); });
    const calls = queueOf([job({ attempts: 1 })]);

    const out = await mod.runJobs();

    expect(out.results[0]).toMatchObject({ outcome: "failed", id: "job-1" });
    const [upd] = patchesTo(calls, "/jobs?id=eq.job-1");
    expect(upd.body.status).toBe("failed");
    expect(upd.body.last_error).toContain("worker died");
    expect(upd.body.lease_until).toBeNull();        // released so it can be re-claimed
    expect(upd.body.run_after).toBeTruthy();        // backed off
    // No new job rows — a retry must never fan out.
    expect(calls.filter(c => c.method === "POST" && c.url.includes("/jobs?"))).toHaveLength(0);
  });

  it("dead-letters on the 3rd attempt instead of retrying forever", async () => {
    mod.registerHandler("generate_session_summary", async () => { throw new Error("still broken"); });
    const calls = queueOf([job({ attempts: 3 })]);

    const out = await mod.runJobs();

    expect(out.results[0].outcome).toBe("dead");
    const [upd] = patchesTo(calls, "/jobs?id=eq.job-1");
    expect(upd.body.status).toBe("dead");
    expect(upd.body.run_after).toBeUndefined();   // terminal — no point scheduling another try
  });

  it("one failing job does not abort the rest of the batch", async () => {
    let n = 0;
    mod.registerHandler("generate_session_summary", async () => {
      if (++n === 1) throw new Error("first one explodes");
      return SUMMARY_ID;
    });
    queueOf([job({ id: "bad", attempts: 1 }), job({ id: "good", attempts: 1 })]);

    const out = await mod.runJobs();

    expect(out.results.map((r: any) => r.outcome)).toEqual(["failed", "done"]);
  });

  it("truncates a pathological error message instead of writing unbounded text", async () => {
    mod.registerHandler("generate_session_summary", async () => { throw new Error("x".repeat(9000)); });
    const calls = queueOf([job({ attempts: 1 })]);

    await mod.runJobs();

    expect(patchesTo(calls, "/jobs?")[0].body.last_error.length).toBeLessThanOrEqual(2000);
  });
});

describe("handler — auth", () => {
  it("refuses to run without the cron secret", async () => {
    queueOf([]);
    const res = makeRes();
    await mod.default({ method: "POST", query: { action: "run" }, headers: {} }, res);
    expect(res.statusCode).toBe(401);
  });

  it("fails closed when CRON_SECRET is unset — an unset secret is not 'open'", async () => {
    delete process.env.CRON_SECRET;
    queueOf([]);
    const res = makeRes();
    await mod.default({ method: "POST", query: { action: "run" }, headers: { authorization: "Bearer anything" } }, res);
    expect(res.statusCode).toBe(401);
  });

  it("accepts either Bearer or the x-cron-secret header (Vercel cron sends Bearer)", async () => {
    queueOf([]);
    for (const headers of [{ authorization: "Bearer test-secret" }, { "x-cron-secret": "test-secret" }]) {
      const res = makeRes();
      await mod.default({ method: "POST", query: { action: "run" }, headers }, res);
      expect(res.statusCode).toBe(200);
      expect(res.body).toMatchObject({ ok: true, claimed: 0 });
    }
  });

  it("does not expose the worker's job types to an anonymous caller", async () => {
    authState.userId = null;
    queueOf([]);
    const res = makeRes();
    await mod.default({ method: "GET", query: { action: "types" }, headers: {} }, res);
    expect(res.statusCode).toBe(401);
  });

  it("rejects an unknown action", async () => {
    queueOf([]);
    const res = makeRes();
    await mod.default({ method: "POST", query: { action: "bogus" }, headers: {} }, res);
    expect(res.statusCode).toBe(400);
  });
});

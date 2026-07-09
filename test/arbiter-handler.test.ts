// @vitest-environment node
// End-to-end test of the Signal Arbiter handler against a mocked Supabase — exercises
// the real decision + delivery path (claim → reserve → in-app insert → mark delivered),
// and the defer paths (rate limit, quiet hours) and dedup. This is the "does the
// pipeline actually work" proof, short of a live DB.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { makeSupabaseMock, makeRes } from "./helpers";

vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }));
import { createClient } from "@supabase/supabase-js";

beforeEach(() => {
  process.env.SUPABASE_URL = "http://localhost";
  process.env.SUPABASE_SERVICE_KEY = "svc";
  process.env.CRON_SECRET = "test-secret";
  delete process.env.DISCORD_BOT_TOKEN;        // in-app only → no Discord fetch
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}), text: async () => "" })));
});
afterEach(() => vi.unstubAllGlobals());

async function loadArbiter(router: (ctx: any) => any) {
  const { client, calls } = makeSupabaseMock(router);
  vi.resetModules();
  (createClient as any).mockReturnValue(client);
  const mod = await import("../api/arbiter.ts");
  return { handler: mod.default, calls };
}

const cand = (over: any = {}) => ({
  id: "c1", user_id: "u1", type: "intervention",
  urgency_score: 0.96, value_score: 0.9,        // urgent by default → bypasses rate/quiet
  channel_hint: "in_app", dedup_key: null,
  title: "t", body: "b", data: { reason: "high_stress" },
  created_at: "2026-06-26T00:00:00Z", ...over,
});

// Router factory: drives the arbiter's reads. `pending` = the pending-candidate load;
// `recent` = notification_queue rows seen by the rate-limiter; `quiet` = users row
// (timezone/quiet-hours and discord_user_id); `tuning` = intervention_tuning row.
function router({ pending = [] as any[], recent = [] as any[], quiet = null as any, tuning = null as any } = {}) {
  return (ctx: any) => {
    const { table, op, payload, filters } = ctx;
    if (table === "proactive_signals") {
      if (op === "select") {
        const reclaim = filters.some((f: any[]) => f[0] === "eq" && f[1] === "status" && f[2] === "approved");
        return { data: reclaim ? [] : pending, error: null };
      }
      if (op === "update") return { data: payload?.status === "approved" ? [{ id: "c1" }] : [], error: null };
    }
    if (table === "notification_queue") {
      if (op === "select") return { data: recent, error: null };
      if (op === "insert") return { data: { id: "q1" }, error: null };
      return { data: null, error: null };
    }
    if (table === "notifications" && op === "insert") return { data: { id: "n1" }, error: null };
    if (table === "users") return { data: quiet ?? { timezone: "UTC" }, error: null };
    if (table === "intervention_tuning") return { data: tuning, error: null };  // userChannelPref / null
    return { data: null, error: null };
  };
}

const auth = () => ({ headers: { authorization: "Bearer test-secret" } });
const had = (calls: any[], table: string, op: string, pred: (c: any) => boolean = () => true) =>
  calls.some(c => c.table === table && c.op === op && pred(c));

describe("arbiter handler", () => {
  it("fail-closed: 401 without the cron secret", async () => {
    const { handler } = await loadArbiter(router({ pending: [cand()] }));
    const res = makeRes();
    await handler({ headers: {} }, res);
    expect(res.statusCode).toBe(401);
  });

  it("delivers an urgent candidate end-to-end (queue row → in-app → mark delivered)", async () => {
    const { handler, calls } = await loadArbiter(router({ pending: [cand()] }));
    const res = makeRes();
    await handler(auth(), res);

    expect(res.body.delivered).toBe(1);
    expect(had(calls, "notification_queue", "insert")).toBe(true);                 // reserved a queue row
    expect(had(calls, "notifications", "insert")).toBe(true);                      // in-app delivery
    expect(had(calls, "notification_queue", "update", c => "delivered_at" in (c.payload ?? {}))).toBe(true); // stamped delivered
    expect(had(calls, "proactive_signals", "update", c => c.payload?.status === "delivered")).toBe(true);

    // The seam that closes the loop: the in-app notification must carry queue_id (so the
    // client can stamp opened_at/action_taken), AND the original data must survive the spread.
    const inApp = calls.find(c => c.table === "notifications" && c.op === "insert");
    expect(inApp?.payload?.data?.queue_id).toBe("q1");
    expect(inApp?.payload?.data?.reason).toBe("high_stress");
  });

  it("delivers on the LEARNED channel — channel_pref=discord overrides an in_app hint", async () => {
    process.env.DISCORD_BOT_TOKEN = "bot";   // so deliverDiscord actually attempts a DM
    const rnd = vi.spyOn(Math, "random").mockReturnValue(0.99);  // ≥ EXPLORE_RATE → exploit the learned pref
    const { handler, calls } = await loadArbiter(router({
      pending: [cand({ channel_hint: "in_app" })],          // candidate asked for in_app …
      tuning:  { channel_pref: "discord" },                  // … but the student learned-prefers discord
      quiet:   { timezone: "UTC", discord_user_id: "d1" },   // discord is reachable
    }));
    const res = makeRes();
    await handler(auth(), res);

    expect(res.body.delivered).toBe(1);
    // queue row stamped with the channel that actually delivered → discord (proves the override fired)
    expect(had(calls, "notification_queue", "update", c => c.payload?.channel === "discord")).toBe(true);
    rnd.mockRestore();
  });

  it("defers (no delivery) when the student already got one in the last hour", async () => {
    const { handler, calls } = await loadArbiter(router({
      pending: [cand({ urgency_score: 0.7 })],                                     // non-urgent → rate-limited
      recent:  [{ created_at: new Date().toISOString() }],                         // one within the hour
    }));
    const res = makeRes();
    await handler(auth(), res);

    expect(res.body.delivered).toBe(0);
    expect(res.body.deferred).toBe(1);
    expect(had(calls, "notifications", "insert")).toBe(false);
  });

  it("defers during quiet hours for a non-urgent candidate", async () => {
    const H = new Date().getUTCHours();
    const { handler, calls } = await loadArbiter(router({
      pending: [cand({ urgency_score: 0.7 })],
      recent:  [],                                                                 // not rate-limited
      quiet:   { timezone: "UTC", quiet_hours_start: H, quiet_hours_end: (H + 1) % 24 }, // now is quiet
    }));
    const res = makeRes();
    await handler(auth(), res);

    expect(res.body.deferred).toBe(1);
    expect(had(calls, "notifications", "insert")).toBe(false);
  });

  it("dedupes: rejects the lower-scored duplicate, delivers the winner", async () => {
    const { handler, calls } = await loadArbiter(router({
      pending: [
        cand({ id: "hi", dedup_key: "k", urgency_score: 0.96, value_score: 0.9 }), // 0.864
        cand({ id: "lo", dedup_key: "k", urgency_score: 0.96, value_score: 0.5 }), // 0.48
      ],
    }));
    const res = makeRes();
    await handler(auth(), res);

    expect(res.body.rejected).toBe(1);   // the duplicate
    expect(res.body.delivered).toBe(1);  // the winner
    expect(had(calls, "proactive_signals", "update", c => c.payload?.status === "rejected")).toBe(true);
  });
});

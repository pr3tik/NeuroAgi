// @vitest-environment node
// Phase D: engagement-tier strategy on top of api/brain-intervention.ts —
//   1. Week-1 accounts (account age within 14d) skip stress-triggered nudges.
//   2. Established (>14d) accounts still get stress nudges as before (regression).
//   3. A separate re-engagement pass proposes a low-urgency "we miss you" signal
//      for established accounts that have gone quiet (5+ days), independent of
//      whether they even appear in the Brain DB context_window loop.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { makeSupabaseMock, makeRes } from "./helpers";

vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }));
import { createClient } from "@supabase/supabase-js";

beforeEach(() => {
  process.env.BRAIN_SUPABASE_URL = "http://brain";
  process.env.BRAIN_SUPABASE_KEY = "bkey";
  process.env.SUPABASE_URL = "http://fs";
  process.env.SUPABASE_SERVICE_KEY = "svc";
  process.env.CRON_SECRET = "test-secret";
});
afterEach(() => vi.unstubAllGlobals());

const DAY = 24 * 60 * 60 * 1000;

// Stub fetch (PostgREST for brain + fschool DBs). `users` covers both the per-context
// week1 age lookup (`select=email_verify_sent_at`) and the re-engagement scan (`or=(`).
function stubFetch({
  context = [] as any[], history = [] as any[], nq = [] as any[], tuning = [] as any[],
  userCreatedAt = null as string | null,      // per-context week1 lookup response
  quietUsers = [] as any[],                    // re-engagement scan response
} = {}) {
  const fn = vi.fn(async (url: any) => {
    const u = String(url);
    const R = (data: any) => ({ ok: true, status: 200, json: async () => data, text: async () => "" });
    if (u.includes("/context_window"))       return R(context);
    if (u.includes("/intervention_tuning"))  return R(tuning);
    if (u.includes("/interventions"))        return R(history);
    if (u.includes("/notification_queue"))   return R(nq);
    if (u.includes("/users?") && u.includes("or=("))            return R(quietUsers);
    if (u.includes("/users?") && u.includes("select=email_verify_sent_at")) return R(userCreatedAt ? [{ email_verify_sent_at: userCreatedAt }] : []);
    return R([]);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

async function loadBI() {
  const { client, calls } = makeSupabaseMock();
  vi.resetModules();
  (createClient as any).mockReturnValue(client);
  const mod = await import("../api/brain-intervention.ts");
  return { handler: mod.default, calls };
}

const ctxFor = (over: any = {}) => ({
  id: "cw1", stress_level: 8, momentum_state: "steady",
  expires_at: new Date(Date.now() + 3600_000).toISOString(), knowledge_gaps: [],
  persons: { id: "p1", name: "Sam", fschool_user_id: "u1" }, ...over,
});
const auth = () => ({ headers: { authorization: "Bearer test-secret" } });
const proposedWith = (calls: any[], dedupKey: string) =>
  calls.some(c => c.table === "proactive_signals" && c.op === "insert" && c.payload?.dedup_key === dedupKey);

describe("brain-intervention: engagement-tier strategy (Phase D)", () => {
  it("skips a stress nudge for a week-1 account (created 1 day ago)", async () => {
    stubFetch({
      context: [ctxFor({ stress_level: 8 })],
      userCreatedAt: new Date(Date.now() - 1 * DAY).toISOString(),
    });
    const { handler, calls } = await loadBI();
    const res = makeRes();
    await handler(auth(), res);

    expect(res.body.proposed).toBe(0);
    expect(proposedWith(calls, "intervention:high_stress")).toBe(false);
  });

  it("still proposes a stress nudge for an established account (created 30 days ago) — regression", async () => {
    stubFetch({
      context: [ctxFor({ stress_level: 8 })],
      userCreatedAt: new Date(Date.now() - 30 * DAY).toISOString(),
    });
    const { handler, calls } = await loadBI();
    const res = makeRes();
    await handler(auth(), res);

    expect(res.body.proposed).toBe(1);
    expect(proposedWith(calls, "intervention:high_stress")).toBe(true);
  });

  it("proposes a re-engagement signal for an established account that's gone quiet, even with no context_window entry at all", async () => {
    stubFetch({
      context: [],   // this user generates NO brain-DB signal — the main loop never sees them
      quietUsers: [{ id: "u2", name: "Sam", email_verify_sent_at: new Date(Date.now() - 60 * DAY).toISOString(), last_active_date: null }],
    });
    const { handler, calls } = await loadBI();
    const res = makeRes();
    await handler(auth(), res);

    expect(res.body.reEngaged).toBe(1);
    expect(proposedWith(calls, "re_engagement")).toBe(true);
    const call = calls.find(c => c.table === "proactive_signals" && c.payload?.dedup_key === "re_engagement");
    expect(call.payload.user_id).toBe("u2");
    expect(call.payload.type).toBe("re_engagement");
    expect(call.payload.urgency_score).toBeLessThan(0.3);   // low-urgency, distinct from stress nudges
  });

  it("does not propose a re-engagement signal when the quiet-users scan returns nobody", async () => {
    stubFetch({ context: [], quietUsers: [] });
    const { handler } = await loadBI();
    const res = makeRes();
    await handler(auth(), res);

    expect(res.body.reEngaged).toBe(0);
  });
});

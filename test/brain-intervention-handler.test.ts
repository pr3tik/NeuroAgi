// @vitest-environment node
// End-to-end test of the brain-intervention cron: it reads context_window (brain DB,
// via fetch/PostgREST), and proposes candidates to the Arbiter via proposeProactive
// (FschoolAI DB, via the supabase client). Covers: propose-on-high-stress, the
// no-user skip, the stress-escalation cap, and the §3.5.4 tuning write-back.
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

// Stub fetch (PostgREST for brain + fschool DBs) with per-test datasets.
function stubFetch({ context = [] as any[], history = [] as any[], nq = [] as any[], tuning = [] as any[] } = {}) {
  const fn = vi.fn(async (url: any, opts: any = {}) => {
    const u = String(url); const method = opts.method ?? "GET";
    const R = (data: any) => ({ ok: true, status: 200, json: async () => data, text: async () => "" });
    if (u.includes("/context_window"))      return R(context);
    if (u.includes("/intervention_tuning"))  return R(method === "GET" ? tuning : []);
    if (u.includes("/interventions"))        return R(history);   // GET=history; POST=log (ignored)
    if (u.includes("/notification_queue"))   return R(nq);
    return R([]);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

async function loadBI() {
  const { client, calls } = makeSupabaseMock();   // default router: insert → 'created'
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
const proposed = (calls: any[]) => calls.some(c => c.table === "proactive_signals" && c.op === "insert");

describe("brain-intervention handler", () => {
  it("proposes a candidate to the Arbiter for a high-stress student", async () => {
    stubFetch({ context: [ctxFor({ stress_level: 8 })] });
    const { handler, calls } = await loadBI();
    const res = makeRes();
    await handler(auth(), res);

    expect(res.body.proposed).toBe(1);
    expect(proposed(calls)).toBe(true);          // candidate written to proactive_signals
  });

  it("does NOT propose when the person has no linked FschoolAI user", async () => {
    stubFetch({ context: [ctxFor({ persons: { id: "p1", name: "Sam", fschool_user_id: null } })] });
    const { handler, calls } = await loadBI();
    const res = makeRes();
    await handler(auth(), res);

    expect(res.body.proposed).toBe(0);
    expect(res.body.skipped).toBe(1);
    expect(proposed(calls)).toBe(false);
  });

  it("fires the wellbeing escalation when delivered nudges keep going unengaged (≥2h, ignored)", async () => {
    const old = () => new Date(Date.now() - 3 * 3600_000).toISOString();   // >2h ago → genuinely ignored
    stubFetch({
      context: [ctxFor({ stress_level: 9 })],                       // very high
      history: [],                                                  // no prior escalation_pause
      nq: Array.from({ length: 3 }, () => ({                        // 3 delivered, ignored ≥2h
        delivered_at: old(), opened_at: null, action_taken: false, channel: "discord", created_at: old(),
      })),
    });
    const { handler, calls } = await loadBI();
    const res = makeRes();
    await handler(auth(), res);

    expect(res.body.escalated).toBe(1);
    expect(res.body.proposed).toBe(0);           // escalation path replaces the normal nudge
    expect(proposed(calls)).toBe(true);          // the wellbeing message is still a proposeProactive
  });

  it("does NOT escalate on nudges the student just hasn't opened yet (<2h grace)", async () => {
    const recent = () => new Date(Date.now() - 30 * 60_000).toISOString(); // 30 min ago → still pending
    stubFetch({
      context: [ctxFor({ stress_level: 9 })],
      history: [],
      nq: Array.from({ length: 3 }, () => ({
        delivered_at: recent(), opened_at: null, action_taken: false, channel: "discord", created_at: recent(),
      })),
    });
    const { handler } = await loadBI();
    const res = makeRes();
    await handler(auth(), res);

    expect(res.body.escalated).toBe(0);          // undecided (pending), not a failure → no premature escalation
    expect(res.body.proposed).toBe(1);           // a normal nudge instead
  });

  // Helper: extract the body of the POST that persisted the tuning.
  const tuningWrite = (fetchFn: any) => {
    const post = (fetchFn.mock.calls as any[]).find(
      ([url, opts]) => String(url).includes("/intervention_tuning") && (opts?.method ?? "GET") === "POST"
    );
    expect(post, "expected a POST to /intervention_tuning").toBeDefined();
    return JSON.parse(post[1].body);
  };
  const old = () => new Date(Date.now() - 3 * 3600_000).toISOString();   // >2h ago → decided label

  it("tunes UP: persists stress_threshold=8 when ≥20 labels are mostly ignored", async () => {
    const fetchFn = stubFetch({
      context: [ctxFor({ stress_level: 7 })],
      nq: Array.from({ length: 25 }, () => ({                       // 25 delivered, none engaged
        delivered_at: old(), opened_at: null, action_taken: false, channel: "in_app", created_at: old(),
      })),
    });
    await (await loadBI()).handler(auth(), makeRes());

    const body = tuningWrite(fetchFn);
    expect(body.stress_threshold).toBe(8);       // raise 7→8 — FAILS if computeTuning is gutted
    expect(body.label_count).toBe(25);
  });

  it("tunes DOWN: persists stress_threshold=6 when ≥20 labels are mostly engaged", async () => {
    const fetchFn = stubFetch({
      context: [ctxFor({ stress_level: 7 })],
      nq: Array.from({ length: 25 }, () => ({                       // 25 delivered AND opened
        delivered_at: old(), opened_at: old(), action_taken: false, channel: "in_app", created_at: old(),
      })),
    });
    await (await loadBI()).handler(auth(), makeRes());

    expect(tuningWrite(fetchFn).stress_threshold).toBe(6);          // lower 7→6
  });
});

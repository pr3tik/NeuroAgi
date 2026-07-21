// @vitest-environment node
// Phase D engagement-tier strategy on the KERNEL-SOURCED brain-intervention:
//   1. Week-1 accounts (age < 14d) skip stress-triggered nudges.
//   2. Established (>14d) accounts still get stress nudges (regression).
//   3. A separate re-engagement pass proposes a low-urgency "we miss you" for established accounts
//      that have gone quiet (5+ days), independent of whether they have any kernel signal at all.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { makeSupabaseMock, makeRes } from "./helpers";

vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }));
import { createClient } from "@supabase/supabase-js";

beforeEach(() => {
  process.env.SUPABASE_URL = "http://fs";
  process.env.SUPABASE_SERVICE_KEY = "svc";
  delete process.env.NEURO_SUPABASE_URL;
  delete process.env.NEURO_SUPABASE_SERVICE_KEY;
  process.env.CRON_SECRET = "test-secret";
});
afterEach(() => vi.unstubAllGlobals());

const DAY = 24 * 60 * 60 * 1000;
const now = () => new Date().toISOString();
const sig = (tone: string) => ({ id: `s${Math.random()}`, subject: "person:p1", kind: "signal", body: { emotional_tone: tone }, salience: 0.5, audience: [], source: "fschoolai", happened_at: now(), last_seen_at: now(), forgotten_at: null, created_at: now() });

function stubFetch({ personMems = [] as any[], history = [] as any[], nq = [] as any[], tuning = [] as any[], userCreatedAt = null as string | null, name = "Sam", quietUsers = [] as any[], activeSubjects = ["person:p1"], links = [{ person_id: "p1", local_id: "u1" }] } = {}) {
  const R = (data: any) => ({ ok: true, status: 200, json: async () => data, text: async () => "" });
  const fn = vi.fn(async (url: any, opts: any = {}) => {
    const u = String(url); const method = opts.method ?? "GET";
    if (u.includes("/neuro_memory")) {
      if (method === "POST") return R([{ id: "m" }]);
      if (u.includes("kind=eq.signal")) return R(activeSubjects.map((s) => ({ subject: s })));
      if (u.includes("kind=in.")) return R(history);
      return R(personMems);
    }
    if (u.includes("/neuro_person_link")) return R(links);
    if (u.includes("/intervention_tuning")) return R(method === "GET" ? tuning : []);
    if (u.includes("/notification_queue")) return R(nq);
    if (u.includes("/users?") && u.includes("or=(")) return R(quietUsers);
    if (u.includes("/users?")) return R(userCreatedAt ? [{ name, email_verify_sent_at: userCreatedAt }] : []);
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

const auth = () => ({ headers: { authorization: "Bearer test-secret" } });
const proposedWith = (calls: any[], dedupKey: string) => calls.some((c) => c.table === "proactive_signals" && c.op === "insert" && c.payload?.dedup_key === dedupKey);
const stressedMems = () => [sig("stressed"), sig("stressed"), sig("stressed"), sig("stressed")]; // stress 8

describe("brain-intervention: engagement-tier strategy (Phase D, kernel-sourced)", () => {
  it("skips a stress nudge for a week-1 account (created 1 day ago)", async () => {
    stubFetch({ personMems: stressedMems(), userCreatedAt: new Date(Date.now() - 1 * DAY).toISOString() });
    const { handler, calls } = await loadBI();
    const res = makeRes();
    await handler(auth(), res);
    expect(res.body.proposed).toBe(0);
    expect(proposedWith(calls, "intervention:high_stress")).toBe(false);
  });

  it("still proposes a stress nudge for an established account (created 30 days ago) — regression", async () => {
    stubFetch({ personMems: stressedMems(), userCreatedAt: new Date(Date.now() - 30 * DAY).toISOString() });
    const { handler, calls } = await loadBI();
    const res = makeRes();
    await handler(auth(), res);
    expect(res.body.proposed).toBe(1);
    expect(proposedWith(calls, "intervention:high_stress")).toBe(true);
  });

  it("proposes a re-engagement signal for an established account that's gone quiet, even with no kernel signal", async () => {
    stubFetch({ activeSubjects: [], quietUsers: [{ id: "u2", name: "Sam", email_verify_sent_at: new Date(Date.now() - 60 * DAY).toISOString(), last_active_date: null }] });
    const { handler, calls } = await loadBI();
    const res = makeRes();
    await handler(auth(), res);
    expect(res.body.reEngaged).toBe(1);
    expect(proposedWith(calls, "re_engagement")).toBe(true);
    const call = calls.find((c) => c.table === "proactive_signals" && c.payload?.dedup_key === "re_engagement");
    expect(call.payload.user_id).toBe("u2");
    expect(call.payload.urgency_score).toBeLessThan(0.3);
  });

  it("does not propose a re-engagement signal when the quiet-users scan returns nobody", async () => {
    stubFetch({ activeSubjects: [], quietUsers: [] });
    const { handler } = await loadBI();
    const res = makeRes();
    await handler(auth(), res);
    expect(res.body.reEngaged).toBe(0);
  });
});

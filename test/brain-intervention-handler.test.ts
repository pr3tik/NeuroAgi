// @vitest-environment node
// brain-intervention cron, KERNEL-SOURCED: enumerates active persons (kernel signals) → maps via
// neuro_person_link → synthesizeContext → proposes to the Arbiter (proposeProactive, supabase
// client) and audits to a kernel `intervention` memory. Covers: propose-on-high-stress, no-active-
// person skip, the stress-escalation cap (+2h grace), and the §3.5.4 tuning write-back.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { makeSupabaseMock, makeRes } from "./helpers";

vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }));
import { createClient } from "@supabase/supabase-js";

beforeEach(() => {
  process.env.SUPABASE_URL = "http://fs";
  process.env.SUPABASE_SERVICE_KEY = "svc";
  delete process.env.NEURO_SUPABASE_URL;   // kernel store falls back to product in the test
  delete process.env.NEURO_SUPABASE_SERVICE_KEY;
  process.env.CRON_SECRET = "test-secret";
});
afterEach(() => vi.unstubAllGlobals());

const now = () => new Date().toISOString();
const sig = (tone: string) => ({ id: `s${Math.random()}`, subject: "person:p1", kind: "signal", body: { emotional_tone: tone }, salience: 0.5, audience: [], source: "fschoolai", happened_at: now(), last_seen_at: now(), forgotten_at: null, created_at: now() });

// Route PostgREST reads/writes for kernel (neuro_memory / neuro_person_link) + product (users /
// tuning / notification_queue). Kernel queries: kind=eq.signal → active subjects; kind=in.(...) →
// intervention history (recall); else subject=in. → the person's memories (synthesizeContext).
function stubFetch({ personMems = [] as any[], history = [] as any[], nq = [] as any[], tuning = [] as any[], user = null as any, activeSubjects = ["person:p1"], links = [{ person_id: "p1", local_id: "u1" }] } = {}) {
  const R = (data: any) => ({ ok: true, status: 200, json: async () => data, text: async () => "" });
  const fn = vi.fn(async (url: any, opts: any = {}) => {
    const u = String(url); const method = opts.method ?? "GET";
    if (u.includes("/neuro_memory")) {
      if (method === "POST") return R([{ id: "mem-new" }]);
      if (u.includes("kind=eq.signal")) return R(activeSubjects.map((s) => ({ subject: s })));
      if (u.includes("kind=in.")) return R(history);
      return R(personMems);
    }
    if (u.includes("/neuro_person_link")) return R(links);
    if (u.includes("/intervention_tuning")) return R(method === "GET" ? tuning : []);
    if (u.includes("/notification_queue")) return R(nq);
    if (u.includes("/users")) return R(user ? [user] : []);
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
const proposed = (calls: any[]) => calls.some((c) => c.table === "proactive_signals" && c.op === "insert");
const estUser = { name: "Sam", email_verify_sent_at: new Date(Date.now() - 30 * 86400000).toISOString() }; // 30d old (past Week-1)

describe("brain-intervention handler (kernel-sourced)", () => {
  it("proposes a candidate to the Arbiter for a high-stress active student", async () => {
    stubFetch({ personMems: [sig("stressed"), sig("stressed"), sig("stressed"), sig("stressed")], user: estUser }); // stress 8
    const { handler, calls } = await loadBI();
    const res = makeRes();
    await handler(auth(), res);
    expect(res.body.proposed).toBe(1);
    expect(proposed(calls)).toBe(true);
  });

  it("does NOT propose an intervention when there are no active persons", async () => {
    stubFetch({ activeSubjects: [] }); // no active kernel signals → no intervention targets; no quiet users either
    const { handler, calls } = await loadBI();
    const res = makeRes();
    await handler(auth(), res);
    expect(res.body.proposed).toBe(0);
    expect(proposed(calls)).toBe(false);
  });

  it("fires the wellbeing escalation when delivered nudges keep going unengaged (≥2h, ignored)", async () => {
    const old = () => new Date(Date.now() - 3 * 3600_000).toISOString();
    stubFetch({
      personMems: [sig("stressed"), sig("stressed"), sig("stressed"), sig("stressed"), sig("stressed")], // stress 10 (>=9)
      history: [], user: estUser,
      nq: Array.from({ length: 3 }, () => ({ delivered_at: old(), opened_at: null, action_taken: false, channel: "discord", created_at: old() })),
    });
    const { handler, calls } = await loadBI();
    const res = makeRes();
    await handler(auth(), res);
    expect(res.body.escalated).toBe(1);
    expect(res.body.proposed).toBe(0);
    expect(proposed(calls)).toBe(true); // wellbeing message is still a proposeProactive
  });

  it("does NOT escalate on nudges the student just hasn't opened yet (<2h grace)", async () => {
    const recent = () => new Date(Date.now() - 30 * 60_000).toISOString();
    stubFetch({
      personMems: [sig("stressed"), sig("stressed"), sig("stressed"), sig("stressed"), sig("stressed")], // stress 10
      history: [], user: estUser,
      nq: Array.from({ length: 3 }, () => ({ delivered_at: recent(), opened_at: null, action_taken: false, channel: "discord", created_at: recent() })),
    });
    const { handler } = await loadBI();
    const res = makeRes();
    await handler(auth(), res);
    expect(res.body.escalated).toBe(0);
    expect(res.body.proposed).toBe(1);
  });

  it("tunes UP: persists stress_threshold=8 when ≥20 labels are mostly ignored", async () => {
    const old = () => new Date(Date.now() - 3 * 3600_000).toISOString();
    const fetchFn = stubFetch({
      personMems: [sig("stressed"), sig("stressed"), sig("stressed"), sig("stressed")], user: estUser, // stress 8
      nq: Array.from({ length: 25 }, () => ({ delivered_at: old(), opened_at: null, action_taken: false, channel: "in_app", created_at: old() })),
    });
    await (await loadBI()).handler(auth(), makeRes());
    const post = (fetchFn.mock.calls as any[]).find(([url, opts]) => String(url).includes("/intervention_tuning") && (opts?.method ?? "GET") === "POST");
    expect(post, "expected a POST to /intervention_tuning").toBeDefined();
    const body = JSON.parse(post[1].body);
    expect(body.stress_threshold).toBe(8);
    expect(body.label_count).toBe(25);
  });
});

// api/_brain/policy.ts — the proactive POLICY GATE (BR-07, person-brain side). A pure decision
// layer mirroring cortex.policy: it decides WHICH brain focuses are worth surfacing proactively and
// whether NOW is an acceptable moment (importance floor · daily budget · cooldown · quiet hours).
//
// It decides should/can we speak — it does NOT deliver. Actual delivery (enqueue to the arbiter /
// notification pipeline) and LIVE FIRE to real students are a separate, gated step: a proactive job
// derives candidates, gates each, and only then hands the survivors to the arbiter. Keeping the gate
// pure means it's fully testable without sending anything.
import { recall, type Store } from "./kernel.js";

export type Candidate = { key: string; dimension: string; text: string; salience: number };

/** Delivery candidates for a person: their promoted `focus` memories, strongest first. Pure recall fold. */
export async function proactiveCandidates(store: Store, subject: string, now = Date.now()): Promise<Candidate[]> {
  const focuses = await recall(store, [subject], { kind: "focus", limit: 20, reinforce: false, now });
  return focuses
    .map((m) => ({ key: String(m.body?.key ?? m.id), dimension: String(m.body?.dimension ?? ""), text: String(m.body?.text ?? ""), salience: m.salience }))
    .filter((c) => c.text)
    .sort((a, b) => b.salience - a.salience);
}

export type PolicyState = {
  lastDeliveredAt?: number | null;   // ms of the last proactive delivery to this subject
  deliveredToday?: number;           // count already delivered in the current day
};
export type PolicyConfig = {
  importanceFloor?: number;          // min candidate salience (default 0.6)
  cooldownMins?: number;             // min gap between deliveries (default 240)
  dailyBudget?: number;              // max deliveries per day (default 3)
  quietHours?: [number, number];     // server-local hour window to suppress, e.g. [22, 8]
};
export type Decision = { allow: boolean; reason: string };

/** Decide whether a candidate may be delivered NOW under the policy. Pure — no I/O, no side effects. */
export function gate(candidate: Candidate, state: PolicyState, cfg: PolicyConfig = {}, now = Date.now()): Decision {
  const floor = cfg.importanceFloor ?? 0.6;
  const cooldown = (cfg.cooldownMins ?? 240) * 60_000;
  const budget = cfg.dailyBudget ?? 3;
  if (candidate.salience < floor) return { allow: false, reason: "below importance floor" };
  if ((state.deliveredToday ?? 0) >= budget) return { allow: false, reason: "daily budget spent" };
  if (state.lastDeliveredAt && now - state.lastDeliveredAt < cooldown) return { allow: false, reason: "cooldown" };
  if (cfg.quietHours) {
    const h = new Date(now).getHours();
    const [qs, qe] = cfg.quietHours;
    const quiet = qs <= qe ? (h >= qs && h < qe) : (h >= qs || h < qe);
    if (quiet) return { allow: false, reason: "quiet hours" };
  }
  return { allow: true, reason: "ok" };
}

// api/_brain/hypothesis.ts — "mine needs from noise" (the cortex hypothesis layer).
//
// A DERIVED LAYER over recall: repeated signals accumulate into candidate hypotheses; once
// confident enough one is promoted to a `focus` (a dimension the tutor should watch). Pure over
// the memory stream — recomputable, and it never delivers anything to a user (that gate belongs to
// the arbiter/policy layer, wired separately). It only writes hypothesis/focus memories that the
// tutor already surfaces via recall → renderStudentBrainState.
import { recall, remember, reinforce, type Store, type Memory } from "./kernel.js";

export type Hypothesis = {
  key: string;        // stable id for dedup, e.g. "emotion:stressed"
  dimension: string;  // 'emotion' | 'habit' | 'engagement'
  claim: string;      // human-readable
  evidence: number;   // supporting signal count in the window
  confidence: number; // 0..1
};

const MIN_EVIDENCE = 3;   // need at least this many corroborating signals
const PROMOTE = 0.6;      // confidence at which a hypothesis becomes a focus
const conf = (n: number) => Math.max(0, Math.min(1, n / 5));

/** Cluster recent signals into candidate hypotheses. Pure — no I/O. */
export function mineHypotheses(signals: Memory[]): Hypothesis[] {
  const bodies = signals.map((s) => s.body || {});
  const count = (pred: (b: any) => boolean) => bodies.filter(pred).length;
  const out: Hypothesis[] = [];

  const stressed = count((b) => b.emotional_tone === "stressed");
  if (stressed >= MIN_EVIDENCE) out.push({ key: "emotion:stressed", dimension: "emotion", claim: "Student has been persistently stressed recently.", evidence: stressed, confidence: conf(stressed) });

  const confused = count((b) => b.emotional_tone === "confused" || b.event === "confusion");
  if (confused >= MIN_EVIDENCE) out.push({ key: "emotion:confused", dimension: "emotion", claim: "Student is repeatedly confused or stuck.", evidence: confused, confidence: conf(confused) });

  const late = count((b) => b.time_of_day === "late_night");
  if (late >= MIN_EVIDENCE) out.push({ key: "habit:late_night", dimension: "habit", claim: "Student frequently studies late at night.", evidence: late, confidence: conf(late) });

  return out;
}

/**
 * Reflection pass: mine hypotheses from recent signals, upsert them as `hypothesis` memories
 * (reinforce the key if it already exists, else remember), and promote high-confidence ones to a
 * `focus` memory the tutor surfaces. Best-effort; returns the hypotheses found. No user delivery.
 */
export async function runHypothesisPass(store: Store, subject: string, now = Date.now()): Promise<Hypothesis[]> {
  const signals = await recall(store, [subject], { kind: "signal", limit: 40, reinforce: false, now });
  const hyps = mineHypotheses(signals);
  if (!hyps.length) return [];

  const existing = await recall(store, [subject], { kind: ["hypothesis", "focus"], limit: 100, reinforce: false, now });
  for (const hyp of hyps) {
    const priorHyp = existing.find((m) => m.kind === "hypothesis" && m.body?.key === hyp.key);
    if (priorHyp) await reinforce(store, priorHyp.id, now, 0.1);
    else await remember(store, { subject, kind: "hypothesis", salience: hyp.confidence, source: "hypothesis-engine", body: { key: hyp.key, dimension: hyp.dimension, claim: hyp.claim, evidence: hyp.evidence } }, now);

    if (hyp.confidence >= PROMOTE) {
      const priorFocus = existing.find((m) => m.kind === "focus" && m.body?.key === hyp.key);
      if (priorFocus) await reinforce(store, priorFocus.id, now, 0.1);
      else await remember(store, { subject, kind: "focus", salience: Math.max(0.6, hyp.confidence), source: "hypothesis-engine", body: { key: hyp.key, dimension: hyp.dimension, text: hyp.claim } }, now);
    }
  }
  return hyps;
}

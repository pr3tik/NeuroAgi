// api/_brain/traits.ts — learning-style / study-profile as a DERIVED LAYER.
//
// A pure fold over a person's behavioral signals into durable `trait` memories the tutor surfaces
// (via recall → renderStudentBrainState). Deliberately conservative: it asserts only what the
// signals actually support (dominant study time, engagement depth) rather than inventing a VARK
// "learning style" the thin signal set can't justify. Re-derived + reinforced each session, so
// stable traits stay alive while stale ones decay. No user delivery.
import { recall, remember, reinforce, type Store, type Memory } from "./kernel.js";

export type Trait = { key: string; dimension: string; text: string; confidence: number; format?: string };

const MIN_SIGNALS = 4; // need enough behavior to characterize anything

const TIME_LABEL: Record<string, string> = {
  late_night: "late at night", morning: "in the morning", afternoon: "in the afternoon", evening: "in the evening",
};
// Empirical format preference vocabulary (mirrors users.learning_style CHECK: diagram/talk/read/problem/mix).
const FORMAT_LABEL: Record<string, string> = {
  diagram: "visual / diagram", talk: "spoken / dialogue", read: "written", problem: "worked-problem", mix: "mixed",
};

/** Derive grounded study-profile traits from recent behavioral signals. Pure — no I/O. */
export function deriveTraits(signals: Memory[]): Trait[] {
  const bodies = signals.map((s) => s.body || {});
  const out: Trait[] = [];
  if (bodies.length < MIN_SIGNALS) return out;

  // Dominant study time (only if it's a clear plurality).
  const timeCounts: Record<string, number> = {};
  for (const b of bodies) if (b.time_of_day) timeCounts[b.time_of_day] = (timeCounts[b.time_of_day] || 0) + 1;
  const total = Object.values(timeCounts).reduce((a, b) => a + b, 0);
  const top = Object.entries(timeCounts).sort((a, b) => b[1] - a[1])[0];
  if (top && total > 0 && top[1] >= Math.max(3, total * 0.4)) {
    out.push({ key: "study_time", dimension: "habit", text: `Tends to study ${TIME_LABEL[top[0]] ?? top[0]}.`, confidence: Math.min(1, top[1] / total) });
  }

  // Engagement depth from average message length.
  const lens = bodies.map((b) => b.message_length).filter((x) => typeof x === "number") as number[];
  if (lens.length >= MIN_SIGNALS) {
    const avg = lens.reduce((a, b) => a + b, 0) / lens.length;
    if (avg >= 200) out.push({ key: "engagement", dimension: "style", text: "Engages in depth — writes long, detailed messages.", confidence: 0.6 });
    else if (avg <= 40) out.push({ key: "engagement", dimension: "style", text: "Prefers short, quick exchanges.", confidence: 0.6 });
  }

  // Learning preference — EMPIRICAL, not a VARK label: which response format the student actually
  // engages with, from signals carrying { format, helpful:boolean } (the tutor logs what it tried +
  // whether it landed). Asserts a preference only with enough evidence AND a clear leader — else it
  // stays silent and callers fall back to the static onboarding users.learning_style.
  const fmt: Record<string, { n: number; good: number }> = {};
  for (const b of bodies) {
    if (typeof b.format === "string" && typeof b.helpful === "boolean") {
      const f = (fmt[b.format] ||= { n: 0, good: 0 }); f.n++; if (b.helpful) f.good++;
    }
  }
  const ranked = Object.entries(fmt).filter(([, v]) => v.n >= 3)
    .map(([f, v]) => ({ f, rate: v.good / v.n })).sort((a, b) => b.rate - a.rate);
  if (ranked.length && ranked[0].rate >= 0.6 && (ranked.length === 1 || ranked[0].rate - ranked[1].rate >= 0.15)) {
    out.push({ key: "learning_pref", dimension: "style", format: ranked[0].f, confidence: Math.min(1, ranked[0].rate),
      text: `Responds best to ${FORMAT_LABEL[ranked[0].f] ?? ranked[0].f} explanations.` });
  }

  return out;
}

/**
 * Derive traits from recent signals and upsert them as `trait` memories (reinforce by key, else
 * remember). Best-effort; returns the traits found. No user delivery.
 */
export async function runTraitPass(store: Store, subject: string, now = Date.now()): Promise<Trait[]> {
  const signals = await recall(store, [subject], { kind: "signal", limit: 60, reinforce: false, now });
  const traits = deriveTraits(signals);
  if (!traits.length) return [];

  const existing = await recall(store, [subject], { kind: "trait", limit: 100, reinforce: false, now });
  for (const t of traits) {
    const prior = existing.find((m) => m.body?.key === t.key);
    if (prior) await reinforce(store, prior.id, now, 0.1);
    else await remember(store, { subject, kind: "trait", salience: Math.max(0.5, t.confidence), source: "trait-engine", body: { key: t.key, dimension: t.dimension, text: t.text, ...(t.format ? { format: t.format } : {}) } }, now);
  }
  return traits;
}

/**
 * The learning/format preference for a subject: the brain-LEARNED value (empirical `learning_pref`
 * trait) if one exists, else the caller's static fallback (e.g. users.learning_style from onboarding).
 * A derived layer over recall — the evidence-based value supersedes the static string as it accrues.
 */
export async function resolveLearningStyle(store: Store, subject: string, fallback?: string | null, now = Date.now()): Promise<string | null> {
  const traits = await recall(store, [subject], { kind: "trait", limit: 50, reinforce: false, now });
  const pref = traits.find((m) => m.body?.key === "learning_pref");
  return (pref?.body?.format as string) ?? fallback ?? null;
}

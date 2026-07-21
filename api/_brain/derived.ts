// api/_brain/derived.ts — derived layers: PURE folds over recall (recomputable, never bespoke
// stateful services). Two v1 feature concepts re-implemented the v2 way:
//   verifySkills  — empirical skill verification from demonstration signals
//   brainHealth   — a recomputable health/engagement snapshot (+ exportBrain for portability)
import { effective, FORGET_THRESHOLD, type Store, type Memory } from "./kernel.js";

export type Skill = { skill: string; demonstrations: number; successRate: number; verified: boolean };

/**
 * Verify skills from signals carrying { skill:string, correct:boolean } — an empirical
 * demonstration rate, not a self-report. A skill is "verified" with >= min demonstrations and a
 * success rate >= rate. Pure aggregate, recomputed each call.
 */
export async function verifySkills(store: Store, subject: string, opts: { min?: number; rate?: number; now?: number } = {}): Promise<Skill[]> {
  const min = opts.min ?? 3, rate = opts.rate ?? 0.7;
  const rows = await store.bySubjects([subject], ["signal"], 1000, false);
  const agg: Record<string, { n: number; ok: number }> = {};
  for (const s of rows) {
    const b = s.body || {};
    if (typeof b.skill === "string" && typeof b.correct === "boolean") {
      const a = (agg[b.skill] ||= { n: 0, ok: 0 }); a.n++; if (b.correct) a.ok++;
    }
  }
  return Object.entries(agg)
    .map(([skill, v]) => ({ skill, demonstrations: v.n, successRate: v.ok / v.n, verified: v.n >= min && v.ok / v.n >= rate }))
    .sort((a, b) => (b.verified ? 1 : 0) - (a.verified ? 1 : 0) || b.successRate - a.successRate);
}

export type BrainHealth = {
  memories: number; fresh: number; decaying: number; traits: number; focuses: number;
  lastActiveDays: number | null; dominantTone: string | null;
};

/** A recomputable health snapshot of a person's OWN brain (subject-scoped, no audience). Pure fold. */
export async function brainHealth(store: Store, subject: string, now = Date.now()): Promise<BrainHealth> {
  const live = (await store.bySubjects([subject], undefined, 5000, false)).filter((m) => !m.forgotten_at);
  const fresh = live.filter((m) => effective(m, now) >= FORGET_THRESHOLD).length;
  const lastSeen = live.length ? Math.max(...live.map((m) => Date.parse(m.last_seen_at))) : null;
  const tones: Record<string, number> = {};
  for (const m of live) if (m.kind === "signal" && m.body?.emotional_tone) tones[m.body.emotional_tone] = (tones[m.body.emotional_tone] || 0) + 1;
  return {
    memories: live.length,
    fresh,
    decaying: live.length - fresh,
    traits: live.filter((m) => m.kind === "trait").length,
    focuses: live.filter((m) => m.kind === "focus").length,
    lastActiveDays: lastSeen != null ? Math.floor((now - lastSeen) / 86_400_000) : null,
    dominantTone: Object.entries(tones).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
  };
}

/** Full export of a person's own memories (data portability). */
export async function exportBrain(store: Store, subject: string): Promise<Memory[]> {
  return store.bySubjects([subject], undefined, 100000, false);
}

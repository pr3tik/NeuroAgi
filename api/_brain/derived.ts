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

export type BrainContext = {
  stressLevel: number;                 // 0..10 (matches the legacy context_window scale)
  momentum: "rising" | "steady" | "declining" | "stalled";
  focus: string | null;                // top promoted focus text
  recentSummary: string | null;        // living-mind digest summary
  tone: string | null;                 // dominant recent emotional tone
  signalCount: number;
};

/**
 * Kernel context synthesis — the v2 replacement for brain-scheduler's LLM-synthesized
 * context_window. A PURE, recomputable fold over the person's own signals/focuses/digest (no cron,
 * no LLM, no stored row): stress from stressed/confused-tone density, momentum from recent-vs-prior
 * signal cadence, focus from the top promoted hypothesis, summary from the living-mind digest. This
 * is what lets the intervention path read the kernel instead of the legacy context_window table.
 */
export async function synthesizeContext(store: Store, subject: string, now = Date.now()): Promise<BrainContext> {
  const live = (await store.bySubjects([subject], undefined, 800, false)).filter((m) => !m.forgotten_at);
  const signals = live.filter((m) => m.kind === "signal");
  const WEEK = 7 * 86_400_000;
  const recent = signals.filter((s) => now - Date.parse(s.last_seen_at) < WEEK);
  const prior = signals.filter((s) => { const d = now - Date.parse(s.last_seen_at); return d >= WEEK && d < 2 * WEEK; });

  const stressed = recent.filter((s) => s.body?.emotional_tone === "stressed").length;
  const confused = recent.filter((s) => s.body?.emotional_tone === "confused" || s.body?.event === "confusion").length;
  const stressLevel = Math.max(0, Math.min(10, stressed * 2 + confused));

  let momentum: BrainContext["momentum"] = "steady";
  if (recent.length === 0 && prior.length > 0) momentum = "stalled";
  else if (recent.length < prior.length * 0.5) momentum = "declining";
  else if (recent.length > prior.length * 1.5 && recent.length >= 3) momentum = "rising";

  const focuses = live.filter((m) => m.kind === "focus").sort((a, b) => b.salience - a.salience);
  const digest = live.find((m) => m.kind === "digest");
  const tones: Record<string, number> = {};
  for (const s of recent) if (s.body?.emotional_tone) tones[s.body.emotional_tone] = (tones[s.body.emotional_tone] || 0) + 1;

  return {
    stressLevel,
    momentum,
    focus: (focuses[0]?.body?.text as string) ?? null,
    recentSummary: (digest?.body?.summary as string) ?? null,
    tone: Object.entries(tones).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
    signalCount: signals.length,
  };
}

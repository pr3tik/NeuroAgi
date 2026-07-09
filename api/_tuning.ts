// api/_tuning.ts — the effectiveness feedback loop (PRD §3.5.4), pure + testable.
//
// A delivered intervention becomes a LABEL:
//   positive — the student opened it or acted on it
//   negative — 2h passed since delivery with no engagement
//   pending  — delivered < 2h ago (not yet decided), or never delivered
// After ≥20 decided labels, per-student thresholds are tuned. No DB/IO here —
// the cron in brain-intervention reads notification_queue rows and feeds them in.

export const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
export const MIN_LABELS   = 20;     // §3.5.4: tune after 20 labelled examples
export const STRESS_MIN    = 5;
export const STRESS_MAX    = 9;
export const STRESS_DEFAULT = 7;
export const MIN_CHANNEL_SAMPLES = 5;  // need this many on a channel before trusting its rate

export interface LabelRow {
  delivered_at: string | null;
  opened_at:    string | null;
  action_taken: boolean | null;
  channel:      string | null;
}
export type Label = "positive" | "negative" | "pending";

export interface Tuning {
  stressThreshold: number;
  channelPref: string | null;
  labelCount: number;
}

/** Classify a single delivered intervention into a feedback label. */
export function labelOf(row: LabelRow, nowMs: number): Label {
  if (!row.delivered_at) return "pending";
  if (row.opened_at || row.action_taken) return "positive";
  if (nowMs - new Date(row.delivered_at).getTime() >= TWO_HOURS_MS) return "negative";
  return "pending";  // delivered but the 2h decision window hasn't closed
}

/** The channel with the highest positive rate (≥ MIN_CHANNEL_SAMPLES), or null. */
function bestChannel(decided: { label: Label; channel: string | null }[]): string | null {
  const by = new Map<string, { pos: number; total: number }>();
  for (const l of decided) {
    if (!l.channel) continue;
    const e = by.get(l.channel) ?? { pos: 0, total: 0 };
    e.total++;
    if (l.label === "positive") e.pos++;
    by.set(l.channel, e);
  }
  let best: string | null = null;
  let bestRate = -1;
  for (const [ch, e] of by) {
    if (e.total < MIN_CHANNEL_SAMPLES) continue;
    const r = e.pos / e.total;
    if (r > bestRate) { bestRate = r; best = ch; }
  }
  return best;
}

/** Recompute a student's tuning from their delivered-intervention rows.
 *  Returns `current` (only refreshing labelCount) until ≥20 decided labels exist. */
export function computeTuning(rows: LabelRow[], current: Tuning, nowMs: number): Tuning {
  const decided = rows
    .map(r => ({ label: labelOf(r, nowMs), channel: r.channel }))
    .filter(l => l.label !== "pending") as { label: Label; channel: string | null }[];

  if (decided.length < MIN_LABELS) {
    return { ...current, labelCount: decided.length };
  }

  const positives = decided.filter(l => l.label === "positive").length;
  const rate = positives / decided.length;

  let stress = current.stressThreshold ?? STRESS_DEFAULT;
  if (rate < 0.2)      stress = Math.min(STRESS_MAX, stress + 1);  // mostly ignored → raise the bar (nudge less)
  else if (rate > 0.6) stress = Math.max(STRESS_MIN, stress - 1);  // responsive → lower the bar (nudge a bit more)

  const channelPref = bestChannel(decided) ?? current.channelPref;

  return { stressThreshold: stress, channelPref, labelCount: decided.length };
}

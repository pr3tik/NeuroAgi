// leaderboard.ts — pure ranking logic for the Leaderboard agent.
//
// Given the product's user rows, produce a ranked board for a category, with the
// requesting user's TRUE rank even when they fall outside the visible top-N. No DB, no
// LLM, no brain, so it's unit-testable and can't interfere with any other work. The API
// handler (api/leaderboard.ts) does the DB read and hands the rows to these functions.

export type Scope = "global" | "university" | "city" | "country";

export interface LbRow {
  userId: string;
  name: string;
  school?: string | null;
  city?: string | null;
  country?: string | null;
  continent?: string | null;
  optedOut?: boolean;
  // metric fields (any may be null when the student has no data for it)
  points?: number | null;
  study_time?: number | null;
  streak?: number | null;
  gpa?: number | null;
  [k: string]: any;
}

export interface Category {
  key: string;
  label: string;
  metric: string;     // which LbRow field to rank by
  available: boolean;
  reason?: string;    // why it's not rankable yet (when available === false)
}

// The eight "maxing" categories from the spec, plus GPA. Only the ones with a real data
// source today are `available`; the rest are declared (not faked) so the UI can show a
// "coming soon" state and we don't invent numbers we can't back.
export const CATEGORIES: Category[] = [
  { key: "tokens",     label: "Tokens",     metric: "points",       available: true  }, // Token Maxing
  { key: "study_time", label: "Study Time", metric: "study_time",   available: true  }, // Nerdmaxing
  { key: "streak",     label: "Streak",     metric: "streak",       available: true  }, // Streak Maxing
  { key: "gpa",        label: "GPA",        metric: "gpa",          available: true  },
  { key: "grind",      label: "On-Time",    metric: "ontime",       available: false, reason: "assignment submission timing isn't tracked yet" },     // Grindmaxing
  { key: "late_night", label: "Late Night", metric: "late_night",   available: false, reason: "study-session timestamps aren't tracked yet" },        // Late Night Maxing
  { key: "social",     label: "Social",     metric: "social",       available: false, reason: "friends-helped / rooms-hosted isn't aggregated yet" }, // Social Maxing
  { key: "brain",      label: "Brain",      metric: "brain_growth", available: false, reason: "knowledge-graph growth comes from the brain layer" },  // Brain Maxing
  { key: "influencer", label: "Influencer", metric: "referrals",    available: false, reason: "no referral system yet" },                             // Influencer Maxing
];

export function getCategory(key: string): Category | undefined {
  return CATEGORIES.find(c => c.key === key);
}

const SCOPE_FIELD: Record<Exclude<Scope, "global">, keyof LbRow> = {
  university: "school",
  city:       "city",
  country:    "country",
};

// Keep only rows matching the scope (e.g. same school). "global" (or a missing scope
// value) keeps everyone.
export function scopeFilter(rows: LbRow[], scope: Scope, scopeValue?: string | null): LbRow[] {
  if (scope === "global" || !scopeValue) return rows;
  const field = SCOPE_FIELD[scope];
  return rows.filter(r => r[field] != null && r[field] === scopeValue);
}

export interface RankedRow extends LbRow { rank: number; value: number; }

// Rank rows by a metric, descending. Rows with a null/undefined/NaN metric are dropped
// (you can't rank "no data"). Ties share a rank — competition ranking, e.g. 1, 2, 2, 4.
export function rankRows(rows: LbRow[], metric: string): RankedRow[] {
  const scored = rows
    .filter(r => r[metric] != null && !Number.isNaN(Number(r[metric])))
    .map(r => ({ ...r, value: Number(r[metric]) }))
    .sort((a, b) => b.value - a.value);

  let prevValue: number | null = null;
  let prevRank = 0;
  return scored.map((r, i) => {
    const rank = (prevValue !== null && r.value === prevValue) ? prevRank : i + 1;
    prevValue = r.value;
    prevRank = rank;
    return { ...r, rank };
  });
}

// The requesting user's true position in the full ranked list (not just the visible
// top-N). Null if they have no data for this metric or aren't in scope.
export function findUserRank(ranked: RankedRow[], userId?: string | null): { rank: number; value: number } | null {
  if (!userId) return null;
  const me = ranked.find(r => r.userId === userId);
  return me ? { rank: me.rank, value: me.value } : null;
}

// studyBlocks.ts — deterministic "Reggie's recommended study times".
//
// NO model calls, no fetching, no Date.now() — everything derives from the inputs so
// the Calendar page (and its tests) get the same answer for the same state. The rules:
//
//   1. Every UNSUBMITTED assignment due 1–7 calendar days out earns ONE prep block on
//      the day BEFORE it's due ("Prep: <title>", 45 min). Due tomorrow → the block
//      lands today. Due today/overdue is NOT a planning problem (the Today panel owns
//      urgency); >7 days out is noise.
//   2. Days that already have an exam-plan session are OFF LIMITS — the committed plan
//      owns those days; suggestions never compete with it (skip, don't reschedule:
//      a suggestion that hops to a random other day stops being explainable).
//   3. Max 2 suggestions per day, soonest-due assignments win the slots.
//   4. One block per assignment (dedup by id, falling back to name).
//   5. Blocks land at REAL evening times, staggered per day: the first block on a day
//      starts 6:00 PM (1080 min), the second 7:15 PM (1155 min) — 45 min of work plus
//      a 30 min break between them.
//
// Same local-day math as WeekCalendar/Study: construct from Y/M/D parts (DST-safe),
// never raw ms deltas on instants.
//
// The time-grid calendar lets users EDIT these suggestions (drag to reschedule, ×
// to dismiss) and add their own blocks. Those edits live in localStorage — the
// schema, the guarded read/write, and the merge (`applyCalendarEdits`) all live
// here so the grid and the "Reggie recommends" list can never disagree.

export interface SuggestedBlock {
  id: string;              // STABLE — derived from the assignment id/name so
                           // localStorage overrides keep pointing at the same block
  date: string;            // "YYYY-MM-DD" (local calendar day)
  title: string;           // "Prep: <assignment name>"
  minutes: number;         // always 45 for v1
  startMin: number;        // start time, minutes from local midnight (rule 5)
  kind: "suggested";
}

// A block after user edits are merged in — either a (possibly moved) suggestion or
// a user-created "Study session".
export interface CalendarBlock {
  id: string;
  date: string;
  title: string;
  minutes: number;
  startMin: number;
  kind: "suggested" | "created";
}

// The localStorage schema for calendar edits (one key per user).
export interface CalendarEdits {
  overrides: Record<string, { date?: string; startMin?: number }>; // blockId → moved where
  created: { id: string; date: string; startMin: number; minutes: number; title: string }[];
  dismissed: string[];                                             // suggested blockIds hidden by ×
}

const pad = (n: number) => String(n).padStart(2, "0");
const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
// Calendar-day difference (b - a) in the local timezone. Both operands are snapped to
// local midnight so the division is exact across DST.
const daysBetween = (a: Date, b: Date) =>
  Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / 86_400_000);

const MAX_PER_DAY = 2;
const BLOCK_MINUTES = 45;
// Rule 5 — evening slots by per-day position: 6:00 PM, then 7:15 PM.
const DAY_SLOTS = [18 * 60, 19 * 60 + 15];

export function suggestStudyBlocks({
  assignments = [],
  plan = null,
  now = new Date(),
}: {
  assignments?: any[];
  plan?: { sessions?: any[] } | null;
  now?: Date;
}): SuggestedBlock[] {
  // Rule 2 precompute: the set of days the committed plan already owns.
  const planDays = new Set<string>();
  for (const s of plan?.sessions ?? []) {
    // Plan dates are date-only strings — anchor at local noon so a UTC parse can't
    // shift them to the previous local day (same trick as Study.tsx/WeekCalendar).
    if (s?.date) planDays.add(dayKey(new Date(s.date + "T12:00:00")));
  }

  // Candidates: unsubmitted, valid due date, 1–7 calendar days out — soonest first.
  const candidates = (assignments ?? [])
    .filter((a: any) => {
      if (!a?.dueAt || a.submission?.submittedAt) return false;
      const due = new Date(a.dueAt);
      if (isNaN(due.getTime())) return false;
      const d = daysBetween(now, due);
      return d >= 1 && d <= 7;
    })
    .sort((a: any, b: any) => +new Date(a.dueAt) - +new Date(b.dueAt));

  const perDay: Record<string, number> = {};
  const seen = new Set<string>();      // rule 4 — one block per assignment
  const out: SuggestedBlock[] = [];

  for (const a of candidates) {
    const idKey = String(a.id ?? a.name ?? a.dueAt);
    if (seen.has(idKey)) continue;
    seen.add(idKey);

    const target = addDays(new Date(a.dueAt), -1);       // the day before due
    const key = dayKey(target);
    if (planDays.has(key)) continue;                     // rule 2 — the plan owns it
    if ((perDay[key] ?? 0) >= MAX_PER_DAY) continue;     // rule 3 — day is full
    perDay[key] = (perDay[key] ?? 0) + 1;

    out.push({
      id: `sb:${idKey}`,                                 // stable across renders/sessions
      date: key,
      title: `Prep: ${a.name ?? "Assignment"}`,
      minutes: BLOCK_MINUTES,
      startMin: DAY_SLOTS[perDay[key] - 1] ?? DAY_SLOTS[DAY_SLOTS.length - 1], // rule 5
      kind: "suggested",
    });
  }

  // Chronological for display; within a day, soonest-due order is preserved (stable sort).
  return out.sort((x, y) => x.date.localeCompare(y.date) || x.startMin - y.startMin);
}

// ── Calendar edits: localStorage schema + merge ───────────────────────────────
//
// Storage value under the per-user key:
//   { overrides: { [blockId]: { date, startMin } },
//     created:   [{ id, date, startMin, minutes, title }],
//     dismissed: [blockId] }

const EMPTY_EDITS = (): CalendarEdits => ({ overrides: {}, created: [], dismissed: [] });

/** Guarded localStorage read — returns empty edits on missing key, bad JSON,
 *  storage disabled, or non-browser environments (tests). Never throws. */
export function readCalendarEdits(storageKey: string): CalendarEdits {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return EMPTY_EDITS();
    const p = JSON.parse(raw);
    return {
      overrides: p && typeof p.overrides === "object" && p.overrides !== null && !Array.isArray(p.overrides) ? p.overrides : {},
      created: Array.isArray(p?.created) ? p.created : [],
      dismissed: Array.isArray(p?.dismissed) ? p.dismissed.map(String) : [],
    };
  } catch {
    return EMPTY_EDITS();
  }
}

/** Guarded localStorage write — silently no-ops if storage is unavailable. */
export function writeCalendarEdits(storageKey: string, edits: CalendarEdits): void {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(edits));
  } catch { /* private mode / quota / non-browser — edits just don't persist */ }
}

/** Merge user edits into the deterministic suggestions:
 *  dismissed ids are dropped, overrides move a block's day/time (suggested OR
 *  created), and created blocks are appended. Pure — the single place both the
 *  time grid and the "Reggie recommends" list get their final block list from. */
export function applyCalendarEdits(
  suggested: SuggestedBlock[] = [],
  stored: Partial<CalendarEdits> | null = null,
): CalendarBlock[] {
  const overrides = stored?.overrides ?? {};
  const dismissed = new Set((stored?.dismissed ?? []).map(String));
  const out: CalendarBlock[] = [];

  for (const b of suggested ?? []) {
    if (!b?.id || dismissed.has(b.id)) continue;
    const ov = overrides[b.id];
    out.push({ ...b, date: ov?.date ?? b.date, startMin: ov?.startMin ?? b.startMin });
  }
  for (const c of stored?.created ?? []) {
    if (!c?.id || !c?.date || dismissed.has(String(c.id))) continue;
    const ov = overrides[String(c.id)];
    const startMin = Number(ov?.startMin ?? c.startMin);
    out.push({
      id: String(c.id),
      date: String(ov?.date ?? c.date),
      title: typeof c.title === "string" && c.title ? c.title : "Study session",
      minutes: Number(c.minutes) > 0 ? Number(c.minutes) : BLOCK_MINUTES,
      startMin: Number.isFinite(startMin) ? startMin : DAY_SLOTS[0],
      kind: "created",
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.startMin - b.startMin);
}

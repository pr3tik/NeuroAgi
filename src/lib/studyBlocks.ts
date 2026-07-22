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
//
// Same local-day math as WeekCalendar/Study: construct from Y/M/D parts (DST-safe),
// never raw ms deltas on instants.

export interface SuggestedBlock {
  date: string;            // "YYYY-MM-DD" (local calendar day)
  title: string;           // "Prep: <assignment name>"
  minutes: number;         // always 45 for v1
  kind: "suggested";
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
      date: key,
      title: `Prep: ${a.name ?? "Assignment"}`,
      minutes: BLOCK_MINUTES,
      kind: "suggested",
    });
  }

  // Chronological for display; within a day, soonest-due order is preserved (stable sort).
  return out.sort((x, y) => x.date.localeCompare(y.date));
}

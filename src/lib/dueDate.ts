// Single source of truth for "how many days until X" in due-date labels.
//
// Why this exists: the app had five separate copies of a due-label formatter, three of
// which used `Math.ceil((due - now) / DAY)` and two `Math.round(...)`. Both derive the day
// count from the raw *instant* delta, so the "Today / Tomorrow" boundary was wrong:
//   - ceil: anything due later TODAY counted as 1 → "Tomorrow"; a task overdue < 24h counted
//     as 0 → "Due today" (hiding that it's late). "Due today" was effectively unreachable.
//   - round: flipped Today↔Tomorrow depending on the time of day it was viewed.
//   - the two variants disagreed with each other for the same assignment.
//
// What users mean by "Today / Tomorrow" is a *calendar-day* difference in their local
// timezone, not elapsed hours. `setHours(0,0,0,0)` snaps to local midnight, so the division
// is exact and DST-safe (both operands share the same local day boundaries).
export function calendarDaysUntil(dateStr: string | number | Date | null | undefined): number | null {
  if (dateStr === null || dateStr === undefined || dateStr === "") return null;
  const due = new Date(dateStr);
  if (isNaN(due.getTime())) return null;
  const startOfDay = (d: Date) => {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x.getTime();
  };
  return Math.round((startOfDay(due) - startOfDay(new Date())) / 86400000);
}

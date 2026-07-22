// WeekCalendar.tsx — the macOS-widget-style calendar half of the Home "Today" card.
//
// The Today panel answers "what should I do right now?" (deriveNextActions); this
// widget answers the sibling question "what does my week/month look like?" using the
// SAME inputs (assignments, exam plan, SRS count) so the two halves can never disagree.
// It is presentation-only: no fetching, no ranking — ranking stays in nextActions.ts.
//
// Overdue rule: overdue items do NOT scatter into past days. A calendar that paints
// last week red is a guilt wall, not a plan — the past is unactionable. Instead a
// single red "N overdue" chip is pinned on TODAY (the day you can act on it), which
// also matches where deriveNextActions surfaces them.
//
// Sizes: `size="compact"` (default) is the Home widget; `size="full"` is the same
// component scaled up for the dedicated Calendar page — taller columns, more chips
// per day before "+N more", and mini text chips in the month grid. All other
// props/behavior are identical between the two.

import { useMemo, useState } from "react";
import { calendarDaysUntil } from "../lib/dueDate";
import { ChevronLeft, ChevronRight } from "lucide-react";

// One color code shared by the calendar chips/dots AND the left-rail row dots in
// Work.tsx — keyed so both NextAction.kind values and calendar item types resolve.
// Values are rgb triplets (or var(--*-rgb) triplets) usable as `rgba(${c}, alpha)`.
export const CAL_COLORS: Record<string, string> = {
  overdue: "255,100,90",            // urgent red — act now
  due_today: "255,100,90",
  assignment: "var(--teal-rgb)",    // periwinkle — upcoming deadlines
  due_tomorrow: "var(--teal-rgb)",
  plan_session: "var(--gold-rgb)",  // ice-lavender — planned study
  exam: "255,100,90",               // red, but OUTLINED so it reads "event" not "late"
  srs: "100,220,130",               // green — reviews
};

// Component-local calendar-day helpers. Constructing from Y/M/D parts (not ms math)
// keeps them DST-safe; date-only strings get the local-noon anchor (T12:00:00) so a
// UTC parse can't shift them to the previous local day — same trick as Study.tsx.
const pad = (n: number) => String(n).padStart(2, "0");
const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const startOfWeek = (d: Date) => addDays(d, -d.getDay());   // Sunday-first, like the reference widget
const WEEKDAY_INITIALS = ["S", "M", "T", "W", "T", "F", "S"];

interface Chip {
  label: string;
  title: string;       // full text for the hover tooltip — chips are heavily ellipsized
  color: string;       // rgb triplet from CAL_COLORS
  outlined?: boolean;  // exam badge: outline only, so it reads as an event marker
}

// Every numeric knob that differs between the Home widget and the Calendar page,
// in one table — the JSX below reads only from `sz` so the two sizes can't drift
// structurally, only proportionally.
const SIZES = {
  compact: {
    containerPad: "14px 16px 12px",    // header row breathing room (founder: "cramped")
    containerGap: 12,
    weekColMinH: 110,
    weekColPad: "8px 6px 10px",        // chips never touch the column edges
    weekChipMax: 3,                    // per-day chips before "+N more"
    chipFont: 11.5,
    chipPad: "3px 8px",
    chipLineH: "15px",
    chipGap: 4,
    dayNumFont: 14,
    monthCellMinH: 64,
    monthDayFont: 12.5,
    monthTextChips: 0,                 // compact month = dots only
    dot: 5,
    legendItemGap: 14,                 // between legend entries
  },
  full: {
    containerPad: "16px 18px 14px",
    containerGap: 14,
    weekColMinH: 200,
    weekColPad: "10px 8px 12px",
    weekChipMax: 5,
    chipFont: 12.5,
    chipPad: "4px 9px",
    chipLineH: "17px",
    chipGap: 5,
    dayNumFont: 15,
    monthCellMinH: 96,
    monthDayFont: 13,
    monthTextChips: 2,                 // month cells show 2 mini text chips, then dots
    dot: 5,
    legendItemGap: 16,
  },
} as const;

export default function WeekCalendar({
  assignments = [],
  plan = null,
  srsDue = 0,
  now = new Date(),
  onDayFocus,
  size = "compact",
}: {
  assignments?: any[];
  plan?: { exam_date?: string; sessions?: any[] } | null;
  srsDue?: number;
  now?: Date;
  onDayFocus?: (date: Date) => void;
  size?: "compact" | "full";
}) {
  const sz = SIZES[size] ?? SIZES.compact;
  const [view, setView] = useState<"week" | "month">("week");
  const [anchor, setAnchor] = useState<Date>(now);
  const todayKey = dayKey(now);

  // Bucket every item onto a local calendar day ONCE; both views read the same map.
  const buckets = useMemo(() => {
    const byDay: Record<string, { asg: any[]; sessions: any[]; exam: boolean }> = {};
    const at = (k: string) => (byDay[k] ??= { asg: [], sessions: [], exam: false });
    let overdueCount = 0;

    for (const a of assignments ?? []) {
      if (!a?.dueAt) continue;
      const submitted = Boolean(a.submission?.submittedAt);
      // Unsubmitted + past calendar day = overdue → folded into the today pin, not
      // painted on its (unactionable) due day. Submitted past work still shows on
      // its day — that's history, not debt.
      if (!submitted && (calendarDaysUntil(a.dueAt) ?? 0) < 0) { overdueCount++; continue; }
      at(dayKey(new Date(a.dueAt))).asg.push(a);
    }
    for (const s of plan?.sessions ?? []) {
      if (s?.date) at(dayKey(new Date(s.date + "T12:00:00"))).sessions.push(s);
    }
    if (plan?.exam_date) at(dayKey(new Date(plan.exam_date + "T12:00:00"))).exam = true;

    return { byDay, overdueCount };
  }, [assignments, plan, srsDue, now]);

  // Ordered chip list for one day — urgency first (pin, exam), then deadlines,
  // then planned study, then reviews. Both views derive from this.
  const dayChips = (date: Date): Chip[] => {
    const k = dayKey(date);
    const isToday = k === todayKey;
    const b = buckets.byDay[k];
    const chips: Chip[] = [];
    if (isToday && buckets.overdueCount > 0) {
      const t = `${buckets.overdueCount} overdue assignment${buckets.overdueCount === 1 ? "" : "s"} — pinned to today`;
      chips.push({ label: `${buckets.overdueCount} overdue`, title: t, color: CAL_COLORS.overdue });
    }
    if (b?.exam) chips.push({ label: "EXAM", title: `Exam · ${plan?.exam_date}`, color: CAL_COLORS.exam, outlined: true });
    for (const a of b?.asg ?? []) {
      const unsubmitted = !a.submission?.submittedAt;
      chips.push({
        label: a.name ?? "Assignment",
        title: `${a.name ?? "Assignment"} · due ${isToday ? "today" : k}${unsubmitted ? "" : " · submitted"}`,
        color: isToday && unsubmitted ? CAL_COLORS.due_today : CAL_COLORS.assignment,
      });
    }
    for (const s of b?.sessions ?? []) {
      chips.push({ label: s.topic ?? "Study session", title: `Study: ${s.topic ?? "session"}${s.estimatedMinutes ? ` · ~${s.estimatedMinutes} min` : ""}`, color: CAL_COLORS.plan_session });
    }
    if (isToday && srsDue > 0) {
      chips.push({ label: `${srsDue} review${srsDue === 1 ? "" : "s"}`, title: `${srsDue} flashcard${srsDue === 1 ? "" : "s"} due for review`, color: CAL_COLORS.srs });
    }
    return chips;
  };

  // ── Range label — week: "Jul 20 – Jul 26, 2026"; month: "July 2026" ──
  const fmt = (d: Date, opts: any) => d.toLocaleDateString("en-US", opts);
  const weekStart = startOfWeek(anchor);
  const weekEnd = addDays(weekStart, 6);
  const rangeLabel = view === "month"
    ? fmt(anchor, { month: "long", year: "numeric" })
    : weekStart.getFullYear() !== weekEnd.getFullYear()
    ? `${fmt(weekStart, { month: "short", day: "numeric", year: "numeric" })} – ${fmt(weekEnd, { month: "short", day: "numeric", year: "numeric" })}`
    : `${fmt(weekStart, { month: "short", day: "numeric" })} – ${fmt(weekEnd, { month: "short", day: "numeric" })}, ${weekEnd.getFullYear()}`;

  const nav = (dir: -1 | 1) => setAnchor(view === "week"
    ? addDays(anchor, dir * 7)
    : new Date(anchor.getFullYear(), anchor.getMonth() + dir, 1));

  // Month grid: full Sun–Sat rows covering the anchor month (up to 6).
  const monthWeeks = useMemo(() => {
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const last = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
    const weeks: Date[][] = [];
    for (let cur = startOfWeek(first); cur <= last; cur = addDays(cur, 7)) {
      weeks.push(Array.from({ length: 7 }, (_, i) => addDays(cur, i)));
    }
    return weeks;
  }, [anchor]);

  const navBtn: any = {
    background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)",
    color: "var(--text-secondary)", borderRadius: 8, cursor: "pointer", fontFamily: "inherit",
    display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "3px 7px",
  };

  // Weekday initials — same treatment in both views/sizes: 10px, uppercase, spaced, dim.
  const weekdayStyle = (active: boolean): any => ({
    fontSize: 10, fontWeight: 600, letterSpacing: "1.2px", textTransform: "uppercase" as const,
    color: active ? "rgb(var(--teal-rgb))" : "var(--text-dim)",
  });

  // Today highlight — softer but larger than v1: whole-column tint + a 1.5px ring
  // (non-today edges stay transparent at the same width so nothing shifts).
  const todayFrame = (isToday: boolean) => ({
    background: isToday ? "rgba(var(--teal-rgb),0.07)" : "transparent",
    border: isToday ? "1.5px solid rgba(var(--teal-rgb),0.35)" : "1.5px solid transparent",
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: sz.containerGap, padding: sz.containerPad, minWidth: 0, fontFamily: "var(--font-sans)", height: "100%", boxSizing: "border-box" as const }}>

      {/* ── Header: [Week|Month] [‹ Today ›] ……… range label — separated from the
          grid by a hairline so the controls read as a toolbar, not floating chips. ── */}
      <div style={{
        display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
        paddingBottom: 12, borderBottom: "1px solid rgba(255,255,255,0.06)",
      }}>
        <div style={{ display: "inline-flex", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 999, padding: 2 }}>
          {(["week", "month"] as const).map(v => (
            <button key={v} onClick={() => setView(v)} style={{
              border: "none", borderRadius: 999, padding: "4px 12px", fontSize: 11.5, cursor: "pointer", fontFamily: "inherit",
              background: view === v ? "rgba(var(--teal-rgb),0.18)" : "transparent",
              color: view === v ? "rgb(var(--teal-rgb))" : "var(--text-dim)",
              fontWeight: view === v ? 600 : 500,
            }}>{v === "week" ? "Week" : "Month"}</button>
          ))}
        </div>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <button aria-label="Previous" onClick={() => nav(-1)} style={navBtn}><ChevronLeft size={13} /></button>
          <button onClick={() => setAnchor(now)} style={{ ...navBtn, fontSize: 11, fontWeight: 600, padding: "4px 10px" }}>Today</button>
          <button aria-label="Next" onClick={() => nav(1)} style={navBtn}><ChevronRight size={13} /></button>
        </div>
        <span style={{
          marginLeft: "auto", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)",
          fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap",
        }}>{rangeLabel}</span>
      </div>

      {/* ── WEEK VIEW — 7 columns, chips under each day ── */}
      {view === "week" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 6 }}>
          {Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)).map((d, i) => {
            const isToday = dayKey(d) === todayKey;
            const chips = dayChips(d);
            const hidden = chips.slice(sz.weekChipMax);
            return (
              <div key={dayKey(d)} style={{
                minHeight: sz.weekColMinH, minWidth: 0, borderRadius: 10, padding: sz.weekColPad,
                display: "flex", flexDirection: "column", gap: sz.chipGap, alignItems: "stretch",
                boxSizing: "border-box" as const,
                ...todayFrame(isToday),
              }}>
                <div style={{ textAlign: "center", marginBottom: 5 }}>
                  <div style={weekdayStyle(isToday)}>{WEEKDAY_INITIALS[i]}</div>
                  <div style={{
                    fontSize: sz.dayNumFont, fontWeight: isToday ? 700 : 500, fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums",
                    marginTop: 2,
                    color: isToday ? "rgb(var(--teal-rgb))" : "var(--text-secondary)",
                  }}>{d.getDate()}</div>
                </div>
                {chips.slice(0, sz.weekChipMax).map((c, j) => (
                  <div key={j} title={c.title} style={{
                    fontSize: sz.chipFont, lineHeight: sz.chipLineH, padding: sz.chipPad, borderRadius: 6,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    background: c.outlined ? "transparent" : `rgba(${c.color},0.14)`,
                    border: c.outlined ? `1px solid rgba(${c.color},0.55)` : "1px solid transparent",
                    color: `rgba(${c.color},0.95)`,
                    fontWeight: c.outlined ? 700 : 500,
                    letterSpacing: c.outlined ? "0.5px" : undefined,
                    textAlign: c.outlined ? ("center" as const) : ("left" as const),
                  }}>{c.label}</div>
                ))}
                {hidden.length > 0 && (
                  <div title={hidden.map(c => c.title).join("\n")} style={{ fontSize: sz.chipFont - 1, color: "var(--text-dim)", padding: "1px 8px" }}>
                    +{hidden.length} more
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── MONTH VIEW — dots per day (full size: 2 mini text chips first, then dots);
          clicking a day zooms to its week ── */}
      {view === "month" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 3 }}>
            {WEEKDAY_INITIALS.map((w, i) => (
              <div key={i} style={{ textAlign: "center", padding: "2px 0 4px", ...weekdayStyle(false) }}>{w}</div>
            ))}
          </div>
          {monthWeeks.map((week, wi) => (
            <div key={wi} style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 3 }}>
              {week.map(d => {
                const isToday = dayKey(d) === todayKey;
                const outside = d.getMonth() !== anchor.getMonth();
                const chips = dayChips(d);
                const textChips = chips.slice(0, sz.monthTextChips);
                const dotChips = chips.slice(sz.monthTextChips, sz.monthTextChips + 3);
                return (
                  <button
                    key={dayKey(d)}
                    title={chips.length ? chips.map(c => c.title).join("\n") : undefined}
                    onClick={() => { setAnchor(d); setView("week"); onDayFocus?.(d); }}
                    style={{
                      minWidth: 0, minHeight: sz.monthCellMinH, borderRadius: 8, padding: "6px 4px 7px", cursor: "pointer",
                      display: "flex", flexDirection: "column", alignItems: "stretch", gap: 4,
                      fontFamily: "inherit", boxSizing: "border-box" as const,
                      opacity: outside ? 0.35 : 1,
                      ...todayFrame(isToday),
                    }}
                  >
                    <span style={{
                      fontSize: sz.monthDayFont, fontWeight: isToday ? 700 : 500, fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums",
                      color: isToday ? "rgb(var(--teal-rgb))" : "var(--text-secondary)", textAlign: "center" as const,
                    }}>{d.getDate()}</span>
                    {textChips.map((c, j) => (
                      <span key={`t${j}`} style={{
                        fontSize: 10.5, lineHeight: "13px", padding: "1.5px 6px", borderRadius: 5,
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        textAlign: c.outlined ? ("center" as const) : ("left" as const),
                        background: c.outlined ? "transparent" : `rgba(${c.color},0.14)`,
                        border: c.outlined ? `1px solid rgba(${c.color},0.55)` : "1px solid transparent",
                        color: `rgba(${c.color},0.95)`, fontWeight: c.outlined ? 700 : 500,
                      }}>{c.label}</span>
                    ))}
                    <span style={{ display: "flex", gap: 3, minHeight: sz.dot, justifyContent: "center" }}>
                      {dotChips.map((c, j) => (
                        <span key={j} style={{
                          width: sz.dot, height: sz.dot, borderRadius: 999, display: "inline-block",
                          background: c.outlined ? "transparent" : `rgba(${c.color},0.9)`,
                          border: c.outlined ? `1px solid rgba(${c.color},0.9)` : "none",
                          boxSizing: "border-box" as const,
                        }} />
                      ))}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {/* ── Legend — the color code, spelled out once at the card's bottom edge ── */}
      <div style={{
        display: "flex", alignItems: "center", gap: sz.legendItemGap, rowGap: 8, flexWrap: "wrap", marginTop: "auto",
        borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 12,
      }}>
        {([
          ["Overdue/Due", CAL_COLORS.overdue, false],
          ["Assignments", CAL_COLORS.assignment, false],
          ["Plan sessions", CAL_COLORS.plan_session, false],
          ["Exam", CAL_COLORS.exam, true],
          ["Reviews", CAL_COLORS.srs, false],
        ] as [string, string, boolean][]).map(([label, color, outlined]) => (
          <span key={label} style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 11, color: "var(--text-dim)" }}>
            <span style={{
              width: 6, height: 6, borderRadius: 999, display: "inline-block", boxSizing: "border-box" as const,
              background: outlined ? "transparent" : `rgba(${color},0.9)`,
              border: outlined ? `1px solid rgba(${color},0.9)` : "none",
            }} />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

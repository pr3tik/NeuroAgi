// TimeGridWeek.tsx — the Calendar tab's REAL week view: a Google-Calendar-style
// time grid (hour slots 7:00–23:00) instead of chip columns.
//
// Division of labor: WeekCalendar stays the all-day/chip surface (Home card +
// Month view); this component owns "what time, exactly?" — assignment due markers
// at their real dueAt instants and Reggie's study blocks at real evening slots.
//
// It is also the EDITABLE surface: drag a block to reschedule (15-min snap,
// across days), click an empty slot to add a 45-min "Study session", hover → ×
// to delete. Edits persist in localStorage under `storageKey` (per user) using
// the schema owned by src/lib/studyBlocks.ts (readCalendarEdits/applyCalendarEdits)
// so the "Reggie recommends" list below the grid reads the exact same truth.
// Drag pattern mirrors BoardCards: local preview state at 60fps, one commit on
// release.

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { CAL_COLORS } from "./WeekCalendar";
import { calendarDaysUntil } from "../lib/dueDate";
import {
  SuggestedBlock, CalendarBlock, CalendarEdits,
  readCalendarEdits, writeCalendarEdits, applyCalendarEdits,
} from "../lib/studyBlocks";

// ── Grid geometry — one place for every pixel↔minute conversion ──────────────
const START_HOUR = 7;
const END_HOUR = 23;                          // last labeled line; grid ends here
const START_MIN = START_HOUR * 60;            // 420
const END_MIN = END_HOUR * 60;                // 1380
const HOUR_PX = 44;   // dense enough to fit ~9 visible hours in the crunched viewport
const PX_PER_MIN = HOUR_PX / 60;              // 0.8
const GRID_H = (END_HOUR - START_HOUR) * HOUR_PX;  // 768
const GUTTER_W = 52;
const DAY_MIN_W = 92;                         // columns scroll horizontally below this
const SNAP = 15;                              // minutes
const NEW_BLOCK_MIN = 45;
const DRAG_THRESHOLD_PX = 4;                  // below this a press is a click, not a drag

const minToY = (min: number) => (min - START_MIN) * PX_PER_MIN;
const yToMin = (y: number) => START_MIN + y / PX_PER_MIN;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// Local-day helpers — same construction-from-parts style as WeekCalendar (DST-safe).
const pad = (n: number) => String(n).padStart(2, "0");
const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const startOfWeek = (d: Date) => addDays(d, -d.getDay());   // Sunday-first, like WeekCalendar
const WEEKDAY_INITIALS = ["S", "M", "T", "W", "T", "F", "S"];

// "6:00 PM" / "11:59 PM" from minutes-since-midnight.
const fmtMin = (min: number) => {
  const h24 = Math.floor(min / 60) % 24;
  const m = Math.round(min % 60);
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h}:${pad(m)} ${h24 >= 12 ? "PM" : "AM"}`;
};
// Compact range: "6:00 – 6:45 PM" (meridiem only once when it matches).
const fmtRange = (start: number, minutes: number) => {
  const end = start + minutes;
  const a = fmtMin(start), b = fmtMin(end);
  const [at, am] = [a.slice(0, -3), a.slice(-2)];
  const bm = b.slice(-2);
  return am === bm ? `${at} – ${b}` : `${a} – ${b}`;
};

const RED = CAL_COLORS.overdue;               // "255,100,90"
const LAV = CAL_COLORS.plan_session;          // var(--gold-rgb) — ice-lavender
const PERI = CAL_COLORS.assignment;           // var(--teal-rgb) — periwinkle
const GREEN = CAL_COLORS.srs;
const HAIRLINE = "rgba(255,255,255,0.05)";
// Sticky gutter/header cells need an opaque-ish ground so scrolled columns don't
// bleed through — matches the glass card sitting on the near-black page bg.
const STICKY_BG = "rgb(19,19,24)";

type DragState = {
  id: string;
  date: string;            // preview position (committed on release)
  startMin: number;
  minutes: number;
  grabOffsetMin: number;   // where inside the block the pointer grabbed it
  originX: number;
  originY: number;
  moved: boolean;          // false until the pointer clears DRAG_THRESHOLD_PX
};

export default function TimeGridWeek({
  assignments = [],
  plan = null,
  suggested = [],
  srsDue = 0,
  now = new Date(),
  storageKey,
}: {
  assignments?: any[];
  plan?: { exam_date?: string; sessions?: any[] } | null;
  suggested?: SuggestedBlock[];
  srsDue?: number;
  now?: Date;
  storageKey: string;
}) {
  const [anchor, setAnchor] = useState<Date>(now);
  const [edits, setEdits] = useState<CalendarEdits>(() => readCalendarEdits(storageKey));
  const [drag, setDrag] = useState<DragState | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const colsRef = useRef<HTMLDivElement | null>(null);
  const vScrollRef = useRef<HTMLDivElement | null>(null);
  // Open on the useful hours: just above now when today is in view, else 9:00.
  useEffect(() => {
    const el = vScrollRef.current;
    if (!el) return;
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const target = nowMin >= START_MIN && nowMin <= END_MIN ? Math.max(START_MIN, nowMin - 90) : 9 * 60;
    el.scrollTop = ((target - START_MIN) / 60) * HOUR_PX;
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  // Click-vs-drag guard for empty-slot creation: remember where the press started.
  const pressRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => { setEdits(readCalendarEdits(storageKey)); }, [storageKey]);

  // Single commit point: state + localStorage + a window event so the
  // "Reggie recommends" list (same page, same storage) re-reads immediately.
  const commitEdits = (next: CalendarEdits) => {
    setEdits(next);
    writeCalendarEdits(storageKey, next);
    try { window.dispatchEvent(new CustomEvent("fschool:calendar-edits")); } catch { /* SSR/tests */ }
  };

  const todayKey = dayKey(now);
  const weekStart = startOfWeek(anchor);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [+weekStart]);

  // ── The final block list: suggestions ⊕ user edits (shared merge) ──────────
  const blocks = useMemo(() => applyCalendarEdits(suggested ?? [], edits), [suggested, edits]);

  // ── All-day buckets: exam / plan sessions per day + today's pinned counts ──
  const allDay = useMemo(() => {
    const sessions: Record<string, any[]> = {};
    for (const s of plan?.sessions ?? []) {
      if (s?.date) (sessions[dayKey(new Date(s.date + "T12:00:00"))] ??= []).push(s);
    }
    const examKey = plan?.exam_date ? dayKey(new Date(plan.exam_date + "T12:00:00")) : null;
    let overdue = 0;
    for (const a of assignments ?? []) {
      if (a?.dueAt && !a.submission?.submittedAt && (calendarDaysUntil(a.dueAt) ?? 0) < 0) overdue++;
    }
    return { sessions, examKey, overdue };
  }, [assignments, plan]);

  // ── Timed due markers, bucketed by day. Same overdue rule as WeekCalendar:
  // unsubmitted past-due folds into the today chip, it doesn't paint its old day. ──
  const dueByDay = useMemo(() => {
    const g: Record<string, { name: string; min: number; submitted: boolean }[]> = {};
    for (const a of assignments ?? []) {
      if (!a?.dueAt) continue;
      const due = new Date(a.dueAt);
      if (isNaN(due.getTime())) continue;
      const submitted = Boolean(a.submission?.submittedAt);
      if (!submitted && (calendarDaysUntil(a.dueAt) ?? 0) < 0) continue;
      (g[dayKey(due)] ??= []).push({
        name: a.name ?? a.title ?? "Assignment",
        min: due.getHours() * 60 + due.getMinutes(),
        submitted,
      });
    }
    for (const k in g) g[k].sort((x, y) => x.min - y.min);
    return g;
  }, [assignments, now]);

  // ── Pointer → grid coordinates (via the columns container, so the math holds
  // wherever the grid sits and however far it's scrolled) ──────────────────────
  const pointToSlot = (clientX: number, clientY: number) => {
    const r = colsRef.current?.getBoundingClientRect();
    if (!r || !r.width) return null;
    const dayIdx = clamp(Math.floor(((clientX - r.left) / r.width) * 7), 0, 6);
    return { dayIdx, min: yToMin(clientY - r.top) };
  };

  // ── Drag a block (BoardCards pattern: preview locally, commit on release) ──
  const beginBlockDrag = (b: CalendarBlock) => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation(); e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    const p = pointToSlot(e.clientX, e.clientY);
    setDrag({
      id: b.id, date: b.date, startMin: b.startMin, minutes: b.minutes,
      grabOffsetMin: p ? p.min - b.startMin : 0,
      originX: e.clientX, originY: e.clientY, moved: false,
    });
  };
  const moveBlockDrag = (e: React.PointerEvent) => {
    if (!drag) return;
    const p = pointToSlot(e.clientX, e.clientY);
    if (!p) return;
    setDrag(d => {
      if (!d) return d;
      const moved = d.moved || Math.hypot(e.clientX - d.originX, e.clientY - d.originY) > DRAG_THRESHOLD_PX;
      if (!moved) return d;
      const snapped = Math.round((p.min - d.grabOffsetMin) / SNAP) * SNAP;
      return {
        ...d, moved: true,
        date: dayKey(weekDays[p.dayIdx]),
        startMin: clamp(snapped, START_MIN, END_MIN - d.minutes),
      };
    });
  };
  const endBlockDrag = () => {
    if (drag?.moved) {
      commitEdits({
        ...edits,
        overrides: { ...edits.overrides, [drag.id]: { date: drag.date, startMin: drag.startMin } },
      });
    }
    setDrag(null);
  };

  // ── Click an empty slot → new 45-min "Study session" ───────────────────────
  const onGridPointerDown = (e: React.PointerEvent) => {
    if (e.target === e.currentTarget) pressRef.current = { x: e.clientX, y: e.clientY };
  };
  const onGridClick = (e: React.MouseEvent) => {
    if (e.target !== e.currentTarget) return;              // a child (block/marker) owns this
    const press = pressRef.current;
    pressRef.current = null;
    if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > DRAG_THRESHOLD_PX) return;
    const p = pointToSlot(e.clientX, e.clientY);
    if (!p) return;
    const startMin = clamp(Math.floor(p.min / SNAP) * SNAP, START_MIN, END_MIN - NEW_BLOCK_MIN);
    const id = `u-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    commitEdits({
      ...edits,
      created: [...edits.created, {
        id, date: dayKey(weekDays[p.dayIdx]), startMin, minutes: NEW_BLOCK_MIN, title: "Study session",
      }],
    });
  };

  // ── Delete (hover ×): suggested → dismissed list; created → removed ────────
  const deleteBlock = (b: CalendarBlock) => {
    const overrides = { ...edits.overrides };
    delete overrides[b.id];
    commitEdits(b.kind === "suggested"
      ? { ...edits, overrides, dismissed: [...edits.dismissed.filter(id => id !== b.id), b.id] }
      : { ...edits, overrides, created: edits.created.filter(c => String(c.id) !== b.id) });
  };

  // ── Nav row bits (visual language borrowed from WeekCalendar's toolbar) ────
  const fmt = (d: Date, opts: any) => d.toLocaleDateString("en-US", opts);
  const weekEnd = addDays(weekStart, 6);
  const rangeLabel = weekStart.getFullYear() !== weekEnd.getFullYear()
    ? `${fmt(weekStart, { month: "short", day: "numeric", year: "numeric" })} – ${fmt(weekEnd, { month: "short", day: "numeric", year: "numeric" })}`
    : `${fmt(weekStart, { month: "short", day: "numeric" })} – ${fmt(weekEnd, { month: "short", day: "numeric" })}, ${weekEnd.getFullYear()}`;
  const navBtn: any = {
    background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)",
    color: "var(--text-secondary)", borderRadius: 8, cursor: "pointer", fontFamily: "inherit",
    display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "3px 7px",
  };

  // Current-time line: today's column only, hidden outside the 7:00–23:00 window.
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const showNowLine = nowMin >= START_MIN && nowMin <= END_MIN;
  const todayIdx = weekDays.findIndex(d => dayKey(d) === todayKey);

  const allDayChip = (color: string, label: string, title: string, outlined = false, key?: any) => (
    <span key={key} title={title} style={{
      fontSize: 10.5, lineHeight: "14px", padding: "2px 7px", borderRadius: 5, maxWidth: "100%",
      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", boxSizing: "border-box" as const,
      background: outlined ? "transparent" : `rgba(${color},0.14)`,
      border: outlined ? `1px solid rgba(${color},0.55)` : "1px solid transparent",
      color: `rgba(${color},0.95)`, fontWeight: outlined ? 700 : 500,
      letterSpacing: outlined ? "0.5px" : undefined,
    }}>{label}</span>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "16px 18px 14px", minWidth: 0, fontFamily: "var(--font-sans)", boxSizing: "border-box" as const }}>

      {/* ── Compact nav: ‹ Today › ……… range label ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, paddingBottom: 12, borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <button aria-label="Previous week" onClick={() => setAnchor(addDays(anchor, -7))} style={navBtn}><ChevronLeft size={13} /></button>
          <button onClick={() => setAnchor(now)} style={{ ...navBtn, fontSize: 11, fontWeight: 600, padding: "4px 10px" }}>Today</button>
          <button aria-label="Next week" onClick={() => setAnchor(addDays(anchor, 7))} style={navBtn}><ChevronRight size={13} /></button>
        </div>
        <span style={{
          marginLeft: "auto", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)",
          fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap",
        }}>{rangeLabel}</span>
      </div>

      {/* ── Scroll container: header + all-day lane + time grid share one column
          template so everything stays aligned; the left gutter is sticky. ── */}
      <div style={{ overflowX: "auto", overflowY: "hidden" }}>
        <div style={{ minWidth: GUTTER_W + 7 * DAY_MIN_W }}>

          {/* Day headers */}
          <div style={{ display: "grid", gridTemplateColumns: `${GUTTER_W}px repeat(7, minmax(0,1fr))` }}>
            <div style={{ position: "sticky", left: 0, zIndex: 6, background: STICKY_BG }} />
            {weekDays.map((d, i) => {
              const isToday = dayKey(d) === todayKey;
              return (
                <div key={i} style={{
                  textAlign: "center", padding: "6px 4px 7px", borderRadius: 10, minWidth: 0,
                  // Today ringed + tinted — same treatment as WeekCalendar's todayFrame.
                  background: isToday ? "rgba(var(--teal-rgb),0.07)" : "transparent",
                  border: isToday ? "1.5px solid rgba(var(--teal-rgb),0.35)" : "1.5px solid transparent",
                  boxSizing: "border-box" as const,
                }}>
                  <div style={{
                    fontSize: 10, fontWeight: 600, letterSpacing: "1.2px", textTransform: "uppercase" as const,
                    color: isToday ? "rgb(var(--teal-rgb))" : "var(--text-dim)",
                  }}>{WEEKDAY_INITIALS[i]}</div>
                  <div style={{
                    fontSize: 15, fontWeight: isToday ? 700 : 500, marginTop: 2,
                    fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums",
                    color: isToday ? "rgb(var(--teal-rgb))" : "var(--text-secondary)",
                  }}>{d.getDate()}</div>
                </div>
              );
            })}
          </div>

          {/* All-day lane — date-only items live here, not on the hour grid */}
          <div style={{
            display: "grid", gridTemplateColumns: `${GUTTER_W}px repeat(7, minmax(0,1fr))`,
            borderTop: `1px solid ${HAIRLINE}`, borderBottom: "1px solid rgba(255,255,255,0.08)",
          }}>
            <div style={{
              position: "sticky", left: 0, zIndex: 6, background: STICKY_BG,
              display: "flex", alignItems: "center", justifyContent: "flex-end", paddingRight: 8,
              fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "0.06em",
              textTransform: "uppercase" as const, color: "var(--text-dim)",
            }}>all-day</div>
            {weekDays.map((d, i) => {
              const k = dayKey(d);
              const isToday = k === todayKey;
              const chips: React.ReactNode[] = [];
              if (isToday && allDay.overdue > 0) {
                chips.push(allDayChip(RED, `${allDay.overdue} overdue`,
                  `${allDay.overdue} overdue assignment${allDay.overdue === 1 ? "" : "s"} — pinned to today`, false, "od"));
              }
              if (allDay.examKey === k) {
                chips.push(allDayChip(RED, "EXAM", `Exam · ${plan?.exam_date}`, true, "ex"));
              }
              for (const [j, s] of (allDay.sessions[k] ?? []).entries()) {
                chips.push(allDayChip(LAV, s.topic ?? "Study session",
                  `Study: ${s.topic ?? "session"}${s.estimatedMinutes ? ` · ~${s.estimatedMinutes} min` : ""}`, false, `s${j}`));
              }
              if (isToday && srsDue > 0) {
                chips.push(allDayChip(GREEN, `${srsDue} review${srsDue === 1 ? "" : "s"}`,
                  `${srsDue} flashcard${srsDue === 1 ? "" : "s"} due for review`, false, "srs"));
              }
              return (
                <div key={k} style={{
                  minHeight: 26, minWidth: 0, padding: "4px 3px", display: "flex", flexWrap: "wrap",
                  alignContent: "flex-start", gap: 3, boxSizing: "border-box" as const,
                  borderLeft: i > 0 ? `1px solid ${HAIRLINE}` : "none",
                  background: isToday ? "rgba(var(--teal-rgb),0.04)" : "transparent",
                }}>{chips}</div>
              );
            })}
          </div>

          {/* Time grid body — its OWN scroll viewport so the whole card fits on the
              page: day headers + all-day lane stay pinned above; hours scroll inside.
              data-lenis-prevent stops the app-wide smooth-scroll from eating the wheel. */}
          <div
            ref={vScrollRef}
            data-lenis-prevent=""
            style={{ maxHeight: "min(56vh, 528px)", overflowY: "auto", overscrollBehavior: "contain" }}
          >
          <div style={{ display: "grid", gridTemplateColumns: `${GUTTER_W}px 1fr` }}>

            {/* Hour gutter — sticky so labels survive horizontal scroll */}
            <div style={{ position: "sticky", left: 0, zIndex: 6, background: STICKY_BG, height: GRID_H }}>
              <div style={{ position: "relative", height: GRID_H }}>
                {Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => START_HOUR + i).map(h => (
                  <span key={h} style={{
                    position: "absolute", top: (h - START_HOUR) * HOUR_PX - 6, right: 8,
                    fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-dim)",
                    fontVariantNumeric: "tabular-nums", lineHeight: "12px",
                  }}>{h}:00</span>
                ))}
              </div>
            </div>

            {/* 7 day columns */}
            <div ref={colsRef} style={{ position: "relative", height: GRID_H }}>
              {/* Hour lines across the full width */}
              {Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => (
                <div key={i} style={{
                  position: "absolute", left: 0, right: 0, top: i * HOUR_PX,
                  borderTop: `1px solid ${HAIRLINE}`, pointerEvents: "none",
                }} />
              ))}

              <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0,1fr))", height: GRID_H }}>
                {weekDays.map((d, i) => {
                  const k = dayKey(d);
                  const isToday = k === todayKey;
                  return (
                    <div
                      key={k}
                      onPointerDown={onGridPointerDown}
                      onClick={onGridClick}
                      title="Click an empty slot to add a study block"
                      style={{
                        position: "relative", minWidth: 0, height: GRID_H, cursor: "copy",
                        borderLeft: i > 0 ? `1px solid ${HAIRLINE}` : "none",
                        background: isToday ? "rgba(var(--teal-rgb),0.04)" : "transparent",
                        boxSizing: "border-box" as const,
                      }}
                    >
                      {/* Assignment due markers — thin, at the REAL due time (clamped
                          into view; the label keeps the true time) */}
                      {(dueByDay[k] ?? []).map((m, j) => {
                        const top = clamp(minToY(m.min), 0, GRID_H - 18);
                        const label = `⏰ ${m.name} · ${fmtMin(m.min)}`;
                        return (
                          <div
                            key={`due${j}`}
                            title={`${m.name} · due ${fmtMin(m.min)}${m.submitted ? " · submitted" : ""}`}
                            onPointerDown={e => e.stopPropagation()}
                            onClick={e => e.stopPropagation()}
                            style={{
                              position: "absolute", left: 2, right: 2, top, height: 18, zIndex: 2,
                              display: "flex", alignItems: "center", padding: "0 5px", borderRadius: 4,
                              background: `rgba(${RED},${m.submitted ? 0.07 : 0.13})`,
                              borderLeft: `2px solid rgba(${RED},${m.submitted ? 0.4 : 0.75})`,
                              fontSize: 10, fontWeight: 600, boxSizing: "border-box" as const,
                              color: `rgba(${RED},${m.submitted ? 0.6 : 0.95})`,
                            }}
                          >
                            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{label}</span>
                          </div>
                        );
                      })}

                      {/* The red now-line — today only, inside 7:00–23:00 */}
                      {isToday && showNowLine && todayIdx === i && (
                        <div style={{ position: "absolute", left: 0, right: 0, top: minToY(nowMin), zIndex: 4, pointerEvents: "none" }}>
                          <div style={{
                            position: "absolute", left: -3, top: -3, width: 7, height: 7, borderRadius: 999,
                            background: `rgb(${RED})`,
                          }} />
                          <div style={{ height: 1, background: `rgba(${RED},0.85)` }} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Study-block layer — ONE flat layer over all columns (the
                  BoardCards pattern). A block dragged across days only changes
                  its left offset, it never remounts into another column subtree,
                  so pointer capture survives the whole gesture. */}
              <div style={{ position: "absolute", inset: 0, zIndex: 3, pointerEvents: "none" }}>
                {blocks.map(b => {
                  const dragging = drag?.moved && drag.id === b.id;
                  const eff = dragging ? { ...b, date: drag!.date, startMin: drag!.startMin } : b;
                  const dayIdx = weekDays.findIndex(d => dayKey(d) === eff.date);
                  if (dayIdx < 0) return null;   // lives outside the visible week
                  const isSug = b.kind === "suggested";
                  const color = isSug ? LAV : PERI;
                  const h = Math.max(24, b.minutes * PX_PER_MIN);
                  const top = clamp(minToY(eff.startMin), 0, GRID_H - h);
                  return (
                    <div
                      key={b.id}
                      title={`${b.title} · ${fmtRange(eff.startMin, b.minutes)} — drag to reschedule`}
                      onPointerDown={beginBlockDrag(b)}
                      onPointerMove={moveBlockDrag}
                      onPointerUp={endBlockDrag}
                      onPointerCancel={endBlockDrag}
                      onClick={e => e.stopPropagation()}
                      onMouseEnter={() => setHoverId(b.id)}
                      onMouseLeave={() => setHoverId(h2 => (h2 === b.id ? null : h2))}
                      style={{
                        position: "absolute", top, height: h, zIndex: dragging ? 5 : undefined,
                        left: `calc(${dayIdx} * (100% / 7) + 3px)`,
                        width: "calc(100% / 7 - 6px)",
                        pointerEvents: "auto",
                        borderRadius: 7, padding: "3px 6px", boxSizing: "border-box" as const,
                        background: `rgba(${color},${dragging ? 0.22 : 0.1})`,
                        border: isSug ? `1.5px dashed rgba(${color},0.55)` : `1.5px solid rgba(${color},0.55)`,
                        cursor: dragging ? "grabbing" : "grab",
                        touchAction: "none", userSelect: "none",
                        overflow: "hidden",
                        boxShadow: dragging ? "0 6px 18px rgba(0,0,0,0.4)" : "none",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "flex-start", gap: 4 }}>
                        <span style={{
                          flex: 1, minWidth: 0, fontSize: 11, fontWeight: 600, lineHeight: "13px",
                          color: `rgba(${color},0.95)`,
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        }}>{b.title}</span>
                        {hoverId === b.id && !dragging && (
                          <button
                            title={isSug ? "Dismiss suggestion" : "Delete block"}
                            onPointerDown={e => e.stopPropagation()}
                            onClick={e => { e.stopPropagation(); deleteBlock(b); }}
                            style={{
                              display: "flex", flexShrink: 0, background: "rgba(0,0,0,0.25)", border: "none",
                              borderRadius: 4, padding: 1, cursor: "pointer", color: "rgba(255,255,255,0.65)",
                            }}
                          ><X size={11} /></button>
                        )}
                      </div>
                      <div style={{
                        fontSize: 9.5, lineHeight: "12px", marginTop: 1, color: `rgba(${color},0.75)`,
                        fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums",
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}>{fmtRange(eff.startMin, b.minutes)}</div>
                      {isSug && h >= 44 && (
                        <div style={{ fontSize: 9, lineHeight: "11px", marginTop: 1, color: `rgba(${color},0.6)`, whiteSpace: "nowrap" }}>
                          ✦ Reggie
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          </div>
        </div>
      </div>

      {/* ── Micro-legend for the grid's own vocabulary ── */}
      <div style={{
        display: "flex", alignItems: "center", gap: 16, rowGap: 8, flexWrap: "wrap",
        borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 12,
      }}>
        {([
          ["Due time", RED, "solid"],
          ["Reggie suggests", LAV, "dashed"],
          ["Your blocks", PERI, "solid"],
        ] as [string, string, "solid" | "dashed"][]).map(([label, color, styleKind]) => (
          <span key={label} style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 11, color: "var(--text-dim)" }}>
            <span style={{
              width: 14, height: 8, borderRadius: 3, display: "inline-block", boxSizing: "border-box" as const,
              border: `1.5px ${styleKind} rgba(${color},0.8)`, background: `rgba(${color},0.12)`,
            }} />
            {label}
          </span>
        ))}
        <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-dim)" }}>
          Drag blocks to reschedule · click an empty slot to add one
        </span>
      </div>
    </div>
  );
}

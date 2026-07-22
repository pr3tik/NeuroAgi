// CalendarPage.tsx — the dedicated Calendar tab: everything due, planned, and
// Reggie's recommended study times, on one full-page calendar.
//
// The Home "Today" card answers "what now?"; this page answers "what does my time
// look like?" — so it reuses the SAME inputs (assignments, exam plan, SRS count).
// Two views behind a page-level toggle:
//   Week  → TimeGridWeek: a real hour-slot time grid (7:00–23:00) with due markers
//           at their actual dueAt times and EDITABLE study blocks (drag to
//           reschedule, click an empty slot to add, × to dismiss). Edits persist
//           in localStorage per user.
//   Month → the shared WeekCalendar (size="full"), unchanged — same component as
//           the Home card, so the two surfaces can never disagree.
//
// "Reggie recommends" is deterministic (src/lib/studyBlocks.ts — no model calls):
// dashed lavender = suggestion, solid lavender = committed plan session. Same color
// (CAL_COLORS.plan_session = --gold-rgb) because both are study time; the border
// STYLE carries the commitment level. The list is merged through the SAME
// localStorage edits as the grid (applyCalendarEdits) so a dragged block shows its
// new time here too, a dismissed one disappears, and user-created blocks appear.

import { useEffect, useState, useMemo } from "react";
import { useApp } from "../context/AppContext";
import { supabase } from "../api/supabase";
import { SectionHeader } from "../components/uikit";
import WeekCalendar from "../components/WeekCalendar";
import TimeGridWeek from "../components/TimeGridWeek";
import {
  suggestStudyBlocks, applyCalendarEdits, readCalendarEdits, CalendarBlock,
} from "../lib/studyBlocks";
import { calendarDaysUntil } from "../lib/dueDate";
import { GraduationCap, Sparkles } from "lucide-react";

const GLASS = {
  background: "rgba(255,255,255,0.035)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 16,
  boxSizing: "border-box" as const,
};

// Date-only strings get the local-noon anchor before any day math — a bare UTC
// parse can shift them to the previous local day (same trick as Study.tsx).
const dayLabel = (dateStr: string) => {
  const d = calendarDaysUntil(dateStr + "T12:00:00");
  if (d === 0) return "Today";
  if (d === 1) return "Tomorrow";
  return new Date(dateStr + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
};

// "6:00 PM" from minutes-since-midnight — for the recommends list's time labels.
const fmtStart = (min: number) => {
  const h24 = Math.floor(min / 60) % 24, m = Math.round(min % 60);
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h}:${String(m).padStart(2, "0")} ${h24 >= 12 ? "PM" : "AM"}`;
};

export default function CalendarPage() {
  const { userId, assignments, courses } = useApp();
  const goPage = (k: string) => () => window.dispatchEvent(new CustomEvent("fschool:navigate", { detail: k }));

  // ── Loader: exam plans + SRS due count (same queries as Work.tsx / Study.tsx,
  // so this page always agrees with Home and Study about the live plan) ────────
  const [extras, setExtras] = useState<{ plans: any[]; dbCourseNames: Record<string, string>; srsDue: number }>({
    plans: [], dbCourseNames: {}, srsDue: 0,
  });
  useEffect(() => {
    if (!userId) return;
    let dead = false;
    (async () => {
      try {
        const [planR, srsR] = await Promise.all([
          supabase.from("exam_plans").select("id, course_id, exam_date, sessions, created_at")
            .eq("user_id", userId).gte("exam_date", new Date().toISOString().slice(0, 10))
            .order("exam_date", { ascending: true }).order("created_at", { ascending: false }),
          supabase.from("srs_reviews").select("card_key").eq("user_id", userId).lte("due_at", new Date().toISOString()),
        ]);
        const rows = (planR.data ?? []).filter((p: any) => Array.isArray(p?.sessions) && p.sessions.length > 0);

        // Plan writers disagree on course_id (manual = label, cron = courses-table
        // integer id). Resolve integer ids, then keep the FRESHEST plan per resolved
        // course — same dedupe as Study.tsx's StudyPlanSection.
        const numericIds = [...new Set(rows.map((p: any) => String(p.course_id)).filter((k: string) => /^\d+$/.test(k)))];
        let idMap: Record<string, string> = {};
        if (numericIds.length) {
          const { data: crs } = await supabase.from("courses").select("id, course_code, name").in("id", numericIds);
          for (const c of crs ?? []) idMap[String(c.id)] = c.course_code || c.name;
        }
        const resolvedKey = (p: any) => {
          const label = idMap[String(p.course_id)] ?? String(p.course_id);
          return String(label).split(/\s+/)[0].replace(/H\d.*$/, "").toUpperCase();
        };
        const byCourse: Record<string, any> = {};
        for (const p of rows) {
          const k = resolvedKey(p);
          if (!byCourse[k]) byCourse[k] = p; // ordering = nearest exam, newest first
        }
        if (!dead) setExtras({ plans: Object.values(byCourse), dbCourseNames: idMap, srsDue: (srsR.data ?? []).length });
      } catch { /* non-fatal — the page renders with assignments only */ }
    })();
    return () => { dead = true; };
  }, [userId]);

  const now = new Date();
  const plan = extras.plans[0] ?? null; // freshest plan for the nearest exam
  const courseLabel = (cid: any) => {
    const c: any = (courses ?? []).find((x: any) => String(x.dbId ?? x.id) === String(cid));
    return c?.courseCode || c?.name || extras.dbCourseNames[String(cid)] || String(cid ?? "Course");
  };

  // ── Page-level view toggle: Week = editable time grid, Month = WeekCalendar ──
  const [view, setView] = useState<"week" | "month">("week");
  const storageKey = "fschool_cal_" + userId;

  // ── Deterministic suggestions, merged with the user's calendar edits ────────
  const suggestions = useMemo(
    () => suggestStudyBlocks({ assignments: assignments ?? [], plan, now }),
    [assignments, plan],  // `now` changes every render; the inputs that matter are these two
  );
  // The grid writes localStorage and fires this event; re-read so the list below
  // always shows the block where the user actually put it.
  const [editsVersion, setEditsVersion] = useState(0);
  useEffect(() => {
    const bump = () => setEditsVersion(v => v + 1);
    window.addEventListener("fschool:calendar-edits", bump);
    window.addEventListener("storage", bump);  // cross-tab edits
    return () => {
      window.removeEventListener("fschool:calendar-edits", bump);
      window.removeEventListener("storage", bump);
    };
  }, []);
  const editedBlocks = useMemo(
    () => applyCalendarEdits(suggestions, readCalendarEdits(storageKey)),
    [suggestions, storageKey, editsVersion],
  );
  const byDay = useMemo(() => {
    const g: Record<string, CalendarBlock[]> = {};
    for (const b of editedBlocks) (g[b.date] ??= []).push(b);
    return Object.entries(g).sort(([a], [b]) => a.localeCompare(b));
  }, [editedBlocks]);
  const upcomingSessions = useMemo(() => {
    if (!plan) return [];
    return [...(Array.isArray(plan.sessions) ? plan.sessions : [])]
      .filter((s: any) => s?.date && (calendarDaysUntil(s.date + "T12:00:00") ?? -1) >= 0)
      .sort((a: any, b: any) => String(a.date).localeCompare(String(b.date)));
  }, [plan]);

  return (
    <div>
      {/* ── Header: title + the Week|Month segmented toggle ── */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 26, fontWeight: 600, color: "var(--text-primary)",
          marginBottom: 4, letterSpacing: "-0.3px", fontFamily: "var(--font-sans)" }}>
          Calendar
        </h1>
        <div style={{
          marginLeft: "auto", display: "inline-flex", background: "rgba(255,255,255,0.05)",
          border: "1px solid rgba(255,255,255,0.07)", borderRadius: 999, padding: 2, marginTop: 4,
        }}>
          {(["week", "month"] as const).map(v => (
            <button key={v} onClick={() => setView(v)} style={{
              border: "none", borderRadius: 999, padding: "5px 14px", fontSize: 12, cursor: "pointer", fontFamily: "inherit",
              background: view === v ? "rgba(var(--teal-rgb),0.18)" : "transparent",
              color: view === v ? "rgb(var(--teal-rgb))" : "var(--text-dim)",
              fontWeight: view === v ? 600 : 500,
            }}>{v === "week" ? "Week" : "Month"}</button>
          ))}
        </div>
      </div>
      <p style={{ color: "var(--text-dim)", fontSize: 14, marginBottom: 24 }}>
        {view === "week"
          ? "Your week, hour by hour — drag Reggie's blocks to reschedule, click an empty slot to add your own."
          : "Everything due, planned, and Reggie's recommended study times."}
      </p>

      {/* ── The calendar ── */}
      <div style={{ ...GLASS, marginBottom: 28 }}>
        {view === "week" ? (
          <TimeGridWeek
            assignments={assignments ?? []}
            plan={plan}
            suggested={suggestions}
            srsDue={extras.srsDue}
            now={now}
            storageKey={storageKey}
          />
        ) : (
          <WeekCalendar
            {...({ size: "full" } as any) /* parallel-branch prop — spread keeps TS happy until it lands */}
            assignments={assignments ?? []}
            plan={plan}
            srsDue={extras.srsDue}
            now={now}
          />
        )}
      </div>

      {/* ── Reggie recommends — the same blocks as the grid, list form ── */}
      <div style={{ marginBottom: 28 }}>
        <SectionHeader
          title="Reggie recommends"
          desc="Suggested prep blocks before each due date — dashed means suggested, solid means yours. Edits on the week grid show here too."
        />
        <div style={{ ...GLASS, padding: "6px 8px" }}>
          {byDay.length === 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 14px" }}>
              <Sparkles size={16} color="rgb(var(--gold-rgb))" style={{ flexShrink: 0 }} />
              <p style={{ margin: 0, fontSize: 13.5, color: "var(--text-secondary)", fontFamily: "var(--font-sans)" }}>
                Nothing to schedule — you're ahead.
              </p>
            </div>
          )}
          {byDay.map(([date, blocks], gi) => (
            <div key={date} style={{ padding: "10px 6px", borderTop: gi > 0 ? "1px solid rgba(255,255,255,0.06)" : "none" }}>
              <p style={{
                fontFamily: "var(--font-mono)", fontSize: 10.5, fontWeight: 600, letterSpacing: "0.08em",
                textTransform: "uppercase", color: "var(--text-dim)", margin: "0 0 8px 8px",
              }}>{dayLabel(date)}</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {blocks.map((b) => {
                  const isSug = b.kind === "suggested";
                  // Same border language as the grid: dashed lavender = Reggie's
                  // suggestion, solid periwinkle = a block the user created.
                  const edge = isSug ? "3px dashed rgba(var(--gold-rgb),0.6)" : "3px solid rgba(var(--teal-rgb),0.6)";
                  const wash = isSug ? "rgba(var(--gold-rgb),0.05)" : "rgba(var(--teal-rgb),0.05)";
                  return (
                    <div key={b.id} style={{
                      display: "flex", alignItems: "center", gap: 12, padding: "10px 12px",
                      borderLeft: edge, borderRadius: 8, background: wash, minWidth: 0,
                    }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{
                          margin: 0, fontSize: 13.5, fontWeight: 600, color: "var(--text-primary)",
                          fontFamily: "var(--font-sans)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        }}>{b.title}</p>
                        <p style={{ margin: "2px 0 0", fontSize: 11.5, color: "var(--text-dim)", fontFamily: "var(--font-sans)", fontVariantNumeric: "tabular-nums" }}>
                          {fmtStart(b.startMin)} · {b.minutes} min · {isSug ? "suggested" : "yours"}
                        </p>
                      </div>
                      <button onClick={goPage("studyAssistant")} style={{
                        flexShrink: 0, background: "rgba(var(--teal-rgb),0.14)",
                        border: "1px solid rgba(var(--teal-rgb),0.3)", color: "rgb(var(--teal-rgb))",
                        borderRadius: 9, padding: "7px 13px", fontSize: 12, fontWeight: 600,
                        cursor: "pointer", fontFamily: "inherit",
                      }}>Start with Reggie</button>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Committed plan — the solid counterpart to the dashed suggestions ── */}
      {plan && upcomingSessions.length > 0 && (
        <div style={{ marginBottom: 28 }}>
          <SectionHeader
            title="Committed plan"
            desc={`${courseLabel(plan.course_id)} · exam ${dayLabel(plan.exam_date)}`}
          />
          <div style={{ ...GLASS, padding: "6px 8px" }}>
            {upcomingSessions.map((s: any, i: number) => (
              <div key={`${s.date}:${i}`} style={{
                display: "flex", alignItems: "center", gap: 12, padding: "10px 12px",
                borderLeft: "3px solid rgba(var(--gold-rgb),0.75)", borderRadius: 8,
                marginTop: i > 0 ? 6 : 0, minWidth: 0,
              }}>
                <GraduationCap size={15} color="rgb(var(--gold-rgb))" style={{ flexShrink: 0 }} />
                <span style={{
                  fontFamily: "var(--font-mono)", fontSize: 11, width: 76, flexShrink: 0,
                  color: "var(--text-dim)", fontVariantNumeric: "tabular-nums",
                }}>{dayLabel(s.date)}</span>
                <p style={{
                  flex: 1, minWidth: 0, margin: 0, fontSize: 13.5, fontWeight: 500, color: "var(--text-primary)",
                  fontFamily: "var(--font-sans)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>{s.topic || "Study session"}</p>
                <span style={{ fontSize: 11.5, color: "var(--text-dim)", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>
                  {Number(s.estimatedMinutes) || 60} min
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

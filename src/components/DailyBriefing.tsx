// DailyBriefing.tsx — Top-of-home daily briefing card.
// Shows readiness, a brief stats summary, and study blocks.
// Deliberately does NOT list individual assignments — that's what
// the Upcoming Assignments section below is for.
// Client-pure: reads only from AppContext, no API calls.

import { useState } from "react";
import { useApp } from "../context/AppContext";

const MS_HOUR = 3_600_000;

function readinessBadge(overdueCount: number, dueTodayCount: number) {
  if (overdueCount === 0 && dueTodayCount === 0) return {
    label: "On track", color: "rgba(52,199,89,0.9)",
    bg: "rgba(52,199,89,0.05)", border: "rgba(52,199,89,0.2)",
  };
  if (overdueCount >= 5 || dueTodayCount >= 3) return {
    label: "Behind", color: "#FFB4AB",
    bg: "rgba(255,180,171,0.05)", border: "rgba(255,180,171,0.3)",
  };
  return {
    label: "Heads up", color: "#C8C5CB",
    bg: "rgba(52,53,53,0.5)", border: "rgba(255,255,255,0.08)",
  };
}

function fmtDue(dueAt: string, now: number): string {
  const h = (new Date(dueAt).getTime() - now) / MS_HOUR;
  if (h < 0)   return "overdue";
  if (h < 1)   return "due < 1h";
  if (h < 24)  return `due in ${Math.round(h)}h`;
  if (h < 48)  return "due tomorrow";
  return "due " + new Date(dueAt).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

export default function DailyBriefing({ isMobile }: { isMobile: boolean }) {
  const { courses, assignments, setPendingNav, setStudyConfig } = useApp();
  const [hoveredPill, setHoveredPill] = useState<number | null>(null);

  if (!courses.length && !assignments.length) return null;

  const now       = Date.now();
  const courseMap = new Map<string, any>(courses.map((c: any) => [String(c.id), c]));
  const pending   = (assignments as any[]).filter(a =>
    !a.submission?.submittedAt && a.dueAt && courseMap.has(String(a.courseId))
  );

  const dateLabel = new Date().toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric",
  });

  // Summary stats — just counts, never individual items
  const overdueCount  = pending.filter(a => new Date(a.dueAt).getTime() < now).length;
  const dueTodayCount = pending.filter(a => {
    const h = (new Date(a.dueAt).getTime() - now) / MS_HOUR;
    return h >= 0 && h < 24;
  }).length;
  const dueThisWeek   = pending.filter(a => {
    const h = (new Date(a.dueAt).getTime() - now) / MS_HOUR;
    return h >= 24 && h < 168;
  }).length;

  // Most urgent single item (earliest dueAt overall)
  const sortedPending = [...pending].sort(
    (a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime()
  );
  const topItem = sortedPending[0] as any | undefined;
  let topItemLabel = "";
  let topItemName  = "";
  if (topItem) {
    const h = (new Date(topItem.dueAt).getTime() - now) / MS_HOUR;
    topItemLabel = h < 0     ? "due now"
      : h < 1               ? "due in < 1h"
      : h < 24              ? `due in ${Math.round(h)}h`
      : `due in ${Math.round(h / 24)}d`;
    const raw: string = topItem.name ?? topItem.title ?? "Untitled";
    topItemName = raw.length > 32 ? raw.slice(0, 30) + "…" : raw;
  }

  // Upcoming events: next 2 non-overdue items, excluding topItem to avoid duplication
  const upcomingEvents = sortedPending
    .filter(a => new Date(a.dueAt).getTime() >= now && (!topItem || a.id !== topItem.id))
    .slice(0, 2) as any[];

  // Study blocks: top 3 courses by urgency, with a suggested focus time
  const urgencyMap = new Map<string, { overdue: number; today: number; week: number; total: number }>();
  pending.forEach((a: any) => {
    const key = String(a.courseId);
    if (!urgencyMap.has(key)) urgencyMap.set(key, { overdue: 0, today: 0, week: 0, total: 0 });
    const e = urgencyMap.get(key)!;
    const h = (new Date(a.dueAt).getTime() - now) / MS_HOUR;
    if (h < 0)        e.overdue++;
    else if (h < 24)  e.today++;
    else if (h < 168) e.week++;
    e.total++;
  });

  const studyBlocks = [...urgencyMap.entries()]
    .sort(([, a], [, b]) =>
      b.overdue !== a.overdue ? b.overdue - a.overdue :
      b.today   !== a.today   ? b.today   - a.today   :
      b.week    - a.week
    )
    .slice(0, 3)
    .map(([courseId, u]) => ({
      course: courseMap.get(courseId) as any,
      hours:  u.total >= 3 ? 3 : u.total === 2 ? 2 : 1,
    }))
    .filter(x => x.course);

  const badge    = readinessBadge(overdueCount, dueTodayCount);
  const allClear = overdueCount === 0 && dueTodayCount === 0 && dueThisWeek === 0;

  const statParts: string[] = [];
  if (overdueCount  > 0) statParts.push(`${overdueCount} overdue`);
  if (dueTodayCount > 0) statParts.push(`${dueTodayCount} due today`);

  const dimText  = { fontFamily: "Inter, sans-serif", fontSize: isMobile ? "12px" : "14px", color: "rgba(200,197,203,0.4)" as const, margin: 0, whiteSpace: "nowrap" as const };

  return (
    <div style={{
      borderRadius:   isMobile ? "16px" : "32px",
      background:     "linear-gradient(0deg, rgba(0,0,0,0.2), rgba(0,0,0,0.2)), radial-gradient(90.05% 130.96% at 9.95% 57.96%, rgba(35,35,36,0.6) 17.31%, rgba(74,74,75,0.6) 38.94%, rgba(117,117,118,0.6) 57.52%, rgba(25,25,25,0.6) 99.04%)",
      border:         "1px solid rgba(255,255,255,0.08)",
      backdropFilter: "blur(10px)",
      boxShadow:      "inset 0 0 0 2px rgba(255,255,255,0.02)",
      padding:        isMobile ? "20px" : "32px",
      width:          "100%",
      boxSizing:      "border-box" as const,
      display:        "flex",
      flexDirection:  "column",
      gap:            isMobile ? "14px" : "20px",
    }}>

      {/* Header: label + date (left), readiness badge (right) */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          <p style={{
            fontFamily: "Inter, sans-serif", fontWeight: 400,
            fontSize: isMobile ? "11px" : "13px",
            color: "rgba(200,197,203,0.5)", margin: 0, letterSpacing: "0.4px",
          }}>
            DAILY BRIEFING
          </p>
          <p style={{
            fontFamily: "Inter, sans-serif", fontWeight: 400,
            fontSize: isMobile ? "14px" : "16px",
            color: "#C8C5CB", margin: 0,
          }}>
            {dateLabel}
          </p>
        </div>
        <span style={{
          padding: isMobile ? "2px 10px" : "4px 14px",
          background: badge.bg, border: `1px solid ${badge.border}`,
          borderRadius: "9999px", fontFamily: "Inter, sans-serif",
          fontWeight: 400, fontSize: isMobile ? "10px" : "14px",
          color: badge.color, whiteSpace: "nowrap", marginTop: "2px",
        }}>
          {badge.label}
        </span>
      </div>

      {/* Two-column body */}
      <div style={{
        display:       "flex",
        flexDirection: isMobile ? "column" : "row",
        gap:           isMobile ? "14px" : "48px",
        alignItems:    isMobile ? "flex-start" : "center",
      }}>

        {/* Left: summary counts + most urgent */}
        <div style={{ flex: "1 1 0", display: "flex", flexDirection: "column", gap: isMobile ? "10px" : "14px" }}>
          <p style={{
            fontFamily: "Inter, sans-serif",
            fontSize:   isMobile ? "14px" : "20px",
            color:      allClear ? "rgba(200,197,203,0.5)" : "#E3E2E2",
            margin:     0,
            lineHeight: 1.3,
          }}>
            {allClear ? "Nothing due — you're all caught up." : statParts.length > 0 ? statParts.join("  ·  ") : "Nothing overdue today."}
          </p>

          {dueThisWeek > 0 && (
            <p style={{ fontFamily: "Inter, sans-serif", fontSize: isMobile ? "13px" : "15px", color: "#C8C5CB", margin: 0 }}>
              <span style={{ color: "rgba(200,197,203,0.4)" }}>This week  </span>
              {dueThisWeek} due
            </p>
          )}

          {topItem && (
            <p style={{ fontFamily: "Inter, sans-serif", fontSize: isMobile ? "12px" : "14px", color: "#C8C5CB", margin: 0 }}>
              <span style={{ color: "rgba(200,197,203,0.4)" }}>Most urgent</span>
              {"  "}{topItemName}
              <span style={{ color: "rgba(200,197,203,0.4)" }}> — {topItemLabel}</span>
            </p>
          )}
        </div>

        {/* Right: upcoming + focus today */}
        {(upcomingEvents.length > 0 || studyBlocks.length > 0) && (
          <div style={{
            flex:          isMobile ? "1 1 auto" : "0 0 auto",
            display:       "flex",
            flexDirection: "column",
            gap:           isMobile ? "10px" : "14px",
            minWidth:      isMobile ? undefined : "220px",
          }}>

            {upcomingEvents.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <p style={dimText}>Upcoming</p>
                {upcomingEvents.map((a: any) => {
                  const raw: string = a.name ?? a.title ?? "Untitled";
                  const name = raw.length > 32 ? raw.slice(0, 30) + "…" : raw;
                  return (
                    <div key={String(a.id)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px" }}>
                      <span style={{ fontFamily: "Inter, sans-serif", fontSize: isMobile ? "13px" : "14px", color: "#C8C5CB" }}>
                        {name}
                      </span>
                      <span style={{ fontFamily: "Inter, sans-serif", fontSize: isMobile ? "11px" : "12px", color: "rgba(200,197,203,0.4)", whiteSpace: "nowrap" }}>
                        {fmtDue(a.dueAt, now)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            {studyBlocks.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <p style={dimText}>Focus today</p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: isMobile ? "8px" : "10px" }}>
                  {studyBlocks.map(({ course, hours }, i) => (
                    <span
                      key={String(course.id)}
                      onClick={() => {
                        setStudyConfig({ course: course.dbId || "", action: "create" });
                        setPendingNav({ page: "rooms" });
                      }}
                      onMouseEnter={() => setHoveredPill(i)}
                      onMouseLeave={() => setHoveredPill(null)}
                      style={{
                        padding:      isMobile ? "3px 10px" : "4px 14px",
                        background:   i === 0
                          ? hoveredPill === i ? "rgba(200,197,203,0.75)" : "rgba(200,197,203,0.5)"
                          : hoveredPill === i ? "rgba(80,80,82,0.7)"     : "rgba(52,53,53,0.5)",
                        borderRadius: "9999px",
                        fontFamily:   "Inter, sans-serif",
                        fontSize:     isMobile ? "12px" : "14px",
                        color:        i === 0 ? "#121414" : "#C8C5CB",
                        fontWeight:   i === 0 ? 600 : 400,
                        cursor:       "pointer",
                        transition:   "background 0.15s ease",
                      }}
                    >
                      {course.courseCode ?? course.name} · {hours}h →
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

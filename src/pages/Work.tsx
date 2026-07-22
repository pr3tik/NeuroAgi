// Work.tsx — Home page. Greeting, upcoming assignments from Canvas, bottom stats row.

import { useEffect, useState } from "react";
import { calendarDaysUntil } from "../lib/dueDate";
import { useApp } from "../context/AppContext";
import { Flame, Layers, MessageCircle, GraduationCap, AlertCircle, CalendarClock } from "lucide-react";
import { supabase } from "../api/supabase";
import { SectionHeader, ObjectCard, MetaLine } from "../components/uikit";
import { coursesToGpa } from "../lib/gpa";
import SchoolPrompt from "../components/SchoolPrompt";
import { deriveNextActions } from "../lib/nextActions";


function formatDue(dateStr) {
  if (!dateStr) return null;
  const due = new Date(dateStr);
  const diffDays = calendarDaysUntil(dateStr);
  if (diffDays === null) return null;

  if (diffDays < 0)  return { label: "Overdue",   urgent: true };
  if (diffDays === 0) return { label: "Due today", urgent: true };
  if (diffDays === 1) return { label: "Tomorrow",  urgent: true };
  if (diffDays <= 7)  return {
    label: due.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }),
    urgent: false,
  };
  return {
    label: due.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    urgent: false,
  };
}

// ── Importance tiers ──────────────────────────────────────────────────────
// Color-code each assignment by how important/urgent it is, so the eye lands on
// what matters first. Overdue work and imminent exams are red; everything else
// grades down orange → amber → neutral as the deadline gets further out.
type Tier = "overdue" | "exam" | "today" | "soon" | "week" | "later" | "done";

const TIER_STYLE: Record<Tier, { label: string; bg: string; border: string; color: string; accent: string }> = {
  overdue: { label: "OVERDUE",   bg: "rgba(255,69,58,0.12)",  border: "rgba(255,105,97,0.55)", color: "#FF938B",              accent: "#FF453A" },
  exam:    { label: "EXAM",      bg: "rgba(255,69,58,0.12)",  border: "rgba(255,105,97,0.55)", color: "#FF938B",              accent: "#FF453A" },
  today:   { label: "DUE TODAY", bg: "rgba(255,159,10,0.13)", border: "rgba(255,159,10,0.5)",  color: "#FFC46B",              accent: "#FF9F0A" },
  soon:    { label: "TOMORROW",  bg: "rgba(255,204,0,0.10)",  border: "rgba(255,214,10,0.42)", color: "#FFE083",              accent: "#FFD60A" },
  week:    { label: "THIS WEEK", bg: "rgba(52,53,53,0.5)",    border: "rgba(255,255,255,0.08)", color: "#C8C5CB",             accent: "transparent" },
  later:   { label: "UPCOMING",  bg: "rgba(52,53,53,0.5)",    border: "rgba(255,255,255,0.05)", color: "#9A979D",             accent: "transparent" },
  done:    { label: "DONE",      bg: "rgba(52,199,89,0.10)",  border: "rgba(52,199,89,0.28)",  color: "rgba(52,199,89,0.95)", accent: "#34C759" },
};

// An exam/quiz/test is inherently high-stakes — flag it by name (Canvas has no
// reliable type field on these rows). Word-boundaried so "contest" ≠ "test".
const EXAM_RE = /\b(exam|midterm|mid-term|final|finals|quiz|test|assessment)\b/i;

function assignmentTier(a: any): Tier {
  if (a?.submission?.submittedAt) return "done";
  const d = calendarDaysUntil(a?.dueAt);
  if (d === null) return "later";
  if (d < 0) return "overdue";                              // past due, not submitted → red
  if (EXAM_RE.test(a?.name ?? "") && d <= 7) return "exam"; // exam within the week → red
  if (d === 0) return "today";
  if (d === 1) return "soon";
  if (d <= 7) return "week";
  return "later";
}

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - +new Date(dateStr);
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(diff / 3_600_000);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(diff / 86_400_000);
  return days === 1 ? "Yesterday" : `${days}d ago`;
}

function AssignmentCard({ a, isMobile = false }) {
  const due = formatDue(a.dueAt);

  // Color-code by importance. One tier drives both badge and the card's left
  // accent bar, so overdue work and imminent exams jump out first.
  const tier = assignmentTier(a);
  const style = TIER_STYLE[tier];
  const eyeCatch = tier === "overdue" || tier === "exam" || tier === "today";
  const badge = { text: style.label, bg: style.bg, border: style.border, color: style.color };
  const mobileBadge = badge;

  return (
    <div style={{
      position: "relative",
      overflow: "hidden",
      padding: isMobile ? "16px" : "20px",
      borderRadius: isMobile ? "12px" : "16px",
      background: "rgba(26,26,30,0.6)",
      border: `1px solid ${eyeCatch ? style.border : "rgba(255,255,255,0.08)"}`,
      backdropFilter: "blur(10px)",
      boxShadow: "inset 0 0 0 2px rgba(255,255,255,0.02)",
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      gap: "16px",
      width: "100%",
      boxSizing: "border-box" as const,
    }}>
      {/* Importance accent bar — draws the eye to overdue work and imminent exams */}
      {style.accent !== "transparent" && (
        <div style={{
          position: "absolute", left: 0, top: 0, bottom: 0,
          width: isMobile ? "3px" : "4px",
          background: style.accent,
        }} />
      )}
      {/* Left: icon + text */}
      <div style={{ display: "flex", alignItems: "center", gap: isMobile ? "16px" : "20px", flex: 1, minWidth: 0 }}>
        <div style={{
          width: isMobile ? "40px" : "48px",
          height: isMobile ? "40px" : "48px",
          flexShrink: 0,
          background: "#1F2020",
          border: "1px solid rgba(255,255,255,0.05)",
          borderRadius: isMobile ? "8px" : "12px",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <svg
            width={isMobile ? "16" : "20"}
            height={isMobile ? "16" : "20"}
            viewBox="0 0 24 24" fill="none"
            stroke="rgba(200,197,203,0.5)"
            strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
          >
            <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
          </svg>
        </div>
        <div style={{ minWidth: 0 }}>
          <p style={{
            fontFamily: "var(--font-sans)",
            fontSize: isMobile ? "14px" : "16px",
            lineHeight: isMobile ? "20px" : undefined,
            color: "#E3E2E2",
            margin: "0 0 4px",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            maxWidth: isMobile ? "140px" : undefined,
          }}>
            {a.name}
          </p>
          <p style={{
            fontFamily: "var(--font-sans)",
            fontSize: isMobile ? "12px" : "14px",
            lineHeight: isMobile ? "16px" : undefined,
            color: isMobile ? "#D2C5B1" : "rgba(200,197,203,0.6)",
            margin: 0,
          }}>
            {a.courseCode ?? a.courseName ?? ""}
          </p>
        </div>
      </div>

      {/* Right: mobile = compact pill, desktop = deadline + badge */}
      {isMobile ? (
        <span style={{
          padding: "2px 8px",
          background: mobileBadge.bg,
          border: `1px solid ${mobileBadge.border}`,
          borderRadius: "9999px",
          fontFamily: "var(--font-sans)",
          fontWeight: 400,
          fontSize: "10px",
          lineHeight: "15px",
          color: mobileBadge.color,
          whiteSpace: "nowrap",
          flexShrink: 0,
        }}>
          {mobileBadge.text}
        </span>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: "32px", flexShrink: 0 }}>
          {due && (
            <div style={{ textAlign: "right" }}>
              <p style={{ fontFamily: "var(--font-sans)", fontSize: "14px", color: "rgba(200,197,203,0.4)", margin: 0 }}>
                Deadline
              </p>
              <p style={{ fontFamily: "var(--font-sans)", fontSize: "14px", color: "#E3E2E2", margin: 0 }}>
                {due.label}
              </p>
            </div>
          )}
          <span style={{
            padding: "6px 16px",
            background: badge.bg,
            border: `1px solid ${badge.border}`,
            borderRadius: "9999px",
            fontFamily: "var(--font-sans)",
            fontSize: "14px",
            color: badge.color,
            whiteSpace: "nowrap",
            letterSpacing: "0.02em",
            flexShrink: 0,
          }}>
            {badge.text}
          </span>
        </div>
      )}
    </div>
  );
}

function EmptyState({ syncStatus, hasToken }) {
  const glass = {
    padding: "32px",
    borderRadius: "32px",
    background: "rgba(26,26,30,0.6)",
    border: "1px solid rgba(255,255,255,0.08)",
    backdropFilter: "blur(10px)",
    boxShadow: "inset 0 0 0 2px rgba(255,255,255,0.02)",
    textAlign: "center" as const,
  };

  if (syncStatus === "syncing") {
    return (
      <div style={glass}>
        <p style={{ fontFamily: "var(--font-sans)", fontWeight: 600, fontSize: "18px", color: "#E3E2E2", margin: "0 0 8px" }}>
          Syncing Canvas…
        </p>
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "14px", color: "rgba(200,197,203,0.6)", margin: 0 }}>
          Fetching your assignments
        </p>
      </div>
    );
  }
  if (syncStatus === "cors-error") {
    return (
      <div style={{ ...glass, textAlign: "left" as const }}>
        <p style={{ fontFamily: "var(--font-sans)", fontWeight: 600, fontSize: "18px", color: "rgba(255,100,90,0.9)", margin: "0 0 8px" }}>
          Canvas blocked by browser
        </p>
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "14px", color: "rgba(200,197,203,0.6)", lineHeight: "1.6", margin: 0 }}>
          Your school's Canvas blocks direct requests. Use the Canvas page to import manually.
        </p>
      </div>
    );
  }
  if (!hasToken) {
    return (
      <div style={glass}>
        <p style={{ fontFamily: "var(--font-sans)", fontWeight: 600, fontSize: "18px", color: "#E3E2E2", margin: "0 0 8px" }}>
          No Canvas connected
        </p>
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "14px", color: "rgba(200,197,203,0.6)", margin: 0 }}>
          Head to the Canvas page to connect your account and see your assignments here.
        </p>
      </div>
    );
  }
  return (
    <div style={glass}>
      <p style={{ fontFamily: "var(--font-sans)", fontWeight: 600, fontSize: "18px", color: "#E3E2E2", margin: "0 0 4px" }}>
        You're all caught up
      </p>
      <p style={{ fontFamily: "var(--font-sans)", fontSize: "14px", color: "rgba(200,197,203,0.6)", margin: 0 }}>
        No upcoming assignments
      </p>
    </div>
  );
}

export default function Work() {
  const { userId, userData, courses, assignments, canvasToken, syncStatus, announcements } = useApp();

  // ── Home extras (UI/UX spec v2): resume state + indexed materials ──────────
  // "Pick up where you left off" mirrors the reference's continue-learning card;
  // "Your materials" shows what Reggie can actually teach from (rag_documents).
  const [homeExtras, setHomeExtras] = useState<{ srsDue: number; materials: { id: string; name: string; count: number }[]; plan: any | null }>({ srsDue: 0, materials: [], plan: null });
  useEffect(() => {
    if (!userId) return;
    let dead = false;
    (async () => {
      try {
        const [srsR, ragR, planR] = await Promise.all([
          supabase.from("srs_reviews").select("card_key").eq("user_id", userId).lte("due_at", new Date().toISOString()),
          supabase.from("rag_documents").select("course_id").eq("user_id", userId),
          // Proactive study plan (exam-mastery-reminder cron): the freshest plan for the
          // nearest still-upcoming exam. Owner-scoped RLS; absent table/rows -> no card.
          supabase.from("exam_plans").select("id, course_id, exam_date, sessions, created_at")
            .eq("user_id", userId).gte("exam_date", new Date().toISOString().slice(0, 10))
            .order("exam_date", { ascending: true }).order("created_at", { ascending: false }).limit(1),
        ]);
        const counts: Record<string, number> = {};
        for (const r of (ragR.data ?? []) as any[]) { const k = r.course_id ?? "other"; counts[k] = (counts[k] || 0) + 1; }
        const materials = Object.entries(counts)
          .map(([cid, n]) => {
            const c: any = (courses ?? []).find((x: any) => String(x.dbId) === String(cid));
            return { id: cid, name: c?.courseCode || c?.name || (cid === "other" ? "Other uploads" : "Course"), count: n as number };
          })
          .sort((a, b) => b.count - a.count).slice(0, 4);
        if (!dead) setHomeExtras({ srsDue: (srsR.data ?? []).length, materials, plan: (planR.data ?? [])[0] ?? null });
      } catch { /* non-fatal — sections simply don't render */ }
    })();
    return () => { dead = true; };
  }, [userId, courses]);
  const goPage = (k: string) => () => window.dispatchEvent(new CustomEvent("fschool:navigate", { detail: k }));

  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    const link = document.createElement("link");
    link.href = "https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500;600&display=swap";
    link.rel = "stylesheet";
    document.head.appendChild(link);

    const style = document.createElement("style");
    style.textContent = `
      @keyframes workRise {
        from { opacity: 0; transform: translateY(16px); }
        to   { opacity: 1; transform: translateY(0); }
      }
      .work-search-input::placeholder {
        color: rgba(200,197,203,0.5);
      }
    `;
    document.head.appendChild(style);

    return () => {
      document.head.removeChild(link);
      document.head.removeChild(style);
    };
  }, []);

  const hour = new Date().getHours();
  const greetingWord = hour < 12 ? "Morning" : hour < 18 ? "Afternoon" : "Evening";
  const name = userData?.name || localStorage.getItem("fschool_name") || "";

  // Filter to upcoming unsubmitted assignments, sorted by due date
  const upcoming = assignments
    .filter(a => {
      if (!a.dueAt) return false;
      const due = new Date(a.dueAt);
      const now = new Date();
      // Show if due in future OR overdue but not submitted
      return due > now || !a.submission?.submittedAt;
    })
    .sort((a, b) => +new Date(a.dueAt) - +new Date(b.dueAt))
    .slice(0, 5); // show top 5

  const completedCount = assignments.filter(a => a.submission?.submittedAt).length;
  // "Connected" = has a Canvas OAuth token OR has any synced data (e.g. from the
  // browser extension, which syncs via the LMS session and sets no canvas_token).
  const hasToken = Boolean(canvasToken) || assignments.length > 0;

  // ── Real data ──
  // Prefer the persisted users.gpa, but fall back to computing it from loaded course
  // scores — covers users whose gpa was never written (extension sync) or dropped by a
  // load/sync race in AppContext, so the widget never shows a blank "/4.0".
  const gpaRaw = userData?.gpa ?? coursesToGpa(courses);
  const streakRaw = userData?.streak ?? 0;

  const STATS = [
    { label: "GPA",       value: gpaRaw != null ? Number(gpaRaw).toFixed(2) : "—" },
    { label: "Streak",    value: streakRaw ? `${streakRaw}d` : "0d" },
    { label: "Completed", value: completedCount },
  ];

  // Most recent announcement
  const latestAnnouncement = announcements?.[0];
  const urgentAssignment = upcoming.find(a => formatDue(a.dueAt)?.urgent);
  const showHero = Boolean(upcoming[0] || latestAnnouncement);

  // Hero card values — based on upcoming[0]
  const heroFirst = upcoming[0] ?? null;
  const heroFirstHours = heroFirst
    ? Math.ceil((+new Date(heroFirst.dueAt) - Date.now()) / 3_600_000)
    : null;
  const heroFirstCourse = heroFirst?.courseCode ?? heroFirst?.courseName ?? "";

  // Date + assignment count. On web these render on two separate, center-aligned
  // lines (below); the single-line joined form is the fallback used everywhere else.
  const subtitleDate = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric" });
  const subtitleCount = upcoming.length > 0
    ? `${upcoming.length} assignment${upcoming.length !== 1 ? "s" : ""} coming up`
    : "";
  const subtitleText = syncStatus === "syncing"
    ? "Syncing your Canvas…"
    : upcoming.length > 0
    ? `${subtitleDate} · ${subtitleCount}`
    : hasToken ? "You're all caught up" : "Connect Canvas to see assignments";
  // Web only: show the date and the assignment count stacked instead of joined.
  const splitSubtitle = !isMobile && syncStatus !== "syncing" && upcoming.length > 0;

  // ── GPA progress bar ──
  const gpaNum = gpaRaw != null ? Number(gpaRaw) : null;
  const gpaPercent = gpaNum != null ? `${Math.min((gpaNum / 4) * 100, 100)}%` : "0%";

  // ── Weekly goal: real submissions this week ──
  const today = new Date().getDay();
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - today);
  weekStart.setHours(0, 0, 0, 0);
  const submittedThisWeek = assignments.filter(a =>
    a.submission?.submittedAt && +new Date(a.submission.submittedAt) >= +weekStart
  );
  const countByDay = Array(7).fill(0);
  submittedThisWeek.forEach(a => {
    const day = new Date(a.submission!.submittedAt).getDay();
    countByDay[day]++;
  });
  const maxDayCount = Math.max(...countByDay, 1);
  const barHeights = countByDay.map(c => c === 0 ? 8 : Math.round((c / maxDayCount) * 80));
  const weeklyGoalTarget = 5;
  const weeklyPercent = Math.min(Math.round((submittedThisWeek.length / weeklyGoalTarget) * 100), 100);
  const desktopBarColors = [
    "rgba(200,197,203,0.5)",
    "rgba(52,53,53,0.5)",
    "rgba(52,53,53,0.5)",
    "rgba(200,197,203,0.5)",
    "#343535",
    "rgba(200,197,203,0.6)",
    "#343535",
  ];
  const barColor = (i: number) => desktopBarColors[i] ?? "#343535";

  // ── Real activity: recent submissions + announcements ──
  const recentSubmissions = assignments
    .filter(a => a.submission?.submittedAt)
    .sort((a, b) => +new Date(b.submission!.submittedAt) - +new Date(a.submission!.submittedAt))
    .slice(0, 2)
    .map(a => ({
      text: `Submitted: ${a.name}`,
      time: formatRelativeTime(a.submission!.submittedAt),
      recent: true,
    }));
  const recentAnnouncements = (announcements ?? []).slice(0, 2).map(ann => ({
    text: (ann as any).title ?? "New announcement",
    time: (ann as any).postedAt ? formatRelativeTime((ann as any).postedAt) : "Recently",
    recent: false,
  }));
  const activityItems = [...recentSubmissions, ...recentAnnouncements].slice(0, 3);
  const showActivity = activityItems.length > 0;

  // Shared activity-feed rows — rendered beside "Pick up where you left off" on desktop
  // (primary), or in the right rail as a fallback when there are no indexed materials.
  const activityFeedRows = (
    <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
      {activityItems.map((item, i) => (
        <div key={i} style={{
          display: "flex", alignItems: "center", gap: "16px",
          padding: "12px 0",
          borderBottom: "1px solid rgba(255,255,255,0.04)",
        }}>
          <div style={{
            width: "8px", height: "8px", borderRadius: "9999px",
            background: item.recent ? "rgba(200,197,203,0.5)" : "#343535",
            flexShrink: 0,
          }} />
          <p style={{
            flex: 1, minWidth: 0, margin: 0,
            fontFamily: "var(--font-sans)", fontSize: "14px",
            color: item.recent ? "#E3E2E2" : "#C8C5CB",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {item.text}
          </p>
          <p style={{
            margin: 0, whiteSpace: "nowrap", flexShrink: 0,
            fontFamily: "var(--font-sans)", fontSize: "10px",
            color: "rgba(200,197,203,0.4)",
          }}>
            {item.time}
          </p>
        </div>
      ))}
    </div>
  );

  const glassCard = {
    borderRadius: isMobile ? "16px" : "32px",
    background: "rgba(26,26,30,0.6)",
    border: "1px solid rgba(255,255,255,0.08)",
    boxShadow: "inset 0 0 0 2px rgba(255,255,255,0.02)",
    backdropFilter: "blur(10px)",
    width: "100%",
    boxSizing: "border-box" as const,
    maxWidth: "100%",
  };

  return (
    <div style={{ position: "relative", minHeight: "100vh", background: "transparent", overflowX: "hidden", width: "100%", maxWidth: "100vw" }}>

      {/* Main content */}
      <div
        className="work-content"
        style={{ position: "relative", zIndex: 1, maxWidth: "1400px", margin: "0 auto", padding: isMobile ? "16px 16px 100px 16px" : "28px 48px 80px", overflowX: "hidden", boxSizing: "border-box", width: "100%" }}
      >
        {/* ── Greeting ── */}
        <div style={{
          position: "relative",
          textAlign: "center", marginBottom: "40px",
          animation: "workRise 0.6s ease both", animationDelay: "0ms",
        }}>
          <p
            style={{
              fontFamily: "var(--font-sans)",
              fontWeight: 300,
              fontSize: isMobile ? "clamp(32px, 8vw, 48px)" : "72px",
              lineHeight: 1,
              letterSpacing: "-1.8px",
              color: "#E3E2E2",
              margin: 0,
            }}
          >
            <span style={{ fontFamily: "var(--font-sans)", fontWeight: 300, color: "#E3E2E2" }}>
              {greetingWord},{" "}
            </span>
            {name && (
              <span style={{ fontFamily: "var(--font-sans)", fontStyle: "italic", fontWeight: 300, color: "var(--text-tertiary)" }}>
                {name}.
              </span>
            )}
            {!name && (
              <span style={{ fontFamily: "var(--font-sans)", fontWeight: 300, color: "#E3E2E2" }}>.</span>
            )}
          </p>
          {splitSubtitle ? (
            <div style={{ textAlign: "center", marginTop: "16px" }}>
              <p style={{
                fontFamily: "var(--font-sans)", fontWeight: 400,
                fontSize: "16px", lineHeight: "24px",
                color: "#C8C5CB", opacity: 0.8, margin: 0,
              }}>
                {subtitleDate}
              </p>
              <p style={{
                fontFamily: "var(--font-sans)", fontWeight: 400,
                fontSize: "16px", lineHeight: "24px",
                color: "#C8C5CB", opacity: 0.8, margin: 0,
              }}>
                {subtitleCount}
              </p>
            </div>
          ) : (
            <p style={{
              fontFamily: "var(--font-sans)", fontWeight: 400,
              fontSize: "16px", lineHeight: "24px",
              color: "#C8C5CB", opacity: 0.8,
              marginTop: "16px", marginBottom: 0,
            }}>
              {subtitleText}
            </p>
          )}
        </div>

        {/* ── Search bar ── */}
        <div style={{
          maxWidth: isMobile ? "100%" : "812px", margin: "0 auto 56px", width: "100%", boxSizing: "border-box" as const, overflowX: "hidden" as const,
          animation: "workRise 0.6s ease both", animationDelay: "80ms",
        }}>
          <SchoolPrompt />
          <div style={{
            display: "flex", alignItems: "center", gap: "16px",
            padding: "8px 16px", borderRadius: "9999px",
            background: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,255,255,0.05)",
          }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#C8C5CB" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
            </svg>
            <input
              type="text"
              className="work-search-input"
              placeholder="Search curriculum, papers, notes..."
              style={{
                flex: 1, minWidth: 0, background: "transparent", border: "none", outline: "none",
                fontFamily: "var(--font-sans)", fontSize: "14px", color: "#E3E2E2",
                caretColor: "#C8C5CB",
              }}
            />
          </div>
        </div>

        {/* ── TODAY — the one decision panel. Every proactive engine (deadlines, the
            exam-plan cron, SRS) feeds ONE ranked top-3 via deriveNextActions instead of
            owning its own card; the page opens with the synthesis, reference lives below. ── */}
        {(() => {
          const nowD = new Date();
          const overdueCount = assignments.filter((a: any) => a?.dueAt && !a.submission?.submittedAt && new Date(a.dueAt) < nowD && new Date(a.dueAt).toDateString() !== nowD.toDateString()).length;
          const plan = homeExtras.plan && Array.isArray(homeExtras.plan.sessions) && homeExtras.plan.sessions.length > 0 ? homeExtras.plan : null;
          const planCourse: any = plan ? (courses ?? []).find((x: any) => String(x.dbId ?? x.id) === String(plan.course_id)) : null;
          const examLabel = plan ? new Date(plan.exam_date + "T12:00:00").toLocaleDateString("en-US", { weekday: "long" }) : null;
          const actions = deriveNextActions({ assignments, plan, srsDue: homeExtras.srsDue, now: nowD });
          const status = overdueCount > 0 ? `Behind — ${overdueCount} overdue` : "On track";
          const desc = `${overdueCount > 0 ? `${overdueCount} assignment${overdueCount === 1 ? "" : "s"} overdue` : "Nothing overdue"}${plan ? ` · ${planCourse?.courseCode || planCourse?.name || "exam"} ${examLabel}` : ""}`;
          const ICONS: Record<string, any> = { overdue: AlertCircle, due_today: AlertCircle, due_tomorrow: CalendarClock, plan_session: GraduationCap, srs: Layers };
          const urgentKind = (k: string) => k === "overdue" || k === "due_today";
          return (
            <div style={{ maxWidth: "1400px", width: "100%", boxSizing: "border-box" as const, marginBottom: isMobile ? "24px" : "32px", animation: "workRise 0.6s ease both", animationDelay: "120ms" }}>
              <SectionHeader
                title="Today"
                desc={desc}
                right={<span style={{
                  fontSize: 11.5, fontWeight: 600, padding: "5px 12px", borderRadius: 20,
                  background: overdueCount > 0 ? "var(--color-urgent-bg)" : "var(--color-success-bg)",
                  color: overdueCount > 0 ? "var(--color-urgent-text)" : "var(--color-success-text)",
                  whiteSpace: "nowrap" as const,
                }}>{status}</span>}
              />
              <div style={{
                background: "rgba(255,255,255,0.035)", border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 16, padding: "6px 8px",
              }}>
                {actions.length === 0 && (
                  <div style={{ padding: "16px 14px", fontSize: 13.5, color: "var(--text-secondary)" }}>
                    You're all caught up — nothing needs you right now.
                  </div>
                )}
                {actions.map((a, i) => {
                  const Icon = ICONS[a.kind] ?? CalendarClock;
                  const urgent = urgentKind(a.kind);
                  return (
                    <div key={a.key} style={{
                      display: "flex", alignItems: "center", gap: 14, padding: "12px 14px",
                      borderTop: i > 0 ? "1px solid rgba(255,255,255,0.06)" : "none",
                    }}>
                      <Icon size={17} color={urgent ? "rgba(255,100,90,0.85)" : "rgb(var(--teal-rgb))"} style={{ flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ margin: 0, fontSize: 14, fontWeight: 550, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.title}</p>
                        <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--text-dim)" }}>{a.detail}</p>
                      </div>
                      {a.minutes != null && (
                        <span style={{ fontSize: 12, color: "var(--text-dim)", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{a.minutes} min</span>
                      )}
                      <button onClick={goPage(a.page)} style={{
                        flexShrink: 0, background: urgent ? "rgba(255,255,255,0.06)" : "rgba(var(--teal-rgb),0.14)",
                        border: `1px solid ${urgent ? "rgba(255,255,255,0.14)" : "rgba(var(--teal-rgb),0.3)"}`,
                        color: urgent ? "var(--text-primary)" : "rgb(var(--teal-rgb))",
                        borderRadius: 9, padding: "7px 14px", fontSize: 12.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
                      }}>{a.kind === "plan_session" ? "Start with Reggie" : "Open"}</button>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* ── Pick up where you left off + Your materials (spec v2 sections) ── */}
        {homeExtras.materials.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 26, marginBottom: isMobile ? "24px" : "32px", animation: "workRise 0.6s ease both", animationDelay: "140ms" }}>
            {/* Pick up + Recent Activity share a row on desktop, mirroring the dashboard
                grid's 1fr / 418.67px rhythm below. Recent Activity here is desktop-only —
                mobile keeps its own feed further down. */}
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "minmax(0, 1fr)" : "minmax(0, 1fr) 418.67px", gap: 24, alignItems: "start" }}>
            <div>
              <SectionHeader title="Pick up where you left off" desc="Jump back into what you were working on" />
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fit, minmax(250px, 330px))", gap: 12 }}>
                {/* Flashcards-due lives in the Today panel now (deriveNextActions) —
                    repeating it here was exactly the scatter the panel consolidates. */}
                {homeExtras.materials[0] && (() => {
                  // Prefer a real course for the resume card; unlinked docs read awkwardly.
                  const top = homeExtras.materials.find(m => m.id !== "other") ?? homeExtras.materials[0];
                  const total = homeExtras.materials.reduce((s, m) => s + m.count, 0);
                  return (
                    <ObjectCard
                      icon={<MessageCircle size={18} color="rgb(var(--teal-rgb))" />}
                      typeLabel="Ask Reggie"
                      title={top.id === "other" ? "Ask about your materials" : `Continue ${top.name}`}
                      meta={[`${total} materials indexed`, "grounded answers"]}
                      onClick={goPage("studyAssistant")}
                    />
                  );
                })()}
              </div>
            </div>
            {!isMobile && showActivity && (
              <div>
                <SectionHeader title="Recent Activity" desc="Your latest submissions and announcements" />
                {activityFeedRows}
              </div>
            )}
            </div>
            {homeExtras.materials.length > 0 && (
              <div>
                <SectionHeader
                  title="Your materials"
                  desc="Course files Reggie can teach from"
                  right={
                    <button onClick={goPage("files")} style={{
                      flexShrink: 0, background: "rgba(var(--teal-rgb),0.14)",
                      border: "1px solid rgba(var(--teal-rgb),0.3)",
                      color: "rgb(var(--teal-rgb))",
                      borderRadius: 9, padding: "7px 14px", fontSize: 12.5, fontWeight: 600,
                      cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
                    }}>Open files</button>
                  }
                />
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  {homeExtras.materials.map(m => {
                    // "Other uploads" has no meaningful name — lead with the file count instead
                    // of a vague label. Real courses keep their code as the title.
                    const files = `${m.count} ${m.count === 1 ? "file" : "files"}`;
                    const isOther = m.id === "other";
                    return (
                      <div key={m.id} style={{
                        display: "inline-flex", alignItems: "center", gap: 8,
                        background: "rgba(255,255,255,0.045)", border: "1px solid rgba(255,255,255,0.08)",
                        borderRadius: 999, padding: "8px 14px",
                      }}>
                        <span style={{ fontFamily: "var(--font-sans)", fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>{isOther ? files : m.name}</span>
                        <MetaLine parts={isOther ? ["ready to search"] : [files, "ready to search"]} />
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Dashboard grid ── */}
        <div
          className="work-grid"
          style={{
            display: "grid",
            gridTemplateColumns: isMobile ? "minmax(0, 1fr)" : "minmax(0, 1fr) 418.67px",
            width: "100%",
            gap: "24px",
            animation: "workRise 0.6s ease both", animationDelay: "160ms",
          }}
        >

          {/* ════ LEFT COLUMN ════ */}
          <div style={{ display: "flex", flexDirection: "column", gap: "24px", minWidth: 0 }}>

            {/* Hero card */}
            {showHero && (
              <div
                className="work-hero work-card-large"
                style={{
                  ...glassCard,
                  background: "rgba(255,255,255,0.045)",
                  padding: isMobile ? "24px" : "40px",
                  borderRadius: isMobile ? "12px" : "32px",
                  position: "relative", overflow: "hidden",
                  width: "100%", maxWidth: "100%", boxSizing: "border-box" as const,
                  ...(isMobile ? {} : {}),
                }}
              >

                {/* Mobile-only: warm bloom */}
                {isMobile && (
                  <div style={{
                    position: "absolute",
                    top: "-47px", right: "-47px",
                    width: "192px", height: "192px",
                    borderRadius: "9999px",
                    background: "rgba(200,197,203,0.05)",
                    filter: "blur(32px)",
                    pointerEvents: "none",
                    zIndex: 0,
                  }} />
                )}

                <div style={{ position: "relative", zIndex: 1, ...(isMobile ? { display: "flex", flexDirection: "column", gap: "16px" } : {}) }}>
                  {/* Top badges */}
                  <div style={{ display: "flex", alignItems: "center", gap: isMobile ? "8px" : "12px", ...(isMobile ? {} : { marginBottom: "24px" }), flexWrap: "wrap" }}>
                    {heroFirstHours != null && (
                      <span style={{
                        padding: isMobile ? "2px 8px" : "4px 12px",
                        background: isMobile ? "rgba(200,197,203,0.1)" : "rgba(200,197,203,0.5)",
                        border: isMobile ? "1px solid rgba(200,197,203,0.2)" : "1px solid rgba(200,197,203,0.2)",
                        borderRadius: "9999px",
                        fontFamily: "var(--font-sans)",
                        fontWeight: isMobile ? 600 : 400,
                        fontSize: isMobile ? "12px" : "16px",
                        lineHeight: isMobile ? "16px" : undefined,
                        letterSpacing: isMobile ? "0.6px" : undefined,
                        color: isMobile ? "#C8C5CB" : "#121414",
                        whiteSpace: "nowrap",
                      }}>
                        DUE IN {heroFirstHours > 0 ? `${heroFirstHours}h` : "NOW"}
                      </span>
                    )}
                    {heroFirstCourse && (
                      <span style={{
                        fontFamily: "var(--font-sans)",
                        fontWeight: isMobile ? 600 : 400,
                        fontSize: isMobile ? "12px" : "16px",
                        lineHeight: isMobile ? "16px" : undefined,
                        letterSpacing: isMobile ? "0.6px" : "1.6px",
                        color: isMobile ? "rgba(210,197,177,0.6)" : "rgba(200,197,203,0.5)",
                        textTransform: "uppercase",
                      }}>
                        {isMobile ? heroFirstCourse : `• ${heroFirstCourse}`}
                      </span>
                    )}
                  </div>

                  {/* Title */}
                  <p style={{
                    fontFamily: isMobile ? "var(--font-sans)" : "var(--font-sans)",
                    fontWeight: isMobile ? 600 : 400,
                    fontSize: isMobile ? "18px" : "42px",
                    lineHeight: isMobile ? "22px" : "52px",
                    letterSpacing: isMobile ? "-0.18px" : undefined,
                    color: "#E3E2E2",
                    maxWidth: isMobile ? "100%" : "576px",
                    margin: 0,
                    padding: isMobile ? "0 0 8px" : undefined,
                    width: isMobile ? "100%" : undefined,
                    ...(isMobile
                      ? { wordBreak: "break-word" as const, whiteSpace: "normal" as const, overflow: "hidden" }
                      : { overflow: "hidden", maxHeight: "104px" }),
                  }}>
                    {heroFirst?.name ?? latestAnnouncement?.title ?? ""}
                  </p>

                  {/* Actions */}
                  <div style={{
                    display: "flex",
                    alignItems: isMobile ? "stretch" : "center",
                    flexDirection: isMobile ? "column" : "row",
                    gap: "24px",
                    ...(isMobile ? {} : { marginTop: "48px" }),
                    flexWrap: "wrap",
                  }}>
                    <button style={{
                      display: "flex", alignItems: "center", justifyContent: "center",
                      gap: isMobile ? "8px" : "12px",
                      padding: isMobile ? "12px 24px" : "16px 32px",
                      borderRadius: isMobile ? "8px" : "16px",
                      height: isMobile ? "44px" : undefined,
                      width: isMobile ? "100%" : undefined,
                      background: "#C8C5CB",
                      border: "none", cursor: "pointer",
                      fontFamily: "var(--font-sans)",
                      fontWeight: isMobile ? 400 : 600,
                      fontSize: isMobile ? "14px" : "18px",
                      lineHeight: isMobile ? "20px" : undefined,
                      letterSpacing: isMobile ? undefined : "-0.18px",
                      color: "#121414",
                      boxShadow: "0 4px 20px -2px rgba(200,197,203,0.25)",
                      whiteSpace: "nowrap",
                    }}>
                      Continue Draft
                      <svg width={isMobile ? "12" : "18"} height={isMobile ? "12" : "18"} viewBox="0 0 24 24" fill="none" stroke="#121414" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M5 12h14M12 5l7 7-7 7"/>
                      </svg>
                    </button>

                    {/* Co-authors — hidden on mobile */}
                    <div style={{ display: isMobile ? "none" : "flex", alignItems: "center", gap: "16px" }}>
                      <div style={{ display: "flex" }}>
                        {(["#343535", "#1F2020", "rgba(200,197,203,0.2)"] as const).map((bg, i) => (
                          <div key={i} style={{
                            width: "32px", height: "32px",
                            background: bg, borderRadius: "9999px",
                            border: "2px solid #121414",
                            marginLeft: i === 0 ? 0 : "-12px",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            zIndex: 3 - i,
                            position: "relative",
                          }}>
                            {i === 2 && (
                              <span style={{ fontSize: "9px", fontFamily: "var(--font-sans)", color: "#C8C5CB", fontWeight: 700 }}>
                                +2
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                      <p style={{
                        fontFamily: "var(--font-sans)", fontSize: "14px",
                        color: "#C8C5CB", margin: 0,
                      }}>
                        Co-authored with AI Research Partner
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Quick stats row — mobile only (GPA + Streak side by side) */}
            {isMobile && (
              <div style={{ display: "flex", flexDirection: "row", gap: "12px" }}>
                {/* GPA card */}
                <div style={{
                  flex: 1, height: "78px", borderRadius: "30px",
                  background: "rgba(255,255,255,0.045)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  backdropFilter: "blur(10px)",
                  position: "relative", overflow: "hidden",
                  display: "flex", flexDirection: "column",
                  justifyContent: "center", alignItems: "center",
                  padding: "16px", boxSizing: "border-box" as const,
                }}>
                  <div style={{ position: "relative", zIndex: 1, textAlign: "center" }}>
                    <p style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 400, fontSize: "18px", lineHeight: "40px", color: "#E3E2E2", margin: 0 }}>
                      {STATS[0].value}
                    </p>
                    <p style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "rgba(200,197,203,0.5)", margin: 0, lineHeight: "14px" }}>
                      GPA
                    </p>
                  </div>
                </div>
                {/* Streak card */}
                <div style={{
                  flex: 1, height: "78px", borderRadius: "30px",
                  background: "rgba(113,104,104,0.12)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  backdropFilter: "blur(10px)",
                  display: "flex", flexDirection: "column",
                  justifyContent: "center", alignItems: "center",
                  padding: "16px", boxSizing: "border-box" as const,
                }}>
                  <Flame size={16} color="var(--gold)" style={{ flexShrink: 0 }} />
                  <p style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 400, fontSize: "18px", lineHeight: "40px", color: "#E3E2E2", margin: 0 }}>
                    {STATS[1].value}
                  </p>
                </div>
              </div>
            )}

            {/* Upcoming assignments section */}
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <div style={{ padding: "0 8px" }}>
                <SectionHeader
                  title="Upcoming assignments"
                  desc="From your Canvas courses, soonest first"
                  action="View all"
                  onAction={goPage("canvas")}
                />
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: isMobile ? "12px" : "16px" }}>
                {upcoming.length > 0
                  ? upcoming.map((a, i) => (
                    <div
                      key={a.id}
                      style={{ animation: "workRise 0.6s ease both", animationDelay: `${160 + i * 40}ms` }}
                    >
                      <AssignmentCard a={a} isMobile={isMobile} />
                    </div>
                  ))
                  : <EmptyState syncStatus={syncStatus} hasToken={hasToken} />
                }
              </div>
            </div>

            {/* Recent Activity — mobile only, only shown when real activity exists */}
            {isMobile && showActivity && (
              <div style={{ padding: "0 8px" }}>
                <p style={{
                  fontFamily: "var(--font-sans)", fontWeight: 600,
                  fontSize: "18px", letterSpacing: "-0.18px",
                  color: "#E3E2E2", margin: "0 0 16px",
                }}>
                  Recent Activity
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                  {activityItems.map((item, i) => (
                    <div key={i} style={{
                      display: "flex", alignItems: "center", gap: "16px",
                      padding: "12px 0",
                      borderBottom: "1px solid rgba(255,255,255,0.04)",
                    }}>
                      <div style={{
                        width: "8px", height: "8px", borderRadius: "9999px",
                        background: item.recent ? "#C8C5CB" : "#343535",
                        flexShrink: 0,
                      }} />
                      <p style={{
                        flex: 1, minWidth: 0, margin: 0,
                        fontFamily: "var(--font-sans)", fontSize: "14px",
                        color: item.recent ? "#E3E2E2" : "#C8C5CB",
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}>
                        {item.text}
                      </p>
                      <p style={{
                        margin: 0, whiteSpace: "nowrap", flexShrink: 0,
                        fontFamily: "var(--font-sans)", fontSize: "10px",
                        color: "rgba(200,197,203,0.4)",
                      }}>
                        {item.time}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ════ RIGHT COLUMN — hidden on mobile (stats shown inline above) ════ */}
          <div style={{ display: isMobile ? "none" : "flex", flexDirection: "column", gap: "24px" }}>

            {/* GPA card */}
            <div
              className="work-card-large"
              style={{
                position: "relative", overflow: "hidden",
                borderRadius: isMobile ? "16px" : "32px",
                height: "165px",
                background: "rgba(255,255,255,0.045)",
                boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.02)",
                backdropFilter: "blur(10px)",
              }}
            >

              {/* All content — absolute wrapper fills card so top: values stay correct */}
              <div style={{ position: "absolute", inset: 0, zIndex: 1, padding: "32px", boxSizing: "border-box" }}>
                <p style={{
                  fontFamily: "var(--font-sans)", fontWeight: 400, fontSize: "16px",
                  color: "rgba(200,197,203,0.5)", margin: 0, letterSpacing: "0.4px",
                }}>
                  CUMULATIVE GPA
                </p>

                {/* Value */}
                <div style={{
                  position: "absolute", left: "32px", right: "32px", top: "64px",
                  display: "flex", alignItems: "baseline",
                }}>
                  <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "42px", color: "#E3E2E2", lineHeight: 1 }}>
                    {STATS[0].value}
                  </span>
                  <span style={{
                    fontFamily: "var(--font-sans)", fontWeight: 700, fontSize: "16px",
                    color: "#C8C5CB", marginLeft: "8px",
                  }}>
                    /4.0
                  </span>
                </div>

                {/* Progress bar */}
                <div style={{ position: "absolute", left: "32px", right: "32px", top: "129px" }}>
                  <div style={{ height: "4px", background: "#343535", borderRadius: "9999px" }}>
                    <div style={{
                      background: "rgba(200,197,203,0.4)",
                      borderRadius: "9999px", height: "100%",
                      width: gpaPercent,
                      transition: "width 0.8s ease",
                    }} />
                  </div>
                </div>

              </div>
            </div>

            {/* Streak card */}
            <div
              className="work-card-large"
              style={{
                ...glassCard,
                padding: "32px",
                display: "flex", flexDirection: "row",
                alignItems: "center", justifyContent: "space-between",
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <p style={{
                  fontFamily: "var(--font-sans)", fontWeight: 400, fontSize: "16px",
                  color: "rgba(200,197,203,0.5)", margin: 0,
                }}>
                  DAILY STREAK
                </p>
                <p style={{
                  fontFamily: "'DM Sans', sans-serif", fontSize: "36px",
                  lineHeight: "40px", color: "#E3E2E2", margin: 0,
                }}>
                  {streakRaw ? `${streakRaw} days` : "0 days"}
                </p>
              </div>
              <div style={{
                width: "64px", height: "64px", borderRadius: "9999px",
                background: "rgba(200,197,203,0.5)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "28px", flexShrink: 0,
              }}>
                <Flame size={26} color="var(--gold)" />
              </div>
            </div>

            {/* Weekly goal card — only shown when Canvas is connected */}
            {hasToken && <div
              className="work-card-large"
              style={{
                ...glassCard,
                background: "rgba(255,255,255,0.045)",
                position: "relative", overflow: "hidden",
              }}
            >

              {/* Content */}
              <div style={{ position: "relative", zIndex: 1, padding: "32px", display: "flex", flexDirection: "column", gap: "32px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  <p style={{
                    fontFamily: "var(--font-sans)", fontWeight: 400, fontSize: "16px",
                    color: "rgba(200,197,203,0.5)", margin: 0,
                  }}>
                    WEEKLY GOAL
                  </p>
                  <p style={{
                    fontFamily: "'DM Sans', sans-serif", fontSize: "36px",
                    color: "#E3E2E2", margin: 0,
                  }}>
                    {completedCount} done
                  </p>
                </div>
                <span style={{
                  padding: "4px 12px",
                  background: "rgba(200,197,203,0.5)",
                  borderRadius: "9999px",
                  fontFamily: "var(--font-sans)",
                  fontWeight: 700, fontSize: "10px", color: "#343535",
                }}>
                  {weeklyPercent}%
                </span>
              </div>

              {/* Bar chart */}
              <div style={{
                display: "flex", flexDirection: "row",
                justifyContent: "center", alignItems: "flex-end",
                gap: "4px", height: "80px",
                overflowX: "hidden", width: "100%",
              }}>
                {barHeights.map((h, i) => (
                  <div key={i} style={{ flex: 1, display: "flex", alignItems: "flex-end", height: "80px" }}>
                    <div style={{
                      width: "100%", height: `${h}px`,
                      background: barColor(i), borderRadius: "2px",
                      transition: "background 0.3s ease",
                    }} />
                  </div>
                ))}
              </div>
              </div> {/* end content wrapper */}
            </div>}

            {/* Recent Activity moved up beside "Pick up where you left off". This right-rail
                copy is a fallback for when there are no indexed materials (so the pick-up
                row — and its activity column — doesn't render). */}
            {showActivity && homeExtras.materials.length === 0 && (
              <div style={{ padding: "0 8px" }}>
                <p style={{
                  fontFamily: "var(--font-sans)", fontWeight: 600,
                  fontSize: "18px", letterSpacing: "-0.18px",
                  color: "#E3E2E2", margin: "0 0 16px",
                }}>
                  Recent Activity
                </p>
                {activityFeedRows}
              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  );
}

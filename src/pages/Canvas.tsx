// Canvas.tsx — Courses page with Figma-matched visual design.
// All data logic (fetchAssignments, fetchModules, addManualCourse, etc.) unchanged.

import { useState, useEffect } from "react";
import { Check, RefreshCw, ChevronUp, ChevronDown } from "lucide-react";
import { useApp } from "../context/AppContext";
import ManualUploadSheet from "../components/ManualUploadSheet";
import { fetchAssignments, fetchModules } from "../../canvas-module/canvasApi";
import { normalizeAssignment, normalizeModule } from "../../canvas-module/canvasTransform";
import { supabase } from "../api/supabase";

/* ─── constants ──────────────────────────────────────────── */

const CARD_BG =
  "linear-gradient(0deg, rgba(0,0,0,0.2), rgba(0,0,0,0.2)), " +
  "radial-gradient(90.05% 130.96% at 9.95% 57.96%, " +
  "rgba(35,35,36,0.6) 17.31%, rgba(74,74,75,0.6) 38.94%, " +
  "rgba(117,117,118,0.6) 57.52%, rgba(25,25,25,0.6) 99.04%)";

/* ─── helpers ─────────────────────────────────────────────── */

function fmt(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  const now = new Date();
  const diff = +d - +now;
  const days = Math.ceil(diff / 86400000);
  if (days < 0)  return { label: "Past due",      urgent: false, past: true  };
  if (days === 0) return { label: "Due today",     urgent: true,  past: false };
  if (days === 1) return { label: "Due tomorrow",  urgent: true,  past: false };
  if (days <= 7)  return { label: `Due in ${days}d`, urgent: false, past: false };
  return {
    label: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    urgent: false, past: false,
  };
}

function scoreColor(score) {
  if (score == null) return "rgba(255,255,255,0.35)";
  if (score >= 90) return "rgba(100,220,130,0.85)";
  if (score >= 80) return "rgba(255,255,255,0.7)";
  if (score >= 70) return "rgba(255,204,0,0.8)";
  return "rgba(255,100,90,0.85)";
}

/* ─── SyncBadge ───────────────────────────────────────────── */

function SyncBadge({ status }) {
  const map = {
    syncing:      { label: "Syncing…",           bg: "rgba(255,204,0,0.12)",   color: "rgba(255,204,0,0.8)"   },
    synced:       { label: "Synced",             bg: "rgba(52,199,89,0.1)",    color: "rgba(100,220,130,0.85)" },
    error:        { label: "Sync error",         bg: "rgba(255,59,48,0.1)",    color: "rgba(255,100,90,0.85)"  },
    "cors-error": { label: "CORS — needs proxy", bg: "rgba(255,59,48,0.1)",    color: "rgba(255,100,90,0.85)"  },
    idle:         { label: "Pending",            bg: "rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.35)" },
  };
  const { label, bg, color } = map[status] ?? map.idle;
  return (
    <span style={{ fontSize: "11px", fontWeight: "500", padding: "4px 10px", borderRadius: "20px", background: bg, color }}>
      {label}
    </span>
  );
}

/* ─── RefreshButton ───────────────────────────────────────── */

function RefreshButton({ syncStatus, onClick, style }: any) {
  const busy = syncStatus === "syncing";
  return (
    <button
      onClick={onClick}
      disabled={busy}
      style={{
        background: "none",
        border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: "20px",
        padding: "4px 12px",
        color: busy ? "rgba(255,255,255,0.3)" : "rgba(255,255,255,0.6)",
        fontSize: "11px", fontWeight: "500",
        cursor: busy ? "not-allowed" : "pointer",
        fontFamily: "inherit",
        transition: "border-color 0.15s, color 0.15s",
        ...style,
      }}
      onMouseEnter={e => { if (!busy) e.currentTarget.style.borderColor = "rgba(255,255,255,0.25)"; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)"; }}
    >
      {busy ? "Syncing…" : <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><RefreshCw size={13} />Refresh</span>}
    </button>
  );
}

/* ─── ConnectCanvas hero card ─────────────────────────────── */

function ConnectCanvas({
  onConnect,
  onManualAdd,
  canvasToken,
  syncStatus,
  onRefresh,
}: {
  onConnect: (token: string, url: string) => Promise<void>;
  onManualAdd: () => void;
  canvasToken: string | null;
  syncStatus: string;
  onRefresh: () => void;
}) {
  const [url,    setUrl]    = useState("");
  const [token,  setToken]  = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!url.trim() || !token.trim() || saving) return;
    setSaving(true);
    await onConnect(token.trim(), url.trim());
    setSaving(false);
  }

  const inputBase: React.CSSProperties = {
    width: "100%",
    padding: "13px 40px 14px",
    borderRadius: "12px",
    background: "rgba(255,255,255,0.05)",
    border: "1px solid rgba(255,255,255,0.1)",
    color: "#E3E2E2",
    fontFamily: "Inter, sans-serif",
    fontSize: "14px",
    outline: "none",
    boxSizing: "border-box",
    transition: "border-color 0.15s",
  };

  return (
    <div style={{
      maxWidth: "710px", margin: "0 auto", padding: "40px",
      borderRadius: "45px", background: CARD_BG,
      border: "1px solid rgba(200,197,203,0.1)",
      position: "relative", overflow: "hidden", textAlign: "center",
    }}>
      {/* Eyebrow badge */}
      <div style={{
        display: "inline-flex", alignItems: "center", gap: "8px",
        padding: "4px 16px", borderRadius: "9999px",
        border: "1px solid rgba(200,197,203,0.2)", marginBottom: "24px",
      }}>
        <div style={{ width: "9px", height: "9px", borderRadius: "9999px", background: "#121414" }} />
        <span style={{
          fontFamily: "Inter, sans-serif", fontSize: "10px",
          textTransform: "uppercase", letterSpacing: "1px", color: "#FEF6E6",
        }}>
          ECOSYSTEM SYNC
        </span>
      </div>

      {canvasToken ? (
        /* ── Connected state ── */
        <>
          <p style={{
            fontFamily: "'Funnel Display', sans-serif", fontWeight: 400,
            fontSize: "32px", lineHeight: "40px", letterSpacing: "-0.32px",
            color: "#E3E2E2", margin: "0 0 16px",
          }}>
            Canvas LMS Connected
          </p>
          <p style={{
            fontFamily: "Inter, sans-serif", fontSize: "16px", lineHeight: "26px",
            color: "#C8C5CB", maxWidth: "500px", margin: "0 auto 32px",
          }}>
            Your academic infrastructure is synced and updating automatically in the background.
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: "12px", justifyContent: "center", marginBottom: "16px" }}>
            <SyncBadge status={syncStatus} />
            <RefreshButton syncStatus={syncStatus} onClick={onRefresh} />
          </div>
          {syncStatus === "cors-error" && (
            <p style={{ fontFamily: "Inter, sans-serif", fontSize: "14px", color: "rgba(255,100,90,0.85)", marginTop: "12px" }}>
              Canvas blocked the last request (CORS). Cached data is displayed.
            </p>
          )}
        </>
      ) : (
        /* ── Not-connected state ── */
        <>
          <p style={{
            fontFamily: "'Funnel Display', sans-serif", fontWeight: 400,
            fontSize: "32px", lineHeight: "40px", letterSpacing: "-0.32px",
            color: "#E3E2E2", margin: "0 0 16px",
          }}>
            Connect Your Canvas LMS
          </p>
          <p style={{
            fontFamily: "Inter, sans-serif", fontSize: "16px", lineHeight: "26px",
            color: "#C8C5CB", maxWidth: "500px", margin: "0 auto 32px",
          }}>
            Seamlessly integrate your academic infrastructure. Enter your institutional credentials below to initiate an automated curriculum handshake.
          </p>

          {/* Input fields */}
          <div style={{
            display: "flex", flexDirection: "column", gap: "16px",
            textAlign: "left", maxWidth: "460px", margin: "0 auto 32px",
          }}>
            {/* Institute URL */}
            <div>
              <p style={{
                fontFamily: "Inter, sans-serif", fontSize: "11px",
                textTransform: "uppercase", letterSpacing: "0.5px",
                color: "rgba(200,197,203,0.7)", margin: "0 0 8px",
              }}>
                INSTITUTE URL
              </p>
              <div style={{ position: "relative" }}>
                <svg style={{ position: "absolute", left: "14px", top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}
                  width="11" height="11" viewBox="0 0 24 24" fill="none"
                  stroke="rgba(200,197,203,0.4)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/>
                  <line x1="2" y1="12" x2="22" y2="12"/>
                  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
                </svg>
                <input
                  value={url} onChange={e => setUrl(e.target.value)}
                  placeholder="canvas.youruni.edu"
                  style={inputBase}
                  onFocus={e => (e.currentTarget.style.borderColor = "rgba(255,255,255,0.25)")}
                  onBlur={e  => (e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)")}
                />
              </div>
            </div>

            {/* Access Token */}
            <div>
              <p style={{
                fontFamily: "Inter, sans-serif", fontSize: "11px",
                textTransform: "uppercase", letterSpacing: "0.5px",
                color: "rgba(200,197,203,0.7)", margin: "0 0 8px",
              }}>
                ACCESS TOKEN
              </p>
              <div style={{ position: "relative" }}>
                <svg style={{ position: "absolute", left: "14px", top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}
                  width="11" height="11" viewBox="0 0 24 24" fill="none"
                  stroke="rgba(200,197,203,0.4)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                  <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                </svg>
                <input
                  value={token} onChange={e => setToken(e.target.value)}
                  placeholder="••••••••••••••••"
                  type="password"
                  style={inputBase}
                  onFocus={e => (e.currentTarget.style.borderColor = "rgba(255,255,255,0.25)")}
                  onBlur={e  => (e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)")}
                />
              </div>
            </div>
          </div>

          {/* Buttons */}
          <div style={{ display: "flex", gap: "16px", justifyContent: "center", marginBottom: "16px" }}>
            <button
              onClick={handleSave}
              disabled={!url.trim() || !token.trim() || saving}
              style={{
                padding: "13px 32px", borderRadius: "12px",
                background: "#C8C5CB", color: "#121414",
                fontFamily: "'Space Grotesk', sans-serif", fontSize: "16px",
                border: "none", display: "flex", alignItems: "center", gap: "12px",
                cursor: !url.trim() || !token.trim() || saving ? "not-allowed" : "pointer",
                opacity: !url.trim() || !token.trim() || saving ? 0.5 : 1,
                transition: "opacity 0.15s",
              }}
            >
              {saving ? "Connecting…" : "Connect Canvas"}
              {!saving && (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#121414" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14M12 5l7 7-7 7"/>
                </svg>
              )}
            </button>

            <button
              style={{
                padding: "13px 32px", borderRadius: "12px",
                background: "transparent", border: "1px solid rgba(255,255,255,0.1)",
                color: "#E3E2E2", fontFamily: "'Space Grotesk', sans-serif", fontSize: "16px",
                display: "flex", alignItems: "center", gap: "12px", cursor: "pointer",
              }}
            >
              Sync Data
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#C8C5CB" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10"/>
                <polyline points="1 20 1 14 7 14"/>
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
              </svg>
            </button>
          </div>

          {/* Footer link */}
          <p
            onClick={onManualAdd}
            style={{
              fontFamily: "Inter, sans-serif", fontSize: "14px",
              color: "rgba(200,197,203,0.7)", textDecoration: "underline",
              cursor: "pointer", margin: 0,
            }}
          >
            Add a course manually instead
          </p>
        </>
      )}
    </div>
  );
}

/* ─── CourseGridCard ─────────────────────────────────────── */

function CourseGridCard({ course, assignments, changes, onSeen, isMobile = false }: any) {
  const courseAssignments = (assignments ?? []).filter((a: any) => a.courseId === course.id);
  const upcoming = courseAssignments.filter(
    (a: any) => !a.submission?.submittedAt && a.dueAt && new Date(a.dueAt) > new Date()
  );
  const missing = courseAssignments.filter((a: any) => a.submission?.missing).length;
  const code  = course.course_code ?? course.courseCode;
  const score = course.current_score ?? course.currentScore ?? course.final_score ?? course.finalScore;
  const progressPct = score != null ? Math.min(Number(score), 100) : 0;

  function handleClick() {
    if (changes && onSeen) onSeen(course.id);
  }

  return (
    <div
      onClick={handleClick}
      style={{
        padding: "29px", borderRadius: "30px", minHeight: "314px",
        background: CARD_BG, border: "1px solid rgba(255,255,255,0.08)",
        position: "relative", overflow: "hidden",
        display: "flex", flexDirection: "column",
        cursor: "default",
        width: "100%", minWidth: 0, boxSizing: "border-box" as const,
      }}
    >
      {/* New-assignment badge */}
      {changes?.newAssignments > 0 && (
        <div style={{
          position: "absolute", top: "16px", right: "16px",
          background: "rgba(10,132,255,0.15)", border: "1px solid rgba(90,170,255,0.3)",
          borderRadius: "9999px", padding: "2px 8px",
          fontFamily: "Inter, sans-serif", fontSize: "10px", color: "rgba(90,170,255,0.95)",
        }}>
          {changes.newAssignments} new
        </div>
      )}

      {/* Top row: icon + tag */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "24px" }}>
        <div style={{
          width: "44px", height: "44px",
          background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: "12px", display: "flex", alignItems: "center", justifyContent: "center",
          flexShrink: 0,
        }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
            stroke="#C8C5CB" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
            <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
          </svg>
        </div>
        <span style={{
          padding: "4px 10px",
          background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.05)",
          borderRadius: "4px", fontFamily: "Inter, sans-serif",
          fontSize: "10px", letterSpacing: "1px", color: "rgba(200,197,203,0.6)",
          textTransform: "uppercase",
        }}>
          {code || "COURSE"}
        </span>
      </div>

      {/* Title */}
      <p style={{
        fontFamily: "Inter, sans-serif", fontWeight: 600, fontSize: "18px",
        letterSpacing: "-0.18px", color: "#E3E2E2", margin: "0 0 8px",
        overflow: "hidden", textOverflow: "ellipsis",
        whiteSpace: isMobile ? "normal" : "nowrap",
      }}>
        {course.name}
      </p>

      {/* Description */}
      <p style={{
        fontFamily: "Inter, sans-serif", fontSize: "14px", lineHeight: "20px",
        color: "rgba(200,197,203,0.7)", margin: "0 0 24px", flex: 1,
        overflow: "hidden", display: "-webkit-box",
        WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as any,
      }}>
        {course.professor
          ? `Prof. ${course.professor}`
          : course.semester ?? "Active course"}
        {missing > 0 ? ` · ${missing} missing` : ""}
      </p>

      {/* Progress */}
      <div style={{ marginBottom: "20px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
          <span style={{ fontFamily: "Inter, sans-serif", fontSize: "11px", color: "rgba(200,197,203,0.8)" }}>
            {score != null ? "Grade" : "Progress"}
          </span>
          <span style={{ fontFamily: "Inter, sans-serif", fontWeight: 700, fontSize: "11px", color: "#C8C5CB" }}>
            {score != null ? `${Math.round(score)}%` : "—"}
          </span>
        </div>
        <div style={{ height: "4px", background: "rgba(255,255,255,0.05)", borderRadius: "9999px" }}>
          <div style={{
            height: "100%", background: "#C8C5CB",
            boxShadow: "0 0 8px rgba(200,197,203,0.3)",
            borderRadius: "9999px", width: `${progressPct}%`,
            transition: "width 0.6s ease",
          }} />
        </div>
      </div>

      {/* Footer */}
      <div style={{
        borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: "16px",
        display: "flex", justifyContent: "space-between", alignItems: "center",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
            stroke="#C8C5CB" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
            <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/>
            <line x1="3" y1="10" x2="21" y2="10"/>
          </svg>
          <span style={{ fontFamily: "Inter, sans-serif", fontSize: "14px", color: "rgba(227,226,226,0.9)" }}>
            {upcoming.length > 0
              ? `${upcoming.length} assignment${upcoming.length !== 1 ? "s" : ""} due`
              : "All caught up"}
          </span>
        </div>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
          stroke="rgba(200,197,203,0.3)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 18l6-6-6-6"/>
        </svg>
      </div>
    </div>
  );
}

/* ─── AddNewCard ─────────────────────────────────────────── */

function AddNewCard({ onClick, isMobile = false }: { onClick: () => void; isMobile?: boolean }) {
  return (
    <div
      onClick={onClick}
      style={{
        padding: "29px", borderRadius: "30px", minHeight: "314px",
        background: "transparent", border: "1px dashed rgba(255,255,255,0.1)",
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", gap: "16px",
        cursor: "pointer",
        width: "100%", minWidth: 0, boxSizing: "border-box" as const,
      }}
    >
      <div style={{
        width: "64px", height: "64px", borderRadius: "9999px",
        background: "rgba(255,255,255,0.03)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none"
          stroke="rgba(200,197,203,0.75)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
      </div>
      <p style={{ fontFamily: "Inter, sans-serif", fontSize: "18px", color: "#E3E2E2", textAlign: "center", margin: 0 }}>
        Add New Course
      </p>
      <p style={{ fontFamily: "Inter, sans-serif", fontSize: "14px", color: "rgba(200,197,203,0.6)", textAlign: "center", margin: 0 }}>
        Import from Canvas or add manually
      </p>
      <span style={{
        border: "1px solid rgba(255,255,255,0.05)", borderRadius: "9999px",
        padding: "8px 20px",
        fontFamily: "Inter, sans-serif", fontSize: "14px", color: "#FFFEFF",
      }}>
        Add manually
      </span>
    </div>
  );
}

/* ─── AnnouncementsSection ────────────────────────────────── */

function AnnouncementsSection({ announcements }) {
  const [open, setOpen] = useState(true);
  if (!announcements?.length) return null;

  return (
    <div style={{ marginBottom: "20px", background: "rgba(26,26,30,0.6)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "16px" }}>
      <button onClick={() => setOpen(o => !o)}
        style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: "14px 18px", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit" }}>
        <span style={{ color: "#E3E2E2", fontSize: "13px", fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase" }}>
          Announcements
        </span>
        <span style={{ color: "rgba(200,197,203,0.4)", fontSize: "12px" }}>
          {announcements.length} · {open ? <ChevronUp size={12} style={{ verticalAlign: "-2px" }} /> : <ChevronDown size={12} style={{ verticalAlign: "-2px" }} />}
        </span>
      </button>

      {open && (
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
          {announcements.slice(0, 5).map((a, i) => (
            <div key={a.id ?? i}
              style={{ padding: "12px 18px", borderBottom: i < Math.min(announcements.length, 5) - 1 ? "1px solid rgba(255,255,255,0.04)" : "none" }}>
              <p style={{ color: "#E3E2E2", fontSize: "13px", fontWeight: 500, marginBottom: "3px" }}>
                {a.title}
              </p>
              <p style={{ color: "rgba(200,197,203,0.4)", fontSize: "11px" }}>
                {a.context_name ?? a.course_name ?? ""}
                {a.posted_at ? ` · ${new Date(a.posted_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : ""}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── PastCoursesSection ──────────────────────────────────── */

function PastCoursesSection({ pastCourses, addedIds, adding, onAdd, onAddManual }) {
  const [open, setOpen]         = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [manualName, setManualName] = useState("");
  const [manualSem,  setManualSem]  = useState("");
  const [manualCode, setManualCode] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleManualSubmit() {
    if (!manualName.trim()) return;
    setSubmitting(true);
    await onAddManual({
      name:       manualName.trim(),
      courseCode: manualCode.trim() || manualName.trim().split(" ")[0].toUpperCase(),
      semester:   manualSem.trim() || "Past",
    });
    setManualName(""); setManualCode(""); setManualSem("");
    setShowForm(false);
    setSubmitting(false);
  }

  const inputSt: React.CSSProperties = {
    width: "100%", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: "8px", padding: "8px 12px", color: "#E3E2E2", fontSize: "13px",
    fontFamily: "inherit", outline: "none", boxSizing: "border-box",
  };

  const grouped: Record<string, any[]> = {};
  pastCourses.forEach(c => {
    const sem = c.semester || "Past";
    if (!grouped[sem]) grouped[sem] = [];
    grouped[sem].push(c);
  });

  return (
    <div style={{ background: "rgba(26,26,30,0.6)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "16px", overflow: "hidden" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 18px" }}>
        <button onClick={() => setOpen(o => !o)}
          style={{ background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: "6px" }}>
          <span style={{ color: "#E3E2E2", fontSize: "13px", fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase" }}>
            Past Courses
          </span>
          <span style={{ color: "rgba(200,197,203,0.4)", fontSize: "12px" }}>
            {pastCourses.length} {open ? <ChevronUp size={12} style={{ verticalAlign: "-2px" }} /> : <ChevronDown size={12} style={{ verticalAlign: "-2px" }} />}
          </span>
        </button>
        <button onClick={() => { setShowForm(f => !f); setOpen(true); }}
          style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: "8px", padding: "5px 12px", color: "rgba(255,255,255,0.6)", fontSize: "11px", fontWeight: 500, cursor: "pointer", fontFamily: "inherit" }}>
          + Add manually
        </button>
      </div>

      {showForm && (
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", padding: "14px 18px", display: "flex", flexDirection: "column", gap: "8px" }}>
          <input style={inputSt} placeholder="Course name (e.g. Intro to Psychology)" value={manualName} onChange={e => setManualName(e.target.value)} />
          <div style={{ display: "flex", gap: "8px" }}>
            <input style={{ ...inputSt, width: "50%" }} placeholder="Code (e.g. PSY101)" value={manualCode} onChange={e => setManualCode(e.target.value)} />
            <input style={{ ...inputSt, width: "50%" }} placeholder="Semester (e.g. Fall 2025)" value={manualSem} onChange={e => setManualSem(e.target.value)} />
          </div>
          <button onClick={handleManualSubmit} disabled={!manualName.trim() || submitting}
            style={{ background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: "8px", padding: "8px", color: "#E3E2E2", fontSize: "13px", fontWeight: 500, cursor: "pointer", fontFamily: "inherit", opacity: (!manualName.trim() || submitting) ? 0.5 : 1 }}>
            {submitting ? "Adding…" : "Add Course"}
          </button>
        </div>
      )}

      {open && (
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
          {pastCourses.length === 0 && (
            <p style={{ padding: "14px 18px", color: "rgba(200,197,203,0.4)", fontSize: "13px" }}>
              No past courses from Canvas. Add them manually above.
            </p>
          )}
          {Object.entries(grouped).map(([semester, semCourses]) => (
            <div key={semester}>
              <p style={{ padding: "10px 18px 6px", fontSize: "10px", color: "rgba(200,197,203,0.4)", letterSpacing: "1.5px", textTransform: "uppercase" }}>
                {semester}
              </p>
              {(semCourses as any[]).map((c, i) => {
                const added = (addedIds as Set<any>).has(c.id);
                return (
                  <div key={c.id ?? i} style={{ padding: "11px 18px", borderBottom: i < semCourses.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <p style={{ color: "#E3E2E2", fontSize: "13px", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {c.name}
                      </p>
                      <p style={{ color: "rgba(200,197,203,0.4)", fontSize: "11px", marginTop: "2px" }}>
                        {c.courseCode}{c.finalScore != null ? ` · ${Math.round(c.finalScore)}%` : ""}
                      </p>
                    </div>
                    <button onClick={() => onAdd(c)} disabled={added || adding}
                      style={{ background: added ? "rgba(100,220,130,0.1)" : "rgba(255,255,255,0.07)", border: `1px solid ${added ? "rgba(100,220,130,0.25)" : "rgba(255,255,255,0.12)"}`, borderRadius: "8px", padding: "5px 12px", color: added ? "rgba(100,220,130,0.8)" : "rgba(255,255,255,0.6)", fontSize: "11px", fontWeight: 500, cursor: added || adding ? "default" : "pointer", fontFamily: "inherit", flexShrink: 0, marginLeft: "10px", transition: "all 0.15s" }}>
                      {added ? <span style={{ display:"inline-flex", alignItems:"center", gap:4 }}>Added<Check size={12} /></span> : adding ? "Adding…" : "+ Add"}
                    </button>
                  </div>
                );
              })}
            </div>
          ))}
          <p style={{ padding: "10px 18px 12px", color: "rgba(200,197,203,0.4)", fontSize: "11px", lineHeight: "1.5" }}>
            Added courses appear in your active course list and are included in AI context.
          </p>
        </div>
      )}
    </div>
  );
}

/* ─── Main Canvas page ───────────────────────────────────── */

export default function Canvas() {
  const {
    courses, assignments, announcements,
    modules, assignmentGroups,
    setModules, setAssignments,
    canvasToken, canvasBaseUrl, syncStatus, saveCanvasCredentials,
    userId, addManualCourse, refreshFromSupabase,
    cardChanges, markCardSeen,
    pastCourses,
  } = useApp();

  const [showUpload,   setShowUpload]   = useState(false);
  const [addingPast,   setAddingPast]   = useState(false);
  const [gridView,     setGridView]     = useState(true);
  const [addedPastIds, setAddedPastIds] = useState<Set<any>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem("fschool_added_past") || "[]")); }
    catch { return new Set(); }
  });
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Inject fonts
  useEffect(() => {
    const link = document.createElement("link");
    link.href = "https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Funnel+Display:wght@300;400;500;600;700&family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;500;600;700&display=swap";
    link.rel = "stylesheet";
    document.head.appendChild(link);
    return () => { document.head.removeChild(link); };
  }, []);

  // ── handlers (unchanged logic) ────────────────────────── //

  async function handleAddPastCourse(pastCourse) {
    if (addedPastIds.has(pastCourse.id)) return;
    setAddingPast(true);

    const dbCourseId = await addManualCourse(
      {
        name:           pastCourse.name,
        courseCode:     pastCourse.courseCode,
        source:         "past_canvas",
        semester:       pastCourse.semester,
        canvasCourseId: pastCourse.id,
      },
      []
    );

    const next = new Set(addedPastIds);
    next.add(pastCourse.id);
    setAddedPastIds(next);
    localStorage.setItem("fschool_added_past", JSON.stringify([...next]));

    if (canvasToken && canvasBaseUrl && dbCourseId) {
      const [assignResult, moduleResult] = await Promise.allSettled([
        fetchAssignments(canvasToken, canvasBaseUrl, pastCourse.id, "/api/canvas"),
        fetchModules(canvasToken, canvasBaseUrl, pastCourse.id, "/api/canvas"),
      ]);

      if (assignResult.status === "fulfilled" && assignResult.value.length > 0) {
        const meta = { courseId: String(pastCourse.id), courseCode: pastCourse.courseCode, courseName: pastCourse.name };
        const normalized = assignResult.value.map(a => normalizeAssignment(a, meta));
        const rows = normalized.map(a => ({
          user_id:              userId,
          course_id:            dbCourseId,
          canvas_assignment_id: String(a.id),
          title:                a.name,
          description:          a.description ?? null,
          due_at:               a.dueAt ?? null,
          points_possible:      a.pointsPossible ?? null,
          score:                a.submission?.score ?? null,
          submitted_at:         a.submission?.submittedAt ?? null,
          late:                 a.submission?.late ?? false,
          missing:              a.submission?.missing ?? false,
          submission_type:      a.submission?.submissionType ?? null,
          source:               "past_canvas",
          is_manual:            false,
        })).filter(r => r.canvas_assignment_id);
        await supabase.from("assignments").upsert(rows, { onConflict: "user_id,canvas_assignment_id" });
        const ctxAssignments = normalized.map(a => ({ ...a, courseId: dbCourseId }));
        setAssignments(prev => [...prev, ...ctxAssignments]);
      }

      if (moduleResult.status === "fulfilled" && moduleResult.value.length > 0) {
        const moduleEntry = {
          courseId:   dbCourseId,
          courseCode: pastCourse.courseCode,
          courseName: pastCourse.name,
          modules:    moduleResult.value.map(normalizeModule),
        };
        setModules(prev => [...prev, moduleEntry]);
      }
    }

    setAddingPast(false);
  }

  async function handleAddManualPast(course) {
    setAddingPast(true);
    const tempId = `manual_past_${Date.now()}`;
    await addManualCourse(
      { name: course.name, courseCode: course.courseCode, source: "manual_past", semester: course.semester },
      []
    );
    // Re-read from Supabase so the new past course lands in the Past Courses bucket
    // (loadCanvasData splits past-source courses out of the main list) right away.
    await refreshFromSupabase().catch(() => {});
    const next = new Set(addedPastIds);
    next.add(tempId);
    setAddedPastIds(next);
    localStorage.setItem("fschool_added_past", JSON.stringify([...next]));
    setAddingPast(false);
  }

  // ── render ─────────────────────────────────────────────── //

  return (
    <div style={{ minHeight: "100vh", background: "transparent" }}>

      {/* Page header */}
      <div style={{ textAlign: "center", marginBottom: "64px" }}>
        <h1 style={{
          fontFamily: "'Funnel Display', sans-serif", fontWeight: 300,
          fontSize: "48px", lineHeight: "56px", letterSpacing: "-1.2px",
          color: "#E3E2E2", textAlign: "center", margin: "0 0 16px",
        }}>
          Your Courses
        </h1>
        <p style={{
          fontFamily: "Inter, sans-serif", fontWeight: 400,
          fontSize: "16px", lineHeight: "24px", color: "#C8C5CB",
          textAlign: "center", maxWidth: "628px", margin: "0 auto",
        }}>
          Manage your academic curriculum, track student progress, and utilize
          AI-enhanced teaching tools across all active departments.
        </p>
      </div>

      {/* Connect Canvas hero card */}
      <ConnectCanvas
        onConnect={saveCanvasCredentials}
        onManualAdd={() => setShowUpload(true)}
        canvasToken={canvasToken}
        syncStatus={syncStatus}
        onRefresh={refreshFromSupabase}
      />

      {/* Course Library */}
      <div style={{ marginTop: "80px" }}>

        {/* Section header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "32px" }}>
          <div>
            <p style={{
              fontFamily: "Inter, sans-serif", fontWeight: 600, fontSize: "18px",
              letterSpacing: "-0.18px", color: "#E3E2E2", margin: "0 0 4px",
            }}>
              Course Library
            </p>
            <p style={{ fontFamily: "Inter, sans-serif", fontSize: "14px", color: "rgba(200,197,203,0.5)", margin: 0 }}>
              {courses.length} active course{courses.length !== 1 ? "s" : ""} this semester
            </p>
          </div>

          {/* View toggle */}
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              onClick={() => setGridView(true)}
              style={{
                width: "32px", height: "36px", cursor: "pointer",
                background: gridView ? "rgba(200,197,203,0.1)" : "rgba(26,26,30,0.6)",
                border: gridView ? "1px solid rgba(200,197,203,0.2)" : "1px solid rgba(255,255,255,0.08)",
                borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center",
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#C8C5CB" strokeWidth="2">
                <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
                <rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
              </svg>
            </button>
            <button
              onClick={() => setGridView(false)}
              style={{
                width: "32px", height: "36px", cursor: "pointer",
                background: !gridView ? "rgba(200,197,203,0.1)" : "rgba(26,26,30,0.6)",
                border: !gridView ? "1px solid rgba(200,197,203,0.2)" : "1px solid rgba(255,255,255,0.08)",
                borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center",
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#C8C5CB" strokeWidth="2">
                <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/>
                <line x1="8" y1="18" x2="21" y2="18"/>
                <line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/>
                <line x1="3" y1="18" x2="3.01" y2="18"/>
              </svg>
            </button>
          </div>
        </div>

        {/* Course grid */}
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3, 1fr)", gap: "20px", width: "100%" }}>
          {courses.map(c => (
            <CourseGridCard
              key={c.id ?? c.course_code ?? c.courseCode}
              course={c}
              assignments={assignments}
              changes={cardChanges?.[String(c.id)]}
              onSeen={markCardSeen}
              isMobile={isMobile}
            />
          ))}
          <AddNewCard onClick={() => setShowUpload(true)} isMobile={isMobile} />
        </div>

        {syncStatus === "syncing" && courses.length === 0 && (
          <p style={{ textAlign: "center", fontFamily: "Inter, sans-serif", fontSize: "14px", color: "rgba(200,197,203,0.5)", marginTop: "40px" }}>
            Syncing your courses…
          </p>
        )}
      </div>

      {/* Announcements */}
      {announcements?.length > 0 && (
        <div style={{ marginTop: "80px" }}>
          <AnnouncementsSection announcements={announcements} />
        </div>
      )}

      {/* Past courses (preserved functionality) */}
      {(pastCourses?.length ?? 0) > 0 && (
        <div style={{ marginTop: "40px" }}>
          <PastCoursesSection
            pastCourses={pastCourses || []}
            addedIds={addedPastIds}
            adding={addingPast}
            onAdd={handleAddPastCourse}
            onAddManual={handleAddManualPast}
          />
        </div>
      )}

      {showUpload && (
        <ManualUploadSheet
          onClose={() => setShowUpload(false)}
          onSave={(course, newAssignments) => {
            addManualCourse(course, newAssignments);
            setShowUpload(false);
          }}
        />
      )}
    </div>
  );
}

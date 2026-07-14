// Courses.jsx — Course-first view. Grid of course cards → tap a course to see
// that course's assignments + grade. Reads live courses/assignments from AppContext.

import { useState, useMemo } from "react";
import { calendarDaysUntil } from "../lib/dueDate";
import { useApp } from "../context/AppContext";

const card = {
  background: "var(--color-surface)",
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius-card)",
  boxShadow: "var(--depth-line)",
};

// Course-code colour palette (matches Toolkit knowledge-graph hues)
const PALETTE = ["#64b4ff", "#64dc9b", "#ffc364", "#be82ff", "#ff8080", "#4ecdc4", "#ffe66d", "#a8e6cf"];
function colorFor(i) { return PALETTE[i % PALETTE.length]; }

// Normalise any course label to a stable join key: "CPS420 - ..." → "cps420"
function deriveCode(s) {
  const str = String(s || "").trim().toLowerCase();
  const m = str.match(/^[a-z]{2,}\s*\d+/);
  return m ? m[0].replace(/\s+/g, "") : str.slice(0, 24);
}

// True if an assignment belongs to a course — tolerant of id/code format drift
function belongsTo(a, course) {
  if (a.courseId && course.id && a.courseId === course.id) return true;
  if (a.courseCode && course.courseCode && a.courseCode === course.courseCode) return true;
  const ac = deriveCode(a.courseCode || a.courseName || a.courseId);
  const cc = deriveCode(course.courseCode || course.id || course.name);
  return ac && cc && ac === cc;
}

function scoreToLetter(pct) {
  if (pct == null) return null;
  if (pct >= 90) return "A";
  if (pct >= 85) return "A-";
  if (pct >= 80) return "B+";
  if (pct >= 75) return "B";
  if (pct >= 70) return "B-";
  if (pct >= 65) return "C+";
  if (pct >= 60) return "C";
  if (pct >= 50) return "D";
  return "F";
}

function formatDue(dateStr) {
  if (!dateStr) return null;
  const due = new Date(dateStr);
  const diffDays = calendarDaysUntil(dateStr);
  if (diffDays === null) return null;
  if (diffDays < 0)   return { label: "Overdue",   urgent: true };
  if (diffDays === 0) return { label: "Due today", urgent: true };
  if (diffDays === 1) return { label: "Tomorrow",  urgent: true };
  return { label: due.toLocaleDateString("en-US", { month: "short", day: "numeric" }), urgent: false };
}

// ── Course detail: assignments + grade for one course ────────────────────────
function CourseDetail({ course, assignments, color, onBack }) {
  const courseAssignments = useMemo(
    () => assignments
      .filter(a => belongsTo(a, course))
      .sort((a, b) => {
        if (!a.dueAt && !b.dueAt) return 0;
        if (!a.dueAt) return 1;
        if (!b.dueAt) return -1;
        return +new Date(a.dueAt) - +new Date(b.dueAt);
      }),
    [assignments, course]
  );

  const graded    = courseAssignments.filter(a => a.submission?.score != null);
  const submitted = courseAssignments.filter(a => a.submission?.submittedAt).length;
  const letter    = scoreToLetter(course.currentScore);

  return (
    <div>
      <button
        onClick={onBack}
        style={{ background: "none", border: "none", color: "var(--text-secondary)", fontSize: "14px", cursor: "pointer", fontFamily: "inherit", padding: 0, marginBottom: "18px" }}
      >
        ← All courses
      </button>

      {/* Course header */}
      <div style={{ marginBottom: "24px" }}>
        <span style={{ color, fontSize: "12px", fontWeight: "700", letterSpacing: "0.5px" }}>{course.courseCode}</span>
        <h1 style={{ fontSize: "24px", fontWeight: "600", color: "var(--text-primary)", letterSpacing: "-0.3px", marginTop: "4px", lineHeight: 1.25 }}>
          {course.name}
        </h1>
        {course.professor && (
          <p style={{ color: "var(--text-dim)", fontSize: "13px", marginTop: "6px" }}>Prof. {course.professor}</p>
        )}
      </div>

      {/* Grade summary */}
      <div style={{ display: "flex", gap: "10px", marginBottom: "24px" }}>
        <div style={{ ...card, flex: 1, padding: "16px", textAlign: "center" }}>
          <p style={{ fontSize: "26px", fontWeight: "700", color, letterSpacing: "-0.5px" }}>
            {course.currentScore != null ? `${Math.round(course.currentScore)}%` : "—"}
          </p>
          <p style={{ color: "var(--text-secondary)", fontSize: "11px", marginTop: "2px" }}>Current grade</p>
        </div>
        <div style={{ ...card, flex: 1, padding: "16px", textAlign: "center" }}>
          <p style={{ fontSize: "26px", fontWeight: "700", color: "var(--text-primary)", letterSpacing: "-0.5px" }}>
            {letter ?? "—"}
          </p>
          <p style={{ color: "var(--text-secondary)", fontSize: "11px", marginTop: "2px" }}>Letter</p>
        </div>
        <div style={{ ...card, flex: 1, padding: "16px", textAlign: "center" }}>
          <p style={{ fontSize: "26px", fontWeight: "700", color: "var(--text-primary)", letterSpacing: "-0.5px" }}>
            {courseAssignments.length}
          </p>
          <p style={{ color: "var(--text-secondary)", fontSize: "11px", marginTop: "2px" }}>Items</p>
        </div>
      </div>

      {/* Assignments */}
      <p style={{ fontSize: "11px", color: "var(--text-dim)", letterSpacing: "2px", textTransform: "uppercase", marginBottom: "12px" }}>
        Assignments
      </p>
      {courseAssignments.length === 0 ? (
        <div style={{ ...card, padding: "24px", textAlign: "center" }}>
          <p style={{ color: "var(--text-secondary)", fontSize: "14px" }}>No assignments synced for this course</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {courseAssignments.map(a => {
            const due       = formatDue(a.dueAt);
            const score     = a.submission?.score;
            const submitted = Boolean(a.submission?.submittedAt);
            return (
              <div key={a.id} style={{ ...card, padding: "14px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px" }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <p style={{ color: "var(--text-primary)", fontSize: "14px", fontWeight: "500", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {a.name}
                  </p>
                  <p style={{ color: "var(--text-dim)", fontSize: "12px", marginTop: "2px" }}>
                    {submitted ? "Submitted" : due ? due.label : "No due date"}
                  </p>
                </div>
                {score != null ? (
                  <span style={{ fontSize: "13px", fontWeight: "700", color, flexShrink: 0 }}>
                    {a.pointsPossible ? `${Math.round((score / a.pointsPossible) * 100)}%` : score}
                  </span>
                ) : due?.urgent ? (
                  <span style={{ fontSize: "11px", fontWeight: "600", padding: "4px 10px", borderRadius: "20px", background: "rgba(255,59,48,0.15)", color: "rgba(255,100,90,0.9)", flexShrink: 0, whiteSpace: "nowrap" }}>
                    {due.label}
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Main: course grid ─────────────────────────────────────────────────────────
export default function Courses() {
  const { courses, assignments } = useApp();
  const [selectedId, setSelectedId] = useState(null);

  const selected = courses.find(c => c.id === selectedId);
  if (selected) {
    const idx = courses.findIndex(c => c.id === selectedId);
    return <CourseDetail course={selected} assignments={assignments} color={colorFor(idx)} onBack={() => setSelectedId(null)} />;
  }

  return (
    <div>
      <h1 style={{ fontSize: "26px", fontWeight: "600", color: "var(--text-primary)", marginBottom: "4px", letterSpacing: "-0.3px" }}>
        Courses
      </h1>
      <p style={{ color: "var(--text-dim)", fontSize: "14px", marginBottom: "24px" }}>
        {courses.length > 0 ? `${courses.length} course${courses.length !== 1 ? "s" : ""} · tap to view details` : "Sync your portal to see courses"}
      </p>

      {courses.length === 0 ? (
        <div style={{ ...card, padding: "24px" }}>
          <p style={{ color: "var(--text-secondary)", fontSize: "14px", marginBottom: "4px" }}>No courses yet</p>
          <p style={{ color: "var(--text-dim)", fontSize: "12px" }}>Connect Canvas or use the browser extension to sync your courses here.</p>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
          {courses.map((c, i) => {
            const color  = colorFor(i);
            const letter = scoreToLetter(c.currentScore);
            const count  = assignments.filter(a => belongsTo(a, c)).length;
            return (
              <div
                key={c.id}
                role="button"
                tabIndex={0}
                onClick={() => setSelectedId(c.id)}
                onKeyDown={e => e.key === "Enter" && setSelectedId(c.id)}
                style={{
                  ...card, padding: "16px", cursor: "pointer", minHeight: "120px",
                  display: "flex", flexDirection: "column", justifyContent: "space-between",
                  borderTop: `2px solid ${color}`,
                  transition: "background var(--dur-base) var(--ease-apple)",
                }}
                onMouseEnter={e => (e.currentTarget.style.background = "var(--color-surface-hover)")}
                onMouseLeave={e => (e.currentTarget.style.background = "var(--color-surface)")}
              >
                <div>
                  <span style={{ color, fontSize: "11px", fontWeight: "700", letterSpacing: "0.5px" }}>{c.courseCode}</span>
                  <p style={{ color: "var(--text-primary)", fontSize: "14px", fontWeight: "500", marginTop: "6px", lineHeight: 1.35,
                    display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                    {c.name}
                  </p>
                  {c.professor && (
                    <p style={{ color: "var(--text-dim)", fontSize: "11px", marginTop: "4px" }}>Prof. {c.professor}</p>
                  )}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginTop: "12px" }}>
                  <span style={{ color: "var(--text-dim)", fontSize: "11px" }}>{count} item{count !== 1 ? "s" : ""}</span>
                  {c.currentScore != null && (
                    <span style={{ color, fontSize: "15px", fontWeight: "700" }}>
                      {letter} · {Math.round(c.currentScore)}%
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

import { useState, useRef, useEffect } from "react";
import { ChevronUp, ChevronDown } from "lucide-react";
import { useApp } from "../context/AppContext";
import { calcRequiredScore, GRADE_TARGETS, AssignmentGroup } from "../lib/whatif";

function GradeDropdown({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const selected = GRADE_TARGETS.find(g => g.pct === value) ?? GRADE_TARGETS[0];

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: "8px", color: "var(--text-primary)", fontSize: "12px",
          padding: "5px 28px 5px 10px", fontFamily: "inherit", cursor: "pointer",
          outline: "none", position: "relative", textAlign: "left", whiteSpace: "nowrap",
        }}
      >
        {selected.label} (≥{selected.pct}%)
        <span style={{ position: "absolute", right: "8px", top: "50%", transform: "translateY(-50%)", opacity: 0.5, fontSize: "10px" }}>▾</span>
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 100,
          background: "#1e1e2a", border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: "8px", overflow: "hidden", minWidth: "200px",
          boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
        }}>
          {GRADE_TARGETS.map(g => {
            const isSelected = g.pct === value;
            const isHovered  = hovered === g.pct;
            const bg = isSelected
              ? "rgba(100,180,255,0.1)"
              : isHovered ? "rgba(255,255,255,0.06)" : "transparent";
            return (
              <div
                key={g.label}
                onClick={() => { onChange(g.pct); setOpen(false); }}
                onMouseEnter={() => setHovered(g.pct)}
                onMouseLeave={() => setHovered(null)}
                style={{
                  padding: "8px 14px", fontSize: "12px", cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", whiteSpace: "nowrap",
                  color: isSelected ? "rgba(100,180,255,0.9)" : "var(--text-secondary)",
                  background: bg,
                }}
              >
                <span>{g.label} (≥{g.pct}%)</span>
                <span style={{ opacity: 0.72, fontSize: "11px", color: isSelected ? "rgba(100,180,255,0.75)" : "rgba(255,255,255,0.5)" }}>
                  GPA: {g.gpa.toFixed(1)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const COURSE_COLORS = [
  "rgba(100,180,255,0.85)",
  "rgba(100,215,130,0.85)",
  "rgba(255,185,60,0.85)",
  "rgba(190,140,255,0.85)",
  "rgba(255,105,100,0.85)",
  "rgba(60,220,200,0.75)",
  "rgba(255,145,180,0.85)",
  "rgba(255,215,80,0.85)",
];

function gradeColor(pct: number | null): string {
  if (pct == null) return "rgba(255,255,255,0.35)";
  if (pct >= 90)   return "rgba(100,220,130,0.85)";
  if (pct >= 80)   return "rgba(255,255,255,0.7)";
  if (pct >= 70)   return "rgba(255,204,0,0.8)";
  return "rgba(255,100,90,0.85)";
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

export default function WhatIfPanel() {
  const { courses, assignments, assignmentGroups } = useApp();
  const [expanded,      setExpanded]      = useState<string | null>(null);
  const [targets,       setTargets]       = useState<Record<string, number>>({});
  const [hypotheticals, setHypotheticals] = useState<Record<string, Record<string | number, string>>>({});

  if (!courses?.length) {
    return (
      <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-card)", padding: "32px 24px", textAlign: "center" }}>
        <p style={{ color: "var(--text-secondary)", fontSize: "14px", fontWeight: "500", marginBottom: "6px" }}>No courses yet</p>
        <p style={{ color: "var(--text-dim)", fontSize: "12px" }}>Connect Canvas to calculate required grades</p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      {courses.map((course, idx) => {
        const cid   = String(course.id);
        const color = COURSE_COLORS[idx % COURSE_COLORS.length];
        const open  = expanded === cid;

        const courseAssignments = assignments.filter(a => String(a.courseId) === cid);
        const target  = targets[cid] ?? 75;
        const hypoStr = hypotheticals[cid] ?? {};

        const hypoNums: Record<string | number, number> = {};
        for (const [k, v] of Object.entries(hypoStr)) {
          const n = parseFloat(v);
          if (!isNaN(n) && n >= 0) {
            const pp = courseAssignments.find(a => String(a.id) === k)?.pointsPossible ?? Infinity;
            hypoNums[k] = Math.min(n, pp);
          }
        }

        // Pull assignment groups for this course from context
        const courseGroups: AssignmentGroup[] =
          (assignmentGroups as any[])
            ?.find((ag: any) => String(ag.courseId) === cid)
            ?.groups ?? [];

        const now = Date.now();
        const isPastDue = (a: any) =>
          a.submission?.missing === true ||
          (a.submission?.score == null && a.dueAt != null && new Date(a.dueAt).getTime() < now);

        const inputs = courseAssignments.map(a => ({
          id:              a.id,
          pointsPossible:  a.pointsPossible ?? null,
          submissionScore: a.submission?.score ?? (isPastDue(a) ? 0 : null),
          weight:          a.weight ?? null,
          weightAchieved:  a.weightAchieved ?? null,
        }));

        const result   = calcRequiredScore(inputs, target, hypoNums, courseGroups);
        const hasHypos = Object.keys(hypoNums).length > 0;
        // Only show truly upcoming work (not past-due missed assignments)
        const ungraded = courseAssignments.filter(
          a => a.submission?.score == null &&
               !isPastDue(a) &&
               (a.pointsPossible ?? 0) > 0
        );

        function setHypo(aId: string | number, val: string) {
          setHypotheticals(prev => ({
            ...prev,
            [cid]: { ...(prev[cid] ?? {}), [aId]: val },
          }));
        }

        return (
          <div key={cid} style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-card)" }}>

            {/* ── Header ── */}
            <div
              style={{ padding: "16px 18px", display: "flex", alignItems: "center", gap: "12px", cursor: "pointer" }}
              onClick={() => setExpanded(open ? null : cid)}
              onMouseEnter={e => (e.currentTarget.style.background = "var(--color-surface-hover)")}
              onMouseLeave={e => (e.currentTarget.style.background = "")}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "3px" }}>
                  <span style={{ fontSize: "10px", color, fontWeight: "600", letterSpacing: "0.5px" }}>
                    {course.courseCode ?? ""}
                  </span>
                  {result.isWeighted && (
                    <span style={{ fontSize: "9px", color: "rgba(100,180,255,0.5)", background: "rgba(100,180,255,0.08)", border: "1px solid rgba(100,180,255,0.15)", borderRadius: "4px", padding: "1px 5px", letterSpacing: "0.5px" }}>
                      WEIGHTED
                    </span>
                  )}
                </div>
                <p style={{ color: "var(--text-primary)", fontSize: "14px", fontWeight: "500", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {course.name}
                </p>
              </div>
              <span style={{ fontSize: "18px", fontWeight: "700", color: gradeColor(result.currentPct), flexShrink: 0 }}>
                {result.currentPct != null ? `${fmt(result.currentPct)}%` : "—"}
              </span>
              <span style={{ color: "var(--text-dim)", display: "flex", flexShrink: 0 }}>
                {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </span>
            </div>

            {/* ── Expanded body ── */}
            {open && (
              <div style={{ borderTop: "1px solid rgba(255,255,255,0.05)", padding: "16px 18px 20px" }}>

                {/* Target picker */}
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
                  <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>I want:</span>
                  <GradeDropdown
                    value={target}
                    onChange={v => setTargets(prev => ({ ...prev, [cid]: v }))}
                  />
                </div>

                {/* Result block */}
                {(() => {
                  // All remaining work filled in via simulation → show projected outcome
                  if (result.noRemainingWork && hasHypos) {
                    const proj = result.projectedPct;
                    const achieved = proj != null && proj >= target;
                    const projColor = gradeColor(proj);
                    return (
                      <div style={{ background: achieved ? "rgba(100,220,130,0.07)" : "rgba(255,255,255,0.04)", border: `1px solid ${achieved ? "rgba(100,220,130,0.2)" : "rgba(255,255,255,0.08)"}`, borderRadius: "10px", padding: "14px 16px", marginBottom: "16px", textAlign: "center" }}>
                        <p style={{ fontSize: "11px", color: "var(--text-dim)", marginBottom: "4px", textTransform: "uppercase", letterSpacing: "1px" }}>Projected grade</p>
                        <p style={{ fontSize: "32px", fontWeight: "800", color: projColor, lineHeight: 1 }}>{proj != null ? `${fmt(proj)}%` : "—"}</p>
                        <p style={{ fontSize: "11px", color: achieved ? "rgba(100,220,130,0.7)" : "var(--text-dim)", marginTop: "4px" }}>
                          {achieved ? `You'd hit your ${GRADE_TARGETS.find(g => g.pct === target)?.label} target` : `Still below your ${GRADE_TARGETS.find(g => g.pct === target)?.label} target — adjust your simulation`}
                        </p>
                      </div>
                    );
                  }
                  // All real work graded, no simulations
                  if (result.noRemainingWork) {
                    const col = result.alreadyAchieved ? "rgba(100,220,130,0.9)" : gradeColor(result.currentPct);
                    return (
                      <div style={{ background: "rgba(255,255,255,0.04)", borderRadius: "10px", padding: "14px 16px", marginBottom: "16px", textAlign: "center" }}>
                        <p style={{ fontSize: "15px", fontWeight: "700", color: col }}>
                          {result.alreadyAchieved ? "Already achieved" : "All work graded"}
                        </p>
                        <p style={{ fontSize: "11px", color: "var(--text-dim)", marginTop: "3px" }}>
                          {result.alreadyAchieved ? "Your grade already meets this target" : "No remaining work — grade is final"}
                        </p>
                      </div>
                    );
                  }
                  if (result.alreadyAchieved) {
                    return (
                      <div style={{ background: "rgba(100,220,130,0.07)", border: "1px solid rgba(100,220,130,0.2)", borderRadius: "10px", padding: "14px 16px", marginBottom: "16px", textAlign: "center" }}>
                        <p style={{ fontSize: "15px", fontWeight: "700", color: "rgba(100,220,130,0.9)" }}>Already on track</p>
                        <p style={{ fontSize: "11px", color: "var(--text-dim)", marginTop: "3px" }}>Your current grade already meets this target</p>
                      </div>
                    );
                  }
                  if (!result.isPossible) {
                    return (
                      <div style={{ background: "rgba(255,100,90,0.07)", border: "1px solid rgba(255,100,90,0.2)", borderRadius: "10px", padding: "14px 16px", marginBottom: "16px", textAlign: "center" }}>
                        <p style={{ fontSize: "15px", fontWeight: "700", color: "rgba(255,100,90,0.9)" }}>Not achievable</p>
                        <p style={{ fontSize: "11px", color: "var(--text-dim)", marginTop: "3px" }}>Would require over 100% on remaining work</p>
                      </div>
                    );
                  }
                  const reqColor = gradeColor(result.requiredPct);
                  return (
                    <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "10px", padding: "14px 16px", marginBottom: "16px", textAlign: "center" }}>
                      <p style={{ fontSize: "11px", color: "var(--text-dim)", marginBottom: "4px", textTransform: "uppercase", letterSpacing: "1px" }}>You need on remaining work</p>
                      <p style={{ fontSize: "32px", fontWeight: "800", color: reqColor, lineHeight: 1 }}>{fmt(result.requiredPct!)}%</p>
                      <p style={{ fontSize: "11px", color: "var(--text-dim)", marginTop: "4px" }}>averaged across all ungraded assignments</p>
                    </div>
                  );
                })()}

                {/* Group breakdown (weighted courses) */}
                {result.isWeighted && result.groups.length > 0 && (
                  <div style={{ marginBottom: "16px" }}>
                    <p style={{ fontSize: "10px", color: "var(--text-dim)", letterSpacing: "1.5px", textTransform: "uppercase", marginBottom: "8px" }}>Grade breakdown</p>
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      {result.groups.map(g => (
                        <div key={String(g.id)} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "8px 12px", background: "rgba(255,255,255,0.03)", borderRadius: "8px" }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <p style={{ fontSize: "12px", color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.name}</p>
                          </div>
                          <span style={{ fontSize: "10px", color: "var(--text-dim)", flexShrink: 0 }}>{g.weight}%</span>
                          <span style={{ fontSize: "13px", fontWeight: "600", color: gradeColor(g.currentPct), flexShrink: 0, minWidth: "44px", textAlign: "right" }}>
                            {g.currentPct != null ? `${fmt(g.currentPct)}%` : "—"}
                          </span>
                          {g.ungradedTotal > 0 && (
                            <span style={{ fontSize: "10px", color: "rgba(255,204,0,0.6)", flexShrink: 0 }}>
                              {fmt(g.ungradedTotal)} pts left
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Points summary pills (points-based) or raw totals (weighted) */}
                <div style={{ display: "flex", gap: "8px", marginBottom: "16px", flexWrap: "wrap" }}>
                  {[
                    { label: "Earned",    value: fmt(result.earnedPoints)  },
                    { label: "Graded",    value: fmt(result.scoredTotal)   },
                    { label: "Remaining", value: fmt(result.ungradedTotal) },
                    { label: "Total",     value: fmt(result.grandTotal)    },
                  ].map(({ label, value }) => (
                    <div key={label} style={{ background: "rgba(255,255,255,0.04)", borderRadius: "8px", padding: "8px 12px", flex: 1, minWidth: "60px" }}>
                      <p style={{ fontSize: "9px", color: "var(--text-dim)", letterSpacing: "1px", textTransform: "uppercase", marginBottom: "4px" }}>{label}</p>
                      <p style={{ fontSize: "14px", fontWeight: "600", color: "var(--text-primary)" }}>{value}</p>
                    </div>
                  ))}
                </div>

                {/* Hypothetical score inputs */}
                {ungraded.length > 0 && (
                  <div>
                    <p style={{ fontSize: "10px", color: "var(--text-dim)", letterSpacing: "1.5px", textTransform: "uppercase", marginBottom: "10px" }}>
                      Simulate upcoming scores
                    </p>
                    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                      {ungraded.map(a => (
                        <div key={a.id} style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                          <p style={{ flex: 1, fontSize: "12px", color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
                            {a.name}
                          </p>
                          <span style={{ fontSize: "11px", color: "var(--text-dim)", flexShrink: 0 }}>
                            /{a.pointsPossible} pts
                          </span>
                          <input
                            type="number"
                            min={0}
                            max={a.pointsPossible ?? undefined}
                            placeholder="?"
                            value={hypoStr[a.id] ?? ""}
                            onChange={e => setHypo(a.id, e.target.value)}
                            style={{ width: "58px", background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: "6px", color: "var(--text-primary)", fontSize: "12px", padding: "5px 8px", fontFamily: "inherit", outline: "none", textAlign: "right" }}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

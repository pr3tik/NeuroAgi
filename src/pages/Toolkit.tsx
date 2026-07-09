// Toolkit.jsx — Class Notes upload, Rubric generation, Recordings, Lecture Dates, Twilio SMS

import { useState, useEffect, useRef, useCallback } from "react";
import { useApp } from "../context/AppContext";
import { groq }   from "../api/groq";
import { supabase } from "../api/supabase";
import WhatIfPanel from "../components/WhatIfPanel";
import LectureUpload from "../components/LectureUpload";
import DigestPanel, { Digest } from "../components/DigestPanel";
import { Sparkles, Check, ArrowUp, Hourglass, ChevronUp, ChevronDown, Circle } from "lucide-react";

// FALLBACK_NODES removed — real data or empty state only. No fake courses shown.
const NODE_POSITIONS = [
  { x: 90,  y: 62  }, { x: 200, y: 106 }, { x: 318, y: 55  }, { x: 372, y: 118 },
  { x: 48,  y: 185 }, { x: 165, y: 218 }, { x: 290, y: 192 }, { x: 358, y: 228 },
  { x: 130, y: 140 }, { x: 255, y: 150 }, { x: 395, y: 168 }, { x: 220, y: 38  },
];
const COLOR_PALETTE = ["#64b4ff", "#64dc9b", "#ffc364", "#be82ff", "#ff8080", "#4ecdc4", "#ffe66d", "#a8e6cf"];

async function buildGraphFromCanvas(courses, assignments) {
  const courseSummary = courses.slice(0, 6).map(c => {
    const names = assignments
      .filter(a => a.courseId === c.id || a.courseCode === c.courseCode)
      .slice(0, 5).map(a => a.name || a.title).filter(Boolean);
    return `${c.courseCode || c.name}: ${names.join(", ") || "(no assignments)"}`;
  }).join("\n");

  const prompt = `You are a university professor. Given these courses and their assignment names, infer the underlying academic topics and build a knowledge graph.

Courses and assignments:
${courseSummary}

Return ONLY a JSON object with this exact shape:
{
  "nodes": [{ "id": "short_id", "label": "2-3 word topic name", "course": "course code", "desc": "One precise sentence explaining the core mechanism." }],
  "edges": [{ "from": "id1", "to": "id2" }]
}

Rules: 6-10 nodes, 4-8 edges, course field must match a course code listed above.`;

  const raw = await groq([{ role: "user", content: prompt }], "");
  let json = raw.trim();
  if (json.startsWith("```")) json = json.replace(/^```[a-z]*\n?/, "").replace(/\n?```$/, "").trim();
  const parsed = JSON.parse(json);
  if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) throw new Error("bad shape");

  const uniqueCourses = [...new Set(parsed.nodes.map(n => n.course))];
  const courseColors: Record<string, any> = {};
  uniqueCourses.forEach((c: any, i) => { courseColors[c] = COLOR_PALETTE[i % COLOR_PALETTE.length]; });
  const nodes = parsed.nodes.map((n, i) => ({ ...n, x: NODE_POSITIONS[i % NODE_POSITIONS.length].x, y: NODE_POSITIONS[i % NODE_POSITIONS.length].y }));
  const nodeIds = new Set(nodes.map(n => n.id));
  const edges = parsed.edges.filter(e => nodeIds.has(e.from) && nodeIds.has(e.to));
  return { nodes, edges, courseColors };
}

// ── Knowledge Graph ───────────────────────────────────────────────────────────
function KnowledgeGraph({ courses, assignments }) {
  const [graphData,  setGraphData]  = useState(null);
  const [loading,    setLoading]    = useState(false);
  const [hovered,    setHovered]    = useState(null);
  const justTappedRef = useRef(null); // prevents SVG parent from immediately clearing a node tap

  useEffect(() => {
    if (!courses || courses.length === 0) {
      setGraphData(null); // no canvas data → show empty state, not fake nodes
      return;
    }
    const cacheKey = `kg_v2_${courses.map(c => c.id || c.name).sort().join("_")}`;
    const cached = localStorage.getItem(cacheKey);
    if (cached) { try { setGraphData(JSON.parse(cached)); return; } catch {} }
    setLoading(true);
    buildGraphFromCanvas(courses, assignments)
      .then(data => { localStorage.setItem(cacheKey, JSON.stringify(data)); setGraphData(data); })
      .catch(() => { setGraphData(null); }) // error → empty state, not fake nodes
      .finally(() => setLoading(false));
  }, [courses, assignments]);

  const handleNodeTouch = (id, e) => {
    e.stopPropagation();
    e.preventDefault();
    justTappedRef.current = id;
    setHovered(h => h === id ? null : id);
    // Clear the ref after a tick so the SVG handler can check it
    setTimeout(() => { justTappedRef.current = null; }, 50);
  };
  const { nodes = [], edges = [], courseColors = {} } = graphData ?? {};
  const adjacentIds = hovered ? new Set(edges.filter(e => e.from === hovered || e.to === hovered).flatMap(e => [e.from, e.to])) : null;
  const isNodeActive = (id) => !hovered || adjacentIds.has(id);
  const isEdgeActive = (e)  => !hovered || e.from === hovered || e.to === hovered;

  // Empty state — no fake nodes, no graph section at all when there's nothing real to show
  if (!loading && (!graphData || !graphData.nodes?.length)) {
    return (
      <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "var(--radius-card)", padding: "24px 16px", marginBottom: "24px", textAlign: "center" }}>
        <p style={{ fontSize: "11px", color: "var(--text-dim)", letterSpacing: "2px", textTransform: "uppercase", marginBottom: "16px" }}>Knowledge Graph</p>
        <p style={{ color: "var(--text-secondary)", fontSize: "14px", fontWeight: "500", marginBottom: "6px" }}>
          {courses?.length === 0 ? "Connect Canvas to build your knowledge map" : "Your knowledge map builds as you study"}
        </p>
        <p style={{ color: "var(--text-dim)", fontSize: "12px" }}>
          {courses?.length === 0 ? "Sync Canvas and the graph populates automatically." : "Keep studying — concepts will appear here as you go."}
        </p>
      </div>
    );
  }

  return (
    <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "var(--radius-card)", padding: "16px", marginBottom: "24px", overflow: "hidden" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
        <p style={{ fontSize: "11px", color: "var(--text-dim)", letterSpacing: "2px", textTransform: "uppercase" }}>Knowledge Graph</p>
        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
          {Object.entries(courseColors).map(([course, color]) => (
            <span key={course} style={{ display: "flex", alignItems: "center", gap: "4px" }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: color as string, display: "inline-block" }} />
              <span style={{ fontSize: "10px", color: "rgba(255,255,255,0.3)" }}>{course.split(" ")[0]}</span>
            </span>
          ))}
        </div>
      </div>
      {loading ? (
        <div style={{ height: "200px", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <p style={{ fontSize: "11px", color: "rgba(255,255,255,0.2)", letterSpacing: "1px" }}>Generating graph…</p>
        </div>
      ) : (
        <svg viewBox="0 0 420 260" width="100%" height="200" style={{ overflow: "visible", touchAction: "none" }} onTouchStart={e => { if ((e.target === e.currentTarget || (e.target as Element).tagName === "svg") && !justTappedRef.current) setHovered(null); }}>
          {edges.map((e, i) => {
            const from = nodes.find(n => n.id === e.from);
            const to   = nodes.find(n => n.id === e.to);
            if (!from || !to) return null;
            const isCross = from.course !== to.course;
            return <line key={i} x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke={isCross ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.10)"} strokeWidth={isCross ? 1 : 0.8} strokeDasharray={isCross ? "3 4" : "none"} opacity={isEdgeActive(e) ? 1 : 0.08} style={{ transition: "opacity 0.2s" }} />;
          })}
          {nodes.map((node) => {
            const active  = isNodeActive(node.id);
            const isHover = hovered === node.id;
            const color   = courseColors[node.course] ?? "#ffffff";
            return (
              <g key={node.id} onMouseEnter={() => setHovered(node.id)} onMouseLeave={() => setHovered(null)} onTouchStart={e => handleNodeTouch(node.id, e)} style={{ cursor: "pointer" }}>
                {/* Large invisible hit target for easy mobile tapping */}
                <circle cx={node.x} cy={node.y} r={22} fill="transparent" />
                {isHover && <circle cx={node.x} cy={node.y} r={14} fill={color} opacity={0.12} />}
                <circle cx={node.x} cy={node.y} r={isHover ? 7 : 5} fill={color} opacity={active ? (isHover ? 1 : 0.75) : 0.12} style={{ transition: "r 0.18s, opacity 0.2s" }} />
                <text x={node.x} y={node.y - 14} textAnchor="middle" fontSize={isHover ? "9" : "8"} fill={color} opacity={active ? (isHover ? 1 : 0.65) : 0.1} style={{ transition: "opacity 0.2s, font-size 0.15s", pointerEvents: "none", fontFamily: "var(--font-sans)" }}>{node.label}</text>
              </g>
            );
          })}
        </svg>
      )}
      <div style={{ minHeight: "44px", marginTop: "8px", padding: "0 2px" }}>
        {hovered ? (() => {
          const n = nodes.find(nd => nd.id === hovered);
          if (!n) return null;
          return (
            <div>
              <div style={{ display: "flex", alignItems: "baseline", gap: "6px", marginBottom: "4px" }}>
                <span style={{ color: courseColors[n.course] ?? "#fff", fontSize: "11px", fontWeight: "600" }}>{n.label}</span>
                <span style={{ color: "var(--text-dim)", fontSize: "10px", letterSpacing: "0.5px" }}>{n.course}</span>
              </div>
              <p style={{ color: "rgba(255,255,255,0.45)", fontSize: "11px", lineHeight: "1.55", margin: 0 }}>{n.desc}</p>
            </div>
          );
        })() : (
          <p style={{ fontSize: "11px", color: "rgba(255,255,255,0.2)", textAlign: "center", marginTop: "14px" }}>Tap or hover a concept to trace connections</p>
        )}
      </div>
    </div>
  );
}

// ── Class Notes Tab ───────────────────────────────────────────────────────────
function ClassNotesTab() {
  const { courses, assignments } = useApp();
  const [expanded,      setExpanded]      = useState(null);
  const [courseFiles,   setCourseFiles]   = useState(() => { try { return JSON.parse(localStorage.getItem("toolkit_notes") || "{}"); } catch { return {}; } });
  const [rubrics,       setRubrics]       = useState(() => { try { return JSON.parse(localStorage.getItem("toolkit_rubrics") || "{}"); } catch { return {}; } });
  const [rubricLoading, setRubricLoading] = useState({});
  const [lectureDates,  setLectureDates]  = useState(() => { try { return JSON.parse(localStorage.getItem("toolkit_lecture_dates") || "{}"); } catch { return {}; } });
  const [dateInput,     setDateInput]     = useState({});
  const fileInputRef  = useRef(null);
  const idleTimersRef = useRef({});
  const [uploadingFor, setUploadingFor]  = useState(null);

  function saveFiles(next) { setCourseFiles(next); localStorage.setItem("toolkit_notes", JSON.stringify(next)); }
  function saveRubrics(next) { setRubrics(next); localStorage.setItem("toolkit_rubrics", JSON.stringify(next)); }
  function saveDates(next) { setLectureDates(next); localStorage.setItem("toolkit_lecture_dates", JSON.stringify(next)); }

  function handleUploadClick(courseId, e) { e.stopPropagation(); setUploadingFor(courseId); fileInputRef.current.click(); }

  function handleFileChange(e) {
    const files = Array.from((e.target as HTMLInputElement).files || []);
    if (!files.length || !uploadingFor) return;
    const added = files.map(f => ({ name: f.name, size: f.size, date: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" }) }));
    const next = { ...courseFiles, [uploadingFor]: [...(courseFiles[uploadingFor] || []), ...added] };
    saveFiles(next);
    e.target.value = "";
    // Start idle timer for rubric generation — 2 min after last upload
    const cid = uploadingFor;
    clearTimeout(idleTimersRef.current[cid]);
    idleTimersRef.current[cid] = setTimeout(() => generateRubric(cid), 2 * 60 * 1000);
    setUploadingFor(null);
  }

  function removeFile(courseId, idx, e) {
    e.stopPropagation();
    const next = { ...courseFiles, [courseId]: courseFiles[courseId].filter((_, i) => i !== idx) };
    saveFiles(next);
  }

  async function generateRubric(courseId) {
    const course = courses.find(c => String(c.id) === courseId);
    if (!course) return;
    const files = courseFiles[courseId] || [];
    const courseAssignments = assignments.filter(a => String(a.courseId) === courseId || String(a.courseCode) === String(course.courseCode)).slice(0, 10);

    setRubricLoading(prev => ({ ...prev, [courseId]: true }));
    try {
      const prompt = `You are a professor evaluating student work for "${course.name}" (${course.courseCode ?? ""}).

Uploaded notes/files: ${files.map(f => f.name).join(", ") || "(none)"}
Recent assignments: ${courseAssignments.map(a => a.name).join(", ") || "(none)"}

Generate a concise rubric to evaluate current student progress. Return ONLY JSON:
{
  "criteria": [
    { "name": "criterion name", "weight": 25, "excellent": "description", "needs_work": "description" }
  ],
  "summary": "One sentence overall assessment suggestion."
}

3-4 criteria, weights sum to 100. Be specific to this course.`;

      const raw = await groq([{ role: "user", content: prompt }], "");
      let json = raw.trim();
      if (json.startsWith("```")) json = json.replace(/^```[a-z]*\n?/, "").replace(/\n?```$/, "").trim();
      const parsed = JSON.parse(json);
      const next = { ...rubrics, [courseId]: { ...parsed, generatedAt: new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }) } };
      saveRubrics(next);
    } catch (err) {
      console.warn("Rubric gen failed:", err.message);
    } finally {
      setRubricLoading(prev => ({ ...prev, [courseId]: false }));
    }
  }

  function addLectureDate(courseId) {
    const val = dateInput[courseId];
    if (!val) return;
    const existing = lectureDates[courseId] || [];
    const next = { ...lectureDates, [courseId]: [...existing, { date: val, addedAt: new Date().toISOString() }].sort((a, b) => +new Date(a.date) - +new Date(b.date)) };
    saveDates(next);
    setDateInput(prev => ({ ...prev, [courseId]: "" }));
  }

  function removeLectureDate(courseId, idx) {
    const next = { ...lectureDates, [courseId]: lectureDates[courseId].filter((_, i) => i !== idx) };
    saveDates(next);
  }

  if (!courses || courses.length === 0) {
    return (
      <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-card)", padding: "24px", textAlign: "center" }}>
        <p style={{ color: "var(--text-secondary)", fontSize: "14px", marginBottom: "4px" }}>No courses yet</p>
        <p style={{ color: "var(--text-dim)", fontSize: "12px" }}>Connect Canvas to see your courses here</p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      <input ref={fileInputRef} type="file" multiple accept=".pdf,.doc,.docx,.ppt,.pptx,.png,.jpg,.jpeg" style={{ display: "none" }} onChange={handleFileChange} />
      {courses.map((course) => {
        const cid   = String(course.id);
        const files = courseFiles[cid] || [];
        const color = COLOR_PALETTE[courses.indexOf(course) % COLOR_PALETTE.length];
        const open  = expanded === cid;
        const rubric = rubrics[cid];
        const dates  = lectureDates[cid] || [];

        return (
          <div key={cid} style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-card)", overflow: "hidden" }}>
            {/* Course header */}
            <div
              style={{ padding: "16px 18px", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}
              onClick={() => setExpanded(open ? null : cid)}
              onMouseEnter={e => (e.currentTarget.style.background = "var(--color-surface-hover)")}
              onMouseLeave={e => (e.currentTarget.style.background = "")}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "3px" }}>
                  <span style={{ fontSize: "10px", color, fontWeight: "600", letterSpacing: "0.5px" }}>{course.courseCode ?? course.name}</span>
                  <span style={{ fontSize: "10px", color: "var(--text-dim)" }}>{files.length} file{files.length !== 1 ? "s" : ""}</span>
                  {dates.length > 0 && <span style={{ fontSize: "10px", color: "rgba(255,200,100,0.6)" }}>{dates.length} date{dates.length !== 1 ? "s" : ""}</span>}
                </div>
                <p style={{ color: "var(--text-primary)", fontSize: "14px", fontWeight: "500", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{course.name}</p>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0, marginLeft: "12px" }}>
                <button
                  onClick={e => handleUploadClick(cid, e)}
                  style={{ background: "rgba(0,210,190,0.12)", border: "1px solid rgba(0,210,190,0.25)", borderRadius: "8px", color: "rgba(0,210,190,0.8)", fontSize: "11px", padding: "5px 10px", cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}
                >
                  + Upload
                </button>
                <span style={{ color: "var(--text-dim)", display: "flex" }}>{open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</span>
              </div>
            </div>

            {open && (
              <div style={{ borderTop: "1px solid rgba(255,255,255,0.05)", padding: "14px 18px 18px" }}>

                {/* Files */}
                <p style={{ fontSize: "10px", color: "var(--text-dim)", letterSpacing: "1.5px", textTransform: "uppercase", marginBottom: "10px" }}>Notes & Files</p>
                {files.length === 0 ? (
                  <p style={{ color: "var(--text-dim)", fontSize: "12px", marginBottom: "16px" }}>No notes uploaded yet — tap Upload to add PDF, doc, or slides</p>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "16px" }}>
                    {files.map((f, i) => (
                      <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "rgba(255,255,255,0.03)", borderRadius: "8px", padding: "10px 12px" }}>
                        <div style={{ minWidth: 0 }}>
                          <p style={{ color: "var(--text-primary)", fontSize: "13px", fontWeight: "500", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</p>
                          <p style={{ color: "var(--text-dim)", fontSize: "11px", marginTop: "2px" }}>{f.date} · {(f.size / 1024).toFixed(0)} KB</p>
                        </div>
                        <button onClick={e => removeFile(cid, i, e)} style={{ background: "none", border: "none", color: "rgba(255,100,90,0.6)", fontSize: "16px", cursor: "pointer", padding: "0 4px", flexShrink: 0 }}>×</button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Lecture Dates */}
                <p style={{ fontSize: "10px", color: "var(--text-dim)", letterSpacing: "1.5px", textTransform: "uppercase", marginBottom: "10px" }}>Lecture Dates</p>
                <div style={{ display: "flex", gap: "8px", marginBottom: "10px" }}>
                  <input
                    type="date"
                    value={dateInput[cid] || ""}
                    onChange={e => setDateInput(prev => ({ ...prev, [cid]: e.target.value }))}
                    style={{ flex: 1, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", padding: "7px 10px", color: "var(--text-primary)", fontSize: "12px", fontFamily: "inherit", outline: "none", colorScheme: "dark" }}
                  />
                  <button
                    onClick={() => addLectureDate(cid)}
                    style={{ background: "rgba(255,200,100,0.12)", border: "1px solid rgba(255,200,100,0.25)", borderRadius: "8px", color: "rgba(255,200,100,0.8)", fontSize: "11px", padding: "7px 12px", cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}
                  >
                    Add
                  </button>
                </div>
                {dates.length > 0 ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: "5px", marginBottom: "16px" }}>
                    {dates.map((d, i) => (
                      <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "rgba(255,200,100,0.05)", borderRadius: "7px", padding: "8px 12px" }}>
                        <span style={{ color: "rgba(255,200,100,0.8)", fontSize: "12px" }}>
                          {new Date(d.date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                        </span>
                        <button onClick={() => removeLectureDate(cid, i)} style={{ background: "none", border: "none", color: "rgba(255,100,90,0.5)", fontSize: "14px", cursor: "pointer", padding: "0 2px" }}>×</button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p style={{ color: "var(--text-dim)", fontSize: "12px", marginBottom: "16px" }}>No lecture dates added yet</p>
                )}

                {/* Rubric section */}
                <div style={{ borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: "14px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
                    <p style={{ fontSize: "10px", color: "var(--text-dim)", letterSpacing: "1.5px", textTransform: "uppercase" }}>
                      AI Rubric {rubric && <span style={{ color: "rgba(255,255,255,0.2)", letterSpacing: "normal", textTransform: "none" }}>· generated {rubric.generatedAt}</span>}
                    </p>
                    <button
                      onClick={() => generateRubric(cid)}
                      disabled={rubricLoading[cid]}
                      style={{ background: "rgba(190,130,255,0.1)", border: "1px solid rgba(190,130,255,0.25)", borderRadius: "8px", color: rubricLoading[cid] ? "rgba(190,130,255,0.4)" : "rgba(190,130,255,0.8)", fontSize: "11px", padding: "5px 10px", cursor: rubricLoading[cid] ? "default" : "pointer", fontFamily: "inherit" }}
                    >
                      {rubricLoading[cid]
                        ? "Generating…"
                        : <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>{rubric ? "Regenerate" : "Generate"}<Sparkles size={12} /></span>}
                    </button>
                  </div>

                  {rubricLoading[cid] && !rubric && (
                    <p style={{ color: "var(--text-dim)", fontSize: "12px" }}>Evaluating course progress…</p>
                  )}

                  {rubric && (
                    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                      {(rubric.criteria || []).map((c, i) => (
                        <div key={i} style={{ background: "rgba(190,130,255,0.05)", border: "1px solid rgba(190,130,255,0.12)", borderRadius: "8px", padding: "10px 12px" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "6px" }}>
                            <span style={{ color: "rgba(190,130,255,0.9)", fontSize: "12px", fontWeight: "600" }}>{c.name}</span>
                            <span style={{ color: "var(--text-dim)", fontSize: "10px" }}>{c.weight}%</span>
                          </div>
                          <p style={{ color: "rgba(100,220,155,0.7)", fontSize: "11px", marginBottom: "3px" }}><Check size={11} style={{ verticalAlign: "-1px", marginRight: 4 }} />{c.excellent}</p>
                          <p style={{ color: "rgba(255,130,100,0.6)", fontSize: "11px" }}><ArrowUp size={11} style={{ verticalAlign: "-1px", marginRight: 4 }} />{c.needs_work}</p>
                        </div>
                      ))}
                      {rubric.summary && (
                        <p style={{ color: "var(--text-secondary)", fontSize: "12px", fontStyle: "italic", marginTop: "4px" }}>{rubric.summary}</p>
                      )}
                    </div>
                  )}

                  {!rubric && !rubricLoading[cid] && (
                    <p style={{ color: "var(--text-dim)", fontSize: "12px" }}>
                      Tap Generate to evaluate course progress, or upload notes — rubric auto-generates after 2 min of inactivity.
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Recordings Tab ────────────────────────────────────────────────────────────
function RecordingsTab() {
  const { courses } = useApp();
  const [transcripts, setTranscripts] = useState(() => { try { return JSON.parse(localStorage.getItem("toolkit_transcripts") || "{}"); } catch { return {}; } });
  const [expanded,    setExpanded]    = useState(null);
  const [textInput,   setTextInput]   = useState({});

  function saveTranscripts(next) { setTranscripts(next); localStorage.setItem("toolkit_transcripts", JSON.stringify(next)); }

  function addTranscript(courseId) {
    const text = textInput[courseId]?.trim();
    if (!text) return;
    const existing = transcripts[courseId] || [];
    const next = { ...transcripts, [courseId]: [...existing, { text, addedAt: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" }) }] };
    saveTranscripts(next);
    setTextInput(prev => ({ ...prev, [courseId]: "" }));
  }

  function removeTranscript(courseId, idx) {
    const next = { ...transcripts, [courseId]: transcripts[courseId].filter((_, i) => i !== idx) };
    saveTranscripts(next);
  }

  if (!courses || courses.length === 0) {
    return (
      <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-card)", padding: "32px 24px", textAlign: "center" }}>
        <p style={{ color: "var(--text-secondary)", fontSize: "14px", fontWeight: "500", marginBottom: "6px" }}>No courses yet</p>
        <p style={{ color: "var(--text-dim)", fontSize: "12px" }}>Connect Canvas to see your courses here</p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      {/* Wisprflow notice */}
      <div style={{ background: "rgba(100,180,255,0.06)", border: "1px solid rgba(100,180,255,0.15)", borderRadius: "var(--radius-card)", padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <p style={{ color: "rgba(100,180,255,0.85)", fontSize: "12px", fontWeight: "500", marginBottom: "2px" }}>Wisprflow not connected</p>
          <p style={{ color: "var(--text-dim)", fontSize: "11px" }}>Audio recording + auto-transcription pending Vincent's API access</p>
        </div>
        <span style={{ color: "rgba(100,180,255,0.4)", display: "flex" }}><Hourglass size={18} /></span>
      </div>

      {courses.map((course) => {
        const cid   = String(course.id);
        const items = transcripts[cid] || [];
        const color = COLOR_PALETTE[courses.indexOf(course) % COLOR_PALETTE.length];
        const open  = expanded === cid;

        return (
          <div key={cid} style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-card)", overflow: "hidden" }}>
            <div
              style={{ padding: "16px 18px", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}
              onClick={() => setExpanded(open ? null : cid)}
              onMouseEnter={e => (e.currentTarget.style.background = "var(--color-surface-hover)")}
              onMouseLeave={e => (e.currentTarget.style.background = "")}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <span style={{ fontSize: "10px", color, fontWeight: "600", letterSpacing: "0.5px", display: "block", marginBottom: "3px" }}>{course.courseCode ?? course.name}</span>
                <p style={{ color: "var(--text-primary)", fontSize: "14px", fontWeight: "500", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{course.name}</p>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", flexShrink: 0 }}>
                <span style={{ fontSize: "10px", color: "var(--text-dim)" }}>{items.length} transcript{items.length !== 1 ? "s" : ""}</span>
                <span style={{ color: "var(--text-dim)", display: "flex" }}>{open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</span>
              </div>
            </div>

            {open && (
              <div style={{ borderTop: "1px solid rgba(255,255,255,0.05)", padding: "14px 18px 18px" }}>
                {/* Record button — placeholder until Wisprflow */}
                <button style={{ width: "100%", background: "rgba(255,100,90,0.08)", border: "1px solid rgba(255,100,90,0.2)", borderRadius: "10px", padding: "12px", color: "rgba(255,100,90,0.6)", fontSize: "13px", cursor: "not-allowed", fontFamily: "inherit", marginBottom: "14px" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Circle size={12} fill="currentColor" strokeWidth={0} />Record Lecture — requires Wisprflow</span>
                </button>

                {/* Manual transcript add */}
                <p style={{ fontSize: "10px", color: "var(--text-dim)", letterSpacing: "1.5px", textTransform: "uppercase", marginBottom: "8px" }}>Transcripts</p>
                <textarea
                  placeholder="Paste transcript text here…"
                  value={textInput[cid] || ""}
                  onChange={e => setTextInput(prev => ({ ...prev, [cid]: e.target.value }))}
                  style={{ width: "100%", minHeight: "80px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "8px", padding: "10px 12px", color: "var(--text-primary)", fontSize: "12px", fontFamily: "inherit", outline: "none", resize: "vertical", boxSizing: "border-box" }}
                />
                <button
                  onClick={() => addTranscript(cid)}
                  style={{ marginTop: "8px", background: "rgba(0,210,190,0.1)", border: "1px solid rgba(0,210,190,0.2)", borderRadius: "8px", color: "rgba(0,210,190,0.8)", fontSize: "11px", padding: "6px 14px", cursor: "pointer", fontFamily: "inherit" }}
                >
                  + Add Transcript
                </button>

                {items.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "12px" }}>
                    {items.map((t, i) => (
                      <div key={i} style={{ background: "rgba(255,255,255,0.03)", borderRadius: "8px", padding: "10px 12px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                          <span style={{ color: "var(--text-dim)", fontSize: "10px" }}>Transcript · {t.addedAt}</span>
                          <button onClick={() => removeTranscript(cid, i)} style={{ background: "none", border: "none", color: "rgba(255,100,90,0.5)", fontSize: "14px", cursor: "pointer", padding: "0" }}>×</button>
                        </div>
                        <p style={{ color: "var(--text-secondary)", fontSize: "12px", lineHeight: "1.55", margin: 0, maxHeight: "80px", overflow: "hidden", textOverflow: "ellipsis" }}>{t.text}</p>
                      </div>
                    ))}
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

// ── Twilio Tab ────────────────────────────────────────────────────────────────
function TwilioTab() {
  const { assignments, userData } = useApp();
  const [phone,    setPhone]    = useState(() => localStorage.getItem("toolkit_phone") || "");
  const [saved,    setSaved]    = useState(Boolean(localStorage.getItem("toolkit_phone")));
  const [sending,  setSending]  = useState(false);
  const [lastSent, setLastSent] = useState(null);
  const [error,    setError]    = useState(null);

  function savePhone() {
    const trimmed = phone.trim();
    if (!trimmed) return;
    localStorage.setItem("toolkit_phone", trimmed);
    setSaved(true);
  }

  // Upcoming assignments in next 48h
  const urgent = assignments.filter(a => {
    if (!a.dueAt || a.submission?.submittedAt) return false;
    const diff = +new Date(a.dueAt) - +new Date();
    return diff > 0 && diff < 48 * 60 * 60 * 1000;
  }).sort((a, b) => +new Date(a.dueAt) - +new Date(b.dueAt)).slice(0, 5);

  async function sendReminders() {
    if (!saved || !phone.trim()) return;
    setSending(true);
    setError(null);
    try {
      const name = userData?.name || localStorage.getItem("fschool_name") || "Student";
      const body = urgent.length > 0
        ? `Hi ${name}! You have ${urgent.length} assignment${urgent.length > 1 ? "s" : ""} due soon:\n` +
          urgent.map(a => `• ${a.name} — due ${new Date(a.dueAt).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}`).join("\n") +
          "\n\nGood luck! — FSchoolAI"
        : `Hi ${name}! No urgent assignments in the next 48 hours. Keep it up! — FSchoolAI`;

      const res = await fetch("/api/utils?fn=twilio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: phone.trim(), body }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "SMS failed");
      setLastSent(new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }));
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      {/* Phone setup */}
      <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-card)", padding: "18px" }}>
        <p style={{ fontSize: "10px", color: "var(--text-dim)", letterSpacing: "1.5px", textTransform: "uppercase", marginBottom: "12px" }}>SMS Reminders</p>
        <div style={{ display: "flex", gap: "8px", marginBottom: "10px" }}>
          <input
            type="tel"
            placeholder="+1 555 000 0000"
            value={phone}
            onChange={e => { setPhone(e.target.value); setSaved(false); }}
            style={{ flex: 1, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", padding: "9px 12px", color: "var(--text-primary)", fontSize: "13px", fontFamily: "inherit", outline: "none" }}
          />
          <button
            onClick={savePhone}
            style={{ background: saved ? "rgba(100,220,155,0.12)" : "rgba(0,210,190,0.12)", border: `1px solid ${saved ? "rgba(100,220,155,0.25)" : "rgba(0,210,190,0.25)"}`, borderRadius: "8px", color: saved ? "rgba(100,220,155,0.8)" : "rgba(0,210,190,0.8)", fontSize: "11px", padding: "9px 14px", cursor: "pointer", fontFamily: "inherit" }}
          >
            {saved ? <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>Saved<Check size={12} /></span> : "Save"}
          </button>
        </div>
        <p style={{ color: "var(--text-dim)", fontSize: "11px" }}>Include country code. Requires TWILIO_SID, TWILIO_TOKEN, TWILIO_FROM in Vercel env vars.</p>
      </div>

      {/* Upcoming urgent assignments */}
      <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-card)", padding: "18px" }}>
        <p style={{ fontSize: "10px", color: "var(--text-dim)", letterSpacing: "1.5px", textTransform: "uppercase", marginBottom: "12px" }}>Due in 48 hours</p>
        {urgent.length === 0 ? (
          <p style={{ color: "var(--text-dim)", fontSize: "12px" }}>Nothing urgent right now</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "4px" }}>
            {urgent.map((a, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "rgba(255,100,90,0.05)", borderRadius: "8px", padding: "8px 12px" }}>
                <span style={{ color: "var(--text-primary)", fontSize: "13px" }}>{a.name}</span>
                <span style={{ color: "rgba(255,100,90,0.7)", fontSize: "11px", flexShrink: 0, marginLeft: "8px" }}>
                  {new Date(a.dueAt).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Send button */}
      <button
        onClick={sendReminders}
        disabled={!saved || sending}
        style={{ width: "100%", background: saved ? "rgba(190,130,255,0.12)" : "rgba(255,255,255,0.04)", border: `1px solid ${saved ? "rgba(190,130,255,0.25)" : "rgba(255,255,255,0.08)"}`, borderRadius: "var(--radius-card)", padding: "14px", color: saved ? "rgba(190,130,255,0.85)" : "var(--text-dim)", fontSize: "13px", fontWeight: "500", cursor: saved ? "pointer" : "not-allowed", fontFamily: "inherit" }}
      >
        {sending ? "Sending…" : "Send Assignment Reminder via SMS"}
      </button>

      {lastSent && <p style={{ color: "rgba(100,220,155,0.7)", fontSize: "12px", textAlign: "center" }}><Check size={12} style={{ verticalAlign: "-2px", marginRight: 4 }} />Sent at {lastSent}</p>}
      {error    && <p style={{ color: "rgba(255,100,90,0.7)", fontSize: "12px", textAlign: "center" }}>Error: {error}</p>}
    </div>
  );
}

// ── Previous Work & Drafts (unchanged placeholders) ───────────────────────────
function PreviousWorkTab() {
  const { assignments } = useApp();
  const submitted = assignments.filter(a => a.submission?.submittedAt).sort((a, b) => +new Date(b.submission.submittedAt) - +new Date(a.submission.submittedAt));
  if (submitted.length === 0) {
    return (
      <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-card)", padding: "32px 24px", textAlign: "center" }}>
        <p style={{ color: "var(--text-secondary)", fontSize: "14px", fontWeight: "500", marginBottom: "6px" }}>No previous work yet</p>
        <p style={{ color: "var(--text-dim)", fontSize: "12px" }}>Submitted assignments will appear here once Canvas is synced</p>
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      {submitted.map((a, i) => (
        <div key={i} style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-card)", padding: "14px 18px" }}>
          <p style={{ color: "var(--text-primary)", fontSize: "14px", fontWeight: "500", marginBottom: "3px" }}>{a.name}</p>
          <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
            <span style={{ color: "var(--text-dim)", fontSize: "11px" }}>{a.courseCode || a.courseName}</span>
            {a.submission?.score != null && a.pointsPossible && (
              <span style={{ color: "rgba(100,220,155,0.7)", fontSize: "11px" }}>{a.submission.score}/{a.pointsPossible}</span>
            )}
            <span style={{ color: "var(--text-dim)", fontSize: "11px" }}>
              {new Date(a.submission.submittedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

function SavedDraftsTab() {
  return (
    <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-card)", padding: "32px 24px", textAlign: "center" }}>
      <p style={{ color: "var(--text-secondary)", fontSize: "14px", fontWeight: "500", marginBottom: "6px" }}>No saved drafts</p>
      <p style={{ color: "var(--text-dim)", fontSize: "12px" }}>Drafts you save from the Assignment page will appear here</p>
    </div>
  );
}

// ── Lecture Digest Tab ────────────────────────────────────────────────────────
// Upload a lecture recording → api/digest-lecture.ts produces summary, key
// points, emphasis markers, glossary, flashcards (saved to flashcards_v2) and
// quiz questions. Past digests for the selected course are listed below.
function LectureDigestTab() {
  const { userId, courses, setPendingNav } = useApp();
  const [courseId, setCourseId] = useState<string>("");
  const [digests,   setDigests]  = useState<Digest[]>([]);
  const [loading,   setLoading]  = useState(false);
  const [expanded,  setExpanded] = useState<string | null>(null);

  const loadDigests = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    let query = supabase.from("lecture_digests")
      .select("id, title, status, summary, key_points, glossary, emphasis, quiz_questions, created_at")
      .eq("user_id", userId).eq("status", "done")
      .order("created_at", { ascending: false }).limit(20);
    if (courseId) query = query.eq("course_id", courseId);
    const { data } = await query;
    setDigests(data ?? []);
    setLoading(false);
  }, [userId, courseId]);

  useEffect(() => { loadDigests(); }, [loadDigests]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      {courses && courses.length > 0 && (
        <select
          value={courseId}
          onChange={e => setCourseId(e.target.value)}
          style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "8px", padding: "10px 12px", color: "var(--text-primary)", fontSize: "13px", fontFamily: "inherit" }}
        >
          <option value="" style={{ background: "#1a1a1e", color: "#f5f5f5" }}>General (no course)</option>
          {courses.map(c => (
            <option key={c.id} value={c.id} style={{ background: "#1a1a1e", color: "#f5f5f5" }}>{c.courseCode ?? c.name}</option>
          ))}
        </select>
      )}

      <LectureUpload
        userId={userId}
        courseId={courseId || null}
        onDone={digest => { setDigests(prev => [digest, ...prev]); }}
      />

      {loading && <p style={{ fontSize: "12px", color: "var(--text-dim)" }}>Loading past digests…</p>}

      {!loading && digests.length === 0 && (
        <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-card)", padding: "32px 24px", textAlign: "center" }}>
          <p style={{ color: "var(--text-secondary)", fontSize: "14px", fontWeight: "500", marginBottom: "6px" }}>No lecture digests yet</p>
          <p style={{ color: "var(--text-dim)", fontSize: "12px" }}>Upload a lecture recording above to get a summary, flashcards, and a quiz</p>
        </div>
      )}

      {digests.map(d => {
        const id = d.id!;
        const open = expanded === id;
        return (
          <div key={id} style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-card)", overflow: "hidden" }}>
            <div
              style={{ padding: "14px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}
              onClick={() => setExpanded(open ? null : id)}
            >
              <p style={{ color: "var(--text-primary)", fontSize: "13px", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", margin: 0 }}>{d.title ?? "Lecture"}</p>
              <span style={{ color: "var(--text-dim)", display: "flex", flexShrink: 0 }}>{open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</span>
            </div>
            {open && (
              <div style={{ borderTop: "1px solid rgba(255,255,255,0.05)", padding: "14px 16px" }}>
                <DigestPanel digest={d} />
                <button
                  onClick={() => setPendingNav({ page: "study" })}
                  style={{ marginTop: "8px", background: "rgba(0,210,190,0.1)", border: "1px solid rgba(0,210,190,0.2)", borderRadius: "8px", color: "rgba(0,210,190,0.8)", fontSize: "11px", padding: "8px 14px", cursor: "pointer", fontFamily: "inherit" }}
                >
                  Study these flashcards →
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Main Toolkit ──────────────────────────────────────────────────────────────
const TABS = [
  { id: "notes",      label: "Notes"      },
  { id: "recordings", label: "Recordings" },
  { id: "digest",     label: "Lecture Digest" },
  { id: "grades",     label: "Grades"     },
  { id: "reminders",  label: "Reminders"  },
  { id: "previous",   label: "Submitted"  },
];

export default function Toolkit() {
  const [activeTab, setActiveTab] = useState("notes");
  const { courses, assignments }  = useApp();

  return (
    <div>
      <h1 style={{ fontSize: "26px", fontWeight: "600", color: "var(--text-primary)", marginBottom: "4px", letterSpacing: "-0.3px" }}>Toolkit</h1>
      <p style={{ color: "var(--text-dim)", fontSize: "14px", marginBottom: "24px" }}>Your AI's knowledge base</p>

      <KnowledgeGraph courses={courses} assignments={assignments} />

      <div style={{ display: "flex", gap: "2px", marginBottom: "18px", background: "rgba(255,255,255,0.04)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-btn)", padding: "3px", overflowX: "auto" }}>
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{ flex: 1, background: activeTab === tab.id ? "rgba(255,255,255,0.09)" : "transparent", border: activeTab === tab.id ? "1px solid rgba(255,255,255,0.12)" : "1px solid transparent", borderRadius: "9px", padding: "8px 6px", color: activeTab === tab.id ? "var(--text-primary)" : "var(--text-secondary)", fontSize: "12px", fontWeight: activeTab === tab.id ? "600" : "400", cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap", transition: "all var(--dur-fast) var(--ease-apple)" }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "notes"      && <ClassNotesTab />}
      {activeTab === "recordings" && <RecordingsTab />}
      {activeTab === "digest"     && <LectureDigestTab />}
      {activeTab === "grades"     && <WhatIfPanel />}
      {activeTab === "reminders"  && <TwilioTab />}
      {activeTab === "previous"   && <PreviousWorkTab />}
    </div>
  );
}

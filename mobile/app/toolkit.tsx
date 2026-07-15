// toolkit.tsx — mobile port of src/pages/Toolkit.tsx ("Your AI's knowledge base").
// Knowledge graph (AI-built via /api/groq, cached), tabbed sections: Notes
// (per-course lecture-dates + AI rubric), Recordings (manual transcripts),
// Lecture Digest (past digests from supabase), Grades (web-only for now),
// Reminders (Twilio SMS via /api/utils?fn=twilio), Submitted.
// Skipped (need native file pickers): note-file upload, lecture-recording upload —
// both degrade to an honest "upload on the web app" note.

import { useCallback, useEffect, useState } from "react";
import {
  View, Text, ScrollView, TextInput, TouchableOpacity, StyleSheet,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Svg, { Line, Circle, G, Text as SvgText } from "react-native-svg";
import {
  Sparkles, Check, ArrowUp, Hourglass, ChevronUp, ChevronDown, Circle as CircleIcon,
} from "lucide-react-native";
import ScreenWrapper from "../components/ScreenWrapper";
import { supabase } from "../services/supabase";
import { apiFetch } from "../services/api";
import { useUserId } from "../context/AuthContext";

// tokens.css values
const T = {
  textPrimary:   "#F5F5F5",
  textSecondary: "rgba(255,255,255,0.45)",
  textDim:       "rgba(255,255,255,0.35)",
  surface:       "rgba(255,255,255,0.05)",
  border:        "rgba(255,255,255,0.08)",
  radiusCard:    16,
  radiusBtn:     12,
};

const NODE_POSITIONS = [
  { x: 90,  y: 62  }, { x: 200, y: 106 }, { x: 318, y: 55  }, { x: 372, y: 118 },
  { x: 48,  y: 185 }, { x: 165, y: 218 }, { x: 290, y: 192 }, { x: 358, y: 228 },
  { x: 130, y: 140 }, { x: 255, y: 150 }, { x: 395, y: 168 }, { x: 220, y: 38  },
];
const COLOR_PALETTE = ["#64b4ff", "#64dc9b", "#ffc364", "#be82ff", "#ff8080", "#4ecdc4", "#ffe66d", "#a8e6cf"];

// Mirrors src/api/groq.ts
async function groq(messages: { role: string; content: string }[], system = ""): Promise<string> {
  const d = await apiFetch("/api/groq", { messages, system, max_tokens: 1024 });
  return d.content ?? "";
}

function parseJsonBlock(raw: string) {
  let json = raw.trim();
  if (json.startsWith("```")) json = json.replace(/^```[a-z]*\n?/, "").replace(/\n?```$/, "").trim();
  return JSON.parse(json);
}

async function storageGet(key: string) {
  try { return JSON.parse((await AsyncStorage.getItem(key)) || "{}"); } catch { return {}; }
}
function storageSet(key: string, val: object) {
  AsyncStorage.setItem(key, JSON.stringify(val)).catch(() => {});
}

type Course = { id: string; name: string; courseCode: string | null };
type Assignment = {
  id: string; name: string; courseId: string | null; courseCode?: string | null;
  courseName?: string | null; dueAt: string | null; pointsPossible: number | null;
  submission: { score: number | null; submittedAt: string | null };
};

// ── Knowledge Graph (mirrors web buildGraphFromCanvas + <KnowledgeGraph/>) ────

async function buildGraphFromCanvas(courses: Course[], assignments: Assignment[]) {
  const courseSummary = courses.slice(0, 6).map(c => {
    const names = assignments
      .filter(a => String(a.courseId) === String(c.id) || a.courseCode === c.courseCode)
      .slice(0, 5).map(a => a.name).filter(Boolean);
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

  const parsed = parseJsonBlock(await groq([{ role: "user", content: prompt }]));
  if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) throw new Error("bad shape");

  const uniqueCourses = [...new Set(parsed.nodes.map((n: any) => n.course))];
  const courseColors: Record<string, string> = {};
  uniqueCourses.forEach((c: any, i) => { courseColors[c] = COLOR_PALETTE[i % COLOR_PALETTE.length]; });
  const nodes = parsed.nodes.map((n: any, i: number) => ({
    ...n, x: NODE_POSITIONS[i % NODE_POSITIONS.length].x, y: NODE_POSITIONS[i % NODE_POSITIONS.length].y,
  }));
  const nodeIds = new Set(nodes.map((n: any) => n.id));
  const edges = parsed.edges.filter((e: any) => nodeIds.has(e.from) && nodeIds.has(e.to));
  return { nodes, edges, courseColors };
}

function KnowledgeGraph({ courses, assignments }: { courses: Course[]; assignments: Assignment[] }) {
  const [graphData, setGraphData] = useState<any>(null);
  const [loading,   setLoading]   = useState(false);
  const [hovered,   setHovered]   = useState<string | null>(null);

  useEffect(() => {
    if (!courses.length) { setGraphData(null); return; }
    const cacheKey = `kg_v2_${courses.map(c => c.id || c.name).sort().join("_")}`;
    let cancelled = false;
    (async () => {
      const cached = await AsyncStorage.getItem(cacheKey);
      if (cached) { try { if (!cancelled) setGraphData(JSON.parse(cached)); return; } catch {} }
      setLoading(true);
      try {
        const data = await buildGraphFromCanvas(courses, assignments);
        AsyncStorage.setItem(cacheKey, JSON.stringify(data)).catch(() => {});
        if (!cancelled) setGraphData(data);
      } catch { if (!cancelled) setGraphData(null); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [courses, assignments]);

  const { nodes = [], edges = [], courseColors = {} } = graphData ?? {};
  const adjacentIds: Set<string> | null = hovered
    ? new Set<string>(edges.filter((e: any) => e.from === hovered || e.to === hovered).flatMap((e: any) => [e.from, e.to]))
    : null;
  const isNodeActive = (id: string) => !adjacentIds || adjacentIds.has(id);
  const isEdgeActive = (e: any) => !hovered || e.from === hovered || e.to === hovered;

  if (!loading && (!graphData || !graphData.nodes?.length)) {
    return (
      <View style={[styles.kgCard, { alignItems: "center", paddingVertical: 24 }]}>
        <Text style={styles.kgLabel}>KNOWLEDGE GRAPH</Text>
        <Text style={styles.kgEmptyTitle}>
          {courses.length === 0 ? "Connect Canvas to build your knowledge map" : "Your knowledge map builds as you study"}
        </Text>
        <Text style={styles.kgEmptySub}>
          {courses.length === 0 ? "Sync Canvas and the graph populates automatically." : "Keep studying — concepts will appear here as you go."}
        </Text>
      </View>
    );
  }

  const hoveredNode = hovered ? nodes.find((n: any) => n.id === hovered) : null;

  return (
    <View style={styles.kgCard}>
      <View style={styles.kgHeader}>
        <Text style={styles.kgLabel}>KNOWLEDGE GRAPH</Text>
        <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
          {Object.entries(courseColors).map(([course, color]) => (
            <View key={course} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color as string }} />
              <Text style={{ fontFamily: "Inter_400Regular", fontSize: 10, color: "rgba(255,255,255,0.3)" }}>
                {course.split(" ")[0]}
              </Text>
            </View>
          ))}
        </View>
      </View>

      {loading ? (
        <View style={{ height: 200, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ fontFamily: "Inter_400Regular", fontSize: 11, color: "rgba(255,255,255,0.2)", letterSpacing: 1 }}>
            Generating graph…
          </Text>
        </View>
      ) : (
        <Svg viewBox="0 0 420 260" width="100%" height={200}>
          {edges.map((e: any, i: number) => {
            const from = nodes.find((n: any) => n.id === e.from);
            const to   = nodes.find((n: any) => n.id === e.to);
            if (!from || !to) return null;
            const isCross = from.course !== to.course;
            return (
              <Line
                key={i} x1={from.x} y1={from.y} x2={to.x} y2={to.y}
                stroke={isCross ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.10)"}
                strokeWidth={isCross ? 1 : 0.8}
                strokeDasharray={isCross ? "3 4" : undefined}
                opacity={isEdgeActive(e) ? 1 : 0.08}
              />
            );
          })}
          {nodes.map((node: any) => {
            const active  = isNodeActive(node.id);
            const isHover = hovered === node.id;
            const color   = courseColors[node.course] ?? "#ffffff";
            return (
              <G key={node.id} onPress={() => setHovered(h => (h === node.id ? null : node.id))}>
                <Circle cx={node.x} cy={node.y} r={22} fill="transparent" />
                {isHover && <Circle cx={node.x} cy={node.y} r={14} fill={color} opacity={0.12} />}
                <Circle cx={node.x} cy={node.y} r={isHover ? 7 : 5} fill={color} opacity={active ? (isHover ? 1 : 0.75) : 0.12} />
                <SvgText
                  x={node.x} y={node.y - 14} textAnchor="middle"
                  fontSize={isHover ? 9 : 8} fill={color}
                  opacity={active ? (isHover ? 1 : 0.65) : 0.1}
                >
                  {node.label}
                </SvgText>
              </G>
            );
          })}
        </Svg>
      )}

      <View style={{ minHeight: 44, marginTop: 8, paddingHorizontal: 2 }}>
        {hoveredNode ? (
          <View>
            <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6, marginBottom: 4 }}>
              <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 11, color: courseColors[hoveredNode.course] ?? "#fff" }}>
                {hoveredNode.label}
              </Text>
              <Text style={{ fontFamily: "Inter_400Regular", fontSize: 10, color: T.textDim, letterSpacing: 0.5 }}>
                {hoveredNode.course}
              </Text>
            </View>
            <Text style={{ fontFamily: "Inter_400Regular", fontSize: 11, lineHeight: 17, color: "rgba(255,255,255,0.45)" }}>
              {hoveredNode.desc}
            </Text>
          </View>
        ) : (
          <Text style={{ fontFamily: "Inter_400Regular", fontSize: 11, color: "rgba(255,255,255,0.2)", textAlign: "center", marginTop: 14 }}>
            Tap a concept to trace connections
          </Text>
        )}
      </View>
    </View>
  );
}

// ── Notes tab ─────────────────────────────────────────────────────────────────

function ClassNotesTab({ courses, assignments }: { courses: Course[]; assignments: Assignment[] }) {
  const [expanded,      setExpanded]      = useState<string | null>(null);
  const [rubrics,       setRubrics]       = useState<Record<string, any>>({});
  const [rubricLoading, setRubricLoading] = useState<Record<string, boolean>>({});
  const [lectureDates,  setLectureDates]  = useState<Record<string, any[]>>({});
  const [dateInput,     setDateInput]     = useState<Record<string, string>>({});

  useEffect(() => {
    storageGet("toolkit_rubrics").then(setRubrics);
    storageGet("toolkit_lecture_dates").then(setLectureDates);
  }, []);

  const saveRubrics = (next: Record<string, any>) => { setRubrics(next); storageSet("toolkit_rubrics", next); };
  const saveDates   = (next: Record<string, any[]>) => { setLectureDates(next); storageSet("toolkit_lecture_dates", next); };

  const generateRubric = useCallback(async (cid: string) => {
    const course = courses.find(c => String(c.id) === cid);
    if (!course) return;
    const courseAssignments = assignments
      .filter(a => String(a.courseId) === cid || String(a.courseCode) === String(course.courseCode))
      .slice(0, 10);
    setRubricLoading(prev => ({ ...prev, [cid]: true }));
    try {
      const prompt = `You are a professor evaluating student work for "${course.name}" (${course.courseCode ?? ""}).

Recent assignments: ${courseAssignments.map(a => a.name).join(", ") || "(none)"}

Generate a concise rubric to evaluate current student progress. Return ONLY JSON:
{
  "criteria": [
    { "name": "criterion name", "weight": 25, "excellent": "description", "needs_work": "description" }
  ],
  "summary": "One sentence overall assessment suggestion."
}

3-4 criteria, weights sum to 100. Be specific to this course.`;
      const parsed = parseJsonBlock(await groq([{ role: "user", content: prompt }]));
      saveRubrics({ ...rubrics, [cid]: { ...parsed, generatedAt: new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }) } });
    } catch {} finally {
      setRubricLoading(prev => ({ ...prev, [cid]: false }));
    }
  }, [courses, assignments, rubrics]);

  function addLectureDate(cid: string) {
    const val = (dateInput[cid] || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(val)) return;
    const next = {
      ...lectureDates,
      [cid]: [...(lectureDates[cid] || []), { date: val, addedAt: new Date().toISOString() }]
        .sort((a, b) => +new Date(a.date) - +new Date(b.date)),
    };
    saveDates(next);
    setDateInput(prev => ({ ...prev, [cid]: "" }));
  }

  function removeLectureDate(cid: string, idx: number) {
    saveDates({ ...lectureDates, [cid]: lectureDates[cid].filter((_, i) => i !== idx) });
  }

  if (!courses.length) return <EmptyCard title="No courses yet" sub="Connect Canvas to see your courses here" />;

  return (
    <View style={{ gap: 10 }}>
      {courses.map((course, idx) => {
        const cid    = String(course.id);
        const color  = COLOR_PALETTE[idx % COLOR_PALETTE.length];
        const open   = expanded === cid;
        const rubric = rubrics[cid];
        const dates  = lectureDates[cid] || [];

        return (
          <View key={cid} style={styles.courseCard}>
            <TouchableOpacity style={styles.courseHeader} onPress={() => setExpanded(open ? null : cid)} activeOpacity={0.7}>
              <View style={{ minWidth: 0, flex: 1 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 3 }}>
                  <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 10, color, letterSpacing: 0.5 }}>
                    {course.courseCode ?? course.name}
                  </Text>
                  {dates.length > 0 && (
                    <Text style={{ fontFamily: "Inter_400Regular", fontSize: 10, color: "rgba(255,200,100,0.6)" }}>
                      {dates.length} date{dates.length !== 1 ? "s" : ""}
                    </Text>
                  )}
                </View>
                <Text numberOfLines={1} style={styles.courseName}>{course.name}</Text>
              </View>
              <View style={{ marginLeft: 12 }}>
                {open ? <ChevronUp size={16} color={T.textDim} /> : <ChevronDown size={16} color={T.textDim} />}
              </View>
            </TouchableOpacity>

            {open && (
              <View style={styles.courseBody}>
                {/* Notes & files — upload needs a native picker; degrade honestly */}
                <Text style={styles.subLabel}>NOTES & FILES</Text>
                <Text style={styles.dimNote}>Upload notes from the web app — mobile upload coming with file-picker support</Text>

                {/* Lecture dates */}
                <Text style={styles.subLabel}>LECTURE DATES</Text>
                <View style={{ flexDirection: "row", gap: 8, marginBottom: 10 }}>
                  <TextInput
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor={T.textDim}
                    value={dateInput[cid] || ""}
                    onChangeText={v => setDateInput(prev => ({ ...prev, [cid]: v }))}
                    style={styles.dateInput}
                  />
                  <TouchableOpacity style={styles.amberBtn} onPress={() => addLectureDate(cid)}>
                    <Text style={styles.amberBtnText}>Add</Text>
                  </TouchableOpacity>
                </View>
                {dates.length > 0 ? (
                  <View style={{ gap: 5, marginBottom: 16 }}>
                    {dates.map((d, i) => (
                      <View key={i} style={styles.dateRow}>
                        <Text style={{ fontFamily: "Inter_400Regular", fontSize: 12, color: "rgba(255,200,100,0.8)" }}>
                          {new Date(d.date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                        </Text>
                        <TouchableOpacity onPress={() => removeLectureDate(cid, i)} hitSlop={8}>
                          <Text style={{ fontSize: 14, color: "rgba(255,100,90,0.5)" }}>×</Text>
                        </TouchableOpacity>
                      </View>
                    ))}
                  </View>
                ) : (
                  <Text style={styles.dimNote}>No lecture dates added yet</Text>
                )}

                {/* AI Rubric */}
                <View style={{ borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.05)", paddingTop: 14 }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                    <Text style={styles.subLabelInline}>
                      AI RUBRIC{rubric ? <Text style={{ color: "rgba(255,255,255,0.2)", letterSpacing: 0 }}>  · generated {rubric.generatedAt}</Text> : null}
                    </Text>
                    <TouchableOpacity
                      style={styles.purpleBtn}
                      disabled={!!rubricLoading[cid]}
                      onPress={() => generateRubric(cid)}
                    >
                      {rubricLoading[cid] ? (
                        <Text style={[styles.purpleBtnText, { color: "rgba(190,130,255,0.4)" }]}>Generating…</Text>
                      ) : (
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                          <Text style={styles.purpleBtnText}>{rubric ? "Regenerate" : "Generate"}</Text>
                          <Sparkles size={12} color="rgba(190,130,255,0.8)" />
                        </View>
                      )}
                    </TouchableOpacity>
                  </View>

                  {rubricLoading[cid] && !rubric && <Text style={styles.dimNote}>Evaluating course progress…</Text>}

                  {rubric && (
                    <View style={{ gap: 8 }}>
                      {(rubric.criteria || []).map((c: any, i: number) => (
                        <View key={i} style={styles.rubricCard}>
                          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                            <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 12, color: "rgba(190,130,255,0.9)" }}>{c.name}</Text>
                            <Text style={{ fontFamily: "Inter_400Regular", fontSize: 10, color: T.textDim }}>{c.weight}%</Text>
                          </View>
                          <View style={{ flexDirection: "row", gap: 4, marginBottom: 3 }}>
                            <Check size={11} color="rgba(100,220,155,0.7)" style={{ marginTop: 2 }} />
                            <Text style={{ flex: 1, fontFamily: "Inter_400Regular", fontSize: 11, color: "rgba(100,220,155,0.7)" }}>{c.excellent}</Text>
                          </View>
                          <View style={{ flexDirection: "row", gap: 4 }}>
                            <ArrowUp size={11} color="rgba(255,130,100,0.6)" style={{ marginTop: 2 }} />
                            <Text style={{ flex: 1, fontFamily: "Inter_400Regular", fontSize: 11, color: "rgba(255,130,100,0.6)" }}>{c.needs_work}</Text>
                          </View>
                        </View>
                      ))}
                      {rubric.summary ? (
                        <Text style={{ fontFamily: "Inter_400Regular", fontSize: 12, fontStyle: "italic", color: T.textSecondary, marginTop: 4 }}>
                          {rubric.summary}
                        </Text>
                      ) : null}
                    </View>
                  )}

                  {!rubric && !rubricLoading[cid] && (
                    <Text style={styles.dimNote}>Tap Generate to evaluate course progress.</Text>
                  )}
                </View>
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

// ── Recordings tab ────────────────────────────────────────────────────────────

function RecordingsTab({ courses }: { courses: Course[] }) {
  const [transcripts, setTranscripts] = useState<Record<string, any[]>>({});
  const [expanded,    setExpanded]    = useState<string | null>(null);
  const [textInput,   setTextInput]   = useState<Record<string, string>>({});

  useEffect(() => { storageGet("toolkit_transcripts").then(setTranscripts); }, []);
  const save = (next: Record<string, any[]>) => { setTranscripts(next); storageSet("toolkit_transcripts", next); };

  function addTranscript(cid: string) {
    const text = textInput[cid]?.trim();
    if (!text) return;
    save({ ...transcripts, [cid]: [...(transcripts[cid] || []), { text, addedAt: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" }) }] });
    setTextInput(prev => ({ ...prev, [cid]: "" }));
  }
  function removeTranscript(cid: string, idx: number) {
    save({ ...transcripts, [cid]: transcripts[cid].filter((_, i) => i !== idx) });
  }

  if (!courses.length) return <EmptyCard title="No courses yet" sub="Connect Canvas to see your courses here" />;

  return (
    <View style={{ gap: 10 }}>
      <View style={styles.wisprCard}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: "Inter_500Medium", fontSize: 12, color: "rgba(100,180,255,0.85)", marginBottom: 2 }}>
            Wisprflow not connected
          </Text>
          <Text style={{ fontFamily: "Inter_400Regular", fontSize: 11, color: T.textDim }}>
            Audio recording + auto-transcription pending Vincent's API access
          </Text>
        </View>
        <Hourglass size={18} color="rgba(100,180,255,0.4)" />
      </View>

      {courses.map((course, idx) => {
        const cid   = String(course.id);
        const items = transcripts[cid] || [];
        const color = COLOR_PALETTE[idx % COLOR_PALETTE.length];
        const open  = expanded === cid;

        return (
          <View key={cid} style={styles.courseCard}>
            <TouchableOpacity style={styles.courseHeader} onPress={() => setExpanded(open ? null : cid)} activeOpacity={0.7}>
              <View style={{ minWidth: 0, flex: 1 }}>
                <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 10, color, letterSpacing: 0.5, marginBottom: 3 }}>
                  {course.courseCode ?? course.name}
                </Text>
                <Text numberOfLines={1} style={styles.courseName}>{course.name}</Text>
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <Text style={{ fontFamily: "Inter_400Regular", fontSize: 10, color: T.textDim }}>
                  {items.length} transcript{items.length !== 1 ? "s" : ""}
                </Text>
                {open ? <ChevronUp size={16} color={T.textDim} /> : <ChevronDown size={16} color={T.textDim} />}
              </View>
            </TouchableOpacity>

            {open && (
              <View style={styles.courseBody}>
                <View style={styles.recordBtn}>
                  <CircleIcon size={12} color="rgba(255,100,90,0.6)" fill="rgba(255,100,90,0.6)" />
                  <Text style={{ fontFamily: "Inter_400Regular", fontSize: 13, color: "rgba(255,100,90,0.6)" }}>
                    Record Lecture — requires Wisprflow
                  </Text>
                </View>

                <Text style={styles.subLabel}>TRANSCRIPTS</Text>
                <TextInput
                  placeholder="Paste transcript text here…"
                  placeholderTextColor={T.textDim}
                  value={textInput[cid] || ""}
                  onChangeText={v => setTextInput(prev => ({ ...prev, [cid]: v }))}
                  multiline
                  style={styles.transcriptInput}
                />
                <TouchableOpacity style={styles.tealBtn} onPress={() => addTranscript(cid)}>
                  <Text style={styles.tealBtnText}>+ Add Transcript</Text>
                </TouchableOpacity>

                {items.length > 0 && (
                  <View style={{ gap: 8, marginTop: 12 }}>
                    {items.map((t, i) => (
                      <View key={i} style={styles.transcriptCard}>
                        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                          <Text style={{ fontFamily: "Inter_400Regular", fontSize: 10, color: T.textDim }}>Transcript · {t.addedAt}</Text>
                          <TouchableOpacity onPress={() => removeTranscript(cid, i)} hitSlop={8}>
                            <Text style={{ fontSize: 14, color: "rgba(255,100,90,0.5)" }}>×</Text>
                          </TouchableOpacity>
                        </View>
                        <Text numberOfLines={4} style={{ fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 19, color: T.textSecondary }}>
                          {t.text}
                        </Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

// ── Lecture Digest tab ────────────────────────────────────────────────────────

function LectureDigestTab() {
  const userId = useUserId();
  const [digests,  setDigests]  = useState<any[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    supabase.from("lecture_digests")
      .select("id, title, status, summary, key_points, created_at")
      .eq("user_id", userId).eq("status", "done")
      .order("created_at", { ascending: false }).limit(20)
      .then(({ data }) => { if (!cancelled) { setDigests(data ?? []); setLoading(false); } });
    return () => { cancelled = true; };
  }, [userId]);

  return (
    <View style={{ gap: 14 }}>
      <Text style={styles.dimNote}>Upload lecture recordings from the web app — digests appear here once processed</Text>

      {loading && <Text style={{ fontFamily: "Inter_400Regular", fontSize: 12, color: T.textDim }}>Loading past digests…</Text>}

      {!loading && digests.length === 0 && (
        <EmptyCard title="No lecture digests yet" sub="Upload a lecture recording on the web to get a summary, flashcards, and a quiz" />
      )}

      {digests.map(d => {
        const open = expanded === d.id;
        return (
          <View key={d.id} style={styles.courseCard}>
            <TouchableOpacity style={styles.courseHeader} onPress={() => setExpanded(open ? null : d.id)} activeOpacity={0.7}>
              <Text numberOfLines={1} style={[styles.courseName, { flex: 1, fontSize: 13 }]}>{d.title ?? "Lecture"}</Text>
              {open ? <ChevronUp size={16} color={T.textDim} /> : <ChevronDown size={16} color={T.textDim} />}
            </TouchableOpacity>
            {open && (
              <View style={styles.courseBody}>
                {d.summary ? (
                  <Text style={{ fontFamily: "Inter_400Regular", fontSize: 13, lineHeight: 21, color: T.textSecondary, marginBottom: 10 }}>
                    {d.summary}
                  </Text>
                ) : null}
                {Array.isArray(d.key_points) && d.key_points.length > 0 && (
                  <View style={{ gap: 6 }}>
                    <Text style={styles.subLabel}>KEY POINTS</Text>
                    {d.key_points.map((p: any, i: number) => (
                      <Text key={i} style={{ fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 19, color: T.textSecondary }}>
                        • {typeof p === "string" ? p : p?.point ?? ""}
                      </Text>
                    ))}
                  </View>
                )}
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

// ── Reminders (Twilio) tab ────────────────────────────────────────────────────

function TwilioTab({ assignments, userName }: { assignments: Assignment[]; userName: string }) {
  const [phone,    setPhone]    = useState("");
  const [saved,    setSaved]    = useState(false);
  const [sending,  setSending]  = useState(false);
  const [lastSent, setLastSent] = useState<string | null>(null);
  const [error,    setError]    = useState<string | null>(null);

  useEffect(() => {
    AsyncStorage.getItem("toolkit_phone").then(v => { if (v) { setPhone(v); setSaved(true); } });
  }, []);

  function savePhone() {
    const trimmed = phone.trim();
    if (!trimmed) return;
    AsyncStorage.setItem("toolkit_phone", trimmed).catch(() => {});
    setSaved(true);
  }

  const urgent = assignments.filter(a => {
    if (!a.dueAt || a.submission?.submittedAt) return false;
    const diff = +new Date(a.dueAt) - Date.now();
    return diff > 0 && diff < 48 * 3_600_000;
  }).sort((a, b) => +new Date(a.dueAt!) - +new Date(b.dueAt!)).slice(0, 5);

  async function sendReminders() {
    if (!saved || !phone.trim() || sending) return;
    setSending(true);
    setError(null);
    try {
      const name = userName || "Student";
      const body = urgent.length > 0
        ? `Hi ${name}! You have ${urgent.length} assignment${urgent.length > 1 ? "s" : ""} due soon:\n` +
          urgent.map(a => `• ${a.name} — due ${new Date(a.dueAt!).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}`).join("\n") +
          "\n\nGood luck! — FSchoolAI"
        : `Hi ${name}! No urgent assignments in the next 48 hours. Keep it up! — FSchoolAI`;
      await apiFetch("/api/utils?fn=twilio", { to: phone.trim(), body });
      setLastSent(new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }));
    } catch (err: any) {
      setError(err?.message ?? "SMS failed");
    } finally {
      setSending(false);
    }
  }

  return (
    <View style={{ gap: 12 }}>
      <View style={styles.sectionCard}>
        <Text style={styles.subLabel}>SMS REMINDERS</Text>
        <View style={{ flexDirection: "row", gap: 8, marginBottom: 10 }}>
          <TextInput
            placeholder="+1 555 000 0000"
            placeholderTextColor={T.textDim}
            keyboardType="phone-pad"
            value={phone}
            onChangeText={v => { setPhone(v); setSaved(false); }}
            style={[styles.dateInput, { fontSize: 13 }]}
          />
          <TouchableOpacity
            style={[styles.tealBtn, saved && { backgroundColor: "rgba(100,220,155,0.12)", borderColor: "rgba(100,220,155,0.25)" }]}
            onPress={savePhone}
          >
            {saved ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                <Text style={[styles.tealBtnText, { color: "rgba(100,220,155,0.8)" }]}>Saved</Text>
                <Check size={12} color="rgba(100,220,155,0.8)" />
              </View>
            ) : (
              <Text style={styles.tealBtnText}>Save</Text>
            )}
          </TouchableOpacity>
        </View>
        <Text style={{ fontFamily: "Inter_400Regular", fontSize: 11, color: T.textDim }}>Include country code.</Text>
      </View>

      <View style={styles.sectionCard}>
        <Text style={styles.subLabel}>DUE IN 48 HOURS</Text>
        {urgent.length === 0 ? (
          <Text style={[styles.dimNote, { marginBottom: 0 }]}>Nothing urgent right now</Text>
        ) : (
          <View style={{ gap: 6 }}>
            {urgent.map((a, i) => (
              <View key={i} style={styles.urgentRow}>
                <Text numberOfLines={1} style={{ flex: 1, fontFamily: "Inter_400Regular", fontSize: 13, color: T.textPrimary }}>{a.name}</Text>
                <Text style={{ fontFamily: "Inter_400Regular", fontSize: 11, color: "rgba(255,100,90,0.7)", marginLeft: 8 }}>
                  {new Date(a.dueAt!).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                </Text>
              </View>
            ))}
          </View>
        )}
      </View>

      <TouchableOpacity
        style={[styles.sendBtn, !saved && { backgroundColor: "rgba(255,255,255,0.04)", borderColor: T.border }]}
        disabled={!saved || sending}
        onPress={sendReminders}
      >
        <Text style={[styles.sendBtnText, !saved && { color: T.textDim }]}>
          {sending ? "Sending…" : "Send Assignment Reminder via SMS"}
        </Text>
      </TouchableOpacity>

      {lastSent && (
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4 }}>
          <Check size={12} color="rgba(100,220,155,0.7)" />
          <Text style={{ fontFamily: "Inter_400Regular", fontSize: 12, color: "rgba(100,220,155,0.7)" }}>Sent at {lastSent}</Text>
        </View>
      )}
      {error && (
        <Text style={{ fontFamily: "Inter_400Regular", fontSize: 12, color: "rgba(255,100,90,0.7)", textAlign: "center" }}>
          Error: {error}
        </Text>
      )}
    </View>
  );
}

// ── Submitted tab ─────────────────────────────────────────────────────────────

function PreviousWorkTab({ assignments }: { assignments: Assignment[] }) {
  const submitted = assignments
    .filter(a => a.submission?.submittedAt)
    .sort((a, b) => +new Date(b.submission.submittedAt!) - +new Date(a.submission.submittedAt!));

  if (!submitted.length) {
    return <EmptyCard title="No previous work yet" sub="Submitted assignments will appear here once Canvas is synced" />;
  }
  return (
    <View style={{ gap: 8 }}>
      {submitted.map((a, i) => (
        <View key={i} style={styles.sectionCard}>
          <Text style={{ fontFamily: "Inter_500Medium", fontSize: 14, color: T.textPrimary, marginBottom: 3 }}>{a.name}</Text>
          <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
            <Text style={{ fontFamily: "Inter_400Regular", fontSize: 11, color: T.textDim }}>{a.courseCode || a.courseName}</Text>
            {a.submission?.score != null && a.pointsPossible ? (
              <Text style={{ fontFamily: "Inter_400Regular", fontSize: 11, color: "rgba(100,220,155,0.7)" }}>
                {a.submission.score}/{a.pointsPossible}
              </Text>
            ) : null}
            <Text style={{ fontFamily: "Inter_400Regular", fontSize: 11, color: T.textDim }}>
              {new Date(a.submission.submittedAt!).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

// ── shared bits ───────────────────────────────────────────────────────────────

function EmptyCard({ title, sub }: { title: string; sub: string }) {
  return (
    <View style={[styles.sectionCard, { alignItems: "center", paddingVertical: 32 }]}>
      <Text style={{ fontFamily: "Inter_500Medium", fontSize: 14, color: T.textSecondary, marginBottom: 6 }}>{title}</Text>
      <Text style={{ fontFamily: "Inter_400Regular", fontSize: 12, color: T.textDim, textAlign: "center" }}>{sub}</Text>
    </View>
  );
}

// ── main screen ───────────────────────────────────────────────────────────────

const TABS = [
  { id: "notes",      label: "Notes"          },
  { id: "recordings", label: "Recordings"     },
  { id: "digest",     label: "Lecture Digest" },
  { id: "grades",     label: "Grades"         },
  { id: "reminders",  label: "Reminders"      },
  { id: "previous",   label: "Submitted"      },
];

export default function ToolkitScreen() {
  const userId = useUserId();
  const [activeTab,   setActiveTab]   = useState("notes");
  const [courses,     setCourses]     = useState<Course[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [userName,    setUserName]    = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [{ data: courseRows }, { data: aRows }, { data: user }] = await Promise.all([
        supabase.from("courses").select("id, name, course_code").eq("user_id", userId),
        supabase.from("assignments")
          .select("id, title, course_id, due_at, points_possible, score, submitted_at, courses(name, course_code)")
          .eq("user_id", userId),
        supabase.from("users").select("name").eq("id", userId).maybeSingle(),
      ]);
      if (cancelled) return;
      setCourses((courseRows ?? []).map((c: any) => ({ id: c.id, name: c.name, courseCode: c.course_code })));
      setAssignments((aRows ?? []).map((a: any) => ({
        id: a.id, name: a.title, courseId: a.course_id,
        courseCode: a.courses?.course_code, courseName: a.courses?.name,
        dueAt: a.due_at, pointsPossible: a.points_possible,
        submission: { score: a.score, submittedAt: a.submitted_at },
      })));
      setUserName(user?.name ?? "");
    })();
    return () => { cancelled = true; };
  }, [userId]);

  return (
    <ScreenWrapper page="toolkit">
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 90 }}>
        <Text style={styles.h1}>Toolkit</Text>
        <Text style={styles.pageSub}>Your AI's knowledge base</Text>

        <KnowledgeGraph courses={courses} assignments={assignments} />

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 18 }}>
          <View style={styles.tabsRow}>
            {TABS.map(tab => {
              const active = activeTab === tab.id;
              return (
                <TouchableOpacity
                  key={tab.id}
                  style={[styles.tab, active && styles.tabActive]}
                  onPress={() => setActiveTab(tab.id)}
                >
                  <Text style={[styles.tabText, active && styles.tabTextActive]}>{tab.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </ScrollView>

        {activeTab === "notes"      && <ClassNotesTab courses={courses} assignments={assignments} />}
        {activeTab === "recordings" && <RecordingsTab courses={courses} />}
        {activeTab === "digest"     && <LectureDigestTab />}
        {activeTab === "grades"     && (
          <EmptyCard title="What-If grade calculator" sub="Grade scenarios are available on the web app for now" />
        )}
        {activeTab === "reminders"  && <TwilioTab assignments={assignments} userName={userName} />}
        {activeTab === "previous"   && <PreviousWorkTab assignments={assignments} />}
      </ScrollView>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  h1:      { fontFamily: "Inter_600SemiBold", fontSize: 26, color: T.textPrimary, letterSpacing: -0.3, marginBottom: 4 },
  pageSub: { fontFamily: "Inter_400Regular", fontSize: 14, color: T.textDim, marginBottom: 24 },

  kgCard:       { backgroundColor: "rgba(255,255,255,0.02)", borderWidth: 1, borderColor: "rgba(255,255,255,0.06)", borderRadius: T.radiusCard, padding: 16, marginBottom: 24, overflow: "hidden" },
  kgHeader:     { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  kgLabel:      { fontFamily: "Inter_400Regular", fontSize: 11, color: T.textDim, letterSpacing: 2, marginBottom: 4 },
  kgEmptyTitle: { fontFamily: "Inter_500Medium", fontSize: 14, color: T.textSecondary, marginTop: 12, marginBottom: 6, textAlign: "center" },
  kgEmptySub:   { fontFamily: "Inter_400Regular", fontSize: 12, color: T.textDim, textAlign: "center" },

  tabsRow:       { flexDirection: "row", gap: 2, backgroundColor: "rgba(255,255,255,0.04)", borderWidth: 1, borderColor: T.border, borderRadius: T.radiusBtn, padding: 3 },
  tab:           { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 9, borderWidth: 1, borderColor: "transparent" },
  tabActive:     { backgroundColor: "rgba(255,255,255,0.09)", borderColor: "rgba(255,255,255,0.12)" },
  tabText:       { fontFamily: "Inter_400Regular", fontSize: 12, color: T.textSecondary },
  tabTextActive: { fontFamily: "Inter_600SemiBold", color: T.textPrimary },

  courseCard:   { backgroundColor: T.surface, borderWidth: 1, borderColor: T.border, borderRadius: T.radiusCard, overflow: "hidden" },
  courseHeader: { paddingVertical: 16, paddingHorizontal: 18, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  courseName:   { fontFamily: "Inter_500Medium", fontSize: 14, color: T.textPrimary },
  courseBody:   { borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.05)", paddingHorizontal: 18, paddingTop: 14, paddingBottom: 18 },

  subLabel:       { fontFamily: "Inter_400Regular", fontSize: 10, color: T.textDim, letterSpacing: 1.5, marginBottom: 10 },
  subLabelInline: { fontFamily: "Inter_400Regular", fontSize: 10, color: T.textDim, letterSpacing: 1.5 },
  dimNote:        { fontFamily: "Inter_400Regular", fontSize: 12, color: T.textDim, marginBottom: 16 },

  dateInput: { flex: 1, backgroundColor: "rgba(255,255,255,0.05)", borderWidth: 1, borderColor: "rgba(255,255,255,0.1)", borderRadius: 8, paddingVertical: 7, paddingHorizontal: 10, fontFamily: "Inter_400Regular", fontSize: 12, color: T.textPrimary },
  dateRow:   { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: "rgba(255,200,100,0.05)", borderRadius: 7, paddingVertical: 8, paddingHorizontal: 12 },

  amberBtn:      { backgroundColor: "rgba(255,200,100,0.12)", borderWidth: 1, borderColor: "rgba(255,200,100,0.25)", borderRadius: 8, paddingVertical: 7, paddingHorizontal: 12, justifyContent: "center" },
  amberBtnText:  { fontFamily: "Inter_400Regular", fontSize: 11, color: "rgba(255,200,100,0.8)" },
  purpleBtn:     { backgroundColor: "rgba(190,130,255,0.1)", borderWidth: 1, borderColor: "rgba(190,130,255,0.25)", borderRadius: 8, paddingVertical: 5, paddingHorizontal: 10 },
  purpleBtnText: { fontFamily: "Inter_400Regular", fontSize: 11, color: "rgba(190,130,255,0.8)" },
  tealBtn:       { backgroundColor: "rgba(0,210,190,0.1)", borderWidth: 1, borderColor: "rgba(0,210,190,0.2)", borderRadius: 8, paddingVertical: 6, paddingHorizontal: 14, alignSelf: "flex-start", justifyContent: "center" },
  tealBtnText:   { fontFamily: "Inter_400Regular", fontSize: 11, color: "rgba(0,210,190,0.8)" },

  rubricCard: { backgroundColor: "rgba(190,130,255,0.05)", borderWidth: 1, borderColor: "rgba(190,130,255,0.12)", borderRadius: 8, paddingVertical: 10, paddingHorizontal: 12 },

  wisprCard: { backgroundColor: "rgba(100,180,255,0.06)", borderWidth: 1, borderColor: "rgba(100,180,255,0.15)", borderRadius: T.radiusCard, paddingVertical: 12, paddingHorizontal: 16, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  recordBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: "rgba(255,100,90,0.08)", borderWidth: 1, borderColor: "rgba(255,100,90,0.2)", borderRadius: 10, padding: 12, marginBottom: 14 },

  transcriptInput: { minHeight: 80, backgroundColor: "rgba(255,255,255,0.04)", borderWidth: 1, borderColor: T.border, borderRadius: 8, paddingVertical: 10, paddingHorizontal: 12, fontFamily: "Inter_400Regular", fontSize: 12, color: T.textPrimary, textAlignVertical: "top", marginBottom: 8 },
  transcriptCard:  { backgroundColor: "rgba(255,255,255,0.03)", borderRadius: 8, paddingVertical: 10, paddingHorizontal: 12 },

  sectionCard: { backgroundColor: T.surface, borderWidth: 1, borderColor: T.border, borderRadius: T.radiusCard, padding: 18 },
  urgentRow:   { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: "rgba(255,100,90,0.05)", borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12 },

  sendBtn:     { backgroundColor: "rgba(190,130,255,0.12)", borderWidth: 1, borderColor: "rgba(190,130,255,0.25)", borderRadius: T.radiusCard, padding: 14, alignItems: "center" },
  sendBtnText: { fontFamily: "Inter_500Medium", fontSize: 13, color: "rgba(190,130,255,0.85)" },
});

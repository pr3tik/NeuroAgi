// GradeGraph.tsx — mobile port of src/components/GradeGraph.tsx.
//
// Grade-over-time line chart: one muted line per course + one teal "Overall
// GPA" line, each continuing as a dotted projection to the end of the
// semester. Falls back to placeholder data when Canvas isn't connected.
// Web uses recharts (SVG under the hood); this draws the same shape by hand
// with react-native-svg (Path/Line/Rect — same primitives as the knowledge
// graph in mobile/app/toolkit.tsx). Web's hover tooltip becomes tap-to-select
// here since touch has no hover: tapping a column shows that date's values
// below the chart.

import { useMemo, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import Svg, { G, Line, Path, Rect, Text as SvgText } from "react-native-svg";
import { ThemeColors } from "../constants/appTheme";

// ── Palette — keep in sync with src/components/GradeGraph.tsx ────────────────
export const COURSE_COLORS = [
  "rgba(100,180,255,0.85)", // sky blue
  "rgba(100,215,130,0.85)", // sage green
  "rgba(255,185,60,0.85)",  // amber
  "rgba(190,140,255,0.85)", // lavender
  "rgba(255,105,100,0.85)", // coral
  "rgba(60,220,200,0.75)",  // mint
  "rgba(255,145,180,0.85)", // rose
  "rgba(255,215,80,0.85)",  // gold
];
const GPA_COLOR = "rgba(90,165,116,0.85)"; // teal highlight

const C = {
  textPrimary: "#ECE8E1",
  textDim:     "rgba(255,255,255,0.35)",
  surface:     "#1d1b20",
  border:      "rgba(255,255,255,0.08)",
};

// ── Prop shapes ──────────────────────────────────────────────────────────────
// Minimal fields this chart actually reads. Structurally compatible with the
// fuller Course/Assignment shapes already used elsewhere in mobile/app
// (work.tsx / toolkit.tsx / assignment.tsx: id, courseCode, courseId, dueAt,
// pointsPossible, submission.score) — pass those arrays straight through.
export type GradeGraphCourse = {
  id: string | number;
  courseCode?: string | null;
};
export type GradeGraphAssignment = {
  courseId: string | number | null;
  dueAt: string | null;
  pointsPossible: number | null;
  submission?: { score: number | null } | null;
};

type ChartPoint = { label: string; real: boolean; [key: string]: number | string | boolean | undefined };

// ── Placeholder data (shown when Canvas is not connected) ────────────────────
const PLACEHOLDER_COURSES = ["PSYC 302", "CS 355", "BUS 410", "MATH 241"];
const PLACEHOLDER_DATA: ChartPoint[] = [
  { label: "Sep 8",  real: true,  "PSYC 302": 88, "CS 355": 80, "BUS 410": 92, "MATH 241": 74, GPA: 83.5 },
  { label: "Sep 22", real: true,  "PSYC 302": 84, "CS 355": 76, "BUS 410": 89, "MATH 241": 70, GPA: 79.8 },
  { label: "Oct 6",  real: true,  "PSYC 302": 87, "CS 355": 79, "BUS 410": 91, "MATH 241": 73, GPA: 82.5 },
  { label: "Oct 20", real: true,  "PSYC 302": 90, "CS 355": 82, "BUS 410": 93, "MATH 241": 71, GPA: 84.0,
                                  "PSYC 302_proj": 90, "CS 355_proj": 82, "BUS 410_proj": 93, "MATH 241_proj": 71, "GPA_proj": 84.0 },
  { label: "Nov 3",  real: false, "PSYC 302_proj": 91, "CS 355_proj": 83, "BUS 410_proj": 94, "MATH 241_proj": 72, "GPA_proj": 85.0 },
  { label: "Nov 17", real: false, "PSYC 302_proj": 92, "CS 355_proj": 84, "BUS 410_proj": 95, "MATH 241_proj": 73, "GPA_proj": 86.0 },
];

// ── Data builder from live Canvas data ────────────────────────────────────────
// Mirrors src/components/GradeGraph.tsx buildChartData() 1:1 (bi-weekly
// buckets, running per-course average, dotted projection bridged from each
// course's own last real point at +0.5%/bucket, capped at 100).

function buildChartData(
  courses: GradeGraphCourse[],
  assignments: GradeGraphAssignment[]
): { data: ChartPoint[]; courseKeys: string[] } | null {
  if (!courses.length || !assignments.length) return null;

  // Filter graded assignments with a valid dueAt, into a fully-typed shape
  // so the rest of this function doesn't need null assertions.
  const graded = assignments
    .filter(a => !!a.dueAt && (a.pointsPossible ?? 0) > 0 && a.submission?.score != null)
    .map(a => ({
      courseId: String(a.courseId),
      dueAt: a.dueAt as string,
      pointsPossible: a.pointsPossible as number,
      score: a.submission!.score as number,
    }))
    .sort((a, b) => +new Date(a.dueAt) - +new Date(b.dueAt));
  if (!graded.length) return null;

  const minDate = new Date(graded[0].dueAt);
  const maxDate = new Date(graded[graded.length - 1].dueAt);
  // Future boundary: latest due_at in all assignments (graded or not)
  const allDueDates = assignments
    .map(a => a.dueAt)
    .filter((d): d is string => !!d)
    .map(d => new Date(d));
  const endDate = allDueDates.length ? new Date(Math.max(...allDueDates.map(d => +d))) : maxDate;

  // Build bi-weekly bucket labels from minDate to endDate
  const buckets: Date[] = [];
  const cur = new Date(minDate);
  while (cur <= endDate) {
    buckets.push(new Date(cur));
    cur.setDate(cur.getDate() + 14);
  }
  if (!buckets.length) return null;

  const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const courseKeys = courses.map(c => c.courseCode).filter((c): c is string => !!c);

  const firstProjIdx = buckets.findIndex(b => {
    const next = new Date(b.getTime() + 14 * 86400000);
    return next > maxDate;
  });
  const splitIdx = firstProjIdx === -1 ? buckets.length - 1 : firstProjIdx;

  // Running average per course per bucket
  const data: ChartPoint[] = buckets.map((bucketStart, idx) => {
    const bucketEnd = new Date(bucketStart.getTime() + 14 * 86400000);
    const isReal = idx <= splitIdx;
    const point: ChartPoint = { label: fmt(bucketStart), real: isReal };

    const allScores: number[] = [];
    for (const course of courses) {
      const code = course.courseCode;
      if (!code) continue;
      const bucket = graded.filter(a =>
        a.courseId === String(course.id) &&
        new Date(a.dueAt) >= bucketStart &&
        new Date(a.dueAt) < bucketEnd
      );
      if (bucket.length) {
        const avg = bucket.reduce((s, a) => s + (a.score / a.pointsPossible) * 100, 0) / bucket.length;
        const rounded = Math.round(avg);
        const key = isReal ? code : `${code}_proj`;
        point[key] = rounded;
        allScores.push(rounded);
      }
    }
    if (allScores.length) {
      const gpaAvg = Math.round(allScores.reduce((s, v) => s + v, 0) / allScores.length);
      point[isReal ? "GPA" : "GPA_proj"] = gpaAvg;
    }
    return point;
  });

  // Bridge + projection: each course's dotted line starts at its own last real
  // data point (sparse courses may not have data at the global splitIdx).
  for (const course of courses) {
    const code = course.courseCode;
    if (!code) continue;
    let lastRealIdx = -1;
    let lastVal: number | null = null;
    for (let j = splitIdx; j >= 0; j--) {
      const v = data[j][code];
      if (typeof v === "number") { lastRealIdx = j; lastVal = v; break; }
    }
    if (lastVal == null || lastRealIdx === -1) continue;
    data[lastRealIdx][`${code}_proj`] = lastVal;
    for (let i = lastRealIdx + 1; i < data.length; i++) {
      data[i][`${code}_proj`] = Math.min(100, Math.round(lastVal + (i - lastRealIdx) * 0.5));
    }
  }

  let lastGpaIdx = -1;
  let lastGpa: number | null = null;
  for (let j = splitIdx; j >= 0; j--) {
    const v = data[j]["GPA"];
    if (typeof v === "number") { lastGpaIdx = j; lastGpa = v; break; }
  }
  if (lastGpa != null && lastGpaIdx !== -1) {
    data[lastGpaIdx]["GPA_proj"] = lastGpa;
    for (let i = lastGpaIdx + 1; i < data.length; i++) {
      data[i]["GPA_proj"] = Math.min(100, Math.round(lastGpa + (i - lastGpaIdx) * 0.5));
    }
  }

  return { data, courseKeys };
}

// ── Chart geometry ─────────────────────────────────────────────────────────────

const CHART_W = 400;
const CHART_H = 168;
const M = { top: 10, right: 12, bottom: 20, left: 32 };
const PLOT_W = CHART_W - M.left - M.right;
const PLOT_H = CHART_H - M.top - M.bottom;
const Y_MIN = 50;
const Y_MAX = 100;
const Y_TICKS = [50, 75, 100];

function xFor(i: number, n: number) {
  if (n <= 1) return M.left + PLOT_W / 2;
  return M.left + (i / (n - 1)) * PLOT_W;
}
function yFor(v: number) {
  const clamped = Math.max(Y_MIN, Math.min(Y_MAX, v));
  return M.top + PLOT_H - ((clamped - Y_MIN) / (Y_MAX - Y_MIN)) * PLOT_H;
}

// connectNulls: skip undefined points, connect the surrounding defined ones directly.
function seriesPath(data: ChartPoint[], key: string): string | null {
  const pts = data
    .map((d, i) => ({ i, v: d[key] }))
    .filter((p): p is { i: number; v: number } => typeof p.v === "number");
  if (pts.length < 2) return null;
  return pts.map((p, idx) => `${idx === 0 ? "M" : "L"} ${xFor(p.i, data.length).toFixed(2)} ${yFor(p.v).toFixed(2)}`).join(" ");
}

// ── Chart component ───────────────────────────────────────────────────────────

function GradeChart({ data, courseKeys }: { data: ChartPoint[]; courseKeys: string[] }) {
  const [selected, setSelected] = useState<number | null>(null);

  const courseLines = useMemo(
    () => courseKeys.map((key, i) => ({
      key,
      color: COURSE_COLORS[i % COURSE_COLORS.length],
      real: seriesPath(data, key),
      proj: seriesPath(data, `${key}_proj`),
    })),
    [data, courseKeys]
  );
  const gpaReal = useMemo(() => seriesPath(data, "GPA"), [data]);
  const gpaProj = useMemo(() => seriesPath(data, "GPA_proj"), [data]);

  const selectedPoint = selected != null ? data[selected] : null;
  const selectedDetails = useMemo(() => {
    if (selected == null) return [];
    const d = data[selected];
    const rows: { label: string; value: number; color: string }[] = [];
    for (const c of courseLines) {
      const v = d[c.key];
      if (typeof v === "number") rows.push({ label: c.key, value: v, color: c.color });
    }
    for (const c of courseLines) {
      const v = d[`${c.key}_proj`];
      if (typeof v === "number") rows.push({ label: `${c.key} (projected)`, value: v, color: c.color });
    }
    if (typeof d.GPA === "number") rows.push({ label: "GPA", value: d.GPA, color: GPA_COLOR });
    if (typeof d.GPA_proj === "number") rows.push({ label: "GPA (projected)", value: d.GPA_proj, color: GPA_COLOR });
    return rows;
  }, [selected, data, courseLines]);

  const colWidth = PLOT_W / Math.max(1, data.length - 1 || 1);

  return (
    <View>
      <Svg width="100%" height={CHART_H} viewBox={`0 0 ${CHART_W} ${CHART_H}`}>
        {/* horizontal gridlines */}
        {Y_TICKS.map(v => (
          <Line key={`grid-${v}`} x1={M.left} y1={yFor(v)} x2={CHART_W - M.right} y2={yFor(v)} stroke="rgba(255,255,255,0.04)" strokeWidth={1} />
        ))}
        {/* y-axis labels */}
        {Y_TICKS.map(v => (
          <SvgText key={`ytick-${v}`} x={M.left - 6} y={yFor(v) + 3} fontSize={9} fill="rgba(255,255,255,0.25)" textAnchor="end">
            {`${v}%`}
          </SvgText>
        ))}
        {/* x-axis labels — first & last only (mirrors recharts interval="preserveStartEnd") */}
        {data.length > 0 && (
          <SvgText x={xFor(0, data.length)} y={CHART_H - 4} fontSize={9} fill="rgba(255,255,255,0.25)" textAnchor="start">
            {data[0].label}
          </SvgText>
        )}
        {data.length > 1 && (
          <SvgText x={xFor(data.length - 1, data.length)} y={CHART_H - 4} fontSize={9} fill="rgba(255,255,255,0.25)" textAnchor="end">
            {data[data.length - 1].label}
          </SvgText>
        )}

        {/* selected-column guide line */}
        {selected != null && (
          <Line
            x1={xFor(selected, data.length)} y1={M.top} x2={xFor(selected, data.length)} y2={CHART_H - M.bottom}
            stroke="rgba(255,255,255,0.12)" strokeWidth={1}
          />
        )}

        {/* per-course real lines */}
        {courseLines.map(c => c.real && (
          <Path key={c.key} d={c.real} stroke={c.color} strokeWidth={1.5} fill="none" />
        ))}
        {/* per-course projection lines (dotted) */}
        {courseLines.map(c => c.proj && (
          <Path key={`${c.key}_proj`} d={c.proj} stroke={c.color} strokeWidth={1.5} strokeDasharray="4 4" fill="none" />
        ))}

        {/* GPA real line (teal) */}
        {gpaReal && <Path d={gpaReal} stroke={GPA_COLOR} strokeWidth={2} fill="none" />}
        {/* GPA projection (teal dotted) */}
        {gpaProj && <Path d={gpaProj} stroke={GPA_COLOR} strokeWidth={2} strokeDasharray="4 4" fill="none" />}

        {/* invisible per-bucket touch targets — tap a column to see its values below */}
        {data.map((d, i) => (
          <G key={`hit-${i}`} onPress={() => setSelected(s => (s === i ? null : i))}>
            <Rect
              x={xFor(i, data.length) - colWidth / 2}
              y={M.top}
              width={colWidth}
              height={PLOT_H}
              fill="transparent"
            />
          </G>
        ))}
      </Svg>

      {/* Tap-to-select detail row — mobile equivalent of the web hover tooltip */}
      <View style={styles.tooltip}>
        {selectedPoint ? (
          <>
            <Text style={styles.tooltipLabel}>{selectedPoint.label}</Text>
            <View style={styles.tooltipRows}>
              {selectedDetails.map((r, i) => (
                <Text key={i} style={[styles.tooltipRow, { color: r.color }]}>
                  {r.label} — {r.value}%
                </Text>
              ))}
            </View>
          </>
        ) : (
          <Text style={styles.tooltipHint}>Tap the chart to see values for a date</Text>
        )}
      </View>

      {/* Legend */}
      <View style={styles.legend}>
        {courseLines.map(c => (
          <View key={c.key} style={styles.legendItem}>
            <View style={[styles.legendSwatch, { backgroundColor: c.color }]} />
            <Text style={styles.legendText}>{c.key}</Text>
          </View>
        ))}
        <View style={styles.legendItem}>
          <View style={[styles.legendSwatch, { backgroundColor: GPA_COLOR }]} />
          <Text style={styles.legendTextGpa}>Overall GPA</Text>
        </View>
      </View>
    </View>
  );
}

// ── Component ────────────────────────────────────────────────────────────────

export default function GradeGraph({
  courses = [],
  assignments = [],
  connected = false,
  colors,
}: {
  courses?: GradeGraphCourse[];
  assignments?: GradeGraphAssignment[];
  connected?: boolean;
  colors?: ThemeColors;
}) {
  const built = connected ? buildChartData(courses, assignments) : null;
  const data = built?.data ?? PLACEHOLDER_DATA;
  const courseKeys = built?.courseKeys ?? PLACEHOLDER_COURSES;

  // The plot must stay dark enough for the vivid line colours (esp. the sky-blue
  // course line) to read — a bright panel would swallow them. So in light
  // (periwinkle) mode the chart is an intentional SOLID deep-indigo card that sits a
  // touch darker than the royal ground, with a light hairline so it still lifts off
  // the blue. Dark mode keeps its default card.
  const light = colors?.scheme === "light";
  const cardOverride = light
    ? { backgroundColor: "#1B2036", borderColor: "rgba(255,255,255,0.12)" }
    : null;

  return (
    <View>
      <View style={styles.header}>
        <Text style={[styles.headerLabel, colors && { color: colors.textDim }]}>Grade Trends</Text>
        {!connected && <Text style={[styles.headerNote, colors && { color: colors.textTertiary }]}>placeholder · connect LMS</Text>}
      </View>

      <View style={[styles.card, cardOverride]}>
        <GradeChart data={data} courseKeys={courseKeys} />
      </View>
    </View>
  );
}

// ── styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  header:      { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginBottom: 14 },
  headerLabel: { fontWeight: "400", fontSize: 11, color: C.textDim, letterSpacing: 0.2, },
  headerNote:  { fontWeight: "400", fontSize: 11, color: "rgba(255,255,255,0.2)" },

  card: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 16, paddingTop: 16, paddingRight: 8, paddingBottom: 8, paddingLeft: 0, overflow: "hidden" },

  tooltip:     { minHeight: 34, paddingHorizontal: 16, paddingTop: 6, justifyContent: "center" },
  tooltipLabel:{ fontWeight: "600", fontSize: 11, color: C.textPrimary, marginBottom: 4 },
  tooltipRows: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tooltipRow:  { fontWeight: "400", fontSize: 11 },
  tooltipHint: { fontWeight: "400", fontSize: 11, color: C.textDim },

  legend:       { flexDirection: "row", flexWrap: "wrap", gap: 10, paddingTop: 8, paddingBottom: 4, paddingHorizontal: 16, marginTop: 4, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.04)" },
  legendItem:   { flexDirection: "row", alignItems: "center", gap: 5 },
  legendSwatch: { width: 16, height: 2, borderRadius: 1 },
  legendText:   { fontWeight: "400", fontSize: 10, color: "rgba(255,255,255,0.35)" },
  legendTextGpa:{ fontWeight: "400", fontSize: 10, color: "rgba(90,165,116,0.7)" },
});

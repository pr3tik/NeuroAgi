// GradeGraph.jsx — Grade-over-time line chart using recharts.
// One muted line per course + one teal GPA line.
// After the last real data point, a dotted projection continues to end of semester.
// Falls back to placeholder data when Canvas is not connected.

import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from "recharts";

// ── Palette ──────────────────────────────────────────────────────────────────
export const COURSE_COLORS = [
  "rgba(100,180,255,0.85)",  // sky blue
  "rgba(100,215,130,0.85)",  // sage green
  "rgba(255,185,60,0.85)",   // amber
  "rgba(190,140,255,0.85)",  // lavender
  "rgba(255,105,100,0.85)",  // coral
  "rgba(60,220,200,0.75)",   // mint
  "rgba(255,145,180,0.85)",  // rose
  "rgba(var(--gold-bright-rgb), 0.85)",   // gold
];
const GPA_COLOR = "rgba(var(--teal-rgb), 0.85)"; // teal highlight

// ── Placeholder data (shown when Canvas is not connected) ────────────────────
const PLACEHOLDER_COURSES = ["PSYC 302", "CS 355", "BUS 410", "MATH 241"];
const PLACEHOLDER_DATA = [
  { label: "Sep 8",  real: true,  "PSYC 302": 88, "CS 355": 80, "BUS 410": 92, "MATH 241": 74, GPA: 83.5 },
  { label: "Sep 22", real: true,  "PSYC 302": 84, "CS 355": 76, "BUS 410": 89, "MATH 241": 70, GPA: 79.8 },
  { label: "Oct 6",  real: true,  "PSYC 302": 87, "CS 355": 79, "BUS 410": 91, "MATH 241": 73, GPA: 82.5 },
  { label: "Oct 20", real: true,  "PSYC 302": 90, "CS 355": 82, "BUS 410": 93, "MATH 241": 71, GPA: 84.0,
                                  "PSYC 302_proj": 90, "CS 355_proj": 82, "BUS 410_proj": 93, "MATH 241_proj": 71, "GPA_proj": 84.0 },
  { label: "Nov 3",  real: false, "PSYC 302_proj": 91, "CS 355_proj": 83, "BUS 410_proj": 94, "MATH 241_proj": 72, "GPA_proj": 85.0 },
  { label: "Nov 17", real: false, "PSYC 302_proj": 92, "CS 355_proj": 84, "BUS 410_proj": 95, "MATH 241_proj": 73, "GPA_proj": 86.0 },
];

// ── Data builder from live Canvas data ──────────────────────────────────────

function buildChartData(courses, assignments) {
  if (!courses.length || !assignments.length) return null;

  // Filter graded assignments with a valid dueAt
  const graded = assignments.filter(
    a => a.dueAt && a.pointsPossible > 0 && a.submission?.score != null
  );
  if (!graded.length) return null;

  // Sort by date
  graded.sort((a, b) => +new Date(a.dueAt) - +new Date(b.dueAt));

  const minDate = new Date(graded[0].dueAt);
  const maxDate = new Date(graded[graded.length - 1].dueAt);
  // Future boundary: latest due_at in all assignments (graded or not)
  const allDueDates = assignments.filter(a => a.dueAt).map(a => new Date(a.dueAt));
  const endDate = allDueDates.length ? new Date(Math.max(...allDueDates)) : maxDate;

  // Build bi-weekly bucket labels from minDate to endDate
  const buckets = [];
  const cur = new Date(minDate);
  while (cur <= endDate) {
    buckets.push(new Date(cur));
    cur.setDate(cur.getDate() + 14);
  }
  if (!buckets.length) return null;

  const fmt = d => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const courseKeys = courses.map(c => c.courseCode).filter(Boolean);

  const lastRealIdx = buckets.findIndex(b => {
    const next = new Date(b.getTime() + 14 * 86400000);
    return next > maxDate;
  });
  const splitIdx = lastRealIdx === -1 ? buckets.length - 1 : lastRealIdx;

  // Running average per course per bucket
  const data = buckets.map((bucketStart, idx) => {
    const bucketEnd = new Date(bucketStart.getTime() + 14 * 86400000);
    const isReal = idx <= splitIdx;
    const point = { label: fmt(bucketStart), real: isReal };

    const allScores = [];
    for (const course of courses) {
      const bucket = graded.filter(a =>
        a.courseId === course.id &&
        new Date(a.dueAt) >= bucketStart &&
        new Date(a.dueAt) < bucketEnd
      );
      if (bucket.length) {
        const avg = bucket.reduce((s, a) => s + (a.submission.score / a.pointsPossible) * 100, 0) / bucket.length;
        const rounded = Math.round(avg);
        const key = isReal ? course.courseCode : `${course.courseCode}_proj`;
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
    let lastRealIdx = -1;
    let lastVal = null;
    for (let j = splitIdx; j >= 0; j--) {
      if (data[j][course.courseCode] != null) {
        lastRealIdx = j;
        lastVal = data[j][course.courseCode];
        break;
      }
    }
    if (lastVal == null || lastRealIdx === -1) continue;
    data[lastRealIdx][`${course.courseCode}_proj`] = lastVal;
    for (let i = lastRealIdx + 1; i < data.length; i++) {
      data[i][`${course.courseCode}_proj`] = Math.min(100, Math.round(lastVal + (i - lastRealIdx) * 0.5));
    }
  }

  let lastGpaIdx = -1;
  let lastGpa = null;
  for (let j = splitIdx; j >= 0; j--) {
    if (data[j]["GPA"] != null) { lastGpaIdx = j; lastGpa = data[j]["GPA"]; break; }
  }
  if (lastGpa != null && lastGpaIdx !== -1) {
    data[lastGpaIdx]["GPA_proj"] = lastGpa;
    for (let i = lastGpaIdx + 1; i < data.length; i++) {
      data[i]["GPA_proj"] = Math.min(100, Math.round(lastGpa + (i - lastGpaIdx) * 0.5));
    }
  }

  return { data, courseKeys };
}

// ── Custom tooltip ───────────────────────────────────────────────────────────

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: "rgba(16,16,16,0.95)",
      border: "1px solid rgba(255,255,255,0.1)",
      borderRadius: "10px",
      padding: "10px 14px",
      fontSize: "12px",
      color: "var(--text-secondary)",
    }}>
      <p style={{ color: "var(--text-primary)", fontWeight: "600", marginBottom: "6px" }}>{label}</p>
      {payload.map(e => (
        <p key={e.dataKey} style={{ color: e.stroke, marginBottom: "2px" }}>
          {e.dataKey.replace("_proj", " (projected)")} — {e.value}%
        </p>
      ))}
    </div>
  );
}

// ── Component ────────────────────────────────────────────────────────────────

export default function GradeGraph({ courses = [], assignments = [], connected = false }) {
  const built = connected ? buildChartData(courses, assignments) : null;
  const data = built?.data ?? PLACEHOLDER_DATA;
  const courseKeys = built?.courseKeys ?? PLACEHOLDER_COURSES;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "14px" }}>
        <p style={{ fontSize: "11px", color: "var(--text-dim)", letterSpacing: "2px", textTransform: "uppercase" }}>
          Grade Trends
        </p>
        {!connected && (
          <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.2)" }}>placeholder · connect Canvas</span>
        )}
      </div>

      <div style={{
        background: "var(--color-surface)",
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-card)",
        padding: "16px 8px 8px 0",
      }}>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={data} margin={{ top: 4, right: 16, left: -24, bottom: 0 }}>
            <CartesianGrid stroke="rgba(255,255,255,0.04)" strokeDasharray="0" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fill: "rgba(255,255,255,0.25)", fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              domain={[50, 100]}
              tick={{ fill: "rgba(255,255,255,0.25)", fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={v => `${v}%`}
            />
            <Tooltip content={<CustomTooltip />} />

            {/* Per-course real lines */}
            {courseKeys.map((code, i) => (
              <Line
                key={code}
                type="monotone"
                dataKey={code}
                stroke={COURSE_COLORS[i % COURSE_COLORS.length]}
                strokeWidth={1.5}
                dot={false}
                activeDot={{ r: 3, fill: COURSE_COLORS[i % COURSE_COLORS.length] }}
                connectNulls
              />
            ))}

            {/* Per-course projection lines (dotted) */}
            {courseKeys.map((code, i) => (
              <Line
                key={`${code}_proj`}
                type="monotone"
                dataKey={`${code}_proj`}
                stroke={COURSE_COLORS[i % COURSE_COLORS.length]}
                strokeWidth={1.5}
                strokeDasharray="4 4"
                dot={false}
                activeDot={false}
                connectNulls
              />
            ))}

            {/* GPA real line (teal) */}
            <Line
              type="monotone"
              dataKey="GPA"
              stroke={GPA_COLOR}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, fill: GPA_COLOR }}
              connectNulls
            />

            {/* GPA projection (teal dotted) */}
            <Line
              type="monotone"
              dataKey="GPA_proj"
              stroke={GPA_COLOR}
              strokeWidth={2}
              strokeDasharray="4 4"
              dot={false}
              activeDot={false}
              connectNulls
            />
          </LineChart>
        </ResponsiveContainer>

        {/* Legend */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "10px 16px", padding: "8px 16px 4px", borderTop: "1px solid rgba(255,255,255,0.04)" }}>
          {courseKeys.map((code, i) => (
            <div key={code} style={{ display: "flex", alignItems: "center", gap: "5px" }}>
              <div style={{ width: 16, height: 2, background: COURSE_COLORS[i % COURSE_COLORS.length], borderRadius: 1 }} />
              <span style={{ fontSize: "10px", color: "rgba(255,255,255,0.35)" }}>{code}</span>
            </div>
          ))}
          <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
            <div style={{ width: 16, height: 2, background: GPA_COLOR, borderRadius: 1 }} />
            <span style={{ fontSize: "10px", color: "rgba(var(--teal-rgb), 0.7)" }}>Overall GPA</span>
          </div>
        </div>
      </div>
    </div>
  );
}

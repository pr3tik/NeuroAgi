// work.tsx — Home screen. Mirrors the mobile (isMobile) branch of src/pages/Work.tsx
// exactly: greeting, search, DailyBriefing, hero card, GPA/streak stat cards,
// upcoming assignments, recent activity. Radial-gradient card backgrounds are
// rendered with react-native-svg to match the web's CSS radial-gradients.

import { useState, useEffect } from "react";
import {
  View, Text, ScrollView, TextInput, TouchableOpacity,
  StyleSheet, useWindowDimensions,
} from "react-native";
import Svg, { Defs, RadialGradient, Rect, Stop } from "react-native-svg";
import { Search, FileText, Flame, ArrowRight } from "lucide-react-native";
import ScreenWrapper from "../components/ScreenWrapper";
import { supabase } from "../services/supabase";

// TODO: replace with the real signed-in user once identity.tsx (mobile login)
// is built. This is Sarim Khan's real TMU account — same Supabase project,
// so its courses/assignments are reachable here too.
const TEST_USER_ID = "26179287-a074-44cf-94a1-c57a8c70cb51";

const MS_HOUR = 3_600_000;

// ── helpers (mirrors src/pages/Work.tsx + src/lib/gpa.ts) ─────────────────────

function formatDue(dateStr: string | null) {
  if (!dateStr) return null;
  const due = new Date(dateStr);
  const diffDays = Math.ceil((+due - Date.now()) / 86_400_000);
  if (diffDays < 0)  return { label: "Overdue",   urgent: true };
  if (diffDays === 0) return { label: "Due today", urgent: true };
  if (diffDays === 1) return { label: "Tomorrow",  urgent: true };
  if (diffDays <= 7)
    return { label: due.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }), urgent: false };
  return { label: due.toLocaleDateString("en-US", { month: "short", day: "numeric" }), urgent: false };
}

function formatRelativeTime(dateStr: string) {
  const mins = Math.floor((Date.now() - +new Date(dateStr)) / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "Yesterday" : `${days}d ago`;
}

// Mirrors src/lib/gpa.ts — percentage→4.0 ladder + course-average fallback.
function scoreToGpa(pct: number): number {
  if (pct >= 90) return 4.0;
  if (pct >= 85) return 3.7;
  if (pct >= 80) return 3.3;
  if (pct >= 75) return 3.0;
  if (pct >= 70) return 2.7;
  if (pct >= 65) return 2.3;
  if (pct >= 60) return 2.0;
  return 1.0;
}

function coursesToGpa(courses: any[] | null | undefined): number | null {
  if (!courses?.length) return null;
  const scored = courses.filter(c => c?.currentScore != null || c?.finalScore != null);
  if (!scored.length) return null;
  const avg = scored.reduce((s, c) => s + (c.currentScore ?? c.finalScore), 0) / scored.length;
  return scoreToGpa(avg);
}

// ── radial-gradient card backgrounds (matches web CSS radial-gradients) ───────
//
// "card": radial-gradient(90.05% 130.96% at 9.95% 57.96%,
//           rgba(35,35,36,.6) 17.31%, rgba(74,74,75,.6) 38.94%,
//           rgba(117,117,118,.6) 57.52%, rgba(25,25,25,.6) 99.04%)
//         + linear-gradient(0deg, rgba(0,0,0,.2), rgba(0,0,0,.2)) overlay
// "row":  radial-gradient(77.21% 312.57% at 97.81% 50.56%,
//           rgba(25,25,25,.75) 27.4%, rgba(52,53,53,.75) 41.13%,
//           rgba(106,107,107,.75) 50.44%, rgba(163,166,166,.75) 64.56%,
//           rgba(69,70,70,.75) 80.31%, rgba(27,27,27,.75) 100%)

function RadialBg({ variant }: { variant: "card" | "row" }) {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width="100%" height="100%">
        <Defs>
          {variant === "card" ? (
            <RadialGradient id="radialCard" cx="9.95%" cy="57.96%" rx="90.05%" ry="130.96%" fx="9.95%" fy="57.96%">
              <Stop offset="17.31%" stopColor="#232324" stopOpacity={0.6} />
              <Stop offset="38.94%" stopColor="#4A4A4B" stopOpacity={0.6} />
              <Stop offset="57.52%" stopColor="#757576" stopOpacity={0.6} />
              <Stop offset="99.04%" stopColor="#191919" stopOpacity={0.6} />
            </RadialGradient>
          ) : (
            <RadialGradient id="radialRow" cx="97.81%" cy="50.56%" rx="77.21%" ry="312.57%" fx="97.81%" fy="50.56%">
              <Stop offset="27.4%"  stopColor="#191919" stopOpacity={0.75} />
              <Stop offset="41.13%" stopColor="#343535" stopOpacity={0.75} />
              <Stop offset="50.44%" stopColor="#6A6B6B" stopOpacity={0.75} />
              <Stop offset="64.56%" stopColor="#A3A6A6" stopOpacity={0.75} />
              <Stop offset="80.31%" stopColor="#454646" stopOpacity={0.75} />
              <Stop offset="100%"   stopColor="#1B1B1B" stopOpacity={0.75} />
            </RadialGradient>
          )}
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={variant === "card" ? "url(#radialCard)" : "url(#radialRow)"} />
        {variant === "card" && (
          <Rect x="0" y="0" width="100%" height="100%" fill="#000000" fillOpacity={0.2} />
        )}
      </Svg>
    </View>
  );
}

// ── DailyBriefing (mobile branch of src/components/DailyBriefing.tsx) ─────────
// Client-pure: computed entirely from courses + assignments, no API calls.

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
  if (h < 0)  return "overdue";
  if (h < 1)  return "due < 1h";
  if (h < 24) return `due in ${Math.round(h)}h`;
  if (h < 48) return "due tomorrow";
  return "due " + new Date(dueAt).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function DailyBriefing({ courses, assignments }: { courses: any[]; assignments: any[] }) {
  if (!courses.length && !assignments.length) return null;

  const now       = Date.now();
  const courseMap = new Map<string, any>(courses.map((c: any) => [String(c.id), c]));
  const pending   = assignments.filter(a =>
    !a.submission?.submittedAt && a.dueAt && courseMap.has(String(a.courseId))
  );

  const dateLabel = new Date().toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric",
  });

  const overdueCount  = pending.filter(a => new Date(a.dueAt).getTime() < now).length;
  const dueTodayCount = pending.filter(a => {
    const h = (new Date(a.dueAt).getTime() - now) / MS_HOUR;
    return h >= 0 && h < 24;
  }).length;
  const dueThisWeek   = pending.filter(a => {
    const h = (new Date(a.dueAt).getTime() - now) / MS_HOUR;
    return h >= 24 && h < 168;
  }).length;

  const sortedPending = [...pending].sort(
    (a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime()
  );
  const topItem = sortedPending[0];
  let topItemLabel = "";
  let topItemName  = "";
  if (topItem) {
    const h = (new Date(topItem.dueAt).getTime() - now) / MS_HOUR;
    topItemLabel = h < 0 ? "due now"
      : h < 1            ? "due in < 1h"
      : h < 24           ? `due in ${Math.round(h)}h`
      : `due in ${Math.round(h / 24)}d`;
    const raw: string = topItem.name ?? topItem.title ?? "Untitled";
    topItemName = raw.length > 32 ? raw.slice(0, 30) + "…" : raw;
  }

  const upcomingEvents = sortedPending
    .filter(a => new Date(a.dueAt).getTime() >= now && (!topItem || a.id !== topItem.id))
    .slice(0, 2);

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

  return (
    <View style={styles.dbCard}>
      <RadialBg variant="card" />

      {/* Header: label + date (left), readiness badge (right) */}
      <View style={styles.dbHeader}>
        <View style={{ gap: 4 }}>
          <Text style={styles.dbLabel}>DAILY BRIEFING</Text>
          <Text style={styles.dbDate}>{dateLabel}</Text>
        </View>
        <View style={[styles.dbBadge, { backgroundColor: badge.bg, borderColor: badge.border }]}>
          <Text style={[styles.dbBadgeText, { color: badge.color }]}>{badge.label}</Text>
        </View>
      </View>

      {/* Body — stacked columns on mobile */}
      <View style={{ gap: 14, alignItems: "flex-start" }}>

        {/* Summary counts + most urgent */}
        <View style={{ gap: 10, alignSelf: "stretch" }}>
          <Text style={[styles.dbStats, { color: allClear ? "rgba(200,197,203,0.5)" : "#E3E2E2" }]}>
            {allClear ? "Nothing due — you're all caught up." : statParts.length > 0 ? statParts.join("  ·  ") : "Nothing overdue today."}
          </Text>

          {dueThisWeek > 0 && (
            <Text style={styles.dbWeek}>
              <Text style={styles.dbDim}>This week  </Text>
              {dueThisWeek} due
            </Text>
          )}

          {topItem && (
            <Text style={styles.dbUrgent}>
              <Text style={styles.dbDim}>Most urgent</Text>
              {"  "}{topItemName}
              <Text style={styles.dbDim}> — {topItemLabel}</Text>
            </Text>
          )}
        </View>

        {/* Upcoming + focus today */}
        {(upcomingEvents.length > 0 || studyBlocks.length > 0) && (
          <View style={{ gap: 10, alignSelf: "stretch" }}>

            {upcomingEvents.length > 0 && (
              <View style={{ gap: 8 }}>
                <Text style={styles.dbDimLabel}>Upcoming</Text>
                {upcomingEvents.map((a: any) => {
                  const raw: string = a.name ?? a.title ?? "Untitled";
                  const nm = raw.length > 32 ? raw.slice(0, 30) + "…" : raw;
                  return (
                    <View key={String(a.id)} style={styles.dbEventRow}>
                      <Text style={styles.dbEventName} numberOfLines={1}>{nm}</Text>
                      <Text style={styles.dbEventTime}>{fmtDue(a.dueAt, now)}</Text>
                    </View>
                  );
                })}
              </View>
            )}

            {studyBlocks.length > 0 && (
              <View style={{ gap: 8 }}>
                <Text style={styles.dbDimLabel}>Focus today</Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  {studyBlocks.map(({ course, hours }, i) => (
                    <View
                      key={String(course.id)}
                      style={[styles.dbPill, { backgroundColor: i === 0 ? "rgba(200,197,203,0.5)" : "rgba(52,53,53,0.5)" }]}
                    >
                      <Text style={[
                        styles.dbPillText,
                        i === 0
                          ? { color: "#121414", fontFamily: "Inter_600SemiBold" }
                          : { color: "#C8C5CB", fontFamily: "Inter_400Regular" },
                      ]}>
                        {course.courseCode ?? course.name} · {hours}h →
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            )}
          </View>
        )}
      </View>
    </View>
  );
}

// ── sub-components ────────────────────────────────────────────────────────────

function AssignmentCard({ a }: { a: any }) {
  const due = formatDue(a.dueAt);
  const submitted = Boolean(a.submission?.submittedAt);
  const urgent = due?.urgent ?? false;

  // Mobile badge — urgent uses Figma red treatment (mirrors web mobileBadge)
  const badge = urgent
    ? { text: "URGENT",      bg: "rgba(255,180,171,0.05)", border: "rgba(255,180,171,0.3)", color: "#FFB4AB" }
    : submitted
    ? { text: "DONE",        bg: "rgba(52,199,89,0.05)",   border: "rgba(52,199,89,0.2)",   color: "rgba(52,199,89,0.9)" }
    : { text: "IN PROGRESS", bg: "rgba(52,53,53,0.3)",     border: "rgba(255,255,255,0.05)", color: "#C8C5CB" };

  return (
    <View style={styles.aCard}>
      <RadialBg variant="row" />
      <View style={styles.aCardLeft}>
        <View style={styles.aIcon}>
          <FileText size={16} color="rgba(200,197,203,0.5)" strokeWidth={1.5} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.aName} numberOfLines={1}>{a.name}</Text>
          <Text style={styles.aCourse}>{a.courseCode ?? a.courseName ?? ""}</Text>
        </View>
      </View>
      <View style={[styles.aBadge, { backgroundColor: badge.bg, borderColor: badge.border }]}>
        <Text style={[styles.aBadgeText, { color: badge.color }]}>{badge.text}</Text>
      </View>
    </View>
  );
}

function HeroCard({ assignment }: { assignment: any }) {
  const hoursLeft = assignment?.dueAt
    ? Math.ceil((+new Date(assignment.dueAt) - Date.now()) / MS_HOUR)
    : null;
  const course = assignment?.courseCode ?? assignment?.courseName ?? "";

  return (
    <View style={styles.heroCard}>
      <RadialBg variant="card" />

      {/* warm bloom (web: blurred circle top-right) */}
      <View style={styles.heroBloom} />

      <View style={{ gap: 16 }}>
        {/* badges */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {hoursLeft != null && (
            <View style={styles.heroBadge}>
              <Text style={styles.heroBadgeText}>
                DUE IN {hoursLeft > 0 ? `${hoursLeft}h` : "NOW"}
              </Text>
            </View>
          )}
          {course ? <Text style={styles.heroCourse}>{course}</Text> : null}
        </View>

        {/* title */}
        <Text style={styles.heroTitle}>{assignment?.name ?? ""}</Text>

        {/* CTA */}
        <TouchableOpacity style={styles.heroCTA} activeOpacity={0.85}>
          <Text style={styles.heroCTAText}>Continue Draft</Text>
          <ArrowRight size={12} color="#121414" strokeWidth={2} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

function EmptyState({ syncing, hasToken }: { syncing: boolean; hasToken: boolean }) {
  const [title, subtitle] = syncing
    ? ["Syncing Canvas…", "Fetching your assignments"]
    : !hasToken
    ? ["No Canvas connected", "Head to the Canvas page to connect your account and see your assignments here."]
    : ["You're all caught up", "No upcoming assignments"];

  return (
    <View style={styles.emptyCard}>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptySubtitle}>{subtitle}</Text>
    </View>
  );
}

// ── main screen ───────────────────────────────────────────────────────────────

export default function WorkScreen() {
  const { width } = useWindowDimensions();
  const hour = new Date().getHours();
  const greetingWord = hour < 12 ? "Morning" : hour < 18 ? "Afternoon" : "Evening";

  const [name, setName]               = useState("");
  const [gpa, setGpa]                 = useState<number | null>(null);
  const [streak, setStreak]           = useState(0);
  const [courses, setCourses]         = useState<any[]>([]);
  const [assignments, setAssignments] = useState<any[]>([]);
  const [syncStatus, setSyncStatus]   = useState<"idle" | "syncing">("syncing");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const [{ data: user }, { data: courseRows }, { data: rows }] = await Promise.all([
        supabase.from("users").select("name, gpa, streak").eq("id", TEST_USER_ID).maybeSingle(),
        supabase.from("courses")
          .select("id, name, course_code, current_score, final_score")
          .eq("user_id", TEST_USER_ID),
        supabase.from("assignments")
          .select("id, title, due_at, points_possible, score, submitted_at, late, missing, course_id, courses(name, course_code)")
          .eq("user_id", TEST_USER_ID),
      ]);
      if (cancelled) return;

      const mappedCourses = (courseRows ?? []).map((c: any) => ({
        id:           c.id,
        name:         c.name,
        courseCode:   c.course_code,
        currentScore: c.current_score,
        finalScore:   c.final_score,
      }));

      setName(user?.name ?? "");
      // Prefer the persisted users.gpa, fall back to computing from course scores
      // (mirrors src/pages/Work.tsx gpaRaw = userData?.gpa ?? coursesToGpa(courses)).
      setGpa(user?.gpa != null ? Number(user.gpa) : coursesToGpa(mappedCourses));
      setStreak(user?.streak ?? 0);
      setCourses(mappedCourses);
      setAssignments((rows ?? []).map((a: any) => ({
        id:         a.id,
        name:       a.title,
        dueAt:      a.due_at,
        courseId:   a.course_id,
        courseName: a.courses?.name,
        courseCode: a.courses?.course_code,
        submission: { score: a.score, submittedAt: a.submitted_at, late: a.late, missing: a.missing },
      })));
      setSyncStatus("idle");
    }

    // Best-effort: never let a network/DB failure crash the screen.
    load().catch(() => { if (!cancelled) setSyncStatus("idle"); });
    return () => { cancelled = true; };
  }, []);

  // Filter to upcoming unsubmitted assignments, sorted by due date (top 5)
  const upcoming = assignments
    .filter(a => {
      if (!a.dueAt) return false;
      return new Date(a.dueAt) > new Date() || !a.submission?.submittedAt;
    })
    .sort((a, b) => +new Date(a.dueAt) - +new Date(b.dueAt))
    .slice(0, 5);

  const hasToken  = assignments.length > 0;
  const heroFirst = upcoming[0] ?? null;
  const showHero  = Boolean(heroFirst);

  const subtitleText = syncStatus === "syncing"
    ? "Syncing your Canvas…"
    : upcoming.length > 0
    ? `${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric" })} · ${upcoming.length} assignment${upcoming.length !== 1 ? "s" : ""} coming up`
    : hasToken ? "You're all caught up" : "Connect Canvas to see assignments";

  // Recent activity: recent submissions (web also merges announcements — none on mobile yet)
  const activityItems = assignments
    .filter(a => a.submission?.submittedAt)
    .sort((a, b) => +new Date(b.submission.submittedAt) - +new Date(a.submission.submittedAt))
    .slice(0, 2)
    .map(a => ({ text: `Submitted: ${a.name}`, time: formatRelativeTime(a.submission.submittedAt), recent: true }))
    .slice(0, 3);
  const showActivity = activityItems.length > 0;

  // Web mobile greeting: clamp(32px, 8vw, 48px), line-height 1
  const greetingSize = Math.min(Math.max(width * 0.08, 32), 48);

  return (
    <ScreenWrapper page="work">
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 8 }}>

        {/* ── Greeting ── */}
        <View style={styles.greeting}>
          <Text style={[styles.greetingText, { fontSize: greetingSize, lineHeight: greetingSize }]}>
            {greetingWord},{" "}
            {name ? <Text style={styles.greetingName}>{name}.</Text> : <Text>.</Text>}
          </Text>
          <Text style={styles.subtitle}>{subtitleText}</Text>
        </View>

        {/* ── Search bar ── */}
        <View style={styles.searchBar}>
          <Search size={18} color="#C8C5CB" strokeWidth={2} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search curriculum, papers, notes..."
            placeholderTextColor="rgba(200,197,203,0.5)"
          />
        </View>

        {/* ── Daily briefing ── */}
        <View style={{ marginBottom: 20 }}>
          <DailyBriefing courses={courses} assignments={assignments} />
        </View>

        {/* ── Dashboard column ── */}
        <View style={{ gap: 24 }}>

          {/* Hero card */}
          {showHero && <HeroCard assignment={heroFirst} />}

          {/* Quick stats: GPA + Streak */}
          <View style={styles.statsRow}>
            {/* GPA card */}
            <View style={styles.statCardGpa}>
              <RadialBg variant="card" />
              <View style={{ alignItems: "center" }}>
                <Text style={styles.statValue}>{gpa != null ? Number(gpa).toFixed(2) : "—"}</Text>
                <Text style={styles.statLabel}>GPA</Text>
              </View>
            </View>
            {/* Streak card */}
            <View style={styles.statCardStreak}>
              <Flame size={16} color="#C49A3C" />
              <Text style={styles.statValue}>{streak ? `${streak}d` : "0d"}</Text>
            </View>
          </View>

          {/* Upcoming assignments */}
          <View style={{ gap: 16 }}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Upcoming Assignments</Text>
              <TouchableOpacity>
                <Text style={styles.viewAll}>View All</Text>
              </TouchableOpacity>
            </View>

            <View style={{ gap: 12 }}>
              {upcoming.length > 0
                ? upcoming.map((a, i) => <AssignmentCard key={a.id ?? i} a={a} />)
                : <EmptyState syncing={syncStatus === "syncing"} hasToken={hasToken} />
              }
            </View>
          </View>

          {/* Recent Activity */}
          {showActivity && (
            <View style={{ paddingHorizontal: 8 }}>
              <Text style={[styles.sectionTitle, { marginBottom: 16 }]}>Recent Activity</Text>
              <View style={{ gap: 2 }}>
                {activityItems.map((item, i) => (
                  <View key={i} style={styles.activityRow}>
                    <View style={[styles.activityDot, { backgroundColor: item.recent ? "#C8C5CB" : "#343535" }]} />
                    <Text
                      style={[styles.activityText, { color: item.recent ? "#E3E2E2" : "#C8C5CB" }]}
                      numberOfLines={1}
                    >
                      {item.text}
                    </Text>
                    <Text style={styles.activityTime}>{item.time}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

        </View>
      </ScrollView>
    </ScreenWrapper>
  );
}

// ── styles (values copied from the isMobile branch of src/pages/Work.tsx) ─────

const styles = StyleSheet.create({
  // Greeting
  greeting:      { alignItems: "center", marginBottom: 40 },
  greetingText:  { fontFamily: "FunnelDisplay_300Light", color: "#E3E2E2", letterSpacing: -1.8, textAlign: "center" },
  greetingName:  { fontFamily: "Fraunces_300Light_Italic", color: "#343535" },
  subtitle:      { fontFamily: "Inter_400Regular", fontSize: 16, lineHeight: 24, color: "#C8C5CB", opacity: 0.8, marginTop: 16, textAlign: "center" },

  // Search bar
  searchBar:     { flexDirection: "row", alignItems: "center", gap: 16, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 9999, backgroundColor: "rgba(255,255,255,0.05)", borderWidth: 1, borderColor: "rgba(255,255,255,0.05)", marginBottom: 56 },
  searchInput:   { flex: 1, minWidth: 0, fontFamily: "Inter_400Regular", fontSize: 14, color: "#E3E2E2", paddingVertical: 4 },

  // Daily briefing
  dbCard:        { borderRadius: 16, borderWidth: 1, borderColor: "rgba(255,255,255,0.08)", padding: 20, gap: 14, overflow: "hidden" },
  dbHeader:      { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  dbLabel:       { fontFamily: "Inter_400Regular", fontSize: 11, color: "rgba(200,197,203,0.5)", letterSpacing: 0.4 },
  dbDate:        { fontFamily: "Inter_400Regular", fontSize: 14, color: "#C8C5CB" },
  dbBadge:       { paddingHorizontal: 10, paddingVertical: 2, borderRadius: 9999, borderWidth: 1, marginTop: 2 },
  dbBadgeText:   { fontFamily: "Inter_400Regular", fontSize: 10 },
  dbStats:       { fontFamily: "Inter_400Regular", fontSize: 14, lineHeight: 18 },
  dbWeek:        { fontFamily: "Inter_400Regular", fontSize: 13, color: "#C8C5CB" },
  dbUrgent:      { fontFamily: "Inter_400Regular", fontSize: 12, color: "#C8C5CB" },
  dbDim:         { color: "rgba(200,197,203,0.4)" },
  dbDimLabel:    { fontFamily: "Inter_400Regular", fontSize: 12, color: "rgba(200,197,203,0.4)" },
  dbEventRow:    { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 },
  dbEventName:   { fontFamily: "Inter_400Regular", fontSize: 13, color: "#C8C5CB", flexShrink: 1 },
  dbEventTime:   { fontFamily: "Inter_400Regular", fontSize: 11, color: "rgba(200,197,203,0.4)" },
  dbPill:        { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 9999 },
  dbPillText:    { fontSize: 12 },

  // Hero card
  heroCard:      { borderRadius: 12, borderWidth: 1, borderColor: "rgba(255,255,255,0.08)", padding: 24, overflow: "hidden" },
  heroBloom:     { position: "absolute", top: -47, right: -47, width: 192, height: 192, borderRadius: 9999, backgroundColor: "rgba(200,197,203,0.05)" },
  heroBadge:     { paddingHorizontal: 8, paddingVertical: 2, backgroundColor: "rgba(200,197,203,0.1)", borderWidth: 1, borderColor: "rgba(200,197,203,0.2)", borderRadius: 9999 },
  heroBadgeText: { fontFamily: "Inter_600SemiBold", fontSize: 12, lineHeight: 16, letterSpacing: 0.6, color: "#C8C5CB" },
  heroCourse:    { fontFamily: "Inter_600SemiBold", fontSize: 12, lineHeight: 16, letterSpacing: 0.6, color: "rgba(210,197,177,0.6)", textTransform: "uppercase" },
  heroTitle:     { fontFamily: "Inter_600SemiBold", fontSize: 18, lineHeight: 22, letterSpacing: -0.18, color: "#E3E2E2", paddingBottom: 8 },
  heroCTA:       { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 44, paddingHorizontal: 24, borderRadius: 8, backgroundColor: "#C8C5CB", shadowColor: "#C8C5CB", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 20 },
  heroCTAText:   { fontFamily: "Inter_400Regular", fontSize: 14, lineHeight: 20, color: "#121414" },

  // Stats row
  statsRow:      { flexDirection: "row", gap: 12 },
  statCardGpa:   { flex: 1, height: 78, borderRadius: 30, borderWidth: 1, borderColor: "rgba(255,255,255,0.08)", alignItems: "center", justifyContent: "center", padding: 16, overflow: "hidden" },
  statCardStreak:{ flex: 1, height: 78, borderRadius: 30, borderWidth: 1, borderColor: "rgba(255,255,255,0.08)", backgroundColor: "rgba(113,104,104,0.12)", alignItems: "center", justifyContent: "center", padding: 16 },
  statValue:     { fontFamily: "DMSans_400Regular", fontSize: 18, lineHeight: 40, color: "#E3E2E2" },
  statLabel:     { fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 14, color: "rgba(200,197,203,0.5)" },

  // Section headers
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 8 },
  sectionTitle:  { fontFamily: "Inter_600SemiBold", fontSize: 18, lineHeight: 24, letterSpacing: -0.18, color: "#E3E2E2" },
  viewAll:       { fontFamily: "Inter_600SemiBold", fontSize: 12, lineHeight: 16, letterSpacing: 0.6, color: "#C8C5CB", textAlign: "center" },

  // Assignment card
  aCard:         { borderRadius: 12, borderWidth: 1, borderColor: "rgba(255,255,255,0.08)", padding: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 16, overflow: "hidden" },
  aCardLeft:     { flexDirection: "row", alignItems: "center", gap: 16, flex: 1, minWidth: 0 },
  aIcon:         { width: 40, height: 40, borderRadius: 8, backgroundColor: "#1F2020", borderWidth: 1, borderColor: "rgba(255,255,255,0.05)", alignItems: "center", justifyContent: "center", flexShrink: 0 },
  aName:         { fontFamily: "Inter_400Regular", fontSize: 14, lineHeight: 20, color: "#E3E2E2", marginBottom: 4, maxWidth: 140 },
  aCourse:       { fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 16, color: "#D2C5B1" },
  aBadge:        { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 9999, borderWidth: 1, flexShrink: 0 },
  aBadgeText:    { fontFamily: "Inter_400Regular", fontSize: 10, lineHeight: 15 },

  // Empty state
  emptyCard:     { borderRadius: 32, borderWidth: 1, borderColor: "rgba(255,255,255,0.08)", backgroundColor: "rgba(26,26,30,0.6)", padding: 32, alignItems: "center" },
  emptyTitle:    { fontFamily: "Inter_600SemiBold", fontSize: 18, color: "#E3E2E2", marginBottom: 8, textAlign: "center" },
  emptySubtitle: { fontFamily: "Inter_400Regular", fontSize: 14, color: "rgba(200,197,203,0.6)", textAlign: "center" },

  // Recent activity
  activityRow:   { flexDirection: "row", alignItems: "center", gap: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.04)" },
  activityDot:   { width: 8, height: 8, borderRadius: 9999, flexShrink: 0 },
  activityText:  { flex: 1, minWidth: 0, fontFamily: "Inter_400Regular", fontSize: 14 },
  activityTime:  { fontFamily: "Inter_400Regular", fontSize: 10, color: "rgba(200,197,203,0.4)", flexShrink: 0 },
});

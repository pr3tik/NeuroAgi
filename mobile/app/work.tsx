import { useState, useEffect } from "react";
import {
  View, Text, ScrollView, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Search, FileText, Flame } from "lucide-react-native";
import ScreenWrapper from "../components/ScreenWrapper";
import { supabase } from "../services/supabase";

// TODO: replace with the real signed-in user once identity.tsx (mobile login)
// is built. This is Sarim Khan's real TMU account — same Supabase project,
// so its courses/assignments are reachable here too.
const TEST_USER_ID = "26179287-a074-44cf-94a1-c57a8c70cb51";

// ── helpers ──────────────────────────────────────────────────────────────────

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

// ── sub-components ────────────────────────────────────────────────────────────

function AssignmentCard({ a }: { a: any }) {
  const due = formatDue(a.dueAt);
  const submitted = Boolean(a.submission?.submittedAt);
  const urgent = due?.urgent ?? false;

  const badge = urgent
    ? { text: "URGENT",      bg: "rgba(255,180,171,0.05)", border: "rgba(255,180,171,0.3)", color: "#FFB4AB" }
    : submitted
    ? { text: "DONE",        bg: "rgba(52,199,89,0.05)",   border: "rgba(52,199,89,0.2)",   color: "rgba(52,199,89,0.9)" }
    : { text: "IN PROGRESS", bg: "rgba(52,53,53,0.3)",     border: "rgba(255,255,255,0.05)", color: "#C8C5CB" };

  return (
    <View style={styles.aCard}>
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
  const hoursLeft = assignment
    ? Math.ceil((+new Date(assignment.dueAt) - Date.now()) / 3_600_000)
    : null;
  const course = assignment?.courseCode ?? assignment?.courseName ?? "";

  return (
    <LinearGradient
      colors={["rgba(74,74,75,0.8)", "rgba(35,35,36,0.9)", "rgba(25,25,25,0.95)"]}
      start={{ x: 0.1, y: 0.6 }}
      end={{ x: 1, y: 0.4 }}
      style={styles.heroCard}
    >
      {/* warm bloom */}
      <View style={styles.heroBloom} />

      <View style={{ position: "relative", zIndex: 1, gap: 16 }}>
        {/* badges */}
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
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
        <Text style={styles.heroTitle} numberOfLines={2}>
          {assignment?.name ?? "No upcoming assignments"}
        </Text>

        {/* CTA */}
        <TouchableOpacity style={styles.heroCTA}>
          <Text style={styles.heroCTAText}>Continue Draft  →</Text>
        </TouchableOpacity>
      </View>
    </LinearGradient>
  );
}

// ── main screen ───────────────────────────────────────────────────────────────

export default function WorkScreen() {
  const hour = new Date().getHours();
  const greetingWord = hour < 12 ? "Morning" : hour < 18 ? "Afternoon" : "Evening";

  const [name, setName]             = useState("");
  const [gpa, setGpa]                 = useState<string | null>(null);
  const [streak, setStreak]           = useState(0);
  const [assignments, setAssignments] = useState<any[]>([]);
  const announcements: any[] = [];
  const [syncStatus, setSyncStatus]   = useState<"idle" | "syncing">("syncing");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const [{ data: user }, { data: rows }] = await Promise.all([
        supabase.from("users").select("name, gpa, streak").eq("id", TEST_USER_ID).maybeSingle(),
        supabase.from("assignments")
          .select("id, title, due_at, points_possible, score, submitted_at, late, missing, courses(name, course_code)")
          .eq("user_id", TEST_USER_ID),
      ]);
      if (cancelled) return;

      setName(user?.name ?? "");
      setGpa(user?.gpa != null ? String(user.gpa) : null);
      setStreak(user?.streak ?? 0);
      setAssignments((rows ?? []).map((a: any) => ({
        id:          a.id,
        name:        a.title,
        dueAt:       a.due_at,
        courseName:  a.courses?.name,
        courseCode:  a.courses?.course_code,
        submission:  { score: a.score, submittedAt: a.submitted_at, late: a.late, missing: a.missing },
      })));
      setSyncStatus("idle");
    }

    load();
    return () => { cancelled = true; };
  }, []);

  const upcoming = assignments
    .filter(a => a.dueAt && (new Date(a.dueAt) > new Date() || !a.submission?.submittedAt))
    .sort((a, b) => +new Date(a.dueAt) - +new Date(b.dueAt))
    .slice(0, 5);

  const completedCount = assignments.filter(a => a.submission?.submittedAt).length;
  const heroFirst = upcoming[0] ?? null;

  const subtitleText = syncStatus === "syncing"
    ? "Syncing your data…"
    : upcoming.length > 0
    ? `${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric" })} · ${upcoming.length} assignment${upcoming.length !== 1 ? "s" : ""} coming up`
    : "You're all caught up";

  const recentActivity = assignments
    .filter(a => a.submission?.submittedAt)
    .sort((a, b) => +new Date(b.submission.submittedAt) - +new Date(a.submission.submittedAt))
    .slice(0, 3)
    .map(a => ({ text: `Submitted: ${a.name}`, time: formatRelativeTime(a.submission.submittedAt) }));

  return (
    <ScreenWrapper page="work">
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 24, paddingBottom: 8 }}>

        {/* ── Greeting ── */}
        <View style={styles.greeting}>
          <Text style={styles.greetingText}>
            {greetingWord},{" "}
            <Text style={styles.greetingName}>{name}.</Text>
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

        {/* ── Hero card ── */}
        <HeroCard assignment={heroFirst} />

        {/* ── Quick stats: GPA + Streak ── */}
        <View style={styles.statsRow}>
          <LinearGradient
            colors={["rgba(74,74,75,0.8)", "rgba(35,35,36,0.9)"]}
            style={styles.statCard}
          >
            <Text style={styles.statValue}>{gpa != null ? Number(gpa).toFixed(2) : "—"}</Text>
            <Text style={styles.statLabel}>GPA</Text>
          </LinearGradient>

          <View style={[styles.statCard, { backgroundColor: "rgba(113,104,104,0.12)" }]}>
            <Flame size={16} color="#C49A3C" />
            <Text style={styles.statValue}>{streak ? `${streak}d` : "0d"}</Text>
          </View>
        </View>

        {/* ── Upcoming assignments ── */}
        <View style={{ gap: 12 }}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Upcoming Assignments</Text>
            <TouchableOpacity>
              <Text style={styles.viewAll}>View All</Text>
            </TouchableOpacity>
          </View>

          {upcoming.length > 0 ? (
            upcoming.map((a, i) => <AssignmentCard key={a.id ?? i} a={a} />)
          ) : (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>
                {syncStatus === "syncing" ? "Syncing…" : "You're all caught up 🎉"}
              </Text>
              <Text style={styles.emptySubtitle}>
                {syncStatus === "syncing" ? "Fetching your assignments" : "No upcoming assignments"}
              </Text>
            </View>
          )}
        </View>

        {/* ── Recent Activity ── */}
        {recentActivity.length > 0 && (
          <View style={{ gap: 4 }}>
            <Text style={styles.sectionTitle}>Recent Activity</Text>
            {recentActivity.map((item, i) => (
              <View key={i} style={styles.activityRow}>
                <View style={styles.activityDot} />
                <Text style={styles.activityText} numberOfLines={1}>{item.text}</Text>
                <Text style={styles.activityTime}>{item.time}</Text>
              </View>
            ))}
          </View>
        )}

      </ScrollView>
    </ScreenWrapper>
  );
}

// ── styles ────────────────────────────────────────────────────────────────────

const GLASS = {
  borderRadius: 16,
  borderWidth: 1,
  borderColor: "rgba(255,255,255,0.08)",
} as const;

const styles = StyleSheet.create({
  greeting:       { alignItems: "center", marginBottom: 8 },
  greetingText:   { fontFamily: "FunnelDisplay_300Light", fontSize: 36, color: "#E3E2E2", letterSpacing: -1 },
  greetingName:   { fontFamily: "Fraunces_300Light_Italic", color: "#343535" },
  subtitle:       { fontFamily: "Inter_400Regular", fontSize: 14, color: "rgba(200,197,203,0.7)", marginTop: 8 },

  searchBar:      { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 9999, backgroundColor: "rgba(255,255,255,0.05)", borderWidth: 1, borderColor: "rgba(255,255,255,0.05)" },
  searchInput:    { flex: 1, fontFamily: "Inter_400Regular", fontSize: 14, color: "#E3E2E2" },

  heroCard:       { ...GLASS, padding: 24, overflow: "hidden", gap: 0 },
  heroBloom:      { position: "absolute", top: -47, right: -47, width: 192, height: 192, borderRadius: 9999, backgroundColor: "rgba(200,197,203,0.05)", zIndex: 0 },
  heroBadge:      { paddingHorizontal: 8, paddingVertical: 2, backgroundColor: "rgba(200,197,203,0.1)", borderWidth: 1, borderColor: "rgba(200,197,203,0.2)", borderRadius: 9999 },
  heroBadgeText:  { fontFamily: "Inter_600SemiBold", fontSize: 12, color: "#C8C5CB", letterSpacing: 0.6 },
  heroCourse:     { fontFamily: "Inter_600SemiBold", fontSize: 12, color: "rgba(210,197,177,0.6)", letterSpacing: 0.6, alignSelf: "center" },
  heroTitle:      { fontFamily: "Inter_600SemiBold", fontSize: 18, color: "#E3E2E2", lineHeight: 24, letterSpacing: -0.18 },
  heroCTA:        { backgroundColor: "#C8C5CB", borderRadius: 8, paddingVertical: 12, paddingHorizontal: 24, alignItems: "center", marginTop: 4 },
  heroCTAText:    { fontFamily: "Inter_400Regular", fontSize: 14, color: "#121414" },

  statsRow:       { flexDirection: "row", gap: 12 },
  statCard:       { flex: 1, height: 78, borderRadius: 30, borderWidth: 1, borderColor: "rgba(255,255,255,0.08)", alignItems: "center", justifyContent: "center", gap: 2 },
  statValue:      { fontFamily: "DMSans_400Regular", fontSize: 18, color: "#E3E2E2" },
  statLabel:      { fontFamily: "Inter_400Regular", fontSize: 12, color: "rgba(200,197,203,0.5)" },

  sectionHeader:  { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  sectionTitle:   { fontFamily: "Inter_600SemiBold", fontSize: 18, color: "#E3E2E2", letterSpacing: -0.18 },
  viewAll:        { fontFamily: "Inter_600SemiBold", fontSize: 12, color: "#C8C5CB" },

  aCard:          { ...GLASS, backgroundColor: "rgba(26,26,30,0.6)", padding: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 16 },
  aCardLeft:      { flexDirection: "row", alignItems: "center", gap: 16, flex: 1, minWidth: 0 },
  aIcon:          { width: 40, height: 40, borderRadius: 8, backgroundColor: "#1F2020", borderWidth: 1, borderColor: "rgba(255,255,255,0.05)", alignItems: "center", justifyContent: "center", flexShrink: 0 },
  aName:          { fontFamily: "Inter_400Regular", fontSize: 14, color: "#E3E2E2", marginBottom: 4 },
  aCourse:        { fontFamily: "Inter_400Regular", fontSize: 12, color: "#D2C5B1" },
  aBadge:         { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 9999, borderWidth: 1, flexShrink: 0 },
  aBadgeText:     { fontFamily: "Inter_400Regular", fontSize: 10 },

  emptyCard:      { ...GLASS, backgroundColor: "rgba(26,26,30,0.6)", padding: 32, alignItems: "center", gap: 4 },
  emptyTitle:     { fontFamily: "Inter_600SemiBold", fontSize: 18, color: "#E3E2E2" },
  emptySubtitle:  { fontFamily: "Inter_400Regular", fontSize: 14, color: "rgba(200,197,203,0.6)" },

  activityRow:    { flexDirection: "row", alignItems: "center", gap: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.04)" },
  activityDot:    { width: 8, height: 8, borderRadius: 4, backgroundColor: "#C8C5CB", flexShrink: 0 },
  activityText:   { fontFamily: "Inter_400Regular", flex: 1, fontSize: 14, color: "#E3E2E2" },
  activityTime:   { fontFamily: "Inter_400Regular", fontSize: 10, color: "rgba(200,197,203,0.4)" },
});

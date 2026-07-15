// identity.tsx — Student profile mirroring src/pages/Identity.tsx:
// editable name + school, 2×2 stat grid, course performance bars, token wallet
// with tier progress + recent events, Discord community, navigation preference.

import { useState, useEffect, useCallback } from "react";
import {
  View, Text, ScrollView, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator, Linking,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import {
  LogIn, RefreshCw, Layers, CircleDot, Sparkles, Check, Hexagon,
  ArrowUp, Star, ChevronUp, ChevronDown, ArrowUpRight,
} from "lucide-react-native";
import ScreenWrapper from "../components/ScreenWrapper";
import { supabase } from "../services/supabase";
import { useAuth } from "../context/AuthContext";
import GradeGraph, { GradeGraphCourse, GradeGraphAssignment } from "../components/GradeGraph";
import WritingTracker from "../components/WritingTracker";
import FriendsSection from "../components/FriendsSection";

const DISCORD_INVITE_URL = "https://discord.gg/SpFXzPZxBX";

// ── tokens.css palette ────────────────────────────────────────────────────────
const C = {
  textPrimary:   "#F5F5F5",
  textSecondary: "rgba(255,255,255,0.45)",
  textTertiary:  "rgba(255,255,255,0.25)",
  textDim:       "rgba(255,255,255,0.35)",
  surface:       "rgba(255,255,255,0.05)",
  border:        "rgba(255,255,255,0.08)",
  gold:          "#C49A3C",
  teal:          "rgba(0,210,190,0.95)",
};

// Keep in sync with src/components/GradeGraph.tsx
const COURSE_COLORS = [
  "rgba(100,180,255,0.85)",  // sky blue
  "rgba(100,215,130,0.85)",  // sage green
  "rgba(255,185,60,0.85)",   // amber
  "rgba(190,140,255,0.85)",  // lavender
  "rgba(255,105,100,0.85)",  // coral
  "rgba(60,220,200,0.75)",   // mint
  "rgba(255,145,180,0.85)",  // rose
  "rgba(255,215,80,0.85)",   // gold
];

const TOKEN_LABELS: Record<string, string> = {
  daily_login:          "Daily login",
  canvas_sync:          "Canvas synced",
  flashcards_generated: "Flashcards generated",
  quiz_completed:       "Quiz completed",
  quiz_perfect:         "Perfect score",
  assignment_submitted: "Assignment done",
  discord_connected:    "Discord connected",
  streak_day:           "Streak extended",
  streak_milestone:     "Streak milestone",
};

const TOKEN_ICONS: Record<string, any> = {
  daily_login:          LogIn,
  canvas_sync:          RefreshCw,
  flashcards_generated: Layers,
  quiz_completed:       CircleDot,
  quiz_perfect:         Sparkles,
  assignment_submitted: Check,
  discord_connected:    Hexagon,
  streak_day:           ArrowUp,
  streak_milestone:     Star,
};

// Tier thresholds — keep in sync with api/token-engine.ts
const TIERS = [
  { name: "Basic",       min: 0    },
  { name: "Scholar",     min: 100  },
  { name: "Mastermind",  min: 500  },
  { name: "Brain Owner", min: 2000 },
];

function getTier(points: number) {
  let curr = TIERS[0];
  for (let i = TIERS.length - 1; i >= 0; i--) {
    if (points >= TIERS[i].min) { curr = TIERS[i]; break; }
  }
  return curr;
}

function getNextTier(points: number) {
  for (const t of TIERS) {
    if (points < t.min) return t;
  }
  return null; // already at max
}

function tierProgressPct(points: number) {
  const curr = getTier(points);
  const next = TIERS[TIERS.indexOf(curr) + 1];
  if (!next) return 100;
  return Math.min(100, Math.round(((points - curr.min) / (next.min - curr.min)) * 100));
}

function fmtAgo(iso: string | null) {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

// Mirrors src/lib/gpa.ts — fallback when users.gpa was never persisted.
function scoreToGpa(pct: number) {
  if (pct >= 90) return 4.0;
  if (pct >= 85) return 3.7;
  if (pct >= 80) return 3.3;
  if (pct >= 75) return 3.0;
  if (pct >= 70) return 2.7;
  if (pct >= 65) return 2.3;
  if (pct >= 60) return 2.0;
  return 1.0;
}

function coursesToGpa(courses: CoursePerf[]) {
  const scored = courses.filter(c => c.pct != null);
  if (!scored.length) return null;
  const avg = scored.reduce((s, c) => s + (c.pct as number), 0) / scored.length;
  return scoreToGpa(avg);
}

type CoursePerf = { name: string; code: string | null; pct: number | null };
type TokenEvent = { action: string; tokens: number; created_at: string };

// ── sub-components ────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: string }) {
  return <Text style={styles.sectionLabel}>{children}</Text>;
}

function TokenEventRow({ e, last }: { e: TokenEvent; last: boolean }) {
  const Ic = TOKEN_ICONS[e.action];
  return (
    <View style={[styles.eventRow, !last && styles.eventRowBorder]}>
      <View style={styles.eventIcon}>
        {Ic ? <Ic size={13} color="rgba(196,154,60,0.6)" /> : <Text style={{ color: "rgba(196,154,60,0.6)" }}>·</Text>}
      </View>
      <Text style={styles.eventLabel}>{TOKEN_LABELS[e.action] ?? e.action}</Text>
      <Text style={styles.eventTokens}>+{e.tokens}</Text>
      <Text style={styles.eventTime}>{fmtAgo(e.created_at)}</Text>
    </View>
  );
}

// ── main screen ───────────────────────────────────────────────────────────────

export default function IdentityScreen() {
  const { userId, signOut } = useAuth();
  const router = useRouter();
  const [loading, setLoading]   = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [user, setUser]         = useState<any>(null);
  const [coursePerf, setCoursePerf] = useState<CoursePerf[]>([]);
  const [doneCount, setDoneCount]   = useState(0);
  const [graphCourses, setGraphCourses]         = useState<GradeGraphCourse[]>([]);
  const [graphAssignments, setGraphAssignments] = useState<GradeGraphAssignment[]>([]);
  const [tokenSummary, setTokenSummary] = useState<{
    points: number; tier: string; todayEarned: number; recentEvents: TokenEvent[];
  } | null>(null);
  const [tokenExpanded, setTokenExpanded] = useState(false);

  // Editable name — local only until mobile auth exists.
  const [name, setName]               = useState("");
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput]     = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const todayStr = new Date().toISOString().slice(0, 10);
        const [
          { data: u, error: uErr },
          { data: courseRows },
          { count: submittedCount },
          { data: todayRows },
          { data: recent },
          { data: fullAssignmentRows },
        ] = await Promise.all([
          // Base columns only — guaranteed to exist per supabase-schema.sql.
          // school_city/school_country/points/discord_user_id come from
          // separate, later migrations that may not be applied to this DB
          // yet; Postgrest fails the WHOLE query if any selected column is
          // missing, so those are fetched separately below and degrade
          // gracefully instead of blocking the whole profile screen.
          supabase.from("users")
            .select("name, school, gpa, streak, study_time")
            .eq("id", userId).maybeSingle(),
          supabase.from("courses")
            .select("id, name, course_code, current_score, final_score")
            .eq("user_id", userId),
          supabase.from("assignments")
            .select("id", { count: "exact", head: true })
            .eq("user_id", userId).not("submitted_at", "is", null),
          supabase.from("token_events")
            .select("tokens").eq("user_id", userId).eq("awarded_on", todayStr),
          supabase.from("token_events")
            .select("action, tokens, created_at")
            .eq("user_id", userId).order("created_at", { ascending: false }).limit(10),
          // GradeGraph needs full rows (course_id/due_at/points_possible/score),
          // not just the summary fields the rest of this screen uses.
          supabase.from("assignments")
            .select("id, course_id, due_at, points_possible, score")
            .eq("user_id", userId),
        ]);
        if (cancelled) return;
        if (uErr) { setLoadError(true); setLoading(false); return; }

        // Best-effort enhanced fields — silently absent if their migration
        // (supabase-users-school-columns-migration.sql / the discord_user_id
        // column) hasn't been run against this database yet.
        let enhanced: { school_city?: string; school_country?: string; points?: number; discord_user_id?: string } = {};
        try {
          const { data: e } = await supabase.from("users")
            .select("school_city, school_country, points, discord_user_id")
            .eq("id", userId).maybeSingle();
          if (e) enhanced = e;
        } catch {}

        const merged = { ...u, ...enhanced };
        setUser(merged);
        setName(u?.name ?? "");
        setCoursePerf((courseRows ?? []).map((c: any) => ({
          name: c.name,
          code: c.course_code,
          pct:  c.current_score ?? c.final_score ?? null,
        })));
        setDoneCount(submittedCount ?? 0);
        setGraphCourses((courseRows ?? []).map((c: any) => ({ id: c.id, courseCode: c.course_code })));
        setGraphAssignments((fullAssignmentRows ?? []).map((a: any) => ({
          courseId:       a.course_id,
          dueAt:          a.due_at,
          pointsPossible: a.points_possible,
          submission:     { score: a.score },
        })));

        // Mirrors api/token-engine.ts ?action=summary, read directly from Supabase.
        const points = enhanced.points ?? 0;
        setTokenSummary({
          points,
          tier:         getTier(points).name,
          todayEarned:  (todayRows ?? []).reduce((s: number, e: any) => s + (e.tokens ?? 0), 0),
          recentEvents: (recent ?? []) as TokenEvent[],
        });
      } catch {
        if (!cancelled) setLoadError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [userId]);

  const commitName = useCallback(() => {
    setEditingName(false);
    const trimmed = nameInput.trim();
    if (!trimmed || trimmed === name) return;
    setName(trimmed); // optimistic — matches this screen's other best-effort writes
    supabase.from("users").update({ name: trimmed }).eq("id", userId).then(({ error }) => {
      if (error) setName(name); // revert on failure
    });
  }, [nameInput, name, userId]);

  // Stack.Protected already redirects to /login the instant status flips to
  // "guest" (see app/_layout.tsx) — the explicit replace() just avoids a beat
  // of stale content on this screen while that re-render lands.
  function handleSignOut() {
    signOut().then(() => router.replace("/login"));
  }

  function handleConnectDiscord() {
    // TODO: Discord OAuth needs the web /api/discord?action=login flow + a
    // mobile redirect URI — not available yet.
  }

  const gpaVal    = user?.gpa ?? coursesToGpa(coursePerf);
  const gpa       = gpaVal != null ? Number(gpaVal).toFixed(2) : "—";
  const streak    = `${user?.streak ?? 0}d`;
  const studyTime = `${user?.study_time ?? 0}h`;

  const STATS = [
    { label: "GPA",         value: gpa },
    { label: "Assignments", value: doneCount ? String(doneCount) : "—" },
    { label: "Streak",      value: streak },
    { label: "Study Time",  value: studyTime },
  ];

  const school = [user?.school, user?.school_city, user?.school_country].filter(Boolean).join(" · ");
  const nextTier = tokenSummary ? getNextTier(tokenSummary.points) : null;
  const events = tokenSummary?.recentEvents ?? [];
  const shownEvents = tokenExpanded ? events : events.slice(0, 5);

  if (loading) {
    return (
      <ScreenWrapper page="identity">
        <View style={styles.center}>
          <ActivityIndicator color="rgba(255,255,255,0.4)" />
        </View>
      </ScreenWrapper>
    );
  }

  if (loadError || !user) {
    return (
      <ScreenWrapper page="identity">
        <View style={styles.center}>
          <Text style={styles.emptyTitle}>Couldn't load profile</Text>
          <Text style={styles.emptySubtitle}>Check your connection and try again.</Text>
        </View>
      </ScreenWrapper>
    );
  }

  return (
    <ScreenWrapper page="identity">
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 8 }}>

        {/* ── Header: name + sign out ── */}
        <View style={styles.header}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <SectionLabel>Identity</SectionLabel>
            {editingName ? (
              <TextInput
                autoFocus
                value={nameInput}
                onChangeText={setNameInput}
                onBlur={commitName}
                onSubmitEditing={commitName}
                returnKeyType="done"
                style={styles.nameInput}
              />
            ) : (
              <TouchableOpacity onPress={() => { setNameInput(name); setEditingName(true); }} activeOpacity={0.7}>
                <Text style={styles.nameText}>{name || "Your Name"}</Text>
              </TouchableOpacity>
            )}
            {school ? <Text style={styles.schoolText}>{school}</Text> : null}
          </View>
          <TouchableOpacity style={styles.signOutBtn} onPress={handleSignOut} activeOpacity={0.7}>
            <Text style={styles.signOutText}>SIGN OUT</Text>
          </TouchableOpacity>
        </View>

        {/* ── 2×2 stat grid ── */}
        <View style={styles.statGrid}>
          {STATS.map(s => (
            <View key={s.label} style={styles.statCard}>
              <Text style={styles.statValue}>{s.value}</Text>
              <Text style={styles.statLabel}>{s.label}</Text>
            </View>
          ))}
        </View>

        {/* ── Grade trends chart ── */}
        <View style={{ marginBottom: 32 }}>
          <GradeGraph courses={graphCourses} assignments={graphAssignments} connected={coursePerf.length > 0} />
        </View>

        {/* ── Writing Evolution Tracker ── */}
        <View style={{ marginBottom: 32 }}>
          <WritingTracker />
        </View>

        {/* ── Course performance bars — only when courses exist ── */}
        {coursePerf.length > 0 && (
          <View style={{ marginBottom: 32 }}>
            <View style={{ marginBottom: 16 }}>
              <SectionLabel>Course Performance</SectionLabel>
            </View>
            <View style={{ gap: 16 }}>
              {coursePerf.map((c, i) => {
                const color = COURSE_COLORS[i % COURSE_COLORS.length];
                return (
                  <View key={c.code ?? c.name ?? i}>
                    <View style={styles.courseRow}>
                      <View style={{ flexDirection: "row", alignItems: "baseline", flex: 1, minWidth: 0 }}>
                        <Text style={styles.courseName} numberOfLines={1}>{c.name}</Text>
                        {c.code ? <Text style={styles.courseCode}>{c.code}</Text> : null}
                      </View>
                      <Text style={[styles.coursePct, { color }]}>
                        {c.pct != null ? `${Math.round(c.pct)}%` : "—"}
                      </Text>
                    </View>
                    <View style={styles.barTrack}>
                      <View style={[styles.barFill, { backgroundColor: color, width: `${c.pct ?? 0}%` }]} />
                    </View>
                  </View>
                );
              })}
            </View>
          </View>
        )}

        {/* ── Token wallet + activity ── */}
        {tokenSummary && (
          <View style={{ marginBottom: 32 }}>
            <View style={{ marginBottom: 12 }}>
              <SectionLabel>Tokens</SectionLabel>
            </View>

            {/* Summary card */}
            <View style={styles.tokenCard}>
              <View style={styles.tokenCardTop}>
                <View>
                  <Text style={styles.tokenPoints}>{tokenSummary.points}</Text>
                  <Text style={styles.tokenTier}>
                    {tokenSummary.tier}
                    {tokenSummary.todayEarned > 0 && (
                      <Text style={styles.tokenToday}>  +{tokenSummary.todayEarned} today</Text>
                    )}
                  </Text>
                </View>
                {nextTier && (
                  <Text style={styles.tokenNext}>
                    {nextTier.min - tokenSummary.points} to{"\n"}
                    <Text style={{ color: "rgba(196,154,60,0.7)" }}>{nextTier.name}</Text>
                  </Text>
                )}
              </View>
              {/* Tier progress bar */}
              <View style={styles.tierTrack}>
                <LinearGradient
                  colors={["#C49A3C", "rgba(196,154,60,0.6)"]}
                  start={{ x: 0, y: 0.5 }}
                  end={{ x: 1, y: 0.5 }}
                  style={[styles.tierFill, { width: `${tierProgressPct(tokenSummary.points)}%` }]}
                />
              </View>
            </View>

            {/* Recent events — capped at 5, expandable */}
            {events.length > 0 && (
              <>
                <View>
                  {shownEvents.map((e, i) => (
                    <TokenEventRow key={i} e={e} last={i === shownEvents.length - 1} />
                  ))}
                </View>
                {events.length > 5 && (
                  <TouchableOpacity
                    onPress={() => setTokenExpanded(v => !v)}
                    style={styles.expandBtn}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.expandText}>
                      {tokenExpanded ? "Show less" : `View all ${events.length}`}
                    </Text>
                    {tokenExpanded
                      ? <ChevronUp size={13} color={C.textDim} />
                      : <ChevronDown size={13} color={C.textDim} />}
                  </TouchableOpacity>
                )}
              </>
            )}
          </View>
        )}

        {/* ── Discord community ── */}
        <View style={{ marginBottom: 32 }}>
          <View style={{ marginBottom: 12 }}>
            <SectionLabel>Community</SectionLabel>
          </View>
          {user.discord_user_id ? (
            <View style={[styles.discordRow, { marginBottom: 8 }]}>
              <Hexagon size={20} color="rgba(88,101,242,0.55)" />
              <Text style={styles.discordConnectedText}>Discord connected</Text>
              <View style={{ marginLeft: "auto" }}>
                <Check size={15} color="rgba(52,199,89,0.8)" />
              </View>
            </View>
          ) : (
            <TouchableOpacity
              style={[styles.discordRow, { marginBottom: 8 }]}
              onPress={handleConnectDiscord}
              activeOpacity={0.7}
            >
              <Hexagon size={20} color="#5865F2" />
              <Text style={styles.discordConnectText}>Connect Discord</Text>
              <Text style={styles.discordBonus}>+5 tokens  →</Text>
            </TouchableOpacity>
          )}
          {/* Direct invite — always visible */}
          <TouchableOpacity
            style={styles.discordInvite}
            onPress={() => Linking.openURL(DISCORD_INVITE_URL).catch(() => {})}
            activeOpacity={0.7}
          >
            <Hexagon size={18} color="rgba(88,101,242,0.6)" />
            <Text style={styles.discordInviteText}>Join our Discord</Text>
            <View style={{ marginLeft: "auto" }}>
              <ArrowUpRight size={14} color="rgba(88,101,242,0.5)" />
            </View>
          </TouchableOpacity>
        </View>

        {/* ── Friends ── */}
        <FriendsSection userId={userId} ownName={name} />

        {/* ShareCard intentionally not ported here — it depends on html2canvas +
            navigator.share, both browser-only APIs with no direct RN equivalent
            (would need react-native-view-shot + the native Share API instead). */}

      </ScrollView>
    </ScreenWrapper>
  );
}

// ── styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 4 },

  sectionLabel: { fontFamily: "Inter_400Regular", fontSize: 11, color: C.textDim, letterSpacing: 2, textTransform: "uppercase" },

  header:      { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 24, gap: 12 },
  nameText:    { fontFamily: "Inter_600SemiBold", fontSize: 26, color: C.textPrimary, letterSpacing: -0.3, marginTop: 6 },
  nameInput:   { backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: "rgba(255,255,255,0.18)", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, color: C.textPrimary, fontFamily: "Inter_600SemiBold", fontSize: 22, letterSpacing: -0.3, width: 180, marginTop: 6 },
  schoolText:  { fontFamily: "Inter_400Regular", fontSize: 13, color: C.textSecondary, marginTop: 4 },
  signOutBtn:  { borderWidth: 1, borderColor: "rgba(255,255,255,0.12)", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  signOutText: { fontFamily: "Inter_400Regular", fontSize: 11, color: "rgba(255,255,255,0.35)", letterSpacing: 1.5 },

  statGrid:  { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 32 },
  statCard:  { flexBasis: "47%", flexGrow: 1, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 16, paddingVertical: 20, paddingHorizontal: 16 },
  statValue: { fontFamily: "Inter_600SemiBold", fontSize: 28, color: C.textPrimary, letterSpacing: -0.5, marginBottom: 4 },
  statLabel: { fontFamily: "Inter_400Regular", fontSize: 12, color: C.textSecondary },

  courseRow:  { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginBottom: 7, gap: 8 },
  courseName: { fontFamily: "Inter_500Medium", fontSize: 14, color: C.textPrimary, flexShrink: 1 },
  courseCode: { fontFamily: "Inter_400Regular", fontSize: 12, color: C.textTertiary, marginLeft: 8 },
  coursePct:  { fontFamily: "Inter_600SemiBold", fontSize: 13, flexShrink: 0 },
  barTrack:   { backgroundColor: "rgba(255,255,255,0.06)", borderRadius: 4, height: 4, overflow: "hidden" },
  barFill:    { height: "100%", borderRadius: 4 },

  tokenCard:    { backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 16, paddingVertical: 16, paddingHorizontal: 18, marginBottom: 10 },
  tokenCardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 },
  tokenPoints:  { fontFamily: "Inter_600SemiBold", fontSize: 28, color: C.gold, letterSpacing: -0.5, lineHeight: 30 },
  tokenTier:    { fontFamily: "Inter_400Regular", fontSize: 12, color: C.textSecondary, marginTop: 3 },
  tokenToday:   { color: "rgba(196,154,60,0.65)" },
  tokenNext:    { fontFamily: "Inter_400Regular", fontSize: 11, color: C.textDim, textAlign: "right", lineHeight: 15 },
  tierTrack:    { backgroundColor: "rgba(255,255,255,0.06)", borderRadius: 3, height: 3, overflow: "hidden" },
  tierFill:     { height: "100%", borderRadius: 3 },

  eventRow:       { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, paddingHorizontal: 4 },
  eventRowBorder: { borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.05)" },
  eventIcon:      { width: 16, alignItems: "center", flexShrink: 0 },
  eventLabel:     { fontFamily: "Inter_400Regular", fontSize: 13, color: C.textSecondary, flex: 1 },
  eventTokens:    { fontFamily: "Inter_700Bold", fontSize: 12, color: C.gold, flexShrink: 0 },
  eventTime:      { fontFamily: "Inter_400Regular", fontSize: 11, color: C.textDim, minWidth: 44, textAlign: "right", flexShrink: 0 },

  expandBtn:  { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 8, paddingVertical: 4 },
  expandText: { fontFamily: "Inter_400Regular", fontSize: 12, color: C.textDim, letterSpacing: 0.3 },

  discordRow:           { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14, paddingHorizontal: 16, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 16 },
  discordConnectedText: { fontFamily: "Inter_400Regular", fontSize: 13, color: C.textSecondary },
  discordConnectText:   { fontFamily: "Inter_500Medium", fontSize: 13, color: C.textPrimary },
  discordBonus:         { fontFamily: "Inter_400Regular", fontSize: 12, color: C.textDim, marginLeft: "auto" },
  discordInvite:        { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, paddingHorizontal: 16, borderWidth: 1, borderColor: "rgba(88,101,242,0.18)", borderRadius: 16 },
  discordInviteText:    { fontFamily: "Inter_400Regular", fontSize: 13, color: "rgba(166,176,255,0.75)" },


  emptyTitle:    { fontFamily: "Inter_600SemiBold", fontSize: 18, color: "#E3E2E2" },
  emptySubtitle: { fontFamily: "Inter_400Regular", fontSize: 14, color: "rgba(200,197,203,0.6)" },
});

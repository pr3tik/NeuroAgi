// work.tsx — Home screen. Proactive by design: Reggie greets on the nearest due
// item up top, a 2×2 quick-action grid deep-links to the things you'd open next,
// a search bar routes anything else into a Reggie chat, and personalized shelves
// (continue studying) sit below. Theme-driven: light mode renders the periwinkle
// glass look (see appTheme.LIGHT); dark stays as it was.

import { useState, useEffect, useMemo, useCallback } from "react";
import {
  View, Text, ScrollView, TextInput, TouchableOpacity,
  StyleSheet, useWindowDimensions,
} from "react-native";
import { ArrowRight, Layers, Mic, Users, ClipboardList } from "lucide-react-native";
import { useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import ScreenWrapper from "../components/ScreenWrapper";
import Glass from "../components/Glass";
import NeuralRing from "../components/NeuralRing";
import { isLightBg } from "../components/Glass";
import { useRefresh, ThemedRefreshControl } from "../components/States";
import { usePageTheme, ThemeColors } from "../constants/appTheme";
import { supabase } from "../services/supabase";
import { useUserId } from "../context/AuthContext";
import { LAST_STUDY_KEY } from "./study";

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

// ── Quick actions ─────────────────────────────────────────────────────────────
// A 2×2 grid of glass launch tiles under the greeting. Each tile deep-links
// straight to its destination — one tap to the thing you'd open next.

type QuickAction = {
  key: string; label: string; sub: string;
  Icon: typeof Layers; tint: string; soft: string; go: () => void;
};

function QuickActionTile({ C, styles, action }: { C: ThemeColors; styles: Styles; action: QuickAction }) {
  const { Icon, label, sub, tint, soft, go } = action;
  return (
    <Glass colors={C} radius={18} onPress={go} style={styles.quickTile}>
      <View style={[styles.quickIcon, { backgroundColor: soft }]}>
        <Icon size={18} color={tint} strokeWidth={1.9} />
      </View>
      <View style={{ gap: 2 }}>
        <Text style={styles.quickLabel}>{label}</Text>
        <Text style={styles.quickSub}>{sub}</Text>
      </View>
    </Glass>
  );
}

// ── Reggie hero — the proactive tutor, front and centre on Home ───────────────
// Reggie doesn't wait to be asked: he opens on the student's nearest due
// assignment and offers to plan it. Tapping the nudge starts a Reggie chat
// already seeded with the assignment; the input below is for anything else.
type NextDue = { name: string; course: string; due: { label: string; urgent: boolean } | null } | null;

function ReggieHero({ C, styles, nextDue, onAsk, onOpen }: {
  C: ThemeColors; styles: Styles; nextDue: NextDue; onAsk: (q: string) => void; onOpen: () => void;
}) {
  const [q, setQ] = useState("");
  const submit = () => { const t = q.trim(); if (!t) return; onAsk(t); setQ(""); };
  const short = (s: string) => (s.length > 54 ? s.slice(0, 52).trim() + "…" : s);

  // The due status is a colored pill, not part of the sentence — Canvas titles
  // are messy (often already contain "Due …"), so a badge reads far cleaner.
  let headline: string, sub: string, nudge: string | null = null;
  let badge: { label: string; color: string; bg: string; line: string } | null = null;
  if (nextDue) {
    headline = short(nextDue.name);
    if (nextDue.due) {
      const lbl = nextDue.due.label;
      const overdue = /overdue/i.test(lbl);
      badge = overdue
        ? { label: lbl, color: "#E68A79", bg: "rgba(224,132,116,0.16)", line: "rgba(224,132,116,0.34)" }
        : nextDue.due.urgent
        ? { label: lbl, color: C.gold, bg: "rgba(235,194,94,0.16)", line: "rgba(235,194,94,0.32)" }
        : { label: lbl, color: C.accent, bg: C.accentSoft, line: C.accentLine };
      sub = overdue ? "Let's catch it up — tap and I'll break it down." : "Want a hand? Tap and I'll help you plan it.";
      nudge = `Help me get started on "${nextDue.name}"${nextDue.course ? ` for ${nextDue.course}` : ""} — ${overdue ? "it's overdue" : `it's due ${lbl.toLowerCase()}`}. Break it into a few concrete steps.`;
    } else {
      sub = "Want a hand? Tap and I'll help you plan it.";
      nudge = `Help me get started on "${nextDue.name}"${nextDue.course ? ` for ${nextDue.course}` : ""}. Break it into a few concrete steps.`;
    }
  } else {
    headline = "You're all caught up.";
    sub = "Want to get ahead? Ask me to quiz you or plan the week.";
  }

  const ringColor = isLightBg(C) ? "50,70,105" : "255,255,255";

  return (
    <Glass colors={C} radius={20} style={styles.reggieHero}>
      <View style={styles.reggieHeroHead}>
        <NeuralRing size={40} color={ringColor} />
        <Text style={styles.reggieKicker}>Reggie · your tutor</Text>
      </View>

      <TouchableOpacity activeOpacity={nudge ? 0.75 : 1} onPress={() => (nudge ? onAsk(nudge) : onOpen())}>
        {(nextDue?.course || badge) && (
          <View style={styles.reggieMetaRow}>
            <Text style={styles.reggieCourse} numberOfLines={1}>{nextDue?.course ?? ""}</Text>
            {badge && (
              <View style={[styles.dueBadge, { backgroundColor: badge.bg, borderColor: badge.line }]}>
                <Text style={[styles.dueBadgeText, { color: badge.color }]}>{badge.label}</Text>
              </View>
            )}
          </View>
        )}
        <Text style={styles.reggieTitle}>{headline}</Text>
        <Text style={styles.reggieSub}>{sub}{nudge ? "  →" : ""}</Text>
      </TouchableOpacity>

      <View style={styles.reggieInputRow}>
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Ask Reggie anything…"
          placeholderTextColor={C.textTertiary}
          style={styles.reggieInput}
          onSubmitEditing={submit}
          returnKeyType="send"
        />
        <TouchableOpacity onPress={q.trim() ? submit : onOpen} style={styles.reggieSend} activeOpacity={0.85}>
          <ArrowRight size={18} color="#121414" strokeWidth={2.4} />
        </TouchableOpacity>
      </View>
    </Glass>
  );
}

export default function WorkScreen() {
  const userId = useUserId();
  const router = useRouter();
  const C = usePageTheme("work");
  const styles = useMemo(() => makeStyles(C), [C]);
  const { width } = useWindowDimensions();
  const hour = new Date().getHours();
  const greetingWord = hour < 12 ? "Morning" : hour < 18 ? "Afternoon" : "Evening";

  const [name, setName]               = useState("");
  const [gpa, setGpa]                 = useState<number | null>(null);
  const [streak, setStreak]           = useState(0);
  const [courses, setCourses]         = useState<any[]>([]);
  const [assignments, setAssignments] = useState<any[]>([]);
  const [, setRooms]                  = useState<any[]>([]);
  const [syncStatus, setSyncStatus]   = useState<"idle" | "syncing">("syncing");
  const [loadError, setLoadError]     = useState(false);
  const [, setLastStudy]              = useState<{ courseCode?: string; name?: string; mode?: string } | null>(null);

  // Read the last-studied context so "Jump back in" resumes the right course.
  // Re-runs on each mount (nav is swap-based, so returning Home re-reads it).
  useEffect(() => {
    AsyncStorage.getItem(LAST_STUDY_KEY)
      .then(raw => { if (raw) { try { setLastStudy(JSON.parse(raw)); } catch {} } })
      .catch(() => {});
  }, []);

  // Hoisted so both first mount and pull-to-refresh run the exact same load.
  const reload = useCallback(async () => {
    setLoadError(false);
    try {
      const [{ data: user }, { data: courseRows }, { data: rows }, { data: roomRows }] = await Promise.all([
        supabase.from("users").select("name, gpa, streak").eq("id", userId).maybeSingle(),
        supabase.from("courses")
          .select("id, name, course_code, current_score, final_score")
          .eq("user_id", userId),
        supabase.from("assignments")
          .select("id, title, due_at, points_possible, score, submitted_at, late, missing, course_id, courses(name, course_code)")
          .eq("user_id", userId),
        supabase.from("study_rooms")
          .select("id, name, is_active")
          .eq("is_active", true)
          .limit(8),
      ]);

      // Live presence for the "Study rooms" shelf: count members per open room.
      let liveRooms: any[] = [];
      if (roomRows?.length) {
        const ids = roomRows.map((r: any) => r.id);
        const { data: mem } = await supabase.from("room_members").select("room_id").in("room_id", ids);
        const counts: Record<string, number> = {};
        (mem ?? []).forEach((m: any) => { counts[m.room_id] = (counts[m.room_id] ?? 0) + 1; });
        liveRooms = roomRows
          .map((r: any) => ({ id: r.id, name: r.name ?? "Study room", members: counts[r.id] ?? 0 }))
          .sort((a: any, b: any) => b.members - a.members)
          .slice(0, 6);
      }
      setRooms(liveRooms);

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
    } catch {
      setLoadError(true);
    } finally {
      setSyncStatus("idle");
    }
  }, [userId]);

  useEffect(() => { reload(); }, [reload]);

  const { refreshing, onRefresh } = useRefresh(reload);

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

  // What Reggie proactively greets the student with: their nearest due item.
  const nextDue: NextDue = heroFirst
    ? { name: heroFirst.name ?? "Untitled", course: heroFirst.courseCode ?? heroFirst.courseName ?? "", due: formatDue(heroFirst.dueAt) }
    : null;

  const subtitleText = syncStatus === "syncing"
    ? "Syncing your courses…"
    : upcoming.length > 0
    ? `${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric" })} · ${upcoming.length} assignment${upcoming.length !== 1 ? "s" : ""} coming up`
    : hasToken ? "You're all caught up" : "Connect your LMS to see assignments";

  // Calmer large-title size (was a 48px hero) — a proper iOS large title.
  const greetingSize = Math.min(Math.max(width * 0.075, 28), 34);

  // One accent for every tile icon — a calm, uniform grid (sage/theme accent).
  const TINT = C.accent, SOFT = C.accentSoft;
  const quickActions: QuickAction[] = [
    // A balanced 2×2 of what you'd reach for next. Uniform sage icons so the grid
    // reads as one calm set. The nearest-due item lives in the Reggie hero above;
    // this tile opens the full list.
    { key: "flashcards",  label: "Flashcards",  sub: "Review your cards",
      Icon: Layers, tint: TINT, soft: SOFT,
      go: () => router.replace("/study?mode=flashcards" as any) },
    { key: "assignments", label: "Assignments", sub: "See what's due",
      Icon: ClipboardList, tint: TINT, soft: SOFT,
      go: () => router.replace("/assignment" as any) },
    { key: "room",        label: "Start room",  sub: "Focus with Reggie",
      Icon: Users, tint: TINT, soft: SOFT,
      go: () => router.replace("/rooms?start=1" as any) },
    { key: "record",      label: "Record",      sub: "Capture a lecture",
      Icon: Mic, tint: TINT, soft: SOFT,
      go: () => router.replace("/toolkit?tab=recordings" as any) },
  ];

  return (
    <ScreenWrapper page="work">
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 8 }}
        refreshControl={<ThemedRefreshControl colors={C} refreshing={refreshing} onRefresh={onRefresh} />}
      >

        {/* ── Greeting ── */}
        <View style={styles.greeting}>
          <Text style={[styles.greetingText, { fontSize: greetingSize, lineHeight: greetingSize }]}>
            {greetingWord},{" "}
            {name ? <Text style={styles.greetingName}>{name}.</Text> : <Text>.</Text>}
          </Text>
          <Text style={styles.subtitle}>{subtitleText}</Text>
        </View>

        {/* ── Reggie (proactive tutor) ── */}
        <ReggieHero
          C={C}
          styles={styles}
          nextDue={nextDue}
          onAsk={(t) => router.push(`/tutor?q=${encodeURIComponent(t)}` as any)}
          onOpen={() => router.push("/tutor" as any)}
        />

        {/* ── Quick actions — a balanced 2×2 of what you'd open next ── */}
        <View style={styles.quickGrid}>
          {quickActions.map(a => <QuickActionTile key={a.key} C={C} styles={styles} action={a} />)}
        </View>
      </ScrollView>
    </ScreenWrapper>
  );
}

// ── styles ────────────────────────────────────────────────────────────────────

type Styles = ReturnType<typeof makeStyles>;

const makeStyles = (C: ThemeColors) => StyleSheet.create({
  // Greeting — plain left-aligned large title (iOS style), name in ink
  greeting:      { alignItems: "flex-start", marginBottom: 22 },
  greetingText:  { fontWeight: "700", color: C.textPrimary, letterSpacing: -0.6, textAlign: "left" },
  greetingName:  { fontWeight: "700", color: C.textPrimary },
  subtitle:      { fontWeight: "400", fontSize: 15, lineHeight: 22, color: C.textSecondary, marginTop: 6, textAlign: "left" },

  // Reggie hero (proactive tutor)
  reggieHero:      { borderRadius: 20, padding: 18, marginBottom: 16 },
  reggieHeroHead:  { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 },
  reggieKicker:    { fontWeight: "600", fontSize: 12, color: C.accent, letterSpacing: 0.2 },
  reggieMetaRow:   { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 6 },
  reggieCourse:    { fontWeight: "600", fontSize: 11, color: C.textSecondary, letterSpacing: 0.5, flexShrink: 1 },
  dueBadge:        { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 8, borderWidth: 1, flexShrink: 0 },
  dueBadgeText:    { fontWeight: "600", fontSize: 11, letterSpacing: 0.2 },
  reggieTitle:     { fontWeight: "700", fontSize: 17, lineHeight: 23, color: C.textPrimary, letterSpacing: -0.2 },
  reggieSub:       { fontWeight: "400", fontSize: 13, lineHeight: 18, color: C.textSecondary, marginTop: 5 },
  reggieInputRow:  { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 14 },
  reggieInput:     { flex: 1, minWidth: 0, height: 44, backgroundColor: C.surfaceTranslucent, borderWidth: 1, borderColor: C.border, borderRadius: 12, paddingHorizontal: 14, fontSize: 15, color: C.textPrimary },
  reggieSend:      { width: 44, height: 44, borderRadius: 12, backgroundColor: C.accent, alignItems: "center", justifyContent: "center" },

  // Quick actions (2×2 launch grid under the greeting)
  quickGrid:     { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  quickTile:     { flexBasis: "47%", flexGrow: 1, maxWidth: "48.5%", minHeight: 100, borderRadius: 18, padding: 14, justifyContent: "space-between" },
  quickIcon:     { width: 36, height: 36, borderRadius: 11, alignItems: "center", justifyContent: "center", marginBottom: 12 },
  quickLabel:    { fontWeight: "600", fontSize: 15, color: C.textPrimary, letterSpacing: -0.2 },
  quickSub:      { fontWeight: "400", fontSize: 12, color: C.textSecondary },

  // Proactive shelves
  shelfRow:      { gap: 12, paddingHorizontal: 8, paddingTop: 14, paddingBottom: 4 },
  shelfCard:     { width: 168, minHeight: 132, borderRadius: 14, padding: 14, gap: 8, justifyContent: "space-between" },
  shelfIcon:     { width: 32, height: 32, borderRadius: 8, backgroundColor: C.surfaceTranslucent, alignItems: "center", justifyContent: "center" },
  shelfCourse:   { fontWeight: "600", fontSize: 11, letterSpacing: 0.5, color: C.textSecondary },
  shelfTitle:    { fontWeight: "500", fontSize: 14, lineHeight: 18, color: C.textPrimary, flex: 1 },
  shelfMeta:     { fontWeight: "400", fontSize: 12, color: C.textSecondary },

  // Stats row — compact inline
  statsRow:      { flexDirection: "row", alignItems: "center", gap: 20, paddingVertical: 2 },
  statItem:      { alignItems: "flex-start" },
  statDivider:   { width: 1, height: 26, backgroundColor: C.border },
  statValue:     { fontWeight: "700", fontSize: 21, color: C.textPrimary, letterSpacing: -0.4 },
  statLabel:     { fontWeight: "400", fontSize: 11, color: C.textSecondary, marginTop: 3 },

  // Section headers
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 8 },
  sectionTitle:  { fontWeight: "600", fontSize: 18, lineHeight: 24, letterSpacing: -0.18, color: C.textPrimary },
  viewAll:       { fontWeight: "600", fontSize: 12, lineHeight: 16, letterSpacing: 0.6, color: C.textSecondary, textAlign: "center" },
});

// canvas.tsx — mobile port of src/pages/Canvas.tsx ("Your Courses").
// Replicates the connected-user experience: page header, Canvas-connected hero
// card, Course Library grid (single column on phone), Announcements and Past
// Courses collapsibles. Skipped: token-entry connect form, manual-upload sheet,
// past-course "+ Add" write flows (web-extension / web-context specific).

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { BlurView } from "expo-blur";
import Glass from "../components/Glass";
import {
  RefreshCw, ChevronUp, ChevronDown, ChevronRight,
  BookOpen, Calendar, Plus, LayoutGrid, List,
} from "lucide-react-native";
import ScreenWrapper from "../components/ScreenWrapper";
import { Skeleton, ErrorState, useRefresh, ThemedRefreshControl } from "../components/States";
import { supabase } from "../services/supabase";
import { useUserId } from "../context/AuthContext";
import { usePageTheme, ThemeColors } from "../constants/appTheme";

const PAGE = "canvas";

// Web CARD_BG is a radial wash (35→74→117→25 greys at 0.6 alpha) under a 20%
// black overlay. Approximated with a diagonal linear gradient + overlay View.
const CARD_COLORS = [
  "rgba(35,35,36,0.6)",
  "rgba(74,74,75,0.6)",
  "rgba(117,117,118,0.6)",
  "rgba(25,25,25,0.6)",
] as const;
const CARD_LOCATIONS = [0.17, 0.39, 0.58, 0.99] as const;
const CARD_START = { x: 0.1, y: 0.6 };
const CARD_END = { x: 1, y: 0.4 };

type SyncStatus = "syncing" | "synced" | "error" | "idle";

// ── helpers ──────────────────────────────────────────────────────────────────

// Parse "85%", "85/100", "85" into a 0-100 number (web canvasSync.ts parseScore).
function parseScore(g: any): number | null {
  if (g == null) return null;
  const s = String(g);
  const pct = s.match(/(\d{1,3}(?:\.\d+)?)\s*%/);
  if (pct) return parseFloat(pct[1]);
  const frac = s.match(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);
  if (frac) return (parseFloat(frac[1]) / parseFloat(frac[2])) * 100;
  const num = s.match(/^\s*(\d{1,3}(?:\.\d+)?)\s*$/);
  if (num) return parseFloat(num[1]);
  return null;
}

// ── SyncBadge ────────────────────────────────────────────────────────────────

function SyncBadge({ status }: { status: SyncStatus }) {
  const C = usePageTheme(PAGE);
  const styles = useMemo(() => makeStyles(C), [C]);
  const map: Record<string, { label: string; bg: string; color: string }> = {
    syncing: { label: "Syncing…",   bg: "rgba(255,204,0,0.12)",   color: "rgba(255,204,0,0.8)" },
    synced:  { label: "Synced",     bg: "rgba(52,199,89,0.1)",    color: "rgba(100,220,130,0.85)" },
    error:   { label: "Sync error", bg: "rgba(255,59,48,0.1)",    color: "rgba(255,100,90,0.85)" },
    idle:    { label: "Pending",    bg: C.surfaceTranslucent, color: C.textDim },
  };
  const { label, bg, color } = map[status] ?? map.idle;
  return (
    <View style={[styles.syncBadge, { backgroundColor: bg }]}>
      <Text style={[styles.syncBadgeText, { color }]}>{label}</Text>
    </View>
  );
}

// ── RefreshButton ────────────────────────────────────────────────────────────

function RefreshButton({ syncStatus, onPress }: { syncStatus: SyncStatus; onPress: () => void }) {
  const C = usePageTheme(PAGE);
  const styles = useMemo(() => makeStyles(C), [C]);
  const busy = syncStatus === "syncing";
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={busy}
      style={styles.refreshBtn}
      activeOpacity={0.7}
    >
      {busy ? (
        <Text style={[styles.refreshText, { color: C.textDim }]}>Syncing…</Text>
      ) : (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
          <RefreshCw size={13} color={C.textSecondary} strokeWidth={2} />
          <Text style={styles.refreshText}>Refresh</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

// ── ConnectCanvas hero card ──────────────────────────────────────────────────

function ConnectCanvas({
  connected, syncStatus, onRefresh,
}: { connected: boolean; syncStatus: SyncStatus; onRefresh: () => void }) {
  const C = usePageTheme(PAGE);
  const styles = useMemo(() => makeStyles(C), [C]);
  return (
    <Glass colors={C} radius={45} style={styles.heroWrap}>
      {/* Eyebrow badge */}
      <View style={styles.eyebrow}>
        <View style={styles.eyebrowDot} />
        <Text style={styles.eyebrowText}>Ecosystem sync</Text>
      </View>

      {connected ? (
        <>
          <Text style={styles.heroTitle}>LMS Connected</Text>
          <Text style={styles.heroBody}>
            Your academic infrastructure is synced and updating automatically in the background.
          </Text>
          <View style={styles.heroRow}>
            <SyncBadge status={syncStatus} />
            <RefreshButton syncStatus={syncStatus} onPress={onRefresh} />
          </View>
        </>
      ) : (
        <>
          <Text style={styles.heroTitle}>Connect Your LMS</Text>
          <Text style={styles.heroBody}>
            Seamlessly integrate your academic infrastructure. Connect your LMS from the
            FschoolAI web app to initiate an automated curriculum handshake — your courses
            will appear here once synced.
          </Text>
          <View style={styles.heroRow}>
            <SyncBadge status={syncStatus} />
            <RefreshButton syncStatus={syncStatus} onPress={onRefresh} />
          </View>
        </>
      )}
    </Glass>
  );
}

// ── CourseGridCard ───────────────────────────────────────────────────────────

function CourseGridCard({ course, assignments }: { course: any; assignments: any[] }) {
  const C = usePageTheme(PAGE);
  const styles = useMemo(() => makeStyles(C), [C]);
  const courseAssignments = (assignments ?? []).filter(
    (a: any) => String(a.courseId) === String(course.id)
  );
  const upcoming = courseAssignments.filter(
    (a: any) => !a.submission?.submittedAt && a.dueAt && new Date(a.dueAt) > new Date()
  );
  const missing = courseAssignments.filter((a: any) => a.submission?.missing).length;
  const code = course.courseCode;
  const score = course.currentScore ?? course.finalScore;
  const progressPct = score != null ? Math.min(Number(score), 100) : 0;

  return (
    <Glass colors={C} radius={30} style={styles.courseCard}>
      {/* Top row: icon + tag */}
      <View style={styles.courseTopRow}>
        <View style={styles.courseIcon}>
          <BookOpen size={20} color={C.textSecondary} strokeWidth={1.5} />
        </View>
        <View style={styles.courseTag}>
          <Text style={styles.courseTagText}>{(code || "COURSE").toUpperCase()}</Text>
        </View>
      </View>

      {/* Title */}
      <Text style={styles.courseTitle}>{course.name}</Text>

      {/* Description */}
      <Text style={styles.courseDesc} numberOfLines={2}>
        {course.professor
          ? `Prof. ${course.professor}`
          : course.semester ?? "Active course"}
        {missing > 0 ? ` · ${missing} missing` : ""}
      </Text>

      {/* Progress */}
      <View style={{ marginBottom: 20 }}>
        <View style={styles.progressLabelRow}>
          <Text style={styles.progressLabel}>{score != null ? "Grade" : "Progress"}</Text>
          <Text style={styles.progressValue}>
            {score != null ? `${Math.round(Number(score))}%` : "—"}
          </Text>
        </View>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progressPct}%` }]} />
        </View>
      </View>

      {/* Footer */}
      <View style={styles.courseFooter}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Calendar size={11} color={C.textSecondary} strokeWidth={2} />
          <Text style={styles.courseFooterText}>
            {upcoming.length > 0
              ? `${upcoming.length} assignment${upcoming.length !== 1 ? "s" : ""} due`
              : "All caught up"}
          </Text>
        </View>
        <ChevronRight size={15} color={C.textTertiary} strokeWidth={2} />
      </View>
    </Glass>
  );
}

// ── AddNewCard ───────────────────────────────────────────────────────────────

// Visual parity with the web's dashed "Add New Course" card. The manual-upload
// sheet is web-only, so this is display-only on mobile for now.
function AddNewCard() {
  const C = usePageTheme(PAGE);
  const styles = useMemo(() => makeStyles(C), [C]);
  return (
    <View style={styles.addCard}>
      <View style={styles.addCircle}>
        <Plus size={24} color={C.textSecondary} strokeWidth={1.5} />
      </View>
      <Text style={styles.addTitle}>Add New Course</Text>
      <Text style={styles.addSub}>Import from your LMS or add manually</Text>
      <View style={styles.addPill}>
        <Text style={styles.addPillText}>Add manually</Text>
      </View>
    </View>
  );
}

// ── AnnouncementsSection ─────────────────────────────────────────────────────

function AnnouncementsSection({ announcements }: { announcements: any[] }) {
  const C = usePageTheme(PAGE);
  const styles = useMemo(() => makeStyles(C), [C]);
  const [open, setOpen] = useState(true);
  if (!announcements?.length) return null;

  const shown = announcements.slice(0, 5);

  return (
    <Glass radius={16} style={styles.collapse} colors={C}>
      <TouchableOpacity style={styles.collapseHeader} onPress={() => setOpen(o => !o)} activeOpacity={0.7}>
        <Text style={styles.collapseTitle}>Announcements</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <Text style={styles.collapseCount}>{announcements.length} ·</Text>
          {open
            ? <ChevronUp size={12} color={C.textTertiary} strokeWidth={2} />
            : <ChevronDown size={12} color={C.textTertiary} strokeWidth={2} />}
        </View>
      </TouchableOpacity>

      {open && (
        <View style={styles.collapseBody}>
          {shown.map((a: any, i: number) => (
            <View
              key={a.id ?? i}
              style={[styles.annRow, i < shown.length - 1 && styles.rowDivider]}
            >
              <Text style={styles.annTitle}>{a.title}</Text>
              <Text style={styles.annMeta}>
                {a.context_name ?? a.course_name ?? ""}
                {a.posted_at
                  ? ` · ${new Date(a.posted_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
                  : ""}
              </Text>
            </View>
          ))}
        </View>
      )}
    </Glass>
  );
}

// ── PastCoursesSection ───────────────────────────────────────────────────────

// Read-only on mobile: the web's "+ Add" / "+ Add manually" write flows depend
// on the web AppContext (Canvas API fetches + localStorage bookkeeping).
function PastCoursesSection({ pastCourses }: { pastCourses: any[] }) {
  const C = usePageTheme(PAGE);
  const styles = useMemo(() => makeStyles(C), [C]);
  const [open, setOpen] = useState(false);

  const grouped: Record<string, any[]> = {};
  pastCourses.forEach((c: any) => {
    const sem = c.semester || "Past";
    if (!grouped[sem]) grouped[sem] = [];
    grouped[sem].push(c);
  });

  return (
    <Glass radius={16} style={styles.collapse} colors={C}>
      <TouchableOpacity style={styles.collapseHeader} onPress={() => setOpen(o => !o)} activeOpacity={0.7}>
        <Text style={styles.collapseTitle}>Past courses</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <Text style={styles.collapseCount}>{pastCourses.length}</Text>
          {open
            ? <ChevronUp size={12} color={C.textTertiary} strokeWidth={2} />
            : <ChevronDown size={12} color={C.textTertiary} strokeWidth={2} />}
        </View>
      </TouchableOpacity>

      {open && (
        <View style={styles.collapseBody}>
          {Object.entries(grouped).map(([semester, semCourses]) => (
            <View key={semester}>
              <Text style={styles.pastSemester}>{semester.toUpperCase()}</Text>
              {semCourses.map((c: any, i: number) => {
                const score = c.finalScore ?? c.currentScore;
                return (
                  <View
                    key={c.id ?? i}
                    style={[styles.pastRow, i < semCourses.length - 1 && styles.rowDivider]}
                  >
                    <View style={{ minWidth: 0, flex: 1 }}>
                      <Text style={styles.pastName} numberOfLines={1}>{c.name}</Text>
                      <Text style={styles.pastMeta}>
                        {c.courseCode}
                        {score != null ? ` · ${Math.round(Number(score))}%` : ""}
                      </Text>
                    </View>
                  </View>
                );
              })}
            </View>
          ))}
          <Text style={styles.pastFootnote}>
            Added courses appear in your active course list and are included in AI context.
          </Text>
        </View>
      )}
    </Glass>
  );
}

// ── Main screen ──────────────────────────────────────────────────────────────

export default function CanvasScreen() {
  const C = usePageTheme(PAGE);
  const styles = useMemo(() => makeStyles(C), [C]);
  const userId = useUserId();
  const [courses, setCourses]             = useState<any[]>([]);
  const [assignments, setAssignments]     = useState<any[]>([]);
  const [announcements, setAnnouncements] = useState<any[]>([]);
  const [pastCourses, setPastCourses]     = useState<any[]>([]);
  const [connected, setConnected]         = useState(false);
  const [syncStatus, setSyncStatus]       = useState<SyncStatus>("syncing");
  const [gridView, setGridView]           = useState(true);

  const load = useCallback(async () => {
    setSyncStatus("syncing");
    try {
      const [userRes, cRes, aRes, blobRes] = await Promise.all([
        supabase.from("users").select("canvas_token").eq("id", userId).maybeSingle(),
        supabase.from("courses").select("*").eq("user_id", userId),
        supabase.from("assignments")
          .select("id, title, due_at, submitted_at, missing, course_id, courses(canvas_course_id)")
          .eq("user_id", userId),
        supabase.from("canvas_data").select("data_type, payload").eq("user_id", userId),
      ]);

      const blobMap: Record<string, any> = {};
      (blobRes.data ?? []).forEach((row: any) => { blobMap[row.data_type] = row.payload; });

      // Mirror web canvasSync loadCanvasData mapping:
      // Canvas courses use canvas_course_id as the id; manual ones the DB UUID.
      const mapped = (cRes.data ?? []).map((c: any) => ({
        id:           c.canvas_course_id ?? c.id,
        dbId:         c.id,
        name:         c.name,
        courseCode:   c.course_code,
        currentScore: c.current_score,
        finalScore:   c.final_score,
        source:       c.source,
      }));

      const mappedAssignments = (aRes.data ?? []).map((a: any) => ({
        id:       a.id,
        courseId: a.courses?.canvas_course_id ?? a.course_id ?? null,
        dueAt:    a.due_at,
        submission: { submittedAt: a.submitted_at, missing: a.missing ?? false },
      }));

      // Browser-extension blobs (non-Canvas users) merge into the course list.
      const extCourses: any[] = blobMap["ext_courses"] ?? [];
      const extGrades:  any[] = blobMap["ext_grades"]  ?? [];
      if (extCourses.length) {
        const gradeByCourse: Record<string, number | null> = {};
        extGrades.forEach((g: any) => {
          const score = parseScore(g.percentage) ?? parseScore(g.score) ?? null;
          if (g.course) gradeByCourse[String(g.course).toLowerCase()] = score;
        });
        extCourses.forEach((c: any, i: number) => {
          const key = (c.name ?? c.code ?? `ext${i}`).toLowerCase();
          const score = gradeByCourse[key]
            ?? gradeByCourse[(c.code ?? "").toLowerCase()]
            ?? null;
          mapped.push({
            id:           `ext_${c.code ?? i}`,
            dbId:         null,
            name:         c.name ?? c.code ?? "Course",
            courseCode:   c.code ?? "",
            currentScore: score,
            finalScore:   null,
            source:       "extension",
          });
        });
      }

      // Past courses live in the courses table with a past-ish source (plus the
      // past_courses blob from Canvas syncs) — keep them out of the main grid.
      const isPast = (c: any) => c.source === "manual_past" || c.source === "past_canvas";
      const pastDb = mapped.filter(isPast).map((c: any) => ({
        id:           c.dbId ?? c.id,
        name:         c.name,
        courseCode:   c.courseCode,
        currentScore: c.currentScore,
        semester:     "Past",
      }));

      setConnected(Boolean(userRes.data?.canvas_token));
      setCourses(mapped.filter((c: any) => !isPast(c)));
      setAssignments(mappedAssignments);
      setAnnouncements(Array.isArray(blobMap["announcements"]) ? blobMap["announcements"] : []);
      setPastCourses([
        ...(Array.isArray(blobMap["past_courses"]) ? blobMap["past_courses"] : []),
        ...pastDb,
      ]);
      setSyncStatus(cRes.error || aRes.error ? "error" : "synced");
    } catch {
      setSyncStatus("error");
    }
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  const { refreshing, onRefresh } = useRefresh(load);

  return (
    <ScreenWrapper page="canvas">
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 8 }}
        refreshControl={<ThemedRefreshControl colors={C} refreshing={refreshing} onRefresh={onRefresh} />}
      >

        {/* ── Page header ── */}
        <View style={styles.pageHeader}>
          <Text style={styles.pageTitle}>Your Courses</Text>
          <Text style={styles.pageSubtitle}>
            Manage your academic curriculum, track student progress, and utilize
            AI-enhanced teaching tools across all active departments.
          </Text>
        </View>

        {/* LMS connection status/refresh lives on the Profile → Connections
            settings card now (app/identity.tsx), not on this Courses screen. */}

        {/* ── Course Library ── */}
        <View style={{ marginTop: 24 }}>
          <View style={styles.sectionHeader}>
            <View>
              <Text style={styles.sectionTitle}>Course Library</Text>
              <Text style={styles.sectionSub}>
                {courses.length} active course{courses.length !== 1 ? "s" : ""} this semester
              </Text>
            </View>

            {/* View toggle (cosmetic parity with web) */}
            <View style={{ flexDirection: "row", gap: 8 }}>
              <TouchableOpacity
                onPress={() => setGridView(true)}
                style={[styles.viewToggle, gridView && styles.viewToggleActive]}
              >
                <LayoutGrid size={14} color={C.textSecondary} strokeWidth={2} />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setGridView(false)}
                style={[styles.viewToggle, !gridView && styles.viewToggleActive]}
              >
                <List size={14} color={C.textSecondary} strokeWidth={2} />
              </TouchableOpacity>
            </View>
          </View>

          {/* Course grid — single column on phone (web's isMobile branch) */}
          <View style={{ gap: 20 }}>
            {syncStatus === "syncing" && courses.length === 0
              ? [0, 1, 2].map(i => <Skeleton key={i} colors={C} height={148} radius={16} />)
              : courses.map((c: any, i: number) => (
                  <CourseGridCard
                    key={c.id ?? c.courseCode ?? i}
                    course={c}
                    assignments={assignments}
                  />
                ))}
            <AddNewCard />
          </View>

          {syncStatus === "error" && courses.length === 0 && (
            <ErrorState
              compact
              colors={C}
              title="Couldn't sync your courses"
              message="Check your connection and try again. Your saved courses will still be here."
              onRetry={load}
            />
          )}
        </View>

        {/* ── Announcements ── */}
        {announcements.length > 0 && (
          <View style={{ marginTop: 80 }}>
            <AnnouncementsSection announcements={announcements} />
          </View>
        )}

        {/* ── Past courses ── */}
        {pastCourses.length > 0 && (
          <View style={{ marginTop: 40 }}>
            <PastCoursesSection pastCourses={pastCourses} />
          </View>
        )}

      </ScrollView>
    </ScreenWrapper>
  );
}

// ── styles ───────────────────────────────────────────────────────────────────

const makeStyles = (C: ThemeColors) => StyleSheet.create({
  // Page header
  pageHeader:    { alignItems: "center", marginBottom: 64 },
  pageTitle:     { fontWeight: "600", fontSize: 48, lineHeight: 56, letterSpacing: -1.2, color: C.textPrimary, textAlign: "center", marginBottom: 16 },
  pageSubtitle:  { fontWeight: "400", fontSize: 16, lineHeight: 24, color: C.textSecondary, textAlign: "center", maxWidth: 628 },

  // Shared card gradient overlay (web CARD_BG's 20% black layer)
  cardOverlay:   { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.2)" },

  // Hero card
  heroWrap:      { padding: 40, alignItems: "center" },
  eyebrow:       { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingVertical: 4, borderRadius: 9999, borderWidth: 1, borderColor: C.border, marginBottom: 24 },
  eyebrowDot:    { width: 9, height: 9, borderRadius: 9999, backgroundColor: C.accent },
  eyebrowText:   { fontWeight: "400", fontSize: 10, letterSpacing: 1, color: C.textSecondary, },
  heroTitle:     { fontWeight: "600", fontSize: 32, lineHeight: 40, letterSpacing: -0.32, color: C.textPrimary, textAlign: "center", marginBottom: 16 },
  heroBody:      { fontWeight: "400", fontSize: 16, lineHeight: 26, color: C.textSecondary, textAlign: "center", maxWidth: 500, marginBottom: 32 },
  heroRow:       { flexDirection: "row", alignItems: "center", gap: 12, justifyContent: "center", marginBottom: 16 },

  syncBadge:     { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  syncBadgeText: { fontWeight: "500", fontSize: 11 },

  refreshBtn:    { borderWidth: 1, borderColor: C.border, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 4 },
  refreshText:   { fontWeight: "500", fontSize: 11, color: C.textSecondary },

  // Course Library section header
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 32 },
  sectionTitle:  { fontWeight: "600", fontSize: 18, letterSpacing: -0.18, color: C.textPrimary, marginBottom: 4 },
  sectionSub:    { fontWeight: "400", fontSize: 14, color: C.textTertiary },
  viewToggle:    { width: 32, height: 36, backgroundColor: C.surfaceTranslucent, borderWidth: 1, borderColor: C.border, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  viewToggleActive: { backgroundColor: C.accentSoft, borderColor: C.accentLine },

  // Course card (Glass supplies the frost + border + radius; this is layout only)
  courseCard:    { padding: 29, minHeight: 314 },
  courseTopRow:  { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 },
  courseIcon:    { width: 44, height: 44, backgroundColor: C.surfaceTranslucent, borderWidth: 1, borderColor: C.border, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  courseTag:     { paddingHorizontal: 10, paddingVertical: 4, backgroundColor: C.surfaceTranslucent, borderWidth: 1, borderColor: C.border, borderRadius: 4 },
  courseTagText: { fontWeight: "400", fontSize: 10, letterSpacing: 1, color: C.textSecondary },
  courseTitle:   { fontWeight: "600", fontSize: 18, letterSpacing: -0.18, color: C.textPrimary, marginBottom: 8 },
  courseDesc:    { fontWeight: "400", fontSize: 14, lineHeight: 20, color: C.textSecondary, marginBottom: 24, flexGrow: 1 },

  progressLabelRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 6 },
  progressLabel: { fontWeight: "400", fontSize: 11, color: C.textSecondary },
  progressValue: { fontWeight: "700", fontSize: 11, color: C.textSecondary },
  progressTrack: { height: 4, backgroundColor: C.surfaceTranslucent, borderRadius: 9999, overflow: "hidden" },
  progressFill:  { height: "100%", backgroundColor: C.accent, borderRadius: 9999 },

  courseFooter:  { borderTopWidth: 1, borderTopColor: C.border, paddingTop: 16, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  courseFooterText: { fontWeight: "400", fontSize: 14, color: C.textSecondary },

  // Add-new card
  addCard:       { padding: 29, borderRadius: 30, minHeight: 314, borderWidth: 1, borderStyle: "dashed", borderColor: C.border, alignItems: "center", justifyContent: "center", gap: 16 },
  addCircle:     { width: 64, height: 64, borderRadius: 9999, backgroundColor: C.surface, alignItems: "center", justifyContent: "center" },
  addTitle:      { fontWeight: "400", fontSize: 18, color: C.textPrimary, textAlign: "center" },
  addSub:        { fontWeight: "400", fontSize: 14, color: C.textSecondary, textAlign: "center" },
  addPill:       { borderWidth: 1, borderColor: C.surfaceTranslucent, borderRadius: 9999, paddingHorizontal: 20, paddingVertical: 8 },
  addPillText:   { fontWeight: "400", fontSize: 14, color: C.textSecondary },

  syncingText:   { fontWeight: "400", fontSize: 14, color: C.textTertiary, textAlign: "center", marginTop: 40 },

  // Collapsible sections (announcements / past courses)
  collapse:      { borderRadius: 16, overflow: "hidden" },
  collapseHeader:{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 18, paddingVertical: 14 },
  collapseTitle: { fontWeight: "600", fontSize: 13, letterSpacing: 0.52, color: C.textPrimary },
  collapseCount: { fontWeight: "400", fontSize: 12, color: C.textTertiary },
  collapseBody:  { borderTopWidth: 1, borderTopColor: C.border },
  rowDivider:    { borderBottomWidth: 1, borderBottomColor: C.border },

  annRow:        { paddingHorizontal: 18, paddingVertical: 12 },
  annTitle:      { fontWeight: "500", fontSize: 13, color: C.textPrimary, marginBottom: 3 },
  annMeta:       { fontWeight: "400", fontSize: 11, color: C.textTertiary },

  pastSemester:  { fontWeight: "400", fontSize: 10, letterSpacing: 0.2, color: C.textTertiary, paddingHorizontal: 18, paddingTop: 10, paddingBottom: 6 },
  pastRow:       { paddingHorizontal: 18, paddingVertical: 11, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  pastName:      { fontWeight: "500", fontSize: 13, color: C.textPrimary },
  pastMeta:      { fontWeight: "400", fontSize: 11, color: C.textTertiary, marginTop: 2 },
  pastFootnote:  { fontWeight: "400", fontSize: 11, lineHeight: 16, color: C.textTertiary, paddingHorizontal: 18, paddingTop: 10, paddingBottom: 12 },
});

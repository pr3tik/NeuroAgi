import { useState, useEffect } from "react";
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from "react-native";
import ScreenWrapper from "../components/ScreenWrapper";
import { supabase } from "../services/supabase";

// Mirrors work.tsx's stand-in until mobile auth/identity is built.
const TEST_USER_ID = "26179287-a074-44cf-94a1-c57a8c70cb51";

function formatDue(dateStr: string | null) {
  if (!dateStr) return null;
  const due = new Date(dateStr);
  const diffDays = Math.round((+due - Date.now()) / 86_400_000);
  if (diffDays < 0)   return { label: "Past due",  urgent: true };
  if (diffDays === 0)  return { label: "Today",     urgent: true };
  if (diffDays === 1)  return { label: "Tomorrow",  urgent: true };
  if (diffDays < 7)    return { label: `In ${diffDays} days`, urgent: false };
  return { label: due.toLocaleDateString("en-US", { month: "short", day: "numeric" }), urgent: false };
}

// Canvas assignment descriptions come as HTML — strip tags for a plain-text
// read until the app has a proper HTML renderer.
function stripHtml(html: string | null) {
  if (!html) return "";
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

type Assignment = {
  id: string;
  name: string;
  description: string | null;
  dueAt: string | null;
  courseName?: string;
  courseCode?: string;
  pointsPossible: number | null;
  submission: { score: number | null; submittedAt: string | null; late: boolean; missing: boolean };
};

function AssignmentRow({ a, onPress }: { a: Assignment; onPress: () => void }) {
  const due = formatDue(a.dueAt);
  const isLate = a.submission.missing || (due?.urgent && !a.submission.submittedAt);

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.7}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.cardTitle} numberOfLines={1}>{a.name}</Text>
        <Text style={styles.cardCourse}>
          {a.courseCode ?? a.courseName ?? ""}
          {a.pointsPossible ? <Text style={styles.cardPoints}>  {a.pointsPossible} pts</Text> : null}
        </Text>
      </View>
      {due && (
        <View style={[styles.badge, isLate && styles.badgeLate]}>
          <Text style={[styles.badgeText, isLate && styles.badgeTextLate]}>{due.label}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

export default function AssignmentScreen() {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Assignment | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const { data: rows } = await supabase
        .from("assignments")
        .select("id, title, description, due_at, points_possible, score, submitted_at, late, missing, courses(name, course_code)")
        .eq("user_id", TEST_USER_ID);
      if (cancelled) return;

      setAssignments((rows ?? []).map((a: any) => ({
        id:             a.id,
        name:           a.title,
        description:    a.description,
        dueAt:          a.due_at,
        courseName:     a.courses?.name,
        courseCode:     a.courses?.course_code,
        pointsPossible: a.points_possible,
        submission:     { score: a.score, submittedAt: a.submitted_at, late: a.late, missing: a.missing },
      })));
      setLoading(false);
    }

    load();
    return () => { cancelled = true; };
  }, []);

  const pending = assignments
    .filter(a => !a.submission.submittedAt)
    .sort((a, b) => {
      if (!a.dueAt && !b.dueAt) return 0;
      if (!a.dueAt) return 1;
      if (!b.dueAt) return -1;
      return +new Date(a.dueAt) - +new Date(b.dueAt);
    });

  if (selected) {
    const due = formatDue(selected.dueAt);
    return (
      <ScreenWrapper page="assignment">
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 16, paddingBottom: 8 }}>
          <TouchableOpacity onPress={() => setSelected(null)}>
            <Text style={styles.back}>←  Assignments</Text>
          </TouchableOpacity>

          <View>
            <Text style={styles.detailTitle}>{selected.name}</Text>
            <Text style={styles.detailCourse}>{selected.courseCode ?? selected.courseName ?? ""}</Text>
          </View>

          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            {due && (
              <View style={[styles.badge, due.urgent && styles.badgeLate]}>
                <Text style={[styles.badgeText, due.urgent && styles.badgeTextLate]}>{due.label}</Text>
              </View>
            )}
            {selected.pointsPossible ? (
              <View style={styles.badge}><Text style={styles.badgeText}>{selected.pointsPossible} pts</Text></View>
            ) : null}
            {selected.submission.submittedAt && (
              <View style={[styles.badge, styles.badgeDone]}>
                <Text style={[styles.badgeText, styles.badgeTextDone]}>SUBMITTED</Text>
              </View>
            )}
          </View>

          <View style={styles.descBox}>
            <Text style={styles.descText}>
              {stripHtml(selected.description) || "No description provided."}
            </Text>
          </View>
        </ScrollView>
      </ScreenWrapper>
    );
  }

  return (
    <ScreenWrapper page="assignment">
      <View style={{ marginBottom: 20 }}>
        <Text style={styles.title}>Assignments</Text>
        <Text style={styles.subtitle}>
          {loading ? "Syncing…" : pending.length > 0 ? `${pending.length} pending` : "You're all caught up"}
        </Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingBottom: 8 }}>
        {pending.length > 0 ? (
          pending.map(a => <AssignmentRow key={a.id} a={a} onPress={() => setSelected(a)} />)
        ) : !loading ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No pending assignments</Text>
          </View>
        ) : null}
      </ScrollView>
    </ScreenWrapper>
  );
}

// tokens.css — the design system Assignment.tsx actually uses on web (not
// Work.tsx's bespoke mobile-redesign palette; that one's page-specific).
const TOKENS = {
  surface:      "rgba(255,255,255,0.05)",
  border:       "rgba(255,255,255,0.08)",
  textPrimary:  "#F5F5F5",
  textSecondary:"rgba(255,255,255,0.45)",
  textDim:      "rgba(255,255,255,0.35)",
  urgentBg:     "rgba(255,59,48,0.1)",
  urgentText:   "rgba(255,100,90,0.85)",
  successBg:    "rgba(52,199,89,0.1)",
  successText:  "rgba(100,220,130,0.85)",
  depthLine:    { boxShadow: "0 1px 0 rgba(255,255,255,0.06)" },
};

const styles = StyleSheet.create({
  title:          { fontSize: 26, fontWeight: "600", color: TOKENS.textPrimary, letterSpacing: -0.3 },
  subtitle:       { fontSize: 14, color: TOKENS.textDim, marginTop: 4 },

  card:           { ...TOKENS.depthLine, backgroundColor: TOKENS.surface, borderWidth: 1, borderColor: TOKENS.border, borderRadius: 16, padding: 18, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  cardTitle:      { fontSize: 15, color: TOKENS.textPrimary, fontWeight: "500", marginBottom: 4 },
  cardCourse:     { fontSize: 12, color: TOKENS.textSecondary },
  cardPoints:     { color: TOKENS.textDim },

  badge:          { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.06)" },
  badgeText:      { fontSize: 11, color: TOKENS.textDim },
  badgeLate:      { backgroundColor: TOKENS.urgentBg },
  badgeTextLate:  { color: TOKENS.urgentText },
  badgeDone:      { backgroundColor: TOKENS.successBg },
  badgeTextDone:  { color: TOKENS.successText },

  emptyCard:      { ...TOKENS.depthLine, backgroundColor: TOKENS.surface, borderWidth: 1, borderColor: TOKENS.border, borderRadius: 16, padding: 24, alignItems: "center" },
  emptyTitle:     { fontSize: 14, color: TOKENS.textSecondary },

  back:           { fontSize: 14, color: TOKENS.textSecondary },
  detailTitle:    { fontSize: 20, fontWeight: "600", color: TOKENS.textPrimary, letterSpacing: -0.2, marginBottom: 6 },
  detailCourse:   { fontSize: 13, color: TOKENS.textSecondary },
  descBox:        { backgroundColor: "rgba(255,255,255,0.03)", borderWidth: 1, borderColor: "rgba(255,255,255,0.06)", borderRadius: 12, padding: 14 },
  descText:       { fontSize: 13, lineHeight: 21, color: TOKENS.textSecondary },
});

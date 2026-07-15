// assignment.tsx — Assignment list → detail view, ported from src/pages/Assignment.tsx.
// Detail view supports AI draft generation (same /api/groq endpoint the web groq()
// helper hits), Copy/Regenerate, a Sources & Reasoning collapsible, and Mark-as-done
// with a best-effort token award (same /api/token-engine endpoint as web awardTokens()).
// Skipped (not portable to RN): text-selection floating toolbar, OfficeHoursPanel,
// monitor-agent nudge.

import { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  // Deprecated in RN core (moving to @react-native-clipboard/clipboard) but still
  // shipped in 0.81 — used here to avoid adding a dependency for one Copy button.
  Clipboard,
} from "react-native";
import { Check, ChevronUp, ChevronDown } from "lucide-react-native";
import ScreenWrapper from "../components/ScreenWrapper";
import { supabase } from "../services/supabase";
import { apiFetch } from "../services/api";
import { useUserId } from "../context/AuthContext";

// Same system prompt as src/pages/Assignment.tsx. The web page also appends
// buildStudentContext() (mock class notes / previous work from src/data/mockData.ts)
// — placeholder data not worth duplicating into the mobile bundle.
const SYSTEM =
  "You are an academic writing assistant. Write thorough, well-structured academic content. Use formal language, clear paragraph structure, and appropriate hedging where needed.";

// ── API helpers (same endpoints the web src/api/* wrappers hit) ──────────────

/** Mirrors src/api/groq.ts — POST /api/groq, returns d.content string. */
async function groq(messages: { role: string; content: string }[], system = "", maxTokens = 1024): Promise<string> {
  const d = await apiFetch("/api/groq", { messages, system, max_tokens: maxTokens });
  return d.content ?? "";
}

/** Mirrors src/api/tokens.ts awardTokens() — server validates and sets the amount. */
async function awardTokens(userId: string, action: string, meta: object = {}) {
  return apiFetch("/api/token-engine?action=award", { userId, action, meta });
}

// ── Formatting helpers ────────────────────────────────────────────────────────

function formatDue(dateStr: string | null) {
  if (!dateStr) return null;
  const due = new Date(dateStr);
  const diffDays = Math.round((+due - Date.now()) / 86_400_000);
  if (diffDays < 0)   return "Past due";
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  if (diffDays < 7)   return `In ${diffDays} days`;
  return due.toLocaleDateString("en-US", { month: "short", day: "numeric" });
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

// Web: isLate = missing || (dueAt in the past && not submitted). "Today"/"Tomorrow"
// pills are NOT red on web — only genuinely late ones are.
function isLateAssignment(a: Assignment) {
  return a.submission.missing || (!!a.dueAt && +new Date(a.dueAt) < Date.now() && !a.submission.submittedAt);
}

function AssignmentRow({ a, onPress }: { a: Assignment; onPress: () => void }) {
  const due = formatDue(a.dueAt);
  const isLate = isLateAssignment(a);

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle} numberOfLines={1}>{a.name}</Text>
        {due && (
          <View style={[styles.badge, isLate && styles.badgeLate]}>
            <Text style={[styles.badgeText, isLate && styles.badgeTextLate]}>{due}</Text>
          </View>
        )}
      </View>
      <View style={styles.cardCourseRow}>
        <Text style={styles.cardCourse}>{a.courseCode ?? a.courseName ?? ""}</Text>
        {a.pointsPossible ? <Text style={styles.cardPoints}>{a.pointsPossible} pts</Text> : null}
      </View>
    </TouchableOpacity>
  );
}

export default function AssignmentScreen() {
  const userId = useUserId();
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Assignment | null>(null);

  // Detail-view state (mirrors the web page)
  const [draft, setDraft] = useState("");
  const [generating, setGenerating] = useState(false);
  const [draftError, setDraftError] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [markedDone, setMarkedDone] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const { data: rows } = await supabase
        .from("assignments")
        .select("id, title, description, due_at, points_possible, score, submitted_at, late, missing, courses(name, course_code)")
        .eq("user_id", userId);
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
  }, [userId]);

  // Real assignments only — unsubmitted, sorted by due date, capped at 20 (web parity).
  const pending = assignments
    .filter(a => !a.submission.submittedAt)
    .sort((a, b) => {
      if (!a.dueAt && !b.dueAt) return 0;
      if (!a.dueAt) return 1;
      if (!b.dueAt) return -1;
      return +new Date(a.dueAt) - +new Date(b.dueAt);
    })
    .slice(0, 20);

  const openAssignment = useCallback((a: Assignment) => {
    setSelected(a);
    setDraft("");
    setDraftError(false);
    setSourcesOpen(false);
    setMarkedDone(false);
  }, []);

  const generateDraft = useCallback(async () => {
    if (!selected || generating) return;
    const prompt = stripHtml(selected.description) || selected.name;
    setGenerating(true);
    setDraftError(false);
    setDraft("");
    try {
      // Same message shape + system prompt as the web page's generateDraftFor().
      const content = await groq(
        [{ role: "user", content: `Write a detailed academic response to this assignment: ${prompt}` }],
        SYSTEM
      );
      setDraft(content);
      if (!content) setDraftError(true);
    } catch {
      setDraftError(true);
    } finally {
      setGenerating(false);
    }
  }, [selected, generating]);

  const markAsDone = useCallback(() => {
    if (!selected || markedDone) return;
    setMarkedDone(true);
    // Best-effort token award — same action + meta as web; never surfaces errors.
    awardTokens(userId, "assignment_submitted", { assignmentId: String(selected.id) }).catch(() => {});
  }, [selected, markedDone, userId]);

  // ── Detail view ─────────────────────────────────────────────────────────────
  if (selected) {
    const due = formatDue(selected.dueAt);
    const isLate = isLateAssignment(selected);
    return (
      <ScreenWrapper page="assignment">
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 8 }}>
          <TouchableOpacity onPress={() => setSelected(null)} style={{ paddingBottom: 16 }}>
            <Text style={styles.back}>←  Assignments</Text>
          </TouchableOpacity>

          <Text style={styles.detailTitle}>{selected.name}</Text>
          <Text style={styles.detailCourse}>{selected.courseCode ?? selected.courseName ?? ""}</Text>

          <View style={styles.badgeRow}>
            {due && (
              <View style={[styles.badge, isLate && styles.badgeLate]}>
                <Text style={[styles.badgeText, isLate && styles.badgeTextLate]}>{due}</Text>
              </View>
            )}
            {selected.pointsPossible ? (
              <View style={styles.badge}><Text style={styles.badgeText}>{selected.pointsPossible} pts</Text></View>
            ) : null}
          </View>

          <View style={styles.descBox}>
            <Text style={styles.descText}>
              {stripHtml(selected.description) || "No description provided."}
            </Text>
          </View>

          {!draft && (
            generating ? (
              <Text style={styles.generatingText}>Generating draft…</Text>
            ) : (
              <View>
                {draftError && (
                  <Text style={styles.draftErrorText}>Draft generation failed — check your connection and try again.</Text>
                )}
                <TouchableOpacity style={styles.generateBtn} onPress={generateDraft} activeOpacity={0.8}>
                  <Text style={styles.generateBtnText}>Generate Draft</Text>
                </TouchableOpacity>
              </View>
            )
          )}

          {!!draft && (
            <>
              <TextInput
                style={styles.draftInput}
                value={draft}
                onChangeText={setDraft}
                multiline
                textAlignVertical="top"
                scrollEnabled={false}
              />

              {/* Sources & Reasoning collapsible */}
              <View style={styles.sourcesBox}>
                <TouchableOpacity
                  style={styles.sourcesHeader}
                  onPress={() => setSourcesOpen(o => !o)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.sourcesHeaderText}>Sources &amp; Reasoning</Text>
                  <View style={{ opacity: 0.5 }}>
                    {sourcesOpen
                      ? <ChevronUp size={14} color={TOKENS.textSecondary} />
                      : <ChevronDown size={14} color={TOKENS.textSecondary} />}
                  </View>
                </TouchableOpacity>
                {sourcesOpen && (
                  <View style={styles.sourcesBody}>
                    <Text style={styles.sourcesBodyText}>
                      This draft was generated from your assignment brief using an AI language model. No external sources were cited automatically — add real academic references before submission.
                    </Text>
                  </View>
                )}
              </View>

              {/* Copy / Regenerate row */}
              <View style={{ flexDirection: "row", gap: 10 }}>
                <TouchableOpacity
                  style={styles.rowBtn}
                  onPress={() => { try { Clipboard.setString(draft); } catch {} }}
                  activeOpacity={0.7}
                >
                  <Text style={styles.rowBtnText}>Copy</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.rowBtn, generating && { opacity: 0.5 }]}
                  onPress={generateDraft}
                  disabled={generating}
                  activeOpacity={0.7}
                >
                  <Text style={styles.rowBtnText}>{generating ? "Regenerating…" : "Regenerate"}</Text>
                </TouchableOpacity>
              </View>

              {/* Mark as done — transparent → green success state, awards tokens */}
              <TouchableOpacity
                style={[styles.doneBtn, markedDone && styles.doneBtnDone]}
                onPress={markAsDone}
                disabled={markedDone}
                activeOpacity={0.7}
              >
                {markedDone ? (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Check size={14} color={TOKENS.successText} />
                    <Text style={[styles.doneBtnText, styles.doneBtnTextDone]}>Marked as done</Text>
                  </View>
                ) : (
                  <Text style={styles.doneBtnText}>Mark as done</Text>
                )}
              </TouchableOpacity>
            </>
          )}
        </ScrollView>
      </ScreenWrapper>
    );
  }

  // ── List view ───────────────────────────────────────────────────────────────
  return (
    <ScreenWrapper page="assignment">
      <View style={{ marginBottom: 28 }}>
        <Text style={styles.title}>Assignments</Text>
        <Text style={styles.subtitle}>
          {loading
            ? "Syncing…"
            : pending.length > 0
            ? `${pending.length} pending assignment${pending.length !== 1 ? "s" : ""}`
            : "You're all caught up"}
        </Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingBottom: 8 }}>
        {pending.length > 0 ? (
          pending.map(a => <AssignmentRow key={a.id} a={a} onPress={() => openAssignment(a)} />)
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
  surfaceHover: "rgba(255,255,255,0.08)",
  border:       "rgba(255,255,255,0.08)",
  accent:       "rgba(255,255,255,0.85)",
  textPrimary:  "#F5F5F5",
  textSecondary:"rgba(255,255,255,0.45)",
  textDim:      "rgba(255,255,255,0.35)",
  urgentBg:     "rgba(255,59,48,0.1)",
  urgentText:   "rgba(255,100,90,0.85)",
  successBg:    "rgba(52,199,89,0.1)",
  successBorder:"rgba(52,199,89,0.3)",
  successText:  "rgba(100,220,130,0.85)",
  depthLine:    { boxShadow: "0 1px 0 rgba(255,255,255,0.06)" },
};

const styles = StyleSheet.create({
  title:          { fontSize: 26, fontWeight: "600", color: TOKENS.textPrimary, letterSpacing: -0.3 },
  subtitle:       { fontSize: 14, color: TOKENS.textDim, marginTop: 4 },

  card:           { ...TOKENS.depthLine, backgroundColor: TOKENS.surface, borderWidth: 1, borderColor: TOKENS.border, borderRadius: 16, padding: 18 },
  cardHeader:     { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 8 },
  cardTitle:      { fontSize: 15, color: TOKENS.textPrimary, fontWeight: "500", flex: 1, minWidth: 0 },
  cardCourseRow:  { flexDirection: "row", alignItems: "center", marginTop: 4 },
  cardCourse:     { fontSize: 12, color: TOKENS.textSecondary },
  cardPoints:     { fontSize: 12, color: TOKENS.textDim, marginLeft: 8 },

  badge:          { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.06)" },
  badgeText:      { fontSize: 11, color: TOKENS.textDim },
  badgeLate:      { backgroundColor: TOKENS.urgentBg },
  badgeTextLate:  { color: TOKENS.urgentText },
  badgeRow:       { flexDirection: "row", gap: 8, flexWrap: "wrap", marginBottom: 16 },

  emptyCard:      { ...TOKENS.depthLine, backgroundColor: TOKENS.surface, borderWidth: 1, borderColor: TOKENS.border, borderRadius: 16, padding: 24, alignItems: "center" },
  emptyTitle:     { fontSize: 14, color: TOKENS.textSecondary },

  back:           { fontSize: 14, color: TOKENS.textSecondary },
  detailTitle:    { fontSize: 20, fontWeight: "600", color: TOKENS.textPrimary, letterSpacing: -0.2, marginBottom: 6 },
  detailCourse:   { fontSize: 13, color: TOKENS.textSecondary, marginBottom: 12 },
  descBox:        { backgroundColor: "rgba(255,255,255,0.03)", borderWidth: 1, borderColor: "rgba(255,255,255,0.06)", borderRadius: 12, padding: 14, marginBottom: 20 },
  descText:       { fontSize: 13, lineHeight: 21, color: TOKENS.textSecondary },

  // Generate Draft — web: accent bg, #111 text, radius-btn 12, padding 12/24
  generateBtn:    { alignSelf: "flex-start", backgroundColor: TOKENS.accent, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 24 },
  generateBtnText:{ fontSize: 14, fontWeight: "600", color: "#111111" },
  generatingText: { fontSize: 13, color: TOKENS.textDim, letterSpacing: 0.3 },
  draftErrorText: { fontSize: 13, color: TOKENS.urgentText, marginBottom: 12 },

  // Draft editor — web textarea: surface bg, border, radius-card 16, padding 20,
  // fontSize 14, lineHeight 1.85 (≈26)
  draftInput:     { backgroundColor: TOKENS.surface, borderWidth: 1, borderColor: TOKENS.border, borderRadius: 16, padding: 20, color: TOKENS.textPrimary, fontSize: 14, lineHeight: 26, minHeight: 320, marginBottom: 14 },

  // Sources & Reasoning collapsible
  sourcesBox:     { backgroundColor: "rgba(255,255,255,0.02)", borderWidth: 1, borderColor: "rgba(255,255,255,0.06)", borderRadius: 12, marginBottom: 16, overflow: "hidden" },
  sourcesHeader:  { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 13, paddingHorizontal: 16 },
  sourcesHeaderText:{ fontSize: 13, color: TOKENS.textSecondary },
  sourcesBody:    { paddingHorizontal: 16, paddingBottom: 14, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.06)" },
  sourcesBodyText:{ fontSize: 13, lineHeight: 21, color: TOKENS.textSecondary, marginTop: 12 },

  // Copy / Regenerate row buttons — web: surface-hover bg, border, radius 12, padding 12
  rowBtn:         { flex: 1, backgroundColor: TOKENS.surfaceHover, borderWidth: 1, borderColor: TOKENS.border, borderRadius: 12, padding: 12, alignItems: "center" },
  rowBtnText:     { fontSize: 14, color: TOKENS.textPrimary },

  // Mark as done — transparent → green success state
  doneBtn:        { marginTop: 10, backgroundColor: "transparent", borderWidth: 1, borderColor: "rgba(255,255,255,0.1)", borderRadius: 12, padding: 11, alignItems: "center" },
  doneBtnDone:    { backgroundColor: TOKENS.successBg, borderColor: TOKENS.successBorder },
  doneBtnText:    { fontSize: 13, color: "rgba(255,255,255,0.35)" },
  doneBtnTextDone:{ color: TOKENS.successText },
});

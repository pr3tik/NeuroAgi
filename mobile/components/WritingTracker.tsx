// WritingTracker.tsx — mobile port of src/components/WritingTracker.tsx.
// Paste a piece of writing and see its profile (readability, vocab, complexity,
// citations), how it changed since last time, a short coaching note, and a
// timeline of past submissions. Calls /api/writing-tracker; feed = writing_snapshots
// table (RLS disabled per supabase-writing-snapshots.sql — anon key reads fine).
//
// No props — self-contained, self-fetching, same signature as the web component.

import { useCallback, useEffect, useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity, ActivityIndicator, StyleSheet,
} from "react-native";
import { PenLine, TrendingUp, ArrowUp, ArrowDown, Sparkles } from "lucide-react-native";
import { supabase } from "../services/supabase";
import { apiFetch } from "../services/api";

// TODO: replace with the real signed-in user once mobile auth exists.
// Mirrors identity.tsx / work.tsx / assignment.tsx — Sarim Khan's real TMU
// account on the same Supabase project.
const TEST_USER_ID = "26179287-a074-44cf-94a1-c57a8c70cb51";

const ACCENT = "#C49A3C";

// tokens.css palette (mirrors identity.tsx's `C`)
const C = {
  textPrimary:   "#F5F5F5",
  textSecondary: "rgba(255,255,255,0.45)",
  textDim:       "rgba(255,255,255,0.35)",
  surface:       "rgba(255,255,255,0.05)",
  surfaceInput:  "rgba(255,255,255,0.05)",
  border:        "rgba(255,255,255,0.08)",
  borderInput:   "rgba(255,255,255,0.09)",
};

interface Metrics {
  words: number; sentences: number; paragraphs: number;
  avgSentenceLength: number; vocabDiversity: number; complexWordRatio: number;
  fleschKincaidGrade: number; citations: number;
}
interface Delta { key: string; label: string; from: number; to: number; delta: number; }
interface Snapshot { id: string; title: string | null; word_count: number; metrics: Metrics; created_at: string; }

const pct = (v: number) => `${Math.round((v ?? 0) * 100)}%`;
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

function metricChips(m: Metrics) {
  return [
    { label: "Words", value: String(m.words) },
    { label: "Reading level", value: `Grade ${m.fleschKincaidGrade}` },
    { label: "Vocabulary", value: pct(m.vocabDiversity) },
    { label: "Complex words", value: pct(m.complexWordRatio) },
    { label: "Words/sentence", value: String(m.avgSentenceLength) },
    { label: "Citations", value: String(m.citations) },
  ];
}

function Chip({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.chip}>
      <Text style={styles.chipValue}>{value}</Text>
      <Text style={styles.chipLabel}>{label}</Text>
    </View>
  );
}

export default function WritingTracker() {
  const [text, setText]       = useState("");
  const [title, setTitle]     = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");
  const [result, setResult]   = useState<{ metrics: Metrics; delta: Delta[]; assessment: string; tip: string } | null>(null);
  const [history, setHistory] = useState<Snapshot[]>([]);

  const loadHistory = useCallback(async () => {
    try {
      const { data } = await supabase
        .from("writing_snapshots")
        .select("id, title, word_count, metrics, created_at")
        .eq("user_id", TEST_USER_ID)
        .order("created_at", { ascending: false })
        .limit(8);
      setHistory(data ?? []);
    } catch { /* table may not exist yet, or the read failed — degrade quietly */ }
  }, []);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  async function analyze() {
    const value = text.trim();
    if (value.length < 40 || loading) { setError(value.length < 40 ? "Paste at least a paragraph." : ""); return; }
    setLoading(true); setError(""); setResult(null);
    try {
      const data = await apiFetch("/api/writing-tracker", {
        userId: TEST_USER_ID, text: value, title: title.trim() || undefined,
      });
      if (!data?.metrics) { setError("Couldn't analyze that. Try again."); }
      else { setResult(data); setText(""); setTitle(""); loadHistory(); }
    } catch { setError("Something went wrong. Try again."); }
    setLoading(false);
  }

  const disabled = loading || text.trim().length < 40;

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <PenLine size={16} color={ACCENT} />
        <Text style={styles.headerTitle}>Writing evolution</Text>
      </View>
      <Text style={styles.headerSubtitle}>
        Paste a draft or essay and I'll profile it and track how your writing grows over time.
      </Text>

      <TextInput
        value={title}
        onChangeText={setTitle}
        placeholder="Title (optional)"
        placeholderTextColor={C.textDim}
        editable={!loading}
        style={styles.titleInput}
      />
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder="Paste your writing here…"
        placeholderTextColor={C.textDim}
        editable={!loading}
        multiline
        numberOfLines={6}
        textAlignVertical="top"
        style={styles.textArea}
      />
      <TouchableOpacity
        onPress={analyze}
        disabled={disabled}
        activeOpacity={0.7}
        style={[styles.analyzeBtn, disabled && styles.analyzeBtnDisabled]}
      >
        {loading ? (
          <>
            <ActivityIndicator size="small" color={C.textDim} />
            <Text style={[styles.analyzeBtnText, styles.analyzeBtnTextDisabled]}>Analyzing…</Text>
          </>
        ) : (
          <>
            <Sparkles size={14} color={disabled ? C.textDim : ACCENT} />
            <Text style={[styles.analyzeBtnText, disabled && styles.analyzeBtnTextDisabled]}>Analyze writing</Text>
          </>
        )}
      </TouchableOpacity>

      {!!error && <Text style={styles.errorText}>{error}</Text>}

      {result && (
        <View style={{ marginTop: 16 }}>
          <View style={styles.chipGrid}>
            {metricChips(result.metrics).map(c => <Chip key={c.label} label={c.label} value={c.value} />)}
          </View>

          {result.delta.length > 0 && (
            <View style={styles.deltaRow}>
              {result.delta.map(d => (
                <View key={d.key} style={styles.deltaItem}>
                  {d.delta > 0
                    ? <ArrowUp size={12} color="rgba(120,220,140,0.9)" />
                    : <ArrowDown size={12} color="rgba(255,160,120,0.9)" />}
                  <Text style={styles.deltaText}>{d.label} vs last</Text>
                </View>
              ))}
            </View>
          )}

          {!!result.assessment && <Text style={styles.assessmentText}>{result.assessment}</Text>}
          {!!result.tip && (
            <View style={styles.tipBox}>
              <Sparkles size={13} color={ACCENT} style={{ marginTop: 2 }} />
              <Text style={styles.tipText}>{result.tip}</Text>
            </View>
          )}
        </View>
      )}

      {history.length > 0 && (
        <View style={styles.timeline}>
          <View style={styles.timelineHeader}>
            <TrendingUp size={13} color={C.textDim} />
            <Text style={styles.timelineHeaderText}>Your writing over time</Text>
          </View>
          <View style={{ gap: 6 }}>
            {history.map(s => (
              <View key={s.id} style={styles.timelineRow}>
                <Text style={styles.timelineTitle} numberOfLines={1}>
                  {s.title || `${s.word_count} words`}
                </Text>
                <Text style={styles.timelineMeta}>
                  Grade {s.metrics?.fleschKincaidGrade ?? "—"} · {pct(s.metrics?.vocabDiversity ?? 0)} vocab
                </Text>
                <Text style={styles.timelineDate}>{fmtDate(s.created_at)}</Text>
              </View>
            ))}
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
    borderRadius: 16, padding: 20, marginBottom: 24,
  },
  headerRow:      { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 3 },
  headerTitle:    { fontFamily: "Inter_600SemiBold", fontSize: 14, color: C.textPrimary },
  headerSubtitle: { fontFamily: "Inter_400Regular", fontSize: 12, color: C.textDim, marginBottom: 14, lineHeight: 17 },

  titleInput: {
    width: "100%", marginBottom: 8, backgroundColor: C.surfaceInput,
    borderWidth: 1, borderColor: C.borderInput, borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 9, color: C.textPrimary,
    fontFamily: "Inter_400Regular", fontSize: 13,
  },
  textArea: {
    width: "100%", backgroundColor: C.surfaceInput, borderWidth: 1, borderColor: C.borderInput,
    borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, color: C.textPrimary,
    fontFamily: "Inter_400Regular", fontSize: 13, lineHeight: 19, minHeight: 110, marginBottom: 10,
  },

  analyzeBtn: {
    flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start",
    paddingVertical: 9, paddingHorizontal: 16, borderRadius: 12,
    backgroundColor: "rgba(196,154,60,0.14)", borderWidth: 1, borderColor: "rgba(196,154,60,0.3)",
  },
  analyzeBtnDisabled: { backgroundColor: "rgba(255,255,255,0.06)", borderColor: C.border },
  analyzeBtnText:         { fontFamily: "Inter_600SemiBold", fontSize: 13, color: ACCENT },
  analyzeBtnTextDisabled: { color: C.textDim },

  errorText: { fontFamily: "Inter_400Regular", fontSize: 12, color: "rgba(255,196,0,0.85)", marginTop: 12 },

  chipGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  chip: {
    flexBasis: "30%", flexGrow: 1, minWidth: 90,
    backgroundColor: "rgba(255,255,255,0.04)", borderWidth: 1, borderColor: "rgba(255,255,255,0.08)",
    borderRadius: 10, paddingVertical: 8, paddingHorizontal: 11,
  },
  chipValue: { fontFamily: "Inter_700Bold", fontSize: 15, color: C.textPrimary },
  chipLabel: { fontFamily: "Inter_400Regular", fontSize: 10, color: C.textDim, letterSpacing: 0.4, textTransform: "uppercase", marginTop: 2 },

  deltaRow:  { flexDirection: "row", flexWrap: "wrap", columnGap: 14, rowGap: 6, marginBottom: 12 },
  deltaItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  deltaText: { fontFamily: "Inter_400Regular", fontSize: 11, color: C.textSecondary },

  assessmentText: { fontFamily: "Inter_400Regular", fontSize: 12.5, color: C.textSecondary, lineHeight: 19, marginBottom: 8 },
  tipBox: {
    flexDirection: "row", gap: 7, backgroundColor: "rgba(196,154,60,0.05)",
    borderWidth: 1, borderColor: "rgba(196,154,60,0.16)", borderRadius: 10,
    paddingVertical: 10, paddingHorizontal: 12,
  },
  tipText: { flex: 1, fontFamily: "Inter_400Regular", fontSize: 12, color: C.textSecondary, lineHeight: 18 },

  timeline:           { marginTop: 18, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.06)", paddingTop: 14 },
  timelineHeader:      { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 10 },
  timelineHeaderText: {
    fontFamily: "Inter_600SemiBold", fontSize: 11, color: C.textDim,
    letterSpacing: 0.5, textTransform: "uppercase",
  },
  timelineRow:   { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  timelineTitle: { flex: 1, minWidth: 0, fontFamily: "Inter_400Regular", fontSize: 12, color: C.textSecondary },
  timelineMeta:  { fontFamily: "Inter_400Regular", fontSize: 12, color: C.textDim, flexShrink: 0 },
  timelineDate:  { fontFamily: "Inter_400Regular", fontSize: 12, color: C.textDim, flexShrink: 0, minWidth: 44, textAlign: "right" },
});

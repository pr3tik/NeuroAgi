// WritingTracker.tsx — paste a piece of writing and see its profile (readability, vocab,
// complexity, citations), how it changed since last time, a short coaching note, and a
// timeline of past submissions. Calls /api/writing-tracker; feed = writing_snapshots table.

import { useState, useEffect, useCallback } from "react";
import { useApp } from "../context/AppContext";
import { supabase } from "../api/supabase";
import { PenLine, TrendingUp, ArrowUp, ArrowDown, Sparkles, Loader2 } from "lucide-react";

interface Metrics {
  words: number; sentences: number; paragraphs: number;
  avgSentenceLength: number; vocabDiversity: number; complexWordRatio: number;
  fleschKincaidGrade: number; citations: number;
}
interface Delta { key: string; label: string; from: number; to: number; delta: number; }
interface Snapshot { id: string; title: string | null; word_count: number; metrics: Metrics; created_at: string; }

const ACCENT = "#C49A3C";
const pct = (v: number) => `${Math.round((v ?? 0) * 100)}%`;
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

function Chip({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
      borderRadius: "10px", padding: "8px 11px", minWidth: 0,
    }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)" }}>{value}</div>
      <div style={{ fontSize: 10, color: "var(--text-dim)", letterSpacing: "0.03em", textTransform: "uppercase", marginTop: 2 }}>{label}</div>
    </div>
  );
}

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

export default function WritingTracker() {
  const { userId } = useApp() as any;
  const [text, setText]       = useState("");
  const [title, setTitle]     = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");
  const [result, setResult]   = useState<{ metrics: Metrics; delta: Delta[]; assessment: string; tip: string } | null>(null);
  const [history, setHistory] = useState<Snapshot[]>([]);

  const loadHistory = useCallback(async () => {
    if (!userId) return;
    try {
      const { data } = await supabase
        .from("writing_snapshots")
        .select("id, title, word_count, metrics, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(8);
      setHistory(data ?? []);
    } catch { /* table may not exist yet */ }
  }, [userId]);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  async function analyze() {
    const value = text.trim();
    if (value.length < 40 || !userId || loading) { setError(value.length < 40 ? "Paste at least a paragraph." : ""); return; }
    setLoading(true); setError(""); setResult(null);
    try {
      const res = await fetch("/api/writing-tracker", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, text: value, title: title.trim() || undefined }),
      });
      const data = res.ok ? await res.json() : null;
      if (!data?.metrics) { setError("Couldn't analyze that. Try again."); }
      else { setResult(data); setText(""); setTitle(""); loadHistory(); }
    } catch { setError("Something went wrong. Try again."); }
    setLoading(false);
  }

  return (
    <div style={{
      background: "var(--color-surface)", border: "1px solid var(--color-border)",
      borderRadius: "var(--radius-card)", boxShadow: "var(--depth-line)",
      padding: "20px", marginBottom: "24px",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
        <PenLine size={16} style={{ color: ACCENT }} />
        <p style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)", margin: 0 }}>Writing evolution</p>
      </div>
      <p style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 14 }}>
        Paste a draft or essay and I'll profile it and track how your writing grows over time.
      </p>

      <input
        value={title}
        onChange={e => setTitle(e.target.value)}
        placeholder="Title (optional)"
        disabled={loading}
        style={{
          width: "100%", marginBottom: 8, background: "rgba(255,255,255,0.05)",
          border: "1px solid rgba(255,255,255,0.09)", borderRadius: "var(--radius-btn)",
          padding: "9px 12px", color: "var(--text-primary)", fontSize: 13, outline: "none", fontFamily: "inherit",
        }}
      />
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder="Paste your writing here…"
        disabled={loading}
        rows={6}
        style={{
          width: "100%", boxSizing: "border-box", background: "rgba(255,255,255,0.05)",
          border: "1px solid rgba(255,255,255,0.09)", borderRadius: "var(--radius-btn)",
          padding: "10px 12px", color: "var(--text-primary)", fontSize: 13, outline: "none",
          fontFamily: "inherit", resize: "vertical", lineHeight: 1.5, marginBottom: 10,
        }}
      />
      <button
        onClick={analyze}
        disabled={loading || text.trim().length < 40}
        style={{
          padding: "9px 16px", borderRadius: "var(--radius-btn)",
          background: loading || text.trim().length < 40 ? "rgba(255,255,255,0.06)" : "rgba(196,154,60,0.14)",
          border:     loading || text.trim().length < 40 ? "1px solid rgba(255,255,255,0.08)" : "1px solid rgba(196,154,60,0.3)",
          color:      loading || text.trim().length < 40 ? "var(--text-dim)" : ACCENT,
          fontSize: 13, fontWeight: 600, cursor: loading || text.trim().length < 40 ? "default" : "pointer",
          fontFamily: "inherit", display: "inline-flex", alignItems: "center", gap: 6,
        }}
      >
        {loading ? <><Loader2 size={14} />Analyzing…</> : <><Sparkles size={14} />Analyze writing</>}
      </button>

      {error && <p style={{ fontSize: 12, color: "rgba(255,196,0,0.85)", marginTop: 12 }}>{error}</p>}

      {result && (
        <div style={{ marginTop: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(90px, 1fr))", gap: 8, marginBottom: 12 }}>
            {metricChips(result.metrics).map(c => <Chip key={c.label} label={c.label} value={c.value} />)}
          </div>

          {result.delta.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px", marginBottom: 12 }}>
              {result.delta.map(d => (
                <span key={d.key} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--text-secondary)" }}>
                  {d.delta > 0 ? <ArrowUp size={12} style={{ color: "rgba(120,220,140,0.9)" }} /> : <ArrowDown size={12} style={{ color: "rgba(255,160,120,0.9)" }} />}
                  {d.label} vs last
                </span>
              ))}
            </div>
          )}

          {result.assessment && (
            <p style={{ fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.55, margin: "0 0 8px" }}>{result.assessment}</p>
          )}
          {result.tip && (
            <div style={{ background: "rgba(196,154,60,0.05)", border: "1px solid rgba(196,154,60,0.16)", borderRadius: "10px", padding: "10px 12px", display: "flex", gap: 7 }}>
              <Sparkles size={13} style={{ color: ACCENT, flexShrink: 0, marginTop: 2 }} />
              <p style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.5, margin: 0 }}>{result.tip}</p>
            </div>
          )}
        </div>
      )}

      {/* Timeline */}
      {history.length > 0 && (
        <div style={{ marginTop: 18, borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
            <TrendingUp size={13} style={{ color: "var(--text-dim)" }} />
            <p style={{ fontSize: 11, color: "var(--text-dim)", fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase", margin: 0 }}>
              Your writing over time
            </p>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {history.map(s => (
              <div key={s.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, fontSize: 12 }}>
                <span style={{ color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>
                  {s.title || `${s.word_count} words`}
                </span>
                <span style={{ color: "var(--text-dim)", flexShrink: 0 }}>
                  Grade {s.metrics?.fleschKincaidGrade ?? "—"} · {pct(s.metrics?.vocabDiversity ?? 0)} vocab
                </span>
                <span style={{ color: "var(--text-dim)", flexShrink: 0, minWidth: 44, textAlign: "right" }}>{fmtDate(s.created_at)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ContentConnector.tsx — paste a link or text the student is consuming outside class and
// the agent surfaces concrete ties to the concepts/courses in their own materials. Calls
// /api/content-connector and keeps a feed of past connections (content_connections table).

import { useState, useEffect, useCallback } from "react";
import { useApp } from "../context/AppContext";
import { supabase } from "../api/supabase";
import { detectSourceType } from "../lib/contentConnector";
import { Link2, Sparkles, BookOpen, Loader2 } from "lucide-react";

interface Connection { concept: string; course: string; explanation: string; }
interface FeedRow {
  id: string; source_url: string | null; source_title: string | null;
  content_summary: string | null; connections: Connection[]; created_at: string;
}

function ConnectionCard({ c }: { c: Connection }) {
  return (
    <div style={{
      background: "rgba(196,154,60,0.05)", border: "1px solid rgba(196,154,60,0.16)",
      borderRadius: "10px", padding: "10px 12px",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
        <BookOpen size={13} style={{ color: "#C49A3C", flexShrink: 0 }} />
        <span style={{ fontSize: 12, fontWeight: 600, color: "#C49A3C" }}>
          {c.concept}{c.course ? ` · ${c.course}` : ""}
        </span>
      </div>
      <p style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.5, margin: 0 }}>{c.explanation}</p>
    </div>
  );
}

export default function ContentConnector() {
  const { userId } = useApp() as any;
  const [input, setInput]     = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");
  const [result, setResult]   = useState<{ sourceTitle: string; summary: string; connections: Connection[] } | null>(null);
  const [feed, setFeed]       = useState<FeedRow[]>([]);

  const loadFeed = useCallback(async () => {
    if (!userId) return;
    try {
      const { data } = await supabase
        .from("content_connections")
        .select("id, source_url, source_title, content_summary, connections, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(8);
      setFeed(data ?? []);
    } catch { /* table may not exist yet */ }
  }, [userId]);

  useEffect(() => { loadFeed(); }, [loadFeed]);

  async function connect() {
    const value = input.trim();
    if (!value || !userId || loading) return;
    setLoading(true); setError(""); setResult(null);
    try {
      const kind = detectSourceType(value);
      const body = kind === "text" ? { userId, text: value } : { userId, url: value };
      const res  = await fetch("/api/content-connector", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const data = res.ok ? await res.json() : null;
      if (!data) { setError("Couldn't analyze that. Try again."); }
      else if (!data.connections?.length) {
        setError(data.reason ? data.reason : "No clear connection to your courses — try material closer to what you're studying, or upload your notes first.");
      } else {
        setResult({ sourceTitle: data.sourceTitle ?? "", summary: data.summary ?? "", connections: data.connections });
        setInput("");
        loadFeed();
      }
    } catch {
      setError("Something went wrong. Try again.");
    }
    setLoading(false);
  }

  return (
    <div style={{
      background: "var(--color-surface)", border: "1px solid var(--color-border)",
      borderRadius: "var(--radius-card)", boxShadow: "var(--depth-line)",
      padding: "20px", marginBottom: "24px",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
        <Link2 size={16} style={{ color: "#C49A3C" }} />
        <p style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)", margin: 0 }}>Connect it to your courses</p>
      </div>
      <p style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 14 }}>
        Paste a link or some text you're reading or watching, and I'll tie it to what you're studying.
      </p>

      <div style={{ display: "flex", gap: 8, marginBottom: result || error ? 14 : 0 }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") connect(); }}
          placeholder="Paste a link or text…"
          disabled={loading}
          style={{
            flex: 1, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.09)",
            borderRadius: "var(--radius-btn)", padding: "9px 12px", color: "var(--text-primary)",
            fontSize: 13, outline: "none", fontFamily: "inherit", opacity: loading ? 0.5 : 1,
          }}
          onFocus={e => (e.target.style.borderColor = "rgba(255,255,255,0.22)")}
          onBlur={e  => (e.target.style.borderColor = "rgba(255,255,255,0.09)")}
        />
        <button
          onClick={connect}
          disabled={loading || !input.trim()}
          style={{
            padding: "9px 14px", borderRadius: "var(--radius-btn)",
            background: loading || !input.trim() ? "rgba(255,255,255,0.06)" : "rgba(196,154,60,0.14)",
            border:     loading || !input.trim() ? "1px solid rgba(255,255,255,0.08)" : "1px solid rgba(196,154,60,0.3)",
            color:      loading || !input.trim() ? "var(--text-dim)" : "#C49A3C",
            fontSize: 13, fontWeight: 600, cursor: loading || !input.trim() ? "default" : "pointer",
            fontFamily: "inherit", whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: 6,
          }}
        >
          {loading
            ? <><Loader2 size={14} />Connecting…</>
            : <><Sparkles size={14} />Connect</>}
        </button>
      </div>

      {error && <p style={{ fontSize: 12, color: "rgba(255,196,0,0.85)", margin: 0 }}>{error}</p>}

      {result && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {result.summary && <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: "0 0 2px" }}>{result.summary}</p>}
          {result.connections.map((c, i) => <ConnectionCard key={i} c={c} />)}
        </div>
      )}

      {/* Recent connections feed */}
      {feed.length > 0 && (
        <div style={{ marginTop: 18, borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 14 }}>
          <p style={{ fontSize: 11, color: "var(--text-dim)", fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase", marginBottom: 10 }}>
            Recent connections
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {feed.map(row => (
              <div key={row.id}>
                {(row.source_title || row.source_url) && (
                  <p style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {row.source_title || row.source_url}
                  </p>
                )}
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {(row.connections ?? []).map((c, i) => <ConnectionCard key={i} c={c} />)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

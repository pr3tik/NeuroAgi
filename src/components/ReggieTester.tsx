// ReggieTester — a self-contained dev panel to exercise Reggie (POST /api/agent-manager)
// from the browser. It does NOT touch the live tutor (NeuralRing); it's a separate
// launcher (bottom-left) so you can chat with the agent-manager loop and see which
// specialist it routed to + the exact tool calls it made. Gated to local dev, or any
// deployment via ?reggie=1, so normal users never see it.
import { useEffect, useRef, useState } from "react";
import { useApp } from "../context/AppContext";

interface Turn {
  role: "you" | "reggie";
  text: string;
  route?: string;
  steps?: number;
  budgetExhausted?: boolean;
  brainContextUsed?: boolean;
  toolCalls?: Array<{ name: string; ok: boolean; preview: string; input?: any }>;
  error?: boolean;
}

// TEMPORARILY always-on so it's easy to find while testing — the "🤖 Reggie β" launcher
// sits bottom-left on the logged-in app shell. Re-gate behind a dev/feature flag before
// any public launch (it shouldn't ship to real users long-term).
export default function ReggieTester() {
  return <Panel />;
}

function Panel() {
  const { userId } = useApp();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [loading, setLoading] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  // Diagnostic: confirms in DevTools that the panel actually mounted (and whether a
  // userId is present). If you don't see this log, you're on a stale build/branch.
  useEffect(() => {
    console.log("[ReggieTester] mounted — look bottom-left for '🤖 Reggie β'. userId:", userId || "(not logged in)");
  }, [userId]);

  const scroll = () => requestAnimationFrame(() => { if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight; });

  async function send() {
    const message = input.trim();
    if (!message || loading) return;
    if (!userId) { setTurns((t) => [...t, { role: "reggie", text: "Not logged in — Reggie needs a real userId (log in first).", error: true }]); return; }
    // Prior turns become conversation memory (text only; skip error bubbles).
    const history = turns
      .filter((t) => !t.error)
      .map((t) => ({ role: t.role === "you" ? "user" : "assistant", content: t.text }));
    setInput("");
    setTurns((t) => [...t, { role: "you", text: message }]);
    setLoading(true);
    scroll();
    try {
      const res = await fetch("/api/agent-manager", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, message, history }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body?.ok === false) {
        setTurns((t) => [...t, { role: "reggie", text: body?.error || `HTTP ${res.status}`, error: true }]);
      } else {
        setTurns((t) => [...t, {
          role: "reggie", text: body.output || "(empty answer)",
          route: body.route, steps: body.steps, budgetExhausted: body.budgetExhausted,
          brainContextUsed: body.brainContextUsed, toolCalls: body.toolCalls || [],
        }]);
      }
    } catch (e: any) {
      setTurns((t) => [...t, { role: "reggie", text: e?.message || "request failed", error: true }]);
    } finally {
      setLoading(false);
      scroll();
    }
  }

  const C = {
    bg: "#0f1115", panel: "#171a21", border: "1px solid rgba(255,255,255,0.1)", text: "#e8e8ea",
    dim: "rgba(255,255,255,0.5)", accent: "#7c9cff", ok: "#30d158", err: "#ff6b5a",
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} title="Test Reggie (agent-manager)"
        style={{ position: "fixed", left: 16, bottom: 16, zIndex: 99998, background: C.panel, color: C.text, border: C.border, borderRadius: 999, padding: "10px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer", boxShadow: "0 6px 24px rgba(0,0,0,0.4)", fontFamily: "inherit" }}>
        🤖 Reggie β
      </button>
    );
  }

  return (
    <div style={{ position: "fixed", left: 16, bottom: 16, zIndex: 99998, width: 400, maxWidth: "92vw", height: "72vh", maxHeight: 620, background: C.bg, border: C.border, borderRadius: 14, display: "flex", flexDirection: "column", boxShadow: "0 12px 48px rgba(0,0,0,0.5)", fontFamily: "inherit", color: C.text }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", borderBottom: C.border }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>🤖 Reggie <span style={{ color: C.dim, fontWeight: 500 }}>· /api/agent-manager (beta test)</span></div>
        <div>
          <button onClick={() => setTurns([])} title="Clear" style={{ background: "none", border: "none", color: C.dim, cursor: "pointer", fontSize: 12, marginRight: 8 }}>clear</button>
          <button onClick={() => setOpen(false)} style={{ background: "none", border: "none", color: C.dim, cursor: "pointer", fontSize: 18, lineHeight: 1 }}>×</button>
        </div>
      </div>

      <div ref={listRef} style={{ flex: 1, overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
        {turns.length === 0 && (
          <div style={{ color: C.dim, fontSize: 13, lineHeight: 1.5 }}>
            Ask Reggie something and watch which specialist it routes to and which tools it calls. It remembers this conversation (use "clear" to reset).<br /><br />
            Try: <em>"how am I doing in my courses and what should I study?"</em>, <em>"quiz me on chapter 3"</em>, <em>"plan my week"</em>, <em>"what if I move my exam up a week"</em>.
            {!userId && <div style={{ color: C.err, marginTop: 10 }}>⚠ Not logged in — log in first (Reggie needs a real userId).</div>}
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} style={{ alignSelf: t.role === "you" ? "flex-end" : "flex-start", maxWidth: "94%" }}>
            <div style={{ fontSize: 10, color: C.dim, marginBottom: 3, textAlign: t.role === "you" ? "right" : "left" }}>
              {t.role === "you" ? "you" : "reggie"}
              {t.route && <span style={{ color: C.accent, marginLeft: 6 }}>→ {t.route}</span>}
              {t.brainContextUsed && <span style={{ color: C.dim, marginLeft: 6 }}>· brain ✓</span>}
              {t.budgetExhausted && <span style={{ color: C.err, marginLeft: 6 }}>· budget hit</span>}
            </div>
            <div style={{ background: t.role === "you" ? "#2a3350" : (t.error ? "rgba(255,107,90,0.12)" : C.panel), border: C.border, borderRadius: 10, padding: "8px 11px", fontSize: 13, lineHeight: 1.5, whiteSpace: "pre-wrap", color: t.error ? C.err : C.text }}>
              {t.text}
            </div>
            {t.toolCalls && t.toolCalls.length > 0 && (
              <details style={{ marginTop: 4 }}>
                <summary style={{ fontSize: 11, color: C.dim, cursor: "pointer" }}>{t.toolCalls.length} tool call{t.toolCalls.length > 1 ? "s" : ""}</summary>
                <div style={{ marginTop: 4, display: "flex", flexDirection: "column", gap: 4 }}>
                  {t.toolCalls.map((tc, j) => (
                    <div key={j} style={{ fontSize: 11, fontFamily: "ui-monospace, monospace", background: "rgba(255,255,255,0.04)", borderRadius: 6, padding: "5px 7px" }}>
                      <span style={{ color: tc.ok ? C.ok : C.err }}>{tc.ok ? "✓" : "✗"}</span>{" "}
                      <span style={{ color: C.accent }}>{tc.name}</span>
                      {tc.input && Object.keys(tc.input).length > 0 && <span style={{ color: C.dim }}> {JSON.stringify(tc.input).slice(0, 80)}</span>}
                      <div style={{ color: C.dim, marginTop: 2 }}>{String(tc.preview).slice(0, 160)}</div>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        ))}
        {loading && <div style={{ color: C.dim, fontSize: 13 }}>Reggie is thinking… (routing → tools → answer)</div>}
      </div>

      <div style={{ display: "flex", gap: 8, padding: 10, borderTop: C.border }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder="Ask Reggie…"
          disabled={loading}
          style={{ flex: 1, background: C.panel, border: C.border, borderRadius: 9, padding: "9px 11px", color: C.text, fontSize: 13, outline: "none", fontFamily: "inherit" }}
        />
        <button onClick={send} disabled={loading || !input.trim()} style={{ background: loading || !input.trim() ? "rgba(124,156,255,0.4)" : C.accent, color: "#0b0c0f", border: "none", borderRadius: 9, padding: "0 16px", fontSize: 13, fontWeight: 700, cursor: loading || !input.trim() ? "default" : "pointer", fontFamily: "inherit" }}>
          Send
        </button>
      </div>
    </div>
  );
}

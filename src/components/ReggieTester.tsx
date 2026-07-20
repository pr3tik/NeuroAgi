// ReggieTester — a self-contained dev panel to exercise Reggie (POST /api/agent-manager)
// from the browser. It does NOT touch the live tutor (NeuralRing); it's a separate
// launcher (bottom-left) so you can chat with the agent-manager loop and see which
// specialist it routed to + the exact tool calls it made. Gated to local dev, or any
// deployment via ?reggie=1, so normal users never see it.
import { useEffect, useRef, useState } from "react";
import { useApp } from "../context/AppContext";
import { streamReggie } from "../lib/reggieStream";

interface Turn {
  role: "you" | "reggie";
  text: string;
  route?: string;
  steps?: number;
  budgetExhausted?: boolean;
  brainContextUsed?: boolean;
  toolCalls?: Array<{ name: string; ok: boolean; preview: string; input?: any; pending?: boolean }>;
  error?: boolean;
  streaming?: boolean;
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
  // Trace lookup (turn observability — "where did Reggie grab its data?")
  const [traceOpen, setTraceOpen]   = useState(false);
  const [traceQuery, setTraceQuery] = useState("");
  const [traceBusy, setTraceBusy]   = useState(false);
  const [traceResult, setTraceResult] = useState<string | null>(null);

  async function lookupTrace() {
    const id = traceQuery.trim();
    if (!id || traceBusy) return;
    setTraceBusy(true); setTraceResult(null);
    try {
      const r = await fetch(`/api/agent-manager?traceId=${encodeURIComponent(id)}`);
      const d = await r.json().catch(() => ({}));
      setTraceResult(r.ok ? JSON.stringify(d.runs, null, 2) : `⚠ ${d?.error ?? `lookup failed (${r.status})`}`);
    } catch (e: any) {
      setTraceResult(`⚠ ${e?.message ?? "lookup failed"}`);
    } finally {
      setTraceBusy(false);
    }
  }
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
    setTurns((t) => [...t, { role: "you", text: message }, { role: "reggie", text: "", streaming: true, toolCalls: [] }]);
    setLoading(true);
    scroll();
    // Patch the in-flight (last) reggie turn as stream events arrive.
    const patch = (fn: (t: Turn) => Turn) => setTurns((ts) => {
      const c = [...ts];
      for (let i = c.length - 1; i >= 0; i--) { if (c[i].role === "reggie") { c[i] = fn(c[i]); break; } }
      return c;
    });
    try {
      await streamReggie(
        { userId, message, history },
        {
          onRoute:      (route) => patch((t) => ({ ...t, route })),
          onToken:      (d) => { patch((t) => ({ ...t, text: (t.text || "") + d })); scroll(); },
          onReset:      () => patch((t) => ({ ...t, text: "" })),
          onToolCall:   (name, input) => { patch((t) => ({ ...t, toolCalls: [...(t.toolCalls || []), { name, input, ok: true, preview: "running…", pending: true }] })); scroll(); },
          onToolResult: (name, ok) => patch((t) => {
            const tc = [...(t.toolCalls || [])];
            for (let i = tc.length - 1; i >= 0; i--) { if (tc[i].name === name && tc[i].pending) { tc[i] = { ...tc[i], ok, pending: false }; break; } }
            return { ...t, toolCalls: tc };
          }),
          onDone:       (r) => patch((t) => ({
            ...t, streaming: false, text: r.output || t.text || "(empty answer)",
            route: r.route, steps: r.steps, budgetExhausted: r.budgetExhausted,
            brainContextUsed: r.brainContextUsed, toolCalls: r.toolCalls?.length ? r.toolCalls : t.toolCalls,
          })),
          onError:      (m) => patch((t) => ({ ...t, streaming: false, error: !t.text, text: t.text ? `${t.text}\n\n⚠ ${m}` : m })),
        },
      );
    } catch (e: any) {
      patch((t) => ({ ...t, streaming: false, error: true, text: e?.message || "request failed" }));
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
          <button onClick={() => setTraceOpen(v => !v)} title="Look up a turn by its trace ID" style={{ background: "none", border: "none", color: traceOpen ? C.accent : C.dim, cursor: "pointer", fontSize: 12, marginRight: 8 }}>trace</button>
          <button onClick={() => setTurns([])} title="Clear" style={{ background: "none", border: "none", color: C.dim, cursor: "pointer", fontSize: 12, marginRight: 8 }}>clear</button>
          <button onClick={() => setOpen(false)} style={{ background: "none", border: "none", color: C.dim, cursor: "pointer", fontSize: 18, lineHeight: 1 }}>×</button>
        </div>
      </div>

      {/* Trace lookup — paste the traceId from any Reggie answer (⧉ trace chip) to see
          the persisted turn log: route, tools called, and the documents it drew from. */}
      {traceOpen && (
        <div style={{ padding: "10px 12px", borderBottom: C.border, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", gap: 6 }}>
            <input value={traceQuery} onChange={e => setTraceQuery(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") lookupTrace(); }}
              placeholder="paste a traceId…"
              style={{ flex: 1, background: "rgba(255,255,255,0.06)", border: C.border, borderRadius: 8, padding: "6px 9px", color: C.text, fontSize: 12, fontFamily: "ui-monospace, monospace", outline: "none" }} />
            <button onClick={lookupTrace} disabled={traceBusy} style={{ background: C.panel, border: C.border, borderRadius: 8, padding: "6px 12px", color: C.accent, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>{traceBusy ? "…" : "Look up"}</button>
          </div>
          {traceResult && (
            <pre style={{ margin: 0, maxHeight: 180, overflow: "auto", background: "rgba(255,255,255,0.04)", borderRadius: 8, padding: "8px 10px", fontSize: 10.5, lineHeight: 1.5, color: C.text, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{traceResult}</pre>
          )}
        </div>
      )}

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
              {t.text}{t.streaming ? " ▍" : ""}
            </div>
            {t.toolCalls && t.toolCalls.length > 0 && (
              <details style={{ marginTop: 4 }} open={t.streaming}>
                <summary style={{ fontSize: 11, color: C.dim, cursor: "pointer" }}>{t.toolCalls.length} tool call{t.toolCalls.length > 1 ? "s" : ""}</summary>
                <div style={{ marginTop: 4, display: "flex", flexDirection: "column", gap: 4 }}>
                  {t.toolCalls.map((tc, j) => (
                    <div key={j} style={{ fontSize: 11, fontFamily: "ui-monospace, monospace", background: "rgba(255,255,255,0.04)", borderRadius: 6, padding: "5px 7px" }}>
                      <span style={{ color: tc.pending ? C.accent : tc.ok ? C.ok : C.err }}>{tc.pending ? "⋯" : tc.ok ? "✓" : "✗"}</span>{" "}
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
        {loading && !turns.some((t) => t.streaming && (t.text || (t.toolCalls?.length))) && (
          <div style={{ color: C.dim, fontSize: 13 }}>Reggie is routing…</div>
        )}
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

// ActivityReceipt.tsx — the premium "work receipt" shared by every Reggie surface
// (orb chat + full-screen Reggie page). One pill per answer: live it narrates the
// current step; done it collapses to a source count; expanded it shows the full
// timeline in pull order with every source, then the answer's numbered source list.

import { useState } from "react";
import { Sparkles } from "lucide-react";

export function ActivityDropdown({ steps, live, sources, traceId }: {
  steps: any[]; live: boolean;
  sources?: Array<{ title: string; heading?: string | null; loc?: string | null }>;
  traceId?: string | null;
}) {
  const [open, setOpen] = useState(false);
  if (!steps?.length) return null;
  const running = steps.find(s => s.status === "running");
  const srcCount = sources?.length ?? steps.reduce((n, s) => n + (s.sources?.length || 0), 0);
  const label = live && running ? `${running.label}…`
    : srcCount > 0 ? `Pulled from ${srcCount} source${srcCount > 1 ? "s" : ""}`
    : `Worked through ${steps.length} step${steps.length > 1 ? "s" : ""}`;
  return (
    <div style={{ marginBottom: 8, fontSize: 12 }}>
      <button onClick={() => setOpen(o => !o)} style={{
        display: "inline-flex", alignItems: "center", gap: 7,
        background: open ? "rgba(var(--teal-rgb),0.1)" : "rgba(255,255,255,0.05)",
        border: `1px solid ${open ? "rgba(var(--teal-rgb),0.3)" : "rgba(255,255,255,0.1)"}`,
        borderRadius: 10, padding: "5px 11px", color: "var(--text-secondary)",
        cursor: "pointer", fontFamily: "inherit", fontSize: 12, transition: "background 0.15s, border-color 0.15s",
      }}>
        {live && running ? <span className="nr-dot" /> : <Sparkles size={11} color="rgb(var(--teal-rgb))" />}
        <span>{label}</span>
        <span style={{ opacity: 0.5, fontSize: 10 }}>{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div style={{
          marginTop: 7, background: "rgba(10,11,20,0.55)", border: "1px solid rgba(255,255,255,0.09)",
          borderRadius: 12, padding: "11px 13px", display: "flex", flexDirection: "column", gap: 8,
        }}>
          {/* The work, in the order it happened */}
          {steps.map((st, i) => (
            <div key={i} style={{ display: "flex", gap: 9 }}>
              <span style={{
                flexShrink: 0, width: 16, height: 16, borderRadius: "50%", marginTop: 1,
                display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9,
                background: st.status === "error" ? "rgba(255,100,90,0.15)" : "rgba(var(--teal-rgb),0.14)",
                border: `1px solid ${st.status === "error" ? "rgba(255,100,90,0.4)" : "rgba(var(--teal-rgb),0.35)"}`,
                color: st.status === "error" ? "rgba(255,120,110,0.95)" : "rgb(var(--teal-rgb))",
              }}>{st.status === "running" ? "…" : st.status === "error" ? "!" : "✓"}</span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ color: "var(--text-secondary)", fontWeight: 500 }}>{st.label}</div>
                {st.sources?.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 3 }}>
                    {st.sources.map((x: any, xi: number) => (
                      <span key={xi} style={{ color: "var(--text-dim)", fontSize: 11.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        <span style={{ opacity: 0.55, fontVariantNumeric: "tabular-nums" }}>{xi + 1}.</span> {x.title}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
          {/* The answer's final source list, in pull order */}
          {sources && sources.length > 0 && (
            <div style={{ borderTop: "1px solid rgba(255,255,255,0.07)", paddingTop: 8, display: "flex", flexDirection: "column", gap: 3 }}>
              <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--text-dim)" }}>Sources</span>
              {sources.map((s, si) => (
                <span key={si} title={s.heading || s.title} style={{ color: "var(--text-secondary)", fontSize: 11.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  <span style={{ color: "rgb(var(--teal-rgb))", fontVariantNumeric: "tabular-nums" }}>{si + 1}</span>
                  <span style={{ opacity: 0.4 }}> · </span>{s.title}{s.loc ? <span style={{ opacity: 0.55 }}> · p.{s.loc}</span> : null}
                </span>
              ))}
            </div>
          )}
          {traceId && (
            <button
              onClick={() => { try { navigator.clipboard.writeText(traceId); } catch {} }}
              title={`Copy trace ID: ${traceId}`}
              style={{ alignSelf: "flex-start", fontSize: 9.5, padding: "2px 8px", borderRadius: 20, background: "none", border: "1px dashed rgba(255,255,255,0.15)", color: "var(--text-dim)", cursor: "pointer", fontFamily: "inherit" }}
            >⧉ copy trace</button>
          )}
        </div>
      )}
    </div>
  );
}

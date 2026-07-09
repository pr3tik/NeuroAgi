// WaitlistInline — the hero's focal waitlist capture. Design intent: within the
// Apple-light system, this is THE object in the hero — a single joined pill (input +
// button as one control) wrapped in a soft gradient ring with a blue ambient glow,
// a live "N in line" eyebrow chip (real scarcity, from ?action=stats), one entrance
// "breath" to draw the eye, and a slow sheen sweep across the button. Restraint
// everywhere else so the one glowing control carries the hero.
import { useEffect, useState } from "react";

const FONT = "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', 'Helvetica Neue', sans-serif";

const CSS = `
@keyframes wlBreath {
  0%, 100% { box-shadow: 0 6px 26px rgba(0,113,227,0.16), 0 1px 3px rgba(0,0,0,0.05); }
  50%      { box-shadow: 0 10px 42px rgba(0,113,227,0.32), 0 1px 3px rgba(0,0,0,0.05); }
}
@keyframes wlSheen {
  0%, 72%  { transform: translateX(-130%) skewX(-18deg); }
  92%, 100%{ transform: translateX(230%)  skewX(-18deg); }
}
@keyframes wlDot {
  0%, 100% { opacity: 1; transform: scale(1); }
  50%      { opacity: 0.45; transform: scale(0.78); }
}
@keyframes wlPop {
  0%   { transform: scale(0.6); opacity: 0; }
  70%  { transform: scale(1.08); }
  100% { transform: scale(1); opacity: 1; }
}
`;

function ensureCss() {
  if (typeof document === "undefined" || document.getElementById("wl-inline-css")) return;
  const tag = document.createElement("style");
  tag.id = "wl-inline-css";
  tag.textContent = CSS;
  document.head.appendChild(tag);
}

export default function WaitlistInline({ source = "landing-hero", inRow = false }: { source?: string; inRow?: boolean }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [result, setResult] = useState<{ position: number; total: number; alreadyJoined: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const [total, setTotal] = useState<number | null>(null);

  useEffect(() => {
    ensureCss();
    fetch("/api/waitlist?action=stats").then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (d && typeof d.total === "number" && d.total > 25) setTotal(d.total);   // only once it's flattering
    }).catch(() => {});
  }, []);

  async function join() {
    if (state !== "idle" || !email.trim()) return;
    setError(null);
    setState("sending");
    try {
      const r = await fetch("/api/waitlist?action=join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), source }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || d?.error) throw new Error(d?.error || `HTTP ${r.status}`);
      setResult({ position: d.position, total: d.total, alreadyJoined: !!d.alreadyJoined });
      setState("done");
    } catch (e: any) {
      setError(e?.message ?? "Something went wrong — try again.");
      setState("idle");
    }
  }

  // ── Success: a small celebration, same footprint ──────────────────────────
  if (state === "done") {
    return (
      <div style={{ marginTop: inRow ? 0 : 20, fontFamily: FONT, flex: inRow ? "1 1 160px" : undefined, minWidth: inRow ? 0 : undefined }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 10, background: "linear-gradient(135deg, rgba(0,113,227,0.09), rgba(64,200,255,0.08))", border: "1px solid rgba(0,113,227,0.28)", borderRadius: 980, padding: "11px 20px", animation: "wlPop 0.5s cubic-bezier(0.34,1.56,0.64,1) both" }}>
          <span style={{ width: 20, height: 20, borderRadius: "50%", background: "linear-gradient(135deg,#0071e3,#33a1ff)", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <svg width="11" height="11" viewBox="0 0 18 18" fill="none"><path d="M3.5 9l4 4 7-7" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </span>
          <span style={{ fontSize: 15, color: "#1d1d1f", whiteSpace: "nowrap" }}>
            {result?.alreadyJoined ? "Spot saved — " : "You're in — "}
            <b>#{result?.position?.toLocaleString?.()}</b> in line. Check your inbox.
          </span>
        </div>
      </div>
    );
  }

  return (
    <div style={{ marginTop: inRow ? 0 : 20, fontFamily: FONT, flex: inRow ? "1 1 200px" : undefined, minWidth: inRow ? 0 : undefined, position: "relative" }}>
      {/* Eyebrow chip — live scarcity, floats above the pill without moving it */}
      <div style={{ position: "absolute", bottom: "calc(100% + 7px)", left: 6, display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
        <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: "50%", background: "#30d158", animation: "wlDot 1.8s ease-in-out infinite", flexShrink: 0 }} />
        <span style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "#0071e3" }}>
          Early access{total ? ` · ${total.toLocaleString()} in line` : " · waves opening"}
        </span>
      </div>

      {/* The joined pill: gradient ring wrapper → white control inside */}
      <div style={{
        background: focused
          ? "linear-gradient(120deg, #0071e3, #40c8ff 55%, #7a5cff)"
          : "linear-gradient(120deg, rgba(0,113,227,0.55), rgba(64,200,255,0.5) 55%, rgba(122,92,255,0.45))",
        borderRadius: 980, padding: 1.5,
        animation: "wlBreath 3.2s ease-in-out 0.9s 2",   // two entrance breaths, then rests
        boxShadow: focused ? "0 10px 42px rgba(0,113,227,0.30)" : "0 6px 26px rgba(0,113,227,0.16)",
        transition: "box-shadow 0.25s ease, background 0.25s ease",
      }}>
        <div style={{ display: "flex", alignItems: "stretch", background: "#fff", borderRadius: 980, overflow: "hidden" }}>
          <input
            type="email"
            value={email}
            placeholder={inRow ? "email" : "you@school.edu"}
            onChange={(e) => { setEmail(e.target.value); if (error) setError(null); }}
            onKeyDown={(e) => { if (e.key === "Enter") join(); }}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            aria-label="Email for the waitlist"
            style={{
              flex: "1 1 60px", minWidth: 0, background: "transparent", border: "none",
              padding: inRow ? "12px 4px 12px 16px" : "13px 6px 13px 20px", fontSize: inRow ? 14 : 15,
              color: "#1d1d1f", outline: "none", fontFamily: FONT,
            }}
          />
          <button
            onClick={join}
            disabled={state === "sending" || !email.trim()}
            style={{
              position: "relative", overflow: "hidden", flexShrink: 0,
              background: state === "sending" || !email.trim()
                ? "linear-gradient(135deg, rgba(0,113,227,0.5), rgba(51,161,255,0.5))"
                : "linear-gradient(135deg, #0071e3, #2b8ff7)",
              color: "#fff", border: "none", borderRadius: 980, margin: 3,
              padding: inRow ? "9px 18px" : "10px 24px", fontSize: inRow ? 14.5 : 15, fontWeight: 500,
              cursor: state === "sending" || !email.trim() ? "default" : "pointer",
              fontFamily: FONT, whiteSpace: "nowrap", transition: "transform 0.15s ease, filter 0.15s ease",
            }}
            onMouseEnter={(e) => { if (!(state === "sending" || !email.trim())) { e.currentTarget.style.transform = "scale(1.03)"; e.currentTarget.style.filter = "brightness(1.06)"; } }}
            onMouseLeave={(e) => { e.currentTarget.style.transform = "scale(1)"; e.currentTarget.style.filter = "none"; }}
          >
            {/* slow sheen sweep — one glint every ~5s */}
            <span aria-hidden="true" style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: "38%", background: "linear-gradient(105deg, transparent, rgba(255,255,255,0.35), transparent)", animation: "wlSheen 5s ease-in-out 1.6s infinite", pointerEvents: "none" }} />
            {state === "sending" ? "Joining…" : "Join the waitlist"}
          </button>
        </div>
      </div>

      {/* Helper / error — out of flow so the pills stay aligned with Learn more */}
      {error
        ? <p style={{ fontSize: 12.5, color: "#c0392b", position: "absolute", top: "100%", left: 14, margin: "6px 0 0", whiteSpace: "nowrap", fontFamily: FONT }}>{error}</p>
        : <p style={{ fontSize: 12.5, color: "#a3a3a3", position: "absolute", top: "100%", left: 14, margin: "6px 0 0", whiteSpace: "nowrap", fontFamily: FONT }}>Free while in beta — one invite email, no spam.</p>}
    </div>
  );
}

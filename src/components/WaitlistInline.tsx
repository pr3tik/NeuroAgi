// WaitlistInline — compact email-capture row embedded directly in the landing hero
// (waitlist mode only). Same /api/waitlist contract as the modal; success swaps the row
// for the position line. Styled to Pratik's Apple-light hero (SF font, #0071e3 accent).
import { useState } from "react";

const FONT = "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', 'Helvetica Neue', sans-serif";

export default function WaitlistInline({ source = "landing-hero", inRow = false }: { source?: string; inRow?: boolean }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [result, setResult] = useState<{ position: number; total: number; alreadyJoined: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  if (state === "done") {
    return (
      <div style={{ marginTop: inRow ? 0 : 20, fontFamily: FONT, animation: "appleTitle 0.5s cubic-bezier(0.16,1,0.3,1) both" }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 10, background: "rgba(0,113,227,0.07)", border: "1px solid rgba(0,113,227,0.22)", borderRadius: 980, padding: "11px 20px" }}>
          <span style={{ width: 18, height: 18, borderRadius: "50%", background: "#0071e3", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <svg width="10" height="10" viewBox="0 0 18 18" fill="none"><path d="M3.5 9l4 4 7-7" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </span>
          <span style={{ fontSize: 15, color: "#1d1d1f" }}>
            {result?.alreadyJoined ? "Already in line — " : "You're in line — "}
            <b>#{result?.position?.toLocaleString?.()}</b> of {result?.total?.toLocaleString?.()}. Check your inbox.
          </span>
        </div>
      </div>
    );
  }

  return (
    <div style={{ marginTop: inRow ? 0 : 20, fontFamily: FONT, flex: inRow ? "1 1 300px" : undefined, minWidth: inRow ? 260 : undefined }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", maxWidth: 430 }}>
        <input
          type="email"
          value={email}
          placeholder="you@school.edu"
          onChange={(e) => { setEmail(e.target.value); if (error) setError(null); }}
          onKeyDown={(e) => { if (e.key === "Enter") join(); }}
          aria-label="Email for the waitlist"
          style={{
            flex: "1 1 220px", minWidth: 0, background: "#f5f5f7", border: "1px solid rgba(0,0,0,0.08)",
            borderRadius: 980, padding: "12px 20px", fontSize: 15, color: "#1d1d1f",
            outline: "none", fontFamily: FONT, transition: "border-color 0.15s, background 0.15s",
          }}
          onFocus={(e) => { e.currentTarget.style.borderColor = "#0071e3"; e.currentTarget.style.background = "#fff"; }}
          onBlur={(e) => { e.currentTarget.style.borderColor = "rgba(0,0,0,0.08)"; e.currentTarget.style.background = "#f5f5f7"; }}
        />
        <button
          onClick={join}
          disabled={state === "sending" || !email.trim()}
          style={{
            background: state === "sending" || !email.trim() ? "rgba(0,113,227,0.45)" : "#0071e3",
            color: "#fff", border: "none", borderRadius: 980, padding: "12px 24px",
            fontSize: 15, fontWeight: 400, cursor: state === "sending" || !email.trim() ? "default" : "pointer",
            fontFamily: FONT, transition: "opacity 0.15s", whiteSpace: "nowrap",
          }}
        >
          {state === "sending" ? "Joining…" : "Join the waitlist"}
        </button>
      </div>
      {error
        ? <p style={{ fontSize: 12.5, color: "#c0392b", margin: "8px 0 0" }}>{error}</p>
        : <p style={{ fontSize: 12.5, color: "#a3a3a3", margin: "8px 0 0" }}>Early access rolls out in waves — no spam, one invite email.</p>}
    </div>
  );
}

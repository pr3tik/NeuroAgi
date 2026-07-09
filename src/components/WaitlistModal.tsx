// WaitlistModal — the landing page's waitlist capture. Light theme to match the
// redesigned landing. Collects email (+ optional name) → POST /api/waitlist?action=join
// → shows the position ("You're #N in line"). Duplicate joins are friendly, not errors.
import { useEffect, useState } from "react";

export default function WaitlistModal({ open, onClose, source = "landing" }: { open: boolean; onClose: () => void; source?: string }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [result, setResult] = useState<{ position: number; total: number; alreadyJoined: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    fetch("/api/waitlist?action=stats").then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (d && typeof d.total === "number" && d.total > 25) setTotal(d.total);   // social proof only once it's flattering
    }).catch(() => {});
  }, [open]);

  if (!open) return null;

  async function join() {
    if (state !== "idle" || !email.trim()) return;
    setError(null);
    setState("sending");
    try {
      const r = await fetch("/api/waitlist?action=join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), name: name.trim() || undefined, source }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || d?.error) throw new Error(d?.error || `HTTP ${r.status}`);
      setResult({ position: d.position, total: d.total, alreadyJoined: !!d.alreadyJoined });
      setState("done");
    } catch (e: any) {
      setError(e?.message ?? "Something went wrong. Try again.");
      setState("idle");
    }
  }

  const input: any = {
    width: "100%", boxSizing: "border-box", background: "#fff", border: "1px solid rgba(26,24,20,0.14)",
    borderRadius: 12, padding: "13px 15px", fontSize: 15, color: "#1a1814", outline: "none", fontFamily: "inherit",
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 1200, background: "rgba(26,24,20,0.35)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 420, background: "#FDFAF4", borderRadius: 24, padding: "36px 30px", boxShadow: "0 30px 80px rgba(26,24,20,0.25)", textAlign: "center", fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif", position: "relative" }}>
        <button onClick={onClose} aria-label="Close" style={{ position: "absolute", top: 14, right: 16, background: "none", border: "none", fontSize: 22, color: "rgba(26,24,20,0.35)", cursor: "pointer", lineHeight: 1 }}>×</button>

        {state !== "done" ? (
          <>
            <p style={{ fontSize: 11, letterSpacing: 3, textTransform: "uppercase", color: "rgba(26,24,20,0.4)", fontWeight: 600, margin: "0 0 18px" }}>Early access</p>
            <h2 style={{ fontFamily: "Georgia, 'Times New Roman', serif", fontSize: 27, color: "#1a1814", margin: "0 0 10px", lineHeight: 1.2 }}>Join the waitlist</h2>
            <p style={{ fontSize: 14.5, color: "rgba(26,24,20,0.55)", lineHeight: 1.65, margin: "0 0 24px" }}>
              We're letting students in gradually{total ? <>: <b>{total.toLocaleString()}</b> are already in line</> : ""}. Leave your email and we'll send your invite the moment a spot opens.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14, textAlign: "left" }}>
              <input style={input} type="text" placeholder="First name (optional)" value={name} onChange={(e) => setName(e.target.value)} />
              <input style={input} type="email" placeholder="you@school.edu" value={email}
                onChange={(e) => { setEmail(e.target.value); if (error) setError(null); }}
                onKeyDown={(e) => { if (e.key === "Enter") join(); }} />
            </div>
            {error && <p style={{ color: "#c0392b", fontSize: 13, margin: "0 0 12px", textAlign: "left" }}>{error}</p>}
            <button onClick={join} disabled={state === "sending" || !email.trim()}
              style={{ width: "100%", background: state === "sending" || !email.trim() ? "rgba(26,24,20,0.35)" : "#1a1814", color: "#F6F2E9", border: "none", borderRadius: 13, padding: 15, fontSize: 15, fontWeight: 650, cursor: state === "sending" || !email.trim() ? "default" : "pointer", fontFamily: "inherit" }}>
              {state === "sending" ? "Joining…" : "Join the waitlist →"}
            </button>
            <p style={{ fontSize: 12, color: "rgba(26,24,20,0.35)", margin: "16px 0 0" }}>No spam: one confirmation now, one email when you're in.</p>
          </>
        ) : (
          <>
            <div style={{ width: 56, height: 56, margin: "6px auto 22px", borderRadius: "50%", background: "#1a1814", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="22" height="22" viewBox="0 0 18 18" fill="none"><path d="M3.5 9l4 4 7-7" stroke="#F6F2E9" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </div>
            <h2 style={{ fontFamily: "Georgia, 'Times New Roman', serif", fontSize: 27, color: "#1a1814", margin: "0 0 10px" }}>
              {result?.alreadyJoined ? "You're already in line" : "You're on the list"}
            </h2>
            <p style={{ fontSize: 15, color: "rgba(26,24,20,0.55)", lineHeight: 1.65, margin: "0 0 6px" }}>
              You're <b style={{ color: "#1a1814" }}>#{result?.position?.toLocaleString?.() ?? "…"}</b> of {result?.total?.toLocaleString?.() ?? "…"} in line.
            </p>
            <p style={{ fontSize: 13.5, color: "rgba(26,24,20,0.45)", lineHeight: 1.6, margin: "0 0 22px" }}>
              {result?.alreadyJoined ? "We have your spot saved. Watch your inbox for the invite." : "Check your inbox for a confirmation. Your invite lands there the moment a spot opens."}
            </p>
            <button onClick={onClose} style={{ background: "none", border: "1px solid rgba(26,24,20,0.18)", borderRadius: 13, padding: "12px 22px", fontSize: 14, color: "#1a1814", cursor: "pointer", fontFamily: "inherit" }}>Done</button>
          </>
        )}
      </div>
    </div>
  );
}

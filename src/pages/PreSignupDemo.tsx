// PreSignupDemo.tsx — PRD §5.1 v2.1, S0-S2: the anonymous pre-signup flow.
// S0 hook -> S1 instant demo (real tutor answer, no account) -> S2 echo-back ->
// hands off into Landing's existing signup modal (S3), pre-opened.
//
// Runs entirely under the guest uid AppContext already assigns to every visitor
// (src/context/AppContext.tsx getOrCreateUserId) — no new identity concept. The
// existing guest-data adoption (src/api/auth.ts adoptIdentity) already folds
// whatever's tied to that guest uid into the real account at signup, so nothing
// built here needs its own "claim on signup" logic.
import { useState, useRef } from "react";
import { useApp } from "../context/AppContext";
import Landing from "./Landing";
import { renderMessageHTML } from "../components/NeuralRing";

const HOOKS = [
  { id: "exam",       label: "Exam I'm not ready for" },
  { id: "behind",     label: "Behind on assignments" },
  { id: "grades",     label: "Grades need to come up" },
  { id: "justlooking",label: "Just looking" },
];

const DEMO_SEEN_KEY = "fschool_demo_seen";

export function hasSeenPreSignupDemo() {
  try { return localStorage.getItem(DEMO_SEEN_KEY) === "1"; } catch { return false; }
}
function markDemoSeen() {
  try { localStorage.setItem(DEMO_SEEN_KEY, "1"); } catch {}
}

const shellStyle: React.CSSProperties = {
  minHeight: "100dvh", display: "flex", flexDirection: "column",
  alignItems: "center", padding: "48px 24px", overflowY: "auto",
  background: "#0b0b0d",
  fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif",
};

const cardStyle: React.CSSProperties = {
  width: "100%", maxWidth: "420px", margin: "auto 0", animation: "psFadeIn 0.4s ease",
};

export default function PreSignupDemo({ onEnter }) {
  const { userId } = useApp(); // already the guest uid — set for every visitor, logged in or not
  const [step, setStep]           = useState("hook"); // hook | demo | echo | landing
  const [initialAuthMode, setInitialAuthMode] = useState(null);
  const [hookChoice, setHookChoice] = useState(null);

  const [question, setQuestion]   = useState("");
  const [busy, setBusy]           = useState(false);
  const [error, setError]         = useState("");
  const [answer, setAnswer]       = useState("");
  const [courseCode, setCourseCode] = useState(null); // only ever real — from an uploaded file, never invented
  const [topic, setTopic]         = useState(null);
  const [blocked, setBlocked]     = useState(null); // { message } | null
  const fileRef = useRef(null);

  function skipToSignIn() {
    markDemoSeen();
    setInitialAuthMode("login");
    setStep("landing");
  }

  function chooseHook(id) {
    setHookChoice(id);
    setStep("demo");
  }

  function skipDemo() {
    // "no empty state ever renders" — land straight on a generic echo-back rather
    // than a blank screen.
    setCourseCode(null);
    setTopic(null);
    setStep("echo");
  }

  async function runDemo({ q, base64, file_type, name }: { q?: string; base64?: string; file_type?: string; name?: string }) {
    setBusy(true); setError(""); setBlocked(null);
    try {
      const res = await fetch("/api/guest-demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guestUid: userId, question: q, base64, file_type, name }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 429 || data.blocked) {
        setBlocked({ message: data.message || "You've used your free preview — sign up to keep going." });
        return;
      }
      if (!res.ok || data.error) {
        setError(data.error || "Something went wrong — try again.");
        return;
      }
      setAnswer(data.answer || "");
      setCourseCode(data.courseCode || null);
      setTopic(data.topic || null);
      setStep("echo");
    } catch {
      setError("Couldn't reach the tutor — check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  function submitQuestion() {
    if (!question.trim() || busy) return;
    runDemo({ q: question.trim() });
  }

  function handleFile(file) {
    if (!file || busy) return;
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = String(reader.result).split(",")[1] ?? "";
      runDemo({ base64, file_type: file.type, name: file.name });
    };
    reader.readAsDataURL(file);
  }

  function confirmEcho() {
    markDemoSeen();
    setInitialAuthMode("signup");
    setStep("landing");
  }

  if (step === "landing") {
    return <Landing onEnter={onEnter} initialAuthMode={initialAuthMode} />;
  }

  return (
    <div style={shellStyle}>
      <style>{`
        @keyframes psFadeIn { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:translateY(0); } }
        .ps-card:hover  { background: rgba(255,255,255,0.08) !important; border-color: rgba(255,255,255,0.22) !important; }
        .ps-primary:hover { background: #fff !important; }
        .ps-skip:hover  { color: rgba(255,255,255,0.5) !important; }
        .nr-md p           { margin: 0 0 6px; }
        .nr-md p:last-child { margin: 0; }
        .nr-md strong       { color: var(--gold); font-weight: 600; }
        .nr-md ul           { margin: 4px 0; padding-left: 18px; }
        .nr-md li           { margin: 3px 0; }
      `}</style>

      {/* ── S0: Hook ─────────────────────────────────────────────────────── */}
      {step === "hook" && (
        <div style={cardStyle}>
          <h1 style={{ color: "#F5F5F5", fontSize: "30px", fontWeight: 700, letterSpacing: "-0.8px", lineHeight: 1.15, marginBottom: "28px", textAlign: "center" }}>
            What's school throwing at you right now?
          </h1>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {HOOKS.map(h => (
              <button
                key={h.id}
                className="ps-card"
                onClick={() => chooseHook(h.id)}
                style={{
                  background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: "14px", padding: "16px 18px", color: "#F5F5F5", fontSize: "15px",
                  fontWeight: 500, textAlign: "left", cursor: "pointer", fontFamily: "inherit",
                  transition: "all 0.15s",
                }}
              >
                {h.label}
              </button>
            ))}
          </div>
          <button
            className="ps-skip"
            onClick={skipToSignIn}
            style={{
              display: "block", margin: "24px auto 0", background: "none", border: "none",
              color: "rgba(255,255,255,0.28)", fontSize: "13px", cursor: "pointer", fontFamily: "inherit",
            }}
          >
            I already have an account
          </button>
        </div>
      )}

      {/* ── S1: Instant demo ─────────────────────────────────────────────── */}
      {step === "demo" && (
        <div style={cardStyle}>
          <h1 style={{ color: "#F5F5F5", fontSize: "26px", fontWeight: 700, letterSpacing: "-0.6px", lineHeight: 1.2, marginBottom: "10px" }}>
            Drop anything.
          </h1>
          <p style={{ color: "rgba(255,255,255,0.4)", fontSize: "14px", marginBottom: "22px", lineHeight: 1.6 }}>
            A homework question, a syllabus, a photo of a problem — I'll answer it right now. No account needed.
          </p>

          {blocked ? (
            <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "14px", padding: "18px", marginBottom: "16px" }}>
              <p style={{ color: "rgba(255,255,255,0.75)", fontSize: "14px", lineHeight: 1.6, marginBottom: "14px" }}>{blocked.message}</p>
              <button className="ps-primary" onClick={skipToSignIn} style={{ width: "100%", background: "rgba(255,255,255,0.92)", color: "#111", border: "none", borderRadius: "12px", padding: "13px", fontSize: "14px", fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
                Sign up →
              </button>
            </div>
          ) : (
            <>
              <textarea
                value={question}
                onChange={e => setQuestion(e.target.value)}
                placeholder="e.g. What's homeostasis?"
                rows={3}
                disabled={busy}
                style={{
                  width: "100%", boxSizing: "border-box", resize: "vertical",
                  background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: "14px", padding: "14px 16px", color: "#F5F5F5", fontSize: "14px",
                  lineHeight: 1.6, fontFamily: "inherit", outline: "none", marginBottom: "10px",
                }}
              />
              <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
                <button
                  className="ps-primary"
                  onClick={submitQuestion}
                  disabled={busy || !question.trim()}
                  style={{
                    flex: 1, background: "rgba(255,255,255,0.92)", color: "#111", border: "none",
                    borderRadius: "12px", padding: "13px", fontSize: "14px", fontWeight: 600,
                    cursor: (busy || !question.trim()) ? "default" : "pointer", fontFamily: "inherit",
                    opacity: (busy || !question.trim()) ? 0.5 : 1,
                  }}
                >
                  {busy ? "Thinking…" : "Ask →"}
                </button>
                <input ref={fileRef} type="file" accept=".pdf,.txt,.png,.jpg,.jpeg,.webp" style={{ display: "none" }}
                  onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; handleFile(f); }} />
                <button
                  onClick={() => fileRef.current?.click()}
                  disabled={busy}
                  style={{
                    background: "transparent", color: "rgba(255,255,255,0.6)", border: "1px solid rgba(255,255,255,0.14)",
                    borderRadius: "12px", padding: "13px 16px", fontSize: "14px", fontWeight: 500,
                    cursor: busy ? "default" : "pointer", fontFamily: "inherit",
                  }}
                >
                  Upload
                </button>
              </div>
              {error && <p style={{ color: "rgba(255,140,130,0.9)", fontSize: "13px", marginBottom: "10px" }}>{error}</p>}
              <button className="ps-skip" onClick={skipDemo} disabled={busy} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.25)", fontSize: "13px", cursor: busy ? "default" : "pointer", fontFamily: "inherit" }}>
                Skip for now →
              </button>
            </>
          )}
        </div>
      )}

      {/* ── S2: Echo-back ────────────────────────────────────────────────── */}
      {step === "echo" && (
        <div style={cardStyle}>
          {answer && (
            <div
              className="nr-md"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "14px", padding: "18px", marginBottom: "20px", color: "rgba(255,255,255,0.85)", fontSize: "14px", lineHeight: 1.7 }}
              dangerouslySetInnerHTML={{ __html: renderMessageHTML(answer) }}
            />
          )}
          <h1 style={{ color: "#F5F5F5", fontSize: "22px", fontWeight: 700, letterSpacing: "-0.4px", lineHeight: 1.3, marginBottom: "22px" }}>
            {courseCode
              ? `Looks like ${courseCode}${topic ? ` — ${topic}` : ""}. Track this course?`
              : topic
                ? `Looks like you're working on ${topic}. Sound right?`
                : "Ready to save your progress?"}
          </h1>
          <button className="ps-primary" onClick={confirmEcho} style={{ width: "100%", background: "rgba(255,255,255,0.92)", color: "#111", border: "none", borderRadius: "12px", padding: "14px", fontSize: "15px", fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
            {courseCode ? "Track it →" : "Continue →"}
          </button>
        </div>
      )}
    </div>
  );
}

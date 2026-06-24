// Landing.jsx — Marketing landing page.
// LOGIC: All state variables, handlers, and auth flow are preserved exactly.
// VISUAL: Dark editorial theme — Fraunces display headings, gold accent (#a855f7),
//         ink background (#111111), Cluely-structure feature cards with CSS mockups.
// MOTION: Cinematic scroll reveals, hero parallax, living mockups, pill buttons,
//         waveform animation, stat counter, ambient breathing. Animation-layer only.

import { useState, useEffect, useRef } from "react";
import ColorBends from "../components/ColorBends";

/* ─────────────────────────────────────────────────────────────────────────
   AUTH MODAL  (inputBase + component untouched)
   ──────────────────────────────────────────────────────────────────────── */

const inputBase = {
  background: "rgba(255,255,255,0.05)",
  border: "1px solid rgba(255,255,255,0.09)",
  borderRadius: "10px",
  padding: "12px 14px",
  color: "#F5F5F5",
  fontSize: "14px",
  outline: "none",
  fontFamily: "inherit",
  width: "100%",
  transition: "border-color 0.15s",
};

function AuthModal({ mode, onClose, onEnter, onSwitchMode, onForgotPassword }) {
  const [name,      setName]      = useState("");
  const [email,     setEmail]     = useState("");
  const [password,  setPassword]  = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [error,     setError]     = useState("");
  const [loading,   setLoading]   = useState(false);

  const isSignup = mode === "signup";

  const canSubmit = isSignup
    ? name.trim() && email.trim() && password.length >= 6
    : email.trim() && password.length >= 1;

  async function handleSubmit() {
    if (!canSubmit || loading) return;
    if (isSignup && password !== confirmPw) { setError("Passwords don't match."); return; }
    setError("");
    setLoading(true);
    try {
      await onEnter({ mode, name: name.trim(), email: email.trim(), password });
    } catch (err) {
      setError(err.message ?? "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  function handleKey(e) { if (e.key === "Enter") handleSubmit(); }

  return (
    <div
      onClick={(e) => e.target === e.currentTarget && onClose()}
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        display: "flex", alignItems: "flex-end",
        background: "rgba(0,0,0,0.55)",
        backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)",
      }}
    >
      <div style={{
        width: "100%",
        background: "rgba(16,16,18,0.97)",
        backdropFilter: "blur(40px)", WebkitBackdropFilter: "blur(40px)",
        borderRadius: "22px 22px 0 0",
        border: "1px solid rgba(255,255,255,0.09)", borderBottom: "none",
        padding: "16px 28px 44px",
        fontFamily: "inherit",
        animation: "lSheetUp 0.28s cubic-bezier(0.25,0.46,0.45,0.94) forwards",
      }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: "22px" }}>
          <div onClick={onClose} style={{ width: 36, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.15)", cursor: "pointer" }} />
        </div>
        <h2 style={{ color: "#F5F5F5", fontSize: "22px", fontWeight: "600", letterSpacing: "-0.3px", marginBottom: "6px" }}>
          {isSignup ? "Create your account" : "Welcome back"}
        </h2>
        <p style={{ color: "rgba(255,255,255,0.35)", fontSize: "14px", marginBottom: "26px", lineHeight: "1.6" }}>
          {isSignup ? "Takes 30 seconds. You'll connect Canvas on the next screen." : "Enter your email and password to continue."}
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "18px" }}>
          {isSignup ? (
            <>
              <input placeholder="Your name"                   value={name}      onChange={e => setName(e.target.value)}      onKeyDown={handleKey} style={inputBase} />
              <input placeholder="Email"          type="email"  value={email}     onChange={e => setEmail(e.target.value)}     onKeyDown={handleKey} style={inputBase} />
              <input placeholder="Password (min 6 characters)" type="password"   value={password}  onChange={e => setPassword(e.target.value)}  onKeyDown={handleKey} style={inputBase} />
              <input placeholder="Confirm password"            type="password"   value={confirmPw} onChange={e => setConfirmPw(e.target.value)} onKeyDown={handleKey} style={inputBase} />
            </>
          ) : (
            <>
              <input placeholder="Email"    type="email"    value={email}    onChange={e => setEmail(e.target.value)}    onKeyDown={handleKey} style={inputBase} />
              <input placeholder="Password" type="password" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={handleKey} style={inputBase} />
              <button type="button" onClick={() => onForgotPassword(email.trim())}
                style={{ background: "none", border: "none", color: "rgba(255,255,255,0.3)", fontSize: "12px", cursor: "pointer", textAlign: "right", fontFamily: "inherit", padding: "0", textDecoration: "underline" }}>
                Forgot password?
              </button>
            </>
          )}
        </div>
        {error && <p style={{ color: "rgba(255,100,90,0.85)", fontSize: "12px", textAlign: "center", marginBottom: "10px" }}>{error}</p>}
        <button onClick={handleSubmit} disabled={!canSubmit || loading}
          style={{ width: "100%", background: canSubmit && !loading ? "rgba(255,255,255,0.92)" : "rgba(255,255,255,0.25)", color: "#111", border: "none", borderRadius: "12px", padding: "14px", fontSize: "15px", fontWeight: "600", cursor: canSubmit && !loading ? "pointer" : "not-allowed", fontFamily: "inherit", transition: "background 0.15s, transform 0.15s" }}
          onMouseEnter={(e) => { if (canSubmit && !loading) { e.currentTarget.style.background = "#fff"; e.currentTarget.style.transform = "translateY(-1px)"; } }}
          onMouseLeave={(e) => { e.currentTarget.style.background = canSubmit && !loading ? "rgba(255,255,255,0.92)" : "rgba(255,255,255,0.25)"; e.currentTarget.style.transform = "none"; }}>
          {loading ? "…" : isSignup ? "Start for free →" : "Sign in →"}
        </button>
        <p style={{ color: "rgba(255,255,255,0.18)", fontSize: "12px", textAlign: "center", marginTop: "10px" }}>
          {isSignup ? "You'll set up Canvas in the next step."
            : <>Don't have an account?{" "}
                <span onClick={() => { onClose(); setTimeout(() => onSwitchMode("signup"), 50); }}
                  style={{ color: "rgba(255,255,255,0.45)", textDecoration: "underline", cursor: "pointer" }}>
                  Sign up free
                </span>
              </>}
        </p>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   SCROLL REVEAL WRAPPER
   ──────────────────────────────────────────────────────────────────────── */

function Reveal({ children, delay = 0, style = {} }) {
  const ref = useRef(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setOn(true); obs.disconnect(); }
    }, { threshold: 0.12 });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return (
    <div ref={ref} style={{
      opacity: on ? 1 : 0,
      transform: on ? "none" : "translateY(32px)",
      filter: on ? "none" : "blur(6px)",
      transition: `opacity .7s cubic-bezier(.22,1,.36,1) ${delay}ms,transform .7s cubic-bezier(.22,1,.36,1) ${delay}ms,filter .7s cubic-bezier(.22,1,.36,1) ${delay}ms`,
      willChange: "transform,opacity",
      ...style,
    }}>
      {children}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   CSS MOCKUP COMPONENTS
   ──────────────────────────────────────────────────────────────────────── */

// Waveform bar duration/delay lookup — 20 bars, non-uniform to feel organic
const WAV_DUR = [0.70,0.90,0.55,1.10,0.75,0.60,0.95,0.80,1.20,0.65,0.85,0.70,1.00,0.60,0.90,0.75,0.55,1.10,0.80,0.65];
const WAV_DEL = [0.00,0.18,0.35,0.10,0.45,0.22,0.05,0.38,0.15,0.50,0.08,0.28,0.42,0.20,0.55,0.12,0.32,0.06,0.48,0.25];

// Hero product preview — dark app cards
function HeroPreview() {
  return (
    <div style={{ position: "relative", width: "100%", maxWidth: "520px", margin: "0 auto", height: "272px" }}>
      <div style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%)", width: "218px", background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: "18px", padding: "18px", zIndex: 3, boxShadow: "0 28px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)" }}>
        <p style={{ fontSize: "9px", color: "rgba(255,255,255,0.3)", letterSpacing: "2.5px", textTransform: "uppercase", marginBottom: "14px" }}>WORK</p>
        <div style={{ display: "flex", flexDirection: "column", gap: "7px", marginBottom: "12px" }}>
          {[{ label: "Research Paper", badge: "Tomorrow", urgent: true }, { label: "Problem Set 4", badge: "May 23", urgent: false }].map(a => (
            <div key={a.label} style={{ background: "rgba(255,255,255,0.06)", borderRadius: "8px", padding: "8px 10px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ color: a.urgent ? "#F5F5F5" : "rgba(255,255,255,0.5)", fontSize: "11px", fontWeight: a.urgent ? "500" : "400" }}>{a.label}</span>
              <span style={{ fontSize: "9px", padding: "2px 7px", borderRadius: "10px", background: a.urgent ? "rgba(255,59,48,0.2)" : "transparent", color: a.urgent ? "rgba(255,100,90,0.9)" : "rgba(255,255,255,0.22)" }}>{a.badge}</span>
            </div>
          ))}
        </div>
        <div style={{ background: "rgba(255,255,255,0.07)", borderRadius: "4px", height: "3px" }}>
          <div style={{ background: "rgba(255,255,255,0.45)", height: "100%", borderRadius: "4px", width: "65%" }} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: "10px" }}>
          {["GPA 3.87","12d streak","34 done"].map(t => <span key={t} style={{ fontSize: "9px", color: "rgba(255,255,255,0.22)" }}>{t}</span>)}
        </div>
      </div>
      <div className="l-preview-r" style={{ position: "absolute", right: "0", top: "16px", width: "158px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "14px", padding: "14px", transform: "rotate(4deg)", zIndex: 2, boxShadow: "0 12px 36px rgba(0,0,0,0.45)" }}>
        <p style={{ fontSize: "9px", color: "rgba(255,255,255,0.25)", letterSpacing: "2px", textTransform: "uppercase", marginBottom: "10px" }}>STUDY</p>
        <div style={{ background: "rgba(255,255,255,0.05)", borderRadius: "8px", padding: "10px" }}>
          <p style={{ color: "rgba(255,255,255,0.22)", fontSize: "8px", textTransform: "uppercase", letterSpacing: "1px", marginBottom: "5px" }}>Question</p>
          <p style={{ color: "#F5F5F5", fontSize: "10px", lineHeight: "1.5" }}>What is cognitive load theory?</p>
        </div>
        <p style={{ color: "rgba(255,255,255,0.16)", fontSize: "8px", marginTop: "8px", textAlign: "center" }}>Tap to flip</p>
      </div>
      <div className="l-preview-l" style={{ position: "absolute", left: "0", bottom: "14px", width: "168px", background: "rgba(14,14,18,0.94)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "14px", padding: "14px", transform: "rotate(-3deg)", zIndex: 2, boxShadow: "0 12px 36px rgba(0,0,0,0.45)" }}>
        <p style={{ fontSize: "9px", color: "rgba(255,255,255,0.25)", letterSpacing: "2px", textTransform: "uppercase", marginBottom: "10px" }}>AI TUTOR</p>
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <div style={{ alignSelf: "flex-end", background: "rgba(168,85,247,0.18)", borderRadius: "8px 8px 2px 8px", padding: "6px 9px" }}>
            <p style={{ color: "#F5F5F5", fontSize: "9px" }}>Summarize my notes</p>
          </div>
          <div style={{ alignSelf: "flex-start", background: "rgba(255,255,255,0.05)", borderRadius: "8px 8px 8px 2px", padding: "6px 9px" }}>
            <p style={{ color: "rgba(255,255,255,0.55)", fontSize: "9px", lineHeight: "1.55" }}>Based on Lecture 7, working memory has four components…</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// Recording mockup — live timer + animated waveform
function RecordingMockup() {
  const bars = [8,16,28,22,12,36,26,18,40,30,22,12,26,34,18,14,22,30,18,8];
  const [secs, setSecs] = useState(3);

  useEffect(() => {
    const t = setInterval(() => setSecs(s => s + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const mm = String(Math.floor(secs / 60)).padStart(2, "0");
  const ss = String(secs % 60).padStart(2, "0");

  return (
    <div style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.09)", borderRadius: "20px", padding: "24px", maxWidth: "320px", width: "100%" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#FF453A" }} />
          <span style={{ color: "rgba(255,255,255,0.9)", fontSize: "13px", fontWeight: "600", letterSpacing: "0.5px" }}>REC</span>
          <span style={{ color: "rgba(255,255,255,0.4)", fontSize: "13px", fontFamily: "ui-monospace,monospace" }}>{mm}:{ss}</span>
        </div>
        <span style={{ fontSize: "10px", color: "rgba(255,255,255,0.28)", background: "rgba(255,255,255,0.06)", padding: "3px 8px", borderRadius: "6px" }}>COMP 101</span>
      </div>
      {/* Animated waveform */}
      <div style={{ display: "flex", alignItems: "center", gap: "3px", height: "44px", marginBottom: "20px" }}>
        {bars.map((h, i) => (
          <div key={i} style={{
            flex: 1,
            height: `${h}px`,
            background: i < 14 ? "#a855f7" : "rgba(255,255,255,0.12)",
            borderRadius: "2px",
            opacity: i < 14 ? 0.85 : 0.5,
            transformOrigin: "center bottom",
            animation: `waveBar ${WAV_DUR[i]}s ease-in-out infinite ${WAV_DEL[i]}s`,
            willChange: "transform",
          }} />
        ))}
      </div>
      <div style={{ borderLeft: "2px solid rgba(139,92,246,0.5)", paddingLeft: "12px" }}>
        <p style={{ color: "rgba(255,255,255,0.28)", fontSize: "9px", textTransform: "uppercase", letterSpacing: "1.5px", marginBottom: "5px" }}>Live transcript</p>
        <p style={{ color: "rgba(255,255,255,0.68)", fontSize: "12px", lineHeight: "1.65" }}>
          "…cognitive load theory suggests working memory has limited capacity for processing new information…"
        </p>
      </div>
    </div>
  );
}

// AI Tutor mockup — animated chat: user → typing → AI response, loops
function TutorMockup() {
  const ref = useRef(null);
  // phase: hidden | user | typing | full
  const [phase, setPhase] = useState("hidden");

  useEffect(() => {
    const el = ref.current; if (!el) return;
    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setPhase("user"); obs.disconnect(); }
    }, { threshold: 0.4 });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (phase === "user")   { const t = setTimeout(() => setPhase("typing"), 600);  return () => clearTimeout(t); }
    if (phase === "typing") { const t = setTimeout(() => setPhase("full"),   1400); return () => clearTimeout(t); }
    if (phase === "full")   { const t = setTimeout(() => setPhase("user"),   4000); return () => clearTimeout(t); }
  }, [phase]);

  const show = (p) => phase !== "hidden" && (
    p === "user"   ? true :
    p === "typing" ? phase === "typing" || phase === "full" :
    p === "full"   ? phase === "full" : false
  );

  return (
    <div ref={ref} style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.09)", borderRadius: "20px", padding: "20px", maxWidth: "300px", width: "100%" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
        <span style={{ fontSize: "13px", fontWeight: "600", color: "#F5F5F5" }}>AI Tutor</span>
        <span style={{ fontSize: "10px", color: "rgba(255,255,255,0.3)", background: "rgba(255,255,255,0.06)", padding: "3px 9px", borderRadius: "8px" }}>BIOL 201</span>
      </div>

      {/* User bubble */}
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "10px", opacity: show("user") ? 1 : 0, transform: show("user") ? "none" : "translateY(6px)", transition: "opacity .4s ease, transform .4s ease" }}>
        <div style={{ background: "rgba(168,85,247,0.18)", border: "1px solid rgba(139,92,246,0.3)", borderRadius: "14px 14px 4px 14px", padding: "9px 13px", maxWidth: "76%" }}>
          <p style={{ color: "#F5F5F5", fontSize: "12px" }}>Explain homeostasis</p>
        </div>
      </div>

      {/* Typing indicator OR AI response */}
      <div style={{ display: "flex", justifyContent: "flex-start", marginBottom: "12px", minHeight: "42px" }}>
        {/* Typing dots */}
        <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "14px 14px 14px 4px", padding: "10px 14px", display: "flex", alignItems: "center", gap: "5px", opacity: phase === "typing" ? 1 : 0, transition: "opacity .3s ease", position: "absolute" }}>
          {[0, 0.16, 0.32].map((d, i) => (
            <div key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: "rgba(255,255,255,0.45)", animation: `typingDot .8s ease-in-out infinite ${d}s`, willChange: "transform" }} />
          ))}
        </div>
        {/* AI response */}
        <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "14px 14px 14px 4px", padding: "10px 13px", maxWidth: "88%", opacity: show("full") ? 1 : 0, transform: show("full") ? "none" : "translateY(4px)", transition: "opacity .5s ease .1s, transform .5s ease .1s" }}>
          <p style={{ color: "rgba(255,255,255,0.65)", fontSize: "12px", lineHeight: "1.65" }}>Homeostasis is the body's mechanism for maintaining stable internal conditions. Your professor covered this in Lecture 4…</p>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "5px", opacity: show("full") ? 1 : 0, transition: "opacity .4s ease .3s" }}>
        <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#a855f7", opacity: 0.55, flexShrink: 0 }} />
        <span style={{ fontSize: "10px", color: "rgba(255,255,255,0.28)" }}>From your Lecture 4 notes</span>
      </div>
    </div>
  );
}

// Study room mockup — participants stagger in when card enters viewport
function StudyRoomMockup() {
  const members = [
    { name: "Pratik", i: "P", c: "rgba(168,85,247,0.8)" },
    { name: "Shreya", i: "S", c: "rgba(123,97,214,0.75)" },
    { name: "Marcus", i: "M", c: "rgba(200,119,58,0.75)" },
    { name: "Aiden",  i: "A", c: "rgba(59,168,123,0.75)" },
  ];
  const ref = useRef(null);
  const [count, setCount] = useState(0);

  useEffect(() => {
    const el = ref.current; if (!el) return;
    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        obs.disconnect();
        let c = 0;
        const iv = setInterval(() => { c++; setCount(c); if (c >= members.length) clearInterval(iv); }, 200);
      }
    }, { threshold: 0.4 });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <div ref={ref} style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.09)", borderRadius: "20px", padding: "20px", maxWidth: "268px", width: "100%" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
        <div>
          <p style={{ fontSize: "14px", fontWeight: "700", color: "#F5F5F5", marginBottom: "2px" }}>Study Room</p>
          <p style={{ fontSize: "11px", color: "rgba(255,255,255,0.35)" }}>{members.length} members active</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
          <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#34C759" }} />
          <span style={{ fontSize: "11px", color: "#34C759", fontWeight: "500" }}>Live</span>
        </div>
      </div>
      {members.map((m, i) => (
        <div key={m.name} style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "10px", opacity: i < count ? 1 : 0, transform: i < count ? "none" : "translateX(-10px)", transition: "opacity .35s ease, transform .35s ease", willChange: "transform,opacity" }}>
          <div style={{ width: 30, height: 30, borderRadius: "50%", background: m.c, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <span style={{ color: "#fff", fontSize: "11px", fontWeight: "600" }}>{m.i}</span>
          </div>
          <span style={{ color: "rgba(255,255,255,0.7)", fontSize: "13px" }}>{m.name}</span>
        </div>
      ))}
      <button style={{ width: "100%", background: "none", border: "1px dashed rgba(139,92,246,0.35)", borderRadius: "10px", padding: "8px", color: "rgba(168,85,247,0.8)", fontSize: "13px", cursor: "default", fontFamily: "inherit", marginTop: "4px" }}>
        + Add friend
      </button>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   STATIC CONTENT
   ──────────────────────────────────────────────────────────────────────── */

const FAQ_DATA = [
  {
    q: "Who is Vincent?",
    a: "Vincent is the founder of FSchoolAI. He never attended a single lecture — learned everything using AI, found a massive gap in how students actually study, and coded the first version of FSchoolAI on his iPhone. That gap is why this exists.",
  },
  {
    q: "Does FSchoolAI support academic integrity?",
    a: "Yes. FSchoolAI is a study tool, not a shortcut — it helps you understand your material faster, not skip it. Think of it as a tutor that knows your exact courses.",
  },
  {
    q: "What is FSchoolAI?",
    a: "FSchoolAI is an AI-powered academic platform that syncs with your Canvas LMS, organizes your courses and assignments, and gives you a personal AI tutor that understands your actual class material — all in one mobile-first space.",
  },
  {
    q: "Is it free?",
    a: "Yes. Joining the beta gives you a full 1-month free subscription. After the beta period we'll offer a Pro tier — the core experience (Canvas sync, AI study guide, flashcards, assignment tracker) stays free.",
  },
  {
    q: "How does Canvas sync work?",
    a: "You paste your school's Canvas URL and a personal read-only API token (generated in Canvas Account Settings in under a minute). FSchoolAI reads your courses, assignments, and deadlines — it never writes to Canvas, and your token is stored only on your device.",
  },
  {
    q: "Does it work with my school?",
    a: "If your school uses Canvas LMS, yes. That covers thousands of universities, colleges, and high schools worldwide. Support for Blackboard and D2L is on the roadmap.",
  },
  {
    q: "When is the mobile app coming?",
    a: "The web app is fully mobile-responsive today — add it to your home screen for an app-like experience. A native iOS app is in development; sign up above to be notified at launch.",
  },
];

const FREE_FEATURES  = [
  "Canvas sync — courses, assignments, deadlines",
  "AI study guide and flashcards",
  "Assignment tracker and GPA view",
  "Basic AI tutor",
  "Mobile-ready web app",
];

const PRO_FEATURES = [
  "Everything in Free",
  "In-class recording and live transcription",
  "Priority AI (faster, smarter responses)",
  "Smart study planner",
  "Study rooms and group sessions",
  "Identity card and leaderboard",
];

/* ─────────────────────────────────────────────────────────────────────────
   LANDING PAGE
   ──────────────────────────────────────────────────────────────────────── */

export default function Landing({ onEnter }) {
  // ── Preserved state ───────────────────────────────────────────────────
  const [authMode,      setAuthMode]      = useState(null);
  const [forgotSent,    setForgotSent]    = useState(false);
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotError,   setForgotError]   = useState(false);
  const [faqOpen,       setFaqOpen]       = useState(null);

  // ── Animation state ───────────────────────────────────────────────────
  const heroRef    = useRef(null);
  const statsRef   = useRef(null);
  // Reduced-motion: checked once (ref, not state — no re-render needed)
  const reducedMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const [statLangs, setStatLangs] = useState(0);

  // ── Countdown + Waitlist state ────────────────────────────────────────
  // Target: July 14, 2026 — official launch date
  const LAUNCH_DATE = new Date("2026-07-14T00:00:00Z");
  function getTimeLeft() {
    const diff = Math.max(0, LAUNCH_DATE.getTime() - Date.now());
    return {
      days:    Math.floor(diff / 86400000),
      hours:   Math.floor((diff % 86400000) / 3600000),
      minutes: Math.floor((diff % 3600000) / 60000),
      seconds: Math.floor((diff % 60000) / 1000),
    };
  }
  const [timeLeft, setTimeLeft] = useState(getTimeLeft);
  const [waitlistEmail, setWaitlistEmail] = useState("");
  const [waitlistState, setWaitlistState] = useState("idle"); // idle | loading | success | error
  const [waitlistCount, setWaitlistCount] = useState(247);

  useEffect(() => {
    const t = setInterval(() => setTimeLeft(getTimeLeft()), 1000);
    return () => clearInterval(t);
  }, []);

  async function handleWaitlist() {
    if (!waitlistEmail.trim() || waitlistState === "loading" || waitlistState === "success") return;
    setWaitlistState("loading");
    try {
      await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: waitlistEmail.trim() }),
      });
      setWaitlistState("success");
      setWaitlistCount(c => c + 1);
    } catch {
      // Still show success for UX — backend may not exist yet
      setWaitlistState("success");
      setWaitlistCount(c => c + 1);
    }
  }

  // ── Preserved handler ─────────────────────────────────────────────────
  async function handleForgotPassword(email) {
    if (!email) {
      setForgotError(true);
      setTimeout(() => setForgotError(false), 4000);
      return;
    }
    setForgotLoading(true);
    try {
      await fetch("/api/email?action=reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      setForgotSent(true);
      setTimeout(() => setForgotSent(false), 5000);
    } catch {}
    setForgotLoading(false);
  }

  // ── Hero parallax ─────────────────────────────────────────────────────
  useEffect(() => {
    function onScroll() {
      if (!heroRef.current) return;
      const y = window.scrollY;
      const h = heroRef.current;
      const h1w  = h.querySelector(".l-par-h1");
      const subw = h.querySelector(".l-par-sub");
      const ctaw = h.querySelector(".l-par-cta");
      if (h1w)  h1w.style.transform  = `translateY(${y * 0.4}px)`;
      if (subw) subw.style.transform = `translateY(${y * 0.6}px)`;
      if (ctaw) ctaw.style.transform = `translateY(${y * 0.8}px)`;
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // ── Stat counter ──────────────────────────────────────────────────────
  useEffect(() => {
    const el = statsRef.current; if (!el) return;
    const obs = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      obs.disconnect();
      const dur = 600, target = 50, t0 = performance.now();
      function tick(now) {
        const p = Math.min((now - t0) / dur, 1);
        // ease-out quad
        setStatLangs(Math.round((1 - (1 - p) * (1 - p)) * target));
        if (p < 1) requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    }, { threshold: 0.3 });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div style={{ background: "#0a0010", minHeight: "100dvh", fontFamily: "var(--font-sans)", overflowX: "clip", color: "#F5F5F5" }}>

      {/* ── All animations ─────────────────────────────────────────────── */}
      <style>{`
        @keyframes lSheetUp { from{transform:translateY(100%)} to{transform:translateY(0)} }
        @keyframes lFadeUp  { from{opacity:0;transform:translateY(16px)} to{opacity:1;transform:none} }

        /* Hero glow breathing */
        @keyframes heroBreathe {
          0%,100% { transform:translateX(-50%) scale(1);    opacity:.08; }
          50%      { transform:translateX(-50%) scale(1.08); opacity:.14; }
        }

        /* Waveform bar oscillation — scaleY from centre-bottom */
        @keyframes waveBar {
          0%,100% { transform:scaleY(.35); }
          50%     { transform:scaleY(1);   }
        }

        /* Typing indicator dots */
        @keyframes typingDot {
          0%,60%,100% { transform:translateY(0);   opacity:.35; }
          30%          { transform:translateY(-5px); opacity:.9;  }
        }

        /* Stat heartbeat radial glow */
        @keyframes statGlow {
          0%,100% { transform:translate(-50%,-50%) scale(1);   opacity:.04; }
          50%      { transform:translate(-50%,-50%) scale(1.5); opacity:.09; }
        }

        /* Button primary shimmer sweep */
        @keyframes shimmerSweep {
          0%   { transform:translateX(-200%); }
          100% { transform:translateX(200%);  }
        }

        /* ── Base utility ── */
        .l-fade { opacity:0; animation: lFadeUp 0.65s cubic-bezier(0.25,0.46,0.45,0.94) forwards; }
        .l-d1{animation-delay:.05s} .l-d2{animation-delay:.18s} .l-d3{animation-delay:.32s}
        .l-d4{animation-delay:.46s} .l-d5{animation-delay:.62s}

        /* Parallax wrappers — will-change so GPU handles transforms */
        .l-par-h1,.l-par-sub,.l-par-cta { will-change:transform; }

        /* ── Nav ── */
        .l-nav-signin:hover { color:#F5F5F5 !important; }

        /* ── Primary pill button — shimmer on hover ── */
        .l-btn-primary {
          position:relative; overflow:hidden;
          border-radius:100px !important;
          transition: opacity .15s, transform .25s cubic-bezier(.34,1.56,.64,1) !important;
          will-change:transform;
        }
        .l-btn-primary:hover  { opacity:.88 !important; transform:scale(1.03) translateY(-1px) !important; }
        .l-btn-primary:active { transform:scale(.98) translateY(0) !important; }
        .l-btn-primary::after {
          content:''; position:absolute; top:0; left:0;
          width:50%; height:100%;
          background:linear-gradient(90deg,transparent,rgba(255,255,255,.28),transparent);
          transform:translateX(-200%); pointer-events:none;
        }
        .l-btn-primary:hover::after {
          animation:shimmerSweep .5s cubic-bezier(.22,1,.36,1) forwards;
        }

        /* ── Ghost pill button — curtain fill on hover ── */
        .l-btn-ghost {
          position:relative; overflow:hidden;
          border-radius:100px !important;
          transition:background .25s ease !important;
        }
        .l-btn-ghost::before {
          content:''; position:absolute; top:0; left:0;
          width:100%; height:100%;
          background:rgba(255,255,255,.07);
          transform:scaleX(0); transform-origin:left;
          transition:transform .3s cubic-bezier(.22,1,.36,1);
          pointer-events:none;
        }
        .l-btn-ghost:hover::before { transform:scaleX(1); }

        /* ── Feature cards — enhanced lift + gold glow ── */
        .l-feat-card {
          position:relative; overflow:hidden;
          transition:transform .25s cubic-bezier(.22,1,.36,1),
                     box-shadow .25s ease,
                     border-color .25s ease !important;
          will-change:transform;
        }
        .l-feat-card:hover {
          transform:translateY(-8px) !important;
          box-shadow:0 0 0 1px rgba(139,92,246,.32),
                     inset 0 0 40px rgba(139,92,246,.04),
                     0 28px 64px rgba(0,0,0,.45) !important;
        }
        /* Ambient glow inside each card */
        .l-feat-card .l-card-glow {
          position:absolute; top:50%; left:50%;
          width:55%; height:55%;
          background:radial-gradient(ellipse,rgba(139,92,246,.04) 0%,transparent 70%);
          transform:translate(-50%,-50%);
          animation:statGlow 4s ease-in-out infinite;
          pointer-events:none;
        }

        /* ── FAQ ── */
        .l-faq-row { border-bottom:1px solid rgba(255,255,255,.06); cursor:pointer; }
        .l-faq-row:hover .l-faq-q-text { color:#a855f7; }

        /* ── Waitlist section ── */
        @keyframes cardScroll {
          0%   { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        @keyframes cardScrollRev {
          0%   { transform: translateX(-50%); }
          100% { transform: translateX(0); }
        }
        .l-card-row-1 { animation: cardScroll 28s linear infinite; }
        .l-card-row-2 { animation: cardScrollRev 32s linear infinite; }
        .l-card-row-3 { animation: cardScroll 24s linear infinite; }
        .l-waitlist-input:focus { border-color: rgba(255,255,255,0.35) !important; outline: none; }
        .l-waitlist-btn:hover { background: rgba(255,255,255,1) !important; }
        .l-waitlist-btn:active { transform: scale(0.97); }
        @keyframes cdFlip {
          0%,45%  { transform: rotateX(0deg); }
          50%,95% { transform: rotateX(-90deg); }
          100%    { transform: rotateX(0deg); }
        }

        /* ── Glassmorphism panels ── */
        .l-glass {
          backdrop-filter: blur(18px) saturate(1.2);
          -webkit-backdrop-filter: blur(18px) saturate(1.2);
        }
        /* Reduce blur on mobile for perf */
        @media(hover:none){
          .l-glass {
            backdrop-filter: blur(8px);
            -webkit-backdrop-filter: blur(8px);
          }
        }

        /* ── Responsive ── */
        @media(max-width:640px){
          .l-hero-h1  { font-size:44px !important; letter-spacing:-1.8px !important; line-height:1.08 !important; }
          .l-hero-sub { font-size:16px !important; }
          .l-split     { flex-direction:column !important; }
          .l-split-rev { flex-direction:column !important; }
          .l-stats     { grid-template-columns:1fr !important; gap:40px !important; }
          .l-pricing   { grid-template-columns:1fr !important; }
          .l-sec       { padding:64px 20px !important; }
          .l-hero-sec  { padding:96px 20px 56px !important; }
          .l-card-pad  { padding:36px 24px !important; }
          .l-preview-r,.l-preview-l { display:none !important; }
        }
      `}</style>

      {/* ── ColorBends fixed background — deep violet/purple, behind everything ── */}
      {/* Explicit px dimensions: position:fixed with inset:0 doesn't give height to children */}
      {/* Canvas at z:0 — ABOVE body background, BELOW content wrapper at z:1 */}
      <div style={{ position: "fixed", top: 0, left: 0, width: "100vw", height: "100vh", zIndex: 0, pointerEvents: "none" }}>
        <ColorBends
          style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%" }}
          colors={["#a855f7", "#7c3aed"]}
          rotation={90}
          speed={0.2}
          scale={1.8}
          frequency={1}
          warpStrength={1}
          mouseInfluence={1}
          noise={0.15}
          parallax={0.5}
          iterations={1}
          intensity={1.5}
          bandWidth={6}
          transparent={true}
          autoRotate={0.3}
        />
      </div>

      {/* Content wrapper at z:1 — above canvas (z:0), backdrop-filter blurs canvas behind each section */}
      <div style={{ position: "relative", zIndex: 1 }}>

      {/* ── Nav ────────────────────────────────────────────────────────── */}
      <nav style={{ position: "sticky", top: 0, zIndex: 100, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 28px", background: "rgba(11,11,13,0.55)", backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <img src="/logo.jpeg" alt="FSchoolAI" style={{ width: 28, height: 28, borderRadius: "7px", objectFit: "cover", flexShrink: 0 }} />
          <span style={{ fontWeight: "700", fontSize: "15px", letterSpacing: "-0.3px", color: "#F5F5F5" }}>FSchoolAI</span>
        </div>
        <button className="l-nav-signin" onClick={() => setAuthMode("login")}
          style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", fontSize: "14px", fontWeight: "500", cursor: "pointer", fontFamily: "inherit", transition: "color .15s" }}>
          Sign in
        </button>
      </nav>

      {/* ── Hero ───────────────────────────────────────────────────────── */}
      <section ref={heroRef} className="l-hero-sec" style={{ padding: "120px 24px 80px", background: "transparent", textAlign: "center", position: "relative", overflow: "hidden" }}>

        {/* Scrim: bottom gradient so hero content blends into next section */}
        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: "200px", background: "linear-gradient(to bottom, transparent, rgba(13,13,15,0.9))", pointerEvents: "none", zIndex: 0 }} />

        {/* Parallax layers — wrapper divs receive the JS transform, inner elements animate in via CSS */}
        <div className="l-par-h1" style={{ willChange: "transform", position: "relative", zIndex: 2 }}>
          <p className="l-fade l-d1" style={{ display: "inline-block", fontSize: "11px", fontWeight: "600", color: "rgba(168,85,247,0.85)", letterSpacing: "2.5px", textTransform: "uppercase", background: "rgba(139,92,246,0.1)", border: "1px solid rgba(139,92,246,0.25)", borderRadius: "20px", padding: "5px 14px", marginBottom: "28px" }}>
            Beta — 1 month free
          </p>
          <h1 className="l-hero-h1 l-fade l-d2" style={{ display: "block", fontSize: "76px", fontWeight: "700", fontFamily: "'Fraunces',Georgia,serif", color: "#F5F5F5", letterSpacing: "-2.8px", lineHeight: "1.04", maxWidth: "760px", margin: "0 auto 22px" }}>
            #1 Student Academic Intelligence
          </h1>
        </div>

        <div className="l-par-sub" style={{ willChange: "transform", position: "relative", zIndex: 2 }}>
          <p className="l-hero-sub l-fade l-d3" style={{ fontSize: "18px", color: "rgba(255,255,255,0.42)", maxWidth: "480px", margin: "0 auto 40px", lineHeight: "1.7" }}>
            Canvas courses, class notes, and AI in one intelligent space — organized the way you actually study.
          </p>
        </div>

        <div className="l-par-cta" style={{ willChange: "transform", position: "relative", zIndex: 2 }}>
          {/* CTAs */}
          <div className="l-fade l-d4" style={{ display: "flex", gap: "12px", justifyContent: "center", flexWrap: "wrap", marginBottom: "28px" }}>
            <button className="l-btn-primary" onClick={() => setAuthMode("signup")}
              style={{ background: "rgba(255,255,255,0.92)", color: "#111", border: "none", borderRadius: "100px", padding: "14px 30px", fontSize: "15px", fontWeight: "600", cursor: "pointer", fontFamily: "inherit" }}>
              Join the Beta →
            </button>
            <button className="l-btn-ghost" onClick={() => setAuthMode("login")}
              style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "100px", color: "rgba(255,255,255,0.65)", padding: "14px 24px", fontSize: "15px", cursor: "pointer", fontFamily: "inherit" }}>
              Sign in
            </button>
          </div>

          {/* App Store badge */}
          <div className="l-fade l-d4" style={{ display: "flex", justifyContent: "center", marginBottom: "60px" }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: "10px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "10px", padding: "9px 16px", cursor: "default" }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" fill="rgba(255,255,255,0.6)"/></svg>
              <div style={{ textAlign: "left" }}>
                <p style={{ fontSize: "9px", color: "rgba(255,255,255,0.3)", lineHeight: 1, marginBottom: "2px" }}>Available soon on the</p>
                <p style={{ fontSize: "13px", fontWeight: "700", color: "#F5F5F5", lineHeight: 1 }}>App Store</p>
              </div>
              <span style={{ fontSize: "9px", fontWeight: "600", color: "rgba(255,255,255,0.3)", background: "rgba(255,255,255,0.07)", borderRadius: "6px", padding: "2px 7px", letterSpacing: "0.5px", textTransform: "uppercase" }}>Soon</span>
            </div>
          </div>

          {/* Product preview */}
          <div className="l-fade l-d5"><HeroPreview /></div>
        </div>

        {/* Section bottom fade — removed, replaced by hero scrim above */}
      </section>

      {/* ── Feature 1: Recording ───────────────────────────────────────── */}
      <section className="l-sec" style={{ padding: "80px 24px", background: "rgba(11,11,13,0.72)", position: "relative", backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)" }}>
        <div style={{ maxWidth: "960px", margin: "0 auto" }}>
          <Reveal>
            <div className="l-feat-card l-card-pad l-split l-glass" style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderTop: "2px solid rgba(139,92,246,0.5)", borderRadius: "28px", padding: "56px 52px", display: "flex", gap: "52px", alignItems: "center", boxShadow: "0 8px 40px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.08)" }}>
              <div className="l-card-glow" />
              <Reveal delay={0} style={{ flex: "1 1 0", minWidth: 0 }}>
                <p style={{ fontSize: "11px", fontWeight: "600", letterSpacing: "2px", textTransform: "uppercase", color: "rgba(168,85,247,0.7)", marginBottom: "16px" }}>In-class recording</p>
                <h2 style={{ fontFamily: "'Fraunces',Georgia,serif", fontSize: "36px", fontWeight: "700", color: "#F5F5F5", letterSpacing: "-0.8px", lineHeight: "1.15", marginBottom: "18px" }}>Never miss what's said in class.</h2>
                <p style={{ fontSize: "15px", color: "rgba(255,255,255,0.45)", lineHeight: "1.75" }}>FSchoolAI captures and transcribes your lectures in real time. Review exactly what was covered — searchable, always there, in your own notes.</p>
              </Reveal>
              <Reveal delay={100} style={{ flex: "1 1 0", minWidth: 0, display: "flex", justifyContent: "center" }}>
                <RecordingMockup />
              </Reveal>
            </div>
          </Reveal>
        </div>
        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: "60px", background: "linear-gradient(to bottom,transparent,rgba(0,0,0,0.25))", pointerEvents: "none" }} />
      </section>

      {/* ── Feature 2: AI Tutor ─────────────────────────────────────────── */}
      <section className="l-sec" style={{ padding: "20px 24px 80px", background: "rgba(11,11,13,0.72)", position: "relative", backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)" }}>
        <div style={{ maxWidth: "960px", margin: "0 auto" }}>
          <Reveal>
            <div className="l-feat-card l-card-pad l-split-rev l-glass" style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderTop: "2px solid rgba(139,92,246,0.5)", borderRadius: "28px", padding: "56px 52px", display: "flex", flexDirection: "row-reverse", gap: "52px", alignItems: "center", boxShadow: "0 8px 40px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.08)" }}>
              <div className="l-card-glow" />
              <Reveal delay={0} style={{ flex: "1 1 0", minWidth: 0 }}>
                <p style={{ fontSize: "11px", fontWeight: "600", letterSpacing: "2px", textTransform: "uppercase", color: "rgba(168,85,247,0.7)", marginBottom: "16px" }}>AI Tutor</p>
                <h2 style={{ fontFamily: "'Fraunces',Georgia,serif", fontSize: "36px", fontWeight: "700", color: "#F5F5F5", letterSpacing: "-0.8px", lineHeight: "1.15", marginBottom: "18px" }}>Your own AI tutor who knows your courses.</h2>
                <p style={{ fontSize: "15px", color: "rgba(255,255,255,0.45)", lineHeight: "1.75" }}>Answers grounded in your actual lecture notes — not just the internet. Ask anything about your courses and get answers that make sense for your class.</p>
              </Reveal>
              <Reveal delay={100} style={{ flex: "1 1 0", minWidth: 0, display: "flex", justifyContent: "center" }}>
                <TutorMockup />
              </Reveal>
            </div>
          </Reveal>
        </div>
        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: "60px", background: "linear-gradient(to bottom,transparent,rgba(0,0,0,0.25))", pointerEvents: "none" }} />
      </section>

      {/* ── Feature 3: Study Rooms ──────────────────────────────────────── */}
      <section className="l-sec" style={{ padding: "20px 24px 80px", background: "rgba(11,11,13,0.72)", position: "relative", backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)" }}>
        <div style={{ maxWidth: "960px", margin: "0 auto" }}>
          <Reveal>
            <div className="l-feat-card l-card-pad l-split l-glass" style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderTop: "2px solid rgba(139,92,246,0.5)", borderRadius: "28px", padding: "56px 52px", display: "flex", gap: "52px", alignItems: "center", position: "relative", boxShadow: "0 8px 40px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.08)" }}>
              <div className="l-card-glow" />
              <span style={{ position: "absolute", top: "22px", right: "24px", fontSize: "10px", fontWeight: "600", letterSpacing: "1.5px", textTransform: "uppercase", color: "rgba(255,255,255,0.3)", background: "rgba(255,255,255,0.06)", borderRadius: "7px", padding: "4px 10px" }}>Coming soon</span>
              <Reveal delay={0} style={{ flex: "1 1 0", minWidth: 0 }}>
                <p style={{ fontSize: "11px", fontWeight: "600", letterSpacing: "2px", textTransform: "uppercase", color: "rgba(168,85,247,0.7)", marginBottom: "16px" }}>Study rooms</p>
                <h2 style={{ fontFamily: "'Fraunces',Georgia,serif", fontSize: "36px", fontWeight: "700", color: "#F5F5F5", letterSpacing: "-0.8px", lineHeight: "1.15", marginBottom: "18px" }}>Study together. Add friends, join a room.</h2>
                <p style={{ fontSize: "15px", color: "rgba(255,255,255,0.45)", lineHeight: "1.75" }}>Create study rooms, invite friends from your school, and learn together in real time. Shared notes, shared focus.</p>
              </Reveal>
              <Reveal delay={100} style={{ flex: "1 1 0", minWidth: 0, display: "flex", justifyContent: "center" }}>
                <StudyRoomMockup />
              </Reveal>
            </div>
          </Reveal>
        </div>
        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: "80px", background: "linear-gradient(to bottom,transparent,rgba(0,0,0,0.4))", pointerEvents: "none" }} />
      </section>

      {/* ── Stats ──────────────────────────────────────────────────────── */}
      <section ref={statsRef} className="l-sec" style={{ padding: "96px 24px", background: "rgba(8,6,14,0.55)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", textAlign: "center", borderTop: "1px solid rgba(255,255,255,0.06)", borderBottom: "1px solid rgba(255,255,255,0.06)", position: "relative" }}>
        <div style={{ maxWidth: "800px", margin: "0 auto" }}>
          <Reveal>
            <p style={{ fontSize: "11px", fontWeight: "600", letterSpacing: "2.5px", textTransform: "uppercase", color: "rgba(168,85,247,0.65)", marginBottom: "64px" }}>By the numbers</p>
          </Reveal>
          <div className="l-stats" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "48px" }}>
            {[
              { val: "Real-time", disp: null,       cap: "transcription, no delay", delay: 0   },
              { val: "50+",       disp: statLangs,  cap: "languages supported",     delay: 80  },
              { val: "1 month",   disp: null,       cap: "free on beta signup",     delay: 160 },
            ].map(({ val, disp, cap, delay: d }) => (
              <Reveal key={val} delay={d}>
                <div style={{ position: "relative" }}>
                  {/* Heartbeat glow */}
                  <div style={{ position: "absolute", top: "50%", left: "50%", width: "120px", height: "120px", background: "radial-gradient(circle,rgba(139,92,246,0.07) 0%,transparent 70%)", animation: `statGlow 3s ease-in-out infinite ${d * 0.002}s`, pointerEvents: "none" }} />
                  <p style={{ fontFamily: "'Fraunces',Georgia,serif", fontSize: "48px", fontWeight: "700", color: "#F5F5F5", letterSpacing: "-1.5px", lineHeight: 1, marginBottom: "12px", position: "relative" }}>
                    {disp !== null ? `${disp}+` : val}
                  </p>
                  <p style={{ fontSize: "14px", color: "rgba(255,255,255,0.35)", lineHeight: "1.5", position: "relative" }}>{cap}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: "80px", background: "linear-gradient(to bottom,transparent,rgba(0,0,0,0.35))", pointerEvents: "none" }} />
      </section>

      {/* ── Pricing ──────────────────────────────────────────────────────── */}
      <section className="l-sec" style={{ padding: "96px 24px", background: "rgba(11,11,13,0.78)", position: "relative", backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)" }}>
        <div style={{ maxWidth: "820px", margin: "0 auto" }}>
          <Reveal style={{ textAlign: "center", marginBottom: "56px" }}>
            <p style={{ fontSize: "11px", fontWeight: "600", letterSpacing: "2.5px", textTransform: "uppercase", color: "rgba(168,85,247,0.65)", marginBottom: "14px" }}>Pricing</p>
            <h2 style={{ fontFamily: "'Fraunces',Georgia,serif", fontSize: "44px", fontWeight: "700", color: "#F5F5F5", letterSpacing: "-1.4px", marginBottom: "10px" }}>Simple pricing.</h2>
            <p style={{ fontSize: "16px", color: "rgba(255,255,255,0.38)" }}>Start free. Upgrade when you're ready.</p>
          </Reveal>

          <div className="l-pricing" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
            <Reveal delay={0}>
              <div style={{ background: "rgba(255,255,255,0.05)", backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "22px", padding: "36px 32px", display: "flex", flexDirection: "column", height: "100%" }}>
                <p style={{ fontSize: "13px", fontWeight: "700", color: "#F5F5F5", marginBottom: "8px" }}>Free</p>
                <div style={{ marginBottom: "28px" }}>
                  <span style={{ fontFamily: "'Fraunces',Georgia,serif", fontSize: "44px", fontWeight: "700", color: "#F5F5F5" }}>$0</span>
                  <span style={{ fontSize: "14px", color: "rgba(255,255,255,0.35)", marginLeft: "4px" }}>/month</span>
                </div>
                <ul style={{ listStyle: "none", padding: 0, margin: "0 0 32px", display: "flex", flexDirection: "column", gap: "12px", flex: 1 }}>
                  {FREE_FEATURES.map(f => (
                    <li key={f} style={{ display: "flex", alignItems: "flex-start", gap: "10px", fontSize: "14px", color: "rgba(255,255,255,0.55)", lineHeight: "1.5" }}>
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, marginTop: "2px" }}><circle cx="8" cy="8" r="7" stroke="rgba(139,92,246,0.55)" strokeWidth="1.2"/><path d="M5 8l2.5 2.5L11 5.5" stroke="#a855f7" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      {f}
                    </li>
                  ))}
                </ul>
                <button className="l-btn-primary" onClick={() => setAuthMode("signup")}
                  style={{ width: "100%", background: "rgba(255,255,255,0.92)", color: "#111", border: "none", borderRadius: "100px", padding: "13px", fontSize: "15px", fontWeight: "600", cursor: "pointer", fontFamily: "inherit" }}>
                  Join the Beta →
                </button>
              </div>
            </Reveal>

            <Reveal delay={80}>
              <div style={{ background: "rgba(139,92,246,0.08)", backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)", border: "1px solid rgba(139,92,246,0.28)", borderRadius: "22px", padding: "36px 32px", display: "flex", flexDirection: "column", position: "relative", overflow: "hidden", height: "100%" }}>
                <div style={{ position: "absolute", top: "-60px", right: "-60px", width: "200px", height: "200px", background: "radial-gradient(circle,rgba(139,92,246,0.1) 0%,transparent 65%)", pointerEvents: "none" }} />
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                  <p style={{ fontSize: "13px", fontWeight: "700", color: "#F5F5F5" }}>Pro</p>
                  <span style={{ fontSize: "10px", fontWeight: "600", letterSpacing: "1.5px", textTransform: "uppercase", color: "rgba(168,85,247,0.7)", background: "rgba(139,92,246,0.1)", border: "1px solid rgba(139,92,246,0.25)", borderRadius: "6px", padding: "3px 8px" }}>Coming soon</span>
                </div>
                <div style={{ marginBottom: "28px" }}>
                  <span style={{ fontFamily: "'Fraunces',Georgia,serif", fontSize: "32px", fontWeight: "700", color: "rgba(255,255,255,0.4)" }}>Coming soon</span>
                </div>
                <ul style={{ listStyle: "none", padding: 0, margin: "0 0 32px", display: "flex", flexDirection: "column", gap: "12px", flex: 1 }}>
                  {PRO_FEATURES.map(f => (
                    <li key={f} style={{ display: "flex", alignItems: "flex-start", gap: "10px", fontSize: "14px", color: "rgba(255,255,255,0.4)", lineHeight: "1.5" }}>
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, marginTop: "2px" }}><circle cx="8" cy="8" r="7" stroke="rgba(139,92,246,0.3)" strokeWidth="1.2"/><path d="M5 8l2.5 2.5L11 5.5" stroke="rgba(139,92,246,0.35)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      {f}
                    </li>
                  ))}
                </ul>
                <button disabled style={{ width: "100%", background: "rgba(139,92,246,0.1)", color: "rgba(168,85,247,0.4)", border: "1px solid rgba(139,92,246,0.18)", borderRadius: "100px", padding: "13px", fontSize: "15px", fontWeight: "600", cursor: "default", fontFamily: "inherit" }}>
                  Get notified
                </button>
              </div>
            </Reveal>
          </div>
        </div>
        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: "80px", background: "linear-gradient(to bottom,transparent,rgba(0,0,0,0.35))", pointerEvents: "none" }} />
      </section>

      {/* ── FAQ ─────────────────────────────────────────────────────────── */}
      <section className="l-sec" style={{ padding: "96px 24px", background: "rgba(8,6,14,0.55)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
        <div style={{ maxWidth: "640px", margin: "0 auto" }}>
          <Reveal style={{ textAlign: "center", marginBottom: "52px" }}>
            <p style={{ fontSize: "11px", fontWeight: "600", letterSpacing: "2.5px", textTransform: "uppercase", color: "rgba(168,85,247,0.65)", marginBottom: "14px" }}>FAQ</p>
            <h2 style={{ fontFamily: "'Fraunces',Georgia,serif", fontSize: "42px", fontWeight: "700", color: "#F5F5F5", letterSpacing: "-1.2px" }}>Questions answered.</h2>
          </Reveal>

          {FAQ_DATA.map((item, i) => (
            <Reveal key={i} delay={i * 50}>
              <div className="l-faq-row" onClick={() => setFaqOpen(faqOpen === i ? null : i)}>
                <div className="l-faq-q-text" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px 0", fontSize: "15px", fontWeight: "600", color: faqOpen === i ? "#a855f7" : "#F5F5F5", transition: "color .15s" }}>
                  {item.q}
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, marginLeft: "16px", transform: faqOpen === i ? "rotate(180deg)" : "none", transition: "transform .22s" }}>
                    <path d="M3 6l5 5 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
                {faqOpen === i && (
                  <p style={{ fontSize: "14px", color: "rgba(255,255,255,0.45)", lineHeight: "1.75", paddingBottom: "20px" }}>{item.a}</p>
                )}
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <footer style={{ padding: "32px 28px", borderTop: "1px solid rgba(255,255,255,0.07)", background: "rgba(11,11,13,0.82)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <img src="/logo.jpeg" alt="FSchoolAI" style={{ width: 22, height: 22, borderRadius: "5px", objectFit: "cover" }} />
          <span style={{ fontWeight: "700", fontSize: "14px", color: "#F5F5F5" }}>FSchoolAI</span>
        </div>
        <span style={{ fontSize: "12px", color: "rgba(255,255,255,0.2)" }}>© 2026 FSchoolAI. All rights reserved.</span>
        <div style={{ display: "flex", gap: "20px" }}>
          {[["Privacy","#"],["Terms","#"],["Contact","#"]].map(([label,href]) => (
            <a key={label} href={href} style={{ fontSize: "12px", color: "rgba(255,255,255,0.28)", textDecoration: "none" }}>{label}</a>
          ))}
        </div>
      </footer>

      </div>{/* end content wrapper */}

      {/* ── Forgot-password banners (unchanged) ──────────────────────────── */}
      <style>{`
        @keyframes bannerIn {
          from { opacity:0; transform:translateX(-50%) translateY(-10px); }
          to   { opacity:1; transform:translateX(-50%) translateY(0); }
        }
      `}</style>
      {forgotError && (
        <div style={{ position:"fixed", top:"env(safe-area-inset-top, 0px)", left:"50%", transform:"translateX(-50%)", zIndex:1001, marginTop:"16px", width:"calc(100% - 40px)", maxWidth:"420px", padding:"14px 18px", borderRadius:"12px", display:"flex", alignItems:"center", gap:"14px", background:"#1a1814", border:"1px solid rgba(255,100,90,0.25)", boxShadow:"0 4px 28px rgba(0,0,0,0.28)", animation:"bannerIn 0.3s cubic-bezier(0.0,0.0,0.2,1.0) both" }}>
          <svg width="34" height="34" viewBox="0 0 34 34" fill="none" style={{flexShrink:0}}><circle cx="17" cy="17" r="16" stroke="#ff6961" strokeWidth="1" opacity="0.55"/><circle cx="17" cy="17" r="12" stroke="#ff6961" strokeWidth="1.4"/><path d="M12 12l10 10M22 12l-10 10" stroke="#ff6961" strokeWidth="2" strokeLinecap="round"/></svg>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:"13px", fontWeight:"700", color:"#ff6961", letterSpacing:"-0.1px", marginBottom:"3px" }}>Enter your email first</div>
            <div style={{ fontSize:"12px", color:"rgba(255,255,255,0.42)" }}>Type your email above, then tap Forgot password.</div>
          </div>
        </div>
      )}
      {forgotSent && (
        <div style={{ position:"fixed", top:"env(safe-area-inset-top, 0px)", left:"50%", transform:"translateX(-50%)", zIndex:1001, marginTop:"16px", width:"calc(100% - 40px)", maxWidth:"420px", padding:"14px 18px", borderRadius:"12px", display:"flex", alignItems:"center", gap:"14px", background:"#F6F2E9", border:"1px solid rgba(139,92,246,0.3)", boxShadow:"0 4px 28px rgba(0,0,0,0.24)", animation:"bannerIn 0.3s cubic-bezier(0.0,0.0,0.2,1.0) both" }}>
          <svg width="34" height="34" viewBox="0 0 34 34" fill="none" style={{flexShrink:0}}><circle cx="17" cy="17" r="16" stroke="#a855f7" strokeWidth="1" strokeDasharray="4 2.5" opacity="0.5"/><circle cx="17" cy="17" r="12" stroke="#a855f7" strokeWidth="1.4"/><path d="M11 17l4.5 4.5 7.5-8" stroke="#a855f7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:"13px", fontWeight:"700", color:"#1a1814", letterSpacing:"-0.1px", marginBottom:"3px" }}>Reset email sent</div>
            <div style={{ fontSize:"12px", color:"rgba(26,24,20,0.5)" }}>Check your inbox — link expires in 1 hour.</div>
          </div>
        </div>
      )}

      {/* ── Auth modal ──────────────────────────────────────────────────── */}
      {authMode && (
        <AuthModal
          mode={authMode}
          onClose={() => setAuthMode(null)}
          onEnter={onEnter}
          onSwitchMode={setAuthMode}
          onForgotPassword={handleForgotPassword}
        />
      )}
    </div>
  );
}

// FschoolAI Founding Card — Apple AirPods Pro 3 buy flow + iPhone 17 Pro cinematic scroll
import { useState, useEffect, useRef } from "react";
import { Brain, Bot, Mic, BookOpen, Radio, Medal, Gem, Trophy, Infinity as InfinityIcon, Truck, RotateCcw, GraduationCap, PartyPopper } from "lucide-react";

/* ─── Data ───────────────────────────────────────────────────────────────── */
const COLORWAYS = [
  { id: "white",  name: "Base White",   tagline: "Clean. Timeless. Iconic.",       hex: "#F5F5F0", img: "/card-white.jpg" },
  { id: "purple", name: "Royal Purple", tagline: "Bold. Regal. Unforgettable.",     hex: "#C8B4F0", img: "/card-purple.jpg" },
  { id: "pink",   name: "Royal Pink",   tagline: "Vivid. Confident. Distinct.",     hex: "#F0B8CC", img: "/card-pink.jpg" },
  { id: "blue",   name: "Royal Blue",   tagline: "Sharp. Focused. Brilliant.",      hex: "#B4D0F0", img: "/card-blue.jpg" },
  { id: "green",  name: "Royal Green",  tagline: "Fresh. Grounded. Alive.",         hex: "#D8ECA0", img: "/card-green.jpg" },
];

const FEATURES = [
  { icon: Brain,        title: "NeuroAGI Brain ID",           desc: "Your unique neural identity across the entire NeuroAGI ecosystem" },
  { icon: Bot,          title: "AI Tutor — Priority",          desc: "24/7 personal AI tutor grounded in your actual lecture notes" },
  { icon: Mic,          title: "In-Class Recording",           desc: "Real-time transcription, searchable, always in your notes" },
  { icon: BookOpen,     title: "Canvas Sync",                  desc: "Every course, assignment, and deadline — automatically synced" },
  { icon: Radio,        title: "NFC Tap",                      desc: "One tap shares your full profile and Brain Card instantly" },
  { icon: Medal,        title: "Founding Number #0001–#0500",  desc: "Permanently engraved — only 500 exist, ever" },
  { icon: Gem,          title: "FST Token Wallet",             desc: "Built-in wallet — earn, hold, and spend FST tokens" },
  { icon: Trophy,       title: "Leaderboard Badge",            desc: "Verified rank badge on the FschoolAI global leaderboard" },
  { icon: InfinityIcon, title: "Lifetime FschoolAI Pro",       desc: "Every Pro feature, every future update — forever, no subscription" },
];

/* ─── Hooks ──────────────────────────────────────────────────────────────── */
function useCountdown(target) {
  const [t, setT] = useState({ d: 0, h: 0, m: 0, s: 0 });
  useEffect(() => {
    const tick = () => {
      const diff = Math.max(0, +new Date(target) - +new Date());
      setT({ d: Math.floor(diff / 86400000), h: Math.floor(diff / 3600000) % 24, m: Math.floor(diff / 60000) % 60, s: Math.floor(diff / 1000) % 60 });
    };
    tick(); const id = setInterval(tick, 1000); return () => clearInterval(id);
  }, [target]);
  return t;
}

function useReveal(threshold = 0.12) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setVisible(true); obs.disconnect(); } }, { threshold });
    obs.observe(el); return () => obs.disconnect();
  }, [threshold]);
  return [ref, visible];
}

/* ─── Feature Visuals ────────────────────────────────────────────────────── */
function FeatureVisual({ type }) {
  const s = { borderRadius: 16, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", padding: "20px", maxWidth: 320, width: "100%" };
  const lbl = { fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "rgba(255,255,255,0.35)", marginBottom: 12 };
  const row = { display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: "1px solid rgba(255,255,255,0.05)" };

  if (type === "tutor") return (
    <div style={s}>
      <div style={lbl}>AI Tutor · BIOL 201</div>
      {[{ role: "user", msg: "What's homeostasis?" }, { role: "ai", msg: "Based on your Lecture 4 notes, homeostasis is the body's mechanism for maintaining stable internal conditions — your professor used temperature regulation as the key example." }].map((m, i) => (
        <div key={i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start", marginBottom: 10 }}>
          <div style={{ maxWidth: "82%", background: m.role === "user" ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.05)", borderRadius: 12, padding: "8px 12px", fontSize: 12, color: m.role === "user" ? "rgba(255,255,255,0.8)" : "rgba(255,255,255,0.55)", lineHeight: 1.55 }}>{m.msg}</div>
        </div>
      ))}
    </div>
  );
  if (type === "recording") return (
    <div style={s}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#ff3b30", boxShadow: "0 0 8px #ff3b30" }} />
        <span style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", letterSpacing: "0.05em" }}>REC 00:04 · COMP 101</span>
      </div>
      <div style={lbl}>Live Transcript</div>
      {["…cognitive load theory suggests working memory has limited capacity…", "…four components: phonological loop, visuospatial sketchpad…"].map((t, i) => (
        <div key={i} style={{ fontSize: 13, color: i === 0 ? "#f5f5f7" : "rgba(245,245,247,0.4)", padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.04)", lineHeight: 1.5 }}>{t}</div>
      ))}
    </div>
  );
  if (type === "canvas") return (
    <div style={s}>
      <div style={lbl}>Canvas · 3 Courses</div>
      {[{ course: "COMP 101", item: "Problem Set 4", due: "Tomorrow", color: "#ff3b30" }, { course: "BIOL 201", item: "Lab Report", due: "May 28", color: "#ff9500" }, { course: "MATH 150", item: "Midterm Review", due: "Jun 2", color: "#30d158" }].map((a, i) => (
        <div key={i} style={{ ...row }}>
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: a.color, flexShrink: 0 }} />
          <div style={{ flex: 1 }}><div style={{ fontSize: 13, color: "#f5f5f7", fontWeight: 500 }}>{a.item}</div><div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)" }}>{a.course}</div></div>
          <div style={{ fontSize: 12, color: a.color }}>{a.due}</div>
        </div>
      ))}
    </div>
  );
  if (type === "leaderboard") return (
    <div style={s}>
      <div style={lbl}>Global Leaderboard</div>
      {[{ rank: 1, name: "You", score: "847h", founding: "#0042" }, { rank: 2, name: "Pratik S.", score: "812h", founding: "#0089" }, { rank: 3, name: "Shreya M.", score: "798h", founding: "#0156" }].map((u) => (
        <div key={u.rank} style={{ ...row, borderBottom: u.rank < 3 ? "1px solid rgba(255,255,255,0.05)" : "none" }}>
          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.3)", width: 18 }}>#{u.rank}</div>
          <div style={{ flex: 1 }}><div style={{ fontSize: 13, color: u.rank === 1 ? "#f5f5f7" : "rgba(255,255,255,0.6)", fontWeight: u.rank === 1 ? 600 : 400 }}>{u.name}</div><div style={{ fontSize: 11, color: "rgba(255,255,255,0.25)" }}>Founding {u.founding}</div></div>
          <div style={{ fontSize: 13, color: u.rank === 1 ? "#a78bfa" : "rgba(255,255,255,0.35)" }}>{u.score}</div>
        </div>
      ))}
    </div>
  );
  return null;
}

/* ─── Main ───────────────────────────────────────────────────────────────── */
export default function Card() {
  const [selected, setSelected]               = useState(0);
  const [engraving, setEngraving]             = useState("");
  const [engravingChoice, setEngravingChoice] = useState(null);
  const [isFounder, setFounder]               = useState(false);
  const [scrolled, setScrolled]               = useState(false);
  const [formData, setFormData]               = useState({ name: "", university: "", email: "" });
  const [submitted, setSubmitted]             = useState(false);
  const [submitting, setSub]                  = useState(false);
  const countdown = useCountdown("2026-06-30T23:59:59");
  const applyRef = useRef(null);

  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 50);
    window.addEventListener("scroll", fn, { passive: true });
    return () => window.removeEventListener("scroll", fn);
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!formData.name || !formData.email) return;
    setSub(true);
    await new Promise(r => setTimeout(r, 1400));
    setSubmitted(true); setSub(false);
  }

  const cw = COLORWAYS[selected];

  const CINEMATIC = [
    { eyebrow: "AI Tutor",           headline: "Your tutor.\nAlways on.",         body: "Priority access to your personal FschoolAI AI tutor — 24/7, for every subject, forever. Answers grounded in your actual lecture notes, not just the internet.", bg: "#000",   visual: "tutor" },
    { eyebrow: "In-Class Recording", headline: "Never miss\nwhat's said.",        body: "FschoolAI captures and transcribes your lectures in real time. Searchable, always there, in your own notes.", bg: "#0a0a0a", visual: "recording" },
    { eyebrow: "Canvas Sync",        headline: "Every course.\nEvery deadline.",  body: "Connect your Canvas account and FschoolAI pulls every course, assignment, and deadline automatically. Your card is linked to your verified academic identity.", bg: "#000",   visual: "canvas" },
    { eyebrow: "Leaderboard",        headline: "Your rank.\nYour legacy.",         body: "Founding members get a permanent verified badge on the FschoolAI global leaderboard. Your founding number is your identity — forever.", bg: "#0a0a0a", visual: "leaderboard" },
  ];

  return (
    <div style={{ background: "#000", minHeight: "100dvh", fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Helvetica Neue', sans-serif", color: "#f5f5f7", overflowX: "hidden" }}>

      {/* HEADER */}
      <header style={{
        position: "fixed", top: 0, left: 0, right: 0, zIndex: 200,
        height: 52,
        background: scrolled ? "rgba(0,0,0,0.88)" : "transparent",
        backdropFilter: scrolled ? "blur(24px) saturate(180%)" : "none",
        WebkitBackdropFilter: scrolled ? "blur(24px) saturate(180%)" : "none",
        borderBottom: scrolled ? "1px solid rgba(255,255,255,0.07)" : "none",
        transition: "background 0.35s, border-color 0.35s",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 20px",
      }}>
        <a href="/" style={{ color: "rgba(255,255,255,0.7)", fontSize: 13, textDecoration: "none", display: "flex", alignItems: "center", gap: 3, minWidth: 90 }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M15 18l-6-6 6-6"/></svg>
          FschoolAI
        </a>
        <span style={{ fontSize: 14, fontWeight: 600, letterSpacing: "-0.3px", color: scrolled ? "rgba(255,255,255,0.88)" : "transparent", transition: "color 0.35s", position: "absolute", left: "50%", transform: "translateX(-50%)", whiteSpace: "nowrap" }}>
          Founding Card
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 18, minWidth: 90, justifyContent: "flex-end" }}>
          <a href="#features" style={{ fontSize: 13, color: "rgba(255,255,255,0.55)", textDecoration: "none" }}>Explore</a>
          <a href="#apply" onClick={e => { e.preventDefault(); applyRef.current?.scrollIntoView({ behavior: "smooth" }); }} style={{ fontSize: 13, fontWeight: 600, color: "#000", background: "#f5f5f7", borderRadius: 980, padding: "6px 16px", textDecoration: "none" }}>Apply</a>
        </div>
      </header>

      {/* HERO */}
      <section style={{ position: "relative", height: "100dvh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", overflow: "hidden" }}>
        <img src="/card-group.jpg" alt="FschoolAI Founding Card" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", objectPosition: "center 45%" }} />
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to bottom, rgba(0,0,0,0.1) 0%, rgba(0,0,0,0) 35%, rgba(0,0,0,0.65) 75%, rgba(0,0,0,0.96) 100%)" }} />
        <div style={{ position: "relative", textAlign: "center", padding: "0 24px 80px" }}>
          <p style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(255,255,255,0.5)", marginBottom: 14 }}>Founding Edition · Only 500</p>
          <h1 style={{ fontSize: "clamp(44px, 11vw, 88px)", fontWeight: 700, lineHeight: 1.02, letterSpacing: "-0.035em", margin: "0 0 16px", color: "#f5f5f7" }}>FschoolAI<br />Founding Card</h1>
          <p style={{ fontSize: 17, color: "rgba(255,255,255,0.55)", marginBottom: 36, fontWeight: 400, letterSpacing: "-0.01em" }}>Free for founding members. Ships Q4 2026.</p>
          <button onClick={() => applyRef.current?.scrollIntoView({ behavior: "smooth" })} style={{ background: "#fff", color: "#1d1d1f", border: "none", borderRadius: 980, padding: "16px 36px", fontSize: 17, fontWeight: 600, cursor: "pointer", letterSpacing: "-0.01em" }}>
            Apply for your card
          </button>
        </div>
        <div style={{ position: "absolute", bottom: 28, left: "50%", transform: "translateX(-50%)", animation: "bounce 2s ease-in-out infinite" }}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M10 4v12M4 10l6 6 6-6" stroke="rgba(255,255,255,0.35)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </div>
        <style>{`@keyframes bounce{0%,100%{transform:translateX(-50%) translateY(0)}50%{transform:translateX(-50%) translateY(7px)}} @keyframes slowZoom{from{transform:scale(1)}to{transform:scale(1.06)}}`}</style>
      </section>

      {/* COUNTDOWN */}
      <section style={{ background: "#111", padding: "48px 24px", textAlign: "center", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <p style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(255,255,255,0.35)", marginBottom: 24 }}>Applications close</p>
        <div style={{ display: "flex", justifyContent: "center", gap: "clamp(20px, 6vw, 56px)" }}>
          {[["d", "DAYS"], ["h", "HOURS"], ["m", "MIN"], ["s", "SEC"]].map(([k, l]) => (
            <div key={k} style={{ textAlign: "center" }}>
              <div style={{ fontSize: "clamp(44px, 11vw, 76px)", fontWeight: 700, letterSpacing: "-0.04em", lineHeight: 1, color: "#f5f5f7", fontVariantNumeric: "tabular-nums" }}>{String(countdown[k]).padStart(2, "0")}</div>
              <div style={{ fontSize: 11, letterSpacing: "0.1em", color: "rgba(255,255,255,0.3)", marginTop: 8 }}>{l}</div>
            </div>
          ))}
        </div>
        <p style={{ fontSize: 13, color: "rgba(255,255,255,0.25)", marginTop: 20 }}>June 30, 2026 · Midnight</p>
      </section>

      {/* MANIFESTO */}
      <section style={{ padding: "100px 24px", textAlign: "center" }}>
        <div style={{ maxWidth: 680, margin: "0 auto" }}>
          <p style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(255,255,255,0.3)", marginBottom: 20 }}>What is FschoolAI</p>
          <h2 style={{ fontSize: "clamp(34px, 7vw, 60px)", fontWeight: 700, lineHeight: 1.08, letterSpacing: "-0.03em", color: "#f5f5f7", margin: "0 0 24px" }}>The AI that actually<br />knows your courses.</h2>
          <p style={{ fontSize: 17, color: "rgba(255,255,255,0.45)", lineHeight: 1.75, maxWidth: 520, margin: "0 auto" }}>Canvas sync. In-class recording. AI tutor grounded in your actual lecture notes. The Founding Card is your key to all of it — forever.</p>
        </div>
      </section>

      {/* COLORWAY PICKER — selected glows, others black out */}
      <section data-colorway-section style={{ padding: "80px 24px", borderTop: "1px solid rgba(255,255,255,0.05)" }}>
        <div style={{ maxWidth: 900, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: 48 }}>
            <p style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(255,255,255,0.3)", marginBottom: 16 }}>Colorway</p>
            <h2 style={{ fontSize: "clamp(32px, 6vw, 52px)", fontWeight: 700, letterSpacing: "-0.03em", color: "#f5f5f7", margin: "0 0 8px" }}>{cw.name}</h2>
            <p style={{ fontSize: 15, color: "rgba(255,255,255,0.4)" }}>{cw.tagline}</p>
          </div>
          <div style={{ display: "flex", justifyContent: "center", gap: "clamp(8px, 3vw, 24px)", marginBottom: 40, flexWrap: "wrap" }}>
            {COLORWAYS.map((c, i) => (
              <button key={c.id} onClick={() => setSelected(i)} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", transition: "transform 0.3s, filter 0.3s", transform: selected === i ? "scale(1.08) translateY(-8px)" : "scale(1)", filter: selected === i ? "brightness(1) drop-shadow(0 0 20px rgba(255,255,255,0.25))" : "brightness(0.25) saturate(0)", borderRadius: 12, overflow: "hidden" }}>
                <img src={c.img} alt={c.name} style={{ width: "clamp(80px, 15vw, 140px)", height: "clamp(120px, 22vw, 210px)", objectFit: "cover", display: "block", borderRadius: 12 }} />
              </button>
            ))}
          </div>
          <div style={{ display: "flex", justifyContent: "center", gap: 12 }}>
            {COLORWAYS.map((c, i) => (
              <button key={c.id} onClick={() => setSelected(i)} title={c.name} style={{ width: 28, height: 28, borderRadius: "50%", background: c.hex, border: selected === i ? "3px solid #fff" : "3px solid transparent", outline: selected === i ? "2px solid rgba(255,255,255,0.5)" : "2px solid rgba(255,255,255,0.12)", outlineOffset: 2, cursor: "pointer", transition: "all 0.2s" }} />
            ))}
          </div>
        </div>
      </section>

      {/* ENGRAVING — Apple side-by-side */}
      <section style={{ padding: "100px 24px", background: "#0a0a0a", borderTop: "1px solid rgba(255,255,255,0.05)" }}>
        <div style={{ maxWidth: 900, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: 60 }}>
            <p style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(255,255,255,0.3)", marginBottom: 16 }}>Personalize</p>
            <h2 style={{ fontSize: "clamp(32px, 6vw, 52px)", fontWeight: 700, letterSpacing: "-0.03em", color: "#f5f5f7", margin: "0 0 12px" }}>Make it yours.</h2>
            <p style={{ fontSize: 17, color: "rgba(255,255,255,0.4)" }}>Laser-engraved on the back. Free. Delivers just as fast.</p>
          </div>
          <div style={{ display: "flex", flexDirection: "row", gap: 48, alignItems: "flex-start", flexWrap: "wrap", justifyContent: "center" }}>
            <div style={{ flex: "0 0 auto", display: "flex", flexDirection: "column", alignItems: "center", gap: 20 }}>
              <div style={{ position: "relative", width: 200, height: 320 }}>
                <img src={cw.img} alt={cw.name} style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 16, boxShadow: "0 24px 64px rgba(0,0,0,0.6)" }} />
                {engraving && engravingChoice === "add" && (
                  <div style={{ position: "absolute", bottom: 28, left: 0, right: 0, textAlign: "center" }}>
                    <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.14em", color: "rgba(255,255,255,0.55)", textTransform: "uppercase", textShadow: "0 1px 4px rgba(0,0,0,0.8)" }}>{engraving}</span>
                  </div>
                )}
              </div>
              <p style={{ fontSize: 13, color: "rgba(255,255,255,0.3)" }}>{cw.name}</p>
            </div>
            <div style={{ flex: "1 1 300px", maxWidth: 400, display: "flex", flexDirection: "column", gap: 12 }}>
              <button
                onClick={() => setEngravingChoice(engravingChoice === "add" ? null : "add")}
                style={{ width: "100%", background: engravingChoice === "add" ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.03)", border: engravingChoice === "add" ? "1.5px solid rgba(255,255,255,0.3)" : "1.5px solid rgba(255,255,255,0.1)", borderRadius: 16, padding: "20px", cursor: "pointer", textAlign: "left", transition: "all 0.2s" }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <p style={{ fontSize: 16, fontWeight: 600, color: "#f5f5f7", marginBottom: 4 }}>Add Engraving</p>
                    <p style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", lineHeight: 1.5 }}>Your name, initials, or student ID — laser-engraved on the back.</p>
                  </div>
                  <span style={{ fontSize: 14, fontWeight: 500, color: "rgba(255,255,255,0.5)", marginLeft: 16, flexShrink: 0 }}>Free</span>
                </div>
                {engravingChoice === "add" && (
                  <div style={{ marginTop: 20, borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 20 }}>
                    <div style={{ position: "relative" }}>
                      <input
                        id="engraving-input"
                        maxLength={30}
                        value={engraving}
                        onChange={(e) => setEngraving(e.target.value.toUpperCase())}
                        placeholder="YOUR ENGRAVING"
                        style={{ width: "100%", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: "13px 56px 13px 14px", fontSize: 14, fontWeight: 500, letterSpacing: "0.1em", color: "#f5f5f7", outline: "none", boxSizing: "border-box", fontFamily: "inherit", transition: "border-color 0.15s" }}
                        onFocus={(e) => e.target.style.borderColor = "rgba(255,255,255,0.3)"}
                        onBlur={(e) => e.target.style.borderColor = "rgba(255,255,255,0.12)"}
                      />
                      <span style={{ position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)", fontSize: 12, color: "rgba(255,255,255,0.3)" }}>{engraving.length}/30</span>
                    </div>
                    <p style={{ fontSize: 12, color: "rgba(255,255,255,0.25)", marginTop: 8 }}>Up to 30 characters. Uppercase only.</p>
                  </div>
                )}
              </button>
              <button
                onClick={() => { setEngravingChoice("none"); setEngraving(""); }}
                style={{ width: "100%", background: engravingChoice === "none" ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.03)", border: engravingChoice === "none" ? "1.5px solid rgba(255,255,255,0.3)" : "1.5px solid rgba(255,255,255,0.1)", borderRadius: 16, padding: "20px", cursor: "pointer", textAlign: "left", transition: "all 0.2s" }}
              >
                <p style={{ fontSize: 16, fontWeight: 600, color: "#f5f5f7" }}>No Engraving</p>
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* CINEMATIC FEATURE SECTIONS */}
      <div id="features">
        {CINEMATIC.map((f, i) => (
          <section key={f.eyebrow} style={{ padding: "100px 24px", background: f.bg, borderTop: "1px solid rgba(255,255,255,0.04)" }}>
            <div style={{ maxWidth: 960, margin: "0 auto", display: "flex", flexDirection: "column", alignItems: "center", gap: 56 }}>
              <div style={{ textAlign: "center" }}>
                <p style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(255,255,255,0.3)", marginBottom: 16 }}>{f.eyebrow}</p>
                <h2 style={{ fontSize: "clamp(36px, 8vw, 68px)", fontWeight: 700, lineHeight: 1.04, letterSpacing: "-0.03em", color: "#f5f5f7", margin: "0 0 20px", whiteSpace: "pre-line" }}>{f.headline}</h2>
                <p style={{ fontSize: 17, color: "rgba(255,255,255,0.45)", lineHeight: 1.75, maxWidth: 500, margin: "0 auto" }}>{f.body}</p>
              </div>
              <FeatureVisual type={f.visual} />
            </div>
          </section>
        ))}
      </div>

      {/* STEVE JOBS "ONE MORE THING" */}
      <section style={{ position: "relative", minHeight: "100svh", display: "flex", alignItems: "center", overflow: "hidden" }}>
        <img src="/card-stage.jpg" alt="Founding Card reveal" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", objectPosition: "center", animation: "slowZoom 20s ease-out forwards" }} />
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to right, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.55) 55%, rgba(0,0,0,0.15) 100%)" }} />
        <div style={{ position: "relative", padding: "80px clamp(24px, 8vw, 80px)", maxWidth: 520 }}>
          <p style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", color: "rgba(255,255,255,0.4)", marginBottom: 24 }}>One more thing.</p>
          <h2 style={{ fontSize: "clamp(40px, 8vw, 72px)", fontWeight: 700, lineHeight: 1.04, letterSpacing: "-0.035em", color: "#f5f5f7", margin: "0 0 20px" }}>The rarest card<br />in the world.</h2>
          <p style={{ fontSize: "clamp(52px, 11vw, 88px)", fontWeight: 700, letterSpacing: "-0.04em", color: "#f5f5f7", margin: "0 0 32px", lineHeight: 1 }}>Only 5<br />exist. Ever.</p>
          <ul style={{ listStyle: "none", padding: 0, margin: "0 0 44px", display: "flex", flexDirection: "column", gap: 12 }}>
            {["Titanium Black — exclusive, never sold separately", "Guaranteed founding number #0001–#0005", "White-glove premium packaging + express delivery", "1-on-1 onboarding session with Vincent", "Lifetime Pro + priority support forever"].map((item, i) => (
              <li key={i} style={{ fontSize: 15, color: "rgba(255,255,255,0.6)", display: "flex", alignItems: "flex-start", gap: 10 }}>
                <span style={{ color: "rgba(255,255,255,0.25)", marginTop: 1, flexShrink: 0 }}>—</span>{item}
              </li>
            ))}
          </ul>
          <button onClick={() => { setFounder(true); applyRef.current?.scrollIntoView({ behavior: "smooth" }); }} style={{ background: "#fff", color: "#1d1d1f", border: "none", borderRadius: 980, padding: "14px 32px", fontSize: 15, fontWeight: 600, cursor: "pointer", letterSpacing: "-0.01em" }}>
            Apply for Founder Delivery
          </button>
        </div>
      </section>

      {/* APPLE BUY FLOW — light background */}
      <div ref={applyRef} id="apply" style={{ background: "#f5f5f7", color: "#1d1d1f" }}>

        {/* Product header */}
        <div style={{ maxWidth: 600, margin: "0 auto", padding: "64px 24px 0" }}>
          <p style={{ fontSize: 13, color: "#6e6e73", marginBottom: 4 }}>FschoolAI</p>
          <h2 style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em", color: "#1d1d1f", marginBottom: 4 }}>Founding Card</h2>
          <p style={{ fontSize: 15, color: "#6e6e73" }}>Founding Edition · Only 500</p>
        </div>

        {/* Card image */}
        <div style={{ maxWidth: 600, margin: "0 auto", padding: "32px 24px" }}>
          <div style={{ background: "#fff", borderRadius: 20, padding: "48px 24px", textAlign: "center" }}>
            <img
              src={isFounder ? "/card-titanium.jpg" : cw.img}
              alt={isFounder ? "Titanium Black" : cw.name}
              style={{ width: "100%", maxWidth: 240, height: 320, objectFit: "contain", transition: "opacity 0.3s ease" }}
            />
          </div>
        </div>

        {/* Colorway selector */}
        {!isFounder && (
          <div style={{ maxWidth: 600, margin: "0 auto", padding: "0 24px 24px" }}>
            <div style={{ background: "#fff", borderRadius: 18, padding: "24px" }}>
              <p style={{ fontSize: 12, color: "#6e6e73", marginBottom: 4 }}>Colorway</p>
              <p style={{ fontSize: 17, fontWeight: 600, color: "#1d1d1f", marginBottom: 20 }}>{cw.name} <span style={{ fontWeight: 400, color: "#6e6e73" }}>— {cw.tagline}</span></p>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                {COLORWAYS.map((c, i) => (
                  <button key={c.id} onClick={() => setSelected(i)} title={c.name} style={{ width: 32, height: 32, borderRadius: "50%", background: c.hex, border: selected === i ? "3px solid #0071e3" : "3px solid transparent", outline: selected === i ? "2px solid #0071e3" : "2px solid #d2d2d7", outlineOffset: 2, cursor: "pointer", transition: "all 0.15s" }} />
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Personalize */}
        <div style={{ maxWidth: 600, margin: "0 auto", padding: "0 24px 24px" }}>
          <div style={{ background: "#fff", borderRadius: 18, overflow: "hidden" }}>
            <div style={{ padding: "28px 24px 20px" }}>
              <h3 style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em", color: "#1d1d1f", marginBottom: 6 }}>Personalize for free</h3>
              <p style={{ fontSize: 15, color: "#6e6e73", lineHeight: 1.5 }}>Engrave your name, student ID, or a short message. Free. Delivers just as fast.</p>
            </div>
            <div style={{ padding: "0 24px 24px", display: "flex", flexDirection: "column", gap: 12 }}>
              <button
                onClick={() => setEngravingChoice(engravingChoice === "add" ? null : "add")}
                style={{ width: "100%", background: "#fff", border: engravingChoice === "add" ? "2px solid #0071e3" : "2px solid #d2d2d7", borderRadius: 14, padding: "18px 20px", cursor: "pointer", textAlign: "left", transition: "border-color 0.15s" }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <p style={{ fontSize: 17, fontWeight: 600, color: "#1d1d1f", marginBottom: 4 }}>Add Engraving</p>
                    <p style={{ fontSize: 13, color: "#6e6e73", lineHeight: 1.5, maxWidth: 260 }}>Engrave your name, initials, or student ID to make your card unmistakably yours.</p>
                  </div>
                  <span style={{ fontSize: 15, fontWeight: 500, color: "#1d1d1f", marginLeft: 16, flexShrink: 0 }}>Free</span>
                </div>
                {engravingChoice === "add" && (
                  <div style={{ marginTop: 20, borderTop: "1px solid #f0f0f0", paddingTop: 20 }}>
                    <div style={{ position: "relative" }}>
                      <input
                        id="engraving-input"
                        maxLength={30}
                        value={engraving}
                        onChange={(e) => setEngraving(e.target.value.toUpperCase())}
                        placeholder="YOUR ENGRAVING"
                        style={{ width: "100%", border: "1.5px solid #d2d2d7", borderRadius: 10, padding: "14px 60px 14px 16px", fontSize: 15, fontWeight: 500, letterSpacing: "0.06em", color: "#1d1d1f", background: "#fafafa", outline: "none", boxSizing: "border-box", fontFamily: "inherit" }}
                        onFocus={(e) => e.target.style.borderColor = "#0071e3"}
                        onBlur={(e) => e.target.style.borderColor = "#d2d2d7"}
                      />
                      <span style={{ position: "absolute", right: 16, top: "50%", transform: "translateY(-50%)", fontSize: 12, color: "#6e6e73" }}>{engraving.length}/30</span>
                    </div>
                    {engraving && (
                      <div style={{ marginTop: 14, padding: "12px 16px", background: "#f5f5f7", borderRadius: 10, textAlign: "center" }}>
                        <p style={{ fontSize: 11, color: "#6e6e73", marginBottom: 4, letterSpacing: "0.06em", textTransform: "uppercase" }}>Preview</p>
                        <p style={{ fontSize: 14, fontWeight: 500, color: "#1d1d1f", letterSpacing: "0.1em" }}>{engraving}</p>
                      </div>
                    )}
                  </div>
                )}
              </button>
              <button
                onClick={() => { setEngravingChoice("none"); setEngraving(""); }}
                style={{ width: "100%", background: "#fff", border: engravingChoice === "none" ? "2px solid #0071e3" : "2px solid #d2d2d7", borderRadius: 14, padding: "18px 20px", cursor: "pointer", textAlign: "left", transition: "border-color 0.15s" }}
              >
                <p style={{ fontSize: 17, fontWeight: 600, color: "#1d1d1f" }}>No Engraving</p>
              </button>
            </div>
          </div>
        </div>

        {/* Delivery */}
        <div style={{ maxWidth: 600, margin: "0 auto", padding: "0 24px 24px" }}>
          <div style={{ background: "#fff", borderRadius: 18, overflow: "hidden" }}>
            <div style={{ padding: "28px 24px 20px" }}>
              <h3 style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em", color: "#1d1d1f" }}>Delivery</h3>
            </div>
            <div style={{ padding: "0 24px 24px", display: "flex", flexDirection: "column", gap: 12 }}>
              <button
                onClick={() => setFounder(false)}
                style={{ width: "100%", background: "#fff", border: !isFounder ? "2px solid #0071e3" : "2px solid #d2d2d7", borderRadius: 14, padding: "18px 20px", cursor: "pointer", textAlign: "left", transition: "border-color 0.15s" }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <p style={{ fontSize: 17, fontWeight: 600, color: "#1d1d1f", marginBottom: 4 }}>Standard</p>
                    <p style={{ fontSize: 13, color: "#6e6e73" }}>Ships Q4 2026 · Your chosen colorway</p>
                  </div>
                  <span style={{ fontSize: 17, fontWeight: 600, color: "#1d1d1f", marginLeft: 16, flexShrink: 0 }}>Free</span>
                </div>
              </button>
              <button
                onClick={() => setFounder(true)}
                style={{ width: "100%", background: isFounder ? "#1d1d1f" : "#fff", border: isFounder ? "2px solid #1d1d1f" : "2px solid #d2d2d7", borderRadius: 14, padding: "18px 20px", cursor: "pointer", textAlign: "left", transition: "all 0.2s" }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <p style={{ fontSize: 17, fontWeight: 600, color: isFounder ? "#f5f5f7" : "#1d1d1f" }}>Founder Delivery</p>
                      <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", background: isFounder ? "rgba(255,255,255,0.12)" : "#f0f0f0", color: isFounder ? "#f5f5f7" : "#6e6e73", borderRadius: 6, padding: "2px 8px" }}>EXCLUSIVE</span>
                    </div>
                    <p style={{ fontSize: 13, color: isFounder ? "rgba(255,255,255,0.5)" : "#6e6e73", lineHeight: 1.5 }}>Titanium Black · #0001–#0005 · White-glove · 1-on-1 with Vincent · Lifetime Pro</p>
                  </div>
                  <span style={{ fontSize: 17, fontWeight: 600, color: isFounder ? "#f5f5f7" : "#1d1d1f", marginLeft: 16, flexShrink: 0 }}>$3,000</span>
                </div>
              </button>
            </div>
          </div>
        </div>

        {/* Price + form */}
        <div style={{ maxWidth: 600, margin: "0 auto", padding: "0 24px 32px" }}>
          <div style={{ background: "#fff", borderRadius: 18, padding: "28px 24px" }}>
            <p style={{ fontSize: 13, color: "#6e6e73", marginBottom: 4 }}>FschoolAI Founding Card</p>
            <p style={{ fontSize: 34, fontWeight: 700, letterSpacing: "-0.03em", color: "#1d1d1f", marginBottom: 4 }}>{isFounder ? "$3,000" : "Free"}</p>
            <p style={{ fontSize: 15, color: "#6e6e73", marginBottom: 28 }}>{isFounder ? "One-time · Founder Delivery · Titanium Black" : "No credit card required · Ships Q4 2026"}</p>
            {!submitted ? (
              <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <input type="text" placeholder="Full name" required value={formData.name} onChange={(e) => setFormData(p => ({ ...p, name: e.target.value }))} style={{ width: "100%", border: "1.5px solid #d2d2d7", borderRadius: 10, padding: "14px 16px", fontSize: 15, color: "#1d1d1f", background: "#fafafa", outline: "none", boxSizing: "border-box", fontFamily: "inherit" }} onFocus={(e) => e.target.style.borderColor = "#0071e3"} onBlur={(e) => e.target.style.borderColor = "#d2d2d7"} />
                <input type="text" placeholder="University or school" value={formData.university} onChange={(e) => setFormData(p => ({ ...p, university: e.target.value }))} style={{ width: "100%", border: "1.5px solid #d2d2d7", borderRadius: 10, padding: "14px 16px", fontSize: 15, color: "#1d1d1f", background: "#fafafa", outline: "none", boxSizing: "border-box", fontFamily: "inherit" }} onFocus={(e) => e.target.style.borderColor = "#0071e3"} onBlur={(e) => e.target.style.borderColor = "#d2d2d7"} />
                <input type="email" placeholder="Email address" required value={formData.email} onChange={(e) => setFormData(p => ({ ...p, email: e.target.value }))} style={{ width: "100%", border: "1.5px solid #d2d2d7", borderRadius: 10, padding: "14px 16px", fontSize: 15, color: "#1d1d1f", background: "#fafafa", outline: "none", boxSizing: "border-box", fontFamily: "inherit" }} onFocus={(e) => e.target.style.borderColor = "#0071e3"} onBlur={(e) => e.target.style.borderColor = "#d2d2d7"} />
                <button type="submit" disabled={submitting || !formData.name || !formData.email} style={{ width: "100%", background: (!formData.name || !formData.email) ? "#b0c8e8" : "#0071e3", color: "#fff", border: "none", borderRadius: 12, padding: "16px", fontSize: 17, fontWeight: 600, cursor: (!formData.name || !formData.email) ? "not-allowed" : "pointer", letterSpacing: "-0.01em", marginTop: 4, transition: "background 0.2s", fontFamily: "inherit" }}>
                  {submitting ? "Submitting…" : isFounder ? "Apply for Founder Delivery →" : "Apply for my card →"}
                </button>
                <p style={{ fontSize: 12, color: "#6e6e73", textAlign: "center", marginTop: 4 }}>{isFounder ? "$3,000 · Titanium Black · Only 5 exist." : "Free. No credit card required. Ships Q4 2026."}</p>
              </form>
            ) : (
              <div style={{ textAlign: "center", padding: "32px 0" }}>
                <div style={{ marginBottom: 16, display: "flex", justifyContent: "center" }}><PartyPopper size={48} color="#C49A3C" /></div>
                <h3 style={{ fontSize: 22, fontWeight: 700, color: "#1d1d1f", marginBottom: 8 }}>You're on the list.</h3>
                <p style={{ fontSize: 15, color: "#6e6e73", lineHeight: 1.6 }}>We'll email you when your founding card is ready to ship. Welcome to the founding {isFounder ? "5" : "500"}.</p>
              </div>
            )}
          </div>
        </div>

        {/* Trust icons */}
        <div style={{ maxWidth: 600, margin: "0 auto", padding: "0 24px 40px" }}>
          {[
            { icon: Truck,        title: "Free delivery", desc: "Ships Q4 2026 to your door" },
            { icon: InfinityIcon, title: "Lifetime Pro included", desc: "Every feature, every update — no subscription ever" },
            { icon: RotateCcw,    title: "Cancel anytime", desc: "Before your card ships, no questions asked" },
          ].map((item, i, arr) => (
            <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", padding: "28px 24px", borderBottom: i < arr.length - 1 ? "1px solid #e5e5ea" : "none" }}>
              <item.icon size={28} color="#1d1d1f" style={{ marginBottom: 10 }} />
              <p style={{ fontSize: 15, fontWeight: 600, color: "#1d1d1f", marginBottom: 4 }}>{item.title}</p>
              <p style={{ fontSize: 13, color: "#6e6e73", lineHeight: 1.5 }}>{item.desc}</p>
            </div>
          ))}
        </div>

        {/* What's inside */}
        <div style={{ maxWidth: 600, margin: "0 auto", padding: "0 24px 40px" }}>
          <div style={{ background: "#fff", borderRadius: 18, padding: "28px 24px" }}>
            <h3 style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em", color: "#1d1d1f", marginBottom: 28 }}>What's inside</h3>
            <div style={{ display: "flex", flexDirection: "column" }}>
              {FEATURES.map((f, i) => (
                <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", padding: "24px 16px", borderBottom: i < FEATURES.length - 1 ? "1px solid #f0f0f0" : "none" }}>
                  <f.icon size={32} color="#1d1d1f" style={{ marginBottom: 10 }} />
                  <p style={{ fontSize: 15, fontWeight: 600, color: "#1d1d1f", marginBottom: 4 }}>{f.title}</p>
                  <p style={{ fontSize: 13, color: "#6e6e73", lineHeight: 1.5 }}>{f.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Specialist Setup */}
        <div style={{ maxWidth: 600, margin: "0 auto", padding: "0 24px 40px" }}>
          <div style={{ background: "#fff", borderRadius: 18, padding: "28px 24px", display: "flex", gap: 20, alignItems: "flex-start" }}>
            <div style={{ width: 48, height: 48, borderRadius: "50%", background: "#f0f0f0", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><GraduationCap size={24} color="#1d1d1f" /></div>
            <p style={{ fontSize: 15, color: "#1d1d1f", lineHeight: 1.65 }}>
              Set up your identity card with a one-on-one session with a Specialist.{" "}
              <a href="mailto:hello@fschoolai.com" style={{ color: "#0071e3", textDecoration: "none" }}>Book a free Personal Setup session.</a>
            </p>
          </div>
        </div>

        {/* Product Information */}
        <div style={{ maxWidth: 600, margin: "0 auto", padding: "0 24px 80px" }}>
          <h3 style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em", color: "#1d1d1f", marginBottom: 20 }}>Product Information</h3>
          <div style={{ background: "#fff", borderRadius: 18, overflow: "hidden" }}>
            {[
              { label: "Overview", text: "The FschoolAI Founding Card is a physical NFC card that serves as your identity in the FschoolAI ecosystem. It unlocks Lifetime Pro access, your NeuroAGI Brain ID, and the ability to share your academic profile with a single tap." },
              { label: "Availability", text: "500 cards total. Applications close June 30, 2026. Ships Q4 2026." },
              { label: "Note", text: "The FschoolAI Founding Card is a physical NFC card. Not a financial product." },
            ].map((item, i, arr) => (
              <div key={i} style={{ padding: "20px 24px", borderBottom: i < arr.length - 1 ? "1px solid #f0f0f0" : "none" }}>
                <p style={{ fontSize: 13, fontWeight: 600, color: "#6e6e73", marginBottom: 4 }}>{item.label}</p>
                <p style={{ fontSize: 15, color: "#1d1d1f", lineHeight: 1.6 }}>{item.text}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div style={{ borderTop: "1px solid #d2d2d7", padding: "24px", textAlign: "center" }}>
          <p style={{ fontSize: 12, color: "#6e6e73" }}>© 2026 FschoolAI. All rights reserved.</p>
        </div>

      </div>
    </div>
  );
}

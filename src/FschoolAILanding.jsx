import { useState, useEffect, useRef } from "react";

// ── Card image maps ───────────────────────────────────────────────────────────
const CARD_IMAGES_LIGHT = {
  white:  "/cards/card-mockups/white.png",
  violet: "/cards/card-mockups/violet.png",
  pink:   "/cards/card-mockups/pink.png",
  blue:   "/cards/card-mockups/blue.png",
  green:  "/cards/card-mockups/green.png",
  black:  "/cards/black.png",
};

const CARD_IMAGES_DARK = {
  white:  "/cards/white_mockup_dark.png",
  violet: "/cards/violet_mockup_dark.png",
  pink:   "/cards/pink_mockup_dark.png",
  blue:   "/cards/blue_mockup_dark.png",
  green:  "/cards/green_mockup_dark.png",
  black:  "/cards/black.png",
};

const COLORWAYS = [
  { id: "white",  name: "Base White",   tag: "Clean. Timeless. Iconic.",          dot: "#e8e4dc", accentDot: "#bbb" },
  { id: "violet", name: "Aura Purple",  tag: "Vivid. Confident. Distinct.",       dot: "#C8B8E8", accentDot: "#9b7ec8" },
  { id: "pink",   name: "Royal Pink",   tag: "Bold. Expressive. Unforgettable.",  dot: "#EFA9B5", accentDot: "#d06080" },
  { id: "blue",   name: "Sky Blue",     tag: "Clear. Focused. Elevated.",         dot: "#B8D4F0", accentDot: "#4a90d9" },
  { id: "green",  name: "Sage Green",   tag: "Fresh. Grounded. Original.",        dot: "#b8e8b0", accentDot: "#3a9a50" },
];

// ── Theme tokens ──────────────────────────────────────────────────────────────
const DARK = {
  bg: "#000",
  bg2: "#080808",
  bgForm: "#f5f5f7",
  text: "#fff",
  textMuted: "rgba(255,255,255,0.45)",
  textFaint: "rgba(255,255,255,0.3)",
  border: "rgba(255,255,255,0.06)",
  navBg: "rgba(0,0,0,0.72)",
  label: "#666",
  cardBg: "#1a1a1a",
  cardBorder: "#2a2a2a",
  cardInner: "#1e1e1e",
  cardInnerBorder: "#2e2e2e",
  formBg: "#f5f5f7",
  formText: "#000",
  formTextMuted: "#888",
  formBorder: "#e0e0e0",
  formSection: "#fff",
  trustBg: "#f5f5f7",
  trustBorder: "#e0e0e0",
  reflectionBg: "#000",
};

const LIGHT = {
  bg: "#fefefe",
  bg2: "#f9f9f7",
  bgForm: "#f5f5f2",
  text: "#000",
  textMuted: "rgba(0,0,0,0.55)",
  textFaint: "rgba(0,0,0,0.35)",
  border: "rgba(0,0,0,0.08)",
  navBg: "rgba(254,254,254,0.88)",
  label: "#888",
  cardBg: "#fff",
  cardBorder: "#e0e0e0",
  cardInner: "#f7f7f5",
  cardInnerBorder: "#ebebeb",
  formBg: "#f5f5f2",
  formText: "#000",
  formTextMuted: "#666",
  formBorder: "#d8d8d5",
  formSection: "#fff",
  trustBg: "#f5f5f2",
  trustBorder: "#e0e0dc",
  reflectionBg: "#fefefe",
};

// ── Card Image Component ──────────────────────────────────────────────────────
const CardImg = ({ id, width = 160, style = {}, images = CARD_IMAGES_LIGHT }) => (
  <img
    src={images[id]}
    alt={id + " card"}
    style={{
      width,
      height: "auto",
      display: "block",
      flexShrink: 0,
      transition: "transform 0.4s ease",
      ...style
    }}
  />
);

// ── Countdown ─────────────────────────────────────────────────────────────────
const useCountdown = (target) => {
  const [time, setTime] = useState({ d: 0, h: 0, m: 0, s: 0 });
  useEffect(() => {
    const tick = () => {
      const diff = new Date(target) - Date.now();
      if (diff <= 0) return;
      setTime({ d: Math.floor(diff/86400000), h: Math.floor((diff%86400000)/3600000), m: Math.floor((diff%3600000)/60000), s: Math.floor((diff%60000)/1000) });
    };
    tick(); const id = setInterval(tick, 1000); return () => clearInterval(id);
  }, [target]);
  return time;
};

// ── Scroll reveal ─────────────────────────────────────────────────────────────
const useInView = (threshold = 0.15) => {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) setVisible(true); }, { threshold });
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, [threshold]);
  return [ref, visible];
};

const Reveal = ({ children, delay = 0, style = {} }) => {
  const [ref, visible] = useInView();
  return (
    <div ref={ref} style={{ opacity: visible?1:0, transform: visible?"translateY(0)":"translateY(28px)", transition: `opacity 0.7s ease ${delay}s, transform 0.7s ease ${delay}s`, ...style }}>
      {children}
    </div>
  );
};

// ── Dark/Light mode toggle button ─────────────────────────────────────────────
const ThemeToggle = ({ dark, onToggle, t }) => (
  <button
    onClick={onToggle}
    aria-label="Toggle theme"
    style={{
      background: dark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.08)",
      border: `1px solid ${dark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.12)"}`,
      borderRadius: 20,
      padding: "5px 13px",
      cursor: "pointer",
      display: "flex",
      alignItems: "center",
      gap: 6,
      fontSize: 13,
      color: t.text,
      fontFamily: "'SF Pro Text','Inter',sans-serif",
      fontWeight: 500,
      transition: "all 0.2s ease",
      backdropFilter: "blur(8px)",
    }}
  >
    <span style={{ fontSize: 14 }}>{dark ? "☀️" : "🌙"}</span>
    <span>{dark ? "Light" : "Dark"}</span>
  </button>
);

// ── Card with reflection (fixed: reflection clipped, no overflow) ─────────────
// Reflection is baked into the image — render directly, blend mode removes bg box
const CardWithReflection = ({ id, width = 200, t, images = CARD_IMAGES_LIGHT, dark = true }) => (
  <div style={{ mixBlendMode: dark ? "lighten" : "normal" }}>
    <CardImg id={id} width={width} images={images} />
  </div>
);

export default function FschoolAILanding() {
  const [dark, setDark] = useState(true);
  const t = dark ? DARK : LIGHT;
  const images = dark ? CARD_IMAGES_DARK : CARD_IMAGES_LIGHT;

  const [activeColor, setActiveColor] = useState(0);
  const [engrave, setEngrave] = useState(null);
  const [delivery, setDelivery] = useState("standard");
  const [form, setForm] = useState({ name:"", school:"", email:"" });
  const [submitted, setSubmitted] = useState(false);
  const countdown = useCountdown("2026-06-30T23:59:59");
  const cw = COLORWAYS[activeColor];
  const pad = n => String(n).padStart(2,"0");

  const Label = ({ children }) => (
    <p style={{ fontFamily:"'SF Pro Text','Inter',sans-serif", fontSize:11, fontWeight:600, letterSpacing:"0.16em", color:t.label, textTransform:"uppercase", marginBottom:16 }}>{children}</p>
  );

  const MockCard = ({ children }) => (
    <div style={{ background:t.cardBg, border:`1px solid ${t.cardBorder}`, borderRadius:16, padding:"24px 28px", maxWidth:380, margin:"0 auto", fontFamily:"'SF Pro Text','Inter',sans-serif" }}>
      {children}
    </div>
  );

  const whatsInside = [
    { emoji:"🧠", title:"NeuroAGI Brain ID", desc:"Your unique neural identity across the entire NeuroAGI ecosystem" },
    { emoji:"🤖", title:"AI Tutor — Priority", desc:"24/7 personal AI tutor grounded in your actual lecture notes" },
    { emoji:"🎙️", title:"In-Class Recording", desc:"Real-time transcription, searchable, always in your notes" },
    { emoji:"📚", title:"Canvas Sync", desc:"Every course, assignment, and deadline — automatically synced" },
    { emoji:"📡", title:"NFC Tap", desc:"One tap shares your full profile and Brain Card instantly" },
    { emoji:"🏅", title:"Founding Number #0001–#0500", desc:"Permanently engraved — only 500 exist, ever" },
    { emoji:"💎", title:"FST Token Wallet", desc:"Built-in wallet — earn, hold, and spend FST tokens" },
    { emoji:"🏆", title:"Leaderboard Badge", desc:"Verified rank badge on the FschoolAI global leaderboard" },
    { emoji:"∞", title:"Lifetime FschoolAI Pro", desc:"Every Pro feature, every future update — forever, no subscription" },
  ];

  return (
    <div style={{ background:t.bg, color:t.text, fontFamily:"'SF Pro Display','Inter',-apple-system,sans-serif", minHeight:"100vh", overflowX:"hidden", transition:"background 0.3s ease, color 0.3s ease" }}>

      {/* NAV */}
      <nav style={{ position:"fixed", top:0, left:0, right:0, zIndex:100, display:"flex", alignItems:"center", justifyContent:"space-between", padding:"0 20px", height:52, background:t.navBg, backdropFilter:"blur(20px)", borderBottom:`1px solid ${t.border}`, transition:"background 0.3s ease" }}>
        <button style={{ background:"none", border:"none", color:t.textMuted, fontSize:14, cursor:"pointer" }}>‹ FschoolAI</button>
        <span style={{ fontSize:14, fontWeight:500, color:t.text }}>Founding Card</span>
        <div style={{ display:"flex", gap:10, alignItems:"center" }}>
          <ThemeToggle dark={dark} onToggle={() => setDark(d => !d)} t={t} />
          <button onClick={() => document.getElementById("order").scrollIntoView({ behavior:"smooth" })} style={{ background:dark?"#fff":"#000", color:dark?"#000":"#fff", border:"none", borderRadius:20, padding:"6px 16px", fontSize:13, fontWeight:600, cursor:"pointer" }}>Apply</button>
        </div>
      </nav>

      {/* HERO */}
      <section style={{ minHeight:"100vh", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", position:"relative", paddingTop:52, overflow:"hidden" }}>
        <div style={{ position:"absolute", bottom:0, left:"50%", transform:"translateX(-50%)", width:"100%", maxWidth:1200, pointerEvents:"none", zIndex:1 }}>
          <div style={{ position:"absolute", top:0, left:0, right:0, height:"45%", background:`linear-gradient(to bottom, ${t.bg} 0%, transparent 100%)`, zIndex:2, pointerEvents:"none" }} />
          <div style={{ position:"absolute", bottom:0, left:0, right:0, height:"15%", background:`linear-gradient(to top, ${t.bg} 0%, transparent 100%)`, zIndex:2, pointerEvents:"none" }} />
          <img src={dark ? "/cards/herodesktop.png" : "/cards/herodesktop_light.png"} alt="FschoolAI cards" style={{ width:"100%", display:"block", objectFit:"contain", opacity: dark ? 0.93 : 1 }} />
        </div>
        <div style={{ position:"relative", zIndex:3, textAlign:"center", padding:"0 20px", marginBottom:"30vh" }}>
          <p style={{ fontSize:12, fontWeight:600, letterSpacing:"0.2em", color:t.textFaint, marginBottom:20, textTransform:"uppercase" }}>Founding Edition · Only 500</p>
          <h1 style={{ fontSize:"clamp(42px,7vw,84px)", fontWeight:700, lineHeight:1.05, margin:"0 0 20px", letterSpacing:"-0.02em" }}>FschoolAI<br />Founding Card</h1>
          <p style={{ fontSize:17, color:t.textMuted, marginBottom:40 }}>Free for founding members. Ships Q4 2026.</p>
          <button onClick={() => document.getElementById("order").scrollIntoView({ behavior:"smooth" })} style={{ background:dark?"#fff":"#000", color:dark?"#000":"#fff", border:"none", borderRadius:50, padding:"16px 40px", fontSize:16, fontWeight:600, cursor:"pointer" }}>Apply for your card</button>
        </div>
        <div style={{ position:"absolute", bottom:32, left:"50%", transform:"translateX(-50%)", zIndex:3, textAlign:"center" }}>
          <div style={{ width:1, height:28, background:`linear-gradient(to bottom,transparent,${dark?"rgba(255,255,255,0.4)":"rgba(0,0,0,0.3)"})`, margin:"0 auto 6px" }} />
          <span style={{ fontSize:18, opacity:0.4 }}>↓</span>
        </div>
      </section>

      {/* COUNTDOWN */}
      <section style={{ padding:"80px 20px", textAlign:"center" }}>
        <Reveal>
          <Label>Applications Close</Label>
          <div style={{ display:"flex", justifyContent:"center", gap:"clamp(24px,5vw,64px)", marginBottom:16 }}>
            {[["d","Days"],["h","Hours"],["m","Min"],["s","Sec"]].map(([k,label]) => (
              <div key={k}>
                <div style={{ fontSize:"clamp(52px,10vw,96px)", fontWeight:700, lineHeight:1, letterSpacing:"-0.03em" }}>{pad(countdown[k])}</div>
                <div style={{ fontSize:12, fontWeight:500, letterSpacing:"0.14em", color:t.textFaint, textTransform:"uppercase", marginTop:8 }}>{label}</div>
              </div>
            ))}
          </div>
          <p style={{ color:t.textFaint, fontSize:14, letterSpacing:"0.04em" }}>June 30, 2026 · Midnight</p>
        </Reveal>
      </section>

      {/* WHAT IS */}
      <section style={{ padding:"100px 20px", textAlign:"center", maxWidth:680, margin:"0 auto" }}>
        <Reveal>
          <Label>What is FschoolAI</Label>
          <h2 style={{ fontSize:"clamp(38px,6vw,64px)", fontWeight:700, lineHeight:1.1, letterSpacing:"-0.02em", marginBottom:24 }}>The AI that actually<br /><span style={{ color:"#f0c040" }}>knows your courses.</span></h2>
          <p style={{ fontSize:18, color:t.textMuted, lineHeight:1.6 }}>Canvas sync. In-class recording. AI tutor grounded in your actual lecture notes. The Founding Card is your key to all of it — forever.</p>
        </Reveal>
      </section>

      {/* COLORWAY SELECTOR */}
      <section style={{ padding:"100px 20px", textAlign:"center" }}>
        <Reveal>
          <Label>Colorway</Label>
          <h2 style={{ fontSize:"clamp(32px,5vw,52px)", fontWeight:700, letterSpacing:"-0.02em", marginBottom:8, transition:"all 0.3s ease", color:t.text }}>{cw.name}</h2>
          <p style={{ color:t.textMuted, fontSize:16, marginBottom:52 }}>{cw.tag}</p>
        </Reveal>

        {/* Card fan selector */}
        <div style={{ position:"relative", height:380, display:"flex", alignItems:"center", justifyContent:"center", marginBottom:48, overflow:"hidden" }}>
          {COLORWAYS.map((c, i) => {
            const dist = i - activeColor;
            const isActive = dist === 0;
            const translateX = dist * 150;
            const scale = isActive ? 1 : 0.72;
            return (
              <div key={c.id} onClick={() => setActiveColor(i)} style={{
                position:"absolute",
                transform:`translateX(${translateX}px) scale(${scale})`,
                opacity: Math.abs(dist) > 2 ? 0 : isActive ? 1 : 0.32,
                cursor:"pointer",
                transition:"all 0.45s cubic-bezier(0.4,0,0.2,1)",
                zIndex: isActive ? 5 : 3 - Math.abs(dist),
              }}>
                <CardImg id={c.id} width={160} images={images} style={{ display:"block" }} />
              </div>
            );
          })}
        </div>

        {/* Color dots */}
        <div style={{ display:"flex", justifyContent:"center", gap:12 }}>
          {COLORWAYS.map((c, i) => (
            <button key={c.id} onClick={() => setActiveColor(i)} style={{
              width:28, height:28, borderRadius:"50%", background:c.dot,
              border: i===activeColor
                ? `2.5px solid ${dark?"#fff":"#000"}`
                : `1.5px solid ${c.id==="white" ? "rgba(0,0,0,0.2)" : "transparent"}`,
              cursor:"pointer", padding:0,
              boxShadow: i===activeColor ? `0 0 0 1px rgba(${dark?"255,255,255":"0,0,0"},0.25)` : "none",
              transition:"all 0.2s ease", outline:"none"
            }} />
          ))}
        </div>
      </section>

      {/* PERSONALIZE */}
      <section style={{ padding:"100px 20px", textAlign:"center" }}>
        <Reveal>
          <Label>Personalize</Label>
          <h2 style={{ fontSize:"clamp(38px,6vw,64px)", fontWeight:700, letterSpacing:"-0.02em", marginBottom:12 }}>Make it yours.</h2>
          <p style={{ color:t.textMuted, fontSize:17, marginBottom:60 }}>Laser-engraved on the back. Free. Delivers just as fast.</p>
        </Reveal>
        <div style={{ display:"flex", gap:48, justifyContent:"center", alignItems:"center", flexWrap:"wrap" }}>
          <Reveal delay={0.1} style={{ textAlign:"center" }}>
            <CardWithReflection id={cw.id} width={200} t={t} images={images} dark={dark} />
            <p style={{ color:t.textFaint, fontSize:13, marginTop:4 }}>{cw.name}</p>
          </Reveal>
          <Reveal delay={0.2} style={{ display:"flex", flexDirection:"column", gap:12, minWidth:300, maxWidth:360 }}>
            {[{ v:"engrave", label:"Add Engraving", sub:"Your name, initials, or student ID — laser-engraved on the back.", badge:"Free" }, { v:"none", label:"No Engraving", sub:null }].map(opt => (
              <button key={opt.v} onClick={() => setEngrave(opt.v)} style={{ background: engrave===opt.v ? (dark?"rgba(255,255,255,0.08)":"rgba(0,0,0,0.06)") : (dark?"rgba(255,255,255,0.03)":"rgba(0,0,0,0.02)"), border: engrave===opt.v ? `1px solid ${dark?"rgba(255,255,255,0.3)":"rgba(0,0,0,0.3)"}` : `1px solid ${dark?"rgba(255,255,255,0.1)":"rgba(0,0,0,0.12)"}`, borderRadius:14, padding:"18px 20px", cursor:"pointer", textAlign:"left", color:t.text, transition:"all 0.2s" }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                  <span style={{ fontSize:16, fontWeight:600 }}>{opt.label}</span>
                  {opt.badge && <span style={{ fontSize:13, color:t.textMuted }}>{opt.badge}</span>}
                </div>
                {opt.sub && <p style={{ fontSize:13, color:t.textMuted, marginTop:6, lineHeight:1.5 }}>{opt.sub}</p>}
              </button>
            ))}
          </Reveal>
        </div>
      </section>

      {/* AI TUTOR */}
      <section style={{ padding:"100px 20px", textAlign:"center" }}>
        <Reveal>
          <Label>AI Tutor</Label>
          <h2 style={{ fontSize:"clamp(38px,6vw,64px)", fontWeight:700, letterSpacing:"-0.02em", marginBottom:20 }}>Your tutor.<br />Always on.</h2>
          <p style={{ color:t.textMuted, fontSize:17, maxWidth:540, margin:"0 auto 48px", lineHeight:1.6 }}>Priority access to your personal FschoolAI AI tutor — 24/7, for every subject, forever. Answers grounded in your actual lecture notes, not just the internet.</p>
        </Reveal>
        <Reveal delay={0.15}>
          <MockCard>
            <p style={{ fontSize:11, fontWeight:600, letterSpacing:"0.14em", color:t.label, marginBottom:16 }}>AI TUTOR · BIOL 201</p>
            <div style={{ display:"flex", justifyContent:"flex-end", marginBottom:12 }}>
              <div style={{ background:dark?"#2a2a2a":"#e8e8e8", borderRadius:18, padding:"10px 16px", fontSize:14, color:t.text }}>What's homeostasis?</div>
            </div>
            <div style={{ background:t.cardInner, border:`1px solid ${t.cardInnerBorder}`, borderRadius:14, padding:"14px 16px", fontSize:14, color:t.textMuted, lineHeight:1.6, textAlign:"left" }}>
              Based on your Lecture 4 notes, homeostasis is the body's mechanism for maintaining stable internal conditions — your professor used temperature regulation as the key example.
            </div>
          </MockCard>
        </Reveal>
      </section>

      {/* IN-CLASS RECORDING */}
      <section style={{ padding:"100px 20px", textAlign:"center" }}>
        <Reveal>
          <Label>In-Class Recording</Label>
          <h2 style={{ fontSize:"clamp(38px,6vw,64px)", fontWeight:700, letterSpacing:"-0.02em", marginBottom:20 }}>Never miss<br />what's said.</h2>
          <p style={{ color:t.textMuted, fontSize:17, maxWidth:520, margin:"0 auto 48px", lineHeight:1.6 }}>FschoolAI captures and transcribes your lectures in real time. Searchable, always there, in your own notes.</p>
        </Reveal>
        <Reveal delay={0.15}>
          <MockCard>
            <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:12 }}>
              <span style={{ width:8, height:8, borderRadius:"50%", background:"#ff3b30", display:"inline-block" }} />
              <span style={{ fontSize:12, fontWeight:600, letterSpacing:"0.1em", color:t.label }}>REC 00:04 · COMP 101</span>
            </div>
            <p style={{ fontSize:11, fontWeight:600, letterSpacing:"0.14em", color:dark?"#444":"#bbb", marginBottom:12 }}>LIVE TRANSCRIPT</p>
            <p style={{ color:t.textMuted, fontSize:14, lineHeight:1.7, textAlign:"left" }}>…cognitive load theory suggests working memory has limited capacity…</p>
            <p style={{ color:t.textFaint, fontSize:14, lineHeight:1.7, textAlign:"left" }}>…four components: phonological loop, visuospatial sketchpad…</p>
          </MockCard>
        </Reveal>
      </section>

      {/* CANVAS SYNC */}
      <section style={{ padding:"100px 20px", textAlign:"center" }}>
        <Reveal>
          <Label>Canvas Sync</Label>
          <h2 style={{ fontSize:"clamp(38px,6vw,64px)", fontWeight:700, letterSpacing:"-0.02em", marginBottom:20 }}>Every course.<br />Every deadline.</h2>
          <p style={{ color:t.textMuted, fontSize:17, maxWidth:540, margin:"0 auto 48px", lineHeight:1.6 }}>Connect your Canvas account and FschoolAI pulls every course, assignment, and deadline automatically. Your card is linked to your verified academic identity.</p>
        </Reveal>
        <Reveal delay={0.15}>
          <MockCard>
            <p style={{ fontSize:11, fontWeight:600, letterSpacing:"0.14em", color:t.label, marginBottom:16 }}>CANVAS · 3 COURSES</p>
            {[{ name:"Problem Set 4", course:"COMP 101", due:"Tomorrow", color:"#ff9500" }, { name:"Lab Report", course:"BIOL 201", due:"May 28", color:"#ff9500" }, { name:"Midterm Review", course:"MATH 150", due:"Jun 2", color:"#34c759" }].map((a, i) => (
              <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"12px 0", borderBottom: i<2 ? `1px solid ${dark?"#222":"#eee"}` : "none" }}>
                <div style={{ display:"flex", gap:10, alignItems:"center" }}>
                  <span style={{ width:7, height:7, borderRadius:"50%", background:a.color, display:"inline-block", flexShrink:0 }} />
                  <div style={{ textAlign:"left" }}>
                    <div style={{ fontSize:14, color:t.text }}>{a.name}</div>
                    <div style={{ fontSize:12, color:t.label }}>{a.course}</div>
                  </div>
                </div>
                <span style={{ fontSize:13, color:a.color, fontWeight:500 }}>{a.due}</span>
              </div>
            ))}
          </MockCard>
        </Reveal>
      </section>

      {/* LEADERBOARD */}
      <section style={{ padding:"100px 20px", textAlign:"center" }}>
        <Reveal>
          <Label>Leaderboard</Label>
          <h2 style={{ fontSize:"clamp(38px,6vw,64px)", fontWeight:700, letterSpacing:"-0.02em", marginBottom:20 }}>Your rank.<br />Your legacy.</h2>
          <p style={{ color:t.textMuted, fontSize:17, maxWidth:520, margin:"0 auto 48px", lineHeight:1.6 }}>Founding members get a permanent verified badge on the FschoolAI global leaderboard. Your founding number is your identity — forever.</p>
        </Reveal>
        <Reveal delay={0.15}>
          <MockCard>
            <p style={{ fontSize:11, fontWeight:600, letterSpacing:"0.14em", color:t.label, marginBottom:16 }}>GLOBAL LEADERBOARD</p>
            {[{ rank:1, name:"You", num:"#0042", hours:"847h", accent:true }, { rank:2, name:"Pratik S.", num:"#0089", hours:"812h", accent:false }, { rank:3, name:"Shreya M.", num:"#0156", hours:"798h", accent:false }].map(r => (
              <div key={r.rank} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"12px 0", borderBottom: r.rank<3 ? `1px solid ${dark?"#222":"#eee"}` : "none" }}>
                <div style={{ display:"flex", gap:12, alignItems:"center" }}>
                  <span style={{ fontSize:13, color:t.label, width:20, textAlign:"right" }}>#{r.rank}</span>
                  <div>
                    <div style={{ fontSize:14, color: r.accent ? t.text : t.textMuted, fontWeight: r.accent ? 600 : 400 }}>{r.name}</div>
                    <div style={{ fontSize:12, color:t.label }}>Founding {r.num}</div>
                  </div>
                </div>
                <span style={{ fontSize:14, color: r.accent ? "#6e8efb" : t.label, fontWeight: r.accent ? 600 : 400 }}>{r.hours}</span>
              </div>
            ))}
          </MockCard>
        </Reveal>
      </section>

      {/* TITANIUM BLACK */}
      <section style={{ padding:"120px 40px", background:dark?"#080808":"#e8e8e8", position:"relative", overflow:"hidden", transition:"background 0.3s ease" }}>
        <div style={{ position:"absolute", inset:0, background:"radial-gradient(ellipse at 65% 50%, rgba(80,80,80,0.3) 0%, transparent 65%)", pointerEvents:"none" }} />
        <div style={{ maxWidth:1100, margin:"0 auto", display:"grid", gridTemplateColumns:"1fr 1fr", gap:60, alignItems:"center" }}>
          <Reveal>
            <p style={{ fontSize:12, fontWeight:600, letterSpacing:"0.16em", color:t.label, marginBottom:24, textTransform:"uppercase" }}>One More Thing.</p>
            <h2 style={{ fontSize:"clamp(48px,7vw,80px)", fontWeight:700, lineHeight:1.05, letterSpacing:"-0.02em", marginBottom:40 }}>
              The rarest card<br />in the world.<br />Only 5 exist.<br /><span style={{ color:t.textFaint }}>Ever.</span>
            </h2>
            <div style={{ display:"flex", flexDirection:"column", gap:14, marginBottom:40 }}>
              {["Titanium Black — exclusive, never sold separately","Guaranteed founding number #0001–#0005","White-glove premium packaging + express delivery","1-on-1 onboarding session with Vincent","Lifetime Pro + priority support forever"].map((item,i) => (
                <div key={i} style={{ display:"flex", gap:12, alignItems:"flex-start" }}>
                  <span style={{ color:t.label, fontSize:18, lineHeight:"22px" }}>—</span>
                  <span style={{ color:t.textMuted, fontSize:15, lineHeight:1.5 }}>{item}</span>
                </div>
              ))}
            </div>
            <button onClick={() => document.getElementById("order").scrollIntoView({ behavior:"smooth" })} style={{ background:dark?"#fff":"#000", color:dark?"#000":"#fff", border:"none", borderRadius:50, padding:"16px 36px", fontSize:15, fontWeight:600, cursor:"pointer" }}>Apply for Founder Delivery</button>
          </Reveal>
          <Reveal delay={0.2} style={{ display:"flex", justifyContent:"center" }}>
            <CardImg id="black" width={260} images={images} />
          </Reveal>
        </div>
      </section>

      {/* ORDER FORM */}
      <section id="order" style={{ background:t.formBg, color:t.formText, padding:"80px 20px", transition:"background 0.3s ease" }}>
        <div style={{ maxWidth:680, margin:"0 auto" }}>
          <p style={{ fontSize:13, color:t.formTextMuted, marginBottom:4 }}>FschoolAI</p>
          <h2 style={{ fontSize:36, fontWeight:700, letterSpacing:"-0.02em", marginBottom:4, color:t.formText }}>Founding Card</h2>
          <p style={{ fontSize:14, color:t.formTextMuted, marginBottom:32 }}>Founding Edition · Only 500</p>

          {/* Card preview */}
          <div style={{ background:t.formSection, borderRadius:20, padding:"40px 20px", marginBottom:20, display:"flex", justifyContent:"center", boxShadow:"0 2px 20px rgba(0,0,0,0.08)" }}>
            <CardImg id={cw.id} width={200} style={{ transition:"all 0.4s ease" }} images={images} />
          </div>

          {/* Colorway picker */}
          <div style={{ background:t.formSection, borderRadius:20, padding:"24px", marginBottom:16, boxShadow:"0 1px 4px rgba(0,0,0,0.06)" }}>
            <p style={{ fontSize:12, color:t.formTextMuted, marginBottom:4 }}>Colorway</p>
            <p style={{ fontSize:17, fontWeight:600, color:t.formText, marginBottom:16 }}>{cw.name} — {cw.tag}</p>
            <div style={{ display:"flex", gap:10 }}>
              {COLORWAYS.map((c,i) => (
                <button key={c.id} onClick={() => setActiveColor(i)} style={{ width:32, height:32, borderRadius:"50%", background:c.dot, border: i===activeColor ? "3px solid #0071e3" : "2px solid transparent", cursor:"pointer", outline:"1px solid rgba(0,0,0,0.1)" }} />
              ))}
            </div>
          </div>

          {/* Personalize */}
          <div style={{ background:t.formSection, borderRadius:20, padding:"24px", marginBottom:16, boxShadow:"0 1px 4px rgba(0,0,0,0.06)" }}>
            <h3 style={{ fontSize:20, fontWeight:700, color:t.formText, marginBottom:6 }}>Personalize for free</h3>
            <p style={{ fontSize:14, color:t.formTextMuted, marginBottom:20 }}>Engrave your name, student ID, or a short message. Free. Delivers just as fast.</p>
            {[{ v:"engrave", label:"Add Engraving", sub:"Engrave your name, initials, or student ID to make your card unmistakably yours.", badge:"Free" }, { v:"none", label:"No Engraving" }].map(opt => (
              <button key={opt.v} onClick={() => setEngrave(opt.v)} style={{ display:"block", width:"100%", background:t.formSection, border: engrave===opt.v ? "2px solid #0071e3" : `1px solid ${t.formBorder}`, borderRadius:12, padding:"16px 18px", cursor:"pointer", textAlign:"left", marginBottom:10, transition:"all 0.2s", color:t.formText }}>
                <div style={{ display:"flex", justifyContent:"space-between" }}>
                  <span style={{ fontSize:15, fontWeight:600 }}>{opt.label}</span>
                  {opt.badge && <span style={{ fontSize:13, color:t.formTextMuted }}>{opt.badge}</span>}
                </div>
                {opt.sub && <p style={{ fontSize:13, color:t.formTextMuted, marginTop:4, lineHeight:1.5 }}>{opt.sub}</p>}
              </button>
            ))}
          </div>

          {/* Delivery */}
          <div style={{ background:t.formSection, borderRadius:20, padding:"24px", marginBottom:16, boxShadow:"0 1px 4px rgba(0,0,0,0.06)" }}>
            <h3 style={{ fontSize:20, fontWeight:700, color:t.formText, marginBottom:16 }}>Delivery</h3>
            {[{ v:"standard", label:"Standard", sub:"Ships Q4 2026 · Your chosen colorway", badge:"Free" }, { v:"founder", label:"Founder Delivery", sub:"Titanium Black · #0001–#0005 · White-glove · 1-on-1 with Vincent · Lifetime Pro", badge:"$3,000", exclusive:true }].map(opt => (
              <button key={opt.v} onClick={() => setDelivery(opt.v)} style={{ display:"block", width:"100%", background:t.formSection, border: delivery===opt.v ? "2px solid #0071e3" : `1px solid ${t.formBorder}`, borderRadius:12, padding:"16px 18px", cursor:"pointer", textAlign:"left", marginBottom:10, transition:"all 0.2s", color:t.formText }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom: opt.sub ? 4 : 0 }}>
                  <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                    <span style={{ fontSize:15, fontWeight:600 }}>{opt.label}</span>
                    {opt.exclusive && <span style={{ fontSize:10, fontWeight:700, letterSpacing:"0.1em", background:"#000", color:"#fff", borderRadius:4, padding:"2px 6px" }}>EXCLUSIVE</span>}
                  </div>
                  <span style={{ fontSize:14, fontWeight:600 }}>{opt.badge}</span>
                </div>
                {opt.sub && <p style={{ fontSize:13, color:t.formTextMuted, lineHeight:1.5 }}>{opt.sub}</p>}
              </button>
            ))}
          </div>

          {/* Form */}
          <div style={{ background:t.formSection, borderRadius:20, padding:"24px", marginBottom:16, boxShadow:"0 1px 4px rgba(0,0,0,0.06)" }}>
            <p style={{ fontSize:13, color:t.formTextMuted, marginBottom:4 }}>FschoolAI Founding Card</p>
            <p style={{ fontSize:32, fontWeight:700, color:t.formText, marginBottom:4 }}>Free</p>
            <p style={{ fontSize:13, color:t.formTextMuted, marginBottom:24 }}>No credit card required · Ships Q4 2026</p>
            {!submitted ? (
              <>
                {[{ key:"name", placeholder:"Full name" }, { key:"school", placeholder:"University or school" }, { key:"email", placeholder:"Email address", type:"email" }].map(f => (
                  <input key={f.key} type={f.type||"text"} placeholder={f.placeholder} value={form[f.key]} onChange={e => setForm({...form, [f.key]:e.target.value})} style={{ display:"block", width:"100%", border:`1px solid ${t.formBorder}`, borderRadius:12, padding:"14px 16px", fontSize:15, marginBottom:12, outline:"none", color:t.formText, boxSizing:"border-box", fontFamily:"inherit", background:t.formSection }} />
                ))}
                <button onClick={() => { if(form.name && form.school && form.email) setSubmitted(true); }} style={{ display:"block", width:"100%", background:"#0071e3", color:"#fff", border:"none", borderRadius:12, padding:"16px", fontSize:16, fontWeight:600, cursor:"pointer", marginBottom:12 }}>Apply for my card →</button>
                <p style={{ textAlign:"center", fontSize:13, color:t.formTextMuted }}>Free. No credit card required. Ships Q4 2026.</p>
              </>
            ) : (
              <div style={{ textAlign:"center", padding:"32px 0" }}>
                <div style={{ fontSize:48, marginBottom:12 }}>✅</div>
                <h3 style={{ fontSize:22, fontWeight:700, color:t.formText, marginBottom:8 }}>You're on the list!</h3>
                <p style={{ color:t.formTextMuted, fontSize:15 }}>We'll email you when your Founding Card is ready to ship.</p>
              </div>
            )}
          </div>

          {/* Trust badges */}
          {[{ emoji:"🚚", title:"Free delivery", desc:"Ships Q4 2026 to your door" }, { emoji:"∞", title:"Lifetime Pro included", desc:"Every feature, every update — no subscription ever" }, { emoji:"↩️", title:"Cancel anytime", desc:"Before your card ships, no questions asked" }].map((b,i) => (
            <div key={i} style={{ display:"flex", flexDirection:"column", alignItems:"center", padding:"28px 0", borderBottom: i<2 ? `1px solid ${t.trustBorder}` : "none", textAlign:"center" }}>
              <span style={{ fontSize:28, marginBottom:8 }}>{b.emoji}</span>
              <p style={{ fontSize:15, fontWeight:600, color:t.formText, marginBottom:4 }}>{b.title}</p>
              <p style={{ fontSize:13, color:t.formTextMuted }}>{b.desc}</p>
            </div>
          ))}

          {/* What's inside */}
          <div style={{ background:t.formSection, borderRadius:20, padding:"24px", marginTop:16, marginBottom:16, boxShadow:"0 1px 4px rgba(0,0,0,0.06)" }}>
            <h3 style={{ fontSize:22, fontWeight:700, color:t.formText, marginBottom:20 }}>What's inside</h3>
            {whatsInside.map((item,i) => (
              <div key={i} style={{ display:"flex", flexDirection:"column", alignItems:"center", padding:"24px 0", borderBottom: i<whatsInside.length-1 ? `1px solid ${t.formBorder}` : "none", textAlign:"center" }}>
                <span style={{ fontSize:32, marginBottom:10 }}>{item.emoji}</span>
                <p style={{ fontSize:15, fontWeight:600, color:t.formText, marginBottom:4 }}>{item.title}</p>
                <p style={{ fontSize:13, color:t.formTextMuted, lineHeight:1.5 }}>{item.desc}</p>
              </div>
            ))}
            <div style={{ background:t.formBg, borderRadius:14, padding:"16px 18px", marginTop:16, display:"flex", gap:14, alignItems:"flex-start" }}>
              <span style={{ fontSize:24 }}>🎓</span>
              <p style={{ fontSize:14, color:t.formText, lineHeight:1.5 }}>Set up your identity card with a one-on-one session with a Specialist. <a href="mailto:support@fschoolai.com" style={{ color:"#0071e3", textDecoration:"none" }}>Book a free Personal Setup session.</a></p>
            </div>
          </div>

          {/* Product info */}
          <div style={{ background:t.formSection, borderRadius:20, padding:"24px", boxShadow:"0 1px 4px rgba(0,0,0,0.06)" }}>
            <h3 style={{ fontSize:22, fontWeight:700, color:t.formText, marginBottom:20 }}>Product Information</h3>
            {[{ label:"Overview", text:"The FschoolAI Founding Card is a physical NFC card that serves as your identity in the FschoolAI ecosystem. It unlocks Lifetime Pro access, your NeuroAGI Brain ID, and the ability to share your academic profile with a single tap." }, { label:"Availability", text:"500 cards total. Applications close June 30, 2026. Ships Q4 2026." }, { label:"Note", text:"The FschoolAI Founding Card is a physical NFC card. Not a financial product." }].map((item,i) => (
              <div key={i} style={{ marginBottom:20 }}>
                <p style={{ fontSize:12, color:t.formTextMuted, marginBottom:4 }}>{item.label}</p>
                <p style={{ fontSize:14, color:t.formText, lineHeight:1.6 }}>{item.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer style={{ background:t.formBg, borderTop:`1px solid ${t.trustBorder}`, padding:"20px", textAlign:"center", transition:"background 0.3s ease" }}>
        <p style={{ fontSize:13, color:t.formTextMuted }}>© 2026 FschoolAI. All rights reserved.</p>
      </footer>

    </div>
  );
}
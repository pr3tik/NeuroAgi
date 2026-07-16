import { useState, useEffect, useRef } from "react";
import CardHeroAnimation from "../components/CardHeroAnimation";
import NFCTapAnimation from "../components/NFCTapAnimation";

// ── Card image maps ───────────────────────────────────────────────────────────
const CARD_IMAGES_LIGHT = {
  white:  "/cards/card-mockups/white.png",
  violet: "/cards/card-mockups/violet.png",
  pink:   "/cards/card-mockups/pink.png",
  blue:   "/cards/card-mockups/blue.png",
  green:  "/cards/card-mockups/green.png",
  black:  "/cards/black_cropped.png",
};

// eslint-disable-next-line no-unused-vars
const CARD_IMAGES_DARK = {
  white:  "/cards/white_mockup_dark.png",
  violet: "/cards/violet_mockup_dark.png",
  pink:   "/cards/pink_mockup_dark.png",
  blue:   "/cards/blue_mockup_dark.png",
  green:  "/cards/green_mockup_dark.png",
  black:  "/cards/black_cropped.png",
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
  formBg: "#0a0a0a",
  formText: "#fff",
  formTextMuted: "rgba(255,255,255,0.5)",
  formBorder: "rgba(255,255,255,0.14)",
  formSection: "#1a1a1a",
  trustBg: "#0a0a0a",
  trustBorder: "rgba(255,255,255,0.1)",
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
const CARD_SHADOW = "inset 1px 1px 2px 2px rgba(0,0,0,0.25)";
const CARD_BORDER = "1px solid rgba(255,255,255,0.4)";
const CARD_DROP   = "-20px 10px 8px 5px rgba(0,0,0,0.21)";

// Shared frosted-glass layers — reused on the Apply button and the Delivery
// option cards, each with their own base color underneath.
const GLASS_LAYERS =
  "linear-gradient(0deg, rgba(255,237,244,0.22), rgba(255,237,244,0.22)), " +
  "linear-gradient(0deg, rgba(255,255,255,0.45) 0%, rgba(255,255,255,0.15) 30%, rgba(255,255,255,0) 70%, rgba(224,237,255,0.1125) 100%), " +
  "linear-gradient(316.97deg, rgba(255,255,255,0.3) 17.24%, rgba(255,255,255,0) 58.62%, rgba(217,235,255,0.135) 86.21%), " +
  "radial-gradient(38.46% 38.46% at 11.54% 19.23%, rgba(255,235,255,0.054) 0%, rgba(230,255,240,0.036) 70%, rgba(240,240,255,0) 100%), " +
  "radial-gradient(20% 20% at 0% 0%, rgba(255,255,255,0.009) 0%, rgba(250,250,255,0.015) 30%, rgba(255,250,250,0.006) 60%, rgba(252,252,255,0) 100%)";
const GLASS_SHADOW =
  "0px 0px 60px rgba(255,255,255,0.135), " +
  "0px 17.2px 40px -6px rgba(0,0,0,0.37), " +
  "0px 3px 12px -3px rgba(0,0,0,0.24), " +
  "inset 1.125px 1.8px 11.6px rgba(209,230,255,0.225), " +
  "inset 0px 1.5px 5.25px rgba(255,255,255,0.675), " +
  "inset -0.54px 0px 1.5px rgba(38,115,255,0.081), " +
  "inset 0.54px 0px 1.5px rgba(255,38,64,0.0675), " +
  "inset 0px 0px 0.95px rgba(242,242,255,0.024)";

const CardImg = ({ id, width = 160, style = {}, images = CARD_IMAGES_LIGHT }) => {
  const radius = Math.round(width * (20 / 214)); // same radius:width ratio as the hero animation cards
  const shadowW = width * 1.15;
  const shadowH = shadowW * 0.13;
  return (
    <div style={{
      position: "relative",
      width,
      flexShrink: 0,
      transition: "transform 0.4s ease",
      ...style
    }}>
      <div style={{ position:"relative", borderRadius:radius, overflow:"hidden" }}>
        <img
          src={images[id]}
          alt={id + " card"}
          style={{ width: "100%", height: "auto", display: "block" }}
        />
        <div style={{ position:"absolute", inset:0, borderRadius:radius, boxShadow:CARD_SHADOW, pointerEvents:"none" }} />
        <div style={{ position:"absolute", inset:0, borderRadius:radius, border:CARD_BORDER, boxShadow:CARD_DROP, pointerEvents:"none" }} />
      </div>
      {/* Ground/contact shadow */}
      <div style={{
        position: "absolute",
        left: "50%",
        bottom: -shadowH * 0.45,
        transform: "translateX(-50%)",
        width: shadowW,
        height: shadowH,
        background: "radial-gradient(ellipse at center, rgba(0,0,0,0.32) 0%, rgba(0,0,0,0) 72%)",
        filter: "blur(4px)",
        pointerEvents: "none",
      }} />
    </div>
  );
};

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

// ── Icon set (plain inline SVG — no icon library dependency) ──────────────────
const iconProps = (size = 26) => ({ width: size, height: size, viewBox: "0 0 24 24", fill: "none", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round" });

const IconBrain = ({ color, size }) => (
  <svg {...iconProps(size)} stroke={color}>
    <path d="M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 2.8V12a3 3 0 0 0 1 5.6V18a3 3 0 0 0 3 3h2V4Z" />
    <path d="M15 4a3 3 0 0 1 3 3 3 3 0 0 1 2 2.8V12a3 3 0 0 1-1 5.6V18a3 3 0 0 1-3 3h-2V4Z" />
  </svg>
);

const IconNfc = ({ color, size }) => (
  <svg {...iconProps(size)} stroke={color}>
    <circle cx="12" cy="19" r="1.1" fill={color} stroke="none" />
    <path d="M8.5 15.3a5 5 0 0 1 7 0" />
    <path d="M5.5 12.2a9 9 0 0 1 13 0" />
    <path d="M2.5 9.1a13 13 0 0 1 19 0" />
  </svg>
);

const IconMedal = ({ color, size }) => (
  <svg {...iconProps(size)} stroke={color}>
    <circle cx="12" cy="14.5" r="5.2" />
    <path d="M9.3 13.8 7 21l5-3 5 3-2.3-7.2" />
  </svg>
);

const IconGem = ({ color, size }) => (
  <svg {...iconProps(size)} stroke={color}>
    <path d="M6 8h12l3 4-9 9-9-9 3-4Z" />
    <path d="M3 12h18" />
    <path d="M9 8 12 21 15 8" />
  </svg>
);

const IconInfinity = ({ color, size }) => (
  <svg {...iconProps(size)} stroke={color}>
    <path d="M18.178 8c5.096 0 5.096 8 0 8-5.095 0-7.133-8-12.739-8-4.585 0-4.585 8 0 8 5.606 0 7.644-8 12.739-8z" />
  </svg>
);

// ── Shine Border ───────────────────────────────────────────────────────────────
// Reimplementation of the shadcn/magicui "Shine Border" component in plain CSS.
// The original relies on Tailwind utility classes (before:bg-shine-size,
// animate-shine) and a cn() helper from "@/lib/utils" — neither exists in this
// CRA project (no Tailwind here), so this uses the same underlying technique
// (a radial-gradient background animated via background-position, revealed
// only along the border using mask-composite: exclude) but as inline styles
// plus a small <style> block for the keyframes.
const ShineBorder = ({ borderRadius = 24, borderWidth = 1.5, duration = 10, color = "#000000", children }) => (
  <div style={{ position: "relative", borderRadius, height: "100%" }}>
    <div
      style={{
        position: "absolute",
        inset: 0,
        borderRadius,
        padding: borderWidth,
        backgroundImage: `radial-gradient(transparent, transparent, ${Array.isArray(color) ? color.join(",") : color}, transparent, transparent)`,
        backgroundSize: "300% 300%",
        WebkitMask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
        WebkitMaskComposite: "xor",
        maskComposite: "exclude",
        animation: `shineMove ${duration}s linear infinite`,
        pointerEvents: "none",
      }}
    />
    {children}
  </div>
);

export default function Card({ onBack }: { onBack?: () => void }) {
  const [dark, setDark] = useState(false);
  const t = dark ? DARK : LIGHT;

  const [activeColor, setActiveColor] = useState(0);
  const [engrave, setEngrave] = useState(null);
  const [delivery, setDelivery] = useState("standard");
  const [form, setForm] = useState({ name:"", school:"", email:"" });
  const [submitted, setSubmitted] = useState(false);
  const countdown = useCountdown("2026-06-30T23:59:59");
  const cw = COLORWAYS[activeColor];
  const pad = n => String(n).padStart(2,"0");

  // Measure the Dark/Light toggle pill's right edge so the "Make it yours"
  // panel below can align its own left/right edges to exactly the same
  // inset from the viewport — rather than a guessed fixed pixel value.
  // Only applies on desktop widths: this inset is roughly a fixed pixel
  // amount (driven by nav button sizes, not viewport width), so on a narrow
  // phone screen it would eat a huge fraction of the available width instead
  // of a small sliver like it does on desktop.
  const themeToggleRef = useRef(null);
  const [sideInset, setSideInset] = useState(20);
  useEffect(() => {
    const measure = () => {
      if (window.innerWidth < 768) { setSideInset(20); return; }
      if (!themeToggleRef.current) return;
      const rect = themeToggleRef.current.getBoundingClientRect();
      const inset = window.innerWidth - rect.right;
      if (inset > 0) setSideInset(inset);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [dark]);

  // What's Inside — cards fade in one-by-one when the section scrolls into view
  const [wiRef, wiVisible] = useInView();

  const Label = ({ children }) => (
    <p style={{ fontFamily:"'SF Pro Text','Inter',sans-serif", fontSize:11, fontWeight:600, letterSpacing:"0.16em", color:t.label, textTransform:"uppercase", marginBottom:16 }}>{children}</p>
  );

  const whatsInside = [
    { Icon:IconBrain,    color:"#B53DD6", title:"NeuroAGI Brain ID", desc:"Your unique neural identity across the entire NeuroAGI ecosystem" },
    { Icon:IconNfc,      color:"#9CB5FF", title:"NFC Tap", desc:"One tap shares your full profile and Brain Card instantly" },
    { Icon:IconGem,      color:"#5DAA46", title:"FST Token Wallet", desc:"Built-in wallet — earn, hold, and spend FST tokens" },
    { Icon:IconInfinity, color:"#4B4444", title:"Lifetime FschoolAI Pro", desc:"Every Pro feature, every future update — forever, no subscription" },
    { Icon:IconMedal,    color:"#FC71C7", title:"Founding Number #0001–#0500", desc:"Permanently engraved — only 500 exist, ever" },
  ];

  return (
    <div style={{ background:t.bg, color:t.text, fontFamily:"'SF Pro Display','Inter',-apple-system,sans-serif", minHeight:"100vh", overflowX:"hidden", transition:"background 0.3s ease, color 0.3s ease" }}>

      {/* NAV */}
      <nav style={{ position:"fixed", top:0, left:0, right:0, zIndex:100, display:"flex", alignItems:"center", justifyContent:"space-between", padding:"0 20px", height:52, background:t.navBg, backdropFilter:"blur(20px)", borderBottom:`1px solid ${t.border}`, transition:"background 0.3s ease" }}>
        <button onClick={() => onBack?.()} style={{ background:"none", border:"none", color:t.textMuted, fontSize:14, cursor:"pointer" }}>‹ FschoolAI</button>
        <span style={{ fontSize:14, fontWeight:500, color:t.text }}>Founding Card</span>
        <div style={{ display:"flex", gap:10, alignItems:"center" }}>
          <span ref={themeToggleRef} style={{ display:"inline-flex" }}>
            <ThemeToggle dark={dark} onToggle={() => setDark(d => !d)} t={t} />
          </span>
          <button onClick={() => document.getElementById("order").scrollIntoView({ behavior:"smooth" })} style={{ background:dark?"#fff":"#000", color:dark?"#000":"#fff", border:"none", borderRadius:20, padding:"6px 16px", fontSize:13, fontWeight:600, cursor:"pointer" }}>Apply</button>
        </div>
      </nav>

      {/* HERO + COUNTDOWN — combined, reordered on mobile */}
      <style>{`
        @keyframes heroFadeIn{from{opacity:0;transform:translateY(20px);}to{opacity:1;transform:translateY(0);}}
        @media(max-width:767px){
          .hero-section{min-height:100svh!important;height:100svh!important;justify-content:space-between!important;padding-bottom:40px!important;}
          .hero-countdown-mobile{display:block!important;}
          .hero-countdown-desktop{display:none!important;}
        }
        @media(min-width:768px){
          .hero-cards{display:block!important;}
          .hero-countdown-mobile{display:none!important;}
          .hero-countdown-desktop{display:block!important;}
        }
      `}</style>

      <section className="hero-section" style={{ minHeight:"145svh", height:"145svh", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"flex-start", position:"relative", overflow:"hidden" }}>
        {/* Animation background — desktop only. Pushed down via `top` (not inset:0) so its
            own vertical centering point sits below the text block instead of behind it —
            the scale itself is viewport-based (unaffected by this box), only the center shifts. */}
        <div className="hero-countdown-desktop" style={{ position:"absolute", top:120, left:0, right:0, bottom:0 }}>
          <CardHeroAnimation dark={dark} />
        </div>

        {/* Text */}
        <div style={{ position:"relative", zIndex:20, textAlign:"center", padding:"80px 20px 0", width:"100%" }}>
          <p style={{ fontSize:12, fontWeight:600, letterSpacing:"0.2em", color:t.textFaint, marginBottom:16, textTransform:"uppercase", opacity:0, animation:"heroFadeIn 1s ease 2s both" }}>Founding Edition · Only 500</p>
          <h1 style={{ fontSize:"clamp(32px,5vw,64px)", fontWeight:700, lineHeight:1.05, margin:"0 0 16px", letterSpacing:"-0.02em", color:t.text, opacity:0, animation:"heroFadeIn 1s ease 2.3s both" }}>FschoolAI<br />Founding Card</h1>
          <p style={{ fontSize:17, color:t.textMuted, opacity:0, animation:"heroFadeIn 1s ease 2.6s both" }}>Free for founding members. Ships Q4 2026.</p>
        </div>

        {/* Cards animation — mobile only, fills remaining space below text */}
        <div className="hero-countdown-mobile" style={{ display:"none", position:"relative", zIndex:20, width:"100%", flex:1, minHeight:0, overflow:"visible" }}>
          <CardHeroAnimation dark={dark} />
        </div>

        {/* Scroll indicator — both modes */}
        <div style={{ position:"absolute", bottom:24, left:"50%", transform:"translateX(-50%)", zIndex:20, textAlign:"center" }}>
          <div style={{ width:1, height:24, background:`linear-gradient(to bottom,transparent,${dark?"rgba(255,255,255,0.4)":"rgba(0,0,0,0.3)"})`, margin:"0 auto 4px" }} />
          <span style={{ fontSize:16, opacity:0.35 }}>↓</span>
        </div>
      </section>

      {/* COUNTDOWN — desktop version (after hero) */}
      <section className="hero-countdown-desktop" style={{ padding:"220px 20px 80px", textAlign:"center" }}>
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

      {/* COUNTDOWN — mobile version (below the fold, user scrolls to see) */}
      <section className="hero-countdown-mobile" style={{ display:"none", padding:"80px 20px", textAlign:"center" }}>
        <Label>Applications Close</Label>
        <div style={{ display:"flex", justifyContent:"center", gap:"clamp(24px,5vw,64px)", marginBottom:16 }}>
          {[["d","Days"],["h","Hours"],["m","Min"],["s","Sec"]].map(([k,label]) => (
            <div key={k}>
              <div style={{ fontSize:"clamp(40px,10vw,72px)", fontWeight:700, lineHeight:1, letterSpacing:"-0.03em", color:t.text }}>{pad(countdown[k])}</div>
              <div style={{ fontSize:11, fontWeight:500, letterSpacing:"0.14em", color:t.textFaint, textTransform:"uppercase", marginTop:6 }}>{label}</div>
            </div>
          ))}
        </div>
        <p style={{ color:t.textFaint, fontSize:13, letterSpacing:"0.04em" }}>June 30, 2026 · Midnight</p>
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
                <CardImg id={c.id} width={160} images={CARD_IMAGES_LIGHT} style={{ display:"block" }} />
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

      {/* WHAT'S INSIDE */}
      <section style={{ background:t.formBg, color:t.formText, padding:"80px 20px 40px", transition:"background 0.3s ease" }}>
        <div style={{ maxWidth:1000, margin:"0 auto" }}>
          <h3 style={{ fontSize:28, fontWeight:700, color:t.formText, marginBottom:28, textAlign:"center" }}>What's inside</h3>
          <div ref={wiRef} className={`mkyours-panel${dark ? " whats-inside-dark" : ""}`}>
            <div style={{ display:"flex", flexWrap:"wrap", gap:24, justifyContent:"center" }}>
              {whatsInside.map((item,i) => (
                <div key={i} style={{
                  flex:"0 1 240px", maxWidth:270, minHeight:170,
                  opacity: wiVisible ? 1 : 0,
                  transform: wiVisible ? "translateY(0)" : "translateY(24px)",
                  transition: `opacity 0.6s ease ${i*0.15}s, transform 0.6s ease ${i*0.15}s`,
                }}>
                  <ShineBorder color={item.color} borderRadius={22} borderWidth={1.5} duration={9}>
                    <div style={{ background:t.formSection, borderRadius:22, height:"100%", boxSizing:"border-box", padding:"26px 18px", boxShadow:"10px -5px 14px rgba(0,0,0,0.1)", display:"flex", flexDirection:"column", alignItems:"center", textAlign:"center", gap:10 }}>
                      <item.Icon color={item.color} size={30} />
                      <p style={{ fontSize:16, fontWeight:600, color:t.formText, margin:0 }}>{item.title}</p>
                      <p style={{ fontSize:13, color:t.formTextMuted, lineHeight:1.45, margin:0 }}>{item.desc}</p>
                    </div>
                  </ShineBorder>
                </div>
              ))}
            </div>
            <div style={{
              background:t.formBg, borderRadius:14, padding:"16px 18px", marginTop:24, maxWidth:680, marginLeft:"auto", marginRight:"auto",
              opacity: wiVisible ? 1 : 0,
              transform: wiVisible ? "translateY(0)" : "translateY(16px)",
              transition: `opacity 0.6s ease ${whatsInside.length*0.15 + 0.3}s, transform 0.6s ease ${whatsInside.length*0.15 + 0.3}s`,
            }}>
              <p style={{ fontSize:14, color:t.formText, lineHeight:1.5, textAlign:"center", margin:0 }}>Set up your identity card with a one-on-one session with a Specialist. <a href="mailto:support@fschoolai.com" style={{ color:"#0071e3", textDecoration:"none" }}>Book a free Personal Setup session.</a></p>
            </div>
          </div>
        </div>
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
            {/* TODO: replacement image goes here */}
          </Reveal>
        </div>
      </section>

      {/* TAP TO LAUNCH */}
      <section style={{ padding:"100px 20px 120px", textAlign:"center" }}>
        <Reveal>
          <Label>How It Works</Label>
        </Reveal>
        <Reveal delay={0.1}>
          <NFCTapAnimation t={t} />
        </Reveal>
      </section>

      {/* PERSONALIZE — now includes the full colorway/delivery/apply flow */}
      <style>{`
        @keyframes shineMove { 0%{background-position:0% 0%;} 50%{background-position:100% 100%;} 100%{background-position:0% 0%;} }
        .trust-inner { width:660px; }
        @media(max-width:767px){
          .trust-outer { height:86px; overflow:hidden; }
          .trust-inner { width:660px; transform:scale(0.55); transform-origin:top center; margin:0 auto; }
        }
        .mkyours-grid { display:flex; flex-direction:column; gap:16px; }
        @media(min-width:768px){
          .mkyours-section { background:none !important; }
        }
        .mkyours-panel { background:none; padding:0; border-radius:0; }
        @media(min-width:768px){
          .mkyours-panel { background:
            radial-gradient(circle at 0% 0%, rgba(255,165,165,0.35) 0%, rgba(255,165,165,0) 32%),
            radial-gradient(circle at 100% 0%, rgba(255,165,165,0.35) 0%, rgba(255,165,165,0) 32%),
            radial-gradient(circle at 0% 100%, rgba(255,165,165,0.35) 0%, rgba(255,165,165,0) 32%),
            radial-gradient(circle at 100% 100%, rgba(255,165,165,0.35) 0%, rgba(255,165,165,0) 32%),
            radial-gradient(65% 68% at 51.74% 48.15%, rgba(255,255,255,0.2) 12.98%, rgba(236,178,253,0.2) 34.62%, rgba(188,246,194,0.2) 52.88%, rgba(143,209,255,0.2) 74.99%, rgba(255,165,165,0.2) 100%),
            #E2E2E2;
            border-radius:40px; padding:40px;
            box-shadow:
              0px 0px 60px rgba(255,255,255,0.135),
              0px 17.2px 40px -6px rgba(0,0,0,0.37),
              0px 3px 12px -3px rgba(0,0,0,0.24),
              inset 1.125px 1.8px 11.6px rgba(209,230,255,0.225),
              inset 0px 1.5px 5.25px rgba(255,255,255,0.675),
              inset -0.54px 0px 1.5px rgba(38,115,255,0.081),
              inset 0.54px 0px 1.5px rgba(255,38,64,0.0675),
              inset 0px 0px 0.95px rgba(242,242,255,0.024);
            backdrop-filter: blur(33.5px);
            -webkit-backdrop-filter: blur(33.5px);
          }
          .mkyours-panel-founder { background:
            radial-gradient(65% 68% at 51.74% 48.15%, rgba(90,90,90,0.5) 0%, rgba(40,40,40,0.6) 55%, rgba(0,0,0,0.85) 100%),
            #0a0a0a !important;
          }
          .whats-inside-dark { background:#0a0a0a !important; }
          .mkyours-grid { display:grid; grid-template-columns:1.1fr 1fr; gap:28px; align-items:start; }
        }
      `}</style>
      <section id="order" className="mkyours-section" style={{ padding:`100px ${sideInset}px`, textAlign:"center", background:t.formBg, transition:"background 0.3s ease" }}>
        <Reveal>
          <Label>Personalize</Label>
          <h2 style={{ fontSize:"clamp(38px,6vw,64px)", fontWeight:700, letterSpacing:"-0.02em", marginBottom:12 }}>Make it yours.</h2>
          <p style={{ color:t.textMuted, fontSize:17, marginBottom:24 }}>Laser-engraved on the back. Free. Delivers just as fast.</p>
          <div className="trust-outer" style={{ maxWidth:660, margin:"0 auto 60px", position:"relative" }}>
            <div className="trust-inner">
            {(() => {
              const W = 660;
              const lines = [
                { text:"Free delivery.", size:32, h:42 },
                { text:"Cancel anytime.", size:40, h:52 },
                { text:"Lifetime Pro included.", size:48, h:62 },
              ];
              const totalH = lines.reduce((s, l) => s + l.h, 0);
              const gradient = "radial-gradient(89.14% 93.09% at 51.74% 48.15%, #B4B4B4 12.98%, #A891B1 34.62%, #94B197 42%, #7E9DB4 46%, #B58888 50%)";
              let offset = 0;
              return lines.map((line) => {
                const y = offset;
                offset += line.h;
                return (
                  <p key={line.text} style={{
                    margin:0,
                    height:line.h,
                    fontFamily:"'SF Pro Display','Inter',sans-serif",
                    fontWeight:590,
                    fontSize:line.size,
                    lineHeight:`${line.h}px`,
                    letterSpacing:0,
                    textAlign:"center",
                    whiteSpace:"nowrap",
                    backgroundImage:gradient,
                    backgroundSize:`${W}px ${totalH}px`,
                    backgroundPosition:`center -${y}px`,
                    backgroundRepeat:"no-repeat",
                    WebkitBackgroundClip:"text",
                    backgroundClip:"text",
                    color:"transparent",
                    WebkitTextFillColor:"transparent",
                    textShadow:"0px 4px 4px rgba(139,139,139,0.25)",
                  }}>
                    {line.text}
                  </p>
                );
              });
            })()}
            </div>
          </div>
        </Reveal>

        <div style={{ margin:"0 auto", textAlign:"left" }}>
          <div className={`mkyours-panel${delivery==="founder" ? " mkyours-panel-founder" : ""}`}>
            <div className="mkyours-grid">

              {/* LEFT column */}
              <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
                {/* Header + card preview, merged into one panel */}
                <div style={{ background:t.formSection, borderRadius:20, padding:"clamp(18px,5vw,24px) clamp(14px,4vw,20px) clamp(24px,7vw,32px)", boxShadow:"0 1px 4px rgba(0,0,0,0.06)" }}>
                  <p style={{ fontSize:13, color:t.formTextMuted, marginBottom:4 }}>FschoolAI</p>
                  <h3 style={{ fontSize:"clamp(24px,7vw,36px)", fontWeight:700, letterSpacing:"-0.02em", marginBottom:4, color:t.formText }}>{delivery==="founder" ? "Exclusive Card" : "Founding Card"}</h3>
                  <p style={{ fontSize:14, color:t.formTextMuted, marginBottom:24 }}>{delivery==="founder" ? "Exclusive Edition · Only 5" : "Founding Edition · Only 500"}</p>
                  <div style={{ display:"flex", justifyContent:"center" }}>
                    <CardImg id={delivery==="founder" ? "black" : cw.id} width={200} style={{ transition:"all 0.4s ease" }} images={CARD_IMAGES_LIGHT} />
                  </div>
                </div>

                {/* Colorway picker */}
                <div style={{ background:t.formSection, borderRadius:20, padding:"clamp(16px,5vw,24px)", boxShadow:"0 1px 4px rgba(0,0,0,0.06)" }}>
                  <p style={{ fontSize:12, color:t.formTextMuted, marginBottom:4 }}>Colorway</p>
                  <p style={{ fontSize:"clamp(15px,4vw,17px)", fontWeight:600, color:t.formText, marginBottom:16 }}>{delivery==="founder" ? "Titanium Black — Exclusive. Unmistakable." : `${cw.name} — ${cw.tag}`}</p>
                  <div style={{ display:"flex", gap:10 }}>
                    {delivery==="founder" ? (
                      <button style={{ width:32, height:32, borderRadius:"50%", background:"#111", border:"3px solid #0071e3", cursor:"default", outline:"1px solid rgba(0,0,0,0.1)" }} />
                    ) : (
                      COLORWAYS.map((c,i) => (
                        <button key={c.id} onClick={() => setActiveColor(i)} style={{ width:32, height:32, borderRadius:"50%", background:c.dot, border: i===activeColor ? "3px solid #0071e3" : "2px solid transparent", cursor:"pointer", outline:"1px solid rgba(0,0,0,0.1)" }} />
                      ))
                    )}
                  </div>
                </div>

                {/* Personalize */}
                <div style={{ background:t.formSection, borderRadius:20, padding:"clamp(16px,5vw,24px)", boxShadow:"0 1px 4px rgba(0,0,0,0.06)" }}>
                  <h3 style={{ fontSize:"clamp(17px,4.5vw,20px)", fontWeight:700, color:t.formText, marginBottom:6 }}>Personalize for free</h3>
                  <p style={{ fontSize:14, color:t.formTextMuted, marginBottom:20 }}>Engrave your name, student ID, or a short message. Free. Delivers just as fast.</p>
                  {[{ v:"engrave", label:"Add Engraving", sub:"Engrave your name, initials, or student ID to make your card unmistakably yours.", badge:"Free" }, { v:"none", label:"No Engraving" }].map(opt => (
                    <button key={opt.v} onClick={() => setEngrave(opt.v)} style={{ display:"block", width:"100%", background:t.formSection, border: engrave===opt.v ? "2px solid #0071e3" : `1px solid ${t.formBorder}`, borderRadius:12, padding:"clamp(12px,4vw,16px) clamp(12px,4vw,18px)", cursor:"pointer", textAlign:"left", marginBottom:10, transition:"all 0.2s", color:t.formText }}>
                      <div style={{ display:"flex", justifyContent:"space-between", gap:8, flexWrap:"wrap" }}>
                        <span style={{ fontSize:15, fontWeight:600 }}>{opt.label}</span>
                        {opt.badge && <span style={{ fontSize:13, color:t.formTextMuted }}>{opt.badge}</span>}
                      </div>
                      {opt.sub && <p style={{ fontSize:13, color:t.formTextMuted, marginTop:4, lineHeight:1.5 }}>{opt.sub}</p>}
                    </button>
                  ))}
                </div>
              </div>

              {/* RIGHT column */}
              <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
                {/* Delivery */}
                <div style={{ background:t.formSection, borderRadius:20, padding:"clamp(16px,5vw,24px)", boxShadow:"0 1px 4px rgba(0,0,0,0.06)" }}>
                  <h3 style={{ fontSize:"clamp(17px,4.5vw,20px)", fontWeight:700, color:t.formText, marginBottom:16 }}>Delivery</h3>
                  {[{ v:"standard", label:"Standard", sub:"Ships Q4 2026 · Your chosen colorway", badge:"Free" }, { v:"founder", label:"Founder Delivery", sub:"Titanium Black · #0001–#0005 · White-glove · 1-on-1 with Vincent · Lifetime Pro", badge:"$3,000", exclusive:true }].map(opt => (
                    <button
                      key={opt.v}
                      onClick={() => setDelivery(opt.v)}
                      style={{
                        display:"block", width:"100%",
                        background: `${GLASS_LAYERS}, ${t.formSection}`,
                        boxShadow: GLASS_SHADOW,
                        backdropFilter:"blur(33.5px)",
                        WebkitBackdropFilter:"blur(33.5px)",
                        border: delivery===opt.v ? "2px solid #0071e3" : `1px solid ${t.formBorder}`,
                        borderRadius:12, padding:"clamp(12px,4vw,16px) clamp(12px,4vw,18px)", cursor:"pointer", textAlign:"left", marginBottom:10, transition:"all 0.2s", color:t.formText
                      }}
                    >
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:8, flexWrap:"wrap", marginBottom: opt.sub ? 4 : 0 }}>
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
                <div style={{ background:t.formSection, borderRadius:20, padding:"clamp(16px,5vw,24px)", boxShadow:"0 1px 4px rgba(0,0,0,0.06)" }}>
                  <p style={{ fontSize:13, color:t.formTextMuted, marginBottom:4 }}>FschoolAI Founding Card</p>
                  <p style={{ fontSize:"clamp(26px,7vw,32px)", fontWeight:700, color:t.formText, marginBottom:4 }}>{delivery==="founder" ? "$3,000" : "Free"}</p>
                  <p style={{ fontSize:13, color:t.formTextMuted, marginBottom:24 }}>No credit card required · Ships Q4 2026</p>
                  {!submitted ? (
                    <>
                      {[{ key:"name", placeholder:"Full name" }, { key:"school", placeholder:"University or school" }, { key:"email", placeholder:"Email address", type:"email" }].map(f => (
                        <input key={f.key} type={f.type||"text"} placeholder={f.placeholder} value={form[f.key]} onChange={e => setForm({...form, [f.key]:e.target.value})} style={{ display:"block", width:"100%", border:`1px solid ${t.formBorder}`, borderRadius:12, padding:"14px 16px", fontSize:15, marginBottom:12, outline:"none", color:t.formText, boxSizing:"border-box", fontFamily:"inherit", background:t.formSection }} />
                      ))}
                      <button
                        onClick={() => { if(form.name && form.school && form.email) setSubmitted(true); }}
                        style={{
                          display:"block", width:"100%", border:"none", borderRadius:50,
                          padding:"16px clamp(20px,6vw,36px)", fontSize:15, fontWeight:600, cursor:"pointer", marginBottom:12,
                          fontFamily:"inherit",
                          background:dark?"#fff":"#000", color:dark?"#000":"#fff",
                        }}
                      >
                        Apply for my card →
                      </button>
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
              </div>

            </div>
          </div>
        </div>
      </section>

      {/* ORDER FORM — remaining info blocks (product info; What's Inside now lives above How It Works) */}
      <section style={{ background:t.formBg, color:t.formText, padding:"80px 20px", transition:"background 0.3s ease" }}>
        <div style={{ maxWidth:680, margin:"0 auto" }}>
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

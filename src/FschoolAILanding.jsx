import { useState, useEffect, useRef } from "react";
import CardHeroAnimation from "./CardHeroAnimation";
import NFCTapAnimation from "./NFCTapAnimation";
import ColorwayDial from "./ColorwayDial";

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

const CLAIM_DRAFT_KEY = "fschoolai-founding-card-draft-v2";

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
}

function loadClaimDraft() {
  try {
    const raw = localStorage.getItem(CLAIM_DRAFT_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

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

// Apple-style laser deboss — per colorway tone + opposing inner shadows (no drop shadow).
const ENGRAVE_STYLES = {
  white:  { color: "rgba(98, 95, 88, 0.72)",   textShadow: "0 1px 0 rgba(255,255,255,0.92), 0 -1px 1px rgba(0,0,0,0.22), 0 1px 2px rgba(0,0,0,0.06)" },
  violet: { color: "rgba(88, 72, 112, 0.74)",  textShadow: "0 1px 0 rgba(255,255,255,0.55), 0 -1px 1px rgba(40,20,60,0.3)" },
  pink:   { color: "rgba(130, 78, 92, 0.74)",  textShadow: "0 1px 0 rgba(255,255,255,0.55), 0 -1px 1px rgba(80,30,45,0.28)" },
  blue:   { color: "rgba(72, 98, 130, 0.74)",  textShadow: "0 1px 0 rgba(255,255,255,0.55), 0 -1px 1px rgba(30,50,80,0.28)" },
  green:  { color: "rgba(82, 110, 72, 0.74)",  textShadow: "0 1px 0 rgba(255,255,255,0.55), 0 -1px 1px rgba(40,70,30,0.28)" },
  black:  { color: "rgba(200, 198, 195, 0.52)", textShadow: "0 -1px 0 rgba(0,0,0,0.88), 0 1px 1px rgba(255,255,255,0.11)" },
};

function engraveFontSize(len) {
  if (len <= 8) return 11;
  if (len <= 12) return 10;
  if (len <= 16) return 9;
  if (len <= 22) return 8;
  return 7;
}

const COLOR_ATMOSPHERE = {
  white:  "rgba(210, 205, 195, 0.55)",
  violet: "rgba(170, 140, 220, 0.45)",
  pink:   "rgba(230, 140, 160, 0.42)",
  blue:   "rgba(130, 175, 230, 0.45)",
  green:  "rgba(140, 200, 145, 0.42)",
  black:  "rgba(80, 80, 85, 0.5)",
};

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);
  return reduced;
}

/**
 * Signature claim preview: magnetic 3D tilt, specular sheen,
 * live per-keystroke engrave, colorway atmosphere, calm success lift.
 */
const EngravedCardPreview = ({
  id,
  width = 240,
  images = CARD_IMAGES_LIGHT,
  name = "",
  celebrate = false,
}) => {
  const reducedMotion = usePrefersReducedMotion();
  const stageRef = useRef(null);
  const rafRef = useRef(0);
  const targetRef = useRef({ x: 0, y: 0 });
  const currentRef = useRef({ x: 0, y: 0 });
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const prevIdRef = useRef(id);
  const [fadingOut, setFadingOut] = useState(null);

  const radius = Math.round(width * (20 / 214));
  const shadowW = width * 1.15;
  const shadowH = shadowW * 0.13;
  // Live — no debounce; each keystroke engraves immediately
  const text = (name || "").trim().toUpperCase();
  const engrave = ENGRAVE_STYLES[id] || ENGRAVE_STYLES.white;
  const fontSize = engraveFontSize(text.length);
  const atmosphere = COLOR_ATMOSPHERE[id] || COLOR_ATMOSPHERE.white;

  // Soft crossfade when colorway / founder card swaps
  useEffect(() => {
    if (prevIdRef.current === id) return;
    setFadingOut(prevIdRef.current);
    prevIdRef.current = id;
    const t = window.setTimeout(() => setFadingOut(null), 480);
    return () => window.clearTimeout(t);
  }, [id]);

  useEffect(() => {
    if (reducedMotion) return undefined;
    let alive = true;
    const tick = () => {
      if (!alive) return;
      const c = currentRef.current;
      const t = targetRef.current;
      c.x += (t.x - c.x) * 0.12;
      c.y += (t.y - c.y) * 0.12;
      if (Math.abs(c.x - t.x) > 0.01 || Math.abs(c.y - t.y) > 0.01) {
        setTilt({ x: c.x, y: c.y });
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      alive = false;
      cancelAnimationFrame(rafRef.current);
    };
  }, [reducedMotion]);

  const onMove = (e) => {
    if (reducedMotion || celebrate) return;
    const el = stageRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width;
    const py = (e.clientY - r.top) / r.height;
    targetRef.current = {
      x: (0.5 - py) * 14,
      y: (px - 0.5) * 18,
    };
  };

  const onLeave = () => {
    targetRef.current = { x: 0, y: 0 };
  };

  const rx = reducedMotion ? 0 : tilt.x;
  const ry = reducedMotion ? 0 : tilt.y;
  const sheenX = 50 + ry * 2.2;
  const sheenY = 40 - rx * 2.2;

  return (
    <div
      ref={stageRef}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      style={{
        position: "relative",
        width,
        flexShrink: 0,
        margin: "0 auto",
        perspective: 900,
        touchAction: "pan-y",
      }}
    >
      {/* Colorway atmosphere bloom */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          left: "50%",
          top: "46%",
          width: width * 1.55,
          height: width * 1.55,
          transform: "translate(-50%, -50%)",
          background: `radial-gradient(circle, ${atmosphere} 0%, transparent 68%)`,
          filter: "blur(2px)",
          opacity: celebrate ? 0.95 : 0.75,
          transition: "background 0.55s ease, opacity 0.5s ease",
          pointerEvents: "none",
          zIndex: 0,
        }}
      />

      {/* Success ring pulse */}
      {celebrate && !reducedMotion && (
        <div
          aria-hidden
          className="claim-success-ring"
          style={{
            position: "absolute",
            left: "50%",
            top: "48%",
            width: width * 1.2,
            height: width * 1.2,
            marginLeft: -(width * 1.2) / 2,
            marginTop: -(width * 1.2) / 2,
            borderRadius: "50%",
            border: "1px solid rgba(0,113,227,0.35)",
            pointerEvents: "none",
            zIndex: 0,
          }}
        />
      )}

      <div
        style={{
          position: "relative",
          zIndex: 1,
          transformStyle: "preserve-3d",
          transform: celebrate && !reducedMotion
            ? "translateY(-10px) scale(1.04) rotateX(0deg) rotateY(0deg)"
            : `rotateX(${rx}deg) rotateY(${ry}deg) translateZ(0)`,
          transition: celebrate
            ? "transform 0.7s cubic-bezier(0.22, 1, 0.36, 1)"
            : "box-shadow 0.3s ease",
          willChange: "transform",
        }}
      >
        <div style={{ position: "relative", borderRadius: radius, overflow: "hidden", transform: "translateZ(12px)" }}>
          <img
            src={images[id]}
            alt={`${id} card`}
            style={{ width: "100%", height: "auto", display: "block", position: "relative", zIndex: 1 }}
          />
          {fadingOut && images[fadingOut] && (
            <img
              src={images[fadingOut]}
              alt=""
              aria-hidden
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                objectFit: "cover",
                zIndex: 2,
                animation: reducedMotion ? "none" : "claimCardFadeOut 0.48s ease forwards",
                pointerEvents: "none",
              }}
            />
          )}

          {/* Specular sheen that tracks the tilt */}
          {!reducedMotion && (
            <div
              aria-hidden
              style={{
                position: "absolute",
                inset: 0,
                zIndex: 3,
                borderRadius: radius,
                background: `radial-gradient(circle at ${sheenX}% ${sheenY}%, rgba(255,255,255,0.34) 0%, rgba(255,255,255,0.08) 28%, transparent 55%)`,
                mixBlendMode: "soft-light",
                pointerEvents: "none",
                opacity: celebrate ? 0.55 : 0.85,
                transition: "opacity 0.4s ease",
              }}
            />
          )}

          <div style={{ position: "absolute", inset: 0, borderRadius: radius, boxShadow: CARD_SHADOW, pointerEvents: "none", zIndex: 4 }} />
          <div style={{ position: "absolute", inset: 0, borderRadius: radius, border: CARD_BORDER, boxShadow: CARD_DROP, pointerEvents: "none", zIndex: 4 }} />

          {/* Engraved name — each keystroke pops onto the card live */}
          {text ? (
            <div
              aria-hidden
              style={{
                position: "absolute",
                bottom: "11%",
                left: "10%",
                right: "10%",
                display: "flex",
                justifyContent: "center",
                alignItems: "flex-end",
                flexWrap: "wrap",
                pointerEvents: "none",
                zIndex: 5,
                fontFamily: "'SF Pro Display', 'Inter', -apple-system, sans-serif",
                fontSize,
                fontWeight: 590,
                letterSpacing: "0.14em",
                lineHeight: 1.15,
                textAlign: "center",
                wordBreak: "break-word",
                maxWidth: "100%",
                ...engrave,
              }}
            >
              {Array.from(text).map((ch, i) => (
                <span
                  key={`${i}-${ch}`}
                  className={reducedMotion ? undefined : "claim-engrave-char"}
                  style={{ display: "inline-block" }}
                >
                  {ch === " " ? "\u00A0" : ch}
                </span>
              ))}
            </div>
          ) : (
            <div
              aria-hidden
              style={{
                position: "absolute",
                bottom: "12%",
                left: 0,
                right: 0,
                textAlign: "center",
                fontSize: 10,
                letterSpacing: "0.12em",
                color: "rgba(0,0,0,0.28)",
                zIndex: 5,
                pointerEvents: "none",
                fontWeight: 500,
              }}
            >
              TYPE TO ENGRAVE
            </div>
          )}
        </div>
      </div>

      <div style={{
        position: "absolute",
        left: "50%",
        bottom: -shadowH * 0.45,
        transform: `translateX(-50%) scaleX(${1 + Math.abs(ry) * 0.01})`,
        width: shadowW,
        height: shadowH,
        background: "radial-gradient(ellipse at center, rgba(0,0,0,0.32) 0%, rgba(0,0,0,0) 72%)",
        filter: "blur(4px)",
        pointerEvents: "none",
        zIndex: 0,
        opacity: celebrate ? 0.55 : 0.9,
        transition: "opacity 0.5s ease",
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

export default function FschoolAILanding({ onBack } = {}) {
  const [dark, setDark] = useState(false);
  const t = dark ? DARK : LIGHT;

  const [activeColor, setActiveColor] = useState(() => {
    const d = loadClaimDraft();
    return typeof d?.activeColor === "number" && d.activeColor >= 0 && d.activeColor < COLORWAYS.length
      ? d.activeColor
      : 0;
  });
  const [delivery, setDelivery] = useState(() => (loadClaimDraft()?.delivery === "founder" ? "founder" : "standard"));
  const [form, setForm] = useState(() => {
    const d = loadClaimDraft();
    return {
      name: d?.form?.name || "",
      school: d?.form?.school || "",
      email: d?.form?.email || "",
    };
  });
  const [submitted, setSubmitted] = useState(() => Boolean(loadClaimDraft()?.submitted));
  const [touched, setTouched] = useState({});
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState("");
  const [honeypot, setHoneypot] = useState("");
  const nameInputRef = useRef(null);
  const countdown = useCountdown("2026-06-30T23:59:59");
  const cw = COLORWAYS[activeColor];
  const pad = n => String(n).padStart(2,"0");

  const nameOk = form.name.trim().length >= 2;
  const schoolOk = form.school.trim().length >= 2;
  const emailOk = isValidEmail(form.email);
  const formValid = nameOk && schoolOk && emailOk;
  const firstName = form.name.trim().split(/\s+/)[0] || "there";

  const goToOrder = () => {
    document.getElementById("order")?.scrollIntoView({ behavior: "smooth", block: "start" });
    window.setTimeout(() => {
      nameInputRef.current?.focus({ preventScroll: true });
    }, 520);
  };

  const selectColor = (i) => {
    setActiveColor(i);
  };

  const handleApply = async () => {
    setTouched({ name: true, school: true, email: true });
    if (!formValid || applying) return;
    setApplyError("");
    setApplying(true);
    try {
      const colorway = delivery === "founder" ? "black" : (COLORWAYS[activeColor]?.id || "white");
      const res = await fetch("/api/founding-card?action=apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          school: form.school.trim(),
          email: form.email.trim(),
          colorway,
          delivery,
          source: "card",
          website: honeypot,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setApplyError(data.error || "Couldn't submit — try again in a moment.");
        return;
      }
      setSubmitted(true);
    } catch (e) {
      console.error("[founding-card] apply error:", e);
      setApplyError("Couldn't reach the server — check your connection and try again.");
    } finally {
      setApplying(false);
    }
  };

  const resetClaimDraft = () => {
    try {
      localStorage.removeItem(CLAIM_DRAFT_KEY);
      localStorage.removeItem("fschoolai-founding-card-draft-v1");
    } catch { /* ignore */ }
    setForm({ name: "", school: "", email: "" });
    setSubmitted(false);
    setTouched({});
    setDelivery("standard");
    setApplyError("");
    setHoneypot("");
  };

  // Drop stale v1 drafts (clears stuck “already applied” state from earlier sessions)
  useEffect(() => {
    try { localStorage.removeItem("fschoolai-founding-card-draft-v1"); } catch { /* ignore */ }
  }, []);

  // Persist draft so refresh / accidental back doesn't wipe the claim flow
  useEffect(() => {
    try {
      localStorage.setItem(CLAIM_DRAFT_KEY, JSON.stringify({
        form, activeColor, delivery, submitted,
      }));
    } catch { /* ignore quota / private mode */ }
  }, [form, activeColor, delivery, submitted]);

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
      <nav style={{ position:"fixed", top:0, left:0, right:0, zIndex:100, display:"flex", alignItems:"center", justifyContent:"space-between", padding:"0 20px", height:52, background: dark ? "rgba(8,8,10,0.55)" : "rgba(255,255,255,0.52)", backdropFilter:"blur(28px) saturate(1.7)", WebkitBackdropFilter:"blur(28px) saturate(1.7)", borderBottom:`1px solid ${dark ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.55)"}`, boxShadow: dark ? "none" : "0 1px 0 rgba(255,255,255,0.4) inset", transition:"background 0.3s ease" }}>
        <button onClick={() => (onBack ? onBack() : (window.location.href = "/"))} style={{ background:"none", border:"none", color:t.textMuted, fontSize:14, cursor:"pointer" }}>‹ FschoolAI</button>
        <span style={{ fontSize:14, fontWeight:500, color:t.text }}>Founding Card</span>
        <div style={{ display:"flex", gap:10, alignItems:"center" }}>
          <span ref={themeToggleRef} style={{ display:"inline-flex" }}>
            <ThemeToggle dark={dark} onToggle={() => setDark(d => !d)} t={t} />
          </span>
          <button onClick={goToOrder} style={{ background:dark?"#fff":"#000", color:dark?"#000":"#fff", border:"none", borderRadius:20, padding:"6px 16px", fontSize:13, fontWeight:600, cursor:"pointer" }}>Apply</button>
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

      <section className="hero-section" style={{ minHeight:"100svh", height:"100svh", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"flex-start", position:"relative", overflow:"hidden" }}>
        {/* Animation background — desktop only. Pushed down via `top` (not inset:0) so its
            own vertical centering point sits below the text block instead of behind it —
            the scale itself is viewport-based (unaffected by this box), only the center shifts. */}
        <div className="hero-countdown-desktop" style={{ position:"absolute", top:360, left:0, right:0, bottom:0 }}>
          <CardHeroAnimation dark={dark} scale={0.64} />
        </div>

        {/* Text */}
        <div style={{ position:"relative", zIndex:20, textAlign:"center", padding:"80px 20px 0", width:"100%" }}>
          <p style={{ fontSize:12, fontWeight:600, letterSpacing:"0.2em", color:t.textFaint, marginBottom:16, textTransform:"uppercase", opacity:0, animation:"heroFadeIn 1s ease 2s both" }}>Founding Edition · Only 500</p>
          <h1 style={{ fontSize:"clamp(32px,5vw,64px)", fontWeight:700, lineHeight:1.05, margin:"0 0 16px", letterSpacing:"-0.02em", color:t.text, opacity:0, animation:"heroFadeIn 1s ease 2.3s both" }}>FschoolAI<br />Founding Card</h1>
          <p style={{ fontSize:17, color:t.textMuted, opacity:0, animation:"heroFadeIn 1s ease 2.6s both" }}>Free for founding members. Ships Q4 2026.</p>
          {/* Primary funnel CTA — jumps straight to the configurator/apply form */}
          <div style={{ marginTop:28, opacity:0, animation:"heroFadeIn 1s ease 2.9s both" }}>
            <button
              onClick={goToOrder}
              style={{ background:"#0071e3", color:"#fff", border:"none", borderRadius:980, padding:"14px 32px", fontSize:16, fontWeight:600, cursor:"pointer", fontFamily:"inherit", boxShadow:"0 4px 16px rgba(0,113,227,0.24)" }}
            >
              Claim your card
            </button>
            <p style={{ fontSize:13, color:t.textFaint, marginTop:10 }}>Free · takes under a minute</p>
          </div>
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

      {/* PERSONALIZE — the full colorway/delivery/apply flow, promoted to directly after
          the hero: visitors arriving from the landing CTA reach the form in one scroll
          (or instantly via the hero button). Showcase sections now live below this. */}
      <style>{`
        @keyframes shineMove { 0%{background-position:0% 0%;} 50%{background-position:100% 100%;} 100%{background-position:0% 0%;} }
        .trust-inner { width:660px; }
        @media(max-width:767px){
          .trust-outer { height:86px; overflow:hidden; }
          .trust-inner { width:660px; transform:scale(0.55); transform-origin:top center; margin:0 auto; }
          .claim-sticky-preview {
            display:flex !important;
            position:sticky; top:52px; z-index:45;
            align-items:center; gap:12px;
            margin:0 0 16px;
            padding:10px 14px;
            border-radius:18px;
            background: rgba(255,255,255,0.72);
            border: 1px solid rgba(255,255,255,0.55);
            box-shadow: 0 1px 0 rgba(255,255,255,0.65) inset, 0 8px 24px rgba(0,0,0,0.08);
            backdrop-filter: blur(24px) saturate(1.6);
            -webkit-backdrop-filter: blur(24px) saturate(1.6);
          }
        }
        /* Atmosphere behind glass — blur needs something colorful to sample */
        .mkyours-section {
          position: relative;
          overflow: hidden;
        }
        .mkyours-section::before {
          content: "";
          position: absolute;
          inset: -10% -5%;
          pointer-events: none;
          z-index: 0;
          background:
            radial-gradient(42% 48% at 12% 22%, rgba(255,170,180,0.55) 0%, transparent 60%),
            radial-gradient(40% 44% at 88% 18%, rgba(150,195,255,0.5) 0%, transparent 58%),
            radial-gradient(46% 50% at 78% 82%, rgba(170,230,185,0.48) 0%, transparent 62%),
            radial-gradient(38% 42% at 18% 78%, rgba(210,170,255,0.4) 0%, transparent 58%),
            radial-gradient(70% 60% at 50% 50%, rgba(255,255,255,0.35) 0%, transparent 70%);
          filter: blur(8px);
        }
        .mkyours-section > * { position: relative; z-index: 1; }
        @media(min-width:768px){
          .claim-sticky-preview { display:none !important; }
        }
        .mkyours-grid { display:flex; flex-direction:column; gap:16px; }
        .claim-col { display:flex; flex-direction:column; gap:16px; }
        .mkyours-panel { background:none; padding:0; border-radius:0; }
        /*
          Liquid Glass (rshankras skill → web):
          - ONE Regular glass shell (navigation/chrome layer)
          - Never glass-on-glass: content cards use solid fills
          - Tint only the primary Apply action
          - GlassEffectContainer ≈ isolation:isolate
        */
        @media(min-width:768px){
          .mkyours-panel {
            position: relative;
            isolation: isolate;
            border-radius: 40px;
            padding: 40px;
            background:
              linear-gradient(145deg, rgba(255,255,255,0.52) 0%, rgba(255,255,255,0.18) 42%, rgba(255,255,255,0.28) 100%);
            border: 1px solid rgba(255,255,255,0.55);
            box-shadow:
              0 1px 0 rgba(255,255,255,0.75) inset,
              0 -0.5px 0 rgba(0,0,0,0.06) inset,
              0 28px 56px -24px rgba(0,0,0,0.3),
              0 10px 24px -12px rgba(0,0,0,0.14);
            backdrop-filter: blur(30px) saturate(180%);
            -webkit-backdrop-filter: blur(30px) saturate(180%);
          }
          .mkyours-panel::after {
            content: "";
            position: absolute; inset: 0; pointer-events: none; border-radius: inherit;
            padding: 1px;
            background: linear-gradient(135deg, rgba(255,255,255,0.85), rgba(255,255,255,0.15) 40%, transparent 60%, rgba(255,255,255,0.35));
            -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
            mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
            -webkit-mask-composite: xor;
            mask-composite: exclude;
          }
          .mkyours-panel-founder {
            background: linear-gradient(145deg, rgba(40,40,48,0.55) 0%, rgba(12,12,16,0.42) 100%) !important;
            border-color: rgba(255,255,255,0.14);
          }
          .whats-inside-dark { background:#0a0a0a !important; }
          .mkyours-grid {
            display:grid;
            grid-template-columns:1.1fr 1fr;
            gap:28px;
            align-items:start;
          }
          .claim-col {
            display:flex;
            flex-direction:column;
            gap:16px;
          }
        }
        /* Content ON glass = solid fills (skill: never glass on glass) */
        .claim-card {
          position: relative;
          background: #fff;
          border-radius: 20px;
          border: 1px solid rgba(0,0,0,0.06);
          box-shadow: 0 1px 3px rgba(0,0,0,0.06);
        }
        .mkyours-panel-founder .claim-card {
          background: #fff;
          border-color: rgba(0,0,0,0.08);
        }
        /* Delivery chips: fills on glass, not second glass layers */
        .claim-delivery-opt {
          transition: transform 0.22s cubic-bezier(0.22, 1, 0.36, 1), border-color 0.2s ease, box-shadow 0.2s ease;
        }
        .claim-delivery-opt:hover { transform: scale(1.015); }
        .claim-delivery-opt:active { transform: scale(0.985); }
        .claim-field:focus {
          border-color:#0071e3 !important;
          box-shadow:0 0 0 3px rgba(0,113,227,0.15);
        }
        @keyframes claimCardFadeOut {
          from { opacity: 1; }
          to { opacity: 0; }
        }
        @keyframes claimEngraveChar {
          0% { opacity: 0; transform: translateY(5px) scale(0.82); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes claimSuccessRing {
          0% { transform: scale(0.72); opacity: 0.55; }
          100% { transform: scale(1.28); opacity: 0; }
        }
        .claim-engrave-char {
          animation: claimEngraveChar 0.16s cubic-bezier(0.34, 1.45, 0.64, 1) both;
        }
        .claim-success-ring { animation: claimSuccessRing 1.1s cubic-bezier(0.22, 1, 0.36, 1) both; }
        @media (prefers-reduced-motion: reduce) {
          .claim-engrave-char, .claim-success-ring { animation: none !important; }
        }
        @media (prefers-reduced-transparency: reduce) {
          .mkyours-section::before { display: none; }
          .mkyours-panel {
            backdrop-filter: none !important;
            -webkit-backdrop-filter: none !important;
            background: #e8e8e8 !important;
          }
          .claim-card { background: #fff !important; }
        }
      `}</style>
      <section id="order" className="mkyours-section" style={{ padding:`100px ${sideInset}px`, textAlign:"center", background: dark ? "#0c0c10" : "#eceef4", transition:"background 0.3s ease", scrollMarginTop:64 }}>
        <Reveal>
          <Label>Personalize</Label>
          <h2 style={{ fontSize:"clamp(38px,6vw,64px)", fontWeight:700, letterSpacing:"-0.02em", marginBottom:12 }}>Make it yours.</h2>
          <p style={{ color:t.textMuted, fontSize:17, marginBottom:12 }}>Laser-engraved on the back. Free. Delivers just as fast.</p>
          <p style={{ fontSize:13, fontWeight:600, letterSpacing:"0.08em", color:t.textFaint, textTransform:"uppercase", marginBottom:36 }}>
            Applications close June 30 · {countdown.d}d {pad(countdown.h)}h {pad(countdown.m)}m left · only 500 cards
          </p>
        </Reveal>

        <div style={{ margin:"0 auto", textAlign:"left" }}>
          {!submitted && (
            <div className="claim-sticky-preview" style={{ display:"none" }}>
              <div style={{ width:44, height:62, borderRadius:8, overflow:"hidden", flexShrink:0, boxShadow:"0 2px 8px rgba(0,0,0,0.12)" }}>
                <img
                  src={CARD_IMAGES_LIGHT[delivery === "founder" ? "black" : cw.id]}
                  alt=""
                  style={{ width:"100%", height:"100%", objectFit:"cover", display:"block" }}
                />
              </div>
              <div style={{ flex:1, minWidth:0 }}>
                <p style={{ fontSize:14, fontWeight:600, color:t.formText, margin:0, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
                  {form.name.trim() || "Your name engraved here"}
                </p>
                <p style={{ fontSize:12, color:t.formTextMuted, margin:"2px 0 0" }}>
                  {delivery === "founder" ? "Titanium Black" : cw.name} · {delivery === "founder" ? "$3,000" : "Free"}
                </p>
              </div>
              <span style={{ width:10, height:10, borderRadius:"50%", background: delivery === "founder" ? "#111" : cw.dot, border:`1px solid ${t.formBorder}`, flexShrink:0 }} />
            </div>
          )}

          <div className={`mkyours-panel${delivery==="founder" ? " mkyours-panel-founder" : ""}`}>
            <div className="mkyours-grid" style={{ position:"relative", zIndex:1 }}>

              {/* LEFT column */}
              <div className="claim-col">
                <div className="claim-card" style={{ padding:"clamp(20px,5vw,28px) clamp(14px,4vw,20px) clamp(36px,8vw,48px)" }}>
                  <p style={{ fontSize:13, color:t.formTextMuted, marginBottom:4 }}>FschoolAI</p>
                  <h3 style={{ fontSize:"clamp(24px,7vw,36px)", fontWeight:700, letterSpacing:"-0.02em", marginBottom:4, color:t.formText }}>{delivery==="founder" ? "Exclusive Card" : "Founding Card"}</h3>
                  <p style={{ fontSize:14, color:t.formTextMuted, marginBottom:8 }}>{delivery==="founder" ? "Exclusive Edition · Only 5" : "Founding Edition · Only 500"}</p>
                  <p style={{ fontSize:12, color:t.formTextMuted, marginBottom:8, textAlign:"center" }}>
                    {submitted ? "Locked in · yours to claim" : "Move over the card · type to engrave"}
                  </p>
                  <EngravedCardPreview
                    id={delivery==="founder" ? "black" : cw.id}
                    width={240}
                    images={CARD_IMAGES_LIGHT}
                    name={form.name}
                    celebrate={submitted}
                  />
                </div>

                <div className="claim-card" style={{ padding:"clamp(16px,5vw,24px)" }}>
                  <p style={{ fontSize:12, color:t.formTextMuted, marginBottom:4 }}>Colorway</p>
                  <p style={{ fontSize:"clamp(15px,4vw,17px)", fontWeight:600, color:t.formText, marginBottom:16 }}>{delivery==="founder" ? "Titanium Black — Exclusive. Unmistakable." : `${cw.name} — ${cw.tag}`}</p>
                  <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
                    {delivery==="founder" ? (
                      <button type="button" style={{ width:32, height:32, borderRadius:"50%", background:"#111", border:"3px solid #0071e3", cursor:"default", outline:"1px solid rgba(0,0,0,0.1)" }} />
                    ) : (
                      COLORWAYS.map((c,i) => (
                        <button
                          key={c.id}
                          type="button"
                          aria-label={c.name}
                          aria-pressed={i === activeColor}
                          onClick={() => selectColor(i)}
                          style={{ width:32, height:32, borderRadius:"50%", background:c.dot, border: i===activeColor ? "3px solid #0071e3" : "2px solid transparent", cursor:"pointer", outline:"1px solid rgba(0,0,0,0.1)", transition:"transform 0.2s ease, border-color 0.2s ease", transform: i===activeColor ? "scale(1.08)" : "scale(1)" }}
                        />
                      ))
                    )}
                  </div>
                  {delivery !== "founder" && (
                    <button
                      type="button"
                      onClick={() => document.getElementById("colorway")?.scrollIntoView({ behavior:"smooth", block:"center" })}
                      style={{ marginTop:14, background:"none", border:"none", padding:0, color:"#0071e3", fontSize:13, fontWeight:600, cursor:"pointer", fontFamily:"inherit" }}
                    >
                      Preview all colors ↓
                    </button>
                  )}
                </div>
              </div>

              {/* RIGHT column */}
              <div className="claim-col">
                <div className="claim-card" style={{ padding:"clamp(16px,5vw,24px)" }}>
                  <h3 style={{ fontSize:"clamp(17px,4.5vw,20px)", fontWeight:700, color:t.formText, marginBottom:16 }}>Delivery</h3>
                  {[{ v:"standard", label:"Standard", sub:"Ships Q4 2026 · Your chosen colorway", badge:"Free" }, { v:"founder", label:"Founder Delivery", sub:"Titanium Black · #0001–#0005 · White-glove · 1-on-1 with Vincent · Lifetime Pro", badge:"$3,000", exclusive:true }].map((opt, optIdx, arr) => (
                    <button
                      key={opt.v}
                      type="button"
                      className="claim-delivery-opt"
                      onClick={() => setDelivery(opt.v)}
                      style={{
                        display:"block", width:"100%",
                        background: delivery===opt.v ? "rgba(0,113,227,0.08)" : "rgba(245,245,247,0.95)",
                        boxShadow: delivery===opt.v ? "0 0 0 1px rgba(0,113,227,0.2)" : "none",
                        border: delivery===opt.v ? "2px solid #0071e3" : `1px solid ${t.formBorder}`,
                        borderRadius:14, padding:"clamp(12px,4vw,16px) clamp(12px,4vw,18px)", cursor:"pointer", textAlign:"left", marginBottom: optIdx < arr.length - 1 ? 10 : 0, color:t.formText
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

                <div className="claim-card" style={{ padding:"clamp(16px,5vw,24px)" }}>
                  <p style={{ fontSize:13, color:t.formTextMuted, marginBottom:4 }}>FschoolAI Founding Card</p>
                  <p style={{ fontSize:"clamp(26px,7vw,32px)", fontWeight:700, color:t.formText, marginBottom:4 }}>{delivery==="founder" ? "$3,000" : "Free"}</p>
                  <p style={{ fontSize:13, color:t.formTextMuted, marginBottom:24 }}>No credit card required · Ships Q4 2026</p>
                  {!submitted ? (
                    <>
                      {[
                        { key:"name", placeholder:"Full name", type:"text", ok: nameOk, hint:"Enter your full name (as you want it engraved)" },
                        { key:"school", placeholder:"University or school", type:"text", ok: schoolOk, hint:"Add your school or university" },
                        { key:"email", placeholder:"Email address", type:"email", ok: emailOk, hint:"Enter a valid email so we can reach you" },
                      ].map(f => {
                        const showError = touched[f.key] && !f.ok;
                        return (
                          <div key={f.key} style={{ marginBottom:12 }}>
                            <input
                              ref={f.key === "name" ? nameInputRef : undefined}
                              className="claim-field"
                              type={f.type}
                              placeholder={f.placeholder}
                              value={form[f.key]}
                              autoComplete={f.key === "email" ? "email" : f.key === "name" ? "name" : "organization"}
                              onChange={e => setForm({ ...form, [f.key]: e.target.value })}
                              onBlur={() => setTouched(prev => ({ ...prev, [f.key]: true }))}
                              style={{
                                display:"block", width:"100%",
                                border:`1px solid ${showError ? "#e35d6a" : t.formBorder}`,
                                borderRadius:12, padding:"14px 16px", fontSize:15,
                                outline:"none", color:t.formText, boxSizing:"border-box",
                                fontFamily:"inherit", background:t.formSection,
                                transition:"border-color 0.2s ease, box-shadow 0.2s ease",
                              }}
                            />
                            {showError && (
                              <p style={{ fontSize:12, color:"#e35d6a", margin:"6px 2px 0" }}>{f.hint}</p>
                            )}
                          </div>
                        );
                      })}
                      {/* Honeypot — hidden from humans; bots fill it and get a fake success */}
                      <input
                        type="text"
                        name="website"
                        tabIndex={-1}
                        autoComplete="off"
                        value={honeypot}
                        onChange={e => setHoneypot(e.target.value)}
                        aria-hidden="true"
                        style={{ position:"absolute", left:-9999, width:1, height:1, opacity:0 }}
                      />
                      {applyError && (
                        <p style={{ fontSize:13, color:"#e35d6a", margin:"0 0 12px", textAlign:"center" }}>{applyError}</p>
                      )}
                      <button
                        type="button"
                        onClick={handleApply}
                        disabled={!formValid || applying}
                        style={{
                          display:"block", width:"100%",
                          background: formValid && !applying ? "#0071e3" : "rgba(0,0,0,0.08)",
                          color: formValid && !applying ? "#fff" : "rgba(0,0,0,0.35)",
                          border:"none", borderRadius:50,
                          padding:"16px clamp(20px,6vw,36px)", fontSize:16, fontWeight:600,
                          letterSpacing:"0.01em", marginBottom:12, fontFamily:"inherit",
                          cursor: formValid && !applying ? "pointer" : "not-allowed",
                          boxShadow: formValid && !applying ? "0 4px 16px rgba(0,113,227,0.24)" : "none",
                          transition:"background 0.2s ease, color 0.2s ease, box-shadow 0.2s ease",
                        }}
                      >
                        {applying ? "Submitting…" : formValid ? "Apply for my card →" : "Fill in your details"}
                      </button>
                      <p style={{ textAlign:"center", fontSize:13, color:t.formTextMuted }}>
                        {formValid ? "Ready — no credit card required · Ships Q4 2026" : "Fill the three fields above to apply · Free"}
                      </p>
                    </>
                  ) : (
                    <div style={{ textAlign:"center", padding:"28px 8px 8px", animation:"claimEngraveIn 0.7s cubic-bezier(0.22, 1, 0.36, 1) both" }}>
                      <div style={{
                        width:52, height:52, borderRadius:"50%", margin:"0 auto 16px",
                        background:"#0071e3", color:"#fff",
                        display:"flex", alignItems:"center", justifyContent:"center",
                        fontSize:22, fontWeight:700, boxShadow:"0 8px 24px rgba(0,113,227,0.28)",
                      }}>✓</div>
                      <h3 style={{ fontSize:22, fontWeight:700, color:t.formText, marginBottom:8 }}>
                        You're on the list, {firstName}
                      </h3>
                      <p style={{ color:t.formTextMuted, fontSize:15, lineHeight:1.55, marginBottom:8 }}>
                        We'll email <span style={{ color:t.formText, fontWeight:500 }}>{form.email.trim()}</span> when your{" "}
                        {delivery === "founder" ? "Titanium Black" : cw.name} Founding Card is ready to ship.
                      </p>
                      <p style={{ fontSize:13, color:t.formTextMuted, marginBottom:20 }}>
                        Next: watch your inbox · ships Q4 2026 · applications close June 30
                      </p>
                      <div style={{ display:"flex", flexWrap:"wrap", gap:10, justifyContent:"center" }}>
                        <button
                          type="button"
                          onClick={() => document.getElementById("whats-inside")?.scrollIntoView({ behavior:"smooth", block:"start" })}
                          style={{
                            background:"#0071e3", color:"#fff", border:"none", borderRadius:980,
                            padding:"10px 22px", fontSize:13, fontWeight:600, cursor:"pointer",
                            fontFamily:"inherit", boxShadow:"0 4px 14px rgba(0,113,227,0.22)",
                          }}
                        >
                          Explore your card →
                        </button>
                        <button
                          type="button"
                          onClick={resetClaimDraft}
                          style={{
                            background:"none", border:`1px solid ${t.formBorder}`, borderRadius:980,
                            padding:"10px 18px", fontSize:13, fontWeight:600, cursor:"pointer",
                            color:t.formText, fontFamily:"inherit",
                          }}
                        >
                          Edit application
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>

            </div>
          </div>
        </div>
      </section>

      {/* COLORWAY SELECTOR */}
      <section id="colorway" style={{ padding:"100px 20px 120px", textAlign:"center", minHeight:"115vh", scrollMarginTop:64 }}>
        <Reveal>
          <Label>Colorway</Label>
          <h2 style={{ fontSize:"clamp(32px,5vw,52px)", fontWeight:700, letterSpacing:"-0.02em", marginBottom:8, transition:"all 0.3s ease", color:t.text }}>{cw.name}</h2>
          <p style={{ color:t.textMuted, fontSize:16, marginBottom:52 }}>{cw.tag}</p>
        </Reveal>

        <ColorwayDial
          colorways={COLORWAYS}
          activeColor={activeColor}
          onSelect={setActiveColor}
          images={CARD_IMAGES_LIGHT}
          cardWidth={148}
        />
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
            <button onClick={() => { setDelivery("founder"); goToOrder(); }} style={{ background:dark?"#fff":"#000", color:dark?"#000":"#fff", border:"none", borderRadius:50, padding:"16px 36px", fontSize:15, fontWeight:600, cursor:"pointer" }}>Apply for Founder Delivery</button>
          </Reveal>
          <Reveal delay={0.2} style={{ display:"flex", justifyContent:"center" }}>
            {/* TODO: replacement image goes here */}
          </Reveal>
        </div>
      </section>

      {/* WHAT'S INSIDE */}
      <section id="whats-inside" style={{ background:t.formBg, color:t.formText, padding:"80px 20px 40px", transition:"background 0.3s ease", scrollMarginTop:64 }}>
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

      {/* TAP TO LAUNCH */}
      <section style={{ padding:"100px 20px 120px", textAlign:"center" }}>
        <Reveal>
          <Label>How It Works</Label>
        </Reveal>
        <Reveal delay={0.1}>
          <NFCTapAnimation t={t} />
        </Reveal>
      </section>

      {/* ORDER FORM — remaining info blocks (product info) */}
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
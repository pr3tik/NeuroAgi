// src/pages/Landing.tsx — FschoolAI app landing page.
// Design system: Apple.com iOS exact — css vars from apple.com/iphone applied verbatim.
// --sk-body-text-color: rgb(29,29,31)  --sk-fill: #fff  --sk-fill-secondary: #fafafc
// --sk-fill-tertiary: #f5f5f7  --sk-glyph-gray-secondary: rgb(110,110,115)

import React, { useState, useEffect, useRef } from "react";

// ── naroai.co + Apple hybrid design tokens ────────────────────────────────────
// naroai reference: --foreground: 0 0% 8% = #141414, --muted-foreground: 0 0% 45% = #737373
// --secondary: 0 0% 96% = #f5f5f5, --border: 0 0% 90% = #e6e6e6
// --shadow-soft: 0 4px 24px -4px rgba(0,0,0,.08), --shadow-elevated: 0 20px 50px -12px rgba(0,0,0,.15)
// --gradient-hero: linear-gradient(180deg,#fff 0%,#f7f7f7 100%)
const DARK = {
  bg: "#000", bg2: "#080808",
  text: "#fff", textMuted: "rgba(255,255,255,0.45)", textFaint: "rgba(255,255,255,0.3)",
  border: "rgba(255,255,255,0.06)", navBg: "rgba(0,0,0,0.72)", label: "#737373",
  cardBg: "#1a1a1a", cardBorder: "#2a2a2a", cardInner: "#1e1e1e", cardInnerBorder: "#2e2e2e",
  userBubble: "#2a2a2a",
};
const LIGHT = {
  bg:              "#ffffff",        // --background: 0 0% 100%
  bg2:             "#f5f5f5",        // --secondary: 0 0% 96%
  bgSoft:          "#fafafa",        // --muted: 0 0% 98%
  text:            "#141414",        // --foreground: 0 0% 8%
  textMuted:       "#737373",        // --muted-foreground: 0 0% 45%
  textFaint:       "#a3a3a3",        // 0 0% 64%
  border:          "#e6e6e6",        // --border: 0 0% 90%
  borderStrong:    "#d4d4d4",        // 0 0% 83%
  navBg:           "rgba(255,255,255,0.82)",
  label:           "#737373",        // --muted-foreground
  cardBg:          "#ffffff",
  cardBorder:      "#e6e6e6",        // --border: 0 0% 90%
  cardInner:       "#f5f5f5",        // --secondary
  cardInnerBorder: "#e6e6e6",
  userBubble:      "#f5f5f5",        // --secondary
};
// Apple.com exact font stack — SF Pro Display first, then system fallbacks
const FONT = '-apple-system,BlinkMacSystemFont,"SF Pro Display","SF Pro Text","Helvetica Neue",Arial,sans-serif';

// ── Hooks ──────────────────────────────────────────────────────────────────────
function useInView(threshold = 0.15) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) setVisible(true); }, { threshold });
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, [threshold]);
  return [ref, visible] as const;
}

// ── Count-up — triggers once on scroll-in, ease-out-expo ──────────────────────
function useCountUp(target: number, duration = 1400) {
  const [ref, inView] = useInView(0.3);
  const [count, setCount] = useState(0);
  const startedRef = useRef(false);
  useEffect(() => {
    if (!inView || startedRef.current) return;
    startedRef.current = true;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min((now - start) / duration, 1);
      const eased = p === 1 ? 1 : 1 - Math.pow(2, -10 * p);
      setCount(Math.round(eased * target));
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [inView]);
  return [ref, count] as const;
}

// ── Reveal ─────────────────────────────────────────────────────────────────────
// ease-out-quint: fast start, settles gently — iOS-native feel vs generic ease
const EASE_OUT = "cubic-bezier(0.22, 1, 0.36, 1)";

function Reveal({ children, delay = 0, style = {} }: {
  children: React.ReactNode; delay?: number; style?: React.CSSProperties;
}) {
  const [ref, visible] = useInView();
  return (
    <div ref={ref} style={{
      opacity: visible ? 1 : 0,
      transform: visible ? "translateY(0)" : "translateY(20px)",
      transition: `opacity 0.6s ${EASE_OUT} ${delay}s, transform 0.6s ${EASE_OUT} ${delay}s`,
      ...style,
    }}>{children}</div>
  );
}

// ── Primitives ─────────────────────────────────────────────────────────────────
function Label({ children, t }: { children: React.ReactNode; t: typeof DARK }) {
  return (
    <p style={{ fontFamily: FONT, fontSize: 11, fontWeight: 600, letterSpacing: "0.16em",
      color: t.label, textTransform: "uppercase", marginBottom: 16 }}>{children}</p>
  );
}

function MockCard({ children, t, style = {} }: {
  children: React.ReactNode; t: typeof DARK; style?: React.CSSProperties;
}) {
  // naroai --shadow-soft / --shadow-elevated
  const shadow = t === LIGHT
    ? "0 4px 24px -4px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04)"
    : "0 4px 24px rgba(0,0,0,0.5), 0 1px 4px rgba(0,0,0,0.2)";
  return (
    <div style={{ background: t.cardBg, border: `1px solid ${t.cardBorder}`,
      borderRadius: 16, padding: "24px 28px", maxWidth: 380, margin: "0 auto",
      boxShadow: shadow, fontFamily: FONT, ...style }}>{children}</div>
  );
}

// ThemeToggle removed — page is light-primary (DARK tokens reserved for card section).

// ── Hero app mockup — Canvas sync + upcoming deadline + AI nudge ──────────────
// Runs on mount (hero is always in view), loops indefinitely.
function HeroMockup({ t }: { t: typeof DARK }) {
  const [phase, setPhase] = useState(0);
  const [loopKey, setLoopKey] = useState(0);

  useEffect(() => {
    const ids = [
      setTimeout(() => setPhase(1), 500),
      setTimeout(() => setPhase(2), 960),
      setTimeout(() => setPhase(3), 1420),
      setTimeout(() => setPhase(4), 2700),
      setTimeout(() => setPhase(5), 4200),
      setTimeout(() => { setPhase(0); setLoopKey(k => k + 1); }, 9200),
    ];
    return () => ids.forEach(clearTimeout);
  }, [loopKey]);

  const show = (on: boolean): React.CSSProperties => ({
    opacity: on ? 1 : 0,
    transform: on ? "translateY(0)" : "translateY(8px)",
    transition: "opacity 0.38s ease, transform 0.38s ease",
  });

  const COURSES = [
    { code: "BIOL 201", name: "Cell Biology",   due: "Quiz Friday"  },
    { code: "COMP 101", name: "Intro to CS",    due: "Lab Sunday"   },
    { code: "MATH 202", name: "Calculus II",    due: "HW Wednesday" },
  ];

  return (
    <MockCard t={t} style={{ textAlign: "left" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
        <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#34c759" }} />
        <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.12em", color: t.label }}>
          CANVAS · 3 COURSES SYNCED
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
        {COURSES.map((c, i) => (
          <div key={c.code} style={{
            ...show(phase >= i + 1),
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "8px 11px",
            background: t.cardInner, border: `1px solid ${t.cardInnerBorder}`,
            borderRadius: 9,
          }}>
            <div>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: t.text }}>{c.code}</p>
              <p style={{ margin: 0, fontSize: 11, color: t.textFaint }}>{c.name}</p>
            </div>
            <span style={{ fontSize: 11, color: t.textFaint, letterSpacing: "-0.1px" }}>{c.due}</span>
          </div>
        ))}
      </div>

      <div style={{ height: 1, background: t.border, marginBottom: 12 }} />

      {/* Upcoming deadline */}
      <div style={{
        ...show(phase >= 4),
        padding: "9px 11px", borderRadius: 9,
        background: t.cardInner, border: `1px solid ${t.cardInnerBorder}`,
        marginBottom: 8,
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#ff9500", flexShrink: 0 }} />
          <span style={{ fontSize: 12, color: t.text, fontWeight: 500 }}>BIOL 201 Quiz</span>
        </div>
        <span style={{ fontSize: 11, color: t.textFaint }}>in 2 days</span>
      </div>

      {/* AI nudge */}
      <div style={{
        ...show(phase >= 5),
        padding: "9px 11px", borderRadius: 9,
        background: t.cardInner, border: `1px solid ${t.cardInnerBorder}`,
        display: "flex", alignItems: "center", gap: 8,
      }}>
        <div style={{
          width: 16, height: 16, borderRadius: "50%", flexShrink: 0,
          background: t.border, display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: t.text }} />
        </div>
        <span style={{ fontSize: 12, color: t.textMuted, lineHeight: 1.45 }}>
          Review lac operon before Friday. Your notes are ready.
        </span>
      </div>
    </MockCard>
  );
}

// ── AI Tutor mockup — animates ONLY when scrolled into view ───────────────────
function TutorMockup({ t }: { t: typeof DARK }) {
  const [containerRef, inView] = useInView(0.3);
  const [phase, setPhase] = useState(0);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!inView || startedRef.current) return;
    startedRef.current = true;
    const ids = [
      setTimeout(() => setPhase(1), 500),
      setTimeout(() => setPhase(2), 1400),
      setTimeout(() => setPhase(3), 3000),
      setTimeout(() => setPhase(4), 6000),
      setTimeout(() => setPhase(5), 6900),
      setTimeout(() => setPhase(6), 8400),
      // loop
      setTimeout(() => { setPhase(0); startedRef.current = false; }, 13500),
    ];
    return () => ids.forEach(clearTimeout);
  }, [inView]);

  // Reset loop
  useEffect(() => {
    if (phase !== 0 || !inView) return;
    const ids = [
      setTimeout(() => setPhase(1), 500),
      setTimeout(() => setPhase(2), 1400),
      setTimeout(() => setPhase(3), 3000),
      setTimeout(() => setPhase(4), 6000),
      setTimeout(() => setPhase(5), 6900),
      setTimeout(() => setPhase(6), 8400),
      setTimeout(() => setPhase(0), 13500),
    ];
    return () => ids.forEach(clearTimeout);
  }, [phase, inView]); // eslint-disable-line

  const msg = (on: boolean) => ({
    opacity: on ? 1 : 0,
    transform: on ? "translateY(0)" : "translateY(8px)",
    transition: "opacity 0.42s ease, transform 0.42s ease",
  });

  return (
    <div ref={containerRef}>
      <MockCard t={t}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 18 }}>
          <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#34c759" }} />
          <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.12em", color: t.label }}>
            AI TUTOR · BIOL 201
          </span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10, minHeight: 170 }}>
          {/* User message */}
          <div style={{ display: "flex", justifyContent: "flex-end", ...msg(phase >= 1) }}>
            <div style={{ background: t.userBubble, borderRadius: "16px 16px 4px 16px",
              padding: "9px 14px", fontSize: 14, color: t.text, maxWidth: "78%" }}>
              Explain the lac operon from my Lecture 4 notes
            </div>
          </div>

          {/* Typing dots */}
          <div style={{ ...msg(phase >= 2 && phase < 3), display: "flex", gap: 4, paddingLeft: 2 }}>
            {[0, 0.15, 0.3].map((d, i) => (
              <div key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: t.textFaint,
                animation: phase >= 2 && phase < 3 ? `dot 0.8s ease-in-out ${d}s infinite` : "none" }} />
            ))}
          </div>

          {/* AI response */}
          <div style={{ ...msg(phase >= 3) }}>
            <div style={{ background: t.cardInner, border: `1px solid ${t.cardInnerBorder}`,
              borderRadius: "4px 16px 16px 16px", padding: "12px 14px",
              fontSize: 14, color: t.textMuted, lineHeight: 1.65 }}>
              Based on your <span style={{ color: t.text, fontWeight: 500 }}>Lecture 4 notes</span>, the lac operon is an inducible system: when lactose binds the repressor, it detaches from the operator and transcription begins. Your professor contrasted it with the trp operon (repressible).
            </div>
            {/* Sources — fades in with the response */}
            <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 7, paddingLeft: 2 }}>
              <span style={{ fontSize: 10, color: t.textFaint, fontWeight: 500 }}>from</span>
              {["Lecture 4.pdf", "Week 3 notes"].map(src => (
                <span key={src} style={{
                  fontSize: 10, fontWeight: 600, color: t.textMuted,
                  background: t.cardInner, border: `1px solid ${t.cardBorder}`,
                  borderRadius: 4, padding: "1px 7px",
                }}>{src}</span>
              ))}
            </div>
          </div>

          {/* Second exchange */}
          <div style={{ display: "flex", justifyContent: "flex-end", ...msg(phase >= 4) }}>
            <div style={{ background: t.userBubble, borderRadius: "16px 16px 4px 16px",
              padding: "9px 14px", fontSize: 14, color: t.text, maxWidth: "78%" }}>
              Is this on the midterm?
            </div>
          </div>

          <div style={{ ...msg(phase >= 5 && phase < 6), display: "flex", gap: 4, paddingLeft: 2 }}>
            {[0, 0.15, 0.3].map((d, i) => (
              <div key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: t.textFaint,
                animation: phase >= 5 && phase < 6 ? `dot 0.8s ease-in-out ${d}s infinite` : "none" }} />
            ))}
          </div>

          <div style={{ ...msg(phase >= 6) }}>
            <div style={{ background: t.cardInner, border: `1px solid ${t.cardInnerBorder}`,
              borderRadius: "4px 16px 16px 16px", padding: "12px 14px",
              fontSize: 14, color: t.textMuted, lineHeight: 1.65 }}>
              Your syllabus lists gene regulation as a Week 6 exam topic. Your professor said "know the operon models cold" in the last session.
            </div>
          </div>
        </div>
        <style>{`@keyframes dot{0%,100%{opacity:.25;transform:translateY(0)}50%{opacity:1;transform:translateY(-4px)}}`}</style>
      </MockCard>
    </div>
  );
}

// ── Recording mockup — waveform + speaker-turn transcript ────────────────────
const TRANSCRIPT_LINES = [
  { speaker: "Prof", text: "Working memory has strict capacity limits, roughly seven items." },
  { speaker: "Prof", text: "Four components govern how we take in new information." },
  { speaker: "You",  text: "Is this the same as Miller's Law?" },
  { speaker: "Prof", text: "Exactly. Seven plus or minus two chunks per modality." },
];

function RecordingMockup({ t }: { t: typeof DARK }) {
  const [containerRef, inView] = useInView(0.3);
  const [secs, setSecs] = useState(4);
  const [lines, setLines] = useState(0);

  useEffect(() => {
    if (!inView) return;
    const tick = setInterval(() => setSecs(s => s + 1), 1000);
    const t1 = setTimeout(() => setLines(1), 700);
    const t2 = setTimeout(() => setLines(2), 2000);
    const t3 = setTimeout(() => setLines(3), 3500);
    const t4 = setTimeout(() => setLines(4), 5200);
    const reset = setTimeout(() => { setSecs(4); setLines(0); }, 10000);
    return () => { clearInterval(tick); [t1, t2, t3, t4, reset].forEach(clearTimeout); };
  }, [inView]); // eslint-disable-line

  const mm = String(Math.floor(secs / 60)).padStart(2, "0");
  const ss = String(secs % 60).padStart(2, "0");

  const BAR_HEIGHTS = [12, 26, 16, 34, 20, 28, 14, 38, 18, 32, 16, 24, 22, 36, 14, 28, 18, 40, 22, 30, 16, 26, 12, 34];
  const DELAYS      = [0, .12, .24, .06, .18, .30, .08, .22, .14, .28, .04, .16, .20, .10, .26, .02, .18, .08, .24, .14, .06, .22, .16, .10];

  return (
    <div ref={containerRef}>
      <MockCard t={t}>
        {/* Header — timer + course label */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#ff3b30",
              animation: inView ? "recPulse 1.2s ease-in-out infinite" : "none", flexShrink: 0 }} />
            <div>
              <span style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.02em", color: t.text,
                fontVariantNumeric: "tabular-nums" }}>
                {mm}:{ss}
              </span>
              <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.1em",
                color: t.label, marginLeft: 7, textTransform: "uppercase" }}>
                Recording
              </span>
            </div>
          </div>
          <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.1em", color: t.label }}>
            COMP 101
          </span>
        </div>

        {/* Waveform */}
        <div style={{ display: "flex", alignItems: "center", gap: 2, height: 44, marginBottom: 14 }}>
          {BAR_HEIGHTS.map((h, i) => (
            <div key={i} style={{
              width: 3, flexShrink: 0,
              background: i < 16
                ? (t === DARK ? "rgba(255,255,255,0.72)" : "rgba(0,0,0,0.55)")
                : (t === DARK ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.1)"),
              borderRadius: 2, transformOrigin: "center",
              animation: inView && i < 16 ? `waveBar 0.65s ease-in-out ${DELAYS[i]}s infinite` : "none",
              height: h,
            }} />
          ))}
        </div>

        {/* Speaker-turn transcript */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
          <div style={{ height: 1, flex: 1, background: t.border }} />
          <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.12em",
            color: t === DARK ? "#444" : "#bbb", textTransform: "uppercase" }}>Live transcript</span>
          <div style={{ height: 1, flex: 1, background: t.border }} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 7, minHeight: 80 }}>
          {TRANSCRIPT_LINES.slice(0, lines).map((line, i) => (
            <div key={i} style={{
              display: "flex", gap: 8, alignItems: "baseline",
              animation: "txIn 0.35s ease both",
            }}>
              <span style={{
                fontSize: 10, fontWeight: 700, letterSpacing: "0.04em", flexShrink: 0,
                color: line.speaker === "You" ? t.text : t.label,
                minWidth: 28,
              }}>
                {line.speaker}
              </span>
              <span style={{ fontSize: 13, color: t.textMuted, lineHeight: 1.5 }}>{line.text}</span>
            </div>
          ))}
          {lines < TRANSCRIPT_LINES.length && lines > 0 && (
            <div style={{ display: "flex", gap: 3, paddingLeft: 36, paddingTop: 2 }}>
              {[0, .14, .28].map((d, i) => (
                <div key={i} style={{
                  width: 4, height: 4, borderRadius: "50%", background: t.textFaint,
                  animation: `dot 0.8s ease-in-out ${d}s infinite`,
                }} />
              ))}
            </div>
          )}
        </div>

        <style>{`
          @keyframes recPulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
          @keyframes waveBar  { 0%,100%{transform:scaleY(0.22)} 50%{transform:scaleY(1)} }
          @keyframes txIn     { from{opacity:0;transform:translateY(5px)} to{opacity:1;transform:translateY(0)} }
        `}</style>
      </MockCard>
    </div>
  );
}

// ── Study Rooms mockup — members joining live ─────────────────────────────────
const ROOM_MEMBERS = [
  { initial: "S", name: "Sam",   goal: "Chapter 4 problems" },
  { initial: "W", name: "Wei",   goal: "Essay draft" },
  { initial: "A", name: "Aron", goal: "Past exams" },
];

function StudyRoomMockup({ t }: { t: typeof DARK }) {
  const [containerRef, inView] = useInView(0.3);
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!inView) return;
    const ids = [
      setTimeout(() => setCount(1), 200),
      setTimeout(() => setCount(2), 1400),
      setTimeout(() => setCount(3), 2800),
      setTimeout(() => { setCount(0); }, 7000),
    ];
    return () => ids.forEach(clearTimeout);
  }, [inView]); // eslint-disable-line

  return (
    <div ref={containerRef}>
      <MockCard t={t}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#34c759" }} />
            <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.12em", color: t.label }}>
              STUDY ROOM · LIVE
            </span>
          </div>
          <span style={{ fontSize: 11, color: t.textFaint }}>{count} focusing</span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10, minHeight: 120 }}>
          {ROOM_MEMBERS.slice(0, count).map((m, i) => (
            <div key={m.name} style={{
              display: "flex", alignItems: "center", gap: 12,
              opacity: 1, transform: "translateY(0)",
              animation: "memberIn 0.4s ease forwards",
            }}>
              <div style={{
                width: 32, height: 32, borderRadius: "50%", flexShrink: 0,
                background: t.cardInner, border: `1px solid ${t.cardBorder}`,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 12, fontWeight: 700, color: t.textMuted,
              }}>{m.initial}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 14, color: t.text, margin: 0 }}>{m.name}</p>
                <p style={{ fontSize: 12, color: t.textFaint, margin: 0,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {m.goal}
                </p>
              </div>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#34c759", flexShrink: 0 }} />
            </div>
          ))}
          {count === 0 && (
            <div style={{ textAlign: "center", padding: "20px 0", color: t.textFaint, fontSize: 13 }}>
              Waiting for members…
            </div>
          )}
        </div>
        <style>{`@keyframes memberIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}`}</style>
      </MockCard>
    </div>
  );
}

// ── PDF file icon (SVG, no external deps) ────────────────────────────────────
function PdfIcon({ t }: { t: typeof DARK }) {
  return (
    <svg width="34" height="42" viewBox="0 0 34 42" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M2 0h20l12 12v26a2 2 0 01-2 2H2a2 2 0 01-2-2V2a2 2 0 012-2z"
        fill={t.cardBg} stroke={t.cardBorder} strokeWidth="1.5"/>
      <path d="M22 0l12 12H24a2 2 0 01-2-2V0z"
        fill={t.cardInner} stroke={t.cardBorder} strokeWidth="1.5"/>
      <text x="17" y="30" textAnchor="middle" fontSize="7.5" fontWeight="700"
        letterSpacing="0.08em" fontFamily="SF Pro Display, Inter, sans-serif" fill={t.label}>PDF</text>
    </svg>
  );
}

// ── Doc drop mockup — PDF drops in, notes appear ─────────────────────────────
function DocDropMockup({ t }: { t: typeof DARK }) {
  const [containerRef, inView] = useInView(0.3);
  const [phase, setPhase] = useState(0);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!inView || startedRef.current) return;
    startedRef.current = true;
    const ids = [
      setTimeout(() => setPhase(1), 400),   // PDF descends
      setTimeout(() => setPhase(2), 1100),  // lands, zone highlights
      setTimeout(() => setPhase(3), 1700),  // processing dots
      setTimeout(() => setPhase(4), 3100),  // content title (zone collapses)
      setTimeout(() => setPhase(5), 3800),  // note 1
      setTimeout(() => setPhase(6), 4500),  // note 2
      setTimeout(() => setPhase(7), 5200),  // note 3
      setTimeout(() => setPhase(8), 6000),  // output badges
      setTimeout(() => { setPhase(0); startedRef.current = false; }, 11000),
    ];
    return () => ids.forEach(clearTimeout);
  }, [inView]);

  useEffect(() => {
    if (phase !== 0 || !inView) return;
    const ids = [
      setTimeout(() => setPhase(1), 400),
      setTimeout(() => setPhase(2), 1100),
      setTimeout(() => setPhase(3), 1700),
      setTimeout(() => setPhase(4), 3100),
      setTimeout(() => setPhase(5), 3800),
      setTimeout(() => setPhase(6), 4500),
      setTimeout(() => setPhase(7), 5200),
      setTimeout(() => setPhase(8), 6000),
      setTimeout(() => setPhase(0), 11000),
    ];
    return () => ids.forEach(clearTimeout);
  }, [phase, inView]); // eslint-disable-line

  const fade = (on: boolean): React.CSSProperties => ({
    opacity: on ? 1 : 0,
    transform: on ? "translateY(0)" : "translateY(6px)",
    transition: "opacity 0.38s ease, transform 0.38s ease",
  });

  const inDrop = phase < 4;

  const NOTES = [
    "Working memory holds 7±2 chunks. Design around this limit",
    "Four components: phonological loop, visuospatial, central exec, episodic buffer",
    "Germane load = schema-building; intrinsic = task complexity; extraneous = poor design",
  ];

  return (
    <div ref={containerRef}>
      <MockCard t={t}>
        {/* Status header */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
          <div style={{
            width: 7, height: 7, borderRadius: "50%",
            background: inDrop ? (phase >= 2 ? "#ff9500" : t.textFaint) : "#34c759",
            transition: "background 0.4s ease",
          }} />
          <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.12em", color: t.label }}>
            {inDrop
              ? (phase >= 3 ? "EXTRACTING CONTENT…" : "COGNITIVE_LOAD.PDF")
              : "EXTRACTED · BIOL 201 LECTURE 6"
            }
          </span>
        </div>

        {/* Drop zone — collapses out via maxHeight when content appears */}
        <div style={{
          border: `1.5px dashed ${phase >= 2 ? t.cardBorder : t.border}`,
          borderRadius: 12,
          overflow: "hidden",
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          gap: 10,
          background: phase >= 2 ? t.cardInner : "transparent",
          transition: "background 0.35s ease, border-color 0.35s ease, max-height 0.55s ease, opacity 0.45s ease, padding 0.45s ease, margin-bottom 0.45s ease",
          maxHeight: inDrop ? 160 : 0,
          opacity: inDrop ? 1 : 0,
          padding: inDrop ? "22px 16px" : 0,
          marginBottom: inDrop ? 4 : 0,
          pointerEvents: "none",
        }}>
          {/* Hint text */}
          <p style={{
            margin: 0, fontSize: 12, color: t.textFaint, letterSpacing: "0.01em",
            opacity: phase === 0 ? 1 : 0, transition: "opacity 0.3s ease",
          }}>
            Drop a PDF, DOCX, or PPTX
          </p>

          {/* PDF icon with spring-drop animation */}
          <div style={{
            opacity: phase >= 1 ? 1 : 0,
            transform: phase < 1 ? "translateY(-22px) scale(0.86)" : "translateY(0) scale(1)",
            transition: "opacity 0.28s ease, transform 0.6s cubic-bezier(0.34, 1.38, 0.64, 1)",
          }}>
            <PdfIcon t={t} />
          </div>

          {/* Processing dots */}
          <div style={{
            display: "flex", gap: 4,
            opacity: phase >= 3 && phase < 4 ? 1 : 0,
            transition: "opacity 0.3s ease",
          }}>
            {[0, 0.15, 0.3].map((d, i) => (
              <div key={i} style={{
                width: 5, height: 5, borderRadius: "50%", background: t.textFaint,
                animation: phase >= 3 && phase < 4 ? `dot 0.8s ease-in-out ${d}s infinite` : "none",
              }} />
            ))}
          </div>
        </div>

        {/* Extracted notes — expands in when drop zone collapses */}
        <div style={{
          maxHeight: !inDrop ? 240 : 0,
          overflow: "hidden",
          opacity: !inDrop ? 1 : 0,
          transition: "max-height 0.55s ease, opacity 0.45s ease",
        }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: t.text, margin: "0 0 12px", letterSpacing: "-0.1px" }}>
            Cognitive Load Theory · Week 6
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 9, marginBottom: 14 }}>
            {NOTES.map((note, i) => (
              <div key={i} style={{ ...fade(phase >= 5 + i), display: "flex", gap: 8, alignItems: "flex-start" }}>
                <span style={{ color: t.textFaint, fontSize: 14, lineHeight: 1.4, flexShrink: 0 }}>–</span>
                <span style={{ fontSize: 13, color: "#737373", lineHeight: 1.55 }}>{note}</span>
              </div>
            ))}
          </div>
          <div style={{ ...fade(phase >= 8), display: "flex", gap: 7, flexWrap: "wrap" }}>
            {["10 flashcards", "Summary ready", "Added to BIOL 201"].map(label => (
              <span key={label} style={{
                fontSize: 11, fontWeight: 600, color: t.textMuted,
                background: t.cardInner, border: `1px solid ${t.cardBorder}`,
                borderRadius: 6, padding: "3px 8px",
              }}>{label}</span>
            ))}
          </div>
        </div>
      </MockCard>
    </div>
  );
}

// ── Grade Tracker mockup — Canvas-synced GPA, progress bars, upcoming due ────
const GT_COURSES = [
  { code:"BIOL 201", grade:"A−", pct:91, complete:8,  total:12, color:"#34c759" },
  { code:"COMP 101", grade:"B+", pct:88, complete:5,  total:10, color:"#ff9500" },
  { code:"MATH 202", grade:"A",  pct:96, complete:7,  total:8,  color:"#34c759" },
  { code:"HIST 104", grade:"B",  pct:83, complete:3,  total:9,  color:"#ff9500" },
];
const GT_DUE = [
  { course:"BIOL 201", task:"Lab Report 3",     due:"Tomorrow", urgent:true  },
  { course:"COMP 101", task:"Lab Assignment 4", due:"Friday",   urgent:false },
  { course:"MATH 202", task:"Problem Set 9",    due:"Sunday",   urgent:false },
];
function GradeTrackerMockup({ t }: { t: typeof DARK }) {
  const [containerRef, inView] = useInView(0.3);
  return (
    <div ref={containerRef}>
      <MockCard t={t} style={{ textAlign:"left" }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14 }}>
          <div style={{ display:"flex", alignItems:"center", gap:7 }}>
            <div style={{ width:7, height:7, borderRadius:"50%", background:"#34c759" }} />
            <span style={{ fontSize:11, fontWeight:600, letterSpacing:"0.12em", color:t.label }}>CANVAS · 4 COURSES</span>
          </div>
          <div>
            <span style={{ fontSize:22, fontWeight:700, letterSpacing:"-0.03em", color:t.text }}>3.52</span>
            <span style={{ fontSize:10, color:t.textFaint, marginLeft:4 }}>GPA</span>
          </div>
        </div>
        <div style={{ display:"flex", flexDirection:"column", gap:10, marginBottom:14 }}>
          {GT_COURSES.map((c,i)=>(
            <div key={c.code} style={{
              opacity:inView?1:0, transform:inView?"none":"translateX(-10px)",
              transition:`opacity 0.4s ease ${i*0.08}s,transform 0.45s cubic-bezier(0.16,1,0.3,1) ${i*0.08}s`,
            }}>
              <div style={{ display:"flex", justifyContent:"space-between", marginBottom:5 }}>
                <span style={{ fontSize:12, fontWeight:600, color:t.text }}>{c.code}</span>
                <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                  <span style={{ fontSize:10, color:t.textFaint }}>{c.complete}/{c.total} done</span>
                  <span style={{ fontSize:12, fontWeight:700, color:c.color }}>{c.grade}</span>
                </div>
              </div>
              <div style={{ height:5, background:t.cardInner, borderRadius:3, overflow:"hidden" }}>
                <div style={{
                  height:"100%", background:c.color, borderRadius:3,
                  width:inView?`${c.pct}%`:"0%",
                  transition:`width 0.9s cubic-bezier(0.16,1,0.3,1) ${0.2+i*0.1}s`,
                }} />
              </div>
            </div>
          ))}
        </div>
        <div style={{ height:1, background:t.border, marginBottom:10 }} />
        <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
          {GT_DUE.map((u,i)=>(
            <div key={i} style={{
              display:"flex", justifyContent:"space-between", alignItems:"center",
              opacity:inView?1:0, transition:`opacity 0.4s ease ${0.5+i*0.1}s`,
            }}>
              <div style={{ display:"flex", alignItems:"center", gap:7 }}>
                <div style={{ width:5, height:5, borderRadius:"50%", background:u.urgent?"#ff3b30":t.textFaint, flexShrink:0 }} />
                <span style={{ fontSize:12, color:t.text }}>{u.task}</span>
                <span style={{ fontSize:10, color:t.textFaint }}>{u.course}</span>
              </div>
              <span style={{ fontSize:11, fontWeight:u.urgent?600:400, color:u.urgent?"#ff3b30":t.textFaint }}>{u.due}</span>
            </div>
          ))}
        </div>
      </MockCard>
    </div>
  );
}

// ── SRS Review mockup — spaced repetition flip card session ──────────────────
const SRS_DECK = [
  { q:"What is the lac operon?",      a:"An inducible operon: lactose binding releases the repressor, starting transcription." },
  { q:"Define working memory.",        a:"Short-term store holding ~7±2 chunks, managed by the central executive." },
  { q:"What drives the Krebs cycle?",  a:"Acetyl-CoA: enters and yields 2 CO₂, NADH, and ATP per turn." },
];
function SRSReviewMockup({ t }: { t: typeof DARK }) {
  const [containerRef, inView] = useInView(0.3);
  const [cardIdx, setCardIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [showBtns, setShowBtns] = useState(false);
  const [reviewed, setReviewed] = useState(0);

  useEffect(() => {
    if (!inView) return;
    const ids = [
      setTimeout(() => setFlipped(true), 1800),
      setTimeout(() => setShowBtns(true), 2400),
      setTimeout(() => {
        setFlipped(false); setShowBtns(false);
        setCardIdx(i => (i + 1) % SRS_DECK.length);
        setReviewed(r => r + 1);
      }, 5200),
    ];
    return () => ids.forEach(clearTimeout);
  }, [inView, cardIdx]);

  const card = SRS_DECK[cardIdx];
  return (
    <div ref={containerRef}>
      <MockCard t={t} style={{ textAlign:"left" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
          <span style={{ fontSize:11, fontWeight:600, letterSpacing:"0.12em", color:t.label }}>BIOL 201 · REVIEW</span>
          <span style={{ fontSize:12, color:t.textMuted, fontVariantNumeric:"tabular-nums" }}>{reviewed+1} / 12 due</span>
        </div>
        <div style={{ height:3, background:t.cardInner, borderRadius:2, marginBottom:14, overflow:"hidden" }}>
          <div style={{ height:"100%", background:"#34c759", borderRadius:2, width:`${(reviewed/12)*100}%`, transition:"width 0.5s ease" }} />
        </div>
        <div style={{ height:118, perspective:900, marginBottom:13 }}>
          <div style={{
            position:"relative", height:"100%", transformStyle:"preserve-3d",
            transform:flipped?"rotateY(180deg)":"rotateY(0deg)",
            transition:"transform 0.55s cubic-bezier(0.16,1,0.3,1)",
          }}>
            {/* Front */}
            <div style={{ position:"absolute",inset:0,backfaceVisibility:"hidden",background:t.cardInner,border:`1px solid ${t.cardInnerBorder}`,borderRadius:12,padding:"13px 15px",display:"flex",flexDirection:"column",justifyContent:"space-between" }}>
              <span style={{ fontSize:9, fontWeight:700, letterSpacing:"0.1em", color:t.textFaint }}>QUESTION</span>
              <p style={{ margin:0, fontSize:13, color:t.text, lineHeight:1.5, fontWeight:500 }}>{card.q}</p>
              <span style={{ fontSize:10, color:t.textFaint, textAlign:"center" }}>tap to reveal</span>
            </div>
            {/* Back */}
            <div style={{ position:"absolute",inset:0,backfaceVisibility:"hidden",transform:"rotateY(180deg)",background:t.cardInner,border:`1px solid ${t.cardInnerBorder}`,borderRadius:12,padding:"13px 15px",display:"flex",flexDirection:"column",justifyContent:"space-between" }}>
              <span style={{ fontSize:9, fontWeight:700, letterSpacing:"0.1em", color:"#34c759" }}>ANSWER</span>
              <p style={{ margin:0, fontSize:13, color:t.text, lineHeight:1.5 }}>{card.a}</p>
            </div>
          </div>
        </div>
        <div style={{ display:"flex", gap:7, opacity:showBtns?1:0, transform:showBtns?"none":"translateY(6px)", transition:"opacity 0.3s ease,transform 0.3s ease" }}>
          {[{label:"Again",color:"#ff3b30"},{label:"Hard",color:"#ff9500"},{label:"Good",color:"#34c759",hi:true},{label:"Easy",color:"#0066cc"}].map(b=>(
            <div key={b.label} style={{ flex:1, textAlign:"center", padding:"7px 2px", background:(b as any).hi?"rgba(52,199,89,0.10)":t.cardInner, border:`1px solid ${(b as any).hi?"rgba(52,199,89,0.25)":t.cardInnerBorder}`, borderRadius:9 }}>
              <p style={{ margin:0, fontSize:10, fontWeight:700, color:b.color, letterSpacing:"0.02em" }}>{b.label}</p>
            </div>
          ))}
        </div>
      </MockCard>
    </div>
  );
}

// ── Leaderboard mockup — live ranked student list with XP count-up ────────────
const LB_DATA = [
  { rank:1, name:"Sofia Reyes",   uni:"Harvard",   xp:2847, streak:12, medal:"#F0A23C", isYou:false },
  { rank:2, name:"Arjun Mehta",   uni:"U of T",    xp:2634, streak:7,  medal:"#A8A8B0", isYou:false },
  { rank:3, name:"Chiara Russo",  uni:"McGill",    xp:2521, streak:15, medal:"#C87A3E", isYou:false },
  { rank:4, name:"You",           uni:"Your uni",  xp:2408, streak:4,  medal:null,      isYou:true  },
  { rank:5, name:"Kwame Asante",  uni:"UBC",       xp:2195, streak:8,  medal:null,      isYou:false },
];
function LeaderboardMockup({ t }: { t: typeof DARK }) {
  const [containerRef, inView] = useInView(0.3);
  const [shown, setShown] = useState(0);
  const [xpArr, setXpArr] = useState(LB_DATA.map(()=>0));
  const startedRef = useRef(false);

  useEffect(() => {
    if (!inView || startedRef.current) return;
    startedRef.current = true;
    LB_DATA.forEach((_,i) => setTimeout(()=>setShown(v=>v+1), 120+i*130));
    const dur = 1200, t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min((now-t0)/dur,1);
      const e = 1-Math.pow(1-p,3);
      setXpArr(LB_DATA.map(d=>Math.round(e*d.xp)));
      if (p<1) requestAnimationFrame(tick);
    };
    setTimeout(()=>requestAnimationFrame(tick), 350);
  }, [inView]);

  return (
    <div ref={containerRef}>
      <MockCard t={t} style={{ textAlign:"left" }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16 }}>
          <div style={{ display:"flex", alignItems:"center", gap:7 }}>
            <div style={{ width:7, height:7, borderRadius:"50%", background:"#34c759", animation:inView?"pulseGlow 2s ease-in-out infinite":"none" }} />
            <span style={{ fontSize:11, fontWeight:600, letterSpacing:"0.12em", color:t.label }}>LEADERBOARD · THIS WEEK</span>
          </div>
          <span style={{ fontSize:10, color:t.textFaint }}>Top 5</span>
        </div>
        <div style={{ display:"flex", flexDirection:"column", gap:3 }}>
          {LB_DATA.map((e,i)=>(
            <div key={e.name} style={{
              display:"flex", alignItems:"center", gap:10,
              padding:"8px 10px", borderRadius:11,
              background:e.isYou?(t===LIGHT?"rgba(0,102,204,0.07)":"rgba(0,102,204,0.12)"):"transparent",
              border:e.isYou?"1px solid rgba(0,102,204,0.16)":"1px solid transparent",
              opacity:i<shown?1:0,
              transform:i<shown?"translateX(0)":"translateX(18px)",
              transition:`opacity 0.4s ease ${i*0.05}s,transform 0.45s cubic-bezier(0.16,1,0.3,1) ${i*0.05}s`,
            }}>
              <span style={{ width:22, fontSize:e.medal?13:11, fontWeight:700, color:e.medal??t.textFaint, textAlign:"center", flexShrink:0, letterSpacing:"-0.02em" }}>
                {e.rank}
              </span>
              <div style={{ width:30, height:30, borderRadius:"50%", flexShrink:0, background:e.isYou?"rgba(0,102,204,0.14)":t.cardInner, border:`1px solid ${t.cardBorder}`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, fontWeight:700, color:e.isYou?"#0066cc":t.textMuted }}>
                {e.name.charAt(0)}
              </div>
              <div style={{ flex:1, minWidth:0 }}>
                <p style={{ margin:0, fontSize:13, fontWeight:e.isYou?700:600, color:e.isYou?"#0066cc":t.text, letterSpacing:"-0.01em" }}>{e.name}</p>
                <p style={{ margin:0, fontSize:10, color:t.textFaint }}>{e.uni} &middot; {e.streak}d streak</p>
              </div>
              <div style={{ textAlign:"right", flexShrink:0 }}>
                <span style={{ fontSize:13, fontWeight:700, color:t.text, fontVariantNumeric:"tabular-nums", letterSpacing:"-0.02em" }}>
                  {xpArr[i].toLocaleString()}
                </span>
                <span style={{ fontSize:9, color:t.textFaint, marginLeft:2 }}>xp</span>
              </div>
            </div>
          ))}
        </div>
      </MockCard>
    </div>
  );
}

// ── Features Showcase — replaces 4 standalone feature sections ───────────────
// Rotating headline + 4 tabs + glassmorphic demo card housing existing mockups.
// Mockups remount on tab switch (key trick) so their useInView/startedRef resets
// and animations replay immediately (the card is always in-viewport when visible).

const SHOWCASE_TABS = [
  { id: "tutor"     as const, label: "AI Tutor",    word: "AI Tutor",    desc: "Grounded in your actual lecture notes, not just the internet." },
  { id: "leaderboard" as const, label: "Leaderboard", word: "Leaderboard", desc: "XP, streaks, and weekly rankings. Study with momentum and compete with classmates." },
  { id: "documents" as const, label: "Documents",   word: "Library",     desc: "PDFs and slides transform into notes and flashcards instantly." },
  { id: "rooms"     as const, label: "Study Rooms", word: "Study Room",  desc: "Focus together: shared timers, live presence, group AI." },
];

function FeaturesShowcase({ t, chromaStyle, ghostRef }: {
  t: typeof DARK;
  chromaStyle: React.CSSProperties;
  ghostRef: React.RefObject<HTMLDivElement>;
}) {
  const [activeIdx, setActiveIdx] = useState(0);
  const [wordVisible, setWordVisible] = useState(true);
  const activeTab = SHOWCASE_TABS[activeIdx];

  // Auto-rotate every 3 s — functional updater always uses current idx
  useEffect(() => {
    const id = setInterval(() => {
      setWordVisible(false);
      setTimeout(() => {
        setActiveIdx(i => (i + 1) % SHOWCASE_TABS.length);
        setWordVisible(true);
      }, 220);
    }, 3000);
    return () => clearInterval(id);
  }, []);

  function selectTab(idx: number) {
    if (idx === activeIdx) return;
    setWordVisible(false);
    setTimeout(() => { setActiveIdx(idx); setWordVisible(true); }, 180);
  }

  return (
    <section style={{ padding: "100px 20px 80px", textAlign: "center", background: "#f5f5f7" }}>
      {/* Ghost sentinel — triggers background wordmark */}
      <div ref={ghostRef} aria-hidden="true" style={{ height: 0, margin: 0, padding: 0 }} />

      {/* Features intro — distinct from the hero, introduces the product surfaces */}
      <Reveal>
        <h1 style={{ fontSize: "clamp(36px,5.5vw,64px)", fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1.08, color: t.text, margin: "0 0 20px" }}>
          <span>Four tools.</span>
          <span style={{ color: t.text }}> One intelligence.</span>
        </h1>
      </Reveal>
      <Reveal delay={0.06}>
        <p style={{ fontSize: 18, color: "#737373", maxWidth: 480, margin: "0 auto 80px", lineHeight: 1.65 }}>
          Purpose-built for the way students actually learn, grounded in your courses, not the internet.
        </p>
      </Reveal>

      {/* Rotating headline */}
      <Reveal delay={0.1}>
        <h2 style={{ fontSize: "clamp(28px,4.2vw,50px)", fontWeight: 700, letterSpacing: "-0.025em", lineHeight: 1.1, marginBottom: 36, color: t.text }}>
          FschoolAI, your{" "}
          <span style={{
            color: "#737373",
            display: "inline-block",
            opacity: wordVisible ? 1 : 0,
            transform: wordVisible ? "translateY(0)" : "translateY(-10px)",
            transition: "opacity 0.2s ease, transform 0.2s ease",
          }}>
            {activeTab.word}
          </span>
        </h2>
      </Reveal>

      {/* Tab row — horizontally scrollable on mobile */}
      <Reveal delay={0.14}>
        <div className="sa-tab-row" style={{
          display: "flex", gap: 4, overflowX: "auto",
          WebkitOverflowScrolling: "touch" as any, scrollbarWidth: "none",
          justifyContent: "center", padding: "0 8px", marginBottom: 12,
        }}>
          {SHOWCASE_TABS.map((tab, i) => (
            <button key={tab.id} onClick={() => selectTab(i)} style={{
              flexShrink: 0, padding: "8px 20px", borderRadius: 50, border: "none",
              background: i === activeIdx ? "rgba(0,0,0,0.08)" : "transparent",
              color: i === activeIdx ? "#000" : "rgba(0,0,0,0.45)",
              fontWeight: i === activeIdx ? 600 : 500,
              fontSize: 14, cursor: "pointer", fontFamily: "inherit",
              transition: "background 0.22s ease, color 0.22s ease",
              WebkitTapHighlightColor: "transparent",
            }}>{tab.label}</button>
          ))}
        </div>
      </Reveal>

      {/* Tab description crossfades with the word */}
      <Reveal delay={0.15}>
        <p style={{
          fontSize: 15, color: "#737373", maxWidth: 380,
          margin: "0 auto 40px", lineHeight: 1.6,
          opacity: wordVisible ? 1 : 0,
          transition: "opacity 0.2s ease",
        }}>
          {activeTab.desc}
        </p>
      </Reveal>

      {/* Glassmorphic demo card — gradient border via padding-box / border-box trick */}
      <Reveal delay={0.18}>
        <div className="feat-card" style={{
          maxWidth: 460, margin: "0 auto", borderRadius: 26, padding: 2,
          background: "linear-gradient(white,white) padding-box, linear-gradient(135deg,#b8a0dc,#f0a4bc,#94c4f0,#96e8a8) border-box",
          border: "1.5px solid transparent",
          boxShadow: "0 24px 64px rgba(0,0,0,0.08), 0 4px 16px rgba(0,0,0,0.04)",
        }}>
          <div style={{ background: "rgba(255,255,255,0.96)", borderRadius: 24, padding: 8, minHeight: 340, overflow: "hidden" }}>
            {/* key={activeTab.id} remounts the mockup → resets startedRef → animation replays */}
            <div key={activeTab.id} style={{ animation: "saFadeIn 0.28s ease both" }}>
              {activeTab.id === "tutor"     && <TutorMockup     t={t} />}
              {activeTab.id === "leaderboard" && <LeaderboardMockup t={t} />}
              {activeTab.id === "documents" && <DocDropMockup   t={t} />}
              {activeTab.id === "rooms"     && <StudyRoomMockup t={t} />}
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

// ── ECO_ITEMS kept for potential reuse ───────────────────────────────────────
const ECO_ITEMS = [
  { name:"Canvas",      angle:-90, bg:"#fff4ee", border:"#E66000",
    icon:<svg viewBox="0 0 32 32" width="22" height="22"><text x="16" y="23" textAnchor="middle" fontSize="18" fontWeight="800" fill="#E66000" fontFamily="inherit">C</text></svg> },
  { name:"YouTube",     angle:-30, bg:"#fff0f0", border:"#FF0000",
    icon:<svg viewBox="0 0 32 32" width="22" height="22"><rect x="2" y="7" width="28" height="18" rx="5" fill="#FF0000"/><polygon points="12,11 12,21 22,16" fill="#fff"/></svg> },
  { name:"Google Drive",angle:30,  bg:"#f0f8f0", border:"#34A853",
    icon:<svg viewBox="0 0 32 32" fill="none" width="22" height="22" xmlns="http://www.w3.org/2000/svg">
      <path d="M16 12.45L12.54 6.34c.11-.12.24-.19.38-.25-1.02.34-1.49 1.48-1.49 1.48L5.11 18.73c-.09.35-.12.67-.11.95h6.9L16 12.45z" fill="#34A853"/>
      <path d="M16 12.45l4.1 7.23h6.9c.01-.28-.01-.61-.11-.95L20.57 7.58s-.47-1.14-1.49-1.48c.13.05.27.13.38.25L16 12.45z" fill="#FBBC05"/>
      <path d="M16 12.45l3.46-6.11c-.12-.12-.25-.19-.38-.25-.15-.05-.31-.08-.49-.09h-.57-4.42h-.57c-.17.01-.34.04-.49.09-.13.05-.26.13-.38.25L16 12.45z" fill="#188038"/>
      <path d="M11.91 19.68L8.49 25.72s-.11-.05-.22-.14c.49.37.96.46.96.46h13.44c.74 0 .9-.28.9-.28l.01-.01-3.42-6.07H11.91z" fill="#4285F4"/>
      <path d="M11.91 19.68H5.01c.03.82.39 1.3.39 1.3l.26.45.01.01.57.99 1.27 2.21c.04.09.08.17.12.25.02.03.03.05.05.08.16.22.34.39.51.53.15.12.26.17.26.17L11.91 19.68z" fill="#1967D2"/>
      <path d="M20.1 19.68h6.9c-.03.82-.39 1.3-.39 1.3l-.26.45-.01.01-.57.99-1.27 2.21c-.04.09-.08.17-.12.25-.02.03-.03.05-.05.08-.16.22-.34.39-.51.53-.15.12-.26.17-.26.17L20.1 19.68z" fill="#EA4335"/>
    </svg> },
  { name:"Microsoft",   angle:90,  bg:"#edf4ff", border:"#00A4EF",
    icon:<svg viewBox="0 0 32 32" width="20" height="20"><rect x="5" y="5" width="10" height="10" fill="#F25022"/><rect x="17" y="5" width="10" height="10" fill="#7FBA00"/><rect x="5" y="17" width="10" height="10" fill="#00A4EF"/><rect x="17" y="17" width="10" height="10" fill="#FFB900"/></svg> },
  { name:"Discord",     angle:150, bg:"#f2f0ff", border:"#5865F2",
    icon:<svg viewBox="0 -28.5 256 256" width="22" height="22" xmlns="http://www.w3.org/2000/svg">
      <path d="M216.856 16.597C200.285 8.843 182.566 3.208 164.042 0c-2.275 4.113-4.933 9.645-6.766 14.046-19.692-2.961-39.203-2.961-58.533 0-1.832-4.4-4.55-9.933-6.845-14.046-18.545 3.209-36.284 8.864-52.855 16.638C5.618 67.147-3.443 116.4 1.087 164.956c23.169 17.555 44.653 27.612 65.775 34.193 5.215-7.177 9.866-14.807 13.873-22.848-7.631-2.899-14.94-6.477-21.846-10.631 1.832-1.357 3.624-2.776 5.356-4.237 42.123 19.702 87.89 19.702 129.51 0 1.751 1.461 3.543 2.88 5.356 4.237-6.926 4.174-14.235 7.752-21.866 10.651 4.007 8.02 8.638 15.67 13.873 22.847 21.142-6.58 42.646-16.637 54.815-34.193 4.716-56.332-9.68-105.079-40.845-148.359zM85.474 135.095c-12.645 0-23.015-11.805-23.015-26.18s10.149-26.18 23.015-26.18c12.867 0 23.236 11.804 23.015 26.18.02 14.375-10.148 26.18-23.015 26.18zm85.051 0c-12.645 0-23.014-11.805-23.014-26.18s10.148-26.18 23.014-26.18c12.867 0 23.236 11.804 23.015 26.18 0 14.375-10.148 26.18-23.015 26.18z" fill="#5865F2"/>
    </svg> },
  { name:"PDFs & Docs", angle:210, bg:"#fff1f1", border:"#EB5757",
    icon:<svg viewBox="-4 0 40 40" width="20" height="20" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M25.6686 26.0962C25.1812 26.2401 24.4656 26.2563 23.6984 26.145C22.875 26.0256 22.0351 25.7739 21.2096 25.403C22.6817 25.1888 23.8237 25.2548 24.8005 25.6009C25.0319 25.6829 25.412 25.9021 25.6686 26.0962ZM17.4552 24.7459C17.3953 24.7622 17.3363 24.7776 17.2776 24.7939C16.8815 24.9017 16.4961 25.0069 16.1247 25.1005L15.6239 25.2275C14.6165 25.4824 13.5865 25.7428 12.5692 26.0529C12.9558 25.1206 13.315 24.178 13.6667 23.2564C13.9271 22.5742 14.193 21.8773 14.468 21.1894C14.6075 21.4198 14.7531 21.6503 14.9046 21.8814C15.5948 22.9326 16.4624 23.9045 17.4552 24.7459ZM14.8927 14.2326C14.958 15.383 14.7098 16.4897 14.3457 17.5514C13.8972 16.2386 13.6882 14.7889 14.2489 13.6185C14.3927 13.3185 14.5105 13.1581 14.5869 13.0744C14.7049 13.2566 14.8601 13.6642 14.8927 14.2326ZM9.63347 28.8054C9.38148 29.2562 9.12426 29.6782 8.86063 30.0767C8.22442 31.0355 7.18393 32.0621 6.64941 32.0621C6.59681 32.0621 6.53316 32.0536 6.44015 31.9554C6.38028 31.8926 6.37069 31.8476 6.37359 31.7862C6.39161 31.4337 6.85867 30.8059 7.53527 30.2238C8.14939 29.6957 8.84352 29.2262 9.63347 28.8054ZM27.3706 26.1461C27.2889 24.9719 25.3123 24.2186 25.2928 24.2116C24.5287 23.9407 23.6986 23.8091 22.7552 23.8091C21.7453 23.8091 20.6565 23.9552 19.2582 24.2819C18.014 23.3999 16.9392 22.2957 16.1362 21.0733C15.7816 20.5332 15.4628 19.9941 15.1849 19.4675C15.8633 17.8454 16.4742 16.1013 16.3632 14.1479C16.2737 12.5816 15.5674 11.5295 14.6069 11.5295C13.948 11.5295 13.3807 12.0175 12.9194 12.9813C12.0965 14.6987 12.3128 16.8962 13.562 19.5184C13.1121 20.5751 12.6941 21.6706 12.2895 22.7311C11.7861 24.0498 11.2674 25.4103 10.6828 26.7045C9.04334 27.3532 7.69648 28.1399 6.57402 29.1057C5.8387 29.7373 4.95223 30.7028 4.90163 31.7107C4.87693 32.1854 5.03969 32.6207 5.37044 32.9695C5.72183 33.3398 6.16329 33.5348 6.6487 33.5354C8.25189 33.5354 9.79489 31.3327 10.0876 30.8909C10.6767 30.0029 11.2281 29.0124 11.7684 27.8699C13.1292 27.3781 14.5794 27.011 15.985 26.6562L16.4884 26.5283C16.8668 26.4321 17.2601 26.3257 17.6635 26.2153C18.0904 26.0999 18.5296 25.9802 18.976 25.8665C20.4193 26.7844 21.9714 27.3831 23.4851 27.6028C24.7601 27.7883 25.8924 27.6807 26.6589 27.2811C27.3486 26.9219 27.3866 26.3676 27.3706 26.1461ZM30.4755 36.2428C30.4755 38.3932 28.5802 38.5258 28.1978 38.5301H3.74486C1.60224 38.5301 1.47322 36.6218 1.46913 36.2428L1.46884 3.75642C1.46884 1.6039 3.36763 1.4734 3.74457 1.46908H20.263L20.2718 1.4778V7.92396C20.2718 9.21763 21.0539 11.6669 24.0158 11.6669H30.4203L30.4753 11.7218L30.4755 36.2428ZM28.9572 10.1976H24.0169C21.8749 10.1976 21.7453 8.29969 21.7424 7.92417V2.95307L28.9572 10.1976ZM31.9447 36.2428V11.1157L21.7424 0.871022V0.823357H21.6936L20.8742 0H3.74491C2.44954 0 0 0.785336 0 3.75711V36.2435C0 37.5427 0.782956 40 3.74491 40H28.2001C29.4952 39.9997 31.9447 39.2143 31.9447 36.2428Z" fill="#EB5757"/></svg> },
] as const;

// ── Integrations marquee — two rows opposite directions, no rotation ──────────
const MARQUEE_PILLS = [
  { name: "Canvas",       bg: "#fff4ee", icon: <svg viewBox="0 0 32 32" width="20" height="20"><text x="16" y="23" textAnchor="middle" fontSize="17" fontWeight="800" fill="#E66000" fontFamily="inherit">C</text></svg> },
  { name: "YouTube",      bg: "#fff0f0", icon: <svg viewBox="0 0 32 32" width="20" height="20"><rect x="2" y="7" width="28" height="18" rx="5" fill="#FF0000"/><polygon points="12,11 12,21 22,16" fill="#fff"/></svg> },
  { name: "Google Drive", bg: "#f0f8f0", icon: <svg viewBox="0 0 32 32" fill="none" width="20" height="20"><path d="M16 12.45L12.54 6.34c.11-.12.24-.19.38-.25-1.02.34-1.49 1.48-1.49 1.48L5.11 18.73c-.09.35-.12.67-.11.95h6.9L16 12.45z" fill="#34A853"/><path d="M16 12.45l4.1 7.23h6.9c.01-.28-.01-.61-.11-.95L20.57 7.58s-.47-1.14-1.49-1.48c.13.05.27.13.38.25L16 12.45z" fill="#FBBC05"/><path d="M16 12.45l3.46-6.11c-.12-.12-.25-.19-.38-.25-.15-.05-.31-.08-.49-.09h-5.56c-.17.01-.34.04-.49.09-.13.05-.26.13-.38.25L16 12.45z" fill="#188038"/><path d="M11.91 19.68L8.49 25.72h13.44c.74 0 .9-.28.9-.28l-3.42-6.07H11.91z" fill="#4285F4"/></svg> },
  { name: "Microsoft",    bg: "#edf4ff", icon: <svg viewBox="0 0 32 32" width="18" height="18"><rect x="5" y="5" width="10" height="10" fill="#F25022"/><rect x="17" y="5" width="10" height="10" fill="#7FBA00"/><rect x="5" y="17" width="10" height="10" fill="#00A4EF"/><rect x="17" y="17" width="10" height="10" fill="#FFB900"/></svg> },
  { name: "Discord",      bg: "#f2f0ff", icon: <svg viewBox="0 0 32 32" width="20" height="20"><text x="16" y="23" textAnchor="middle" fontSize="15" fontWeight="800" fill="#5865F2" fontFamily="inherit">D</text></svg> },
  { name: "PDFs & Docs",  bg: "#fff1f1", icon: <svg viewBox="0 0 32 32" width="16" height="16" fill="none"><path d="M6 4h13l7 7v17a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2z" stroke="#EB5757" strokeWidth="2"/><path d="M19 4v7h7" stroke="#EB5757" strokeWidth="2"/></svg> },
];

function IntegrationPill({ name, bg, icon }: { name: string; bg: string; icon: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, background: "#fff", border: "1px solid #e6e6e6", borderRadius: 50, padding: "10px 20px", flexShrink: 0, boxShadow: "0 1px 4px rgba(0,0,0,0.05)" }}>
      <div style={{ width: 28, height: 28, borderRadius: "50%", background: bg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{icon}</div>
      <span style={{ fontSize: 13, fontWeight: 600, color: "#141414", whiteSpace: "nowrap" }}>{name}</span>
    </div>
  );
}

// ── EcosystemCircle — hub-and-spoke orbital animation ────────────────────────
const ORBIT_R = 195;
const SVG_CENTER = 260;

// Real brand SVG icons for ecosystem apps
const ECO_ICON = {
  canvas: <svg viewBox="0 0 32 32" width="22" height="22"><text x="16" y="23" textAnchor="middle" fontSize="18" fontWeight="800" fill="#E66000" fontFamily="inherit">C</text></svg>,
  youtube: <svg viewBox="0 0 32 32" width="22" height="22"><rect x="2" y="6" width="28" height="20" rx="6" fill="#FF0000"/><polygon points="13,11 13,22 23,16.5" fill="#fff"/></svg>,
  gdrive: <svg viewBox="0 0 48 48" width="22" height="22" fill="none"><path d="M6 40l8-14h20l-8 14H6z" fill="#4285F4"/><path d="M34 26L24 8h-4L10 26h24z" fill="#34A853"/><path d="M42 40l-8-14-10 0 8 14h10z" fill="#FBBC05"/></svg>,
  microsoft: <svg viewBox="0 0 32 32" width="20" height="20"><rect x="4" y="4" width="11" height="11" fill="#F25022"/><rect x="17" y="4" width="11" height="11" fill="#7FBA00"/><rect x="4" y="17" width="11" height="11" fill="#00A4EF"/><rect x="17" y="17" width="11" height="11" fill="#FFB900"/></svg>,
  discord: <svg viewBox="0 0 127.14 96.36" width="22" height="16" fill="#5865F2"><path d="M107.7 8.07A105.15 105.15 0 0081.47 0a72.06 72.06 0 00-3.36 6.83 97.68 97.68 0 00-29.11 0A72.37 72.37 0 0045.64 0a105.89 105.89 0 00-26.25 8.09C2.79 32.65-1.71 56.6.54 80.21a105.73 105.73 0 0032.17 16.15 77.7 77.7 0 006.89-11.11 68.42 68.42 0 01-10.85-5.18c.91-.66 1.8-1.34 2.66-2a75.57 75.57 0 0064.32 0c.87.71 1.76 1.39 2.66 2a68.68 68.68 0 01-10.87 5.19 77 77 0 006.89 11.1 105.25 105.25 0 0032.19-16.14c2.64-27.38-4.51-51.11-18.9-72.15zM42.45 65.69C36.18 65.69 31 60 31 53s5-12.74 11.43-12.74S54 46 53.89 53s-5.05 12.69-11.44 12.69zm42.24 0C78.41 65.69 73.25 60 73.25 53s5-12.74 11.44-12.74S96.23 46 96.12 53s-5.04 12.69-11.43 12.69z"/></svg>,
  pdf: <svg viewBox="0 0 24 24" width="18" height="18" fill="none"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z" stroke="#EB5757" strokeWidth="1.5" strokeLinecap="round"/><path d="M14 2v6h6M9 13h1.5a1.5 1.5 0 010 3H9v-3zm0 0v5m6-5h1a2 2 0 010 4h-1V13z" stroke="#EB5757" strokeWidth="1.5" strokeLinecap="round"/></svg>,
};

const ECOSYSTEM_APPS = [
  { name:"Canvas",       angle:-90,  scatter:{x:-230,y:-175,r:-22}, color:"#E66000", bg:"#fff4ee", svgX:260, svgY:65,  icon:ECO_ICON.canvas    },
  { name:"YouTube",      angle:-30,  scatter:{x:205,y:-215,r:16},   color:"#FF0000", bg:"#fff0f0", svgX:429, svgY:162, icon:ECO_ICON.youtube   },
  { name:"Google Drive", angle:30,   scatter:{x:265,y:55,r:-14},    color:"#34A853", bg:"#f0f8f0", svgX:429, svgY:358, icon:ECO_ICON.gdrive    },
  { name:"Microsoft",    angle:90,   scatter:{x:155,y:240,r:22},    color:"#00A4EF", bg:"#edf4ff", svgX:260, svgY:455, icon:ECO_ICON.microsoft },
  { name:"Discord",      angle:150,  scatter:{x:-180,y:230,r:-16},  color:"#5865F2", bg:"#f2f0ff", svgX:91,  svgY:358, icon:ECO_ICON.discord   },
  { name:"PDFs & Docs",  angle:210,  scatter:{x:-270,y:38,r:12},    color:"#EB5757", bg:"#fff1f1", svgX:91,  svgY:162, icon:ECO_ICON.pdf       },
] as const;

function EcosystemCircle({ t }: { t: typeof DARK }) {
  const [containerRef, inView] = useInView(0.2);
  const [phase, setPhase] = useState(0);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!inView || startedRef.current) return;
    startedRef.current = true;
    const ids = [
      setTimeout(() => setPhase(1), 0),
      setTimeout(() => setPhase(2), 800),
      setTimeout(() => setPhase(3), 1700),
      setTimeout(() => setPhase(4), 2300),
      setTimeout(() => setPhase(5), 3000),
    ];
    return () => ids.forEach(clearTimeout);
  }, [inView]);

  return (
    <section className="eco-section" style={{ background: "#f5f5f7", padding: "100px 0", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ textAlign: "center", padding: "0 20px", marginBottom: 52 }}>
        <Reveal>
          <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.18em", textTransform: "uppercase", color: "#a3a3a3", marginBottom: 14 }}>Integrations</p>
          <h2 style={{ fontSize: "clamp(28px,4.5vw,50px)", fontWeight: 700, letterSpacing: "-0.025em", lineHeight: 1.1, color: "#141414", margin: "0 0 16px" }}>
            Works with everything<br />you already use.
          </h2>
          <p style={{ fontSize: 16, color: "#737373", maxWidth: 400, margin: "0 auto", lineHeight: 1.6 }}>
            Canvas, YouTube, Google Drive, Microsoft, Discord. Your academic world unified.
          </p>
        </Reveal>
      </div>

      {/* Orbital container — desktop only */}
      <div className="eco-orbital-wrap">
      <div ref={containerRef} className="eco-orbital" style={{ width: "min(520px,90vw)", height: "min(520px,90vw)", position: "relative", margin: "0 auto" }}>

        {/* SVG overlay: orbit ring + connection lines + data packets */}
        <svg
          viewBox="0 0 520 520"
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible" }}
        >
          <defs>
            {ECOSYSTEM_APPS.map((app, i) => {
              const ox = SVG_CENTER + Math.cos(app.angle * Math.PI / 180) * ORBIT_R;
              const oy = SVG_CENTER + Math.sin(app.angle * Math.PI / 180) * ORBIT_R;
              return (
                <path key={i} id={`eco-line-${i}`} d={`M${SVG_CENTER} ${SVG_CENTER} L${ox} ${oy}`} />
              );
            })}
          </defs>

          {/* Dashed orbit ring */}
          <circle
            cx={SVG_CENTER} cy={SVG_CENTER} r={ORBIT_R}
            fill="none" stroke="rgba(0,0,0,0.08)" strokeWidth="1" strokeDasharray="4 8"
            style={{ opacity: phase >= 3 ? 1 : 0, transition: "opacity 0.5s ease" }}
          />

          {/* Connection lines */}
          {ECOSYSTEM_APPS.map((app, i) => {
            const ox = SVG_CENTER + Math.cos(app.angle * Math.PI / 180) * ORBIT_R;
            const oy = SVG_CENTER + Math.sin(app.angle * Math.PI / 180) * ORBIT_R;
            const lineLen = ORBIT_R;
            return (
              <line
                key={i}
                x1={SVG_CENTER} y1={SVG_CENTER}
                x2={ox} y2={oy}
                stroke={app.color + "22"} strokeWidth="1.5"
                strokeDasharray={`${lineLen} ${lineLen}`}
                strokeDashoffset={phase >= 4 ? 0 : lineLen}
                style={{ transition: `stroke-dashoffset 0.85s cubic-bezier(0.16,1,0.3,1) ${0.15 + i * 0.1}s` }}
              />
            );
          })}

          {/* Data packet dots — CSS-only (no animateMotion, avoids browser jank) */}
          {phase >= 5 && ECOSYSTEM_APPS.map((app, i) => {
            const dx = Math.cos(app.angle * Math.PI / 180) * ORBIT_R;
            const dy = Math.sin(app.angle * Math.PI / 180) * ORBIT_R;
            const kfName = `eco-pkt-${i}`;
            return (
              <g key={i}>
                <style>{`
                  @keyframes ${kfName} {
                    0%   { transform: translate(${SVG_CENTER}px, ${SVG_CENTER}px) scale(0); opacity: 0; }
                    8%   { opacity: 0.9; transform: translate(${SVG_CENTER}px, ${SVG_CENTER}px) scale(1); }
                    88%  { opacity: 0.7; }
                    100% { transform: translate(${SVG_CENTER + dx}px, ${SVG_CENTER + dy}px) scale(0.4); opacity: 0; }
                  }
                `}</style>
                <circle r="3.5" fill={app.color}
                  style={{
                    animation: `${kfName} ${2.2 + i * 0.18}s ease-in-out ${i * 0.38}s infinite`,
                    willChange: "transform, opacity",
                  }}
                />
              </g>
            );
          })}
        </svg>

        {/* App nodes */}
        {ECOSYSTEM_APPS.map((app, i) => {
          const orbX = Math.cos(app.angle * Math.PI / 180) * ORBIT_R;
          const orbY = Math.sin(app.angle * Math.PI / 180) * ORBIT_R;
          const sx = app.scatter.x;
          const sy = app.scatter.y;
          const sr = app.scatter.r;

          const atOrbit = phase >= 2;
          const tx = atOrbit ? orbX : sx;
          const ty = atOrbit ? orbY : sy;
          const rot = atOrbit ? 0 : sr;

          return (
            <div
              key={app.name}
              style={{
                position: "absolute",
                left: "50%", top: "50%",
                opacity: phase >= 1 ? 1 : 0,
                transform: `translate(calc(-50% + ${tx}px), calc(-50% + ${ty}px)) rotate(${rot}deg)`,
                transition: phase >= 2
                  ? `transform 0.88s cubic-bezier(0.16,1,0.3,1) ${i * 0.085}s, opacity 0.2s ease`
                  : "opacity 0.1s ease",
                zIndex: 2,
                willChange: "transform, opacity",
              }}
            >
              <div style={{
                display: "flex", alignItems: "center", gap: 8,
                background: "#ffffff",
                border: "1px solid rgba(0,0,0,0.10)",
                borderRadius: 50,
                padding: "8px 14px 8px 8px",
                boxShadow: "0 2px 14px rgba(0,0,0,0.10), 0 1px 4px rgba(0,0,0,0.05)",
                whiteSpace: "nowrap",
              }}>
                <div style={{
                  width: 28, height: 28, borderRadius: "50%",
                  background: app.bg,
                  display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                  animation: phase >= 5 ? `iconPing ${2.4 + (i % 3) * 0.4}s ease-in-out ${i * 0.3}s infinite` : "none",
                }}>
                  {app.icon}
                </div>
                <span style={{ fontSize: 12, fontWeight: 600, color: "#1d1d1f" }}>{app.name}</span>
              </div>
            </div>
          );
        })}

        {/* Center FschoolAI logo */}
        <div style={{
          position: "absolute", left: "50%", top: "50%",
          zIndex: 3,
          opacity: phase >= 3 ? 1 : 0,
          transform: `translate(-50%,-50%) scale(${phase >= 3 ? 1 : 0.5})`,
          transition: "opacity 0.5s ease, transform 0.55s cubic-bezier(0.16,1,0.3,1)",
        }}>
          {/* Outer pulse ring */}
          <div style={{
            position: "absolute", inset: -12, borderRadius: "50%",
            border: "1px solid rgba(0,0,0,0.07)",
            animation: phase >= 5 ? "centerOrb 3s ease-in-out infinite" : "none",
          }} />
          {/* Logo circle */}
          <div style={{
            width: 80, height: 80, borderRadius: "50%",
            background: "#fff",
            border: "1px solid rgba(0,0,0,0.09)",
            boxShadow: "0 8px 32px rgba(0,0,0,0.10)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <img src="/logo.jpeg" style={{ width: 48, height: 48, borderRadius: 12, mixBlendMode: "multiply" }} alt="FschoolAI" />
          </div>
        </div>
      </div>

      </div>{/* end eco-orbital-wrap */}

      {/* Mobile fallback — two-row marquee, real brand icons */}
      <div className="eco-marquee-wrap" style={{ overflow: "hidden", paddingBottom: 8 }}>
        {/* Row 1 — scrolls left */}
        <div style={{ display: "flex", gap: 12, marginBottom: 12, animation: "marqueeL 22s linear infinite", width: "max-content" }}>
          {[...ECOSYSTEM_APPS, ...ECOSYSTEM_APPS].map((app, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, background: "#fff", border: "1px solid rgba(0,0,0,0.09)", borderRadius: 50, padding: "9px 16px 9px 10px", flexShrink: 0, boxShadow: "0 1px 6px rgba(0,0,0,0.07)" }}>
              <div style={{ width: 26, height: 26, borderRadius: "50%", background: app.bg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{app.icon}</div>
              <span style={{ fontSize: 13, fontWeight: 600, color: "#1d1d1f", whiteSpace: "nowrap" }}>{app.name}</span>
            </div>
          ))}
        </div>
        {/* Row 2 — scrolls right */}
        <div style={{ display: "flex", gap: 12, animation: "marqueeR 26s linear infinite", width: "max-content" }}>
          {[...[...ECOSYSTEM_APPS].reverse(), ...[...ECOSYSTEM_APPS].reverse()].map((app, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, background: "#fff", border: "1px solid rgba(0,0,0,0.09)", borderRadius: 50, padding: "9px 16px 9px 10px", flexShrink: 0, boxShadow: "0 1px 6px rgba(0,0,0,0.07)" }}>
              <div style={{ width: 26, height: 26, borderRadius: "50%", background: app.bg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{app.icon}</div>
              <span style={{ fontSize: 13, fontWeight: 600, color: "#1d1d1f", whiteSpace: "nowrap" }}>{app.name}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Bottom tagline */}
      <Reveal delay={0.1}>
        <p style={{ textAlign: "center", fontSize: 13, color: "#a3a3a3", marginTop: 52, lineHeight: 1.7, padding: "0 20px" }}>
          Canvas · YouTube · Google Drive · Microsoft · Discord · PDFs. Your academic world, connected.
        </p>
      </Reveal>
    </section>
  );
}

// ── Three Moments — premium Apple-editorial split rows ───────────────────────
// Each row: full-bleed section, alternating layout, Apple-scale display type.
// Animations: count-up on 47, waveform bars, staggered transcript, concept pills.

// RecordingAppMockup — realistic iPhone-frame showing FschoolAI live recording UI
const TX = [
  { speaker: "Prof", text: "Working memory has strict capacity limits, roughly seven items." },
  { speaker: "You",  text: "Is this the same as Miller's Law?" },
  { speaker: "Prof", text: "Exactly. Seven plus or minus two chunks per modality." },
  { speaker: "Prof", text: "Germane load builds long-term schema. Design for it." },
];
const WAVE_H = [14,22,36,18,44,28,16,40,24,48,20,34,18,42,26,36,16,40,22,32,18,38,24,30];
const WAVE_D = [0,.12,.24,.06,.18,.30,.08,.22,.14,.28,.04,.16,.20,.10,.26,.02,.18,.08,.24,.14,.06,.22,.16,.10];

function RecordingAppMockup() {
  const [ref, inView] = useInView(0.3);
  const [secs, setSecs] = useState(0);
  const [shownLines, setShownLines] = useState(0);
  const loopRef = useRef(0);

  useEffect(() => {
    if (!inView) return;
    let tick: ReturnType<typeof setInterval>;
    let ids: ReturnType<typeof setTimeout>[] = [];

    function startLoop() {
      setSecs(0);
      setShownLines(0);
      tick = setInterval(() => setSecs(s => s + 1), 1000);
      ids = [
        setTimeout(() => setShownLines(1), 900),
        setTimeout(() => setShownLines(2), 2800),
        setTimeout(() => setShownLines(3), 5000),
        setTimeout(() => setShownLines(4), 7400),
        setTimeout(() => {
          clearInterval(tick);
          ids.forEach(clearTimeout);
          startLoop();
        }, 11000),
      ];
    }

    startLoop();
    return () => { clearInterval(tick); ids.forEach(clearTimeout); };
  }, [inView]); // eslint-disable-line

  const mm = String(Math.floor(secs / 60)).padStart(2, "0");
  const ss = String(secs % 60).padStart(2, "0");

  return (
    <div ref={ref} style={{ display: "flex", justifyContent: "center" }}>
      {/* Phone frame */}
      <div style={{
        width: 260, borderRadius: 28,
        background: "#ffffff",
        boxShadow: "0 24px 64px rgba(0,0,0,0.13), 0 4px 16px rgba(0,0,0,0.08), inset 0 0 0 1px rgba(0,0,0,0.09)",
        overflow: "hidden", fontFamily: FONT,
      }}>
        {/* iOS status bar */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px 6px", background: "#fff" }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: "#1d1d1f" }}>9:41</span>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            {/* WiFi bars */}
            <svg width="14" height="10" viewBox="0 0 14 10" fill="none">
              <rect x="0" y="6" width="2.5" height="4" rx="0.5" fill="#1d1d1f"/>
              <rect x="3.5" y="4" width="2.5" height="6" rx="0.5" fill="#1d1d1f"/>
              <rect x="7" y="2" width="2.5" height="8" rx="0.5" fill="#1d1d1f"/>
              <rect x="10.5" y="0" width="2.5" height="10" rx="0.5" fill="#1d1d1f"/>
            </svg>
            {/* Battery */}
            <svg width="22" height="11" viewBox="0 0 22 11" fill="none">
              <rect x="0.5" y="0.5" width="18" height="10" rx="2.5" stroke="#1d1d1f" strokeOpacity="0.35"/>
              <rect x="2" y="2" width="13" height="7" rx="1.5" fill="#1d1d1f"/>
              <path d="M19.5 3.5v4c.83-.37 1.5-1.1 1.5-2s-.67-1.63-1.5-2z" fill="#1d1d1f" fillOpacity="0.4"/>
            </svg>
          </div>
        </div>

        {/* App navbar */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 14px 10px", borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <div style={{
              width: 8, height: 8, borderRadius: "50%", background: "#ff3b30", flexShrink: 0,
              animation: inView ? "recPulse 1.2s ease-in-out infinite" : "none",
            }} />
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: "-0.01em", color: "#1d1d1f", lineHeight: 1.2 }}>BIOL 201</div>
              <div style={{ fontSize: 9, fontWeight: 600, letterSpacing: "0.08em", color: "#a3a3a3", textTransform: "uppercase" }}>Recording</div>
            </div>
          </div>
          <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: "-0.04em", color: "#1d1d1f", fontVariantNumeric: "tabular-nums" }}>{mm}:{ss}</span>
        </div>

        {/* Waveform */}
        <div style={{ display: "flex", alignItems: "center", gap: 2, height: 44, padding: "0 14px", background: "#fafafa", justifyContent: "center" }}>
          {WAVE_H.map((h, i) => (
            <div key={i} style={{
              width: 3, borderRadius: 2, flexShrink: 0,
              background: i < 18 ? `rgba(0,0,0,${0.65 - i * 0.01})` : "rgba(0,0,0,0.09)",
              height: h, transformOrigin: "center",
              animation: inView && i < 18 ? `waveBar 0.65s ease-in-out ${WAVE_D[i]}s infinite` : "none",
            }} />
          ))}
        </div>

        {/* Live transcript section */}
        <div style={{ padding: "10px 14px 16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
            <div style={{ height: 1, flex: 1, background: "rgba(0,0,0,0.07)" }} />
            <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: "0.10em", color: "#c0c0c0", textTransform: "uppercase" }}>Live transcript</span>
            <div style={{ height: 1, flex: 1, background: "rgba(0,0,0,0.07)" }} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, minHeight: 84 }}>
            {TX.slice(0, shownLines).map((line, i) => (
              <div key={i} style={{ display: "flex", gap: 6, alignItems: "baseline", animation: "txIn 0.35s ease both" }}>
                <span style={{
                  fontSize: 9, fontWeight: 700, flexShrink: 0, minWidth: 24,
                  color: line.speaker === "You" ? "#1d1d1f" : "#a3a3a3",
                  letterSpacing: "0.03em",
                }}>{line.speaker}</span>
                <span style={{ fontSize: 11, color: "rgba(0,0,0,0.55)", lineHeight: 1.5 }}>{line.text}</span>
              </div>
            ))}
            {shownLines < TX.length && shownLines > 0 && (
              <div style={{ display: "flex", gap: 3, paddingLeft: 30, paddingTop: 2 }}>
                {[0, .14, .28].map((d, i) => (
                  <div key={i} style={{ width: 4, height: 4, borderRadius: "50%", background: "rgba(0,0,0,0.22)", animation: `dot 0.8s ease-in-out ${d}s infinite` }} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ConceptExtractionVisual — counter 0→8, pills unlock as count rises
const CONCEPT_PILLS = ["Lac Operon","Cell Division","Mitosis","ATP Synthesis","Enzyme Kinetics","CRISPR","Photosynthesis","Gene Expression"];

function ConceptExtractionVisual() {
  const [ref, inView] = useInView(0.25);
  const [count, setCount] = useState(0);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!inView || startedRef.current) return;
    startedRef.current = true;
    let i = 0;
    const id = setInterval(() => {
      i++;
      setCount(i);
      if (i >= 8) clearInterval(id);
    }, 380);
    return () => clearInterval(id);
  }, [inView]);

  return (
    <div ref={ref}>
      {/* Counter row */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 18 }}>
        <span style={{ fontSize: 52, fontWeight: 700, letterSpacing: "-0.04em", color: "#1d1d1f", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{count}</span>
        <span style={{ fontSize: 15, color: "#a3a3a3", fontWeight: 400 }}>/ 47 concepts extracted</span>
      </div>
      {/* Pill grid */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, maxWidth: 340 }}>
        {CONCEPT_PILLS.map((pill, i) => (
          <span key={pill} style={{
            fontSize: 12, fontWeight: 500, padding: "7px 14px",
            borderRadius: 50,
            background: i < count ? "#f5f5f7" : "transparent",
            color: "rgba(0,0,0,0.72)",
            border: "1px solid rgba(0,0,0,0.08)",
            opacity: i < count ? 1 : 0,
            transform: i < count ? "scale(1)" : "scale(0.9)",
            transition: `opacity 0.4s cubic-bezier(0.16,1,0.3,1) ${i * 0.04}s, transform 0.4s cubic-bezier(0.16,1,0.3,1) ${i * 0.04}s, background 0.3s ease`,
            display: "inline-block",
          }}>{pill}</span>
        ))}
      </div>
    </div>
  );
}


function ThreeMoments({ t }: { t: typeof DARK }) {
  const [countRef, count47] = useCountUp(47, 1600);

  const EYEBROW: React.CSSProperties = {
    fontSize: 11, fontWeight: 600, letterSpacing: "0.16em",
    textTransform: "uppercase", color: "rgba(0,0,0,0.30)", marginBottom: 20,
  };
  const DISPLAY: React.CSSProperties = {
    fontSize: "clamp(60px,8.5vw,96px)", fontWeight: 700,
    letterSpacing: "-0.04em", lineHeight: 1.0, color: "#1d1d1f", margin: "0 0 12px",
  };
  const SUBLINE: React.CSSProperties = {
    fontSize: "clamp(16px,2vw,22px)", color: "#6e6e73",
    fontWeight: 400, letterSpacing: "-0.01em", lineHeight: 1.35, margin: "0 0 26px",
  };
  const BODY: React.CSSProperties = {
    fontSize: 17, color: "rgba(0,0,0,0.56)", lineHeight: 1.72,
    maxWidth: "48ch", margin: "0 0 28px",
  };
  const SECTION: React.CSSProperties = {
    padding: "clamp(80px,10vw,120px) clamp(20px,5vw,80px)",
  };
  const INNER: React.CSSProperties = {
    maxWidth: 1100, margin: "0 auto",
    display: "flex", gap: "clamp(40px,6vw,96px)",
    alignItems: "center", flexWrap: "wrap",
  };

  return (
    <>
      {/* ── Row 1: During Lecture ── */}
      <section style={{ ...SECTION, background: "#ffffff" }}>
        <div className="tm-row" style={INNER}>
          <Reveal style={{ flex: "1 1 300px" }}>
            <p style={EYEBROW}>During lecture</p>
            <div style={DISPLAY}>Real-time</div>
            <p style={SUBLINE}>transcription, live as it happens</p>
            <p style={BODY}>
              FschoolAI captures your lectures the moment they start. No typing, no missed words: just the full transcript, ready to search and study from.
            </p>
          </Reveal>
          <Reveal delay={0.12} style={{ flex: "1 1 280px" }}>
            <RecordingAppMockup />
          </Reveal>
        </div>
      </section>

      {/* ── Row 2: After Class ── */}
      <section style={{ ...SECTION, background: "#f5f5f7" }}>
        <div className="tm-row-rev" style={{ ...INNER, flexDirection: "row-reverse" as const }}>
          <Reveal style={{ flex: "1 1 300px" }}>
            <p style={EYEBROW}>After class</p>
            <div ref={countRef} style={DISPLAY}>{count47}</div>
            <p style={SUBLINE}>key concepts extracted per lecture on average</p>
            <p style={BODY}>
              The AI reads through your entire lecture, surfaces the concepts your professor actually emphasised, and connects them to your existing notes.
            </p>
          </Reveal>
          <Reveal delay={0.12} style={{ flex: "1 1 280px" }}>
            <ConceptExtractionVisual />
          </Reveal>
        </div>
      </section>

      {/* ── Row 3: Before the Exam ── */}
      <section style={{ ...SECTION, background: "#ffffff" }}>
        <div className="tm-row" style={INNER}>
          <Reveal style={{ flex: "1 1 300px" }}>
            <p style={EYEBROW}>Before the exam</p>
            <div style={DISPLAY}>1 month</div>
            <p style={SUBLINE}>free on beta signup, no credit card</p>
            <p style={BODY}>
              Start for free. Every tool (live recording, AI tutor, flashcards, study rooms) works from day one. No feature gates, no trial tricks.
            </p>
          </Reveal>
          <Reveal delay={0.15} style={{ flex: "1 1 260px", display: "flex", justifyContent: "center" }}>
            <div style={{
              background: "#000", borderRadius: 22,
              padding: "30px 28px", color: "#fff",
              width: "100%", maxWidth: 290,
              boxShadow: "0 40px 80px rgba(0,0,0,0.22), 0 8px 24px rgba(0,0,0,0.12)",
            }}>
              <p style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.20em", color: "rgba(255,255,255,0.32)", textTransform: "uppercase", marginBottom: 22 }}>FschoolAI Beta</p>
              <p style={{ fontSize: 40, fontWeight: 700, letterSpacing: "-0.04em", lineHeight: 1, marginBottom: 6 }}>Free</p>
              <p style={{ fontSize: 13, color: "rgba(255,255,255,0.42)", marginBottom: 26 }}>First month, always</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {["AI Tutor","Live Recording","Smart Flashcards","Study Rooms"].map((f, i) => (
                  <div key={f} style={{
                    display: "flex", alignItems: "center", gap: 12,
                    animation: `featIn 0.45s ease ${0.35 + i * 0.12}s both`,
                  }}>
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
                      <circle cx="8" cy="8" r="7.25" stroke="rgba(255,255,255,0.16)" strokeWidth="1.5"/>
                      <path d="M5 8l2 2 4-4" stroke="rgba(255,255,255,0.72)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    <span style={{ fontSize: 14, color: "rgba(255,255,255,0.70)", fontFamily: FONT }}>{f}</span>
                  </div>
                ))}
              </div>
            </div>
          </Reveal>
        </div>
      </section>
    </>
  );
}

// ── Block C: Knowledge Map ───────────────────────────────────────────────────
// Animated SVG knowledge graph: FschoolAI as the hub, your courses/resources
// as orbiting nodes. SVG animateMotion sends data-packet dots along the edges.
// stroke-dashoffset draws edges in on scroll. Nodes pulse at staggered rates.

const KM_NODES = [
  { id:"hub",    x:300, y:220, r:38, fill:"#0d0d0f", stroke:"rgba(0,210,190,0.8)",  sw:2.5, label:"",            sub:"" },
  // courses
  { id:"biol",   x:170, y:108, r:26, fill:"rgba(168,130,220,0.14)", stroke:"#a882dc", sw:1.5, label:"BIOL 201",    sub:"Cell Biology" },
  { id:"comp",   x:390, y:82,  r:26, fill:"rgba(148,196,240,0.14)", stroke:"#94c4f0", sw:1.5, label:"COMP 101",    sub:"Intro to CS" },
  { id:"math",   x:470, y:230, r:26, fill:"rgba(96,220,180,0.14)",  stroke:"#60dcb4", sw:1.5, label:"MATH 202",    sub:"Calculus II" },
  { id:"hist",   x:390, y:355, r:26, fill:"rgba(240,164,120,0.14)", stroke:"#f0a478", sw:1.5, label:"HIST 104",    sub:"Modern History" },
  { id:"chem",   x:155, y:330, r:26, fill:"rgba(240,120,160,0.14)", stroke:"#f078a0", sw:1.5, label:"CHEM 110",    sub:"Organic Chem" },
  // resources
  { id:"flash",  x:92,  y:210, r:18, fill:"rgba(0,210,190,0.08)",   stroke:"rgba(0,210,190,0.5)", sw:1, label:"47 flashcards", sub:"" },
  { id:"lec",    x:246, y:48,  r:18, fill:"rgba(0,210,190,0.08)",   stroke:"rgba(0,210,190,0.5)", sw:1, label:"Lecture 4",     sub:"" },
  { id:"assign", x:500, y:340, r:18, fill:"rgba(0,210,190,0.08)",   stroke:"rgba(0,210,190,0.5)", sw:1, label:"Due Friday",    sub:"" },
  { id:"notes",  x:310, y:390, r:18, fill:"rgba(0,210,190,0.08)",   stroke:"rgba(0,210,190,0.5)", sw:1, label:"Smart notes",   sub:"" },
];
// Hub edges (animated data flow), then resource→course connections
const KM_EDGES = [
  {from:"hub",  to:"biol",   delay:0    },
  {from:"hub",  to:"comp",   delay:0.25 },
  {from:"hub",  to:"math",   delay:0.5  },
  {from:"hub",  to:"hist",   delay:0.75 },
  {from:"hub",  to:"chem",   delay:1.0  },
  {from:"biol", to:"flash",  delay:1.25 },
  {from:"comp", to:"lec",    delay:1.5  },
  {from:"math", to:"assign", delay:1.75 },
  {from:"hist", to:"notes",  delay:2.0  },
];

function KnowledgeMap({ t, chromaStyle }: { t: typeof DARK; chromaStyle: React.CSSProperties }) {
  const [containerRef, inView] = useInView(0.18);

  function nodeById(id: string) { return KM_NODES.find(n => n.id === id)!; }

  return (
    <section style={{
      // Colour-to-colour gradient: no transparent overlays — they create banding.
      // top 120px: ecosystem gray → dark  |  bottom 120px: dark → white
      background: "#fafafa",
      padding: "100px 20px 80px",
      position: "relative",
      overflow: "hidden",
    }}>
      {/* Ambient glow */}
      <div aria-hidden="true" style={{
        position: "absolute", top: "20%", left: "50%", transform: "translateX(-50%)",
        width: "60%", height: 300,
        background: "radial-gradient(ellipse 60% 50% at 50% 50%, rgba(0,210,190,0.05) 0%, transparent 100%)",
        pointerEvents: "none",
      }} />

      <Reveal style={{ textAlign: "center", marginBottom: 56 }}>
        <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.18em", textTransform: "uppercase",
          color: "#a3a3a3", marginBottom: 16 }}>Knowledge Graph</p>
        <h2 style={{ fontSize: "clamp(28px,4.5vw,52px)", fontWeight: 700, letterSpacing: "-0.03em",
          lineHeight: 1.05, color: "#141414", margin: "0 0 16px" }}>
          Your academic world, connected.
        </h2>
        <p style={{ fontSize: 16, color: "#737373", maxWidth: 440,
          margin: "0 auto", lineHeight: 1.6 }}>
          FschoolAI builds a living map of your courses, lectures, notes and deadlines,
          so every answer is grounded in your actual world.
        </p>
      </Reveal>

      {/* SVG Knowledge Graph */}
      <div ref={containerRef} style={{ maxWidth: 620, margin: "0 auto" }}>
        <svg viewBox="0 0 600 440" width="100%" style={{ overflow: "visible" }}>
          <defs>
            {/* Gradient for data-packet dots */}
            <radialGradient id="packetGrad">
              <stop offset="0%" stopColor="rgba(0,210,190,1)" />
              <stop offset="100%" stopColor="rgba(0,210,190,0)" />
            </radialGradient>
            {/* Edge paths (needed for animateMotion) */}
            {KM_EDGES.map(({ from, to }) => {
              const a = nodeById(from), b = nodeById(to);
              return (
                <path key={`path-${from}-${to}`} id={`km-${from}-${to}`}
                  d={`M${a.x} ${a.y} L${b.x} ${b.y}`} />
              );
            })}
          </defs>

          {/* Edges — draw in via stroke-dashoffset on inView */}
          {KM_EDGES.map(({ from, to, delay }) => {
            const a = nodeById(from), b = nodeById(to);
            const len = Math.hypot(b.x - a.x, b.y - a.y);
            const isHub = from === "hub";
            return (
              <line key={`e-${from}-${to}`}
                x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                stroke={isHub ? "rgba(0,210,190,0.22)" : "rgba(0,210,190,0.12)"}
                strokeWidth={isHub ? 1.2 : 0.8}
                strokeDasharray={`${len} ${len}`}
                strokeDashoffset={inView ? 0 : len}
                style={{ transition: `stroke-dashoffset 0.9s cubic-bezier(0.16,1,0.3,1) ${delay + 0.3}s` }}
              />
            );
          })}

          {/* Animated data-packet dots traveling along hub edges */}
          {inView && KM_EDGES.filter(e => e.from === "hub").map(({ from, to, delay }) => (
            <circle key={`pkt-${from}-${to}`} r="4" fill="url(#packetGrad)"
              opacity="0.9">
              <animateMotion
                dur="2.8s"
                begin={`${delay + 0.8}s`}
                repeatCount="indefinite"
                calcMode="spline"
                keySplines="0.4 0 0.6 1"
              >
                <mpath href={`#km-${from}-${to}`} />
              </animateMotion>
            </circle>
          ))}

          {/* Nodes */}
          {KM_NODES.map((node, i) => {
            const isHub = node.id === "hub";
            const isResource = ["flash","lec","assign","notes"].includes(node.id);
            return (
              <g key={node.id} style={{
                opacity: inView ? 1 : 0,
                transition: `opacity 0.5s ease ${i * 0.08 + 0.2}s`,
              }}>
                {/* Outer glow ring for hub */}
                {isHub && (
                  <circle cx={node.x} cy={node.y} r={node.r + 10}
                    fill="none" stroke="rgba(0,210,190,0.12)" strokeWidth={8}
                    style={{ animation: "centerOrb 3s ease-in-out infinite" }}
                  />
                )}
                {/* Node circle */}
                <circle cx={node.x} cy={node.y} r={node.r}
                  fill={node.fill} stroke={node.stroke} strokeWidth={node.sw}
                  style={{
                    animation: !isHub
                      ? `iconPing ${2.4 + (i % 3) * 0.4}s ease-in-out ${i * 0.3}s infinite`
                      : "centerOrb 3s ease-in-out infinite",
                  }}
                />
                {/* Hub FschoolAI mark */}
                {isHub && (
                  <image href="/logo.jpeg" x={node.x - 20} y={node.y - 20}
                    width={40} height={40}
                    clipPath="circle()"
                    style={{ borderRadius: "50%" }}
                  />
                )}
                {/* Labels */}
                {node.label && (
                  <text x={node.x} y={node.y + node.r + (isResource ? 13 : 16)}
                    textAnchor="middle"
                    fontSize={isResource ? 8 : 9}
                    fontWeight={600}
                    letterSpacing="0.02em"
                    fill={isResource ? "rgba(0,210,190,0.7)" : "rgba(255,255,255,0.75)"}
                    fontFamily="inherit"
                  >{node.label}</text>
                )}
                {node.sub && (
                  <text x={node.x} y={node.y + node.r + 27}
                    textAnchor="middle" fontSize={8}
                    fill="rgba(0,0,0,0.40)"
                    fontFamily="inherit"
                  >{node.sub}</text>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      {/* Three key callouts */}
      <Reveal delay={0.2}>
        <div style={{
          display: "flex", gap: "clamp(16px,3vw,40px)", justifyContent: "center",
          flexWrap: "wrap", marginTop: 64, maxWidth: 720, margin: "64px auto 0",
        }}>
          {[
            { icon: "⚡", title: "Instant context", body: "Every answer references your actual lecture notes, not generic internet knowledge." },
            { icon: "🕸", title: "Living knowledge graph", body: "Connections between concepts, deadlines and notes update in real time as you study." },
            { icon: "🎯", title: "Zero setup", body: "Sync Canvas once. FschoolAI maps your entire academic world automatically." },
          ].map(({ icon, title, body }) => (
            <div key={title} style={{
              flex: "1 1 180px", maxWidth: 220,
              padding: "20px 0",
              borderTop: "1px solid rgba(255,255,255,0.08)",
            }}>
              <div style={{ fontSize: 22, marginBottom: 10 }}>{icon}</div>
              <p style={{ fontSize: 14, fontWeight: 600, color: "rgba(255,255,255,0.88)", marginBottom: 6 }}>{title}</p>
              <p style={{ fontSize: 13, color: "#737373", lineHeight: 1.6 }}>{body}</p>
            </div>
          ))}
        </div>
      </Reveal>
    </section>
  );
}

// ── Voice AI Demo mockup ──────────────────────────────────────────────────────
function VoiceAIDemo({ t }: { t: typeof DARK }) {
  const [containerRef, inView] = useInView(0.3);
  const [phase, setPhase] = useState(0);
  const startedRef = useRef(false);
  const REPLY = "The Krebs cycle occurs in the mitochondrial matrix. Your professor highlighted two key outputs: ATP and CO₂. According to your Lecture 4 notes, the 8-step cycle is driven by acetyl-CoA.";
  const words = REPLY.split(" ");

  useEffect(() => {
    if (!inView || startedRef.current) return;
    startedRef.current = true;
    const ids = [
      setTimeout(() => setPhase(1), 400),
      setTimeout(() => setPhase(2), 1400),
      setTimeout(() => setPhase(3), 2400),
      setTimeout(() => setPhase(4), 3200),
      setTimeout(() => { setPhase(0); startedRef.current = false; }, 11000),
    ];
    return () => ids.forEach(clearTimeout);
  }, [inView]);

  useEffect(() => {
    if (phase !== 0 || !inView) return;
    const ids = [
      setTimeout(() => setPhase(1), 400),
      setTimeout(() => setPhase(2), 1400),
      setTimeout(() => setPhase(3), 2400),
      setTimeout(() => setPhase(4), 3200),
      setTimeout(() => setPhase(0), 11000),
    ];
    return () => ids.forEach(clearTimeout);
  }, [phase, inView]); // eslint-disable-line

  const show = (on: boolean): React.CSSProperties => ({
    opacity: on ? 1 : 0, transform: on ? "translateY(0)" : "translateY(8px)",
    transition: "opacity 0.38s ease, transform 0.38s ease",
  });

  return (
    <div ref={containerRef}>
      <MockCard t={t} style={{ maxWidth: 360, textAlign: "left", padding: "0 0 16px" }}>
        {/* Phone status bar */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px 12px", borderBottom: `1px solid ${t.border}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#34c759" }} />
            <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", color: t.label }}>AI TUTOR · BIOL 201</span>
          </div>
          <span style={{ fontSize: 10, color: t.textFaint }}>LIVE</span>
        </div>

        <div style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: 10, minHeight: 200 }}>
          {/* User voice bubble */}
          <div style={{ ...show(phase >= 1), display: "flex", justifyContent: "flex-end" }}>
            <div style={{ background: t.userBubble, borderRadius: "16px 16px 3px 16px", padding: "9px 13px", fontSize: 13, color: t.text, maxWidth: "80%", display: "flex", alignItems: "center", gap: 7 }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v5M8 23h8"/>
              </svg>
              Explain Krebs cycle from my BIOL notes
            </div>
          </div>

          {/* Thinking dots */}
          <div style={{ ...show(phase >= 2 && phase < 3), display: "flex", gap: 4, paddingLeft: 2 }}>
            {[0, .14, .28].map((d, i) => <div key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: t.textFaint, animation: phase >= 2 && phase < 3 ? `dot .8s ease-in-out ${d}s infinite` : "none" }} />)}
          </div>

          {/* AI response — streams word by word */}
          <div style={{ ...show(phase >= 3) }}>
            <div style={{ background: t.cardInner, border: `1px solid ${t.cardInnerBorder}`, borderRadius: "3px 16px 16px 16px", padding: "11px 13px", fontSize: 13, color: t.textMuted, lineHeight: 1.65 }}>
              {phase >= 3 && words.slice(0, phase >= 4 ? words.length : 12).map((w, i) => (
                <span key={i} style={{ animation: `waveWord 0.25s ease ${i * 0.04}s both`, display: "inline" }}>{w} </span>
              ))}
            </div>
            {/* Source chip */}
            <div style={{ ...show(phase >= 4), display: "flex", alignItems: "center", gap: 5, marginTop: 8, paddingLeft: 2 }}>
              <span style={{ fontSize: 10, color: t.textFaint }}>from</span>
              <span style={{ fontSize: 10, fontWeight: 600, background: t.cardInner, border: `1px solid ${t.cardBorder}`, borderRadius: 4, padding: "1px 7px", color: t.textMuted }}>Lecture 4.pdf</span>
              <span style={{ fontSize: 10, fontWeight: 600, background: t.cardInner, border: `1px solid ${t.cardBorder}`, borderRadius: 4, padding: "1px 7px", color: t.textMuted }}>Week 3 notes</span>
            </div>
          </div>
        </div>

        {/* Mic input bar */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "0 14px 2px", padding: "9px 13px", background: t.cardInner, border: `1px solid ${t.cardBorder}`, borderRadius: 12 }}>
          <span style={{ flex: 1, fontSize: 12, color: t.textFaint }}>Ask about your lectures…</span>
          <div style={{
            width: 28, height: 28, borderRadius: "50%", background: "#141414",
            display: "flex", alignItems: "center", justifyContent: "center",
            animation: phase >= 1 && phase < 2 ? "micPulse 1s ease-in-out infinite" : "none",
          }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round">
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
            </svg>
          </div>
        </div>
      </MockCard>
    </div>
  );
}

// ── Flashcard Gen Demo ────────────────────────────────────────────────────────
const FC_CARDS = [
  { q: "What drives the Krebs cycle?", a: "Acetyl-CoA" },
  { q: "Key output of Krebs cycle?", a: "ATP + CO₂" },
  { q: "Where does Krebs occur?", a: "Mitochondrial matrix" },
  { q: "How many steps in Krebs?", a: "8 enzymatic steps" },
];

function FlashcardGenDemo({ t }: { t: typeof DARK }) {
  const [containerRef, inView] = useInView(0.3);
  const [phase, setPhase] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!inView || startedRef.current) return;
    startedRef.current = true;
    const ids = [
      setTimeout(() => setPhase(1), 500),
      setTimeout(() => setPhase(2), 1200),
      setTimeout(() => setPhase(3), 1900),
      setTimeout(() => setPhase(4), 2600),
      setTimeout(() => setFlipped(true), 4200),
      setTimeout(() => { setFlipped(false); setPhase(0); startedRef.current = false; }, 9000),
    ];
    return () => ids.forEach(clearTimeout);
  }, [inView]);

  useEffect(() => {
    if (phase !== 0 || !inView) return;
    const ids = [
      setTimeout(() => setPhase(1), 500),
      setTimeout(() => setPhase(2), 1200),
      setTimeout(() => setPhase(3), 1900),
      setTimeout(() => setPhase(4), 2600),
      setTimeout(() => setFlipped(true), 4200),
      setTimeout(() => setFlipped(false), 6000),
      setTimeout(() => setPhase(0), 9000),
    ];
    return () => ids.forEach(clearTimeout);
  }, [phase, inView]); // eslint-disable-line

  return (
    <div ref={containerRef}>
      <MockCard t={t} style={{ maxWidth: 360, textAlign: "left" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
          <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#34c759" }} />
          <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", color: t.label }}>FLASHCARDS · BIOL 201</span>
          <span style={{ marginLeft: "auto", fontSize: 11, color: phase >= 4 ? "#34c759" : t.textFaint, fontWeight: 600 }}>
            {phase >= 4 ? `${Math.min(phase, 4)} / 4 created` : "Generating…"}
          </span>
        </div>

        {/* Generated cards stacking in */}
        <div style={{ position: "relative", height: 160, marginBottom: 14 }}>
          {FC_CARDS.slice(0, phase).map((card, i) => (
            <div key={i} style={{
              position: "absolute", top: `${i * 6}px`, left: `${i * 3}px`,
              right: `${-i * 3}px`,
              background: i === phase - 1 ? t.cardBg : t.cardInner,
              border: `1px solid ${t.cardBorder}`,
              borderRadius: 12,
              padding: "14px 16px",
              boxShadow: i === phase - 1 ? "0 4px 20px rgba(0,0,0,0.08)" : "none",
              animation: `cardSlideUp 0.4s cubic-bezier(0.16,1,0.3,1) both`,
              // Card flip for top card
              transformStyle: "preserve-3d",
              transform: i === phase - 1 && flipped ? "rotateY(180deg)" : "rotateY(0deg)",
              transition: "transform 0.5s cubic-bezier(0.16,1,0.3,1)",
            }}>
              {/* Front */}
              <div style={{ backfaceVisibility: "hidden" }}>
                <p style={{ fontSize: 11, fontWeight: 600, color: t.textFaint, marginBottom: 6, letterSpacing: "0.06em" }}>Q</p>
                <p style={{ fontSize: 13, color: t.text, fontWeight: 500, lineHeight: 1.5 }}>{card.q}</p>
              </div>
              {/* Back */}
              <div style={{ position: "absolute", inset: "14px 16px", backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}>
                <p style={{ fontSize: 11, fontWeight: 600, color: "#34c759", marginBottom: 6, letterSpacing: "0.06em" }}>A</p>
                <p style={{ fontSize: 15, color: t.text, fontWeight: 600, lineHeight: 1.5 }}>{card.a}</p>
              </div>
            </div>
          ))}
          {phase === 0 && (
            <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <p style={{ fontSize: 13, color: t.textFaint }}>Tap to generate flashcards →</p>
            </div>
          )}
        </div>

        {/* Tap button */}
        <button style={{
          width: "100%", background: "#141414", color: "#fff", border: "none",
          borderRadius: 10, padding: "11px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: FONT,
          display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
          Create flashcards from notes
        </button>
      </MockCard>
    </div>
  );
}

// ── Live Recording Demo ───────────────────────────────────────────────────────
const LIVE_LINES = [
  { speaker: "Prof", text: "Working memory holds roughly seven chunks at once." },
  { speaker: "You",  text: "Is this the Miller's Law?" },
  { speaker: "Prof", text: "Exactly. Seven plus or minus two. It's fundamental." },
  { speaker: "Prof", text: "Germane load builds long-term schema. Design for it." },
];

function LiveRecordingDemo({ t }: { t: typeof DARK }) {
  const [containerRef, inView] = useInView(0.3);
  const [secs, setSecs] = useState(6);
  const [lines, setLines] = useState(0);
  const [concepts, setConcepts] = useState(0);

  useEffect(() => {
    if (!inView) return;
    const tick = setInterval(() => setSecs(s => s + 1), 1000);
    const t1 = setTimeout(() => setLines(1), 600);
    const t2 = setTimeout(() => { setLines(2); setConcepts(1); }, 2200);
    const t3 = setTimeout(() => setLines(3), 3600);
    const t4 = setTimeout(() => { setLines(4); setConcepts(2); }, 5000);
    const reset = setTimeout(() => { setSecs(6); setLines(0); setConcepts(0); }, 10000);
    return () => { clearInterval(tick); [t1,t2,t3,t4,reset].forEach(clearTimeout); };
  }, [inView]); // eslint-disable-line

  const mm = String(Math.floor(secs / 60)).padStart(2, "0");
  const ss = String(secs % 60).padStart(2, "0");
  const BARS = [14,24,18,36,22,28,16,40,20,32,18,28,22,36,14,28];
  const DELAYS = [0,.1,.2,.06,.15,.25,.08,.18,.12,.22,.04,.14,.18,.08,.24,.02];

  return (
    <div ref={containerRef}>
      <MockCard t={t} style={{ maxWidth: 360, textAlign: "left" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#ff3b30", animation: inView ? "recPulse 1.2s ease-in-out infinite" : "none" }} />
            <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: "-0.02em", color: t.text, fontVariantNumeric: "tabular-nums" }}>{mm}:{ss}</span>
            <span style={{ fontSize: 10, fontWeight: 600, color: t.label, letterSpacing: "0.08em" }}>LECTURE</span>
          </div>
          {concepts > 0 && (
            <span style={{ fontSize: 11, fontWeight: 600, color: "#34c759", animation: "waveWord 0.3s ease both" }}>
              {concepts * 12 + 23} concepts extracted
            </span>
          )}
        </div>

        {/* Waveform */}
        <div style={{ display: "flex", alignItems: "center", gap: 2, height: 36, marginBottom: 12 }}>
          {BARS.map((h, i) => (
            <div key={i} style={{
              width: 3, borderRadius: 2, flexShrink: 0,
              background: i < 12 ? (t === DARK ? "rgba(255,255,255,0.7)" : "rgba(0,0,0,0.65)") : "rgba(0,0,0,0.12)",
              height: h,
              animation: inView && i < 12 ? `waveBar 0.65s ease-in-out ${DELAYS[i]}s infinite` : "none",
            }} />
          ))}
        </div>

        {/* Speaker turns */}
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          {LIVE_LINES.slice(0, lines).map((line, i) => (
            <div key={i} style={{ display: "flex", gap: 7, alignItems: "baseline", animation: "txIn 0.3s ease both" }}>
              <span style={{ fontSize: 9, fontWeight: 700, flexShrink: 0, color: line.speaker === "You" ? t.text : t.label, minWidth: 26 }}>{line.speaker}</span>
              <span style={{ fontSize: 12, color: t.textMuted, lineHeight: 1.5 }}>{line.text}</span>
            </div>
          ))}
          {lines < LIVE_LINES.length && lines > 0 && (
            <div style={{ display: "flex", gap: 3, paddingLeft: 33, paddingTop: 2 }}>
              {[0,.14,.28].map((d,i) => <div key={i} style={{ width: 4, height: 4, borderRadius: "50%", background: t.textFaint, animation: `dot .8s ease-in-out ${d}s infinite` }} />)}
            </div>
          )}
        </div>
      </MockCard>
    </div>
  );
}

// ── AIDemoSection — replaces FeaturesShowcase ─────────────────────────────────
const DEMO_TABS = [
  { id: "voice",     word: "AI Tutor",     label: "AI Tutor",     desc: "Ask anything. The AI answers from your actual lecture notes, not the internet." },
  { id: "flash",     word: "Flashcards",   label: "Flashcards",   desc: "One tap converts your notes into exam-ready flashcards with spaced repetition built in." },
  { id: "review",    word: "Review Mode",  label: "Study Review", desc: "SM-2 spaced repetition: shows each card exactly when you're about to forget it." },
] as const;
type DemoTabId = typeof DEMO_TABS[number]["id"];

function AIDemoSection({ t, ghostRef }: { t: typeof DARK; ghostRef: React.RefObject<HTMLDivElement> }) {
  const [activeIdx, setActiveIdx] = useState(0);
  const [wordVisible, setWordVisible] = useState(true);
  const active = DEMO_TABS[activeIdx];

  useEffect(() => {
    const id = setInterval(() => {
      setWordVisible(false);
      setTimeout(() => { setActiveIdx(i => (i + 1) % DEMO_TABS.length); setWordVisible(true); }, 220);
    }, 5000);
    return () => clearInterval(id);
  }, []);

  function pickTab(idx: number) {
    if (idx === activeIdx) return;
    setWordVisible(false);
    setTimeout(() => { setActiveIdx(idx); setWordVisible(true); }, 180);
  }

  return (
    <section style={{ padding: "100px 20px 80px", background: "#ffffff", textAlign: "center" }}>
      <div ref={ghostRef} aria-hidden="true" style={{ height: 0 }} />

      {/* Relocated tagline */}
      <Reveal>
        <h1 style={{ fontSize: "clamp(36px,5.5vw,64px)", fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1.08, color: "#141414", margin: "0 0 18px" }}>
          Four tools. One intelligence.
        </h1>
      </Reveal>
      <Reveal delay={0.06}>
        <p style={{ fontSize: 18, color: "#737373", maxWidth: 480, margin: "0 auto 72px", lineHeight: 1.65 }}>
          Purpose-built for the way students actually learn, grounded in your courses, not the internet.
        </p>
      </Reveal>

      {/* Naroai-style: "FschoolAI, your [word]" */}
      <Reveal delay={0.1}>
        <p style={{ fontSize: 14, color: "#a3a3a3", marginBottom: 6, fontWeight: 500 }}>FschoolAI, your</p>
        <h2 style={{ fontSize: "clamp(32px,5vw,56px)", fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1.05, marginBottom: 40, color: "#141414" }}>
          <span style={{
            display: "inline-block",
            opacity: wordVisible ? 1 : 0,
            transform: wordVisible ? "translateY(0)" : "translateY(-8px)",
            transition: "opacity 0.18s ease, transform 0.18s ease",
            color: "#0066cc",
          }}>{active.word}</span>
        </h2>
      </Reveal>

      {/* Tab row */}
      <Reveal delay={0.13}>
        <div className="sa-tab-row" style={{ display: "flex", gap: 4, overflowX: "auto", WebkitOverflowScrolling: "touch" as any, scrollbarWidth: "none", justifyContent: "center", marginBottom: 10, padding: "0 8px" }}>
          {DEMO_TABS.map((tab, i) => (
            <button key={tab.id} onClick={() => pickTab(i)} style={{
              flexShrink: 0, padding: "8px 20px", borderRadius: 50, border: "none",
              background: i === activeIdx ? "rgba(0,0,0,0.07)" : "transparent",
              color: i === activeIdx ? "#141414" : "#737373",
              fontWeight: i === activeIdx ? 600 : 500,
              fontSize: 14, cursor: "pointer", fontFamily: FONT,
              transition: "background 0.2s ease, color 0.2s ease",
            }}>{tab.label}</button>
          ))}
        </div>
      </Reveal>

      {/* Tab description */}
      <Reveal delay={0.15}>
        <p style={{ fontSize: 15, color: "#737373", maxWidth: 380, margin: "0 auto 40px", lineHeight: 1.6, opacity: wordVisible ? 1 : 0, transition: "opacity 0.2s ease" }}>
          {active.desc}
        </p>
      </Reveal>

      {/* Demo card — glassmorphic border + content */}
      <Reveal delay={0.18}>
        <div style={{
          maxWidth: 420, margin: "0 auto",
          background: "linear-gradient(white,white) padding-box, linear-gradient(135deg,#b8a0dc,#f0a4bc,#94c4f0,#96e8a8) border-box",
          border: "1.5px solid transparent", borderRadius: 24,
          boxShadow: "0 20px 50px rgba(0,0,0,0.10), 0 4px 16px rgba(0,0,0,0.06)",
        }}>
          <div style={{ background: "rgba(255,255,255,0.97)", borderRadius: 22, padding: 8, minHeight: 340, overflow: "hidden" }}>
            <div key={active.id} style={{ animation: "saFadeIn 0.3s ease both" }}>
              {active.id === "voice"     && <VoiceAIDemo     t={t} />}
              {active.id === "flash"     && <FlashcardGenDemo t={t} />}
              {active.id === "review" && <SRSReviewMockup t={t} />}
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

// ── Feature Grid — 6 product pillars ─────────────────────────────────────────
const FEATURE_ITEMS = [
  { icon:"🎓", title:"AI Tutor",       desc:"Grounded in your actual lecture notes and syllabus, not the internet.",   bg:"#f0f4ff" },
  { icon:"🎙",  title:"Live Recording", desc:"Real-time transcription with speaker turns. Every lecture, searchable.",   bg:"#fff0f0" },
  { icon:"⚡",  title:"Smart Flashcards",desc:"One tap from any material. Spaced repetition built in for long-term memory.", bg:"#fffbf0" },
  { icon:"🔗",  title:"Canvas Sync",   desc:"All your assignments, due dates and grades pulled directly from your LMS.", bg:"#f0fff4" },
  { icon:"👥",  title:"Study Rooms",   desc:"Shared focus timers, live presence, group AI and whiteboard collaboration.", bg:"#f5f0ff" },
  { icon:"📄",  title:"Document AI",   desc:"Upload PDFs and slides. The AI extracts notes, flashcards and insights.",  bg:"#fff0fa" },
] as const;

function FeatureGrid({ t }: { t: typeof DARK }) {
  return (
    <section style={{ padding: "80px 20px", background: "#f5f5f5" }}>
      <div style={{ maxWidth: 860, margin: "0 auto" }}>
        <Reveal style={{ textAlign: "center", marginBottom: 52 }}>
          <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.16em", textTransform: "uppercase", color: "#a3a3a3", marginBottom: 14 }}>
            Everything you need
          </p>
          <h2 style={{ fontSize: "clamp(28px,4vw,48px)", fontWeight: 700, letterSpacing: "-0.025em", color: "#141414", margin: 0 }}>
            The complete academic OS.
          </h2>
        </Reveal>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 16 }}>
          {FEATURE_ITEMS.map(({ icon, title, desc, bg }, i) => (
            <Reveal key={title} delay={i * 0.06}>
              <div style={{
                background: "#ffffff", borderRadius: 16, padding: "24px 22px",
                border: "1px solid #e6e6e6",
                boxShadow: "0 2px 12px rgba(0,0,0,0.04)",
                transition: "box-shadow 0.2s ease, transform 0.2s ease",
                cursor: "default",
              }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = "0 8px 28px rgba(0,0,0,0.10)"; (e.currentTarget as HTMLElement).style.transform = "translateY(-2px)"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = "0 2px 12px rgba(0,0,0,0.04)"; (e.currentTarget as HTMLElement).style.transform = "translateY(0)"; }}
              >
                <div style={{ width: 44, height: 44, borderRadius: 12, background: bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, marginBottom: 14 }}>
                  {icon}
                </div>
                <p style={{ fontSize: 15, fontWeight: 600, color: "#141414", margin: "0 0 7px", letterSpacing: "-0.01em" }}>{title}</p>
                <p style={{ fontSize: 13, color: "#737373", lineHeight: 1.6, margin: 0 }}>{desc}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── DemoCarousel — naroai-style left/right arrow carousel for 3 demos ────────
const CAROUSEL_DEMOS = [
  {
    id: "voice" as const,
    label: "AI Tutor",
    desc: "Ask anything from your lectures. The AI answers grounded in your actual notes, not the internet.",
  },
  {
    id: "flash" as const,
    label: "Flashcards",
    desc: "One tap converts your notes and lectures into exam-ready flashcards with spaced repetition.",
  },
  {
    id: "grades" as const,
    label: "Grade Tracker",
    desc: "Every Canvas grade and assignment in one view: GPA, completion bars, due dates, live.",
  },
];

function DemoCarousel({ t }: { t: typeof DARK }) {
  const [idx, setIdx] = useState(0);
  const [visible, setVisible] = useState(true);
  const [slideDir, setSlideDir] = useState(0); // -1 left, 1 right

  function go(dir: 1 | -1) {
    setVisible(false); setSlideDir(dir);
    setTimeout(() => { setIdx(i => (i + dir + CAROUSEL_DEMOS.length) % CAROUSEL_DEMOS.length); setVisible(true); }, 200);
  }

  const demo = CAROUSEL_DEMOS[idx];

  return (
    <section style={{ background: "#ffffff", padding: "100px 20px" }}>
      <div style={{ maxWidth: 860, margin: "0 auto", textAlign: "center" }}>
        <Reveal>
          <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.18em", textTransform: "uppercase", color: "#a3a3a3", marginBottom: 10 }}>
            FschoolAI, your
          </p>
          <h2 style={{ fontSize: "clamp(32px,5vw,54px)", fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1.05, color: "#141414", marginBottom: 16, transition: "opacity 0.2s ease", opacity: visible ? 1 : 0 }}>
            {demo.label}
          </h2>
          <p style={{ fontSize: 16, color: "#737373", maxWidth: 400, margin: "0 auto 52px", lineHeight: 1.65, opacity: visible ? 1 : 0, transition: "opacity 0.2s ease 0.05s" }}>
            {demo.desc}
          </p>
        </Reveal>

        {/* Carousel row: arrow + demo + arrow */}
        <div style={{ display: "flex", alignItems: "center", gap: 20, justifyContent: "center" }}>
          {/* Left arrow — naroai style */}
          <button onClick={() => go(-1)} aria-label="Previous" style={{
            width: 44, height: 44, borderRadius: "50%", border: "1.5px solid #e6e6e6",
            background: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0, transition: "border-color 0.15s, box-shadow 0.15s",
            boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
          }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = "#141414"; (e.currentTarget as HTMLElement).style.boxShadow = "0 2px 8px rgba(0,0,0,0.12)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = "#e6e6e6"; (e.currentTarget as HTMLElement).style.boxShadow = "0 1px 4px rgba(0,0,0,0.06)"; }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#141414" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
          </button>

          {/* Demo content */}
          <div className="feat-card" style={{ flex: 1, maxWidth: 420, opacity: visible ? 1 : 0, transform: visible ? "translateX(0)" : `translateX(${slideDir * 24}px)`, transition: "opacity 0.2s ease, transform 0.2s ease" }}>
            {/* Glassmorphic card */}
            <div style={{
              background: "linear-gradient(white,white) padding-box, linear-gradient(135deg,#b8a0dc,#f0a4bc,#94c4f0,#96e8a8) border-box",
              border: "1.5px solid transparent", borderRadius: 24,
              boxShadow: "0 20px 50px rgba(0,0,0,0.09), 0 4px 16px rgba(0,0,0,0.05)",
              overflow: "hidden",
            }}>
              <div style={{ background: "rgba(255,255,255,0.97)", borderRadius: 22, minHeight: 320 }}>
                <div key={demo.id} style={{ animation: "saFadeIn 0.28s ease both" }}>
                  {demo.id === "voice"     && <VoiceAIDemo      t={t} />}
                  {demo.id === "flash"     && <FlashcardGenDemo  t={t} />}
                  {demo.id === "grades" && <GradeTrackerMockup t={t} />}
                </div>
              </div>
            </div>
          </div>

          {/* Right arrow */}
          <button onClick={() => go(1)} aria-label="Next" style={{
            width: 44, height: 44, borderRadius: "50%", border: "1.5px solid #e6e6e6",
            background: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0, transition: "border-color 0.15s, box-shadow 0.15s",
            boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
          }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = "#141414"; (e.currentTarget as HTMLElement).style.boxShadow = "0 2px 8px rgba(0,0,0,0.12)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = "#e6e6e6"; (e.currentTarget as HTMLElement).style.boxShadow = "0 1px 4px rgba(0,0,0,0.06)"; }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#141414" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg>
          </button>
        </div>

        {/* Dot indicators */}
        <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 28 }}>
          {CAROUSEL_DEMOS.map((_, i) => (
            <button key={i} onClick={() => { setVisible(false); setTimeout(() => { setIdx(i); setVisible(true); }, 200); }}
              style={{ width: i === idx ? 24 : 8, height: 8, borderRadius: 4, border: "none", cursor: "pointer", padding: 0, transition: "width 0.25s ease, background 0.25s ease", background: i === idx ? "#141414" : "#d4d4d4" }} />
          ))}
        </div>
      </div>
    </section>
  );
}

// ── NeuralCoreSection — Apple asymmetric, live data stream ───────────────────
// LEFT: bold stats. RIGHT: real-time AI event stream — terminal aesthetic.
// Zero rotation, zero orbit. Completely distinct from Ecosystem marquee.
const STREAM_EVENTS = [
  { type: "SYNC",  color: "#34c759", text: "Canvas BIOL 201: 3 new assignments imported"     },
  { type: "INDEX", color: "#0066cc", text: "Lecture 4.pdf: 47 key concepts extracted"         },
  { type: "FLASH", color: "#ff9500", text: "12 flashcards generated from your BIOL notes"      },
  { type: "TRACK", color: "#ff3b30", text: "Cell Division quiz: due Friday 11:59 PM"          },
  { type: "LINK",  color: "#5856d6", text: "Cross-referenced COMP 101 with Study Guide"        },
  { type: "LEARN", color: "#34c759", text: "Pattern: stronger in theory, weaker in application"},
  { type: "SYNC",  color: "#0066cc", text: "MATH 202 lecture: 23 min, 31 concepts indexed"    },
  { type: "GRADE", color: "#ff9500", text: "Grade updated: BIOL assignment 84% · B"            },
];

function NeuralCoreSection({ t }: { t: typeof DARK }) {
  const [visibleLines, setVisibleLines] = useState<(typeof STREAM_EVENTS[number] & { ts: string })[]>([]);
  const [containerRef, inView] = useInView(0.2);

  useEffect(() => {
    if (!inView) return;
    let idx = 0;
    const tick = () => {
      const ev = STREAM_EVENTS[idx % STREAM_EVENTS.length];
      const now = new Date();
      const ts = `${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}:${String(now.getSeconds()).padStart(2,"0")}`;
      setVisibleLines(prev => { const next = [...prev, { ...ev, ts }]; return next.slice(-6); });
      idx++;
    };
    tick();
    const id = setInterval(tick, 1800);
    return () => clearInterval(id);
  }, [inView]);

  return (
    <section ref={containerRef} style={{ background: "linear-gradient(180deg,#090909 0%,#0c0c0f 100%)", padding: "clamp(80px,10vw,120px) 20px", overflow: "hidden", position: "relative" }}>
      <div aria-hidden="true" style={{ position: "absolute", top: 0, left: "50%", transform: "translateX(-50%)", width: "60%", height: 260, background: "radial-gradient(ellipse 55% 40% at 50% 0%, rgba(0,102,204,0.10) 0%, transparent 100%)", pointerEvents: "none" }} />

      <div style={{ maxWidth: 980, margin: "0 auto", display: "flex", gap: "clamp(40px,6vw,80px)", alignItems: "center", flexWrap: "wrap", position: "relative", zIndex: 1 }}>

        {/* LEFT — stats + copy */}
        <div style={{ flex: "1 1 300px" }}>
          <Reveal>
            <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.2em", textTransform: "uppercase", color: "rgba(0,210,190,0.65)", marginBottom: 22 }}>Intelligence Layer</p>
            <h2 style={{ fontSize: "clamp(28px,4.5vw,50px)", fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1.1, color: "#f5f5f5", margin: "0 0 20px" }}>
              Every course.<br />Every lecture.<br />One mind.
            </h2>
            <p style={{ fontSize: 15, color: "rgba(255,255,255,0.40)", lineHeight: 1.75, marginBottom: 44, maxWidth: 320 }}>
              FschoolAI builds a living model of your academic world, grounding every answer in your actual notes, deadlines and study history.
            </p>
          </Reveal>
          <div style={{ display: "flex", gap: 32, flexWrap: "wrap" }}>
            {[
              { val: "47", sub: "concepts per lecture" },
              { val: "< 1s", sub: "indexing time" },
              { val: "100%", sub: "private to you" },
            ].map(({ val, sub }, i) => (
              <Reveal key={val} delay={i * 0.08}>
                <div>
                  <p style={{ fontSize: "clamp(26px,3.5vw,38px)", fontWeight: 700, letterSpacing: "-0.04em", lineHeight: 1, color: "#f5f5f5", margin: "0 0 6px" }}>{val}</p>
                  <p style={{ fontSize: 11, color: "rgba(255,255,255,0.30)", letterSpacing: "0.02em" }}>{sub}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>

        {/* RIGHT — live event stream */}
        <div style={{ flex: "1 1 320px" }}>
          <Reveal delay={0.12}>
            <div style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 18, overflow: "hidden", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.06), 0 24px 60px rgba(0,0,0,0.45)" }}>
              {/* Titlebar */}
              <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "11px 16px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                {["#ff5f57","#ffbd2e","#28c840"].map(c => <div key={c} style={{ width: 10, height: 10, borderRadius: "50%", background: c }} />)}
                <span style={{ fontSize: 10, color: "rgba(255,255,255,0.22)", marginLeft: 8, fontFamily: "monospace" }}>fschoolai · neural_core</span>
                <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 5 }}>
                  <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#34c759", animation: "pulseGlow 2s ease-in-out infinite" }} />
                  <span style={{ fontSize: 9, color: "rgba(255,255,255,0.28)", fontFamily: "monospace", letterSpacing: "0.06em" }}>LIVE</span>
                </div>
              </div>
              {/* Stream */}
              <div style={{ padding: "14px 16px", minHeight: 250, display: "flex", flexDirection: "column", gap: 9, fontFamily: "monospace" }}>
                {visibleLines.map((ev, i) => (
                  <div key={i} style={{ display: "flex", gap: 9, alignItems: "flex-start", animation: "streamIn 0.3s cubic-bezier(0.16,1,0.3,1) both" }}>
                    <span style={{ fontSize: 9, color: "rgba(255,255,255,0.18)", paddingTop: 2, flexShrink: 0 }}>{ev.ts}</span>
                    <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.06em", padding: "2px 7px", borderRadius: 4, background: `${ev.color}14`, color: ev.color, flexShrink: 0, border: `1px solid ${ev.color}28` }}>{ev.type}</span>
                    <span style={{ color: "rgba(255,255,255,0.48)", lineHeight: 1.55, fontSize: 11 }}>{ev.text}</span>
                  </div>
                ))}
                <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 2 }}>
                  <span style={{ color: "rgba(0,210,190,0.55)", fontSize: 12 }}>›</span>
                  <div style={{ width: 7, height: 13, background: "rgba(0,210,190,0.55)", borderRadius: 1, animation: "micPulse 1s step-end infinite" }} />
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

// ── Premium CTA — full-bleed get-started section, auth modal triggers ─────────
// No external links. "Create account" → signup, "Log in" → login.
// Animated: floating orb bg, staggered text entrance, pulsing ring on button.

function PremiumCTA({ onSignup, onLogin }: { onSignup: () => void; onLogin: () => void }) {
  const [ref, inView] = useInView(0.12);
  const [btnHover, setBtnHover] = useState(false);
  // Real waitlist size — only surfaced once it clears 1,000 (no fixed/vanity number).
  const [wlTotal, setWlTotal] = useState<number | null>(null);
  useEffect(() => {
    fetch("/api/waitlist?action=stats")
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d && typeof d.total === "number") setWlTotal(d.total); })
      .catch(() => {});
  }, []);

  return (
    <section style={{
      // Apple MacBook Air tile blue — exact product section treatment
      background: "linear-gradient(180deg, #b8d4e8 0%, #cce0ee 35%, #d8eaf5 65%, #e4f1fb 100%)",
      padding: "clamp(100px,13vw,160px) 20px",
      textAlign: "center",
      position: "relative",
      overflow: "hidden",
    }}>
      {/* ── Background: slow-breathing radial grid ── */}
      <div aria-hidden="true" style={{
        position: "absolute", inset: 0, pointerEvents: "none",
        backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.35) 1px, transparent 1px)",
        backgroundSize: "40px 40px",
        animation: "ctaGridBreath 8s ease-in-out infinite",
        opacity: 0.9,
      }} />
      {/* Warm center glow */}
      <div aria-hidden="true" style={{
        position: "absolute", top: "50%", left: "50%",
        transform: "translate(-50%,-50%)",
        width: "80%", maxWidth: 800, height: 400,
        background: "radial-gradient(ellipse 60% 50% at 50% 50%, rgba(255,255,255,0.40) 0%, rgba(255,255,255,0.10) 55%, transparent 100%)",
        animation: "ctaGlowPulse 6s ease-in-out infinite",
        pointerEvents: "none",
      }} />

      <div ref={ref} style={{ position: "relative", zIndex: 1, maxWidth: 680, margin: "0 auto" }}>

        {/* Eyebrow */}
        <p style={{
          fontSize: 11, fontWeight: 600, letterSpacing: "0.16em",
          textTransform: "uppercase", color: "rgba(0,40,80,0.50)", marginBottom: 22,
          opacity: inView ? 1 : 0,
          transform: inView ? "none" : "translateY(12px)",
          transition: "opacity 0.7s ease, transform 0.7s cubic-bezier(0.16,1,0.3,1)",
        }}>Get started today</p>

        {/* Headline */}
        <h2 style={{
          fontSize: "clamp(44px,6.5vw,84px)", fontWeight: 600,
          letterSpacing: "-0.03em", lineHeight: 1.03, color: "#0d2b40",
          margin: "0 0 20px", fontFamily: FONT,
          opacity: inView ? 1 : 0,
          transform: inView ? "none" : "translateY(22px) scale(0.97)",
          transition: "opacity 0.72s ease 0.07s, transform 0.72s cubic-bezier(0.16,1,0.3,1) 0.07s",
        }}>
          Launching<br />August 1st.
        </h2>

        {/* Body */}
        <p style={{
          fontSize: 19, color: "rgba(0,40,80,0.62)", lineHeight: 1.68,
          margin: "0 auto 48px", maxWidth: "36ch", fontFamily: FONT,
          opacity: inView ? 1 : 0,
          transform: inView ? "none" : "translateY(16px)",
          transition: "opacity 0.72s ease 0.14s, transform 0.72s cubic-bezier(0.16,1,0.3,1) 0.14s",
        }}>
          Get early access. Every tool from day one. No credit card, no feature gates.
        </p>

        {/* Buttons */}
        <div style={{
          display: "flex", gap: 14, justifyContent: "center", flexWrap: "wrap",
          opacity: inView ? 1 : 0,
          transform: inView ? "none" : "translateY(14px)",
          transition: "opacity 0.72s ease 0.20s, transform 0.72s cubic-bezier(0.16,1,0.3,1) 0.20s",
        }}>
          {/* Primary — shimmer + scale on hover */}
          <button onClick={onSignup}
            onMouseEnter={() => setBtnHover(true)}
            onMouseLeave={() => setBtnHover(false)}
            style={{
              background: "#0071e3", color: "#fff", border: "none",
              borderRadius: 980, padding: "16px 34px", fontSize: 17, fontWeight: 400,
              cursor: "pointer", fontFamily: FONT,
              transform: btnHover ? "scale(1.03)" : "scale(1)",
              transition: "transform 0.22s cubic-bezier(0.16,1,0.3,1), opacity 0.15s",
              position: "relative", overflow: "hidden",
              boxShadow: btnHover
                ? "0 8px 28px rgba(0,113,227,0.40), 0 2px 8px rgba(0,113,227,0.20)"
                : "0 4px 16px rgba(0,113,227,0.24), 0 1px 4px rgba(0,113,227,0.12)",
            }}
          >
            Join the waitlist
            {/* Shimmer sweep */}
            <span aria-hidden="true" style={{
              position: "absolute", inset: 0,
              background: "linear-gradient(105deg, transparent 30%, rgba(255,255,255,0.28) 50%, transparent 70%)",
              backgroundSize: "200% 100%",
              animation: "btnShimmer 2.8s ease-in-out 1.2s infinite",
              borderRadius: "inherit",
              pointerEvents: "none",
            }} />
          </button>

          {/* Secondary */}
          <button onClick={onLogin} style={{
            background: "rgba(255,255,255,0.60)", color: "#1d4f72",
            border: "1px solid rgba(255,255,255,0.80)",
            borderRadius: 980, padding: "16px 34px", fontSize: 17, fontWeight: 400,
            cursor: "pointer", fontFamily: FONT,
            backdropFilter: "blur(12px)",
            transition: "background 0.18s, transform 0.22s cubic-bezier(0.16,1,0.3,1)",
          }}
            onMouseEnter={e => { const b = e.currentTarget; b.style.background = "rgba(255,255,255,0.85)"; b.style.transform = "scale(1.03)"; }}
            onMouseLeave={e => { const b = e.currentTarget; b.style.background = "rgba(255,255,255,0.60)"; b.style.transform = "scale(1)"; }}
          >Already on the list?</button>
        </div>

        {/* Social proof — real waitlist count, shown only once it's at least 1,000 */}
        {wlTotal != null && wlTotal >= 1000 && (
          <p style={{
            fontSize: 13, color: "rgba(0,40,80,0.45)", marginTop: 30,
            fontFamily: FONT, letterSpacing: "0.01em",
            opacity: inView ? 1 : 0,
            transition: "opacity 0.72s ease 0.30s",
          }}>
            {wlTotal.toLocaleString()} students on the waitlist · free for your first month
          </p>
        )}
      </div>

      <style>{`
        @keyframes ctaFloat { 0%,100%{transform:translate(0,0) scale(1)} 33%{transform:translate(12px,-20px) scale(1.04)} 66%{transform:translate(-8px,12px) scale(0.97)} }
        @keyframes ctaGridBreath { 0%,100%{opacity:0.7;background-size:40px 40px} 50%{opacity:1;background-size:44px 44px} }
        @keyframes ctaGlowPulse { 0%,100%{opacity:0.7;transform:translate(-50%,-50%) scale(1)} 50%{opacity:1;transform:translate(-50%,-50%) scale(1.06)} }
        @keyframes btnShimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
      `}</style>
    </section>
  );
}

// ── Countdown to Aug 1, 2026 ──────────────────────────────────────────────────
const LAUNCH_DATE = new Date("2026-08-01T00:00:00Z").getTime();

// HeroBtnCountdown — live "22d 4h" chip inside the hero CTA button
function HeroBtnCountdown() {
  const [t, setT] = useState({ d: 0, h: 0 });
  useEffect(() => {
    const tick = () => {
      const diff = Math.max(0, LAUNCH_DATE - Date.now());
      setT({ d: Math.floor(diff / 86400000), h: Math.floor((diff % 86400000) / 3600000) });
    };
    tick();
    const id = setInterval(tick, 60000);
    return () => clearInterval(id);
  }, []);
  return (
    <span style={{
      borderLeft: "1px solid rgba(255,255,255,0.15)",
      padding: "14px 18px",
      fontSize: 13, fontWeight: 400, color: "rgba(255,255,255,0.38)",
      fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap",
      background: "transparent",
    }}>
      {t.d}d {String(t.h).padStart(2,"0")}h left
    </span>
  );
}

// NavCountdown — compact pill shown in the nav bar
function NavCountdown() {
  const [t, setT] = useState({ d: 0, h: 0, m: 0 });
  useEffect(() => {
    const tick = () => {
      const diff = Math.max(0, LAUNCH_DATE - Date.now());
      setT({
        d: Math.floor(diff / 86400000),
        h: Math.floor((diff % 86400000) / 3600000),
        m: Math.floor((diff % 3600000) / 60000),
      });
    };
    tick();
    const id = setInterval(tick, 30000); // update every 30s in nav
    return () => clearInterval(id);
  }, []);
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 6,
      background: "rgba(0,0,0,0.05)", borderRadius: 980,
      padding: "4px 12px 4px 8px", fontSize: 12, fontFamily: FONT,
      fontVariantNumeric: "tabular-nums", color: "rgba(0,0,0,0.62)",
      letterSpacing: "-0.01em",
    }}>
      {/* Pulsing red dot — "live" launch indicator */}
      <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#ff3b30", flexShrink: 0, animation: "recPulse 2s ease-in-out infinite" }} />
      <span style={{ fontWeight: 500 }}>
        {t.d}d {String(t.h).padStart(2, "0")}h {String(t.m).padStart(2, "0")}m
      </span>
    </div>
  );
}

function Countdown({ large = false }: { large?: boolean }) {
  const [t, setT] = useState({ d: 0, h: 0, m: 0, s: 0 });
  useEffect(() => {
    const tick = () => {
      const diff = Math.max(0, LAUNCH_DATE - Date.now());
      setT({
        d: Math.floor(diff / 86400000),
        h: Math.floor((diff % 86400000) / 3600000),
        m: Math.floor((diff % 3600000) / 60000),
        s: Math.floor((diff % 60000) / 1000),
      });
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  const pad = (n: number) => String(n).padStart(2, "0");
  const numSize = large ? 44 : 28;
  const lblSize = large ? 11 : 9;
  return (
    <div style={{ display: "flex", gap: large ? 20 : 12, alignItems: "center", fontFamily: FONT }}>
      {[{ v: t.d, l: "days" }, { v: t.h, l: "hrs" }, { v: t.m, l: "min" }, { v: t.s, l: "sec" }].map(({ v, l }) => (
        <div key={l} style={{ textAlign: "center", minWidth: large ? 56 : 36 }}>
          <div style={{
            fontSize: numSize, fontWeight: 700, letterSpacing: "-0.04em",
            lineHeight: 1, color: large ? "#0d2b40" : "#1d1d1f",
            fontVariantNumeric: "tabular-nums",
            overflow: "hidden",
          }}>
            <span style={{ display: "inline-block", animation: "countFlip 0.3s ease" }} key={v}>{pad(v)}</span>
          </div>
          <div style={{ fontSize: lblSize, color: large ? "rgba(0,40,80,0.50)" : "#a3a3a3", letterSpacing: "0.06em", textTransform: "uppercase", marginTop: 5 }}>{l}</div>
        </div>
      ))}
    </div>
  );
}

// ── Confetti burst ─────────────────────────────────────────────────────────────
const CONFETTI_COLORS = ["#0071e3", "#34c759", "#ff9500", "#ff3b30", "#5856d6", "#30b0c7"];
function Confetti() {
  const pieces = Array.from({ length: 48 }, (_, i) => ({
    left: `${(i / 48) * 100 + (Math.sin(i) * 3)}%`,
    delay: `${(i * 0.04) % 0.9}s`,
    dur: `${0.9 + (i % 5) * 0.14}s`,
    color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
    w: 5 + (i % 4),
    h: 8 + (i % 3) * 2,
    rot: (i * 37) % 360,
  }));
  return (
    <div aria-hidden="true" style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 9999, overflow: "hidden" }}>
      {pieces.map((p, i) => (
        <div key={i} style={{
          position: "absolute", left: p.left, top: -12,
          width: p.w, height: p.h, background: p.color, borderRadius: 2,
          animation: `confettiFall ${p.dur} ease-in ${p.delay} both`,
          transform: `rotate(${p.rot}deg)`,
        }} />
      ))}
    </div>
  );
}

// ── WaitlistModal ─────────────────────────────────────────────────────────────
// Apple/iOS native — centered card on desktop, bottom sheet on mobile.
// States: idle → loading → success | error | duplicate
function WaitlistModal({ onClose, onLogin }: { onClose: () => void; onLogin: () => void }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error" | "duplicate">("idle");
  const [position, setPosition] = useState(0);
  const [showConfetti, setShowConfetti] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 320); }, []);

  async function submit() {
    const q = email.trim();
    if (!q || status === "loading") return;
    setStatus("loading");
    // Never spin forever — abort after 12s and surface an error.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    try {
      const res = await fetch("/api/waitlist?action=join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: q, source: "landing" }),
        signal: ctrl.signal,
      });
      const data = await res.json().catch(() => ({}));
      if (data.already || data.alreadyJoined) { setStatus("duplicate"); return; }
      if (res.ok && data.success) {
        setPosition(data.position ?? 0);
        setStatus("success");
        setShowConfetti(true);
        setTimeout(() => setShowConfetti(false), 3600);
      } else {
        console.error("[waitlist] join failed:", data.error || `HTTP ${res.status}`);
        setStatus("error");
      }
    } catch (e) {
      console.error("[waitlist] join error:", e);
      setStatus("error");
    } finally {
      clearTimeout(timer);
    }
  }

  const isSuccess = status === "success";

  return (
    <>
      {showConfetti && <Confetti />}

      <style>{`
        .wl-overlay {
          position: fixed; inset: 0; z-index: 1000;
          background: rgba(0,0,0,0.48);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          display: flex; align-items: flex-end; justify-content: center;
        }
        .wl-card {
          width: 100%; max-width: 100%;
          background: #ffffff;
          border-radius: 22px 22px 0 0;
          padding: 6px 24px 40px;
          font-family: ${FONT};
          animation: waitIn 0.38s cubic-bezier(0.16,1,0.3,1) both;
          box-shadow: 0 -2px 0 rgba(0,0,0,0.04), 0 -24px 60px rgba(0,0,0,0.18);
          max-height: 90dvh;
          overflow-y: auto;
        }
        @media (min-width: 640px) {
          .wl-overlay { align-items: center; padding: 20px; }
          .wl-card {
            max-width: 440px; border-radius: 22px;
            padding: 28px 32px 32px;
            box-shadow: 0 32px 80px rgba(0,0,0,0.20), 0 8px 24px rgba(0,0,0,0.10);
            animation: successPop 0.38s cubic-bezier(0.16,1,0.3,1) both;
          }
        }
        .wl-handle { display: flex; justify-content: center; padding: 10px 0 16px; }
        @media (min-width: 640px) { .wl-handle { display: none; } }
        .wl-inp {
          width: 100%; background: #f5f5f7; border: 1.5px solid transparent;
          border-radius: 14px; padding: 15px 16px; color: #1d1d1f; font-size: 17px;
          font-family: ${FONT}; outline: none; box-sizing: border-box;
          transition: border-color 0.18s, background 0.18s, box-shadow 0.18s;
        }
        .wl-inp::placeholder { color: rgba(0,0,0,0.30); }
        .wl-inp:focus { background: #fff; border-color: rgba(0,102,204,0.55); box-shadow: 0 0 0 4px rgba(0,102,204,0.10); }
        .wl-btn-primary {
          width: 100%; background: #0071e3; color: #fff; border: none;
          border-radius: 980px; padding: 16px; font-size: 17px; font-weight: 400;
          cursor: pointer; font-family: ${FONT}; transition: opacity 0.15s, transform 0.15s;
          display: flex; align-items: center; justify-content: center;
        }
        .wl-btn-primary:hover { opacity: 0.86; }
        .wl-btn-primary:active { transform: scale(0.98); }
        .wl-btn-primary:disabled { background: rgba(0,0,0,0.08); color: rgba(0,0,0,0.30); cursor: default; transform: none; opacity: 1; }
      `}</style>

      <div className="wl-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="wl-card">

          {/* Drag handle — mobile only */}
          <div className="wl-handle">
            <div onClick={onClose} style={{ width: 36, height: 4, borderRadius: 2, background: "rgba(0,0,0,0.14)", cursor: "pointer" }} />
          </div>

          {isSuccess ? (
            /* ── Success ── */
            <div style={{ textAlign: "center", paddingTop: 8 }}>
              {/* Animated check ring */}
              <div style={{
                width: 80, height: 80, borderRadius: "50%",
                background: "rgba(52,199,89,0.10)",
                display: "flex", alignItems: "center", justifyContent: "center",
                margin: "0 auto 24px",
                animation: "successPop 0.45s cubic-bezier(0.16,1,0.3,1) both",
              }}>
                <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
                  <circle cx="20" cy="20" r="19" stroke="#34c759" strokeWidth="2" opacity="0.4" />
                  <path d="M11 20l7 7 11-11"
                    stroke="#34c759" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                    strokeDasharray="64" strokeDashoffset="64"
                    style={{ animation: "checkIn 0.55s cubic-bezier(0.16,1,0.3,1) 0.15s forwards" }} />
                </svg>
              </div>

              <h2 style={{ fontSize: 28, fontWeight: 600, letterSpacing: "-0.025em", color: "#1d1d1f", margin: "0 0 10px" }}>
                You're in.
              </h2>
              <p style={{ fontSize: 17, color: "#6e6e73", lineHeight: 1.6, margin: "0 0 4px" }}>
                You're <strong style={{ color: "#1d1d1f", fontWeight: 600 }}>#{position.toLocaleString()}</strong> on the waitlist.
              </p>
              <p style={{ fontSize: 15, color: "#6e6e73", lineHeight: 1.55, marginBottom: 28 }}>
                Check your inbox. We just sent a confirmation. We launch{" "}
                <strong style={{ color: "#0066cc", fontWeight: 500 }}>August 1st, 2026.</strong>
              </p>

              {/* Mini countdown */}
              <div style={{ background: "#f5f5f7", borderRadius: 16, padding: "16px 20px", marginBottom: 24, display: "flex", justifyContent: "center" }}>
                <Countdown />
              </div>

              <button className="wl-btn-primary" onClick={onClose}>Done</button>
            </div>
          ) : (
            /* ── Entry form ── */
            <>
              {/* Header */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 22 }}>
                <img src="/fschoolai-logo.jpeg" alt="FschoolAI"
                  style={{ width: 32, height: 32, borderRadius: 8, filter: "invert(1)", mixBlendMode: "multiply" }} />
                <button onClick={onClose} style={{
                  background: "rgba(0,0,0,0.06)", border: "none", cursor: "pointer",
                  width: 30, height: 30, borderRadius: "50%",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  transition: "background 0.15s",
                }}
                  onMouseEnter={e => (e.currentTarget.style.background = "rgba(0,0,0,0.10)")}
                  onMouseLeave={e => (e.currentTarget.style.background = "rgba(0,0,0,0.06)")}
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path d="M1 1l10 10M11 1L1 11" stroke="#1d1d1f" strokeWidth="1.8" strokeLinecap="round"/>
                  </svg>
                </button>
              </div>

              <h2 style={{ fontSize: 26, fontWeight: 600, letterSpacing: "-0.025em", color: "#1d1d1f", margin: "0 0 6px" }}>
                Reserve your spot.
              </h2>
              <p style={{ fontSize: 15, color: "#6e6e73", lineHeight: 1.6, marginBottom: 24 }}>
                FschoolAI launches August 1st, 2026. Get early access, free for your first month.
              </p>

              {/* Countdown strip */}
              <div style={{
                display: "flex", justifyContent: "center",
                padding: "16px 0", marginBottom: 24,
                borderTop: "1px solid rgba(0,0,0,0.07)",
                borderBottom: "1px solid rgba(0,0,0,0.07)",
              }}>
                <Countdown />
              </div>

              {/* Email input */}
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: "block", fontSize: 13, fontWeight: 500, color: "rgba(0,0,0,0.52)", marginBottom: 8, letterSpacing: "0.01em" }}>
                  Email address
                </label>
                <input
                  ref={inputRef}
                  className="wl-inp"
                  type="email"
                  placeholder="student@university.edu"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && submit()}
                  disabled={status === "loading"}
                  style={status === "error" ? { borderColor: "rgba(255,59,48,0.55)", background: "rgba(255,59,48,0.04)" } : {}}
                />
                {status === "error" && (
                  <p style={{ fontSize: 13, color: "rgba(255,59,48,0.85)", marginTop: 8 }}>Something went wrong. Please try again.</p>
                )}
                {status === "duplicate" && (
                  <p style={{ fontSize: 13, color: "#34c759", marginTop: 8 }}>You're already on the list. See you August 1st.</p>
                )}
              </div>

              {/* Primary CTA */}
              <button
                className="wl-btn-primary"
                onClick={submit}
                disabled={!email.trim() || status === "loading"}
                style={{ marginBottom: 16 }}
              >
                {status === "loading" ? (
                  <span style={{ display: "inline-flex", gap: 5, alignItems: "center" }}>
                    {[0,.15,.30].map((d,i) => (
                      <span key={i} style={{ width: 5, height: 5, borderRadius: "50%", background: "rgba(255,255,255,0.7)", display: "inline-block", animation: `dot .8s ease-in-out ${d}s infinite` }} />
                    ))}
                  </span>
                ) : "Notify me when we launch"}
              </button>

            </>
          )}
        </div>
      </div>
    </>
  );
}

// ── Auth modal ────────────────────────────────────────────────────────────────
function AuthModal({ mode, onClose, onEnter, onSwitchMode, onForgotPassword, t }: {
  mode: "login"|"signup"; onClose: () => void;
  onEnter: (args: any) => Promise<void>; onSwitchMode: (m: string) => void;
  onForgotPassword: (email: string) => void; t: typeof DARK;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const isSignup = mode === "signup";
  const canSubmit = isSignup ? name.trim() && email.trim() && password.length >= 6 : email.trim() && password.length >= 1;

  async function handleSubmit() {
    if (!canSubmit || loading) return;
    if (isSignup && password !== confirmPw) { setError("Passwords don't match."); return; }
    setError(""); setLoading(true);
    try { await onEnter({ mode, name: name.trim(), email: email.trim(), password }); }
    catch (err: any) { setError(err.message ?? "Something went wrong."); }
    finally { setLoading(false); }
  }
  function handleKey(e: React.KeyboardEvent) { if (e.key === "Enter") handleSubmit(); }

  const inp: React.CSSProperties = {
    background: t.cardInner, border: `1px solid ${t.cardBorder}`, borderRadius: 10,
    padding: "12px 14px", color: t.text, fontSize: 14, outline: "none",
    fontFamily: FONT, width: "100%", boxSizing: "border-box", transition: "border-color 0.15s",
  };

  return (
    <div onClick={e => e.target === e.currentTarget && onClose()} style={{
      position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "flex-end",
      background: "rgba(0,0,0,0.55)", backdropFilter: "blur(8px)",
    }}>
      <div style={{
        width: "100%", background: t.bg2, backdropFilter: "blur(40px)",
        borderRadius: "22px 22px 0 0", border: `1px solid ${t.border}`, borderBottom: "none",
        padding: "16px 28px 44px", fontFamily: FONT,
        animation: "authUp 0.28s cubic-bezier(0.25,0.46,0.45,0.94) forwards",
      }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 22 }}>
          <div onClick={onClose} style={{ width: 36, height: 4, borderRadius: 2, background: t.border, cursor: "pointer" }} />
        </div>
        <h2 style={{ color: t.text, fontSize: 22, fontWeight: 600, letterSpacing: "-0.3px", marginBottom: 6 }}>
          {isSignup ? "Create your account" : "Welcome back"}
        </h2>
        <p style={{ color: t.textMuted, fontSize: 14, marginBottom: 26, lineHeight: 1.6 }}>
          {isSignup ? "Takes 30 seconds. Connect Canvas in the next step." : "Enter your email and password to continue."}
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 18 }}>
          {isSignup && <input placeholder="Your name" value={name} onChange={e => setName(e.target.value)} onKeyDown={handleKey} style={inp} />}
          <input placeholder="Email" type="email" value={email} onChange={e => setEmail(e.target.value)} onKeyDown={handleKey} style={inp} />
          <input placeholder="Password" type="password" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={handleKey} style={inp} />
          {isSignup && <input placeholder="Confirm password" type="password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)} onKeyDown={handleKey} style={inp} />}
          {!isSignup && <button type="button" onClick={() => onForgotPassword(email.trim())} style={{ background: "none", border: "none", color: t.textFaint, fontSize: 12, cursor: "pointer", textAlign: "right", fontFamily: FONT, padding: 0, textDecoration: "underline" }}>Forgot password?</button>}
        </div>
        {error && <p style={{ color: "rgba(255,59,48,0.85)", fontSize: 12, textAlign: "center", marginBottom: 10 }}>{error}</p>}
        <button onClick={handleSubmit} disabled={!canSubmit || loading} style={{
          width: "100%", background: canSubmit && !loading ? t.text : `${t.text}44`, color: t.bg,
          border: "none", borderRadius: 12, padding: 14, fontSize: 15, fontWeight: 600,
          cursor: canSubmit && !loading ? "pointer" : "not-allowed", fontFamily: FONT, transition: "background 0.15s",
        }}>{loading ? "…" : isSignup ? "Start for free →" : "Sign in →"}</button>
        <p style={{ color: t.textFaint, fontSize: 12, textAlign: "center", marginTop: 10 }}>
          {isSignup
            ? "You'll connect Canvas in the next step."
            : <>Don't have an account?{" "}
                <span onClick={() => { onClose(); setTimeout(() => onSwitchMode("signup"), 50); }}
                  style={{ color: t.textMuted, textDecoration: "underline", cursor: "pointer" }}>Sign up free</span>
              </>}
        </p>
      </div>
      <style>{`@keyframes authUp{from{transform:translateY(100%)}to{transform:translateY(0)}}`}</style>
    </div>
  );
}

// ── Landing ────────────────────────────────────────────────────────────────────
const FAQ_DATA = [
  { q: "Is FschoolAI free?", a: "Yes, 1 month free on beta signup, no credit card required. Pro features and extended storage are paid." },
  { q: "Does it work with my university's Canvas?", a: "Yes. FschoolAI syncs directly with Canvas via your access token: courses, assignments, deadlines, and grades." },
  { q: "What makes it different from ChatGPT?", a: "ChatGPT knows the internet. FschoolAI knows YOUR courses: your lecture notes, your syllabus, your actual assignments. Answers are grounded in what your professor actually said." },
  { q: "What's the Founding Card?", a: "A physical NFC titanium card for the first 1,000 members. It holds your AI identity, student number, and lifetime Pro access. See the Card page." },
];

export default function Landing({ onEnter, initialAuthMode = null, onTryDemo }: { onEnter: (args: any) => Promise<void>; initialAuthMode?: "login" | "signup" | null; onTryDemo?: () => void }) {
  // Light-primary — no toggle. DARK tokens used directly in the card-preview section.
  const t = LIGHT;
  const [authMode, setAuthMode] = useState<"login"|"signup"|null>(initialAuthMode);
  // Deep link for socials (IG bio): fschoolai.com/waitlist or ?waitlist=1 lands with the
  // join modal open. Preserved across the design merge (PR #146/#148 behavior).
  const [waitlistOpen, setWaitlistOpen] = useState(() => {
    try {
      const q = new URLSearchParams(window.location.search);
      return window.location.pathname === "/waitlist" || q.has("waitlist");
    } catch { return false; }
  });
  const [forgotStatus, setForgotStatus] = useState<"sent"|"error"|null>(null);
  const [scrollY, setScrollY] = useState(0);
  const [faqOpen, setFaqOpen] = useState<number|null>(null);
  // Ghost wordmark: fires once when the product section scrolls into view, stays on.
  const [ghostRef, ghostVisible] = useInView(0.1);
  // True once hero scrolls ~85 % out of view — triggers header swap.
  const showProductBar = scrollY > (typeof window !== "undefined" ? window.innerHeight * 0.85 : 700);
  // 3D tilt ref — DOM-direct updates, zero React re-renders
  const cardTiltRef = useRef<HTMLDivElement>(null);
  function onHeroMouseMove(e: React.MouseEvent<HTMLElement>) {
    const el = cardTiltRef.current; if (!el) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width  - 0.5) *  9;   // ±4.5°
    const y = ((e.clientY - r.top)  / r.height - 0.5) * -6;   // ±3°
    el.style.transform = `perspective(1100px) rotateX(${y}deg) rotateY(${x}deg) scale(1.015)`;
  }
  function onHeroMouseLeave() {
    const el = cardTiltRef.current; if (!el) return;
    el.style.transform = "perspective(1100px) rotateX(0deg) rotateY(0deg) scale(1)";
  }

  // Magichromatic: scroll-linked gradient matching the 5 card colorways.
  // 0.12 multiplier = noticeable shift within the first 200px of scroll.
  const chromaPos  = `${(scrollY * 0.12) % 300}% center`;
  const chromaStyle: React.CSSProperties = {
    // 9-stop gradient: actual card pigments (purple → pink → blue → green → purple).
    // Extra intermediate stops (peach, teal) create the smooth spectral sweep Apple uses.
    background: "linear-gradient(90deg,#b8a0dc 0%,#d4a0c8 14%,#f0a4bc 28%,#f5b8b0 40%,#94c4f0 54%,#80d8d0 66%,#96e8a8 78%,#b8c8e0 90%,#b8a0dc 100%)",
    backgroundSize: "300% 100%",
    backgroundPosition: chromaPos,
    backgroundClip: "text",
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
    display: "inline",
  };

  useEffect(() => {
    const fn = () => setScrollY(window.scrollY);
    window.addEventListener("scroll", fn, { passive: true });
    return () => window.removeEventListener("scroll", fn);
  }, []);

  async function handleForgotPassword(email: string) {
    try {
      const { supabase } = await import("../api/supabase");
      await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/?reset=1` });
      setForgotStatus("sent");
    } catch { setForgotStatus("error"); }
    setTimeout(() => setForgotStatus(null), 5000);
  }

  return (
    <div style={{ background: "#ffffff", color: "#141414", fontFamily: FONT, minHeight: "100vh",
      overflowX: "hidden", WebkitFontSmoothing: "antialiased" as any, maxWidth: "100vw" }}>

      <style>{`
        /* Apple.com exact typography base — matches html{font-size:106.25%} on apple.com */
        :root { --sk-body-text-color:#1d1d1f; --sk-fill:#fff; --sk-fill-secondary:#fafafc; --sk-fill-tertiary:#f5f5f7; }
        @keyframes heroIn      { from{opacity:0;transform:translateY(20px)} to{opacity:1;transform:translateY(0)} }
        @keyframes scrollBob   { 0%,100%{opacity:0.3;transform:translateY(0)} 50%{opacity:0.8;transform:translateY(6px)} }
        @keyframes saFadeIn    { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
        .sa-tab-row::-webkit-scrollbar { display:none }
        @keyframes ecoRingOrbit { to { transform:rotate(360deg); } }
        @keyframes ecoCounter   { to { transform:rotate(-360deg); } }
        @keyframes lineFlow     { from{stroke-dashoffset:28;opacity:0.25} 60%{opacity:0.7} to{stroke-dashoffset:0;opacity:0.25} }
        @keyframes iconPing     { 0%,100%{transform:scale(1)} 45%{transform:scale(1.09)} 60%{transform:scale(0.97)} }
        @keyframes centerOrb    { 0%,100%{box-shadow:0 0 0 0 rgba(148,130,220,0.18),0 4px 24px rgba(0,0,0,0.12)} 50%{box-shadow:0 0 0 10px rgba(148,130,220,0.0),0 4px 24px rgba(0,0,0,0.14)} }
        @keyframes ringPulse    { 0%,100%{opacity:0.06} 50%{opacity:0.14} }
        @keyframes appleLabel  { from{opacity:0;letter-spacing:.5em} to{opacity:1;letter-spacing:.18em} }
        @keyframes appleTitle  { from{opacity:0;transform:translateY(32px) scale(0.94)} to{opacity:1;transform:translateY(0) scale(1)} }
        @keyframes appleSub    { from{opacity:0;transform:translateY(20px)} to{opacity:1;transform:translateY(0)} }
        @keyframes appleCta    { from{opacity:0;transform:translateY(16px)} to{opacity:1;transform:translateY(0)} }
        @keyframes appleCards  { from{opacity:0;transform:translateY(72px) scale(0.93)} to{opacity:1;transform:translateY(0) scale(1)} }
        @keyframes cardFloat   { 0%,100%{transform:translateY(0px) scale(1)} 50%{transform:translateY(-9px) scale(1.004)} }
        @keyframes glassIn     { 0%{opacity:0;transform:scale(1.06) translateY(24px);filter:blur(10px)} 100%{opacity:1;transform:scale(1) translateY(0);filter:blur(0)} }
        @keyframes micPulse    { 0%,100%{transform:scale(1);box-shadow:0 0 0 0 rgba(0,0,0,0.12)} 50%{transform:scale(1.06);box-shadow:0 0 0 8px rgba(0,0,0,0.04)} }
        @keyframes waveWord    { from{opacity:0;transform:translateY(4px)} to{opacity:1;transform:translateY(0)} }
        @keyframes cardSlideUp { from{opacity:0;transform:translateY(20px) scale(0.94)} to{opacity:1;transform:translateY(0) scale(1)} }
        @keyframes cardFlip3d  { 0%{transform:rotateY(0deg)} 40%{transform:rotateY(90deg)} 50%{transform:rotateY(90deg)} 100%{transform:rotateY(0deg)} }
        @keyframes highlightIn { from{background-size:0% 100%} to{background-size:100% 100%} }
        @keyframes phoneSlide  { from{opacity:0;transform:translateX(30px)} to{opacity:1;transform:translateX(0)} }
        @keyframes featIn      { from{opacity:0;transform:translateY(16px)} to{opacity:1;transform:translateY(0)} }
        @keyframes streamIn    { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
        @keyframes waveBar     { 0%,100%{transform:scaleY(0.22)} 50%{transform:scaleY(1)} }
        @keyframes marqueeL    { from{transform:translateX(0)} to{transform:translateX(-50%)} }
        @keyframes marqueeR    { from{transform:translateX(-50%)} to{transform:translateX(0)} }
        @keyframes statCount   { from{opacity:0;transform:translateY(20px) scale(0.96)} to{opacity:1;transform:translateY(0) scale(1)} }
        @keyframes pulseGlow   { 0%,100%{box-shadow:0 0 0 0 rgba(0,210,190,0.4)} 50%{box-shadow:0 0 0 6px rgba(0,210,190,0)} }
        @keyframes confettiFall { 0%{transform:translateY(-20px) rotate(0deg);opacity:1} 100%{transform:translateY(110vh) rotate(720deg);opacity:0} }
        @keyframes checkIn     { 0%{stroke-dashoffset:60} 100%{stroke-dashoffset:0} }
        @keyframes successPop  { 0%{opacity:0;transform:scale(0.8)} 60%{transform:scale(1.04)} 100%{opacity:1;transform:scale(1)} }
        @keyframes countFlip   { 0%{transform:translateY(100%);opacity:0} 100%{transform:translateY(0);opacity:1} }
        @keyframes waitIn      { from{opacity:0;transform:translateY(24px)} to{opacity:1;transform:translateY(0)} }
        .apple-nav-links { display:flex; gap:28px; align-items:center; }
        @media(max-width:680px){ .apple-nav-links{ display:none!important; } }
        /* Responsive nav padding — tight on mobile, relaxed on desktop */
        .apple-nav-bar { padding: 0 12px; }
        @media(min-width:480px){ .apple-nav-bar { padding: 0 16px; } }
        @media(min-width:768px){ .apple-nav-bar { padding: 0 22px; } }
        /* ── Mobile layout resets ── */
        @media(max-width:768px){
          .hero-inner   { flex-direction:column!important; gap:32px!important; }
          .hero-cards   { width:100%!important; min-width:unset!important; }
          .tm-row       { flex-direction:column!important; padding:60px 20px!important; gap:36px!important; }
          .tm-row-rev   { flex-direction:column!important; padding:60px 20px!important; gap:36px!important; }
          .eco-orbital  { width:min(380px,88vw)!important; height:min(380px,88vw)!important; }
          .demo-inner   { flex-direction:column!important; align-items:center!important; }
          .cta-btns     { flex-direction:column!important; align-items:stretch!important; }
          .cta-btns button { width:100%!important; justify-content:center!important; }
        }
        @media(max-width:480px){
          .tm-row { padding:48px 16px!important; }
          .tm-row-rev { padding:48px 16px!important; }
          .nav-countdown { display:none!important; }
        }
        /* ── Ecosystem: orbital on desktop, marquee on mobile ── */
        .eco-orbital-wrap { display:block; }
        .eco-marquee-wrap { display:none; }
        @media(max-width:700px){
          .eco-orbital-wrap { display:none!important; }
          .eco-marquee-wrap { display:block!important; }
        }
        /* ── FeaturesShowcase: demo card + tab row mobile clamp ── */
        @media(max-width:600px){
          .sa-tab-row { padding:0 4px!important; }
          .feat-card   { max-width:calc(100vw - 40px)!important; margin:0 auto!important; }
          .feat-card > div { border-radius:18px!important; }
        }
        /* ── Prevent any horizontal overflow across all sections ── */
        @media(max-width:768px){
          section, .eco-section { overflow-x:hidden!important; }
        }
      `}</style>

      {/* ── PRODUCT STICKY BAR — slides in independently, staggered after nav slides out ── */}
      <div style={{
        position: "fixed", top: 0, left: 0, right: 0, zIndex: 102,
        height: 44,
        background: "rgba(255,255,255,0.82)",
        backdropFilter: "saturate(180%) blur(20px)",
        WebkitBackdropFilter: "saturate(180%) blur(20px)",
        borderBottom: "1px solid rgba(0,0,0,0.08)",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 16px",
        opacity: showProductBar ? 1 : 0,
        transform: showProductBar ? "translateY(0)" : "translateY(-110%)",
        transition: showProductBar
          ? "opacity 0.28s ease 0.10s, transform 0.34s cubic-bezier(0.16,1,0.3,1) 0.06s"
          : "opacity 0.18s ease, transform 0.24s cubic-bezier(0.4,0,1,1)",
        pointerEvents: showProductBar ? "auto" : "none",
      }}>
        <span style={{ fontSize: 13, fontWeight: 500, letterSpacing: "-0.01em", color: "#1d1d1f" }}>
          Founding Card
        </span>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button onClick={() => setWaitlistOpen(true)} style={{
            borderRadius: 980, border: "1px solid rgba(0,102,204,0.56)",
            padding: "7px 17px", fontSize: 13, fontWeight: 400,
            color: "#0066cc", background: "transparent", cursor: "pointer", fontFamily: FONT,
            display: "inline-flex", alignItems: "center",
            transition: "background 0.15s, border-color 0.15s",
          }}
            onMouseEnter={e => { const a = e.currentTarget; a.style.background = "rgba(0,102,204,0.06)"; a.style.borderColor = "#0066cc"; }}
            onMouseLeave={e => { const a = e.currentTarget; a.style.background = "transparent"; a.style.borderColor = "rgba(0,102,204,0.56)"; }}
          >Join the waitlist</button>
        </div>
      </div>

      {/* ── ANNOUNCEMENT BANNER — no borders, bg fades at edges, text fully readable ── */}
      <div style={{
        position: "fixed", top: 44, left: 0, right: 0, zIndex: 99,
        height: 38,
        // fade the gray horizontally so it has no hard edge, no box feel
        background: "linear-gradient(to right, transparent 0%, rgba(245,245,247,0.72) 12%, rgba(245,245,247,0.72) 88%, transparent 100%)",
        border: "none",
        display: "flex", alignItems: "center", justifyContent: "center",
        opacity: showProductBar ? 0 : 1,
        transform: showProductBar ? "translateY(-100%)" : "translateY(0)",
        transition: "opacity 0.22s ease 0.04s, transform 0.26s cubic-bezier(0.4,0,0.2,1) 0.04s",
        pointerEvents: showProductBar ? "none" : "auto",
      }}>
        <p style={{
          fontSize: 12, fontWeight: 400, letterSpacing: "0.015em",
          color: "rgba(0,0,0,0.52)", margin: 0, textAlign: "center",
        }}>
          Founding members receive{" "}
          <span style={{ fontWeight: 500, color: "rgba(0,0,0,0.72)" }}>
            Lifetime Pro&nbsp;· guaranteed founding number&nbsp;· express delivery
          </span>
          {" · "}
          <button onClick={() => setWaitlistOpen(true)} style={{
            color: "#0066cc", background: "none", border: "none", cursor: "pointer",
            fontFamily: FONT, fontSize: "inherit", padding: 0,
            transition: "color 0.12s",
          }}
            onMouseEnter={e => { e.currentTarget.style.color = "#004499"; }}
            onMouseLeave={e => { e.currentTarget.style.color = "#0066cc"; }}
          >Join the waitlist →</button>
        </p>
      </div>


      {/* ── NAV — Apple-exact: frosted glass, 44px, responsive padding via .apple-nav-bar ── */}
      <nav className="apple-nav-bar" style={{
        position: "fixed", top: 0, left: 0, right: 0, zIndex: 100,
        display: "flex", alignItems: "center",
        height: 44,
        background: "rgba(255,255,255,0.82)",
        backdropFilter: "saturate(180%) blur(20px)",
        WebkitBackdropFilter: "saturate(180%) blur(20px)",
        border: "none",
        opacity: showProductBar ? 0 : 1,
        transform: showProductBar ? "translateY(-100%)" : "translateY(0)",
        transition: "opacity 0.22s ease, transform 0.26s cubic-bezier(0.4,0,0.2,1)",
        pointerEvents: showProductBar ? "none" : "auto",
      }}>
        {/* Left — F+brain logo in corner */}
        <div style={{ flex: 1, display: "flex", alignItems: "center" }}>
          <img
            src="/fschoolai-logo.jpeg"
            alt="FschoolAI"
            style={{
              width: 49, height: 49,
              display: "block",
              objectFit: "contain",
              filter: "invert(1)",
              mixBlendMode: "multiply",
            }}
          />
        </div>
        {/* Center — the launch countdown, dead-center in the nav (equal flex:1 sides
            keep it centered). Hidden on tiny screens via .nav-countdown. */}
        <div style={{ flex: "0 0 auto", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div className="nav-countdown"><NavCountdown /></div>
        </div>
        {/* Right — invisible login. Text is transparent so only people who know it's
            here click it; still fully clickable, never reveals on hover. This is the
            ONLY discoverable path to the login screen (an injected ?/link aside). */}
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "flex-end" }}>
          <button onClick={() => setAuthMode("login")}
            aria-label="Log in"
            style={{ background: "none", border: "none", padding: "5px 10px", fontSize: 13,
              fontWeight: 400, color: "transparent", cursor: "pointer", fontFamily: FONT,
              whiteSpace: "nowrap" }}
          >Log in</button>
        </div>
      </nav>

      {/* ── HERO — asymmetric split, 3D mouse-tilt, pure white ── */}
      {/* design-taste: ANTI-CENTER BIAS at DESIGN_VARIANCE 8 → split layout */}
      {/* 3D tilt: DOM-direct via cardTiltRef — zero React re-renders on mousemove */}
      <section
        style={{ background: "#ffffff", minHeight: "100dvh", display: "flex", alignItems: "center", overflow: "hidden", position: "relative", paddingTop: "clamp(82px,11vw,104px)" }}
        onMouseMove={onHeroMouseMove}
        onMouseLeave={onHeroMouseLeave}
      >
        {/* Faint radial highlight behind cards */}
        <div aria-hidden="true" style={{ position: "absolute", top: "30%", right: "5%", width: 640, height: 640, borderRadius: "50%", background: "radial-gradient(circle, rgba(148,196,240,0.10) 0%, rgba(182,160,220,0.06) 40%, transparent 70%)", pointerEvents: "none" }} />

        <div className="hero-inner" style={{ width: "100%", maxWidth: 1180, margin: "0 auto", padding: "0 clamp(20px,4vw,48px)", display: "flex", alignItems: "center", gap: "clamp(32px,5vw,72px)", flexWrap: "wrap" }}>

          {/* ── LEFT: copy + CTAs ── */}
          <div style={{ flex: "0 0 auto", width: "min(480px, 100%)", animation: "appleTitle 0.9s cubic-bezier(0.16,1,0.3,1) 0.1s both" }}>
            {/* H1 — Apple weight 600, SF Pro Display optical size, tight tracking */}
            <h1 style={{ fontSize: "clamp(40px,5.5vw,72px)", fontWeight: 600, letterSpacing: "-0.03em", lineHeight: 1.04, color: "#1d1d1f", margin: "0 0 18px", fontFamily: FONT }}>
              Your degree<br />on autopilot.
            </h1>

            {/* Body — Apple 19px, color #6e6e73, relaxed line-height */}
            <p style={{ fontSize: "clamp(16px,1.8vw,19px)", fontWeight: 400, color: "#6e6e73", lineHeight: 1.68, margin: "0 0 32px", maxWidth: "50ch", fontFamily: FONT }}>
              The AI that reads your Canvas, explains your lectures, and builds your exam prep, grounded in your actual notes.
            </p>

            {/* Hero CTAs — waitlist pill + learn more ghost */}
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
              <button
                onClick={() => setWaitlistOpen(true)}
                style={{
                  display: "inline-flex", alignItems: "center",
                  background: "#0071e3", color: "#fff", border: "none",
                  borderRadius: 980, cursor: "pointer", fontFamily: FONT,
                  overflow: "hidden", transition: "opacity 0.15s, transform 0.18s cubic-bezier(0.16,1,0.3,1)",
                  boxShadow: "0 4px 16px rgba(0,113,227,0.28), 0 1px 4px rgba(0,113,227,0.14)",
                }}
                onMouseEnter={e => { e.currentTarget.style.opacity = "0.86"; e.currentTarget.style.transform = "scale(1.02)"; }}
                onMouseLeave={e => { e.currentTarget.style.opacity = "1"; e.currentTarget.style.transform = "scale(1)"; }}
              >
                <span style={{ padding: "14px 22px", fontSize: 17, fontWeight: 400 }}>Join the waitlist</span>
                <HeroBtnCountdown />
              </button>
            </div>

            {/* Subtle stat pills */}
            <div style={{ display: "flex", gap: 20, marginTop: 36, flexWrap: "wrap" }}>
              {[["5", "colorways"], ["1,000", "members only"], ["Lifetime", "Pro access"]].map(([v, l]) => (
                <div key={v} style={{ display: "flex", flexDirection: "column" }}>
                  <span style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.03em", color: "#141414", lineHeight: 1.1 }}>{v}</span>
                  <span style={{ fontSize: 11, color: "#a3a3a3", letterSpacing: "0.01em", marginTop: 2 }}>{l}</span>
                </div>
              ))}
            </div>
          </div>

          {/* ── RIGHT: 3D-tilt card fan ── */}
          {/* No background, no border-radius box — card image floats on pure white */}
          <div style={{ flex: 1, minWidth: "min(320px, 100%)", display: "flex", justifyContent: "center", animation: "glassIn 1.2s cubic-bezier(0.16,1,0.3,1) 0.3s both" }}>
            <div
              ref={cardTiltRef}
              style={{ width: "min(560px, 100%)", transition: "transform 0.45s cubic-bezier(0.16,1,0.3,1)", willChange: "transform" }}
            >
              <img
                src="/cards/herodesktop_light.png"
                alt="FschoolAI Founding Cards, 5 colorways"
                style={{
                  display: "block", width: "100%", height: "auto",
                  animation: "cardFloat 5.5s ease-in-out 1.6s infinite",
                  // Dissolve top + sides into white; bottom reflection fades
                  maskImage: [
                    "linear-gradient(to bottom, transparent 0%, black 7%, black 62%, transparent 92%)",
                    "linear-gradient(to right,  transparent 0%, black 5%, black 95%, transparent 100%)",
                  ].join(", "),
                  WebkitMaskImage: [
                    "linear-gradient(to bottom, transparent 0%, black 7%, black 62%, transparent 92%)",
                    "linear-gradient(to right,  transparent 0%, black 5%, black 95%, transparent 100%)",
                  ].join(", "),
                  maskComposite: "intersect",
                  WebkitMaskComposite: "source-in",
                  filter: "drop-shadow(0 20px 48px rgba(0,0,0,0.10)) drop-shadow(0 4px 12px rgba(0,0,0,0.06))",
                }}
              />
            </div>
          </div>
        </div>
      </section>

      {/* ── SECTION TILE GAP — 8px of page background shows between every tile ── */}
      <div aria-hidden="true" style={{ height: 8 }} />
      <FeaturesShowcase t={t} chromaStyle={chromaStyle} ghostRef={ghostRef} />

      <div aria-hidden="true" style={{ height: 8 }} />
      <DemoCarousel t={t} />

      <div aria-hidden="true" style={{ height: 8 }} />
      <NeuralCoreSection t={t} />

      <div aria-hidden="true" style={{ height: 8 }} />
      <EcosystemCircle t={t} />

      <div aria-hidden="true" style={{ height: 8 }} />
      <ThreeMoments t={t} />

      <div aria-hidden="true" style={{ height: 8 }} />
      <PremiumCTA onSignup={() => setWaitlistOpen(true)} onLogin={() => setWaitlistOpen(true)} />

      <div aria-hidden="true" style={{ height: 8 }} />
      {/* ── FAQ — clean solid tile ── */}
      <section style={{ padding: "100px 20px", background: "#f5f5f7" }}>
        <div style={{ maxWidth: 640, margin: "0 auto" }}>
          <Reveal style={{ textAlign: "center", marginBottom: 52 }}>
            <Label t={t}>FAQ</Label>
            <h2 style={{ fontSize: "clamp(32px,5vw,52px)", fontWeight: 700, letterSpacing: "-0.025em" }}>
              Questions answered.
            </h2>
          </Reveal>
          {FAQ_DATA.map((item, i) => (
            <Reveal key={i} delay={i * 0.04}>
              <div onClick={() => setFaqOpen(faqOpen === i ? null : i)}
                style={{ borderBottom: `1px solid ${t.border}`, cursor: "pointer" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
                  padding: "20px 0", fontSize: 16, fontWeight: 600, color: faqOpen === i ? t.text : t.text,
                  transition: "color 0.15s" }}>
                  {item.q}
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none"
                    style={{ flexShrink: 0, marginLeft: 16, transform: faqOpen === i ? "rotate(180deg)" : "none", transition: "transform 0.22s" }}>
                    <path d="M3 6l5 5 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
                {faqOpen === i && (
                  <p style={{ fontSize: 15, color: t.textMuted, lineHeight: 1.7, paddingBottom: 20, margin: 0 }}>{item.a}</p>
                )}
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      <div aria-hidden="true" style={{ height: 8 }} />
      {/* ── FOOTER — Apple dark tile close ── */}
      <footer style={{ borderTop: "none", padding: "28px 24px",
        display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, background: "#1d1d1f" }}>
        <span style={{ fontSize: 14, fontWeight: 500, color: "rgba(255,255,255,0.80)", fontFamily: FONT }}>FschoolAI</span>
        <span style={{ fontSize: 12, color: "rgba(255,255,255,0.36)", fontFamily: FONT }}>© 2026 FschoolAI. All rights reserved.</span>
        <div style={{ display: "flex", gap: 20 }}>
          {[["Privacy","#"],["Terms","#"],["Contact","#"]].map(([l,h]) => (
            <a key={l} href={h} style={{ fontSize: 12, color: "rgba(255,255,255,0.36)", textDecoration: "none", fontFamily: FONT, transition: "color 0.15s" }}
              onMouseEnter={e => ((e.currentTarget as HTMLAnchorElement).style.color = "rgba(255,255,255,0.70)")}
              onMouseLeave={e => ((e.currentTarget as HTMLAnchorElement).style.color = "rgba(255,255,255,0.36)")}
            >{l}</a>
          ))}
        </div>
      </footer>

      {/* ── WAITLIST MODAL ── */}
      {waitlistOpen && (
        <WaitlistModal
          onClose={() => setWaitlistOpen(false)}
          onLogin={() => { setWaitlistOpen(false); setTimeout(() => setAuthMode("login"), 50); }}
        />
      )}
      {/* ── AUTH MODAL — existing team members only ── */}
      {authMode && (
        <AuthModal mode={authMode} onClose={() => setAuthMode(null)} onEnter={onEnter}
          onSwitchMode={m => setAuthMode(m as any)} onForgotPassword={handleForgotPassword} t={t} />
      )}
      {forgotStatus && (
        <div style={{ position: "fixed", top: "env(safe-area-inset-top,0px)", left: "50%",
          transform: "translateX(-50%)", zIndex: 999, marginTop: 16,
          width: "calc(100% - 40px)", maxWidth: 420, padding: "14px 18px", borderRadius: 12,
          background: forgotStatus === "sent" ? "rgba(52,199,89,0.12)" : "rgba(255,59,48,0.12)",
          border: `1px solid ${forgotStatus === "sent" ? "rgba(52,199,89,0.3)" : "rgba(255,59,48,0.3)"}`,
          display: "flex", alignItems: "center", gap: 12,
          backdropFilter: "blur(20px)", fontFamily: FONT,
          animation: "bannerIn 0.3s cubic-bezier(0,0,0.2,1) both" }}>
          <p style={{ flex: 1, fontSize: 14, color: t.text }}>
            {forgotStatus === "sent" ? "Reset link sent. Check your inbox." : "Something went wrong. Try again."}
          </p>
          <button onClick={() => setForgotStatus(null)} style={{ background: "none", border: "none", color: t.textMuted, cursor: "pointer", fontSize: 18 }}>×</button>
          <style>{`@keyframes bannerIn{from{opacity:0;transform:translateX(-50%) translateY(-10px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}`}</style>
        </div>
      )}
    </div>
  );
}

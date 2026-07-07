// src/pages/Landing.tsx — FschoolAI app landing page.
// Design system: matches src/FschoolAILanding.jsx (Safreen's card page) exactly.
// Black/white Apple-minimal. SF Pro/Inter. Pure CSS + IntersectionObserver animations.

import React, { useState, useEffect, useRef } from "react";

// ── Theme tokens ───────────────────────────────────────────────────────────────
const DARK = {
  bg: "#000", bg2: "#080808",
  text: "#fff", textMuted: "rgba(255,255,255,0.45)", textFaint: "rgba(255,255,255,0.3)",
  border: "rgba(255,255,255,0.06)", navBg: "rgba(0,0,0,0.72)", label: "#666",
  cardBg: "#1a1a1a", cardBorder: "#2a2a2a", cardInner: "#1e1e1e", cardInnerBorder: "#2e2e2e",
  userBubble: "#2a2a2a",
};
const LIGHT = {
  bg: "#fefefe", bg2: "#f9f9f7",
  text: "#000", textMuted: "rgba(0,0,0,0.55)", textFaint: "rgba(0,0,0,0.35)",
  border: "rgba(0,0,0,0.08)", navBg: "rgba(254,254,254,0.88)", label: "#888",
  cardBg: "#fff", cardBorder: "#e0e0e0", cardInner: "#f7f7f5", cardInnerBorder: "#ebebeb",
  userBubble: "#e8e8e8",
};
const FONT = "'SF Pro Display','SF Pro Text','Inter',-apple-system,BlinkMacSystemFont,sans-serif";

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
  const shadow = t === LIGHT
    ? "0 4px 32px rgba(0,0,0,0.07), 0 1px 6px rgba(0,0,0,0.04)"
    : "0 4px 32px rgba(0,0,0,0.62), 0 1px 6px rgba(0,0,0,0.2)";
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
          Review lac operon before Friday — your notes are ready.
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
              Based on your <span style={{ color: t.text, fontWeight: 500 }}>Lecture 4 notes</span>, the lac operon is an inducible system — when lactose binds the repressor, it detaches from the operator and transcription begins. Your professor contrasted it with the trp operon (repressible).
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
  { speaker: "Prof", text: "Working memory has strict capacity limits — roughly seven items." },
  { speaker: "Prof", text: "Four components govern how we take in new information." },
  { speaker: "You",  text: "Is this the same as Miller's Law?" },
  { speaker: "Prof", text: "Exactly — seven plus or minus two chunks per modality." },
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
    "Working memory holds 7±2 chunks — design around this limit",
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
            Cognitive Load Theory — Week 6
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 9, marginBottom: 14 }}>
            {NOTES.map((note, i) => (
              <div key={i} style={{ ...fade(phase >= 5 + i), display: "flex", gap: 8, alignItems: "flex-start" }}>
                <span style={{ color: t.textFaint, fontSize: 14, lineHeight: 1.4, flexShrink: 0 }}>–</span>
                <span style={{ fontSize: 13, color: "rgba(0,0,0,0.58)", lineHeight: 1.55 }}>{note}</span>
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

// ── Features Showcase — replaces 4 standalone feature sections ───────────────
// Rotating headline + 4 tabs + glassmorphic demo card housing existing mockups.
// Mockups remount on tab switch (key trick) so their useInView/startedRef resets
// and animations replay immediately (the card is always in-viewport when visible).

const SHOWCASE_TABS = [
  { id: "tutor"     as const, label: "AI Tutor",    word: "AI Tutor",    desc: "Grounded in your actual lecture notes — not just the internet." },
  { id: "recording" as const, label: "Recording",   word: "Recorder",    desc: "Live transcription, always searchable, linked to your notes." },
  { id: "documents" as const, label: "Documents",   word: "Library",     desc: "PDFs and slides transform into notes and flashcards instantly." },
  { id: "rooms"     as const, label: "Study Rooms", word: "Study Room",  desc: "Focus together — shared timers, live presence, group AI." },
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
    <section style={{ padding: "100px 20px 80px", textAlign: "center", background: "#ffffff" }}>
      {/* Ghost sentinel — triggers background wordmark */}
      <div ref={ghostRef} aria-hidden="true" style={{ height: 0, margin: 0, padding: 0 }} />

      {/* Relocated product tagline */}
      <Reveal>
        <h1 style={{ fontSize: "clamp(36px,5.5vw,64px)", fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1.08, color: t.text, margin: "0 0 20px" }}>
          <span style={chromaStyle}>Your degree on autopilot.</span>
        </h1>
      </Reveal>
      <Reveal delay={0.06}>
        <p style={{ fontSize: 18, color: "rgba(0,0,0,0.52)", maxWidth: 440, margin: "0 auto 80px", lineHeight: 1.65 }}>
          The AI that reads your Canvas, explains your lectures, and keeps you ahead.
        </p>
      </Reveal>

      {/* Rotating headline */}
      <Reveal delay={0.1}>
        <h2 style={{ fontSize: "clamp(28px,4.2vw,50px)", fontWeight: 700, letterSpacing: "-0.025em", lineHeight: 1.1, marginBottom: 36, color: t.text }}>
          FschoolAI, your{" "}
          <span style={{
            ...chromaStyle,
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
          fontSize: 15, color: "rgba(0,0,0,0.50)", maxWidth: 380,
          margin: "0 auto 40px", lineHeight: 1.6,
          opacity: wordVisible ? 1 : 0,
          transition: "opacity 0.2s ease",
        }}>
          {activeTab.desc}
        </p>
      </Reveal>

      {/* Glassmorphic demo card — gradient border via padding-box / border-box trick */}
      <Reveal delay={0.18}>
        <div style={{
          maxWidth: 460, margin: "0 auto", borderRadius: 26, padding: 2,
          background: "linear-gradient(white,white) padding-box, linear-gradient(135deg,#b8a0dc,#f0a4bc,#94c4f0,#96e8a8) border-box",
          border: "1.5px solid transparent",
          boxShadow: "0 24px 64px rgba(0,0,0,0.08), 0 4px 16px rgba(0,0,0,0.04)",
        }}>
          <div style={{ background: "rgba(255,255,255,0.96)", borderRadius: 24, padding: 8, minHeight: 340, overflow: "hidden" }}>
            {/* key={activeTab.id} remounts the mockup → resets startedRef → animation replays */}
            <div key={activeTab.id} style={{ animation: "saFadeIn 0.28s ease both" }}>
              {activeTab.id === "tutor"     && <TutorMockup     t={t} />}
              {activeTab.id === "recording" && <RecordingMockup t={t} />}
              {activeTab.id === "documents" && <DocDropMockup   t={t} />}
              {activeTab.id === "rooms"     && <StudyRoomMockup t={t} />}
            </div>
          </div>
        </div>
      </Reveal>
    </section>
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
  { q: "Is FschoolAI free?", a: "Yes — 1 month free on beta signup, no credit card required. Pro features and extended storage are paid." },
  { q: "Does it work with my university's Canvas?", a: "Yes. FschoolAI syncs directly with Canvas via your access token — courses, assignments, deadlines, and grades." },
  { q: "What makes it different from ChatGPT?", a: "ChatGPT knows the internet. FschoolAI knows YOUR courses — your lecture notes, your syllabus, your actual assignments. Answers are grounded in what your professor actually said." },
  { q: "What's the Founding Card?", a: "A physical NFC titanium card for the first 1,000 members — it holds your AI identity, student number, and lifetime Pro access. See the Card page." },
];

export default function Landing({ onEnter }: { onEnter: (args: any) => Promise<void> }) {
  // Light-primary — no toggle. DARK tokens used directly in the card-preview section.
  const t = LIGHT;
  const [authMode, setAuthMode] = useState<"login"|"signup"|null>(null);
  const [forgotStatus, setForgotStatus] = useState<"sent"|"error"|null>(null);
  const [scrollY, setScrollY] = useState(0);
  const [faqOpen, setFaqOpen] = useState<number|null>(null);
  // Ghost wordmark: fires once when the product section scrolls into view, stays on.
  const [ghostRef, ghostVisible] = useInView(0.1);
  // True once hero scrolls ~85 % out of view — triggers header swap.
  const showProductBar = scrollY > (typeof window !== "undefined" ? window.innerHeight * 0.85 : 700);

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
    <div style={{ background: t.bg, color: t.text, fontFamily: FONT, minHeight: "100vh",
      overflowX: "hidden", transition: "background 0.3s ease, color 0.3s ease" }}>

      <style>{`
        @keyframes heroIn    { from{opacity:0;transform:translateY(20px)} to{opacity:1;transform:translateY(0)} }
        @keyframes scrollBob { 0%,100%{opacity:0.3;transform:translateY(0)} 50%{opacity:0.8;transform:translateY(6px)} }
        @keyframes saFadeIn  { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
        .sa-tab-row::-webkit-scrollbar { display:none }
      `}</style>

      {/* ── PRODUCT STICKY BAR — slides in when hero scrolls off, like Apple ── */}
      <div style={{
        position: "fixed", top: 0, left: 0, right: 0, zIndex: 102,
        height: 52,
        background: "rgba(255,255,255,0.88)",
        backdropFilter: "saturate(180%) blur(20px)",
        WebkitBackdropFilter: "saturate(180%) blur(20px)",
        borderBottom: "1px solid rgba(0,0,0,0.08)",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 22px",
        opacity: showProductBar ? 1 : 0,
        transform: showProductBar ? "translateY(0)" : "translateY(-100%)",
        transition: "opacity 0.32s ease, transform 0.32s cubic-bezier(0.25,0.46,0.45,0.94)",
        pointerEvents: showProductBar ? "auto" : "none",
      }}>
        <span style={{ fontSize: 17, fontWeight: 600, letterSpacing: "-0.3px", color: "#000" }}>
          Founding Card
        </span>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <a href="/card" style={{
            borderRadius: 50, border: "1px solid rgba(0,0,0,0.20)",
            padding: "7px 18px", fontSize: 13, fontWeight: 500,
            color: "#000", textDecoration: "none", background: "transparent",
            display: "inline-flex", alignItems: "center",
            transition: "background 0.15s",
          }}
            onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.background = "rgba(0,0,0,0.05)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.background = "transparent"; }}
          >Learn more</a>
          <a href="/card#order" style={{
            borderRadius: 50, border: "none",
            padding: "7px 18px", fontSize: 13, fontWeight: 600,
            color: "#fff", textDecoration: "none", background: "#000",
            display: "inline-flex", alignItems: "center",
            transition: "opacity 0.15s",
          }}
            onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.opacity = "0.78"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.opacity = "1"; }}
          >Apply →</a>
        </div>
      </div>

      {/* ── ANNOUNCEMENT BANNER — sits BELOW the nav, like Apple product pages ── */}
      <div style={{
        position: "fixed", top: 44, left: 0, right: 0, zIndex: 99,
        height: 44,
        background: "#f5f5f7",
        borderBottom: "1px solid rgba(0,0,0,0.07)",
        display: "flex", alignItems: "center", justifyContent: "center",
        opacity: showProductBar ? 0 : 1,
        transform: showProductBar ? "translateY(-100%)" : "translateY(0)",
        transition: "opacity 0.28s ease, transform 0.28s cubic-bezier(0.25,0.46,0.45,0.94)",
        pointerEvents: showProductBar ? "none" : "auto",
      }}>
        <p style={{
          fontSize: 12, fontWeight: 400, letterSpacing: "0.01em",
          color: "rgba(0,0,0,0.52)", margin: 0, textAlign: "center",
        }}>
          Founding members receive{" "}
          <span style={{ ...chromaStyle, fontWeight: 600 }}>
            Lifetime Pro&nbsp;· guaranteed founding number&nbsp;· express delivery
          </span>
          {" "}—{" "}
          <a href="/card#order" style={{
            color: "rgba(0,0,0,0.52)", textDecoration: "none",
            borderBottom: "1px solid rgba(0,0,0,0.22)", paddingBottom: 1,
            transition: "color 0.12s, border-color 0.12s",
          }}
            onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.color = "#000"; (e.currentTarget as HTMLAnchorElement).style.borderColor = "#000"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.color = "rgba(0,0,0,0.52)"; (e.currentTarget as HTMLAnchorElement).style.borderColor = "rgba(0,0,0,0.22)"; }}
          >Apply now →</a>
        </p>
      </div>


      {/* ── NAV — slides up when product bar takes over ── */}
      <nav style={{
        position: "fixed", top: 0, left: 0, right: 0, zIndex: 100,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 22px", height: 44,
        background: "rgba(255,255,255,0.82)",
        backdropFilter: "saturate(180%) blur(20px)",
        WebkitBackdropFilter: "saturate(180%) blur(20px)",
        borderBottom: "1px solid rgba(0,0,0,0.08)",
        opacity: showProductBar ? 0 : 1,
        transform: showProductBar ? "translateY(-100%)" : "translateY(0)",
        transition: "opacity 0.28s ease, transform 0.28s cubic-bezier(0.25,0.46,0.45,0.94)",
        pointerEvents: showProductBar ? "none" : "auto",
      }}>
        {/* Logo mark only */}
        <img src="/logo.jpeg" alt="FschoolAI"
          style={{ width: 22, height: 22, borderRadius: 5, objectFit: "cover" }} />
        {/* Actions */}
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <button
            onClick={() => setAuthMode("login")}
            style={{ background: "none", border: "none", padding: "5px 12px", fontSize: 12,
              fontWeight: 500, color: "rgba(0,0,0,0.48)", cursor: "pointer", fontFamily: FONT,
              transition: "color 0.15s" }}
            onMouseEnter={e => (e.currentTarget.style.color = "#000")}
            onMouseLeave={e => (e.currentTarget.style.color = "rgba(0,0,0,0.48)")}
          >Sign in</button>
          <button
            onClick={() => setAuthMode("signup")}
            style={{ background: "#000", color: "#fff", border: "none", borderRadius: 50,
              padding: "6px 18px", fontSize: 12, fontWeight: 600, cursor: "pointer",
              fontFamily: FONT, transition: "opacity 0.15s", letterSpacing: "0.01em" }}
            onMouseEnter={e => (e.currentTarget.style.opacity = "0.80")}
            onMouseLeave={e => (e.currentTarget.style.opacity = "1")}
          >Join Beta</button>
        </div>
      </nav>

      {/* ── HERO — 5-card fan, card-first, product forward ── */}
      <section style={{
        minHeight: "100vh", display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", position: "relative",
        padding: "130px 20px 100px", background: "#ffffff", overflow: "hidden",
      }}>
        <div style={{ textAlign: "center", position: "relative", zIndex: 3, width: "100%" }}>

          {/* Eyebrow — Magichromatic, matches the card colorways */}
          <p style={{
            fontSize: 11, fontWeight: 700, letterSpacing: "0.22em",
            marginBottom: 44, textTransform: "uppercase",
            animation: "heroIn 0.55s ease 0.08s both",
          }}>
            <span style={chromaStyle}>5 colorways &nbsp;·&nbsp; 1,000 founding members</span>
          </p>

          {/* ── Fan ── */}
          <div style={{ animation: "heroIn 0.85s ease 0.18s both", marginBottom: 28 }}>
            <img
              src="/cards/herodesktop_light.png"
              alt="FschoolAI Founding Cards — 5 colorways"
              style={{
                display: "block",
                width: "min(860px, calc(100vw - 40px))",
                height: "auto",
                margin: "0 auto",
                // Layer 1 (vertical): 5% top fade dissolves box top-edge; card bases solid;
                //   reflection fades 60→83%, giving the cinematic mirror dissolve.
                // Layer 2 (horizontal): 7% side feathers dissolve box left/right edges.
                // Intersect: corners dissolve faster than edges → naturally rounded silhouette.
                maskImage: [
                  "linear-gradient(to bottom, transparent 0%, black 5%, black 60%, transparent 83%)",
                  "linear-gradient(to right, transparent 0%, black 7%, black 93%, transparent 100%)",
                ].join(", "),
                WebkitMaskImage: [
                  "linear-gradient(to bottom, transparent 0%, black 5%, black 60%, transparent 83%)",
                  "linear-gradient(to right, transparent 0%, black 7%, black 93%, transparent 100%)",
                ].join(", "),
                maskComposite: "intersect",
                WebkitMaskComposite: "source-in",
              }}
            />
          </div>

          {/* Card feature list — 3 key benefits, reference-screenshot style */}
          <div style={{
            display: "flex", flexDirection: "column", gap: 9,
            margin: "0 auto 28px", maxWidth: 360, textAlign: "left",
            animation: "heroIn 0.55s ease 0.28s both",
          }}>
            {[
              "Titanium Black — exclusive, never sold separately",
              "Guaranteed founding number #0001–#1000",
              "White-glove packaging + express worldwide delivery",
            ].map(line => (
              <div key={line} style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                <span style={{ color: "rgba(0,0,0,0.22)", fontSize: 13, flexShrink: 0, lineHeight: 1.6 }}>—</span>
                <span style={{ fontSize: 13, color: "rgba(0,0,0,0.52)", lineHeight: 1.6 }}>{line}</span>
              </div>
            ))}
          </div>

          {/* Apple-caption tagline */}
          <p style={{
            fontSize: 15, fontWeight: 400, letterSpacing: "0.015em",
            color: "rgba(0,0,0,0.38)", margin: "0 auto 32px", lineHeight: 1.5,
            animation: "heroIn 0.55s ease 0.36s both",
          }}>
            The intelligence of FschoolAI. In a card.
          </p>

          {/* Card CTAs — direct after fan, signup lives in the nav */}
          <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap",
            animation: "heroIn 0.6s ease 0.44s both" }}>
            <a
              href="/card"
              style={{
                background: "#000", color: "#fff", textDecoration: "none",
                border: "none", borderRadius: 50, padding: "12px 28px",
                fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: FONT,
                display: "inline-flex", alignItems: "center",
                transition: "opacity 0.15s",
              }}
              onMouseEnter={e => ((e.currentTarget as HTMLAnchorElement).style.opacity = "0.80")}
              onMouseLeave={e => ((e.currentTarget as HTMLAnchorElement).style.opacity = "1")}
            >
              Learn more →
            </a>
            <a
              href="/card#order"
              style={{
                background: "transparent", color: "rgba(0,0,0,0.68)", textDecoration: "none",
                border: "1px solid rgba(0,0,0,0.16)", borderRadius: 50, padding: "12px 28px",
                fontSize: 14, cursor: "pointer", fontFamily: FONT,
                display: "inline-flex", alignItems: "center",
                transition: "border-color 0.15s, color 0.15s",
              }}
              onMouseEnter={e => { const el = e.currentTarget as HTMLAnchorElement; el.style.borderColor = "#000"; el.style.color = "#000"; }}
              onMouseLeave={e => { const el = e.currentTarget as HTMLAnchorElement; el.style.borderColor = "rgba(0,0,0,0.16)"; el.style.color = "rgba(0,0,0,0.68)"; }}
            >
              Apply for your card
            </a>
          </div>
        </div>

        {/* Scroll cue */}
        <div style={{ position: "absolute", bottom: 28, left: "50%", transform: "translateX(-50%)", textAlign: "center" }}>
          <div style={{ width: 1, height: 24, background: "linear-gradient(to bottom, transparent, rgba(0,0,0,0.14))", margin: "0 auto 5px" }} />
          <span style={{ fontSize: 14, opacity: 0.22, animation: "scrollBob 2s ease-in-out infinite" }}>↓</span>
        </div>
      </section>

      {/* ── FEATURES SHOWCASE — replaces 4 standalone sections ── */}
      <FeaturesShowcase t={t} chromaStyle={chromaStyle} ghostRef={ghostRef} />

      {/* ── BY THE NUMBERS ── */}
      <section style={{ padding: "100px 20px", textAlign: "center", background: "#ffffff" }}>
        <Reveal>
          <Label t={t}>By the numbers</Label>
          <div style={{ display: "flex", justifyContent: "center", gap: "clamp(32px,6vw,80px)", flexWrap: "wrap", marginTop: 8 }}>
            {[
              { val: "Real-time", sub: "transcription, no delay" },
              { val: "50+",       sub: "languages supported" },
              { val: "1 month",   sub: "free on beta signup" },
            ].map(({ val, sub }, i) => (
              <Reveal key={val} delay={i * 0.08} style={{ textAlign: "center" }}>
                <div style={{ fontSize: "clamp(40px,7vw,72px)", fontWeight: 700, lineHeight: 1, letterSpacing: "-0.03em", marginBottom: 10 }}>{val}</div>
                <div style={{ fontSize: 14, color: "rgba(0,0,0,0.42)", letterSpacing: "0.02em" }}>{sub}</div>
              </Reveal>
            ))}
          </div>
        </Reveal>
      </section>


      {/* ── FAQ ── */}
      <section style={{ padding: "100px 20px", background: "#f5f5f7" }}>
        <div style={{ maxWidth: 640, margin: "0 auto" }}>
          <Reveal style={{ textAlign: "center", marginBottom: 52 }}>
            <Label t={t}>FAQ</Label>
            <h2 style={{ fontSize: "clamp(32px,5vw,52px)", fontWeight: 700, letterSpacing: "-0.025em" }}>
              <span style={chromaStyle}>Questions answered.</span>
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

      {/* ── FOOTER ── */}
      <footer style={{ borderTop: `1px solid ${t.border}`, padding: "24px 20px",
        display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, background: "#f5f5f7" }}>
        <span style={{ fontSize: 14, fontWeight: 500, color: t.text }}>FschoolAI</span>
        <span style={{ fontSize: 12, color: t.textFaint }}>© 2026 FschoolAI. All rights reserved.</span>
        <div style={{ display: "flex", gap: 20 }}>
          {[["Privacy","#"],["Terms","#"],["Contact","#"]].map(([l,h]) => (
            <a key={l} href={h} style={{ fontSize: 12, color: t.textFaint, textDecoration: "none" }}>{l}</a>
          ))}
        </div>
      </footer>

      {/* ── AUTH + BANNER ── */}
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
            {forgotStatus === "sent" ? "Reset link sent — check your inbox." : "Something went wrong. Try again."}
          </p>
          <button onClick={() => setForgotStatus(null)} style={{ background: "none", border: "none", color: t.textMuted, cursor: "pointer", fontSize: 18 }}>×</button>
          <style>{`@keyframes bannerIn{from{opacity:0;transform:translateX(-50%) translateY(-10px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}`}</style>
        </div>
      )}
    </div>
  );
}

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

      {/* Features intro — distinct from the hero, introduces the product surfaces */}
      <Reveal>
        <h1 style={{ fontSize: "clamp(36px,5.5vw,64px)", fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1.08, color: t.text, margin: "0 0 20px" }}>
          <span style={chromaStyle}>Four tools.</span>
          <span style={{ color: t.text }}> One intelligence.</span>
        </h1>
      </Reveal>
      <Reveal delay={0.06}>
        <p style={{ fontSize: 18, color: "rgba(0,0,0,0.52)", maxWidth: 480, margin: "0 auto 80px", lineHeight: 1.65 }}>
          Purpose-built for the way students actually learn — grounded in your courses, not the internet.
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

// ── Ecosystem Circle ─────────────────────────────────────────────────────────
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

function EcosystemCircle({ t }: { t: typeof DARK }) {
  const R = 40; // ring radius as % of container (= 176px at 440px size)
  // SVG endpoint for each icon (in 0–440 viewBox coords, radius=175)
  const SVG_R = 175;
  const svgPts = ECO_ITEMS.map(item => {
    const rad = item.angle * (Math.PI / 180);
    return { x: 220 + SVG_R * Math.cos(rad), y: 220 + SVG_R * Math.sin(rad) };
  });
  const positions = ECO_ITEMS.map(item => {
    const rad = item.angle * (Math.PI / 180);
    return { cx: 50 + R * Math.cos(rad), cy: 50 + R * Math.sin(rad) };
  });
  return (
    <section style={{ padding: "100px 20px", textAlign: "center", background: "#f5f5f7" }}>
      <Reveal>
        <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.18em", textTransform: "uppercase", color: "rgba(0,0,0,0.32)", marginBottom: 16 }}>Integrations</p>
        <h2 style={{ fontSize: "clamp(28px,4.5vw,50px)", fontWeight: 700, letterSpacing: "-0.025em", lineHeight: 1.1, color: t.text, margin: "0 0 16px" }}>
          Connects to everything<br />you already use.
        </h2>
        <p style={{ fontSize: 16, color: "rgba(0,0,0,0.50)", maxWidth: 380, margin: "0 auto 56px", lineHeight: 1.6 }}>
          Canvas, YouTube, Google Drive, Microsoft Teams, Discord — your whole academic world, in one place.
        </p>
      </Reveal>
      <Reveal delay={0.1}>
        <div style={{ position: "relative", width: "min(480px, 92vw)", height: "min(480px, 92vw)", margin: "0 auto" }}>

          {/* ── Layer 0: ambient glow ring (non-rotating, breathes) ── */}
          <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
            <svg viewBox="0 0 440 440" width="100%" height="100%">
              <circle cx="220" cy="220" r="175" fill="none" stroke="rgba(130,110,200,0.08)" strokeWidth="14"
                style={{ animation: "ringPulse 4s ease-in-out infinite" }} />
            </svg>
          </div>

          {/* ── Layer 1: rotating ring + constellation lines + dashes ── */}
          <div style={{ position: "absolute", inset: 0, animation: "ecoRingOrbit 45s linear infinite" }}>
            <svg viewBox="0 0 440 440" width="100%" height="100%">
              {/* Dashed orbit ring */}
              <circle cx="220" cy="220" r="175" fill="none"
                stroke="rgba(0,0,0,0.10)" strokeWidth="1.5"
                strokeDasharray="7 10" strokeLinecap="round"/>
              {/* Constellation lines — center→icon, flowing data dash */}
              {svgPts.map(({ x, y }, i) => (
                <line key={i} x1="220" y1="220" x2={x} y2={y}
                  stroke={`${(ECO_ITEMS[i] as any).border}55`}
                  strokeWidth="1.1"
                  strokeDasharray="6 7"
                  strokeLinecap="round"
                  style={{ animation: `lineFlow 2.2s linear ${(i * 0.36).toFixed(2)}s infinite` }}
                />
              ))}
            </svg>
          </div>

          {/* ── Layer 2: center FschoolAI logo (pulsing glow) ── */}
          <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", zIndex: 4 }}>
            <div style={{
              width: 64, height: 64, borderRadius: 18, background: "#fff",
              overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center",
              animation: "centerOrb 3.6s ease-in-out infinite",
            }}>
              <img src="/logo.jpeg" alt="FschoolAI" style={{ width: 64, height: 64, objectFit: "cover" }} />
            </div>
          </div>

          {/* ── Layer 3: orbiting icon circles ── */}
          <div style={{ position: "absolute", inset: 0, animation: "ecoRingOrbit 45s linear infinite" }}>
            {ECO_ITEMS.map((item, i) => {
              const { cx, cy } = positions[i];
              return (
                <div key={item.name} style={{ position: "absolute", left: `${cx}%`, top: `${cy}%`, transform: "translate(-50%, -50%)", zIndex: 3 }}>
                  {/* counter-rotate wraps both icon + label so both stay upright */}
                  <div style={{ animation: `ecoCounter 45s linear infinite` }}>
                    {/* Icon with staggered ping */}
                    <div style={{ animation: `iconPing 3.2s ease-in-out ${(i * 0.52).toFixed(2)}s infinite` }}>
                      <div style={{
                        width: 50, height: 50, borderRadius: "50%",
                        background: item.bg,
                        border: `1.5px solid ${item.border}30`,
                        boxShadow: `0 6px 22px ${item.border}22, 0 1px 4px rgba(0,0,0,0.06), inset 0 1px 0 rgba(255,255,255,0.9)`,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        backdropFilter: "blur(2px)",
                      }}>
                        {item.icon}
                      </div>
                    </div>
                    <p style={{ fontSize: 9, fontWeight: 600, color: "rgba(0,0,0,0.42)", letterSpacing: "0.02em", marginTop: 6, whiteSpace: "nowrap", textAlign: "center" }}>{item.name}</p>
                  </div>
                </div>
              );
            })}
          </div>

        </div>
      </Reveal>
    </section>
  );
}

// ── Three Moments — replaces plain "By the Numbers" ─────────────────────────
// Split-layout rows: animated visual on one side, premium stat + copy on the
// other. Each moment shows the product in a real student scenario.

// Mini waveform bars — 12 bars at varying heights + CSS animation
function MiniWaveform() {
  const BARS = [18,28,14,36,22,32,16,40,24,30,18,28];
  const DELAYS = [0,.08,.16,.04,.12,.20,.06,.14,.10,.18,.02,.16];
  const [ref, visible] = useInView(0.4);
  return (
    <div ref={ref} style={{ display:"flex", alignItems:"center", gap:3, height:48 }}>
      {BARS.map((h,i)=>(
        <div key={i} style={{
          width:4, borderRadius:3,
          background: i < 8 ? "rgba(0,0,0,0.7)" : "rgba(0,0,0,0.18)",
          height: h,
          transformOrigin:"center",
          animation: visible && i < 8 ? `waveBar 0.65s ease-in-out ${DELAYS[i]}s infinite` : "none",
        }}/>
      ))}
    </div>
  );
}

// Animated concept tags that float in with stagger
const CONCEPTS = ["Lac Operon","Cell Division","Mitosis","ATP Synthesis","Enzyme Kinetics","CRISPR"];
function ConceptCloud() {
  const [ref, visible] = useInView(0.3);
  return (
    <div ref={ref} style={{ display:"flex", flexWrap:"wrap", gap:8, maxWidth:280 }}>
      {CONCEPTS.map((c,i)=>(
        <span key={c} style={{
          fontSize:12, fontWeight:600, padding:"5px 12px",
          borderRadius:20, letterSpacing:"0.02em",
          background: i%2===0 ? "rgba(0,0,0,0.06)" : "rgba(0,0,0,0.04)",
          color: "rgba(0,0,0,0.68)",
          border:"1px solid rgba(0,0,0,0.09)",
          opacity: visible ? 1 : 0,
          transform: visible ? "translateY(0) scale(1)" : "translateY(12px) scale(0.92)",
          transition: `opacity 0.45s ease ${i*0.09}s, transform 0.45s cubic-bezier(0.16,1,0.3,1) ${i*0.09}s`,
        }}>{c}</span>
      ))}
    </div>
  );
}

// Live transcript lines appearing with stagger
function LiveTranscript() {
  const [ref, visible] = useInView(0.4);
  const lines = [
    "…cognitive load theory suggests working",
    "memory has strict capacity limits.",
    "Four components govern how we process",
    "new information in real time…",
  ];
  return (
    <div ref={ref} style={{ textAlign:"left" }}>
      {lines.map((line, i) => (
        <p key={i} style={{
          fontSize:12, color:"rgba(0,0,0,0.52)", lineHeight:1.7, margin:0,
          opacity: visible ? 1 : 0,
          transform: visible ? "none" : "translateY(6px)",
          transition: `opacity 0.4s ease ${0.3+i*0.12}s, transform 0.4s ease ${0.3+i*0.12}s`,
        }}>{line}</p>
      ))}
    </div>
  );
}

function ThreeMoments({ t }: { t: typeof DARK }) {
  const rows = [
    {
      bg: "#ffffff", flip: false,
      label: "During lecture",
      stat: "Real-time",
      statSub: "transcription — live as it happens",
      body: "FschoolAI captures your lectures the moment they start. No typing, no missed words — just the full transcript, ready to search and study from.",
      visual: (
        <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
          <MiniWaveform />
          <LiveTranscript />
        </div>
      ),
    },
    {
      bg: "#f5f5f7", flip: true,
      label: "After class",
      stat: "47",
      statSub: "key concepts extracted per lecture on average",
      body: "The AI reads through your entire lecture, surfaces the concepts your professor actually emphasised, and connects them to your existing notes.",
      visual: <ConceptCloud />,
    },
    {
      bg: "#ffffff", flip: false,
      label: "Before the exam",
      stat: "1 month",
      statSub: "free on beta signup — no credit card",
      body: "Start for free. Every tool — live recording, AI tutor, flashcards, study rooms — works from day one. No feature gates, no trial tricks.",
      visual: (
        <div style={{
          width: 200, background:"#000", borderRadius:16,
          padding:"22px 20px", color:"#fff",
          boxShadow:"0 20px 48px rgba(0,0,0,0.18), 0 4px 12px rgba(0,0,0,0.1)",
        }}>
          <p style={{fontSize:10,fontWeight:600,letterSpacing:"0.18em",color:"rgba(255,255,255,0.4)",textTransform:"uppercase",marginBottom:16}}>FschoolAI Beta</p>
          <p style={{fontSize:24,fontWeight:700,letterSpacing:"-0.03em",marginBottom:4}}>Free</p>
          <p style={{fontSize:12,color:"rgba(255,255,255,0.5)",marginBottom:18}}>First month, always</p>
          {["AI Tutor","Live Recording","Flashcards","Study Rooms"].map(f=>(
            <div key={f} style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
              <div style={{width:14,height:14,borderRadius:"50%",background:"rgba(255,255,255,0.12)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                <div style={{width:6,height:6,borderRadius:"50%",background:"rgba(255,255,255,0.7)"}}/>
              </div>
              <span style={{fontSize:12,color:"rgba(255,255,255,0.7)"}}>{f}</span>
            </div>
          ))}
        </div>
      ),
    },
  ];

  return (
    <>
      {rows.map(({ bg, flip, label, stat, statSub, body, visual }) => (
        <section key={label} style={{ background: bg, padding: "80px 20px" }}>
          <div style={{
            maxWidth: 860, margin: "0 auto",
            display: "flex", gap: "clamp(32px,6vw,80px)",
            alignItems: "center", flexWrap: "wrap",
            flexDirection: flip ? "row-reverse" : "row",
          }}>
            {/* Text side */}
            <Reveal style={{ flex: "1 1 280px" }}>
              <p style={{ fontSize:11, fontWeight:600, letterSpacing:"0.16em", textTransform:"uppercase", color:"rgba(0,0,0,0.30)", marginBottom:14 }}>{label}</p>
              <div style={{ fontSize:"clamp(44px,6vw,72px)", fontWeight:700, letterSpacing:"-0.04em", lineHeight:1, marginBottom:8, color:t.text }}>{stat}</div>
              <p style={{ fontSize:14, color:"rgba(0,0,0,0.42)", marginBottom:20, letterSpacing:"0.01em" }}>{statSub}</p>
              <p style={{ fontSize:16, color:"rgba(0,0,0,0.58)", lineHeight:1.65, maxWidth:340 }}>{body}</p>
            </Reveal>
            {/* Visual side */}
            <Reveal delay={0.1} style={{ flex:"1 1 240px", display:"flex", justifyContent: flip ? "flex-start" : "flex-end" }}>
              {visual}
            </Reveal>
          </div>
        </section>
      ))}
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
      background: "linear-gradient(180deg, #f5f5f7 0%, #0a0a0c 120px, #0a0a0c calc(100% - 120px), #ffffff 100%)",
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
          color: "rgba(255,255,255,0.3)", marginBottom: 16 }}>Knowledge Graph</p>
        <h2 style={{ fontSize: "clamp(28px,4.5vw,52px)", fontWeight: 700, letterSpacing: "-0.03em",
          lineHeight: 1.05, color: "#f5f5f7", margin: "0 0 16px" }}>
          Your academic world,{" "}
          <span style={{ ...chromaStyle }}>connected.</span>
        </h2>
        <p style={{ fontSize: 16, color: "rgba(255,255,255,0.45)", maxWidth: 440,
          margin: "0 auto", lineHeight: 1.6 }}>
          FschoolAI builds a living map of your courses, lectures, notes and deadlines —
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
                    fill="rgba(255,255,255,0.35)"
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
              <p style={{ fontSize: 13, color: "rgba(255,255,255,0.40)", lineHeight: 1.6 }}>{body}</p>
            </div>
          ))}
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
        .apple-nav-links { display:flex; gap:28px; align-items:center; }
        @media(max-width:680px){ .apple-nav-links{ display:none!important; } }
      `}</style>

      {/* ── PRODUCT STICKY BAR — slides in when hero scrolls off, like Apple ── */}
      <div style={{
        position: "fixed", top: 0, left: 0, right: 0, zIndex: 102,
        height: 52,
        background: "rgba(255,255,255,0.88)",
        backdropFilter: "saturate(180%) blur(20px)",
        WebkitBackdropFilter: "saturate(180%) blur(20px)",
        borderBottom: "none",
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

      {/* ── ANNOUNCEMENT BANNER — sits BELOW the nav, frosted white like the nav ── */}
      <div style={{
        position: "fixed", top: 44, left: 0, right: 0, zIndex: 99,
        height: 44,
        background: "#f5f5f7",
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


      {/* ── NAV — three-column Apple layout, no border ── */}
      <nav style={{
        position: "fixed", top: 0, left: 0, right: 0, zIndex: 100,
        display: "flex", alignItems: "center",
        padding: "0 22px", height: 44,
        background: "#ffffff",
        opacity: showProductBar ? 0 : 1,
        transform: showProductBar ? "translateY(-100%)" : "translateY(0)",
        transition: "opacity 0.28s ease, transform 0.28s cubic-bezier(0.25,0.46,0.45,0.94)",
        pointerEvents: showProductBar ? "none" : "auto",
      }}>
        {/* Left */}
        <div style={{ flex: 1 }}>
          <img src="/logo.jpeg" alt="FschoolAI"
            style={{ width: 22, height: 22, borderRadius: 5, objectFit: "cover", display: "block" }} />
        </div>
        {/* Center — hidden on mobile via CSS */}
        <div className="apple-nav-links">
          {[{ label:"Card", href:"/card" }, { label:"Features", href:"#features" }, { label:"Pricing", href:"#pricing" }, { label:"Blog", href:"/blog" }].map(({ label, href }) => (
            <a key={label} href={href} style={{ fontSize: 13, fontWeight: 400, color: "rgba(0,0,0,0.56)", textDecoration: "none", letterSpacing: "-0.01em", transition: "color 0.15s" }}
              onMouseEnter={e => ((e.currentTarget as HTMLAnchorElement).style.color = "#000")}
              onMouseLeave={e => ((e.currentTarget as HTMLAnchorElement).style.color = "rgba(0,0,0,0.56)")}
            >{label}</a>
          ))}
        </div>
        {/* Right */}
        <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 4, justifyContent: "flex-end" }}>
          <button onClick={() => setAuthMode("login")}
            style={{ background: "none", border: "none", padding: "5px 12px", fontSize: 12,
              fontWeight: 500, color: "rgba(0,0,0,0.48)", cursor: "pointer", fontFamily: FONT,
              transition: "color 0.15s" }}
            onMouseEnter={e => (e.currentTarget.style.color = "#000")}
            onMouseLeave={e => (e.currentTarget.style.color = "rgba(0,0,0,0.48)")}
          >Sign in</button>
          <button onClick={() => setAuthMode("signup")}
            style={{ background: "#000", color: "#fff", border: "none", borderRadius: 50,
              padding: "6px 18px", fontSize: 12, fontWeight: 600, cursor: "pointer",
              fontFamily: FONT, transition: "opacity 0.15s", letterSpacing: "0.01em" }}
            onMouseEnter={e => (e.currentTarget.style.opacity = "0.80")}
            onMouseLeave={e => (e.currentTarget.style.opacity = "1")}
          >Join Beta</button>
        </div>
      </nav>

      {/* ── HERO — full-bleed dark scene, no box, Apple spring entrance ── */}
      <section style={{
        background: "linear-gradient(180deg, #1c1c1e 0%, #141416 60%, #0e0e10 100%)",
        minHeight: "100dvh", display: "flex", flexDirection: "column",
        alignItems: "center", paddingTop: "clamp(120px,18vw,160px)",
        overflow: "hidden", position: "relative",
      }}>
        {/* Ambient radial highlight */}
        <div aria-hidden="true" style={{ position: "absolute", top: 0, left: "50%", transform: "translateX(-50%)", width: "80%", height: 400, background: "radial-gradient(ellipse 70% 50% at 50% 0%, rgba(255,255,255,0.04) 0%, transparent 100%)", pointerEvents: "none" }} />

        {/* Text */}
        <div style={{ textAlign: "center", padding: "0 20px", position: "relative", zIndex: 1 }}>
          <p style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", color: "rgba(255,255,255,0.45)", marginBottom: 16, letterSpacing: "0.18em", animation: "appleLabel 0.8s cubic-bezier(0.16,1,0.3,1) 0.1s both" }}>
            Founding Card &nbsp;·&nbsp; 1,000 only
          </p>
          <h1 style={{ fontSize: "clamp(32px,6.5vw,68px)", fontWeight: 700, letterSpacing: "-0.035em", lineHeight: 1.0, color: "#f5f5f7", margin: "0 0 14px", animation: "appleTitle 0.9s cubic-bezier(0.16,1,0.3,1) 0.22s both" }}>
            Your degree on autopilot.
          </h1>
          <p style={{ fontSize: "clamp(15px,2.4vw,19px)", fontWeight: 400, color: "rgba(255,255,255,0.58)", lineHeight: 1.5, margin: "0 auto 32px", maxWidth: 440, animation: "appleSub 0.85s cubic-bezier(0.16,1,0.3,1) 0.38s both" }}>
            5 colorways. Titanium Black. The intelligence of FschoolAI, in a card.
          </p>
          <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap", animation: "appleCta 0.8s cubic-bezier(0.16,1,0.3,1) 0.52s both" }}>
            <a href="/card" style={{ background: "rgba(255,255,255,0.90)", color: "#141416", textDecoration: "none", borderRadius: 50, padding: "10px 24px", fontSize: 14, fontWeight: 500, display: "inline-flex", alignItems: "center", fontFamily: FONT, letterSpacing: "-0.01em", transition: "background 0.15s" }}
              onMouseEnter={e => ((e.currentTarget as HTMLAnchorElement).style.background = "#fff")}
              onMouseLeave={e => ((e.currentTarget as HTMLAnchorElement).style.background = "rgba(255,255,255,0.90)")}
            >Learn more</a>
            <a href="/card#order" style={{ background: "transparent", color: "rgba(255,255,255,0.85)", textDecoration: "none", borderRadius: 50, border: "1px solid rgba(255,255,255,0.28)", padding: "10px 24px", fontSize: 14, fontWeight: 500, display: "inline-flex", alignItems: "center", fontFamily: FONT, letterSpacing: "-0.01em", transition: "border-color 0.15s, color 0.15s" }}
              onMouseEnter={e => { const a = e.currentTarget as HTMLAnchorElement; a.style.borderColor = "rgba(255,255,255,0.7)"; a.style.color = "#fff"; }}
              onMouseLeave={e => { const a = e.currentTarget as HTMLAnchorElement; a.style.borderColor = "rgba(255,255,255,0.28)"; a.style.color = "rgba(255,255,255,0.85)"; }}
            >Apply for your card</a>
          </div>
        </div>

        {/* Fan — dark-bg, capped at native 959 px so no upscale blur on desktop.
            Centered via margin:auto; no transform hacks. */}
        <div style={{ width: "100%", marginTop: 20, lineHeight: 0, overflow: "hidden", animation: "appleCards 1.1s cubic-bezier(0.16,1,0.3,1) 0.6s both", flex: 1, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
          <img src="/cards/herodesktop.png" alt="FschoolAI Founding Cards — 5 colorways"
            style={{
              display: "block",
              width: "min(100%, 959px)",
              height: "auto",
              margin: "0 auto",
              // Entrance spring → then perpetual gentle float
              animation: "appleCards 1.1s cubic-bezier(0.16,1,0.3,1) 0.6s both, cardFloat 5s ease-in-out 1.8s infinite",
              // Top: fade in from dark bg. Bottom: dissolves into the next section (no sharp PNG edge).
              maskImage: "linear-gradient(to bottom, transparent 0%, black 10%, black 70%, transparent 98%)",
              WebkitMaskImage: "linear-gradient(to bottom, transparent 0%, black 10%, black 70%, transparent 98%)",
            }}
          />
        </div>

        {/* Micro edge-blend — only softens the very last 40px where the dark bg
            meets the white section. Doesn't reach the reflection. */}
        <div aria-hidden="true" style={{
          position: "absolute", bottom: 0, left: 0, right: 0,
          height: 40,
          background: "linear-gradient(to bottom, transparent 0%, #ffffff 100%)",
          pointerEvents: "none",
          zIndex: 2,
        }} />
      </section>

      {/* ── FEATURES SHOWCASE — replaces 4 standalone sections ── */}
      <FeaturesShowcase t={t} chromaStyle={chromaStyle} ghostRef={ghostRef} />

      {/* ── ECOSYSTEM CIRCLE ── */}
      <EcosystemCircle t={t} />

      {/* ── BLOCK C: KNOWLEDGE MAP ── */}
      <KnowledgeMap t={t} chromaStyle={chromaStyle} />

      {/* ── THREE MOMENTS — premium split-layout, live animated visuals ── */}
      <ThreeMoments t={t} />


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

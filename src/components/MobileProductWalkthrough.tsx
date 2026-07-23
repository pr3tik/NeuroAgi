import React, { useRef, useEffect, useState } from "react";

const FONT = '-apple-system,BlinkMacSystemFont,"SF Pro Display","SF Pro Text","Helvetica Neue",Arial,sans-serif';
const PW = 340;
const PH = 680;

interface SceneDef {
  tag: string;
  headline: string;
  copy: string;
  showCTA?: boolean;
}

const SCENES: SceneDef[] = [
  { tag: "Get started", headline: "Unlock\nyour day.", copy: "Your campus life, beautifully organized. Courses, deadlines, and your AI tutor — one glance away." },
  { tag: "Canvas sync", headline: "Connect\nCanvas.", copy: "Link your school's LMS in seconds. Every course, syllabus, and instructor — pulled in and kept in sync." },
  { tag: "Assignments", headline: "Assignments\nsynced.", copy: "Never miss a deadline. Every assignment is tracked, dated, and surfaced exactly when you need it." },
  { tag: "AI tutor", headline: "Meet\nReggie.", copy: "Your AI study companion. Ask anything — it already knows your courses, your notes, and where you're stuck." },
  { tag: "Lectures", headline: "Lecture\nimported.", copy: "Drop in a recording or PDF. Reggie reads it, summarizes it, and turns it into ready-to-study material." },
  { tag: "Study Rooms", headline: "Focus\ntogether.", copy: "Real-time rooms with AI grounded in your shared notes. Shared timers, quizzes, and live chat." },
  { tag: "Flashcards", headline: "Flip it.\nLearn it.", copy: "AI-generated flashcards from your own lectures and notes. Spaced repetition brings them back at just the right time." },
  { tag: "AI summaries", headline: "AI\nsummaries.", copy: "Every lecture distilled to what matters. Key concepts, definitions, and potential exam questions — from your actual material." },
  { tag: "Early access", headline: "Launching\nsoon.", copy: "AI-native learning built for students who take their grades seriously. Be among the first.", showCTA: true },
];

// ── Screen components ────────────────────────────────────────────────────────

function ScreenLock({ isActive }: { isActive: boolean }) {
  return (
    <div style={{
      width: "100%", height: "100%",
      background: "linear-gradient(180deg,#000c2e 0%,#001240 60%,#000820 100%)",
      display: "flex", flexDirection: "column", alignItems: "center",
      fontFamily: FONT, color: "#fff", overflow: "hidden", position: "relative",
    }}>
      <div style={{ position: "absolute", top: "-20%", left: "15%", width: "70%", height: "65%",
        background: "radial-gradient(ellipse,rgba(79,110,255,0.16) 0%,transparent 70%)" }} />
      <div style={{ marginTop: 72, fontSize: 66, fontWeight: 200, letterSpacing: "-0.04em", lineHeight: 1 }}>9:41</div>
      <div style={{ fontSize: 14, color: "rgba(255,255,255,0.42)", marginTop: 6 }}>Monday, January 13</div>
      <div style={{ marginTop: 48, display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
        <img src="/fschoolai-logo.jpeg" alt="" style={{
          width: 78, height: 78, objectFit: "contain", borderRadius: 18,
          filter: "drop-shadow(0 6px 24px rgba(79,110,255,0.42))",
        }} />
        <span style={{ fontSize: 15, fontWeight: 600, color: "rgba(255,255,255,0.82)" }}>FSchoolAI</span>
      </div>
      <div style={{
        marginTop: 40, padding: "10px 20px", borderRadius: 22,
        background: "rgba(255,255,255,0.08)", backdropFilter: "blur(12px)",
        border: "1px solid rgba(255,255,255,0.11)", fontSize: 13, color: "rgba(255,255,255,0.78)",
        opacity: isActive ? 1 : 0,
        transform: isActive ? "translateY(0)" : "translateY(8px)",
        transition: "opacity 0.5s 0.3s ease, transform 0.5s 0.3s ease",
      }}>Welcome back, Aisha</div>
      <div style={{ position: "absolute", bottom: 38, display: "flex", flexDirection: "column", alignItems: "center", gap: 5 }}>
        <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
          <rect x="1" y="1" width="7" height="7" rx="2" stroke="rgba(255,255,255,0.28)" strokeWidth="1.4"/>
          <rect x="20" y="1" width="7" height="7" rx="2" stroke="rgba(255,255,255,0.28)" strokeWidth="1.4"/>
          <rect x="1" y="20" width="7" height="7" rx="2" stroke="rgba(255,255,255,0.28)" strokeWidth="1.4"/>
          <rect x="20" y="20" width="7" height="7" rx="2" stroke="rgba(255,255,255,0.28)" strokeWidth="1.4"/>
          <path d="M11 14.5L13.3 17L18 11.5" stroke="rgba(255,255,255,0.38)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        <span style={{ fontSize: 9, color: "rgba(255,255,255,0.22)", letterSpacing: "0.08em" }}>FACE ID</span>
      </div>
    </div>
  );
}

function ScreenCanvas({ isActive }: { isActive: boolean }) {
  const CIRC = 2 * Math.PI * 11;
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (isActive) { const t = setTimeout(() => setShow(true), 280); return () => clearTimeout(t); }
    setShow(false);
  }, [isActive]);

  const courses = [
    { c: "CHEM 201", t: "Reaction Mechanisms", col: "#FF6B6B", pct: 40, bg: "#fff0f0" },
    { c: "BIO 110", t: "Lab report due tomorrow", col: "#FF9F43", pct: 70, bg: "#fff6ee", urgent: true },
    { c: "PSYC 101", t: "Essay submitted", col: "#4CAF50", pct: 100, bg: "#f0fff2" },
  ];

  return (
    <div style={{ width: "100%", height: "100%", background: "#f2f2f7", fontFamily: FONT, overflow: "hidden" }}>
      <div style={{ background: "rgba(255,255,255,0.94)", backdropFilter: "blur(20px)",
        padding: "54px 18px 13px", borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: "#000", letterSpacing: "-0.02em" }}>Good afternoon, Aisha</div>
      </div>
      <div style={{
        margin: "11px 14px 0", padding: "10px 13px", borderRadius: 12,
        background: "linear-gradient(135deg,#e8eeff,#d8e2ff)", border: "1px solid rgba(79,110,255,0.18)",
        display: "flex", alignItems: "center", gap: 10,
        opacity: show ? 1 : 0, transform: show ? "translateY(0)" : "translateY(-10px)",
        transition: "opacity 0.4s ease, transform 0.4s ease",
      }}>
        <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#4F6EFF",
          boxShadow: "0 0 0 3px rgba(79,110,255,0.2)", flexShrink: 0 }} />
        <span style={{ fontSize: 12, fontWeight: 600, color: "#253EFF", flex: 1 }}>Canvas synced · 3 new items</span>
        <span style={{ fontSize: 11, color: "rgba(0,0,0,0.35)" }}>just now</span>
      </div>
      <div style={{ padding: "11px 14px 0", display: "flex", flexDirection: "column", gap: 8 }}>
        {courses.map((d, i) => (
          <div key={i} style={{
            padding: "11px 13px", borderRadius: 13, background: "#fff",
            boxShadow: "0 2px 8px rgba(0,0,0,0.05)", display: "flex", alignItems: "center", gap: 11,
            opacity: show ? 1 : 0, transform: show ? "translateY(0)" : "translateY(12px)",
            transition: `opacity 0.4s ${0.08 + i * 0.07}s ease, transform 0.4s ${0.08 + i * 0.07}s ease`,
          }}>
            <div style={{ width: 38, height: 38, borderRadius: 9, background: d.bg,
              display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <svg width="26" height="26" viewBox="0 0 26 26" style={{ transform: "rotate(-90deg)" }}>
                <circle cx="13" cy="13" r="11" fill="none" stroke="rgba(0,0,0,0.07)" strokeWidth="3"/>
                <circle cx="13" cy="13" r="11" fill="none" stroke={d.col} strokeWidth="3"
                  strokeDasharray={`${CIRC * d.pct / 100} ${CIRC}`} strokeLinecap="round"/>
              </svg>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: d.col, letterSpacing: "0.04em" }}>{d.c}</div>
              <div style={{ fontSize: 12, fontWeight: 500, color: "#111", marginTop: 1,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{d.t}</div>
            </div>
            {(d as any).urgent && (
              <div style={{ fontSize: 9, fontWeight: 700, color: "#FF9F43",
                background: "#fff5e8", padding: "3px 7px", borderRadius: 5, flexShrink: 0 }}>DUE</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ScreenAssignments({ isActive }: { isActive: boolean }) {
  const [animated, setAnimated] = useState(false);
  useEffect(() => {
    if (isActive) { const t = setTimeout(() => setAnimated(true), 320); return () => clearTimeout(t); }
    setAnimated(false);
  }, [isActive]);

  const R = 27, CIRC = 2 * Math.PI * R;
  const assignments = [
    { c: "BIO 110", t: "Lab Report: Enzyme Kinetics", due: "Tomorrow, 11:59 PM", col: "#FF9F43", urgent: true, pct: 70 },
    { c: "CHEM 201", t: "Reaction Mechanisms Problem Set", due: "Friday, 3:00 PM", col: "#4F6EFF", pct: 40 },
  ];

  return (
    <div style={{ width: "100%", height: "100%", background: "#f2f2f7", fontFamily: FONT, overflow: "hidden" }}>
      <div style={{ padding: "54px 18px 13px", background: "rgba(255,255,255,0.94)",
        backdropFilter: "blur(20px)", borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
        <div style={{ fontSize: 23, fontWeight: 700, color: "#000", letterSpacing: "-0.025em" }}>Assignments</div>
        <div style={{ fontSize: 12, color: "rgba(0,0,0,0.38)", marginTop: 3 }}>2 active · 1 overdue</div>
      </div>
      <div style={{ padding: "13px" }}>
        {assignments.map((a, i) => (
          <div key={i} style={{ padding: "15px", borderRadius: 15, background: "#fff",
            boxShadow: "0 2px 12px rgba(0,0,0,0.07)", marginBottom: 11, display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ flexShrink: 0, position: "relative", width: 62, height: 62 }}>
              <svg width="62" height="62" viewBox="0 0 62 62" style={{ transform: "rotate(-90deg)" }}>
                <circle cx="31" cy="31" r={R} fill="none" stroke="rgba(0,0,0,0.07)" strokeWidth="5"/>
                <circle cx="31" cy="31" r={R} fill="none" stroke={a.col} strokeWidth="5"
                  strokeLinecap="round" strokeDasharray={CIRC}
                  strokeDashoffset={animated ? CIRC * (1 - a.pct / 100) : CIRC}
                  style={{ transition: animated ? `stroke-dashoffset 0.95s ${i * 0.14}s cubic-bezier(0.4,0,0.2,1)` : "none" }}
                />
              </svg>
              <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 11, fontWeight: 700, color: a.col }}>{a.pct}%</div>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: a.col, letterSpacing: "0.05em",
                textTransform: "uppercase" as const, marginBottom: 3 }}>{a.c}</div>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#000", lineHeight: 1.35 }}>{a.t}</div>
              <div style={{ fontSize: 11, marginTop: 4,
                color: (a as any).urgent ? "#FF9F43" : "rgba(0,0,0,0.38)",
                fontWeight: (a as any).urgent ? 600 : 400 }}>{a.due}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ScreenReggie({ isActive }: { isActive: boolean }) {
  const CIRC = 2 * Math.PI * 11;
  const [reggieIn, setReggieIn] = useState(false);
  useEffect(() => {
    if (isActive) { const t = setTimeout(() => setReggieIn(true), 450); return () => clearTimeout(t); }
    setReggieIn(false);
  }, [isActive]);

  const courses = [
    { c: "CHEM 201", t: "Reaction Mechanisms", col: "#FF6B6B", pct: 40, bg: "#fff0f0" },
    { c: "BIO 110", t: "Lab report due tomorrow", col: "#FF9F43", pct: 70, bg: "#fff6ee" },
    { c: "PSYC 101", t: "Essay submitted", col: "#4CAF50", pct: 100, bg: "#f0fff2" },
  ];

  return (
    <div style={{ width: "100%", height: "100%", background: "#f2f2f7", fontFamily: FONT, overflow: "hidden", position: "relative" }}>
      <div style={{ background: "rgba(255,255,255,0.94)", backdropFilter: "blur(20px)",
        padding: "54px 18px 13px", borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: "#000", letterSpacing: "-0.02em" }}>Good afternoon, Aisha</div>
      </div>
      <div style={{ padding: "11px 14px 0", display: "flex", flexDirection: "column", gap: 8 }}>
        {courses.map((d, i) => (
          <div key={i} style={{ padding: "11px 13px", borderRadius: 13, background: "#fff",
            boxShadow: "0 2px 8px rgba(0,0,0,0.05)", display: "flex", alignItems: "center", gap: 11 }}>
            <div style={{ width: 38, height: 38, borderRadius: 9, background: d.bg,
              display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <svg width="26" height="26" viewBox="0 0 26 26" style={{ transform: "rotate(-90deg)" }}>
                <circle cx="13" cy="13" r="11" fill="none" stroke="rgba(0,0,0,0.07)" strokeWidth="3"/>
                <circle cx="13" cy="13" r="11" fill="none" stroke={d.col} strokeWidth="3"
                  strokeDasharray={`${CIRC * d.pct / 100} ${CIRC}`} strokeLinecap="round"/>
              </svg>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: d.col, letterSpacing: "0.04em" }}>{d.c}</div>
              <div style={{ fontSize: 12, fontWeight: 500, color: "#111", marginTop: 1,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{d.t}</div>
            </div>
          </div>
        ))}
      </div>
      <div style={{
        position: "absolute", bottom: 50, left: 14, right: 14,
        padding: "12px 15px", borderRadius: 17,
        background: "rgba(255,255,255,0.88)",
        backdropFilter: "blur(20px) saturate(1.3)",
        WebkitBackdropFilter: "blur(20px) saturate(1.3)",
        boxShadow: "0 8px 28px rgba(0,0,0,0.09), inset 0 1px 0 rgba(255,255,255,0.95)",
        border: "1px solid rgba(79,110,255,0.14)",
        opacity: reggieIn ? 1 : 0,
        transform: reggieIn ? "translateY(0) scale(1)" : "translateY(16px) scale(0.97)",
        transition: "opacity 0.45s ease, transform 0.45s cubic-bezier(0.16,1,0.3,1)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 5 }}>
          <div style={{ width: 24, height: 24, borderRadius: "50%",
            background: "linear-gradient(135deg,#5F7BFF,#3B50EC)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 12, fontWeight: 700, color: "#fff" }}>R</div>
          <span style={{ fontSize: 12, fontWeight: 600, color: "#3B50EC" }}>Reggie</span>
        </div>
        <div style={{ fontSize: 13, color: "#111", lineHeight: 1.5 }}>Hey. Let&apos;s finish today&apos;s lecture.</div>
      </div>
    </div>
  );
}

function ScreenLecture({ isActive }: { isActive: boolean }) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (!isActive) { setStep(0); return; }
    const timers = [
      setTimeout(() => setStep(1), 180),
      setTimeout(() => setStep(2), 880),
      setTimeout(() => setStep(3), 1480),
    ];
    return () => timers.forEach(clearTimeout);
  }, [isActive]);

  const bullets = [
    "Enzyme kinetics describes reaction rates and substrate binding.",
    "Km is the substrate concentration at ½ Vmax — lower Km = higher affinity.",
    "Competitive inhibitors increase Km but don't change Vmax.",
  ];

  return (
    <div style={{ width: "100%", height: "100%", background: "#f2f2f7", fontFamily: FONT, overflow: "hidden" }}>
      <div style={{ background: "rgba(255,255,255,0.94)", backdropFilter: "blur(20px)",
        padding: "54px 18px 13px", borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: "#000", letterSpacing: "-0.02em" }}>Lectures</div>
        <div style={{ fontSize: 12, color: "rgba(0,0,0,0.38)", marginTop: 2 }}>BIO 110 · Chapter 4</div>
      </div>
      <div style={{ padding: "13px" }}>
        <div style={{
          padding: "13px 15px", borderRadius: 13, background: "#fff",
          boxShadow: "0 2px 8px rgba(0,0,0,0.05)", display: "flex", alignItems: "center", gap: 11, marginBottom: 11,
          opacity: step >= 1 ? 1 : 0, transform: step >= 1 ? "none" : "translateY(8px)",
          transition: "opacity 0.4s ease, transform 0.4s ease",
        }}>
          <div style={{ width: 38, height: 38, borderRadius: 9, background: "#f0f4ff",
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <rect x="2.5" y="1" width="13" height="16" rx="2.5" stroke="#4F6EFF" strokeWidth="1.4"/>
              <path d="M5.5 6.5h7M5.5 9.5h7M5.5 12.5h4.5" stroke="#4F6EFF" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#000",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>
              Enzyme Kinetics — Lecture 4.pdf
            </div>
            <div style={{ fontSize: 11, color: "rgba(0,0,0,0.38)", marginTop: 2 }}>
              {step >= 2 ? "Processed · 47 concepts" : "3.2 MB · Processing…"}
            </div>
          </div>
          {step === 1 && (
            <div style={{ width: 18, height: 18, borderRadius: "50%",
              border: "2px solid #4F6EFF", borderTopColor: "transparent", flexShrink: 0,
              animation: "mpw-spin 0.8s linear infinite" }} />
          )}
          {step >= 2 && (
            <div style={{ width: 18, height: 18, borderRadius: "50%", background: "#4CAF50",
              display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
                <path d="M1.5 4.5l2 2 4-4" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
          )}
        </div>

        <div style={{
          padding: "13px 15px", borderRadius: 13, background: "#fff",
          boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
          opacity: step >= 2 ? 1 : 0, transform: step >= 2 ? "none" : "translateY(10px)",
          transition: "opacity 0.45s ease, transform 0.45s ease",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
            <div style={{ width: 20, height: 20, borderRadius: "50%",
              background: "linear-gradient(135deg,#3351FF,#0527BD)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 11, fontWeight: 700, color: "#fff" }}>R</div>
            <span style={{ fontSize: 11, fontWeight: 600, color: "#3351FF" }}>Reggie · AI Summary</span>
          </div>
          {step >= 3 ? (
            bullets.map((line, i) => (
              <div key={i} style={{ display: "flex", gap: 7, marginBottom: 6,
                animation: `mpw-fadein 0.35s ${i * 0.09}s both ease` }}>
                <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#4F6EFF",
                  marginTop: 5, flexShrink: 0 }} />
                <div style={{ fontSize: 11, color: "#333", lineHeight: 1.5 }}>{line}</div>
              </div>
            ))
          ) : (
            <div style={{ display: "flex", gap: 4, padding: "3px 0" }}>
              {[0, 1, 2].map(i => (
                <div key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: "#4F6EFF", opacity: 0.4,
                  animation: `mpw-bounce 1.2s ${i * 0.18}s infinite ease-in-out` }} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ScreenStudyRooms({ isActive }: { isActive: boolean }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (isActive) { const t = setTimeout(() => setShow(true), 220); return () => clearTimeout(t); }
    setShow(false);
  }, [isActive]);

  const rooms = [
    { name: "CHEM 201 Finals Prep", members: 4, active: true, host: "Siddharth" },
    { name: "BIO 110 Study Group", members: 2, active: true, host: "Johan" },
    { name: "PSYC 101 Essay Workshop", members: 6, active: false, host: "You" },
  ];

  return (
    <div style={{ width: "100%", height: "100%", background: "#000820", fontFamily: FONT, overflow: "hidden", position: "relative" }}>
      <div style={{ position: "absolute", top: "8%", left: "10%", width: "80%", height: "55%",
        background: "radial-gradient(ellipse,rgba(79,110,255,0.1) 0%,transparent 70%)" }} />
      <div style={{ padding: "54px 18px 13px" }}>
        <div style={{ fontSize: 9, fontWeight: 700, color: "rgba(180,195,255,0.48)", letterSpacing: "0.1em",
          textTransform: "uppercase" as const, marginBottom: 4 }}>Study Rooms</div>
        <div style={{ fontSize: 22, fontWeight: 700, color: "#fff", letterSpacing: "-0.025em" }}>Learn together.</div>
      </div>
      <div style={{ padding: "0 14px", display: "flex", flexDirection: "column", gap: 9 }}>
        {rooms.map((r, i) => (
          <div key={i} style={{
            padding: "12px 14px", borderRadius: 14,
            background: r.active ? "rgba(79,110,255,0.1)" : "rgba(255,255,255,0.04)",
            border: r.active ? "1px solid rgba(79,110,255,0.22)" : "1px solid rgba(255,255,255,0.06)",
            display: "flex", alignItems: "center", gap: 11,
            opacity: show ? 1 : 0, transform: show ? "none" : "translateY(12px)",
            transition: `opacity 0.4s ${i * 0.08}s ease, transform 0.4s ${i * 0.08}s ease`,
          }}>
            <div style={{ width: 7, height: 7, borderRadius: "50%", flexShrink: 0,
              background: r.active ? "#4CAF50" : "rgba(255,255,255,0.18)",
              boxShadow: r.active ? "0 0 0 3px rgba(76,175,80,0.18)" : "none" }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#fff",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{r.name}</div>
              <div style={{ fontSize: 10, color: "rgba(180,195,255,0.42)", marginTop: 2 }}>
                {r.host} · {r.members} members
              </div>
            </div>
            <button style={{ padding: "5px 12px", borderRadius: 18,
              background: r.active ? "rgba(79,110,255,0.22)" : "rgba(255,255,255,0.07)",
              border: "none", color: r.active ? "#818dff" : "rgba(255,255,255,0.32)",
              fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
              {r.active ? "Join" : "View"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function ScreenFlashcards({ isActive }: { isActive: boolean }) {
  const [flipped, setFlipped] = useState(false);
  useEffect(() => {
    if (isActive) { const t = setTimeout(() => setFlipped(true), 720); return () => clearTimeout(t); }
    setFlipped(false);
  }, [isActive]);

  const cardGlass: React.CSSProperties = {
    background: "rgba(255,255,255,0.07)", backdropFilter: "blur(18px)",
    WebkitBackdropFilter: "blur(18px)", border: "1px solid rgba(255,255,255,0.11)",
    boxShadow: "0 8px 24px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.1)",
  };

  return (
    <div style={{ width: "100%", height: "100%", background: "#000820", fontFamily: FONT,
      display: "flex", flexDirection: "column", alignItems: "center", overflow: "hidden", position: "relative" }}>
      <div style={{ position: "absolute", top: "10%", left: "18%", width: "64%", height: "52%",
        background: "radial-gradient(ellipse,rgba(79,110,255,0.13) 0%,transparent 70%)" }} />
      <div style={{ padding: "54px 20px 9px", width: "100%", textAlign: "center" }}>
        <div style={{ fontSize: 9, fontWeight: 700, color: "rgba(180,195,255,0.52)", letterSpacing: "0.1em",
          textTransform: "uppercase" as const }}>BIO 110 · Chapter 4</div>
        <div style={{ fontSize: 19, fontWeight: 700, color: "#fff", marginTop: 4, letterSpacing: "-0.02em" }}>Flashcards</div>
        <div style={{ fontSize: 11, color: "rgba(180,195,255,0.38)", marginTop: 2 }}>Card 3 of 12</div>
      </div>
      <div style={{ perspective: "900px", width: 268, height: 170, margin: "14px auto 0" }}>
        <div style={{
          width: "100%", height: "100%", position: "relative",
          transformStyle: "preserve-3d" as const, willChange: "transform",
          transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)",
          transition: "transform 0.65s cubic-bezier(0.4,0,0.2,1)",
        }}>
          <div style={{ position: "absolute", inset: 0, backfaceVisibility: "hidden" as const,
            WebkitBackfaceVisibility: "hidden" as const, borderRadius: 17, ...cardGlass,
            display: "flex", alignItems: "center", justifyContent: "center", padding: "18px" }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: "rgba(180,195,255,0.52)", letterSpacing: "0.1em",
                textTransform: "uppercase" as const, marginBottom: 10 }}>Question</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#fff", lineHeight: 1.4 }}>
                What moves E→S in MESI?
              </div>
            </div>
          </div>
          <div style={{ position: "absolute", inset: 0, backfaceVisibility: "hidden" as const,
            WebkitBackfaceVisibility: "hidden" as const, transform: "rotateY(180deg)", borderRadius: 17,
            background: "linear-gradient(135deg,rgba(79,110,255,0.28),rgba(37,62,255,0.2))",
            boxShadow: "0 0 36px rgba(79,110,255,0.12), 0 10px 28px -6px rgba(0,0,0,0.3), inset 1px 2px 10px rgba(79,110,255,0.2)",
            backdropFilter: "blur(18px)", WebkitBackdropFilter: "blur(18px)",
            border: "1px solid rgba(79,110,255,0.28)",
            display: "flex", alignItems: "center", justifyContent: "center", padding: "18px" }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: "rgba(79,110,255,0.78)", letterSpacing: "0.1em",
                textTransform: "uppercase" as const, marginBottom: 10 }}>Answer</div>
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.88)", lineHeight: 1.55 }}>
                A remote read. Invalidation only fires on a remote write.
              </div>
            </div>
          </div>
        </div>
      </div>
      <div style={{ width: "70%", margin: "16px auto 0" }}>
        <div style={{ height: 3, background: "rgba(255,255,255,0.07)", borderRadius: 2 }}>
          <div style={{ height: "100%", width: "25%", background: "#4F6EFF", borderRadius: 2 }} />
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        {([ ["Again","rgba(255,107,107,0.14)","rgba(255,107,107,0.26)","#FF6B6B"],
            ["Good","rgba(79,110,255,0.18)","rgba(79,110,255,0.36)","#818dff"],
            ["Easy","rgba(76,175,80,0.14)","rgba(76,175,80,0.28)","#4CAF50"] ] as const).map(([label,bg,border,col]) => (
          <button key={label} style={{ padding: "9px 16px", borderRadius: 18, background: bg,
            border: `1px solid ${border}`, color: col, fontSize: 11, fontWeight: 600,
            cursor: "pointer", fontFamily: FONT }}>{label}</button>
        ))}
      </div>
    </div>
  );
}

function ScreenSummary({ isActive }: { isActive: boolean }) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (!isActive) { setStep(0); return; }
    const timers = [
      setTimeout(() => setStep(1), 160),
      setTimeout(() => setStep(2), 720),
      setTimeout(() => setStep(3), 1140),
    ];
    return () => timers.forEach(clearTimeout);
  }, [isActive]);

  const responseLines = [
    "SN2: backside attack, inversion, fast with strong nucleophiles.",
    "SN1: two-step, carbocation intermediate, racemization.",
    "E2: one step, anti-periplanar, base removes β-hydrogen.",
  ];

  return (
    <div style={{ width: "100%", height: "100%", background: "#f2f2f7", fontFamily: FONT, overflow: "hidden" }}>
      <div style={{ background: "rgba(255,255,255,0.94)", backdropFilter: "blur(20px)",
        padding: "54px 18px 13px", borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: "#000", letterSpacing: "-0.02em" }}>Ask Reggie</div>
        <div style={{ fontSize: 12, color: "rgba(0,0,0,0.38)", marginTop: 2 }}>CHEM 201</div>
      </div>
      <div style={{ padding: "13px", display: "flex", flexDirection: "column", gap: 9 }}>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <div style={{
            maxWidth: "78%", padding: "9px 13px", borderRadius: "17px 17px 4px 17px",
            background: "#4F6EFF", color: "#fff", fontSize: 12, lineHeight: 1.45,
            opacity: step >= 1 ? 1 : 0,
            transform: step >= 1 ? "none" : "translateY(8px) scale(0.97)",
            transition: "opacity 0.35s ease, transform 0.35s ease",
          }}>Summarize reaction mechanisms for my midterm</div>
        </div>
        <div style={{
          maxWidth: "90%", padding: "11px 13px", borderRadius: "4px 17px 17px 17px",
          background: "#fff", boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
          opacity: step >= 2 ? 1 : 0,
          transform: step >= 2 ? "none" : "translateY(10px)",
          transition: "opacity 0.4s 0.08s ease, transform 0.4s 0.08s ease",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
            <div style={{ width: 18, height: 18, borderRadius: "50%",
              background: "linear-gradient(135deg,#3351FF,#0527BD)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 10, fontWeight: 700, color: "#fff" }}>R</div>
            <span style={{ fontSize: 10, fontWeight: 600, color: "#3351FF" }}>Reggie</span>
          </div>
          {step >= 3 ? (
            responseLines.map((line, i) => (
              <div key={i} style={{
                fontSize: 11, color: "#333", lineHeight: 1.5, display: "flex", gap: 6, marginBottom: 5,
                animation: `mpw-fadein 0.35s ${i * 0.09}s both ease`,
              }}>
                <span style={{ color: "#4F6EFF", fontWeight: 700, flexShrink: 0 }}>{i + 1}.</span>
                {line}
              </div>
            ))
          ) : (
            <div style={{ display: "flex", gap: 4, padding: "2px 0" }}>
              {[0, 1, 2].map(i => (
                <div key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: "#4F6EFF", opacity: 0.4,
                  animation: `mpw-bounce 1.2s ${i * 0.18}s infinite ease-in-out` }} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ScreenLaunch({ isActive }: { isActive: boolean }) {
  return (
    <div style={{
      width: "100%", height: "100%",
      background: "linear-gradient(180deg,#000c2e 0%,#001240 60%,#000820 100%)",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      fontFamily: FONT, color: "#fff", overflow: "hidden", position: "relative",
    }}>
      <div style={{ position: "absolute", top: "18%", left: "12%", width: "76%", height: "64%",
        background: "radial-gradient(ellipse,rgba(79,110,255,0.2) 0%,transparent 70%)" }} />
      <img src="/fschoolai-logo.jpeg" alt="" style={{
        width: 84, height: 84, objectFit: "contain", borderRadius: 20, marginBottom: 18,
        filter: "drop-shadow(0 8px 32px rgba(79,110,255,0.52))",
        opacity: isActive ? 1 : 0,
        transform: isActive ? "scale(1)" : "scale(0.88)",
        transition: "opacity 0.6s ease, transform 0.6s cubic-bezier(0.16,1,0.3,1)",
      }} />
      <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-0.03em", textAlign: "center",
        opacity: isActive ? 1 : 0, transition: "opacity 0.6s 0.14s ease" }}>FSchoolAI</div>
      <div style={{ fontSize: 13, color: "rgba(255,255,255,0.42)", marginTop: 7, textAlign: "center",
        opacity: isActive ? 1 : 0, transition: "opacity 0.6s 0.24s ease" }}>AI-native learning</div>
      <div style={{
        marginTop: 28, padding: "9px 20px", borderRadius: 22,
        background: "rgba(79,110,255,0.18)", border: "1px solid rgba(79,110,255,0.32)",
        fontSize: 12, fontWeight: 600, color: "#818dff",
        opacity: isActive ? 1 : 0, transition: "opacity 0.6s 0.34s ease",
      }}>Coming soon</div>
    </div>
  );
}

// ── Screen registry ────────────────────────────────────────────────────────────
type ScreenProps = { isActive: boolean };
const SCREENS: Array<React.FC<ScreenProps>> = [
  ScreenLock, ScreenCanvas, ScreenAssignments, ScreenReggie, ScreenLecture,
  ScreenStudyRooms, ScreenFlashcards, ScreenSummary, ScreenLaunch,
];

// ── Phone shell ───────────────────────────────────────────────────────────────
function PhoneShell({ activeScene }: { activeScene: number }) {
  return (
    <div style={{
      position: "relative", width: PW, height: PH, borderRadius: 50,
      background: "linear-gradient(168deg,#3e3e41 0%,#2e2e31 28%,#222224 58%,#17171a 100%)",
      boxShadow:
        "0 0 0 0.5px rgba(255,255,255,0.10)," +
        "0 1.5px 0 rgba(255,255,255,0.13) inset," +
        "0 -1px 0 rgba(0,0,0,0.65) inset," +
        "inset 1px 0 0 rgba(255,255,255,0.055)," +
        "inset -1px 0 0 rgba(255,255,255,0.055)," +
        "0 40px 90px rgba(0,0,0,0.55)," +
        "0 80px 150px rgba(0,0,0,0.28)",
      flexShrink: 0,
    }}>
      <div style={{ position: "absolute", left: -3, top: 118, width: 3.5, height: 30, borderRadius: "2px 0 0 2px", background: "#3a3a3d" }} />
      <div style={{ position: "absolute", left: -3, top: 158, width: 3.5, height: 30, borderRadius: "2px 0 0 2px", background: "#3a3a3d" }} />
      <div style={{ position: "absolute", right: -3, top: 145, width: 3.5, height: 58, borderRadius: "0 2px 2px 0", background: "#3a3a3d" }} />
      <div style={{ position: "absolute", top: 10, left: 10, right: 10, bottom: 10, borderRadius: 42, overflow: "hidden", background: "#000", transform: "translateZ(0)", isolation: "isolate" }}>
        <div style={{ position: "absolute", top: 10, left: "50%", transform: "translateX(-50%)",
          width: 104, height: 32, borderRadius: 22, background: "#000", zIndex: 10,
          boxShadow: "0 0 0 1px rgba(255,255,255,0.04)", pointerEvents: "none" }} />
        {SCREENS.map((ScreenComp, i) => (
          <div key={i} style={{
            position: "absolute", inset: 0,
            opacity: activeScene === i ? 1 : 0,
            transform: activeScene === i ? "scale(1)" : activeScene > i ? "scale(1.015)" : "scale(0.985)",
            transition: "opacity 0.42s cubic-bezier(0.4,0,0.2,1), transform 0.42s cubic-bezier(0.4,0,0.2,1)",
            pointerEvents: activeScene === i ? "auto" : "none",
            willChange: "opacity, transform",
          }}>
            <ScreenComp isActive={activeScene === i} />
          </div>
        ))}
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "46%",
          background: "linear-gradient(180deg,rgba(255,255,255,0.032) 0%,transparent 100%)",
          pointerEvents: "none", zIndex: 20, borderRadius: "40px 40px 0 0" }} />
      </div>
    </div>
  );
}

// ── Text panel ────────────────────────────────────────────────────────────────
interface TextPanelProps {
  scene: SceneDef;
  onWaitlist?: () => void;
  mobile?: boolean;
}
function TextPanel({ scene, onWaitlist, mobile }: TextPanelProps) {
  return (
    <div>
      <div style={{
        display: "inline-block",
        background: mobile ? "#f5f5f7" : "rgba(255,255,255,0.08)",
        border: mobile ? "none" : "1px solid rgba(255,255,255,0.10)",
        borderRadius: 980,
        padding: mobile ? "3px 10px" : "4px 12px",
        fontSize: mobile ? 10 : 11, fontWeight: mobile ? 600 : 500,
        color: mobile ? "#86868b" : "rgba(255,255,255,0.48)",
        letterSpacing: "0.06em", textTransform: "uppercase" as const,
        marginBottom: mobile ? 10 : 20,
      }}>{scene.tag}</div>
      <h3 style={{
        fontSize: mobile ? "clamp(26px,8vw,40px)" : "clamp(40px,5vw,66px)",
        fontWeight: 600, letterSpacing: "-0.035em",
        lineHeight: 1.04,
        color: mobile ? "#1d1d1f" : "#ffffff",
        margin: mobile ? "0 0 10px" : "0 0 20px",
        whiteSpace: "pre-line" as const, fontFamily: FONT,
      }}>{scene.headline}</h3>
      <p style={{
        fontSize: mobile ? 14 : 17,
        color: mobile ? "#6e6e73" : "rgba(255,255,255,0.52)",
        lineHeight: 1.65,
        maxWidth: mobile ? undefined : 420,
        margin: 0, fontFamily: FONT,
      }}>{scene.copy}</p>
      {scene.showCTA && (
        <button
          onClick={onWaitlist}
          style={{
            marginTop: mobile ? 18 : 32,
            padding: mobile ? "13px 28px" : "14px 28px",
            borderRadius: 980,
            background: mobile ? "#1d1d1f" : "#ffffff",
            color: mobile ? "#fff" : "#1d1d1f",
            border: "none",
            cursor: "pointer", fontSize: mobile ? 15 : 16, fontWeight: 500, fontFamily: FONT,
            display: mobile ? "block" : "inline-block",
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.opacity = "0.82"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.opacity = "1"; }}
        >
          Join the waitlist
        </button>
      )}
    </div>
  );
}

// ── MOBILE-ONLY WALKTHROUGH ───────────────────────────────────────────────────
// Completely separate from desktop. Shown only at ≤767px via CSS.

// ── Mobile design tokens (Safreen's glass system) ────────────────────────────
const SBG_COLORS = ['#D6DBFF','#7B8AFF','#3B50EC','#0527BD','#253EFF','#1A30E8'];
const SP = 'cubic-bezier(0.22,1,0.36,1)';
const MG = {
  panel:  { background:'rgba(255,255,255,0.09)', backdropFilter:'blur(20px) saturate(1.5)', WebkitBackdropFilter:'blur(20px) saturate(1.5)', border:'1px solid rgba(255,255,255,0.13)' },
  card:   { background:'rgba(255,255,255,0.14)', backdropFilter:'blur(18px) saturate(1.4)', WebkitBackdropFilter:'blur(18px) saturate(1.4)', border:'1px solid rgba(255,255,255,0.18)' },
  tile:   { background:'rgba(255,255,255,0.06)', backdropFilter:'blur(14px)',                WebkitBackdropFilter:'blur(14px)',                border:'1px solid rgba(255,255,255,0.09)' },
  bubble: { background:'rgba(78,102,238,0.44)',  backdropFilter:'blur(10px)',                WebkitBackdropFilter:'blur(10px)',                border:'1px solid rgba(140,160,255,0.24)' },
};

// Safreen's blurred-ellipse background, scaled for phone viewport
function SBg() {
  return (
    <div style={{ position:'absolute', inset:0, background:'#fff', overflow:'hidden', zIndex:0 }}>
      <div style={{ position:'absolute', left:'-50%', top:'-50%', width:'200%', height:'200%', filter:'blur(36px)' }}>
        {SBG_COLORS.map((c, i) => (
          <div key={i} style={{
            position:'absolute',
            top:`${i * 7}%`, left:`${i * 7}%`,
            right:`${i * 7}%`, bottom:`${i * 7}%`,
            background:c, borderRadius:'50%',
          }} />
        ))}
      </div>
    </div>
  );
}

// Light glass tokens — iOS 26-style app screens
const MGL = {
  card:  { background:'rgba(255,255,255,0.90)', backdropFilter:'blur(20px) saturate(1.3)', WebkitBackdropFilter:'blur(20px) saturate(1.3)', boxShadow:'0 2px 18px rgba(0,0,0,0.07)', border:'1px solid rgba(255,255,255,0.72)' },
  panel: { background:'rgba(255,255,255,0.74)', backdropFilter:'blur(16px) saturate(1.2)', WebkitBackdropFilter:'blur(16px) saturate(1.2)', boxShadow:'0 1px 10px rgba(0,0,0,0.05)', border:'1px solid rgba(255,255,255,0.62)' },
  tile:  { background:'rgba(255,255,255,0.58)', backdropFilter:'blur(12px)', WebkitBackdropFilter:'blur(12px)', border:'1px solid rgba(255,255,255,0.52)' },
};

function SBgLight() {
  return (
    <div style={{ position:'absolute', inset:0, overflow:'hidden', zIndex:0, background:'#F2F2F7' }}>
      <div style={{ position:'absolute', top:'-20%', left:'-10%', width:'75%', height:'75%', borderRadius:'50%', background:'rgba(214,219,255,0.38)', filter:'blur(42px)' }} />
      <div style={{ position:'absolute', bottom:'-15%', right:'-5%', width:'68%', height:'65%', borderRadius:'50%', background:'rgba(123,138,255,0.12)', filter:'blur(50px)' }} />
    </div>
  );
}

const M_SCENES = [
  { tag: "Get started",  headline: "Unlock\nyour day."   },
  { tag: "Welcome",      headline: "Good to\nhave you."  },
  { tag: "Canvas sync",  headline: "Connected."          },
  { tag: "AI tutor",     headline: "Meet\nReggie."       },
  { tag: "Study Rooms",  headline: "Focus\ntogether."    },
  { tag: "Flashcards",   headline: "Know it\ncold."      },
  { tag: "Dashboard",    headline: "One OS.\nAll yours." },
  { tag: "Early access", headline: "Launching\nsoon."    },
];

// ── Mobile screen 0: Lock ─────────────────────────────────────────────────────
function MScreen0({ isActive }: { isActive: boolean }) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (!isActive) { setStep(0); return; }
    const ts = [
      setTimeout(() => setStep(1), 280),
      setTimeout(() => setStep(2), 720),
      setTimeout(() => setStep(3), 1100),
    ];
    return () => ts.forEach(clearTimeout);
  }, [isActive]);

  return (
    <div style={{ width:'100%', height:'100%', fontFamily:FONT, position:'relative', overflow:'hidden',
      background:'linear-gradient(170deg,#0C0C1A 0%,#101428 45%,#0A1038 75%,#080E2A 100%)' }}>
      {/* wallpaper ambient */}
      <div style={{ position:'absolute', top:'-5%', left:'15%', width:'68%', height:'58%', background:'radial-gradient(ellipse,rgba(72,62,220,0.16) 0%,transparent 68%)', pointerEvents:'none' }} />
      <div style={{ position:'absolute', bottom:'10%', right:'5%', width:'60%', height:'50%', background:'radial-gradient(ellipse,rgba(0,90,255,0.10) 0%,transparent 68%)', pointerEvents:'none' }} />
      {/* status bar */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'15px 22px 0', position:'relative', zIndex:5 }}>
        <span style={{ fontSize:12, fontWeight:600, color:'rgba(255,255,255,0.88)', letterSpacing:'-0.02em' }}>9:41</span>
        <div style={{ display:'flex', gap:5, alignItems:'center' }}>
          <div style={{ display:'flex', gap:1.5, alignItems:'flex-end', height:9 }}>
            {[3,5,7,9].map((h,i) => (
              <div key={i} style={{ width:2.5, height:h, background:i<3?'rgba(255,255,255,0.80)':'rgba(255,255,255,0.22)', borderRadius:0.5 }} />
            ))}
          </div>
          <div style={{ width:18, height:9, border:'1.5px solid rgba(255,255,255,0.45)', borderRadius:2, display:'flex', alignItems:'center', padding:'1.5px', gap:0 }}>
            <div style={{ width:'68%', height:'100%', background:'rgba(255,255,255,0.76)', borderRadius:1 }} />
          </div>
        </div>
      </div>
      {/* clock */}
      <div style={{ textAlign:'center', position:'relative', zIndex:1, marginTop:24 }}>
        <div style={{ fontSize:68, fontWeight:100, letterSpacing:'-0.05em', color:'#fff', lineHeight:1 }}>9:41</div>
        <div style={{ fontSize:14, color:'rgba(255,255,255,0.50)', marginTop:5, fontWeight:400, letterSpacing:'0.01em' }}>Monday, January 13</div>
      </div>
      {/* notification — FSchoolAI */}
      <div style={{ margin:'26px 11px 0', padding:'11px 13px', borderRadius:18,
        background:'rgba(18,20,36,0.80)', backdropFilter:'blur(24px)', WebkitBackdropFilter:'blur(24px)',
        border:'1px solid rgba(255,255,255,0.08)',
        opacity:step>=1?1:0,
        transform:step>=1?'translateY(0) scale(1)':'translateY(-26px) scale(0.90)',
        transition:`opacity 0.52s ${SP}, transform 0.58s ${SP}`,
        position:'relative', zIndex:2 }}>
        <div style={{ display:'flex', gap:10, alignItems:'flex-start' }}>
          <img src="/fschoolai-logo.jpeg" alt="" style={{ width:36, height:36, borderRadius:9, objectFit:'cover', flexShrink:0 }} />
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:3 }}>
              <span style={{ fontSize:10, fontWeight:600, color:'rgba(255,255,255,0.50)', letterSpacing:'0.05em', textTransform:'uppercase' as const }}>FSchoolAI</span>
              <span style={{ fontSize:10, color:'rgba(255,255,255,0.28)' }}>now</span>
            </div>
            <div style={{ fontSize:13, fontWeight:500, color:'rgba(255,255,255,0.90)', lineHeight:1.38 }}>Good morning, Aisha</div>
            <div style={{ fontSize:11, color:'rgba(255,255,255,0.46)', marginTop:2, lineHeight:1.4 }}>3 assignments due · Reggie is ready</div>
          </div>
        </div>
      </div>
      {/* notification — study room */}
      <div style={{ margin:'7px 11px 0', padding:'10px 13px', borderRadius:16,
        background:'rgba(18,20,36,0.60)', backdropFilter:'blur(18px)', WebkitBackdropFilter:'blur(18px)',
        border:'1px solid rgba(255,255,255,0.06)',
        opacity:step>=2?1:0,
        transform:step>=2?'translateY(0) scale(1)':'translateY(-18px) scale(0.92)',
        transition:`opacity 0.48s 0.12s ${SP}, transform 0.52s 0.12s ${SP}`,
        position:'relative', zIndex:2 }}>
        <div style={{ display:'flex', gap:10, alignItems:'center' }}>
          <div style={{ width:32, height:32, borderRadius:8, background:'rgba(52,199,89,0.18)', border:'1px solid rgba(52,199,89,0.28)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
            <div style={{ width:8, height:8, borderRadius:'50%', background:'#34C759' }} />
          </div>
          <div>
            <div style={{ fontSize:11, color:'rgba(255,255,255,0.86)', fontWeight:500 }}>CHEM 201 · Study Room</div>
            <div style={{ fontSize:10, color:'rgba(255,255,255,0.38)', marginTop:1 }}>3 friends studying now</div>
          </div>
        </div>
      </div>
      {/* swipe hint */}
      <div style={{ position:'absolute', bottom:32, left:0, right:0, display:'flex', flexDirection:'column', alignItems:'center', gap:4, opacity:step>=3?1:0, transition:`opacity 0.55s ${SP}` }}>
        <div style={{ fontSize:10, color:'rgba(255,255,255,0.28)', letterSpacing:'0.04em' }}>Swipe up to open</div>
      </div>
    </div>
  );
}

// ── Mobile screen 1: Welcome ──────────────────────────────────────────────────
function MScreen1({ isActive }: { isActive: boolean }) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (!isActive) { setStep(0); return; }
    const ts = [
      setTimeout(() => setStep(1), 220),
      setTimeout(() => setStep(2), 560),
      setTimeout(() => setStep(3), 880),
    ];
    return () => ts.forEach(clearTimeout);
  }, [isActive]);

  return (
    <div style={{ width:'100%', height:'100%', position:'relative', overflow:'hidden', fontFamily:FONT }}>
      <SBgLight />
      <div style={{ position:'relative', zIndex:1, padding:'52px 18px 0' }}>
        <div style={{ fontSize:12, color:'#8E8E93', letterSpacing:'-0.01em' }}>Monday, January 13</div>
        <div style={{ fontSize:21, fontWeight:700, color:'#1C1C1E', marginTop:3, letterSpacing:'-0.04em', lineHeight:1.12 }}>Good afternoon,</div>
        <div style={{ fontSize:21, fontWeight:300, color:'#1C1C1E', letterSpacing:'-0.04em', lineHeight:1.15 }}>Aisha.</div>
      </div>
      {/* welcome card */}
      <div style={{ position:'relative', zIndex:1, margin:'13px 14px 0', ...MGL.card, borderRadius:18, padding:'14px 15px',
        opacity:step>=1?1:0, transform:step>=1?'translateY(0) scale(1)':'translateY(12px) scale(0.97)',
        transition:`opacity 0.45s ${SP}, transform 0.45s ${SP}` }}>
        <div style={{ display:'flex', alignItems:'center', gap:11 }}>
          <div style={{ width:42, height:42, borderRadius:'50%', background:'linear-gradient(135deg,#3A5FFF,#1034CC)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:15, fontWeight:700, color:'#fff', flexShrink:0 }}>A</div>
          <div>
            <div style={{ fontSize:13, fontWeight:600, color:'#1C1C1E' }}>Welcome back</div>
            <div style={{ fontSize:11, color:'#8E8E93', marginTop:1 }}>Sophomore · Spring 2025</div>
          </div>
        </div>
        <div style={{ marginTop:11, padding:'9px 12px', borderRadius:12, background:'rgba(0,122,255,0.07)', border:'1px solid rgba(0,122,255,0.11)' }}>
          <div style={{ fontSize:9, fontWeight:700, color:'#007AFF', letterSpacing:'0.07em', textTransform:'uppercase' as const, marginBottom:3 }}>Reggie suggests</div>
          <div style={{ fontSize:12, color:'#3C3C43', lineHeight:1.45 }}>Review flashcards for CHEM 201 — exam in 3 days</div>
        </div>
      </div>
      {/* stat tiles */}
      <div style={{ position:'relative', zIndex:1, display:'flex', gap:7, padding:'9px 14px 0' }}>
        {[{label:'Courses',val:'5'},{label:'Tasks',val:'3'},{label:'Streak',val:'7d'}].map((s,i) => (
          <div key={i} style={{ flex:1, ...MGL.tile, borderRadius:14, padding:'9px 10px', textAlign:'center',
            opacity:step>=2?1:0, transform:step>=2?'translateY(0)':'translateY(10px)',
            transition:`opacity 0.38s ${i*0.06+0.05}s ${SP}, transform 0.38s ${i*0.06+0.05}s ${SP}` }}>
            <div style={{ fontSize:16, fontWeight:700, color:'#1C1C1E', letterSpacing:'-0.02em' }}>{s.val}</div>
            <div style={{ fontSize:9, color:'#8E8E93', marginTop:2, letterSpacing:'0.05em', textTransform:'uppercase' as const }}>{s.label}</div>
          </div>
        ))}
      </div>
      {/* sync status */}
      <div style={{ position:'relative', zIndex:1, margin:'8px 14px 0', ...MGL.panel, borderRadius:13, padding:'10px 14px',
        display:'flex', alignItems:'center', gap:9,
        opacity:step>=3?1:0, transition:`opacity 0.42s ${SP}` }}>
        <div style={{ width:7, height:7, borderRadius:'50%', background:'#34C759', boxShadow:'0 0 0 3px rgba(52,199,89,0.18)', flexShrink:0, animation:'mpwm-pulse 2s infinite' }} />
        <span style={{ fontSize:12, color:'#3C3C43' }}>3 courses synced · All up to date</span>
      </div>
    </div>
  );
}

// ── Mobile screen 2: Canvas sync ─────────────────────────────────────────────
function MScreen2({ isActive }: { isActive: boolean }) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (!isActive) { setStep(0); return; }
    const ts = [
      setTimeout(() => setStep(1), 200),
      setTimeout(() => setStep(2), 520),
    ];
    return () => ts.forEach(clearTimeout);
  }, [isActive]);

  const courses = [
    { code:'CHEM 201', name:'Reaction Mechanisms', pct:40,  color:'#FF6B6B', due:'' },
    { code:'BIO 110',  name:'Lab report',           pct:70,  color:'#FF9500', due:'Tomorrow' },
    { code:'PSYC 101', name:'Essay submitted',       pct:100, color:'#34C759', due:'' },
  ];
  const C = 2 * Math.PI * 10;

  return (
    <div style={{ width:'100%', height:'100%', position:'relative', overflow:'hidden', fontFamily:FONT }}>
      <SBgLight />
      <div style={{ position:'relative', zIndex:1, padding:'52px 18px 0', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <div>
          <div style={{ fontSize:12, color:'#8E8E93' }}>Canvas</div>
          <div style={{ fontSize:21, fontWeight:700, color:'#1C1C1E', marginTop:2, letterSpacing:'-0.03em' }}>Your Courses</div>
        </div>
        <div style={{ padding:'5px 11px', borderRadius:20, background:'rgba(52,199,89,0.10)', border:'1px solid rgba(52,199,89,0.20)',
          display:'flex', alignItems:'center', gap:5, opacity:step>=1?1:0, transition:`opacity 0.4s ${SP}` }}>
          <div style={{ width:6, height:6, borderRadius:'50%', background:'#34C759', animation:'mpwm-pulse 2s infinite' }} />
          <span style={{ fontSize:10, fontWeight:600, color:'#30A84A' }}>Synced</span>
        </div>
      </div>
      <div style={{ position:'relative', zIndex:1, padding:'11px 14px 0', display:'flex', flexDirection:'column', gap:8 }}>
        {courses.map((c,i) => (
          <div key={i} style={{ ...MGL.card, borderRadius:16, padding:'11px 13px', display:'flex', alignItems:'center', gap:11,
            opacity:step>=2?1:0, transform:step>=2?'translateY(0)':'translateY(14px)',
            transition:`opacity 0.42s ${i*0.08+0.04}s ${SP}, transform 0.42s ${i*0.08+0.04}s ${SP}` }}>
            <svg width="28" height="28" viewBox="0 0 28 28" style={{ transform:'rotate(-90deg)', flexShrink:0 }}>
              <circle cx="14" cy="14" r="10" fill="none" stroke="rgba(0,0,0,0.07)" strokeWidth="3"/>
              <circle cx="14" cy="14" r="10" fill="none" stroke={c.color} strokeWidth="3"
                strokeDasharray={`${C * c.pct / 100} ${C}`} strokeLinecap="round"/>
            </svg>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:9, fontWeight:700, color:c.color, letterSpacing:'0.06em', textTransform:'uppercase' as const }}>{c.code}</div>
              <div style={{ fontSize:12, fontWeight:500, color:'#1C1C1E', marginTop:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' as const }}>{c.name}</div>
            </div>
            {c.due ? (
              <div style={{ padding:'3px 8px', borderRadius:7, background:'rgba(255,149,0,0.10)', border:'1px solid rgba(255,149,0,0.18)', fontSize:9, fontWeight:700, color:'#E68900', flexShrink:0 }}>{c.due}</div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Mobile screen 3: Reggie chat ─────────────────────────────────────────────
function MScreen3({ isActive }: { isActive: boolean }) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (!isActive) { setStep(0); return; }
    const ts = [
      setTimeout(() => setStep(1), 250),
      setTimeout(() => setStep(2), 900),
      setTimeout(() => setStep(3), 1750),
    ];
    return () => ts.forEach(clearTimeout);
  }, [isActive]);

  const bullets = [
    'SN2: backside attack, Walden inversion',
    'SN1: two-step via carbocation',
    'E2: anti-periplanar elimination',
  ];

  return (
    <div style={{ width:'100%', height:'100%', position:'relative', overflow:'hidden', fontFamily:FONT }}>
      <SBgLight />
      <div style={{ position:'relative', zIndex:1, padding:'52px 18px 10px', borderBottom:'1px solid rgba(0,0,0,0.06)' }}>
        <div style={{ fontSize:12, color:'#8E8E93' }}>AI Tutor</div>
        <div style={{ fontSize:21, fontWeight:700, color:'#1C1C1E', marginTop:2, letterSpacing:'-0.03em' }}>Ask Reggie</div>
      </div>
      <div style={{ position:'relative', zIndex:1, padding:'13px 14px 0', display:'flex', flexDirection:'column', gap:9 }}>
        {/* user bubble */}
        <div style={{ display:'flex', justifyContent:'flex-end', opacity:step>=1?1:0, transform:step>=1?'none':'translateY(8px)', transition:`opacity 0.32s ${SP}, transform 0.32s ${SP}` }}>
          <div style={{ maxWidth:'78%', padding:'10px 14px', borderRadius:'18px 18px 4px 18px', background:'#007AFF', color:'#fff', fontSize:12, lineHeight:1.45, boxShadow:'0 2px 12px rgba(0,122,255,0.22)' }}>
            Summarize reaction mechanisms for my midterm
          </div>
        </div>
        {/* Reggie response */}
        <div style={{ ...MGL.card, borderRadius:'4px 18px 18px 18px', maxWidth:'94%', padding:'12px 14px',
          opacity:step>=2?1:0, transform:step>=2?'none':'translateY(10px)',
          transition:`opacity 0.40s ${SP}, transform 0.40s ${SP}` }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10 }}>
            <div style={{ width:22, height:22, borderRadius:'50%', background:'linear-gradient(135deg,#253EFF,#7B8AFF)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:10, fontWeight:700, color:'#fff', flexShrink:0 }}>R</div>
            <span style={{ fontSize:12, fontWeight:600, color:'#253EFF' }}>Reggie</span>
          </div>
          {step >= 3 ? (
            bullets.map((line,i) => (
              <div key={i} style={{ display:'flex', gap:8, marginBottom:6, animation:`mpwm-fadein 0.3s ${i*0.09}s both ease` }}>
                <span style={{ color:'#007AFF', fontWeight:700, flexShrink:0, fontSize:12 }}>{i+1}.</span>
                <span style={{ fontSize:12, color:'#1C1C1E', lineHeight:1.5 }}>{line}</span>
              </div>
            ))
          ) : (
            <div style={{ display:'flex', gap:5 }}>
              {[0,1,2].map(i => (
                <div key={i} style={{ width:7, height:7, borderRadius:'50%', background:'#AEAEB2', animation:`mpwm-bounce 1.2s ${i*0.18}s infinite ease-in-out` }} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Mobile screen 4: Study Room ───────────────────────────────────────────────
function MScreen4({ isActive }: { isActive: boolean }) {
  const [step, setStep] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!isActive) { setStep(0); setElapsed(0); return; }
    const ts = [
      setTimeout(() => setStep(1), 250),
      setTimeout(() => setStep(2), 600),
      setTimeout(() => setStep(3), 950),
      setTimeout(() => setStep(4), 1300),
    ];
    return () => ts.forEach(clearTimeout);
  }, [isActive]);
  useEffect(() => {
    if (step < 3) return;
    const iv = setInterval(() => setElapsed(s => s + 1), 1000);
    return () => clearInterval(iv);
  }, [step]);

  const min = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const sec = String(elapsed % 60).padStart(2, '0');
  const participants = [
    { init:'S', bg:'rgba(0,122,255,0.10)',   fg:'#007AFF' },
    { init:'J', bg:'rgba(255,59,48,0.10)',   fg:'#FF3B30' },
    { init:'K', bg:'rgba(52,199,89,0.10)',   fg:'#34C759' },
    { init:'A', bg:'rgba(255,149,0,0.10)',   fg:'#FF9500' },
  ];

  return (
    <div style={{ width:'100%', height:'100%', position:'relative', overflow:'hidden', fontFamily:FONT }}>
      <SBgLight />
      <div style={{ position:'relative', zIndex:1, padding:'52px 18px 0' }}>
        <div style={{ fontSize:12, color:'#8E8E93' }}>Study Rooms</div>
        <div style={{ fontSize:21, fontWeight:700, color:'#1C1C1E', marginTop:2, letterSpacing:'-0.03em' }}>CHEM 201 Finals</div>
      </div>
      {/* live + timer */}
      <div style={{ position:'relative', zIndex:1, display:'flex', alignItems:'center', justifyContent:'space-between', padding:'8px 14px 0' }}>
        <div style={{ padding:'5px 11px', borderRadius:20, background:'rgba(52,199,89,0.10)', border:'1px solid rgba(52,199,89,0.18)',
          display:'flex', alignItems:'center', gap:5, opacity:step>=1?1:0, transition:`opacity 0.4s ${SP}` }}>
          <div style={{ width:6, height:6, borderRadius:'50%', background:'#34C759', animation:'mpwm-pulse 2s infinite' }} />
          <span style={{ fontSize:10, fontWeight:600, color:'#30A84A' }}>Live · 4 studying</span>
        </div>
        <div style={{ ...MGL.tile, borderRadius:12, padding:'5px 12px', opacity:step>=3?1:0, transition:`opacity 0.4s ${SP}` }}>
          <span style={{ fontSize:14, fontWeight:200, color:'#1C1C1E', letterSpacing:'0.04em', fontVariantNumeric:'tabular-nums' as const }}>{min}:{sec}</span>
        </div>
      </div>
      {/* participants */}
      <div style={{ position:'relative', zIndex:1, display:'flex', gap:8, padding:'10px 14px 0' }}>
        {participants.map((p,i) => (
          <div key={i} style={{ width:38, height:38, borderRadius:'50%', background:p.bg, border:`1.5px solid ${p.fg}26`,
            display:'flex', alignItems:'center', justifyContent:'center', fontSize:14, fontWeight:700, color:p.fg,
            opacity:step>=2?1:0, transform:step>=2?'scale(1)':'scale(0.7)',
            transition:`opacity 0.38s ${i*0.07}s ${SP}, transform 0.38s ${i*0.07}s ${SP}` }}>{p.init}</div>
        ))}
      </div>
      {/* AI whiteboard */}
      <div style={{ position:'relative', zIndex:1, margin:'10px 14px 0', ...MGL.card, borderRadius:16, padding:'12px 14px',
        opacity:step>=4?1:0, transform:step>=4?'translateY(0)':'translateY(8px)',
        transition:`opacity 0.5s ${SP}, transform 0.5s ${SP}` }}>
        <div style={{ fontSize:9, fontWeight:700, color:'#007AFF', letterSpacing:'0.08em', textTransform:'uppercase' as const, marginBottom:8 }}>AI Whiteboard</div>
        <div style={{ display:'flex', gap:6, flexWrap:'wrap' as const }}>
          {['SN2 Mechanism','SN1 vs E2','Rate Laws'].map((tag,i) => (
            <div key={i} style={{ padding:'4px 10px', borderRadius:8, background:'rgba(0,122,255,0.07)', border:'1px solid rgba(0,122,255,0.10)', fontSize:11, color:'#007AFF', animation:`mpwm-fadein 0.28s ${i*0.09+0.05}s both ease` }}>{tag}</div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Mobile screen 5: Dashboard ────────────────────────────────────────────────
function MScreen5({ isActive }: { isActive: boolean }) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (!isActive) { setStep(0); return; }
    const ts = [
      setTimeout(() => setStep(1), 200),
      setTimeout(() => setStep(2), 500),
      setTimeout(() => setStep(3), 800),
    ];
    return () => ts.forEach(clearTimeout);
  }, [isActive]);

  return (
    <div style={{ width:'100%', height:'100%', position:'relative', overflow:'hidden', fontFamily:FONT }}>
      <SBgLight />
      <div style={{ position:'relative', zIndex:1, padding:'52px 18px 0' }}>
        <div style={{ fontSize:12, color:'#8E8E93' }}>Dashboard</div>
        <div style={{ fontSize:21, fontWeight:700, color:'#1C1C1E', marginTop:2, letterSpacing:'-0.03em' }}>Overview</div>
      </div>
      {/* stat tiles */}
      <div style={{ position:'relative', zIndex:1, display:'flex', gap:7, padding:'11px 14px 0' }}>
        {[{label:'GPA',val:'3.8',color:'#007AFF'},{label:'Streak',val:'12d',color:'#FF9500'},{label:'Cards due',val:'4',color:'#FF3B30'}].map((s,i) => (
          <div key={i} style={{ flex:1, ...MGL.card, borderRadius:14, padding:'10px 10px', textAlign:'center',
            opacity:step>=1?1:0, transform:step>=1?'translateY(0)':'translateY(10px)',
            transition:`opacity 0.38s ${i*0.07}s ${SP}, transform 0.38s ${i*0.07}s ${SP}` }}>
            <div style={{ fontSize:17, fontWeight:700, color:s.color, letterSpacing:'-0.02em' }}>{s.val}</div>
            <div style={{ fontSize:9, color:'#8E8E93', marginTop:2, letterSpacing:'0.04em', textTransform:'uppercase' as const }}>{s.label}</div>
          </div>
        ))}
      </div>
      {/* deadlines */}
      <div style={{ position:'relative', zIndex:1, margin:'8px 14px 0', ...MGL.card, borderRadius:16, padding:'12px 13px',
        opacity:step>=2?1:0, transform:step>=2?'translateY(0)':'translateY(10px)',
        transition:`opacity 0.42s ${SP}, transform 0.42s ${SP}` }}>
        <div style={{ fontSize:10, fontWeight:600, color:'#8E8E93', letterSpacing:'0.04em', textTransform:'uppercase' as const, marginBottom:9 }}>Upcoming</div>
        {[
          { task:'Problem Set 4', course:'CHEM 201', due:'Tonight',  urgent:true  },
          { task:'Lab Report',    course:'BIO 110',  due:'Tomorrow', urgent:false },
        ].map((d,i) => (
          <div key={i} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'6px 0', borderBottom:i===0?'1px solid rgba(0,0,0,0.05)':'none' }}>
            <div>
              <div style={{ fontSize:12, fontWeight:500, color:'#1C1C1E' }}>{d.task}</div>
              <div style={{ fontSize:10, color:'#8E8E93', marginTop:1 }}>{d.course}</div>
            </div>
            <div style={{ padding:'3px 8px', borderRadius:7, background:d.urgent?'rgba(255,59,48,0.08)':'rgba(0,0,0,0.05)', fontSize:10, fontWeight:600, color:d.urgent?'#FF3B30':'#8E8E93' }}>{d.due}</div>
          </div>
        ))}
      </div>
      {/* widgets row */}
      <div style={{ position:'relative', zIndex:1, display:'flex', gap:7, padding:'7px 14px 0' }}>
        {[{label:'Canvas',sub:'All synced',dot:'#34C759'},{label:'Reggie',sub:'Ready to help',dot:'#007AFF'}].map((w,i) => (
          <div key={i} style={{ flex:1, ...MGL.tile, borderRadius:13, padding:'10px 11px',
            opacity:step>=3?1:0, transform:step>=3?'translateY(0)':'translateY(8px)',
            transition:`opacity 0.38s ${i*0.07}s ${SP}, transform 0.38s ${i*0.07}s ${SP}` }}>
            <div style={{ display:'flex', alignItems:'center', gap:5, marginBottom:4 }}>
              <div style={{ width:7, height:7, borderRadius:'50%', background:w.dot }} />
              <span style={{ fontSize:11, fontWeight:600, color:'#1C1C1E' }}>{w.label}</span>
            </div>
            <div style={{ fontSize:10, color:'#8E8E93' }}>{w.sub}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Mobile screen 6: Launch ───────────────────────────────────────────────────
function MScreen6({ isActive, onWaitlist }: { isActive: boolean; onWaitlist?: () => void }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!isActive) { setShow(false); return; }
    const t = setTimeout(() => setShow(true), 300);
    return () => clearTimeout(t);
  }, [isActive]);

  return (
    <div style={{ width:'100%', height:'100%', background:'#000', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', fontFamily:FONT, position:'relative', overflow:'hidden' }}>
      <div style={{ position:'absolute', top:'15%', left:'15%', width:'70%', height:'60%', background:'radial-gradient(ellipse, rgba(37,62,255,0.18) 0%, transparent 70%)', pointerEvents:'none' }} />
      {/* official logo */}
      <div style={{ opacity:show?1:0, transform:show?'scale(1) translateY(0)':'scale(0.9) translateY(12px)', transition:`opacity 0.6s ${SP}, transform 0.6s ${SP}` }}>
        <img src="/fschoolai-logo.jpeg" alt="FSchoolAI" style={{ width:82, height:82, borderRadius:18, objectFit:'cover', display:'block' }} />
      </div>
      <div style={{ marginTop:14, fontSize:20, fontWeight:700, color:'#fff', letterSpacing:'-0.03em', opacity:show?1:0, transition:`opacity 0.55s 0.1s ${SP}` }}>FSchoolAI</div>
      <div style={{ marginTop:5, fontSize:12, color:'rgba(255,255,255,0.4)', letterSpacing:'0.02em', opacity:show?1:0, transition:`opacity 0.55s 0.18s ${SP}` }}>AI-native learning for students</div>
      <div style={{ marginTop:26, padding:'6px 16px', borderRadius:20, background:'rgba(255,255,255,0.08)', border:'1px solid rgba(255,255,255,0.14)', fontSize:11, fontWeight:500, color:'rgba(255,255,255,0.78)', opacity:show?1:0, transition:`opacity 0.5s 0.28s ${SP}` }}>Launching Soon</div>
      <button onClick={onWaitlist} style={{ marginTop:12, padding:'11px 24px', borderRadius:980, background:'#fff', color:'#000', border:'none', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:FONT, opacity:show?1:0, transition:`opacity 0.5s 0.38s ${SP}`, userSelect:'none' as const }}>
        Join the waitlist
      </button>
      <div style={{ position:'absolute', top:0, left:0, right:0, height:'42%', background:'linear-gradient(180deg,rgba(255,255,255,0.018) 0%,transparent 100%)', pointerEvents:'none', borderRadius:'40px 40px 0 0' }} />
    </div>
  );
}

// ── Mobile screen FC: Flashcards ─────────────────────────────────────────────
function MScreenFC({ isActive }: { isActive: boolean }) {
  const [step, setStep] = useState(0);
  const [flipped, setFlipped] = useState(false);
  useEffect(() => {
    if (!isActive) { setStep(0); setFlipped(false); return; }
    const ts = [
      setTimeout(() => setStep(1), 260),
      setTimeout(() => setStep(2), 680),
      setTimeout(() => setFlipped(true), 1400),
      setTimeout(() => setStep(3), 1600),
    ];
    return () => ts.forEach(clearTimeout);
  }, [isActive]);

  return (
    <div style={{ width:'100%', height:'100%', position:'relative', overflow:'hidden', fontFamily:FONT }}>
      <SBgLight />
      <div style={{ position:'relative', zIndex:1, padding:'52px 18px 0' }}>
        <div style={{ fontSize:12, color:'#8E8E93' }}>Spaced Repetition</div>
        <div style={{ fontSize:21, fontWeight:700, color:'#1C1C1E', marginTop:2, letterSpacing:'-0.03em' }}>CHEM 201</div>
      </div>
      {/* progress */}
      <div style={{ position:'relative', zIndex:1, margin:'10px 14px 0' }}>
        <div style={{ height:4, borderRadius:2, background:'rgba(0,0,0,0.07)', overflow:'hidden' }}>
          <div style={{ height:'100%', width:step>=1?'38%':'0%', borderRadius:2, background:'#007AFF', transition:`width 0.9s ${SP}` }} />
        </div>
        <div style={{ display:'flex', justifyContent:'space-between', padding:'4px 0 0' }}>
          <span style={{ fontSize:10, color:'#8E8E93' }}>12 of 32 reviewed</span>
          <span style={{ fontSize:10, color:'#007AFF', fontWeight:600 }}>38%</span>
        </div>
      </div>
      {/* flashcard — 3D flip */}
      <div style={{ position:'relative', zIndex:1, margin:'10px 14px 0', height:164, perspective:'700px',
        opacity:step>=1?1:0, transform:step>=1?'translateY(0)':'translateY(16px)',
        transition:`opacity 0.45s ${SP}, transform 0.45s ${SP}` }}>
        <div style={{
          width:'100%', height:'100%', borderRadius:20, position:'relative',
          transformStyle:'preserve-3d' as any,
          transform:flipped?'rotateY(180deg)':'rotateY(0deg)',
          transition:`transform 0.65s ${SP}`,
        }}>
          {/* front face */}
          <div style={{ position:'absolute', inset:0, borderRadius:20, ...MGL.card,
            backfaceVisibility:'hidden' as any,
            display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'18px 16px' }}>
            <div style={{ fontSize:9, fontWeight:700, color:'#8E8E93', letterSpacing:'0.09em', textTransform:'uppercase' as const, marginBottom:10 }}>Question</div>
            <div style={{ fontSize:14, fontWeight:500, color:'#1C1C1E', textAlign:'center', lineHeight:1.52 }}>
              What makes SN2 reactions stereospecific?
            </div>
            <div style={{ marginTop:14, fontSize:10, color:'#8E8E93' }}>Tap to reveal →</div>
          </div>
          {/* back face */}
          <div style={{ position:'absolute', inset:0, borderRadius:20,
            background:'rgba(0,122,255,0.07)', border:'1px solid rgba(0,122,255,0.14)',
            boxShadow:'0 2px 18px rgba(0,122,255,0.08)',
            backfaceVisibility:'hidden' as any, transform:'rotateY(180deg)',
            display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'18px 16px' }}>
            <div style={{ fontSize:9, fontWeight:700, color:'#007AFF', letterSpacing:'0.09em', textTransform:'uppercase' as const, marginBottom:10 }}>Answer</div>
            <div style={{ fontSize:13, fontWeight:500, color:'#1C1C1E', textAlign:'center', lineHeight:1.5 }}>
              Backside nucleophilic attack causes Walden inversion — stereocenter inverts
            </div>
          </div>
        </div>
      </div>
      {/* grading buttons */}
      <div style={{ position:'relative', zIndex:1, display:'flex', gap:8, padding:'10px 14px 0',
        opacity:step>=3?1:0, transform:step>=3?'translateY(0)':'translateY(8px)',
        transition:`opacity 0.42s ${SP}, transform 0.42s ${SP}` }}>
        {[
          { label:'Again', sub:'10 min',   bg:'rgba(255,59,48,0.09)',  border:'rgba(255,59,48,0.18)',  color:'#FF3B30'  },
          { label:'Hard',  sub:'1 day',    bg:'rgba(255,149,0,0.09)',  border:'rgba(255,149,0,0.18)',  color:'#FF9500'  },
          { label:'Good',  sub:'4 days',   bg:'rgba(52,199,89,0.09)',  border:'rgba(52,199,89,0.18)',  color:'#34C759'  },
        ].map((b,i) => (
          <div key={i} style={{ flex:1, padding:'10px 6px', borderRadius:14, background:b.bg, border:`1px solid ${b.border}`, textAlign:'center' }}>
            <div style={{ fontSize:12, fontWeight:600, color:b.color }}>{b.label}</div>
            <div style={{ fontSize:9, color:'#8E8E93', marginTop:1 }}>{b.sub}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

const M_SCREENS_BASE = [MScreen0, MScreen1, MScreen2, MScreen3, MScreen4, MScreenFC, MScreen5];

// ── Mobile phone shell ────────────────────────────────────────────────────────
function MobilePhoneShell({ scene, phoneScale, isRotating, isEntered, onWaitlist }: {
  scene: number;
  phoneScale: number;
  isRotating: boolean;
  isEntered: boolean;
  onWaitlist?: () => void;
}) {
  return (
    // Outer: sized box so layout flow is stable
    <div style={{
      width: PW * phoneScale,
      height: PH * phoneScale,
      flexShrink: 0,
      position: "relative",
    }}>
      {/* Float layer — continuous vertical drift after entrance */}
      <div className={isEntered ? "mpwm-phone-float" : ""} style={{ position: "absolute", inset: 0 }}>
        {/* Cinematic entrance: opacity + blur + scale + translateY settle together */}
        <div style={{
          position: "absolute", inset: 0,
          opacity: isEntered ? 1 : 0,
          filter: isEntered ? "blur(0px)" : "blur(10px)",
          transform: isEntered ? "translateY(0) scale(1)" : "translateY(36px) scale(0.93)",
          transition: `opacity 1.0s ${SP}, filter 0.85s ${SP}, transform 1.05s ${SP}`,
          willChange: "opacity,filter,transform",
        }}>
          {/* Rotation layer (scene 7 choreography) */}
          <div style={{
            position: "absolute", top: 0, left: 0,
            transform: `scale(${phoneScale}) rotate(${isRotating ? -2.5 : 0}deg)`,
            transformOrigin: "top left",
            transition: `transform 0.92s ${SP}`,
            willChange: "transform",
          }}>
            {/* Outer container: side buttons live here, outside overflow:hidden */}
            <div style={{ position: "relative", width: PW, height: PH }}>
              {/* Side buttons — titanium Space Black */}
              <div style={{ position: "absolute", zIndex: 1, left: -3, top: 120, width: 3.5, height: 32, borderRadius: "2px 0 0 2px", background: "#3a3a3d" }} />
              <div style={{ position: "absolute", zIndex: 1, left: -3, top: 164, width: 3.5, height: 32, borderRadius: "2px 0 0 2px", background: "#3a3a3d" }} />
              <div style={{ position: "absolute", zIndex: 1, right: -3, top: 148, width: 3.5, height: 62, borderRadius: "0 2px 2px 0", background: "#3a3a3d" }} />
              {/* Phone body */}
              <div style={{
                position: "absolute", inset: 0, borderRadius: 50, overflow: "hidden",
                background: "linear-gradient(168deg,#3e3e41 0%,#2e2e31 28%,#222224 58%,#17171a 100%)",
                boxShadow:
                  "0 0 0 0.5px rgba(255,255,255,0.10)," +
                  "0 1.5px 0 rgba(255,255,255,0.13) inset," +
                  "0 -1px 0 rgba(0,0,0,0.65) inset," +
                  "inset 1px 0 0 rgba(255,255,255,0.055)," +
                  "inset -1px 0 0 rgba(255,255,255,0.055)," +
                  "0 40px 90px rgba(0,0,0,0.55)," +
                  "0 80px 150px rgba(0,0,0,0.28)",
              }}>
                {/* Screen inset — own clip, GPU layer */}
                <div style={{
                  position: "absolute", top: 12, left: 12, right: 12, bottom: 12,
                  borderRadius: 40, overflow: "hidden", background: "#000",
                  transform: "translateZ(0)",
                  isolation: "isolate",
                }}>
                  {/* Dynamic Island */}
                  <div style={{
                    position: "absolute", top: 10, left: "50%", transform: "translateX(-50%)",
                    width: 104, height: 34, borderRadius: 22, background: "#000", zIndex: 10,
                    pointerEvents: "none",
                    boxShadow: "0 0 0 1px rgba(255,255,255,0.04)",
                  }} />
                  {/* Screens 0–5 — crossfade */}
                  {M_SCREENS_BASE.map((Screen, i) => (
                    <div key={i} style={{
                      position: "absolute", inset: 0,
                      opacity: scene === i ? 1 : 0,
                      transform: scene === i ? "scale(1)" : scene > i ? "scale(1.015)" : "scale(0.985)",
                      transition: "opacity 0.42s cubic-bezier(0.4,0,0.2,1), transform 0.42s cubic-bezier(0.4,0,0.2,1)",
                      pointerEvents: scene === i ? "auto" : "none",
                      willChange: "opacity, transform",
                    }}>
                      <Screen isActive={scene === i} />
                    </div>
                  ))}
                  {/* Screen 7: Launch */}
                  <div style={{
                    position: "absolute", inset: 0,
                    opacity: scene === 7 ? 1 : 0,
                    transform: scene === 7 ? "scale(1)" : "scale(0.985)",
                    transition: "opacity 0.42s cubic-bezier(0.4,0,0.2,1), transform 0.42s cubic-bezier(0.4,0,0.2,1)",
                    pointerEvents: scene === 7 ? "auto" : "none",
                    willChange: "opacity, transform",
                  }}>
                    <MScreen6 isActive={scene === 7} onWaitlist={onWaitlist} />
                  </div>
                  {/* Glass sheen */}
                  <div style={{
                    position: "absolute", top: 0, left: 0, right: 0, height: "44%",
                    background: "linear-gradient(180deg,rgba(255,255,255,0.028) 0%,transparent 100%)",
                    pointerEvents: "none", zIndex: 20,
                  }} />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Mobile walkthrough container ─────────────────────────────────────────────
function MobileWalkthrough({ onWaitlist }: { onWaitlist?: () => void }) {
  const mTrackRef = useRef<HTMLDivElement>(null);
  const [mScene, setMScene]           = useState(0);
  const [mScale, setMScale]           = useState(0.72);
  const [phoneRotate, setPhoneRotate] = useState(false);
  const [phoneEntered, setPhoneEntered] = useState(false);

  // Entrance trigger — fire once when track scrolls into view
  useEffect(() => {
    const el = mTrackRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setPhoneEntered(true); obs.disconnect(); } },
      { threshold: 0.12 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // RAF poll — independent of desktop trackRef
  useEffect(() => {
    let rafId = 0;
    const tick = () => {
      if (mTrackRef.current) {
        const rect       = mTrackRef.current.getBoundingClientRect();
        const scrollable = rect.height - window.innerHeight;
        if (scrollable > 0) {
          const p    = Math.max(0, Math.min(1, -rect.top / scrollable));
          const next = Math.min(M_SCENES.length - 1, Math.floor(p * M_SCENES.length));
          setMScene(prev => (prev === next ? prev : next));
        }
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  // Phone rotation on final scene
  useEffect(() => {
    if (mScene !== 7) return;
    setPhoneRotate(true);
    const t = setTimeout(() => setPhoneRotate(false), 950);
    return () => clearTimeout(t);
  }, [mScene]);

  // Compute phone scale — subtract nav bar height so phone clears the banner
  useEffect(() => {
    const compute = () => {
      const navH = 64; // fixed nav bar height
      const s = Math.min(
        (window.innerHeight - navH - 160) / PH,
        (window.innerWidth - 48)   / PW,
        1
      );
      setMScale(Math.max(0.5, s));
    };
    compute();
    window.addEventListener("resize", compute);
    return () => window.removeEventListener("resize", compute);
  }, []);

  const sceneData = M_SCENES[mScene];

  return (
    <div role="region" aria-label="Product walkthrough" className="mpwm-section" style={{ background: "linear-gradient(180deg,#0a0a0f 0%,#0d0d14 100%)", fontFamily: FONT }}>
      <div ref={mTrackRef} style={{ height: `${M_SCENES.length * 100}vh`, position: "relative" }}>
        <div className="mpw-sticky" style={{
          display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "flex-start",
          padding: "clamp(16px,3vh,28px) 24px clamp(14px,2.5vh,24px)",
          gap: "clamp(8px,1.5vh,14px)",
          boxSizing: "border-box" as const,
        }}>
          {/* Phone */}
          <MobilePhoneShell scene={mScene} phoneScale={mScale} isRotating={phoneRotate} isEntered={phoneEntered} onWaitlist={onWaitlist} />

          {/* Scene text */}
          <div key={mScene} className="mpwm-text-anim" style={{ textAlign: "center" }}>
            <div style={{
              display: "inline-block",
              background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.10)",
              borderRadius: 980, padding: "3px 10px", fontSize: 10, fontWeight: 600,
              color: "rgba(255,255,255,0.46)", letterSpacing: "0.06em",
              textTransform: "uppercase" as const, marginBottom: 7,
            }}>{sceneData.tag}</div>
            <div style={{
              fontSize: "clamp(22px,6vw,32px)", fontWeight: 600, letterSpacing: "-0.03em",
              lineHeight: 1.08, color: "#ffffff", whiteSpace: "pre-line" as const, margin: 0,
            }}>{sceneData.headline}</div>
          </div>

          {/* Progress dots */}
          <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
            {M_SCENES.map((_, i) => (
              <div key={i} style={{
                borderRadius: "50%",
                width: mScene === i ? 7 : 5,
                height: mScene === i ? 7 : 5,
                background: mScene === i ? "rgba(255,255,255,0.90)" : "rgba(255,255,255,0.20)",
                transition: "all 0.28s ease",
              }} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
interface Props { onWaitlist?: () => void; }

export default function MobileProductWalkthrough({ onWaitlist }: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [activeScene, setActiveScene] = useState(0);
  const [phoneScale, setPhoneScale] = useState(() => {
    if (typeof window === "undefined") return 1;
    if (window.innerWidth > 767) return 1;
    return Math.min(
      (window.innerHeight * 0.58) / PH,
      (window.innerWidth * 0.88) / PW,
      1
    );
  });

  // Continuous RAF poll — works regardless of which element is scrolling
  useEffect(() => {
    let rafId = 0;
    const tick = () => {
      if (trackRef.current) {
        const rect = trackRef.current.getBoundingClientRect();
        const scrollable = rect.height - window.innerHeight;
        if (scrollable > 0) {
          const p = Math.max(0, Math.min(1, -rect.top / scrollable));
          const next = Math.min(SCENES.length - 1, Math.floor(p * SCENES.length));
          setActiveScene(prev => (prev === next ? prev : next));
        }
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  // Responsive phone scale
  useEffect(() => {
    const compute = () => {
      if (window.innerWidth > 767) {
        setPhoneScale(1);
      } else {
        setPhoneScale(Math.min(
          (window.innerHeight * 0.58) / PH,
          (window.innerWidth * 0.88) / PW,
          1
        ));
      }
    };
    compute();
    window.addEventListener("resize", compute);
    return () => window.removeEventListener("resize", compute);
  }, []);

  const scene = SCENES[activeScene];

  return (
    <>
      {/* ── DESKTOP SECTION (≥768px only) ── */}
      <div className="mpw-ds">
        <div style={{ background: "linear-gradient(180deg,#0a0a0f 0%,#0d0d14 100%)", fontFamily: FONT }}>
          {/* Scroll track — 80 vh per scene gives time to read each screen */}
          <div ref={trackRef} style={{ height: `${SCENES.length * 80}vh`, position: "relative" }}>
            <div className="mpw-sticky">
              <div className="mpw-desktop" style={{
                height: "100%", maxWidth: 1100, margin: "0 auto",
                padding: "0 clamp(24px,4vw,64px)",
                alignItems: "center",
                gap: "clamp(40px,5vw,80px)",
              }}>
                {/* Text col */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div key={activeScene} className="mpw-scene-text">
                    <TextPanel scene={scene} onWaitlist={onWaitlist} />
                  </div>
                </div>
                {/* Progress spine + phone */}
                <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 18, position: "relative" }}>
                  {/* Ambient glow behind phone */}
                  <div aria-hidden style={{ position: "absolute", top: "50%", right: -20, transform: "translate(0,-50%)", width: PW + 120, height: PH * 0.7, borderRadius: "50%", background: "radial-gradient(ellipse, rgba(79,110,255,0.12) 0%, transparent 72%)", pointerEvents: "none", zIndex: 0 }} />
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "center" }}>
                    {SCENES.map((_, i) => (
                      <div key={i} style={{
                        width: 2.5, borderRadius: 2,
                        height: activeScene === i ? 22 : 7,
                        background: activeScene === i ? "rgba(255,255,255,0.92)" : "rgba(255,255,255,0.18)",
                        transition: "height 0.32s cubic-bezier(0.4,0,0.2,1), background 0.32s ease",
                      }} />
                    ))}
                  </div>
                  <div style={{ position: "relative", zIndex: 1 }}><PhoneShell activeScene={activeScene} /></div>
                </div>
              </div>
            </div>
          </div>

          <style>{`
            .mpw-sticky {
              position: sticky;
              top: 0;
              height: 100vh;
              height: 100dvh;
              overflow: hidden;
            }
            .mpw-desktop {
              display: flex;
              height: 100%;
            }
            .mpw-scene-text {
              animation: mpw-fadein 0.38s cubic-bezier(0.4,0,0.2,1) both;
            }
            @keyframes mpw-spin {
              to { transform: rotate(360deg); }
            }
            @keyframes mpw-bounce {
              0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
              40%            { transform: translateY(-4px); opacity: 1; }
            }
            @keyframes mpw-fadein {
              from { opacity: 0; transform: translateY(8px); }
              to   { opacity: 1; transform: translateY(0); }
            }

            /* ── Show/hide: desktop vs mobile sections ── */
            .mpw-ds      { display: block; }
            .mpwm-section { display: none; }
            @media (max-width: 767px) {
              .mpw-ds       { display: none; }
              .mpwm-section { display: block; }
              /* Push sticky below fixed nav so phone never goes behind the banner */
              .mpw-sticky {
                top: 64px;
                height: calc(100vh - 64px);
                height: calc(100dvh - 64px);
              }
            }

            /* ── Mobile-only animations ── */
            @keyframes mpwm-pulse {
              0%, 100% { opacity: 1; }
              50%       { opacity: 0.4; }
            }
            @keyframes mpwm-bounce {
              0%, 80%, 100% { transform: translateY(0); opacity: 0.5; }
              40%            { transform: translateY(-4px); opacity: 1; }
            }
            @keyframes mpwm-fadein {
              from { opacity: 0; transform: translateY(6px); }
              to   { opacity: 1; transform: translateY(0); }
            }
            .mpwm-text-anim {
              animation: mpwm-fadein 0.35s cubic-bezier(0.4,0,0.2,1) both;
            }
            .mpwm-cta {
              animation: mpwm-fadein 0.4s 0.18s cubic-bezier(0.4,0,0.2,1) both;
            }
            .mpwm-cta:hover { opacity: 0.8; }

            @keyframes mpwm-float {
              0%, 100% { transform: translateY(0px); }
              50%       { transform: translateY(-5px); }
            }
            .mpwm-phone-float {
              animation: mpwm-float 5s 1.1s ease-in-out infinite;
            }

            @media (prefers-reduced-motion: reduce) {
              .mpw-scene-text, .mpwm-text-anim, .mpwm-cta {
                animation: none !important;
              }
              .mpw-desktop *, .mpwm-section * {
                transition: none !important;
                animation: none !important;
              }
              .mpwm-phone-float { animation: none !important; }
            }
          `}</style>
        </div>
      </div>

      {/* ── MOBILE SECTION (<768px only) — completely separate ── */}
      <MobileWalkthrough onWaitlist={onWaitlist} />
    </>
  );
}

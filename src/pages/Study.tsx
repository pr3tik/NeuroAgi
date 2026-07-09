// Study.jsx — Course picker, Flashcards / Study Guide modes.
// Flashcard study session: fullscreen, one card at a time, 3D flip, swipe-to-judge.

import { useState, useRef, useCallback, useEffect } from "react";
import { groq }         from "../api/groq";
import { useApp }        from "../context/AppContext";
import { supabase }      from "../api/supabase";
import { awardTokens }   from "../api/tokens";
import { Check, X, AlertTriangle, Sparkles } from "lucide-react";
import { groundingToast } from "../lib/studyGrounding";


const SYSTEM =
  "You are a study assistant. When generating flashcards, format EVERY card as exactly: Q: [question] | A: [answer] — one per line, no extra text. For study guides, use clear headings and concise bullet points.";

function parseFlashcards(text) {
  const cards = [];
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);

  // Primary format: "Q: question | A: answer" on one line
  const pipeLines = lines.filter(l => l.includes("Q:") && l.includes(" | ") && l.includes("A:"));
  if (pipeLines.length > 0) {
    pipeLines.forEach((line, i) => {
      const [qPart, aPart] = line.split(" | ");
      const question = (qPart || "").replace(/^(?:\d+[\.\)]\s*)?(?:\*+)?Q:\s*(?:\*+)?/i, "").replace(/\s*\|$/, "").trim();
      const answer   = (aPart || "").replace(/^(?:\d+[\.\)]\s*)?(?:\*+)?A:\s*(?:\*+)?/i, "").trim();
      if (question && answer) cards.push({ id: i, question, answer });
    });
    return cards;
  }

  // Fallback: "Q: question" on one line, "A: answer" on the next (Groq sometimes puts "| A:" on next line)
  for (let i = 0; i < lines.length - 1; i++) {
    const qMatch = lines[i].match(/^(?:\d+[\.\)]\s*)?(?:\*+)?Q:\s*(?:\*+)?(.+)/i);
    if (qMatch) {
      const aMatch = lines[i + 1].match(/^(?:\*+)?(?:\|\s*)?A:\s*(?:\*+)?(.+)/i);
      if (aMatch) {
        cards.push({ id: cards.length, question: qMatch[1].replace(/\s*\|$/, "").trim(), answer: aMatch[1].trim() });
        i++;
      }
    }
  }

  return cards;
}

// ── Fullscreen study session ──────────────────────────────────────────────────
function StudySession({ cards, onExit, updateUserField, userData }) {
  const [idx, setIdx]         = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [results, setResults] = useState([]);
  const [dragX, setDragX]     = useState(0);
  const [exitDir, setExitDir] = useState(null); // "left" | "right"

  const touchStartX  = useRef(null);
  const touchStartY  = useRef(null);
  const isDragMode   = useRef(false);
  const judgeLock    = useRef(false);

  // Timer refs
  const sessionStart = useRef(Date.now());   // when session began
  const idleTimer    = useRef(null);          // 2-min idle timeout handle
  const savedRef     = useRef(false);         // prevent double-save

  const IDLE_MS = 2 * 60 * 1000; // 2 minutes

  // Save elapsed study time to Supabase (accumulates on top of existing total)
  const saveStudyTime = useCallback(async (exitCallback) => {
    if (savedRef.current) { exitCallback?.(); return; }
    savedRef.current = true;
    clearTimeout(idleTimer.current);
    const elapsedMinutes = Math.round((Date.now() - sessionStart.current) / 60000);
    if (elapsedMinutes > 0 && updateUserField) {
      const prev = userData?.study_time ?? 0;
      await updateUserField("study_time", prev + elapsedMinutes);
    }
    exitCallback?.();
  }, [updateUserField, userData]);

  // Reset idle timer on any activity
  const resetIdle = useCallback(() => {
    clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => {
      saveStudyTime(onExit);
    }, IDLE_MS);
  }, [saveStudyTime, onExit]);

  // Start idle timer on mount, clear on unmount
  useEffect(() => {
    resetIdle();
    return () => clearTimeout(idleTimer.current);
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  const isDone = idx >= cards.length;
  const card   = cards[idx];

  const judge = useCallback((correct) => {
    if (judgeLock.current || isDone) return;
    resetIdle(); // reset idle on every judge action
    judgeLock.current = true;
    setExitDir(correct ? "right" : "left");
    setTimeout(() => {
      setResults((r) => [...r, correct]);
      setIdx((i) => i + 1);
      setFlipped(false);
      setDragX(0);
      setExitDir(null);
      judgeLock.current = false;
    }, 280);
  }, [isDone, resetIdle]);

  // Keyboard controls: Space = flip, ArrowRight = got it, ArrowLeft = missed
  useEffect(() => {
    function handleKey(e) {
      if (isDone) return;
      if (e.key === " " || e.code === "Space") {
        e.preventDefault();
        if (!flipped && !judgeLock.current) { resetIdle(); setFlipped(true); }
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        if (flipped) judge(true);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        if (flipped) judge(false);
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [flipped, isDone, judge, resetIdle]);

  // Touch: tap = flip, horizontal drag (after flip) = judge
  const onTouchStart = useCallback((e) => {
    resetIdle();
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
    isDragMode.current  = false;
    setDragX(0);
  }, [resetIdle]);

  const onTouchMove = useCallback((e) => {
    if (touchStartX.current === null || !flipped) return;
    const dx = e.touches[0].clientX - touchStartX.current;
    const dy = Math.abs(e.touches[0].clientY - touchStartY.current);
    if (Math.abs(dx) > 10 && Math.abs(dx) > dy) {
      isDragMode.current = true;
      e.preventDefault();
      setDragX(dx);
    }
  }, [flipped]);

  const onTouchEnd = useCallback((e) => {
    const endX  = e.changedTouches[0].clientX;
    const endY  = e.changedTouches[0].clientY;
    const dx    = endX - (touchStartX.current ?? endX);
    const dy    = Math.abs(endY - (touchStartY.current ?? endY));
    touchStartX.current = null;
    touchStartY.current = null;

    if (isDragMode.current) {
      isDragMode.current = false;
      if (Math.abs(dragX) > 70) judge(dragX > 0);
      else setDragX(0);
      return;
    }

    // It's a tap — flip the card
    if (!flipped && Math.abs(dx) < 12 && dy < 20 && !judgeLock.current) {
      setFlipped(true);
    }
  }, [flipped, dragX, judge]);

  // Card drag tint (only meaningful when flipped)
  const tintOpacity = Math.min(Math.abs(dragX) / 120, 1);
  const tintColor   = dragX > 20
    ? `rgba(52, 199, 89, ${tintOpacity * 0.2})`
    : dragX < -20
    ? `rgba(255, 59, 48, ${tintOpacity * 0.18})`
    : "transparent";

  const dragTransform  = exitDir === "right"
    ? "translateX(115%) rotate(14deg)"
    : exitDir === "left"
    ? "translateX(-115%) rotate(-14deg)"
    : `translateX(${dragX}px) rotate(${dragX * 0.035}deg)`;

  const dragTransition = exitDir
    ? "transform 0.28s var(--ease-apple), opacity 0.28s"
    : isDragMode.current
    ? "none"
    : "transform 0.28s var(--ease-apple)";

  // ── Done screen ──────────────────────────────────────────────────────────────
  if (isDone) {
    const correct = results.filter(Boolean).length;
    const pct     = Math.round((correct / cards.length) * 100);
    return (
      <div style={{
        position: "fixed", inset: 0, zIndex: 800,
        background: "var(--color-bg)", display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", fontFamily: "var(--font-sans)",
        padding: "32px 28px",
      }}>
        <div style={{ textAlign: "center", maxWidth: "320px", width: "100%" }}>
          <div style={{ fontSize: "60px", fontWeight: "700", color: "var(--text-primary)", letterSpacing: "-2px", marginBottom: "8px" }}>
            {pct}%
          </div>
          <p style={{ color: "var(--text-secondary)", fontSize: "15px", marginBottom: "32px" }}>
            {correct} of {cards.length} correct
          </p>
          <div style={{ display: "flex", gap: "6px", justifyContent: "center", marginBottom: "40px", flexWrap: "wrap" }}>
            {results.map((r, i) => (
              <div key={i} style={{
                width: 10, height: 10, borderRadius: "50%",
                background: r ? "rgba(52, 199, 89, 0.85)" : "rgba(255, 59, 48, 0.7)",
              }} />
            ))}
          </div>
          <button
            onClick={() => saveStudyTime(onExit)}
            style={{
              background: "var(--color-accent)", color: "#111", border: "none",
              borderRadius: "var(--radius-btn)", padding: "14px 32px",
              fontSize: "15px", fontWeight: "600", cursor: "pointer",
              fontFamily: "inherit", width: "100%", marginBottom: "12px",
            }}
          >
            Done
          </button>
          <button
            onClick={() => { setIdx(0); setResults([]); setFlipped(false); setDragX(0); }}
            style={{
              background: "rgba(255,255,255,0.06)", color: "var(--text-primary)",
              border: "1px solid var(--color-border)", borderRadius: "var(--radius-btn)",
              padding: "14px 32px", fontSize: "15px", cursor: "pointer",
              fontFamily: "inherit", width: "100%",
            }}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // ── Active session ───────────────────────────────────────────────────────────
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 800,
      background: "var(--color-bg)", display: "flex", flexDirection: "column",
      fontFamily: "var(--font-sans)",
    }}>
      {/* Top bar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "52px 22px 0", flexShrink: 0 }}>
        <button
          onClick={() => saveStudyTime(onExit)}
          style={{ background: "none", border: "none", color: "var(--text-secondary)", fontSize: "14px", cursor: "pointer", fontFamily: "inherit", padding: 0 }}
        >
          ← Exit
        </button>
        <span style={{ color: "var(--text-dim)", fontSize: "13px", fontVariantNumeric: "tabular-nums" }}>
          {idx + 1} / {cards.length}
        </span>
      </div>

      {/* Progress bar */}
      <div style={{ height: 2, background: "rgba(255,255,255,0.06)", margin: "14px 22px 0", borderRadius: 2 }}>
        <div style={{
          height: "100%", background: "rgba(255,255,255,0.55)", borderRadius: 2,
          width: `${(idx / cards.length) * 100}%`,
          transition: "width 0.3s var(--ease-apple)",
        }} />
      </div>

      {/* Swipe hint labels */}
      <div style={{ display: "flex", justifyContent: "space-between", padding: "14px 28px 0", flexShrink: 0 }}>
        <span style={{
          fontSize: "12px", color: "rgba(255, 75, 65, 0.8)", fontWeight: "600",
          opacity: flipped ? 1 : 0, transition: "opacity 0.22s",
        }}><X size={12} style={{ verticalAlign: "-2px", marginRight: 3 }} />Missed</span>
        <span style={{
          fontSize: "12px", color: "rgba(52, 199, 89, 0.85)", fontWeight: "600",
          opacity: flipped ? 1 : 0, transition: "opacity 0.22s",
        }}>Got it<Check size={12} style={{ verticalAlign: "-2px", marginLeft: 3 }} /></span>
      </div>

      {/* Card area */}
      <div
        style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 22px" }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <div style={{ width: "100%", maxWidth: "400px" }}>
          {/* Drag/exit wrapper */}
          <div
            style={{
              transform:  dragTransform,
              transition: dragTransition,
              opacity:    exitDir ? 0 : 1,
            }}
          >
            {/* 3D flip container — perspective applied here so it scales with card */}
            <div
              onClick={() => {
                if (!flipped && !judgeLock.current && !isDragMode.current) {
                  resetIdle();
                  setFlipped(true);
                }
              }}
              style={{
                position:      "relative",
                width:         "100%",
                paddingBottom: "68%",
                perspective:   "1400px",
                cursor:        flipped ? "default" : "pointer",
                touchAction:   "none",
              }}
            >
              <div style={{
                position:      "absolute",
                inset:         0,
                transformStyle: "preserve-3d",
                transform:     flipped ? "rotateY(180deg)" : "rotateY(0deg)",
                transition:    "transform 0.42s var(--ease-apple)",
              }}>
                {/* Front — question */}
                <div style={{
                  position:           "absolute",
                  inset:              0,
                  backfaceVisibility: "hidden",
                  WebkitBackfaceVisibility: "hidden",
                  background:         "linear-gradient(135deg, rgba(255,255,255,0.07) 0%, rgba(255,255,255,0.04) 100%)",
                  border:             "1px solid rgba(255,255,255,0.09)",
                  borderRadius:       "22px",
                  display:            "flex",
                  flexDirection:      "column",
                  justifyContent:     "center",
                  padding:            "30px 26px",
                  boxShadow:          "0 24px 60px rgba(0,0,0,0.45)",
                }}>
                  <div style={{
                    position: "absolute", inset: 0, borderRadius: "22px",
                    background: tintColor, transition: "background 0.15s", pointerEvents: "none",
                  }} />
                  <p style={{ color: "rgba(255,255,255,0.28)", fontSize: "10px", letterSpacing: "2px", textTransform: "uppercase", marginBottom: "14px" }}>
                    Question
                  </p>
                  <p style={{ color: "var(--text-primary)", fontSize: "18px", lineHeight: "1.65", fontWeight: "500" }}>
                    {card.question}
                  </p>
                  <p style={{ color: "rgba(255,255,255,0.2)", fontSize: "12px", marginTop: "22px" }}>
                    Tap or press Space to reveal
                  </p>
                </div>

                {/* Back — answer (pre-rotated 180° so it faces user when container flips) */}
                <div style={{
                  position:           "absolute",
                  inset:              0,
                  backfaceVisibility: "hidden",
                  WebkitBackfaceVisibility: "hidden",
                  transform:          "rotateY(180deg)",
                  background:         "linear-gradient(135deg, rgba(255,255,255,0.09) 0%, rgba(255,255,255,0.05) 100%)",
                  border:             "1px solid rgba(255,255,255,0.12)",
                  borderRadius:       "22px",
                  display:            "flex",
                  flexDirection:      "column",
                  justifyContent:     "center",
                  padding:            "30px 26px",
                  boxShadow:          "0 24px 60px rgba(0,0,0,0.45)",
                }}>
                  <div style={{
                    position: "absolute", inset: 0, borderRadius: "22px",
                    background: tintColor, transition: "background 0.15s", pointerEvents: "none",
                  }} />
                  <p style={{ color: "rgba(255,255,255,0.35)", fontSize: "10px", letterSpacing: "2px", textTransform: "uppercase", marginBottom: "14px" }}>
                    Answer
                  </p>
                  <p style={{ color: "var(--text-primary)", fontSize: "17px", lineHeight: "1.7" }}>
                    {card.answer}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Judge buttons — slide up after flip */}
      <div style={{
        display:     "flex",
        gap:         "12px",
        padding:     "0 22px 44px",
        flexShrink:  0,
        opacity:     flipped && !exitDir ? 1 : 0,
        transform:   flipped && !exitDir ? "translateY(0)" : "translateY(12px)",
        transition:  "opacity 0.25s var(--ease-apple), transform 0.25s var(--ease-apple)",
        pointerEvents: flipped && !exitDir ? "auto" : "none",
      }}>
        <button
          onClick={() => judge(false)}
          style={{
            flex: 1, background: "rgba(255, 59, 48, 0.1)",
            border: "1px solid rgba(255, 59, 48, 0.22)",
            borderRadius: "var(--radius-btn)", padding: "16px",
            color: "rgba(255, 85, 75, 0.9)", fontSize: "15px", fontWeight: "600",
            cursor: "pointer", fontFamily: "inherit",
            transition: "background var(--dur-base) var(--ease-apple)",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255, 59, 48, 0.18)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(255, 59, 48, 0.1)")}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><X size={16} />Missed</span>
        </button>
        <button
          onClick={() => judge(true)}
          style={{
            flex: 1, background: "rgba(52, 199, 89, 0.08)",
            border: "1px solid rgba(52, 199, 89, 0.22)",
            borderRadius: "var(--radius-btn)", padding: "16px",
            color: "rgba(72, 210, 110, 0.9)", fontSize: "15px", fontWeight: "600",
            cursor: "pointer", fontFamily: "inherit",
            transition: "background var(--dur-base) var(--ease-apple)",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(52, 199, 89, 0.16)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(52, 199, 89, 0.08)")}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>Got it<Check size={16} /></span>
        </button>
      </div>
    </div>
  );
}

// ── Compact flip card for list view ──────────────────────────────────────────
function FlipCard({ card }) {
  const [flipped, setFlipped] = useState(false);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => setFlipped((f) => !f)}
      onKeyDown={(e) => e.key === "Enter" && setFlipped((f) => !f)}
      style={{
        background:    "var(--color-surface)",
        border:        "1px solid var(--color-border)",
        borderRadius:  "var(--radius-card)",
        padding:       "22px",
        cursor:        "pointer",
        minHeight:     "100px",
        display:       "flex",
        flexDirection: "column",
        justifyContent: "center",
        transition:    "background var(--dur-base) var(--ease-apple)",
        outline:       "none",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-surface-hover)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "var(--color-surface)")}
      onFocus={(e) => (e.currentTarget.style.outline = "2px solid rgba(255,255,255,0.3)")}
      onBlur={(e)  => (e.currentTarget.style.outline = "none")}
    >
      <p style={{ color: "var(--text-dim)", fontSize: "10px", letterSpacing: "1.5px", textTransform: "uppercase", marginBottom: "8px" }}>
        {flipped ? "Answer" : "Question — tap to flip"}
      </p>
      <p style={{ color: "var(--text-primary)", fontSize: "15px", lineHeight: "1.6" }}>
        {flipped ? card.answer : card.question}
      </p>
    </div>
  );
}

// ── Lightweight markdown renderer (handles headings, bold, bullets) ──────────
function MarkdownGuide({ text }) {
  const lines = text.split("\n");
  const elements = [];
  let i = 0;

  function renderInline(str) {
    // Bold: **text**
    const parts = str.split(/(\*\*[^*]+\*\*)/g);
    return parts.map((part, idx) => {
      if (part.startsWith("**") && part.endsWith("**")) {
        return <strong key={idx} style={{ color: "var(--text-primary)", fontWeight: "600" }}>{part.slice(2, -2)}</strong>;
      }
      return part;
    });
  }

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) { elements.push(<div key={i} style={{ height: "8px" }} />); i++; continue; }

    if (trimmed.startsWith("### ")) {
      elements.push(
        <p key={i} style={{ color: "var(--text-primary)", fontSize: "13px", fontWeight: "700", letterSpacing: "1.5px", textTransform: "uppercase", marginTop: "20px", marginBottom: "8px", opacity: 0.6 }}>
          {trimmed.slice(4)}
        </p>
      );
    } else if (trimmed.startsWith("## ")) {
      elements.push(
        <p key={i} style={{ color: "var(--text-primary)", fontSize: "15px", fontWeight: "700", marginTop: "22px", marginBottom: "8px" }}>
          {trimmed.slice(3)}
        </p>
      );
    } else if (trimmed.startsWith("# ")) {
      elements.push(
        <p key={i} style={{ color: "var(--text-primary)", fontSize: "17px", fontWeight: "700", marginTop: "24px", marginBottom: "10px" }}>
          {trimmed.slice(2)}
        </p>
      );
    } else if (trimmed.startsWith("- ") || trimmed.startsWith("• ")) {
      elements.push(
        <div key={i} style={{ display: "flex", gap: "10px", marginBottom: "6px", alignItems: "flex-start" }}>
          <span style={{ color: "var(--text-dim)", fontSize: "13px", marginTop: "1px", flexShrink: 0 }}>·</span>
          <p style={{ color: "var(--text-secondary)", fontSize: "14px", lineHeight: "1.7", margin: 0 }}>
            {renderInline(trimmed.slice(2))}
          </p>
        </div>
      );
    } else {
      elements.push(
        <p key={i} style={{ color: "var(--text-secondary)", fontSize: "14px", lineHeight: "1.75", marginBottom: "6px" }}>
          {renderInline(trimmed)}
        </p>
      );
    }
    i++;
  }

  return <div>{elements}</div>;
}

// ── Main Study component ──────────────────────────────────────────────────────
export default function Study() {
  const { userId, courses: liveCourses, studyConfig, setStudyConfig, updateUserField, userData } = useApp();


  // Use live Canvas courses only
  const COURSES = liveCourses.map(c => `${c.courseCode} — ${c.name}`);
  const hasCanvasCourses = COURSES.length > 0;

  const [course,     setCourse]     = useState(COURSES[0] ?? "");
  const [mode,       setMode]       = useState("flashcards");
  const [loading,    setLoading]    = useState(false);
  const [flashcards, setFlashcards] = useState([]);
  const [guide,      setGuide]      = useState("");
  const [inSession,  setInSession]  = useState(false);
  const [toast,      setToast]      = useState("");
  const [toastKind,  setToastKind]  = useState("info"); // "warn" | "ok" | "info"
  const showToast = (msg, kind = "info") => { setToastKind(kind); setToast(msg); };

  // Sync selected course when live courses load in
  useEffect(() => {
    if (COURSES.length > 0 && !course) setCourse(COURSES[0]);
  }, [liveCourses]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-clear toast
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  // Hold the pending nav config in a ref so it survives async course-loading
  const pendingConfig = useRef(null);
  // Incrementing this forces Effect 2 to re-run even when liveCourses hasn't changed
  const [configTick, setConfigTick] = useState(0);

  // Step 1: capture incoming studyConfig into ref and signal Effect 2 to run
  useEffect(() => {
    if (studyConfig) {
      pendingConfig.current = studyConfig;
      setStudyConfig(null);
      setConfigTick(t => t + 1);
    }
  }, [studyConfig, setStudyConfig]);

  // Step 2: apply config whenever it arrives (configTick) or courses change (liveCourses)
  useEffect(() => {
    const cfg = pendingConfig.current;
    if (!cfg) return;
    pendingConfig.current = null;

    const available = liveCourses.map(c => `${c.courseCode} — ${c.name}`);
    if (!available.length) return;

    if (cfg.course) {
      const query    = cfg.course.toLowerCase();
      const keywords = query.split(/[\s\-—:,]+/).filter(w => w.length > 2);
      const match =
        available.find(c => c.toLowerCase() === query) ??
        available.find(c => c.toLowerCase().includes(query)) ??
        available.find(c => query.includes(c.toLowerCase())) ??
        available.find(c => keywords.some(w => c.toLowerCase().includes(w))) ??
        available[0];
      setCourse(match);
      setFlashcards([]);
      setGuide("");
    }
    if (cfg.mode) {
      setMode(cfg.mode === "guide" ? "guide" : "flashcards");
    }
  }, [liveCourses, configTick]);

  // Find the DB course id for the currently selected course label
  function getCourseDbId() {
    const selectedCourse = liveCourses.find(c => `${c.courseCode} — ${c.name}` === course);
    return selectedCourse?.dbId ?? null;
  }

  // Load existing flashcards/guide from DB without regenerating
  const loadExisting = async () => {
    const dbId = getCourseDbId();
    if (mode === "flashcards") {
      setLoading(true);
      try {
        const loadRes = await fetch("/api/flashcards", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ action: "load", userId, courseId: dbId }),
        });
        const loadData = await loadRes.json();
        const loaded = loadData?.cards ?? [];
        if (loaded.length > 0) { setFlashcards(loaded); setGuide(""); }
        else showToast("No saved flashcards yet — tap Add New Flashcards to create some.", "info");
      } catch {
        showToast("No saved flashcards yet — tap Add New Flashcards to create some.", "info");
      }
      setLoading(false);
    } else {
      // Study guide — load from canvas_data blob
      setLoading(true);
      const { data } = await supabase
        .from("canvas_data")
        .select("payload")
        .eq("user_id", userId)
        .eq("data_type", `study_guide_${dbId}`)
        .maybeSingle();
      if (data?.payload?.text) setGuide(data.payload.text);
      else showToast("No saved study guide yet — tap Update Study Guide to create one.", "info");
      setFlashcards([]);
      setLoading(false);
    }
  };

  // Build a smart context string — reads syllabus, modules, pages, files, announcements
  // Vincent's vision: read everything → reverse engineer what's on the final → plan
  async function buildCourseContext(dbId) {
    if (!dbId) return "";
    try {
      const selectedCourse = liveCourses.find(c => `${c.courseCode} — ${c.name}` === course);
      const courseId = selectedCourse?.id; // Canvas course ID for blob filtering

      const { data: rows } = await supabase
        .from("canvas_data")
        .select("data_type, payload")
        .eq("user_id", userId)
        .in("data_type", ["syllabus", "modules", "announcements", "course_pages", "course_files"]);

      const parts = [];

      // 1. Syllabus — full outline of what the course covers
      const syllabusRow = rows?.find(r => r.data_type === "syllabus");
      if (syllabusRow?.payload?.length) {
        const items = syllabusRow.payload
          .filter(s => !courseId || !s.courseId || s.courseId === courseId)
          .slice(0, 10)
          .map(s => s.title ?? s.name ?? JSON.stringify(s));
        if (items.length) parts.push(`SYLLABUS / COURSE OUTLINE:\n${items.map(i => `• ${i}`).join("\n")}`);
      }

      // 2. Modules — focus on LAST 3 (most likely to be on final)
      const modulesRow = rows?.find(r => r.data_type === "modules");
      if (modulesRow?.payload?.length) {
        const courseModules = modulesRow.payload
          .filter(m => !courseId || m.courseId === courseId);
        const recentModules = courseModules.slice(-3); // last 3 modules = finals territory
        const allModuleNames = courseModules.map(m => m.name ?? m.title);
        if (recentModules.length) {
          parts.push(`RECENT MODULES (last ${recentModules.length} — highest finals probability):\n${recentModules.map(m => `• ${m.name ?? m.title}`).join("\n")}`);
        }
        if (allModuleNames.length > 3) {
          parts.push(`ALL MODULES (full course arc):\n${allModuleNames.map(n => `• ${n}`).join("\n")}`);
        }
      }

      // 3. Professor announcements — often contain exam hints
      const annRow = rows?.find(r => r.data_type === "announcements");
      if (annRow?.payload?.length) {
        const recentAnn = annRow.payload
          .filter(a => !courseId || a.courseId === courseId)
          .slice(-4) // last 4 announcements
          .map(a => `• ${a.title ?? a.subject ?? ""}: ${(a.message ?? a.body ?? "").slice(0, 120)}`);
        if (recentAnn.length) parts.push(`PROFESSOR ANNOUNCEMENTS (recent — may contain exam hints):\n${recentAnn.join("\n")}`);
      }

      // 4. Course pages — professor notes, reading pages
      const pagesRow = rows?.find(r => r.data_type === "course_pages");
      if (pagesRow?.payload?.length) {
        const coursePages = pagesRow.payload
          .filter(p => !courseId || p.courseId === courseId)
          .slice(0, 6)
          .map(p => `• ${p.title ?? p.url ?? "Page"}`);
        if (coursePages.length) parts.push(`PROFESSOR PAGES / NOTES:\n${coursePages.join("\n")}`);
      }

      // 5. Course files — slides, PDFs uploaded by professor
      const filesRow = rows?.find(r => r.data_type === "course_files");
      if (filesRow?.payload?.length) {
        const courseFiles = filesRow.payload
          .filter(f => !courseId || f.courseId === courseId)
          .slice(0, 6)
          .map(f => `• ${f.displayName ?? f.filename ?? f.name ?? "File"}`);
        if (courseFiles.length) parts.push(`PROFESSOR FILES / SLIDES:\n${courseFiles.join("\n")}`);
      }

      // 6. Shared course library (course_content) — richer text from the puzzle library.
      // Populated by the extension as students browse their LMS.
      // Contains full extracted text, summaries, and concepts — far richer than canvas_data blobs.
      try {
        const selectedCourseObj = liveCourses.find(c => `${c.courseCode} — ${c.name}` === course);
        const canvasCourseId = selectedCourseObj?.canvasCourseId ?? String(selectedCourseObj?.id ?? "");
        if (canvasCourseId) {
          const { data: libraryRows } = await supabase
            .from("course_content")
            .select("content_type, summary, concepts, text, week_number, module_name, professor_name")
            .eq("canvas_course_id", canvasCourseId)
            .order("week_number", { ascending: false, nullsFirst: false })
            .limit(8);
          if (libraryRows?.length) {
            const libParts = libraryRows.map(r => {
              const label = r.module_name
                ? `${r.content_type} — ${r.module_name}`
                : r.week_number
                ? `${r.content_type} Week ${r.week_number}`
                : r.content_type;
              const body = r.summary || (r.text || "").slice(0, 400);
              const concepts = Array.isArray(r.concepts) && r.concepts.length
                ? `\n  Concepts: ${r.concepts.slice(0, 5).join(", ")}`
                : "";
              return `• [LIBRARY] ${label}: ${body}${concepts}`;
            });
            parts.push(`COURSE LIBRARY (shared content from all students in this course):\n${libParts.join("\n\n")}`);
          }
        }
      } catch (libErr) {
        console.warn("[Study] course_content library query failed:", libErr.message);
      }

      // 7. Actual lecture file text from files table (highest value — real course content)
      try {
        if (dbId) {
          const { data: fileRows } = await supabase
            .from("files")
            .select("name, content_text")
            .eq("user_id", userId)
            .eq("course_id", dbId)
            .not("content_text", "is", null)
            .limit(20);

          if (fileRows?.length) {
            const filtered = fileRows.filter(f =>
              !/course.?outline|zoom.?meeting|syllabus|course.?info|ai.?generated|tips.?for|appeals|feedback.?policy|academic.?integrity/i.test(f.name || "")
            );
            // Shuffle so repeated generations cover different files
            for (let i = filtered.length - 1; i > 0; i--) {
              const j = Math.floor(Math.random() * (i + 1));
              [filtered[i], filtered[j]] = [filtered[j], filtered[i]];
            }
            const fileContexts = filtered.slice(0, 4).map(f => {
              let text = f.content_text || "";
              text = text.split("\n").filter((l: string) => {
                if (/copyright|©|\ball rights\b|registered in course|course material|unauthorized/i.test(l)) return false;
                if (/^\s*(?:do you know|questions?)\s*\??$/i.test(l)) return false;
                if (/^\s*(?:•|-|\d+\.)\s*(?:how|what|why|which|when|where|who|is|are|can|would|could)\b.+\?\s*$/.test(l)) return false;
                return true;
              }).join("\n");
              text = text.replace(/\s+/g, " ").trim().slice(0, 400);
              return text ? `[${f.name}]: ${text}` : null;
            }).filter(Boolean);
            if (fileContexts.length) {
              parts.push(`LECTURE NOTES / SLIDES (actual course files):\n${fileContexts.join("\n\n")}`);
            }
          }
        }
      } catch (fileErr) {
        console.warn("[Study] files query failed:", fileErr.message);
      }

      return parts.length ? parts.join("\n\n") : "";
    } catch (e) {
      console.warn("[Study] buildCourseContext error:", e.message);
      return "";
    }
  }

  const deleteCard = async (cardId: string) => {
    setFlashcards(prev => prev.filter(c => c.id !== cardId));
    await fetch("/api/flashcards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", userId, cardId }),
    }).catch(() => {});
  };

  // Generate fresh flashcards/guide and append to existing
  const generate = async () => {
    setLoading(true);
    setGuide("");

    try {
      const dbId = getCourseDbId();

      // Load existing cards for dedup before generating
      let existingCards: { id: string; question: string; answer: string }[] = [];
      let existingQuestionsForDedup: string[] = [];
      let existingQuestionsBlock = "";
      if (dbId) {
        const existingRes = await fetch("/api/flashcards", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "load", userId, courseId: dbId }),
        }).then(r => r.json()).catch(() => ({ cards: [] }));
        existingCards = existingRes?.cards ?? [];
        existingQuestionsForDedup = existingCards.map((c: { question: string }) => c.question).filter(Boolean);
        if (existingQuestionsForDedup.length > 0) {
          const topics = existingQuestionsForDedup.slice(0, 15).map(q =>
            q.replace(/^(what is|what are|how is|how are|why is|why are|which|who|when|where)\s+/i, "")
              .replace(/\?$/, "").trim()
          );
          existingQuestionsBlock = `\n\nThese topics are already covered — generate cards on entirely different aspects:\n${topics.map(t => `• ${t}`).join("\n")}`;
        }
      }

      // Try RAG query first — returns best-matched full sections from ingested PDFs/slides.
      // If RAG has no content yet, auto-backfill from files.content_text then retry.
      // Falls back to direct DB queries if neither produces results.
      let contextBlock = "";
      try {
        const runRagQuery = () => fetch("/api/rag?action=query", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId,
            courseId: dbId,
            query: `key concepts, definitions, and important topics for ${course}`,
            maxSections: 5,
          }),
        }).then(r => r.json()).catch(() => ({ passages: [] }));

        let ragRes = await runRagQuery();

        // No RAG content yet — backfill from files.content_text then retry once
        if (!ragRes.passages?.length && dbId) {
          const { data: fileRows } = await supabase
            .from("files")
            .select("name, content_text")
            .eq("user_id", userId)
            .eq("course_id", dbId)
            .not("content_text", "is", null)
            .limit(10);

          if (fileRows?.length) {
            // Ingest each file's existing text into RAG
            for (const f of fileRows) {
              await fetch("/api/rag?action=ingest", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ userId, courseId: dbId, title: f.name, kind: "document", text: f.content_text }),
              }).catch(() => {});
            }
            ragRes = await runRagQuery();
          }
        }

        if (ragRes.passages?.length > 0) {
          const ragContext = ragRes.passages.map((p: { title: string; heading?: string; text: string }) => {
            const label = p.heading ? `[${p.title} — ${p.heading}]` : `[${p.title}]`;
            return `${label}:\n${p.text}`;
          }).join("\n\n");
          contextBlock = `\n\nHere is relevant content retrieved from the student's course materials:\n${ragContext}`;
        }
      } catch { /* RAG failed — fall through to buildCourseContext */ }

      if (!contextBlock) {
        const courseContext = await buildCourseContext(dbId);
        if (courseContext) contextBlock = `\n\nHere is real content from the student's course:\n${courseContext}`;
      }

      // Did we find ANY real course material (RAG / files / Canvas)? If not, the model is
      // generating from the course name alone — convincing but ungrounded, and the student
      // could end up studying the wrong topics. We still generate, but flag it clearly below.
      const grounded = contextBlock.length > 0;

      const cardCount = 8;

      const prompt =
        mode === "flashcards"
          ? `Create exactly ${cardCount} study flashcards for ${course}.${contextBlock}${existingQuestionsBlock}\n\nUse the course content above to identify the key topics and concepts for this course. Then write flashcards where every answer is a complete, factual explanation — written from your knowledge of the subject, not copied from the text above. You MUST provide a real answer for every card. It is FORBIDDEN to say anything like "not covered", "not available", "no specific answer", "not mentioned", or reference the source material in any answer. Every answer must explain the concept clearly as if teaching it. No numbering, no extra text.\n\nFormat: Q: [question] | A: [answer] — one per line.`
          : `You are a finals detective. Your job is to figure out exactly what will be on the final exam for ${course} and build a targeted study plan.${contextBlock}\n\nStep 1 — REVERSE ENGINEER THE FINAL: Based on the syllabus, recent modules (especially the last ones), professor announcements, and any file/page titles, identify the 5-7 most likely exam topics. Think like a professor: what did they spend the most time on? What did they announce recently?\n\nStep 2 — BUILD THE STUDY PLAN: For each likely exam topic, write: the concept, why it matters, and 2-3 things to know cold.\n\nStep 3 — PRIORITY ORDER: rank topics by how likely they are to appear.\n\nBe specific to this course's actual content. Do not give generic study advice.`;

      let result = await groq(
        [{ role: "user", content: prompt }],
        SYSTEM,
        mode === "guide" ? 2048 : 700
      );

      if (mode === "flashcards") {
        let cards = parseFlashcards(result);

        // Retry with strict format if parse failed
        if (cards.length === 0) {
          const retryPrompt = `Generate 8 study flashcards for ${course}. You MUST use this exact format for every card, one per line:\nQ: [question] | A: [answer]\n\nNo numbering, no extra text, no markdown. Just the Q/A lines.`;
          const retryResult = await groq([{ role: "user", content: retryPrompt }], SYSTEM, 700).catch(() => "");
          cards = parseFlashcards(retryResult);
        }

        if (cards.length === 0) {
          showToast("Couldn't parse any flashcards — try generating again.", "warn");
          setLoading(false);
          return;
        }

        // Client-side dedup against full existing questions
        if (existingQuestionsForDedup.length > 0) {
          const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
          const existingNorm = new Set(existingQuestionsForDedup.map(normalize));
          cards = cards.filter(c => !existingNorm.has(normalize(c.question)));
        }

        if (cards.length === 0) {
          showToast("All generated cards were duplicates — try again for new topics.", "warn");
          setLoading(false);
          return;
        }

        if (!dbId) {
          // No course link — show only, don't save
          setFlashcards([...cards, ...existingCards]);
          showToast("Couldn't link to course — flashcards shown but not saved. Try re-syncing Canvas.", "warn");
        } else {
          const saveRes = await fetch("/api/flashcards", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "save", userId, courseId: dbId, cards }),
          });
          if (!saveRes.ok) {
            const saveErr = await saveRes.json().catch(() => ({}));
            showToast("Flashcards generated but couldn't save: " + (saveErr.error ?? "unknown error"), "warn");
            setFlashcards([...cards, ...existingCards]);
          } else {
            // Reload from DB to get real UUIDs and correct order (newest first)
            const reloaded = await fetch("/api/flashcards", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "load", userId, courseId: dbId }),
            }).then(r => r.json()).catch(() => ({ cards: [] }));
            setFlashcards(reloaded?.cards?.length > 0 ? reloaded.cards : [...cards, ...existingCards]);
            const t = groundingToast("flashcards", grounded, cards.length);
            showToast(t.message, t.kind);
            awardTokens("flashcards_generated", { courseId: String(dbId) }).catch(() => {});
          }
        }
      } else {
        setGuide(result);
        if (!dbId) {
          showToast("Couldn't link to course — guide shown but not saved. Try re-syncing Canvas.", "warn");
        } else {
          const { error: saveErr } = await supabase.from("canvas_data").upsert(
            { user_id: userId, data_type: `study_guide_${dbId}`, payload: { text: result }, synced_at: new Date().toISOString() },
            { onConflict: "user_id,data_type" }
          );
          if (saveErr) {
            showToast("Guide generated but couldn't save: " + saveErr.message, "warn");
          } else {
            const t = groundingToast("guide", grounded);
            showToast(t.message, t.kind);
          }
        }
      }
    } catch (err) {
      console.error("[Study] generate error:", err.message);
      showToast("Generation failed — " + (err.message ?? "unexpected error"), "warn");
    } finally {
      setLoading(false);
    }
  };

  if (inSession && flashcards.length > 0) {
    return <StudySession cards={flashcards} onExit={() => setInSession(false)} updateUserField={updateUserField} userData={userData} />;
  }

  // No Canvas connected yet
  if (!hasCanvasCourses) {
    return (
      <div>
        <h1 style={{ fontSize: "26px", fontWeight: "600", color: "var(--text-primary)", marginBottom: "24px", letterSpacing: "-0.3px" }}>
          Study
        </h1>
        <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-card)", boxShadow: "var(--depth-line)", padding: "24px" }}>
          <p style={{ color: "var(--text-secondary)", fontSize: "14px", marginBottom: "4px" }}>No courses found</p>
          <p style={{ color: "var(--text-dim)", fontSize: "12px", lineHeight: "1.6" }}>
            Connect Canvas on the Canvas page to load your real courses here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1 style={{ fontSize: "26px", fontWeight: "600", color: "var(--text-primary)", marginBottom: "24px", letterSpacing: "-0.3px" }}>
        Study
      </h1>

      <select
        value={course}
        onChange={e => { setCourse(e.target.value); setFlashcards([]); setGuide(""); }}
        style={{
          width: "100%", background: "var(--color-surface)",
          border: "1px solid var(--color-border)", borderRadius: "var(--radius-btn)",
          padding: "12px 36px 12px 14px", color: "var(--text-primary)",
          fontSize: "14px", outline: "none", fontFamily: "inherit",
          marginBottom: "14px", cursor: "pointer", appearance: "none", WebkitAppearance: "none",
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='rgba(255,255,255,0.35)' stroke-width='1.5' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`,
          backgroundRepeat: "no-repeat", backgroundPosition: "right 14px center",
        }}
      >
        {COURSES.map((c) => <option key={c} value={c} style={{ background: "#1a1a1a" }}>{c}</option>)}
      </select>

      {/* Mode toggle */}
      <div style={{
        display: "flex", gap: "6px", marginBottom: "20px",
        background: "rgba(255,255,255,0.04)", border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-btn)", padding: "4px",
      }}>
        {["flashcards", "guide"].map((m) => (
          <button
            key={m}
            onClick={() => { setMode(m); setFlashcards([]); setGuide(""); }}
            style={{
              flex: 1,
              background: mode === m ? "var(--color-surface-hover)" : "transparent",
              border:     mode === m ? "1px solid var(--color-border-strong)" : "1px solid transparent",
              borderRadius: "9px", padding: "8px",
              color:      mode === m ? "var(--text-primary)" : "var(--text-secondary)",
              fontSize:   "13px", fontWeight: mode === m ? "600" : "400",
              cursor:     "pointer", fontFamily: "inherit",
              transition: "all var(--dur-fast) var(--ease-apple)",
            }}
          >
            {m === "guide" ? "Study Guide" : "Flashcards"}
          </button>
        ))}
      </div>

      {/* Toast */}
      {toast && (
        <div style={{
          background: "rgba(255,255,255,0.06)",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: "12px",
          padding: "12px 16px",
          marginBottom: "14px",
          fontSize: "13px",
          color: "var(--text-secondary)",
          display: "flex",
          alignItems: "center",
          gap: "8px",
        }}>
          {toastKind === "warn" && <AlertTriangle size={14} style={{ color: "rgba(255,200,80,0.8)", flexShrink: 0 }} />}
          {toastKind === "ok" && <Check size={14} style={{ color: "rgba(120,220,140,0.9)", flexShrink: 0 }} />}
          {toast}
        </div>
      )}

      {/* Action buttons */}
      <div style={{ display: "flex", gap: "8px", marginBottom: "24px" }}>
        {/* Ghost button — load existing */}
        <button
          onClick={loadExisting}
          disabled={loading}
          style={{
            flex: 1,
            background: "transparent",
            color: "var(--text-secondary)",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: "var(--radius-btn)",
            padding: "13px 10px",
            fontSize: "13px",
            fontWeight: "500",
            cursor: loading ? "not-allowed" : "pointer",
            fontFamily: "inherit",
            letterSpacing: "0.2px",
            transition: "border-color 0.18s, color 0.18s",
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.25)"; e.currentTarget.style.color = "var(--text-primary)"; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.12)"; e.currentTarget.style.color = "var(--text-secondary)"; }}
        >
          {mode === "guide" ? "Read Guide" : <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>Study<Sparkles size={14} /></span>}
        </button>

        {/* Primary button — generate new */}
        <button
          onClick={generate}
          disabled={loading}
          style={{
            flex: 2,
            background: loading
              ? "rgba(255,255,255,0.08)"
              : "linear-gradient(135deg, rgba(255,255,255,0.14) 0%, rgba(255,255,255,0.07) 100%)",
            color: loading ? "var(--text-dim)" : "var(--text-primary)",
            border: "1px solid rgba(255,255,255,0.14)",
            borderRadius: "var(--radius-btn)",
            padding: "13px 10px",
            fontSize: "13px",
            fontWeight: "600",
            cursor: loading ? "not-allowed" : "pointer",
            fontFamily: "inherit",
            letterSpacing: "0.2px",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
            transition: "background 0.18s, border-color 0.18s",
            position: "relative",
            overflow: "hidden",
          }}
          onMouseEnter={e => { if (!loading) e.currentTarget.style.borderColor = "rgba(255,255,255,0.28)"; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.14)"; }}
        >
          {loading
            ? "Generating…"
            : mode === "guide"
            ? <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>Update Study Guide<Sparkles size={14} /></span>
            : <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>Add New Flashcards<Sparkles size={14} /></span>}
        </button>
      </div>

      {flashcards.length > 0 && (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
            <p style={{ color: "var(--text-dim)", fontSize: "12px" }}>
              {flashcards.length} cards — tap any card to preview
            </p>
            <button
              onClick={() => setInSession(true)}
              style={{
                background: "var(--color-accent)", color: "#111", border: "none",
                borderRadius: "var(--radius-btn)", padding: "9px 18px",
                fontSize: "13px", fontWeight: "600", cursor: "pointer", fontFamily: "inherit",
              }}
            >
              Study Now →
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {flashcards.map((card) => (
              <div key={card.id} style={{ position: "relative" }}>
                <FlipCard card={card} />
                <button
                  onClick={() => deleteCard(card.id)}
                  title="Delete card"
                  style={{
                    position: "absolute", top: "8px", right: "8px",
                    background: "rgba(255,60,60,0.12)", border: "1px solid rgba(255,60,60,0.22)",
                    borderRadius: "6px", color: "rgba(255,100,100,0.75)",
                    fontSize: "11px", padding: "3px 7px", cursor: "pointer", lineHeight: 1,
                  }}
                ><X size={12} /></button>
              </div>
            ))}
          </div>
        </>
      )}

      {guide && (
        <div style={{
          background: "var(--color-surface)", border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-card)", padding: "20px 22px",
        }}>
          <MarkdownGuide text={guide} />
        </div>
      )}
    </div>
  );
}

// src/components/SpaceExams.tsx — YouLearn Phase 4: Exams inside a Space.
// Flow: list → preferences → animated generation steps → take → grade → scorecard

import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Medal, ClipboardList, PenLine, BookOpen, Check, X } from "lucide-react";
import { supabase } from "../api/supabase";

// ── Types ─────────────────────────────────────────────────────────────────

export interface ExamQuestion {
  id: string;
  type: "mcq" | "truefalse" | "written";
  question: string;
  options?: string[];
  correctIndex?: number;
  correct?: boolean;
  topic?: string;
  explanation?: string;
  expectedKey?: string;
}

interface Exam {
  id: string; space_id: string; user_id: string;
  title: string; questions: ExamQuestion[]; created_at: string;
}

interface QuestionResult {
  questionId: string; score: number;
  verdict: "correct" | "partial" | "incorrect";
  feedback: string;
}

interface ExamAttempt {
  id: string; exam_id: string; user_id: string;
  answers: Record<string, string | number>;
  results: QuestionResult[];
  score: number; submitted_at: string; created_at: string;
}

interface DocMaterial {
  id: string; name: string;
  summary: string | null; content_text: string | null;
}

interface ExamPrefs {
  questionCount: number;
  questionType: "both" | "mcq" | "written";
}

type View = "list" | "prefs" | "creating" | "taking" | "grading" | "scorecard";

// ── Constants ─────────────────────────────────────────────────────────────

const EASE: [number, number, number, number] = [0.25, 0.46, 0.45, 0.94];

const GEN_STEPS = [
  "Preparing exam materials",
  "Analyzing content",
  "Generating questions",
  "Structuring exam",
  "Reviewing criteria",
];

// ── Helpers ───────────────────────────────────────────────────────────────

// Strip lone UTF-16 surrogates and control chars that break JSON.stringify
function sanitize(text: string): string {
  return text
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, "")
    .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
}

function parseJSON<T>(raw: string): T | null {
  const clean = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  try { return JSON.parse(clean) as T; } catch { return null; }
}

async function callClaude(prompt: string, system: string, maxTokens = 3000): Promise<string> {
  const res = await fetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: prompt }], system, max_tokens: maxTokens }),
  });
  if (!res.ok) throw new Error(`Claude ${res.status}`);
  const d = await res.json();
  return d.content ?? "";
}

function wait(ms: number) { return new Promise<void>(r => setTimeout(r, ms)); }

function scoreColor(s: number) {
  if (s >= 85) return "#4ade80";
  if (s >= 70) return "#C49A3C";
  if (s >= 55) return "#60a5fa";
  return "#f87171";
}

function scoreLabel(s: number) {
  if (s >= 90) return "Excellent";
  if (s >= 80) return "Great";
  if (s >= 70) return "Good";
  if (s >= 60) return "Passing";
  return "Needs Review";
}

function timeAgo(iso: string) {
  const d = Date.now() - new Date(iso).getTime();
  const h = Math.floor(d / 3_600_000);
  if (h < 24) return h < 1 ? "just now" : `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ── Exam Preferences Screen ────────────────────────────────────────────────

function ExamPreferences({
  docCount, onBack, onContinue,
}: {
  docCount: number; onBack: () => void;
  onContinue: (prefs: ExamPrefs) => void;
}) {
  const [count, setCount] = useState(10);
  const [type,  setType]  = useState<ExamPrefs["questionType"]>("both");

  const COUNTS = [5, 8, 10, 15, 20];
  const TYPE_OPTS: { value: ExamPrefs["questionType"]; label: string; sub: string }[] = [
    { value: "both",    label: "Both",             sub: "MCQ + Written" },
    { value: "mcq",     label: "Multiple Choice",  sub: "MCQ + True/False" },
    { value: "written", label: "Written only",     sub: "Short answers" },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -16 }}
      transition={{ duration: 0.24, ease: EASE }}
    >
      {/* Progress dashes */}
      <div style={{ display: "flex", gap: 6, justifyContent: "center", marginBottom: 32 }}>
        {[0, 1, 2].map(i => (
          <motion.div
            key={i}
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ delay: i * 0.08, duration: 0.3, ease: EASE }}
            style={{
              height: 4, width: 44, borderRadius: 2,
              background: "#22c55e",
              transformOrigin: "left",
            }}
          />
        ))}
      </div>

      <p style={{
        fontSize: 22, fontWeight: 700, color: "var(--text-primary)",
        textAlign: "center", marginBottom: 6, letterSpacing: "-0.3px",
      }}>Choose your preferences</p>
      <p style={{ fontSize: 13, color: "var(--text-dim)", textAlign: "center", marginBottom: 32 }}>
        {docCount} document{docCount !== 1 ? "s" : ""} · AI will anchor questions to your materials
      </p>

      {/* Number of questions */}
      <p style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 10 }}>
        Number of Questions <span style={{ color: "rgba(255,80,80,0.7)" }}>*</span>
      </p>
      <div style={{ display: "flex", gap: 8, marginBottom: 24, flexWrap: "wrap" }}>
        {COUNTS.map(n => (
          <motion.button
            key={n}
            whileTap={{ scale: 0.96 }}
            onClick={() => setCount(n)}
            style={{
              padding: "10px 0", width: 56, borderRadius: 12,
              background: count === n ? "rgba(34,197,94,0.12)" : "rgba(255,255,255,0.04)",
              border: `1.5px solid ${count === n ? "rgba(34,197,94,0.5)" : "rgba(255,255,255,0.08)"}`,
              color: count === n ? "#22c55e" : "var(--text-secondary)",
              fontSize: 15, fontWeight: count === n ? 700 : 400,
              cursor: "pointer", fontFamily: "inherit",
              transition: "all 0.14s",
            }}
          >{n}</motion.button>
        ))}
      </div>

      {/* Question type */}
      <p style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 10 }}>
        Question Type <span style={{ color: "rgba(255,80,80,0.7)" }}>*</span>
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 36 }}>
        {TYPE_OPTS.map(opt => (
          <motion.button
            key={opt.value}
            whileTap={{ scale: 0.99 }}
            onClick={() => setType(opt.value)}
            style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "12px 16px", borderRadius: 12,
              background: type === opt.value ? "rgba(34,197,94,0.08)" : "rgba(255,255,255,0.04)",
              border: `1.5px solid ${type === opt.value ? "rgba(34,197,94,0.4)" : "rgba(255,255,255,0.08)"}`,
              cursor: "pointer", fontFamily: "inherit", textAlign: "left",
              transition: "all 0.14s",
            }}
          >
            <div>
              <p style={{ fontSize: 14, fontWeight: 500, color: type === opt.value ? "#22c55e" : "var(--text-primary)" }}>
                {opt.label}
              </p>
              <p style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 2 }}>{opt.sub}</p>
            </div>
            <div style={{
              width: 18, height: 18, borderRadius: "50%", flexShrink: 0,
              background: type === opt.value ? "#22c55e" : "transparent",
              border: `2px solid ${type === opt.value ? "#22c55e" : "rgba(255,255,255,0.2)"}`,
              display: "flex", alignItems: "center", justifyContent: "center",
              transition: "all 0.14s",
            }}>
              {type === opt.value && (
                <svg width="8" height="6" viewBox="0 0 8 6" fill="none">
                  <path d="M1 3L3 5L7 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
            </div>
          </motion.button>
        ))}
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: 10 }}>
        <button
          onClick={onBack}
          style={{
            padding: "13px 20px", borderRadius: 12,
            background: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,255,255,0.09)",
            color: "var(--text-secondary)", fontSize: 14, fontWeight: 500,
            cursor: "pointer", fontFamily: "inherit",
          }}
        >← Back</button>
        <motion.button
          whileTap={{ scale: 0.98 }}
          onClick={() => onContinue({ questionCount: count, questionType: type })}
          style={{
            flex: 1, padding: "13px",
            background: "rgba(34,197,94,0.14)",
            border: "1px solid rgba(34,197,94,0.38)",
            borderRadius: 12, color: "#22c55e",
            fontSize: 14, fontWeight: 700,
            cursor: "pointer", fontFamily: "inherit",
            transition: "background 0.14s",
          }}
        >Continue →</motion.button>
      </div>
    </motion.div>
  );
}

// ── Animated Generation Steps ─────────────────────────────────────────────

function AnimatedGenerationSteps({ step }: { step: number }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      style={{ padding: "20px 0" }}
    >
      <motion.p
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        style={{
          fontSize: 18, fontWeight: 700,
          color: "var(--text-primary)", marginBottom: 32,
          letterSpacing: "-0.2px",
        }}
      >Building your exam…</motion.p>

      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        {GEN_STEPS.map((label, i) => {
          const done    = i < step;
          const active  = i === step;
          const pending = i > step;

          return (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: -14 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.09, duration: 0.28, ease: EASE }}
              style={{ display: "flex", alignItems: "center", gap: 14 }}
            >
              {/* Step circle */}
              <div style={{ width: 28, height: 28, flexShrink: 0, position: "relative" }}>
                {done && (
                  <motion.div
                    initial={{ scale: 0.4, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: "spring", stiffness: 420, damping: 18 }}
                    style={{
                      width: 28, height: 28, borderRadius: "50%",
                      background: "#22c55e",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}
                  >
                    <svg width="12" height="9" viewBox="0 0 12 9" fill="none">
                      <path d="M1 4.5L4.5 8L11 1" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </motion.div>
                )}
                {active && (
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1.1, repeat: Infinity, ease: "linear" }}
                    style={{
                      width: 28, height: 28, borderRadius: "50%",
                      border: "2.5px solid rgba(255,255,255,0.1)",
                      borderTopColor: "#22c55e",
                    }}
                  />
                )}
                {pending && (
                  <div style={{
                    width: 28, height: 28, borderRadius: "50%",
                    border: "1.5px solid rgba(255,255,255,0.1)",
                  }} />
                )}
              </div>

              {/* Label */}
              <motion.p
                animate={{
                  color: done    ? "rgba(255,255,255,0.45)"
                       : active  ? "rgba(255,255,255,0.92)"
                       : "rgba(255,255,255,0.22)",
                }}
                transition={{ duration: 0.25 }}
                style={{ fontSize: 15, fontWeight: active ? 600 : 400, lineHeight: 1 }}
              >
                {label}
                {active && (
                  <motion.span
                    animate={{ opacity: [1, 0.3, 1] }}
                    transition={{ duration: 1.2, repeat: Infinity }}
                    style={{ marginLeft: 2 }}
                  >.</motion.span>
                )}
              </motion.p>
            </motion.div>
          );
        })}
      </div>
    </motion.div>
  );
}

// ── Score Ring ────────────────────────────────────────────────────────────

function ScoreRing({ score, color }: { score: number; color: string }) {
  const R = 52, CIRC = 2 * Math.PI * R;
  const [displayed, setDisplayed] = useState(0);

  useEffect(() => {
    const start = performance.now(), dur = 1500;
    function tick(now: number) {
      const t = Math.min((now - start) / dur, 1);
      setDisplayed(Math.round((1 - Math.pow(1 - t, 3)) * score));
      if (t < 1) requestAnimationFrame(tick);
    }
    const id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [score]);

  return (
    <div style={{ position: "relative", width: 140, height: 140, margin: "0 auto" }}>
      <svg width="140" height="140" viewBox="0 0 140 140">
        <circle cx="70" cy="70" r={R} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="8" />
        <motion.circle
          cx="70" cy="70" r={R} fill="none" stroke={color} strokeWidth="8"
          strokeLinecap="round" strokeDasharray={CIRC}
          initial={{ strokeDashoffset: CIRC }}
          animate={{ strokeDashoffset: CIRC - (score / 100) * CIRC }}
          transition={{ duration: 1.5, ease: [0.25, 0.46, 0.45, 0.94], delay: 0.25 }}
          style={{ transformOrigin: "70px 70px", rotate: "-90deg" }}
        />
      </svg>
      <div style={{
        position: "absolute", inset: 0,
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      }}>
        <span style={{ fontSize: 32, fontWeight: 700, color, letterSpacing: "-1px", lineHeight: 1 }}>
          {displayed}
        </span>
        <span style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 3 }}>/ 100</span>
      </div>
    </div>
  );
}

// ── Exam Card (list item) ─────────────────────────────────────────────────

function ExamCard({ exam, attempt, onTake, onViewResults }: {
  exam: Exam; attempt: ExamAttempt | null;
  onTake: () => void; onViewResults: () => void;
}) {
  const done = !!attempt?.submitted_at;
  const sc   = done ? Math.round(attempt!.score) : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }} transition={{ duration: 0.2, ease: EASE }}
      style={{
        padding: "14px 16px",
        background: "var(--color-surface)",
        border: "1px solid var(--color-border)",
        borderRadius: 14,
        display: "flex", alignItems: "center", gap: 14,
      }}
    >
      <div style={{
        width: 40, height: 40, borderRadius: 10, flexShrink: 0,
        background: done ? `${scoreColor(sc!)}18` : "rgba(255,255,255,0.05)",
        border: `1px solid ${done ? `${scoreColor(sc!)}30` : "rgba(255,255,255,0.08)"}`,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        {done
          ? (sc! >= 70
              ? <Medal size={20} style={{ color: scoreColor(sc!) }} />
              : <ClipboardList size={20} style={{ color: scoreColor(sc!) }} />)
          : <PenLine size={20} style={{ color: "var(--text-secondary)" }} />}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{
          fontSize: 13, fontWeight: 600, color: "var(--text-primary)",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>{exam.title}</p>
        <p style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 3 }}>
          {exam.questions.length} questions · {timeAgo(exam.created_at)}
          {done && ` · ${sc}%`}
        </p>
      </div>

      {done ? (
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          <button onClick={onViewResults} style={{
            padding: "6px 12px", borderRadius: 8, fontSize: 12, fontWeight: 600,
            background: `${scoreColor(sc!)}18`, border: `1px solid ${scoreColor(sc!)}38`,
            color: scoreColor(sc!), cursor: "pointer", fontFamily: "inherit",
          }}>Results</button>
          <button onClick={onTake} style={{
            padding: "6px 12px", borderRadius: 8, fontSize: 12, fontWeight: 500,
            background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.09)",
            color: "var(--text-secondary)", cursor: "pointer", fontFamily: "inherit",
          }}>Retake</button>
        </div>
      ) : (
        <button onClick={onTake} style={{
          padding: "7px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600, flexShrink: 0,
          background: "rgba(196,154,60,0.12)", border: "1px solid rgba(196,154,60,0.3)",
          color: "#C49A3C", cursor: "pointer", fontFamily: "inherit",
        }}>Take →</button>
      )}
    </motion.div>
  );
}

// ── Exam Session ──────────────────────────────────────────────────────────

function ExamSession({ exam, userId, attemptId, onSubmit }: {
  exam: Exam; userId: string; attemptId: string;
  onSubmit: (answers: Record<string, string | number>) => void;
}) {
  const [qIdx,    setQIdx]    = useState(0);
  const [answers, setAnswers] = useState<Record<string, string | number>>({});
  const q = exam.questions[qIdx];
  const total = exam.questions.length;
  const isLast = qIdx === total - 1;
  const allAnswered = exam.questions.every(q => answers[q.id] !== undefined);

  function answer(value: string | number) {
    const updated = { ...answers, [q.id]: value };
    setAnswers(updated);
    supabase.from("exam_attempts").update({ answers: updated }).eq("id", attemptId).then();
  }

  const current = answers[q.id];
  const pct = Math.round(((qIdx + 1) / total) * 100);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      style={{ display: "flex", flexDirection: "column", minHeight: "calc(100dvh - 160px)" }}
    >
      {/* Progress */}
      <div style={{ marginBottom: 24, flexShrink: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
          <span style={{ fontSize: 12, color: "var(--text-dim)" }}>Q {qIdx + 1} / {total}</span>
          <span style={{ fontSize: 12, color: "var(--text-dim)" }}>{Object.keys(answers).length} answered</span>
        </div>
        <div style={{ height: 3, borderRadius: 2, background: "rgba(255,255,255,0.07)", overflow: "hidden" }}>
          <motion.div animate={{ width: `${pct}%` }} transition={{ duration: 0.3, ease: EASE }}
            style={{ height: "100%", background: "rgba(196,154,60,0.7)", borderRadius: 2 }} />
        </div>
      </div>

      {/* Question */}
      <AnimatePresence mode="wait">
        <motion.div key={q.id}
          initial={{ opacity: 0, x: 18 }} animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -18 }} transition={{ duration: 0.2, ease: EASE }}
          style={{ flex: 1 }}
        >
          <p style={{
            fontSize: 10, fontWeight: 600, letterSpacing: "1.5px",
            textTransform: "uppercase",
            color: q.type === "written" ? "rgba(148,163,184,0.8)" : "rgba(196,154,60,0.8)",
            marginBottom: 12,
          }}>
            {q.type === "mcq" ? "Multiple Choice" : q.type === "truefalse" ? "True / False" : "Short Answer"}
          </p>
          <p style={{ fontSize: 16, fontWeight: 500, lineHeight: 1.55, color: "var(--text-primary)", marginBottom: 24 }}>
            {q.question}
          </p>

          {/* MCQ */}
          {q.type === "mcq" && q.options && (
            <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
              {q.options.map((opt, i) => {
                const chosen = current === i;
                return (
                  <motion.button key={i} whileHover={{ scale: 1.004 }} whileTap={{ scale: 0.997 }}
                    onClick={() => answer(i)}
                    style={{
                      display: "flex", alignItems: "center", gap: 12,
                      padding: "12px 14px", borderRadius: 12, textAlign: "left",
                      background: chosen ? "rgba(196,154,60,0.12)" : "rgba(255,255,255,0.04)",
                      border: `1.5px solid ${chosen ? "rgba(196,154,60,0.45)" : "rgba(255,255,255,0.08)"}`,
                      cursor: "pointer", fontFamily: "inherit", transition: "all 0.14s",
                    }}
                  >
                    <span style={{
                      width: 26, height: 26, borderRadius: "50%", flexShrink: 0,
                      background: chosen ? "rgba(196,154,60,0.2)" : "rgba(255,255,255,0.06)",
                      border: `1.5px solid ${chosen ? "rgba(196,154,60,0.6)" : "rgba(255,255,255,0.14)"}`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 11, fontWeight: 700,
                      color: chosen ? "#C49A3C" : "var(--text-dim)",
                    }}>{String.fromCharCode(65 + i)}</span>
                    <span style={{ fontSize: 14, color: chosen ? "var(--text-primary)" : "var(--text-secondary)", lineHeight: 1.5 }}>
                      {opt}
                    </span>
                  </motion.button>
                );
              })}
            </div>
          )}

          {/* T/F */}
          {q.type === "truefalse" && (
            <div style={{ display: "flex", gap: 12 }}>
              {(["true", "false"] as const).map(v => {
                const chosen = current === v;
                const isT = v === "true";
                return (
                  <motion.button key={v} whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                    onClick={() => answer(v)}
                    style={{
                      flex: 1, padding: "18px 0", borderRadius: 14,
                      background: chosen ? (isT ? "rgba(74,222,128,0.12)" : "rgba(248,113,113,0.12)") : "rgba(255,255,255,0.04)",
                      border: `1.5px solid ${chosen ? (isT ? "rgba(74,222,128,0.4)" : "rgba(248,113,113,0.4)") : "rgba(255,255,255,0.08)"}`,
                      color: chosen ? (isT ? "#4ade80" : "#f87171") : "var(--text-secondary)",
                      fontSize: 15, fontWeight: 600, cursor: "pointer",
                      fontFamily: "inherit", transition: "all 0.14s",
                    }}
                  ><span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>{isT ? <Check size={15} /> : <X size={15} />}{isT ? "True" : "False"}</span></motion.button>
                );
              })}
            </div>
          )}

          {/* Written */}
          {q.type === "written" && (
            <textarea value={(current as string) ?? ""}
              onChange={e => answer(e.target.value)}
              placeholder="Write your answer here…" rows={5}
              style={{
                width: "100%", boxSizing: "border-box",
                background: "rgba(255,255,255,0.05)",
                border: "1.5px solid rgba(255,255,255,0.1)",
                borderRadius: 12, padding: "13px 14px",
                color: "var(--text-primary)", fontSize: 14, lineHeight: 1.7,
                outline: "none", resize: "vertical", fontFamily: "inherit",
                transition: "border-color 0.15s",
              }}
              onFocus={e => (e.target.style.borderColor = "rgba(255,255,255,0.28)")}
              onBlur={e  => (e.target.style.borderColor = "rgba(255,255,255,0.1)")}
            />
          )}
        </motion.div>
      </AnimatePresence>

      {/* Nav */}
      <div style={{ display: "flex", gap: 10, marginTop: 28, alignItems: "center", flexShrink: 0 }}>
        {qIdx > 0 && (
          <button onClick={() => setQIdx(i => i - 1)} style={{
            padding: "12px 18px", borderRadius: 12,
            background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.09)",
            color: "var(--text-secondary)", fontSize: 14, fontWeight: 500,
            cursor: "pointer", fontFamily: "inherit",
          }}>←</button>
        )}
        <div style={{ flex: 1, display: "flex", gap: 4, justifyContent: "center" }}>
          {exam.questions.map((qq, i) => (
            <button key={qq.id} onClick={() => setQIdx(i)} style={{
              width: i === qIdx ? 18 : 7, height: 7, borderRadius: 4,
              background: answers[qq.id] !== undefined ? "rgba(196,154,60,0.7)"
                : i === qIdx ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.15)",
              border: "none", cursor: "pointer", transition: "all 0.2s",
              padding: 0,
            }} />
          ))}
        </div>
        {isLast ? (
          <button onClick={() => allAnswered && onSubmit(answers)} disabled={!allAnswered} style={{
            padding: "12px 20px", borderRadius: 12,
            background: allAnswered ? "rgba(196,154,60,0.14)" : "rgba(255,255,255,0.04)",
            border: `1px solid ${allAnswered ? "rgba(196,154,60,0.38)" : "rgba(255,255,255,0.07)"}`,
            color: allAnswered ? "#C49A3C" : "var(--text-tertiary)",
            fontSize: 14, fontWeight: 600,
            cursor: allAnswered ? "pointer" : "default",
            fontFamily: "inherit", transition: "all 0.15s", whiteSpace: "nowrap",
          }}>
            {allAnswered ? "Submit →" : `${Object.keys(answers).length}/${total}`}
          </button>
        ) : (
          <button onClick={() => setQIdx(i => i + 1)} style={{
            padding: "12px 18px", borderRadius: 12,
            background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.09)",
            color: "var(--text-secondary)", fontSize: 14, fontWeight: 500,
            cursor: "pointer", fontFamily: "inherit",
          }}>→</button>
        )}
      </div>
    </motion.div>
  );
}

// ── Exam Scorecard ────────────────────────────────────────────────────────

function ExamScorecard({ exam, attempt, onDone }: {
  exam: Exam; attempt: ExamAttempt; onDone: () => void;
}) {
  const score   = Math.round(attempt.score);
  const color   = scoreColor(score);
  const results = attempt.results ?? [];

  // Topic analysis
  const topicMap: Record<string, { ok: number; total: number }> = {};
  results.forEach(r => {
    const t = exam.questions.find(q => q.id === r.questionId)?.topic ?? "General";
    if (!topicMap[t]) topicMap[t] = { ok: 0, total: 0 };
    topicMap[t].total++;
    if (r.score >= 70) topicMap[t].ok++;
  });
  const strengths  = Object.entries(topicMap).filter(([, v]) => v.ok / v.total >= 0.75).map(([k]) => k);
  const weaknesses = Object.entries(topicMap).filter(([, v]) => v.ok / v.total < 0.5).map(([k]) => k);
  const toReview   = [
    ...weaknesses,
    ...Object.entries(topicMap).filter(([, v]) => v.ok / v.total >= 0.5 && v.ok / v.total < 0.75).map(([k]) => k),
  ].slice(0, 4);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={{ paddingBottom: 48 }}>
      {/* Score hero */}
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: EASE }}
        style={{ textAlign: "center", marginBottom: 28 }}
      >
        <ScoreRing score={score} color={color} />
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.7 }}
          style={{ fontSize: 22, fontWeight: 700, color, marginTop: 14, letterSpacing: "-0.3px" }}
        >{scoreLabel(score)}</motion.p>
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.85 }}
          style={{ fontSize: 13, color: "var(--text-dim)", marginTop: 4 }}
        >
          {results.filter(r => r.score >= 70).length} of {exam.questions.length} questions correct
        </motion.p>
      </motion.div>

      {/* Strength / weakness */}
      {(strengths.length + weaknesses.length > 0) && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.9, duration: 0.3, ease: EASE }}
          style={{
            padding: "14px 16px", borderRadius: 14, marginBottom: 16,
            background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)",
          }}
        >
          {strengths.length > 0 && (
            <div style={{ marginBottom: weaknesses.length ? 12 : 0 }}>
              <p style={{ fontSize: 10, color: "var(--text-dim)", marginBottom: 8, fontWeight: 600, letterSpacing: "0.8px" }}>
                STRONG ON
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {strengths.map(t => (
                  <span key={t} style={{
                    fontSize: 12, padding: "3px 10px", borderRadius: 20,
                    background: "rgba(74,222,128,0.1)", border: "1px solid rgba(74,222,128,0.25)",
                    color: "#4ade80",
                  }}>{t}</span>
                ))}
              </div>
            </div>
          )}
          {weaknesses.length > 0 && (
            <div>
              <p style={{ fontSize: 10, color: "var(--text-dim)", marginBottom: 8, fontWeight: 600, letterSpacing: "0.8px" }}>
                NEEDS REVIEW
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {weaknesses.map(t => (
                  <span key={t} style={{
                    fontSize: 12, padding: "3px 10px", borderRadius: 20,
                    background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.25)",
                    color: "#f87171",
                  }}>{t}</span>
                ))}
              </div>
            </div>
          )}
        </motion.div>
      )}

      {/* Review suggestions */}
      {toReview.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.05, duration: 0.3, ease: EASE }}
          style={{
            padding: "12px 16px", borderRadius: 14, marginBottom: 16,
            background: "rgba(196,154,60,0.06)", border: "1px solid rgba(196,154,60,0.15)",
          }}
        >
          <p style={{ fontSize: 12, color: "#C49A3C", fontWeight: 600, marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}><BookOpen size={14} />Suggested study areas</p>
          {toReview.map(t => (
            <p key={t} style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 3 }}>· {t}</p>
          ))}
        </motion.div>
      )}

      {/* Question breakdown */}
      <p style={{ fontSize: 10, color: "var(--text-dim)", fontWeight: 600, marginBottom: 12, letterSpacing: "0.8px" }}>
        QUESTION BREAKDOWN
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 28 }}>
        {exam.questions.map((q, i) => {
          const r = results.find(r => r.questionId === q.id);
          if (!r) return null;
          const bgMap   = { correct: "rgba(74,222,128,0.07)",   partial: "rgba(251,191,36,0.07)",  incorrect: "rgba(248,113,113,0.07)" };
          const bdMap   = { correct: "rgba(74,222,128,0.22)",   partial: "rgba(251,191,36,0.22)",  incorrect: "rgba(248,113,113,0.22)" };
          const chipMap = {
            correct:   { bg: "rgba(74,222,128,0.15)",  color: "#4ade80", label: "Correct"   },
            partial:   { bg: "rgba(251,191,36,0.15)",  color: "#fbbf24", label: "Partial"   },
            incorrect: { bg: "rgba(248,113,113,0.15)", color: "#f87171", label: "Incorrect" },
          };
          const chip = chipMap[r.verdict];
          const userAns = attempt.answers?.[q.id];
          const correctAns = q.type === "mcq" ? q.options?.[q.correctIndex!]
                           : q.type === "truefalse" ? (q.correct ? "True" : "False") : null;

          return (
            <motion.div key={q.id}
              initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 1.1 + i * 0.065, duration: 0.25, ease: EASE }}
              style={{
                padding: "13px 14px", borderRadius: 13,
                background: bgMap[r.verdict], border: `1px solid ${bdMap[r.verdict]}`,
              }}
            >
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, marginBottom: 8 }}>
                <p style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)", lineHeight: 1.5, flex: 1 }}>
                  <span style={{ color: "var(--text-dim)", marginRight: 5 }}>Q{i + 1}.</span>{q.question}
                </p>
                <span style={{
                  flexShrink: 0, fontSize: 11, fontWeight: 600,
                  padding: "3px 9px", borderRadius: 20,
                  background: chip.bg, color: chip.color,
                }}>{chip.label}</span>
              </div>
              {q.type !== "written" && (
                <p style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: r.feedback ? 8 : 0 }}>
                  Your answer: <span style={{ color: "var(--text-secondary)", fontWeight: 500 }}>
                    {q.type === "mcq" ? q.options?.[userAns as number] ?? "—" : String(userAns ?? "—")}
                  </span>
                  {r.verdict !== "correct" && correctAns && (
                    <> · Correct: <span style={{ color: "#4ade80", fontWeight: 500 }}>{correctAns}</span></>
                  )}
                </p>
              )}
              {q.type === "written" && userAns && (
                <p style={{ fontSize: 12, color: "var(--text-secondary)", fontStyle: "italic", marginBottom: r.feedback ? 8 : 0, lineHeight: 1.6 }}>
                  "{String(userAns).slice(0, 120)}{String(userAns).length > 120 ? "…" : ""}"
                </p>
              )}
              {r.feedback && (
                <p style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.6 }}>{r.feedback}</p>
              )}
            </motion.div>
          );
        })}
      </div>

      <motion.button initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.5 }}
        onClick={onDone}
        style={{
          width: "100%", padding: "14px", borderRadius: 14,
          background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)",
          color: "var(--text-secondary)", fontSize: 14, fontWeight: 600,
          cursor: "pointer", fontFamily: "inherit",
        }}
      >Done</motion.button>
    </motion.div>
  );
}

// ── SpaceExams orchestrator ────────────────────────────────────────────────

export default function SpaceExams({ spaceId, userId, docRefs, docFiles }: {
  spaceId: string; userId: string;
  docRefs: string[]; docFiles: Map<string, DocMaterial>;
}) {
  const [view,          setView]          = useState<View>("list");
  const [genStep,       setGenStep]       = useState(0);
  const [exams,         setExams]         = useState<Exam[]>([]);
  const [attempts,      setAttempts]      = useState<Map<string, ExamAttempt>>(new Map());
  const [activeExam,    setActiveExam]    = useState<Exam | null>(null);
  const [activeAttempt, setActiveAttempt] = useState<ExamAttempt | null>(null);
  const [error,         setError]         = useState("");
  const attemptIdRef = useRef<string>("");

  // Load exams + attempts
  useEffect(() => {
    supabase.from("exams")
      .select("*").eq("space_id", spaceId).eq("user_id", userId)
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        const list = (data ?? []) as Exam[];
        setExams(list);
        if (!list.length) return;
        supabase.from("exam_attempts")
          .select("*").eq("user_id", userId)
          .in("exam_id", list.map(e => e.id))
          .not("submitted_at", "is", null)
          .order("created_at", { ascending: false })
          .then(({ data: ats }) => {
            const m = new Map<string, ExamAttempt>();
            (ats ?? []).forEach(a => { if (!m.has(a.exam_id)) m.set(a.exam_id, a as ExamAttempt); });
            setAttempts(m);
          });
      });
  }, [spaceId, userId]);

  async function startAttempt(exam: Exam) {
    const id = crypto.randomUUID();
    attemptIdRef.current = id;
    await supabase.from("exam_attempts").insert({ id, exam_id: exam.id, user_id: userId, answers: {} });
    setView("taking");
  }

  const generateExam = useCallback(async (prefs: ExamPrefs) => {
    setError("");
    setGenStep(0);
    setView("creating");

    // Build question distribution
    const { questionCount: n, questionType: qt } = prefs;
    let mcqCount = 0, tfCount = 0, writtenCount = 0;
    if (qt === "both") {
      writtenCount = Math.max(1, Math.round(n * 0.3));
      tfCount      = Math.max(1, Math.round(n * 0.15));
      mcqCount     = n - writtenCount - tfCount;
    } else if (qt === "mcq") {
      tfCount  = Math.max(1, Math.round(n * 0.2));
      mcqCount = n - tfCount;
    } else {
      writtenCount = n;
    }

    // Build context
    const materials = docRefs.map(id => {
      const f = docFiles.get(id);
      if (!f) return "";
      const summary = sanitize(f.summary ?? "");
      const excerpt = sanitize(f.content_text?.slice(0, 1800) ?? "");
      return `Document: "${sanitize(f.name)}"\nSummary: ${summary}\n${excerpt}`;
    }).filter(Boolean).join("\n\n---\n\n");

    const parts: string[] = [];
    if (mcqCount > 0)      parts.push(`- ${mcqCount} multiple choice (4 options, correctIndex 0-3)`);
    if (tfCount > 0)       parts.push(`- ${tfCount} true/false (correct: true or false boolean)`);
    if (writtenCount > 0)  parts.push(`- ${writtenCount} short written answer`);

    const prompt = `Create a rigorous academic exam based on these study materials.

Generate exactly ${n} questions:
${parts.join("\n")}

STUDY MATERIALS:
${materials}

Return ONLY valid JSON (no markdown fences):
{
  "title": "Exam: [concise topic]",
  "questions": [
    {"id":"q1","type":"mcq","question":"...","options":["A","B","C","D"],"correctIndex":0,"topic":"...","explanation":"..."},
    {"id":"q6","type":"truefalse","question":"...","correct":true,"topic":"...","explanation":"..."},
    {"id":"q8","type":"written","question":"...","topic":"...","expectedKey":"key concepts"}
  ]
}`;

    // Start Claude call immediately, animate steps concurrently
    const claudePromise = callClaude(
      prompt,
      "You are an academic exam generator. Always return valid JSON only.",
      Math.max(3000, n * 300)
    );

    // Animate steps 0→1 while Claude works
    await wait(750);  setGenStep(1);
    await wait(900);  setGenStep(2); // "Generating questions" — waits for Claude

    let raw: string;
    try {
      raw = await claudePromise;
    } catch (e: any) {
      setError(e.message ?? "Generation failed. Try again.");
      setView("list");
      return;
    }

    setGenStep(3); await wait(520);
    setGenStep(4); await wait(680);

    const data = parseJSON<{ title: string; questions: ExamQuestion[] }>(raw);
    if (!data?.questions?.length) {
      setError("Couldn't parse exam — please try again.");
      setView("list");
      return;
    }

    const { data: saved } = await supabase.from("exams").insert({
      space_id: spaceId, user_id: userId,
      title: data.title ?? "Practice Exam",
      questions: data.questions,
    }).select().single();

    if (!saved) { setError("Failed to save exam."); setView("list"); return; }

    const newExam = saved as Exam;
    setExams(prev => [newExam, ...prev]);
    supabase.from("space_items").insert({
      space_id: spaceId, user_id: userId,
      item_type: "exam", item_ref: newExam.id, title: newExam.title,
    }).then();

    setActiveExam(newExam);
    await startAttempt(newExam);
  }, [docRefs, docFiles, spaceId, userId]);

  const submitExam = useCallback(async (answers: Record<string, string | number>) => {
    if (!activeExam) return;
    setView("grading");

    const results: QuestionResult[] = [];

    // Auto-grade MCQ + T/F
    activeExam.questions.filter(q => q.type !== "written").forEach(q => {
      const userAns = answers[q.id];
      const correct = q.type === "mcq"
        ? userAns === q.correctIndex
        : String(userAns) === String(q.correct);
      results.push({
        questionId: q.id, score: correct ? 100 : 0,
        verdict: correct ? "correct" : "incorrect",
        feedback: q.explanation ?? (correct ? "Correct!" :
          `Correct answer: ${q.type === "mcq" ? q.options?.[q.correctIndex!] : (q.correct ? "True" : "False")}.`),
      });
    });

    // AI-grade written in parallel
    await Promise.all(
      activeExam.questions.filter(q => q.type === "written").map(async q => {
        const ans = String(answers[q.id] ?? "").trim();
        if (!ans) { results.push({ questionId: q.id, score: 0, verdict: "incorrect", feedback: "No answer provided." }); return; }
        try {
          const raw = await callClaude(
            `Grade this student's answer.\n\nQuestion: ${q.question}\nExpected concepts: ${q.expectedKey ?? "relevant content"}\nStudent's answer: ${ans}\n\nReturn ONLY valid JSON:\n{"score":<0-100>,"verdict":"<correct|partial|incorrect>","feedback":"<1-2 sentence feedback>"}`,
            "You are an academic grader. Return only valid JSON.", 250
          );
          const d = parseJSON<{ score: number; verdict: string; feedback: string }>(raw);
          results.push({
            questionId: q.id,
            score: d ? Math.max(0, Math.min(100, d.score)) : 50,
            verdict: (d?.verdict === "correct" || d?.verdict === "partial" || d?.verdict === "incorrect") ? d.verdict : "partial",
            feedback: d?.feedback ?? "",
          });
        } catch {
          results.push({ questionId: q.id, score: 50, verdict: "partial", feedback: "Grading unavailable." });
        }
      })
    );

    const overallScore = results.reduce((s, r) => s + r.score, 0) / results.length;
    const now = new Date().toISOString();
    const attemptId = attemptIdRef.current;

    await supabase.from("exam_attempts").update({
      answers, results, score: overallScore, submitted_at: now,
    }).eq("id", attemptId);

    const finalAttempt: ExamAttempt = {
      id: attemptId, exam_id: activeExam.id, user_id: userId,
      answers, results, score: overallScore, submitted_at: now, created_at: now,
    };
    setActiveAttempt(finalAttempt);
    setAttempts(prev => new Map(prev).set(activeExam.id, finalAttempt));
    setView("scorecard");
  }, [activeExam, userId]);

  // ── Render ────────────────────────────────────────────────────────────

  const BackBtn = ({ onClick }: { onClick: () => void }) => (
    <button onClick={onClick} style={{
      width: 30, height: 30, borderRadius: "50%",
      background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.09)",
      color: "var(--text-secondary)", cursor: "pointer",
      display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
    }}>
      <svg width="7" height="11" viewBox="0 0 7 11" fill="none">
        <path d="M6 1L1 5.5L6 10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </button>
  );

  return (
    <AnimatePresence mode="wait">

      {/* LIST */}
      {view === "list" && (
        <motion.div key="list" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
            <p style={{ fontSize: 13, color: "var(--text-dim)" }}>
              {exams.length === 0 ? "No exams yet" : `${exams.length} exam${exams.length !== 1 ? "s" : ""}`}
            </p>
            <button
              onClick={() => { if (docRefs.length) setView("prefs"); }}
              disabled={!docRefs.length}
              style={{
                display: "flex", alignItems: "center", gap: 5,
                padding: "8px 14px", borderRadius: "var(--radius-pill)",
                background: docRefs.length ? "rgba(196,154,60,0.12)" : "rgba(255,255,255,0.04)",
                border: `1px solid ${docRefs.length ? "rgba(196,154,60,0.3)" : "rgba(255,255,255,0.07)"}`,
                color: docRefs.length ? "#C49A3C" : "var(--text-tertiary)",
                fontSize: 13, fontWeight: 600,
                cursor: docRefs.length ? "pointer" : "default",
                fontFamily: "inherit", transition: "all 0.14s",
              }}
            ><span style={{ fontSize: 16 }}>+</span> Create Exam</button>
          </div>
          {error && (
            <p style={{ fontSize: 12, color: "#f87171", marginBottom: 14,
              padding: "8px 12px", background: "rgba(248,113,113,0.1)", borderRadius: 8 }}>{error}</p>
          )}
          {exams.length === 0 ? (
            <div style={{ textAlign: "center", padding: "40px 20px" }}>
              <div style={{ marginBottom: 14, opacity: 0.35, display: "flex", justifyContent: "center" }}><PenLine size={32} /></div>
              <p style={{ fontSize: 14, color: "var(--text-secondary)", fontWeight: 500, marginBottom: 5 }}>No exams yet</p>
              <p style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.6 }}>
                {docRefs.length ? "Generate a practice exam from your space documents." : "Add documents first, then create an exam."}
              </p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <AnimatePresence>
                {exams.map(e => (
                  <ExamCard key={e.id} exam={e} attempt={attempts.get(e.id) ?? null}
                    onTake={() => { setActiveExam(e); startAttempt(e); }}
                    onViewResults={() => {
                      const at = attempts.get(e.id);
                      if (at) { setActiveExam(e); setActiveAttempt(at); setView("scorecard"); }
                    }}
                  />
                ))}
              </AnimatePresence>
            </div>
          )}
        </motion.div>
      )}

      {/* PREFERENCES */}
      {view === "prefs" && (
        <motion.div key="prefs" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
          <ExamPreferences
            docCount={docRefs.length}
            onBack={() => setView("list")}
            onContinue={generateExam}
          />
        </motion.div>
      )}

      {/* CREATING */}
      {view === "creating" && (
        <motion.div key="creating" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
          <AnimatedGenerationSteps step={genStep} />
        </motion.div>
      )}

      {/* TAKING */}
      {view === "taking" && activeExam && (
        <motion.div key="taking" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 22 }}>
            <BackBtn onClick={() => setView("list")} />
            <p style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {activeExam.title}
            </p>
          </div>
          <ExamSession exam={activeExam} userId={userId} attemptId={attemptIdRef.current} onSubmit={submitExam} />
        </motion.div>
      )}

      {/* GRADING */}
      {view === "grading" && activeExam && (
        <motion.div key="grading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "60px 24px" }}
        >
          <motion.div animate={{ rotate: 360 }} transition={{ duration: 1.1, repeat: Infinity, ease: "linear" }}
            style={{ width: 52, height: 52, borderRadius: "50%",
              border: "2px solid rgba(255,255,255,0.08)", borderTopColor: "#C49A3C", marginBottom: 24 }}
          />
          <p style={{ fontSize: 16, fontWeight: 600, color: "var(--text-primary)", marginBottom: 8 }}>Grading your exam…</p>
          <p style={{ fontSize: 13, color: "var(--text-dim)", textAlign: "center", lineHeight: 1.6 }}>
            {activeExam.questions.filter(q => q.type === "written").length > 0
              ? `AI is reviewing your written answers`
              : "Calculating your score"}
          </p>
        </motion.div>
      )}

      {/* SCORECARD */}
      {view === "scorecard" && activeExam && activeAttempt?.submitted_at && (
        <motion.div key="scorecard" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 24 }}>
            <BackBtn onClick={() => setView("list")} />
            <p style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>{activeExam.title}</p>
          </div>
          <ExamScorecard exam={activeExam} attempt={activeAttempt} onDone={() => setView("list")} />
        </motion.div>
      )}

    </AnimatePresence>
  );
}

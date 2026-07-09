// DocQuiz.tsx — YouLearn Phase 2: interactive multiple-choice quiz.
// Receives parsed quiz data, shows one question at a time, tracks score.
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, X } from "lucide-react";

export interface QuizQuestion {
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

interface Props {
  questions: QuizQuestion[];
  onDone: () => void;
}

export default function DocQuiz({ questions, onDone }: Props) {
  const [idx,      setIdx]      = useState(0);
  const [picked,   setPicked]   = useState<number | null>(null);
  const [score,    setScore]    = useState(0);
  const [finished, setFinished] = useState(false);

  const q = questions[idx];
  const answered = picked !== null;

  function choose(i: number) {
    if (answered) return;
    setPicked(i);
    if (i === q.correctIndex) setScore(s => s + 1);
  }

  function next() {
    if (idx + 1 >= questions.length) {
      setFinished(true);
    } else {
      setIdx(i => i + 1);
      setPicked(null);
    }
  }

  if (finished) {
    const pct = Math.round((score / questions.length) * 100);
    return (
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        style={{ padding: "8px 0" }}
      >
        {/* Score card */}
        <div style={{
          textAlign: "center", padding: "28px 20px",
          background: "rgba(255,255,255,0.03)",
          border: "1px solid rgba(255,255,255,0.07)",
          borderRadius: "14px", marginBottom: "16px",
        }}>
          <p style={{ fontSize: "32px", fontWeight: "700", color: pct >= 70 ? "#7fae6e" : "#d47878", margin: "0 0 4px", letterSpacing: "-1px" }}>
            {score}/{questions.length}
          </p>
          <p style={{ fontSize: "14px", color: "rgba(255,255,255,0.55)", margin: "0 0 12px" }}>
            {pct}% correct
          </p>
          <p style={{ fontSize: "13px", color: pct >= 70 ? "#7fae6e" : "rgba(255,255,255,0.4)", margin: 0 }}>
            {pct >= 90 ? "Excellent!" : pct >= 70 ? "Good work!" : pct >= 50 ? "Keep studying" : "Review this section"}
          </p>
        </div>

        <button onClick={onDone} style={{
          width: "100%", padding: "11px", borderRadius: "10px",
          background: "rgba(196,154,60,0.14)", color: "#C49A3C",
          border: "1px solid rgba(196,154,60,0.3)",
          fontSize: "13px", fontWeight: "600", cursor: "pointer",
          fontFamily: "inherit",
        }}>
          Back to chat
        </button>
      </motion.div>
    );
  }

  return (
    <div style={{ padding: "4px 0" }}>
      {/* Progress */}
      <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "16px" }}>
        <div style={{ flex: 1, height: 3, borderRadius: 2, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
          <motion.div
            animate={{ width: `${((idx) / questions.length) * 100}%` }}
            transition={{ duration: 0.3 }}
            style={{ height: "100%", background: "#C49A3C", borderRadius: 2 }}
          />
        </div>
        <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.35)", flexShrink: 0 }}>
          {idx + 1}/{questions.length}
        </span>
      </div>

      {/* Question */}
      <AnimatePresence mode="wait">
        <motion.div
          key={idx}
          initial={{ opacity: 0, x: 12 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{    opacity: 0, x: -12 }}
          transition={{ duration: 0.18 }}
        >
          <p style={{
            fontSize: "14px", fontWeight: "600", lineHeight: "1.5",
            color: "rgba(245,245,245,0.92)", marginBottom: "16px",
          }}>
            {q.question}
          </p>

          {/* Options */}
          <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "14px" }}>
            {q.options.map((opt, i) => {
              const isCorrect = i === q.correctIndex;
              const isPicked  = i === picked;
              let bg = "rgba(255,255,255,0.04)";
              let border = "rgba(255,255,255,0.08)";
              let color  = "rgba(245,245,245,0.75)";
              if (answered) {
                if (isCorrect)            { bg = "rgba(127,174,110,0.14)"; border = "rgba(127,174,110,0.4)"; color = "#7fae6e"; }
                else if (isPicked)        { bg = "rgba(212,120,120,0.12)"; border = "rgba(212,120,120,0.35)"; color = "#d47878"; }
              }

              return (
                <motion.button
                  key={i}
                  whileHover={!answered ? { scale: 1.01 } : {}}
                  onClick={() => choose(i)}
                  style={{
                    display: "flex", alignItems: "flex-start", gap: "10px",
                    background: bg, border: `1px solid ${border}`,
                    borderRadius: "10px", padding: "10px 13px",
                    cursor: answered ? "default" : "pointer",
                    fontFamily: "inherit", textAlign: "left",
                    transition: "background 0.15s, border-color 0.15s",
                  }}
                >
                  <span style={{
                    width: 22, height: 22, borderRadius: "50%", flexShrink: 0,
                    border: `1.5px solid ${answered && isCorrect ? "#7fae6e" : answered && isPicked ? "#d47878" : "rgba(255,255,255,0.2)"}`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: "11px", fontWeight: "700",
                    color: answered && isCorrect ? "#7fae6e" : answered && isPicked ? "#d47878" : "rgba(255,255,255,0.4)",
                    background: answered && isCorrect ? "rgba(127,174,110,0.15)" : answered && isPicked ? "rgba(212,120,120,0.12)" : "transparent",
                  }}>
                    {answered && isCorrect ? <Check size={13} /> : answered && isPicked ? <X size={13} /> : String.fromCharCode(65 + i)}
                  </span>
                  <span style={{ fontSize: "13px", lineHeight: "1.5", color }}>{opt}</span>
                </motion.button>
              );
            })}
          </div>

          {/* Explanation */}
          {answered && q.explanation && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              style={{
                padding: "10px 13px",
                background: "rgba(196,154,60,0.07)",
                border: "1px solid rgba(196,154,60,0.18)",
                borderRadius: "9px", marginBottom: "14px",
              }}
            >
              <p style={{ fontSize: "12px", lineHeight: "1.6", color: "rgba(245,245,245,0.72)", margin: 0 }}>
                <strong style={{ color: "#C49A3C", fontWeight: "600" }}>Why: </strong>
                {q.explanation}
              </p>
            </motion.div>
          )}

          {/* Next button */}
          {answered && (
            <motion.button
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              onClick={next}
              style={{
                width: "100%", padding: "10px", borderRadius: "10px",
                background: "rgba(196,154,60,0.14)", color: "#C49A3C",
                border: "1px solid rgba(196,154,60,0.3)",
                fontSize: "13px", fontWeight: "600", cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              {idx + 1 >= questions.length ? "See results" : "Next →"}
            </motion.button>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

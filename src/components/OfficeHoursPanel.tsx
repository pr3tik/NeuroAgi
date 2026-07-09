// OfficeHoursPanel.tsx — Embeddable panel for the Assignment page (Phase 1
// placement per FEATURE_PLAN_DIGEST_OFFICEHOURS.md: Option B). Pre-session:
// generates 5-7 gap-grounded questions via api/office-hours.ts?action=prep.
// Post-session: captures what was clarified via ?action=capture, which
// updates tutor_mind so the next tutor chat reflects the resolved gap.

import { useState } from "react";
import { MessageCircleQuestion, Copy, Check } from "lucide-react";

interface Question {
  id: string;
  gap: string;
  question: string;
  priority: "high" | "medium";
  linked_assignment?: string | null;
}

interface Props {
  userId: string;
  courseId: string;
  courseName: string;
}

export default function OfficeHoursPanel({ userId, courseId, courseName }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [asked, setAsked] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [notes, setNotes] = useState("");
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/office-hours?action=prep", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, courseId, courseName }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.questions) throw new Error(data.error || "Couldn't generate questions.");
      setQuestions(data.questions);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  function toggleAsked(id: string) {
    setAsked(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  function copyAll() {
    if (!questions) return;
    const text = questions.map((q, i) => `${i + 1}. ${q.question}`).join("\n\n");
    navigator.clipboard?.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
  }

  async function saveCapture() {
    if (!notes.trim()) return;
    setCapturing(true);
    setSavedMsg(null);
    try {
      const res = await fetch("/api/office-hours?action=capture", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, courseId, sessionNotes: notes.trim(), questionIds: [...asked] }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || "Couldn't save.");
      setSavedMsg("Saved — the tutor now knows this was clarified.");
      setNotes("");
    } catch (e: any) {
      setSavedMsg(e?.message || String(e));
    } finally {
      setCapturing(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => { setOpen(true); if (!questions) generate(); }}
        style={{
          display: "flex", alignItems: "center", gap: "8px", width: "100%",
          background: "rgba(190,130,255,0.08)", border: "1px solid rgba(190,130,255,0.2)",
          borderRadius: "10px", padding: "12px 14px", color: "rgba(190,130,255,0.85)",
          fontSize: "13px", fontWeight: 500, cursor: "pointer", fontFamily: "inherit", marginBottom: "16px",
        }}
      >
        <MessageCircleQuestion size={15} />
        Prep for Office Hours
      </button>
    );
  }

  return (
    <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-card)", padding: "16px", marginBottom: "16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
        <p style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-primary)", margin: 0 }}>Office Hours Prep</p>
        <button onClick={() => setOpen(false)} style={{ background: "none", border: "none", color: "var(--text-dim)", fontSize: "16px", cursor: "pointer", padding: 0 }}>×</button>
      </div>

      {loading && <p style={{ fontSize: "12px", color: "var(--text-dim)" }}>Generating questions from what you don't understand yet…</p>}
      {error && <p style={{ fontSize: "12px", color: "#ff6961" }}>{error}</p>}

      {questions && questions.length > 0 && !capturing && savedMsg === null && (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "12px" }}>
            {questions.map(q => (
              <label key={q.id} style={{ display: "flex", gap: "10px", alignItems: "flex-start", cursor: "pointer" }}>
                <input type="checkbox" checked={asked.has(q.id)} onChange={() => toggleAsked(q.id)} style={{ marginTop: "3px" }} />
                <div>
                  <span style={{
                    fontSize: "9px", fontWeight: 700, letterSpacing: "0.5px", textTransform: "uppercase",
                    color: q.priority === "high" ? "rgba(255,120,120,0.8)" : "rgba(255,200,100,0.8)",
                  }}>{q.priority}</span>
                  <p style={{ fontSize: "13px", color: "var(--text-primary)", margin: "3px 0 2px", lineHeight: 1.5 }}>{q.question}</p>
                  <p style={{ fontSize: "11px", color: "var(--text-dim)", margin: 0 }}>Gap: {q.gap}</p>
                </div>
              </label>
            ))}
          </div>
          <div style={{ display: "flex", gap: "8px" }}>
            <button onClick={copyAll} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", padding: "10px", color: "var(--text-secondary)", fontSize: "12px", cursor: "pointer", fontFamily: "inherit" }}>
              {copied ? <Check size={13} /> : <Copy size={13} />}{copied ? "Copied" : "Copy all"}
            </button>
            <button onClick={() => setSavedMsg("")} style={{ flex: 1, background: "rgba(0,210,190,0.1)", border: "1px solid rgba(0,210,190,0.2)", borderRadius: "8px", padding: "10px", color: "rgba(0,210,190,0.85)", fontSize: "12px", cursor: "pointer", fontFamily: "inherit" }}>
              I'm done — capture what I learned
            </button>
          </div>
        </>
      )}

      {savedMsg === "" && (
        <>
          <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "8px" }}>What did you learn? ({asked.size} question{asked.size !== 1 ? "s" : ""} asked)</p>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Tell me what was clarified…"
            style={{ width: "100%", minHeight: "80px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "8px", padding: "10px 12px", color: "var(--text-primary)", fontSize: "12px", fontFamily: "inherit", outline: "none", resize: "vertical", boxSizing: "border-box", marginBottom: "8px" }}
          />
          <button onClick={saveCapture} disabled={!notes.trim() || capturing} style={{ width: "100%", background: "rgba(0,210,190,0.1)", border: "1px solid rgba(0,210,190,0.2)", borderRadius: "8px", padding: "10px", color: "rgba(0,210,190,0.85)", fontSize: "12px", cursor: notes.trim() ? "pointer" : "default", fontFamily: "inherit", opacity: capturing ? 0.6 : 1 }}>
            {capturing ? "Saving…" : "Save & Close"}
          </button>
        </>
      )}

      {savedMsg && savedMsg !== "" && (
        <p style={{ fontSize: "12px", color: savedMsg.startsWith("Saved") ? "rgba(0,210,190,0.85)" : "#ff6961" }}>{savedMsg}</p>
      )}
    </div>
  );
}

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { reviewSession, decideProposal, type ReviewResponse, type QuizQuestion, type BrainProposal } from "../api/roomSession";
import { jobsPending } from "../lib/sessionReview";

// Post-session recap: group summary + notes, the caller's own 5-question quiz, and any brain-update
// proposals to accept/dismiss. Summary/quiz/proposals are produced asynchronously by the jobs
// worker, so this polls the review endpoint (bounded by a timeout) while jobs are still running.

const POLL_MS = 3000;
const POLL_TIMEOUT_MS = 60_000;

const overlay: CSSProperties = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 90, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 };
const sheet: CSSProperties = { width: 560, maxWidth: "100%", maxHeight: "88vh", overflowY: "auto", background: "var(--card, #16151c)", border: "1px solid rgba(var(--teal-rgb),0.25)", borderRadius: 16, boxShadow: "0 18px 60px rgba(0,0,0,0.5)", color: "var(--text, #ECEBF0)" };
const section: CSSProperties = { padding: "14px 18px", borderTop: "1px solid rgba(255,255,255,0.07)" };
const h: CSSProperties = { fontSize: 13, fontWeight: 700, color: "var(--text-primary)", margin: "0 0 8px" };

function QuizCard({ q, i }: { q: QuizQuestion; i: number }) {
  const [show, setShow] = useState(false);
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>{i + 1}. {q.question}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {q.options.map((o, j) => {
          const right = show && j === q.correctIndex;
          return (
            <div key={j} style={{ fontSize: 12.5, padding: "5px 9px", borderRadius: 8, background: right ? "rgba(94,234,212,0.14)" : "rgba(255,255,255,0.04)", border: right ? "1px solid rgba(94,234,212,0.4)" : "1px solid transparent", color: right ? "#a7f3d0" : "var(--text-secondary)" }}>
              {String.fromCharCode(65 + j)}. {o}
            </div>
          );
        })}
      </div>
      <button onClick={() => setShow(s => !s)} style={{ marginTop: 6, background: "none", border: "none", color: "rgb(var(--teal-rgb))", fontSize: 11.5, cursor: "pointer", padding: 0, fontFamily: "inherit" }}>{show ? "Hide answer" : "Show answer"}</button>
      {show && <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 4, lineHeight: 1.5 }}>{q.rationale}</div>}
    </div>
  );
}

export default function SessionReview({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const [data, setData] = useState<ReviewResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const startedRef = useRef(Date.now());
  const timerRef = useRef<any>(null);

  async function load() {
    try {
      const d = await reviewSession(sessionId);
      setData(d);
      setErr(null);
      if (jobsPending(d.jobs) && Date.now() - startedRef.current < POLL_TIMEOUT_MS) {
        timerRef.current = setTimeout(load, POLL_MS);
      }
    } catch (e) {
      setErr((e as Error)?.message || "Couldn't load the recap.");
    }
  }

  useEffect(() => {
    load();
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  async function decide(p: BrainProposal, decision: "accept" | "reject") {
    setBusyId(p.id);
    try { await decideProposal(p.id, decision); await load(); }
    catch (e) { setErr((e as Error)?.message || "Couldn't apply that."); }
    finally { setBusyId(null); }
  }

  const g = data?.groupSummary;
  const pending = jobsPending(data?.jobs) && Date.now() - startedRef.current < POLL_TIMEOUT_MS;
  const proposals = (data?.myProposals ?? []).filter(p => p.status === "pending");
  const hasQuiz = Array.isArray(data?.myQuiz) && (data!.myQuiz!.length > 0);

  return (
    <div style={overlay} onClick={onClose} role="dialog" aria-modal aria-label="Session recap">
      <div style={sheet} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "15px 18px" }}>
          <span style={{ fontSize: 16 }} aria-hidden>📋</span>
          <span style={{ fontWeight: 700, fontSize: 15, color: "var(--text-primary)" }}>Session recap</span>
          {pending && <span style={{ fontSize: 11.5, color: "var(--text-dim)" }}>· generating…</span>}
          <button onClick={onClose} aria-label="Close" style={{ marginLeft: "auto", background: "none", border: "none", color: "var(--text-dim)", cursor: "pointer", fontSize: 15 }}>✕</button>
        </div>

        {err && <div style={{ ...section, color: "#fca5a5" }}>{err}</div>}
        {!data && !err && <div style={section}>Loading…</div>}

        {g && (
          <div style={section}>
            <p style={h}>What you covered</p>
            {Array.isArray(g.objectives) && g.objectives.length > 0 && (
              <ul style={{ margin: "0 0 8px", paddingLeft: 18, fontSize: 12.5, lineHeight: 1.6 }}>
                {g.objectives.map((o: string, i: number) => <li key={i}>{o}</li>)}
              </ul>
            )}
            {Array.isArray(g.concepts) && g.concepts.length > 0 && (
              <div style={{ marginBottom: 8 }}>
                {g.concepts.map((c: any, i: number) => (
                  <div key={i} style={{ fontSize: 12.5, marginBottom: 4, lineHeight: 1.5 }}><b>{c.name}</b>{c.explanation ? ` — ${c.explanation}` : ""}</div>
                ))}
              </div>
            )}
            {Array.isArray(g.unresolved) && g.unresolved.length > 0 && (
              <>
                <p style={{ ...h, marginTop: 6 }}>Still open</p>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, lineHeight: 1.6, color: "var(--text-secondary)" }}>
                  {g.unresolved.map((u: string, i: number) => <li key={i}>{u}</li>)}
                </ul>
              </>
            )}
            {Array.isArray(g.citations) && g.citations.length > 0 && (
              <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 8 }}>Sources: {g.citations.join(" · ")}</div>
            )}
          </div>
        )}

        {hasQuiz && (
          <div style={section}>
            <p style={h}>Check your understanding</p>
            {data!.myQuiz!.map((q, i) => <QuizCard key={i} q={q} i={i} />)}
          </div>
        )}

        {proposals.length > 0 && (
          <div style={section}>
            <p style={h}>Update your study brain?</p>
            {proposals.map(p => (
              <div key={p.id} style={{ marginBottom: 10, padding: 10, borderRadius: 10, background: "rgba(255,255,255,0.04)" }}>
                <div style={{ fontSize: 12.5, lineHeight: 1.5 }}>{p.evidence || "Reggie noticed something worth remembering."}</div>
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <button disabled={busyId === p.id} onClick={() => decide(p, "accept")} style={{ background: "rgba(94,234,212,0.18)", border: "1px solid rgba(94,234,212,0.4)", borderRadius: 8, padding: "5px 12px", fontSize: 12, fontWeight: 600, color: "#a7f3d0", cursor: "pointer", fontFamily: "inherit", opacity: busyId === p.id ? 0.5 : 1 }}>Accept</button>
                  <button disabled={busyId === p.id} onClick={() => decide(p, "reject")} style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8, padding: "5px 12px", fontSize: 12, color: "var(--text-secondary)", cursor: "pointer", fontFamily: "inherit", opacity: busyId === p.id ? 0.5 : 1 }}>Dismiss</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {data && !pending && !g && !hasQuiz && proposals.length === 0 && (
          <div style={section}>This session was too short to generate a recap.</div>
        )}

        <div style={{ padding: "12px 18px", display: "flex", justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ background: "rgba(var(--teal-rgb),0.18)", border: "1px solid rgba(var(--teal-rgb),0.4)", borderRadius: 9, padding: "7px 16px", fontSize: 13, fontWeight: 600, color: "#DCE3FF", cursor: "pointer", fontFamily: "inherit" }}>Done</button>
        </div>
      </div>
    </div>
  );
}

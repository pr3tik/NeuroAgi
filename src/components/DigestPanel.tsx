// DigestPanel.tsx — Renders one lecture digest: summary, key points (with
// timestamps), emphasis markers, glossary, and quiz questions. Consumes the
// shape returned by api/digest-lecture.ts (lecture_digests row).

function formatTimestamp(seconds: number | null | undefined): string {
  if (seconds == null) return "";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: "20px" }}>
      <p style={{ fontSize: "10px", color: "var(--text-dim)", letterSpacing: "1.5px", textTransform: "uppercase", marginBottom: "10px" }}>{title}</p>
      {children}
    </div>
  );
}

interface KeyPoint { timestamp_seconds?: number; heading: string; body: string }
interface GlossaryTerm { term: string; definition: string }
interface EmphasisMoment { timestamp_seconds?: number; quote: string; reason: string; importance?: number }
interface QuizQuestion { question: string; type: string; options?: string[] | null; answer: string }

export interface Digest {
  id?: string;
  title?: string;
  summary?: string | null;
  keyPoints?: KeyPoint[] | null;
  key_points?: KeyPoint[] | null;
  glossary?: GlossaryTerm[] | null;
  emphasis?: EmphasisMoment[] | null;
  quizQuestions?: QuizQuestion[] | null;
  quiz_questions?: QuizQuestion[] | null;
}

export default function DigestPanel({ digest }: { digest: Digest }) {
  const keyPoints = digest.keyPoints ?? digest.key_points ?? [];
  const quizQuestions = digest.quizQuestions ?? digest.quiz_questions ?? [];
  const glossary = digest.glossary ?? [];
  const emphasis = digest.emphasis ?? [];

  return (
    <div style={{ padding: "4px 2px" }}>
      {digest.summary && (
        <Section title="Summary">
          <p style={{ fontSize: "13px", lineHeight: 1.7, color: "var(--text-secondary)", whiteSpace: "pre-wrap" }}>{digest.summary}</p>
        </Section>
      )}

      {keyPoints.length > 0 && (
        <Section title="Key points">
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {keyPoints.map((kp, i) => (
              <div key={i} style={{ background: "rgba(255,255,255,0.03)", borderRadius: "8px", padding: "10px 12px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "3px" }}>
                  {kp.timestamp_seconds != null && (
                    <span style={{ fontSize: "10px", color: "rgba(0,210,190,0.8)", fontWeight: 600 }}>{formatTimestamp(kp.timestamp_seconds)}</span>
                  )}
                  <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-primary)" }}>{kp.heading}</span>
                </div>
                <p style={{ fontSize: "12px", color: "var(--text-secondary)", lineHeight: 1.55, margin: 0 }}>{kp.body}</p>
              </div>
            ))}
          </div>
        </Section>
      )}

      {emphasis.length > 0 && (
        <Section title="What the professor emphasized">
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {emphasis.map((e, i) => (
              <div key={i} style={{ display: "flex", gap: "8px", alignItems: "flex-start" }}>
                {e.timestamp_seconds != null && (
                  <span style={{ fontSize: "10px", color: "rgba(190,130,255,0.8)", fontWeight: 600, flexShrink: 0, paddingTop: "2px" }}>{formatTimestamp(e.timestamp_seconds)}</span>
                )}
                <div>
                  <p style={{ fontSize: "12px", color: "var(--text-secondary)", margin: 0, fontStyle: "italic" }}>&ldquo;{e.quote}&rdquo;</p>
                  <p style={{ fontSize: "11px", color: "var(--text-dim)", margin: "2px 0 0" }}>{e.reason}</p>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {glossary.length > 0 && (
        <Section title="Glossary">
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {glossary.map((g, i) => (
              <div key={i}>
                <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-primary)" }}>{g.term}</span>
                <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}> — {g.definition}</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {quizQuestions.length > 0 && (
        <Section title="Quiz yourself">
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {quizQuestions.map((q, i) => (
              <details key={i} style={{ background: "rgba(255,255,255,0.03)", borderRadius: "8px", padding: "10px 12px" }}>
                <summary style={{ fontSize: "12px", color: "var(--text-primary)", cursor: "pointer" }}>{i + 1}. {q.question}</summary>
                {q.options && q.options.length > 0 && (
                  <ul style={{ margin: "8px 0 0", paddingLeft: "18px" }}>
                    {q.options.map((o, oi) => <li key={oi} style={{ fontSize: "12px", color: "var(--text-secondary)" }}>{o}</li>)}
                  </ul>
                )}
                <p style={{ fontSize: "12px", color: "rgba(0,210,190,0.85)", marginTop: "8px", marginBottom: 0 }}>Answer: {q.answer}</p>
              </details>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

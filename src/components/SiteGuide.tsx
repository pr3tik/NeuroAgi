// SiteGuide.tsx — lightweight, data-free navigation/FAQ helper.
//
// Deliberately separate from NeuralRing: this widget has NO Supabase reads, no
// RAG, no Brain DB, no userId dependency — it only knows the static product
// description below. That's what makes it safe to show to logged-out visitors
// on the landing page. Personal academic tutoring lives in NeuralRing (in-app)
// and StudyAssistant (the student's main tutor) — this component never touches either.
//
// Routed through task:"cheap" (Groq via api/_gateway.ts) — FAQ-style answers
// don't need a frontier model, and this runs for anonymous, unauthenticated
// traffic where cost matters more than it does for the in-app tutor.
import { useState, useRef, useEffect } from "react";
import { MessageCircle, X } from "lucide-react";
import { sanitizeApiMessages } from "../lib/chatMessages";

type Msg = { role: "user" | "assistant"; content: string };

const SYSTEM_PROMPT = `You are "Site Guide", a friendly assistant that helps visitors understand FSchoolAI and navigate this website. You do NOT have access to any student's personal data, grades, or courses — you only answer general questions about the product and site.

WHAT FSCHOOLAI IS:
FSchoolAI is an AI-powered academic platform that syncs with a student's Canvas LMS, organizes their courses and assignments, and gives them a personal AI tutor that understands their actual class material — all in one mobile-first space. Core features: Canvas sync (courses/assignments/deadlines, read-only), an AI study guide and flashcards, an assignment tracker and GPA view, Study Rooms (collaborative study sessions with a private AI assistant, shared whiteboard, and voice), and a leaderboard/identity card.

PRICING:
Joining the beta gives a full 1-month free subscription. After the beta, the core experience (Canvas sync, AI study guide, flashcards, assignment tracker, basic AI tutor) stays free. A Pro tier adds in-class recording/transcription, priority AI, a smart study planner, and Study Rooms.

CANVAS SYNC:
Students paste their school's Canvas URL and a personal read-only API token (generated in Canvas Account Settings). FSchoolAI reads courses, assignments, and deadlines — it never writes to Canvas, and the token is stored only on the student's device. Works with any school using Canvas LMS; Blackboard/D2L support is on the roadmap.

ACADEMIC INTEGRITY:
FSchoolAI is a study tool, not a shortcut — it helps students understand material faster, not skip it.

SCOPE: Only answer questions about FSchoolAI, its features, pricing, sign-up, and how to navigate this site. If asked about someone's personal grades, assignments, or account-specific data, explain that's only available once they're signed in and using the app — you don't have access to that here. If asked something unrelated to FSchoolAI entirely, politely redirect. Keep answers brief and friendly.`;

export default function SiteGuide() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<Msg[]>([]);
  messagesRef.current = messages;
  const sendingRef = useRef(false);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSend() {
    const q = input.trim();
    if (!q || sendingRef.current) return;
    sendingRef.current = true;
    setInput("");
    const userMsg: Msg = { role: "user", content: q };
    const priorMessages = messagesRef.current;
    setMessages(prev => [...prev, userMsg, { role: "assistant", content: "" }]);
    setStreaming(true);

    try {
      const apiMessages = sanitizeApiMessages([...priorMessages, userMsg]);
      const resp = await fetch("/api/claude", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stream: true, task: "cheap", messages: apiMessages, system: SYSTEM_PROMPT, max_tokens: 400 }),
      });

      if (!resp.ok || !resp.body) {
        setMessages(prev => {
          const next = [...prev];
          next[next.length - 1] = { role: "assistant", content: "Sorry, I couldn't answer that right now." };
          return next;
        });
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let sseBuffer = "", fullText = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        sseBuffer += decoder.decode(value, { stream: true });
        const lines = sseBuffer.split("\n");
        sseBuffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (!data || data === "[DONE]") continue;
          try {
            const evt = JSON.parse(data);
            const delta = evt.choices?.[0]?.delta?.content ?? (evt.type === "content_block_delta" ? evt.delta?.text : null);
            if (delta) {
              fullText += delta;
              setMessages(prev => {
                const next = [...prev];
                next[next.length - 1] = { role: "assistant", content: fullText };
                return next;
              });
            }
          } catch {}
        }
      }
    } catch {
      setMessages(prev => {
        const next = [...prev];
        next[next.length - 1] = { role: "assistant", content: "Connection error. Please try again." };
        return next;
      });
    } finally {
      setStreaming(false);
      sendingRef.current = false;
    }
  }

  return (
    <div style={{ position: "fixed", right: "20px", bottom: "20px", zIndex: 200 }}>
      {open && (
        <div style={{
          width: "min(340px, calc(100vw - 40px))", maxHeight: "460px", marginBottom: "12px",
          background: "rgba(20,19,15,0.97)", border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: "16px", overflow: "hidden", display: "flex", flexDirection: "column",
          boxShadow: "0 12px 40px rgba(0,0,0,0.5)", backdropFilter: "blur(20px)",
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
            <span style={{ fontSize: "13px", fontWeight: "600", color: "#F5F5F5" }}>Site Guide</span>
            <button onClick={() => setOpen(false)} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", display: "flex" }}><X size={16} /></button>
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: messages.length ? "12px 16px" : "0", maxHeight: "320px" }}>
            {messages.length === 0 && (
              <div style={{ padding: "20px 16px", textAlign: "center" }}>
                <p style={{ fontSize: "13px", color: "rgba(255,255,255,0.4)", lineHeight: 1.5 }}>
                  Ask about FSchoolAI — features, pricing, Canvas sync, or how to get started.
                </p>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} style={{ marginBottom: i < messages.length - 1 ? "12px" : "4px" }}>
                {m.role === "user" ? (
                  <p style={{ fontSize: "13px", color: "#F5F5F5", fontWeight: "500", margin: "0 0 6px" }}>{m.content}</p>
                ) : (
                  <div style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "10px", padding: "10px 14px", fontSize: "13px", color: "rgba(255,255,255,0.75)", lineHeight: "1.6", whiteSpace: "pre-wrap" }}>
                    {m.content ? m.content : <span style={{ color: "rgba(255,255,255,0.35)", fontStyle: "italic" }}>Thinking…</span>}
                  </div>
                )}
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          <div style={{ padding: "10px 12px 12px", borderTop: messages.length ? "1px solid rgba(255,255,255,0.06)" : "none" }}>
            <div style={{ display: "flex", gap: "8px" }}>
              <input
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && !e.shiftKey && handleSend()}
                placeholder="Ask a question…"
                disabled={streaming}
                maxLength={500}
                style={{ flex: 1, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.09)", borderRadius: "9px", padding: "9px 12px", color: "#F5F5F5", fontSize: "13px", outline: "none", fontFamily: "inherit", opacity: streaming ? 0.5 : 1 }}
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || streaming}
                style={{ background: "rgba(255,255,255,0.1)", color: "#F5F5F5", border: "1px solid rgba(255,255,255,0.15)", borderRadius: "9px", padding: "9px 16px", fontSize: "13px", fontWeight: "600", cursor: (!input.trim() || streaming) ? "default" : "pointer", fontFamily: "inherit", opacity: (!input.trim() || streaming) ? 0.4 : 1, flexShrink: 0 }}
              >
                {streaming ? "…" : "Ask →"}
              </button>
            </div>
          </div>
        </div>
      )}

      <button
        onClick={() => setOpen(o => !o)}
        aria-label="Site Guide"
        style={{
          width: "52px", height: "52px", borderRadius: "50%",
          background: "linear-gradient(135deg, #C49A3C, #a07a2c)",
          border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: "0 6px 20px rgba(196,154,60,0.4)", marginLeft: "auto",
        }}
      >
        {open ? <X size={22} color="#0b0b0d" /> : <MessageCircle size={22} color="#0b0b0d" />}
      </button>
    </div>
  );
}

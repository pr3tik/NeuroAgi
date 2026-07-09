// SiteGuide.tsx — Premium floating AI assistant for landing page visitors.
// Light Apple theme. No Supabase, no user data — static product FAQ only.
// Routing: task:"cheap" via api/_gateway.ts (Groq, anonymous traffic).
import { useState, useRef, useEffect } from "react";
import { sanitizeApiMessages } from "../lib/chatMessages";

type Msg = { role: "user" | "assistant"; content: string };

const FONT = '-apple-system,BlinkMacSystemFont,"SF Pro Display","SF Pro Text","Helvetica Neue",Arial,sans-serif';

const SYSTEM_PROMPT = `You are "FschoolAI Guide", a friendly assistant helping visitors understand FSchoolAI. You do NOT have access to any student's personal data, grades, or courses — you only answer general questions about the product and site.

WHAT FSCHOOLAI IS:
FSchoolAI is an AI-powered academic platform that syncs with a student's Canvas LMS, organizes their courses and assignments, and gives them a personal AI tutor grounded in their actual class material. Core features: Canvas sync (courses/assignments/deadlines, read-only), AI tutor & flashcards, assignment tracker, Study Rooms (collaborative sessions with shared whiteboard), and a leaderboard/identity card system.

PRICING: Beta gives 1 month free, no credit card. Core features stay free after beta. Pro adds recording/transcription, priority AI, study planner, and Study Rooms.

CANVAS: Students paste their school Canvas URL + read-only API token. FSchoolAI reads — never writes. Token stored only on device. Works with any Canvas LMS school.

SCOPE: Only answer questions about FSchoolAI, its features, pricing, sign-up, and navigation. Keep answers brief and friendly.`;

const SUGGESTIONS = [
  "What is FschoolAI?",
  "Is it free to join?",
  "How does Canvas sync work?",
];

export default function SiteGuide() {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [fabHover, setFabHover] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const messagesRef = useRef<Msg[]>([]);
  messagesRef.current = messages;
  const sendingRef = useRef(false);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 320);
  }, [open]);

  function handleOpen() { setClosing(false); setOpen(true); }
  function handleClose() {
    setClosing(true);
    setTimeout(() => { setOpen(false); setClosing(false); }, 220);
  }

  async function handleSend(text?: string) {
    const q = (text ?? input).trim();
    if (!q || sendingRef.current) return;
    sendingRef.current = true;
    setInput("");
    const userMsg: Msg = { role: "user", content: q };
    const prior = messagesRef.current;
    setMessages(prev => [...prev, userMsg, { role: "assistant", content: "" }]);
    setStreaming(true);

    try {
      const apiMessages = sanitizeApiMessages([...prior, userMsg]);
      const resp = await fetch("/api/claude", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stream: true, task: "cheap", messages: apiMessages, system: SYSTEM_PROMPT, max_tokens: 400 }),
      });

      if (!resp.ok || !resp.body) {
        setMessages(prev => { const n = [...prev]; n[n.length - 1] = { role: "assistant", content: "Sorry, couldn't reach the server. Try again." }; return n; });
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
              setMessages(prev => { const n = [...prev]; n[n.length - 1] = { role: "assistant", content: fullText }; return n; });
            }
          } catch {}
        }
      }
    } catch {
      setMessages(prev => { const n = [...prev]; n[n.length - 1] = { role: "assistant", content: "Connection error — please try again." }; return n; });
    } finally {
      setStreaming(false);
      sendingRef.current = false;
    }
  }

  return (
    <>
      <style>{`
        @keyframes sgPanelIn  { from{opacity:0;transform:translateY(18px) scale(0.95)} to{opacity:1;transform:translateY(0) scale(1)} }
        @keyframes sgPanelOut { from{opacity:1;transform:translateY(0) scale(1)} to{opacity:0;transform:translateY(12px) scale(0.96)} }
        @keyframes sgMsgIn    { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
        @keyframes sgFabPulse { 0%,100%{box-shadow:0 4px 20px rgba(0,0,0,0.18),0 1px 4px rgba(0,0,0,0.08)} 50%{box-shadow:0 6px 28px rgba(0,0,0,0.22),0 2px 6px rgba(0,0,0,0.10)} }
        @keyframes sgDot      { 0%,100%{transform:translateY(0);opacity:0.4} 50%{transform:translateY(-4px);opacity:1} }
        .sg-input::placeholder { color:rgba(0,0,0,0.32); }
        .sg-input:focus { border-color:rgba(0,102,204,0.60)!important; outline:none; box-shadow:0 0 0 3px rgba(0,102,204,0.12); }
        .sg-chip:hover { background:rgba(0,0,0,0.07)!important; }
      `}</style>

      <div style={{ position: "fixed", right: 20, bottom: 20, zIndex: 300, display: "flex", flexDirection: "column", alignItems: "flex-end" }}>

        {/* ── Panel ── */}
        {open && (
          <div style={{
            width: "min(360px, calc(100vw - 40px))",
            maxHeight: 520,
            marginBottom: 12,
            background: "rgba(255,255,255,0.96)",
            backdropFilter: "saturate(180%) blur(24px)",
            WebkitBackdropFilter: "saturate(180%) blur(24px)",
            border: "1px solid rgba(0,0,0,0.09)",
            borderRadius: 20,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            boxShadow: "0 24px 60px rgba(0,0,0,0.13), 0 4px 16px rgba(0,0,0,0.06), inset 0 1px 0 rgba(255,255,255,0.9)",
            animation: closing ? "sgPanelOut 0.22s cubic-bezier(0.4,0,1,1) both" : "sgPanelIn 0.32s cubic-bezier(0.16,1,0.3,1) both",
            fontFamily: FONT,
          }}>

            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px 12px", borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
              <img src="/fschoolai-logo.jpeg" alt="FschoolAI" style={{ width: 22, height: 22, borderRadius: 6, objectFit: "cover", flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "#1d1d1f", letterSpacing: "-0.01em" }}>FschoolAI</p>
                <p style={{ margin: 0, fontSize: 11, color: "rgba(0,0,0,0.40)" }}>AI Guide · Typically replies instantly</p>
              </div>
              {/* Status dot */}
              <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#34c759", flexShrink: 0 }} />
              <button
                onClick={handleClose}
                style={{ background: "none", border: "none", cursor: "pointer", padding: 4, color: "rgba(0,0,0,0.36)", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 6, transition: "background 0.15s, color 0.15s" }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(0,0,0,0.06)"; (e.currentTarget as HTMLButtonElement).style.color = "rgba(0,0,0,0.72)"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "none"; (e.currentTarget as HTMLButtonElement).style.color = "rgba(0,0,0,0.36)"; }}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
              </button>
            </div>

            {/* Messages */}
            <div style={{ flex: 1, overflowY: "auto", padding: "14px 14px 8px" }}>
              {messages.length === 0 ? (
                <div style={{ padding: "8px 2px 16px" }}>
                  <p style={{ fontSize: 14, color: "rgba(0,0,0,0.62)", lineHeight: 1.6, margin: "0 0 16px" }}>
                    Hi! Ask me anything about FschoolAI — features, pricing, Canvas sync, or how to get started.
                  </p>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
                    {SUGGESTIONS.map(s => (
                      <button key={s} className="sg-chip"
                        onClick={() => handleSend(s)}
                        style={{
                          background: "rgba(0,0,0,0.05)", border: "1px solid rgba(0,0,0,0.08)",
                          borderRadius: 20, padding: "6px 13px", fontSize: 12, fontWeight: 500,
                          color: "rgba(0,0,0,0.72)", cursor: "pointer", fontFamily: FONT,
                          transition: "background 0.15s",
                        }}
                      >{s}</button>
                    ))}
                  </div>
                </div>
              ) : (
                messages.map((m, i) => (
                  <div key={i} style={{
                    display: "flex",
                    justifyContent: m.role === "user" ? "flex-end" : "flex-start",
                    marginBottom: 10,
                    animation: "sgMsgIn 0.28s cubic-bezier(0.16,1,0.3,1) both",
                  }}>
                    {m.role === "user" ? (
                      <div style={{
                        background: "#1d1d1f", color: "#fff",
                        borderRadius: "16px 16px 4px 16px",
                        padding: "9px 14px", fontSize: 13, lineHeight: 1.55,
                        maxWidth: "80%",
                      }}>{m.content}</div>
                    ) : (
                      <div style={{
                        background: "#f5f5f7", color: "#1d1d1f",
                        borderRadius: "4px 16px 16px 16px",
                        padding: "10px 14px", fontSize: 13, lineHeight: 1.65,
                        maxWidth: "84%", whiteSpace: "pre-wrap",
                        border: "1px solid rgba(0,0,0,0.06)",
                      }}>
                        {m.content
                          ? m.content
                          : (
                            <span style={{ display: "flex", gap: 4, alignItems: "center", padding: "2px 0" }}>
                              {[0, 0.16, 0.32].map((d, j) => (
                                <span key={j} style={{ width: 5, height: 5, borderRadius: "50%", background: "rgba(0,0,0,0.35)", display: "inline-block", animation: `sgDot 0.8s ease-in-out ${d}s infinite` }} />
                              ))}
                            </span>
                          )
                        }
                      </div>
                    )}
                  </div>
                ))
              )}
              <div ref={bottomRef} />
            </div>

            {/* Input */}
            <div style={{ padding: "8px 12px 14px", borderTop: messages.length ? "1px solid rgba(0,0,0,0.06)" : "none" }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  ref={inputRef}
                  className="sg-input"
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && !e.shiftKey && handleSend()}
                  placeholder="Ask a question…"
                  disabled={streaming}
                  maxLength={500}
                  style={{
                    flex: 1,
                    background: "rgba(0,0,0,0.04)", border: "1px solid rgba(0,0,0,0.10)",
                    borderRadius: 12, padding: "10px 14px",
                    color: "#1d1d1f", fontSize: 13, fontFamily: FONT,
                    opacity: streaming ? 0.55 : 1,
                    transition: "border-color 0.15s, box-shadow 0.15s",
                  }}
                />
                <button
                  onClick={() => handleSend()}
                  disabled={!input.trim() || streaming}
                  style={{
                    background: !input.trim() || streaming ? "rgba(0,0,0,0.06)" : "#0071e3",
                    color: !input.trim() || streaming ? "rgba(0,0,0,0.32)" : "#fff",
                    border: "none", borderRadius: 11, padding: "10px 16px",
                    fontSize: 13, fontWeight: 500, cursor: !input.trim() || streaming ? "default" : "pointer",
                    fontFamily: FONT, flexShrink: 0,
                    transition: "background 0.18s, color 0.18s, transform 0.15s",
                  }}
                  onMouseEnter={e => { if (input.trim() && !streaming) (e.currentTarget as HTMLButtonElement).style.transform = "scale(1.04)"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.transform = "scale(1)"; }}
                >
                  {streaming ? "…" : "Ask →"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── FAB — clean dark pill, no gold, no glow ── */}
        <button
          onClick={open ? handleClose : handleOpen}
          onMouseEnter={() => setFabHover(true)}
          onMouseLeave={() => setFabHover(false)}
          aria-label="Ask FschoolAI"
          style={{
            display: "flex", alignItems: "center", gap: open ? 0 : 9,
            width: open ? 48 : "auto",
            height: 48,
            borderRadius: 980,
            padding: open ? "0" : "0 20px 0 14px",
            background: fabHover ? "#333" : "#1d1d1f",
            border: "none", cursor: "pointer",
            boxShadow: "0 4px 20px rgba(0,0,0,0.22), 0 1px 4px rgba(0,0,0,0.10)",
            overflow: "hidden",
            justifyContent: "center",
            animation: !open ? "sgFabPulse 4s ease-in-out 2s infinite" : "none",
            transition: "background 0.18s, width 0.28s cubic-bezier(0.16,1,0.3,1), transform 0.18s cubic-bezier(0.16,1,0.3,1), box-shadow 0.18s",
            transform: fabHover ? "scale(1.04)" : "scale(1)",
          }}
        >
          {open ? (
            <svg width="16" height="16" viewBox="0 0 14 14" fill="none">
              <path d="M1 1l12 12M13 1L1 13" stroke="#fff" strokeWidth="1.8" strokeLinecap="round"/>
            </svg>
          ) : (
            <>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
              <span style={{ fontSize: 13, fontWeight: 500, color: "#fff", whiteSpace: "nowrap", fontFamily: FONT }}>Ask anything</span>
            </>
          )}
        </button>
      </div>
    </>
  );
}

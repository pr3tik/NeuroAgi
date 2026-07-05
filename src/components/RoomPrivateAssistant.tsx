// RoomPrivateAssistant.tsx — a private, per-student AI helper inside a Study Room.
//
// Standalone: does not modify or depend on NeuralRing.tsx or StudyAssistant.tsx.
// Calls the same backend endpoints they already use (tutor-context, rag, claude,
// tutor-impression, session-close) with its own system-prompt assembly. Renders
// only into this component's own state — never sent through the room's shared
// broadcast channel. That absence of an outgoing path (not a filter on what goes
// out) is the entire privacy mechanism: there is nothing here that could leak.
import { useState, useRef, useEffect } from "react";
import { Lock } from "lucide-react";
import { useApp } from "../context/AppContext";
import { sanitizeApiMessages } from "../lib/chatMessages";

type Msg = { role: "user" | "assistant"; content: string };

export default function RoomPrivateAssistant({
  courseId,
  courseName,
  onClose,
}: {
  courseId?: number | null;
  courseName?: string;
  onClose: () => void;
}) {
  const { userId, userData, assignments } = useApp();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const messagesRef = useRef<Msg[]>([]);
  messagesRef.current = messages;
  // Most recent pattern-recognition hint shown this session, if any — passed to
  // session-close so it can tell whether the hinted technique actually panned out.
  const usedStrategyRef = useRef<{ id: string | null; kind: string | null }>({ id: null, kind: null });
  // Re-entrancy guard for handleSend. The `streaming` STATE isn't safe for this —
  // React batches state updates, so a rapid double-click can read the same stale
  // `streaming === false` closure in both calls before either commit lands. A ref
  // updates synchronously and immediately, so it actually blocks the second call.
  const sendingRef = useRef(false);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // On close/unmount, feed this session into the same living-mind update
  // NeuralRing triggers on chat close — room sessions count too.
  useEffect(() => {
    return () => {
      const finalMessages = messagesRef.current;
      if (finalMessages.length >= 2) {
        fetch("/api/session-close", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId, sessionMessages: finalMessages,
            usedStrategyId:   usedStrategyRef.current.id,
            usedStrategyKind: usedStrategyRef.current.kind,
          }),
        }).catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function buildSystem(ragContext: string | null, liveContext: string | null) {
    const upcoming = (assignments || [])
      .filter((a: any) => a.dueAt && new Date(a.dueAt) > new Date() && !a.submission?.submittedAt)
      .slice(0, 5)
      .map((a: any) => `  • ${a.title} — due ${new Date(a.dueAt).toLocaleDateString()}`)
      .join("\n");

    return [
      "You are the student's private AI study assistant, helping them while they're in a Study Room with classmates.",
      "This conversation is visible ONLY to this student — nobody else in the room sees any part of it.",
      "Be direct, encouraging, and academically accurate. Ground answers in the student's own materials and history below when relevant.",
      "",
      `ROOM CONTEXT: ${courseName || "General study session"}`,
      `STUDENT: ${userData?.name || "Student"}${userData?.gpa != null ? ` — GPA ${Number(userData.gpa).toFixed(2)}` : ""}`,
      upcoming ? `UPCOMING ASSIGNMENTS:\n${upcoming}` : "",
      ragContext ? `\nFROM THE STUDENT'S OWN COURSE MATERIALS:\n${ragContext}` : "",
      liveContext ? `\nLIVE CONTEXT:\n${liveContext}` : "",
    ].filter(Boolean).join("\n");
  }

  async function handleSend() {
    const q = input.trim();
    if (!q || sendingRef.current) return;
    sendingRef.current = true;
    setInput("");
    const userMsg: Msg = { role: "user", content: q };
    const priorMessages = messagesRef.current;
    setMessages(prev => [...prev, userMsg, { role: "assistant", content: "" }]);
    setStreaming(true);
    abortRef.current = new AbortController();

    try {
      const [ctxRes, ragRes] = await Promise.all([
        fetch("/api/tutor-context", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId, userMessage: q, activeCourseId: courseId ?? null }),
        }).then(r => r.json()).catch(() => ({ context: null })),
        fetch("/api/rag?action=query", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId, query: q, courseId: courseId ?? null }),
        }).then(r => r.json()).catch(() => ({ passages: [] })),
      ]);

      const ragContext = (ragRes.passages || [])
        .slice(0, 4)
        .map((p: any, i: number) => `[${i + 1}] ${p.title}${p.heading ? ` — ${p.heading}` : ""}\n${p.text}`)
        .join("\n\n") || null;

      // Track the most recent hint shown, if any, so session-close can later tell
      // whether the hinted technique actually panned out this session.
      if (ctxRes.strategyHintId) {
        usedStrategyRef.current = { id: ctxRes.strategyHintId, kind: ctxRes.strategyHintKind ?? null };
      }

      const system = buildSystem(ragContext, ctxRes.context);
      const apiMessages = sanitizeApiMessages([...priorMessages, userMsg]);

      const resp = await fetch("/api/claude", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stream: true, messages: apiMessages, system, max_tokens: 1024 }),
        signal: abortRef.current.signal,
      });

      if (!resp.ok || !resp.body) {
        const errData = await resp.json().catch(() => ({}));
        setMessages(prev => {
          const next = [...prev];
          next[next.length - 1] = { role: "assistant", content: errData.error || "Sorry, I couldn't answer that right now." };
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
            if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta") {
              fullText += evt.delta.text ?? "";
              setMessages(prev => {
                const next = [...prev];
                next[next.length - 1] = { role: "assistant", content: fullText };
                return next;
              });
            }
          } catch {}
        }
      }

      fetch("/api/tutor-impression", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, userMessage: q, tutorResponse: fullText }),
      }).catch(() => {});
    } catch (err: any) {
      if (err?.name !== "AbortError") {
        setMessages(prev => {
          const next = [...prev];
          next[next.length - 1] = { role: "assistant", content: "Connection error. Please try again." };
          return next;
        });
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
      sendingRef.current = false;
    }
  }

  return (
    <div style={{
      border: "1px solid rgba(160,120,220,0.25)",
      borderRadius: "14px",
      background: "rgba(160,120,220,0.04)",
      marginBottom: "20px",
      overflow: "hidden",
    }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "12px 16px",
        borderBottom: "1px solid rgba(160,120,220,0.14)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ display: "flex", color: "#a078dc" }}><Lock size={14} /></span>
          <span style={{ fontSize: "13px", fontWeight: "600", color: "#a078dc" }}>Your Private Assistant</span>
          <span style={{ fontSize: "11px", color: "var(--text-dim)", background: "rgba(255,255,255,0.05)", borderRadius: "6px", padding: "2px 7px" }}>
            only visible to you
          </span>
        </div>
        <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-dim)", fontSize: "18px", cursor: "pointer", lineHeight: 1, padding: "0 2px" }}>×</button>
      </div>

      <div style={{ maxHeight: "380px", overflowY: "auto", padding: messages.length ? "12px 16px" : "0" }}>
        {messages.length === 0 && (
          <div style={{ padding: "20px 16px", textAlign: "center" }}>
            <p style={{ fontSize: "13px", color: "var(--text-dim)", lineHeight: 1.5 }}>
              Ask anything — your grades, your gaps, this course's material.<br />
              <span style={{ fontSize: "12px", opacity: 0.7 }}>Nobody else in this room ever sees this.</span>
            </p>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} style={{ marginBottom: i < messages.length - 1 ? "14px" : "4px" }}>
            {m.role === "user" ? (
              <p style={{ fontSize: "13px", color: "var(--text-primary)", fontWeight: "500", margin: "0 0 6px" }}>{m.content}</p>
            ) : (
              <div style={{
                background: "rgba(160,120,220,0.06)", border: "1px solid rgba(160,120,220,0.14)",
                borderRadius: "10px", padding: "10px 14px",
                fontSize: "13px", color: "var(--text-secondary)", lineHeight: "1.65",
                whiteSpace: "pre-wrap",
              }}>
                {m.content ? m.content : <span style={{ color: "var(--text-dim)", fontStyle: "italic" }}>Thinking…</span>}
              </div>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div style={{ padding: "10px 16px 14px", borderTop: messages.length ? "1px solid rgba(255,255,255,0.05)" : "none" }}>
        <div style={{ display: "flex", gap: "8px" }}>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && !e.shiftKey && handleSend()}
            placeholder="Ask your private assistant…"
            disabled={streaming}
            maxLength={800}
            style={{
              flex: 1, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.09)",
              borderRadius: "9px", padding: "9px 12px", color: "var(--text-primary)", fontSize: "13px",
              outline: "none", fontFamily: "inherit", opacity: streaming ? 0.5 : 1,
            }}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || streaming}
            style={{
              background: "rgba(160,120,220,0.14)", color: "#a078dc",
              border: "1px solid rgba(160,120,220,0.3)", borderRadius: "9px",
              padding: "9px 16px", fontSize: "13px", fontWeight: "600",
              cursor: (!input.trim() || streaming) ? "default" : "pointer",
              fontFamily: "inherit", opacity: (!input.trim() || streaming) ? 0.4 : 1,
              flexShrink: 0,
            }}
          >
            {streaming ? "…" : "Ask →"}
          </button>
        </div>
      </div>
    </div>
  );
}

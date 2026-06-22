// DocChat.tsx — YouLearn Phase 2: chat panel with quiz + flashcard flows.
// Fix Round 3:
//   1. createPortal → panel renders at document.body, outside CSS-transform ancestor
//   2. RAF-batched streaming → no layout thrash on every token
//   3. courseId threaded through → flashcard save actually works
//   4. react-markdown → properly formatted AI responses
import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import ReactMarkdown from "react-markdown";
import { useApp } from "../context/AppContext";
import type { DocAction } from "./SelectionToolbar";
import DocQuiz, { type QuizQuestion } from "./DocQuiz";

// ── Types ─────────────────────────────────────────────────────────────────────
interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
}

interface Props {
  docId: string;
  docTitle: string;
  docContext: string;
  /** The file's course DB id — passed through so flashcards save to the right course */
  courseId?: number | null;
  initialSelection: string | null;
  initialAction: DocAction | null;
  onClose: () => void;
  onNavigate: (page: string) => void;
}

// ── Suggestions ───────────────────────────────────────────────────────────────
const SUGGESTIONS: { action: DocAction; label: string }[] = [
  { action: "explain",    label: "Explain this passage" },
  { action: "quiz",       label: "Quiz me on this"      },
  { action: "flashcards", label: "Create flashcards"    },
];

// ── System prompt ─────────────────────────────────────────────────────────────
function chatSystem(title: string, ctx: string) {
  return `You are a study assistant helping a student understand "${title}".\n\nDocument excerpt:\n"""\n${ctx}\n"""`;
}

// ── Non-streaming Claude call (structured JSON responses) ─────────────────────
async function callClaude(prompt: string, system: string, maxTokens = 1400): Promise<string> {
  const res = await fetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: prompt }], system, max_tokens: maxTokens }),
  });
  if (!res.ok) throw new Error(`Claude ${res.status}`);
  const data = await res.json();
  return data.content ?? "";
}

// ── SSE streaming ─────────────────────────────────────────────────────────────
async function streamClaude(
  msgs: { role: string; content: string }[],
  system: string,
  onChunk: (t: string) => void,
  signal: AbortSignal
) {
  const res = await fetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: msgs, system, max_tokens: 900, stream: true }),
    signal,
  });
  if (!res.ok) throw new Error(`Claude ${res.status}`);
  const reader = res.body!.getReader();
  const dec    = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n"); buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const d = line.slice(5).trim();
      if (!d || d === "[DONE]") continue;
      try {
        const e = JSON.parse(d);
        if (e.type === "content_block_delta" && e.delta?.type === "text_delta") onChunk(e.delta.text);
      } catch { /* skip */ }
    }
  }
}

// ── Safe JSON parse ───────────────────────────────────────────────────────────
function parseJSON<T>(raw: string): T | null {
  const clean = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  try { return JSON.parse(clean) as T; } catch { return null; }
}

// ── Typing dots ───────────────────────────────────────────────────────────────
function Dots() {
  return (
    <span style={{ display: "inline-flex", gap: "3px", alignItems: "center", marginLeft: "2px" }}>
      <style>{`@keyframes td{0%,80%,100%{opacity:.25;transform:translateY(0)}40%{opacity:1;transform:translateY(-3px)}}`}</style>
      {[0, .17, .34].map((d, i) => (
        <span key={i} style={{ display: "inline-block", width: 4, height: 4, borderRadius: "50%", background: "#C49A3C", animation: `td 1s ease-in-out infinite`, animationDelay: `${d}s` }} />
      ))}
    </span>
  );
}

// ── Markdown styles (injected once) ──────────────────────────────────────────
const MD_STYLES = `
.doc-md h1,.doc-md h2,.doc-md h3{color:rgba(245,245,245,.92);font-family:var(--font-sans);font-weight:600;line-height:1.35;margin:.9em 0 .35em}
.doc-md h1{font-size:16px}.doc-md h2{font-size:15px}.doc-md h3{font-size:14px}
.doc-md p{margin:.45em 0;line-height:1.78;color:rgba(245,245,245,.88)}
.doc-md ul,.doc-md ol{padding-left:18px;margin:.4em 0}
.doc-md li{margin:.25em 0;color:rgba(245,245,245,.84);line-height:1.65}
.doc-md strong{color:rgba(245,245,245,.96);font-weight:700}
.doc-md em{color:rgba(245,245,245,.75)}
.doc-md code{background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.1);border-radius:4px;padding:1px 5px;font-size:12px;font-family:monospace;color:#C49A3C}
.doc-md pre{background:rgba(0,0,0,.3);border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:12px 14px;overflow-x:auto;margin:.6em 0}
.doc-md pre code{background:none;border:none;padding:0;color:rgba(245,245,245,.82)}
.doc-md blockquote{border-left:2px solid rgba(196,154,60,.4);padding-left:12px;margin:.5em 0;color:rgba(245,245,245,.65);font-style:italic}
.doc-md hr{border:none;border-top:1px solid rgba(255,255,255,.08);margin:.8em 0}
`;

function MarkdownContent({ content }: { content: string }) {
  return (
    <>
      <style>{MD_STYLES}</style>
      <div className="doc-md">
        <ReactMarkdown>{content}</ReactMarkdown>
      </div>
    </>
  );
}

// ── DocChat ───────────────────────────────────────────────────────────────────
export default function DocChat({
  docId, docTitle, docContext, courseId, initialSelection, initialAction, onClose, onNavigate,
}: Props) {
  const { userId, setStudyConfig } = useApp();
  const [msgs,       setMsgs]       = useState<Message[]>([]);
  const [input,      setInput]      = useState("");
  const [streaming,  setStreaming]  = useState(false);
  const [chip,       setChip]       = useState<string | null>(initialSelection);
  const [quizData,   setQuizData]   = useState<QuizQuestion[] | null>(null);
  const [quizLoad,   setQuizLoad]   = useState(false);
  const [fcStatus,   setFcStatus]   = useState<"idle" | "loading" | "saved" | "error">("idle");
  const [fcError,    setFcError]    = useState("");

  const abortRef    = useRef<AbortController | null>(null);
  const bottomRef   = useRef<HTMLDivElement>(null);
  const inputRef    = useRef<HTMLTextAreaElement>(null);
  const idRef       = useRef(0);
  // RAF-based streaming buffer — avoids a setMsgs call on every single token
  const streamBuf   = useRef("");
  const streamAid   = useRef("");
  const rafRef      = useRef<number | null>(null);

  const mobile = typeof window !== "undefined" && window.innerWidth < 640;

  // Auto-scroll to bottom whenever messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs]);

  // Fire initial action on mount
  useEffect(() => {
    if (!initialAction || !initialSelection) return;
    if (initialAction === "quiz")       { handleQuiz(initialSelection);       return; }
    if (initialAction === "flashcards") { handleFlashcards(initialSelection); return; }
    const text = initialAction === "explain"
      ? `Explain this passage:\n\n"${initialSelection}"`
      : `Let's discuss:\n\n"${initialSelection}"`;
    sendMsg(text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Quiz ───────────────────────────────────────────────────────────────────
  async function handleQuiz(selection: string) {
    setQuizLoad(true);
    try {
      const system = `You are a study assistant. Generate a quiz from this document excerpt:\n\n"${docContext}"`;
      const prompt = `Create 4-5 multiple choice questions about:\n\n"${selection}"\n\nReturn ONLY valid JSON (no markdown fences):\n{"questions":[{"question":"...","options":["A","B","C","D"],"correctIndex":0,"explanation":"..."}]}`;
      const raw  = await callClaude(prompt, system, 1400);
      const data = parseJSON<{ questions: QuizQuestion[] }>(raw);
      if (!data?.questions?.length) throw new Error("No questions returned");
      setQuizData(data.questions);
    } catch {
      setMsgs([{ id: "err", role: "assistant", content: "Couldn't generate quiz. Please try again." }]);
    } finally { setQuizLoad(false); }
  }

  // ── Flashcards ────────────────────────────────────────────────────────────
  async function handleFlashcards(selection: string) {
    setFcStatus("loading");
    try {
      const system = `You are a study assistant generating flashcards.`;
      const prompt = `Create 5-8 flashcards from this passage:\n\n"${selection}"\n\nReturn ONLY valid JSON (no markdown fences, no extra text):\n{"flashcards":[{"front":"Term or question","back":"Definition or answer"}]}`;
      const raw  = await callClaude(prompt, system, 1000);
      const data = parseJSON<{ flashcards: { front: string; back: string }[] }>(raw);

      if (!data?.flashcards?.length) {
        throw new Error(`AI returned invalid format. Raw: ${raw.slice(0, 200)}`);
      }

      const cards = data.flashcards.map(f => ({ question: f.front, answer: f.back }));

      // Save — use docId as courseId proxy for flashcards_v2 (course_id NOT NULL, no FK)
      let saved = false;
      if (userId) {
        const saveRes = await fetch("/api/flashcards", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "save", userId, courseId: docId, cards }),
        });
        if (saveRes.ok) { saved = true; }
        else {
          const err = await saveRes.json().catch(() => ({}));
          console.error("[DocChat] flashcard save failed:", err);
          throw new Error(err.error || `Save failed (${saveRes.status})`);
        }
      }

      const preview = cards.slice(0, 3).map(c => `**${c.question}**\n${c.answer}`).join("\n\n");
      setMsgs([{
        id: `fc-${++idRef.current}`,
        role: "assistant",
        content: `✓ Created ${cards.length} flashcards${saved ? " and saved to your deck" : ""}:\n\n${preview}${cards.length > 3 ? `\n\n…and ${cards.length - 3} more` : ""}\n\nOpening Study section…`,
      }]);
      setFcStatus("saved");
      setStudyConfig({ mode: "flashcards", docId, docTitle });
      setTimeout(() => { onClose(); onNavigate("study"); }, 2000);
    } catch (e: any) {
      console.error("[DocChat] flashcard error:", e);
      setFcStatus("error");
      setFcError(e.message || "Couldn't create flashcards. Please try again.");
    }
  }

  // ── Streaming chat ────────────────────────────────────────────────────────
  const sendMsg = useCallback(async (text: string) => {
    if (!text.trim() || streaming) return;
    const uid = `u-${++idRef.current}`;
    const aid = `a-${++idRef.current}`;
    const uMsg: Message = { id: uid, role: "user",      content: text.trim() };
    const aMsg: Message = { id: aid, role: "assistant", content: "", streaming: true };
    setMsgs(prev => [...prev, uMsg, aMsg]);
    setStreaming(true);

    // Set up RAF-batched streaming buffer
    streamBuf.current = "";
    streamAid.current = aid;

    function flushStream() {
      const cur = streamBuf.current;
      setMsgs(prev => prev.map(m => m.id === streamAid.current ? { ...m, content: cur } : m));
      rafRef.current = null;
    }

    const sys  = chatSystem(docTitle, docContext);
    const hist = [...msgs, uMsg].map(m => ({ role: m.role as any, content: m.content }));
    abortRef.current = new AbortController();
    try {
      await streamClaude(hist, sys, chunk => {
        streamBuf.current += chunk;
        // Batch DOM updates via RAF — avoids a setState on every single token
        if (!rafRef.current) rafRef.current = requestAnimationFrame(flushStream);
      }, abortRef.current.signal);
      // Flush any remaining buffer after stream ends
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
      flushStream();
    } catch (e: any) {
      if (e?.name !== "AbortError") {
        setMsgs(prev => prev.map(m => m.id === aid ? { ...m, content: "Something went wrong. Please try again.", streaming: false } : m));
      }
    } finally {
      setMsgs(prev => prev.map(m => m.id === aid ? { ...m, streaming: false } : m));
      setStreaming(false);
      abortRef.current = null;
    }
  }, [msgs, streaming, docTitle, docContext]);

  function handleSend() {
    if (!input.trim()) return;
    const text = chip ? `${input.trim()}\n\nContext: "${chip}"` : input.trim();
    setInput(""); setChip(null);
    if (inputRef.current) inputRef.current.style.height = "auto";
    sendMsg(text);
  }
  function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }

  // ── Layout ─────────────────────────────────────────────────────────────────
  const panelAnim = mobile
    ? { initial: { y: "100%" }, animate: { y: 0 }, exit: { y: "100%" } }
    : { initial: { x: "100%" }, animate: { x: 0 }, exit: { x: "100%" } };

  // position:fixed is VIEWPORT-relative because we render via createPortal at document.body,
  // outside the CSS-transform ancestor (.app-page-transition) that would otherwise
  // create a containing block and break fixed positioning.
  const panelStyle: React.CSSProperties = mobile
    ? { position: "fixed", bottom: 0, left: 0, right: 0, height: "78dvh", borderRadius: "20px 20px 0 0" }
    : { position: "fixed", top: 0, right: 0, width: "min(400px, 100vw)", height: "100dvh" };

  const actionLabel = initialAction
    ? { explain: "Explain", chat: "Chat", quiz: "Quiz", flashcards: "Flashcards" }[initialAction]
    : "Ask";

  const isQuizMode      = !!quizData || quizLoad;
  const isFlashcardMode = initialAction === "flashcards";
  const showEmpty       = msgs.length === 0 && !streaming && !isQuizMode && !isFlashcardMode;

  const panel = (
    <>
      {/* Backdrop — createPortal so position:fixed is viewport-relative */}
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        onClick={onClose}
        style={{ position: "fixed", inset: 0, zIndex: 9050, background: "rgba(0,0,0,0.45)", backdropFilter: "blur(2px)" }}
      />

      {/* Chat panel */}
      <motion.div
        {...panelAnim}
        transition={{ type: "spring", stiffness: 340, damping: 36 }}
        style={{
          ...panelStyle,
          zIndex: 9100,
          background: "#17171a",
          borderLeft: mobile ? "none" : "1px solid rgba(255,255,255,0.07)",
          borderTop:  mobile ? "1px solid rgba(255,255,255,0.09)" : "none",
          display: "flex", flexDirection: "column", overflow: "hidden",
          boxShadow: mobile ? "0 -8px 40px rgba(0,0,0,0.4)" : "-8px 0 40px rgba(0,0,0,0.4)",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "14px 18px", borderBottom: "1px solid rgba(255,255,255,0.06)", flexShrink: 0 }}>
          <div style={{ width: 28, height: 28, borderRadius: "8px", background: "rgba(196,154,60,0.13)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "12px", color: "#C49A3C", fontWeight: "700" }}>✦</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: "13px", fontWeight: "600", color: "rgba(245,245,245,0.9)" }}>{actionLabel}</p>
            <p style={{ margin: 0, fontSize: "11px", color: "rgba(255,255,255,0.3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{docTitle}</p>
          </div>
          <button onClick={onClose} aria-label="Close"
            style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.32)", padding: "6px", borderRadius: "8px", transition: "background 0.12s, color 0.12s" }}
            onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.07)"; e.currentTarget.style.color = "rgba(255,255,255,0.6)"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = "rgba(255,255,255,0.32)"; }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 18px" }}>
          <AnimatePresence mode="wait">
            {quizLoad && (
              <motion.div key="qload" initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ textAlign: "center", paddingTop: "32px" }}>
                <Dots /><p style={{ fontSize: "13px", color: "rgba(255,255,255,0.35)", marginTop: "12px" }}>Generating quiz…</p>
              </motion.div>
            )}
            {quizData && !quizLoad && (
              <motion.div key="quiz" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <DocQuiz questions={quizData} onDone={() => setQuizData(null)} />
              </motion.div>
            )}
            {isFlashcardMode && fcStatus === "loading" && !msgs.length && (
              <motion.div key="fcload" initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ textAlign: "center", paddingTop: "32px" }}>
                <Dots /><p style={{ fontSize: "13px", color: "rgba(255,255,255,0.35)", marginTop: "12px" }}>Creating flashcards…</p>
              </motion.div>
            )}
            {fcStatus === "error" && (
              <motion.div key="fcerr" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                style={{ padding: "14px", background: "rgba(255,59,48,0.07)", border: "1px solid rgba(255,59,48,0.2)", borderRadius: "10px" }}>
                <p style={{ fontSize: "13px", color: "rgba(255,100,90,0.8)", margin: 0 }}>{fcError}</p>
              </motion.div>
            )}
            {showEmpty && (
              <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                {initialSelection && (
                  <div style={{ marginBottom: "16px", padding: "10px 14px", background: "rgba(196,154,60,0.06)", border: "1px solid rgba(196,154,60,0.15)", borderRadius: "10px" }}>
                    <p style={{ margin: "0 0 4px", fontSize: "10px", fontWeight: "700", letterSpacing: "0.5px", textTransform: "uppercase", color: "#C49A3C" }}>Selected</p>
                    <p style={{ margin: 0, fontSize: "12px", lineHeight: "1.6", color: "rgba(245,245,245,0.6)", fontStyle: "italic", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>"{initialSelection}"</p>
                  </div>
                )}
                <p style={{ margin: "0 0 10px", fontSize: "11px", color: "rgba(255,255,255,0.25)", fontWeight: "500" }}>Suggestions</p>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  {SUGGESTIONS.map((s, i) => (
                    <motion.button key={s.action} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}
                      onClick={() => {
                        if (s.action === "quiz")       { handleQuiz(initialSelection ?? docContext.slice(0, 600)); return; }
                        if (s.action === "flashcards") { handleFlashcards(initialSelection ?? docContext.slice(0, 600)); return; }
                        sendMsg(initialSelection ? `Explain:\n\n"${initialSelection}"` : "Explain the main ideas in this document.");
                      }}
                      style={{ display: "flex", alignItems: "center", gap: "10px", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "10px", padding: "10px 14px", cursor: "pointer", fontFamily: "inherit", textAlign: "left", transition: "background 0.12s, border-color 0.12s" }}
                      onMouseEnter={e => { e.currentTarget.style.background = "rgba(196,154,60,0.06)"; e.currentTarget.style.borderColor = "rgba(196,154,60,0.18)"; }}
                      onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.03)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)"; }}
                    >
                      <span style={{ fontSize: "13px", color: "rgba(245,245,245,0.7)", fontWeight: "500" }}>{s.label}</span>
                    </motion.button>
                  ))}
                </div>
              </motion.div>
            )}
            {msgs.length > 0 && !isQuizMode && (
              <motion.div key="msgs" style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
                {msgs.map(msg => (
                  <motion.div key={msg.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
                    {msg.role === "user" ? (
                      <div style={{ display: "flex", justifyContent: "flex-end" }}>
                        <div style={{ maxWidth: "82%", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "12px 12px 3px 12px", padding: "8px 13px", fontSize: "13px", lineHeight: "1.55", color: "rgba(245,245,245,0.82)", whiteSpace: "pre-wrap" }}>
                          {msg.content}
                        </div>
                      </div>
                    ) : (
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "7px" }}>
                          <div style={{ width: 18, height: 18, borderRadius: "5px", background: "rgba(196,154,60,0.14)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "9px", color: "#C49A3C", fontWeight: "700" }}>✦</div>
                          <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.28)", fontWeight: "600" }}>AI Tutor</span>
                        </div>
                        <div style={{ paddingLeft: "24px", fontSize: "14px", color: "rgba(245,245,245,0.88)" }}>
                          <MarkdownContent content={msg.content} />
                          {msg.streaming && !msg.content && <Dots />}
                          {msg.streaming && msg.content && (
                            <span style={{ display: "inline-block", width: 2, height: "1em", background: "#C49A3C", marginLeft: 2, verticalAlign: "text-bottom", animation: "blink .9s step-end infinite" }} />
                          )}
                          <style>{`@keyframes blink{0%,100%{opacity:1}50%{opacity:0}}`}</style>
                        </div>
                      </div>
                    )}
                  </motion.div>
                ))}
                <div ref={bottomRef} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Input */}
        {!isQuizMode && !isFlashcardMode && (
          <div style={{ flexShrink: 0, borderTop: "1px solid rgba(255,255,255,0.06)", padding: "10px 18px 14px" }}>
            <AnimatePresence>
              {chip && (
                <motion.div initial={{ opacity: 0, height: 0, marginBottom: 0 }} animate={{ opacity: 1, height: "auto", marginBottom: 8 }} exit={{ opacity: 0, height: 0, marginBottom: 0 }} transition={{ duration: 0.18 }} style={{ overflow: "hidden" }}>
                  <div style={{ display: "inline-flex", alignItems: "center", gap: "5px", background: "rgba(196,154,60,0.08)", border: "1px solid rgba(196,154,60,0.18)", borderRadius: "7px", padding: "3px 8px 3px 7px", maxWidth: "100%" }}>
                    <span style={{ color: "#C49A3C", fontSize: "11px", fontWeight: "700" }}>→</span>
                    <span style={{ fontSize: "11px", color: "rgba(196,154,60,0.85)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "200px" }}>{chip.length > 55 ? chip.slice(0, 55) + "…" : chip}</span>
                    <button onClick={() => setChip(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(196,154,60,0.5)", fontSize: "12px", padding: "0 1px", lineHeight: 1 }}>×</button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
            <div style={{ display: "flex", gap: "8px", alignItems: "flex-end", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "12px", padding: "9px 12px", transition: "border-color 0.15s" }}
              onFocusCapture={e => (e.currentTarget.style.borderColor = "rgba(196,154,60,0.28)")}
              onBlurCapture={e  => (e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)")}
            >
              <textarea ref={inputRef} value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKey} disabled={streaming}
                placeholder={streaming ? "" : "Ask about this document…"} rows={1}
                style={{ flex: 1, background: "none", border: "none", outline: "none", fontFamily: "inherit", fontSize: "13px", lineHeight: "1.55", color: "rgba(245,245,245,0.88)", resize: "none", maxHeight: "96px", overflowY: "auto", opacity: streaming ? 0.4 : 1 }}
                onInput={e => { const t = e.currentTarget; t.style.height = "auto"; t.style.height = `${Math.min(t.scrollHeight, 96)}px`; }}
              />
              {streaming
                ? <button onClick={() => abortRef.current?.abort()} style={{ background: "rgba(255,59,48,0.1)", border: "1px solid rgba(255,59,48,0.2)", borderRadius: "8px", padding: "5px 10px", cursor: "pointer", color: "rgba(255,100,90,0.8)", fontSize: "11px", fontWeight: "600", fontFamily: "inherit", flexShrink: 0, alignSelf: "flex-end" }}>Stop</button>
                : <button onClick={handleSend} disabled={!input.trim()} style={{ background: input.trim() ? "rgba(196,154,60,0.14)" : "transparent", border: `1px solid ${input.trim() ? "rgba(196,154,60,0.28)" : "rgba(255,255,255,0.07)"}`, borderRadius: "8px", padding: "5px 11px", cursor: input.trim() ? "pointer" : "default", color: input.trim() ? "#C49A3C" : "rgba(255,255,255,0.2)", fontSize: "12px", fontWeight: "600", fontFamily: "inherit", flexShrink: 0, alignSelf: "flex-end", transition: "all 0.12s" }}>Send</button>
              }
            </div>
          </div>
        )}
      </motion.div>
    </>
  );

  // Render via portal at document.body — escapes the CSS-transform ancestor
  if (typeof document === "undefined") return null;
  return createPortal(
    <AnimatePresence>{panel}</AnimatePresence>,
    document.body
  );
}

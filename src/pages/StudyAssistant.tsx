// StudyAssistant.tsx — Spotlight-style full-screen study assistant.
// Empty state: large centered input + suggestion chips.
// Conversation state: messages scroll above a pinned input.
// Powered by RAG (indexed imported materials) + Claude. History persists to
// chat_logs (page="study-assistant") — the same table NeuralRing's tutor chat
// uses, just a different `page` value — so returning students keep context.
//
// This is the student's main private tutor (internally the team calls it
// "study rooms" — renamed on this page to avoid confusion with the separate
// collaborative Rooms feature, which has no AI at all). It carries:
//   - living mind (tutor_mind) + recent impressions — cross-session profile
//   - teaching-strategy hints (via tutor-context's pattern-recognition layer)
//   - a privacy-scoped system prompt (own materials + own data only)
//   - whiteboard vision: if the student is currently in a Study Room with the
//     Board panel open, AppContext carries a live snapshot (see StudyRooms.tsx)
//     that this page can read and send as an image on explicit request
//   - room chat visibility: reads the shared chat of whatever room they're in
//     (already persisted via list_room_messages) — never the reverse

import { useState, useRef, useEffect, useCallback } from "react";
import { useApp } from "../context/AppContext";
import { supabase } from "../api/supabase";
import { loadRecentMessages } from "../api/chat";
import { sanitizeApiMessages } from "../lib/chatMessages";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import "../css/markdown.css";
import { SectionLabel } from "../components/uikit";
import { ActivityDropdown } from "../components/ActivityReceipt";
import { tealAlpha } from "../lib/theme";

// Concrete rgba (not var()) — ACCENT also feeds an SVG stroke= presentation
// attribute (send-arrow icon), where CSS var() doesn't resolve.
const ACCENT = tealAlpha(0.9);
const ACCENT_DIM = "rgba(var(--teal-rgb), 0.18)";
const ACCENT_BORDER = "rgba(var(--teal-rgb), 0.3)";
const PAGE = "study-assistant";
// Bound how much persisted history we replay into Claude's context per turn —
// full history still renders on screen, this only caps what's sent upstream.
const MAX_CONTEXT_TURNS = 20;

const SUGGESTIONS = [
  "Summarize what I've imported recently",
  "What topics appear most in my library?",
  "Explain the key concepts from my materials",
  "Quiz me on something from my library",
];

// Explicit-trigger only — the assistant doesn't always watch the whiteboard,
// only captures/sends it when the student asks about it directly.
const WHITEBOARD_INTENT_RE = /\b(whiteboard|white\s*board|the\s+board|diagram|sketch|drawing)\b/i;
// Explicit-trigger for reading back the room's shared chat.
const ROOM_CHAT_INTENT_RE = /\b(room\s*chat|the\s+chat|what.*(said|say)|shared\s+discussion|everyone.*said)\b/i;

// ── Slash commands — Claude-style "/" popup menu ────────────────────────────
type SlashCommandId = "clear-memory" | "clear-chat" | "clear-all";
interface SlashCommand {
  id: SlashCommandId;
  label: string;
  aliases: string[];
  description: string;
  confirmText: string;
}
const SLASH_COMMANDS: SlashCommand[] = [
  {
    id: "clear-memory",
    label: "/clear-memory",
    aliases: ["/clear-memory", "/forget-me"],
    description: "Erase what I've learned about you across sessions — keeps this chat visible",
    confirmText: "Clear your memory? This erases the living-mind profile and recent impressions built up across sessions. This can't be undone.",
  },
  {
    id: "clear-chat",
    label: "/clear-chat",
    aliases: ["/clear-chat", "/new-chat"],
    description: "Clear this conversation — keeps what I've learned about you",
    confirmText: "Clear this chat? The visible conversation and its history will be deleted. This can't be undone.",
  },
  {
    id: "clear-all",
    label: "/clear-all",
    aliases: ["/clear-all", "/reset"],
    description: "Clear both this chat and everything I've learned about you",
    confirmText: "Clear everything? This deletes the chat and your memory profile. This can't be undone.",
  },
];

function matchSlashCommand(raw: string): SlashCommand | null {
  const q = raw.trim().toLowerCase();
  return SLASH_COMMANDS.find(c => c.aliases.includes(q)) ?? null;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  sources?: { title: string; heading?: string }[];
  activity?: { label: string; status: string; sources?: { title: string }[] }[]; // work receipt steps (this page's own pipeline)
  system?: boolean; // local-only notice (e.g. "Chat cleared.") — never persisted or sent to Claude
}

async function loadHistory(userId: string): Promise<Message[]> {
  try {
    const { data } = await supabase
      .from("chat_logs")
      .select("role, content, created_at")
      .eq("user_id", userId)
      .eq("page", PAGE)
      .order("created_at", { ascending: true })
      .limit(200);
    return (data ?? []).map(r => ({ role: r.role as Message["role"], content: r.content }));
  } catch {
    return [];
  }
}

/** Fire-and-forget log — never blocks the chat UI on a slow/failed write. */
function logMessage(userId: string, role: string, content: string, conversationId: string | null = null) {
  supabase.from("chat_logs").insert({ user_id: userId, role, content, page: PAGE, conversation_id: conversationId }).then(() => {}, () => {});
}

// ── Conversations — the SAME chat_conversations threads the orb uses, so Reggie has
//    one history everywhere. "legacy" is a sentinel for the page's old un-threaded rows.
async function listConversations(userId: string) {
  try {
    const { data } = await supabase.from("chat_conversations")
      .select("id, title, updated_at").eq("user_id", userId)
      .order("updated_at", { ascending: false }).limit(30);
    return data ?? [];
  } catch { return []; }
}
async function loadConvMessages(convId: string): Promise<Message[]> {
  try {
    const { data } = await supabase.from("chat_logs")
      .select("role, content").eq("conversation_id", convId)
      .order("created_at", { ascending: true }).limit(200);
    return (data ?? []).map(r => ({ role: r.role as Message["role"], content: r.content }));
  } catch { return []; }
}
async function createConversation(userId: string, title: string): Promise<string | null> {
  try {
    const { data } = await supabase.from("chat_conversations")
      .insert({ user_id: userId, title: title.slice(0, 60) }).select("id").single();
    return data?.id ?? null;
  } catch { return null; }
}
function touchConversation(convId: string) {
  supabase.from("chat_conversations").update({ updated_at: new Date().toISOString() }).eq("id", convId).then(() => {}, () => {});
}
async function deleteConversation(convId: string) {
  await supabase.from("chat_conversations").delete().eq("id", convId); // chat_logs cascade
}
function relTime(iso: string | null): string {
  if (!iso) return "";
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 2) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return d === 1 ? "1d" : `${d}d`;
}

/** Delete this page's persisted chat history. Does not touch tutor_mind/tutor_impressions. */
async function clearChatHistory(userId: string) {
  await supabase.from("chat_logs").delete().eq("user_id", userId).eq("page", PAGE);
}

/** Delete the living-mind doc + recent impressions. Does not touch chat_logs. */
async function clearMemory(userId: string) {
  await Promise.all([
    supabase.from("tutor_mind").delete().eq("user_id", userId),
    supabase.from("tutor_impressions").delete().eq("user_id", userId),
  ]);
}

// Compact digest of the student's SYNCED Canvas data for the system prompt. Without
// this the model truthfully-but-wrongly concludes it "can't access Canvas" and tells
// the student to go check Quercus themselves — the exact opposite of the product.
function buildAssignmentDigest(assignments: any[], courses: any[]): string | null {
  if (!Array.isArray(assignments) || assignments.length === 0) return null;
  const now = new Date();
  const courseLabel = (cid: any) => {
    const c = (courses ?? []).find((x: any) => String(x.dbId ?? x.id) === String(cid));
    return c?.courseCode || c?.name || "";
  };
  const fmt = (d: Date) => d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  const unsub = assignments.filter((a: any) => a?.dueAt && !a.submission?.submittedAt);
  const overdue = unsub.filter((a: any) => new Date(a.dueAt) < now);
  const upcoming = unsub
    .filter((a: any) => { const d = new Date(a.dueAt); return d >= now && d.getTime() - now.getTime() < 14 * 86_400_000; })
    .sort((a: any, b: any) => +new Date(a.dueAt) - +new Date(b.dueAt))
    .slice(0, 15);
  const lines = [
    overdue.length ? `OVERDUE (${overdue.length}): ${overdue.slice(0, 5).map((a: any) => `${a.name ?? a.title} (${courseLabel(a.courseId)}, was due ${fmt(new Date(a.dueAt))})`).join("; ")}${overdue.length > 5 ? "; …" : ""}` : "Nothing overdue.",
    upcoming.length
      ? `DUE NEXT 14 DAYS:\n${upcoming.map((a: any) => `- ${a.name ?? a.title} — ${courseLabel(a.courseId)} — due ${fmt(new Date(a.dueAt))}`).join("\n")}`
      : "Nothing due in the next 14 days.",
  ];
  return lines.join("\n");
}

async function ragQuery(userId: string, query: string) {
  try {
    const res = await fetch("/api/rag?action=query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, query, rerank: false }),
    });
    if (!res.ok) return [];
    const d = await res.json();
    return d?.passages ?? [];
  } catch {
    return [];
  }
}

/** Living mind + recent impressions — the cross-session behavioral model. */
async function loadStudentModel(userId: string) {
  try {
    const [{ data: mindData }, { data: impData }] = await Promise.all([
      supabase.from("tutor_mind").select("mind_doc").eq("user_id", userId).maybeSingle(),
      supabase.from("tutor_impressions").select("impression, created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(10),
    ]);
    return { livingMind: mindData?.mind_doc ?? null, impressions: impData ?? [] };
  } catch {
    return { livingMind: null, impressions: [] };
  }
}

/** Teaching-strategy hint + brain/library context — same endpoint NeuralRing uses. */
async function fetchTutorContext(userId: string, userMessage: string, brainPersonId: string | null) {
  try {
    const res = await fetch("/api/tutor-context", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, userMessage, brainPersonId }),
    });
    if (!res.ok) return { context: null, strategyHintId: null, strategyHintKind: null };
    return await res.json();
  } catch {
    return { context: null, strategyHintId: null, strategyHintKind: null };
  }
}

async function claudeReply(messages: any[], system: string): Promise<string> {
  const res = await fetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, system, model: "claude-haiku-4-5-20251001", max_tokens: 1024 }),
  });
  if (!res.ok) throw new Error("Claude error");
  const d = await res.json();
  return d.content ?? "";
}

function UserBubble({ text }: { text: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "16px" }}>
      <div style={{
        maxWidth: "72%",
        background: "rgba(255,255,255,0.07)",
        border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: "18px 18px 4px 18px",
        padding: "12px 16px",
        fontSize: "14px",
        lineHeight: "1.55",
        color: "var(--text-primary)",
      }}>
        {text}
      </div>
    </div>
  );
}

function AssistantBubble({ text, sources, activity }: { text: string; sources?: { title: string; heading?: string }[]; activity?: any[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", marginBottom: "20px" }}>
      {/* Orb indicator */}
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
        <div style={{
          width: 22, height: 22, borderRadius: "50%",
          background: "radial-gradient(circle at 35% 35%, rgba(var(--teal-rgb), 0.8), rgba(0,100,100,0.6))",
          boxShadow: "0 0 8px rgba(var(--teal-rgb), 0.3)",
          flexShrink: 0,
        }} />
        <span style={{ fontSize: "11px", color: "var(--text-dim)", letterSpacing: "0.5px", fontWeight: 600 }}>
          REGGIE
        </span>
      </div>

      {/* react-markdown, same renderer as the orb/DocChat/Spaces — one markdown
          pipeline on web (the room's GsRichText stays separate by design). */}
      <div
        className="sa-md markdown-body"
        style={{
          maxWidth: "88%",
          fontSize: "14px",
          lineHeight: "1.65",
          color: "var(--text-primary)",
        }}
      >
        <Markdown remarkPlugins={[remarkGfm]}>{text}</Markdown>
      </div>

      {/* Premium receipt when this turn recorded its steps; flat chips only as the
          legacy fallback for persisted messages that predate activity capture. */}
      {activity && activity.length > 0 && (
        <div style={{ marginTop: "10px" }}>
          <ActivityDropdown steps={activity} live={false} sources={sources} />
        </div>
      )}
      {!activity && sources && sources.length > 0 && (
        <div style={{ marginTop: "10px" }}>
          <SectionLabel style={{ fontSize: 10, marginBottom: 6 }}>Sources</SectionLabel>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
          {sources.map((s, i) => (
            <span key={i} style={{
              fontSize: "11px",
              padding: "3px 10px",
              borderRadius: "20px",
              background: ACCENT_DIM,
              border: `1px solid ${ACCENT_BORDER}`,
              color: ACCENT,
              fontWeight: 500,
            }}>
              {s.title}{s.heading ? ` — ${s.heading}` : ""}
            </span>
          ))}
          </div>
        </div>
      )}
    </div>
  );
}

function CommandMenu({ commands, highlightedIndex, onSelect }: {
  commands: SlashCommand[];
  highlightedIndex: number;
  onSelect: (cmd: SlashCommand) => void;
}) {
  if (commands.length === 0) return null;
  return (
    <div style={{
      position: "absolute", bottom: "calc(100% + 8px)", left: 0, right: 0,
      background: "rgba(24,26,28,0.98)", border: "1px solid rgba(255,255,255,0.1)",
      borderRadius: "12px", overflow: "hidden", boxShadow: "0 8px 30px rgba(0,0,0,0.4)",
      zIndex: 20,
    }}>
      {commands.map((cmd, i) => (
        <div
          key={cmd.id}
          onMouseDown={e => { e.preventDefault(); onSelect(cmd); }}
          style={{
            padding: "10px 14px",
            background: i === highlightedIndex ? "rgba(var(--teal-rgb), 0.1)" : "transparent",
            cursor: "pointer",
            borderBottom: i < commands.length - 1 ? "1px solid rgba(255,255,255,0.06)" : "none",
          }}
        >
          <div style={{ fontSize: "13px", fontWeight: 600, color: i === highlightedIndex ? ACCENT : "var(--text-primary)" }}>
            {cmd.label}
          </div>
          <div style={{ fontSize: "12px", color: "var(--text-dim)", marginTop: "2px" }}>
            {cmd.description}
          </div>
        </div>
      ))}
    </div>
  );
}

function ConfirmDialog({ command, clearing, onConfirm, onCancel }: {
  command: SlashCommand;
  clearing: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 100,
      background: "rgba(0,0,0,0.5)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: "20px",
    }}>
      <div style={{
        background: "rgba(24,26,28,0.98)", border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: "16px", padding: "22px", maxWidth: "380px", width: "100%",
        boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
      }}>
        <h3 style={{ fontSize: "15px", fontWeight: 600, color: "var(--text-primary)", marginBottom: "10px" }}>
          {command.label}
        </h3>
        <p style={{ fontSize: "13px", color: "var(--text-dim)", lineHeight: 1.5, marginBottom: "20px" }}>
          {command.confirmText}
        </p>
        <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
          <button
            onClick={onCancel}
            disabled={clearing}
            style={{
              background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: "9px", padding: "8px 16px", fontSize: "13px", color: "var(--text-primary)",
              cursor: clearing ? "default" : "pointer", fontFamily: "inherit", opacity: clearing ? 0.5 : 1,
            }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={clearing}
            style={{
              background: "rgba(255,80,80,0.15)", border: "1px solid rgba(255,80,80,0.3)",
              borderRadius: "9px", padding: "8px 16px", fontSize: "13px", fontWeight: 600,
              color: "rgba(255,120,100,0.95)", cursor: clearing ? "default" : "pointer",
              fontFamily: "inherit", opacity: clearing ? 0.6 : 1,
            }}
          >
            {clearing ? "Clearing…" : "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}

function SystemNotice({ text }: { text: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "center", marginBottom: "20px" }}>
      <span style={{
        fontSize: "12px", color: "var(--text-dim)",
        background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: "20px", padding: "5px 14px",
      }}>
        {text}
      </span>
    </div>
  );
}

function ThinkingBubble() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "20px" }}>
      <div style={{
        width: 22, height: 22, borderRadius: "50%",
        background: "radial-gradient(circle at 35% 35%, rgba(var(--teal-rgb), 0.8), rgba(0,100,100,0.6))",
        boxShadow: "0 0 8px rgba(var(--teal-rgb), 0.3)",
        flexShrink: 0,
      }} />
      <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
        {[0, 1, 2].map(i => (
          <div key={i} style={{
            width: 5, height: 5, borderRadius: "50%",
            background: ACCENT,
            opacity: 0.6,
            animation: `saPulse 1.2s ease-in-out ${i * 0.2}s infinite`,
          }} />
        ))}
      </div>
    </div>
  );
}

export default function StudyAssistant() {
  const { userId, userData, activeRoomId, whiteboardSnapshot, assignments, courses } = useApp();
  const [messages, setMessages] = useState<Message[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [liveSteps, setLiveSteps] = useState<any[]>([]); // live work-receipt steps for the in-flight turn
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const isEmpty = messages.length === 0;
  const messagesRef = useRef<Message[]>([]);
  messagesRef.current = messages;

  // ── Conversations: null = fresh new chat · "legacy" = the old un-threaded history ──
  const [convs, setConvs] = useState<{ id: string; title: string | null; updated_at: string | null }[]>([]);
  const [convId, setConvIdState] = useState<string | null>(() => {
    try { return localStorage.getItem("sa_conv_id") || "legacy"; } catch { return "legacy"; }
  });
  const convIdRef = useRef(convId);
  const setConvId = (v: string | null) => {
    convIdRef.current = v; setConvIdState(v);
    try { v ? localStorage.setItem("sa_conv_id", v) : localStorage.removeItem("sa_conv_id"); } catch {}
  };
  const [hasLegacy, setHasLegacy] = useState(false);

  useEffect(() => {
    if (!userId) return;
    listConversations(userId).then(setConvs);
    supabase.from("chat_logs").select("id").eq("user_id", userId).eq("page", PAGE).is("conversation_id", null).limit(1)
      .then(({ data }) => setHasLegacy(!!data?.length), () => {});
  }, [userId]);

  function startNewChat() {
    if (thinking) return;
    setConvId(null); setMessages([]); setHistoryLoaded(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  }
  function selectConversation(id: string) {
    if (thinking || id === convIdRef.current) return;
    setConvId(id); setHistoryLoaded(false);
  }

  // Slash-command popup ("/" menu) + pending destructive-action confirmation.
  const [showCommandMenu, setShowCommandMenu] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [pendingCommand, setPendingCommand] = useState<SlashCommand | null>(null);
  const [clearing, setClearing] = useState(false);
  const filteredCommands = input.startsWith("/")
    ? SLASH_COMMANDS.filter(c => c.label.startsWith(input.trim().toLowerCase()))
    : [];

  // Living-mind + recent impressions — loaded once per session, same pattern
  // NeuralRing already uses, so this assistant benefits from what's been
  // learned about the student across every prior session (any page).
  const [livingMind, setLivingMind] = useState<string | null>(null);
  const [impressions, setImpressions] = useState<{ impression: string; created_at: string }[]>([]);
  // Most recent teaching-strategy hint shown this session, if any — reported
  // back via session-close so the pattern-recognition loop can tell whether
  // it actually helped.
  const usedStrategyRef = useRef<{ id: string | null; kind: string | null }>({ id: null, kind: null });

  useEffect(() => {
    if (!userId) return;
    loadStudentModel(userId).then(({ livingMind, impressions }) => {
      setLivingMind(livingMind);
      setImpressions(impressions);
    });
  }, [userId]);

  // Feed this session into the living-mind rewrite on unmount, same as NeuralRing.
  useEffect(() => {
    return () => {
      const finalMessages = messagesRef.current;
      if (userId && finalMessages.length >= 2) {
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

  // Hydrate the SELECTED conversation (or the legacy un-threaded history).
  useEffect(() => {
    let cancelled = false;
    if (!userId) { setHistoryLoaded(true); return; }
    if (convId === null) { setMessages([]); setHistoryLoaded(true); return; }   // fresh chat
    const load = convId === "legacy" ? loadHistory(userId) : loadConvMessages(convId);
    load.then(hist => {
      if (!cancelled) { setMessages(hist); setHistoryLoaded(true); }
    });
    return () => { cancelled = true; };
  }, [userId, convId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, thinking]);

  // Auto-focus the input once history has resolved (Spotlight-style).
  useEffect(() => { if (historyLoaded) inputRef.current?.focus(); }, [historyLoaded]);

  const send = useCallback(async (text: string) => {
    const q = text.trim();
    if (!q || thinking) return;
    // Slash command typed and submitted directly (e.g. no popup navigation) —
    // intercept before it's treated as a chat message.
    const directCommand = matchSlashCommand(q);
    if (directCommand) {
      setInput("");
      setShowCommandMenu(false);
      setPendingCommand(directCommand);
      return;
    }
    setInput("");
    const userMsg: Message = { role: "user", content: q };
    const priorMessages = messagesRef.current.filter(m => !m.system);
    setMessages(prev => [...prev, userMsg]);
    // Thread: a fresh chat materializes its conversation on first send, titled by it.
    let convForLog: string | null = convIdRef.current && convIdRef.current !== "legacy" ? convIdRef.current : null;
    if (userId && convIdRef.current === null) {
      const id = await createConversation(userId, q);
      if (id) { setConvId(id); convForLog = id; listConversations(userId).then(setConvs); }
    }
    if (userId) logMessage(userId, "user", q, convForLog);
    if (convForLog) touchConversation(convForLog);
    setThinking(true);
    // The work receipt: this pipeline's REAL steps, narrated as they run. Same
    // component the orb uses — the page just feeds it its own stages.
    let act: { label: string; status: string; sources?: { title: string }[] }[] = [
      { label: "searching your materials", status: "running" },
      { label: "reading your course context", status: "running" },
    ];
    setLiveSteps([...act]);
    const stepDone = (label: string, srcs?: { title: string }[]) => {
      act = act.map(st => st.label === label ? { ...st, status: "ok", ...(srcs?.length ? { sources: srcs } : {}) } : st);
      setLiveSteps([...act]);
    };

    try {
      const wantsWhiteboard = WHITEBOARD_INTENT_RE.test(q);
      const wantsRoomChat = ROOM_CHAT_INTENT_RE.test(q);

      const [passages, tutorCtx, roomChatRows] = await Promise.all([
        ragQuery(userId, q).then(p => {
          const seen = new Set<string>();
          const titles = (p ?? []).map((x: any) => ({ title: x.title })).filter((x: any) => x.title && !seen.has(x.title) && seen.add(x.title) !== undefined);
          stepDone("searching your materials", titles);
          return p;
        }),
        fetchTutorContext(userId, q, userData?.brain_person_id ?? null).then(c => { stepDone("reading your course context"); return c; }),
        (wantsRoomChat && activeRoomId) ? loadRecentMessages(userId, activeRoomId, 10).catch(() => []) : Promise.resolve([]),
      ]);
      act = [...act, { label: "writing the answer", status: "running" }];
      setLiveSteps([...act]);

      if (tutorCtx.strategyHintId) {
        usedStrategyRef.current = { id: tutorCtx.strategyHintId, kind: tutorCtx.strategyHintKind ?? null };
      }

      const hasSources = Array.isArray(passages) && passages.length > 0;
      const ragContext = hasSources
        ? passages.map((p: any, i: number) =>
            `[${i + 1}] ${p.title}${p.heading ? " — " + p.heading : ""}${p.loc ? ` (${p.loc})` : ""}\n${p.text}`
          ).join("\n\n")
        : null;

      const impressionContext = impressions.slice(0, 5).map(i => `• ${i.impression}`).join("\n");

      const roomChatContext = (roomChatRows || [])
        .slice(-10)
        .map((m: any) => `  • ${m.name}: ${m.body}`)
        .join("\n") || null;

      // Whiteboard vision: only when explicitly asked, and only if the student
      // is (or was recently) in a Study Room with a captured snapshot. The
      // whiteboard is session-only/unpersisted by design, so this snapshot —
      // bridged through AppContext from StudyRooms.tsx — is the only record.
      let whiteboardImage: string | null = null;
      let whiteboardNote: string | null = null;
      if (wantsWhiteboard) {
        if (whiteboardSnapshot?.dataUrl) {
          whiteboardImage = whiteboardSnapshot.dataUrl.split(",")[1] ?? null;
        }
        if (!whiteboardImage) {
          whiteboardNote = "NOTE: the student asked about a whiteboard, but no snapshot is available right now — tell them to open the Board panel in their Study Room and ask again.";
        }
      }

      const asgDigest = buildAssignmentDigest(assignments as any[], courses as any[]);
      const system = [
        "You are Reggie — the student's private, main academic tutor. You know this student across sessions: their patterns, work habits, and any study materials they've uploaded.",
        "Only help with the student's own enrolled courses, university curriculum, and their own imported materials, or general study skills — politely decline or redirect clearly off-topic, non-academic requests.",
        asgDigest
          ? `\nLIVE CANVAS DATA — FschoolAI syncs the student's Canvas/Quercus account automatically; the data below IS from their real account, kept fresh by the app. You DO have Canvas access through the platform. NEVER tell the student to log into Canvas/Quercus to check deadlines (answer from this data), never claim you lack Canvas access, and never lecture about Canvas tokens — the app manages the connection. If earlier turns in this conversation said you cannot see Canvas or told the student to check Quercus themselves, that was WRONG — briefly correct yourself and answer directly from this data now. Factual schedule questions ("what's due", "what homework do I have") are ALWAYS answered directly from this data — teaching independence never means withholding the student's own deadlines, whatever your student model suggests.\n${asgDigest}`
          : "\nNOTE: the student's Canvas sync hasn't loaded any assignments yet this session. If asked about deadlines, say the sync is still loading and suggest checking the Home page — do NOT claim you fundamentally lack Canvas access; the platform syncs it automatically.",
        "Be concise, clear, and academically rigorous. Avoid unnecessary filler. Answer in 2-4 sentences unless the student asks for more detail.",
        hasSources
          ? `\n\nSOURCE MATERIAL (retrieved from the student's own library):\n${ragContext}\n\nBase your answer primarily on this material. Cite source numbers like [1] when relevant.`
          : "\n\nThe student has not yet imported materials relevant to this question. Answer helpfully from general knowledge but gently encourage them to import related documents.",
        livingMind ? `\nWHAT YOU KNOW ABOUT THIS STUDENT (living mind, built across all their sessions):\n${livingMind}` : "",
        impressionContext ? `\nRECENT IMPRESSIONS:\n${impressionContext}` : "",
        tutorCtx.context ? `\n${tutorCtx.context}` : "",
        roomChatContext ? `\nROOM CHAT (shared discussion in the student's current Study Room, already visible to everyone in that room):\n${roomChatContext}` : "",
        whiteboardNote ? `\n${whiteboardNote}` : "",
      ].filter(Boolean).join(" ");

      // Sanitize before sending to Claude — drops empties and merges same-role
      // turns so history can't be poisoned. Image turn is built separately and
      // appended after sanitizing, since sanitizeApiMessages collapses non-string
      // content to "".
      const priorApiMessages = sanitizeApiMessages([...priorMessages, userMsg]).slice(-MAX_CONTEXT_TURNS);
      const apiMessages = whiteboardImage
        ? [
            ...priorApiMessages.slice(0, -1),
            { role: "user", content: [
                { type: "image", source: { type: "base64", media_type: "image/png", data: whiteboardImage } },
                { type: "text", text: q },
              ] },
          ]
        : priorApiMessages;

      const reply = await claudeReply(apiMessages, system);
      stepDone("writing the answer");

      // Dedupe source chips by document (multiple passages often share a title).
      const seen = new Set<string>();
      const sources: { title: string; heading?: string }[] = hasSources
        ? passages
            .map((p: any) => ({ title: p.title, heading: p.heading }))
            .filter((s: { title: string; heading?: string }) => {
              const k = `${s.title}|${s.heading ?? ""}`;
              if (seen.has(k)) return false;
              seen.add(k);
              return true;
            })
            .slice(0, 4)
        : [];

      setMessages(prev => [...prev, { role: "assistant", content: reply, sources, activity: act }]);
      if (userId) logMessage(userId, "assistant", reply, convForLog);
    } catch {
      const fallback = "Sorry, something went wrong. Please try again.";
      setMessages(prev => [...prev, { role: "assistant", content: fallback }]);
      if (userId) logMessage(userId, "assistant", fallback, convForLog);
    } finally {
      setThinking(false);
      setLiveSteps([]);
    }
  }, [userId, userData, thinking, activeRoomId, whiteboardSnapshot, livingMind, impressions, assignments, courses]);

  /** Picks a command from the "/" popup — opens the confirm step, doesn't execute yet. */
  const selectCommand = useCallback((cmd: SlashCommand) => {
    setInput("");
    setShowCommandMenu(false);
    setPendingCommand(cmd);
  }, []);

  /** Runs a confirmed slash command, then closes the confirm dialog. */
  const executeCommand = useCallback(async (cmd: SlashCommand) => {
    if (!userId) { setPendingCommand(null); return; }
    setClearing(true);
    try {
      if (cmd.id === "clear-chat" || cmd.id === "clear-all") {
        const cur = convIdRef.current;
        if (cur && cur !== "legacy") {
          // Threaded chat: delete the conversation (logs cascade) and start fresh.
          await deleteConversation(cur);
          setConvs(cs => cs.filter(c => c.id !== cur));
          setConvId(null);
        } else {
          await clearChatHistory(userId);
        }
      }
      if (cmd.id === "clear-memory" || cmd.id === "clear-all") {
        await clearMemory(userId);
        setLivingMind(null);
        setImpressions([]);
      }
      const notice = cmd.id === "clear-chat" ? "Chat cleared."
        : cmd.id === "clear-memory" ? "Memory cleared."
        : "Everything cleared.";
      const noticeMsg: Message = { role: "assistant", content: notice, system: true };
      setMessages(cmd.id === "clear-memory" ? prev => [...prev, noticeMsg] : [noticeMsg]);
    } finally {
      setClearing(false);
      setPendingCommand(null);
    }
  }, [userId]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showCommandMenu && filteredCommands.length > 0) {
      if (e.key === "ArrowDown") { e.preventDefault(); setHighlightedIndex(i => (i + 1) % filteredCommands.length); return; }
      if (e.key === "ArrowUp")   { e.preventDefault(); setHighlightedIndex(i => (i - 1 + filteredCommands.length) % filteredCommands.length); return; }
      if (e.key === "Escape")   { e.preventDefault(); setShowCommandMenu(false); return; }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        selectCommand(filteredCommands[highlightedIndex] ?? filteredCommands[0]);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  };

  // Auto-resize textarea
  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setInput(value);
    setShowCommandMenu(value.startsWith("/"));
    setHighlightedIndex(0);
    e.target.style.height = "auto";
    e.target.style.height = Math.min(e.target.scrollHeight, 160) + "px";
  };

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      // Fill the shell's viewport-locked column exactly (App.tsx .page-locked makes
      // .app-main a flex column sized to the viewport minus the real header height —
      // no more hardcoded calc(100dvh - 56px) drifting out of sync with shell padding).
      flex: 1,
      minHeight: 0,
      position: "relative",
    }}>
      <style>{`
        @keyframes saPulse {
          0%, 100% { transform: translateY(0); opacity: 0.4; }
          50%       { transform: translateY(-4px); opacity: 1; }
        }
        .sa-md p { margin: 0 0 10px; }
        .sa-md p:last-child { margin-bottom: 0; }
        .sa-md ul { margin: 6px 0; padding-left: 20px; }
        .sa-md li { margin: 2px 0; }
        .sa-md strong { font-weight: 650; color: var(--text-primary); }
        .sa-input::placeholder { color: rgba(255,255,255,0.28); }
        .sa-input:focus { outline: none; }
        .sa-suggestion:hover {
          background: rgba(var(--teal-rgb), 0.1) !important;
          border-color: rgba(var(--teal-rgb), 0.28) !important;
          color: rgba(var(--teal-rgb), 0.9) !important;
        }
        .sa-send:hover:not(:disabled) { background: rgba(var(--teal-rgb), 0.85) !important; }
        .sa-send:disabled { opacity: 0.4; cursor: default; }
        .sa-rail { display: none; }
        @media (min-width: 900px) { .sa-rail { display: flex; } }
        .sa-conv-item:hover { background: rgba(255,255,255,0.05) !important; }
      `}</style>

      {/* ── Two panes: conversation rail (desktop) + the chat itself ── */}
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <div className="sa-rail" style={{ width: 228, flexShrink: 0, flexDirection: "column", gap: 3, borderRight: "1px solid rgba(255,255,255,0.07)", padding: "2px 14px 12px 0", marginRight: 22, overflowY: "auto" }}>
          <button onClick={startNewChat} style={{
            display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left",
            background: "rgba(var(--teal-rgb),0.1)", border: "1px solid rgba(var(--teal-rgb),0.25)",
            borderRadius: 10, padding: "9px 12px", fontSize: 13, fontWeight: 600,
            color: "rgba(var(--teal-rgb),0.95)", cursor: "pointer", fontFamily: "inherit", marginBottom: 8,
          }}>+ New chat</button>
          {convs.map(c => (
            <button key={c.id} className="sa-conv-item" onClick={() => selectConversation(c.id)} style={{
              display: "flex", alignItems: "baseline", gap: 8, width: "100%", textAlign: "left",
              background: convId === c.id ? "rgba(255,255,255,0.07)" : "transparent",
              border: "1px solid " + (convId === c.id ? "rgba(255,255,255,0.12)" : "transparent"),
              borderRadius: 9, padding: "8px 11px", cursor: "pointer", fontFamily: "inherit",
            }}>
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12.5, color: convId === c.id ? "var(--text-primary)" : "var(--text-secondary)" }}>{c.title || "New chat"}</span>
              <span style={{ fontSize: 10, color: "var(--text-dim)", flexShrink: 0 }}>{relTime(c.updated_at)}</span>
            </button>
          ))}
          {hasLegacy && (
            <button className="sa-conv-item" onClick={() => selectConversation("legacy")} style={{
              display: "flex", alignItems: "baseline", gap: 8, width: "100%", textAlign: "left",
              background: convId === "legacy" ? "rgba(255,255,255,0.07)" : "transparent",
              border: "1px solid " + (convId === "legacy" ? "rgba(255,255,255,0.12)" : "transparent"),
              borderRadius: 9, padding: "8px 11px", cursor: "pointer", fontFamily: "inherit", marginTop: 4,
            }}>
              <span style={{ flex: 1, fontSize: 12.5, color: "var(--text-dim)" }}>Earlier messages</span>
            </button>
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>

      {/* ── Empty state: centered input ───────────────────────────────── */}
      {isEmpty && historyLoaded && (
        <div style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "24px 20px",
          gap: "28px",
        }}>
          {/* Orb + title */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "14px" }}>
            <div style={{
              width: 52, height: 52, borderRadius: "50%",
              background: "radial-gradient(circle at 35% 35%, rgba(var(--teal-rgb), 0.85), rgba(0,80,80,0.7))",
              boxShadow: "0 0 32px rgba(var(--teal-rgb), 0.25), 0 0 0 1px rgba(var(--teal-rgb), 0.2)",
            }} />
            <div style={{ textAlign: "center" }}>
              <h2 style={{
                fontSize: "22px", fontWeight: 600,
                color: "var(--text-primary)", letterSpacing: "-0.4px", marginBottom: "4px",
              }}>
                Reggie
              </h2>
              <p style={{ fontSize: "13px", color: "var(--text-dim)", lineHeight: 1.5 }}>
                Ask anything from your imported materials
              </p>
            </div>
          </div>

          {/* Centered input box */}
          <div style={{ position: "relative", width: "min(520px, 100%)" }}>
            {showCommandMenu && (
              <CommandMenu commands={filteredCommands} highlightedIndex={highlightedIndex} onSelect={selectCommand} />
            )}
            <InputBox
              value={input}
              onChange={handleInput}
              onKeyDown={handleKeyDown}
              onSend={() => send(input)}
              thinking={thinking}
              inputRef={inputRef}
              centered
            />
          </div>

          {/* Suggestion chips */}
          <div style={{
            display: "flex", flexWrap: "wrap", gap: "8px",
            justifyContent: "center", maxWidth: "520px",
          }}>
            {SUGGESTIONS.map(s => (
              <button
                key={s}
                className="sa-suggestion"
                onClick={() => send(s)}
                style={{
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: "20px",
                  padding: "8px 14px",
                  fontSize: "12px",
                  color: "var(--text-dim)",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  transition: "all 0.15s",
                }}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Conversation view ─────────────────────────────────────────── */}
      {!isEmpty && (
        <>
          {/* Scroll container spans the FULL chat pane (scrollbar at the far edge, not
              mid-page); the message column centers inside it with room to breathe.
              The mask fades the CONTENT near the input instead of painting a backdrop
              band over the page glow — natural over any background/theme. */}
          <div style={{
            flex: 1, overflowY: "auto", boxSizing: "border-box",
            WebkitMaskImage: "linear-gradient(to bottom, black calc(100% - 20px), transparent)",
            maskImage: "linear-gradient(to bottom, black calc(100% - 20px), transparent)",
          }}>
            <div style={{ maxWidth: "800px", width: "100%", margin: "0 auto", padding: "28px 24px 16px", boxSizing: "border-box" }}>
            {messages.map((m, i) =>
              m.system
                ? <SystemNotice key={i} text={m.content} />
                : m.role === "user"
                  ? <UserBubble key={i} text={m.content} />
                  : <AssistantBubble key={i} text={m.content} sources={m.sources} activity={m.activity} />
            )}
            {thinking && (liveSteps.length ? <div style={{ marginBottom: 20 }}><ActivityDropdown steps={liveSteps} live /></div> : <ThinkingBubble />)}
            <div ref={bottomRef} />
            </div>
          </div>

          {/* Pinned bottom input — full-width strip, centered column inside.
              No painted backdrop: the input is a flex SIBLING of the scroller (messages
              never pass underneath), so a gradient here just draws a dark band over the
              page's ambient glow. The soft fade lives on the scroller's mask instead. */}
          <div style={{
            padding: "12px 24px 20px",
            boxSizing: "border-box",
          }}>
          <div style={{ maxWidth: "800px", width: "100%", margin: "0 auto", boxSizing: "border-box", position: "relative" }}>
            {showCommandMenu && (
              <CommandMenu commands={filteredCommands} highlightedIndex={highlightedIndex} onSelect={selectCommand} />
            )}
            <InputBox
              value={input}
              onChange={handleInput}
              onKeyDown={handleKeyDown}
              onSend={() => send(input)}
              thinking={thinking}
              inputRef={inputRef}
              centered={false}
            />
          </div>
          </div>
        </>
      )}
        </div>
      </div>

      {pendingCommand && (
        <ConfirmDialog
          command={pendingCommand}
          clearing={clearing}
          onConfirm={() => executeCommand(pendingCommand)}
          onCancel={() => setPendingCommand(null)}
        />
      )}
    </div>
  );
}

interface InputBoxProps {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onSend: () => void;
  thinking: boolean;
  inputRef: React.RefObject<HTMLTextAreaElement>;
  centered: boolean;
}

function InputBox({ value, onChange, onKeyDown, onSend, thinking, inputRef, centered }: InputBoxProps) {
  return (
    <div style={{
      display: "flex",
      alignItems: "flex-end",
      gap: "10px",
      width: centered ? "min(520px, 100%)" : "100%",
      background: "rgba(255,255,255,0.05)",
      border: "1px solid rgba(255,255,255,0.12)",
      borderRadius: "16px",
      padding: "12px 14px",
      boxSizing: "border-box",
      boxShadow: centered ? "0 8px 40px rgba(0,0,0,0.4), 0 0 0 1px rgba(var(--teal-rgb), 0.06)" : undefined,
      transition: "border-color 0.15s",
    }}
      onFocus={() => {}} // border highlight handled via CSS if needed
    >
      <textarea
        ref={inputRef}
        className="sa-input"
        value={value}
        onChange={onChange}
        onKeyDown={onKeyDown}
        placeholder="Ask anything from your library…"
        rows={1}
        style={{
          flex: 1,
          background: "none",
          border: "none",
          resize: "none",
          fontFamily: "inherit",
          fontSize: "14px",
          lineHeight: "1.5",
          color: "var(--text-primary)",
          overflowY: "hidden",
          minHeight: "21px",
          maxHeight: "160px",
        }}
      />
      <button
        className="sa-send"
        onClick={onSend}
        disabled={!value.trim() || thinking}
        style={{
          width: 34, height: 34, flexShrink: 0,
          borderRadius: "10px",
          background: value.trim() && !thinking ? ACCENT : "rgba(var(--teal-rgb), 0.15)",
          border: "none",
          cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
          transition: "background 0.15s, opacity 0.15s",
        }}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={value.trim() && !thinking ? "#000" : ACCENT} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 19V5M5 12l7-7 7 7" />
        </svg>
      </button>
    </div>
  );
}

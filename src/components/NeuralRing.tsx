// NeuralRing.jsx — Draggable floating AI assistant button + chat sheet.
//
// Behaviour:
//  • Drag freely anywhere on screen; stays exactly where released (free placement, no corner snap).
//  • Position is global and persists across page navigation.
//  • Ring hides (opacity 0, pointer-events none) while the chat is open.
//  • Chat is a non-modal floating window (bottom-right); the app stays interactive while open.
//  • Chat can be closed by the × button, swiping down on the drag handle, or a navigation command.
//  • Renders via createPortal into document.body to escape any ancestor overflow/stacking context.
//  • Ring name label below the sphere is editable and saved to Supabase users.ring_name.
//  • Voice mode: mute toggle in header. When unmuted, AI replies are spoken via ElevenLabs TTS.

import { useRef, useEffect, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { groq }       from "../api/groq";
import { claude }      from "../api/claude";
import { useApp }      from "../context/AppContext";
import { supabase }    from "../api/supabase";
import { awardTokens } from "../api/tokens";
import { sanitizeApiMessages } from "../lib/chatMessages";
import { buildRetrievalQuery } from "../lib/ragQuery";
import { replaceFlashcardDeck } from "../lib/flashcardsSave";
import { ensureTutorReply } from "../lib/tutorReply";
import { parseVoiceTags, stripAgentJSON } from "../lib/voiceTags";
import { createSentenceChunker } from "../lib/ttsChunker";
import { startScribeSession, isStreamingSTT } from "../lib/scribeStream";
import { streamReggie } from "../lib/reggieStream";
import { Send, Square, Plus, ThumbsUp, ThumbsDown, Check, RotateCcw, Play, Mic } from "lucide-react";
import { createDictation } from "../lib/dictation";
import { GOLD, CREAM, INK_WARM, GOLD_RGB } from "../lib/theme";
import ArtifactPanel   from "./ArtifactPanel";
import Markdown from 'react-markdown';
import remarkGfm from "remark-gfm";
import '../css/markdown.css';

// ── Claude proxy helper (tutor brain — better quality than Groq for conversation) ──
// Returns the full proxy response: { content, contentBlocks, stop_reason, usage }.
// `tools` is optional; when present the caller drives a tool-use loop.
async function claudeTutor(messages, system, signal?, tools?) {
  const res = await fetch("/api/claude", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, system, max_tokens: 400, ...(tools ? { tools } : {}) }),
    signal,  // abort signal from stopResponse()
  });
  if (!res.ok) throw new Error(`Claude proxy ${res.status}`);
  // /api/claude returns { content, contentBlocks, stop_reason, usage }. The chat
  // paths consume the joined text STRING (parseVoiceTags/nav parsing call .trim()
  // etc.), and groq() returns a string too — so return the text to match that
  // contract. Returning the raw object here made `raw` an object → parseVoiceTags'
  // `cleaned.trim()` threw → "Something went wrong." (regression from the merge
  // that dropped the tool-use loop, which was the only caller needing the object).
  const data = await res.json();
  return data.content ?? "";
}


const NAV_REGEX      = /<\s*n?\s*nav[^>]*>([\s\S]*?)<\/\s*n?\s*nav\s*>/i;
const NAV_STRIP_REGEX = /<\s*n?\s*nav[\s\S]*$/i;
const ARTIFACT_REGEX = /<artifact>([\s\S]*?)<\/artifact>/i;

const VIZ_KEYWORDS = [
  "chart", "graph", "visuali", "plot", "diagram", "dashboard", "histogram", "scatter", "heatmap",
  "build", "create", "make me", "make a", "build me",
  "interactive", "animation", "animate", "simulat",
  "timer", "calculator", "tracker", "kanban", "game", "snake",
  "flashcard", "quiz", "pomodoro", "calendar", "planner", "budget",
  "sorting", "pathfinding", "neural", "algorithm",
];
const NAV_OVERRIDE_KEYWORDS = [
  "go to", "navigate", "open", "show my", "what are my",
  "study plan", "remind me", "schedule", "assignment",
  // Quiz intents — must bypass viz routing and go through normal Claude path
  // so the [QUIZ_START] format triggers InlineQuiz
  "quiz me", "quiz on", "quiz about", "test me on", "test me about",
  "ask me questions", "ask me about", "flashcard me", "drill me",
];

// Friendly "what Reggie is doing" labels for the live tool-progress line (Reggie mode).
const REGGIE_TOOL_LABELS = {
  canvas_get_grades: "checking your grades", canvas_get_upcoming: "checking what's due",
  compute_grade_weights: "computing grade weights", rag_search: "searching your materials",
  generate_quiz: "building a quiz", evaluate_answers: "grading your answers",
  generate_study_plan: "building a study plan", generate_framework: "mapping the concepts",
  list_flashcards: "loading your flashcards", save_flashcards: "saving flashcards",
  summarize_text: "summarizing", what_if_plan: "running the what-if", token_summary: "checking your points",
};
const reggieToolLabel = (n) => REGGIE_TOOL_LABELS[n] || (n || "").replace(/_/g, " ");

/* Manus-style tool-activity dropdown: collapsed shows the CURRENT fetch while
   streaming ("searching your materials…"), or a summary once done; expanding
   reveals the timeline of every pull with its outcome + the sources it hit. */
function ActivityDropdown({ steps, live }) {
  const [open, setOpen] = useState(false);
  if (!steps?.length) return null;
  const running = steps.find(s => s.status === "running");
  const label = live && running ? `${running.label}…`
    : `Pulled info · ${steps.length} step${steps.length > 1 ? "s" : ""}`;
  return (
    <div style={{ marginBottom: 8, fontSize: 12 }}>
      <button onClick={() => setOpen(o => !o)} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, padding: "5px 10px", color: "var(--text-secondary)", cursor: "pointer", fontFamily: "inherit", fontSize: 12 }}>
        {live && running ? <span className="nr-dot" /> : <span style={{ color: "rgb(var(--teal-rgb))" }}>✓</span>}
        <span>{label}</span>
        <span style={{ opacity: 0.5 }}>{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div style={{ marginTop: 6, borderLeft: "2px solid rgba(var(--teal-rgb),0.3)", paddingLeft: 10, display: "flex", flexDirection: "column", gap: 4 }}>
          {steps.map((st, i) => (
            <div key={i} style={{ color: "var(--text-dim)" }}>
              {st.status === "running" ? "…" : st.status === "ok" ? "✓" : "⚠"} {st.label}
              {st.sources?.length ? <span style={{ opacity: 0.75 }}> — {st.sources.slice(0, 3).map(x => x.title).join(", ")}</span> : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function isVizRequest(text) {
  const lower = text.toLowerCase();
  if (NAV_OVERRIDE_KEYWORDS.some(kw => lower.includes(kw))) return false;
  return VIZ_KEYWORDS.some(kw => lower.includes(kw));
}

// Reggie mode uses a STRICT viz gate: only unambiguous artifact asks (charts, diagrams,
// games, timers…). The broad list's generic verbs ("create", "make me") and study words
// ("flashcard", "quiz", "planner") would hijack requests Reggie's real tools should
// handle — "create flashcards for BIO120" must reach save_flashcards, not a sample-data
// React widget. Classic mode keeps the broad gate (its only builder IS the artifact path).
const VIZ_KEYWORDS_STRICT = [
  "chart", "graph", "visuali", "plot", "diagram", "dashboard", "histogram", "scatter", "heatmap",
  "interactive", "animation", "animate", "simulat",
  "timer", "calculator", "kanban", "game", "snake", "pomodoro",
  "sorting", "pathfinding",
];
function isStrictVizRequest(text) {
  const lower = text.toLowerCase();
  if (NAV_OVERRIDE_KEYWORDS.some(kw => lower.includes(kw))) return false;
  return VIZ_KEYWORDS_STRICT.some(kw => lower.includes(kw));
}

function parseArtifact(raw) {
  // Primary: wrapped in <artifact> tags
  const m = raw.match(ARTIFACT_REGEX);
  if (m) return { code: m[1].trim(), text: raw.replace(ARTIFACT_REGEX, "").trim() || "Here's your visualization." };

  // Fallback: response looks like raw component code (Claude skipped the tags)
  const looksLikeCode = /function\s+App\s*[({]|const\s+App\s*=|return\s*\(\s*</.test(raw);
  if (looksLikeCode) return { code: raw.trim(), text: "Here's your visualization." };

  return { code: null, text: raw };
}

const VIZ_SYSTEM = `You are a data visualization expert. Create stunning interactive React visualizations.

STRICT RULES — breaking any of these will cause a crash:
1. Wrap your ENTIRE component in <artifact></artifact> tags. Nothing outside the tags.
2. The component MUST be named App: function App() { ... } or const App = () => { ... }
3. NO import or export statements — everything is already available as a global.
4. NO TypeScript — plain JavaScript only. No type annotations, no interfaces, no generics.
5. Use only these pre-loaded globals (do NOT redeclare them):
   - React hooks: useState, useEffect, useCallback, useMemo, useRef
   - Recharts: LineChart, Line, BarChart, Bar, PieChart, Pie, AreaChart, Area,
     RadarChart, Radar, ScatterChart, Scatter, Cell, XAxis, YAxis, CartesianGrid,
     Tooltip, Legend, ResponsiveContainer, PolarGrid, PolarAngleAxis, PolarRadiusAxis
6. Use realistic sample data when no real data is provided.
7. Design language: dark background ${INK_WARM}, gold accent ${GOLD}, cream text ${CREAM}. NEVER neon green, neon yellow, or bright saturated accents.
8. Make it interactive where it makes sense (buttons, sliders, hover effects).
9. Return ONLY the <artifact> block — no explanation, no markdown fences, nothing else.`;

/** Log chat message to Supabase chat_logs (non-blocking) */
async function logChat(userId, role, content, page, conversationId) {
  try {
    await supabase.from("chat_logs").insert({
      user_id: userId, role, content, page: page ?? null,
      conversation_id: conversationId ?? null,
      created_at: new Date().toISOString(),
    });
  } catch { /* non-fatal */ }
}

/** Relative time label for the conversation list, e.g. "3h ago". */
function relativeTime(iso) {
  if (!iso) return "";
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1)    return "just now";
  if (mins < 60)   return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)    return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7)    return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Lightweight inline formatter for streaming text — no block elements so partial HTML is safe */
function renderStreamingHTML(text) {
  let s = text
    .replace(/&/g,  "&amp;")
    .replace(/</g,  "&lt;")
    .replace(/>/g,  "&gt;");
  s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/^(\d+)\.\s+(.+)$/gm, '<p style="margin:2px 0">$1. $2</p>');
  s = s.replace(/\n/g, "<br/>");
  return s;
}

/** Render tutor message markdown as safe HTML (no dependency) */
export function renderMessageHTML(text) {
  let s = text
    .replace(/&/g,  "&amp;")
    .replace(/</g,  "&lt;")
    .replace(/>/g,  "&gt;");
  // Bold
  s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  // Numbered list items
  s = s.replace(/^(\d+)\.\s+(.+)$/gm, '<p style="margin:3px 0;padding-left:2px">$1. $2</p>');
  // Bullet items
  s = s.replace(/^[-•] (.+)$/gm, "<li>$1</li>");
  // Wrap runs of <li> in <ul>
  s = s.replace(/(<li>[\s\S]*?<\/li>)/g, m =>
    m.startsWith("<ul>") ? m : "<ul>" + m + "</ul>"
  );
  s = s.replace(/<\/ul>\s*<ul>/g, "");   // merge adjacent lists
  // Paragraph breaks
  s = s.replace(/\n\n/g, "</p><p>");
  s = s.replace(/\n/g,   "<br/>");
  return "<p>" + s + "</p>";
}

/** Parse [QUIZ_START]...[QUIZ_END] block from a Claude response */
function parseQuiz(text) {
  const match = text.match(/\[QUIZ_START\]([\s\S]*?)\[QUIZ_END\]/);
  if (!match) return null;
  const cards = match[1].trim().split("\n")
    .filter(l => l.includes("Q:") && l.includes(" | ") && l.includes("A:"))
    .map(l => {
      const [q, a] = l.split(" | ");
      return {
        q: (q || "").replace(/^Q:\s*/i, "").trim(),
        a: (a || "").replace(/^A:\s*/i, "").trim(),
      };
    })
    .filter(c => c.q && c.a);
  return cards.length > 0 ? cards : null;
}

/** Load this user's conversations, most recently active first. */
async function loadConversations(userId) {
  try {
    const { data } = await supabase
      .from("chat_conversations")
      .select("id, title, updated_at")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(50);
    return data ?? [];
  } catch {
    return [];
  }
}

/** Load one conversation's messages, oldest first. */
async function loadConversationMessages(conversationId) {
  try {
    const { data } = await supabase
      .from("chat_logs")
      .select("role, content, created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true })
      .limit(100);
    return (data ?? []).map(r => ({ role: r.role, content: r.content }));
  } catch {
    return [];
  }
}

/** Return assignments due within 48h that aren't submitted */
function getUrgentAssignments(assignments) {
  const now = Date.now();
  const h48 = 48 * 60 * 60 * 1000;
  return (assignments || []).filter(a => {
    if (!a.dueAt || a.submission?.submittedAt) return false;
    const diff = new Date(a.dueAt).getTime() - now;
    return diff > 0 && diff <= h48;
  });
}

function buildChatSystem() {
  return `You are the student's personal AI study tutor inside FschoolAI — friendly, encouraging, and genuinely helpful. When the student's context (their courses, assignments, deadlines, grades) is provided below, it is REAL and current: use it directly to answer their questions.

PAGES (for navigation): work, canvas, assignment, study, courses, identity, leaderboard, toolkit

NAVIGATION: When the student wants to GO somewhere or open a page, append this EXACTLY at the end of your reply:
<nav>{"page":"pagename"}</nav>

USING THEIR DATA — IMPORTANT:
- If you can see their courses or assignments in the context below, you ARE connected to their data. NEVER tell the student to "connect Canvas", "sync Canvas", or that Canvas "isn't connected" when you can already see their courses/assignments — that's confusing and wrong.
- Missing grades/scores do NOT mean Canvas is disconnected. It usually means grades simply aren't posted yet, or the course was added manually. Say that plainly ("no grades are posted yet") and help with what you have — don't nag about syncing.
- Only suggest connecting an LMS if there are genuinely NO courses AND NO assignments in the context at all.
- Never invent a specific grade, GPA, score, or deadline you can't see. If a number isn't in the data, say it isn't available yet — don't fabricate it, and don't blame a missing connection.

ABOUT FSCHOOLAI (for product/navigation questions): an AI academic platform that syncs with Canvas, organizes courses/assignments, and gives each student a personal AI tutor — plus flashcards, study guides, an assignment tracker, GPA view, Study Rooms, and a leaderboard.

STYLE: Warm and concise. Explain concepts as fully as the question needs; keep logistics/navigation answers short. Answer general and academic questions directly, like a knowledgeable tutor.`;
}


function parseNav(raw) {
  const tagMatch = raw.match(NAV_REGEX);
  if (tagMatch) {
    try {
      const cmd  = JSON.parse(tagMatch[1].trim());
      const text = raw.replace(NAV_REGEX, "").replace(NAV_STRIP_REGEX, "").trim();
      return { cmd, text };
    } catch {}
  }
  const bareMatch = raw.match(/(\{[^{}]*"page"\s*:[^{}]*\})\s*$/);
  if (bareMatch) {
    try {
      const cmd = JSON.parse(bareMatch[1]);
      if (cmd.page) return { cmd, text: raw.slice(0, raw.lastIndexOf(bareMatch[1])).replace(NAV_STRIP_REGEX, "").trim() };
    } catch {}
  }
  return { cmd: null, text: raw.replace(NAV_STRIP_REGEX, "").trim() };
}

// ── Tone presets — map intent tag values to ElevenLabs voice_settings ───────
const TONE_PRESETS = {
  calm:      { stability: 0.8, similarity_boost: 0.75, style: 0.1 },
  energetic: { stability: 0.3, similarity_boost: 0.8,  style: 0.6 },
  neutral:   { stability: 0.5, similarity_boost: 0.75, style: 0.3 },
  serious:   { stability: 0.7, similarity_boost: 0.7,  style: 0.2 },
};

// ── Voice command matchers — detected in STT transcript before hitting Claude ─
const VOICE_STOP_WORDS   = /^(stop|wait|hold on|pause|cancel|never ?mind|no|nope)\b\.?$/i;
const VOICE_REPEAT_WORDS = /^(say that again|repeat|repeat that|again|what did you say|come again|huh)\??\.?$/i;
const VOICE_SPEED_FAST   = /\b(faster|speed up|too slow|quicker|hurry)\b/i;
const VOICE_SPEED_SLOW   = /\b(slower|slow down|too fast|slow it down)\b/i;

// Voice intent tag parsing + stray-tool-JSON stripping live in src/lib/voiceTags.ts
// (shared with Reggie mode + unit-tested there).

// ── ElevenLabs TTS ─────────────────────────────────────────────────────────
// AudioContext bypasses iOS Safari autoplay restrictions.
let _audioCtx = null;
function getAudioContext() {
  if (!_audioCtx) _audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  if (_audioCtx.state === "suspended") _audioCtx.resume();
  return _audioCtx;
}

// Sanitize text before sending to TTS.
// Course codes like "GGRC25H3 F LEC01" sound terrible when read aloud.
// We strip them and replace with a natural phrase where possible.
function sanitizeForTTS(text) {
  return text
    // Strip markdown so TTS never reads symbols aloud ("asterisk", "one dot", etc.).
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")   // [link](url) → link text
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")        // # headings
    .replace(/^\s*[-*•+]\s+/gm, "")            // - / * / • bullet markers
    .replace(/^\s*\d+\.\s+/gm, "")             // 1. numbered-list markers
    .replace(/\*\*([^*]+)\*\*/g, "$1")         // **bold**
    .replace(/\*([^*]+)\*/g, "$1")             // *italic*
    .replace(/`([^`]+)`/g, "$1")               // `code`
    // Remove raw Canvas course codes: e.g. GGRC25H3, VPAC16H3, MDSB11H3
    .replace(/\b[A-Z]{2,6}\d{2,4}[A-Z0-9]*\s*(F|W|S)?\s*(LEC|TUT|PRA|LAB)\d{2,3}\b/g, "that course")
    // Remove section labels like "LEC01", "TUT02"
    .replace(/\b(LEC|TUT|PRA|LAB)\d{2,3}\b/gi, "")
    // Clean up multiple spaces
    .replace(/\s{2,}/g, " ")
    .trim();
}

// Returns { duration: seconds, play: fn }
// Caller decodes audio first, gets duration, then starts typewriter, then plays.
async function fetchAndDecodeAudio(text, voiceId, speed = 1.0, voiceSettings) {
  const body = {
    text: sanitizeForTTS(text),
    ...(voiceId ? { voiceId } : {}),
    ...(speed !== 1.0 ? { speed } : {}),
    ...(voiceSettings ? { voiceSettings } : {}),
  };
  const res = await fetch("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`TTS ${res.status}`);
  const { audio } = await res.json();
  if (!audio) throw new Error("No audio returned");
  const binaryStr = atob(audio);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
  const ctx = getAudioContext();
  if (ctx.state === "suspended") { try { await ctx.resume(); } catch (_) {} }
  const audioBuffer = await ctx.decodeAudioData(bytes.buffer);
  const effectiveDuration = audioBuffer.duration / Math.max(speed, 0.1);
  return {
    duration: effectiveDuration,
    play: (onSourceCreated) => new Promise((resolve) => {
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.playbackRate.value = speed; // client-side speed fallback
      source.connect(ctx.destination);
      source.onended = resolve;
      onSourceCreated?.(source);
      source.start(0);
    }),
  };
}

// ── First-ever-session opening (PRD §5.1, S8): the one message that has to visibly
// use every S6 intake answer, proving the intake wasn't wasted. Only called when the
// student has zero prior conversations (checked at the call site) — every later
// session uses buildSituationGreeting below, unchanged.
//
// Never invents specifics we don't actually have (same discipline as the S1 demo
// honesty fix): only references a real assignment/course if synced data exists;
// only maps in an intake-based phrasing, never a fabricated topic/week number.
const WALKTHROUGH_STYLE = {
  diagram: "a diagram-first walkthrough",
  talk:    "me talking you through it",
  read:    "a written breakdown you can read at your own pace",
  problem: "a practice problem",
  mix:     "a mix of approaches",
};

function buildFirstSessionGreeting(assignments, courses, userData) {
  const name = userData?.name?.split(" ")[0] || "there";
  const now  = new Date();

  // Broader window than the returning-session greeting (14 days, not 48h) — S8 wants
  // to reference whatever's genuinely most pressing, not just what's due imminently.
  const upcoming = (assignments || [])
    .filter(a => a.dueAt && !a.submission?.submittedAt && new Date(a.dueAt) > now)
    .sort((a, b) => +new Date(a.dueAt) - +new Date(b.dueAt));
  const nextDue = upcoming[0] || null;
  const daysUntil = nextDue ? Math.max(1, Math.round((+new Date(nextDue.dueAt) - +now) / 86400000)) : null;

  const walkthrough = WALKTHROUGH_STYLE[userData?.learning_style] || "a walkthrough";

  // First-person self-introduction — this is the ONE moment Reggie names itself,
  // matching the onboarding doc's "Meet Reggie" beat (Step 2: introduces itself,
  // already knows the student's courses/deadlines, doesn't ask them to explain).
  const intro = "I'm Reggie.";

  if (nextDue) {
    const course = courses?.find(c => c.id === nextDue.courseId || c.dbId === nextDue.courseId);
    const courseLabel = course?.courseCode || course?.name;
    const subject = courseLabel ? `${courseLabel} — ${nextDue.name}` : nextDue.name;
    return `${intro} ${name}, your ${subject} is due in ${daysUntil} day${daysUntil === 1 ? "" : "s"}. Want ${walkthrough}, or a 2-minute readiness check?`;
  }

  // No synced deadline yet (e.g. skipped Canvas connect) — still personalize with
  // the intake answer instead of falling back to something generic.
  return `${intro} Hey ${name} — want to start with ${walkthrough} on something you're working on, or a quick 2-minute check-in on where you're at?`;
}

// ── Situation-aware opening greeting ─────────────────────────────────────────
function buildSituationGreeting(assignments, courses, userData) {
  const now   = new Date();
  const hour  = now.getHours();
  const name  = userData?.name?.split(" ")[0] || "there";
  const timeTone = hour < 12 ? "morning" : hour < 17 ? "afternoon" : hour < 21 ? "evening" : "latenight";

  const overdue = (assignments || []).filter(a => a.dueAt && new Date(a.dueAt) < now && !a.submission?.submittedAt);
  const due24h  = (assignments || []).filter(a => {
    if (!a.dueAt || a.submission?.submittedAt) return false;
    const diff = +new Date(a.dueAt) - +now;
    return diff > 0 && diff < 86400000;
  });
  const due48h  = (assignments || []).filter(a => {
    if (!a.dueAt || a.submission?.submittedAt) return false;
    const diff = +new Date(a.dueAt) - +now;
    return diff > 0 && diff < 172800000;
  });
  const streak = userData?.streak || 0;

  let situation = "neutral";
  if (overdue.length > 0)       situation = "overdue";
  else if (due24h.length > 0)   situation = "urgent";
  else if (due48h.length > 0)   situation = "upcoming";
  else if (streak >= 7)         situation = "streak";
  else if (timeTone === "latenight") situation = "latenight";

  const greetings = {
    overdue: [
      `${name}, you've got ${overdue.length} overdue assignment${overdue.length > 1 ? "s" : ""}. Let's deal with that first.`,
      `Before anything else — ${overdue[0]?.name || "an assignment"} is past due. Want to tackle it now?`,
    ],
    urgent: [
      `${due24h[0]?.name || "An assignment"} is due in under 24 hours. How far along are you?`,
      `Tight window — ${due24h.length} assignment${due24h.length > 1 ? "s" : ""} due today. Let's prioritize.`,
    ],
    upcoming: [
      `You've got ${due48h.length} thing${due48h.length > 1 ? "s" : ""} due in the next 48 hours. Good time to get ahead.`,
      `${due48h[0]?.name || "Something"} is coming up. Want to break it down together?`,
    ],
    streak: [
      `${streak} days in a row — that's real momentum, ${name}. What are we working on today?`,
      `${streak}-day streak. Let's keep it going. What's on your plate?`,
    ],
    latenight: [
      `Still at it, ${name}? What do you need right now?`,
      `Late night session. I'm here — what are we solving?`,
    ],
    neutral: [
      `What are we working on${timeTone === "morning" ? " this morning" : timeTone === "evening" ? " tonight" : " today"}, ${name}?`,
      `Good ${timeTone === "morning" ? "morning" : timeTone === "afternoon" ? "afternoon" : "evening"}, ${name}. What do you need?`,
    ],
  };

  const opts = greetings[situation];
  return opts[Math.floor(Math.random() * opts.length)];
}

// ── Dynamic smart chips ───────────────────────────────────────────────────────
function buildSmartChips(assignments, courses, userData) {
  const now   = new Date();
  const chips = [];

  const overdue = (assignments || []).filter(a => a.dueAt && new Date(a.dueAt) < now && !a.submission?.submittedAt);
  if (overdue.length > 0) {
    chips.push({
      label:   `Fix ${overdue.length} overdue`,
      message: `I have ${overdue.length} overdue assignment${overdue.length > 1 ? "s" : ""}. Help me prioritize and make a plan.`,
    });
  }

  const dueSoon = (assignments || []).filter(a => {
    if (!a.dueAt || a.submission?.submittedAt) return false;
    const diff = +new Date(a.dueAt) - +now;
    return diff > 0 && diff < 172800000;
  });
  if (dueSoon.length > 0) {
    chips.push({
      label:   (`Due soon: ${dueSoon[0].name || "assignment"}`).slice(0, 28),
      message: `Tell me about my most urgent upcoming assignment and help me make a plan.`,
    });
  }

  if ((courses || []).length > 0) {
    const c = courses[Math.floor(Math.random() * courses.length)];
    chips.push({
      label:   `Quiz me on ${(c.name || c.courseCode || "my courses").split(" ")[0]}`,
      message: `Quiz me on ${c.name || c.courseCode}. Ask me 5 questions to test my understanding.`,
    });
  } else {
    chips.push({ label: "Connect Canvas", message: "How do I connect my Canvas account?" });
  }

  if ((userData?.streak || 0) >= 3) {
    chips.push({
      label:   `Keep your ${userData.streak}-day streak`,
      message: "What should I study today to keep my streak going?",
    });
  }

  const hour = now.getHours();
  chips.push(hour >= 18
    ? { label: "Review today's work",  message: "Give me a quick summary of what I should have done today and what's still pending." }
    : { label: "Plan my day",          message: "Help me plan my study schedule for today based on my assignments and deadlines." }
  );

  chips.push({ label: "I'm stressed",   message: "I'm feeling stressed about my workload." });
  chips.push({ label: "How's my GPA?",  message: "What's my current GPA and grade breakdown?" });
  chips.push({ label: "Open toolkit",   message: "Open toolkit" });

  return chips.slice(0, 4);
}

// ── Artifact type detection ────────────────────────────────────────────────────
function detectArtifactType(msg) {
  const t = (msg || "").toLowerCase();
  if (/quiz\s+me|test\s+me|exam\s+me|drill\s+me|give\s+me\s+a\s+quiz/i.test(t)) return "quiz";
  if (/flashcard|flash\s+card/i.test(t))                                         return "flashcard";
  if (/study\s+plan|schedule\s+me|planner|timetable|plan\s+my/i.test(t))        return "plan";
  if (/diagram|flowchart|mind\s+map/i.test(t))                                   return "diagram";
  if (/dashboard/i.test(t))                                                       return "dashboard";
  if (/chart|graph|plot|histogram|scatter|visuali/i.test(t))                     return "chart";
  if (/game|snake|puzzle/i.test(t))                                               return "game";
  if (/timer|pomodoro|countdown/i.test(t))                                        return "timer";
  if (/tracker|kanban|todo/i.test(t))                                             return "tracker";
  if (/calculator/i.test(t))                                                       return "calculator";
  return "viz";
}

const ARTIFACT_LABELS = {
  quiz:       { button: "Start Quiz →",       header: "Quiz"        },
  flashcard:  { button: "Open Flashcards →",  header: "Flashcards"  },
  plan:       { button: "View Plan →",        header: "Study Plan"  },
  diagram:    { button: "View Diagram →",     header: "Diagram"     },
  dashboard:  { button: "View Dashboard →",   header: "Dashboard"   },
  chart:      { button: "View Chart →",       header: "Chart"       },
  game:       { button: "Play →",             header: "Game"        },
  timer:      { button: "Open →",             header: "Tool"        },
  tracker:    { button: "Open →",             header: "Tracker"     },
  calculator: { button: "Open →",             header: "Calculator"  },
  viz:        { button: "Open →",             header: "Visualization"},
};

// ── Inline quiz component (renders inside chat when Claude returns quiz format) ─
function InlineQuiz({ cards, userId, courseId }) {
  const [idx,     setIdx]     = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [results, setResults] = useState([]);
  const [done,    setDone]    = useState(false);
  const [saving,  setSaving]  = useState(false);
  const [saved,   setSaved]   = useState(false);

  const card = cards[idx];

  function judge(correct) {
    const next = [...results, correct];
    setResults(next);
    setFlipped(false);
    if (idx + 1 >= cards.length) {
      setDone(true);
      const score = next.filter(Boolean).length;
      const total = cards.length;
      awardTokens("quiz_completed", { score, total }).catch(() => {});
      if (score === total) awardTokens("quiz_perfect", { score, total }).catch(() => {});
    } else {
      setIdx(i => i + 1);
    }
  }

  async function saveCards() {
    setSaving(true);
    try {
      await replaceFlashcardDeck(supabase, userId, courseId ?? null, cards);   // flashcards_v2 (the read table)
      setSaved(true);
    } catch { /* non-fatal */ }
    setSaving(false);
  }

  const wrap = {
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(var(--gold-rgb),0.35)",
    borderRadius: "14px",
    padding: "16px",
    marginTop: "8px",
  };

  if (done) {
    const correct = results.filter(Boolean).length;
    return (
      <div style={wrap}>
        <p style={{ color: "var(--text-primary)", fontSize: "15px", fontWeight: "600", marginBottom: "8px" }}>
          {correct}/{cards.length} correct
        </p>
        <div style={{ display: "flex", gap: "5px", marginBottom: "12px" }}>
          {results.map((r, i) => (
            <div key={i} style={{ width: 10, height: 10, borderRadius: "50%", background: r ? "rgba(52,199,89,0.85)" : "rgba(255,59,48,0.7)" }} />
          ))}
        </div>
        {!saved
          ? <button onClick={saveCards} disabled={saving}
              style={{ background: "rgba(var(--gold-rgb),0.12)", border: "1px solid rgba(var(--gold-rgb),0.28)", borderRadius: "8px", padding: "7px 14px", color: "var(--gold)", fontSize: "12px", fontWeight: "600", cursor: "pointer", fontFamily: "inherit" }}>
              {saving ? "Saving…" : "Save to flashcards"}
            </button>
          : <p style={{ color: "var(--gold)", fontSize: "12px", display:"flex", alignItems:"center", gap:5 }}><Check size={13} />Saved to flashcards</p>
        }
      </div>
    );
  }

  return (
    <div style={wrap}>
      <p style={{ color: "rgba(var(--gold-rgb),0.55)", fontSize: "10px", letterSpacing: "1.5px", textTransform: "uppercase", marginBottom: "10px" }}>
        {idx + 1} / {cards.length}
      </p>
      <div style={{ minHeight: "58px", marginBottom: "12px" }}>
        {!flipped ? (
          <>
            <p style={{ color: "rgba(255,255,255,0.3)", fontSize: "10px", textTransform: "uppercase", letterSpacing: "1px", marginBottom: "6px" }}>Question</p>
            <p style={{ color: "var(--text-primary)", fontSize: "14px", lineHeight: "1.6", fontFamily: "var(--font-sans)" }}>{card.q}</p>
          </>
        ) : (
          <>
            <p style={{ color: "rgba(var(--gold-rgb),0.55)", fontSize: "10px", textTransform: "uppercase", letterSpacing: "1px", marginBottom: "6px" }}>Answer</p>
            <p style={{ color: "var(--text-primary)", fontSize: "14px", lineHeight: "1.6" }}>{card.a}</p>
          </>
        )}
      </div>
      {!flipped
        ? <button onClick={() => setFlipped(true)}
            style={{ width: "100%", background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: "8px", padding: "9px", color: "var(--text-primary)", fontSize: "13px", cursor: "pointer", fontFamily: "inherit" }}>
            Reveal answer
          </button>
        : <div style={{ display: "flex", gap: "8px" }}>
            <button onClick={() => judge(false)}
              style={{ flex: 1, background: "rgba(255,59,48,0.1)", border: "1px solid rgba(255,59,48,0.22)", borderRadius: "8px", padding: "9px", color: "rgba(255,85,75,0.9)", fontSize: "13px", fontWeight: "600", cursor: "pointer", fontFamily: "inherit" }}>
              Missed
            </button>
            <button onClick={() => judge(true)}
              style={{ flex: 1, background: "rgba(52,199,89,0.08)", border: "1px solid rgba(52,199,89,0.22)", borderRadius: "8px", padding: "9px", color: "rgba(72,210,110,0.9)", fontSize: "13px", fontWeight: "600", cursor: "pointer", fontFamily: "inherit" }}>
              Got it
            </button>
          </div>
      }
    </div>
  );
}

const SIZE           = 68;
const RADIUS         = 24;
const VOICE_SIZE     = 156;  // larger sphere for centered voice-mode hero
const VOICE_RADIUS   = 54;
const N              = 28;
const EDGE_THRESHOLD = 0.72;

function fibonacciSphere(n) {
  const pts = [];
  const phi = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const t = phi * i;
    pts.push({ x: r * Math.cos(t), y, z: r * Math.sin(t) });
  }
  return pts;
}

const NODES = fibonacciSphere(N);

// Per-turn TTS generation stamp for Reggie voice mode — see runReggieTurn. Module scope
// is fine: one NeuralRing instance per app.
let reggieTtsGen = 0;

// Safe-area bottom offset — accounts for iOS home indicator + browser toolbar
function safeBottom() {
  // env(safe-area-inset-bottom) isn't readable from JS directly,
  // so we use a sentinel div approach, or fall back to a generous 90px.
  try {
    const el = document.createElement("div");
    el.style.cssText = "position:fixed;bottom:env(safe-area-inset-bottom,0px);height:0;visibility:hidden";
    document.body.appendChild(el);
    const rect = el.getBoundingClientRect();
    document.body.removeChild(el);
    const inset = window.innerHeight - rect.bottom;
    return Math.max(inset, 0) + 80; // 80px above toolbar
  } catch {
    return 90;
  }
}

function defaultPos() {
  const W = window.innerWidth;
  const H = window.innerHeight;
  return { top: H - SIZE - safeBottom(), left: W - SIZE - 22 };
}

function clamp(pos) {
  const W = window.innerWidth;
  const H = window.innerHeight;
  return {
    top:  Math.max(56, Math.min(H - SIZE - safeBottom(), pos.top)),
    left: Math.max(8,  Math.min(W - SIZE - 8, pos.left)),
  };
}

// Premium voice toggle — pill button with animated waveform (unmuted) or slash (muted)
const VoiceToggle = ({ muted, onClick, speaking }) => (
  <button
    onClick={onClick}
    title={muted ? "Voice off — tap to enable" : "Voice on — tap to mute"}
    style={{
      display: "flex",
      alignItems: "center",
      gap: "6px",
      padding: "6px 12px",
      borderRadius: "20px",
      border: `1px solid ${muted ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.16)"}`,
      background: muted
        ? "rgba(255,255,255,0.04)"
        : speaking
          ? "rgba(255,255,255,0.14)"
          : "rgba(255,255,255,0.08)",
      cursor: "pointer",
      flexShrink: 0,
      transition: "all 0.2s ease",
      outline: "none",
      WebkitTapHighlightColor: "transparent",
    }}
  >
    {/* Animated bars or muted icon */}
    {muted ? (
      // Muted — static crossed mic
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="2.2" strokeLinecap="round">
        <line x1="2" y1="2" x2="22" y2="22"/>
        <path d="M18.89 13.23A7 7 0 0 0 19 12v-2"/>
        <path d="M5 10v2a7 7 0 0 0 11.9 5.1"/>
        <path d="M15 9.34V5a3 3 0 0 0-5.68-1.33"/>
        <path d="M9 9v3a3 3 0 0 0 5.12 2.12"/>
        <line x1="12" y1="19" x2="12" y2="23"/>
        <line x1="8" y1="23" x2="16" y2="23"/>
      </svg>
    ) : (
      // Unmuted — waveform bars (animate when speaking)
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.85)" strokeWidth="2.2" strokeLinecap="round">
        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
        <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
        <line x1="12" y1="19" x2="12" y2="23"/>
        <line x1="8" y1="23" x2="16" y2="23"/>
      </svg>
    )}
    <span style={{
      fontSize: "10px",
      fontWeight: "500",
      letterSpacing: "0.5px",
      textTransform: "uppercase",
      color: muted ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.7)",
      fontFamily: "var(--font-sans)",
    }}>
      {speaking ? "Live" : muted ? "Off" : "Voice"}
    </span>
  </button>
);

// ── S9: notification-permission ask copy, tied to the declared study window ─
// (PRD §5.1 v2.1 — shown once, after the first completed session, never during
// onboarding). Falls back to a schedule-agnostic line if study_window wasn't
// answered (skipped in the S6 intake).
function buildNotificationAskCopy(studyWindow) {
  const byWindow = {
    weeknights: "Want me to remind you on weeknights, before things pile up?",
    latenight:  "Want me to remind you before your late-night sessions?",
    mornings:   "Want me to remind you in the morning, before your day gets busy?",
    weekends:   "Want me to remind you on weekends, ahead of the week?",
    deadline:   "Want me to remind you as deadlines get close?",
  };
  return byWindow[studyWindow] || "Want me to remind you before deadlines and study sessions?";
}

export default function NeuralRing({ currentPage }: { currentPage?: string } = {}) {
  const { userData, updateUserField, courses, assignments, setPendingNav, setStudyConfig, tutorSeed, setTutorSeed, userId, flashcardMap, syllabus, forceSync, canvasToken } = useApp();

  const courseOptions = courses.length
    ? courses.map(c => `${c.courseCode} — ${c.name}`)
    : [];

  // ── Tutor impressions + living mind — loaded once on mount ─────────────────
  const [impressions,      setImpressions]      = useState([]);
  const abortCtrlRef       = useRef(null);   // cancel in-flight fetch
  const activeAssignmentRef = useRef(null);  // { assignmentId, courseId, title } when studying a task
  const audioSourceRef     = useRef(null);   // cancel in-flight audio
  const [lastSession,      setLastSession]      = useState(null);
  const [livingMind,       setLivingMind]       = useState(null);
  const [preloadedContext, setPreloadedContext] = useState<string | null>(null);

  // ── S9: notification-permission ask (shown once, after first session close) ─
  const [showNotifAsk, setShowNotifAsk] = useState(false);

  // ── Session tracking — for session-close payload + self-write trigger ───────
  const sessionStartedAt  = useRef(null);
  const exchangeCountRef  = useRef(0); // increments each AI response

  // Refs — always hold latest prefs without stale closure in speakAndType
  const voiceIdRef     = useRef(userData?.preferred_voice_id ?? null);
  const speedRef       = useRef(userData?.preferred_speed ?? 1.2);
  const toneRef        = useRef(userData?.preferred_tone  ?? "neutral");

  // Voice mode state
  const [voiceMode,        setVoiceMode]        = useState(false);
  const [isRecording,      setIsRecording]      = useState(false);
  // True between opening the mic and the Scribe socket actually accepting audio. Drives
  // the "connecting" label so the orb never says "listening" over a socket that isn't up.
  const [voiceConnecting,  setVoiceConnecting]  = useState(false);
  const [micDenied,        setMicDenied]        = useState(false);
  const [availableVoices,  setAvailableVoices]  = useState([]);
  const mediaRecorderRef   = useRef(null);
  const audioChunksRef     = useRef([]);
  // Voice mode — auto-listen engine
  const voiceCanvasRef     = useRef(null);   // larger centered sphere in voice mode
  const voiceRafRef        = useRef(null);   // RAF for voice canvas
  const analyserRef        = useRef(null);   // WebAudio AnalyserNode
  const micStreamRef       = useRef(null);   // mic MediaStream (kept open during listen)
  const silenceRafRef      = useRef(null);   // RAF for silence detection tick
  const silenceTimerRef    = useRef(null);   // setTimeout for auto-stop
  const speechDetectedRef  = useRef(false);  // has speech started this utterance?
  const voiceRmsRef        = useRef(0);      // current RMS level 0–1 (no re-render)
  const voiceModeRef       = useRef(false);  // mirrors voiceMode state for async closures
  const speakingRef        = useRef(false);  // mirrors speaking state for RAF barge-in
  // Voice intelligence refs
  const interruptedTextRef = useRef(null);   // partial text when barge-in happens
  const lastSpokenTextRef  = useRef("");     // last assistant text (for "say that again")
  const streamingMsgRef    = useRef("");     // mirrors streamingMsg for stopResponse capture
  const voiceQuizRef       = useRef(null);   // { questions:[{q,a}], idx, score } | null
  const voiceTTSAbortRef   = useRef(false);  // true = skip remaining queued TTS sentences
  const scribeRef          = useRef<any>(null); // live ScribeSession, streaming STT path only
  const voicePartialRef    = useRef("");     // latest partial transcript (UI wiring: P2-6)
  const sttFailStreakRef   = useRef(0);      // consecutive transcript failures -> bail out
  // Mirrors `muted` for the async voice paths. sendMessage/runReggieTurn read this many
  // ticks after they start, and entering voice mode auto-unmutes — reading the state
  // directly there caught the pre-unmute value and silently produced a mute turn.
  const mutedRef           = useRef(false);

  const canvasRef      = useRef(null);
  const rafRef         = useRef(null);
  const rotRef         = useRef(0);
  const sphereStateRef = useRef("idle");    // "idle"|"thinking"|"speaking"
  const rotSpeedRef    = useRef(0.004);     // lerped rotation speed
  const colorMixRef    = useRef(0);         // 0=white → 1=gold, lerped
  const pulseSineRef   = useRef(0);         // for speaking radius pulse

  const [pos, setPos]           = useState(defaultPos);
  const [isDragging, setIsDrag] = useState(false);
  const dragStartRef            = useRef(null);
  const hasDraggedRef           = useRef(false);

  const [chatOpen, setChatOpen] = useState(false);

  const [ringName,       setRingName]       = useState("");
  const [editingName,    setEditingName]    = useState(false);
  const [ringNameInput,  setRingNameInput]  = useState("");
  const ringNameInputRef                    = useRef(null);

  const [messages,   setMessages]   = useState([]);
  const [smartChips, setSmartChips] = useState([
    { label: "What's due soon?",  message: "What assignments do I have due soon?" },
    { label: "Take me to study",  message: "Take me to study" },
    { label: "How's my GPA?",     message: "What's my current GPA and grade breakdown?" },
    { label: "Open toolkit",      message: "Open toolkit" },
  ]);
  const historyLoadedRef = useRef(false); // guard: only load history once per mount
  // ── Chat history (conversations) ──────────────────────────────────────────
  const [conversations,        setConversations]        = useState([]);   // [{id,title,updated_at}]
  const [currentConversationId, setCurrentConversationId] = useState(null);
  const [historyOpen,          setHistoryOpen]          = useState(false);
  const currentConvIdRef = useRef(null);  // mirror for async closures
  const [input,    setInput]    = useState("");
  const [loading,  setLoading]  = useState(false);
  // Thumbs reaction state — tracks per-message reactions + reason picker
  const [reactions,    setReactions]    = useState({});   // { msgIndex: "up"|"down" }
  const [reasonPicker, setReasonPicker] = useState(null); // msgIndex | null
  const messagesEndRef          = useRef(null);
  const inputRef                = useRef(null);
  const attachInputRef          = useRef(null);
  const photoInputRef           = useRef(null);
  const cameraInputRef          = useRef(null);
  const [attachStatus, setAttachStatus] = useState<string | null>(null);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  // Mic dictation for the text input (tap to talk -> words land in the box, user edits
  // then sends). Separate from full voice mode; works in classic AND Reggie mode.
  const [dictState, setDictState] = useState<"idle" | "listening" | "processing">("idle");
  const [dictInterim, setDictInterim] = useState("");
  const dictationRef = useRef<any>(null);

  // Voice intelligence state
  const [activeVoiceId,      setActiveVoiceId]      = useState(null); // drives instant chip highlight
  const [voiceQuizProgress,  setVoiceQuizProgress]  = useState(null); // {current, total} | null
  const [leaderboardRank,    setLeaderboardRank]     = useState(null); // {rank,points,tier,above}

  // Surfaced in the header whenever voice is degraded. Exists so the orb can never look
  // like it is listening or speaking while the underlying pipeline is dead — a silent
  // failure reads as "the AI ignored me", which is worse than an error.
  const [voiceError,   setVoiceError]   = useState<string | null>(null);
  const [muted,        setMuted]        = useState(() => {
    try { return localStorage.getItem("fschool_muted") === "1"; } catch { return false; }
  });
  // ── Reggie mode: route the tutor through the agent-manager loop (router + tools +
  //    brain + live Canvas) instead of the direct Claude/Groq path. Default ON — an
  //    explicit toggle-off (localStorage "0") is still respected; only an unset value
  //    (new users) defaults to on. Toggled from the chat header; persisted. Fully
  //    reversible — set to "0" === original direct-path behavior.
  const [reggieMode,   setReggieMode]   = useState(() => {
    try {
      const v = localStorage.getItem("fschool_reggie_mode");
      return v === null ? true : v === "1";
    } catch { return true; }
  });
  const reggieModeRef = useRef(reggieMode);
  useEffect(() => {
    reggieModeRef.current = reggieMode;
    try { localStorage.setItem("fschool_reggie_mode", reggieMode ? "1" : "0"); } catch {}
  }, [reggieMode]);
  const [speaking,     setSpeaking]     = useState(false);
  const [streamingMsg, setStreamingMsg] = useState("");
  const [liveActivity, setLiveActivity] = useState([]);   // Reggie tool-activity timeline (live turn)
  const typeTimerRef = useRef(null);

  // ── Visualization artifact state ────────────────────────────────────────────
  const [artifactCode, setArtifactCode] = useState(null);
  const [artifactType, setArtifactType] = useState("viz"); // tracks latest artifact type for panel header
  const [artifactOpen, setArtifactOpen] = useState(false);

  // ── Stop button — cancels in-flight fetch + audio ───────────────────────────
  const stopResponse = useCallback(() => {
    // Capture partial text for barge-in interrupt context (voice mode only)
    if (speakingRef.current) {
      const partial = streamingMsgRef.current || lastSpokenTextRef.current;
      if (partial) interruptedTextRef.current = partial;
    }
    // Kill the queued TTS sentence chain immediately
    voiceTTSAbortRef.current = true;
    // Cancel in-flight fetch
    abortCtrlRef.current?.abort();
    abortCtrlRef.current = null;
    // Stop audio playback
    try { audioSourceRef.current?.stop(); } catch (_) {}
    audioSourceRef.current = null;
    // Stop typewriter
    if (typeTimerRef.current) { clearInterval(typeTimerRef.current); typeTimerRef.current = null; }
    setSpeaking(false); speakingRef.current = false;
    setLoading(false);
    setStreamingMsg("");
  }, []); // uses only refs — stable


  useEffect(() => {
    const name = userData?.ring_name ?? "";
    setRingName(name);
    setRingNameInput(name);
  }, [userData?.ring_name]);

  // Keep preference + mode refs current
  useEffect(() => { voiceIdRef.current   = userData?.preferred_voice_id ?? null;      }, [userData?.preferred_voice_id]);
  useEffect(() => { speedRef.current     = userData?.preferred_speed    ?? 1.2;       }, [userData?.preferred_speed]);
  useEffect(() => { toneRef.current      = userData?.preferred_tone     ?? "neutral"; }, [userData?.preferred_tone]);
  useEffect(() => {
    // Secondary sync — fires after paint. Direct assignments below are the primary.
    if (voiceModeRef.current !== voiceMode) {
      voiceModeRef.current = voiceMode;
    }
  }, [voiceMode]);
  useEffect(() => { speakingRef.current  = speaking;   }, [speaking]);
  useEffect(() => { streamingMsgRef.current = streamingMsg; }, [streamingMsg]);
  // Keep activeVoiceId in sync when userData loads / changes from DB
  useEffect(() => {
    if (userData?.preferred_voice_id) setActiveVoiceId(userData.preferred_voice_id);
  }, [userData?.preferred_voice_id]);
  // Fetch leaderboard rank when voice mode opens
  useEffect(() => {
    if (!voiceMode || !userId) return;
    (async () => {
      try {
        const { data: lb } = await supabase
          .from("leaderboard")
          .select("user_id, points, tier")
          .order("points", { ascending: false })
          .limit(50);
        if (!lb?.length) return;
        const idx = lb.findIndex(r => r.user_id === userId);
        if (idx < 0) return;
        setLeaderboardRank({
          rank:   idx + 1,
          points: lb[idx].points,
          tier:   lb[idx].tier,
          above:  idx > 0 ? { gap: lb[idx - 1].points - lb[idx].points } : null,
        });
      } catch (_) {}
    })();
  }, [voiceMode, userId]); // eslint-disable-line

  // Fetch voice list once — needed for Claude context + [VOICE:x] tag resolution
  useEffect(() => {
    fetch("/api/tts?action=voices")
      .then(r => r.ok ? r.json() : [])
      .then(vs => setAvailableVoices(vs ?? []))
      .catch(() => {});
  }, []);

  // ── Load impressions + last session from Supabase on mount ──────────────────
  useEffect(() => {
    if (!userId) return;
    async function loadMemory() {
      try {
        // Load last 10 impressions
        const { data: impData } = await supabase
          .from("tutor_impressions")
          .select("impression, created_at")
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(10);
        if (impData?.length) setImpressions(impData);

        // Load last session summary from chat_logs (last assistant message from a different day)
        const { data: logData } = await supabase
          .from("chat_logs")
          .select("content, created_at")
          .eq("user_id", userId)
          .eq("role", "assistant")
          .order("created_at", { ascending: false })
          .limit(1);
        if (logData?.[0]) {
          const daysAgo = Math.round((Date.now() - +new Date(logData[0].created_at)) / 86400000);
          if (daysAgo >= 1) {
            setLastSession(`${daysAgo === 1 ? "yesterday" : `${daysAgo} days ago`} — "${logData[0].content.slice(0, 80)}..."`);
          }
        }

        // Load living mind doc
        const { data: mindData } = await supabase
          .from("tutor_mind")
          .select("mind_doc")
          .eq("user_id", userId)
          .maybeSingle();
        if (mindData?.mind_doc) setLivingMind(mindData.mind_doc);

        // ── Preload academic context once on mount ──────────────────────────
        // Use localStorage snapshot for instant load, then refresh in background.
        const CACHE_KEY    = `fschool_ctx_${userId}`;
        const CACHE_TS_KEY = `fschool_ctx_ts_${userId}`;
        const cached   = localStorage.getItem(CACHE_KEY);
        const cachedAt = Number(localStorage.getItem(CACHE_TS_KEY) ?? 0);
        if (cached && Date.now() - cachedAt < 10 * 60 * 1000) {
          setPreloadedContext(cached);
        }
        // Always refresh from server — updates snapshot if data changed
        fetch("/api/tutor-context", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId, userMessage: "preload", brainPersonId: userData?.brain_person_id ?? null, courseIds: [] }),
        })
          .then(r => r.ok ? r.json() : null)
          .then(d => {
            if (d?.context) {
              setPreloadedContext(d.context);
              localStorage.setItem(CACHE_KEY, d.context);
              localStorage.setItem(CACHE_TS_KEY, String(Date.now()));
            }
          })
          .catch(() => {});

      } catch { /* non-fatal */ }
    }
    loadMemory();
  }, [userId]);

  // Backfill the RAG index for any previously-uploaded files that aren't indexed yet,
  // so the tutor can find OLD materials without re-uploading. Runs in the background on
  // load; idempotent + paginated server-side, so it's cheap when nothing's pending and
  // converges when there is. Never deletes anything — only adds missing index rows.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      try {
        for (let guard = 0; guard < 300 && !cancelled; guard++) {
          const r = await fetch("/api/rag?action=backfill", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userId }),
          });
          if (!r.ok) break;
          const d = await r.json().catch(() => ({}));
          if (d.done || !d.progressed) break; // finished, or no progress this pass → stop
          // Be gentle between batches so background indexing doesn't contend with a live
          // chat query's embedding call (contention there slows/drops its grounding).
          await new Promise(res => setTimeout(res, 1500));
        }
      } catch { /* non-fatal — files still index on their next upload */ }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  const toggleMute = useCallback(() => {
    setMuted(m => {
      const next = !m;
      mutedRef.current = next;
      try { localStorage.setItem("fschool_muted", next ? "1" : "0"); } catch {}
      return next;
    });
  }, []);

  // Keep the ref honest regardless of who changed the state (toggle, voice-mode entry,
  // or the initial localStorage read).
  useEffect(() => { mutedRef.current = muted; }, [muted]);

  // ── Inject keyframes once ──────────────────────────────────────────────────
  useEffect(() => {
    if (document.querySelector("[data-neuralring-style]")) return;
    const style = document.createElement("style");
    style.dataset.neuralringStyle = "1";
    style.textContent = `
      @keyframes neuralPulse {
        0%, 100% { box-shadow: 0 0 0 0 rgba(255,255,255,0.08), 0 0 0 1px rgba(255,255,255,0.10), 0 6px 28px rgba(0,0,0,0.5); }
        50%       { box-shadow: 0 0 0 9px rgba(255,255,255,0.03), 0 0 0 1px rgba(255,255,255,0.12), 0 6px 28px rgba(0,0,0,0.5); }
      }
      .nr-idle { animation: neuralPulse 4s ease-in-out infinite; }
      @keyframes neuralSpeak {
        0%, 100% { box-shadow: 0 0 0 0 rgba(255,255,255,0.14), 0 0 0 1px rgba(255,255,255,0.18), 0 6px 28px rgba(0,0,0,0.5); }
        50%       { box-shadow: 0 0 0 14px rgba(255,255,255,0.05), 0 0 0 1px rgba(255,255,255,0.22), 0 6px 28px rgba(0,0,0,0.5); }
      }
      .nr-speaking { animation: neuralSpeak 0.8s ease-in-out infinite; }
      @keyframes blink { 0%, 100% { opacity: 0.4; } 50% { opacity: 0; } }
      @keyframes nrVoiceIn { from{opacity:0;transform:translateY(12px)} to{opacity:1;transform:none} }
      @keyframes nrVoicePulse { 0%,100%{opacity:0.35;transform:scale(1)} 50%{opacity:0.55;transform:scale(1.03)} }

      /* ── Message entrance + thinking dots ── */
      @media (prefers-reduced-motion: no-preference) {
        @keyframes nrMsgIn {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: none; }
        }
        @keyframes nrBorderPulse {
          0%   { box-shadow: 0 0 0 1px rgba(var(--gold-rgb),0.55); }
          100% { box-shadow: 0 0 0 1px rgba(var(--gold-rgb),0); }
        }
        @keyframes nrDot {
          0%, 60%, 100% { transform: scale(0.75); opacity: 0.35; }
          30%            { transform: scale(1.15); opacity: 1; }
        }
        .nr-msg-in  { animation: nrMsgIn 0.24s cubic-bezier(0.22,1,0.36,1) both; }
        .nr-msg-new { animation: nrBorderPulse 1.2s ease-out both; }
        .nr-dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: var(--gold); }
        .nr-dot:nth-child(1) { animation: nrDot 0.9s ease-in-out infinite 0s; }
        .nr-dot:nth-child(2) { animation: nrDot 0.9s ease-in-out infinite 0.15s; }
        .nr-dot:nth-child(3) { animation: nrDot 0.9s ease-in-out infinite 0.30s; }
      }
      .nr-dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: var(--gold); }

      /* ── Markdown styles ── */
      .nr-md p            { margin: 0 0 6px; }
      .nr-md p:last-child  { margin: 0; }
      .nr-md strong        { color: var(--gold); font-weight: 600; }
      .nr-md ul            { margin: 4px 0; padding-left: 18px; }
      .nr-md li            { margin: 3px 0; }
    `;
    document.head.appendChild(style);
    return () => style.remove();
  }, []);

  // ── Sphere state sync — updates ref so draw loop reads it without re-render ──
  useEffect(() => {
    sphereStateRef.current = loading ? "thinking" : speaking ? "speaking" : "idle";
  }, [loading, speaking]);

  // ── Canvas animation (state-reactive) ────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const draw = () => {
      const state = sphereStateRef.current;

      // Target rotation speed per state
      const targetSpeed = state === "thinking" ? 0.010 : state === "speaking" ? 0.006 : 0.004;
      // Target color mix: 0=white, 1=gold #C49A3C=rgb(196,154,60)
      const targetMix   = state === "thinking" || state === "speaking" ? 1 : 0;

      // Lerp smoothly toward targets
      rotSpeedRef.current += (targetSpeed - rotSpeedRef.current) * 0.04;
      colorMixRef.current += (targetMix   - colorMixRef.current) * 0.04;

      ctx.clearRect(0, 0, SIZE, SIZE);
      rotRef.current += rotSpeedRef.current;

      // Radius pulse for speaking state (±6% on sine wave)
      pulseSineRef.current += 0.08;
      const pulse = state === "speaking" ? Math.sin(pulseSineRef.current) * 0.06 : 0;
      const R = RADIUS * (1 + pulse);

      const rot = rotRef.current;
      const mix = colorMixRef.current;

      // Interpolate RGB: white(255,255,255) → gold(196,154,60)
      const cr = Math.round(255 + (GOLD_RGB.r - 255) * mix);
      const cg = Math.round(255 + (GOLD_RGB.g - 255) * mix);
      const cb = Math.round(255 + (GOLD_RGB.b - 255) * mix);

      const projected = NODES.map(({ x, y, z }) => {
        const rx = x * Math.cos(rot) + z * Math.sin(rot);
        const rz = -x * Math.sin(rot) + z * Math.cos(rot);
        return { sx: rx * R + SIZE / 2, sy: y * R + SIZE / 2, sz: rz, depth: (rz + 1) * 0.5 };
      });

      ctx.lineWidth = 0.7;
      for (let i = 0; i < projected.length; i++) {
        for (let j = i + 1; j < projected.length; j++) {
          const ri = projected[i], rj = projected[j];
          const da = { x: ri.sx - rj.sx, y: ri.sy - rj.sy, z: ri.sz - rj.sz };
          const d3 = Math.sqrt(da.x * da.x + da.y * da.y + da.z * da.z);
          if (d3 < RADIUS * 2 * EDGE_THRESHOLD) {
            const alpha = 0.05 + (ri.depth + rj.depth) * 0.07;
            ctx.strokeStyle = `rgba(${cr},${cg},${cb},${alpha.toFixed(2)})`;
            ctx.beginPath(); ctx.moveTo(ri.sx, ri.sy); ctx.lineTo(rj.sx, rj.sy); ctx.stroke();
          }
        }
      }
      for (const { sx, sy, depth } of projected) {
        ctx.beginPath();
        ctx.arc(sx, sy, 0.9 + depth * 0.8, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${cr},${cg},${cb},${(0.5 + depth * 0.4).toFixed(2)})`;
        ctx.fill();
      }
      rafRef.current = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  // ── Voice canvas: DPR-scaled sphere with depth rendering + glow ─────────────
  useEffect(() => {
    if (!voiceMode) { cancelAnimationFrame(voiceRafRef.current); return; }
    const canvas = voiceCanvasRef.current;
    if (!canvas) return;

    // DPR scaling — sharpest single fix for blurry canvas on retina/HiDPI displays
    const dpr = window.devicePixelRatio || 1;
    canvas.width  = Math.round(VOICE_SIZE * dpr);
    canvas.height = Math.round(VOICE_SIZE * dpr);
    canvas.style.width  = VOICE_SIZE + "px";
    canvas.style.height = VOICE_SIZE + "px";
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    ctx.imageSmoothingEnabled = true;

    const cx = VOICE_SIZE / 2;
    const cy = VOICE_SIZE / 2;

    const drawVoice = () => {
      ctx.clearRect(0, 0, VOICE_SIZE, VOICE_SIZE);
      const rot  = rotRef.current;
      const mix  = colorMixRef.current;
      const cr   = Math.round(255 + (GOLD_RGB.r - 255) * mix);
      const cg   = Math.round(255 + (GOLD_RGB.g - 255) * mix);
      const cb   = Math.round(255 + (GOLD_RGB.b - 255) * mix);
      const pulse = sphereStateRef.current === "speaking"
        ? Math.sin(pulseSineRef.current) * 0.06 : 0;
      const R    = VOICE_RADIUS * (1 + pulse);

      // Radial gradient body — warm depth glow at sphere center
      const grad = ctx.createRadialGradient(cx, cy, R * 0.15, cx, cy, R * 1.4);
      grad.addColorStop(0,   `rgba(${cr},${cg},${cb},0.08)`);
      grad.addColorStop(0.5, `rgba(${cr},${cg},${cb},0.03)`);
      grad.addColorStop(1,   "rgba(0,0,0,0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, R * 1.4, 0, Math.PI * 2);
      ctx.fill();

      const projected = NODES.map(({ x, y, z }) => {
        const rx = x * Math.cos(rot) + z * Math.sin(rot);
        const rz = -x * Math.sin(rot) + z * Math.cos(rot);
        return { sx: rx * R + cx, sy: y * R + cy, sz: rz, depth: (rz + 1) * 0.5 };
      });

      // Neural connections — depth-aware alpha
      ctx.shadowBlur = 0;
      ctx.lineWidth = 0.9;
      for (let i = 0; i < projected.length; i++) {
        for (let j = i + 1; j < projected.length; j++) {
          const ri = projected[i], rj = projected[j];
          const da = { x: ri.sx - rj.sx, y: ri.sy - rj.sy, z: ri.sz - rj.sz };
          const d3 = Math.sqrt(da.x*da.x + da.y*da.y + da.z*da.z);
          if (d3 < VOICE_RADIUS * 2 * EDGE_THRESHOLD) {
            const alpha = 0.04 + Math.min(ri.depth, rj.depth) * 0.12;
            ctx.strokeStyle = `rgba(${cr},${cg},${cb},${alpha.toFixed(2)})`;
            ctx.beginPath(); ctx.moveTo(ri.sx, ri.sy); ctx.lineTo(rj.sx, rj.sy); ctx.stroke();
          }
        }
      }

      // Points — depth-sorted (painter's algorithm) with glow on foreground nodes
      const sorted = [...projected].sort((a, b) => a.sz - b.sz);
      for (const { sx, sy, depth } of sorted) {
        const r = 1.2 + depth * 1.5;
        const alpha = 0.3 + depth * 0.6;
        if (depth > 0.55) {
          ctx.shadowBlur  = 5 + depth * 8;
          ctx.shadowColor = `rgba(${cr},${cg},${cb},0.55)`;
        } else {
          ctx.shadowBlur = 0;
        }
        ctx.beginPath();
        ctx.arc(sx, sy, r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${cr},${cg},${cb},${alpha.toFixed(2)})`;
        ctx.fill();
      }
      ctx.shadowBlur = 0;

      // Soft halo ring — always present, very faint
      ctx.beginPath();
      ctx.arc(cx, cy, R + 14, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${cr},${cg},${cb},0.04)`;
      ctx.lineWidth = 10;
      ctx.stroke();

      // Gold RMS rim — reacts to live mic input
      const rms = voiceRmsRef.current;
      if (rms > 0.04) {
        ctx.beginPath();
        ctx.arc(cx, cy, R + 5 + rms * 8, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${GOLD_RGB.r},${GOLD_RGB.g},${GOLD_RGB.b},${Math.min(rms * 0.9, 0.6).toFixed(2)})`;
        ctx.lineWidth = 1.5 + rms * 2;
        ctx.stroke();
      }

      voiceRafRef.current = requestAnimationFrame(drawVoice);
    };
    drawVoice();
    return () => cancelAnimationFrame(voiceRafRef.current);
  }, [voiceMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-grow the chat input to a 2nd line (capped) as the user types; shrink on clear.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  }, [input]);

  // Keep the latest message in view — including while a reply streams in token-by-token.
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: streamingMsg ? "auto" : "smooth" });
  }, [messages, loading, streamingMsg]);

  const commitRingName = useCallback(async () => {
    setEditingName(false);
    const trimmed = ringNameInput.trim();
    setRingName(trimmed);
    await updateUserField("ring_name", trimmed);
  }, [ringNameInput, updateUserField]);

  // ── Drag handlers ───────────────────────────────────────────────────────────
  const handlePointerDown = useCallback((e) => {
    e.preventDefault(); e.stopPropagation();
    dragStartRef.current  = { px: pos.left, py: pos.top, mx: e.clientX, my: e.clientY };
    hasDraggedRef.current = false;
    setIsDrag(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  }, [pos]);

  const handlePointerMove = useCallback((e) => {
    if (!isDragging || !dragStartRef.current) return;
    const dx = e.clientX - dragStartRef.current.mx;
    const dy = e.clientY - dragStartRef.current.my;
    if (Math.abs(dx) > 5 || Math.abs(dy) > 5) hasDraggedRef.current = true;
    setPos({ top: dragStartRef.current.py + dy, left: dragStartRef.current.px + dx });
  }, [isDragging]);

  const handlePointerUp = useCallback(() => {
    if (!isDragging) return;
    setIsDrag(false);
    if (hasDraggedRef.current) {
      setPos(p => clamp(p));
    } else {
      setChatOpen(o => !o);
      setEditingName(false);
    }
  }, [isDragging]);

  // ── Movable / resizable / maximizable chat window ───────────────────────────
  const [maximized, setMaximized] = useState(false);
  const [winGeom, setWinGeom] = useState(() => {
    const vw = typeof window !== "undefined" ? window.innerWidth  : 1024;
    const vh = typeof window !== "undefined" ? window.innerHeight : 768;
    const width  = Math.min(384, vw - 24);
    const height = Math.min(580, vh - 96);
    return { left: vw - width - 16, top: vh - height - 16, width, height };
  });
  const winDragRef = useRef<any>(null); // { mode, startX, startY, start:{left,top,width,height} }

  // Pointer move during a move/resize gesture (stable ref so we can remove the listener).
  const onWinPointerMove = useCallback((e: PointerEvent) => {
    const d = winDragRef.current; if (!d) return;
    const MINW = 300, MINH = 360;
    const dx = e.clientX - d.startX, dy = e.clientY - d.startY;
    let { left, top, width, height } = d.start;
    if (d.mode === "move") { left += dx; top += dy; }
    else {
      if (d.mode.includes("e")) width  = d.start.width  + dx;
      if (d.mode.includes("s")) height = d.start.height + dy;
      if (d.mode.includes("w")) { width  = d.start.width  - dx; left = d.start.left + dx; }
      if (d.mode.includes("n")) { height = d.start.height - dy; top  = d.start.top  + dy; }
      // enforce minimums while keeping the opposite (anchored) edge fixed
      if (width  < MINW) { if (d.mode.includes("w")) left = d.start.left + (d.start.width  - MINW); width  = MINW; }
      if (height < MINH) { if (d.mode.includes("n")) top  = d.start.top  + (d.start.height - MINH); height = MINH; }
    }
    const vw = window.innerWidth, vh = window.innerHeight;
    width  = Math.min(width,  vw - 8);
    height = Math.min(height, vh - 8);
    left = Math.max(48 - width, Math.min(left, vw - 48)); // always keep ≥48px on screen
    top  = Math.max(0, Math.min(top, vh - 40));
    setWinGeom({ left, top, width, height });
  }, []);

  const onWinPointerUp = useCallback(() => {
    winDragRef.current = null;
    window.removeEventListener("pointermove", onWinPointerMove);
    window.removeEventListener("pointerup", onWinPointerUp);
    try { document.body.style.userSelect = ""; } catch { /* noop */ }
  }, [onWinPointerMove]);

  // Start a move ("move") or resize ("n"/"s"/"e"/"w"/"ne"/… ) gesture.
  const beginWinDrag = (mode: string) => (e: React.PointerEvent) => {
    if (maximized) return; // can't move/resize while full-screen
    if (mode === "move" && (e.target as HTMLElement)?.closest?.("button, input")) return; // let controls work
    e.preventDefault();
    winDragRef.current = { mode, startX: e.clientX, startY: e.clientY, start: { ...winGeom } };
    try { document.body.style.userSelect = "none"; } catch { /* noop */ }
    window.addEventListener("pointermove", onWinPointerMove);
    window.addEventListener("pointerup", onWinPointerUp);
  };

  // ── Session close queue — fires living mind rewrite when chat closes ────────
  const prevChatOpenClose = useRef(false);
  // Keep a ref to messages so beforeunload can read the latest value
  const messagesRef = useRef(messages);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  useEffect(() => {
    const wasOpen = prevChatOpenClose.current;
    prevChatOpenClose.current = chatOpen;
    if (chatOpen && !wasOpen) {
      // Chat just opened — record session start time
      if (!sessionStartedAt.current) sessionStartedAt.current = new Date().toISOString();
    }
    // Chat just closed — fire session-close queue (lowered threshold: 1+ real messages)
    if (wasOpen && !chatOpen && userId && messages.length >= 1) {
      fetch("/api/session-close", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          sessionMessages: messages,
          sessionStartedAt: sessionStartedAt.current,
        }),
      }).catch(() => {});
      // Reset for next session
      sessionStartedAt.current  = null;
      exchangeCountRef.current  = 0;

      // S9 — one-time notification-permission ask, first completed session only.
      // Guarded on: browser support, OS-level permission still undecided, and
      // our own "already asked" flag so it never shows twice (even across tabs).
      if (
        typeof Notification !== "undefined" &&
        Notification.permission === "default" &&
        !localStorage.getItem("sa_notif_ask_shown")
      ) {
        localStorage.setItem("sa_notif_ask_shown", "1");
        setShowNotifAsk(true);
      }
    }
  }, [chatOpen, userId, messages]);

  // ── S9 handlers — accept requests the real browser permission; decline just
  // records that the ask was seen and dismissed. Either way it's a one-shot. ──
  const acceptNotifAsk = useCallback(async () => {
    setShowNotifAsk(false);
    let result = "dismissed";
    try { result = await Notification.requestPermission(); } catch { /* unsupported */ }
    updateUserField({ notification_permission: result, notification_asked_at: new Date().toISOString() }).catch(() => {});
  }, [updateUserField]);

  const dismissNotifAsk = useCallback(() => {
    setShowNotifAsk(false);
    updateUserField({ notification_permission: "dismissed", notification_asked_at: new Date().toISOString() }).catch(() => {});
  }, [updateUserField]);

  // Also fire session-close on page unload/refresh so memory saves even without
  // explicitly closing the chat sheet
  useEffect(() => {
    if (!userId) return;
    function handleUnload() {
      const msgs = messagesRef.current;
      if (!msgs || msgs.length < 1) return;
      // sendBeacon is fire-and-forget — survives page unload
      const payload = JSON.stringify({
        userId,
        sessionMessages: msgs,
        sessionStartedAt: sessionStartedAt.current,
      });
      navigator.sendBeacon("/api/session-close", new Blob([payload], { type: "application/json" }));
    }
    window.addEventListener("pagehide", handleUnload);
    window.addEventListener("beforeunload", handleUnload);
    return () => {
      window.removeEventListener("pagehide", handleUnload);
      window.removeEventListener("beforeunload", handleUnload);
    };
  }, [userId]);

  // ── On chat open: load history OR show situation greeting + refresh chips ────
  const prevChatOpen = useRef(false);
  useEffect(() => {
    const wasOpen = prevChatOpen.current;
    prevChatOpen.current = chatOpen;
    if (!chatOpen || wasOpen) return; // only fire on false→true transition

    // Always refresh smart chips on open
    setSmartChips(buildSmartChips(assignments, courses, userData));

    // Load history or show greeting only once per mount (not on every reopen)
    if (historyLoadedRef.current) return;
    historyLoadedRef.current = true;

    (async () => {
      let convos = [];
      if (userId) {
        convos = await loadConversations(userId);
        setConversations(convos);
        if (convos.length > 0) {
          const recent = convos[0];
          const msgs = await loadConversationMessages(recent.id);
          if (msgs.length > 0) {
            currentConvIdRef.current = recent.id;
            setCurrentConversationId(recent.id);
            setMessages(msgs);
            return; // most-recent conversation loaded — skip greeting
          }
        }
      }
      // No history → situation-aware greeting (a fresh conversation is created
      // lazily on the first user message, so greeting-only chats aren't saved).
      // Zero prior conversations = genuinely their first-ever session (S8): use the
      // intake-personalized opening instead of the generic returning-session ones.
      const greeting = (userId && convos.length === 0)
        ? buildFirstSessionGreeting(assignments, courses, userData)
        : buildSituationGreeting(assignments, courses, userData);
      setMessages([{ role: "assistant", content: greeting }]);
    })();
  }, [chatOpen, assignments, courses, userData, userId]);

  // ── Conversation helpers ─────────────────────────────────────────────────
  /** Fire the memory pipeline for a transcript (same as closing the sheet). */
  const flushSession = useCallback((msgs) => {
    if (!userId || !msgs || msgs.length < 1) return;
    fetch("/api/session-close", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, sessionMessages: msgs, sessionStartedAt: sessionStartedAt.current }),
    }).catch(() => {});
  }, [userId]);

  /** Ensure a conversation row exists (creating on the first message) and bump
   *  its updated_at so it sorts to the top. Returns the conversation id. */
  const ensureConversation = useCallback(async (firstMessage) => {
    const nowIso = new Date().toISOString();
    let id = currentConvIdRef.current;
    if (!id) {
      id = (crypto?.randomUUID?.() ?? `c-${Date.now()}-${Math.random().toString(16).slice(2)}`);
      currentConvIdRef.current = id;
      setCurrentConversationId(id);
      const title = ((firstMessage || "").trim().slice(0, 48)) || "New chat";
      setConversations(prev => [{ id, title, updated_at: nowIso }, ...prev]);
      // Await the insert so the conversation row exists BEFORE chat_logs references it —
      // otherwise the chat_logs.conversation_id foreign key fails with a 409 on the first
      // message of a new conversation (the insert and the log were racing).
      await supabase.from("chat_conversations")
        .insert({ id, user_id: userId, title, created_at: nowIso, updated_at: nowIso });
    } else {
      setConversations(prev => {
        const found = prev.find(c => c.id === id);
        if (!found) return prev;
        return [{ ...found, updated_at: nowIso }, ...prev.filter(c => c.id !== id)];
      });
      supabase.from("chat_conversations").update({ updated_at: nowIso }).eq("id", id).then(() => {}, () => {});
    }
    return id;
  }, [userId]);

  /** Stop any in-flight typewriter/stream so it can't bleed into the new view. */
  const haltStreaming = useCallback(() => {
    if (typeTimerRef.current) { clearInterval(typeTimerRef.current); typeTimerRef.current = null; }
    setStreamingMsg("");
  }, []);

  /** Start a fresh conversation, preserving memory from the current one.
   *  Lands on the empty state (orb + smart chips) so it's clearly a NEW chat. */
  const startNewChat = useCallback(() => {
    flushSession(messagesRef.current);
    haltStreaming();
    sessionStartedAt.current = new Date().toISOString();
    exchangeCountRef.current = 0;
    currentConvIdRef.current = null;
    setCurrentConversationId(null);
    setHistoryOpen(false);
    setReactions({});
    setSmartChips(buildSmartChips(assignments, courses, userData));
    setMessages([]); // empty → the fresh "new chat" interface
  }, [flushSession, haltStreaming, assignments, courses, userData]);

  /** Open a past conversation, preserving memory from the current one. */
  const openConversation = useCallback(async (convId) => {
    if (convId === currentConvIdRef.current) { setHistoryOpen(false); return; }
    flushSession(messagesRef.current);
    haltStreaming();
    sessionStartedAt.current = new Date().toISOString();
    exchangeCountRef.current = 0;
    currentConvIdRef.current = convId;
    setCurrentConversationId(convId);
    setHistoryOpen(false);
    setReactions({});
    setMessages([]); // clear immediately so the switch is visible while loading
    const loaded = await loadConversationMessages(convId);
    // Guard against a stale switch if the user changed convos again mid-load
    if (currentConvIdRef.current !== convId) return;
    setMessages(loaded.length ? loaded : [{ role: "assistant", content: "This conversation is empty." }]);
  }, [flushSession, haltStreaming]);

  /** Delete a conversation (its messages cascade in the DB). */
  const deleteConversation = useCallback(async (convId, e) => {
    e?.stopPropagation?.();
    setConversations(prev => prev.filter(c => c.id !== convId));
    try { await supabase.from("chat_conversations").delete().eq("id", convId); } catch { /* non-fatal */ }
    if (convId === currentConvIdRef.current) startNewChat();
  }, [startNewChat]);

  // ── Typewriter ──────────────────────────────────────────────────────────────────────────
  const typewrite = useCallback((text, durationSecs) => {
    return new Promise<void>((resolve) => {
      if (typeTimerRef.current) clearInterval(typeTimerRef.current);
      let i = 0;
      setStreamingMsg("");
      // Spread typing over actual audio duration, min 1.5s, with slight padding
      const totalMs  = Math.max(1500, durationSecs * 1000 * 0.92);
      const interval = Math.max(16, Math.round(totalMs / text.length));
      typeTimerRef.current = setInterval(() => {
        i++;
        setStreamingMsg(text.slice(0, i));
        if (i >= text.length) {
          clearInterval(typeTimerRef.current);
          typeTimerRef.current = null;
          setMessages(m => [...m, { role: "assistant", content: text }]);
          setStreamingMsg("");
          resolve();
        }
      }, interval);
    });
  }, []);

  // ── Speak + type in sync ───────────────────────────────────────────────────────────────
  // Fetch audio first → get real duration → start both typewriter and playback together.
  // This eliminates the 1-2s delay between text appearing and voice starting.
  const speakAndType = useCallback(async (text) => {
    const plain = text.replace(/<[^>]+>/g, "").trim();
    if (!plain) return;

    if (mutedRef.current) {
      await typewrite(plain, 3); // ~3s default when no voice
      return;
    }

    try {
      setSpeaking(true);
      // Decode audio first so we have the real duration
      const tone = TONE_PRESETS[toneRef.current] ?? TONE_PRESETS.neutral;
      const { duration, play } = await fetchAndDecodeAudio(plain, voiceIdRef.current, speedRef.current, tone);
      // Now start both simultaneously — typewriter matches actual audio length
      await Promise.all([
        play((src) => { audioSourceRef.current = src; }).finally(() => {
          audioSourceRef.current = null;
          setSpeaking(false);
        }),
        typewrite(plain, duration),
      ]);
    } catch (err) {
      console.warn("TTS failed, staying text-only:", err.message);
      setSpeaking(false);
      await typewrite(plain, 3);
    }
  }, [muted, typewrite]);

  // ── Instant client-side navigation — handles unambiguous "take me to X" phrases ──
  // Fires before any API call so navigation feels instant. Claude's <nav> tags
  // handle all other nav (e.g. "I want to study calculus") — this is just a fast
  // path for the obvious verbs that never need AI interpretation.
  // Each intent requires an EXPLICIT navigation verb before the page noun. The old
  // patterns made the verb optional (e.g. `(go to|open)?\s*(my courses?)`), so any
  // message merely CONTAINING "courses"/"assignments" was hijacked into a silent
  // page-switch + "On it." and never reached the tutor. Real questions
  // ("help me with my courses", "show me my courses") must fall through to Claude,
  // which can still navigate on its own via <nav> tags when that's the right move.
  const NAV_INTENTS = [
    { re: /\b(take me to|go to|open|navigate to|switch to)\s+(the\s+)?(study|flashcards?|flash card|review)\b/i,            page: "study"       },
    { re: /\b(take me to|go to|open|navigate to|switch to)\s+(the\s+)?(toolkit|my tools|brain mode)\b/i,                    page: "toolkit"     },
    { re: /\b(take me to|go to|open|navigate to|switch to)\s+(the\s+)?(leaderboard|ranking|scoreboard|standings|my rank)\b/i, page: "leaderboard" },
    { re: /\b(take me to|go to|open|navigate to|switch to)\s+(the\s+)?(canvas|my courses?|courses? page|course page)\b/i,   page: "canvas"      },
    { re: /\b(take me to|go to|open|navigate to|switch to)\s+(the\s+)?(assignments?|my assignments?|homework)\b/i,         page: "assignment"  },
    { re: /\b(go home|take me home|open dashboard|go to dashboard|go to work)\b/i,                                          page: "work"        },
    { re: /\b(take me to|go to|open|navigate to|switch to)\s+(my\s+|the\s+)?(profile|settings|identity)\b/i,               page: "identity"    },
  ];
  const NAV_PAGE_LABELS = {
    work:        "your dashboard",
    assignment:  "assignments",
    study:       "study",
    canvas:      "Canvas",
    toolkit:     "toolkit",
    leaderboard: "your leaderboard",
    identity:    "your profile",
  };

  // ── Streaming STT capture (VITE_VOICE_STREAMING=1) ──────────────────────────
  // Opens a Scribe WebSocket over an already-running mic stream. Differs from the
  // MediaRecorder path in who decides the turn is over: there, a local RMS timer stops
  // the recorder; here, the provider's VAD commits segments and scribeStream assembles
  // them into a turn.
  //
  // The mic stream is NOT stopped when a turn dispatches — it stays open so barge-in
  // can interrupt the reply, exactly as the batch path keeps it alive after mr.onstop.
  // The socket does close per turn (and after 5s with no transcripts), because
  // ElevenLabs bills connected time and auto-listen re-arms after every turn.
  async function _startScribeCapture(stream, analyser) {
    setIsRecording(true);
    // "connecting", NOT "listening". The token mint plus WebSocket handshake is a real
    // round-trip; showing a listening state through it tells the user to start talking
    // into a socket that isn't open yet, and those words are lost. Flipped to
    // "listening" from onReady below, once the socket is actually accepting audio.
    sphereStateRef.current = "connecting";
    setVoiceConnecting(true);

    // Local RMS loop: drives the sphere's voice reactivity and owns barge-in. Kept on
    // the local signal rather than provider frames — an interruption has to feel
    // instant, and a network round-trip does not.
    const data = new Float32Array(analyser.fftSize);
    const BARGE_THRESH = 0.012 * 2.5;
    const BARGE_FRAMES = 10;   // ~150-200ms sustained, so the tutor's own audio leaking
                               // into the mic can't cut its answer off mid-sentence.
    let bargeCount = 0;
    function tick() {
      if (!analyserRef.current) return;  // stream closed
      analyser.getFloatTimeDomainData(data);
      const rms = Math.sqrt(data.reduce((s, v) => s + v * v, 0) / data.length);
      voiceRmsRef.current = Math.min(rms * 14, 1);
      if (speakingRef.current && rms > BARGE_THRESH) {
        if (++bargeCount >= BARGE_FRAMES) { stopResponse(); return; }
      } else {
        bargeCount = 0;
      }
      silenceRafRef.current = requestAnimationFrame(tick);
    }
    tick();

    function endCapture() {
      cancelAnimationFrame(silenceRafRef.current);
      voiceRmsRef.current = 0;
      setVoiceConnecting(false);
      setIsRecording(false);   // lets the next startAutoListen() past its re-entry guard
      scribeRef.current?.stop();
      scribeRef.current = null;
    }

    try {
      scribeRef.current = await startScribeSession({
        stream,
        onReady: () => {
          // Socket open and accepting audio — safe to invite the user to speak.
          setVoiceConnecting(false);
          if (voiceModeRef.current) sphereStateRef.current = "listening";
        },
        // Provisional text, replaced on every frame. Rendering it is P2-6; holding it
        // in a ref keeps this path from re-rendering the orb on every partial.
        onPartial: (t) => { voicePartialRef.current = t; },
        onTurn: async (t) => {
          voicePartialRef.current = "";
          endCapture();
          await _handleTranscript(t);
        },
        onError: (kind, detail) => {
          console.warn("[voice] scribe error:", kind, detail ?? "");
          // Terminal failures must never leave voice mode showing active over a dead
          // socket. Each one gets a reason the user can act on rather than silence.
          const fatal = {
            auth_error: "Voice session expired — tap the mic to restart.",
            quota_exceeded: "Voice transcription quota reached.",
            not_configured: "Voice transcription isn't configured on the server.",
            session_time_limit_exceeded: "Voice session timed out — tap the mic to restart.",
            transcriber_error: "Voice transcription failed — tap the mic to retry.",
          }[kind];
          if (fatal) {
            setVoiceError(fatal);
            endCapture();
            sphereStateRef.current = "idle";
            exitVoiceMode();
          }
        },
        onClose: () => {
          // Idle timeout or provider close with nothing buffered. Drop back to idle
          // rather than sitting armed against a socket that no longer exists.
          if (!scribeRef.current) return;   // already torn down by endCapture
          endCapture();
          sphereStateRef.current = "idle";
        },
      });
    } catch (err) {
      // Session never opened (token mint refused, socket blocked). Voice mode cannot
      // work at all, so say so rather than sitting in a listening state that isn't.
      console.warn("[voice] scribe session failed:", err?.message);
      endCapture();
      sphereStateRef.current = "idle";
      setVoiceError("Couldn't start voice input — tap the mic to retry.");
      exitVoiceMode();
    }
  }

  // ── Voice mode: auto-listen + silence detection + barge-in ──────────────────
  async function startAutoListen() {
    if (isRecording || micDenied) return;
    // Stop any lingering stream kept alive for barge-in monitoring
    cancelAnimationFrame(silenceRafRef.current);
    micStreamRef.current?.getTracks().forEach(t => t.stop());
    micStreamRef.current = null;
    analyserRef.current  = null;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      micStreamRef.current    = stream;
      speechDetectedRef.current = false;
      audioChunksRef.current  = [];

      // WebAudio analyser for live RMS (silence detection + barge-in)
      const audCtx   = getAudioContext();
      const analyser = audCtx.createAnalyser();
      analyser.fftSize = 512;
      const src = audCtx.createMediaStreamSource(stream);
      src.connect(analyser);
      analyserRef.current = analyser;

      // ── Streaming STT switch ────────────────────────────────────────────────
      // VITE_VOICE_STREAMING=1 sends audio to ElevenLabs Scribe over a WebSocket and
      // lets the provider's VAD decide when the speaker is done. Unset/"0" keeps the
      // MediaRecorder path below (record whole utterance -> blob -> POST /api/stt).
      //
      // Both paths are kept on purpose so a bad turn in front of users is one env var
      // from a rollback. See src/lib/scribeStream.ts for the full rationale.
      //
      // The analyser above is wired before this branch because BOTH paths need it:
      // barge-in runs on local RMS, which is instant, where provider frames carry
      // network latency.
      if (isStreamingSTT()) {
        await _startScribeCapture(stream, analyser);
        return;
      }

      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus" : "audio/webm";
      const mr = new MediaRecorder(stream, { mimeType });
      mr.ondataavailable = e => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      mr.onstop = async () => {
        cancelAnimationFrame(silenceRafRef.current);
        clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = null;
        setIsRecording(false);
        voiceRmsRef.current = 0;
        if (!audioChunksRef.current.length) {
          // No audio captured — clean up stream immediately
          stream.getTracks().forEach(t => t.stop());
          micStreamRef.current = null;
          analyserRef.current  = null;
          return;
        }
        // Keep stream + analyser alive so the barge-in monitor can interrupt TTS.
        // The next startAutoListen() will stop this stream before opening a fresh one.
        const bargeinData = new Float32Array(analyser.fftSize);
        const BARGE_THRESH = 0.012 * 2.5;
        const BARGE_FRAMES = 10;   // ~150-200ms of SUSTAINED input before we treat it as a
                                   // real interruption — so the tutor's own audio leaking
                                   // into the mic (echo on speakers) or a one-frame blip
                                   // can't cut its answer off mid-sentence.
        let bargeCount = 0;
        function bargeinTick() {
          if (!analyserRef.current) return; // stream was closed
          analyser.getFloatTimeDomainData(bargeinData);
          const rms = Math.sqrt(bargeinData.reduce((s, v) => s + v * v, 0) / bargeinData.length);
          voiceRmsRef.current = Math.min(rms * 14, 1);
          if (speakingRef.current && rms > BARGE_THRESH) {
            if (++bargeCount >= BARGE_FRAMES) {
              stopResponse(); // kills TTS chain + aborts stream
              return;         // let sendMessage's finally-path call startAutoListen
            }
          } else {
            bargeCount = 0;   // reset on any quiet frame — only sustained speech interrupts
          }
          silenceRafRef.current = requestAnimationFrame(bargeinTick);
        }
        // Brief delay so TTS startup transient doesn't trigger false barge-in
        setTimeout(() => { if (analyserRef.current) bargeinTick(); }, 300);

        const blob = new Blob(audioChunksRef.current, { type: mimeType });
        await _transcribeAndSend(blob, mimeType);
      };
      mediaRecorderRef.current = mr;
      mr.start();
      setIsRecording(true);
      sphereStateRef.current = "listening";

      // Silence + barge-in detection loop
      const data = new Float32Array(analyser.fftSize);
      const SPEECH_THRESH  = 0.012;
      const SILENCE_MS     = 1400;  // trailing silence before auto-stop — long enough that a
                                    // natural mid-sentence pause doesn't cut the speaker off
      const MIN_SPEECH_MS  = 400;   // min speech duration before silence timer arms
      let   speechStartTime = null; // when speech first crossed threshold this utterance
      let   bargeFrames     = 0;    // consecutive loud frames while tutor speaks (debounce)

      function silenceTick() {
        if (!analyserRef.current) return;
        analyser.getFloatTimeDomainData(data);
        const rms = Math.sqrt(data.reduce((s, v) => s + v * v, 0) / data.length);
        voiceRmsRef.current = Math.min(rms * 14, 1);

        // Barge-in: user speaks while tutor is speaking → interrupt. Require SUSTAINED
        // input (not a single spike) so the tutor's own audio / a blip can't cut it off.
        if (speakingRef.current && rms > SPEECH_THRESH * 2.5) {
          if (++bargeFrames >= 10) stopResponse();
        } else {
          bargeFrames = 0;
        }

        if (rms > SPEECH_THRESH) {
          if (!speechDetectedRef.current) {
            speechDetectedRef.current = true;
            speechStartTime = Date.now();
          }
          clearTimeout(silenceTimerRef.current);
          silenceTimerRef.current = null;
        } else if (speechDetectedRef.current && !silenceTimerRef.current
                   && mr.state === "recording") {
          // Only arm once speech has lasted long enough to be real speech
          const speechDuration = Date.now() - (speechStartTime ?? 0);
          if (speechDuration >= MIN_SPEECH_MS) {
            silenceTimerRef.current = setTimeout(() => {
              if (mr.state === "recording") mr.stop();
            }, SILENCE_MS);
          }
        }
        silenceRafRef.current = requestAnimationFrame(silenceTick);
      }
      silenceTick();

    } catch (err) {
      // Every branch here used to leave voice mode switched on with no working mic:
      // a denial only set micDenied, and any other failure (device busy, no input
      // device, hardware error) was logged and otherwise ignored.
      console.warn("[voice] mic error:", err?.name, err?.message);
      if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
        setMicDenied(true);
        setVoiceError("Microphone permission denied — allow it in your browser to use voice.");
      } else if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
        setVoiceError("No microphone found.");
      } else {
        setVoiceError("Microphone unavailable — it may be in use by another app.");
      }
      sphereStateRef.current = "idle";
      exitVoiceMode();
    }
  }

  function exitVoiceMode() {
    // Set ref synchronously FIRST so any in-flight async code sees false immediately,
    // without waiting for the useEffect to run after paint.
    voiceModeRef.current = false;
    if (mediaRecorderRef.current?.state === "recording") mediaRecorderRef.current.stop();
    // Streaming path: close the socket explicitly. ElevenLabs bills connected time, so
    // an orphaned session left open after the user exits voice mode costs real money.
    scribeRef.current?.stop();
    scribeRef.current = null;
    voicePartialRef.current = "";
    micStreamRef.current?.getTracks().forEach(t => t.stop());
    micStreamRef.current = null;
    analyserRef.current  = null;
    cancelAnimationFrame(silenceRafRef.current);
    clearTimeout(silenceTimerRef.current);
    cancelAnimationFrame(voiceRafRef.current);
    voiceRmsRef.current = 0;
    setIsRecording(false);
    setVoiceConnecting(false);
    setVoiceMode(false);
    setMicDenied(false);
    sphereStateRef.current = "idle";
    // Clear voice quiz state
    voiceQuizRef.current = null;
    setVoiceQuizProgress(null);
    interruptedTextRef.current = null;
  }

  // ── Voice quiz: judge a spoken answer, advance, or finish ─────────────────
  async function _judgeVoiceQuizAnswer(answer) {
    const quiz = voiceQuizRef.current;
    if (!quiz) return;
    sphereStateRef.current = "thinking";

    const question = quiz.questions[quiz.idx];
    try {
      // Lightweight judge call — Groq (fast, cheap, no Claude quota needed for ~80 token judgments)
      const judgeSystem = `You are judging a spoken quiz answer. Reply in ONE concise spoken sentence. If correct, start with "Correct!" If wrong, start with "Not quite —" and give the short correct answer. Warm, brief. No lists, no markdown.`;
      const judgeMsgs   = [{ role: "user", content: `Question: ${question.q}\nCorrect answer: ${question.a}\nStudent said: "${answer}"` }];
      let feedback;
      try {
        feedback = (await groq(judgeMsgs, judgeSystem)).trim();
      } catch (_) {
        // Fallback: simple keyword match if Groq is unavailable
        feedback = /^(correct|yes|right|yeah)/i.test(answer) ? "Correct!" : `Not quite — ${question.a}.`;
      }
      const isCorrect = /^correct/i.test(feedback);
      const newScore  = quiz.score + (isCorrect ? 1 : 0);
      const newIdx    = quiz.idx + 1;
      const total     = quiz.questions.length;

      if (newIdx >= total) {
        // ── Quiz complete ────────────────────────────────────────────────────
        voiceQuizRef.current = null;
        setVoiceQuizProgress(null);
        const weak = !isCorrect ? ` Your weakest spot was ${question.q.slice(0, 50)}.` : "";
        const resultText = `${feedback} That's ${newScore} out of ${total}.${weak} Want to drill any of those again?`;
        setMessages(m => [...m, { role: "user", content: answer }, { role: "assistant", content: resultText }]);
        setLoading(false);
        awardTokens("quiz_completed", { score: newScore, total }).catch(() => {});
        if (newScore === total) awardTokens("quiz_perfect", { score: newScore, total }).catch(() => {});
        lastSpokenTextRef.current = resultText;
        await speakAndType(resultText);
        if (voiceModeRef.current && !micDenied) await startAutoListen();
        return;
      }

      // ── Next question ────────────────────────────────────────────────────
      voiceQuizRef.current = { ...quiz, idx: newIdx, score: newScore };
      setVoiceQuizProgress({ current: newIdx + 1, total });
      const nextQ    = quiz.questions[newIdx];
      const nextText = `${feedback} Question ${newIdx + 1}: ${nextQ.q}`;
      setMessages(m => [...m, { role: "user", content: answer }, { role: "assistant", content: nextText }]);
      lastSpokenTextRef.current = nextText;
      await speakAndType(nextText);
      if (voiceModeRef.current && !micDenied) await startAutoListen();
    } catch (err) {
      console.warn("[voice quiz]", err.message);
      sphereStateRef.current = "idle";
      if (voiceModeRef.current && !micDenied) await startAutoListen();
    }
  }

  async function _transcribeAndSend(blob, mimeType) {
    // Guard: if voice mode was exited between recording start and onstop firing,
    // discard the audio — don't send a stale recording as a text-mode message.
    if (!voiceModeRef.current) {
      return;
    }
    sphereStateRef.current = "thinking";
    try {
      const base64 = await new Promise((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res((fr.result as string).split(",")[1]);
        fr.onerror = rej;
        fr.readAsDataURL(blob);
      });
      const sttRes = await fetch("/api/stt", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ audio: base64, mimeType }),
      });
      if (!sttRes.ok) throw new Error(`STT ${sttRes.status}`);
      const { text } = await sttRes.json();
      await _handleTranscript(text);
    } catch (err) {
      console.warn("[voice] STT error:", err.message);
      sphereStateRef.current = "idle";
    }
  }

  // Post-transcript dispatch, shared by both STT paths (batch blob and streaming
  // Scribe). Everything from the silence guard through command handling to sendMessage
  // is identical regardless of how the words arrived — only the capture differs.
  async function _handleTranscript(text) {
    if (!voiceModeRef.current) return;
    sphereStateRef.current = "thinking";
    try {
      // Whisper HALLUCINATES on silence: ".", "...", "Thank you.", "you" are its classic
      // quiet-room artifacts. Treating them as real speech created the "keeps saying
      // dots" loop: silence -> "." sent as a message -> reply -> re-listen -> repeat.
      // Scribe is far less prone to this, but the guard is cheap and path-agnostic.
      const t = (text ?? "").trim();
      const silenceArtifact =
        /^[.,!?;:…\s]*$/.test(t) ||
        /^(you|thank you|thanks for watching)[.!]?$/i.test(t);
      if (!t || silenceArtifact) {
        // Empty/hallucinated transcript — re-listen silently rather than leaving dead air
        sphereStateRef.current = "idle";
        if (voiceModeRef.current && !micDenied) await startAutoListen();
        return;
      }
      const trimmed = t;

      // ── Stop-word detection — halt without sending to Claude ─────────────
      // "stop"/"wait"/"hold on" mean stop TALKING, not leave voice mode. This used to
      // return without re-arming, so the orb kept showing voice mode as active over a
      // mic that was no longer listening — the user's next sentence went nowhere.
      if (VOICE_STOP_WORDS.test(trimmed)) {
        interruptedTextRef.current = null;
        sphereStateRef.current = "idle";
        if (voiceModeRef.current && !micDenied) await startAutoListen();
        return;
      }

      // ── "Say that again" — re-speak last response ──────────────────────
      if (VOICE_REPEAT_WORDS.test(trimmed) && lastSpokenTextRef.current) {
        sphereStateRef.current = "idle";
        await speakAndType(lastSpokenTextRef.current);
        if (voiceModeRef.current && !micDenied) await startAutoListen();
        return;
      }

      // ── Speed modulation via spoken command ────────────────────────────
      if (VOICE_SPEED_FAST.test(trimmed)) {
        const next = Math.min(1.3, (speedRef.current || 1.0) + 0.15);
        speedRef.current = next;
        updateUserField("preferred_speed", next).catch(() => {});
        const reply = next >= 1.25 ? "At maximum speed." : "Speaking faster.";
        sphereStateRef.current = "idle";
        await speakAndType(reply);
        if (voiceModeRef.current && !micDenied) await startAutoListen();
        return;
      }
      if (VOICE_SPEED_SLOW.test(trimmed)) {
        const next = Math.max(0.7, (speedRef.current || 1.0) - 0.15);
        speedRef.current = next;
        updateUserField("preferred_speed", next).catch(() => {});
        const reply = next <= 0.75 ? "At minimum speed." : "Slowing down.";
        sphereStateRef.current = "idle";
        await speakAndType(reply);
        if (voiceModeRef.current && !micDenied) await startAutoListen();
        return;
      }

      // ── Active voice quiz — route answer to judge ─────────────────────
      if (voiceQuizRef.current) {
        await _judgeVoiceQuizAnswer(trimmed);
        return;
      }

      // ── Normal message ─────────────────────────────────────────────────
      sttFailStreakRef.current = 0;
      await sendMessage(trimmed);
    } catch (err) {
      // Previously this left voice mode visually active with a dead mic on ANY error —
      // one dropped request ended the conversation with no explanation. Retry once, then
      // stop pretending: a third failure exits voice mode with a visible reason.
      console.warn("[voice] transcript dispatch error:", err?.message);
      sphereStateRef.current = "idle";
      sttFailStreakRef.current += 1;
      if (sttFailStreakRef.current >= 2) {
        setVoiceError("Voice input failed repeatedly — voice mode off. You can still type.");
        exitVoiceMode();
        return;
      }
      if (voiceModeRef.current && !micDenied) await startAutoListen();
    }
  }

  // ── Chat ──────────────────────────────────────────────────────────────────────────
  // Attach a file from the chat: extract its text and ingest it into RAG (api/extract
  // auto-ingests when given userId), so the tutor can answer about it — same pipeline as
  // "Add study material", no re-upload. Stays in rag_* (searchable), not the Files library.
  const handleAttachFile = async (file) => {
    if (!file) return;
    if (!userId) { setAttachStatus("Sign in to attach files."); setTimeout(() => setAttachStatus(null), 3000); return; }
    if (file.size > 4 * 1024 * 1024) {
      setAttachStatus(`"${file.name}" is too large here — add big files via Study materials.`);
      setTimeout(() => setAttachStatus(null), 5000);
      return;
    }
    setAttachStatus(`Reading ${file.name}…`);
    try {
      const base64 = await new Promise<string>((res, rej) => {
        const fr = new FileReader();
        fr.onload  = () => res(String(fr.result).split(",")[1] ?? "");
        fr.onerror = () => rej(fr.error);
        fr.readAsDataURL(file);
      });
      setAttachStatus(`Indexing ${file.name}…`);
      const r = await fetch("/api/extract", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base64, file_type: file.type, name: file.name, userId }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.text) throw new Error(d.error || "Couldn't read that file.");
      setAttachStatus(null);
      setMessages(m => [...m, { role: "assistant", content: `Indexed **${file.name}** — ask me anything about it.` }]);
    } catch {
      setAttachStatus(`Couldn't attach ${file.name}.`);
      setTimeout(() => setAttachStatus(null), 5000);
    }
  };

  // ── Reggie-mode turn: stream /api/agent-manager (live tokens + tool progress) ──
  // Text mode streams the answer token-by-token into the streaming bubble; voice mode
  // shows the tool-progress line while working, then speaks the answer. Self-contained
  // (does not use the classic viz/rag/Claude tail).
  // ── Voice-tag executors — ONE implementation shared by the classic tutor and
  // Reggie mode, so the two paths can't drift. Tags come from src/lib/voiceTags.
  const applyVoicePrefTags = (voiceTags) => {
    // [VOICE:x] — match by name, persist + apply immediately
    if (voiceTags.VOICE) {
      const query  = String(voiceTags.VOICE).toLowerCase().trim();
      const words  = query.split(/\s+/).filter(w => w.length > 2);
      // Score each voice: exact name > partial name > label words coverage
      const scored = availableVoices.map(v => {
        const name   = v.name.toLowerCase();
        const labels = Object.values(v.labels ?? {}).join(" ").toLowerCase();
        const all    = name + " " + labels;
        if (name === query) return { v, score: 100 };
        const hits = words.filter(w => all.includes(w)).length;
        return { v, score: hits };
      }).filter(x => x.score > 0).sort((a, b) => b.score - a.score);
      const match = scored[0]?.v;
      if (match) {
        voiceIdRef.current = match.voice_id;         // sync — next TTS chunk uses this
        setActiveVoiceId(match.voice_id);             // instant chip highlight
        updateUserField("preferred_voice_id", match.voice_id).catch(() => {}); // persist async
      }
    }
    if (voiceTags.SPEED) {
      const sp = Math.min(1.3, Math.max(0.7, parseFloat(voiceTags.SPEED) || 1.0));
      speedRef.current = sp;
      updateUserField("preferred_speed", sp).catch(() => {});
    }
    if (voiceTags.TONE) {
      const t = String(voiceTags.TONE).toLowerCase();
      if (TONE_PRESETS[t]) {
        toneRef.current = t;
        updateUserField("preferred_tone", t).catch(() => {});
      }
    }
  };

  // [SYNC] — refresh Canvas data, narrating the result.
  const execVoiceSync = async () => {
    try {
      if (!canvasToken) {
        const msg = "Canvas isn't connected yet. Head to the Canvas page to set that up first.";
        setMessages(m => [...m, { role: "assistant", content: msg }]);
        lastSpokenTextRef.current = msg;
        await speakAndType(msg);
      } else {
        await forceSync();
        const cCount = courses.length;
        const aCount = assignments.length;
        const msg = `Done — synced ${cCount} course${cCount !== 1 ? "s" : ""} and ${aCount} assignment${aCount !== 1 ? "s" : ""}.`;
        setMessages(m => [...m, { role: "assistant", content: msg }]);
        lastSpokenTextRef.current = msg;
        await speakAndType(msg);
      }
    } catch (_) {
      if (voiceModeRef.current) await speakAndType("Canvas sync ran into an issue. Try again in a moment.");
    }
  };

  // [GENERATE_FLASHCARDS:course] — generate + save 8 cards, award tokens, narrate.
  const execVoiceFlashcards = async (courseTag) => {
    const course = typeof courseTag === "string" && courseTag
      ? courseTag
      : (courseOptions[0] ?? "your course");
    try {
      const flashResult = await groq([{
        role: "user",
        content: `Create exactly 8 study flashcards for "${course}". Format each card as: Q: [question] | A: [answer] — one per line. No numbering, no extra text, no markdown.`,
      }]);
      const cards = flashResult.split(String.fromCharCode(10))
        .filter(l => l.includes("Q:") && l.includes(" | ") && l.includes("A:"))
        .map(l => {
          const [qP, aP] = l.split(" | ");
          return { question: (qP || "").replace(/^Q:/i, "").trim(), answer: (aP || "").replace(/^A:/i, "").trim() };
        })
        .filter(c => c.question && c.answer);
      if (cards.length > 0) {
        await replaceFlashcardDeck(supabase, userId, null, cards);   // flashcards_v2 (the read table)
        awardTokens("flashcards_generated", {}).catch(() => {});
        const msg = `${cards.length} flashcards ready for ${course}. Head to Study to review them.`;
        setMessages(m => [...m, { role: "assistant", content: msg }]);
        lastSpokenTextRef.current = msg;
        await speakAndType(msg);
      }
    } catch (_) {
      if (voiceModeRef.current) await speakAndType("Flashcard generation hit an error. Try again in a moment.");
    }
  };

  const runReggieTurn = async (text) => {
    // Only the last few turns are sent: the server caps history at 10 turns anyway, so
    // anything older was uploaded and discarded — on a long session that is a steadily
    // growing request body in front of every answer.
    const history = messages
      .filter(m => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .slice(-10)
      .map(m => ({ role: m.role, content: m.content }));
    abortCtrlRef.current = new AbortController();
    // Stale barge-in context from a previous turn must not leak into this one (the
    // classic path consumes it; Reggie mode clears it).
    interruptedTextRef.current = null;
    const voice = voiceModeRef.current;
    const speakLive = voice && !mutedRef.current;      // sentence-chunked TTS while streaming
    let streamed = "", toolNote = "", finalOut = "", errMsg = null;
    let activity = []; setLiveActivity([]);
    let widgets: Array<{ type: string; data: any }> = [];
    let turnSources: Array<{ title: string; heading?: string | null; loc?: string | null }> = [];
    let turnTraceId: string | null = null;
    const paint = () => setStreamingMsg([toolNote, voice ? "" : streamed].filter(Boolean).join("\n\n"));

    // ── Streaming TTS (voice mode): speak each sentence the moment it closes — same
    // chain discipline as the classic streaming path (stop button + barge-in honored
    // via voiceTTSAbortRef / abort signal). Voice-UI tags are stripped before speech.
    // A per-turn generation stamp (not just the shared boolean) kills the race where a
    // NEW turn resets voiceTTSAbortRef before an old chain item ran its abort check —
    // the old item would otherwise resume speaking stale sentences over the new answer.
    let ttsChain = Promise.resolve();
    const myGen = ++reggieTtsGen;
    voiceTTSAbortRef.current = false;
    let spokenSoFar = "";
    const enqueueTTS = (sentence) => {
      const clean = sanitizeForTTS(parseVoiceTags(sentence).cleaned);
      if (!clean) return;
      // Progressive capture so a barge-in (stopResponse) sees what was actually spoken
      // this turn — streamingMsg is suppressed in voice mode, so it can't serve that role.
      spokenSoFar += (spokenSoFar ? " " : "") + clean;
      lastSpokenTextRef.current = spokenSoFar;
      // PIPELINE: start synthesizing THIS sentence immediately, in parallel with whatever
      // is currently playing — the chain serializes PLAYBACK order only. Without this,
      // sentence N+1's synthesis waited for sentence N to finish playing, inserting a
      // full TTS round-trip of silence between every spoken sentence.
      const tone = TONE_PRESETS[toneRef.current] ?? TONE_PRESETS.neutral;
      const audioP = fetchAndDecodeAudio(clean, voiceIdRef.current, speedRef.current, tone);
      audioP.catch(() => {});   // consumed in the chain — pre-empt unhandled-rejection noise
      ttsChain = ttsChain.then(async () => {
        if (abortCtrlRef.current?.signal?.aborted || voiceTTSAbortRef.current || myGen !== reggieTtsGen) return;
        setSpeaking(true); speakingRef.current = true;
        sphereStateRef.current = "speaking";
        try {
          const { play } = await audioP;
          await play(src => { audioSourceRef.current = src; });
        } catch (e) {
          // Do NOT swallow this. The sphere is showing "speaking" right now; if audio
          // failed, the user is staring at a talking orb in silence with no explanation.
          // Surface it once per turn and let the text carry the reply.
          console.warn("[reggie voice chunk]", e?.message);
          setVoiceError("Voice output failed — showing text instead.");
        }
      });
    };
    const chunker = createSentenceChunker(enqueueTTS);

    try {
      await streamReggie(
        {
          userId, message: text, history, voiceMode: voice,
          // When the student launched from an assignment, ground the tutor in it — the
          // agent-manager forwards these into ctx for the assignment-aware tools.
          courseId:     activeAssignmentRef.current?.courseId ?? null,
          assignmentId: activeAssignmentRef.current?.assignmentId ?? null,
        },
        {
          onToken:      (d) => { streamed += d; toolNote = ""; paint(); if (speakLive) chunker.feed(d); },
          onReset:      ()  => { streamed = ""; paint(); chunker.reset(); },
          onToolCall:   (n) => { activity = [...activity, { name: n, label: reggieToolLabel(n), status: "running" }]; setLiveActivity(activity); },
          onToolResult: (n, ok, srcs) => {
            for (let i = activity.length - 1; i >= 0; i--) {
              if (activity[i].name === n && activity[i].status === "running") { activity[i] = { ...activity[i], status: ok ? "ok" : "err", sources: srcs }; break; }
            }
            activity = [...activity]; setLiveActivity(activity);
          },
          onDone:       (r) => { finalOut = r.output || ""; widgets = r.widgets || []; turnSources = r.sources || []; turnTraceId = r.traceId || null; },
          onError:      (m) => { errMsg = m; },
        },
        abortCtrlRef.current?.signal,
      );
    } catch (e) {
      if (e?.name === "AbortError") { setLoading(false); setStreamingMsg(""); return; }
      errMsg = e?.message || "request failed";
    }
    if (speakLive) chunker.flush();                    // speak the trailing sentence
    setLoading(false);
    setStreamingMsg("");
    if (errMsg) {
      // If the stream was cut off after some text arrived, keep that partial answer
      // (it's real and useful) rather than throwing it away for a canned failure.
      const partial = stripAgentJSON(streamed);
      const content = partial || "Something went wrong. Try again.";
      logChat(userId, "assistant", content, null, currentConvIdRef.current);
      setMessages(m => [...m, { role: "assistant", content }]);
      voiceTTSAbortRef.current = true;                 // don't keep talking into an error
      // A chain item may have set the speaking state before the error — clean up, or the
      // orb stays "speaking" forever and the barge-in RAF kills the mic for good.
      setSpeaking(false); speakingRef.current = false;
      sphereStateRef.current = "idle"; audioSourceRef.current = null;
      if (voice && voiceModeRef.current && !micDenied) await startAutoListen();
      return;
    }
    const rawOut = stripAgentJSON(finalOut) || stripAgentJSON(streamed) || "I couldn't put an answer together — try rephrasing?";
    // Voice-UI tags: strip from display, then execute (shared executors with classic).
    const { tags: vTags, cleaned } = parseVoiceTags(rawOut);
    // A tags-only reply (e.g. just "[SYNC]") must not display the raw tag.
    const out = cleaned || "On it!";
    // Apply voice/speed/tone BEFORE awaiting the TTS chain — fetchAndDecodeAudio reads
    // the refs per chunk, so "speak slower" takes effect on the tail of THIS reply
    // (classic behaves the same way).
    applyVoicePrefTags(vTags);
    // If a tool produced an interactive quiz, attach it so it renders as InlineQuiz cards.
    const quizCards = (widgets.find(w => w.type === "quiz")?.data?.cards) ?? null;
    // If Reggie chose to navigate, carry out the page change (+ optional study config).
    const nav = widgets.find(w => w.type === "navigate")?.data ?? null;
    logChat(userId, "assistant", out, null, currentConvIdRef.current);

    if (speakLive) {
      // Audio for every sentence is already queued — commit the bubble, wait it out.
      setMessages(m => [...m, { role: "assistant", content: out, ...(activity.length ? { activity } : {}), ...(quizCards ? { quiz: quizCards } : {}), ...(turnSources.length ? { sources: turnSources } : {}), ...(turnTraceId ? { traceId: turnTraceId } : {}) }]); setLiveActivity([]);
      lastSpokenTextRef.current = out;
      await ttsChain;
      voiceTTSAbortRef.current = false;
      setSpeaking(false); speakingRef.current = false;
      sphereStateRef.current = "idle"; audioSourceRef.current = null;
    } else if (voice) {
      // Muted voice mode: typewriter only (speakAndType skips audio when muted).
      lastSpokenTextRef.current = out;
      await speakAndType(out);
      if (quizCards) setMessages(m => [...m, { role: "assistant", content: "Here's your quiz:", quiz: quizCards }]);
    } else {
      setMessages(m => [...m, { role: "assistant", content: out, ...(activity.length ? { activity } : {}), ...(quizCards ? { quiz: quizCards } : {}), ...(turnSources.length ? { sources: turnSources } : {}), ...(turnTraceId ? { traceId: turnTraceId } : {}) }]); setLiveActivity([]);
    }

    // ── Voice actions (parity with the classic tutor, shared executors). Gate on the
    // LIVE ref too, so exiting voice mode mid-turn doesn't narrate actions aloud.
    if (vTags.SYNC && voice && voiceModeRef.current) await execVoiceSync();
    if (vTags.GENERATE_FLASHCARDS && voice && voiceModeRef.current) await execVoiceFlashcards(vTags.GENERATE_FLASHCARDS);

    if (nav?.page) {
      if (nav.course || nav.mode) setStudyConfig({ course: nav.course ?? null, mode: nav.mode ?? "flashcards" });
      setTimeout(() => setPendingNav({ page: nav.page }), 500);
    }
    // Living-mind self-write parity with the classic tutor: every 6th exchange.
    exchangeCountRef.current += 1;
    if (exchangeCountRef.current % 6 === 0) {
      const recent = [...messages, { role: "user", content: text }, { role: "assistant", content: out }].slice(-8);
      fetch("/api/self-write", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId, recentMessages: recent }) })
        .then(r => (r.ok ? r.json() : null)).then(d => { if (d?.updated && d?.patch) setLivingMind(d.patch); }).catch(() => {});
    }
    // Auto-restart listening after the reply ends, if still in voice mode.
    if (voice && voiceModeRef.current && !micDenied) await startAutoListen();
  };

  // ── Assignment → Reggie handoff ────────────────────────────────────────────
  // A page (the Assignment detail's "Study this with Reggie" button) sets tutorSeed.
  // Open the tutor in Reggie mode with that assignment in scope so it can ground the
  // conversation in the specific task, then clear the seed so it fires once.
  useEffect(() => {
    if (!tutorSeed) return;
    const { assignmentId = null, courseId = null, title = "", course = "" } = tutorSeed;
    activeAssignmentRef.current = { assignmentId, courseId, title };
    // Reggie is the only assignment-aware path (agent-manager + assignment tools), so
    // force it on for this turn (persisted + immediate via the ref).
    reggieModeRef.current = true;
    setReggieMode(true);
    setChatOpen(true);
    const seed = `I'm working on my assignment "${title}"${course ? ` for ${course}` : ""}. Help me get started. Where should I begin, and what should I focus on?`;
    sendMessage(seed);
    setTutorSeed(null);
  }, [tutorSeed]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggleDictation() {
    if (dictState === "listening") {
      const usingServer = dictationRef.current?.engine === "server";
      setDictState(usingServer ? "processing" : "idle");   // server engine transcribes after stop
      dictationRef.current?.stop();
      return;
    }
    if (dictState === "processing") return;
    const d = createDictation({
      onInterim: (t) => setDictInterim(t),
      onFinal:   (t) => { setDictInterim(""); setInput(prev => (prev ? prev.replace(/\s+$/, "") + " " : "") + t); },
      onError:   (m) => { setAttachStatus(m); setTimeout(() => setAttachStatus(null), 5000); },
      onEnd:     ()  => { setDictState("idle"); setDictInterim(""); },
    });
    dictationRef.current = d;
    setDictState("listening");
    d.start();
  }

  const sendMessage = async (overrideText?) => {
    const text = overrideText ?? input.trim();
    if (!text || loading) return;
    const userMsg = { role: "user", content: text };
    setMessages(m => [...m, userMsg]);
    setInput("");
    setLoading(true);
    const convId = await ensureConversation(userMsg.content);
    logChat(userId, "user", userMsg.content, null, convId);

    // ── Brain behavioral signal (fire-and-forget) ─────────────────────────────
    // Every student message is a data point for the brain. Fire whenever we have a signed-in
    // user — the server derives the brain identity from the JWT (installApiAuth attaches it),
    // so we don't gate on a possibly-stale client-side brain_person_id.
    if (userId) {
      const msgLen   = userMsg.content.length;
      const hour     = new Date().getHours();
      const timeSlot = hour < 6 ? 'late_night' : hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : hour < 22 ? 'evening' : 'late_night';
      // Lightweight stress/confusion detection from word patterns
      const stressWords    = /\b(stress|anxious|panic|overwhelm|behind|fail|lost|confus|stuck|help|urgent|due|tomorrow|tonight)\b/i;
      const confidenceWords = /\b(understand|got it|makes sense|clear|easy|done|finish|ready)\b/i;
      const emotionalTone  = stressWords.test(userMsg.content) ? 'stressed' : confidenceWords.test(userMsg.content) ? 'confident' : 'neutral';
      fetch('/api/brain-signal', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brainPersonId: userData.brain_person_id,
          signalType:    'behavioral',
          source:        'fschoolai_chat',
          payload: {
            message_length:  msgLen,
            time_of_day:     timeSlot,
            hour_of_day:     hour,
            emotional_tone:  emotionalTone,
            message_count:   messages.length + 1,
            has_canvas_data: courses.length > 0,
          },
        }),
      }).catch(() => {}); // fire and forget — never blocks the tutor
    }

    // ── DIAGNOSTIC LOGS — remove after confirming voice gates ───────────────

    // ── Instant nav shortcut (pre-API) ────────────────────────────────────────
    const navMatch = NAV_INTENTS.find(n => n.re.test(text));
    if (navMatch) {
      const reply = voiceModeRef.current
        ? `Taking you to ${NAV_PAGE_LABELS[navMatch.page] || navMatch.page}.`
        : "On it.";
      logChat(userId, "assistant", reply, null, currentConvIdRef.current);
      setMessages(m => [...m, { role: "assistant", content: reply }]);
      setLoading(false);
      if (voiceModeRef.current) {
        // Speak confirmation, navigate, keep voice mode alive
        lastSpokenTextRef.current = reply;
        await speakAndType(reply);
        setTimeout(() => setPendingNav({ page: navMatch.page }), 200);
        if (voiceModeRef.current && !micDenied) await startAutoListen();
      } else {
        setTimeout(() => { setPendingNav({ page: navMatch.page }); setChatOpen(false); }, 380);
      }
      return;
    }

    try {
      // ── Visualization routing — send to Claude artifact builder ───────────
      // BOTH modes get artifacts, but Reggie mode uses the STRICT gate so generic
      // "create/make/quiz/flashcard" asks reach his real tools instead of a
      // sample-data widget (see VIZ_KEYWORDS_STRICT).
      if (reggieModeRef.current ? isStrictVizRequest(userMsg.content) : isVizRequest(userMsg.content)) {
        const aType = detectArtifactType(userMsg.content);
        const raw = await fetch("/api/claude", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: [userMsg], system: VIZ_SYSTEM, max_tokens: 4096 }),
        }).then(r => r.json()).then(d => d.content ?? "");
        const { code, text: displayText } = parseArtifact(raw);
        if (code) {
          setArtifactCode(code);
          setArtifactType(aType);
          setMessages(m => [...m, { role: "assistant", content: displayText, hasArtifact: true, artifactType: aType }]);
        } else {
          setMessages(m => [...m, { role: "assistant", content: displayText }]);
        }
        setLoading(false);
        // Voice mode: narrate the handoff and keep the conversation loop alive — without
        // this the viz path ended with a silent bubble and a dead mic. (Speak directly:
        // speakAndType would commit a duplicate bubble — setMessages above already did.)
        if (voiceModeRef.current) {
          lastSpokenTextRef.current = displayText;
          if (!mutedRef.current) {
            try {
              const tone = TONE_PRESETS[toneRef.current] ?? TONE_PRESETS.neutral;
              setSpeaking(true); speakingRef.current = true; sphereStateRef.current = "speaking";
              const { play } = await fetchAndDecodeAudio(sanitizeForTTS(displayText), voiceIdRef.current, speedRef.current, tone);
              await play(src => { audioSourceRef.current = src; });
            } catch (_) { /* TTS best-effort */ }
            setSpeaking(false); speakingRef.current = false; sphereStateRef.current = "idle"; audioSourceRef.current = null;
          }
          if (voiceModeRef.current && !micDenied) await startAutoListen();
        }
        return;
      }

      // ── Reggie mode: everything else streams through the agent loop ──────
      if (reggieModeRef.current) { await runReggieTurn(text); return; }

      // ── Dynamic context fetch (chatbot agent upgrade) ─────────────────────
      // Fires in parallel — if it resolves before Claude, gets injected into prompt.
      // The merged /api/tutor-context now also classifies file_lookup and surfaces
      // synced extension files, so the tutor can answer about them on this path.
      // Static student context is preloaded on mount + cached (see preloadedContext).
      // RAG source material is query-specific, so it's fetched per message here.
      let ragContext = null;
      abortCtrlRef.current = new AbortController();
      // In Reggie mode the agent does its own retrieval (rag_search tool). Otherwise:
      // a big pasted prompt is self-contained context → skip retrieval (skipRag); a
      // medium one is capped to its gist → both keep the "thinking" delay small on
      // large prompts (embedding/searching the whole message was the slow part).
      const { skip: skipRag, query: ragQuery } = buildRetrievalQuery(userMsg.content);
      const ragFetch = (reggieModeRef.current || skipRag) ? Promise.resolve() : fetch("/api/rag?action=query", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, query: ragQuery, rerank: false }),
      })
        .then(r => r.ok ? r.json() : null)
        .then(d => {
          const passages = d?.passages ?? [];
          if (passages.length) {
            ragContext = passages.map((p, i) =>
              `[${i + 1}] ${p.title}${p.heading ? " — " + p.heading : ""}${p.loc ? " (" + p.loc + ")" : ""}\n${p.text}`
            ).join("\n\n");
          }
        })
        .catch(() => {});

      // Never block a spoken turn on retrieval. For text chat, this is a Promise.race —
      // it resolves the INSTANT RAG returns (~1s now that the reranker is disabled), NOT
      // after the full cap. The cap is only a safety ceiling for a stalled request, so
      // keeping it generous costs nothing in the normal (fast) case but stops a
      // slightly-slow query from dropping the file's grounding (the "no SOURCE MATERIAL"
      // bug). Lower caps trade reliable grounding for a worst-case bound that rarely helps.
      if (!voiceModeRef.current && !reggieModeRef.current && !skipRag) {
        await Promise.race([ragFetch, new Promise(r => setTimeout(r, 4000))]);
      }

      const system = buildChatSystem();

      abortCtrlRef.current = new AbortController();

      // Base context = student context preloaded on mount + cached via Anthropic
      // prompt caching (PR #12). RAG source material is query-specific, so it goes in
      // its own block (kept out of the cached prefix, which must stay stable).
      const ragBlock = ragContext
        ? `SOURCE MATERIAL — passages retrieved RIGHT NOW from the student's own uploaded documents. They ARE available to you. Answer grounded in them and cite inline as [n]. Ignore any EARLIER message in this conversation that claimed you had no documents or told them to sync Canvas — that is outdated; these materials are available now.\n\n${ragContext}`
        : "";
      let finalSystem;
      if (preloadedContext) {
        finalSystem = [
          { type: "text", text: system },
          { type: "text", text: `LIVE CONTEXT (pre-loaded):\n${preloadedContext}`, cache_control: { type: "ephemeral" } },
        ];
        if (ragBlock) finalSystem.push({ type: "text", text: ragBlock });
      } else {
        finalSystem = ragBlock ? `${system}\n\n${ragBlock}` : system;
      }

      // Use Claude for tutor brain; fall back to Groq if key missing
      // Strip UI-only props (hasArtifact) so they don't reach the Anthropic/Groq API
      // Sanitize history before sending (drop empties + merge consecutive same-role
      // turns) so the conversation is always valid for the Anthropic API.
      const apiMessages = sanitizeApiMessages([...messages, userMsg]);
      // Inject barge-in interrupted context so Claude can merge vs switch intent
      const interruptText = interruptedTextRef.current;
      interruptedTextRef.current = null;
      if (interruptText && voiceModeRef.current) {
        // Insert the partial prior response as assistant context before the new user message
        apiMessages.splice(-1, 0, { role: "assistant", content: interruptText.slice(0, 300) + "…" });
      }
      let raw;
      // Groq only accepts a plain string for system — flatten if we built an array for Claude
      const groqSystem = Array.isArray(finalSystem)
        ? (finalSystem as { text: string }[]).map(b => b.text).join("\n\n")
        : finalSystem;

      let voiceTTSDone = null; // resolves when all sentence-chunked TTS finishes

      if (voiceModeRef.current && !mutedRef.current) {
        // ── Streaming voice: sentence-chunked TTS pipeline ───────────────────
        // Each sentence is sent to TTS the moment Claude generates it,
        // so audio starts before the full response arrives.
        try {
          const streamRes = await fetch("/api/claude", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ messages: apiMessages, system: finalSystem, max_tokens: 400, stream: true, task: "voice" }),
            signal: abortCtrlRef.current?.signal,
          });
          if (!streamRes.ok) throw new Error(`Stream ${streamRes.status}`);

          const reader  = streamRes.body.getReader();
          const decoder = new TextDecoder();
          let sseBuffer = "", pendingSentence = "", fullText = "";
          let ttsChain  = Promise.resolve();
          voiceTTSAbortRef.current = false; // reset for this turn

          const enqueueTTS = (text) => {
            const clean = sanitizeForTTS(text.trim());
            if (!clean) return;
            // PIPELINE (same as the Reggie path): synthesize now, serialize playback only —
            // otherwise each sentence's synthesis waits for the previous one to finish playing.
            const tone = TONE_PRESETS[toneRef.current] ?? TONE_PRESETS.neutral;
            const audioP = fetchAndDecodeAudio(clean, voiceIdRef.current, speedRef.current, tone);
            audioP.catch(() => {});
            ttsChain = ttsChain.then(async () => {
              if (abortCtrlRef.current?.signal?.aborted || voiceTTSAbortRef.current) return;
              setSpeaking(true); speakingRef.current = true;
              sphereStateRef.current = "speaking";
              console.log("[voice] speaking chunk | voiceId:", voiceIdRef.current ?? "(default)");
              try {
                const { play } = await audioP;
                await play(src => { audioSourceRef.current = src; });
              } catch (e) { console.warn("[voice chunk]", e.message); }
            });
          };

          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              sseBuffer += decoder.decode(value, { stream: true });
              const lines = sseBuffer.split("\n");
              sseBuffer = lines.pop() ?? "";
              for (const line of lines) {
                if (!line.startsWith("data: ")) continue;
                const data = line.slice(6).trim();
                if (!data || data === "[DONE]") continue;
                try {
                  const evt = JSON.parse(data);
                  if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta") {
                    const chunk = evt.delta.text ?? "";
                    fullText += chunk;
                    pendingSentence += chunk;
                    setStreamingMsg(fullText);
                    // Flush on sentence boundary (.!? followed by space/newline)
                    const sm = /[.!?][ \n]/.exec(pendingSentence);
                    if (sm) {
                      const sent = pendingSentence.slice(0, sm.index + 1);
                      pendingSentence = pendingSentence.slice(sm.index + 2).trimStart();
                      enqueueTTS(sent);
                    }
                  }
                } catch (_) {}
              }
            }
          } catch (err) {
            if (err?.name !== "AbortError") throw err;
          }

          if (abortCtrlRef.current?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
          if (pendingSentence.trim()) enqueueTTS(pendingSentence.trim());

          raw = fullText;
          voiceTTSDone = ttsChain.then(() => {
            voiceTTSAbortRef.current = false;
            setSpeaking(false); speakingRef.current = false;
            sphereStateRef.current = "idle"; audioSourceRef.current = null;
          });
        } catch (err) {
          if (err?.name === "AbortError") throw err;
          // Streaming failed — try non-streaming Sonnet, then Groq as last resort
          try {
            console.warn("[tutor] Sonnet stream failed, trying non-streaming:", err.message);
            raw = await claudeTutor(apiMessages, finalSystem, abortCtrlRef.current?.signal);
          } catch (claudeErr) {
            console.warn("[tutor] Sonnet also failed, falling back to Groq:", claudeErr.message);
            raw = await groq(apiMessages, groqSystem);
          }
        }
      } else {
        // Text chat / muted voice — non-streaming Sonnet, Groq fallback
        try {
          raw = await claudeTutor(apiMessages, finalSystem, abortCtrlRef.current?.signal);
        } catch (claudeErr) {
          console.warn("[tutor] Sonnet failed, falling back to Groq:", claudeErr.message);
          raw = await groq(apiMessages, groqSystem);
        }
      }

      // Strip any stray tool-call JSON the model emitted as text before parsing/display.
      raw = stripAgentJSON(raw);
      // ── Voice intent tag extraction (strip before display/quiz/nav parsing) ──
      const { tags: voiceTags, cleaned: rawNoVoice } = parseVoiceTags(raw);

      // Apply VOICE/SPEED/TONE tags (shared executor with Reggie mode)
      applyVoicePrefTags(voiceTags);
      // [READ:assignments] — Claude's text response IS the reading; tag is stripped
      // [QUIZ:*] — Claude will emit [QUIZ_START]..[QUIZ_END] which is handled below

      // Use cleaned (tag-stripped) response for all downstream processing
      const rawClean = rawNoVoice;

      // ── Quiz detection (before parseNav so tags don't confuse nav parser) ───
      const quizCards = parseQuiz(rawClean);
      if (quizCards) {
        if (voiceModeRef.current) {
          // ── Voice quiz: one question at a time, spoken ───────────────────
          voiceQuizRef.current = { questions: quizCards, idx: 0, score: 0 };
          setVoiceQuizProgress({ current: 1, total: quizCards.length });
          const firstQ = quizCards[0];
          const intro  = `Alright, ${quizCards.length} questions. First one: ${firstQ.q}`;
          logChat(userId, "assistant", intro, null, currentConvIdRef.current);
          setMessages(m => [...m, { role: "assistant", content: intro }]);
          setLoading(false);
          lastSpokenTextRef.current = intro;
          await speakAndType(intro);
          if (voiceModeRef.current && !micDenied) await startAutoListen();
          return;
        }
        // ── Text mode: show full card set ────────────────────────────────
        const preText = rawClean.replace(/\[QUIZ_START\][\s\S]*?\[QUIZ_END\]/, "").trim();
        const display = preText || "Here's your quiz:";
        logChat(userId, "assistant", display, null, currentConvIdRef.current);
        setMessages(m => [...m, { role: "assistant", content: display, quiz: quizCards }]);
        setLoading(false);
        return;
      }

      const { cmd, text: displayText } = parseNav(rawClean);
      let cleanText = displayText.replace(/<[^>]+>/g, "").trim();

      // Never ship an empty/filler-only reply (model stalling + stripped tool JSON left a
      // blank/dangling bubble and silence). Guarded in tutorReply.ts; skipped when the
      // model is navigating, where empty text is intentional.
      cleanText = ensureTutorReply(cleanText, { isNav: !!cmd?.page, hasGrounding: !!ragContext });

      if (cmd?.page) {
        if (cmd.course || cmd.mode) setStudyConfig({ course: cmd.course ?? null, mode: cmd.mode ?? "flashcards" });
        setTimeout(() => setPendingNav({ page: cmd.page }), 600);
      }

      if (cleanText) {
        logChat(userId, "assistant", cleanText, null, currentConvIdRef.current);
      }

      // ── Self-write trigger — fires every 6th exchange ─────────────────────
      exchangeCountRef.current += 1;
      if (exchangeCountRef.current % 6 === 0) {
        const currentMsgs = [...messages, userMsg, { role: "assistant", content: cleanText }];
        fetch("/api/self-write", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId, recentMessages: currentMsgs.slice(-8) }),
        })
          .then(r => r.ok ? r.json() : null)
          .then(d => {
            // If living mind was patched mid-session, update local state immediately
            if (d?.updated && d?.patch) setLivingMind(d.patch);
          })
          .catch(() => {});
      }

      setLoading(false);
      if (voiceTTSDone) {
        // Streaming voice path: TTS already queued — add message now, wait for audio
        setMessages(m => [...m, { role: "assistant", content: cleanText }]);
        setStreamingMsg("");
        lastSpokenTextRef.current = cleanText;
        await voiceTTSDone;
      } else {
        lastSpokenTextRef.current = cleanText;
        await speakAndType(cleanText);
      }
      // ── Execute voice action tags (shared executors with Reggie mode) ───────
      if (voiceTags.SYNC && voiceModeRef.current) await execVoiceSync();
      if (voiceTags.GENERATE_FLASHCARDS && voiceModeRef.current) await execVoiceFlashcards(voiceTags.GENERATE_FLASHCARDS);

      // Auto-restart listening after reply ends, if still in voice mode
      if (voiceModeRef.current && !micDenied) {
        await startAutoListen();
      }
    } catch (err) {
      console.error("[NeuralRing] sendMessage error:", err?.message ?? err);
      // Only add error message if not aborted by stop button
      if (err?.name !== "AbortError") {
        setMessages(m => [...m, { role: "assistant", content: "Something went wrong. Try again." }]);
      }
      setSpeaking(false);
      setLoading(false);
      setStreamingMsg("");
    }
  };

  // ── "fschool:reggie-ask" — a page hands the orb a prompt (Files' per-file Ask
  // Reggie buttons). Same open-then-send shape as the tutorSeed path above. The ref
  // carries the latest closures: the listener registers once, but sendMessage is
  // rebuilt every render (it closes over input/loading/messages).
  const reggieAskRef = useRef({ send: (_t?: string) => {}, loading: false });
  reggieAskRef.current = { send: sendMessage, loading };
  useEffect(() => {
    const onAsk = (e: any) => {
      const msg = e?.detail?.message;
      if (typeof msg !== "string" || !msg.trim()) return;
      setChatOpen(true);
      // Mid-response: open the chat only — auto-sending would interrupt the stream.
      if (reggieAskRef.current.loading) return;
      reggieAskRef.current.send(msg);
    };
    window.addEventListener("fschool:reggie-ask", onAsk);
    return () => window.removeEventListener("fschool:reggie-ask", onAsk);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Render ──────────────────────────────────────────────────────────────────
  // On the dedicated Reggie page itself, the launcher/sidebar has nothing to add —
  // the student is already in the full Reggie experience. Guard placed after all
  // hooks above (never before) to keep hook-call order stable across renders.
  if (currentPage === "studyAssistant") return null;

  return createPortal(
    <>
      {/* Floating ring */}
      <div
        style={{
          position: "fixed", top: pos.top, left: pos.left,
          opacity: chatOpen ? 0 : (isDragging ? 1 : 0.82),
          pointerEvents: chatOpen ? "none" : "auto",
          transition: isDragging
            ? "opacity 0.15s"
            : "top 0.22s var(--ease-apple), left 0.22s var(--ease-apple), opacity 0.2s",
          zIndex: 9999, display: "flex", flexDirection: "column", alignItems: "center", gap: "5px",
        }}
      >
        <div
          className={speaking ? "nr-speaking" : (isDragging ? undefined : "nr-idle")}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          style={{
            width: SIZE, height: SIZE, borderRadius: "50%",
            cursor: isDragging ? "grabbing" : "grab",
            touchAction: "none", userSelect: "none",
            background: "radial-gradient(circle at 35% 35%, rgba(255,255,255,0.13), rgba(255,255,255,0.04))",
            border: "1px solid rgba(255,255,255,0.13)",
          }}
        >
          <canvas ref={canvasRef} width={SIZE} height={SIZE} style={{ display: "block", borderRadius: "50%" }} />
        </div>
      </div>

      {/* S9 — notification-permission ask, shown once after the first completed session */}
      {showNotifAsk && (
        <div style={{
          position: "fixed", bottom: "24px", left: "50%", transform: "translateX(-50%)",
          zIndex: 9998, width: "calc(100% - 40px)", maxWidth: "380px",
          padding: "16px 18px", borderRadius: "16px",
          background: "rgba(16,16,16,0.96)", border: "1px solid rgba(255,255,255,0.12)",
          boxShadow: "0 18px 50px rgba(0,0,0,0.5)",
          backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)",
          fontFamily: "var(--font-sans, -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif)",
        }}>
          <p style={{ color: "#F5F5F5", fontSize: "14px", lineHeight: 1.5, margin: "0 0 14px" }}>
            {buildNotificationAskCopy(userData?.study_window)}
          </p>
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              onClick={acceptNotifAsk}
              style={{
                flex: 1, padding: "10px", background: "rgba(255,255,255,0.92)", color: "#111",
                border: "none", borderRadius: "10px", fontSize: "13px", fontWeight: 600,
                cursor: "pointer", fontFamily: "inherit",
              }}
            >
              Remind me
            </button>
            <button
              onClick={dismissNotifAsk}
              style={{
                flex: 1, padding: "10px", background: "transparent", color: "rgba(255,255,255,0.5)",
                border: "1px solid rgba(255,255,255,0.14)", borderRadius: "10px", fontSize: "13px",
                fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
              }}
            >
              Not now
            </button>
          </div>
        </div>
      )}

      {/* Chat sheet */}
      {chatOpen && (
        <>
          {/* Floating, non-modal chat window docked bottom-right. No backdrop, so the
              rest of the app stays interactive — close via the × button or swipe-down.
              Responsive width: a 384px widget on web, near-full-width on mobile. */}
          <div
            onTouchStart={e => e.stopPropagation()}
            onTouchEnd={e => e.stopPropagation()}
            // The app-wide Lenis smooth-scroll preventDefaults wheel events, which
            // kills native wheel scrolling in this portal's nested containers
            // (messages, history, textarea). data-lenis-prevent opts the whole
            // window out — Lenis checks the event target's ancestors for it.
            data-lenis-prevent=""
            style={{
              position: "fixed",
              ...(maximized
                ? { inset: 0, borderRadius: 0, border: "none", boxShadow: "none" }
                : {
                    left: winGeom.left, top: winGeom.top, width: winGeom.width, height: winGeom.height,
                    borderRadius: 20, border: "1px solid rgba(255,255,255,0.10)",
                    boxShadow: "0 18px 60px rgba(0,0,0,0.55)",
                  }),
              background: "rgba(16,16,16,0.96)",
              backdropFilter: "blur(32px)", WebkitBackdropFilter: "blur(32px)",
              display: "flex", flexDirection: "column",
              fontFamily: "var(--font-sans)",
              zIndex: 9998,
              overflow: "hidden",
            }}
          >
            {/* Resize handles — edges + corners (hidden when maximized). Corners come
                last so they sit above the edge strips at overlaps. */}
            {!maximized && [
              { dir: "n",  s: { top: 0, left: 10, right: 10, height: 7, cursor: "ns-resize" } },
              { dir: "s",  s: { bottom: 0, left: 10, right: 10, height: 7, cursor: "ns-resize" } },
              { dir: "e",  s: { top: 10, bottom: 10, right: 0, width: 7, cursor: "ew-resize" } },
              { dir: "w",  s: { top: 10, bottom: 10, left: 0, width: 7, cursor: "ew-resize" } },
              { dir: "nw", s: { top: 0, left: 0, width: 16, height: 16, cursor: "nwse-resize" } },
              { dir: "ne", s: { top: 0, right: 0, width: 16, height: 16, cursor: "nesw-resize" } },
              { dir: "sw", s: { bottom: 0, left: 0, width: 16, height: 16, cursor: "nesw-resize" } },
              { dir: "se", s: { bottom: 0, right: 0, width: 16, height: 16, cursor: "nwse-resize" } },
            ].map(h => (
              <div key={h.dir} onPointerDown={beginWinDrag(h.dir)}
                style={{ position: "absolute", zIndex: 10, touchAction: "none", ...h.s }} />
            ))}

            {/* Title-bar grip — drag to move the window */}
            <div
              onPointerDown={beginWinDrag("move")}
              style={{ display: "flex", justifyContent: "center", padding: "14px 0 6px", flexShrink: 0, cursor: maximized ? "default" : "grab", touchAction: "none" }}
            >
              {!maximized && <div style={{ width: 40, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.18)" }} />}
            </div>

            {/* Header — flexWrap so an overflowing button row wraps onto a second line
                instead of being clipped by this panel's overflow:"hidden" (was the actual
                cause of Close looking "missing" at narrow/non-maximized widths — it wasn't
                missing, it was clipped off-canvas). */}
            <div style={{ padding: "10px 20px 14px", borderBottom: "1px solid rgba(255,255,255,0.07)", flexShrink: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", rowGap: "8px" }}>
                <div style={{ width: 30, height: 30, borderRadius: "50%", flexShrink: 0, background: "radial-gradient(circle at 35% 35%, rgba(255,255,255,0.18), rgba(255,255,255,0.04))", border: "1px solid rgba(255,255,255,0.12)" }} />
                <div style={{ minWidth: 0, flex: "1 1 100px", overflow: "hidden" }}>
                  {editingName ? (
                    <input
                      ref={ringNameInputRef}
                      value={ringNameInput}
                      onChange={e => setRingNameInput(e.target.value)}
                      onBlur={commitRingName}
                      onKeyDown={e => e.key === "Enter" && commitRingName()}
                      style={{
                        background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.18)",
                        borderRadius: "6px", padding: "3px 9px", color: "var(--text-primary)",
                        fontSize: "17px", fontWeight: "600", letterSpacing: "-0.2px",
                        outline: "none", fontFamily: "inherit", width: "160px", maxWidth: "100%",
                      }}
                    />
                  ) : (
                    <p
                      onClick={() => { setRingNameInput(ringName); setEditingName(true); setTimeout(() => ringNameInputRef.current?.focus(), 0); }}
                      style={{
                        color: "var(--text-primary)", fontSize: "17px", fontWeight: "600", letterSpacing: "-0.2px", cursor: "text",
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}
                      title="Tap to rename"
                    >
                      {ringName || "Reggie"}
                    </p>
                  )}
                  <p style={{ color: "rgba(255,255,255,0.3)", fontSize: "11px", marginTop: "1px", letterSpacing: "0.4px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    Always on{speaking ? " · Speaking…" : ""}
                  </p>
                </div>

                {/* Action buttons — grouped so they wrap together as a unit, pushed right.
                    "New chat" lives in the history panel's own header (below), not here —
                    was a redundant duplicate control taking up header space. */}
                <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", justifyContent: "flex-end", marginLeft: "auto" }}>
                {/* History */}
                <button
                  onClick={() => setHistoryOpen(true)}
                  title="Chat history"
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "center",
                    width: 32, height: 32, flexShrink: 0, borderRadius: "50%",
                    background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)",
                    cursor: "pointer", outline: "none", WebkitTapHighlightColor: "transparent",
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 6h16M4 12h16M4 18h10" />
                  </svg>
                </button>

                {/* Reggie mode toggle (beta) — swaps the tutor brain to the agent loop */}
                <button
                  onClick={() => setReggieMode(v => !v)}
                  title={reggieMode ? "Reggie mode ON — using the agent loop (tools + brain). Tap to switch back to the classic tutor." : "Reggie mode OFF — classic tutor. Tap to route through Reggie (tools + brain)."}
                  aria-label="Toggle Reggie mode"
                  style={{
                    display: "flex", alignItems: "center", gap: 5, padding: "0 10px", height: 32, flexShrink: 0,
                    borderRadius: 20, cursor: "pointer", outline: "none", WebkitTapHighlightColor: "transparent",
                    fontFamily: "var(--font-sans)", fontSize: 10, fontWeight: 600, letterSpacing: "0.5px", textTransform: "uppercase",
                    background: reggieMode ? "rgba(var(--gold-rgb),0.18)" : "rgba(255,255,255,0.06)",
                    border: `1px solid ${reggieMode ? "rgba(var(--gold-rgb),0.5)" : "rgba(255,255,255,0.12)"}`,
                    color: reggieMode ? "var(--gold)" : "rgba(255,255,255,0.4)",
                  }}
                >
                  🤖 Reggie
                </button>

                {/* Voice toggle */}
                <VoiceToggle muted={muted} onClick={toggleMute} speaking={speaking} />

                {/* Voice failure banner. Every voice failure path routes here rather than
                    to console.warn alone — an unreported failure is indistinguishable
                    from the tutor ignoring the user. Click to dismiss. */}
                {voiceError && (
                  <button
                    onClick={() => setVoiceError(null)}
                    title="Dismiss"
                    style={{
                      display: "flex", alignItems: "center", gap: 5, height: 32, flexShrink: 1,
                      minWidth: 0, padding: "0 10px", borderRadius: 20, cursor: "pointer",
                      background: "rgba(239,68,68,0.14)", border: "1px solid rgba(239,68,68,0.32)",
                      color: "#fca5a5", fontSize: 11.5, fontWeight: 500, fontFamily: "inherit",
                      outline: "none", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                    }}
                  >{voiceError}</button>
                )}

                {/* Maximize / restore — expand to cover the screen and back */}
                <button
                  onClick={() => setMaximized(m => !m)}
                  title={maximized ? "Restore" : "Expand to full screen"}
                  aria-label={maximized ? "Restore window" : "Maximize window"}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "center",
                    width: 32, height: 32, flexShrink: 0, borderRadius: "50%",
                    background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)",
                    cursor: "pointer", outline: "none", WebkitTapHighlightColor: "transparent",
                  }}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    {maximized
                      ? <path d="M8 3v3a2 2 0 0 1-2 2H3M16 3v3a2 2 0 0 0 2 2h3M3 16h3a2 2 0 0 1 2 2v3M21 16h-3a2 2 0 0 0-2 2v3" />
                      : <path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M3 16v3a2 2 0 0 0 2 2h3" />}
                  </svg>
                </button>

                {/* Open the dedicated full Reggie page — distinct from the in-place
                    Maximize button above (which just resizes this same floating panel).
                    This one navigates to the full-screen Reggie experience. */}
                <button
                  onClick={() => { setPendingNav({ page: "studyAssistant" }); setChatOpen(false); }}
                  title="Open full Reggie page"
                  aria-label="Open full Reggie page"
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "center",
                    width: 32, height: 32, flexShrink: 0, borderRadius: "50%",
                    background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)",
                    cursor: "pointer", outline: "none", WebkitTapHighlightColor: "transparent",
                  }}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3" />
                  </svg>
                </button>

                {/* Close — the window is non-modal (no backdrop), so this is the
                    primary way to dismiss it on desktop. */}
                <button
                  onClick={() => setChatOpen(false)}
                  title="Close chat"
                  aria-label="Close chat"
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "center",
                    width: 32, height: 32, flexShrink: 0, borderRadius: "50%",
                    background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)",
                    cursor: "pointer", outline: "none", WebkitTapHighlightColor: "transparent",
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                </button>
                </div>
              </div>
            </div>

            {/* ── Chat history panel ─────────────────────────────────────── */}
            {historyOpen && (
              <div style={{
                position: "absolute", inset: 0, zIndex: 6,
                background: "rgba(14,14,15,0.99)", borderRadius: "22px 22px 0 0",
                display: "flex", flexDirection: "column",
                animation: "nrHistIn 0.2s var(--ease-apple) both",
              }}>
                <style>{`@keyframes nrHistIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}`}</style>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "18px 18px 14px", borderBottom: "1px solid rgba(255,255,255,0.07)", flexShrink: 0 }}>
                  <button
                    onClick={() => setHistoryOpen(false)}
                    title="Back"
                    style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 30, height: 30, borderRadius: "50%", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", cursor: "pointer", outline: "none" }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
                  </button>
                  <span style={{ flex: 1, color: "var(--text-primary)", fontSize: "16px", fontWeight: 600, letterSpacing: "-0.2px" }}>Chats</span>
                  <button
                    onClick={startNewChat}
                    style={{ display: "flex", alignItems: "center", gap: "5px", padding: "6px 12px", borderRadius: "20px", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.14)", color: "rgba(255,255,255,0.7)", fontSize: "12px", fontWeight: 600, cursor: "pointer", fontFamily: "inherit", outline: "none" }}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
                    New
                  </button>
                </div>
                <div style={{ flex: 1, overflowY: "auto", padding: "8px", marginRight: 8 }}>
                  {conversations.length === 0 ? (
                    <p style={{ textAlign: "center", color: "rgba(255,255,255,0.3)", fontSize: "13px", marginTop: "40px" }}>
                      No saved chats yet.
                    </p>
                  ) : conversations.map(c => {
                    const active = c.id === currentConversationId;
                    return (
                      <div
                        key={c.id}
                        onClick={() => openConversation(c.id)}
                        style={{
                          display: "flex", alignItems: "center", gap: "10px",
                          padding: "12px 12px", borderRadius: "12px", cursor: "pointer",
                          background: active ? "rgba(255,255,255,0.07)" : "transparent",
                          border: `1px solid ${active ? "rgba(255,255,255,0.12)" : "transparent"}`,
                          marginBottom: "2px",
                        }}
                      >
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <p style={{ color: "var(--text-primary)", fontSize: "14px", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {c.title || "Untitled chat"}
                          </p>
                          <p style={{ color: "rgba(255,255,255,0.32)", fontSize: "11px", marginTop: "2px" }}>
                            {relativeTime(c.updated_at)}
                          </p>
                        </div>
                        <button
                          onClick={(e) => deleteConversation(c.id, e)}
                          title="Delete chat"
                          style={{ flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, borderRadius: "8px", background: "none", border: "none", cursor: "pointer", outline: "none" }}
                        >
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.32)" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /></svg>
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Messages */}
            {/* marginRight keeps this list's scrollbar clear of the invisible 7px
                east resize strip (zIndex 10) that otherwise sits on top of it and
                turns scrollbar drags into window resizes. */}
            <div style={{ flex: 1, overflowY: "auto", padding: "16px 18px", marginRight: 8, display: "flex", flexDirection: "column", gap: "10px" }}>
              {messages.length === 0 ? (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginTop: "40px", gap: "12px" }}>
                  <div style={{ width: 52, height: 52, borderRadius: "50%", background: "radial-gradient(circle at 35% 35%, rgba(255,255,255,0.14), rgba(255,255,255,0.03))", border: "1px solid rgba(255,255,255,0.10)" }} />
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "7px", justifyContent: "center", marginTop: "4px" }}>
                    {smartChips.map(chip => (
                      <button
                        key={chip.label}
                        onClick={() => sendMessage(chip.message)}
                        style={{
                          fontSize: "11px", padding: "5px 11px", borderRadius: "20px",
                          background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)",
                          color: "rgba(255,255,255,0.5)", cursor: "pointer", fontFamily: "inherit",
                        }}
                      >
                        {chip.label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                messages.map((m, i) => (
                  <div key={i} className="nr-msg-in" style={{ alignSelf: m.role === "user" ? "flex-end" : "flex-start", maxWidth: "84%" }}>
                    <div
                      className={(m.role === "assistant" && i === messages.length - 1 ? "nr-msg-new " : "") + (m.role === "assistant" ? "markdown-body" : "")}
                      style={{
                        background: m.role === "user" ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.05)",
                        borderRadius: m.role === "user" ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
                        padding: "10px 14px", color: "var(--text-primary)",
                        fontSize: "14px", lineHeight: "1.6",
                        border: m.hasArtifact ? "1px solid rgba(232,255,107,0.2)" : "1px solid rgba(255,255,255,0.07)",
                        ...(m.role === "user" ? { whiteSpace: "pre-wrap" as const } : {}),
                      }}
                    >
                      {/* Only assistant turns are markdown — a student typing "a*b*c" or
                          "# of items" must see their text verbatim, not a parse of it. */}
                      {m.role === "assistant" && m.activity && <ActivityDropdown steps={m.activity} live={false} />}
                      {m.role === "assistant"
                        ? <Markdown remarkPlugins={[remarkGfm]}>{m.content}</Markdown>
                        : m.content}
                      {m.quiz && <InlineQuiz cards={m.quiz} userId={userId} courseId={null} />}
                      {/* Search tags: which documents this answer drew from (+ traceId for debugging —
                          click copies it; paste into ReggieTester's trace lookup). */}
                      {m.sources?.length > 0 && (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "5px", marginTop: "9px", alignItems: "center" }}>
                          {m.sources.slice(0, 5).map((s, si) => (
                            <span key={si} title={s.heading || s.title} style={{
                              fontSize: "10.5px", padding: "2px 9px", borderRadius: "20px",
                              background: "rgba(var(--teal-rgb),0.12)", border: "1px solid rgba(var(--teal-rgb),0.28)",
                              color: "rgb(var(--teal-rgb))", fontWeight: 500, maxWidth: "180px",
                              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                            }}>
                              {s.title}{s.loc ? ` · p.${s.loc}` : ""}
                            </span>
                          ))}
                          {m.traceId && (
                            <button
                              onClick={() => { try { navigator.clipboard.writeText(m.traceId); } catch {} }}
                              title={`Copy trace ID for debugging: ${m.traceId}`}
                              style={{ fontSize: "10px", padding: "2px 7px", borderRadius: "20px", background: "none",
                                border: "1px dashed rgba(255,255,255,0.18)", color: "var(--text-dim)", cursor: "pointer", fontFamily: "inherit" }}
                            >⧉ trace</button>
                          )}
                        </div>
                      )}
                      {m.hasArtifact && (
                        <button
                          onClick={() => { setArtifactType(m.artifactType || "viz"); setArtifactOpen(true); }}
                          style={{
                            display: "block", marginTop: "10px",
                            background: "rgba(var(--gold-rgb),0.1)", border: "1px solid rgba(var(--gold-rgb),0.3)",
                            borderRadius: "8px", padding: "7px 14px", color: "var(--gold)",
                            fontSize: "12px", fontWeight: "600", cursor: "pointer",
                            fontFamily: "inherit", width: "100%", textAlign: "center",
                          }}
                        >
                          {(ARTIFACT_LABELS[m.artifactType] ?? ARTIFACT_LABELS.viz).button}
                        </button>
                      )}
                    </div>
                    {m.role === "assistant" && (
                      <div style={{ marginTop: "5px", paddingLeft: "2px" }}>
                        {/* Action row — Copy / thumbs */}
                        <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
                          {/* Copy */}
                          <button
                            onClick={() => {
                              navigator.clipboard?.writeText(m.content);
                              // Flash "Copied" feedback
                              const btn = document.getElementById(`copy-btn-${i}`);
                              if (btn) { btn.textContent = "Copied!"; setTimeout(() => { btn.textContent = "Copy"; }, 1500); }
                            }}
                            id={`copy-btn-${i}`}
                            style={{ background: "none", border: "none", color: "rgba(255,255,255,0.25)", fontSize: "12px", cursor: "pointer", padding: "3px 7px", borderRadius: "6px", fontFamily: "inherit", transition: "color 0.15s" }}
                            onMouseEnter={e => e.currentTarget.style.color = "rgba(255,255,255,0.6)"}
                            onMouseLeave={e => e.currentTarget.style.color = "rgba(255,255,255,0.25)"}
                          >Copy</button>

                          {/* Thumbs up */}
                          <button
                            onClick={() => {
                              if (reactions[i] === "up") return;
                              setReactions(r => ({ ...r, [i]: "up" }));
                              setReasonPicker(null);
                            }}
                            style={{
                              background: reactions[i] === "up" ? "rgba(52,199,89,0.15)" : "none",
                              border: reactions[i] === "up" ? "1px solid rgba(52,199,89,0.3)" : "1px solid transparent",
                              borderRadius: "6px", fontSize: "13px", cursor: reactions[i] === "up" ? "default" : "pointer",
                              padding: "2px 5px", transition: "all 0.15s",
                              transform: reactions[i] === "up" ? "scale(1.2)" : "scale(1)",
                              display: "inline-flex", alignItems: "center", color: reactions[i] === "up" ? "rgba(72,210,110,0.95)" : "rgba(255,255,255,0.4)",
                            }}
                          ><ThumbsUp size={14} /></button>

                          {/* Thumbs down */}
                          <button
                            onClick={() => {
                              if (reactions[i] === "up") return;
                              setReasonPicker(reasonPicker === i ? null : i);
                            }}
                            style={{
                              background: reactions[i] === "down" ? "rgba(255,80,80,0.12)" : "none",
                              border: reactions[i] === "down" ? "1px solid rgba(255,80,80,0.25)" : "1px solid transparent",
                              borderRadius: "6px", fontSize: "13px", cursor: "pointer",
                              padding: "2px 5px", transition: "all 0.15s",
                              transform: reactions[i] === "down" ? "scale(1.1)" : "scale(1)",
                              display: "inline-flex", alignItems: "center", color: reactions[i] === "down" ? "rgba(255,120,100,0.95)" : "rgba(255,255,255,0.4)",
                            }}
                          ><ThumbsDown size={14} /></button>
                        </div>

                        {/* Reason picker — slides in below thumbs down */}
                        {reasonPicker === i && reactions[i] !== "down" && (
                          <div style={{
                            marginTop: "8px",
                            background: "rgba(255,255,255,0.04)",
                            border: "1px solid rgba(255,255,255,0.09)",
                            borderRadius: "12px",
                            padding: "10px",
                            display: "flex", flexDirection: "column", gap: "6px",
                          }}>
                            <p style={{ fontSize: "11px", color: "rgba(255,255,255,0.3)", marginBottom: "2px", letterSpacing: "0.5px" }}>What was wrong?</p>
                            {["Too long", "Off topic", "Wrong info", "Not helpful"].map(reason => (
                              <button
                                key={reason}
                                onClick={() => {
                                  setReactions(r => ({ ...r, [i]: "down" }));
                                  setReasonPicker(null);
                                  // Offer regenerate — set input to last user message
                                  const lastUserMsg = messages[i-1]?.content;
                                  if (lastUserMsg) setInput(lastUserMsg);
                                }}
                                style={{
                                  background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)",
                                  borderRadius: "8px", padding: "7px 10px", color: "rgba(255,255,255,0.6)",
                                  fontSize: "13px", cursor: "pointer", textAlign: "left", fontFamily: "inherit",
                                  transition: "background 0.12s, color 0.12s",
                                }}
                                onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,80,80,0.1)"; e.currentTarget.style.color = "rgba(255,130,120,0.9)"; }}
                                onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.05)"; e.currentTarget.style.color = "rgba(255,255,255,0.6)"; }}
                              >{reason}</button>
                            ))}
                          </div>
                        )}

                        {/* Regenerate prompt — shows after picking a reason */}
                        {reactions[i] === "down" && (
                          <div style={{ marginTop: "6px", display: "flex", alignItems: "center", gap: "6px" }}>
                            <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.25)" }}>Thanks for the feedback</span>
                            <button
                              onClick={() => {
                                const lastUserMsg = messages[i-1]?.content;
                                if (!lastUserMsg) return;
                                // Remove the bad response + queue regenerate after state settles
                                setMessages(msgs => msgs.slice(0, i));
                                setReactions(r => { const n = {...r}; delete n[i]; return n; });
                                setInput(lastUserMsg);
                                // Use a small delay so setMessages settles, then send
                                setTimeout(() => {
                                  setInput("");
                                  sendMessage(lastUserMsg);
                                }, 100);
                              }}
                              style={{
                                background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)",
                                borderRadius: "6px", padding: "3px 9px", color: "rgba(255,255,255,0.5)",
                                fontSize: "12px", cursor: "pointer", fontFamily: "inherit",
                                transition: "all 0.15s",
                              }}
                              onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.1)"; e.currentTarget.style.color = "rgba(255,255,255,0.85)"; }}
                              onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.06)"; e.currentTarget.style.color = "rgba(255,255,255,0.5)"; }}
                            ><span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><RotateCcw size={12} />Try again</span></button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))
              )}
              {loading && !streamingMsg && (
                <div style={{ alignSelf: "flex-start", padding: "10px 14px", background: "rgba(255,255,255,0.04)", borderRadius: "16px 16px 16px 4px", border: "1px solid rgba(255,255,255,0.07)", display: "flex", gap: "5px", alignItems: "center" }}>
                  {/* Tool calls all run BEFORE the first token streams, so the live
                      activity timeline must show HERE — by the time the streaming
                      bubble exists, retrieval is already over. Bare dots only until
                      the first tool_call frame lands. */}
                  {liveActivity.length > 0 ? (
                    <ActivityDropdown steps={liveActivity} live />
                  ) : (<>
                    <span className="nr-dot" />
                    <span className="nr-dot" />
                    <span className="nr-dot" />
                  </>)}
                </div>
              )}
              {streamingMsg ? (
                <div 
                  className="markdown-body"
                  style={{
                    alignSelf: "flex-start", maxWidth: "84%",
                    background: "rgba(255,255,255,0.05)",
                    borderRadius: "16px 16px 16px 4px",
                    padding: "10px 14px", color: "var(--text-primary)",
                    fontSize: "14px", lineHeight: "1.6",
                    border: "1px solid rgba(255,255,255,0.07)",
                  }}>
                  <ActivityDropdown steps={liveActivity} live />
                  <Markdown remarkPlugins={[remarkGfm]}>{streamingMsg}</Markdown>
                  <span style={{ opacity: 0.4, animation: "blink 1s step-end infinite" }}>|</span>
                </div>
              ) : null}
              <div ref={messagesEndRef} />
            </div>

            {/* Input row (text mode) */}
            {!voiceMode && (
              <>
                {attachStatus && (
                  <div style={{ padding: "0 16px 6px", fontSize: "12px", color: "rgba(255,255,255,0.55)", flexShrink: 0 }}>{attachStatus}</div>
                )}
              <div style={{ display: "flex", gap: "10px", padding: "12px 14px 28px", borderTop: "1px solid rgba(255,255,255,0.07)", flexShrink: 0, alignItems: "flex-end", position: "relative" }}>
                {/* Hidden file inputs — all three feed handleAttachFile (extract → RAG ingest).
                    Separate elements because accept/capture must differ per source. */}
                <input
                  ref={attachInputRef} type="file" style={{ display: "none" }}
                  accept=".pdf,.txt,.md,.docx,.pptx,.png,.jpg,.jpeg,.webp"
                  onChange={e => { const f = e.target.files?.[0]; e.currentTarget.value = ""; handleAttachFile(f); }}
                />
                <input
                  ref={photoInputRef} type="file" style={{ display: "none" }}
                  accept="image/*"
                  onChange={e => { const f = e.target.files?.[0]; e.currentTarget.value = ""; handleAttachFile(f); }}
                />
                <input
                  ref={cameraInputRef} type="file" style={{ display: "none" }}
                  accept="image/*" capture="environment"
                  onChange={e => { const f = e.target.files?.[0]; e.currentTarget.value = ""; handleAttachFile(f); }}
                />

                {/* "+" — opens the attach sheet (Claude-app style) instead of jumping
                    straight into a file picker. */}
                {attachMenuOpen && (
                  <>
                    {/* click-away backdrop */}
                    <div onClick={() => setAttachMenuOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 20 }} />
                    <div style={{
                      position: "absolute", left: 10, bottom: "calc(100% + 8px)", zIndex: 21,
                      minWidth: 230, padding: "6px",
                      background: "rgba(22,22,26,0.98)", border: "1px solid rgba(255,255,255,0.12)",
                      borderRadius: "16px", boxShadow: "0 16px 48px rgba(0,0,0,0.55)",
                      backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)",
                      animation: "nrAttachIn 0.16s var(--ease-apple) both",
                    }}>
                      <style>{`@keyframes nrAttachIn{from{opacity:0;transform:translateY(6px) scale(0.98)}to{opacity:1;transform:none}}`}</style>
                      {[
                        { label: "Camera",            icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" /><circle cx="12" cy="13" r="3" /></svg>, act: () => { setAttachMenuOpen(false); cameraInputRef.current?.click(); } },
                        { label: "Add photos",        icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21" /></svg>, act: () => { setAttachMenuOpen(false); photoInputRef.current?.click(); } },
                        { label: "Add files",         icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M13 2v7h7" /></svg>, act: () => { setAttachMenuOpen(false); attachInputRef.current?.click(); } },
                        { label: "Study materials",   icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="6" width="13" height="12" rx="2" /><path d="M8 4h11a2 2 0 0 1 2 2v9" /></svg>, hint: "big files", act: () => { setAttachMenuOpen(false); setPendingNav({ page: "files" }); setChatOpen(false); } },
                      ].map(row => (
                        <button
                          key={row.label}
                          onClick={row.act}
                          style={{
                            display: "flex", alignItems: "center", gap: "11px", width: "100%",
                            background: "transparent", border: "none", borderRadius: "11px",
                            padding: "11px 12px", cursor: "pointer", fontFamily: "inherit",
                            color: "rgba(255,255,255,0.82)", fontSize: "13.5px", fontWeight: 500,
                            textAlign: "left", outline: "none",
                          }}
                          onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.07)"}
                          onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                        >
                          <span style={{ display: "flex", color: "rgba(255,255,255,0.55)" }}>{row.icon}</span>
                          <span style={{ flex: 1 }}>{row.label}</span>
                          {row.hint && <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.32)" }}>{row.hint}</span>}
                        </button>
                      ))}
                      <div style={{ height: 1, background: "rgba(255,255,255,0.08)", margin: "4px 10px" }} />
                      <p style={{ margin: 0, padding: "8px 12px 6px", fontSize: "11px", color: "rgba(255,255,255,0.35)" }}>
                        Files are indexed so Reggie can answer about them.
                      </p>
                    </div>
                  </>
                )}
                <button
                  onClick={() => setAttachMenuOpen(o => !o)}
                  title="Add to chat"
                  aria-label="Add to chat"
                  aria-expanded={attachMenuOpen}
                  style={{
                    background: "none", border: "none", padding: "6px 4px",
                    cursor: "pointer", flexShrink: 0, color: attachMenuOpen ? "var(--gold)" : "rgba(255,255,255,0.4)",
                    fontSize: "24px", lineHeight: 1, outline: "none", transition: "color 0.15s, transform 0.18s var(--ease-apple)",
                    transform: attachMenuOpen ? "rotate(45deg)" : "none",
                  }}
                  onMouseEnter={e => e.currentTarget.style.color = "var(--gold)"}
                  onMouseLeave={e => { if (!attachMenuOpen) e.currentTarget.style.color = "rgba(255,255,255,0.4)"; }}
                ><Plus size={20} strokeWidth={2.2} /></button>
                {/* Subtle waveform glyph — enters voice mode */}
                <button
                  onClick={() => {
                    getAudioContext();
                    voiceModeRef.current = true;
                    setVoiceMode(true);
                    // Entering voice mode implies wanting to HEAR the replies. `muted`
                    // persists across sessions, so without this a user who muted during
                    // text chat gets a voice mode that listens but never speaks back —
                    // it looks like the tutor is ignoring them. Ref is set synchronously
                    // because the first turn can start before the re-render lands.
                    mutedRef.current = false;
                    setMuted(false);
                    try { localStorage.setItem("fschool_muted", "0"); } catch {}
                    setVoiceError(null);
                    sttFailStreakRef.current = 0;
                    startAutoListen();
                  }}
                  title="Voice mode"
                  style={{
                    background: "none", border: "none", padding: "8px 6px",
                    cursor: "pointer", flexShrink: 0, color: "rgba(255,255,255,0.28)",
                    transition: "color 0.15s", outline: "none",
                  }}
                  onMouseEnter={e => e.currentTarget.style.color = "var(--gold)"}
                  onMouseLeave={e => e.currentTarget.style.color = "rgba(255,255,255,0.28)"}
                >
                  {/* Waveform glyph — three bars of different heights */}
                  <svg width="16" height="14" viewBox="0 0 16 14" fill="currentColor">
                    <rect x="0"  y="4" width="2.5" height="6"  rx="1.25"/>
                    <rect x="4.5" y="1" width="2.5" height="12" rx="1.25"/>
                    <rect x="9"  y="3" width="2.5" height="8"  rx="1.25"/>
                    <rect x="13.5" y="5" width="2.5" height="4" rx="1.25"/>
                  </svg>
                </button>
                {/* Mic dictation — tap to talk, words land in the input (better STT path:
                    browser speech engine when available, /api/stt fallback elsewhere) */}
                <button
                  onClick={toggleDictation}
                  title={dictState === "listening" ? "Stop dictating" : dictState === "processing" ? "Transcribing…" : "Dictate (speech-to-text into the box)"}
                  aria-label="Dictate"
                  style={{
                    background: dictState === "listening" ? "rgba(255,80,80,0.16)" : "none",
                    border: dictState === "listening" ? "1px solid rgba(255,80,80,0.35)" : "1px solid transparent",
                    borderRadius: 8, padding: "6px 6px", cursor: "pointer", flexShrink: 0,
                    color: dictState === "listening" ? "#ff6b5a" : dictState === "processing" ? "var(--gold)" : "rgba(255,255,255,0.28)",
                    transition: "color 0.15s, background 0.15s", outline: "none",
                    animation: dictState === "listening" ? "fsPulseRing 1.4s ease-out infinite" : "none",
                  }}
                  onMouseEnter={e => { if (dictState === "idle") e.currentTarget.style.color = "var(--gold)"; }}
                  onMouseLeave={e => { if (dictState === "idle") e.currentTarget.style.color = "rgba(255,255,255,0.28)"; }}
                >
                  <Mic size={16} strokeWidth={2.2} />
                </button>
                <textarea
                  ref={inputRef}
                  value={dictInterim ? (input ? input + " " : "") + dictInterim : input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); getAudioContext(); sendMessage(); } }}
                  placeholder={dictState === "listening" ? "Listening… tap the mic to stop" : dictState === "processing" ? "Transcribing…" : "Ask a question, or where to go…"}
                  rows={1}
                  style={{
                    flex: 1, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.09)",
                    borderRadius: "var(--radius-btn)", padding: "11px 14px", color: "var(--text-primary)",
                    fontSize: "14px", outline: "none", fontFamily: "inherit",
                    lineHeight: "1.4", resize: "none", maxHeight: "120px", overflowY: "auto",
                    transition: "border-color var(--dur-base) var(--ease-apple)",
                  }}
                  onFocus={e => (e.currentTarget.style.borderColor = "rgba(255,255,255,0.22)")}
                  onBlur={e  => (e.currentTarget.style.borderColor = "rgba(255,255,255,0.09)")}
                />
                {(loading || speaking) ? (
                  <button onClick={stopResponse} title="Stop" aria-label="Stop" style={{ display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(255,80,80,0.15)", color: "rgba(255,120,100,0.95)", border: "1px solid rgba(255,80,80,0.25)", borderRadius: "var(--radius-btn)", padding: "10px 13px", cursor: "pointer", fontFamily: "inherit", flexShrink: 0 }}>
                    <Square size={16} fill="currentColor" strokeWidth={0} />
                  </button>
                ) : (
                  <button onClick={() => { getAudioContext(); sendMessage(); }} disabled={!input.trim()} title="Send" aria-label="Send"
                    style={{ display: "flex", alignItems: "center", justifyContent: "center", background: !input.trim() ? "rgba(255,255,255,0.18)" : "var(--color-accent)", color: "#111", border: "none", borderRadius: "var(--radius-btn)", padding: "10px 13px", cursor: !input.trim() ? "not-allowed" : "pointer", fontFamily: "inherit", flexShrink: 0, opacity: !input.trim() ? 0.5 : 1, transition: "background var(--dur-base) var(--ease-apple)" }}>
                    <Send size={18} />
                  </button>
                )}
              </div>
              </>
            )}

            {/* ── Voice mode overlay: centered sphere hero ── */}
            {voiceMode && (
              <div style={{
                position: "absolute", top: "58px", bottom: 0, left: 0, right: 0,
                display: "flex", flexDirection: "column",
                alignItems: "center", justifyContent: "center",
                background: "rgba(14,14,14,0.97)",
                animation: "nrVoiceIn 0.32s cubic-bezier(0.22,1,0.36,1) both",
                zIndex: 5,
              }}>
                {/* Voice quiz progress — top-centre, Fraunces small-caps dots */}
                {voiceQuizProgress && (
                  <div style={{
                    position: "absolute", top: "14px", left: "50%", transform: "translateX(-50%)",
                    display: "flex", flexDirection: "column", alignItems: "center", gap: "6px",
                    pointerEvents: "none",
                  }}>
                    <span style={{ fontFamily: "var(--font-sans)", fontSize: "10px", fontVariant: "small-caps", letterSpacing: "0.14em", color: "rgba(var(--gold-rgb),0.65)" }}>
                      question {voiceQuizProgress.current} / {voiceQuizProgress.total}
                    </span>
                    <div style={{ display: "flex", gap: "5px" }}>
                      {Array.from({ length: voiceQuizProgress.total }).map((_, i) => (
                        <div key={i} style={{
                          width: 6, height: 6, borderRadius: "50%",
                          background: i < voiceQuizProgress.current - 1
                            ? "rgba(var(--gold-rgb),0.55)"
                            : i === voiceQuizProgress.current - 1
                              ? "var(--gold)"
                              : "rgba(255,255,255,0.1)",
                          transition: "background 0.3s ease",
                        }} />
                      ))}
                    </div>
                  </div>
                )}

                {/* Exit — top-right ghost × */}
                <button
                  onClick={exitVoiceMode}
                  style={{
                    position: "absolute", top: "12px", right: "16px",
                    background: "none", border: "none", color: "rgba(255,255,255,0.22)",
                    fontSize: "22px", lineHeight: 1, cursor: "pointer", padding: "4px 6px",
                    transition: "color 0.15s",
                  }}
                  onMouseEnter={e => e.currentTarget.style.color = "rgba(255,255,255,0.6)"}
                  onMouseLeave={e => e.currentTarget.style.color = "rgba(255,255,255,0.22)"}
                  aria-label="Exit voice mode"
                >×</button>

                {/* Existing neural sphere — just larger and centered */}
                <div style={{ position: "relative", marginBottom: "26px" }}>
                  {/* RMS rim — reacts to live mic */}
                  <div style={{
                    position: "absolute",
                    inset: `-${8 + Math.round((voiceRmsRef.current ?? 0) * 10)}px`,
                    borderRadius: "50%",
                    border: `1.5px solid rgba(var(--gold-rgb),${Math.min((voiceRmsRef.current ?? 0) * 0.75, 0.5).toFixed(2)})`,
                    pointerEvents: "none",
                    transition: "inset 0.06s linear, border-color 0.06s linear",
                  }} />
                  <canvas
                    ref={voiceCanvasRef}
                    width={VOICE_SIZE}
                    height={VOICE_SIZE}
                    className={isRecording && !speaking ? "nr-speaking" : "nr-idle"}
                    style={{ display: "block", borderRadius: "50%" }}
                  />
                </div>

                {/* Tiny small-caps Fraunces caption — crossfades, orb carries the state */}
                <p style={{
                  fontFamily: "var(--font-sans)",
                  fontSize: "11px", fontWeight: "300",
                  fontVariant: "small-caps",
                  letterSpacing: "0.14em",
                  marginBottom: "32px",
                  minHeight: "1em",
                  color: micDenied ? "rgba(255,100,90,0.5)" : "rgba(var(--cream-rgb),0.22)",
                  transition: "opacity 0.35s ease, color 0.35s ease",
                  opacity: (micDenied || speaking || loading || isRecording || voiceConnecting) ? 1 : 0,
                }}>
                  {micDenied       ? "allow microphone access"
                  : speaking       ? "speaking"
                  : loading        ? "thinking"
                  // Ahead of isRecording: the mic opens first, but audio goes nowhere
                  // until the socket is up. Saying "listening" here would invite the
                  // user to talk into a dropped stream.
                  : voiceConnecting ? "connecting"
                  : isRecording    ? "listening"
                  : ""}
                </p>

                {/* Inline voice chip strip — slim, horizontal, scrollable */}
                {availableVoices.length > 0 && (
                  <div style={{
                    position: "absolute", bottom: "24px", left: 0, right: 0,
                    overflowX: "auto", display: "flex", gap: "7px",
                    padding: "0 20px",
                    scrollbarWidth: "none", msOverflowStyle: "none",
                  }}>
                    {availableVoices.slice(0, 8).map(v => {
                      const isActive = (activeVoiceId ?? voiceIdRef.current ?? userData?.preferred_voice_id) === v.voice_id;
                      const lbls = [v.labels?.accent, v.labels?.gender].filter(Boolean).join("/");
                      return (
                        <button
                          key={v.voice_id}
                          onClick={() => {
                            voiceIdRef.current = v.voice_id;
                            setActiveVoiceId(v.voice_id);  // instant chip highlight (was missing)
                            updateUserField("preferred_voice_id", v.voice_id).catch(() => {});
                          }}
                          style={{
                            flexShrink: 0,
                            background: isActive ? "rgba(var(--gold-rgb),0.1)" : "rgba(255,255,255,0.04)",
                            border: `1px solid ${isActive ? "rgba(var(--gold-rgb),0.35)" : "rgba(255,255,255,0.07)"}`,
                            borderRadius: "20px", padding: "5px 11px",
                            color: isActive ? "var(--gold)" : "rgba(255,255,255,0.3)",
                            fontSize: "11px", fontWeight: isActive ? "600" : "400",
                            cursor: "pointer", fontFamily: "inherit",
                            display: "flex", alignItems: "center", gap: "5px",
                            transition: "all 0.15s",
                          }}
                        >
                          <span>{v.name}</span>
                          {lbls && <span style={{ opacity: 0.5, fontSize: "9px" }}>{lbls}</span>}
                          {/* ▶ mini preview */}
                          <span
                            onClick={e => {
                              e.stopPropagation();
                              if (v.preview_url) {
                                const a = new Audio(v.preview_url);
                                a.play().catch(() => {});
                              }
                            }}
                            style={{ opacity: 0.45, cursor: "pointer", fontSize: "10px" }}
                            title="Preview"
                          ><Play size={10} fill="currentColor" strokeWidth={0} /></span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}
      {artifactOpen && artifactCode && (
        <ArtifactPanel code={artifactCode} type={artifactType} onClose={() => setArtifactOpen(false)} />
      )}
    </>,
    document.body
  );
}

// api/room-ai.ts — AI-04 (group turn) + AI-05 (private turn).
//
//   POST /api/room-ai?action=group    { roomId, message }
//     → grounded answer from the room's shared sources + shared board, shaped by the
//       session's persona and the room teaching plan.
//   POST /api/room-ai?action=private  { roomId, message }
//     → the SAME grounding, but scoped to one student: their own Brain, no room plan,
//       and history in their own private thread.
//
// Both live here on purpose. They share context assembly, and the ONLY thing that differs
// is scope — keeping the divergence in one file makes it auditable instead of scattered
// across two endpoints that drift apart.
//
// WHAT THIS FILE IS RESPONSIBLE FOR: assembling context and enforcing scope. It does NOT
// invent prompt structure — buildRoomSystemPrompt() (api/_personas.ts) owns the seven-layer
// contract and the <untrusted> fencing, and it is the thing QA-04's rubric checks.
//
// THE TWO ISOLATION RULES (STUDYROOM_ARCHITECTURE.md §7; both are release-gate items and
// on the sprint plan's never-cut list — Ryan adversarially tests them):
//
//   1. "Brain leakage into group" — the room teaching plan is SERVER-ONLY. It goes into the
//      group system prompt and NOWHERE else. The response carries `planVersion` (a number),
//      never the plan, participant summaries, or a named gap.
//   2. "Private-thread leakage" — a private turn may read the CALLER'S Brain and their own
//      thread, and nothing else. It passes plan: null (buildRoomSystemPrompt requires this
//      for private scope), reads student_brains by the caller's id only, and every thread
//      lookup is filtered by user_id so a peer's thread is not addressable.
//
// BE-12 is automatic: `metadata` on the gateway call is lifted into prompt_runs columns by
// the trace sink. No prompt text is persisted — deliberate. Do not add a manual write here.
import { requireUserOr401 } from "./_auth.js";
import { rateLimit } from "./_ratelimit.js";
import { callModel, openStream } from "./_gateway.js";
import { buildRoomSystemPrompt } from "./_personas.js";
import { searchRoomSources } from "./_roomRetrieval.js";
import { latestBoardContext } from "./room-board.js";
import { PERSONA_IDS, brainToMarkdown } from "./_contracts.js";
import type { BrainProfile, GroundingRef, InterventionIntensity, PersonaId, RoomTeachingPlan } from "./_contracts.js";

export const config = { maxDuration: 60 };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_MESSAGE_CHARS = 4000;
const EXCERPT_CHARS = 1500;   // per-source excerpt handed to the prompt layer

function db() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("Supabase env vars not configured");
  const headers: Record<string, string> = {
    apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json",
  };
  return {
    async select(path: string) {
      const r = await fetch(`${url}/rest/v1/${path}`, { headers });
      if (!r.ok) throw new Error(`select ${path.split("?")[0]} failed (${r.status})`);
      return (await r.json()) as any[];
    },
    async insert(table: string, body: any, returning = true) {
      const r = await fetch(`${url}/rest/v1/${table}`, {
        method: "POST",
        headers: returning ? { ...headers, Prefer: "return=representation" } : headers,
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(`insert ${table} failed (${r.status}): ${(await r.text()).slice(0, 200)}`);
      return returning ? ((await r.json()) as any[]) : [];
    },
  };
}

async function isJoinedMember(userId: string, roomId: string): Promise<boolean> {
  const rows = await db().select(
    `room_members?room_id=eq.${roomId}&user_id=eq.${encodeURIComponent(userId)}&status=eq.joined&select=user_id&limit=1`,
  );
  return rows.length > 0;
}

interface RoomAiSession {
  id: string;
  persona: PersonaId;
  intensity: InterventionIntensity;
  plan: RoomTeachingPlan | null;
}

/**
 * The active AI session for a room, with its frozen config and teaching plan.
 * Returns null when no session is running — a group turn outside a session has no persona
 * and no plan, so we refuse rather than silently answering with defaults.
 */
async function loadActiveSession(roomId: string): Promise<RoomAiSession | null> {
  const d = db();
  const [session] = await d.select(
    `room_ai_sessions?room_id=eq.${roomId}&state=eq.active&select=id,config_version&limit=1`,
  );
  if (!session) return null;

  const [cfg] = await d.select(
    `room_configs?room_id=eq.${roomId}&version=eq.${session.config_version}&select=persona,intervention_intensity&limit=1`,
  );
  const [snap] = await d.select(
    `room_brain_snapshots?session_id=eq.${session.id}&select=participant_summaries,group_strategy&order=created_at.desc&limit=1`,
  );

  const persona: PersonaId = PERSONA_IDS.includes(cfg?.persona) ? cfg.persona : "facilitator";
  const intensity: InterventionIntensity =
    ["low", "balanced", "active"].includes(cfg?.intervention_intensity) ? cfg.intervention_intensity : "balanced";

  const plan: RoomTeachingPlan | null = snap
    ? {
        // room_brain_snapshots has no version column; the config version IS the plan's
        // version — a new config freezes a new plan (see room-session ?action=start).
        version: session.config_version ?? 1,
        participants: snap.participant_summaries ?? [],
        group_strategy: snap.group_strategy ?? { default_explanation: "stepwise", peer_teaching_pairs: [], avoid: [] },
      }
    : null;

  return { id: session.id, persona, intensity, plan };
}

/**
 * The CALLER'S active Brain profile, as markdown for the prompt layer.
 *
 * ISOLATION: `userId` must come from the JWT (requireUserOr401), never from the body.
 * Both reads are keyed by it, so there is no addressable path to a peer's Brain — that is
 * the property Ryan's cross-Brain attempts target.
 *
 * Returns null when the student has no Brain yet: a new student should still get private
 * help, just un-personalised.
 */
async function loadOwnBrainMarkdown(userId: string): Promise<string | null> {
  const d = db();
  const [brain] = await d.select(
    `student_brains?user_id=eq.${encodeURIComponent(userId)}&select=active_version_id&limit=1`,
  );
  if (!brain?.active_version_id) return null;

  // Filtered by user_id as well as version id — belt and braces. A version id alone would
  // be a lookup key an attacker could guess at; pairing it with the caller means a stolen
  // id still resolves to nothing.
  const [version] = await d.select(
    `brain_versions?id=eq.${brain.active_version_id}&user_id=eq.${encodeURIComponent(userId)}&select=profile,markdown&limit=1`,
  );
  if (!version) return null;

  // Prefer the stored projection; regenerate from the canonical profile if absent.
  if (version.markdown) return version.markdown;
  return version.profile ? brainToMarkdown(version.profile as BrainProfile) : null;
}

/** One open private thread per (session, student). Created on first ask. */
async function getOrCreateThread(userId: string, roomId: string, sessionId: string): Promise<string> {
  const d = db();
  const [existing] = await d.select(
    `private_threads?session_id=eq.${sessionId}&user_id=eq.${encodeURIComponent(userId)}&status=eq.open&select=id&limit=1`,
  );
  if (existing) return existing.id;

  const [created] = await d.insert("private_threads", {
    session_id: sessionId, room_id: roomId, user_id: userId, status: "open",
  });
  return created.id;
}

/**
 * Recent turns from the caller's own thread.
 * The thread id is only ever one we resolved for THIS caller above, so this cannot reach
 * a peer's messages.
 */
async function loadThreadHistory(threadId: string, limit = 10) {
  const rows = await db().select(
    `private_messages?thread_id=eq.${threadId}&select=author_type,body&order=created_at.desc&limit=${limit}`,
  );
  return rows.reverse().map(m => ({
    role: m.author_type === "ai" ? "assistant" : "user",
    content: m.body,
  }));
}

// ── Board cards ───────────────────────────────────────────────────────────────────────
// Reggie can furnish the room's shared whiteboard by appending a ```cards fence to its
// reply. That fence is MODEL OUTPUT, so everything below treats it as hostile input:
// an unknown kind degrades to a note, a card with no text is dropped, coordinates are
// clamped into the board, every string is length-capped, and malformed JSON degrades to
// a plain reply rather than failing the turn.
//
// The load-bearing rule is the `reference` kind. A reference card claims "this real course
// file matters for what you're doing" — so it may ONLY name a document that came back from
// retrieval on THIS turn. The server matches the model's `sourceTitle` case-insensitively
// against the turn's source_refs, rewrites it to the true title, attaches the true
// document_id, and DROPS anything it cannot match. An invented filename never reaches the
// client, so the board can never cite a file the room does not have.

/** Minimal shape of a retrieved source (structurally satisfied by RoomSourceRef). */
export interface CardSourceRef { document_id?: string | null; title?: string | null; [k: string]: any }

export type BoardCardKind = "note" | "quiz" | "guide" | "terms" | "reference";
export interface BoardCardTerm { term: string; definition: string }

/** A validated card, exactly as it goes over the wire to the client. */
export interface BoardCardPayload {
  kind: BoardCardKind;
  title: string;
  x: number;
  y: number;
  w: number;
  content?: string;              // markdown body (note/guide); quiz: the question text
  quizOptions?: string[];        // quiz
  correctOptionIndex?: number;   // quiz
  explanation?: string;          // quiz
  terms?: BoardCardTerm[];       // terms
  why?: string;                  // reference — one line on why this file matters
  documentId?: string;           // reference — SERVER-supplied, from the matched source
  sourceTitle?: string;          // reference — SERVER-supplied, the real title
}

const CARD_KINDS: BoardCardKind[] = ["note", "quiz", "guide", "terms", "reference"];
const MAX_CARDS = 4;
const MAX_TERMS = 8;
const MAX_QUIZ_OPTIONS = 6;
const DEFAULT_CARD_W: Record<BoardCardKind, number> = { note: 460, quiz: 480, guide: 560, terms: 420, reference: 420 };
// A guide carries 2–4 sections, so it gets a bigger body budget than a note.
const MAX_CARD_CONTENT: Record<BoardCardKind, number> = { note: 1200, quiz: 1200, guide: 2400, terms: 1200, reference: 1200 };

/** Falsy/NaN/0 → the default, then clamp. Matches the original `Number(v) || dflt` semantics. */
function clampNum(v: any, lo: number, hi: number, dflt: number): number {
  const n = Number(v);
  return Math.max(lo, Math.min(hi, Number.isFinite(n) && n !== 0 ? n : dflt));
}
function clampStr(v: any, max: number): string {
  return (v == null ? "" : String(v)).slice(0, max).trim();
}
const normTitle = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Resolve a model-supplied file name to a REAL retrieved source, or null.
 *
 * Two exact passes, never a substring/fuzzy match — a loose match would let a
 * one-character "title" resolve to whatever document happened to be first.
 *   1. case/whitespace-insensitive equality against a retrieved title
 *   2. the same, after stripping a trailing " — Heading", because the prompt's source
 *      list shows passages in "Title — Heading" form and the model sometimes echoes it
 */
function resolveSourceRef(sourceTitle: string, sourceRefs: CardSourceRef[]): CardSourceRef | null {
  if (!sourceTitle || !Array.isArray(sourceRefs) || !sourceRefs.length) return null;
  const candidates = [normTitle(sourceTitle), normTitle(sourceTitle.split(/\s+[—–-]\s+/)[0] ?? "")].filter(Boolean);
  for (const cand of candidates) {
    const hit = sourceRefs.find(r => typeof r?.title === "string" && normTitle(r.title) === cand);
    if (hit) return hit;
  }
  return null;
}

/** One card in → zero or one card out. Returning [] is how a bad card is dropped. */
function validateCard(c: any, sourceRefs: CardSourceRef[]): BoardCardPayload[] {
  const kind: BoardCardKind = CARD_KINDS.includes(c?.kind) ? c.kind : "note";
  const title = clampStr(c?.title, 80);
  if (!title) return [];

  const card: BoardCardPayload = {
    kind, title,
    x: clampNum(c?.x, 60, 2500, 1000),
    y: clampNum(c?.y, 60, 1500, 600),
    w: clampNum(c?.w, 320, 640, DEFAULT_CARD_W[kind]),
  };

  if (kind === "terms") {
    // Validate first, THEN cap — otherwise a half-written entry silently eats one of the
    // eight slots. The raw pre-slice just bounds the work a runaway generation can cause.
    const raw = Array.isArray(c?.terms) ? c.terms.slice(0, MAX_TERMS * 4) : [];
    const terms = raw.flatMap((t: any) => {
      const term = clampStr(t?.term, 80);
      const definition = clampStr(t?.definition, 240);
      return term && definition ? [{ term, definition }] : [];
    }).slice(0, MAX_TERMS);
    if (!terms.length) return [];          // a key-terms card with no terms is empty furniture
    card.terms = terms;
    const lede = clampStr(c?.content, MAX_CARD_CONTENT[kind]);
    if (lede) card.content = lede;         // optional one-line intro above the list
    return [card];
  }

  if (kind === "reference") {
    const why = clampStr(c?.why, 200);
    if (!why) return [];
    const hit = resolveSourceRef(clampStr(c?.sourceTitle, 200), sourceRefs);
    if (!hit) return [];                   // ← invented (or unretrieved) file: dropped here
    card.why = why;
    card.sourceTitle = clampStr(hit.title, 200);           // the REAL title, canonical casing
    if (hit.document_id) card.documentId = String(hit.document_id);  // the REAL id, never the model's
    return [card];
  }

  const content = clampStr(c?.content, MAX_CARD_CONTENT[kind]);
  if (!content) return [];
  card.content = content;

  if (kind === "quiz") {
    const opts = Array.isArray(c?.quizOptions)
      ? c.quizOptions.slice(0, MAX_QUIZ_OPTIONS).map((o: any) => String(o).slice(0, 160))
      : [];
    if (opts.length < 2) return [];
    card.quizOptions = opts;
    card.correctOptionIndex = Math.max(0, Math.min(opts.length - 1, Number(c?.correctOptionIndex) || 0));
    if (c?.explanation) card.explanation = String(c.explanation).slice(0, 300);
  }
  return [card];
}

/**
 * Split a model reply into { reply, cards }.
 *
 * The fence is stripped from the reply in EVERY outcome — valid, malformed, or empty —
 * because raw JSON in the transcript (or read aloud by TTS) is worse than no cards.
 * Pure and exported so test/roomAiCards.test.ts can exercise it without a live turn.
 */
export function parseCardsFence(text: any, sourceRefs: CardSourceRef[] = []): { reply: any; cards: BoardCardPayload[] } {
  if (typeof text !== "string") return { reply: text, cards: [] };
  const m = text.match(/```cards\s*\n([\s\S]*?)```/);
  if (!m) return { reply: text, cards: [] };

  const reply = text.replace(m[0], "").trim();
  let parsed: any;
  try { parsed = JSON.parse(m[1]); } catch { return { reply, cards: [] }; }
  if (!Array.isArray(parsed)) return { reply, cards: [] };

  // Validate, THEN cap. Capping first would let one dropped card — say a reference to an
  // invented filename — cost the room a slot a perfectly good card was going to fill.
  // The raw pre-slice bounds the work a runaway generation can cause.
  const cards = parsed.slice(0, MAX_CARDS * 4).flatMap((c: any) => validateCard(c, sourceRefs)).slice(0, MAX_CARDS);
  return { reply, cards };
}

/**
 * The BOARD CARDS prompt block. Exported for tests: the source list it emits is the only
 * thing telling the model which filenames are real, and it must stay in lockstep with
 * resolveSourceRef() — anything not listed here gets dropped server-side anyway.
 */
export function boardCardsPrompt(sourceRefs: CardSourceRef[] = []): string {
  const titles = [...new Set((sourceRefs ?? []).map(r => clampStr(r?.title, 200)).filter(Boolean))].slice(0, 8);
  const refBlock = titles.length
    ? `COURSE FILES YOU MAY CITE in a "reference" card — copy one of these titles EXACTLY as written. A reference naming anything else is discarded before it reaches the board, so never invent or guess a filename:
${titles.map(t => `- ${t}`).join("\n")}`
    : `No course files were retrieved for this turn, so do NOT use the "reference" kind at all.`;

  return `BOARD CARDS: The room has a big shared whiteboard (3000×1800 units; students see the center region first). If — and only if — placing content on the board would genuinely help (the user asked for it, or you are kicking off a session), append AFTER your reply one fenced block:
\`\`\`cards
[{"kind":"note","title":"...","content":"markdown ≤80 words","x":1000,"y":600,"w":460}]
\`\`\`
Five kinds — pick whichever fit, and mix them freely:
- note — use this when one short paragraph says it: an idea, a definition, a reminder.
  {"kind":"note","title":"...","content":"markdown ≤80 words","x":1000,"y":600,"w":460}
- quiz — use this when you want them to answer rather than read; checks understanding on the spot.
  {"kind":"quiz","title":"...","content":"the question","x":1550,"y":620,"w":480,"quizOptions":["A","B","C","D"],"correctOptionIndex":0,"explanation":"one line"}
- guide — use this when the topic needs structure: 2–4 short sections of steps or checkpoints, as markdown headings with bullets.
  {"kind":"guide","title":"...","content":"## Step 1\\n- ...\\n- ...\\n\\n## Step 2\\n- ...","x":950,"y":480,"w":560}
- terms — use this when the blocker is vocabulary rather than reasoning; one line per term, max 8.
  {"kind":"terms","title":"...","terms":[{"term":"...","definition":"one line"}],"x":1700,"y":900,"w":420}
- reference — use this when the answer already lives in a file this room has; point them at it instead of re-explaining.
  {"kind":"reference","title":"...","why":"one line on why this file matters right now","sourceTitle":"<an exact title from the list below>","x":1900,"y":1050,"w":420}
${refBlock}
Max 4 cards total. Spread x 900–2100, y 450–1250 so cards land in the visible center without stacking. Never mention the fence or the JSON in your prose; for a plain conversational question, no fence at all.`;
}

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();

  const action = req.query?.action;
  if (action !== "group" && action !== "private") {
    return res.status(400).json({ error: "Unknown action. Use ?action=group|private" });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const scope: "group" | "private" = action;

  try {
    const userId = await requireUserOr401(req, res);
    if (!userId) return;

    const roomId = String(req.body?.roomId ?? "");
    const message = String(req.body?.message ?? "").trim();
    if (!UUID_RE.test(roomId)) return res.status(400).json({ error: "valid roomId required" });
    if (!message) return res.status(400).json({ error: "message required" });
    if (message.length > MAX_MESSAGE_CHARS) return res.status(413).json({ error: `message too long (max ${MAX_MESSAGE_CHARS})` });

    // Architecture §5: 30/min per user. AI turns cost money and are an abuse vector.
    if (!(await rateLimit(req, res, "room-ai", { anonMax: 5, authMax: 30, windowSecs: 60 }))) return;

    if (!(await isJoinedMember(userId, roomId))) {
      return res.status(403).json({ error: "Not a joined member of this room." });
    }

    const session = await loadActiveSession(roomId);
    if (!session) return res.status(409).json({ error: "No active AI session for this room. Start one first." });

    // Ground the turn. Both primitives take roomId and assume membership is already
    // verified above — that check is what earns the right to call them. Room sources and
    // the board are SHARED, so both scopes may use them; only the pedagogy layer differs.
    const [retrieval, board, callerAssignments] = await Promise.all([
      searchRoomSources(roomId, message),
      latestBoardContext(roomId),
      // The caller's synced Canvas schedule. Without it the room tutor concludes it
      // "can't see" assignments and sends students back to Quercus — the same failure
      // the full-page tutor had. Best-effort: a failed fetch degrades to no digest.
      db().select(
        `assignments?user_id=eq.${userId}&select=title,due_at,submitted_at&order=due_at.asc.nullslast&limit=300`,
      ).catch(() => [] as any[]),
    ]);

    // Compact schedule digest: overdue summary + the next 14 days, capped.
    let scheduleDigest: string | null = null;
    {
      const rows = (callerAssignments as any[]).filter(r => r?.due_at);
      const nowT = Date.now();
      const fmt = (iso: string) => new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
      const unsub = rows.filter(r => !r.submitted_at);
      const overdue = unsub.filter(r => new Date(r.due_at).getTime() < nowT);
      const upcoming = unsub
        .filter(r => { const t = new Date(r.due_at).getTime(); return t >= nowT && t - nowT < 14 * 86_400_000; })
        .slice(0, 15);
      if (overdue.length || upcoming.length) {
        scheduleDigest = [
          overdue.length ? `OVERDUE (${overdue.length}): ${overdue.slice(-5).map(r => `${r.title} (was due ${fmt(r.due_at)})`).join("; ")}${overdue.length > 5 ? "; …" : ""}` : "Nothing overdue.",
          upcoming.length ? `DUE NEXT 14 DAYS:\n${upcoming.map(r => `- ${r.title} — due ${fmt(r.due_at)}`).join("\n")}` : "Nothing due in the next 14 days.",
        ].join("\n");
      }
    }

    const boardText = board?.extract?.texts?.length
      ? board.extract.texts.map((t: any) => t.text).join("\n")
      : null;

    // The scope divergence, in one place:
    //   group   → the room plan, no individual profile, no thread history.
    //   private → the CALLER'S profile, plan forced to null, their own thread history.
    const isPrivate = scope === "private";
    const threadId = isPrivate ? await getOrCreateThread(userId, roomId, session.id) : null;
    const [studentProfileMarkdown, history] = isPrivate
      ? await Promise.all([loadOwnBrainMarkdown(userId), loadThreadHistory(threadId!)])
      : [null, []];

    const system = buildRoomSystemPrompt({
      scope,
      persona: session.persona,
      intensity: session.intensity,
      // Hard null for private: buildRoomSystemPrompt's contract says private scope must
      // pass null, and a room plan in a 1:1 turn is precisely the cross-student leak.
      plan: isPrivate ? null : session.plan,
      studentProfileMarkdown,
      sources: retrieval.passages.map(p => ({
        title: p.heading ? `${p.title} — ${p.heading}` : p.title,
        excerpt: p.text.slice(0, EXCERPT_CHARS),
      })),
      boardText,
      boardRevision: board?.revision ?? null,
    });

    // Board cards (opt-in, group + non-stream only): the client asks for structured
    // cards it can materialize onto the shared whiteboard. Kept out of the streamed
    // path on purpose — fence JSON in a token stream would get sentence-chunked into
    // TTS. The fence sits at the END of the reply and is stripped before returning.
    // Schedule grounding rides every scope — the room tutor must never claim it lacks
    // Canvas access or send students off to Quercus; the app IS the Canvas connection.
    const systemWithSchedule = scheduleDigest
      ? system + `

CALLER'S LIVE CANVAS SCHEDULE (FschoolAI syncs their Canvas account automatically — this data IS their real account, kept fresh by the app; answer "what's due"-type questions directly from it; never claim you lack Canvas access, never tell them to log into Canvas/Quercus to check):
${scheduleDigest}`
      : system;

    const allowCards = scope === "group" && req.body?.allowCards === true && req.body?.stream !== true;
    // The retrieved titles ride into the prompt so the model can cite them verbatim; the
    // same list is what parseCardsFence validates `reference` cards against below.
    const systemFinal = allowCards
      ? systemWithSchedule + "\n\n" + boardCardsPrompt(retrieval.source_refs)
      : systemWithSchedule;

    const messages = [...history, { role: "user", content: message }];
    const metadata = { scope, user_id: userId, room_id: roomId, session_id: session.id, persona: session.persona };

    // Streaming path (group only): the room voice agent streams tokens so the client can
    // sentence-chunk them into TTS and start speaking within ~a second. Pipes the gateway's
    // raw SSE straight through, exactly like api/claude.ts. Grounding still runs above; the
    // grounded refs are simply not surfaced on the streamed turn.
    if (scope === "group" && req.body?.stream === true) {
      const out = await openStream({ task: "tutor", system: systemWithSchedule, messages, max_tokens: 900, metadata });
      if (!out.ok || !out.stream) {
        return res.status(out.status >= 400 ? out.status : 502).json({ error: out.error ?? "stream open failed", detail: out.detail });
      }
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      const reader = out.stream.getReader();
      try {
        while (true) { const { done, value } = await reader.read(); if (done) break; res.write(value); }
      } finally { res.end(); }
      return;
    }

    const result = await callModel({
      task: "tutor",
      system: systemFinal,
      messages,
      max_tokens: 900,
      // Lifted into prompt_runs columns by the trace sink → BE-12 with no manual write.
      metadata,
    });

    if (!result.ok) {
      console.error("[room-ai] gateway failed:", result.error, result.detail);
      return res.status(result.status >= 400 ? result.status : 502).json({ error: result.error ?? "AI call failed" });
    }

    // Strip + validate the cards fence. A malformed fence degrades to a plain reply —
    // never fail the turn over board furniture. `reference` cards are checked against
    // THIS turn's retrieved sources, so a hallucinated filename dies here.
    const fence = allowCards
      ? parseCardsFence(result.content, retrieval.source_refs)
      : { reply: result.content, cards: [] as BoardCardPayload[] };
    const replyContent = fence.reply;
    const cards = fence.cards;

    // Persist the private exchange AFTER a successful answer, so a failed turn does not
    // leave a dangling user message the next turn would replay as context.
    if (isPrivate && threadId) {
      await db().insert("private_messages", [
        { thread_id: threadId, author_type: "user", body: message },
        { thread_id: threadId, author_type: "ai", body: result.content },
      ], false);
    }

    // The client-visible grounding contract (_contracts.ts). `planVersion` is a NUMBER —
    // it tells the UI the plan existed, and reveals nothing about its contents. It is null
    // on a private turn because no plan was used at all.
    const grounded: GroundingRef = {
      sources: retrieval.source_refs.map(r => ({ documentId: r.document_id, title: r.title })),
      boardRevision: board?.revision ?? null,
      planVersion: isPrivate ? null : (session.plan?.version ?? null),
      // Nothing retrieved and no board → the answer cannot be grounded in room material,
      // so the UI must be able to label it. The prompt layer also tells the model to say so.
      generalKnowledge: retrieval.used === 0 && !boardText,
    };

    return res.status(200).json({
      ok: true,
      scope,
      sessionId: session.id,
      persona: session.persona,
      ...(threadId ? { threadId } : {}),
      message: replyContent,
      ...(cards.length ? { cards } : {}),
      grounded,
      trace_id: result.trace_id,
    });
  } catch (err: any) {
    console.error("[room-ai] error:", err?.message ?? err);
    return res.status(502).json({ error: err?.message ?? "room AI error" });
  }
}

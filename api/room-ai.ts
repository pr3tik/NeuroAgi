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
import { callModel } from "./_gateway.js";
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
    const [retrieval, board] = await Promise.all([
      searchRoomSources(roomId, message),
      latestBoardContext(roomId),
    ]);

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

    const result = await callModel({
      task: "tutor",
      system,
      messages: [...history, { role: "user", content: message }],
      max_tokens: 900,
      // Lifted into prompt_runs columns by the trace sink → BE-12 with no manual write.
      metadata: {
        scope,
        user_id: userId,
        room_id: roomId,
        session_id: session.id,
        persona: session.persona,
      },
    });

    if (!result.ok) {
      console.error("[room-ai] gateway failed:", result.error, result.detail);
      return res.status(result.status >= 400 ? result.status : 502).json({ error: result.error ?? "AI call failed" });
    }

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
      message: result.content,
      grounded,
      trace_id: result.trace_id,
    });
  } catch (err: any) {
    console.error("[room-ai] error:", err?.message ?? err);
    return res.status(502).json({ error: err?.message ?? "room AI error" });
  }
}

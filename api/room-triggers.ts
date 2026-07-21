// api/room-triggers.ts — AI-08: the trigger engine's cron tick.
//
//   POST /api/room-triggers?action=tick   (CRON_SECRET; wired to a 1-minute Vercel cron)
//
// The 1-minute fallback that makes proactivity reliable even if no event-driven call fires.
// For every ACTIVE session it gathers the context the pure policy layer (api/_triggers.ts)
// needs, evaluates it, and records the single decision to intervention_events. When a rule
// SENDS, a message_id is minted; actual delivery to the room channel is the integration seam
// (same boundary as AI-04 — this engine decides + audits, it does not broadcast).
//
// Fail closed on CRON_SECRET (matches brain-scheduler): this reads participation and could
// drive AI messages, so it must never be publicly triggerable.
import { randomUUID } from "crypto";
import { loadSessionParticipation } from "./_participation.js";
import { evaluateTriggers, BLOCK_MS } from "./_triggers.js";
import type { TriggerSession, TriggerContext, TriggerDecision } from "./_triggers.js";
import { PERSONA_IDS } from "./_contracts.js";
import type { PersonaId, InterventionIntensity } from "./_contracts.js";

export const config = { maxDuration: 60 };

function db() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("Supabase env vars not configured");
  const headers: Record<string, string> = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  return {
    async select(path: string) {
      const r = await fetch(`${url}/rest/v1/${path}`, { headers });
      if (!r.ok) throw new Error(`select ${path.split("?")[0]} failed (${r.status})`);
      return (await r.json()) as any[];
    },
    async insert(table: string, body: any) {
      const r = await fetch(`${url}/rest/v1/${table}`, { method: "POST", headers, body: JSON.stringify(body) });
      if (!r.ok) throw new Error(`insert ${table} failed (${r.status}): ${(await r.text()).slice(0, 200)}`);
    },
    async patch(path: string, body: any) {
      const r = await fetch(`${url}/rest/v1/${path}`, { method: "PATCH", headers: { ...headers, Prefer: "return=minimal" }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error(`patch ${path.split("?")[0]} failed (${r.status}): ${(await r.text()).slice(0, 200)}`);
    },
  };
}

const ms = (t: any) => (t ? new Date(t).getTime() : null);

/** Rooms auto-close after this long without a liveness signal, so the lobby doesn't
 *  accumulate dead rooms forever (nothing closed them before — deactivation only ever
 *  ran as failed-create rollback). The client bumps study_rooms.last_active on join AND
 *  on a 5-minute heartbeat while inside, so an occupied room can't age past the window;
 *  only rooms whose every occupant left (or closed the tab) go stale. */
const ROOM_IDLE_CLOSE_MS = Number(process.env.ROOM_IDLE_CLOSE_MS || 45 * 60_000);

/** Close rooms idle past ROOM_IDLE_CLOSE_MS. Exported for the unit test.
 *  Belt-and-suspenders: a room is spared if any open session STARTED inside the window
 *  (a just-joined user whose first heartbeat hasn't fired must not lose the room).
 *  Closing a room also stamps left_at on its dangling sessions — tab-closes never write
 *  one, and rows open forever would poison the time-tracking stats. */
export async function sweepStaleRooms(d: ReturnType<typeof db>, nowMs = Date.now()) {
  const cutoff = encodeURIComponent(new Date(nowMs - ROOM_IDLE_CLOSE_MS).toISOString());
  const stale = await d.select(`study_rooms?is_active=eq.true&last_active=lt.${cutoff}&select=id&limit=100`);
  if (!stale.length) return { closed: 0, roomIds: [] as string[] };
  const ids = stale.map((r) => r.id);
  const fresh = await d.select(`room_sessions?room_id=in.(${ids.join(",")})&left_at=is.null&joined_at=gt.${cutoff}&select=room_id`);
  const freshSet = new Set(fresh.map((r) => r.room_id));
  const toClose = ids.filter((id) => !freshSet.has(id));
  if (!toClose.length) return { closed: 0, roomIds: [] as string[] };
  const inList = `in.(${toClose.join(",")})`;
  await d.patch(`study_rooms?id=${inList}`, { is_active: false });
  await d.patch(`room_sessions?room_id=${inList}&left_at=is.null`, { left_at: new Date(nowMs).toISOString() });
  return { closed: toClose.length, roomIds: toClose };
}

/** Assemble the pure engine's context for one session from the DB. Exported so the live
 *  test and any event-driven caller can reuse the exact same gathering. */
export async function buildContextAndEvaluate(d: ReturnType<typeof db>, session: any, nowMs = Date.now()) {
  const sessionId = session.id as string;

  // Frozen config for this session (persona / intensity / duration).
  const [cfg] = await d.select(
    `room_configs?room_id=eq.${session.room_id}&version=eq.${session.config_version ?? 0}&select=persona,intervention_intensity,duration_minutes&limit=1`,
  );
  const persona: PersonaId = PERSONA_IDS.includes(cfg?.persona) ? cfg.persona : "facilitator";
  const intensity: InterventionIntensity = ["low", "balanced", "active"].includes(cfg?.intervention_intensity) ? cfg.intervention_intensity : "balanced";

  const ts: TriggerSession = {
    sessionId,
    state: session.state,
    startedAtMs: ms(session.started_at) ?? nowMs,
    durationMinutes: cfg?.duration_minutes ?? null,
    persona, intensity,
  };

  // Last activity (silence detection).
  const [lastAct] = await d.select(
    `activity_events?session_id=eq.${sessionId}&select=created_at&order=created_at.desc&limit=1`,
  );

  // Recent intervention history: cooldowns, fired milestones, per-block sends, per-target caps.
  const history = await d.select(
    `intervention_events?session_id=eq.${sessionId}&select=rule,target_user_id,decision,state,created_at&order=created_at.desc&limit=200`,
  );
  const sent = history.filter(h => h.decision === "sent");
  const silenceLastSentMs = ms(sent.find(h => h.rule === "silence")?.created_at ?? null);
  const firedMilestones = sent.filter(h => h.rule === "time_milestone").map(h => String(h.state?.milestone ?? h.state?.fraction ?? "")).filter(Boolean);
  const curBlock = Math.floor(Math.max(0, nowMs - ts.startedAtMs) / BLOCK_MS);
  const sentThisBlock = sent.filter(h => (h.state?.block ?? -1) === curBlock).length;
  const unevenSentCount: Record<string, number> = {};
  for (const h of sent) if (h.rule === "uneven" && h.target_user_id) unevenSentCount[h.target_user_id] = (unevenSentCount[h.target_user_id] ?? 0) + 1;

  // Participation (AI-07) + who's in private help.
  const { participants, median } = await loadSessionParticipation(sessionId);
  const openThreads = await d.select(`private_threads?session_id=eq.${sessionId}&status=eq.open&select=user_id`);
  const privateHelpActive = new Set(openThreads.map(t => t.user_id));

  const ctx: TriggerContext = {
    nowMs, lastActivityAtMs: ms(lastAct?.created_at ?? null),
    silenceLastSentMs, sentThisBlock, firedMilestones,
    participants, median, unevenSentCount, privateHelpActive,
  };

  return { session: ts, decision: evaluateTriggers(ts, ctx) };
}

/** Persist a decision to intervention_events, minting a message_id when it was sent. Milestone
 *  key is folded into `state` so the next tick's firedMilestones can dedupe. */
export async function recordDecision(d: ReturnType<typeof db>, sessionId: string, decision: NonNullable<Awaited<ReturnType<typeof buildContextAndEvaluate>>["decision"]>) {
  const messageId = decision.decision === "sent" ? randomUUID() : null;
  await d.insert("intervention_events", {
    session_id: sessionId,
    rule: decision.rule,
    target_user_id: decision.targetUserId,
    state: { ...decision.state, milestone: decision.milestone ?? null, message: decision.message },
    decision: decision.decision,
    message_id: messageId,
  });
  return messageId;
}

/** The room-channel broadcast for a decision — null unless it actually SENT (so only real nudges
 *  reach clients; suppressed/no-op decisions are audit-only). Pure/testable; the impure send is
 *  broadcastToRoom below. */
export function interventionBroadcast(
  roomId: string,
  decision: TriggerDecision,
  messageId: string | null,
): { topic: string; event: "intervention"; payload: Record<string, any> } | null {
  if (decision.decision !== "sent" || !decision.message) return null;
  return {
    topic: `room:${roomId}`,
    event: "intervention",
    payload: {
      messageId,
      rule: decision.rule,
      message: decision.message,
      persona: decision.state?.persona ?? null,
      milestone: decision.milestone ?? null,
    },
  };
}

/** Fire a broadcast on a room's realtime topic via the Supabase Realtime REST endpoint. The room
 *  channel is public (clients subscribe to "room:<id>"), so a server-side send reaches everyone in
 *  the room. Best-effort — a failed broadcast never fails the tick; the audit row is already written. */
async function broadcastToRoom(msg: { topic: string; event: string; payload: any }): Promise<void> {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return;
  try {
    const r = await fetch(`${url}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [msg] }),
    });
    if (!r.ok) console.warn("[room-triggers] broadcast non-OK:", r.status);
  } catch (e) {
    console.warn("[room-triggers] broadcast failed:", (e as Error).message);
  }
}

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-cron-secret");
  if (req.method === "OPTIONS") return res.status(204).end();

  const secret = process.env.CRON_SECRET;
  if (!secret) return res.status(401).json({ error: "Unauthorized" });   // fail closed
  const auth = req.headers?.authorization ?? req.headers?.["x-cron-secret"];
  if (auth !== `Bearer ${secret}` && auth !== secret) return res.status(401).json({ error: "Unauthorized" });

  if (req.query?.action !== "tick") return res.status(400).json({ error: "Unknown action. Use ?action=tick" });

  try {
    const d = db();
    const nowMs = Date.now();
    const sessions = await d.select(`room_ai_sessions?state=eq.active&select=id,room_id,config_version,state,started_at&limit=200`);

    const results: any[] = [];
    for (const s of sessions) {
      try {
        const { decision } = await buildContextAndEvaluate(d, s, nowMs);
        if (!decision) { results.push({ session: s.id, decision: "no_op" }); continue; }
        const messageId = await recordDecision(d, s.id, decision);
        // Delivery seam: a SENT decision is broadcast to the room's realtime channel so clients
        // render the intervention card. Decide-and-audit stays above; this is the actual send.
        const bc = interventionBroadcast(s.room_id, decision, messageId);
        if (bc) await broadcastToRoom(bc);
        results.push({ session: s.id, rule: decision.rule, decision: decision.decision, target: decision.targetUserId, message_id: messageId, delivered: !!bc });
      } catch (err: any) {
        // One bad session must not abort the tick for the rest.
        console.error(`[room-triggers] session ${s.id} failed:`, err?.message ?? err);
        results.push({ session: s.id, error: String(err?.message ?? err).slice(0, 120) });
      }
    }

    // Stale-room sweep rides the same tick. Its failure must not fail trigger delivery.
    let sweep: any = null;
    try {
      sweep = await sweepStaleRooms(d, nowMs);
    } catch (err: any) {
      console.error("[room-triggers] sweep failed:", err?.message ?? err);
      sweep = { error: String(err?.message ?? err).slice(0, 120) };
    }

    return res.status(200).json({ ok: true, sessions: sessions.length, results, sweep });
  } catch (err: any) {
    console.error("[room-triggers] error:", err?.message ?? err);
    return res.status(502).json({ error: err?.message ?? "trigger error" });
  }
}

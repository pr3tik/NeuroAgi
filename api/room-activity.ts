// api/room-activity.ts — BE-10: the participation activity ingest.
//
//   POST /api/room-activity  { sessionId, roomId, events: [{ type, magnitude?, meta? }] }
//
// Clients emit lightweight signals as students work (a chat sent, a burst of board
// strokes, an AI question). This endpoint is the write gate for participation, and its
// whole job is to keep that firehose from becoming a row-per-event flood.
//
// TWO-LAYER MODEL (matches supabase-studyroom-sprint-migration.sql):
//   activity_events      — the append log. Per-MINUTE buckets (bucket_start defaults to
//                          date_trunc('minute', now())). We AGGREGATE the request batch by
//                          type first, so 50 chat_sent events in one call become ONE row of
//                          magnitude 50 — the BE-10 exit criterion ("burst flood does NOT
//                          create row-per-event").
//   participant_metrics  — the derived aggregate. RECOMPUTED as a pure function of the log
//                          (sum magnitudes per channel), never incremented. Recompute-from-
//                          log is idempotent, which is what makes the score stable under
//                          reconnect + high-frequency replay (AI-07's requirement).
//
// The composite/normalized SCORE and opt-out live in AI-07 (api/_participation.ts); this
// file only maintains the raw sub-scores it derives from.
import { requireUserOr401 } from "./_auth.js";
import { rateLimit } from "./_ratelimit.js";
import { ACTIVITY_EVENT_TYPES } from "./_contracts.js";
import type { ActivityEventType } from "./_contracts.js";

export const config = { maxDuration: 30 };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_EVENTS_PER_REQUEST = 200;   // a client should batch, not stream one-at-a-time
const MAX_MAGNITUDE = 600;            // per aggregated bucket — a minute has 600s of focus at most

const ALLOWED = new Set<string>(ACTIVITY_EVENT_TYPES);

// Which raw event types feed which participant_metrics sub-score. Types not listed here
// (hand_raise, timer_milestone, session_started/ended) are still logged for audit/triggers
// but do not move a score. focus_state feeds active_seconds (its magnitude = seconds).
const CHANNEL: Partial<Record<ActivityEventType, "chat_score" | "board_score" | "peer_score" | "help_score">> = {
  chat_sent:   "chat_score",
  board_burst: "board_score",
  peer_reply:  "peer_score",
  talk_to_ai:  "help_score",
};

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
    async insert(table: string, body: any) {
      const r = await fetch(`${url}/rest/v1/${table}`, {
        method: "POST", headers, body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(`insert ${table} failed (${r.status}): ${(await r.text()).slice(0, 200)}`);
    },
    async upsert(table: string, body: any, onConflict: string) {
      const r = await fetch(`${url}/rest/v1/${table}?on_conflict=${onConflict}`, {
        method: "POST",
        headers: { ...headers, Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(`upsert ${table} failed (${r.status}): ${(await r.text()).slice(0, 200)}`);
    },
  };
}

async function isJoinedMember(d: ReturnType<typeof db>, userId: string, roomId: string): Promise<boolean> {
  const rows = await d.select(
    `room_members?room_id=eq.${roomId}&user_id=eq.${encodeURIComponent(userId)}&status=eq.joined&select=user_id&limit=1`,
  );
  return rows.length > 0;
}

/** The session must belong to the room the caller is a member of — closes the hole where a
 *  member of room A posts activity against room B's session id. */
async function sessionBelongsToRoom(d: ReturnType<typeof db>, sessionId: string, roomId: string): Promise<boolean> {
  const rows = await d.select(
    `room_ai_sessions?id=eq.${sessionId}&room_id=eq.${roomId}&select=id&limit=1`,
  );
  return rows.length > 0;
}

/**
 * Recompute one participant's sub-scores from the activity log — a pure fold over
 * activity_events, so it cannot drift or double-count on replay. Cheap: a session's rows
 * are bounded (≈ minutes × types).
 */
async function recomputeMetrics(d: ReturnType<typeof db>, sessionId: string, userId: string) {
  const rows = await d.select(
    `activity_events?session_id=eq.${sessionId}&user_id=eq.${encodeURIComponent(userId)}&select=type,magnitude`,
  );
  const acc = { chat_score: 0, board_score: 0, peer_score: 0, help_score: 0, active_seconds: 0 };
  for (const r of rows) {
    const ch = CHANNEL[r.type as ActivityEventType];
    if (ch) acc[ch] += Number(r.magnitude) || 0;
    else if (r.type === "focus_state") acc.active_seconds += Number(r.magnitude) || 0;
  }
  await d.upsert("participant_metrics", {
    session_id: sessionId, user_id: userId,
    chat_score: acc.chat_score, board_score: acc.board_score,
    peer_score: acc.peer_score, help_score: acc.help_score,
    active_seconds: Math.round(acc.active_seconds),
    computed_at: new Date().toISOString(),
  }, "session_id,user_id");
  return acc;
}

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const userId = await requireUserOr401(req, res);
    if (!userId) return;

    const { sessionId, roomId, events } = req.body ?? {};
    if (!UUID_RE.test(String(sessionId ?? ""))) return res.status(400).json({ error: "valid sessionId required" });
    if (!UUID_RE.test(String(roomId ?? ""))) return res.status(400).json({ error: "valid roomId required" });
    if (!Array.isArray(events) || events.length === 0) return res.status(400).json({ error: "events[] required" });
    if (events.length > MAX_EVENTS_PER_REQUEST) return res.status(413).json({ error: `too many events (max ${MAX_EVENTS_PER_REQUEST})` });

    // High-frequency by nature, but bounded per user so a client cannot spin the endpoint.
    if (!(await rateLimit(req, res, "room-activity", { anonMax: 10, authMax: 120, windowSecs: 60 }))) return;

    const d = db();
    if (!(await isJoinedMember(d, userId, roomId))) {
      return res.status(403).json({ error: "Not a joined member of this room." });
    }
    if (!(await sessionBelongsToRoom(d, sessionId, roomId))) {
      return res.status(409).json({ error: "session does not belong to this room" });
    }

    // ── Aggregate the batch by type — THIS is the flood protection. A burst of N events of
    // the same type collapses to one row of summed (capped) magnitude, not N rows.
    const byType = new Map<string, number>();
    let dropped = 0;
    for (const ev of events) {
      const type = String(ev?.type ?? "");
      if (!ALLOWED.has(type)) { dropped++; continue; }   // ignore unknown types, don't 400 the whole batch
      const mag = Number.isFinite(+ev?.magnitude) ? Math.max(0, +ev.magnitude) : 1;
      byType.set(type, (byType.get(type) ?? 0) + mag);
    }
    if (byType.size === 0) return res.status(400).json({ error: "no valid events after validation" });

    // One aggregated row per type. bucket_start defaults to the current minute server-side,
    // so the whole batch lands in one bucket — the intended granularity.
    const rows = [...byType.entries()].map(([type, magnitude]) => ({
      session_id: sessionId,
      room_id: roomId,
      user_id: userId,
      type,
      magnitude: Math.min(magnitude, MAX_MAGNITUDE),   // cap so one call can't inflate a channel
    }));
    await d.insert("activity_events", rows);

    // Derive the caller's sub-scores from the (now updated) log. Idempotent — never
    // increments, so a resent batch cannot double-count the score.
    const metrics = await recomputeMetrics(d, sessionId, userId);

    return res.status(200).json({
      ok: true,
      buckets_written: rows.length,   // NOT events.length — proof the flood was collapsed
      events_received: events.length,
      dropped,
      metrics,
    });
  } catch (err: any) {
    console.error("[room-activity] error:", err?.message ?? err);
    return res.status(502).json({ error: err?.message ?? "activity error" });
  }
}

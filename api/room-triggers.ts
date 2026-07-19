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
import type { TriggerSession, TriggerContext } from "./_triggers.js";
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
  };
}

const ms = (t: any) => (t ? new Date(t).getTime() : null);

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
        results.push({ session: s.id, rule: decision.rule, decision: decision.decision, target: decision.targetUserId, message_id: messageId });
      } catch (err: any) {
        // One bad session must not abort the tick for the rest.
        console.error(`[room-triggers] session ${s.id} failed:`, err?.message ?? err);
        results.push({ session: s.id, error: String(err?.message ?? err).slice(0, 120) });
      }
    }

    return res.status(200).json({ ok: true, sessions: sessions.length, results });
  } catch (err: any) {
    console.error("[room-triggers] error:", err?.message ?? err);
    return res.status(502).json({ error: err?.message ?? "trigger error" });
  }
}

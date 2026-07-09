/**
 * api/brain-intervention.ts — Vercel Cron Job (Pattern B: watch → evaluate → propose).
 *
 * Runs every 30 minutes. Reads context_window from the Brain DB (NeuroAGI),
 * detects students who need a proactive nudge, and writes a CANDIDATE to the
 * FschoolAI Signal Arbiter (public.proactive_signals) — it no longer delivers
 * directly. The Arbiter (api/arbiter.ts) owns dedup, ranking, rate limits, quiet
 * hours, and the actual delivery (in-app + Discord). Every proposal is logged to
 * the Brain DB interventions table for cooldown + audit.
 *
 * Trigger conditions (stress is 0–10, matching brain-scheduler):
 *   - stress_level >= 7  (high stress)
 *   - momentum_state in ['declining', 'stalled']
 *   - expires_at is past (context stale > 8h) AND stress_level >= 5
 *
 * Stress-escalation cap (§8): if stress stays very high (>= 9) across 3+ recent
 * interventions and the student keeps not engaging, stop nudging — send ONE
 * supportive wellbeing message with campus resources and pause stress nudges 48h.
 *
 * Cooldown: won't re-propose for the same person within 4h unless stress rose >= 2.
 *
 * Env: BRAIN_SUPABASE_URL, BRAIN_SUPABASE_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY,
 *      CRON_SECRET (fail-closed). Optional: CAMPUS_WELLBEING_URL.
 */
import { proposeProactive } from "./_notify.js";
import { computeTuning, labelOf, type Tuning } from "./_tuning.js";

const BRAIN_URL  = process.env.BRAIN_SUPABASE_URL;
const BRAIN_KEY  = process.env.BRAIN_SUPABASE_KEY;
const FS_URL     = process.env.SUPABASE_URL;
const FS_KEY     = process.env.SUPABASE_SERVICE_KEY;

const COOLDOWN_MS       = 4 * 60 * 60 * 1000;   // 4 hours
const STRESS_ESCALATION = 2;                      // re-propose if stress rose by this much
const ESCALATION_STRESS = 9;                      // "very high" on the 0–10 scale (~0.9)
const ESCALATION_COUNT  = 3;                      // # of recent very-high interventions that trips the cap
const ESCALATION_PAUSE_MS = 48 * 60 * 60 * 1000;  // suppress stress nudges this long after escalating
const THREE_DAYS_MS     = 3 * 24 * 60 * 60 * 1000;

// ── Brain DB helpers ──────────────────────────────────────────────────────────
const brainHeaders = {
  apikey:          BRAIN_KEY,
  Authorization:   `Bearer ${BRAIN_KEY}`,
  "Content-Type":  "application/json",
  Prefer:          "return=representation",
};
async function brainGet(path: string): Promise<any[]> {
  const res = await fetch(`${BRAIN_URL}/rest/v1/${path}`, { headers: brainHeaders as any });
  if (!res.ok) throw new Error(`Brain GET ${path} failed ${res.status}: ${await res.text().catch(() => "")}`);
  return res.json();
}
async function brainPost(path: string, body: unknown): Promise<void> {
  const res = await fetch(`${BRAIN_URL}/rest/v1/${path}`, {
    method:  "POST",
    headers: { ...brainHeaders, Prefer: "return=minimal" } as any,
    body:    JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Brain POST ${path} failed ${res.status}: ${await res.text().catch(() => "")}`);
}

// ── FschoolAI DB reader (notification_queue lives here — see api/arbiter.ts) ─────
const fsHeaders = { apikey: FS_KEY, Authorization: `Bearer ${FS_KEY}`, "Content-Type": "application/json" };
async function fsGet(path: string): Promise<any[]> {
  const res = await fetch(`${FS_URL}/rest/v1/${path}`, { headers: fsHeaders as any });
  if (!res.ok) throw new Error(`FS GET ${path} failed ${res.status}: ${await res.text().catch(() => "")}`);
  return res.json();
}
async function fsPost(path: string, body: unknown, upsert = false): Promise<void> {
  const res = await fetch(`${FS_URL}/rest/v1/${path}`, {
    method:  "POST",
    headers: { ...fsHeaders, Prefer: upsert ? "resolution=merge-duplicates,return=minimal" : "return=minimal" } as any,
    body:    JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`FS POST ${path} failed ${res.status}: ${await res.text().catch(() => "")}`);
}

// ── Message composer ──────────────────────────────────────────────────────────
function composeMessage(person: any, ctx: any): string {
  const name     = person.name ?? "there";
  const stress   = ctx.stress_level ?? 5;
  const momentum = ctx.momentum_state ?? "steady";
  const focus    = ctx.what_to_focus_on ?? null;
  const deadline = ctx.active_deadline ?? null;
  const gaps     = Array.isArray(ctx.knowledge_gaps) ? ctx.knowledge_gaps : [];
  const summary  = ctx.recent_summary ?? null;

  let opening;
  if (stress >= 8)                opening = `Hey ${name} 👋 — I can see you're under a lot of pressure right now.`;
  else if (stress >= 7)           opening = `Hey ${name} — looks like things are getting a bit intense.`;
  else if (momentum === "stalled") opening = `Hey ${name} — I noticed you've been a bit stuck lately.`;
  else                            opening = `Hey ${name} — your momentum has been dipping a little.`;

  const lines = [opening];
  if (summary)        lines.push(`📊 ${summary}`);
  if (deadline)       lines.push(`⏰ Upcoming: **${deadline}**`);
  if (focus)          lines.push(`🎯 Focus tip: ${focus}`);
  if (gaps.length)    lines.push(`🧠 Worth revisiting: ${gaps.slice(0, 2).join(", ")}`);
  lines.push("", "I'm here whenever you're ready to work through it. You've got this! 💪", "_— Reggie, your academic brain_");
  return lines.join("\n");
}

// Supportive wellbeing message — §8: no clinical terms, never implies failure or diagnosis.
function composeWellbeing(person: any): string {
  const name = person.name ?? "there";
  const link = process.env.CAMPUS_WELLBEING_URL || "your campus health & wellness services";
  return [
    `Hey ${name} — it looks like this has been a heavy stretch.`,
    `FschoolAI will be here whenever you're ready, no pressure at all.`,
    `If it would help to talk to someone, ${link} is there for you.`,
    `Take care of yourself first. 💛`,
    `_— Reggie_`,
  ].join("\n");
}

// ── Eligibility + scoring ──────────────────────────────────────────────────────
function needsIntervention(ctx: any, stressThreshold = 7): { reason: string; stress: number; urgency: number; value: number } | null {
  const stress   = ctx.stress_level ?? 0;
  const momentum = ctx.momentum_state ?? "steady";
  const stale    = ctx.expires_at ? new Date(ctx.expires_at) < new Date() : false;
  if (stress >= stressThreshold) return { reason: "high_stress",        stress, urgency: 0.7, value: 0.8 };
  if (momentum === "stalled")   return { reason: "stalled",             stress, urgency: 0.5, value: 0.6 };
  if (momentum === "declining") return { reason: "declining_momentum",  stress, urgency: 0.4, value: 0.6 };
  if (stale && stress >= 5)     return { reason: "stale_context",       stress, urgency: 0.4, value: 0.5 };
  return null;
}

function withinCooldown(last: any, currentStress: number): boolean {
  if (!last) return false;
  const age = Date.now() - new Date(last.sent_at ?? last.created_at).getTime();
  if (age > COOLDOWN_MS) return false;
  const prevStress = last.metadata?.stress_level ?? 0;
  return currentStress - prevStress < STRESS_ESCALATION;  // still cooling down unless stress jumped
}

// ── Main handler ──────────────────────────────────────────────────────────────
export default async function handler(req: any, res: any) {
  // Fail-closed.
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return res.status(500).json({ error: "CRON_SECRET not configured" });
  const auth = req.headers?.authorization ?? req.headers?.["x-cron-secret"];
  if (auth !== `Bearer ${cronSecret}` && auth !== cronSecret) return res.status(401).json({ error: "Unauthorized" });

  if (!BRAIN_URL || !BRAIN_KEY) return res.status(200).json({ ok: false, reason: "brain db not configured" });
  if (!FS_URL || !FS_KEY)       return res.status(200).json({ ok: false, reason: "fschool db not configured" });

  const started = Date.now();
  const results = { proposed: 0, skipped: 0, escalated: 0, errors: 0, persons: [] as any[] };

  try {
    const contexts = await brainGet("context_window?select=*,persons(id,name,fschool_user_id)&order=stress_level.desc");
    console.log(`[brain-intervention] ${contexts.length} context windows loaded`);

    for (const ctx of contexts) {
      const person = ctx.persons;
      if (!person) { results.skipped++; continue; }

      const userId = person.fschool_user_id;

      // Effectiveness feedback (§3.5.4): read this student's tuned stress threshold (default 7).
      let tuning: Tuning = { stressThreshold: 7, channelPref: null, labelCount: 0 };
      if (userId) {
        const t = await fsGet(`intervention_tuning?user_id=eq.${encodeURIComponent(userId)}&select=*`).catch(() => []);
        if (t[0]) tuning = {
          stressThreshold: t[0].stress_threshold ?? 7,
          channelPref:     t[0].channel_pref ?? null,
          labelCount:      t[0].label_count ?? 0,
        };
      }

      const trigger = needsIntervention(ctx, tuning.stressThreshold);
      if (!trigger) { results.skipped++; continue; }
      if (!userId) {
        results.skipped++;
        await brainPost("interventions", {
          person_id: person.id, trigger_reason: trigger.reason, message: null,
          channel: "none", status: "skipped_no_user",
          sent_at: new Date().toISOString(), metadata: { stress_level: trigger.stress },
        }).catch(() => {});
        continue;
      }

      try {
        // Recent intervention history (cooldown + escalation detection).
        const history: any[] = await brainGet(`interventions?person_id=eq.${person.id}&order=created_at.desc&limit=20`);
        const now = Date.now();

        // Escalation cap still active? (paused within the last 48h → suppress ALL nudges.)
        const escActive = history.some(h =>
          h.status === "escalation_pause" &&
          now - new Date(h.created_at).getTime() < ESCALATION_PAUSE_MS);
        if (escActive) { results.skipped++; continue; }

        // Don't re-escalate more than once per 3 days (prevents escalate-forever while stress stays high).
        const escalatedRecently = history.some(h =>
          h.status === "escalation_pause" &&
          now - new Date(h.created_at).getTime() < THREE_DAYS_MS);

        // Pull this student's recent delivered interventions ONCE — used for both the
        // effectiveness feedback loop (§3.5.4) and the escalation non-engagement count.
        const nq: any[] = await fsGet(
          `notification_queue?user_id=eq.${encodeURIComponent(userId)}&type=eq.intervention` +
          `&select=delivered_at,opened_at,action_taken,channel,created_at&order=created_at.desc&limit=200`
        ).catch(() => []);

        // Recompute + persist tuning from the labels (raise/lower stress threshold, learn channel).
        const tuned = computeTuning(nq, tuning, now);
        if (tuned.stressThreshold !== tuning.stressThreshold ||
            tuned.channelPref     !== tuning.channelPref ||
            tuned.labelCount      !== tuning.labelCount) {
          await fsPost("intervention_tuning", {
            user_id: userId, stress_threshold: tuned.stressThreshold,
            channel_pref: tuned.channelPref, label_count: tuned.labelCount,
            updated_at: new Date().toISOString(),
          }, true).catch(() => {});
        }

        // Escalation cap: count GENUINELY ignored interventions in the last 3 days. Reuse
        // labelOf so this honours the same 2h grace as the tuning loop — a nudge delivered
        // minutes ago that the student simply hasn't opened yet is 'pending', NOT a failure,
        // and must not trip the wellbeing escalation + 48h pause prematurely.
        const threeDaysAgo = now - THREE_DAYS_MS;
        const deliveredUnengaged = (trigger.stress >= ESCALATION_STRESS && !escalatedRecently)
          ? nq.filter(r => r.delivered_at &&
                           new Date(r.delivered_at).getTime() >= threeDaysAgo &&
                           labelOf(r as any, now) === "negative").length
          : 0;

        if (trigger.stress >= ESCALATION_STRESS && !escalatedRecently && deliveredUnengaged >= ESCALATION_COUNT) {
          await proposeProactive(userId, {
            agentSource: "intervention", type: "intervention",
            urgencyScore: 0.7, valueScore: 0.95,        // important, but < 0.95 urgency → still respects quiet hours
            title: "FschoolAI is here for you", body: composeWellbeing(person),
            channelHint: "in_app", dedupKey: "wellbeing", expiresInHours: 12,
          });
          await brainPost("interventions", {
            person_id: person.id, trigger_reason: "stress_escalation", message: composeWellbeing(person),
            channel: "in_app", status: "escalation_pause",
            sent_at: new Date().toISOString(),
            metadata: { stress_level: trigger.stress, stress_escalated: true },
          });
          results.escalated++;
          continue;
        }

        // Normal cooldown.
        if (withinCooldown(history[0] ?? null, trigger.stress)) { results.skipped++; continue; }

        // Propose a candidate to the Arbiter (channel_hint discord → also DMs if linked).
        const message = composeMessage(person, ctx);
        const outcome = await proposeProactive(userId, {
          agentSource: "intervention", type: "intervention",
          urgencyScore: trigger.urgency, valueScore: trigger.value,
          title: "A nudge from Reggie", body: message,
          channelHint: "discord",
          dedupKey: `intervention:${trigger.reason}`,
          data: { reason: trigger.reason, stress_level: trigger.stress, momentum: ctx.momentum_state },
        });

        await brainPost("interventions", {
          person_id: person.id, trigger_reason: trigger.reason, message,
          channel: "proactive_signal", status: outcome === "duplicate" ? "duplicate" : "proposed",
          sent_at: new Date().toISOString(),
          metadata: { stress_level: trigger.stress, momentum: ctx.momentum_state },
        });

        if (outcome === "error") results.errors++; else results.proposed++;
        results.persons.push({ id: person.id, name: person.name, reason: trigger.reason, stress: trigger.stress, outcome });
      } catch (err) {
        console.error(`[brain-intervention] Error for ${person.id}:`, (err as Error).message);
        results.errors++;
        await brainPost("interventions", {
          person_id: person.id, trigger_reason: trigger?.reason ?? "unknown", message: null,
          channel: "none", status: "error", sent_at: new Date().toISOString(),
          metadata: { error: (err as Error).message, stress_level: trigger?.stress },
        }).catch(() => {});
      }
    }

    const elapsed = Date.now() - started;
    console.log(`[brain-intervention] done ${elapsed}ms`, results);
    return res.status(200).json({ ok: true, elapsed_ms: elapsed, ...results });
  } catch (err) {
    console.error("[brain-intervention] Fatal:", (err as Error).message);
    return res.status(500).json({ ok: false, error: (err as Error).message });
  }
}

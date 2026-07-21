/**
 * api/brain-intervention.ts — Vercel Cron (watch → evaluate → propose), KERNEL-SOURCED.
 *
 * Runs every 30 minutes. Reads each active person's context from the NeuroAGI KERNEL
 * (derived.synthesizeContext — a pure fold over kernel signals/focuses/digest, the v2 replacement
 * for the legacy brain-scheduler → context_window synthesis), detects who needs a proactive nudge,
 * and writes a CANDIDATE to the FschoolAI Signal Arbiter (public.proactive_signals). The Arbiter
 * (api/arbiter.ts) still owns dedup / ranking / rate limits / quiet hours / delivery. The audit +
 * cooldown/escalation history now lives as kernel `intervention` memories (no legacy Brain DB).
 *
 * Trigger (stress 0–10, from synthesizeContext): stress >= threshold (default 7) · momentum
 * stalled/declining. Escalation cap (§8): 3+ recent very-high (>=9) interventions the student keeps
 * ignoring → ONE supportive wellbeing message + pause stress nudges 48h. Cooldown 4h unless stress
 * rose >= 2. Effectiveness tuning (intervention_tuning) + re-engagement pass are product-side, unchanged.
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_KEY (product: arbiter/tuning/users/neuro_person_link),
 *      NEURO_SUPABASE_* (kernel memory; falls back to product via brainConn), CRON_SECRET (fail-closed).
 *      Optional: CAMPUS_WELLBEING_URL.
 */
import { proposeProactive } from "./_notify.js";
import { computeTuning, labelOf, type Tuning } from "./_tuning.js";
import { brainConn } from "./_brain/conn.js";
import { postgrestStore, recall, remember } from "./_brain/kernel.js";
import { synthesizeContext, type BrainContext } from "./_brain/derived.js";

const FS_URL = process.env.SUPABASE_URL;
const FS_KEY = process.env.SUPABASE_SERVICE_KEY;

const COOLDOWN_MS         = 4 * 60 * 60 * 1000;
const STRESS_ESCALATION   = 2;
const ESCALATION_STRESS   = 9;
const ESCALATION_COUNT    = 3;
const ESCALATION_PAUSE_MS = 48 * 60 * 60 * 1000;
const THREE_DAYS_MS       = 3 * 24 * 60 * 60 * 1000;
const WEEK1_MS            = 14 * 24 * 60 * 60 * 1000;
const RE_ENGAGE_IDLE_MS   = 5 * 24 * 60 * 60 * 1000;
const ACTIVE_WINDOW_MS    = 7 * 24 * 60 * 60 * 1000;   // only synthesize persons with a signal this recent

// ── FschoolAI (product) DB helpers — arbiter tables, tuning, users, neuro_person_link ─────────────
const fsHeaders = { apikey: FS_KEY, Authorization: `Bearer ${FS_KEY}`, "Content-Type": "application/json" };
async function fsGet(path: string): Promise<any[]> {
  const res = await fetch(`${FS_URL}/rest/v1/${path}`, { headers: fsHeaders as any });
  if (!res.ok) throw new Error(`FS GET ${path} ${res.status}: ${await res.text().catch(() => "")}`);
  return res.json();
}
async function fsPost(path: string, body: unknown, upsert = false): Promise<void> {
  const res = await fetch(`${FS_URL}/rest/v1/${path}`, {
    method: "POST",
    headers: { ...fsHeaders, Prefer: upsert ? "resolution=merge-duplicates,return=minimal" : "return=minimal" } as any,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`FS POST ${path} ${res.status}: ${await res.text().catch(() => "")}`);
}

// ── Message composers (from the kernel-synthesized context) ───────────────────────────────────────
function composeMessage(name: string, ctx: BrainContext): string {
  const opening = ctx.stressLevel >= 8 ? `Hey ${name} 👋 — I can see you're under a lot of pressure right now.`
    : ctx.stressLevel >= 7 ? `Hey ${name} — looks like things are getting a bit intense.`
    : ctx.momentum === "stalled" ? `Hey ${name} — I noticed you've been a bit stuck lately.`
    : `Hey ${name} — your momentum has been dipping a little.`;
  const lines = [opening];
  if (ctx.recentSummary) lines.push(`📊 ${String(ctx.recentSummary).slice(0, 240)}`);
  if (ctx.focus)         lines.push(`🎯 ${ctx.focus}`);
  lines.push("", "I'm here whenever you're ready to work through it. You've got this! 💪", "_— Reggie, your academic brain_");
  return lines.join("\n");
}
function composeWellbeing(name: string): string {
  const link = process.env.CAMPUS_WELLBEING_URL || "your campus health & wellness services";
  return [
    `Hey ${name} — it looks like this has been a heavy stretch.`,
    `FschoolAI will be here whenever you're ready, no pressure at all.`,
    `If it would help to talk to someone, ${link} is there for you.`,
    `Take care of yourself first. 💛`, `_— Reggie_`,
  ].join("\n");
}
function composeReEngagement(name: string): string {
  return [
    `Hey ${name} 👋 — it's been a few days since we've seen you.`,
    `No pressure at all — whenever you're ready, I'll pick up right where we left off.`, `_— Reggie_`,
  ].join("\n");
}

// ── Eligibility ───────────────────────────────────────────────────────────────────────────────────
function needsIntervention(ctx: BrainContext, stressThreshold = 7): { reason: string; urgency: number; value: number } | null {
  if (ctx.stressLevel >= stressThreshold) return { reason: "high_stress",       urgency: 0.7, value: 0.8 };
  if (ctx.momentum === "stalled")         return { reason: "stalled",           urgency: 0.5, value: 0.6 };
  if (ctx.momentum === "declining")       return { reason: "declining_momentum", urgency: 0.4, value: 0.6 };
  return null;
}
function withinCooldown(last: any, currentStress: number): boolean {
  if (!last) return false;
  const age = Date.now() - Date.parse(last.last_seen_at ?? last.created_at);
  if (age > COOLDOWN_MS) return false;
  return currentStress - (last.body?.stress_level ?? 0) < STRESS_ESCALATION;
}

// ── Main handler ────────────────────────────────────────────────────────────────────────────────
export default async function handler(req: any, res: any) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return res.status(500).json({ error: "CRON_SECRET not configured" });
  const auth = req.headers?.authorization ?? req.headers?.["x-cron-secret"];
  if (auth !== `Bearer ${cronSecret}` && auth !== cronSecret) return res.status(401).json({ error: "Unauthorized" });
  if (!FS_URL || !FS_KEY) return res.status(200).json({ ok: false, reason: "fschool db not configured" });
  const bc = brainConn();
  if (!bc) return res.status(200).json({ ok: false, reason: "kernel store not configured" });
  const store = postgrestStore(bc.url, bc.key);

  const started = Date.now();
  const results = { proposed: 0, skipped: 0, escalated: 0, errors: 0, reEngaged: 0 };

  try {
    // Active persons: subjects with a kernel signal in the last 7d, mapped to FschoolAI user ids via
    // neuro_person_link (product). Pre-filtering by recent kernel activity keeps this O(active), not O(all).
    const activeRes = await fetch(
      `${bc.url}/rest/v1/neuro_memory?kind=eq.signal&last_seen_at=gte.${new Date(started - ACTIVE_WINDOW_MS).toISOString()}&select=subject&limit=5000`,
      { headers: { apikey: bc.key, Authorization: `Bearer ${bc.key}` } as any },
    );
    const activeSubjects = new Set<string>((activeRes.ok ? await activeRes.json() : []).map((r: any) => r.subject));
    const links = await fsGet(`neuro_person_link?product=eq.fschoolai&select=person_id,local_id&limit=5000`).catch(() => []);
    const targets = links.filter((l: any) => activeSubjects.has(`person:${l.person_id}`));
    console.log(`[brain-intervention] ${targets.length} active persons (of ${links.length} linked)`);

    for (const link of targets) {
      const userId: string = link.local_id;
      const subject = `person:${link.person_id}`;
      try {
        const ctx = await synthesizeContext(store, subject, started);

        // Tuned stress threshold (default 7).
        let tuning: Tuning = { stressThreshold: 7, channelPref: null, labelCount: 0 };
        const t = await fsGet(`intervention_tuning?user_id=eq.${encodeURIComponent(userId)}&select=*`).catch(() => []);
        if (t[0]) tuning = { stressThreshold: t[0].stress_threshold ?? 7, channelPref: t[0].channel_pref ?? null, labelCount: t[0].label_count ?? 0 };

        const trigger = needsIntervention(ctx, tuning.stressThreshold);
        if (!trigger) { results.skipped++; continue; }

        // Person name + Week-1 delight guard (skip stress nudges for accounts < 14d old).
        const uRows = await fsGet(`users?id=eq.${encodeURIComponent(userId)}&select=name,email_verify_sent_at`).catch(() => []);
        const name = uRows[0]?.name ?? "there";
        if (trigger.reason === "high_stress") {
          const created = uRows[0]?.email_verify_sent_at ? Date.parse(uRows[0].email_verify_sent_at) : 0;
          if (created && Date.now() - created <= WEEK1_MS) { results.skipped++; continue; }
        }

        // Intervention history (kernel `intervention` memories) — cooldown + escalation.
        const history = await recall(store, [subject], { kind: "intervention", limit: 20, reinforce: false, now: started });
        const now = Date.now();
        const escActive = history.some((h) => h.body?.status === "escalation_pause" && now - Date.parse(h.last_seen_at) < ESCALATION_PAUSE_MS);
        if (escActive) { results.skipped++; continue; }
        const escalatedRecently = history.some((h) => h.body?.status === "escalation_pause" && now - Date.parse(h.last_seen_at) < THREE_DAYS_MS);

        // Delivered interventions (product notification_queue) — tuning + escalation non-engagement count.
        const nq = await fsGet(
          `notification_queue?user_id=eq.${encodeURIComponent(userId)}&type=eq.intervention&select=delivered_at,opened_at,action_taken,channel,created_at&order=created_at.desc&limit=200`,
        ).catch(() => []);
        const tuned = computeTuning(nq, tuning, now);
        if (tuned.stressThreshold !== tuning.stressThreshold || tuned.channelPref !== tuning.channelPref || tuned.labelCount !== tuning.labelCount) {
          await fsPost("intervention_tuning", { user_id: userId, stress_threshold: tuned.stressThreshold, channel_pref: tuned.channelPref, label_count: tuned.labelCount, updated_at: new Date().toISOString() }, true).catch(() => {});
        }

        // Escalation cap: count genuinely-ignored interventions in the last 3 days (labelOf honours the 2h grace).
        const threeDaysAgo = now - THREE_DAYS_MS;
        const deliveredUnengaged = (ctx.stressLevel >= ESCALATION_STRESS && !escalatedRecently)
          ? nq.filter((r: any) => r.delivered_at && Date.parse(r.delivered_at) >= threeDaysAgo && labelOf(r as any, now) === "negative").length : 0;

        if (ctx.stressLevel >= ESCALATION_STRESS && !escalatedRecently && deliveredUnengaged >= ESCALATION_COUNT) {
          await proposeProactive(userId, {
            agentSource: "intervention", type: "intervention", urgencyScore: 0.7, valueScore: 0.95,
            title: "FschoolAI is here for you", body: composeWellbeing(name),
            channelHint: "in_app", dedupKey: "wellbeing", expiresInHours: 12,
          });
          await remember(store, { subject, kind: "intervention", source: "intervention", salience: 0.8, body: { trigger_reason: "stress_escalation", status: "escalation_pause", stress_level: ctx.stressLevel } }, now);
          results.escalated++;
          continue;
        }

        if (withinCooldown(history[0] ?? null, ctx.stressLevel)) { results.skipped++; continue; }

        const message = composeMessage(name, ctx);
        const outcome = await proposeProactive(userId, {
          agentSource: "intervention", type: "intervention", urgencyScore: trigger.urgency, valueScore: trigger.value,
          title: "A nudge from Reggie", body: message, channelHint: "discord",
          dedupKey: `intervention:${trigger.reason}`, data: { reason: trigger.reason, stress_level: ctx.stressLevel, momentum: ctx.momentum },
        });
        await remember(store, { subject, kind: "intervention", source: "intervention", salience: 0.6, body: { trigger_reason: trigger.reason, status: outcome === "duplicate" ? "duplicate" : "proposed", stress_level: ctx.stressLevel, momentum: ctx.momentum } }, now);
        if (outcome === "error") results.errors++; else results.proposed++;
      } catch (err) {
        console.error(`[brain-intervention] error for ${subject}:`, (err as Error).message);
        results.errors++;
      }
    }

    // ── Re-engagement pass (product users, unchanged): established (>14d) accounts gone quiet 5+ days ──
    try {
      const cutoffCreated = new Date(started - WEEK1_MS).toISOString();
      const idleCutoff = new Date(started - RE_ENGAGE_IDLE_MS).toISOString();
      const quiet = await fsGet(
        `users?select=id,name,email_verify_sent_at,last_active_date&email_verify_sent_at=lte.${encodeURIComponent(cutoffCreated)}` +
        `&or=(last_active_date.is.null,last_active_date.lt.${encodeURIComponent(idleCutoff.slice(0, 10))})`,
      ).catch(() => []);
      for (const u of quiet) {
        const outcome = await proposeProactive(u.id, {
          agentSource: "cohort", type: "re_engagement", urgencyScore: 0.15, valueScore: 0.4,
          title: "We miss you", body: composeReEngagement(u.name ?? "there"), channelHint: "in_app", dedupKey: "re_engagement", expiresInHours: 24,
        });
        if (outcome === "created") results.reEngaged++;
      }
    } catch (err) { console.error("[brain-intervention] re-engagement pass failed:", (err as Error).message); }

    const elapsed = Date.now() - started;
    console.log(`[brain-intervention] done ${elapsed}ms`, results);
    return res.status(200).json({ ok: true, elapsed_ms: elapsed, ...results });
  } catch (err) {
    console.error("[brain-intervention] fatal:", (err as Error).message);
    return res.status(500).json({ ok: false, error: (err as Error).message });
  }
}

/**
 * brain-scheduler-fast.js — Tier 1 Brain Scheduler (every 5 minutes)
 *
 * Lightweight signal aggregator — no Claude call, pure math.
 * Reads the last few signals per student and fast-ESCALATES the 0–10 stress_level
 * in brain.context_window for near-real-time intervention detection (Tier 2 owns the
 * full recompute + de-escalation).
 *
 * Vercel Cron: runs every 5 minutes (see vercel.json)
 * Protected by CRON_SECRET header.
 *
 * Two-tier architecture:
 *   Tier 1 (this file)  — every 5 min — fast math update, no LLM
 *   Tier 2 (brain-scheduler.js) — every hour — full Claude synthesis
 */

import { createClient } from "@supabase/supabase-js";

// Supabase clients are ASSIGNED inside the handler, never constructed at module load. Constructing
// a client with an undefined URL throws "supabaseUrl is required" synchronously — as a module-load
// `const` that crashed this */5 cron with a 500 on EVERY invocation whenever BRAIN_SUPABASE_* was
// unset (the prod reality). These stay module-scoped (the helper below reads `brain`) but are only
// built after a guard, turning the unconfigured case into a clean no-op like the sibling endpoints.
let fschool: any = null;
let brain: any = null;

export default async function handler(req, res) {
  // Auth check — FAIL CLOSED: reject if CRON_SECRET is missing or wrong.
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return res.status(500).json({ error: "CRON_SECRET not configured" });
  const auth = req.headers.authorization ?? req.headers["x-cron-secret"] ?? req.query.secret;
  if (auth !== `Bearer ${cronSecret}` && auth !== cronSecret) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // Graceful no-op if env is missing — never crash the cron at construction time.
  const brainUrl = process.env.BRAIN_SUPABASE_URL, brainKey = process.env.BRAIN_SUPABASE_KEY;
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) return res.status(200).json({ ok: false, reason: "missing fschool env" });
  if (!brainUrl || !brainKey) return res.status(200).json({ ok: false, reason: "brain db not configured" });
  fschool = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  brain = createClient(brainUrl, brainKey, { db: { schema: "brain" } });

  const startTime = Date.now();

  try {
    // Watermark: only students with a NEW brain signal in the last cadence window get
    // processed. The old version looped EVERY linked user (1 + 3N queries per 5-min run
    // ≈ 112k queries/day at 130 users) even for students idle for weeks. One signals
    // query now finds the active set; a quiet run costs exactly 1 query.
    const since = new Date(Date.now() - 6 * 60 * 1000).toISOString(); // 5-min cadence + slack
    const { data: recent, error: sigErr } = await brain
      .from("signals")
      .select("person_id")
      .gte("created_at", since)
      .limit(1000);
    if (sigErr) throw sigErr;

    const activePersonIds = [...new Set((recent ?? []).map(r => r.person_id).filter(Boolean))];
    if (!activePersonIds.length) {
      return res.status(200).json({ message: "No active students this window", processed: 0 });
    }

    let updated = 0;
    const errors = [];

    for (const personId of activePersonIds) {
      try {
        await updateStudentFastSignals(null, personId);
        updated++;
      } catch (e) {
        errors.push({ personId, error: e.message });
      }
    }

    const elapsed = Date.now() - startTime;
    console.log(`[brain-scheduler-fast] Updated ${updated}/${activePersonIds.length} active students in ${elapsed}ms`);

    return res.status(200).json({
      tier: 1,
      processed: updated,
      errors: errors.length,
      elapsed_ms: elapsed,
    });
  } catch (e) {
    console.error("[brain-scheduler-fast] Fatal error:", e.message);
    return res.status(500).json({ error: e.message });
  }
}

/**
 * Update a single student's 0–10 stress_level from their recent signals (escalate-only).
 * Pure math — no LLM call.
 */
async function updateStudentFastSignals(userId, brainPersonId) {
  // Last few signals from the Brain DB.
  const { data: signals, error } = await brain
    .from("signals")
    .select("signal_type, payload, created_at")
    .eq("person_id", brainPersonId)
    .order("created_at", { ascending: false })
    .limit(8);

  if (error || !signals || signals.length === 0) return;

  // ── Stress: 0–10 (matches brain-scheduler + brain-intervention's >=7 threshold) ──
  // Read the signals producers ACTUALLY emit: NeuralRing writes signal_type 'behavioral'
  // with payload.emotional_tone; session-close writes 'academic' with payload.score/event.
  // (The old code keyed on 'chat_message'/'session_end' — which nothing produces — and wrote
  // metadata.stress_score on a 0–100 scale no reader consumes, so this whole tier was dead.)
  let stress = 0;
  for (const sig of signals) {
    const p = sig.payload || {};
    if (p.emotional_tone === "stressed")  stress += 3;
    if (p.emotional_tone === "confident") stress -= 1;
    const hour = p.hour_of_day ?? new Date(sig.created_at).getHours();
    if (hour >= 23 || hour <= 4)          stress += 1;                // late-night work
    if (typeof p.score === "number" && p.score < 60) stress += 3;     // recent low score
  }
  stress = Math.max(0, Math.min(10, stress));

  // Latest context_window row for this person.
  const { data: existing } = await brain
    .from("context_window")
    .select("id, stress_level, metadata")
    .eq("person_id", brainPersonId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Fast path only ESCALATES stress between the hourly Tier-2 syntheses — it never drags the
  // richer Tier-2 value down (Tier-2 owns the full recompute, de-escalation, and momentum).
  const nextStress = Math.max(existing?.stress_level ?? 0, stress);
  const meta = { ...(existing?.metadata || {}), fast_stress: stress, fast_updated_at: new Date().toISOString() };

  if (existing) {
    // Skip the write when it wouldn't change the acted-on value — the unconditional
    // UPDATE used to rewrite every student's row 288×/day for nothing.
    if (nextStress === (existing.stress_level ?? 0)) return;
    await brain.from("context_window").update({ stress_level: nextStress, metadata: meta }).eq("id", existing.id);
  } else {
    // No context_window yet — create a minimal valid one (recent_summary is the real
    // column; the old insert wrote a non-existent `summary`).
    await brain.from("context_window").insert({
      person_id:      brainPersonId,
      stress_level:   stress,
      recent_summary: "Initializing…",
      metadata:       meta,
      created_at:     new Date().toISOString(),
    });
  }
}

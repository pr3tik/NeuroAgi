// api/brain-scheduler.js — Vercel Cron endpoint for NeuroAGI Brain Scheduler
//
// SCHEDULE: Every hour (see vercel.json)
// PURPOSE:  Reads brain.signals for all active students → synthesises context_window
//           This is the engine that makes the brain "alive" between sessions.
//
// DEPLOYMENT NOTE:
//   This file lives in FschoolAI's Vercel project because that's where the
//   cron infrastructure is. The logic reads/writes to the NeuroAGI Brain DB.
//   The NeuroAGI repo has the full scheduler in src/brain/brain-scheduler.js
//   for standalone deployment (Railway/Render/GitHub Actions).
//
// ENV VARS:
//   BRAIN_SUPABASE_URL  — NeuroAGI Brain DB URL
//   BRAIN_SUPABASE_KEY  — Brain DB service_role key
//   ANTHROPIC_API_KEY   — Claude Haiku for synthesis
//   CRON_SECRET         — REQUIRED: reject all requests without it (fail-closed)

const BRAIN_URL = process.env.BRAIN_SUPABASE_URL;
const BRAIN_KEY = process.env.BRAIN_SUPABASE_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

// neuro schema: persons table
const neuroHeaders = {
  apikey:           BRAIN_KEY,
  Authorization:    `Bearer ${BRAIN_KEY}`,
  "Content-Type":   "application/json",
  "Accept-Profile": "neuro",
};
// brain schema: signals, context_window tables
const brainHeaders = {
  apikey:           BRAIN_KEY,
  Authorization:    `Bearer ${BRAIN_KEY}`,
  "Content-Type":   "application/json",
  "Accept-Profile": "brain",
};

// ── Fetch helpers ─────────────────────────────────────────────────────────────

async function fetchPersons() {
  // Watermark: only persons with a NEW signal since the last hourly run (65min slack).
  // The old version pulled ALL persons and re-synthesized anyone with any signal in the
  // trailing 24h — so a single chat message bought 24 hourly Claude syntheses and 24
  // context_window rows. Now: no new activity → no reads, no LLM call, no write.
  const since = new Date(Date.now() - 65 * 60 * 1000).toISOString();
  const sigRes = await fetch(
    `${BRAIN_URL}/rest/v1/signals?created_at=gte.${since}&select=person_id&limit=2000`,
    { headers: brainHeaders }
  );
  if (!sigRes.ok) throw new Error(`fetchActiveSignals ${sigRes.status}`);
  const ids = [...new Set(((await sigRes.json()) ?? []).map(s => s.person_id).filter(Boolean))];
  if (!ids.length) return [];

  const res = await fetch(
    `${BRAIN_URL}/rest/v1/persons?id=in.(${ids.join(",")})&select=id,name,email,source&limit=200`,
    { headers: neuroHeaders }
  );
  if (!res.ok) throw new Error(`fetchPersons ${res.status}`);
  return res.json();
}

async function fetchRecentSignals(personId) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const res = await fetch(
    `${BRAIN_URL}/rest/v1/signals?person_id=eq.${personId}&created_at=gte.${since}&select=signal_type,source,payload,created_at&order=created_at.desc&limit=50`,
    { headers: brainHeaders }
  );
  if (!res.ok) return [];
  return res.json();
}

async function fetchUpcomingAssignments(personId) {
  const now     = new Date().toISOString();
  const weekOut = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const res = await fetch(
    `${BRAIN_URL}/rest/v1/fschool_assignments?person_id=eq.${personId}&due_at=gte.${now}&due_at=lte.${weekOut}&select=title,due_at,missing,score,points_possible&order=due_at.asc&limit=10`,
    { headers: brainHeaders }
  );
  if (!res.ok) return [];
  return res.json();
}

async function fetchExistingContext(personId) {
  const res = await fetch(
    `${BRAIN_URL}/rest/v1/context_window?person_id=eq.${personId}&select=computed_at,stress_level&limit=1`,
    { headers: brainHeaders }
  );
  if (!res.ok) return null;
  const rows = await res.json();
  return rows?.[0] ?? null;
}

// ── Rule-based synthesis (no LLM — fast, free, always available) ─────────────

function ruleBasedSynthesis(signals, assignments) {
  const stressSignals = signals.filter(s => s.payload?.emotional_tone === "stressed").length;
  const missingCount  = assignments.filter(a => a.missing).length;
  const urgentCount   = assignments.filter(a => {
    const h = (+new Date(a.due_at) - Date.now()) / (1000 * 60 * 60);
    return h < 48;
  }).length;

  const stressLevel = Math.min(10, stressSignals * 2 + missingCount * 3 + urgentCount * 2);
  const recentMsgs  = signals.filter(s => s.source === "fschoolai_chat").length;
  const momentum    = recentMsgs >= 10 ? "building" : recentMsgs >= 5 ? "steady" : recentMsgs >= 1 ? "declining" : "stalled";

  const nextDeadline   = assignments[0];
  const activeDeadline = nextDeadline
    ? `${nextDeadline.title} — ${Math.round((+new Date(nextDeadline.due_at) - Date.now()) / (1000 * 60 * 60))}h`
    : null;

  const hours = signals.filter(s => s.payload?.hour_of_day != null).map(s => s.payload.hour_of_day);
  const avgHour = hours.length ? hours.reduce((a, b) => a + b, 0) / hours.length : null;
  const studyPattern = avgHour === null ? "unknown" : avgHour < 10 ? "morning_person" : avgHour < 20 ? "afternoon" : "night_owl";

  return {
    stress_level:        stressLevel,
    momentum_state:      momentum,
    active_deadline:     activeDeadline,
    recent_summary:      `${recentMsgs} chat interactions in last 24h. ${missingCount > 0 ? `${missingCount} missing assignment(s).` : "No missing assignments."}`,
    what_to_focus_on:    nextDeadline ? `Help with: ${nextDeadline.title}` : "General study support",
    what_not_to_mention: null,
    knowledge_gaps:      [],
    study_pattern:       studyPattern,
  };
}

// ── Claude synthesis (when ANTHROPIC_API_KEY is set) ─────────────────────────

async function claudeSynthesis(person, signals, assignments, existingContext) {
  const signalSummary = signals.length
    ? signals.slice(0, 20).map(s =>
        `[${new Date(s.created_at).toLocaleTimeString()}] ${s.signal_type}/${s.source}: ${JSON.stringify(s.payload)}`
      ).join("\n")
    : "No signals in last 24h.";

  const assignmentSummary = assignments.length
    ? assignments.map(a => {
        const h = Math.round((+new Date(a.due_at) - Date.now()) / (1000 * 60 * 60));
        return `- ${a.title}: due in ${h}h${a.missing ? " (MISSING)" : ""}`;
      }).join("\n")
    : "No upcoming assignments.";

  const body = {
    model:      "claude-haiku-4-5",
    max_tokens: 400,
    messages: [{
      role:    "user",
      content: `You are the NeuroAGI Brain Scheduler. Synthesise this student's signals into a JSON context window for their AI tutor.

Student: ${person.name ?? "Unknown"}

RECENT SIGNALS (24h):
${signalSummary}

UPCOMING ASSIGNMENTS:
${assignmentSummary}

Return ONLY a JSON object with these exact fields:
{
  "stress_level": <0-10>,
  "momentum_state": <"building"|"steady"|"declining"|"stalled">,
  "active_deadline": <"assignment name — Xh" or null>,
  "recent_summary": <1-2 sentences>,
  "what_to_focus_on": <1 sentence>,
  "what_not_to_mention": <1 sentence or null>,
  "knowledge_gaps": <array of up to 3 topic strings>,
  "study_pattern": <"morning_person"|"night_owl"|"afternoon"|"irregular"|"unknown">
}`,
    }],
  };

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method:  "POST",
    headers: {
      "x-api-key":         ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
      "Content-Type":      "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(`Claude API ${res.status}`);
  const data = await res.json();
  const text = data.content?.[0]?.text ?? "";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("No JSON in Claude response");
  return JSON.parse(jsonMatch[0]);
}

// ── Write context_window ──────────────────────────────────────────────────────

async function writeContextWindow(personId, context) {
  const row = {
    person_id:           personId,
    stress_level:        context.stress_level,
    momentum_state:      context.momentum_state,
    active_deadline:     context.active_deadline,
    recent_summary:      context.recent_summary,
    what_to_focus_on:    context.what_to_focus_on,
    what_not_to_mention: context.what_not_to_mention,
    knowledge_gaps:      context.knowledge_gaps,
    study_pattern:       context.study_pattern,
    computed_at:         new Date().toISOString(),
    expires_at:          new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
  };

  const res = await fetch(`${BRAIN_URL}/rest/v1/context_window`, {
    method:  "POST",
    headers: { ...brainHeaders, Prefer: "resolution=merge-duplicates,return=minimal" },
    body:    JSON.stringify(row),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`context_window write failed: ${err}`);
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  // Auth check — FAIL CLOSED: reject if CRON_SECRET is missing or wrong.
  // This cron calls Claude (cost) — must never be publicly triggerable.
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return res.status(500).json({ error: "CRON_SECRET not configured" });
  const auth = req.headers.authorization ?? req.headers["x-cron-secret"];
  if (auth !== `Bearer ${cronSecret}` && auth !== cronSecret) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (!BRAIN_URL || !BRAIN_KEY) {
    return res.status(200).json({ ok: false, reason: "brain db not configured" });
  }

  const startTime = Date.now();
  const results   = { processed: 0, skipped: 0, errors: 0, persons: [] };

  try {
    const persons = await fetchPersons();
    console.log(`[brain-scheduler] ${persons.length} persons to process`);

    for (const person of persons) {
      try {
        const [signals, assignments, existingCtx] = await Promise.all([
          fetchRecentSignals(person.id),
          fetchUpcomingAssignments(person.id),
          fetchExistingContext(person.id),
        ]);

        // Skip if context is fresh (< 2h) and no new signals
        if (signals.length === 0 && existingCtx) {
          const age = Date.now() - new Date(existingCtx.computed_at).getTime();
          if (age < 2 * 60 * 60 * 1000) {
            results.skipped++;
            continue;
          }
        }

        // Synthesise — use Claude if available, else rule-based
        let context;
        if (ANTHROPIC_KEY) {
          context = await claudeSynthesis(person, signals, assignments, existingCtx).catch(() =>
            ruleBasedSynthesis(signals, assignments)
          );
        } else {
          context = ruleBasedSynthesis(signals, assignments);
        }

        await writeContextWindow(person.id, context);

        results.processed++;
        results.persons.push({
          id:       person.id,
          name:     person.name,
          stress:   context.stress_level,
          momentum: context.momentum_state,
          signals:  signals.length,
        });

        console.log(`[brain-scheduler] ✓ ${person.name ?? person.id} stress=${context.stress_level} momentum=${context.momentum_state} signals=${signals.length}`);

        // Rate limit
        await new Promise(r => setTimeout(r, 150));

      } catch (err) {
        console.error(`[brain-scheduler] Error for ${person.id}:`, err.message);
        results.errors++;
      }
    }

    const elapsed = Date.now() - startTime;
    console.log(`[brain-scheduler] Done in ${elapsed}ms. Processed: ${results.processed}, Skipped: ${results.skipped}, Errors: ${results.errors}`);

    return res.status(200).json({ ok: true, elapsed_ms: elapsed, ...results });

  } catch (err) {
    console.error("[brain-scheduler] Fatal:", err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

// api/monitor-agent.js — Proactive tutor monitor for Assignment page
//
// FIRES:  when student lands on Assignment page (polled once on mount)
// READS:  assignment context passed by client + tutor_mind + tutor_impressions
// WRITES: nothing — read-only, returns a nudge string
// NEVER:  block UI — client shows nudge non-intrusively
//
// NUDGE LOGIC:
//   - If assignment is due within 24h and not submitted → urgency nudge
//   - If assignment is overdue → recovery nudge
//   - If assignment has low score + similar topic in impressions → targeted help
//   - If student has avoidance pattern in living mind → gentle call-out
//   - Returns null if no meaningful nudge to give (don't spam)

import { requireUserOr401 } from "./_auth.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const supabaseUrl  = process.env.SUPABASE_URL;
  const supabaseKey  = process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_ANON_KEY;

  if (!anthropicKey || !supabaseUrl || !supabaseKey) {
    return res.status(200).json({ nudge: null, reason: "missing env" });
  }

  const _uid = await requireUserOr401(req, res); if (!_uid) return;
  const { assignment, userData } = req.body ?? {};
  const userId = _uid;
  if (!assignment) return res.status(200).json({ nudge: null, reason: "missing fields" });

  const sbHeaders = {
    "apikey":        supabaseKey,
    "Authorization": `Bearer ${supabaseKey}`,
    "Content-Type":  "application/json",
    "Accept-Profile":  "public",   // app data lives in the `neuroagi` schema,
    "Content-Profile": "public",   // not public.* (that's Vincent's)
  };

  // ── 1. Load living mind + impressions ──────────────────────────────────────
  let livingMind   = null;
  let impressions  = [];

  try {
    const [mindRes, impRes] = await Promise.all([
      fetch(`${supabaseUrl}/rest/v1/tutor_mind?user_id=eq.${userId}&select=mind_doc`, { headers: sbHeaders }),
      fetch(`${supabaseUrl}/rest/v1/tutor_impressions?user_id=eq.${userId}&order=created_at.desc&limit=5&select=impression`, { headers: sbHeaders }),
    ]);
    if (mindRes.ok) {
      const rows = await mindRes.json();
      livingMind = rows?.[0]?.mind_doc ?? null;
    }
    if (impRes.ok) impressions = await impRes.json();
  } catch { /* non-fatal */ }

  // ── 2. Compute urgency context ──────────────────────────────────────────────
  const now      = Date.now();
  const dueMs    = assignment.dueAt ? new Date(assignment.dueAt).getTime() : null;
  const hoursLeft = dueMs ? Math.round((dueMs - now) / 3600000) : null;
  const isOverdue = dueMs && dueMs < now;
  const isUrgent  = hoursLeft !== null && hoursLeft >= 0 && hoursLeft <= 24;
  const submitted = !!assignment.submittedAt;

  // Don't nudge on already-submitted assignments
  if (submitted) return res.status(200).json({ nudge: null, reason: "already submitted" });

  const impressionList = impressions.map(i => `• ${i.impression}`).join("\n") || "None";

  const assignmentContext = [
    `Assignment: ${assignment.title ?? "Unknown"}`,
    assignment.courseName ? `Course: ${assignment.courseName}` : null,
    assignment.pointsPossible ? `Points: ${assignment.pointsPossible}` : null,
    isOverdue  ? `Status: OVERDUE` : null,
    isUrgent   ? `Due in: ${hoursLeft}h` : null,
    !isOverdue && !isUrgent && dueMs ? `Due: ${new Date(dueMs).toLocaleDateString()}` : null,
    assignment.description ? `Description (truncated): ${assignment.description.slice(0, 200)}` : null,
  ].filter(Boolean).join("\n");

  const prompt = `You are a proactive AI academic tutor. A student just opened this assignment page. Based on everything you know about them, decide if there's a useful nudge to give — and if so, write it.

ASSIGNMENT:
${assignmentContext}

STUDENT:
${userData?.name ? `Name: ${userData.name}` : ""}
${userData?.gpa ? `GPA: ${userData.gpa}` : ""}

LIVING MIND (what you know about this student):
${livingMind ?? "No living mind yet — first session."}

RECENT OBSERVATIONS:
${impressionList}

DECISION RULES:
- If overdue: give a no-nonsense recovery nudge (1 sentence, no lecture)
- If due within 6h: give urgency nudge, offer to help start
- If due within 24h: give a gentle heads-up, offer specific help
- If you see an avoidance pattern in living mind matching this topic: call it out briefly
- If assignment looks straightforward and nothing is urgent: return exactly the string NULL
- Never be preachy. Be direct, specific, like a tutor who actually knows them.

Return either:
1. A 1-2 sentence nudge (plain text, no formatting)
2. The exact string NULL if no nudge is warranted`;

  try {
    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method:  "POST",
      headers: {
        "Content-Type":      "application/json",
        "x-api-key":         anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model:      "claude-haiku-4-5-20251001",
        max_tokens: 100,
        messages:   [{ role: "user", content: prompt }],
      }),
    });

    if (!claudeRes.ok) return res.status(200).json({ nudge: null, reason: "claude error" });
    const data   = await claudeRes.json();
    const text   = data.content?.[0]?.text?.trim() ?? "";
    const nudge  = (text === "NULL" || text === "" || text.toUpperCase() === "NULL") ? null : text;
    return res.status(200).json({ nudge });

  } catch (err) {
    console.error("[monitor-agent] error:", err.message);
    return res.status(200).json({ nudge: null, reason: err.message });
  }
}

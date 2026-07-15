// api/tutor-impression.js — Non-blocking impression writer
// Fires after each NeuralRing exchange. Uses Claude Haiku to write one
// observation about the student in the tutor's voice, then upserts it
// to the tutor_impressions table (last 10 load into every session).
//
// ARCHITECTURE CONTRACT (from Reggie):
//   READS:  nothing
//   WRITES: tutor_impressions table (one row per exchange)
//   NEVER:  modify users/courses/assignments tables
//   NEVER:  block the tutor response — caller fires and forgets

import { requireUserOr401 } from "./_auth.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const supabaseUrl  = process.env.SUPABASE_URL;
  const supabaseKey  = process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_ANON_KEY;

  // Fail silently — never block the tutor
  if (!anthropicKey || !supabaseUrl || !supabaseKey) {
    return res.status(200).json({ ok: false, reason: "missing env" });
  }

  const _uid = await requireUserOr401(req, res); if (!_uid) return;
  const { userMessage, tutorResponse } = req.body ?? {};
  const userId = _uid;
  if (!userMessage || !tutorResponse) {
    return res.status(200).json({ ok: false, reason: "missing fields" });
  }

  // Skip very short messages — not substantive enough to observe
  if (userMessage.trim().length < 20) {
    return res.status(200).json({ ok: false, reason: "too short" });
  }

  const prompt = `You are an AI academic tutor. After this exchange with your student, write ONE brief observation about them — not a summary of what was said, but what you noticed.

Student said: "${userMessage}"
You responded: "${tutorResponse.slice(0, 300)}"

Write an observation in first person (e.g. "He avoided the follow-up question about deadlines — avoidance pattern." or "She's asking for confirmation, not help — she already knows the answer.").

RULES:
- Extract facts ONLY from what the student said, not from your response
- One sentence, max 25 words
- No filler phrases like "The student..." — write in a direct, perceptive voice
- Return ONLY the observation, nothing else`;

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
        max_tokens: 80,
        messages:   [{ role: "user", content: prompt }],
      }),
    });

    if (!claudeRes.ok) return res.status(200).json({ ok: false, reason: "claude error" });

    const data       = await claudeRes.json();
    const impression = data.content?.[0]?.text?.trim();
    if (!impression) return res.status(200).json({ ok: false, reason: "empty impression" });

    // Upsert to tutor_impressions — create table if it doesn't exist yet via insert
    const sbHeaders = {
      "apikey":        supabaseKey,
      "Authorization": `Bearer ${supabaseKey}`,
      "Content-Type":  "application/json",
      "Prefer":        "return=minimal",
      "Accept-Profile":  "public",   // app data lives in the `neuroagi` schema,
      "Content-Profile": "public",   // not public.* (that's Vincent's)
    };

    await fetch(`${supabaseUrl}/rest/v1/tutor_impressions`, {
      method:  "POST",
      headers: sbHeaders,
      body: JSON.stringify({
        user_id:    userId,
        impression,
        created_at: new Date().toISOString(),
      }),
    });

    // Prune to last 30 — keep table small
    // Get oldest beyond 30 and delete them
    const listRes = await fetch(
      `${supabaseUrl}/rest/v1/tutor_impressions?user_id=eq.${userId}&order=created_at.desc&select=id`,
      { headers: sbHeaders }
    );
    if (listRes.ok) {
      const rows = await listRes.json();
      const toDelete = rows.slice(30).map(r => r.id);
      if (toDelete.length > 0) {
        await fetch(
          `${supabaseUrl}/rest/v1/tutor_impressions?id=in.(${toDelete.join(",")})`,
          { method: "DELETE", headers: sbHeaders }
        );
      }
    }

    return res.status(200).json({ ok: true, impression });

  } catch (err) {
    // Always return 200 — never let impression writing surface errors
    console.error("[tutor-impression] error:", err.message);
    return res.status(200).json({ ok: false, reason: err.message });
  }
}

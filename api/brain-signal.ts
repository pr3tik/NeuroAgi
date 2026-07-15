// api/brain-signal.js — Writes a behavioral signal to NeuroAGI Brain DB
//
// ARCHITECTURE CONTRACT:
//   FIRES:  called fire-and-forget after every student chat message
//           Also called for session_end (from session-close.js) and canvas_sync
//   READS:  nothing (all data passed in body)
//   WRITES: brain.signals table in Brain DB
//
// SIGNAL TYPES:
//   "behavioral" — chat message signals (this route's primary purpose)
//   "academic"   — canvas sync, session end (also routed here for centralisation)
//
// WHY THIS EXISTS:
//   Every student message is a data point. The brain needs to see:
//   - What time of day the student studies
//   - How long their messages are (short = confused/frustrated, long = engaged)
//   - Emotional tone (stress markers, confusion words, confidence words)
//   - What topics they're asking about
//   - Response latency (how fast they reply — slow = thinking hard or distracted)
//   The brain_scheduler reads these signals and synthesises them into context_window.
//
// CALLER (fire-and-forget from NeuralRing.jsx after message send):
//   fetch('/api/brain-signal', {
//     method: 'POST',
//     body: JSON.stringify({
//       brainPersonId, signalType: 'behavioral',
//       payload: { message_length, time_of_day, topic, emotional_tone, ... }
//     })
//   }).catch(() => {})

import { requireUserOr401 } from "./_auth.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const brainUrl = process.env.BRAIN_SUPABASE_URL;
  const brainKey = process.env.BRAIN_SUPABASE_KEY;

  // Gracefully skip if Brain DB not configured
  if (!brainUrl || !brainKey) {
    return res.status(200).json({ ok: false, reason: "brain db not configured" });
  }

  const _uid = await requireUserOr401(req, res); if (!_uid) return;
  // Signals may only be written for the caller's OWN brain person — derive it from the verified
  // user, never trust a body brainPersonId (that let anyone forge/poison another user's brain).
  const sbUrl = process.env.SUPABASE_URL, sbKey = process.env.SUPABASE_SERVICE_KEY;
  let brainPersonId: string | null = null;
  if (sbUrl && sbKey) {
    const ur = await fetch(`${sbUrl}/rest/v1/users?id=eq.${encodeURIComponent(_uid)}&select=brain_person_id`, { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` } }).catch(() => null);
    if (ur && ur.ok) brainPersonId = ((await ur.json().catch(() => []))?.[0]?.brain_person_id) ?? null;
  }
  if (!brainPersonId) return res.status(200).json({ ok: false, reason: "no brain person for caller" });
  const { signalType = "behavioral", source = "fschoolai", payload } = req.body ?? {};
  if (!payload)       return res.status(200).json({ ok: false, reason: "payload required" });

  const brainHeaders = {
    "apikey":          brainKey,
    "Authorization":   `Bearer ${brainKey}`,
    "Content-Type":    "application/json",
    "Prefer":          "return=minimal",
    "Accept-Profile":  "brain",   // signals table lives in brain schema
    "Content-Profile": "brain",
  };

  try {
    const signalRow = {
      person_id:   brainPersonId,
      signal_type: signalType,
      source,
      payload,
      created_at:  new Date().toISOString(),
    };

    const writeRes = await fetch(`${brainUrl}/rest/v1/signals`, {
      method:  "POST",
      headers: brainHeaders,
      body:    JSON.stringify(signalRow),
    });

    if (!writeRes.ok) {
      const errText = await writeRes.text().catch(() => "");
      console.error("[brain-signal] write failed:", errText);
      return res.status(200).json({ ok: false, reason: "signal write failed" });
    }

    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error("[brain-signal] error:", err.message);
    return res.status(200).json({ ok: false, reason: err.message });
  }
}

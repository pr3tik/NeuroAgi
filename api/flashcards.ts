// api/flashcards.ts — Save, load, and delete flashcards using flashcards_v2 table.
import { requireUserOr401 } from "./_auth.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const _uid = await requireUserOr401(req, res); if (!_uid) return;
  if (req.body && typeof req.body === "object") req.body.userId = _uid;

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: "Supabase env vars not configured" });
  }

  const sbHeaders = {
    "apikey":          supabaseKey,
    "Authorization":   `Bearer ${supabaseKey}`,
    "Content-Type":    "application/json",
    "Accept-Profile":  "public",
    "Content-Profile": "public",
  };

  const { action, userId, courseId, cards, cardId } = req.body ?? {};

  if (!action || !userId) {
    return res.status(400).json({ error: "action and userId are required" });
  }

  // ── Append new cards ───────────────────────────────────────────────────────
  if (action === "save") {
    if (!courseId || !cards?.length) {
      return res.status(400).json({ error: "courseId and cards are required for save" });
    }

    const rows = cards.map((c: { question: string; answer: string }) => ({
      user_id:   userId,
      course_id: courseId,
      question:  c.question,
      answer:    c.answer,
    }));

    const r = await fetch(`${supabaseUrl}/rest/v1/flashcards_v2`, {
      method:  "POST",
      headers: { ...sbHeaders, "Prefer": "return=minimal" },
      body:    JSON.stringify(rows),
    });

    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      return res.status(r.status).json({ error: err.message ?? `Supabase ${r.status}` });
    }

    return res.status(200).json({ ok: true });
  }

  // ── Load cards (newest first) ──────────────────────────────────────────────
  if (action === "load") {
    if (!courseId) {
      return res.status(400).json({ error: "courseId is required for load" });
    }

    const r = await fetch(
      `${supabaseUrl}/rest/v1/flashcards_v2?user_id=eq.${userId}&course_id=eq.${encodeURIComponent(courseId)}&order=created_at.desc&select=id,question,answer,created_at`,
      { headers: { ...sbHeaders, "Prefer": "return=representation" } }
    );

    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      return res.status(r.status).json({ error: err.message ?? `Supabase ${r.status}` });
    }

    const rows = await r.json();
    return res.status(200).json({ cards: rows ?? [] });
  }

  // ── Delete a single card ───────────────────────────────────────────────────
  if (action === "delete") {
    if (!cardId) {
      return res.status(400).json({ error: "cardId is required for delete" });
    }

    const r = await fetch(
      `${supabaseUrl}/rest/v1/flashcards_v2?id=eq.${encodeURIComponent(cardId)}&user_id=eq.${userId}`,
      { method: "DELETE", headers: sbHeaders }
    );

    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      return res.status(r.status).json({ error: err.message ?? `Supabase ${r.status}` });
    }

    return res.status(200).json({ ok: true });
  }

  return res.status(400).json({ error: "Unknown action. Use save, load, or delete." });
}

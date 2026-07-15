// api/summarize.ts — generates an AI summary + key verbatim highlight passages.
// Uses Claude Haiku (fast, cheap). Returns { summary, highlights: string[] }.
// Highlights are EXACT quotes from the provided text so the reader can find + mark them.

import { rateLimit } from "./_ratelimit.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST")   return res.status(405).end();
  if (!(await rateLimit(req, res, "summarize", { anonMax: 20, authMax: 100 }))) return;

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured" });

  const { text, title } = req.body ?? {};
  if (!text?.trim()) return res.status(400).json({ error: "text required" });

  // Use up to 8 000 chars so there is enough material for meaningful highlights
  const sample = text.slice(0, 8000).trim();
  const truncated = text.length > 8000;

  const prompt = `You are an AI study assistant helping a student understand a document.

Document title: "${title || "Untitled"}"
${truncated ? "(Note: showing first portion of a longer document)\n" : ""}
FULL DOCUMENT TEXT (use this exact text for highlights):
"""
${sample}
"""

Produce a JSON response with this EXACT shape — no extra fields, no markdown fences:
{
  "summary": "A thorough 3-5 sentence summary covering the main argument, key concepts, and what the student should take away. Make it genuinely useful — not generic.",
  "highlights": [
    "EXACT verbatim sentence or phrase copied word-for-word from the document above",
    "Another exact sentence that is important for understanding"
  ]
}

CRITICAL RULES for highlights:
1. Copy each highlight EXACTLY as it appears in the document — character for character, same spelling, same punctuation. Do NOT paraphrase or change any words.
2. Include 6 to 10 highlights.
3. Pick sentences or short passages that define key concepts, state important conclusions, or capture the most important ideas.
4. Each highlight must be a COMPLETE sentence or a complete meaningful phrase.
5. The highlight text must appear verbatim in the document text provided above.

Return ONLY valid JSON. No markdown. No explanation outside the JSON.`;

  try {
    const model = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001";
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method:  "POST",
      headers: {
        "Content-Type":      "application/json",
        "x-api-key":         key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 1200,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(502).json({ error: `Claude ${response.status}`, detail: errText.slice(0, 200) });
    }

    const data = await response.json();
    const raw  = (data.content?.[0]?.text ?? "").trim();

    let parsed: { summary?: string; highlights?: string[] } = {};
    try {
      const clean = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
      parsed = JSON.parse(clean);
    } catch {
      // If JSON parse fails, return the raw text as summary with empty highlights
      console.error("[summarize] JSON parse failed:", raw.slice(0, 200));
      parsed = { summary: raw.slice(0, 600), highlights: [] };
    }

    return res.status(200).json({
      summary:    (parsed.summary    ?? "").trim(),
      highlights: (parsed.highlights ?? []).filter(h => typeof h === "string" && h.trim()),
    });
  } catch (err) {
    console.error("[summarize]", err);
    return res.status(502).json({ error: (err as any)?.message || "Summarization failed" });
  }
}

// api/deck-profile.ts — Deck Signature Analysis: a cached, AI-generated profile of what
// a student's flashcard deck for a course actually covers and how well, built from their
// real flashcards (mostly hand-written) plus real srs_reviews performance history.
// Feeds the exam-mastery reminder (api/exam-mastery-reminder.ts) AND the "suggest more
// cards" deck-expansion feature (Study.tsx) — one shared foundation for both.
//
//   action:'get'       → cached profile, regenerating if stale/missing/drifted
//   action:'generate'  → force a fresh profile from current flashcards + review history
//   action:'suggest'   → N new candidate flashcards matching the profile's topics/style
import { callModel } from "./_gateway.js";

const STALE_MS = 7 * 24 * 60 * 60 * 1000;   // regenerate if profile older than this
const CARD_COUNT_DRIFT = 0.2;                // or if card count drifted by more than this fraction

/** Claude sometimes wraps JSON in prose/fences — try a clean parse first, then fall
 *  back to pulling the outermost {...} span. (Same pattern as api/exam.ts.) */
function parseJsonLoose(text: any, fallback: any) {
  const stripped = String(text || "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
  try { return JSON.parse(stripped); } catch { /* try span extraction below */ }
  const m = stripped.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* fall through */ } }
  return fallback;
}

// Exported for api/exam-mastery-reminder.ts, which reuses these directly (in-process,
// no HTTP hop) rather than duplicating the deck-fetch/profile-generation logic.
export function sbHeaders(key: string) {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    "Accept-Profile": "public",
    "Content-Profile": "public",
  };
}

export async function fetchDeckData(sbUrl: string, key: string, userId: string, courseId: string) {
  const h = sbHeaders(key);
  const [cardsRes, reviewsRes] = await Promise.all([
    fetch(`${sbUrl}/rest/v1/flashcards_v2?user_id=eq.${encodeURIComponent(userId)}&course_id=eq.${encodeURIComponent(courseId)}&select=id,question,answer`, { headers: h }),
    fetch(`${sbUrl}/rest/v1/srs_reviews?user_id=eq.${encodeURIComponent(userId)}&course_id=eq.${encodeURIComponent(courseId)}&select=card_key,question,ease,reps,lapses`, { headers: h }),
  ]);
  const cards = cardsRes.ok ? await cardsRes.json() : [];
  const reviews = reviewsRes.ok ? await reviewsRes.json() : [];
  return { cards: cards ?? [], reviews: reviews ?? [] };
}

export async function generateProfile(sbUrl: string, key: string, userId: string, courseId: string) {
  const { cards, reviews } = await fetchDeckData(sbUrl, key, userId, courseId);
  if (cards.length === 0) return { error: "no_cards" as const };

  // Join review performance onto each card by matching question text — reviews are
  // keyed by card_key = cardKey(courseId, question) (src/lib/srs.ts), not flashcards_v2.id.
  const reviewByQuestion = new Map(reviews.map((r: any) => [String(r.question || "").trim().toLowerCase(), r]));
  const cardLines = cards.map((c: any) => {
    const r: any = reviewByQuestion.get(String(c.question || "").trim().toLowerCase());
    const perf = r ? ` [reviewed ${r.reps}x, ease ${r.ease}, ${r.lapses} lapses]` : " [never reviewed]";
    return `Q: ${c.question} | A: ${c.answer}${perf}`;
  }).join("\n");

  const sys = "You analyze a student's flashcard deck to understand what it covers and how well the student knows it. Respond with STRICT JSON only, no prose.";
  const prompt = `Here is a student's flashcard deck for one course, each card annotated with review performance where available (more reps + higher ease + fewer lapses = better known; "never reviewed" = no signal yet).

${cardLines.slice(0, 16000)}

Identify the distinct topics/concepts actually covered by these cards, estimate a confidence (0-1) per topic informed by the review performance of cards touching it (default to a low-moderate confidence for topics with no reviewed cards — don't guess high), and briefly describe the deck's own style (terse definitions vs. worked examples vs. conceptual, etc.).

Return JSON: {"topics":[{"topic":"...","confidence":0.0,"card_count":0}],"style_notes":"..."}`;

  const r = await callModel({
    task: "default", system: sys, messages: [{ role: "user", content: prompt }],
    max_tokens: 4000, metadata: { tool: "deck-profile.generate", user_id: userId, course_id: courseId },
  });
  if (!r.ok) return { error: r.error ?? "generation failed" };

  const parsed = parseJsonLoose(r.content, { topics: [], style_notes: "" });
  const topics = Array.isArray(parsed?.topics) ? parsed.topics : [];
  const styleNotes = typeof parsed?.style_notes === "string" ? parsed.style_notes : "";

  const profile = {
    user_id: userId, course_id: courseId, topics,
    style_notes: styleNotes, card_count: cards.length,
    generated_at: new Date().toISOString(),
  };

  await fetch(`${sbUrl}/rest/v1/deck_profiles`, {
    method: "POST",
    headers: { ...sbHeaders(key), Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(profile),
  }).catch(() => {});

  return { profile };
}

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const sbUrl = process.env.SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!sbUrl || !sbKey) return res.status(500).json({ error: "Supabase env vars not configured" });

  const { action, userId, courseId } = req.body ?? {};
  if (!userId || courseId == null) return res.status(400).json({ error: "userId and courseId are required" });
  const cid = String(courseId);

  try {
    if (action === "generate") {
      const result = await generateProfile(sbUrl, sbKey, userId, cid);
      if ("error" in result) return res.status(result.error === "no_cards" ? 404 : 502).json({ error: result.error });
      return res.status(200).json(result);
    }

    if (action === "get") {
      const r = await fetch(
        `${sbUrl}/rest/v1/deck_profiles?user_id=eq.${encodeURIComponent(userId)}&course_id=eq.${encodeURIComponent(cid)}&select=*&limit=1`,
        { headers: sbHeaders(sbKey) },
      );
      const rows = r.ok ? await r.json() : [];
      const cached = rows?.[0] ?? null;

      // Staleness: missing, older than STALE_MS, or card count drifted more than 20%.
      let stale = !cached;
      if (cached) {
        const age = Date.now() - new Date(cached.generated_at).getTime();
        if (age > STALE_MS) stale = true;
        else {
          const { cards } = await fetchDeckData(sbUrl, sbKey, userId, cid);
          const drift = cached.card_count > 0
            ? Math.abs(cards.length - cached.card_count) / cached.card_count
            : (cards.length > 0 ? 1 : 0);
          if (drift > CARD_COUNT_DRIFT) stale = true;
        }
      }

      if (!stale) return res.status(200).json({ profile: cached, cached: true });

      const result = await generateProfile(sbUrl, sbKey, userId, cid);
      if ("error" in result) {
        // No fresh cards to profile — fall back to whatever's cached rather than nothing.
        if (cached) return res.status(200).json({ profile: cached, cached: true, stale: true });
        return res.status(result.error === "no_cards" ? 404 : 502).json({ error: result.error });
      }
      return res.status(200).json({ ...result, cached: false });
    }

    if (action === "suggest") {
      const { focusTopic, count } = req.body ?? {};
      const r = await fetch(
        `${sbUrl}/rest/v1/deck_profiles?user_id=eq.${encodeURIComponent(userId)}&course_id=eq.${encodeURIComponent(cid)}&select=*&limit=1`,
        { headers: sbHeaders(sbKey) },
      );
      const rows = r.ok ? await r.json() : [];
      let profile = rows?.[0] ?? null;
      if (!profile) {
        const result = await generateProfile(sbUrl, sbKey, userId, cid);
        if ("error" in result) return res.status(result.error === "no_cards" ? 404 : 502).json({ error: result.error });
        profile = result.profile;
      }

      const n = Math.max(1, Math.min(Number(count) || 5, 10));
      const sys = "You write flashcards matching an existing deck's own topics and style. Respond with STRICT JSON only, no prose.";
      const prompt = `This student's flashcard deck covers these topics (with confidence — lower confidence = weaker, more worth reinforcing):
${JSON.stringify(profile.topics, null, 2)}

Deck style: ${profile.style_notes || "(not specified — match a plain, direct Q&A style)"}
${focusTopic ? `\nFocus specifically on this topic, which needs reinforcement: "${focusTopic}"` : ""}

Write ${n} NEW flashcards that fit naturally into this deck — same style, same level of depth, covering ${focusTopic ? "the focus topic" : "the deck's weaker topics first"}. Do not repeat existing questions.

Return JSON: {"cards":[{"question":"...","answer":"...","topic":"..."}]}`;

      const genRes = await callModel({
        task: "default", system: sys, messages: [{ role: "user", content: prompt }],
        max_tokens: 4000, metadata: { tool: "deck-profile.suggest", user_id: userId, course_id: cid },
      });
      if (!genRes.ok) return res.status(genRes.status || 502).json({ error: genRes.error ?? "suggestion failed" });

      const parsed = parseJsonLoose(genRes.content, { cards: [] });
      const cards = Array.isArray(parsed?.cards) ? parsed.cards : [];
      return res.status(200).json({ cards });
    }

    return res.status(400).json({ error: "Unknown action. Use get, generate, or suggest." });
  } catch (err: any) {
    return res.status(502).json({ error: err?.message ?? "deck-profile tool failed" });
  }
}

// api/self-write.js — Mid-session living mind self-correction
//
// FIRES:  after every 6th exchange in a session (not every message — too noisy)
// READS:  current session messages + existing living mind
// WRITES: tutor_mind (patch — only updates sections where new evidence contradicts
//         or meaningfully extends what's there)
// NEVER:  full rewrite (that's session-close's job) — only targeted corrections
//
// DIFFERENCE FROM session-close:
//   session-close: full rewrite after chat ends (macro, comprehensive)
//   self-write:    micro-correction mid-session when something doesn't match
//                  e.g. "living mind says she avoids calculus but she just asked
//                  3 detailed calculus questions — update WHAT THEY KNOW"
//
// Returns { updated: bool, patch: string | null }

import { requireUserOr401 } from "./_auth.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const supabaseUrl  = process.env.SUPABASE_URL;
  const supabaseKey  = process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_ANON_KEY;

  if (!anthropicKey || !supabaseUrl || !supabaseKey) {
    return res.status(200).json({ updated: false, reason: "missing env" });
  }

  const _uid = await requireUserOr401(req, res); if (!_uid) return;
  const { recentMessages } = req.body ?? {};
  const userId = _uid;
  if (!recentMessages?.length) {
    return res.status(200).json({ updated: false, reason: "missing fields" });
  }

  const sbHeaders = {
    "apikey":        supabaseKey,
    "Authorization": `Bearer ${supabaseKey}`,
    "Content-Type":  "application/json",
    "Accept-Profile":  "public",   // app data lives in the `neuroagi` schema,
    "Content-Profile": "public",   // not public.* (that's Vincent's)
  };

  // ── 1. Fetch existing living mind ──────────────────────────────────────────
  let existingMind = null;
  try {
    const mindRes = await fetch(
      `${supabaseUrl}/rest/v1/tutor_mind?user_id=eq.${userId}&select=mind_doc`,
      { headers: sbHeaders }
    );
    if (mindRes.ok) {
      const rows = await mindRes.json();
      existingMind = rows?.[0]?.mind_doc ?? null;
    }
  } catch { /* non-fatal */ }

  // No living mind yet — nothing to patch, session-close will build it
  if (!existingMind) return res.status(200).json({ updated: false, reason: "no existing mind" });

  // ── 2. Build patch prompt ──────────────────────────────────────────────────
  const transcript = (recentMessages || [])
    .slice(-8) // only last 8 messages — recent evidence only
    .map(m => `${m.role === "user" ? "STUDENT" : "TUTOR"}: ${m.content.slice(0, 250)}`)
    .join("\n");

  const prompt = `You are an AI tutor reviewing your living mind document mid-session. You just had this exchange with your student:

RECENT EXCHANGE:
${transcript}

YOUR CURRENT LIVING MIND:
${existingMind}

Your job: identify if anything in the recent exchange CONTRADICTS or MEANINGFULLY UPDATES what's in the living mind. This is a mid-session micro-correction, not a full rewrite.

EXAMPLES of when to patch:
- Living mind says "avoids calculus" but student just asked 3 calculus questions enthusiastically → patch WHAT THEY KNOW
- Living mind says "studies in evenings" but student mentions they're doing this at 8am → patch HOW THEY WORK  
- Living mind has no info on a course but student just discussed it in depth → patch WHAT THEY KNOW

EXAMPLES of when NOT to patch (return NO_UPDATE):
- Exchange is casual small talk
- Exchange confirms what's already in living mind
- Evidence is ambiguous or could go either way
- Only 1 message in the exchange

If a patch is warranted, return ONLY the updated living mind document (same 5-section structure, full rewrite of just the affected sections, rest unchanged). Under 400 words.

If no patch is warranted, return exactly: NO_UPDATE`;

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
        max_tokens: 600,
        messages:   [{ role: "user", content: prompt }],
      }),
    });

    if (!claudeRes.ok) return res.status(200).json({ updated: false, reason: "claude error" });
    const data  = await claudeRes.json();
    const text  = data.content?.[0]?.text?.trim() ?? "";

    // Prefix match, not equality — the model sometimes replies "NO_UPDATE\n\n<reasoning>",
    // which the old exact check missed, writing the reasoning into the mind doc as a patch.
    if (text === "" || text.startsWith("NO_UPDATE")) {
      return res.status(200).json({ updated: false });
    }

    // ── 3. Patch tutor_mind ──────────────────────────────────────────────────
    await fetch(`${supabaseUrl}/rest/v1/tutor_mind`, {
      method:  "POST",
      headers: { ...sbHeaders, "Prefer": "resolution=merge-duplicates,return=minimal" },
      body:    JSON.stringify({ user_id: userId, mind_doc: text, updated_at: new Date().toISOString() }),
    });

    return res.status(200).json({ updated: true, patch: text });

  } catch (err) {
    console.error("[self-write] error:", err.message);
    return res.status(200).json({ updated: false, reason: err.message });
  }
}

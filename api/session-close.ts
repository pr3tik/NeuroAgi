// api/session-close.js — Session close queue: living mind rewrite + brain signal write
//
// ALSO: pattern-recognition harvest (see supabase-teaching-strategies-migration.sql).
// If this session shows a concept genuinely resolved, save a de-identified
// description of the teaching method used — never the student's identity or
// raw content — so it can help a different student later. Best-effort only:
// any failure here never affects the living-mind response above.
//
// ARCHITECTURE CONTRACT (from Reggie):
//   FIRES:  when NeuralRing chat closes (non-blocking, fire-and-forget)
//   READS:  chat_logs (current session transcript) + tutor_impressions (last 10)
//           + tutor_mind (existing living mind doc for this user)
//   WRITES: tutor_mind table (one row per user, upserted — full rewrite each session)
//           brain.signals (NeuroAGI Brain DB — session_end signal, fire-and-forget)
//           brain.context_window (NeuroAGI Brain DB — updated with latest mind summary)
//   NEVER:  block the UI — caller fires and forgets
//   NEVER:  modify users/courses/assignments tables
//
// LIVING MIND DOC:
//   A single coherent student profile Claude maintains across all sessions.
//   Not a log — a living document that gets REWRITTEN (not appended) each time.
//   Structured into 5 sections Claude fills in from evidence:
//     1. WHO THEY ARE    — name, school, GPA, quick identity snapshot
//     2. HOW THEY WORK   — study patterns, time of day, procrastination signals
//     3. WHAT THEY KNOW  — course-level confidence map (strong/shaky/blank)
//     4. WHAT TO WATCH   — recurring gaps, avoidance patterns, emotional signals
//     5. HOW TO HELP     — what works for this student, what to avoid
//
// Loaded into every NeuralRing session via buildChatSystem() as LIVING MIND section.

import { embed } from "./rag.js";
import { awardTechniqueTypeIfEligible } from "./_achievements.js";
import { postgrestStore, remember } from "./_brain/kernel.js";
import { brainConn } from "./_brain/conn.js";
import { resolveFschoolPerson } from "./_brain/identity.js";
import { runHypothesisPass } from "./_brain/hypothesis.js";
import { runTraitPass } from "./_brain/traits.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // sendBeacon sends body as text/plain — parse manually if needed
  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  body = body ?? {};

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const supabaseUrl  = process.env.SUPABASE_URL;
  const supabaseKey  = process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_ANON_KEY;
  // Brain DB env vars (NeuroAGI) — optional, gracefully skipped if not configured
  const brainUrl = process.env.BRAIN_SUPABASE_URL;
  const brainKey = process.env.BRAIN_SUPABASE_KEY;

  // Fail silently — never surface errors to UI
  if (!anthropicKey || !supabaseUrl || !supabaseKey) {
    return res.status(200).json({ ok: false, reason: "missing env" });
  }

  const { userId, sessionMessages, usedStrategyId = null, usedStrategyKind = null } = body;
  if (!userId) return res.status(200).json({ ok: false, reason: "missing userId" });

  // Need at least 2 real exchanges to be worth rewriting
  const msgs = (sessionMessages || []).filter(m => m.role && m.content?.trim().length > 10);
  if (msgs.length < 2) return res.status(200).json({ ok: false, reason: "session too short" });

  const sbHeaders = {
    "apikey":        supabaseKey,
    "Authorization": `Bearer ${supabaseKey}`,
    "Content-Type":  "application/json",
    "Prefer":        "return=minimal",
    "Accept-Profile":  "public",   // app data lives in the `neuroagi` schema,
    "Content-Profile": "public",   // not public.* (that's Vincent's)
  };

  try {
    // ── 1. Fetch existing living mind doc (if any) ──────────────────────────
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
    } catch { /* non-fatal — build from scratch */ }

    // ── 2. Fetch user profile (for brain signal) ──────────────────────────────
    let userProfile = null;
    try {
      const userRes = await fetch(
        `${supabaseUrl}/rest/v1/users?id=eq.${userId}&select=id,name,brain_person_id,gpa,streak,school&limit=1`,
        { headers: sbHeaders }
      );
      if (userRes.ok) {
        const userData = await userRes.json();
        userProfile = userData?.[0] ?? null;
      }
    } catch { /* non-fatal */ }

    // ── 3. Fetch last 10 impressions ────────────────────────────────────────
    let impressions = [];
    try {
      const impRes = await fetch(
        `${supabaseUrl}/rest/v1/tutor_impressions?user_id=eq.${userId}&order=created_at.desc&limit=10&select=impression`,
        { headers: sbHeaders }
      );
      if (impRes.ok) impressions = await impRes.json();
    } catch { /* non-fatal */ }

    // ── 4. Build the rewrite prompt ─────────────────────────────────────────
    const sessionTranscript = msgs
      .slice(-20) // cap at 20 messages to stay within token budget
      .map(m => `${m.role === "user" ? "STUDENT" : "TUTOR"}: ${m.content.slice(0, 300)}`)
      .join("\n");

    const impressionList = impressions
      .map(i => `• ${i.impression}`)
      .join("\n") || "None yet";

    const existingMindSection = existingMind
      ? `EXISTING LIVING MIND (rewrite and update this — don't just append):\n${existingMind}`
      : "EXISTING LIVING MIND: None — this is the first session. Build from scratch.";

    const prompt = `You are an AI academic tutor maintaining a living mind document for your student. After each session, you rewrite this document — not append to it — incorporating new evidence while preserving accurate prior knowledge.

${existingMindSection}

THIS SESSION TRANSCRIPT:
${sessionTranscript}

MICRO-OBSERVATIONS FROM THIS SESSION:
${impressionList}

Rewrite the living mind document using exactly this structure. Every section must be filled from evidence — never invented. If you don't have evidence for something, write "Unknown" or omit it.

---
WHO THEY ARE
[Name, school, GPA if known. 1-2 sentences max. What defines them as a student at a glance.]

HOW THEY WORK
[Study patterns, when they show up, how they ask questions, procrastination signals, response to pressure. Evidence-based only.]

WHAT THEY KNOW
[Per course: confidence level and specific strong/shaky areas. Only list courses that have appeared in conversation.]

WHAT TO WATCH
[Recurring gaps, avoidance patterns, topics they deflect from, emotional signals. What keeps showing up?]

HOW TO HELP
[What works for this student. What to lead with. What to avoid. Pacing, depth, tone preferences — inferred from how they respond.]
---

RULES:
- Rewrite the whole document — don't just add a new section
- Stay under 400 words total
- Write in present tense, first person as their tutor ("She tends to..." / "He avoids...")
- No filler, no hedging — if you know it, say it directly
- Return ONLY the document, no preamble, no markdown headers with ##`;

    // ── 5. Call Claude Haiku ────────────────────────────────────────────────
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

    if (!claudeRes.ok) return res.status(200).json({ ok: false, reason: "claude error" });

    const claudeData = await claudeRes.json();
    const mindDoc    = claudeData.content?.[0]?.text?.trim();
    if (!mindDoc) return res.status(200).json({ ok: false, reason: "empty mind doc" });

    // ── 6. Upsert to tutor_mind (one row per user) ──────────────────────────
    // Uses ON CONFLICT DO UPDATE via Prefer: resolution=merge-duplicates
    const upsertRes = await fetch(`${supabaseUrl}/rest/v1/tutor_mind`, {
      method:  "POST",
      headers: { ...sbHeaders, "Prefer": "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({
        user_id:     userId,
        mind_doc:    mindDoc,
        updated_at:  new Date().toISOString(),
      }),
    });

    if (!upsertRes.ok) {
      const errText = await upsertRes.text().catch(() => "");
      console.error("[session-close] upsert failed:", errText);
      return res.status(200).json({ ok: false, reason: "upsert failed" });
    }

    // ── 6b. NeuroAGI kernel write (product-DB, always on) ────────────────────
    // The session becomes memories in the person's brain: an academic 'signal' + a 'digest'
    // (the rewritten living mind). Independent of the legacy Brain DB below; identity resolved
    // from the verified userId. Best-effort — never affects the response.
    try {
      const personId = await resolveFschoolPerson({ url: supabaseUrl, key: supabaseKey }, userId);
      if (personId) {
        const bc = brainConn() ?? { url: supabaseUrl, key: supabaseKey };   // memory log → NeuroAGI project if configured
        const store = postgrestStore(bc.url, bc.key);
        const subject = `person:${personId}`;
        await remember(store, {
          subject, kind: "signal", source: "fschoolai",
          salience: Math.min(1, msgs.length / 20),
          body: {
            signal_type: "academic", event: "session_end",
            session_messages: msgs.length, duration_mins: Math.round(msgs.length * 1.5),
            user_gpa: userProfile?.gpa, user_streak: userProfile?.streak, school: userProfile?.school,
          },
        });
        if (mindDoc) {
          await remember(store, {
            subject, kind: "digest", source: "fschoolai", salience: 0.7,
            body: { summary: String(mindDoc).slice(0, 2000) },
          });
        }
        // Reflection: mine recent signals into hypotheses/focus + durable study-profile traits the
        // tutor will surface next time. Pure derived layers — write memories only, deliver nothing.
        await runHypothesisPass(store, subject).catch(() => {});
        await runTraitPass(store, subject).catch(() => {});
      }
    } catch (e: any) { console.error("[session-close] kernel write failed:", e?.message); }

    // ── 7. Write signal to NeuroAGI Brain DB (fire-and-forget) ─────────────
    // Only fires if brain env vars are set AND user has a brain_person_id
    if (brainUrl && brainKey && userProfile?.brain_person_id) {
      const brainHeaders = {
        "apikey":          brainKey,
        "Authorization":   `Bearer ${brainKey}`,
        "Content-Type":    "application/json",
        "Prefer":          "return=minimal",
        "Accept-Profile":  "brain",   // signals + context_window live in brain schema
        "Content-Profile": "brain",
      };

      // Write session_end signal to brain.signals
      const brainSignal = {
        person_id:   userProfile.brain_person_id,
        signal_type: "academic",
        source:      "fschoolai",
        payload: {
          event:               "session_end",
          session_messages:    msgs.length,
          duration_mins:       Math.round(msgs.length * 1.5),
          living_mind_updated: true,
          user_gpa:            userProfile.gpa,
          user_streak:         userProfile.streak,
          school:              userProfile.school,
        },
        intensity:   Math.min(1.0, msgs.length / 20),
        confidence:  0.8,
        created_at:  new Date().toISOString(),
      };

      fetch(`${brainUrl}/rest/v1/signals`, {
        method: "POST", headers: brainHeaders, body: JSON.stringify(brainSignal),
      }).catch(err => console.error("[session-close] brain signal write failed:", err.message));

      // Update brain.context_window with the latest mind summary ONLY.
      // Do NOT write stress_level / momentum_state here: those are owned by the brain
      // schedulers on a 0–10 scale, and this used to overwrite them with a constant 0.5
      // (a 0–1-scale value) + "neutral" every session close, which pinned stress below the
      // intervention threshold (>=7) forever. Omitting them preserves the scheduler's values
      // (merge-duplicates only updates the fields we send).
      const contextUpdate = {
        person_id:      userProfile.brain_person_id,
        written_at:     new Date().toISOString(),
        expires_at:     new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
        recent_summary: mindDoc.slice(0, 300).replace(/\n/g, " ").trim(),
      };
      fetch(`${brainUrl}/rest/v1/context_window`, {
        method: "POST",
        headers: { ...brainHeaders, "Prefer": "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(contextUpdate),
      }).catch(err => console.error("[session-close] context_window update failed:", err.message));
    }

    // ── 8. Pattern-recognition harvest ──────────────────────────────────────
    // Detect a genuine confusion→understanding shift and, if found, save a
    // de-identified teaching-method card. Never blocks or affects the response
    // above — any failure here is caught and swallowed.
    try {
      const classifyRes = await fetch("https://api.anthropic.com/v1/messages", {
        method:  "POST",
        headers: {
          "Content-Type":      "application/json",
          "x-api-key":         anthropicKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model:      "claude-haiku-4-5-20251001",
          max_tokens: 200,
          messages: [{
            role: "user",
            content: `Analyze this tutoring session transcript. Did the student go from being confused about ONE specific academic concept to actually understanding it? This must be a genuine shift from confusion to understanding, not just a normal question-and-answer exchange.

SESSION TRANSCRIPT:
${sessionTranscript}

If a concept was clearly resolved, return JSON only:
{"resolved":true,"concept":"<short concept name>","strategy_kind":"<one of: retrieval_practice, elaborative_interrogation, self_explanation, concrete_example, dual_coding, interleaving, spaced_callback>","strategy_summary":"<one sentence describing the teaching approach used, written generically>"}

If no clear resolution happened, or you're not confident, return exactly:
{"resolved":false}`,
          }],
        }),
      });

      if (classifyRes.ok) {
        const classifyData = await classifyRes.json();
        const rawClassify  = classifyData.content?.[0]?.text?.trim() ?? "{}";
        const parsed       = JSON.parse(rawClassify.replace(/```json|```/g, "").trim());

        // If a hint was shown this session, record whether the hinted technique
        // actually panned out. This is what keeps the personal affinity ratio
        // honest — without it, affinity would only ever accumulate successes
        // with nothing to weigh them against. A match on the resolved branch
        // below already records the success case; this only fires the failure
        // case (hint shown, but this session didn't resolve via that technique).
        if (usedStrategyKind) {
          const hintWorked = parsed.resolved === true && parsed.strategy_kind === usedStrategyKind;
          if (!hintWorked) {
            fetch(`${supabaseUrl}/rest/v1/rpc/bump_student_strategy_affinity`, {
              method:  "POST",
              headers: sbHeaders,
              body: JSON.stringify({ p_user_id: userId, p_strategy_kind: usedStrategyKind, p_success: false }),
            }).catch(() => {});
          }
        }

        if (parsed.resolved && parsed.concept && parsed.strategy_kind && parsed.strategy_summary) {
          // Fail-closed de-identification: if the model isn't fully confident the
          // summary is clean of anything traceable, DROP means "don't store it."
          const deidRes = await fetch("https://api.anthropic.com/v1/messages", {
            method:  "POST",
            headers: {
              "Content-Type":      "application/json",
              "x-api-key":         anthropicKey,
              "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify({
              model:      "claude-haiku-4-5-20251001",
              max_tokens: 100,
              messages: [{
                role: "user",
                content: `Rewrite the following teaching-method description as a fully GENERIC pedagogical approach. Remove every specific detail — names, course codes, assignment titles, dates, or anything that could identify a specific student or situation. Keep only the abstract method.

If you cannot produce a fully generic version with total confidence, respond with exactly: DROP

Input: "${parsed.strategy_summary}"`,
              }],
            }),
          });
          const deidText = deidRes.ok ? (await deidRes.json()).content?.[0]?.text?.trim() : null;

          if (deidText && deidText !== "DROP") {
            // Everything past this point is best-effort and non-blocking.
            (async () => {
              try {
                const [conceptEmbedding] = await embed([parsed.concept]);

                const harvestRes = await fetch(`${supabaseUrl}/rest/v1/rpc/harvest_teaching_strategy`, {
                  method:  "POST",
                  headers: sbHeaders,
                  body: JSON.stringify({
                    p_concept:           parsed.concept,
                    p_concept_embedding: conceptEmbedding,
                    p_strategy_kind:     parsed.strategy_kind,
                    p_strategy_summary:  deidText,
                  }),
                });
                const strategyId = harvestRes.ok ? await harvestRes.json() : null;

                if (strategyId) {
                  // Provenance — identity, quarantined, erasure-only. Never
                  // read by the matching/retrieval path.
                  fetch(`${supabaseUrl}/rest/v1/strategy_provenance`, {
                    method:  "POST",
                    headers: { ...sbHeaders, "Prefer": "return=minimal" },
                    body: JSON.stringify({ strategy_id: strategyId, user_id: userId }),
                  }).catch(() => {});

                  // This resolution also strengthens this student's own personal
                  // track record for this technique — never compared to anyone else's.
                  // Awaited (unlike the failure-path bump above) because we need the
                  // returned success/attempt counts to check the technique-type
                  // achievement threshold — safe to await, this whole block already
                  // runs inside a fire-and-forget IIFE relative to the HTTP response.
                  try {
                    const bumpRes = await fetch(`${supabaseUrl}/rest/v1/rpc/bump_student_strategy_affinity`, {
                      method:  "POST",
                      headers: sbHeaders,
                      body: JSON.stringify({ p_user_id: userId, p_strategy_kind: parsed.strategy_kind, p_success: true }),
                    });
                    const bumpRows = bumpRes.ok ? await bumpRes.json() : null;
                    const bumpRow  = Array.isArray(bumpRows) ? bumpRows[0] : null;
                    if (bumpRow) {
                      await awardTechniqueTypeIfEligible(
                        userId, parsed.strategy_kind, bumpRow.success_count, bumpRow.attempt_count
                      );
                    }
                  } catch { /* best-effort — never let achievement wiring break the harvest */ }
                }
              } catch (err) {
                console.error("[session-close] pattern-recognition harvest failed:", err.message);
              }
            })();
          }
        }
      }
    } catch (err) {
      console.error("[session-close] pattern-recognition classify failed:", err.message);
    }

    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error("[session-close] error:", err.message);
    return res.status(200).json({ ok: false, reason: err.message });
  }
}

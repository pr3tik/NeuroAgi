// api/brain-person-link.js — Links a FschoolAI user to their NeuroAGI Brain person record
//
// ARCHITECTURE CONTRACT:
//   FIRES:  called once per user, on signup OR on first login if brain_person_id is null
//           Safe to call multiple times — idempotent (checks before creating)
//   READS:  FschoolAI users table (name, email, school, gpa, created_at)
//           NeuroAGI Brain DB neuro.persons (checks if person already exists by email)
//   WRITES: NeuroAGI Brain DB neuro.persons (creates new person record)
//           FschoolAI users table (stores brain_person_id UUID)
//
// WHY THIS EXISTS:
//   Every FschoolAI student needs a matching neuro.persons record in Brain DB.
//   This is the "spine" that connects all brain signals, context_window, and
//   knowledge graph data back to the student. Without it, the brain is blind.
//
//   Currently: 64 students in FschoolAI, 0 linked to Brain DB (except Vincent).
//   This route fixes that — call it on login for any user where brain_person_id is null.
//
// CALLER (in frontend login flow):
//   After successful auth, if user.brain_person_id is null:
//     fetch('/api/brain-person-link', { method: 'POST', body: JSON.stringify({ userId }) })
//   Fire-and-forget — don't block login on this.

import { requireUserOr401 } from "./_auth.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const supabaseUrl  = process.env.SUPABASE_URL;
  const supabaseKey  = process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_ANON_KEY;
  const brainUrl     = process.env.BRAIN_SUPABASE_URL;
  const brainKey     = process.env.BRAIN_SUPABASE_KEY;

  // Silently skip if Brain DB not configured (graceful degradation)
  if (!supabaseUrl || !supabaseKey) {
    return res.status(200).json({ ok: false, reason: "missing fschool env" });
  }
  if (!brainUrl || !brainKey) {
    return res.status(200).json({ ok: false, reason: "brain db not configured" });
  }

  const _uid = await requireUserOr401(req, res); if (!_uid) return;
  const userId = _uid;

  const sbHeaders = {
    "apikey":        supabaseKey,
    "Authorization": `Bearer ${supabaseKey}`,
    "Content-Type":  "application/json",
  };
  const brainHeaders = {
    "apikey":          brainKey,
    "Authorization":   `Bearer ${brainKey}`,
    "Content-Type":    "application/json",
    "Accept-Profile":  "neuro",   // persons table lives in neuro schema
    "Content-Profile": "neuro",
  };

  try {
    // ── 1. Fetch user from FschoolAI ──────────────────────────────────────────
    const userRes = await fetch(
      // NOTE: users has NO created_at column (live schema) — selecting it 42703'd the
      // whole query and broke linking in prod ("user fetch failed"). Don't re-add it.
      `${supabaseUrl}/rest/v1/users?id=eq.${userId}&select=id,name,email,school,gpa,brain_person_id&limit=1`,
      { headers: sbHeaders }
    );
    if (!userRes.ok) return res.status(200).json({ ok: false, reason: "user fetch failed" });
    const users = await userRes.json();
    const user  = users?.[0];
    if (!user) return res.status(200).json({ ok: false, reason: "user not found" });

    // ── 2. Already linked — return existing brain_person_id ──────────────────
    if (user.brain_person_id) {
      return res.status(200).json({ ok: true, brain_person_id: user.brain_person_id, created: false });
    }

    // ── 3. Check if person already exists in Brain DB by email ───────────────
    // (handles re-runs and edge cases where Brain record exists but link is missing)
    let existingPersonId = null;
    if (user.email) {
      const checkRes = await fetch(
        `${brainUrl}/rest/v1/persons?email=eq.${encodeURIComponent(user.email)}&select=id&limit=1`,
        { headers: brainHeaders }
      );
      if (checkRes.ok) {
        const existing = await checkRes.json();
        existingPersonId = existing?.[0]?.id ?? null;
      }
    }

    let brainPersonId = existingPersonId;

    // ── 4. Create neuro.persons record in Brain DB (if not already exists) ───
    if (!brainPersonId) {
      const createRes = await fetch(`${brainUrl}/rest/v1/persons`, {
        method:  "POST",
        headers: { ...brainHeaders, "Prefer": "return=representation" },
        // neuro.persons is the domain-AGNOSTIC brain identity table (PRD §19.9: the brain
        // holds no education semantics). Education-specific fields (school, gpa) are NOT
        // top-level person columns there — sending them 400'd the insert ("brain person
        // create failed" in prod), so they live in metadata instead. Keep only the generic
        // person columns at top level.
        body: JSON.stringify({
          name:         user.name ?? "Unknown",
          email:        user.email ?? null,
          source:       "fschoolai",
          source_id:    userId,
          created_at:   new Date().toISOString(),
          metadata: {
            fschoolai_user_id: userId,
            school:            user.school ?? null,
            gpa:               user.gpa ?? null,
            signup_date:       null,   // users table has no created_at to source this from
            linked_at:         new Date().toISOString(),
          },
        }),
      });

      if (!createRes.ok) {
        const errText = await createRes.text().catch(() => "");
        console.error("[brain-person-link] create person failed:", errText);
        return res.status(200).json({ ok: false, reason: "brain person create failed" });
      }

      const created = await createRes.json();
      // Supabase returns array for POST with return=representation
      brainPersonId = Array.isArray(created) ? created[0]?.id : created?.id;
      if (!brainPersonId) {
        return res.status(200).json({ ok: false, reason: "no id returned from brain" });
      }
    }

    // ── 5. Store brain_person_id back in FschoolAI users table ───────────────
    const updateRes = await fetch(
      `${supabaseUrl}/rest/v1/users?id=eq.${userId}`,
      {
        method:  "PATCH",
        headers: { ...sbHeaders, "Prefer": "return=minimal" },
        body: JSON.stringify({ brain_person_id: brainPersonId }),
      }
    );

    if (!updateRes.ok) {
      const errText = await updateRes.text().catch(() => "");
      console.error("[brain-person-link] update users failed:", errText);
      // Brain record was created — return partial success so caller can retry the link
      return res.status(200).json({
        ok: false,
        reason: "brain person created but fschool link failed",
        brain_person_id: brainPersonId,
      });
    }

    console.log(`[brain-person-link] linked user ${userId} → brain person ${brainPersonId}`);
    return res.status(200).json({
      ok: true,
      brain_person_id: brainPersonId,
      created: !existingPersonId,
    });

  } catch (err) {
    console.error("[brain-person-link] error:", err.message);
    return res.status(200).json({ ok: false, reason: err.message });
  }
}

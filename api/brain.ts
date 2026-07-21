// api/brain.ts — NeuroAGI brain REST surface (the parent brain's product-agnostic contract).
//
// This is the ONE way any child product reaches a person's brain — never by touching brain
// tables directly. Action-routed to stay under Vercel's function budget:
//   POST /api/brain?action=remember   body { kind, body, salience?, audience?, source? }
//   GET|POST /api/brain?action=recall  { kind?, limit? }
//   POST /api/brain?action=forget      { ids: [...] }        (only the caller's own memories)
//   POST /api/brain?action=reinforce   { id }                (only the caller's own)
//   POST /api/brain?action=tick        { scopes? }           (decay sweep; cron via x-cron-secret)
//
// The caller's brain SUBJECT is derived from their verified identity — never trusted from the
// body — so no one can read or poison another person's brain. (PR1: subject is FschoolAI-local;
// PR2 upgrades subjectForUser() to the global neuro_person id shared across products.)
import { requireUserOr401 } from "./_auth.js";
import { postgrestStore, remember, recall, forget, reinforce, tickDecay, readableScopes, canWrite } from "./_brain/kernel.js";
import { brainConn } from "./_brain/conn.js";
import { brainHealth, verifySkills, exportBrain } from "./_brain/derived.js";
import { resolveFschoolPerson } from "./_brain/identity.js";

function conn() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return { url, key };
}

export default async function handler(req: any, res: any) {
  const action = String(req.query?.action || (req.method === "GET" ? "recall" : ""));
  const c = conn();
  if (!c) return res.status(503).json({ error: "brain store not configured" });
  const bc = brainConn() ?? c;                         // memory log → NeuroAGI project if configured
  const s = postgrestStore(bc.url, bc.key);

  try {
    // Cron decay sweep: a valid x-cron-secret sweeps the scopes it names, no per-user auth.
    if (action === "tick" && process.env.CRON_SECRET && req.headers?.["x-cron-secret"] === process.env.CRON_SECRET) {
      const scopes: string[] = Array.isArray(req.body?.scopes) ? req.body.scopes : [];
      const forgotten = await tickDecay(s, scopes);
      return res.status(200).json({ ok: true, forgotten: forgotten.length });
    }

    const userId = await requireUserOr401(req, res); if (!userId) return;
    // Resolve the caller's GLOBAL person id (creates + links + backfills users.brain_person_id on
    // first touch). This is the shared cross-product subject — 'person:<neuro_person_id>'.
    const personId = await resolveFschoolPerson(c, userId);
    if (!personId) return res.status(500).json({ error: "could not resolve brain identity" });
    const subject = `person:${personId}`;

    if (action === "remember") {
      const { kind, body, salience, audience, source } = req.body ?? {};
      if (!kind || typeof kind !== "string") return res.status(400).json({ error: "kind required" });
      // Target: own personal scope by default; a shared space (course:/room:/prof:) requires the
      // caller to be a writer/owner member — never trust an arbitrary scope from the body.
      const target = typeof req.body?.scope === "string" && req.body.scope ? req.body.scope : subject;
      if (target !== subject && !(await canWrite(s, target, subject))) {
        return res.status(403).json({ error: "not authorized to write this scope" });
      }
      // AUDIENCE IS AN ACL, NOT A FREE FIELD (BR-06 §9.4 row4). `audience` widens who may READ a
      // memory — recall matches rows whose audience overlaps the reader's scopes, or contains '*'.
      // So a caller may only grant read to scopes they THEMSELVES belong to: never '*' (public
      // broadcast is a system capability, not user-settable) and never an arbitrary person:/space
      // they aren't in — that would inject a row into a victim's recall (and thence their tutor
      // prompt). Over-granting is rejected outright rather than silently dropped.
      let audienceClean: string[] | undefined;
      if (audience !== undefined && audience !== null) {
        if (!Array.isArray(audience)) return res.status(400).json({ error: "audience must be an array of scopes" });
        const readable = new Set(await readableScopes(s, subject)); // own subject + spaces the caller belongs to
        const bad = audience.filter((a: any) => typeof a !== "string" || a === "*" || !readable.has(a));
        if (bad.length) return res.status(403).json({ error: "audience may only include scopes you belong to" });
        audienceClean = audience as string[];
      }
      const m = await remember(s, { subject: target, kind, body, salience, audience: audienceClean, source: source ?? "fschoolai" });
      return res.status(200).json({ ok: true, id: m.id });
    }

    if (action === "recall") {
      const kind = req.body?.kind ?? req.query?.kind;
      const rawLimit = req.body?.limit ?? req.query?.limit;
      const limit = rawLimit ? Math.min(200, Math.max(1, Number(rawLimit) || 20)) : 20;
      // Read the caller's OWN scope + shared spaces they belong to (+ directed/public shares via
      // audience). A caller may narrow via body.scopes, but only to scopes they're allowed to read.
      const readable = await readableScopes(s, subject);
      const requested: string[] = Array.isArray(req.body?.scopes) ? req.body.scopes.filter((x: any) => typeof x === "string") : readable;
      const scopes = requested.filter((sc) => readable.includes(sc));
      const rows = await recall(s, scopes.length ? scopes : [subject], { kind, limit });
      return res.status(200).json({ ok: true, memories: rows });
    }

    if (action === "forget") {
      const ids: string[] = Array.isArray(req.body?.ids) ? req.body.ids : [];
      // Ownership guard: only forget ids that belong to the caller's own subject.
      const mine = new Set((await recall(s, [subject], { limit: 5000, reinforce: false })).map((m) => m.id));
      const owned = ids.filter((i) => mine.has(i));
      await forget(s, owned);
      return res.status(200).json({ ok: true, forgotten: owned.length });
    }

    if (action === "reinforce") {
      const id = req.body?.id;
      const mine = new Set((await recall(s, [subject], { limit: 5000, reinforce: false })).map((m) => m.id));
      if (!id || !mine.has(id)) return res.status(404).json({ error: "not found" });
      await reinforce(s, id);
      return res.status(200).json({ ok: true });
    }

    if (action === "tick") {
      const forgotten = await tickDecay(s, [subject]); // self-scoped decay sweep
      return res.status(200).json({ ok: true, forgotten: forgotten.length });
    }

    // Derived layers (read-only, own scope): recomputable folds over the caller's memories.
    if (action === "health") return res.status(200).json({ ok: true, health: await brainHealth(s, subject) });
    if (action === "skills") return res.status(200).json({ ok: true, skills: await verifySkills(s, subject) });
    if (action === "export") return res.status(200).json({ ok: true, memories: await exportBrain(s, subject) });

    return res.status(400).json({ error: "unknown action" });
  } catch (err: any) {
    console.error("[brain]", err?.message);
    return res.status(500).json({ error: "brain error" });
  }
}

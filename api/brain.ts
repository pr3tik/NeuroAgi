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
import { postgrestStore, remember, recall, forget, reinforce, tickDecay } from "./_brain/kernel.js";
import { brainConn } from "./_brain/conn.js";
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
      const m = await remember(s, { subject, kind, body, salience, audience, source: source ?? "fschoolai" });
      return res.status(200).json({ ok: true, id: m.id });
    }

    if (action === "recall") {
      const kind = req.body?.kind ?? req.query?.kind;
      const rawLimit = req.body?.limit ?? req.query?.limit;
      const limit = rawLimit ? Math.min(200, Math.max(1, Number(rawLimit) || 20)) : 20;
      const rows = await recall(s, [subject], { kind, limit });
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

    return res.status(400).json({ error: "unknown action" });
  } catch (err: any) {
    console.error("[brain]", err?.message);
    return res.status(500).json({ error: "brain error" });
  }
}

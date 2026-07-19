// api/brain-person-link.ts — Links a FschoolAI user to their GLOBAL NeuroAGI person.
//
// Called fire-and-forget on login (AppContext) when brain_person_id is null. Now resolves against
// the NeuroAGI kernel identity in the PRODUCT DB (neuro_person + neuro_person_link) via the shared
// resolver — no separate Brain DB project required. This is what turns the 0/N link count into a
// real count: every user who logs in gets a person + link + users.brain_person_id backfilled.
//
// (Superseded the old two-DB linker that no-op'd because BRAIN_SUPABASE_* was never provisioned.)
import { requireUserOr401 } from "./_auth.js";
import { resolveFschoolPerson } from "./_brain/identity.js";

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return res.status(200).json({ ok: false, reason: "missing fschool env" });

  const userId = await requireUserOr401(req, res); if (!userId) return;

  try {
    const personId = await resolveFschoolPerson({ url, key }, userId);
    if (!personId) return res.status(200).json({ ok: false, reason: "resolve failed" });
    return res.status(200).json({ ok: true, brain_person_id: personId });
  } catch (err: any) {
    console.error("[brain-person-link]", err?.message);
    return res.status(200).json({ ok: false, reason: err?.message ?? "error" });
  }
}

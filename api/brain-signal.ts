// api/brain-signal.ts — Ingests a behavioral/academic signal into the NeuroAGI kernel.
//
// Every student action — a chat message, a session close, a canvas sync — becomes one memory in
// the person's brain. Writes to the product-DB kernel (neuro_memory) via remember(); the signal's
// SUBJECT is derived from the verified caller, never trusted from the body (so no one can poison
// another person's brain). Fire-and-forget from callers; self-degrades to {ok:false} rather than
// throwing. (Replaces the old writer that targeted the never-provisioned two-DB Brain project.)
//
// CALLER (fire-and-forget; the browser auto-attaches the caller's JWT via installApiAuth):
//   fetch('/api/brain-signal', { method:'POST',
//     body: JSON.stringify({ signalType:'behavioral', source:'fschoolai_chat', payload:{...} }) })
import { requireUserOr401 } from "./_auth.js";
import { postgrestStore, remember } from "./_brain/kernel.js";
import { brainConn } from "./_brain/conn.js";
import { resolveFschoolPerson } from "./_brain/identity.js";

// Base importance by signal class (then decays over time). Behavioral chatter fades fast; academic
// events (session end, canvas sync) matter longer.
const SALIENCE: Record<string, number> = { behavioral: 0.35, academic: 0.6 };

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return res.status(200).json({ ok: false, reason: "store not configured" });

  const userId = await requireUserOr401(req, res); if (!userId) return;

  const { signalType = "behavioral", source = "fschoolai", payload } = req.body ?? {};
  if (!payload || typeof payload !== "object") return res.status(200).json({ ok: false, reason: "payload required" });

  try {
    const personId = await resolveFschoolPerson({ url, key }, userId);
    if (!personId) return res.status(200).json({ ok: false, reason: "no brain identity" });

    const bc = brainConn() ?? { url, key };            // memory log → NeuroAGI project if configured
    const store = postgrestStore(bc.url, bc.key);
    const m = await remember(store, {
      subject: `person:${personId}`,
      kind: "signal",
      source,
      salience: SALIENCE[signalType] ?? 0.4,
      body: { signal_type: signalType, ...payload },
    });
    return res.status(200).json({ ok: true, id: m.id });
  } catch (err: any) {
    console.error("[brain-signal]", err?.message);
    return res.status(200).json({ ok: false, reason: err?.message ?? "error" });
  }
}

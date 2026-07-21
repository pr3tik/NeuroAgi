// api/_brainWarm.ts — A5: warm a participant's brain context_window on room join.
//
// WHY: the C1 latency budget (route 200 / recall 800 / LLM 1800 / deliver 200 = 3000ms) only closes
// if recall hits a WARM context_window. A cold rebuild is 3–8s — the spec's audit landmine. On
// room-session ?action=start we enqueue a fire-and-forget `warm_brain_context` job per participant;
// this handler primes the recall path and materializes a CURRENT digest so the next room AI turn's
// recall returns a ready context_window.
//
// Deterministic + NO LLM: the digest is folded from live memories via the kernel's pure
// renderStudentBrainState. The richer LLM-synthesized digest stays the scheduler's job (Ryan Lin) —
// this is the fast warm FLOOR that guarantees a ready context_window without spending model latency
// or money on a hot path. Idempotent under at-least-once delivery (a re-run inside the freshness
// window is a no-op), matching every other jobs-worker handler.
import { resolveFschoolPerson } from "./_brain/identity.js";
import { postgrestStore, recall, remember, renderStudentBrainState, type Store } from "./_brain/kernel.js";
import { brainConn } from "./_brain/conn.js";

export const DIGEST_KIND = "digest";
export const DIGEST_FRESH_MS = 10 * 60 * 1000; // a digest younger than this is "warm enough"

/**
 * Ensure a fresh `digest` memory exists for `subject` (a `person:<id>` scope).
 * - Live digest younger than DIGEST_FRESH_MS → no-op ("already-warm").
 * - Nothing worth digesting → no-op ("nothing-to-digest").
 * - Otherwise fold the NON-digest memories into a fresh digest, retire older digests (soft-forget)
 *   so recall returns exactly one current context_window, and append the new one ("rebuilt").
 */
export async function materializeDigestIfStale(
  store: Store,
  subject: string,
  now = Date.now(),
): Promise<{ warmed: boolean; reason: "already-warm" | "nothing-to-digest" | "rebuilt" }> {
  const mems = await recall(store, [subject], { reinforce: false, now });
  const digests = mems.filter((m) => m.kind === DIGEST_KIND);
  const freshest = digests.slice().sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
  if (freshest && now - Date.parse(freshest.created_at) < DIGEST_FRESH_MS) {
    return { warmed: false, reason: "already-warm" };
  }
  // Fold from RAW memories only — never re-fold a prior digest into the new one.
  const summary = renderStudentBrainState(mems.filter((m) => m.kind !== DIGEST_KIND));
  if (!summary) return { warmed: false, reason: "nothing-to-digest" };
  if (digests.length) await store.forget(digests.map((d) => d.id), new Date(now).toISOString());
  await remember(store, { subject, kind: DIGEST_KIND, body: { summary }, salience: 0.9, source: "fschoolai" }, now);
  return { warmed: true, reason: "rebuilt" };
}

/**
 * Worker handler for JOB_TYPES.warmBrain. Payload: { userId, roomId? }. Returns the warmed person's
 * id as output_ref (a uuid), or null when unconfigured / unresolvable (fail-soft — a missed warm
 * just means the next recall pays the cold cost, never an error).
 */
export async function warmBrainContext(payload: any): Promise<string | null> {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_KEY;
  const userId = payload?.userId;
  if (!url || !key || !userId) return null;
  const personId = await resolveFschoolPerson({ url, key }, String(userId));
  if (!personId) return null;
  const bc = brainConn() ?? { url, key };            // memory log → NeuroAGI project if configured
  const store: Store = postgrestStore(bc.url, bc.key);
  await materializeDigestIfStale(store, `person:${personId}`);
  return personId;
}

// api/_brain/conn.ts — where the brain's MEMORY log (neuro_memory) lives.
//
// Identity ALWAYS stays in the product DB: the product `users` table and the neuro_person /
// neuro_person_link mapping are resolved with the product service key (resolveFschoolPerson). Only
// the memory log is relocatable to the dedicated NeuroAGI project. `brainConn()` is the memory
// store's connection — the NeuroAGI project when NEURO_SUPABASE_* is set (both), else the product DB.
// So production is byte-identical until those vars are set, and the flip/rollback is one env var.
export type Conn = { url: string; key: string };

export function productConn(): Conn | null {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_KEY;
  return url && key ? { url, key } : null;
}

/** Connection for the neuro_memory store: NEURO_SUPABASE_* if fully set, else the product DB. */
export function brainConn(): Conn | null {
  const url = process.env.NEURO_SUPABASE_URL, key = process.env.NEURO_SUPABASE_SERVICE_KEY;
  if (url && key) return { url, key };
  if (url || key) throw new Error("NEURO_SUPABASE_* is half-configured — set both URL and SERVICE_KEY, or neither");
  return productConn();
}

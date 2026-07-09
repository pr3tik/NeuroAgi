/**
 * api/extension-auth.ts — RETIRED (410 Gone).
 *
 * The legacy extension auth proxy minted users rows WITHOUT auth_id (its `signup`
 * used a bare randomUUID) and its `login` returned rows[0].id for duplicate emails —
 * both were live id-divergence factories. Nothing in the repo calls it anymore:
 * both extensions log in via Supabase Auth (GoTrue) in their popups and resolve the
 * canonical profile id via auth_id. Kept as a tombstone so any stale extension build
 * still hitting the deployed URL gets a clear error instead of forking identities.
 */

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  return res.status(410).json({
    error: "Gone — update the FschoolAI extension and sign in via the popup (Supabase Auth).",
  });
}

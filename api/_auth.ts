// api/_auth.ts — server-side caller authentication for the API endpoints.
//
// The browser attaches the signed-in user's Supabase JWT as `Authorization: Bearer <token>`
// to every /api/* request (see src/api/installApiAuth.ts). requireUser() verifies that token
// against GoTrue and resolves it to the caller's app profile id (public.users.id via auth_id).
// Endpoints use this INSTEAD of trusting a userId from the request body/query — closing the
// IDOR where anyone could pass another user's id.
//
// The service_role client is built lazily inside the call (never at module load) so importing
// this file in the Node-20 test runner doesn't construct a Supabase client at import time
// (no WebSocket there → crash). [[ci-node20-supabase-import]]
import { createClient } from "@supabase/supabase-js";

let _client: any = null;
function svc() {
  if (_client) return _client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  _client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return _client;
}

function bearer(req: any): string | null {
  const h = req?.headers?.authorization ?? req?.headers?.Authorization ?? "";
  const m = String(h).match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

/**
 * Verify the caller's JWT and resolve it to their app profile id.
 * Returns { userId, authId } or null when there's no valid session.
 */
export async function requireUser(req: any): Promise<{ userId: string; authId: string } | null> {
  // In-process trusted call: callApi() (Reggie's tool loop, agent-manager's brain-context fetch)
  // sets req.__internalUserId to an ALREADY-verified profile id. A real HTTP request can NEVER set
  // this — Vercel only populates headers/body/query from the wire — so it's unforgeable from the
  // browser, and it lets in-process calls skip a redundant JWT round-trip.
  if (req?.__internalUserId) return { userId: String(req.__internalUserId), authId: "internal" };
  const token = bearer(req);
  if (!token) return null;
  const sb = svc();
  if (!sb) return null;
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data?.user) return null;
  const authId = data.user.id as string;
  const { data: rows } = await sb.from("users").select("id").eq("auth_id", authId).limit(1);
  let userId = rows?.[0]?.id ?? null;

  // Lazy-link a legacy account: the JWT is valid but no users row is linked to this auth_id yet
  // (pre-migration accounts whose auth_id was never backfilled). Link by the JWT's VERIFIED email
  // so their first authenticated API call self-heals instead of hard-failing every enforced
  // endpoint. Only link a row that is unlinked (or already this authId) — never steal a row that
  // belongs to a different auth_id.
  if (!userId && data.user.email) {
    const { data: byEmail } = await sb.from("users").select("id, auth_id").ilike("email", data.user.email).limit(1);
    const cand = byEmail?.[0];
    if (cand && (!cand.auth_id || cand.auth_id === authId)) {
      if (!cand.auth_id) await sb.from("users").update({ auth_id: authId }).eq("id", cand.id);
      userId = cand.id;
    }
  }

  if (!userId) return null;
  return { userId, authId };
}

/**
 * Enforce auth: returns the caller's profile id, or sends 401 and returns null.
 * Usage:  const userId = await requireUserOr401(req, res); if (!userId) return;
 */
export async function requireUserOr401(req: any, res: any): Promise<string | null> {
  const u = await requireUser(req);
  if (!u) { res.status(401).json({ error: "Authentication required." }); return null; }
  return u.userId;
}

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

// ─────────────────────────────────────────────────────────────────────────────
// Verified-token cache
//
// requireUser() costs TWO network round trips (GoTrue getUser + the users-row select)
// and it runs on the hot path of every chat turn, so it was a fixed ~150-400ms tax on
// time-to-first-token. The (token → profile id) mapping is immutable for the life of the
// token, so we memoize it per warm instance.
//
// Safety: keyed by a SHA-256 of the token, never the token itself. Entry lifetime is
// min(TTL, the JWT's own `exp`) — an expired token can never be served from cache. Only
// SUCCESSFUL verifications are cached; failures always re-verify so a user who just
// linked their account isn't locked out for the TTL.
//
// Tradeoff: a sign-out is honoured up to TTL late on warm instances. AUTH_CACHE_TTL_MS
// tunes (or, at 0, disables) that window without a code change.
// ─────────────────────────────────────────────────────────────────────────────
import { createHash } from "node:crypto";

const AUTH_CACHE_MAX = 500;
const AUTH_CACHE_DEFAULT_TTL_MS = 5 * 60_000;
const authCache = new Map<string, { userId: string; authId: string; expiresAt: number }>();

function cacheTtlMs(): number {
  const raw = Number(process.env.AUTH_CACHE_TTL_MS);
  return Number.isFinite(raw) && raw >= 0 ? raw : AUTH_CACHE_DEFAULT_TTL_MS;
}

function tokenKey(token: string): string {
  return createHash("sha256").update(token).digest("base64");
}

/** The JWT's `exp` claim in ms, or null when it can't be read (unsigned parse — the
 *  signature was already verified upstream by GoTrue; this only bounds cache lifetime). */
function jwtExpiryMs(token: string): number | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const json = Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    const exp = JSON.parse(json)?.exp;
    return typeof exp === "number" ? exp * 1000 : null;
  } catch { return null; }
}

function cacheGet(token: string): { userId: string; authId: string } | null {
  const hit = authCache.get(tokenKey(token));
  if (!hit) return null;
  if (Date.now() >= hit.expiresAt) { authCache.delete(tokenKey(token)); return null; }
  return { userId: hit.userId, authId: hit.authId };
}

function cachePut(token: string, userId: string, authId: string): void {
  const ttl = cacheTtlMs();
  if (ttl <= 0) return;
  const exp = jwtExpiryMs(token);
  const expiresAt = Math.min(Date.now() + ttl, exp ?? Number.POSITIVE_INFINITY);
  if (expiresAt <= Date.now()) return;
  // Bounded, insertion-ordered eviction — a Map iterates in insertion order, so the first
  // key is the oldest. Keeps a long-lived instance from growing without limit.
  if (authCache.size >= AUTH_CACHE_MAX) {
    const oldest = authCache.keys().next().value;
    if (oldest !== undefined) authCache.delete(oldest);
  }
  authCache.set(tokenKey(token), { userId, authId, expiresAt });
}

/** Test seam: drop every memoized verification. */
export function _clearAuthCache(): void { authCache.clear(); }

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
  const cached = cacheGet(token);
  if (cached) return cached;
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
  cachePut(token, userId, authId);
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

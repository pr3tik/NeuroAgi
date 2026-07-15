// api/_ratelimit.ts — fixed-window rate limiting for PUBLIC endpoints (unauthenticated → cost/
// abuse vector). Keyed by a hash of the session token when present (generous per-user limit) and
// by client IP otherwise (strict) — so it caps anonymous abuse without throttling many logged-in
// students behind one campus NAT. Counting is one atomic RPC (public.check_rate_limit). FAILS
// OPEN on any error: a rate-limiter hiccup must never take a working endpoint down.
import { createClient } from "@supabase/supabase-js";

let _c: any = null;
function svc() {
  if (_c) return _c;
  const u = process.env.SUPABASE_URL, k = process.env.SUPABASE_SERVICE_KEY;
  if (!u || !k) return null;
  _c = createClient(u, k, { auth: { persistSession: false, autoRefreshToken: false } });
  return _c;
}
function clientIp(req: any): string {
  const xff = req?.headers?.["x-forwarded-for"];
  if (xff) return String(xff).split(",")[0].trim();
  return String(req?.headers?.["x-real-ip"] ?? "unknown");
}
function hash(s: string): string {
  let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/**
 * Returns true if allowed. On over-limit, sends 429 + returns false → `if (!(await rateLimit(...))) return;`.
 */
export async function rateLimit(
  req: any, res: any, bucket: string,
  opts: { anonMax?: number; authMax?: number; windowSecs?: number } = {},
): Promise<boolean> {
  const { anonMax = 20, authMax = 120, windowSecs = 60 } = opts;
  try {
    const sb = svc();
    if (!sb) return true;                                  // not configured → don't block
    const m = /^Bearer\s+(.+)$/i.exec(String(req?.headers?.authorization ?? ""));
    const subject = m ? "u:" + hash(m[1]) : "ip:" + clientIp(req);
    const max = m ? authMax : anonMax;
    const { data, error } = await sb.rpc("check_rate_limit", { p_key: `${bucket}:${subject}`, p_max: max, p_window_secs: windowSecs });
    if (error) return true;                                // fail open
    if (data === false) { res.status(429).json({ error: "Too many requests — please slow down and try again in a minute." }); return false; }
    return true;
  } catch { return true; }                                 // fail open
}

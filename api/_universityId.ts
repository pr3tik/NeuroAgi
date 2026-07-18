// api/_universityId.ts — canonical institution key for Course Brain scoping (PRD §17.1 Gap 8).
//
// One school → one stable `university_id`, derived deterministically from a Canvas host so that
// a WRITE (contributor's Canvas host) and a READ (reader's Canvas host / stored university_id)
// agree by construction. Without this, `course_content` collides across schools: two universities
// share the same integer canvas_course_id, and the same professor name, so an unscoped read leaks
// one school's material into another's (Gap 8).
//
// Deliberately conservative: it normalizes to a lowercase bare hostname (strip scheme/port/path)
// and does NOT collapse subdomains to a registrable domain. Keeping the full host means this is a
// NO-OP on values already produced by the old `new URL(creds.host).hostname` write path
// (e.g. "canvas.utoronto.ca" stays "canvas.utoronto.ca") — so turning on read-side scoping does not
// silently orphan rows written before this change. A registrable-domain collapse (canvas.x.edu +
// q.x.edu → x.edu) is a deliberate later step that requires a live-data backfill first.
//
// Pure function, no imports — safe to unit-test in the Node-20 runner and to reuse from SQL logic.

/**
 * Canonical university id from a Canvas host or URL. Returns null when nothing usable is present
 * (caller must then NOT apply a university scope rather than scope to an empty string).
 */
export function canonicalUniversityId(hostOrUrl?: string | null): string | null {
  if (hostOrUrl == null) return null;
  let h = String(hostOrUrl).trim().toLowerCase();
  if (!h) return null;
  // Extract the bare host whether we were given a full URL, a host:port, or already a bare host.
  if (h.includes("://")) {
    try { h = new URL(h).hostname; } catch { h = h.split("://")[1] ?? h; }
  }
  h = h.split("/")[0];        // drop any path that survived (host given without scheme)
  h = h.replace(/:\d+$/, ""); // strip an explicit port
  h = h.replace(/\.$/, "");   // strip a trailing dot (FQDN root)
  // A valid host has at least one dot and only host-legal characters.
  if (!h || !h.includes(".") || !/^[a-z0-9.-]+$/.test(h)) return null;
  return h;
}

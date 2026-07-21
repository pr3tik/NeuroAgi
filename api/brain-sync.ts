// api/brain-sync.ts — server-side Canvas → KERNEL sync (F-5 fix + legacy retirement).
//
// The browser POSTs its freshly-synced Canvas data here (installApiAuth attaches the user's JWT).
// The server authenticates the caller and records a compact `canvas_sync` academic signal in the
// caller's KERNEL brain (subject `person:<id>`), person resolved from the verified caller — never
// the request body — so it can only ever write the caller's own brain. Fixes F-5 (the old browser
// path used a VITE_-inlined Brain-DB key) AND retires the legacy fschool_* Brain-DB writes: the
// kernel is the single source of truth now.
//
// ENV (server-only, never VITE_): SUPABASE_URL + SUPABASE_SERVICE_KEY (identity resolution),
// NEURO_SUPABASE_* (kernel store via brainConn, falls back to product). Raw fetch / kernel store
// only (no @supabase/supabase-js at module load → Node-20 test-runner safe).
import { requireUserOr401 } from "./_auth.js";
import { resolveFschoolPerson } from "./_brain/identity.js";
import { postgrestStore, remember } from "./_brain/kernel.js";
import { brainConn } from "./_brain/conn.js";

const MAX_COURSES = 200;

export default async function handler(req: any, res: any): Promise<void> {
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }

  // Auth: caller's profile id comes from the verified JWT (or the trusted in-process path), never
  // from the body — this both fixes F-5 and closes the IDOR the browser version had.
  const userId = await requireUserOr401(req, res);
  if (!userId) return; // 401 already sent

  const prodUrl  = process.env.SUPABASE_URL;
  const prodKey  = process.env.SUPABASE_SERVICE_KEY;
  if (!prodUrl || !prodKey) { res.status(200).json({ ok: false, reason: "not configured" }); return; }

  const courses     = Array.isArray(req.body?.courses)     ? req.body.courses.slice(0, MAX_COURSES) : [];
  const assignments = Array.isArray(req.body?.assignments) ? req.body.assignments : [];
  const result: any = { ok: true, courses: 0, assignments: 0 };

  // ── Kernel bridge (single source of truth) — record a compact Canvas academic signal in the
  // person's KERNEL brain, independent of the legacy fschool_* path below. Idempotent per day (a
  // re-sync updates, not piles up). This is what lets the kernel supersede the legacy brain, so the
  // legacy fschool_*/context_window writers can eventually be retired without losing Canvas context.
  try {
    const kpid = await resolveFschoolPerson({ url: prodUrl, key: prodKey }, userId);
    const bc = brainConn();
    if (kpid && bc) {
      const nowMs = Date.now();
      const upcoming = assignments.filter((a: any) => a?.dueAt && Date.parse(a.dueAt) > nowMs).length;
      const missing = assignments.filter((a: any) => a?.submission?.missing).length;
      await remember(postgrestStore(bc.url, bc.key), {
        subject: `person:${kpid}`, kind: "signal", source: "fschoolai", salience: 0.5,
        idem: `canvas:${new Date().toISOString().slice(0, 10)}`,
        body: { signal_type: "academic", event: "canvas_sync", courses: courses.length, upcoming, missing },
      });
      result.kernelBridged = true;
    }
  } catch (e: any) { console.error("[brain-sync] kernel bridge failed:", e?.message); }

  // (Legacy Brain-DB fschool_* writes retired — the kernel canvas_sync bridge above is now the single
  // source of truth for the Canvas snapshot.)
  res.status(200).json(result);
}

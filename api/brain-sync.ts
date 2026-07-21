// api/brain-sync.ts — server-side Canvas → Brain-DB sync (F-5 fix).
//
// BEFORE: src/api/canvasSync.ts syncToBrainDB() ran IN THE BROWSER and used
// VITE_BRAIN_SUPABASE_KEY — a VITE_ var, so its value was inlined into the public JS bundle — to
// write person-scoped rows straight into the Brain DB. If that value was the Brain DB service_role
// key, it shipped to every visitor's browser (full Brain-DB r/w, RLS bypassed).
//
// NOW: the browser POSTs its freshly-synced Canvas data here (installApiAuth attaches the user's
// JWT). The server authenticates the caller, resolves THEIR brain_person_id from the product users
// table, and writes fschool_courses / fschool_assignments with the server-only BRAIN_SUPABASE_KEY.
// The Brain service key never touches the client, and person_id is derived from the verified caller
// (never the request body) — so this endpoint can only ever write the caller's own brain.
//
// ENV (server-only, never VITE_): SUPABASE_URL + SUPABASE_SERVICE_KEY (resolve brain_person_id from
// the product `users` table), BRAIN_SUPABASE_URL + BRAIN_SUPABASE_KEY (write the Brain DB).
// Raw fetch only (no @supabase/supabase-js at module load → Node-20 test-runner safe).
import { requireUserOr401 } from "./_auth.js";
import { resolveFschoolPerson } from "./_brain/identity.js";
import { postgrestStore, remember } from "./_brain/kernel.js";
import { brainConn } from "./_brain/conn.js";

const MAX_COURSES = 200;
const MAX_ASSIGNMENTS = 100;

export default async function handler(req: any, res: any): Promise<void> {
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }

  // Auth: caller's profile id comes from the verified JWT (or the trusted in-process path), never
  // from the body — this both fixes F-5 and closes the IDOR the browser version had.
  const userId = await requireUserOr401(req, res);
  if (!userId) return; // 401 already sent

  const prodUrl  = process.env.SUPABASE_URL;
  const prodKey  = process.env.SUPABASE_SERVICE_KEY;
  const brainUrl = process.env.BRAIN_SUPABASE_URL;
  const brainKey = process.env.BRAIN_SUPABASE_KEY;
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

  // ── Legacy Brain DB (fschool_*) — kept until the legacy system is retired (gated). Skipped when
  // its env is unset or the caller isn't legacy-linked; the kernel bridge above already ran.
  if (!brainUrl || !brainKey) { res.status(200).json(result); return; }

  // Resolve the caller's LEGACY brain_person_id (server-side, service key). NOT from req.body.
  let brainPersonId: string | null = null;
  try {
    const r = await fetch(`${prodUrl}/rest/v1/users?id=eq.${encodeURIComponent(userId)}&select=brain_person_id`, {
      headers: { apikey: prodKey, Authorization: `Bearer ${prodKey}` },
    });
    if (r.ok) { const rows = await r.json(); brainPersonId = rows?.[0]?.brain_person_id ?? null; }
  } catch { /* fall through to not-linked no-op */ }
  if (!brainPersonId) { res.status(200).json(result); return; }

  const now = new Date().toISOString(); // server-stamped, not client-supplied
  const brainHeaders = {
    apikey: brainKey,
    Authorization: `Bearer ${brainKey}`,
    "Content-Type": "application/json",
    Prefer: "resolution=merge-duplicates,return=minimal",
  };

  if (courses.length) {
    const courseRows = courses.map((c: any) => ({
      person_id:        brainPersonId,   // server-derived — the row is always scoped to the caller
      canvas_course_id: String(c.id),
      name:             c.name,
      course_code:      c.courseCode ?? null,
      current_score:    c.currentScore ?? null,
      final_score:      c.finalScore ?? null,
      synced_at:        now,
    }));
    const cr = await fetch(`${brainUrl}/rest/v1/fschool_courses`, {
      method: "POST", headers: brainHeaders, body: JSON.stringify(courseRows),
    }).catch(() => null);
    if (cr && cr.ok) result.courses = courseRows.length;
    else if (cr) result.courseError = cr.status;
  }

  const recent = assignments
    .filter((a: any) => a?.dueAt)
    .sort((a: any, b: any) => +new Date(b.dueAt) - +new Date(a.dueAt))
    .slice(0, MAX_ASSIGNMENTS);
  if (recent.length) {
    const assignRows = recent.map((a: any) => ({
      person_id:            brainPersonId,
      canvas_assignment_id: String(a.id),
      canvas_course_id:     String(a.courseId),
      title:                a.name,
      due_at:               a.dueAt ?? null,
      score:                a.submission?.score ?? null,
      points_possible:      a.pointsPossible ?? null,
      missing:              a.submission?.missing ?? false,
      late:                 a.submission?.late ?? false,
      synced_at:            now,
    }));
    const ar = await fetch(`${brainUrl}/rest/v1/fschool_assignments`, {
      method: "POST", headers: brainHeaders, body: JSON.stringify(assignRows),
    }).catch(() => null);
    if (ar && ar.ok) result.assignments = assignRows.length;
    else if (ar) result.assignmentError = ar.status;
  }

  res.status(200).json(result);
}

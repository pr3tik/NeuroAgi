// api/grade-weights.ts — compute a course's grade-category weights + a projected grade.
// Reads the synced 'assignment_groups' canvas_data blob (category → weight, from
// buildSyllabus) and the course's assignments, and returns per-category weights plus a
// projected grade via the shared grade math (src/lib/whatif).
//
// Two id spaces matter here: the blob is keyed by the CANVAS course id (canvasSync stores
// course.id → canvas_course_id), while assignments.course_id is the DB uuid FK to
// courses.id. We resolve the course row first so `courseId` may be EITHER id.
//
// NOTE: the sync pipeline doesn't persist assignment→group membership, so per-assignment
// weight distribution (and writing weight/weight_achieved back onto assignments) is a
// no-op for now — returned as persisted:false. Wiring membership through canvasSync is
// the follow-up that unlocks the write half. Contract: fschoolai_tool_contracts.md §A.
import { calcRequiredScore } from "../src/lib/whatif.js";
import { courseFilter } from "../src/lib/courseId.js";
import { requireUserOr401 } from "./_auth.js";

function sbHeaders(key: string) {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    "Accept-Profile": "public",
    "Content-Profile": "public",
  };
}

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const _uid = await requireUserOr401(req, res); if (!_uid) return;
  if (req.body && typeof req.body === "object") req.body.userId = _uid;
  const { userId, courseId } = req.body ?? {};
  if (!userId || courseId == null) return res.status(400).json({ error: "userId and courseId are required" });

  const sbUrl = process.env.SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!sbUrl || !sbKey) return res.status(500).json({ error: "Supabase env vars not configured" });
  const H = sbHeaders(sbKey);
  const u = encodeURIComponent(userId);

  try {
    // Validate the userId exists (mirrors api/extension-sync.ts, per the contract's
    // "SERVICE_KEY + userId validation"). Not full IDOR protection (anon/RLS-off model).
    const uCheck = await fetch(`${sbUrl}/rest/v1/users?id=eq.${u}&select=id&limit=1`, { headers: H });
    if (!uCheck.ok) return res.status(uCheck.status).json({ error: `Supabase ${uCheck.status}` });
    if (!((await uCheck.json().catch(() => [])) || []).length) return res.status(401).json({ error: "Invalid userId" });

    // 0. Resolve the course (accept DB uuid or canvas id) → both ids.
    const cr = await fetch(
      `${sbUrl}/rest/v1/courses?user_id=eq.${u}&${courseFilter(courseId)}&select=id,canvas_course_id&limit=1`,
      { headers: H },
    );
    const courseRow = cr.ok ? (await cr.json())?.[0] : null;
    if (!courseRow) return res.status(404).json({ error: "Course not found for this user." });
    const dbId = courseRow.id;
    const canvasId = courseRow.canvas_course_id;

    // 1. assignment_groups blob → this course's categories ([{name, weight}]), keyed by canvas id.
    const br = await fetch(
      `${sbUrl}/rest/v1/canvas_data?user_id=eq.${u}&data_type=eq.assignment_groups&select=payload`,
      { headers: H },
    );
    const blobRows = br.ok ? await br.json() : [];
    const payload = blobRows?.[0]?.payload ?? [];
    const courseBlob = Array.isArray(payload)
      ? payload.find((g: any) => String(g.courseId) === String(canvasId) || String(g.courseId) === String(courseId))
      : null;
    const rawGroups: any[] = courseBlob?.groups ?? [];
    if (!rawGroups.length) {
      return res.status(404).json({ error: "No assignment_groups data for this course. Run a Canvas sync first." });
    }

    // 2. course assignments (for the projected-grade calc), keyed by the DB uuid.
    const ar = await fetch(
      `${sbUrl}/rest/v1/assignments?user_id=eq.${u}&course_id=eq.${encodeURIComponent(String(dbId))}&select=*`,
      { headers: H },
    );
    const asg = ar.ok ? await ar.json() : [];

    // 3. category weights. Per-assignment distribution needs assignment→group membership,
    //    which isn't synced yet → assignments:[] for now.
    const groups = rawGroups.map((g: any) => ({
      name: g.name,
      weight: Number(g.weight) || 0,
      assignments: [] as any[],
    }));

    // 4. projected grade — points-based (no per-item weights available yet).
    let projectedGrade: number | null = null;
    try {
      const calc = calcRequiredScore(
        asg.map((a: any) => ({
          id: a.id,
          pointsPossible: a.points_possible ?? null,
          submissionScore: a.score ?? null,
        })),
        100, {}, [],
      );
      projectedGrade = Number.isFinite(calc.projectedPct as number)
        ? (calc.projectedPct as number)
        : (calc.currentPct ?? null);
    } catch { /* leave null */ }

    return res.status(200).json({
      ok: true,
      courseId,
      groups,
      projectedGrade,
      persisted: false,
      note: "Category weights + points-based projection. Per-assignment weight distribution/persistence needs assignment→group membership, which the Canvas sync does not store yet.",
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message ?? "grade-weights failed" });
  }
}

// api/canvas-reads.ts — read-only Canvas surfaces for the tutor, action-routed.
//   action:'grades'   → per-course standing (current/final %, per-assignment scores/weights) + GPA
//   action:'upcoming' → upcoming/unsubmitted assignments, soonest first
// Reads the synced courses/assignments tables with the service key (mirrors the client
// loadCanvasData() field mapping — note the column is `title`, not `name`). We select
// `*` like loadCanvasData does, so optional/migration-added columns (weight,
// weight_achieved, missing) never 400 the query when absent.
// Contracts: fschoolai_tool_contracts.md §A.
import { coursesToGpa } from "../src/lib/gpa.js";
import { courseFilter } from "../src/lib/courseId.js";

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
  const { action, userId, courseId, withinDays, includeSubmitted, status } = req.body ?? {};
  if (!userId) return res.status(400).json({ error: "userId is required" });

  const sbUrl = process.env.SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!sbUrl || !sbKey) return res.status(500).json({ error: "Supabase env vars not configured" });
  const H = sbHeaders(sbKey);

  try {
    // Validate the userId exists (mirrors api/extension-sync.ts, per the contract's
    // "SERVICE_KEY + userId validation"). Rejects bogus ids; note this is not full IDOR
    // protection — the app's anon/RLS-off model means a valid id still authorizes reads.
    const uCheck = await fetch(`${sbUrl}/rest/v1/users?id=eq.${encodeURIComponent(userId)}&select=id&limit=1`, { headers: H });
    if (!uCheck.ok) return res.status(uCheck.status).json({ error: `Supabase ${uCheck.status}` });
    if (!((await uCheck.json().catch(() => [])) || []).length) return res.status(401).json({ error: "Invalid userId" });

    if (action === "grades")   return await grades(res, sbUrl, H, userId, courseId);
    // `overdue` is a convenience alias for upcoming with status:'overdue'.
    if (action === "upcoming") return await upcoming(res, sbUrl, H, userId, withinDays, includeSubmitted, status);
    if (action === "overdue")  return await upcoming(res, sbUrl, H, userId, withinDays, includeSubmitted, "overdue");
    return res.status(400).json({ error: "Unknown action. Use grades, upcoming, or overdue." });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message ?? "canvas read failed" });
  }
}

async function grades(res: any, sbUrl: string, H: any, userId: string, courseId?: any) {
  const u = encodeURIComponent(userId);
  const cFilter = courseId != null ? `&${courseFilter(courseId)}` : "";
  const cr = await fetch(`${sbUrl}/rest/v1/courses?user_id=eq.${u}${cFilter}&select=*`, { headers: H });
  if (!cr.ok) return res.status(cr.status).json({ error: `Supabase ${cr.status}` });
  const courseRows = await cr.json();

  // assignments.course_id is the DB uuid FK to courses.id → group by it to match courses.id.
  // Scope to the requested course(s) when courseId was given, and cap the row count so a
  // heavy-history account can't silently truncate under PostgREST's default row cap.
  const courseIds = (courseRows || []).map((c: any) => c.id).filter(Boolean);
  let aUrl = `${sbUrl}/rest/v1/assignments?user_id=eq.${u}&select=*&limit=5000`;
  if (courseId != null && courseIds.length) {
    aUrl += `&course_id=in.(${courseIds.map((id: any) => encodeURIComponent(String(id))).join(",")})`;
  }
  const ar = await fetch(aUrl, { headers: H });
  const asgRows = ar.ok ? await ar.json() : [];
  const byCourse = new Map<string, any[]>();
  for (const a of asgRows) {
    const k = String(a.course_id);
    if (!byCourse.has(k)) byCourse.set(k, []);
    byCourse.get(k)!.push({
      name: a.title ?? a.name ?? "",
      score: a.score ?? null,
      pointsPossible: a.points_possible ?? null,
      weight: a.weight ?? null,
      weightAchieved: a.weight_achieved ?? null,
    });
  }

  const courses = courseRows.map((c: any) => ({
    courseId: c.id,
    courseCode: c.course_code ?? null,
    currentScore: c.current_score ?? null,
    finalScore: c.final_score ?? null,
    assignments: byCourse.get(String(c.id)) ?? [],
  }));

  const gpa = coursesToGpa(courses);
  return res.status(200).json({ ok: true, courses, gpa });
}

// Lists assignments by window:
//   'upcoming' (default) → due in the future, soonest first (optionally within N days)
//   'overdue'            → PAST due AND not submitted, most-recently-due first (what the
//                          student is behind on) — optionally only within the last N days
//   'all'                → every assignment, soonest due first
// Overdue always excludes submitted work (a submitted past-due item isn't "behind").
async function upcoming(
  res: any, sbUrl: string, H: any, userId: string, withinDays?: any, includeSubmitted?: boolean, status?: string,
) {
  const u = encodeURIComponent(userId);
  const now = Date.now();
  const nowIso = new Date().toISOString();
  const mode = status === "overdue" || status === "all" ? status : "upcoming";
  const hasWindow = withinDays != null && Number.isFinite(Number(withinDays));
  const days = hasWindow ? Math.max(0, Number(withinDays)) : 0;

  let url = `${sbUrl}/rest/v1/assignments?user_id=eq.${u}&select=*,courses(name)&limit=2000`;
  if (mode === "upcoming") {
    url += `&due_at=gte.${encodeURIComponent(nowIso)}&order=due_at.asc`;
    if (hasWindow) url += `&due_at=lte.${encodeURIComponent(new Date(now + days * 86_400_000).toISOString())}`;
  } else if (mode === "overdue") {
    url += `&due_at=lt.${encodeURIComponent(nowIso)}&order=due_at.desc`;
    if (hasWindow) url += `&due_at=gte.${encodeURIComponent(new Date(now - days * 86_400_000).toISOString())}`;
  } else { // all
    url += `&order=due_at.asc`;
  }

  const r = await fetch(url, { headers: H });
  if (!r.ok) return res.status(r.status).json({ error: `Supabase ${r.status}` });
  const rows = await r.json();

  // Overdue = not done yet → always drop submitted. Upcoming honors includeSubmitted.
  // "all" means EVERYTHING (bugfix: the old `|| !includeSubmitted` silently dropped every
  // submitted assignment on the all path, contradicting the contract).
  const dropSubmitted = mode === "overdue" || (mode === "upcoming" && !includeSubmitted);
  const assignments = (rows || [])
    .map((a: any) => ({
      id: a.id,
      name: a.title ?? a.name ?? "",
      courseId: a.course_id,
      courseName: a.courses?.name ?? "",
      dueAt: a.due_at ?? null,
      pointsPossible: a.points_possible ?? null,
      // "Done" = a Canvas submission OR the student marked it done in-app. manual_done_at
      // is FschoolAI's own completion flag (Canvas never writes it); the client's
      // loadCanvasData ORs the two the same way, so upcoming/overdue must too — otherwise
      // work the student finished in-app keeps surfacing as pending/behind.
      submitted: a.submitted_at != null || a.manual_done_at != null,
      missing: a.missing ?? false,
    }))
    .filter((a: any) => (dropSubmitted ? !a.submitted : true));

  return res.status(200).json({ ok: true, status: mode, assignments });
}

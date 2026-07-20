// api/_reggie/canvasLive.ts — live Canvas REST access for Reggie's tools.
// Unlike canvas-reads (which reads the SYNCED courses/assignments tables), these helpers
// hit the student's Canvas instance directly with their stored token, so Reggie can see
// announcements, module content, page bodies, quizzes, submission feedback, and inbox —
// none of which the sync persists. Every result is TRIMMED to compact, model-friendly
// shapes: raw Canvas objects are huge (full HTML bodies, dozens of fields) and would
// blow the loop's tool-result budget.

export interface CanvasCreds { host: string; token: string; }

/** Fetch the student's Canvas token + host from the users table (service key). */
export async function canvasCreds(userId: string): Promise<CanvasCreds> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase env vars not configured");
  const r = await fetch(
    `${url}/rest/v1/users?id=eq.${encodeURIComponent(userId)}&select=canvas_token,canvas_base_url&limit=1`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } },
  );
  if (!r.ok) throw new Error(`user lookup failed (${r.status})`);
  const row = ((await r.json()) as any[])[0];
  if (!row?.canvas_token || !row?.canvas_base_url) {
    throw new Error("Canvas isn't connected for this account — connect Canvas in the app first.");
  }
  // canvas_base_url is stored inconsistently (origin or …/api/v1) — normalize to origin.
  const host = new URL(row.canvas_base_url).origin;
  return { host, token: row.canvas_token };
}

/** BR-02 (Gap 8): the caller's canonical institution key = the hostname of their Canvas base
 *  URL (e.g. 'q.utoronto.ca'), used to scope Course Brain (course_content) reads to the user's
 *  own school. Reads the populated users.university_id (fast path); falls back to deriving it
 *  from canvas_base_url so it also works before the backfill runs. Returns null when the user
 *  has no Canvas connected — callers MUST then skip the university_id filter (degrade to the
 *  prior unscoped behaviour) rather than filter on null (which would return zero rows). */
export async function userUniversityId(userId: string): Promise<string | null> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!url || !key || !userId) return null;
  try {
    const r = await fetch(
      `${url}/rest/v1/users?id=eq.${encodeURIComponent(userId)}&select=university_id,canvas_base_url&limit=1`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } },
    );
    if (!r.ok) return null;
    return deriveUniversityId(((await r.json()) as any[])[0]);
  } catch { return null; }
}

/** The derivation half of userUniversityId, as a pure function over an already-fetched
 *  users row. Callers that read the users row for other reasons (tutor-context needs
 *  brain_person_id on the same row) reuse it instead of issuing a second identical
 *  SELECT on the request's hot path — the rule itself stays defined in exactly one place. */
export function deriveUniversityId(row: any): string | null {
  // Sanitize to valid hostname chars only (strips stray chars like a trailing quote that would
  // fragment a school) — must match the write-side derivation in extension-content.ts.
  const clean = (h: string) => h.toLowerCase().replace(/[^a-z0-9.-]/g, "") || null;
  if (row?.university_id) return clean(String(row.university_id));
  if (row?.canvas_base_url) { try { return clean(new URL(row.canvas_base_url).hostname); } catch { /* fall through */ } }
  return null;
}

/** GET a Canvas REST path (relative to /api/v1) with the student's token. */
export async function canvasGET(creds: CanvasCreds, path: string, params: Record<string, any> = {}): Promise<any> {
  const url = new URL(`${creds.host}/api/v1${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v == null) continue;
    if (Array.isArray(v)) v.forEach((x) => url.searchParams.append(k, String(x)));
    else url.searchParams.set(k, String(v));
  }
  // Bounded fetch: a slow/unreachable Canvas must fail fast, never hang the tool loop
  // (an unbounded GET could stall a turn for a minute-plus).
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 12000);
  let r: Response;
  try {
    r = await fetch(url.toString(), { headers: { Authorization: `Bearer ${creds.token}` }, signal: ac.signal });
  } catch (e: any) {
    if (e?.name === "AbortError") throw new Error("Canvas timed out — it's slow or unreachable right now. Try again in a moment.");
    throw e;
  } finally {
    clearTimeout(timer);
  }
  if (!r.ok) {
    const body = (await r.text().catch(() => "")).slice(0, 200);
    if (r.status === 401) throw new Error("Canvas rejected the stored token — reconnect Canvas in the app.");
    if (r.status === 403) throw new Error("Canvas says this account can't access that (the course may restrict this tab).");
    if (r.status === 404) throw new Error("Canvas 404 — that course/resource doesn't exist or the tab is disabled.");
    throw new Error(`Canvas ${r.status}: ${body}`);
  }
  return r.json();
}

/** Resolve a course reference (name / code / canvas id) to its CANVAS course id using
 *  the synced courses table. Live-Canvas endpoints need the Canvas id, not the DB id. */
export async function resolveCanvasCourseId(userId: string, course: any): Promise<string> {
  if (course === undefined || course === null || course === "") throw new Error("course is required");
  const raw = String(course).trim();
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return raw;
  const r = await fetch(
    `${url}/rest/v1/courses?user_id=eq.${encodeURIComponent(userId)}&select=id,canvas_course_id,course_code,name`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } },
  );
  if (!r.ok) return raw;
  const rows: any[] = await r.json();
  const lc = raw.toLowerCase();
  // Numeric input can be a Canvas id OR the DB id (models pass both) — match either
  // against the synced table; unknown large numbers pass through (Canvas 404s if wrong).
  if (/^\d+$/.test(raw)) {
    const byCanvas = rows.find((c) => String(c.canvas_course_id) === raw);
    if (byCanvas) return raw;
    const byDbId = rows.find((c) => String(c.id) === raw);
    if (byDbId?.canvas_course_id) return String(byDbId.canvas_course_id);
    if (raw.length >= 4) return raw;
    throw new Error(`No synced course matches id "${raw}" — pass the course name or run a Canvas sync.`);
  }
  const hit =
    rows.find((c) => (c.course_code || "").toLowerCase() === lc || (c.name || "").toLowerCase() === lc) ||
    rows.find((c) => (c.name || "").toLowerCase().includes(lc) || (c.course_code || "").toLowerCase().includes(lc));
  if (!hit?.canvas_course_id) throw new Error(`No synced course matches "${raw}" — ask the student which course they mean (or run a Canvas sync).`);
  return String(hit.canvas_course_id);
}

/** All synced canvas course ids for the user (for cross-course reads like announcements). */
export async function allCanvasCourseIds(userId: string): Promise<string[]> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return [];
  const r = await fetch(
    `${url}/rest/v1/courses?user_id=eq.${encodeURIComponent(userId)}&select=canvas_course_id`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } },
  );
  if (!r.ok) return [];
  return ((await r.json()) as any[]).map((c) => c.canvas_course_id).filter(Boolean).map(String);
}

// ── Trimmers — compact, model-friendly shapes ────────────────────────────────

const CAP = 20;                      // max array items returned to the model
const BODY_CAP = 4000;               // max chars for a single HTML-ish body

export function stripHtml(html: string | null | undefined): string {
  if (!html) return "";
  return String(html)
    .replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>|<\/p>|<\/div>|<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, BODY_CAP);
}

export const trim = {
  announcements: (rows: any[]) => rows.slice(0, CAP).map((a) => ({
    courseContext: a.context_code ?? null, title: a.title ?? "", postedAt: a.posted_at ?? null,
    message: stripHtml(a.message).slice(0, 600),
  })),
  modules: (rows: any[]) => rows.slice(0, CAP).map((m) => ({
    name: m.name ?? "", state: m.state ?? null,
    items: (m.items ?? []).slice(0, 15).map((i: any) => ({ title: i.title ?? "", type: i.type ?? "" })),
  })),
  pagesIndex: (rows: any[]) => rows.slice(0, CAP).map((p) => ({ slug: p.url ?? "", title: p.title ?? "", updatedAt: p.updated_at ?? null })),
  page: (p: any) => ({ title: p.title ?? "", updatedAt: p.updated_at ?? null, body: stripHtml(p.body) }),
  quizzes: (rows: any[]) => rows.slice(0, CAP).map((q) => ({
    id: q.id, title: q.title ?? "", dueAt: q.due_at ?? null, points: q.points_possible ?? null, type: q.quiz_type ?? null, questionCount: q.question_count ?? null,
  })),
  submission: (s: any) => ({
    score: s.score ?? null, grade: s.grade ?? null, submittedAt: s.submitted_at ?? null,
    late: s.late ?? false, missing: s.missing ?? false,
    comments: (s.submission_comments ?? []).slice(0, 10).map((c: any) => ({ author: c.author_name ?? "", comment: (c.comment ?? "").slice(0, 500), at: c.created_at ?? null })),
    rubric: s.rubric_assessment
      ? Object.values(s.rubric_assessment as Record<string, any>).slice(0, 15).map((r: any) => ({ points: r.points ?? null, comments: (r.comments ?? "").slice(0, 300) }))
      : null,
  }),
  conversations: (rows: any[]) => rows.slice(0, CAP).map((c) => ({
    id: c.id, subject: c.subject ?? "", lastMessage: (c.last_message ?? "").slice(0, 300), at: c.last_message_at ?? null, state: c.workflow_state ?? null,
  })),
  conversation: (c: any) => ({
    subject: c.subject ?? "",
    messages: (c.messages ?? []).slice(0, 10).map((m: any) => ({ authorId: m.author_id ?? null, body: (m.body ?? "").slice(0, 500), at: m.created_at ?? null })),
  }),
  files: (rows: any[]) => rows.slice(0, CAP).map((f) => ({ id: f.id, name: f.display_name ?? f.filename ?? "", size: f.size ?? null, type: f["content-type"] ?? null, updatedAt: f.updated_at ?? null })),
  pastCourses: (rows: any[]) => rows.slice(0, 30).map((c) => ({
    canvasCourseId: c.id, name: c.name ?? "", code: c.course_code ?? null,
    finalScore: c.enrollments?.[0]?.computed_final_score ?? null, finalGrade: c.enrollments?.[0]?.computed_final_grade ?? null,
  })),
};

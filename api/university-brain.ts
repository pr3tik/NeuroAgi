// api/university-brain.ts — PROTOTYPE of the University Brain's k=1 content tier.
//
// The idea being proven: knowledge is keyed to CANONICAL ENTITIES (institution +
// canvas_course_id + professor), never to the contributing account — so what one
// student imports is instantly readable by a completely different account.
//
//   POST ?action=contribute { userId, course }
//     Pulls PUBLISHED artifacts from the student's own Canvas (syllabus body, teacher
//     names, grading-group weights), extracts MECHANICAL FACTS (no opinions — that's
//     the k>=10 behavioral tier, deliberately out of scope here), and upserts them
//     into the shared course_content library, deduped by content_hash. A second
//     contributor of the same artifact just increments seen_by_count.
//   POST ?action=profile { userId, course? , professor? }
//     Assembles the global profile from course_content for ANY user — the reader
//     needs no Canvas connection; course refs resolve through their own synced
//     courses table, professor refs match by name.
//
// Storage is the EXISTING course_content table (content_type 'syllabus'|'rubric',
// content_hash = sha256(university_id|course_id|content_type|text[:500]) — the same
// dedup convention as the extension). No schema changes; RLS stays as-is for the
// prototype (server writes via service key).
import crypto from "node:crypto";
import { callModel } from "./_gateway.js";
import { canvasCreds, canvasGET, resolveCanvasCourseId, stripHtml, trim, userUniversityId } from "./_reggie/canvasLive.js";
import { assertCourseFact } from "./course-fact-guard.js";
import { requireUserOr401 } from "./_auth.js";

function sb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase env vars not configured");
  return { url, headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" } as Record<string, string> };
}

const hashOf = (universityId: string, courseId: string, type: string, text: string) =>
  crypto.createHash("sha256").update(`${universityId}|${courseId}|${type}|${text.slice(0, 500)}`).digest("hex");

// ── BR-03 formatters (pure, deterministic — no LLM, no I/O) ──────────────────
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** ISO timestamp → "Oct 3" (UTC, deterministic). Falsy/invalid → "". */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
  if (!m) return "";
  const mon = MONTHS[Number(m[2]) - 1];
  return mon ? `${mon} ${Number(m[3])}` : "";
}

/** Merge assignments + quizzes into one dated schedule sentence. Only ever reads title/dueAt/points
 *  — any other field on an item (e.g. a quiz's question/answer) is unreachable here (BR-01). */
export function formatAssessmentSchedule(
  courseLabel: string,
  items: { title: string; dueAt: string | null; points: number | null }[],
): string | null {
  const clean = (items ?? [])
    .filter((i) => i && i.title)
    .map((i) => ({ title: String(i.title).trim(), dueAt: i.dueAt ?? null, points: i.points ?? null }))
    .sort((a, b) => (a.dueAt ?? "~").localeCompare(b.dueAt ?? "~")); // undated sorts last
  if (!clean.length) return null;
  const parts = clean.map((i) => {
    const meta = [fmtDate(i.dueAt), i.points != null ? `${i.points} pts` : ""].filter(Boolean).join(", ");
    return meta ? `${i.title} (${meta})` : i.title;
  });
  return `${courseLabel} assessment schedule: ${parts.join("; ")}.`;
}

/** Module names → numbered topic sequence + concepts[] (the topic titles). */
export function formatTopicSequence(
  courseLabel: string,
  modules: { name: string }[],
): { text: string; concepts: string[] } | null {
  const names = (modules ?? []).filter((m) => m && m.name).map((m) => String(m.name).trim());
  const concepts = [...new Set(names)].slice(0, 40);
  if (!concepts.length) return null;
  const text = `${courseLabel} topic sequence: ${concepts.map((n, i) => `${i + 1}. ${n}`).join(" · ")}.`;
  return { text, concepts };
}

/** Published file names → materials list sentence. Names only (BR-01: never file contents). */
export function formatPostedMaterials(
  courseLabel: string,
  files: { name: string }[],
): string | null {
  const names = [...new Set((files ?? []).filter((f) => f && f.name).map((f) => String(f.name).trim()))].slice(0, 60);
  if (!names.length) return null;
  return `${courseLabel} posted materials: ${names.join(", ")}.`;
}

/** Insert-or-bump one artifact. Returns { id, deduped } — deduped=true means another
 *  account (or a re-run) already contributed identical content. */
async function upsertArtifact(row: {
  university_id: string; course_id: string; canvas_course_id: string; content_type: string;
  text: string; professor_name: string | null; summary: string | null; concepts: string[] | null;
}) {
  const { url, headers } = sb();
  const content_hash = hashOf(row.university_id, row.course_id, row.content_type, row.text);
  const existing = await fetch(`${url}/rest/v1/course_content?content_hash=eq.${content_hash}&select=id,seen_by_count`, { headers });
  const hit = ((await existing.json().catch(() => [])) as any[])[0];
  if (hit) {
    await fetch(`${url}/rest/v1/course_content?id=eq.${hit.id}`, {
      method: "PATCH", headers,
      body: JSON.stringify({ seen_by_count: (hit.seen_by_count ?? 1) + 1, last_seen_at: new Date().toISOString() }),
    });
    return { id: hit.id, deduped: true };
  }
  const insertRow = assertCourseFact({ ...row, content_hash, is_private: false, text: row.text.slice(0, 50000), last_seen_at: new Date().toISOString() }, { screenText: false });
  const ins = await fetch(`${url}/rest/v1/course_content`, {
    method: "POST", headers: { ...headers, Prefer: "return=representation" },
    body: JSON.stringify(insertRow),
  });
  if (!ins.ok) throw new Error(`library insert failed (${ins.status}): ${(await ins.text()).slice(0, 200)}`);
  return { id: ((await ins.json()) as any[])[0]?.id, deduped: false };
}

// BR-03 — the fact categories the Course Brain aims to make demo-visible. Kept as a named list so
// the prompt and the tests describe the same contract.
export const EXTRACTION_CATEGORIES = [
  "grading breakdown / component weights",
  "late & makeup policy",
  "exam dates, times, and format",
  "topic or weekly schedule outline",
  "submission mechanics (how/where work is handed in, allowed formats, individual vs group)",
  "required / recommended materials",
  "office hours & contact method",
  "professor's PUBLISHED course-conduct style (only what the syllabus states about how the course runs)",
] as const;

const MAX_FACTS = 14;

const UB_SOURCE = "university-brain"; // sentinel: rows THIS endpoint owns (never clobber extension rows)

/** BR-03 snapshot upsert: exactly one current row per (university_id, course_id, content_type) that
 *  this endpoint owns (source_url = UB_SOURCE). Replaces on re-contribute; never duplicates, never
 *  touches extension-written rows of the same type. content_hash is namespaced ("snapshot:<type>")
 *  so it can never collide with an extension/artifact hash on the UNIQUE content_hash index. */
export async function upsertSnapshot(row: {
  university_id: string; course_id: string; canvas_course_id: string; content_type: string;
  text: string; professor_name: string | null; summary: string | null; concepts: string[] | null;
}): Promise<{ id: any; replaced: boolean }> {
  const { url, headers } = sb();
  const content_hash = hashOf(row.university_id, row.course_id, `snapshot:${row.content_type}`, row.text);
  const body = assertCourseFact({
    ...row, content_hash, source_url: UB_SOURCE, is_private: false,
    text: row.text.slice(0, 50000), last_seen_at: new Date().toISOString(),
  }, { screenText: false });
  const q = `${url}/rest/v1/course_content?university_id=eq.${encodeURIComponent(row.university_id)}` +
            `&course_id=eq.${encodeURIComponent(row.course_id)}` +
            `&content_type=eq.${encodeURIComponent(row.content_type)}` +
            `&source_url=eq.${encodeURIComponent(UB_SOURCE)}&select=id&limit=1`;
  const hit = ((await (await fetch(q, { headers })).json().catch(() => [])) as any[])[0];
  if (hit) {
    const upd = await fetch(`${url}/rest/v1/course_content?id=eq.${hit.id}`,
      { method: "PATCH", headers, body: JSON.stringify(body) });
    if (!upd.ok) throw new Error(`snapshot update failed (${upd.status}): ${(await upd.text()).slice(0, 200)}`);
    return { id: hit.id, replaced: true };
  }
  const ins = await fetch(`${url}/rest/v1/course_content`,
    { method: "POST", headers: { ...headers, Prefer: "return=representation" }, body: JSON.stringify(body) });
  if (!ins.ok) throw new Error(`snapshot insert failed (${ins.status}): ${(await ins.text()).slice(0, 200)}`);
  return { id: ((await ins.json()) as any[])[0]?.id, replaced: false };
}

/**
 * Mechanical-facts extraction — PUBLISHED facts only, never judgments. Broadened for BR-03 to the
 * demo-visible fact set in EXTRACTION_CATEGORIES (adds exam dates, the schedule outline, submission
 * mechanics, and the professor's published course-conduct style to the original grading/late/office
 * set). Guardrails, unchanged in spirit and made explicit: only what the professor PUBLISHED; never
 * opinions, difficulty judgments, or professor-quality commentary; never student-derived or aggregate
 * claims ("students find X hard" is the blocked k>=10 tier); and paraphrase — facts over verbatim
 * quotes (copyright, spec §10.2). Exported for unit testing of the parse/shape path.
 */
export async function extractFacts(syllabusText: string): Promise<{ summary: string | null; concepts: string[] | null }> {
  if (!syllabusText || syllabusText.length < 80) return { summary: null, concepts: null };
  const r = await callModel({
    task: "summarize", max_tokens: 700,
    system:
      "You extract MECHANICAL, PUBLISHED FACTS from a course syllabus for a shared course library. " +
      "Cover, WHEN PRESENT: " + EXTRACTION_CATEGORIES.map((c, i) => `(${i + 1}) ${c}`).join(", ") + ". " +
      "HARD RULES: only facts the professor actually PUBLISHED — never opinions, difficulty judgments, or commentary " +
      "about the professor's quality; never student-derived or aggregate claims (e.g. 'students find this hard' is forbidden); " +
      "paraphrase into short factual statements — do NOT copy sentences verbatim (facts over quotation). " +
      "Each fact must be self-contained (include the number/date/component it refers to). " +
      `Reply as JSON only: {"summary":"2-4 sentences of the key mechanics","facts":["fact 1","fact 2",...]} (max ${MAX_FACTS} facts).`,
    messages: [{ role: "user", content: syllabusText.slice(0, 16000) }],
    metadata: { tool: "university-brain.extract" },
  });
  if (!r.ok) return { summary: null, concepts: null };
  try {
    const m = r.content.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(m ? m[0] : r.content);
    // Tolerate a model that returns objects instead of strings ({fact|text|...}); coerce to strings
    // so course_content.concepts stays a clean string[] and profile()'s flatten keeps working.
    const facts = Array.isArray(parsed.facts)
      ? parsed.facts
          .map((f: any) => (typeof f === "string" ? f : String(f?.fact ?? f?.text ?? f?.value ?? "")))
          .map((s: string) => s.trim())
          .filter(Boolean)
          .slice(0, MAX_FACTS)
      : null;
    return { summary: parsed.summary ?? null, concepts: facts && facts.length ? facts : null };
  } catch { return { summary: r.content.slice(0, 500), concepts: null }; }
}

async function contribute(res: any, userId: string, course: any) {
  const creds = await canvasCreds(userId);                     // contributor's own token
  const canvasCourseId = await resolveCanvasCourseId(userId, course);
  // Canonical institution key — normalized so a WRITE (here) and a READ (profile) agree by
  // construction. No-op on hosts the old `new URL(creds.host).hostname` path already produced.
  const universityId = new URL(creds.host).hostname;           // canonical institution key
  const c = await canvasGET(creds, `/courses/${canvasCourseId}`, { "include[]": ["syllabus_body", "teachers"] });
  const professors = (c.teachers ?? []).map((t: any) => t.display_name).filter(Boolean);
  const professor = professors[0] ?? null;
  const courseKey = c.course_code ?? String(canvasCourseId);

  const contributed: any[] = [];

  // Artifact 1: the syllabus (published by the professor).
  const syllabus = stripHtml(c.syllabus_body);
  if (syllabus && syllabus.length >= 80) {
    const { summary, concepts } = await extractFacts(syllabus);
    contributed.push({ type: "syllabus", ...(await upsertArtifact({
      university_id: universityId, course_id: courseKey, canvas_course_id: String(canvasCourseId),
      content_type: "syllabus", text: syllabus, professor_name: professor, summary, concepts,
    })) });
  }

  // Artifact 2: the grading structure (assignment-group weights — published data).
  try {
    const groups = await canvasGET(creds, `/courses/${canvasCourseId}/assignment_groups`, { "include[]": "group_weight", per_page: 50 });
    const weighted = (groups ?? []).map((g: any) => ({ name: g.name, weight: g.group_weight ?? 0 }));
    if (weighted.length) {
      const text = `Grading structure for ${c.name ?? courseKey}: ` + weighted.map((w: any) => `${w.name} — ${w.weight}%`).join("; ");
      contributed.push({ type: "rubric", ...(await upsertArtifact({
        university_id: universityId, course_id: courseKey, canvas_course_id: String(canvasCourseId),
        content_type: "rubric", text, professor_name: professor,
        summary: text.slice(0, 300), concepts: null,
      })) });
    }
  } catch { /* groups tab may be restricted — syllabus alone is still a contribution */ }

  // Artifact 3: assessment schedule (assignments + quizzes — published dates/points only).
  try {
    const [assignments, quizzes] = await Promise.all([
      canvasGET(creds, `/courses/${canvasCourseId}/assignments`, { per_page: 100 }).catch(() => []),
      canvasGET(creds, `/courses/${canvasCourseId}/quizzes`, { per_page: 100 }).catch(() => []),
    ]);
    const items = [
      ...((assignments ?? []) as any[]).map((a) => ({ title: a.name, dueAt: a.due_at ?? null, points: a.points_possible ?? null })),
      ...trim.quizzes(quizzes ?? []).map((q) => ({ title: q.title, dueAt: q.dueAt, points: q.points })),
    ];
    const text = formatAssessmentSchedule(courseKey, items);
    if (text) contributed.push({ type: "assessment", ...(await upsertSnapshot({
      university_id: universityId, course_id: courseKey, canvas_course_id: String(canvasCourseId),
      content_type: "assessment", text, professor_name: professor, summary: text.slice(0, 300), concepts: null,
    })) });
  } catch { /* assignments/quizzes tab restricted — other artifacts still contribute */ }

  // Artifact 4: topic sequence (module structure — published course map).
  try {
    const modules = await canvasGET(creds, `/courses/${canvasCourseId}/modules`, { "include[]": "items", per_page: 50 });
    const seq = formatTopicSequence(courseKey, trim.modules(modules ?? []));
    if (seq) contributed.push({ type: "module", ...(await upsertSnapshot({
      university_id: universityId, course_id: courseKey, canvas_course_id: String(canvasCourseId),
      content_type: "module", text: seq.text, professor_name: professor, summary: seq.text.slice(0, 300), concepts: seq.concepts,
    })) });
  } catch { /* modules tab restricted */ }

  // Artifact 5: posted materials (published file names only — an index, not contents).
  try {
    const files = await canvasGET(creds, `/courses/${canvasCourseId}/files`, { per_page: 50 });
    const text = formatPostedMaterials(courseKey, trim.files(files ?? []).map((f: any) => ({ name: f.name })));
    if (text) contributed.push({ type: "file", ...(await upsertSnapshot({
      university_id: universityId, course_id: courseKey, canvas_course_id: String(canvasCourseId),
      content_type: "file", text, professor_name: professor, summary: text.slice(0, 300), concepts: null,
    })) });
  } catch { /* files tab restricted */ }

  if (!contributed.length) {
    return res.status(200).json({ ok: true, contributed: [], professor, course: c.name ?? courseKey, note: "No published artifacts found for this course (empty syllabus, restricted tabs)." });
  }
  return res.status(200).json({ ok: true, contributed, professor, professors, course: c.name ?? courseKey, universityId, canvasCourseId });
}

async function profile(res: any, userId: string, course: any, professor: any) {
  const { url, headers } = sb();
  let rows: any[] = [];
  let scope = "";
  // BR-02 (Gap 8): scope every course_content read to the caller's own institution so a
  // course/professor lookup can't surface another school's facts. Degrade to unscoped when the
  // caller has no Canvas connected (uni === null) — the professor read below otherwise matched
  // EVERY "Prof <name>" on the whole platform.
  const uni = await userUniversityId(userId);
  const uniFilter = uni ? `&university_id=eq.${encodeURIComponent(uni)}` : "";
  if (course != null && course !== "") {
    // Resolve through the READER's own synced courses — no Canvas token needed.
    const canvasCourseId = await resolveCanvasCourseId(userId, course);
    scope = `course ${canvasCourseId}`;
    const r = await fetch(`${url}/rest/v1/course_content?canvas_course_id=eq.${encodeURIComponent(String(canvasCourseId))}${uniFilter}&is_private=not.is.true&select=content_type,professor_name,summary,concepts,seen_by_count,last_seen_at&order=last_seen_at.desc.nullslast&limit=20`, { headers });
    if (!r.ok) throw new Error(`library read failed (${r.status}): ${(await r.text()).slice(0, 150)}`);
    rows = await r.json();
  } else if (professor) {
    // Normalize: strip honorifics ("Professor Kepe" must match "Thembela Kepe"), and if
    // the full query misses, retry on the last name alone.
    const name = String(professor).replace(/\b(professor|prof\.?|dr\.?|mr\.?|ms\.?|mrs\.?)\b/gi, "").trim();
    scope = `professor ${name || professor}`;
    const search = async (q: string) => {
      const r = await fetch(`${url}/rest/v1/course_content?professor_name=ilike.${encodeURIComponent("*" + q + "*")}${uniFilter}&is_private=not.is.true&select=content_type,professor_name,summary,concepts,seen_by_count,last_seen_at,course_id,canvas_course_id&order=last_seen_at.desc.nullslast&limit=30`, { headers });
      if (!r.ok) throw new Error(`library read failed (${r.status}): ${(await r.text()).slice(0, 150)}`);
      return r.json();
    };
    rows = await search(name || String(professor));
    if (!rows.length && name.includes(" ")) rows = await search(name.split(/\s+/).pop() as string);
  } else {
    return res.status(400).json({ error: "course or professor is required" });
  }

  if (!rows.length) {
    return res.status(200).json({ ok: true, found: false, scope, note: "The university brain has nothing on this yet — be the first to contribute (action=contribute)." });
  }
  const professors = [...new Set(rows.map((r) => r.professor_name).filter(Boolean))];
  const facts = [...new Set(rows.flatMap((r) => (Array.isArray(r.concepts) ? r.concepts : [])))].slice(0, 16);
  const summaries = rows.map((r) => r.summary).filter(Boolean).slice(0, 4);
  const contributors = Math.max(...rows.map((r) => r.seen_by_count ?? 1));
  return res.status(200).json({
    ok: true, found: true, scope, professors, facts, summaries,
    artifacts: rows.map((r) => ({ type: r.content_type, course: r.course_id ?? undefined })),
    crowd: { artifactCount: rows.length, maxSeenBy: contributors },
  });
}

export default async function handler(req: any, res: any) {
  res.setHeader?.("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const _uid = await requireUserOr401(req, res); if (!_uid) return;
  if (req.body && typeof req.body === "object") req.body.userId = _uid;
  const action = req.query?.action ?? req.body?.action;
  const { userId, course = null, professor = null } = req.body ?? {};
  if (!userId) return res.status(400).json({ error: "userId is required" });
  try {
    if (action === "contribute") {
      if (course == null || course === "") return res.status(400).json({ error: "course is required" });
      return await contribute(res, userId, course);
    }
    if (action === "profile") return await profile(res, userId, course, professor);
    return res.status(400).json({ error: "Unknown action. Use contribute or profile." });
  } catch (e: any) {
    return res.status(502).json({ error: e?.message ?? "university-brain failed" });
  }
}

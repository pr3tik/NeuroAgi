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
import { canvasCreds, canvasGET, resolveCanvasCourseId, stripHtml, userUniversityId } from "./_reggie/canvasLive.js";
import { requireUserOr401 } from "./_auth.js";

function sb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase env vars not configured");
  return { url, headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" } as Record<string, string> };
}

const hashOf = (universityId: string, courseId: string, type: string, text: string) =>
  crypto.createHash("sha256").update(`${universityId}|${courseId}|${type}|${text.slice(0, 500)}`).digest("hex");

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
  const ins = await fetch(`${url}/rest/v1/course_content`, {
    method: "POST", headers: { ...headers, Prefer: "return=representation" },
    body: JSON.stringify({ ...row, content_hash, is_private: false, text: row.text.slice(0, 50000), last_seen_at: new Date().toISOString() }),
  });
  if (!ins.ok) throw new Error(`library insert failed (${ins.status}): ${(await ins.text()).slice(0, 200)}`);
  return { id: ((await ins.json()) as any[])[0]?.id, deduped: false };
}

/** Mechanical-facts extraction: published policies only, never judgments. */
async function extractFacts(syllabusText: string): Promise<{ summary: string | null; concepts: string[] | null }> {
  if (!syllabusText || syllabusText.length < 80) return { summary: null, concepts: null };
  const r = await callModel({
    task: "summarize", max_tokens: 400,
    system:
      "Extract MECHANICAL FACTS from this course syllabus: grading breakdown, late policy, exam format/dates, attendance rules, contact/office hours, required materials. " +
      "Rules: facts the professor PUBLISHED only — never opinions, difficulty judgments, or commentary about the professor. " +
      'Reply as JSON: {"summary":"2-3 sentences of the key policies","facts":["fact 1","fact 2",...]} (max 8 facts).',
    messages: [{ role: "user", content: syllabusText.slice(0, 12000) }],
    metadata: { tool: "university-brain.extract" },
  });
  if (!r.ok) return { summary: null, concepts: null };
  try {
    const m = r.content.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(m ? m[0] : r.content);
    return { summary: parsed.summary ?? null, concepts: Array.isArray(parsed.facts) ? parsed.facts.slice(0, 8) : null };
  } catch { return { summary: r.content.slice(0, 400), concepts: null }; }
}

async function contribute(res: any, userId: string, course: any) {
  const creds = await canvasCreds(userId);                     // contributor's own token
  const canvasCourseId = await resolveCanvasCourseId(userId, course);
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

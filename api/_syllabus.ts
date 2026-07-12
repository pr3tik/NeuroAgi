// api/_syllabus.ts — syllabus → structured course deadlines (link ② of the MVP core loop).
//
// The primary upload path (Files page → /api/extract) previously only RAG-indexed a
// syllabus; the structured course/assignment extraction lived solely behind the Canvas
// "+" ManualUploadSheet (client-side, 20-page pdfjs cap). This module promotes that
// parse to the server so ANY course-tagged upload feeds the task generator:
//   parseSyllabusStructure(text)         → LLM extract {courseName, courseCode, assignments[]}
//   syllabusRows(userId, courseId, ...)  → idempotent `assignments` upsert rows
//
// Rows use a deterministic canvas_assignment_id (`syl:<courseId>:<slug>`), so re-uploading
// the same syllabus UPSERTs (onConflict user_id,canvas_assignment_id) instead of duplicating.
// source='manual' matches how loadCanvasData maps non-Canvas assignments (courseId = DB id).

export type SyllabusAssignment = { name: string; dueDate: string | null; pointsPossible: number | null };
export type SyllabusStructure = {
  isSyllabus: boolean;
  courseName: string | null;
  courseCode: string | null;
  assignments: SyllabusAssignment[];
};

const MAX_ITEMS = 60;      // sanity cap — no real syllabus has more graded items
const MAX_CHARS = 24_000;  // ~6k tokens of syllabus text is plenty for the schedule table

/** LLM parse. Returns null when unconfigured/unparseable — callers treat that as "no structure". */
export async function parseSyllabusStructure(text: string, filename?: string): Promise<SyllabusStructure | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key || !text?.trim()) return null;

  const today = new Date().toISOString().slice(0, 10);
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method:  "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      max_tokens: 2048,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            `You extract structured course data from documents. Today is ${today}. ` +
            `Return ONLY JSON: {"is_syllabus": boolean, "course_name": string|null, "course_code": string|null, ` +
            `"assignments": [{"name": string, "due_date": string|null, "points_possible": number|null}]}. ` +
            `Rules: is_syllabus is true only if the document is a course syllabus/outline/assignment schedule. ` +
            `Include only GRADED deliverables (assignments, quizzes, exams, projects, papers) — not lecture topics or readings. ` +
            `due_date must be ISO 8601 (YYYY-MM-DD); infer the year from semester context in the document ` +
            `(e.g. "Fall 2026"), never invent dates — use null when no date is given. ` +
            `If the document is not a syllabus, return {"is_syllabus": false, "course_name": null, "course_code": null, "assignments": []}.`,
        },
        { role: "user", content: `${filename ? `Filename: ${filename}\n\n` : ""}${text.slice(0, MAX_CHARS)}` },
      ],
    }),
  });
  if (!res.ok) throw new Error(`syllabus parse: OpenAI ${res.status}`);
  const data = await res.json();
  let parsed: any;
  try { parsed = JSON.parse(data.choices?.[0]?.message?.content ?? ""); } catch { return null; }
  if (!parsed || typeof parsed !== "object") return null;

  const assignments: SyllabusAssignment[] = (Array.isArray(parsed.assignments) ? parsed.assignments : [])
    .map((a: any) => {
      const name = String(a?.name ?? "").trim().slice(0, 200);
      if (!name) return null;
      let dueDate: string | null = null;
      if (a?.due_date) {
        const d = new Date(a.due_date);
        if (!isNaN(+d)) dueDate = d.toISOString();
      }
      const p = Number(a?.points_possible);
      return { name, dueDate, pointsPossible: Number.isFinite(p) && p >= 0 ? p : null };
    })
    .filter(Boolean)
    .slice(0, MAX_ITEMS) as SyllabusAssignment[];

  return {
    isSyllabus: !!parsed.is_syllabus,
    courseName: parsed.course_name ? String(parsed.course_name).slice(0, 200) : null,
    courseCode: parsed.course_code ? String(parsed.course_code).slice(0, 60) : null,
    assignments,
  };
}

/** Build idempotent `assignments` rows. Deterministic ids → re-upload upserts, never duplicates.
 *  Slug collisions within one batch get a numeric suffix (a single upsert can't touch the
 *  same conflict key twice — Postgres rejects the whole batch otherwise). */
export function syllabusRows(userId: string, courseId: any, assignments: SyllabusAssignment[]) {
  const seen = new Map<string, number>();
  return assignments.map((a) => {
    const base = a.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "item";
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    const slug = n === 1 ? base : `${base}-${n}`;
    return {
      user_id:              userId,
      course_id:            courseId,
      canvas_assignment_id: `syl:${courseId}:${slug}`,
      title:                a.name,
      due_at:               a.dueDate,
      points_possible:      a.pointsPossible,
      source:               "manual",   // load path: source==='manual' → courseId = course_id (DB id)
      updated_at:           new Date().toISOString(),
    };
  });
}

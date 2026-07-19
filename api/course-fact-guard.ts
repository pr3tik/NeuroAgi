// api/course-fact-guard.ts
// BR-06 write-boundary guard: the ONLY sanctioned gate for writes to the shared
// course_content table. Rebuilds each row from an allowlist and fail-closed rejects
// anything that looks person-scoped. Pure + dependency-free so it's trivially testable.

export class CourseFactRejected extends Error {
  constructor(public reason: string) {
    super(`course_content write rejected: ${reason}`);
    this.name = "CourseFactRejected";
  }
}

const ALLOWED_FIELDS = [
  "university_id", "course_id", "canvas_course_id", "content_type", "content_hash",
  "text", "summary", "concepts", "week_number", "module_name", "professor_name",
  "source_url", "seen_by_count", "is_private", "last_seen_at",
] as const;

const ALLOWED_CONTENT_TYPES = new Set([
  "syllabus", "lecture", "rubric", "announcement", "module", "file", "assessment",
]);

// Bare column names that only appear on PERSON tables — their presence signals a
// mis-routed person payload, so we reject rather than silently drop.
const PERSON_LINKING_KEYS = new Set([
  "user_id", "person_id", "student_name", "score", "grade", "submitted_at",
]);

// High-signal person-data text patterns. Deliberately narrow so professor facts
// (grading breakdowns like "Grading: midterm 40%", "you will submit online") still pass.
const PERSON_TEXT_PATTERNS: RegExp[] = [
  /\byour\s+(grade|score|submission|mark)\b/i,
  /\byou\s+(scored|submitted|received)\b/i,
  /\bsubmitted\s+(at|on)\b/i,
  /\blate\s+submission\b/i,
  /\b\d{1,3}\s*\/\s*\d{1,3}\b.{0,20}\b(score|grade|points|mark|result)\b/i,
  /\b(score|grade|points|mark|result)\b.{0,20}\b\d{1,3}\s*\/\s*\d{1,3}\b/i,
  /\b\d{1,3}\s+out of\s+\d{1,3}\b.{0,20}\b(score|grade|points|mark|result)\b/i,
  /\b(score|grade|points|mark|result)\b.{0,20}\b\d{1,3}\s+out of\s+\d{1,3}\b/i,
  /\b(score|grade|mark|result)\b\s*:?\s*\d{1,3}\s?%/i,
  /\byour\b.{0,20}\b\d{1,3}\s?%/i,
];

// Fields that are stored AND served to other students — every one must be screened,
// not just text/summary (person data hides just as well in a module or professor name).
const SCREENED_FIELDS = ["text", "summary", "module_name", "professor_name"] as const;

function screenPersonData(input: Record<string, unknown>): void {
  const parts: string[] = [];
  for (const f of SCREENED_FIELDS) {
    if (typeof (input as any)[f] === "string") parts.push((input as any)[f] as string);
  }
  if (Array.isArray(input.concepts)) parts.push((input.concepts as unknown[]).map(String).join(" "));
  const haystack = parts.join("\n");
  for (const re of PERSON_TEXT_PATTERNS) {
    if (re.test(haystack)) throw new CourseFactRejected(`person-data text pattern: ${re}`);
  }
  // grade-table shape: >=3 lines like "Label | 18 | 20"
  const rows = haystack.split("\n").filter((l) => /\S+\s*\|\s*\d{1,3}\s*\|\s*\d{1,3}/.test(l)).length;
  if (rows >= 3) throw new CourseFactRejected("grade-table shape");
}

/**
 * Guard a prospective course_content row. Returns a rebuilt allowlisted row, or throws
 * CourseFactRejected. `opts.screenText` (default true) runs the heuristic person-data text
 * screen — pass false ONLY for the TRUSTED deterministic university-brain formatter door,
 * where professor policy language ("late submissions penalized", "participation grade: 10%")
 * is legitimate and the structural allowlist is the guarantee.
 */
export function assertCourseFact(
  input: Record<string, unknown>,
  opts: { screenText?: boolean } = {},
): Record<string, unknown> {
  if (!input || typeof input !== "object") throw new CourseFactRejected("not an object");

  // 1. person-linking keys → reject
  for (const k of Object.keys(input)) {
    if (PERSON_LINKING_KEYS.has(k) || /^submission/i.test(k)) {
      throw new CourseFactRejected(`person-linking key present: ${k}`);
    }
  }

  // 2. content_type allowlist
  const ct = input.content_type;
  if (typeof ct !== "string" || !ALLOWED_CONTENT_TYPES.has(ct)) {
    throw new CourseFactRejected(`content_type not allowed: ${String(ct)}`);
  }

  // 3. is_private must not be true — the guard writes professor facts only
  if (input.is_private === true || input.is_private === "true") {
    throw new CourseFactRejected("is_private:true not permitted in shared table");
  }

  // 3b. person-data text screen (heuristic) across ALL served free-text fields
  if (opts.screenText ?? true) screenPersonData(input);

  // 4. rebuild from allowlist + force is_private=false
  const clean: Record<string, unknown> = {};
  for (const f of ALLOWED_FIELDS) {
    if (f in input && (input as any)[f] !== undefined) clean[f] = (input as any)[f];
  }
  clean.is_private = false;
  return clean;
}

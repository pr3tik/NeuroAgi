// courseId.ts — shared helper for the "courseId may be a DB uuid OR a Canvas course id"
// tool inputs. courses.id is a uuid; courses.canvas_course_id is text.
//
// Filtering the uuid column with a NON-uuid literal makes Postgres throw 22P02
// ("invalid input syntax for type uuid") and PostgREST 400s the WHOLE query. Crucially,
// an `or=(id.eq.X,canvas_course_id.eq.X)` does NOT rescue it: the bad constant cast
// fails at parse/plan time, before any row — or the other OR branch — is evaluated. So
// we branch on the SHAPE of the id and emit exactly one safe filter.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): boolean {
  return typeof v === "string" && UUID_RE.test(v);
}

/** A single PostgREST filter matching a course by whichever id space `courseId` is in:
 *  `id=eq.<uuid>` for a uuid, else `canvas_course_id=eq.<value>`. Value is URL-encoded.
 *  Never emits `id.eq` against a non-uuid (which would 400 the query). */
export function courseFilter(courseId: string | number): string {
  const raw = String(courseId);
  const col = isUuid(raw) ? "id" : "canvas_course_id";
  return `${col}=eq.${encodeURIComponent(raw)}`;
}

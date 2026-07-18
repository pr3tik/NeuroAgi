// api/course-source.ts — BR-05: how a shared course_content row is ranked + labeled when
// grounding the tutor. Pure so it's unit-testable and reusable by tutor-context / room grounding.

// Relevance boost by artifact type (professor-published course facts). Higher = surfaced sooner.
// syllabus/lecture/announcement preserve the tutor's existing weights; assessment/module/file are
// the BR-03 additions so that extraction actually reaches the tutor.
const TYPE_BOOST: Record<string, number> = {
  syllabus: 5,
  assessment: 4,
  lecture: 3,
  module: 3,
  announcement: 2,
  file: 1,
};

export function courseSourceBoost(contentType: string): number {
  return TYPE_BOOST[contentType] ?? 0;
}

// Friendly source label for a grounded snippet / chip.
export function courseSourceLabel(
  row: { content_type: string; week_number?: number | null; module_name?: string | null },
): string {
  switch (row.content_type) {
    case "syllabus":     return "Course Syllabus";
    case "lecture":      return `Lecture Notes${row.week_number ? ` (Week ${row.week_number})` : ""}${row.module_name ? ` — ${row.module_name}` : ""}`;
    case "announcement": return "Course Announcement";
    case "assessment":   return "Assessment Schedule";
    case "module":       return `Course Topics${row.module_name ? ` — ${row.module_name}` : ""}`;
    case "file":         return "Posted Materials";
    default:             return row.content_type;
  }
}

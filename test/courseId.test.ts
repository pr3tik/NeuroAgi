import { describe, it, expect } from "vitest";
import { isUuid, courseFilter } from "../src/lib/courseId";

describe("courseId helper", () => {
  it("recognizes uuids and rejects Canvas numeric ids", () => {
    expect(isUuid("11111111-2222-3333-4444-555555555555")).toBe(true);
    expect(isUuid("98765")).toBe(false);
    expect(isUuid(98765 as any)).toBe(false); // numbers are never uuids
    expect(isUuid("not-a-uuid")).toBe(false);
  });

  it("filters a uuid via id=eq (safe against the uuid column)", () => {
    expect(courseFilter("11111111-2222-3333-4444-555555555555"))
      .toBe("id=eq.11111111-2222-3333-4444-555555555555");
  });

  it("filters a Canvas id via canvas_course_id=eq (NEVER id.eq → no uuid-cast 400)", () => {
    expect(courseFilter("98765")).toBe("canvas_course_id=eq.98765");
    expect(courseFilter(98765)).toBe("canvas_course_id=eq.98765");
    expect(courseFilter("98765").startsWith("id=eq")).toBe(false); // not the uuid branch
  });
});

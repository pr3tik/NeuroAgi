import { describe, it, expect } from "vitest";
import { courseSourceBoost, courseSourceLabel } from "../api/course-source";

describe("courseSourceBoost", () => {
  it("preserves the tutor's existing boosts", () => {
    expect(courseSourceBoost("syllabus")).toBe(5);
    expect(courseSourceBoost("lecture")).toBe(3);
    expect(courseSourceBoost("announcement")).toBe(2);
  });
  it("surfaces BR-03 artifact types", () => {
    expect(courseSourceBoost("assessment")).toBe(4);
    expect(courseSourceBoost("module")).toBe(3);
    expect(courseSourceBoost("file")).toBe(1);
  });
  it("returns 0 for an unknown type", () => {
    expect(courseSourceBoost("mystery")).toBe(0);
  });
});

describe("courseSourceLabel", () => {
  it("keeps the existing labels", () => {
    expect(courseSourceLabel({ content_type: "syllabus" })).toBe("Course Syllabus");
    expect(courseSourceLabel({ content_type: "lecture", week_number: 5 })).toBe("Lecture Notes (Week 5)");
    expect(courseSourceLabel({ content_type: "lecture", week_number: 5, module_name: "Cells" })).toBe("Lecture Notes (Week 5) — Cells");
    expect(courseSourceLabel({ content_type: "announcement" })).toBe("Course Announcement");
  });
  it("labels the BR-03 types", () => {
    expect(courseSourceLabel({ content_type: "assessment" })).toBe("Assessment Schedule");
    expect(courseSourceLabel({ content_type: "module", module_name: "Unit 2" })).toBe("Course Topics — Unit 2");
    expect(courseSourceLabel({ content_type: "file" })).toBe("Posted Materials");
  });
  it("falls back to the raw type when unknown", () => {
    expect(courseSourceLabel({ content_type: "weird" })).toBe("weird");
  });
});

import { describe, it, expect } from "vitest";
import { assertCourseFact, CourseFactRejected } from "../api/course-fact-guard";

const base = {
  university_id: "q.utoronto.ca", course_id: "BIO130", canvas_course_id: "123",
  content_type: "syllabus", content_hash: "abc",
  text: "Grading breakdown: midterm 40%, final 60%. Office hours Tue 2pm.",
};

describe("assertCourseFact — field allowlist", () => {
  it("drops non-allowlisted keys, keeps allowlisted ones", () => {
    const out = assertCourseFact({ ...base, bogus: "x", internal_note: "y" });
    expect(out).not.toHaveProperty("bogus");
    expect(out).not.toHaveProperty("internal_note");
    expect(out.university_id).toBe("q.utoronto.ca");
    expect(out.content_hash).toBe("abc");
  });
  it("rejects person-linking keys (mis-routed person payload)", () => {
    expect(() => assertCourseFact({ ...base, user_id: "u1" })).toThrow(CourseFactRejected);
    expect(() => assertCourseFact({ ...base, score: 18 })).toThrow(CourseFactRejected);
    expect(() => assertCourseFact({ ...base, submitted_at: "2026-01-01" })).toThrow(CourseFactRejected);
    expect(() => assertCourseFact({ ...base, submission_id: "s1" })).toThrow(CourseFactRejected);
  });
});

describe("assertCourseFact — content_type allowlist", () => {
  it("passes every allowed type", () => {
    for (const ct of ["syllabus","lecture","rubric","announcement","module","file","assessment"])
      expect(assertCourseFact({ ...base, content_type: ct }).content_type).toBe(ct);
  });
  it("rejects an unknown type", () => {
    expect(() => assertCourseFact({ ...base, content_type: "grades" })).toThrow(CourseFactRejected);
    expect(() => assertCourseFact({ ...base, content_type: undefined })).toThrow(CourseFactRejected);
  });
});

describe("assertCourseFact — is_private", () => {
  it("forces is_private=false on clean input", () => {
    expect(assertCourseFact(base).is_private).toBe(false);
  });
  it("rejects an explicit is_private=true", () => {
    expect(() => assertCourseFact({ ...base, is_private: true })).toThrow(CourseFactRejected);
  });
});

describe("assertCourseFact — person-data text screen", () => {
  it("rejects numeric grade patterns", () => {
    expect(() => assertCourseFact({ ...base, text: "Assignment 1 score 18/20" })).toThrow(CourseFactRejected);
    expect(() => assertCourseFact({ ...base, text: "Your grade: 82% on the midterm" })).toThrow(CourseFactRejected);
  });
  it("rejects submission / result language", () => {
    expect(() => assertCourseFact({ ...base, text: "You submitted at 11:59pm — late submission" })).toThrow(CourseFactRejected);
    expect(() => assertCourseFact({ ...base, text: "your submission was received" })).toThrow(CourseFactRejected);
  });
  it("passes clean professor text — incl. 'you will submit' and a grading breakdown", () => {
    expect(() => assertCourseFact({ ...base, text: "You will submit assignments online via the portal." })).not.toThrow();
    expect(() => assertCourseFact({ ...base, text: "Grading breakdown: midterm 40%, final 60%, participation 10%." })).not.toThrow();
    expect(() => assertCourseFact({ ...base, text: "Topics: cells, membranes, ATP. Midterm covers weeks 1-6." })).not.toThrow();
  });
});

describe("assertCourseFact — B1: screens ALL served fields (not just text/summary)", () => {
  it("rejects person data hidden in module_name / professor_name / concepts", () => {
    expect(() => assertCourseFact({ ...base, content_type: "module", text: "Week 5 module overview and readings.", module_name: "your grade: 18/20" })).toThrow(CourseFactRejected);
    expect(() => assertCourseFact({ ...base, professor_name: "grade: 45%" })).toThrow(CourseFactRejected);
    expect(() => assertCourseFact({ ...base, concepts: ["score 3/10"] })).toThrow(CourseFactRejected);
  });
  it("still passes clean module_name / professor_name / concepts", () => {
    expect(() => assertCourseFact({ ...base, content_type: "module", text: "Week 5 module overview and readings.", module_name: "Week 5: Cell Biology", professor_name: "Dr. Bob Lee", concepts: ["cells", "membranes"] })).not.toThrow();
  });
});

describe("assertCourseFact — B2: grade-table / percent / out-of patterns", () => {
  it("rejects a grade-table shape (>=3 rows)", () => {
    expect(() => assertCourseFact({ ...base, text: "HW1 | 18 | 20\nHW2 | 15 | 20\nQuiz | 9 | 10" })).toThrow(CourseFactRejected);
  });
  it("rejects a percentage next to a grade keyword", () => {
    expect(() => assertCourseFact({ ...base, text: "Final grade: 82%" })).toThrow(CourseFactRejected);
  });
  it("rejects 'N out of N' near a grade keyword", () => {
    expect(() => assertCourseFact({ ...base, text: "Alice's score was 18 out of 20" })).toThrow(CourseFactRejected);
  });
});

describe("assertCourseFact — D1: trusted door (screenText:false) skips the heuristic", () => {
  const policy = "Late submissions penalized 10%/day. Participation grade: 10%.";
  it("passes legit grading-policy language when screenText:false", () => {
    expect(() => assertCourseFact({ ...base, content_type: "syllabus", text: policy }, { screenText: false })).not.toThrow();
  });
  it("but the SAME text is rejected on an untrusted door (default screenText)", () => {
    expect(() => assertCourseFact({ ...base, content_type: "syllabus", text: policy })).toThrow(CourseFactRejected);
  });
});

import { describe, it, expect } from "vitest";
import { scoreToGpa, coursesToGpa } from "../src/lib/gpa";

describe("scoreToGpa", () => {
  it("maps percentage bands to the 4.0 ladder", () => {
    expect(scoreToGpa(95)).toBe(4.0);
    expect(scoreToGpa(90)).toBe(4.0);
    expect(scoreToGpa(89.9)).toBe(3.7);
    expect(scoreToGpa(85)).toBe(3.7);
    expect(scoreToGpa(80)).toBe(3.3);
    expect(scoreToGpa(75)).toBe(3.0);
    expect(scoreToGpa(70)).toBe(2.7);
    expect(scoreToGpa(65)).toBe(2.3);
    expect(scoreToGpa(60)).toBe(2.0);
    expect(scoreToGpa(59)).toBe(1.0);
    expect(scoreToGpa(0)).toBe(1.0);
  });
});

describe("coursesToGpa", () => {
  it("returns null when there are no courses", () => {
    expect(coursesToGpa(null)).toBeNull();
    expect(coursesToGpa(undefined)).toBeNull();
    expect(coursesToGpa([])).toBeNull();
  });

  it("returns null when no course carries a score", () => {
    expect(coursesToGpa([{ currentScore: null, finalScore: null }, {}])).toBeNull();
  });

  it("averages scored courses then maps to GPA (90 & 80 → 85 → 3.7)", () => {
    expect(coursesToGpa([{ currentScore: 90 }, { currentScore: 80 }])).toBe(3.7);
  });

  it("falls back to finalScore when currentScore is null", () => {
    expect(coursesToGpa([{ currentScore: null, finalScore: 92 }])).toBe(4.0);
  });

  it("prefers currentScore over finalScore on the same course", () => {
    // currentScore 60 wins over finalScore 95 → avg 60 → 2.0
    expect(coursesToGpa([{ currentScore: 60, finalScore: 95 }])).toBe(2.0);
  });

  it("ignores ungraded courses when averaging (B8: 3 of 4 graded)", () => {
    const courses = [
      { currentScore: 90 },
      { currentScore: 90 },
      { finalScore: 90 },
      { currentScore: null, finalScore: null }, // ungraded — must not drag the average to 0
    ];
    expect(coursesToGpa(courses)).toBe(4.0);
  });
});

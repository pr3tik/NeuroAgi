import { describe, it, expect } from "vitest";
import { calcRequiredScore } from "../src/lib/whatif";

describe("calcRequiredScore", () => {
  it("returns null currentPct when nothing is graded", () => {
    const r = calcRequiredScore([
      { id: 1, pointsPossible: 100, submissionScore: null },
      { id: 2, pointsPossible: 50,  submissionScore: null },
    ], 75);
    expect(r.currentPct).toBeNull();
    expect(r.requiredPct).toBeCloseTo(75);
  });

  it("computes currentPct from real grades only", () => {
    const r = calcRequiredScore([
      { id: 1, pointsPossible: 100, submissionScore: 85 },
      { id: 2, pointsPossible: 50,  submissionScore: null },
    ], 75);
    expect(r.currentPct).toBeCloseTo(85);
  });

  it("computes required score for remaining work", () => {
    // earned 85/100, remaining 50, target 75%
    // targetTotal = 0.75 * 150 = 112.5, required = 112.5 - 85 = 27.5 on 50 → 55%
    const r = calcRequiredScore([
      { id: 1, pointsPossible: 100, submissionScore: 85 },
      { id: 2, pointsPossible: 50,  submissionScore: null },
    ], 75);
    expect(r.requiredPct).toBeCloseTo(55);
    expect(r.isPossible).toBe(true);
    expect(r.alreadyAchieved).toBe(false);
  });

  it("flags alreadyAchieved when on track", () => {
    // earned 90/100, remaining 10, target 75%
    // targetTotal = 0.75 * 110 = 82.5, required = 82.5 - 90 = -7.5 → already there
    const r = calcRequiredScore([
      { id: 1, pointsPossible: 100, submissionScore: 90 },
      { id: 2, pointsPossible: 10,  submissionScore: null },
    ], 75);
    expect(r.alreadyAchieved).toBe(true);
    expect(r.isPossible).toBe(true);
  });

  it("flags not possible when required > 100%", () => {
    // earned 0/100, remaining 10, target 75%
    // targetTotal = 0.75 * 110 = 82.5, required = 82.5 on 10 → 825%
    const r = calcRequiredScore([
      { id: 1, pointsPossible: 100, submissionScore: 0 },
      { id: 2, pointsPossible: 10,  submissionScore: null },
    ], 75);
    expect(r.isPossible).toBe(false);
    expect(r.alreadyAchieved).toBe(false);
  });

  it("sets noRemainingWork when all assignments are graded", () => {
    const r = calcRequiredScore([
      { id: 1, pointsPossible: 100, submissionScore: 80 },
    ], 75);
    expect(r.noRemainingWork).toBe(true);
    expect(r.alreadyAchieved).toBe(true);
    expect(r.requiredPct).toBeNull();
  });

  it("includes hypotheticals in projection and updates required", () => {
    // real: 80/100, hypo: 40/50, ungraded: 30, target 75%
    // earned = 120, scoredTotal = 150, grandTotal = 180
    // targetTotal = 0.75 * 180 = 135, required = 135 - 120 = 15 on 30 → 50%
    const r = calcRequiredScore([
      { id: 1, pointsPossible: 100, submissionScore: 80 },
      { id: 2, pointsPossible: 50,  submissionScore: null },
      { id: 3, pointsPossible: 30,  submissionScore: null },
    ], 75, { 2: 40 });
    expect(r.requiredPct).toBeCloseTo(50);
    expect(r.projectedPct).toBeCloseTo((120 / 150) * 100);
    expect(r.earnedPoints).toBe(120);
    expect(r.ungradedTotal).toBe(30);
  });

  it("ignores assignments with null or zero pointsPossible", () => {
    const r = calcRequiredScore([
      { id: 1, pointsPossible: null, submissionScore: null },
      { id: 2, pointsPossible: 0,    submissionScore: null },
      { id: 3, pointsPossible: 100,  submissionScore: 80 },
    ], 75);
    expect(r.grandTotal).toBe(100);
    expect(r.noRemainingWork).toBe(true);
  });
});

describe("calcRequiredScore — weighted", () => {
  // Two groups: Assignments 40%, Exams 60%
  // A1 (assignments, 50pp, scored 40), A2 (assignments, 50pp, ungraded)
  // E1 (exams, 100pp, scored 70)
  const groups = [
    { id: "g1", name: "Assignments", weight: 40, assignmentIds: [1, 2] },
    { id: "g2", name: "Exams",       weight: 60, assignmentIds: [3]    },
  ];
  const assignments = [
    { id: 1, pointsPossible: 50,  submissionScore: 40 },
    { id: 2, pointsPossible: 50,  submissionScore: null },
    { id: 3, pointsPossible: 100, submissionScore: 70 },
  ];

  it("sets isWeighted true when groups sum to ~100", () => {
    const r = calcRequiredScore(assignments, 75, {}, groups);
    expect(r.isWeighted).toBe(true);
  });

  it("computes Canvas-style currentPct (re-normalized weights)", () => {
    // Assignments group: 40/50 = 80%, weight 40
    // Exams group: 70/100 = 70%, weight 60
    // Both have real grades → weights already sum to 100 → no re-normalization needed
    // currentPct = 80*0.4 + 70*0.6 = 32 + 42 = 74
    const r = calcRequiredScore(assignments, 75, {}, groups);
    expect(r.currentPct).toBeCloseTo(74);
  });

  it("computes weighted required score for remaining work", () => {
    // earnedContrib = (40/100)*0.4 + (70/100)*0.6 = 0.16 + 0.42 = 0.58
    // remainingContrib = (50/100)*0.4 = 0.20
    // X = (0.75 - 0.58) / 0.20 * 100 = 0.17/0.20 * 100 = 85
    const r = calcRequiredScore(assignments, 75, {}, groups);
    expect(r.requiredPct).toBeCloseTo(85);
    expect(r.isPossible).toBe(true);
    expect(r.alreadyAchieved).toBe(false);
  });

  it("populates group breakdown correctly", () => {
    const r = calcRequiredScore(assignments, 75, {}, groups);
    expect(r.groups).toHaveLength(2);
    const asgn = r.groups.find(g => g.name === "Assignments")!;
    expect(asgn.currentPct).toBeCloseTo(80);
    expect(asgn.ungradedTotal).toBe(50);
    const exams = r.groups.find(g => g.name === "Exams")!;
    expect(exams.currentPct).toBeCloseTo(70);
    expect(exams.ungradedTotal).toBe(0);
  });

  it("flags noRemainingWork when all groups fully graded", () => {
    const allGraded = [
      { id: 1, pointsPossible: 50,  submissionScore: 40 },
      { id: 2, pointsPossible: 50,  submissionScore: 45 },
      { id: 3, pointsPossible: 100, submissionScore: 70 },
    ];
    const r = calcRequiredScore(allGraded, 75, {}, groups);
    expect(r.noRemainingWork).toBe(true);
    expect(r.requiredPct).toBeNull();
  });

  it("falls back to points-based when groups don't sum to ~100", () => {
    const badGroups = [
      { id: "g1", name: "Assignments", weight: 30, assignmentIds: [1, 2] },
    ];
    const r = calcRequiredScore(assignments, 75, {}, badGroups);
    expect(r.isWeighted).toBe(false);
  });

  it("re-normalizes currentPct when only some groups have real grades", () => {
    // Only exams graded (70/100 = 70%), assignments group has no real grades
    // Re-normalized: only exams group (weight 60) → currentPct = 70
    const noAsgn = [
      { id: 1, pointsPossible: 50,  submissionScore: null },
      { id: 2, pointsPossible: 50,  submissionScore: null },
      { id: 3, pointsPossible: 100, submissionScore: 70  },
    ];
    const r = calcRequiredScore(noAsgn, 75, {}, groups);
    expect(r.currentPct).toBeCloseTo(70);
  });
});

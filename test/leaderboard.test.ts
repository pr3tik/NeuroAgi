import { describe, it, expect } from "vitest";
import { CATEGORIES, getCategory, scopeFilter, rankRows, findUserRank } from "../src/lib/leaderboard";

const rows = [
  { userId: "a", name: "A", school: "UofT", city: "Toronto", country: "Canada", points: 100, study_time: 40, streak: 5, gpa: 3.9 },
  { userId: "b", name: "B", school: "UofT", city: "Toronto", country: "Canada", points: 300, study_time: 10, streak: 5, gpa: null },
  { userId: "c", name: "C", school: "MIT",  city: "Boston",  country: "USA",    points: 200, study_time: 25, streak: 9, gpa: 3.2 },
];

describe("CATEGORIES", () => {
  it("marks the data-backed boards available and the rest not (no faked numbers)", () => {
    expect(getCategory("tokens")?.available).toBe(true);
    expect(getCategory("study_time")?.available).toBe(true);
    expect(getCategory("streak")?.available).toBe(true);
    expect(getCategory("gpa")?.available).toBe(true);
    for (const k of ["grind", "late_night", "social", "brain", "influencer"]) {
      const c = getCategory(k)!;
      expect(c.available, `${k} should not be available yet`).toBe(false);
      expect(c.reason, `${k} should explain why`).toBeTruthy();
    }
  });
  it("covers all eight maxing categories plus GPA", () => {
    expect(CATEGORIES.length).toBe(9);
  });
});

describe("rankRows", () => {
  it("ranks by the metric descending", () => {
    const r = rankRows(rows, "points");
    expect(r.map(x => x.userId)).toEqual(["b", "c", "a"]);
    expect(r.map(x => x.rank)).toEqual([1, 2, 3]);
  });

  it("drops rows with no data for the metric (can't rank null)", () => {
    const r = rankRows(rows, "gpa");
    expect(r.map(x => x.userId)).toEqual(["a", "c"]); // b has null gpa
    expect(r.find(x => x.userId === "b")).toBeUndefined();
  });

  it("gives tied values the same rank (competition ranking 1,2,2,4)", () => {
    const tied = [
      { userId: "w", name: "W", streak: 9 },
      { userId: "x", name: "X", streak: 5 },
      { userId: "y", name: "Y", streak: 5 },
      { userId: "z", name: "Z", streak: 1 },
    ];
    const r = rankRows(tied, "streak");
    expect(r.map(x => x.rank)).toEqual([1, 2, 2, 4]);
  });
});

describe("scopeFilter", () => {
  it("keeps everyone for global", () => {
    expect(scopeFilter(rows, "global").length).toBe(3);
  });
  it("filters to a single school / city / country", () => {
    expect(scopeFilter(rows, "university", "UofT").map(r => r.userId)).toEqual(["a", "b"]);
    expect(scopeFilter(rows, "city", "Boston").map(r => r.userId)).toEqual(["c"]);
    expect(scopeFilter(rows, "country", "Canada").map(r => r.userId)).toEqual(["a", "b"]);
  });
  it("keeps everyone when the scope value is missing", () => {
    expect(scopeFilter(rows, "city", null).length).toBe(3);
  });
});

describe("findUserRank", () => {
  it("returns the user's true rank even when outside the visible top-N", () => {
    const ranked = rankRows(rows, "points"); // b(1), c(2), a(3)
    expect(findUserRank(ranked, "a")).toEqual({ rank: 3, value: 100 });
    expect(findUserRank(ranked, "b")).toEqual({ rank: 1, value: 300 });
  });
  it("returns null when the user has no data for the metric", () => {
    const ranked = rankRows(rows, "gpa"); // b dropped (null gpa)
    expect(findUserRank(ranked, "b")).toBeNull();
  });
  it("returns null without a userId", () => {
    expect(findUserRank(rankRows(rows, "points"), null)).toBeNull();
  });
});

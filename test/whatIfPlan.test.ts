import { describe, it, expect } from "vitest";
import { whatIf, StudyPlan } from "../src/lib/whatIfPlan";

const base: StudyPlan = {
  examDate: "2026-08-10",
  sessions: [
    { date: "2026-08-01", topic: "Kinetics",     activities: ["read"],        estimatedMinutes: 60 },
    { date: "2026-08-03", topic: "Thermo",        activities: ["practice"],    estimatedMinutes: 60 },
    { date: "2026-08-05", topic: "Kinetics",      activities: ["quiz"],        estimatedMinutes: 60 },
    { date: "2026-08-07", topic: "Equilibrium",   activities: ["review"],      estimatedMinutes: 60 },
  ],
};

describe("whatIf study-plan recompute", () => {
  it("drops sessions whose topic is dropped (case-insensitive) and reports it", () => {
    const r = whatIf(base, { dropTopics: ["kinetics"] });
    expect(r.projectedPlan.sessions).toHaveLength(2);
    expect(r.projectedPlan.sessions.some((s) => s.topic.toLowerCase() === "kinetics")).toBe(false);
    expect(r.deltas.join(" ")).toMatch(/Dropped/);
  });

  it("caps per-session minutes to the new daily budget", () => {
    const r = whatIf(base, { dailyMinutes: 30 });
    expect(r.projectedPlan.sessions.every((s) => (s.estimatedMinutes ?? 0) <= 30)).toBe(true);
    expect(r.deltas.join(" ")).toMatch(/30 min/);
  });

  it("keeps readiness within [0,1] and drops it when the exam moves up", () => {
    const later = whatIf(base, { dailyMinutes: 60 });
    const sooner = whatIf(base, { dailyMinutes: 60, examDate: "2026-08-04" });
    for (const r of [later, sooner]) {
      expect(r.readiness).toBeGreaterThanOrEqual(0);
      expect(r.readiness).toBeLessThanOrEqual(1);
    }
    expect(sooner.readiness).toBeLessThanOrEqual(later.readiness);
    expect(sooner.deltas.join(" ")).toMatch(/moved up/);
  });

  it("reports readiness 0 when the exam is moved to/before the first study session", () => {
    // first session is 2026-08-01; move the exam to 2026-07-30 (before it) → no time to prep
    const r = whatIf(base, { examDate: "2026-07-30" });
    expect(r.readiness).toBe(0);
  });

  it("throws on a malformed basePlan", () => {
    // @ts-expect-error intentional bad input
    expect(() => whatIf({}, {})).toThrow();
  });

  it("is a no-op with no changes", () => {
    const r = whatIf(base, {});
    expect(r.projectedPlan.sessions).toHaveLength(4);
    expect(r.deltas).toContain("No changes applied");
  });
});

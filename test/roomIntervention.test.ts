import { describe, it, expect } from "vitest";
import { interventionReason, shouldShowIntervention } from "../src/lib/roomIntervention";

describe("interventionReason — non-accusatory reason labels", () => {
  it("maps each rule to a human label", () => {
    expect(interventionReason("silence")).toBe("The room went quiet");
    expect(interventionReason("time_milestone", "50")).toBe("Time checkpoint");
    expect(interventionReason("time_milestone", "5min_left")).toBe("5 minutes left");
    expect(interventionReason("uneven")).toBe("Let's bring everyone in"); // never names/scores a student
    expect(interventionReason("something_else")).toBe("A nudge from Reggie");
  });
});

describe("shouldShowIntervention", () => {
  const base = { rule: "silence", message: "Want to talk through the last idea?", messageId: "m1" };

  it("shows a fresh, non-empty nudge", () => {
    expect(shouldShowIntervention(base, { paused: false })).toBe(true);
  });

  it("suppresses when paused for the session", () => {
    expect(shouldShowIntervention(base, { paused: true })).toBe(false);
  });

  it("suppresses a missing / empty message", () => {
    expect(shouldShowIntervention(null, { paused: false })).toBe(false);
    expect(shouldShowIntervention({ rule: "silence", message: "" }, { paused: false })).toBe(false);
    expect(shouldShowIntervention({ rule: "silence", message: "   " }, { paused: false })).toBe(false);
  });

  it("de-dupes the same messageId (guards a double broadcast)", () => {
    expect(shouldShowIntervention(base, { paused: false, lastId: "m1" })).toBe(false);
    expect(shouldShowIntervention(base, { paused: false, lastId: "m0" })).toBe(true); // different id → show
  });
});

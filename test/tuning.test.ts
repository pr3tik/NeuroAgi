// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  labelOf, computeTuning, TWO_HOURS_MS, type LabelRow, type Tuning,
} from "../api/_tuning";

const NOW = Date.parse("2026-06-26T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

const row = (over: Partial<LabelRow>): LabelRow => ({
  delivered_at: ago(3 * 60 * 60 * 1000),  // delivered 3h ago by default
  opened_at: null, action_taken: null, channel: "in_app", ...over,
});

const DEFAULT: Tuning = { stressThreshold: 7, channelPref: null, labelCount: 0 };

describe("labelOf", () => {
  it("opened → positive", () => {
    expect(labelOf(row({ opened_at: ago(1000) }), NOW)).toBe("positive");
  });
  it("action_taken → positive", () => {
    expect(labelOf(row({ action_taken: true }), NOW)).toBe("positive");
  });
  it("delivered >2h ago, no engagement → negative", () => {
    expect(labelOf(row({ delivered_at: ago(TWO_HOURS_MS + 1000) }), NOW)).toBe("negative");
  });
  it("delivered <2h ago → pending (decision window still open)", () => {
    expect(labelOf(row({ delivered_at: ago(TWO_HOURS_MS - 1000) }), NOW)).toBe("pending");
  });
  it("never delivered → pending", () => {
    expect(labelOf(row({ delivered_at: null }), NOW)).toBe("pending");
  });
});

describe("computeTuning", () => {
  it("does nothing until ≥20 decided labels (but refreshes labelCount)", () => {
    const rows = Array.from({ length: 10 }, () => row({}));  // 10 negatives
    const out = computeTuning(rows, DEFAULT, NOW);
    expect(out.stressThreshold).toBe(7);   // unchanged
    expect(out.labelCount).toBe(10);
  });

  it("raises the stress threshold when interventions are mostly ignored", () => {
    const rows = Array.from({ length: 25 }, () => row({}));  // 25 negatives, rate 0 < 0.2
    expect(computeTuning(rows, DEFAULT, NOW).stressThreshold).toBe(8);
  });

  it("lowers the stress threshold when the student is responsive", () => {
    const rows = Array.from({ length: 25 }, (_, i) => row(i < 20 ? { opened_at: ago(1000) } : {})); // 20/25 positive
    expect(computeTuning(rows, DEFAULT, NOW).stressThreshold).toBe(6);
  });

  it("clamps the threshold to [5, 9]", () => {
    const ignored  = Array.from({ length: 25 }, () => row({}));                       // raise
    const engaged  = Array.from({ length: 25 }, () => row({ opened_at: ago(1000) })); // lower
    expect(computeTuning(ignored, { ...DEFAULT, stressThreshold: 9 }, NOW).stressThreshold).toBe(9);
    expect(computeTuning(engaged, { ...DEFAULT, stressThreshold: 5 }, NOW).stressThreshold).toBe(5);
  });

  it("learns the channel the student engages with most", () => {
    // 10 discord (8 opened) vs 15 in_app (3 opened) → discord has the higher positive rate
    const discord = Array.from({ length: 10 }, (_, i) => row({ channel: "discord", opened_at: i < 8 ? ago(1000) : null }));
    const inApp   = Array.from({ length: 15 }, (_, i) => row({ channel: "in_app",  opened_at: i < 3 ? ago(1000) : null }));
    expect(computeTuning([...discord, ...inApp], DEFAULT, NOW).channelPref).toBe("discord");
  });

  it("ignores channels with too few samples", () => {
    // 22 in_app (mixed) + 2 discord (both positive) — discord lacks ≥5 samples, so it's not chosen
    const inApp   = Array.from({ length: 22 }, (_, i) => row({ channel: "in_app", opened_at: i < 11 ? ago(1000) : null }));
    const discord = Array.from({ length: 2 },  () => row({ channel: "discord", opened_at: ago(1000) }));
    expect(computeTuning([...inApp, ...discord], DEFAULT, NOW).channelPref).toBe("in_app");
  });
});

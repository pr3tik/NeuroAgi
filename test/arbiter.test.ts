// @vitest-environment node
import { describe, it, expect, vi } from "vitest";

// arbiter.ts → _notify.ts call createClient() at module load. On Node 20 (CI) the
// real supabase-js eagerly inits a realtime WebSocket client and throws ("Node.js 20
// detected without native WebSocket support"). These tests only exercise pure
// functions, so stub createClient — no real client is needed. (Matches the mock
// convention used by the other suites.)
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ from: () => ({}), channel: () => ({}) }),
}));

import { score, isUrgent, chooseChannel, dedupe, rank, localHour, isQuietHours, type Candidate } from "../api/arbiter";

const mk = (over: Partial<Candidate>): Candidate => ({
  id: Math.random().toString(36).slice(2),
  user_id: "u1",
  urgency_score: 0.5,
  value_score: 0.5,
  channel_hint: "in_app",
  dedup_key: null,
  created_at: "2026-06-25T00:00:00Z",
  ...over,
});

describe("score", () => {
  it("is urgency × value", () => {
    expect(score({ urgency_score: 0.8, value_score: 0.5 })).toBeCloseTo(0.4);
  });
});

describe("chooseChannel", () => {
  it("uses the candidate hint when there is no valid learned pref", () => {
    expect(chooseChannel("in_app", null)).toBe("in_app");
    expect(chooseChannel("discord", "bogus" as any)).toBe("discord");
  });
  it("exploits the learned pref by default (rand ≥ exploreRate)", () => {
    expect(chooseChannel("in_app", "discord", () => 0.99)).toBe("discord");
    expect(chooseChannel("discord", "in_app", () => 0.5)).toBe("in_app");
  });
  it("ε-greedily probes the OTHER channel a fraction of the time (rand < exploreRate)", () => {
    expect(chooseChannel("in_app", "discord", () => 0.0)).toBe("in_app");   // other(discord) = in_app
    expect(chooseChannel("in_app", "in_app",  () => 0.0)).toBe("discord");  // other(in_app) = discord
  });
});

describe("isUrgent", () => {
  it("treats >= 0.95 as urgent", () => {
    expect(isUrgent({ urgency_score: 0.95 })).toBe(true);
    expect(isUrgent({ urgency_score: 1 })).toBe(true);
  });
  it("tolerates float4 round-trip (0.95 stored as ~0.9499999)", () => {
    expect(isUrgent({ urgency_score: 0.9499999 })).toBe(true);
  });
  it("non-urgent below the threshold", () => {
    expect(isUrgent({ urgency_score: 0.9 })).toBe(false);
    expect(isUrgent({ urgency_score: 0.7 })).toBe(false);
  });
});

describe("dedupe", () => {
  it("collapses same dedup_key, keeping the highest score", () => {
    const lo = mk({ id: "lo", dedup_key: "k", urgency_score: 0.4, value_score: 0.4 }); // 0.16
    const hi = mk({ id: "hi", dedup_key: "k", urgency_score: 0.9, value_score: 0.9 }); // 0.81
    const { kept, dropped } = dedupe([lo, hi]);
    expect(kept.map(c => c.id)).toEqual(["hi"]);
    expect(dropped.map(c => c.id)).toEqual(["lo"]);
  });

  it("never deduplicates null-key candidates", () => {
    const a = mk({ id: "a", dedup_key: null });
    const b = mk({ id: "b", dedup_key: null });
    const { kept, dropped } = dedupe([a, b]);
    expect(kept).toHaveLength(2);
    expect(dropped).toHaveLength(0);
  });

  it("dedups per-key independently", () => {
    const { kept } = dedupe([
      mk({ id: "k1a", dedup_key: "k1", urgency_score: 0.2, value_score: 0.2 }),
      mk({ id: "k1b", dedup_key: "k1", urgency_score: 0.9, value_score: 0.9 }),
      mk({ id: "k2",  dedup_key: "k2", urgency_score: 0.5, value_score: 0.5 }),
    ]);
    expect(new Set(kept.map(c => c.id))).toEqual(new Set(["k1b", "k2"]));
  });
});

describe("rank", () => {
  it("orders by urgency×value desc", () => {
    const out = rank([
      mk({ id: "low",  urgency_score: 0.2, value_score: 0.2 }), // 0.04
      mk({ id: "high", urgency_score: 0.9, value_score: 0.9 }), // 0.81
      mk({ id: "mid",  urgency_score: 0.6, value_score: 0.5 }), // 0.30
    ]);
    expect(out.map(c => c.id)).toEqual(["high", "mid", "low"]);
  });

  it("tie-breaks equal scores by oldest first (anti-starvation)", () => {
    const out = rank([
      mk({ id: "new", urgency_score: 0.5, value_score: 0.5, created_at: "2026-06-25T10:00:00Z" }),
      mk({ id: "old", urgency_score: 0.5, value_score: 0.5, created_at: "2026-06-25T01:00:00Z" }),
    ]);
    expect(out.map(c => c.id)).toEqual(["old", "new"]);
  });
});

describe("isQuietHours", () => {
  it("handles a window that wraps midnight (23→8)", () => {
    expect(isQuietHours(23, 23, 8)).toBe(true);
    expect(isQuietHours(2,  23, 8)).toBe(true);
    expect(isQuietHours(7,  23, 8)).toBe(true);
    expect(isQuietHours(8,  23, 8)).toBe(false); // end is exclusive
    expect(isQuietHours(12, 23, 8)).toBe(false);
    expect(isQuietHours(22, 23, 8)).toBe(false);
  });

  it("handles a same-day window (1→5)", () => {
    expect(isQuietHours(0, 1, 5)).toBe(false);
    expect(isQuietHours(1, 1, 5)).toBe(true);
    expect(isQuietHours(4, 1, 5)).toBe(true);
    expect(isQuietHours(5, 1, 5)).toBe(false);
  });

  it("start === end means never quiet", () => {
    expect(isQuietHours(3, 0, 0)).toBe(false);
  });
});

describe("localHour", () => {
  const t = new Date("2026-06-25T04:30:00Z"); // 04:30 UTC
  it("returns the hour in the given timezone", () => {
    expect(localHour(t, "UTC")).toBe(4);
    expect(localHour(t, "America/Toronto")).toBe(0); // EDT = UTC-4 in June → 00:30
  });
  it("falls back to UTC hour on a bad timezone", () => {
    expect(localHour(t, "Not/AZone")).toBe(4);
  });
});

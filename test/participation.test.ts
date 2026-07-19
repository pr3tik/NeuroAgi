// @vitest-environment node
// AI-07 — api/_participation.ts, the participation aggregator.
//
// The pure scoring functions need no mocks. They pin the four properties the sprint plan
// requires: the weighted formula, per-channel caps (no channel can dominate), time
// normalization (score is a rate, so presence duration doesn't inflate it), and opt-out
// (an opted-out student is flagged and excluded from the cohort baseline the "uneven" rule
// compares against).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  scoreParticipant, cohortMedian, ratioToMedian, isUnderparticipating,
  PARTICIPATION_WEIGHTS, CHANNEL_CAPS,
} from "../api/_participation";

const M = (over: Partial<any> = {}) => ({
  chat_score: 0, board_score: 0, peer_score: 0, help_score: 0, active_seconds: 60, ...over,
});

describe("scoreParticipant — the formula", () => {
  it("weights the four channels 0.35 / 0.35 / 0.20 / 0.10", () => {
    // 1 minute present → score == weighted sum. Use values under the caps.
    const p = scoreParticipant("u", M({ chat_score: 10, board_score: 10, peer_score: 10, help_score: 10, active_seconds: 60 }));
    const expected = 0.35 * 10 + 0.35 * 10 + 0.20 * 10 + 0.10 * 10;   // = 10
    expect(p.score).toBeCloseTo(expected, 6);
    expect(PARTICIPATION_WEIGHTS).toEqual({ chat: 0.35, board: 0.35, peer: 0.20, help: 0.10 });
  });

  it("caps each channel so one loud channel cannot dominate", () => {
    // A chat spammer with 10000 chats is capped at CHANNEL_CAPS.chat.
    const spammer = scoreParticipant("spam", M({ chat_score: 10000, active_seconds: 60 }));
    expect(spammer.breakdown.chat).toBe(CHANNEL_CAPS.chat);
    expect(spammer.score).toBeCloseTo(0.35 * CHANNEL_CAPS.chat, 6);   // not 0.35 * 10000
  });

  it("normalizes by time present — a rate, not a raw count", () => {
    // Same raw work, different presence: the one present longer scores LOWER per minute.
    const short = scoreParticipant("s", M({ chat_score: 20, active_seconds: 60 }));    // 1 min
    const long  = scoreParticipant("l", M({ chat_score: 20, active_seconds: 600 }));   // 10 min
    expect(short.score).toBeGreaterThan(long.score);
    expect(long.minutesPresent).toBe(10);
  });

  it("floors presence at 1 minute — a few seconds cannot explode the rate, and 0 never divides", () => {
    const blip = scoreParticipant("b", M({ chat_score: 20, active_seconds: 3 }));
    const zero = scoreParticipant("z", M({ chat_score: 20, active_seconds: 0 }));
    expect(blip.minutesPresent).toBe(1);
    expect(zero.minutesPresent).toBe(1);
    expect(Number.isFinite(zero.score)).toBe(true);   // not Infinity/NaN
  });

  it("treats missing/negative sub-scores as zero rather than NaN", () => {
    const p = scoreParticipant("u", { chat_score: -5, board_score: NaN as any, peer_score: undefined as any, help_score: 4, active_seconds: 60 });
    expect(p.breakdown).toEqual({ chat: 0, board: 0, peer: 0, help: 4 });
    expect(Number.isFinite(p.score)).toBe(true);
  });
});

describe("cohort statistics", () => {
  it("takes the median over the participating cohort", () => {
    const scored = [1, 5, 9].map((c, i) => scoreParticipant(`u${i}`, M({ chat_score: c / 0.35, active_seconds: 60 })));
    // scores are 1,5,9 → median 5
    expect(cohortMedian(scored)).toBeCloseTo(5, 6);
  });

  it("averages the two middle values for an even cohort", () => {
    const scored = [2, 4, 6, 8].map((c, i) => scoreParticipant(`u${i}`, M({ chat_score: c / 0.35, active_seconds: 60 })));
    expect(cohortMedian(scored)).toBeCloseTo(5, 6);   // (4+6)/2
  });

  it("EXCLUDES opted-out students from the median baseline", () => {
    // Two active (score 10) + one opted-out with a wildly high score that must NOT skew it.
    const active = [10, 10].map((c, i) => scoreParticipant(`a${i}`, M({ chat_score: c / 0.35, active_seconds: 60 })));
    const opted = scoreParticipant("opt", M({ chat_score: 1000, active_seconds: 60 }), true);
    expect(cohortMedian([...active, opted])).toBeCloseTo(10, 6);   // opted-out ignored
  });

  it("returns 0 when there is no participating cohort", () => {
    expect(cohortMedian([])).toBe(0);
    expect(cohortMedian([scoreParticipant("o", M(), true)])).toBe(0);   // all opted out
  });
});

describe("under-participation (the AI-08 score half)", () => {
  it("flags a student below 35% of the median", () => {
    const median = 10;
    const quiet = scoreParticipant("q", M({ chat_score: 3 / 0.35, active_seconds: 60 }));   // score 3, ratio 0.3
    expect(isUnderparticipating(quiet, median)).toBe(true);
  });

  it("does NOT flag a student at 40% of the median", () => {
    const median = 10;
    const ok = scoreParticipant("ok", M({ chat_score: 4 / 0.35, active_seconds: 60 }));      // score 4, ratio 0.4
    expect(isUnderparticipating(ok, median)).toBe(false);
  });

  it("never flags an opted-out student, however quiet", () => {
    const opted = scoreParticipant("opt", M({ chat_score: 0, active_seconds: 60 }), true);
    expect(isUnderparticipating(opted, 10)).toBe(false);
  });

  it("never flags anyone when there is no median signal", () => {
    const quiet = scoreParticipant("q", M({ chat_score: 0, active_seconds: 60 }));
    expect(isUnderparticipating(quiet, 0)).toBe(false);
    expect(ratioToMedian(5, 0)).toBe(1);   // no signal → ratio 1, not Infinity
  });
});

// ── loader (mocked DB) ──────────────────────────────────────────────────────
function R(data: any) { return { ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) }; }
function stubDb(route: (u: string) => any) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: any) => { calls.push(String(url)); return route(String(url)) ?? R([]); }));
  return calls;
}

describe("loadSessionParticipation — reads metrics + consent", () => {
  beforeEach(() => { process.env.SUPABASE_URL = "http://localhost"; process.env.SUPABASE_SERVICE_KEY = "svc"; vi.resetModules(); });
  afterEach(() => vi.unstubAllGlobals());

  it("scores every participant and marks opt-out from consent_room_pedagogy=false", async () => {
    stubDb(u => {
      if (u.includes("participant_metrics")) return R([
        { user_id: "a", chat_score: 20, board_score: 0, peer_score: 0, help_score: 0, active_seconds: 60 },
        { user_id: "b", chat_score: 20, board_score: 0, peer_score: 0, help_score: 0, active_seconds: 60 },
        { user_id: "c", chat_score: 1,  board_score: 0, peer_score: 0, help_score: 0, active_seconds: 60 },
      ]);
      if (u.includes("student_brains")) return R([{ user_id: "b", consent_room_pedagogy: false }]);
      return R([]);
    });
    const mod = await import("../api/_participation");
    const { participants, median } = await mod.loadSessionParticipation("sess-1");

    expect(participants.map(p => p.userId)).toEqual(["a", "b", "c"]);
    expect(participants.find(p => p.userId === "b")!.optedOut).toBe(true);
    // Median over non-opted-out {a:7, c:0.35} → (7+0.35)/2... only a and c participate → 2 values.
    // a score = 0.35*20 = 7, c = 0.35*1 = 0.35. median = (7 + 0.35)/2 = 3.675
    expect(median).toBeCloseTo((7 + 0.35) / 2, 4);
  });

  it("returns empty when the session has no metrics yet", async () => {
    stubDb(() => R([]));
    const mod = await import("../api/_participation");
    expect(await mod.loadSessionParticipation("sess-empty")).toEqual({ participants: [], median: 0 });
  });
});

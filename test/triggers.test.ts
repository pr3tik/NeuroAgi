// @vitest-environment node
// AI-08 — api/_triggers.ts, the deterministic policy layer.
//
// The exit criterion is "rule unit tests for cooldowns/caps/opt-out pass". Because the
// engine is pure, these pin the exact behaviour: which rule fires, in what priority, and
// every suppression path (cooldown, budget, per-person cap, opt-out, paused).
import { describe, it, expect } from "vitest";
import {
  evaluateTriggers, SILENCE_THRESHOLD_MS, SILENCE_COOLDOWN_MS,
  UNEVEN_MIN_ELAPSED_MS, UNEVEN_MAX_PER_TARGET, FIVE_MIN_LEFT,
} from "../api/_triggers";
import { scoreParticipant } from "../api/_participation";

const T0 = 1_000_000_000_000;   // fixed epoch for deterministic elapsed times
const MIN = 60_000;

const session = (over: any = {}) => ({
  sessionId: "s1", state: "active" as const, startedAtMs: T0,
  durationMinutes: 60, persona: "facilitator" as const, intensity: "balanced" as const, ...over,
});

// A default context: 20 min elapsed, recent activity, budget untouched, no history.
const ctx = (over: any = {}) => ({
  nowMs: T0 + 20 * MIN,
  lastActivityAtMs: T0 + 20 * MIN,   // active right now → not silent
  silenceLastSentMs: null,
  sentThisBlock: 0,
  firedMilestones: ["25", "50", "75", FIVE_MIN_LEFT],   // all milestones already fired → time rule quiet
  participants: [],
  median: 0,
  unevenSentCount: {},
  privateHelpActive: new Set<string>(),
  ...over,
});

const P = (id: string, chat: number) => scoreParticipant(id, { chat_score: chat, board_score: 0, peer_score: 0, help_score: 0, active_seconds: 60 }, false);

describe("no-op", () => {
  it("returns null when no rule condition is met (never floods intervention_events)", () => {
    expect(evaluateTriggers(session(), ctx())).toBeNull();
  });

  it("returns null for an ended session", () => {
    expect(evaluateTriggers(session({ state: "ended" }), ctx({ lastActivityAtMs: T0 }))).toBeNull();
  });
});

describe("silence rule", () => {
  const silentCtx = (over: any = {}) => ctx({ lastActivityAtMs: T0 + 20 * MIN - SILENCE_THRESHOLD_MS - 1, nowMs: T0 + 20 * MIN, ...over });

  it("fires after 180s of no activity", () => {
    const d = evaluateTriggers(session(), silentCtx())!;
    expect(d).toMatchObject({ rule: "silence", decision: "sent" });
    expect(d.message).toBeTruthy();
  });

  it("does NOT fire before 180s", () => {
    const d = evaluateTriggers(session(), ctx({ lastActivityAtMs: T0 + 20 * MIN - (SILENCE_THRESHOLD_MS - 5_000) }));
    expect(d).toBeNull();
  });

  it("never fires when the room has had no activity at all (lastActivityAtMs null)", () => {
    expect(evaluateTriggers(session(), silentCtx({ lastActivityAtMs: null }))).toBeNull();
  });

  it("COOLDOWN: suppresses a second silence within 8 minutes", () => {
    const d = evaluateTriggers(session(), silentCtx({ silenceLastSentMs: T0 + 20 * MIN - (SILENCE_COOLDOWN_MS - MIN) }))!;
    expect(d).toMatchObject({ rule: "silence", decision: "suppressed_cooldown" });
    expect(d.message).toBeNull();
  });

  it("allows silence again after the 8-minute cooldown lapses", () => {
    const d = evaluateTriggers(session(), silentCtx({ silenceLastSentMs: T0 + 20 * MIN - (SILENCE_COOLDOWN_MS + MIN) }))!;
    expect(d.decision).toBe("sent");
  });
});

describe("time_milestone rule", () => {
  it("fires the 50% milestone when elapsed crosses half of the duration", () => {
    // 60-min session, 30 min elapsed, only 25 fired → 50 is due.
    const d = evaluateTriggers(session(), ctx({ nowMs: T0 + 30 * MIN, lastActivityAtMs: T0 + 30 * MIN, firedMilestones: ["25"] }))!;
    expect(d).toMatchObject({ rule: "time_milestone", milestone: "50", decision: "sent" });
  });

  it("does not re-fire a milestone already recorded", () => {
    const d = evaluateTriggers(session(), ctx({ nowMs: T0 + 30 * MIN, lastActivityAtMs: T0 + 30 * MIN, firedMilestones: ["25", "50"] }));
    expect(d).toBeNull();
  });

  it("fires 5-minutes-left in the final window", () => {
    const d = evaluateTriggers(session(), ctx({ nowMs: T0 + 56 * MIN, lastActivityAtMs: T0 + 56 * MIN, firedMilestones: ["25", "50", "75"] }))!;
    expect(d).toMatchObject({ rule: "time_milestone", milestone: FIVE_MIN_LEFT });
  });

  it("has no milestones when the session has no planned duration", () => {
    const d = evaluateTriggers(session({ durationMinutes: null }), ctx({ nowMs: T0 + 30 * MIN, lastActivityAtMs: T0 + 30 * MIN, firedMilestones: [] }));
    expect(d).toBeNull();
  });
});

describe("uneven-participation rule", () => {
  // Two loud (score 7) + one quiet (0.35) → median 7, quiet ratio 0.05 < 0.35.
  const parts = [P("a", 20), P("b", 20), P("quiet", 1)];
  const median = 7;
  const unevenCtx = (over: any = {}) => ctx({ nowMs: T0 + 15 * MIN, lastActivityAtMs: T0 + 15 * MIN, participants: parts, median, ...over });

  it("fires for a student below 35% of the median after 10 minutes", () => {
    const d = evaluateTriggers(session(), unevenCtx())!;
    expect(d).toMatchObject({ rule: "uneven", targetUserId: "quiet", decision: "sent" });
  });

  it("the message NEVER names the student or states a score (social constraint)", () => {
    const d = evaluateTriggers(session(), unevenCtx())!;
    expect(d.message).not.toContain("quiet");
    expect(d.message).not.toMatch(/\d/);   // no numbers → no score leak
    expect(d.targetUserId).toBe("quiet");   // target is only in the audit row
  });

  it("does NOT apply before 10 minutes elapsed", () => {
    const d = evaluateTriggers(session(), unevenCtx({ nowMs: T0 + 5 * MIN, lastActivityAtMs: T0 + 5 * MIN }));
    expect(d).toBeNull();
  });

  it("CAP: suppresses after 2 nudges for the same person", () => {
    const d = evaluateTriggers(session(), unevenCtx({ unevenSentCount: { quiet: UNEVEN_MAX_PER_TARGET } }))!;
    expect(d).toMatchObject({ rule: "uneven", targetUserId: "quiet", decision: "suppressed_cooldown" });
  });

  it("OPT-OUT: never targets an opted-out student", () => {
    const optedQuiet = scoreParticipant("quiet", { chat_score: 1, board_score: 0, peer_score: 0, help_score: 0, active_seconds: 60 }, true);
    const d = evaluateTriggers(session(), unevenCtx({ participants: [P("a", 20), P("b", 20), optedQuiet] }));
    expect(d).toBeNull();   // the only under-participator is opted out → no candidate at all
  });

  it("does not target a student who is in private help", () => {
    const d = evaluateTriggers(session(), unevenCtx({ privateHelpActive: new Set(["quiet"]) }));
    expect(d).toBeNull();
  });
});

describe("hard blocks + priority", () => {
  const silentCtx = (over: any = {}) => ctx({ lastActivityAtMs: T0 + 20 * MIN - SILENCE_THRESHOLD_MS - 1, nowMs: T0 + 20 * MIN, ...over });

  it("PAUSED: a frozen room suppresses a would-be silence nudge", () => {
    const d = evaluateTriggers(session({ state: "frozen" }), silentCtx())!;
    expect(d).toMatchObject({ rule: "silence", decision: "suppressed_paused" });
  });

  it("BUDGET: suppresses once the persona's block budget is spent", () => {
    // facilitator balanced budget = 2. Already sent 2 this block.
    const d = evaluateTriggers(session(), silentCtx({ sentThisBlock: 2 }))!;
    expect(d).toMatchObject({ decision: "suppressed_budget" });
  });

  it("prefers a SENDABLE lower-priority rule over a blocked higher one", () => {
    // Silence is on cooldown (blocked) but a time milestone is due (sendable) → we send the
    // milestone rather than only recording the silence suppression.
    const d = evaluateTriggers(session(), ctx({
      nowMs: T0 + 30 * MIN, lastActivityAtMs: T0 + 30 * MIN - SILENCE_THRESHOLD_MS - 1,
      silenceLastSentMs: T0 + 30 * MIN - MIN,   // silence on cooldown
      firedMilestones: ["25"],                  // 50% due
    }))!;
    expect(d).toMatchObject({ rule: "time_milestone", decision: "sent" });
  });

  it("records the highest-priority block when nothing can send", () => {
    // Silence due but on cooldown; no milestone due; no uneven → record the silence cooldown.
    const d = evaluateTriggers(session(), ctx({
      nowMs: T0 + 20 * MIN, lastActivityAtMs: T0 + 20 * MIN - SILENCE_THRESHOLD_MS - 1,
      silenceLastSentMs: T0 + 20 * MIN - MIN,
    }))!;
    expect(d).toMatchObject({ rule: "silence", decision: "suppressed_cooldown" });
  });
});

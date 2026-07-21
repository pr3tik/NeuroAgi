// @vitest-environment node
// The delivery seam: only a SENT decision becomes a room broadcast; suppressed/no-op decisions
// stay audit-only. Pure builder, so no network.
import { describe, it, expect } from "vitest";
import { interventionBroadcast } from "../api/room-triggers.ts";
import type { TriggerDecision } from "../api/_triggers.ts";

const sent: TriggerDecision = {
  rule: "silence", targetUserId: null, decision: "sent",
  message: "Want to talk through the last idea on the board?",
  state: { persona: "facilitator", block: 0 },
};

describe("interventionBroadcast — SENT decisions become a room broadcast", () => {
  it("builds a room:<id> broadcast carrying the nudge message + reason", () => {
    const b = interventionBroadcast("room-123", sent, "msg-1");
    expect(b).not.toBeNull();
    expect(b!.topic).toBe("room:room-123");
    expect(b!.event).toBe("intervention");
    expect(b!.payload).toMatchObject({ messageId: "msg-1", rule: "silence", message: sent.message, persona: "facilitator" });
  });

  it("returns null for a suppressed decision (audit-only, never delivered)", () => {
    const suppressed: TriggerDecision = { ...sent, decision: "suppressed_cooldown", message: null };
    expect(interventionBroadcast("room-123", suppressed, null)).toBeNull();
  });

  it("returns null when a 'sent' decision somehow has no message", () => {
    expect(interventionBroadcast("room-123", { ...sent, message: null }, "x")).toBeNull();
  });

  it("passes a milestone through when present", () => {
    const b = interventionBroadcast("r1", { ...sent, rule: "time_milestone", milestone: "5min_left" }, "m2");
    expect(b!.payload.milestone).toBe("5min_left");
  });
});

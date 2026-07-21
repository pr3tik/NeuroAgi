// src/lib/roomIntervention.ts — pure display logic for the in-room intervention card.
//
// The trigger engine (api/room-triggers.ts) broadcasts an "intervention" event on the room's
// realtime channel when a nudge SENDS. This helper turns that payload into a human reason label
// and decides whether the card should surface (respecting a per-session "pause" and de-duping
// repeat deliveries) — so the React handler stays a thin, unit-testable shell.

export type InterventionPayload = {
  messageId?: string | null;
  rule: "silence" | "time_milestone" | "uneven" | string;
  message: string;
  persona?: string | null;
  milestone?: string | null;
};

/** Human, non-accusatory reason label shown on the card header. The "uneven" rule is deliberately
 *  framed as a group invitation — it never names or scores a student (that stays in the audit). */
export function interventionReason(rule: string, milestone?: string | null): string {
  switch (rule) {
    case "silence":        return "The room went quiet";
    case "time_milestone": return milestone === "5min_left" ? "5 minutes left" : "Time checkpoint";
    case "uneven":         return "Let's bring everyone in";
    default:               return "A nudge from Reggie";
  }
}

/** Whether an incoming intervention should surface. Pure: no card without a message, none while
 *  paused, and never the same messageId twice (guards a rare double-broadcast). */
export function shouldShowIntervention(
  payload: InterventionPayload | null | undefined,
  opts: { paused: boolean; lastId?: string | null },
): boolean {
  if (!payload || !payload.message || !payload.message.trim()) return false;
  if (opts.paused) return false;
  if (payload.messageId && opts.lastId && payload.messageId === opts.lastId) return false;
  return true;
}

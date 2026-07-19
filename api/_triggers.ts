// api/_triggers.ts — AI-08: the deterministic trigger policy layer.
//
// Given a session's state + AI-07 participation + recent intervention history, decide
// whether the AI should proactively speak, and if not, WHY it was suppressed. This layer is
// PURE (no I/O) so the cooldown/cap/opt-out rules are unit-testable to the letter — which is
// the AI-08 exit criterion. api/room-triggers.ts gathers the context and persists decisions.
//
// Determinism is the whole point: the same inputs always yield the same decision, so the
// engine can be audited and never double-fires. It never calls a model — it selects an
// INTERVENTION_TEMPLATE and fills the slots it knows; concept-slot filling / delivery is the
// integration layer's job.
//
// SCOPE (plan cut-list — the three rules in the Day-5 exit criterion):
//   silence · time_milestone · uneven-participation.
// peer-teaching and stuck-loop are deferred; the structure extends to them cleanly.
import { PERSONAS, INTERVENTION_TEMPLATES } from "./_personas.js";
import { isUnderparticipating } from "./_participation.js";
import type { ScoredParticipant } from "./_participation.js";
import type { PersonaId, InterventionIntensity } from "./_contracts.js";

export const SILENCE_THRESHOLD_MS  = 180_000;      // 180s of no activity → a silence nudge is due
export const SILENCE_COOLDOWN_MS   = 8 * 60_000;   // at most one silence nudge per 8 minutes
export const UNEVEN_MIN_ELAPSED_MS = 10 * 60_000;  // the uneven rule only applies after 10 min
export const UNEVEN_MAX_PER_TARGET = 2;            // at most twice per session per person
export const BLOCK_MS              = 25 * 60_000;  // a "block" for the persona proactive budget
export const FIVE_MIN_MS           = 5 * 60_000;

// Time milestones as fractions of the planned duration, plus a "5 minutes left" marker.
export const MILESTONE_FRACTIONS = [0.25, 0.5, 0.75] as const;
export const FIVE_MIN_LEFT = "5min_left";

export type TriggerRule = "silence" | "time_milestone" | "uneven";
export type Decision =
  | "sent" | "suppressed_cooldown" | "suppressed_budget"
  | "suppressed_optout" | "suppressed_paused" | "no_op";

export interface TriggerSession {
  sessionId: string;
  state: "active" | "ended" | "frozen";
  startedAtMs: number;
  durationMinutes: number | null;
  persona: PersonaId;
  intensity: InterventionIntensity;
}

export interface TriggerContext {
  nowMs: number;
  lastActivityAtMs: number | null;          // null = no activity recorded yet
  silenceLastSentMs: number | null;          // when the last silence nudge fired
  sentThisBlock: number;                     // interventions already SENT in the current block
  firedMilestones: string[];                 // milestone keys already fired ("25","50","75","5min_left")
  participants: ScoredParticipant[];         // from AI-07 loadSessionParticipation
  median: number;
  unevenSentCount: Record<string, number>;   // per target user → times the uneven rule fired
  privateHelpActive: Set<string>;            // users currently in a private-help thread
}

export interface TriggerDecision {
  rule: TriggerRule;
  targetUserId: string | null;
  decision: Decision;
  /** Templated message when decision === "sent"; null otherwise. */
  message: string | null;
  milestone?: string;
  /** Snapshot for intervention_events.state — the metrics the decision was based on. NEVER
   *  includes a raw participation score attributed to a named student on a sent message. */
  state: Record<string, any>;
}

function elapsedMs(session: TriggerSession, ctx: TriggerContext): number {
  return Math.max(0, ctx.nowMs - session.startedAtMs);
}

function currentBlock(session: TriggerSession, ctx: TriggerContext): number {
  return Math.floor(elapsedMs(session, ctx) / BLOCK_MS);
}

function personaBudget(session: TriggerSession): number {
  const p = PERSONAS[session.persona] ?? PERSONAS.facilitator;
  return p.proactiveBudget[session.intensity] ?? 0;
}

/** Which milestone (if any) is newly due right now, given the plan duration and what's fired. */
function dueMilestone(session: TriggerSession, ctx: TriggerContext): string | null {
  if (!session.durationMinutes || session.durationMinutes <= 0) return null;  // no plan → no milestones
  const totalMs = session.durationMinutes * 60_000;
  const el = elapsedMs(session, ctx);

  // 5-minutes-left fires once, in the last 5 minutes (but not after the session should have ended).
  if (el >= totalMs - FIVE_MIN_MS && el < totalMs && !ctx.firedMilestones.includes(FIVE_MIN_LEFT)) {
    return FIVE_MIN_LEFT;
  }
  // Fraction milestones fire once each, once elapsed passes the fraction.
  for (const f of MILESTONE_FRACTIONS) {
    const key = String(Math.round(f * 100));
    if (el >= f * totalMs && !ctx.firedMilestones.includes(key)) return key;
  }
  return null;
}

/** The under-participating targets (AI-07 rule) eligible to be nudged right now. Excludes
 *  opted-out (handled in isUnderparticipating) and anyone in private help, and only applies
 *  after the 10-minute warmup. */
function unevenTargets(session: TriggerSession, ctx: TriggerContext): string[] {
  if (elapsedMs(session, ctx) < UNEVEN_MIN_ELAPSED_MS) return [];
  if (ctx.median <= 0) return [];
  return ctx.participants
    .filter(p => isUnderparticipating(p, ctx.median))
    .filter(p => !ctx.privateHelpActive.has(p.userId))
    .map(p => p.userId);
}

function fillTemplate(key: keyof typeof INTERVENTION_TEMPLATES, slots: Record<string, string>): string {
  let msg = INTERVENTION_TEMPLATES[key] ?? "";
  // split/join instead of replaceAll — the tsconfig target lib is ES2020 (no String.replaceAll).
  for (const [k, v] of Object.entries(slots)) msg = msg.split(`{${k}}`).join(v);
  return msg;
}

/**
 * Evaluate the policy for one session at one instant. Returns the SINGLE decision to record
 * (at most one intervention per tick), or null when no rule's condition is met (so no row is
 * written — the engine never floods intervention_events with no-ops).
 *
 * Rule priority when several conditions are met at once: silence → time_milestone → uneven.
 * A rule whose condition fires but is blocked (cooldown/budget/paused/opt-out) does NOT hide
 * a lower-priority rule that CAN send — we prefer to actually help. Only if nothing can send
 * do we record the highest-priority block, so the audit shows why the room stayed quiet.
 */
export function evaluateTriggers(session: TriggerSession, ctx: TriggerContext): TriggerDecision | null {
  if (session.state !== "active" && session.state !== "frozen") return null;  // ended → nothing

  const paused = session.state === "frozen";
  const budget = personaBudget(session);
  const overBudget = ctx.sentThisBlock >= budget;

  // Build the candidate list in priority order.
  const candidates: { rule: TriggerRule; target: string | null; milestone?: string }[] = [];

  // 1. silence — the room has gone quiet.
  const hadActivity = ctx.lastActivityAtMs != null;
  const silent = hadActivity && (ctx.nowMs - ctx.lastActivityAtMs!) >= SILENCE_THRESHOLD_MS;
  if (silent) candidates.push({ rule: "silence", target: null });

  // 2. time milestone — a checkpoint just came due.
  const ms = dueMilestone(session, ctx);
  if (ms) candidates.push({ rule: "time_milestone", target: null, milestone: ms });

  // 3. uneven — a student is well below the room.
  for (const t of unevenTargets(session, ctx)) candidates.push({ rule: "uneven", target: t });

  if (candidates.length === 0) return null;

  // Resolve each candidate's decision; send the first that can, else remember the first block.
  let firstBlocked: TriggerDecision | null = null;

  for (const c of candidates) {
    const baseState: Record<string, any> = {
      elapsed_ms: elapsedMs(session, ctx), block: currentBlock(session, ctx),
      persona: session.persona, intensity: session.intensity, budget,
      sent_this_block: ctx.sentThisBlock, median: ctx.median,
    };

    // Blocks, in order of precedence.
    let decision: Decision | null = null;
    if (paused) decision = "suppressed_paused";
    else if (overBudget) decision = "suppressed_budget";
    else if (c.rule === "silence" && ctx.silenceLastSentMs != null && (ctx.nowMs - ctx.silenceLastSentMs) < SILENCE_COOLDOWN_MS) {
      decision = "suppressed_cooldown";
    } else if (c.rule === "uneven" && (ctx.unevenSentCount[c.target!] ?? 0) >= UNEVEN_MAX_PER_TARGET) {
      decision = "suppressed_cooldown";   // the per-person cap
    }

    if (decision) {
      // Record the first (highest-priority) block, but keep looking for something sendable.
      if (!firstBlocked) firstBlocked = { rule: c.rule, targetUserId: c.target, decision, message: null, milestone: c.milestone, state: baseState };
      continue;
    }

    // Sendable — fill the template. Uneven never states the score or names the low student in
    // the message: it's a general invitation, and target is recorded only in the audit row.
    let message: string;
    if (c.rule === "silence") {
      message = fillTemplate("silence", { remaining: session.durationMinutes ? `${Math.max(0, session.durationMinutes - Math.round(elapsedMs(session, ctx) / 60000))} min` : "some time", conceptA: "the last idea", conceptB: "what's on the board" });
    } else if (c.rule === "time_milestone") {
      const frac = c.milestone === FIVE_MIN_LEFT ? "5 minutes left" : `${c.milestone}%`;
      message = fillTemplate("time_milestone", { fraction: frac, covered: "what we've done", current: "the current thread" });
    } else {
      message = INTERVENTION_TEMPLATES.low_participation;   // deliberately general — no name, no score
    }

    return { rule: c.rule, targetUserId: c.target, decision: "sent", message, milestone: c.milestone, state: baseState };
  }

  // Nothing could send. Record why the top-priority candidate was blocked.
  return firstBlocked;
}

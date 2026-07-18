// api/_contracts.ts — the Study Room sprint's shared contract (BE-03 + AI-01).
// ONE source of truth for the DTOs, realtime channel names/payloads, and the canonical
// Student Brain profile schema. Server code imports values + types; CLIENT code must use
// `import type { ... } from "../../api/_contracts"` ONLY (type-only imports are erased at
// build, so no server code leaks into the bundle). Frozen per the Day-1 architecture
// contract — changes here require a review from the schema owner (Ryan).
//
// ID spaces (match the live DB — do not "fix" these):
//   users.id TEXT · study_rooms.id UUID · study_rooms.course_id BIGINT (Canvas)
//   rag_documents.id UUID · deck_profiles.course_id TEXT

// ─────────────────────────────────────────────────────────────────────────────
// Realtime channel naming (BE-05). Policies in supabase-studyroom-sprint-migration.sql
// gate these EXACT shapes once a channel is opened with { private: true }.
// ─────────────────────────────────────────────────────────────────────────────
export const channels = {
  room:          (roomId: string) => `room:${roomId}`,        // presence + broadcast (chat_message, pomodoro, wb_live, wb_cursor, wb_laser, raise_hand, room_closed, access_changed, ai_message, ai_speaking)
  whiteboard:    (roomId: string) => `wb-${roomId}`,          // Yjs doc sync (yjs_update / yjs_sync_req / yjs_sync_res)
  privateThread: (threadId: string) => `private:${threadId}`, // owner-only AI stream state
};

// Broadcast events the room channel may carry. New AI events are additive so the
// existing client keeps working untouched until Pratik wires the panel.
export type RoomBroadcastEvent =
  | "chat_message" | "pomodoro" | "raise_hand" | "room_closed" | "access_changed"
  | "wb_live" | "wb_cursor" | "wb_laser"
  | "ai_message"        // { messageId, persona, body, grounded: GroundingRef }
  | "ai_speaking"       // { on: boolean }
  | "session_state";    // { sessionId, state: "active"|"ended" }

// ─────────────────────────────────────────────────────────────────────────────
// Personas (AI-09). Runtime policies live in api/_personas.ts.
// ─────────────────────────────────────────────────────────────────────────────
export const PERSONA_IDS = ["facilitator", "peer_teaching", "clarifier", "challenger", "timekeeper", "observer"] as const;
export type PersonaId = typeof PERSONA_IDS[number];
export type InterventionIntensity = "low" | "balanced" | "active";

// ─────────────────────────────────────────────────────────────────────────────
// Student Brain — canonical profile document (AI-01), schema_version 1.
// Stored in brain_versions.profile (jsonb). Versions are immutable; proposals
// merge into a NEW version only after the student accepts (AI-12).
// ─────────────────────────────────────────────────────────────────────────────
export const BRAIN_SCHEMA_VERSION = 1;

export interface BrainEvidence { kind: "session" | "quiz" | "srs" | "chat" | "manual"; ref: string; note?: string }
export interface BrainTopicItem { topic: string; confidence: number; evidence?: BrainEvidence[] }

export interface BrainProfile {
  identity: { display_name: string };
  strengths: BrainTopicItem[];                 // never exposed to peers by name+gap pairing
  gaps: BrainTopicItem[];                      // NEVER exposed to peers or the group prompt with attribution
  teaching_preferences: string[];              // e.g. "visual", "worked_example", "stepwise"
  known_examples: string[];                    // analogies that landed
  mastery_evidence: BrainEvidence[];
  interaction_preferences: {
    invite_style: "gentle_direct" | "open_invite" | "no_cold_call";
    private_first: boolean;
  };
  accessibility: string[];                     // explicit opt-in only
  do_not_use: string[];                        // hard constraints for the persona runtime
}

/** Minimal structural validation — returns a list of problems (empty = valid). */
export function validateBrainProfile(p: any): string[] {
  const errs: string[] = [];
  if (!p || typeof p !== "object") return ["profile must be an object"];
  if (!p.identity?.display_name || typeof p.identity.display_name !== "string") errs.push("identity.display_name required");
  for (const k of ["strengths", "gaps"] as const) {
    if (!Array.isArray(p[k])) { errs.push(`${k} must be an array`); continue; }
    for (const it of p[k]) {
      if (!it || typeof it.topic !== "string" || !it.topic.trim()) errs.push(`${k}[] items need a topic`);
      else if (typeof it.confidence !== "number" || it.confidence < 0 || it.confidence > 1) errs.push(`${k} "${it.topic}": confidence must be 0..1`);
    }
  }
  for (const k of ["teaching_preferences", "known_examples", "accessibility", "do_not_use"] as const) {
    if (!Array.isArray(p[k]) || p[k].some((s: any) => typeof s !== "string")) errs.push(`${k} must be string[]`);
  }
  if (!Array.isArray(p.mastery_evidence)) errs.push("mastery_evidence must be an array");
  const ip = p.interaction_preferences;
  if (!ip || !["gentle_direct", "open_invite", "no_cold_call"].includes(ip.invite_style) || typeof ip.private_first !== "boolean") {
    errs.push("interaction_preferences.{invite_style,private_first} required");
  }
  return errs;
}

export function emptyBrainProfile(displayName: string): BrainProfile {
  return {
    identity: { display_name: displayName },
    strengths: [], gaps: [], teaching_preferences: [], known_examples: [], mastery_evidence: [],
    interaction_preferences: { invite_style: "open_invite", private_first: false },
    accessibility: [], do_not_use: [],
  };
}

/** Human-readable projection — derived, never canonical. */
export function brainToMarkdown(p: BrainProfile): string {
  const list = (xs: string[]) => (xs.length ? xs.map(x => `- ${x}`).join("\n") : "- (none)");
  const topics = (xs: BrainTopicItem[]) => (xs.length ? xs.map(t => `- ${t.topic} (confidence ${Math.round(t.confidence * 100)}%)`).join("\n") : "- (none)");
  return [
    `# Learning profile — ${p.identity.display_name}`,
    `\n## Strengths\n${topics(p.strengths)}`,
    `\n## Working on\n${topics(p.gaps)}`,
    `\n## Teaching preferences\n${list(p.teaching_preferences)}`,
    `\n## Examples that work\n${list(p.known_examples)}`,
    `\n## Interaction\n- Invite style: ${p.interaction_preferences.invite_style}\n- Prefers private hints first: ${p.interaction_preferences.private_first ? "yes" : "no"}`,
    p.accessibility.length ? `\n## Accessibility\n${list(p.accessibility)}` : "",
    p.do_not_use.length ? `\n## Do not use\n${list(p.do_not_use)}` : "",
  ].filter(Boolean).join("\n");
}

/**
 * Merge an accepted proposal patch into a profile → the NEW version's profile.
 * Array sections are unioned (topic items deduped by topic, patch wins on confidence);
 * interaction/identity are shallow-merged. Unknown keys in the patch are DROPPED —
 * a proposal can never smuggle new top-level sections into the canonical document.
 */
export function applyBrainPatch(base: BrainProfile, patch: Partial<BrainProfile>): BrainProfile {
  const out: BrainProfile = JSON.parse(JSON.stringify(base));
  const mergeTopics = (a: BrainTopicItem[], b?: BrainTopicItem[]) => {
    if (!Array.isArray(b)) return a;
    const m = new Map(a.map(t => [t.topic.toLowerCase(), t]));
    for (const t of b) {
      if (!t || typeof t.topic !== "string") continue;
      m.set(t.topic.toLowerCase(), { ...m.get(t.topic.toLowerCase()), ...t });
    }
    return [...m.values()].slice(0, 24);
  };
  const mergeStrs = (a: string[], b?: string[]) =>
    Array.isArray(b) ? [...new Set([...a, ...b.filter(s => typeof s === "string")])].slice(0, 24) : a;
  out.strengths = mergeTopics(out.strengths, patch.strengths);
  out.gaps = mergeTopics(out.gaps, patch.gaps);
  out.teaching_preferences = mergeStrs(out.teaching_preferences, patch.teaching_preferences);
  out.known_examples = mergeStrs(out.known_examples, patch.known_examples);
  out.accessibility = mergeStrs(out.accessibility, patch.accessibility);
  out.do_not_use = mergeStrs(out.do_not_use, patch.do_not_use);
  if (Array.isArray(patch.mastery_evidence)) out.mastery_evidence = [...out.mastery_evidence, ...patch.mastery_evidence].slice(-50);
  if (patch.interaction_preferences) out.interaction_preferences = { ...out.interaction_preferences, ...patch.interaction_preferences };
  if (patch.identity?.display_name) out.identity.display_name = patch.identity.display_name;
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Room teaching plan (AI-02 contract — composed at session start, stored server-only
// in room_brain_snapshots; clients only ever see RoomPlanSummary).
// ─────────────────────────────────────────────────────────────────────────────
export interface ParticipantSummary {
  user_id: string;
  display_name: string;
  invite_style: BrainProfile["interaction_preferences"]["invite_style"];
  strengths: string[];        // topic names only
  topic_gaps: string[];       // topic names only — group prompt may use these ONLY unattributed
  teaching_preferences: string[];
}
export interface GroupStrategy {
  default_explanation: string;                                  // e.g. "visual_then_stepwise"
  peer_teaching_pairs: { explainer: string; listener: string }[]; // display names
  avoid: string[];                                              // hard social constraints
}
export interface RoomTeachingPlan {
  version: number;
  participants: ParticipantSummary[];
  group_strategy: GroupStrategy;
}
/** The ONLY projection of the plan a client may receive. */
export interface RoomPlanSummary { participant_count: number; group_preferences: string[]; version: number }

// ─────────────────────────────────────────────────────────────────────────────
// room-session API DTOs (action-routed: POST /api/room-session?action=…)
// ─────────────────────────────────────────────────────────────────────────────
export interface StartSessionRequest {
  roomId: string;
  persona?: PersonaId;
  intensity?: InterventionIntensity;
  durationMinutes?: number;
}
export interface StartSessionResponse {
  ok: true;
  session: { id: string; roomId: string; state: "active"; startedAt: string; configVersion: number };
  config: { persona: PersonaId; intensity: InterventionIntensity; durationMinutes: number | null };
  roomPlan: RoomPlanSummary;
  resumed: boolean; // an active session already existed
}
export interface EndSessionResponse { ok: true; sessionId: string; state: "ended"; jobs: { type: string; id: string }[] }

export interface GroundingRef { sources: { documentId: string; title: string }[]; boardRevision: number | null; planVersion: number | null; generalKnowledge: boolean }

export interface ReviewResponse {
  ok: true;
  session: { id: string; roomId: string; startedAt: string; endedAt: string | null; state: string };
  groupSummary: any | null;          // session_summaries.summary (scope=group)
  mySummary: any | null;             // scope=individual, caller only
  myQuiz: any | null;                // quiz_sets.questions, caller only
  myProposals: { id: string; patch: Partial<BrainProfile>; evidence: BrainEvidence[] | null; confidence: number | null; status: string }[];
  jobs: Record<string, string>;      // job type → status
}

export interface ProposalDecideRequest { proposalId: string; decision: "accept" | "edit" | "reject"; patch?: Partial<BrainProfile> }

// Quiz item contract (AI-11): exactly five per set, validated before persistence.
export interface QuizItem { question: string; options: string[]; correctIndex: number; rationale: string; evidence?: string }
export function validateQuizSet(qs: any): string[] {
  const errs: string[] = [];
  if (!Array.isArray(qs) || qs.length !== 5) return ["quiz must be exactly 5 questions"];
  qs.forEach((q: any, i: number) => {
    if (!q?.question || typeof q.question !== "string") errs.push(`q${i + 1}: question required`);
    if (!Array.isArray(q?.options) || q.options.length !== 4) errs.push(`q${i + 1}: exactly 4 options`);
    if (typeof q?.correctIndex !== "number" || q.correctIndex < 0 || q.correctIndex > 3) errs.push(`q${i + 1}: correctIndex 0..3`);
    if (!q?.rationale) errs.push(`q${i + 1}: rationale required`);
  });
  return errs;
}

// Job types the end-session flow enqueues (worker: Siddharth, BE-08/AI-10/11/12).
export const JOB_TYPES = {
  summary: "generate_session_summary",
  quiz: "generate_quiz",
  brainProposal: "propose_brain_update",
  // A5 — fire-and-forget warm of a participant's brain context_window on room-session start, so the
  // C1 room-turn recall (800ms budget) hits a warm digest instead of a 3–8s cold rebuild.
  warmBrain: "warm_brain_context",
} as const;

// Activity-event allowlist (must match the DB check constraint).
export const ACTIVITY_EVENT_TYPES = [
  "chat_sent", "board_burst", "talk_to_ai", "peer_reply", "focus_state",
  "hand_raise", "private_help_state", "timer_milestone", "session_started", "session_ended",
] as const;
export type ActivityEventType = typeof ACTIVITY_EVENT_TYPES[number];

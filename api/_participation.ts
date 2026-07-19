// api/_participation.ts — AI-07: the participation aggregator.
//
// Turns BE-10's raw sub-scores (participant_metrics) into a normalized engagement score
// per student, plus the cohort statistics AI-08's "uneven participation" rule needs.
//
// INTERNAL ONLY. A participation score is never returned to a peer and never shown as a
// number to students — it exists to shape the AI's proactivity, nothing else. The prompt
// layer and the trigger engine are the only consumers; callers must not put a score on a
// client wire. (This is a usage contract; the module can't enforce it, so it's stated here
// and asserted in the AI-08 tests instead.)
//
// The score is a RATE (engagement per minute present), so a student present for 90 minutes
// is not ranked above one present for 10 just by clocking more raw events. Per-channel caps
// stop any single channel (e.g. a chat spammer) from dominating.

export interface RawMetrics {
  chat_score: number;
  board_score: number;
  peer_score: number;
  help_score: number;
  active_seconds: number;
}

export interface ScoredParticipant {
  userId: string;
  score: number;                 // normalized engagement rate (see below)
  optedOut: boolean;             // consent_room_pedagogy = false → excluded from cohort stats
  minutesPresent: number;
  breakdown: { chat: number; board: number; peer: number; help: number };  // capped, pre-weight
}

// The sprint formula: 0.35·chat + 0.35·board + 0.20·peer + 0.10·AI-questions.
export const PARTICIPATION_WEIGHTS = { chat: 0.35, board: 0.35, peer: 0.20, help: 0.10 } as const;

// Per-channel caps applied to the RAW sub-score before weighting. A single channel cannot
// contribute more than its cap, so one very loud channel can't drown the signal. Tunable.
export const CHANNEL_CAPS = { chat: 40, board: 40, peer: 20, help: 20 } as const;

// "uneven < 35% of the median after 10 min" — the AI-08 threshold, owned here so the rule
// and the scoring stay in one place.
export const UNDERPARTICIPATION_RATIO = 0.35;

const clampNonNeg = (n: any) => (Number.isFinite(+n) && +n > 0 ? +n : 0);

/**
 * Score one participant from their raw metrics.
 *
 * `optedOut` still yields a score (the caller may want it for the student's own view) but
 * the flag is what keeps them OUT of the cohort median and away from being named in a
 * trigger — that is how opt-out is "respected".
 */
export function scoreParticipant(userId: string, m: RawMetrics, optedOut = false): ScoredParticipant {
  const chat  = Math.min(clampNonNeg(m.chat_score),  CHANNEL_CAPS.chat);
  const board = Math.min(clampNonNeg(m.board_score), CHANNEL_CAPS.board);
  const peer  = Math.min(clampNonNeg(m.peer_score),  CHANNEL_CAPS.peer);
  const help  = Math.min(clampNonNeg(m.help_score),  CHANNEL_CAPS.help);

  const weighted =
    PARTICIPATION_WEIGHTS.chat  * chat +
    PARTICIPATION_WEIGHTS.board * board +
    PARTICIPATION_WEIGHTS.peer  * peer +
    PARTICIPATION_WEIGHTS.help  * help;

  // Normalize by time present. Floor at 1 minute so a few seconds of presence can't explode
  // the rate, and so missing focus data (active_seconds = 0) degrades to "treat as 1 minute"
  // rather than dividing by zero.
  const minutesPresent = Math.max(clampNonNeg(m.active_seconds) / 60, 1);
  const score = weighted / minutesPresent;

  return { userId, score, optedOut, minutesPresent, breakdown: { chat, board, peer, help } };
}

/**
 * Median score over the participating (non-opted-out) cohort. Opted-out students are
 * excluded so their absence doesn't drag the baseline the "uneven" rule compares against.
 * Returns 0 when there is no one to compare (caller treats 0 as "no signal").
 */
export function cohortMedian(scored: ScoredParticipant[]): number {
  const xs = scored.filter(s => !s.optedOut).map(s => s.score).sort((a, b) => a - b);
  if (xs.length === 0) return 0;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

/** A student's score as a fraction of the cohort median. Median 0 → 1 (no signal, so never
 *  flag anyone as under-participating when there is nothing to compare to). */
export function ratioToMedian(score: number, median: number): number {
  if (median <= 0) return 1;
  return score / median;
}

/**
 * Is this student under-participating relative to the room? Opted-out students never
 * qualify (they must not be singled out). The caller still gates on elapsed time (the rule
 * is "after 10 minutes") and cohort size — this is only the score half of the test.
 */
export function isUnderparticipating(p: ScoredParticipant, median: number): boolean {
  if (p.optedOut) return false;
  if (median <= 0) return false;
  return ratioToMedian(p.score, median) < UNDERPARTICIPATION_RATIO;
}

// ── DB loader ─────────────────────────────────────────────────────────────────
// participant_metrics + student_brains.consent are RLS-on deny-all, service-key only.
function db() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("Supabase env vars not configured");
  const headers: Record<string, string> = { apikey: key, Authorization: `Bearer ${key}` };
  return async (path: string) => {
    const r = await fetch(`${url}/rest/v1/${path}`, { headers });
    if (!r.ok) throw new Error(`select ${path.split("?")[0]} failed (${r.status})`);
    return (await r.json()) as any[];
  };
}

export interface SessionParticipation {
  participants: ScoredParticipant[];
  median: number;
}

/**
 * Load and score every participant in a session. Opt-out is read from
 * student_brains.consent_room_pedagogy (false → opted out of pedagogy use, so excluded from
 * cohort stats and never named by a trigger).
 */
export async function loadSessionParticipation(sessionId: string): Promise<SessionParticipation> {
  const select = db();
  const metrics = await select(
    `participant_metrics?session_id=eq.${sessionId}&select=user_id,chat_score,board_score,peer_score,help_score,active_seconds`,
  );
  if (!metrics.length) return { participants: [], median: 0 };

  const ids = metrics.map(m => m.user_id);
  // `in.(a,b,c)` — user ids are text; quote to be safe against odd characters.
  const inList = ids.map(id => `"${String(id).replace(/"/g, "")}"`).join(",");
  const consent = await select(
    `student_brains?user_id=in.(${inList})&select=user_id,consent_room_pedagogy`,
  );
  const optedOut = new Set(
    consent.filter(c => c.consent_room_pedagogy === false).map(c => c.user_id),
  );

  const participants = metrics.map(m => scoreParticipant(m.user_id, m, optedOut.has(m.user_id)));
  return { participants, median: cohortMedian(participants) };
}

// src/lib/sessionReview.ts — pure logic for the Session Review screen.
// The summary/quiz/proposals are generated asynchronously by the jobs worker after a session ends,
// so the review endpoint returns a `jobs` status map and the screen polls until they're done. This
// keeps the "are we still waiting?" decision pure + unit-testable.

export type ReviewJobs = Record<string, string>;

// A job is "done" (stop waiting on it) once it reaches any terminal state.
const TERMINAL = new Set([
  "done", "succeeded", "success", "complete", "completed",
  "failed", "error", "cancelled", "dead", "skipped",
]);

/** True while ANY review job (summary / quiz / brain-proposal) is still being generated — the
 *  screen polls while this holds (the component also bounds it with a wall-clock timeout). An
 *  empty/absent map means nothing is queued, so we are not waiting. */
export function jobsPending(jobs: ReviewJobs | null | undefined): boolean {
  if (!jobs) return false;
  const vals = Object.values(jobs);
  if (vals.length === 0) return false;
  return vals.some((s) => !TERMINAL.has(String(s).toLowerCase()));
}

// whatIfPlan.ts — study.what_if (client-pure). Recompute a hypothetical study plan
// locally, with NO server or LLM call, so the UI can explore "what if I drop this
// topic / move the exam up / study more per day" instantly on already-loaded data.
// The plan shape mirrors what api/exam.ts (generate_plan) returns.
// Contract: fschoolai_tool_contracts.md §D (study.what_if) — explicitly client-pure.

export interface PlanSession {
  date: string;                 // ISO date (YYYY-MM-DD)
  topic: string;
  activities: string[];
  materialIds?: string[];
  estimatedMinutes?: number;
}

export interface StudyPlan {
  planId?: string;
  examDate?: string;            // ISO date of the exam this plan targets
  sessions: PlanSession[];
}

export interface WhatIfChanges {
  examDate?: string;            // move the exam
  dropTopics?: string[];        // remove sessions covering these topics
  dailyMinutes?: number;        // new per-day study budget
}

export interface WhatIfResult {
  projectedPlan: StudyPlan;
  readiness: number;            // 0–1 estimate of coverage vs. available time
  deltas: string[];             // human-readable summary of what changed
}

const DAY_MS = 86_400_000;

function parseDate(d?: string): number | null {
  if (!d) return null;
  const t = Date.parse(d);
  return Number.isNaN(t) ? null : t;
}

/** Pure, deterministic what-if recompute. Throws on a malformed basePlan. */
export function whatIf(basePlan: StudyPlan, changes: WhatIfChanges = {}): WhatIfResult {
  if (!basePlan || !Array.isArray(basePlan.sessions)) {
    throw new Error("whatIf: basePlan.sessions must be an array");
  }

  const deltas: string[] = [];
  const drop = new Set(
    (changes.dropTopics ?? []).map((t) => String(t).trim().toLowerCase()).filter(Boolean),
  );

  // 1. Drop topics
  let sessions = basePlan.sessions;
  if (drop.size) {
    const before = sessions.length;
    sessions = sessions.filter((s) => !drop.has(String(s.topic ?? "").trim().toLowerCase()));
    const removed = before - sessions.length;
    if (removed > 0) {
      deltas.push(`Dropped ${drop.size} topic${drop.size > 1 ? "s" : ""} (${removed} session${removed > 1 ? "s" : ""} freed)`);
    }
  }

  // 2. Re-cap per-session minutes to the new daily budget
  if (changes.dailyMinutes != null && changes.dailyMinutes > 0) {
    const cap = changes.dailyMinutes;
    sessions = sessions.map((s) => {
      const est = s.estimatedMinutes ?? cap;
      return est > cap ? { ...s, estimatedMinutes: cap } : s;
    });
    deltas.push(`Daily study budget set to ${cap} min`);
  }

  // 3. Exam-date shift (informational delta)
  const oldExamMs = parseDate(basePlan.examDate);
  const newExamMs = parseDate(changes.examDate);
  if (newExamMs != null && oldExamMs != null && newExamMs !== oldExamMs) {
    const days = Math.round((newExamMs - oldExamMs) / DAY_MS);
    deltas.push(days < 0
      ? `Exam moved up ${-days} day${-days > 1 ? "s" : ""}`
      : `Exam pushed back ${days} day${days > 1 ? "s" : ""}`);
  }

  // 4. Readiness = available study time vs. time the remaining plan needs.
  const neededMinutes = sessions.reduce((s, x) => s + (x.estimatedMinutes ?? 0), 0);
  const examMs = newExamMs ?? oldExamMs;
  const firstSessionMs = sessions.reduce<number | null>((min, x) => {
    const t = parseDate(x.date);
    return t != null && (min == null || t < min) ? t : min;
  }, null);

  let readiness = 1;
  if (neededMinutes > 0 && examMs != null && firstSessionMs != null) {
    if (examMs <= firstSessionMs) {
      readiness = 0;                            // exam at/before study starts → no time to prepare
    } else {
      const daysAvail = Math.max(1, Math.round((examMs - firstSessionMs) / DAY_MS));
      const perDay = changes.dailyMinutes && changes.dailyMinutes > 0
        ? changes.dailyMinutes
        : neededMinutes / daysAvail;            // no budget given → assume the plan fits
      readiness = (perDay * daysAvail) / neededMinutes;
    }
  }
  readiness = Math.max(0, Math.min(1, readiness));

  if (!deltas.length) deltas.push("No changes applied");

  return {
    projectedPlan: { ...basePlan, examDate: changes.examDate ?? basePlan.examDate, sessions },
    readiness,
    deltas,
  };
}

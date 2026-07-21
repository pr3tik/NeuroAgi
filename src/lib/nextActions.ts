// nextActions.ts — the ONE ranking behind the Home "Today" panel.
//
// Every proactive engine (Canvas deadlines, the exam-plan cron, spaced repetition)
// used to own its own Home card, leaving the student to synthesize five widgets.
// This pure function merges them into a single ranked answer to "what should I do
// right now?" — deterministic, no LLM, unit-tested. The panel renders its output;
// anything else that surfaces "what's next" (notifications, nudges) should rank
// with THIS function so push and pull never disagree.
//
// Diversity rule: at most ONE row per source, with the remainder folded into the
// row's detail ("+6 more overdue") — three rows of overdue assignments is a list,
// not a synthesis; the full list lives lower on the page.

export interface NextAction {
  key: string;
  kind: "overdue" | "due_today" | "plan_session" | "due_tomorrow" | "srs";
  title: string;
  detail: string;          // the WHY — which engine produced this row
  minutes: number | null;  // estimated time cost, when the source knows it
  page: string;            // fschool:navigate target
  score: number;
}

const DAY_MS = 86_400_000;

function calDays(from: Date, to: Date): number {
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const b = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((+b - +a) / DAY_MS);
}

function courseTag(a: any): string {
  return a.courseCode ?? a.courseName ?? "";
}

export function deriveNextActions(input: {
  assignments?: any[];
  plan?: { exam_date: string; sessions?: any[] } | null;
  srsDue?: number;
  now?: Date;
}): NextAction[] {
  const { assignments = [], plan = null, srsDue = 0 } = input;
  const now = input.now ?? new Date();
  const pool: NextAction[] = [];

  const unsubmitted = assignments.filter((a) => a?.dueAt && !a.submission?.submittedAt);
  const overdue = unsubmitted
    .filter((a) => calDays(now, new Date(a.dueAt)) < 0)
    .sort((a, b) => +new Date(b.dueAt) - +new Date(a.dueAt));   // most recently missed = most recoverable
  const dueToday = unsubmitted
    .filter((a) => calDays(now, new Date(a.dueAt)) === 0)
    .sort((a, b) => +new Date(a.dueAt) - +new Date(b.dueAt));
  const dueTomorrow = unsubmitted
    .filter((a) => calDays(now, new Date(a.dueAt)) === 1)
    .sort((a, b) => +new Date(a.dueAt) - +new Date(b.dueAt));

  if (overdue.length) {
    const a = overdue[0];
    pool.push({
      key: `overdue:${a.id ?? a.name}`, kind: "overdue",
      title: a.name,
      detail: `${courseTag(a)} · overdue${overdue.length > 1 ? ` · +${overdue.length - 1} more overdue` : ""}`,
      minutes: null, page: "canvas", score: 100,
    });
  }
  if (dueToday.length) {
    const a = dueToday[0];
    pool.push({
      key: `due_today:${a.id ?? a.name}`, kind: "due_today",
      title: a.name,
      detail: `${courseTag(a)} · due today${dueToday.length > 1 ? ` · +${dueToday.length - 1} more today` : ""}`,
      minutes: null, page: "canvas", score: 90,
    });
  }

  // Exam plan: today's session outranks tomorrow's deadline (studying for Friday's
  // exam beats starting tomorrow's homework early); a future session ranks below it.
  const sessions = Array.isArray(plan?.sessions) ? plan!.sessions : [];
  const daysToExam = plan ? calDays(now, new Date(plan.exam_date + "T12:00:00")) : null;
  const todaySession = sessions.find((s) => s?.date && calDays(now, new Date(s.date + "T12:00:00")) === 0);
  const nextSession = sessions
    .filter((s) => s?.date && calDays(now, new Date(s.date + "T12:00:00")) > 0)
    .sort((a, b) => +new Date(a.date) - +new Date(b.date))[0];
  const planRow = todaySession ?? nextSession;
  if (planRow && daysToExam != null && daysToExam >= 0) {
    pool.push({
      key: `plan:${planRow.date}:${planRow.topic}`, kind: "plan_session",
      title: `Study: ${planRow.topic}`,
      detail: `${todaySession ? "today's session" : `next session ${planRow.date}`} · exam in ${daysToExam === 0 ? "0 days — today" : daysToExam === 1 ? "1 day" : `${daysToExam} days`}`,
      minutes: Number(planRow.estimatedMinutes) || 60,
      page: "studyAssistant", score: todaySession ? 85 : 60,
    });
  }

  if (dueTomorrow.length) {
    const a = dueTomorrow[0];
    pool.push({
      key: `due_tomorrow:${a.id ?? a.name}`, kind: "due_tomorrow",
      title: a.name,
      detail: `${courseTag(a)} · due tomorrow${dueTomorrow.length > 1 ? ` · +${dueTomorrow.length - 1} more tomorrow` : ""}`,
      minutes: null, page: "canvas", score: 70,
    });
  }

  if (srsDue > 0) {
    pool.push({
      key: "srs", kind: "srs",
      title: `Review ${srsDue} flashcard${srsDue === 1 ? "" : "s"}`,
      detail: "spaced repetition · due now",
      minutes: Math.max(2, Math.min(15, Math.ceil(srsDue / 3))),
      page: "study", score: 55,
    });
  }

  return pool.sort((a, b) => b.score - a.score).slice(0, 3);
}

// api/_reggie/router.ts — Reggie's intent router: message → one specialist route.
// Three tiers (cheap → precise): explicit hint/action → PRECISE phrase rules → a Haiku
// classifier over the CLOSED set (with per-route descriptions), fail-open to tutor.
// The phrase rules are deliberately specific so ambiguous single words ("grade", "plan")
// don't hijack a route — those fall through to the model, which routes better.
import { callModel } from "../_gateway.js";

const TASK_HINTS: Record<string, string> = {
  ask: "tutor", tutor: "tutor", explain: "tutor",
  briefing: "planner", daily_briefing: "planner", weekly_plan: "planner", exam_prep: "planner", plan: "planner", planner: "planner",
  what_if: "insight_explainer", grades: "insight_explainer", grade: "insight_explainer", insight: "insight_explainer",
  digest_lecture: "content_synthesizer", flashcards: "content_synthesizer", quiz: "content_synthesizer", summarize: "content_synthesizer", content: "content_synthesizer",
  find_resources: "resource_curator", resources: "resource_curator",
  start_assignment: "writing_coach", essay: "writing_coach", writing: "writing_coach",
  office_hours: "question_coach", questions: "question_coach", tokens: "tutor", points: "tutor",
};

// Ordered, PRECISE rules — first match wins. A rule fires only if its route is available.
const KEYWORD_RULES: Array<[RegExp, string]> = [
  // writing_coach — analyzing the student's own writing (before question_coach's generic "check my …")
  [/\b(analy[sz]e|review|improve)\b[^.?!]*\b(my|this)\b[^.?!]*\b(writing|essay|draft|paper|paragraph)\b|how('s| is) my writing/i, "writing_coach"],
  // insight_explainer — professor feedback / lost points on submitted work
  [/\bfeedback\b[^.?!]{0,30}\b(on|for|about)\b|why did i (lose|get docked)\b|\brubric\b|what did (the |my )?(prof|professor|teacher|ta) (say|comment)/i, "insight_explainer"],
  // question_coach — office-hours prep, then grading the student's OWN answers / practice
  [/office hours?/i, "question_coach"],
  [/\b(grade|check|mark|evaluate|score)\b[^.?!]*\b(my|these|this|the)\b[^.?!]*\b(answer|answers|response|work|attempt|essay|solution)\b|\bam i (right|correct)\b|\bhow did i do\b|\bgrade (my|these|this)\b/i, "question_coach"],
  // tutor — live-Canvas reads: announcements, inbox, past terms
  [/\bannouncements?\b|did (my|the) (prof|professor|teacher|ta) (post|announce|say anything)|\bcanvas (inbox|messages?)\b|messages? from (my |the )?(prof|professor|teacher|ta)|what did i take last (term|semester|year)|\bpast courses\b/i, "tutor"],
  // insight_explainer — what-if scenarios & grade standing/weighting
  [/\bwhat[-\s]?if\b|\bif i (get|score|drop|skip|move|only)\b|\bprojected grade\b|\bgrade[-\s]?weight|weighted grade|\bhow (is|are|'?s) my grades?\b|\bwhat('?s| is| are)?\s+(my\s+)?grades?\b|\bmy grades?\b|\bmy gpa\b|\bfinal grade\b|\bhow am i doing\b|do i need (on|to)\b/i, "insight_explainer"],
  // planner — deadlines, dated study plans, and overdue/past-due work
  [/\bstudy plan\b|\bplan (for|my|a)\b|study schedule|what'?s due|due (this|next|soon|today)|\bdeadlines?\b|\boverdue\b|past[-\s]?due|\bbehind\b|\blate\b|what did i miss|missing assignments?|prioriti[sz]e|daily briefing|what should i (do|work on|study|focus on)( first| next| today| this week)?/i, "planner"],
  // content_synthesizer — study aids
  [/\bquiz me\b|\b(make|create|generate|build)\b[^.?!]{0,20}\b(quiz|practice|flashcards?)\b|practice questions?\b|\bflashcards?\b|concept map|mind ?map|\bsummari[sz]e\b|study guide/i, "content_synthesizer"],
  // writing_coach
  [/\bessay\b|\boutline\b|\bthesis\b|\brough draft\b|\bmy paper\b|\bargument\b|revise my|help me write/i, "writing_coach"],
  // resource_curator
  [/what (resources|materials?|readings?)\b|reading list|what should i read|point me to/i, "resource_curator"],
  // tokens / gamification (tutor holds token_summary)
  [/how many (points|tokens)|\bmy (points|tokens|tier)\b|what tier|token balance/i, "tutor"],
];

const ROUTE_DESC: Record<string, string> = {
  tutor: "general questions, explanations, points/tokens, Canvas announcements/inbox/modules, past courses, or anything not covered by another specialist",
  insight_explainer: "the student's grades, projected grade, grade weighting, GPA, what-if scenarios, and the professor's feedback/rubric on submitted work",
  planner: "what's due, deadlines, prioritizing work, and building dated study plans for an exam",
  content_synthesizer: "making study materials from their content — quizzes, flashcards, summaries, concept maps",
  question_coach: "quizzing the student, grading THEIR practice answers with feedback, and prepping questions for office hours",
  writing_coach: "essays and writing — outlining, argument structure, revision, analyzing their drafts (never writing the submission for them)",
  resource_curator: "pointing the student to the most relevant material they already have",
};

/** Map an explicit product action / hint to a route, or null if not recognized. */
export function hintToRoute(hint?: string | null): string | null {
  if (!hint) return null;
  return TASK_HINTS[String(hint).trim().toLowerCase()] ?? null;
}

export async function classifyIntent(message: string, routes: string[], hint?: string | null): Promise<string> {
  const set = new Set(routes);
  const fallback = set.has("tutor") ? "tutor" : routes[0];
  if (!routes.length) return "tutor";

  // 1. explicit hint
  const hinted = hintToRoute(hint);
  if (hinted && set.has(hinted)) return hinted;

  // 2. precise phrase rules
  const msg = String(message || "");
  for (const [re, route] of KEYWORD_RULES) {
    if (set.has(route) && re.test(msg)) return route;
  }

  // 3. model classification over the closed set, with descriptions — fail-open
  try {
    const menu = routes.map((r) => `- ${r}: ${ROUTE_DESC[r] ?? ""}`).join("\n");
    const prompt =
      `Route the student's message to exactly ONE specialist. Reply with ONLY the label, nothing else.\n\n${menu}\n\n` +
      `Message: ${JSON.stringify(msg.slice(0, 400))}`;
    const r = await callModel({ task: "classify", messages: [{ role: "user", content: prompt }], max_tokens: 16, metadata: { tool: "reggie.route" } });
    if (r.ok) {
      const pick = String(r.content || "").trim().toLowerCase().replace(/[^a-z_]/g, "");
      if (set.has(pick)) return pick;
      for (const route of routes) if (pick.includes(route)) return route;
    }
  } catch { /* fall through to tutor */ }

  return fallback;
}

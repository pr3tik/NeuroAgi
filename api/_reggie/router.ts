// api/_reggie/router.ts — Reggie's intent router: message → one specialist route.
// Three tiers (cheap → expensive), ported/adapted from feat/optimize's classify_intent:
//   1. an explicit hint / product action (deterministic map)
//   2. keyword rules (deterministic, no model call)
//   3. a Haiku classification over the CLOSED route set (fail-open to tutor)
// Never returns a route outside the provided set.
import { callModel } from "../_gateway.js";

const TASK_HINTS: Record<string, string> = {
  ask: "tutor", tutor: "tutor", explain: "tutor",
  briefing: "planner", daily_briefing: "planner", weekly_plan: "planner", exam_prep: "planner", plan: "planner", planner: "planner",
  what_if: "insight_explainer", grades: "insight_explainer", grade: "insight_explainer", insight: "insight_explainer",
  digest_lecture: "content_synthesizer", flashcards: "content_synthesizer", quiz: "content_synthesizer", summarize: "content_synthesizer", content: "content_synthesizer",
  find_resources: "resource_curator", resources: "resource_curator",
  start_assignment: "writing_coach", essay: "writing_coach", writing: "writing_coach",
  office_hours: "question_coach", questions: "question_coach",
};

const KEYWORD_TASKS: Array<[string[], string]> = [
  [["exam", "weekly", "next week", "plan", "briefing", "today", "schedule", "deadline", "due"], "planner"],
  [["grade", "what-if", "what if", "my score", "final grade", "gpa", "weighted", "projected"], "insight_explainer"],
  [["summarize", "summary", "lecture", "flashcard", "quiz", "digest", "concept map", "framework"], "content_synthesizer"],
  [["resource", "video", "podcast", "article", "reading list"], "resource_curator"],
  [["essay", "paper", "draft", "outline", "scaffold", "thesis"], "writing_coach"],
  [["office hour", "professor", "ask my teacher", "question to ask"], "question_coach"],
];

/** Map an explicit product action / hint to a route, or null if not recognized. */
export function hintToRoute(hint?: string | null): string | null {
  if (!hint) return null;
  const n = String(hint).trim().toLowerCase();
  return TASK_HINTS[n] ?? null;
}

export async function classifyIntent(message: string, routes: string[], hint?: string | null): Promise<string> {
  const set = new Set(routes);
  const fallback = set.has("tutor") ? "tutor" : routes[0];
  if (!routes.length) return "tutor";

  // 1. explicit hint
  const hinted = hintToRoute(hint);
  if (hinted && set.has(hinted)) return hinted;

  // 2. keyword rules
  const lower = String(message || "").toLowerCase();
  for (const [needles, route] of KEYWORD_TASKS) {
    if (set.has(route) && needles.some((n) => lower.includes(n))) return route;
  }

  // 3. model classification over the closed set — fail-open
  try {
    const prompt =
      `Route the student's message to exactly ONE specialist. Reply with ONLY the label, nothing else.\n` +
      `Labels: ${routes.join(", ")}\n` +
      `Message: ${JSON.stringify(String(message).slice(0, 300))}`;
    const r = await callModel({ task: "classify", messages: [{ role: "user", content: prompt }], max_tokens: 12, metadata: { tool: "reggie.route" } });
    if (r.ok) {
      const pick = String(r.content || "").trim().toLowerCase().replace(/[^a-z_]/g, "");
      if (set.has(pick)) return pick;
      for (const route of routes) if (pick.includes(route)) return route;
    }
  } catch { /* fall through to tutor */ }

  return fallback;
}

// api/_reggie/specialists.ts — Reggie's specialists as SCOPED LOOP CONFIGS (a system
// prompt + an allowed tool subset), NOT separate agent runtimes. This is the reconciled
// design: feat/optimize routes to separate specialist graphs, but PRD §19.9 settled on
// "one router + one tool-use loop" where specialists are tool-groupings/skills. The same
// loop (loop.ts) runs with whichever config the router selects.

export interface Specialist {
  key: string;
  title: string;
  task: string;                                     // gateway task label (model routing)
  tools: string[];                                  // tool names from the registry (allow-list)
  system: (opts: { brainContext?: string | null }) => string;
}

const INTEGRITY =
  "Academic integrity: help the student LEARN — explain, guide, quiz, and give feedback. " +
  "Never write a graded assignment, essay, or exam answer for them to submit; scaffold and coach instead.";

function base(persona: string, brainContext?: string | null): string {
  const ctx = brainContext
    ? `\n\nWhat you currently know about this student (from their brain — personalize with it; do NOT read it back verbatim):\n${brainContext}`
    : "";
  return (
    `You are Reggie, FschoolAI's AI tutor. ${persona}\n\n` +
    `You are a GENERAL tutor: answer any question — concepts, homework help, explanations, writing, life/study advice — directly and naturally, the way a knowledgeable tutor would. Do NOT steer every conversation back to Canvas, grades, or deadlines, and do not call a tool for general-knowledge questions.\n` +
    `Use your tools ONLY when the question is about THIS student's own data — their grades, their courses, their deadlines/overdue work, or their uploaded materials. In those cases fetch the real data instead of guessing, and never invent grades, deadlines, or quiz content you could fetch. If a tool returns an error or nothing, say so plainly and continue with what you have. Be concise and encouraging.\n` +
    INTEGRITY + ctx
  );
}

export const SPECIALISTS: Record<string, Specialist> = {
  tutor: {
    key: "tutor", title: "General tutor", task: "tutor",
    tools: ["rag_search", "canvas_get_grades", "canvas_get_upcoming", "summarize_text", "list_flashcards", "token_summary"],
    system: (o) => base("Answer the student's question clearly and help them understand it, pulling from their uploaded materials (rag_search) and Canvas data when relevant.", o.brainContext),
  },
  insight_explainer: {
    key: "insight_explainer", title: "Grades & what-if", task: "tutor",
    tools: ["canvas_get_grades", "compute_grade_weights", "what_if_plan", "canvas_get_upcoming", "token_summary"],
    system: (o) => base("Explain the student's grade standing and run what-if scenarios. Fetch real grades/weights BEFORE any math, and show the numbers you used.", o.brainContext),
  },
  planner: {
    key: "planner", title: "Planning & deadlines", task: "tutor",
    tools: ["canvas_get_upcoming", "canvas_get_grades", "generate_study_plan", "what_if_plan"],
    system: (o) => base("Help the student plan: what's due, what they're OVERDUE/behind on (call canvas_get_upcoming with status:'overdue'), what to prioritize, dated study plans for exams (based on their REAL upcoming work), and what-if tweaks to an existing plan (drop a topic, move the exam, change daily minutes) via what_if_plan.", o.brainContext),
  },
  content_synthesizer: {
    key: "content_synthesizer", title: "Study materials", task: "tutor",
    tools: ["rag_search", "generate_quiz", "list_flashcards", "save_flashcards", "summarize_text", "generate_framework"],
    system: (o) => base("Turn the student's materials into study aids — quizzes, flashcards, summaries, concept maps — grounded in their actual course content (rag_search).", o.brainContext),
  },
  question_coach: {
    key: "question_coach", title: "Practice & feedback", task: "tutor",
    tools: ["rag_search", "generate_quiz", "evaluate_answers"],
    system: (o) => base("Coach the student through practice: quiz them, grade their answers, and give targeted feedback on gaps.", o.brainContext),
  },
  writing_coach: {
    key: "writing_coach", title: "Writing", task: "tutor",
    tools: ["rag_search", "summarize_text", "generate_framework"],
    system: (o) => base("Coach the student's writing — outline, argument structure, revision — WITHOUT writing the submission for them. Use their sources (rag_search).", o.brainContext),
  },
  resource_curator: {
    key: "resource_curator", title: "Resources", task: "tutor",
    tools: ["rag_search"],
    system: (o) => base("Point the student to the most relevant material they already have for their question, and suggest what to study next.", o.brainContext),
  },
};

export const ROUTES: string[] = Object.keys(SPECIALISTS);

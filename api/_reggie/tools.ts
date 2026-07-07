// api/_reggie/tools.ts — Reggie's tool catalog: the product capabilities the tool-use
// loop can call, each as an Anthropic tool spec (name/description/input_schema) plus an
// `invoke` that runs the REAL api/* handler in-process (or a pure lib fn). This is the
// analogue of feat/optimize's agents/_shared/tools, but wired to the shipped handlers
// rather than stubs.
//
// Scope: agent-turn tools only — reads, generation, and pure computation. Pipeline /
// background / mutation-heavy endpoints (rag ingest+embed, transcribe, lms-ingest, the
// arbiter / nudge / cron senders) are intentionally NOT in the chat catalog; they have
// their own tests and aren't things Reggie calls mid-conversation.
import canvasReads from "../canvas-reads.js";
import gradeWeights from "../grade-weights.js";
import exam from "../exam.js";
import rag from "../rag.js";
import flashcards from "../flashcards.js";
import summarize from "../summarize.js";
import tokenEngine from "../token-engine.js";
import { whatIf } from "../../src/lib/whatIfPlan.js";
import { callApi } from "./callApi.js";

export interface ToolContext {
  userId: string;
  courseId?: any;
  assignmentId?: any;
}

export interface ReggieTool {
  name: string;
  description: string;
  input_schema: any;                                   // Anthropic tool input schema (JSON Schema)
  invoke: (args: any, ctx: ToolContext) => Promise<any>;
}

// Run a handler and unwrap: throw on >=400 so the loop records a recoverable tool error
// (surfaced to the model as an is_error tool_result) instead of crashing the turn.
async function call(handler: any, opts: any, label: string): Promise<any> {
  const { status, body } = await callApi(handler, opts);
  if (status >= 400) throw new Error(body?.error ? `${label}: ${body.error}` : `${label}: HTTP ${status}`);
  return body;
}

export const TOOLS: ReggieTool[] = [
  // ── A. Canvas / academic data ────────────────────────────────────────────────
  {
    name: "canvas_get_grades",
    description:
      "Get the student's per-course grade standing (current/final %, per-assignment scores + weights) and GPA from synced Canvas data. Call to answer 'how am I doing in X', 'what are my grades', 'my GPA'.",
    input_schema: {
      type: "object",
      properties: { courseId: { type: ["string", "number", "null"], description: "Optional: one course (DB uuid or Canvas id). Omit for all courses." } },
      required: [],
    },
    invoke: (a, ctx) => call(canvasReads, { body: { action: "grades", userId: ctx.userId, courseId: a.courseId ?? ctx.courseId ?? null } }, "canvas_get_grades"),
  },
  {
    name: "canvas_get_upcoming",
    description:
      "List the student's upcoming unsubmitted assignments, soonest first. Call for 'what's due', 'what should I work on next', deadline questions.",
    input_schema: {
      type: "object",
      properties: {
        withinDays: { type: "integer", description: "Only assignments due within N days from now (omit for all future)." },
        includeSubmitted: { type: "boolean", description: "Include already-submitted work (default false)." },
      },
      required: [],
    },
    invoke: (a, ctx) => call(canvasReads, { body: { action: "upcoming", userId: ctx.userId, withinDays: a.withinDays, includeSubmitted: !!a.includeSubmitted } }, "canvas_get_upcoming"),
  },
  {
    name: "compute_grade_weights",
    description:
      "Get a course's grade-category weights and a points-based projected grade. Call when the student asks how their grade is weighted or what their projected grade is.",
    input_schema: {
      type: "object",
      properties: { courseId: { type: ["string", "number"], description: "Course DB uuid or Canvas id." } },
      required: ["courseId"],
    },
    invoke: (a, ctx) => call(gradeWeights, { body: { userId: ctx.userId, courseId: a.courseId } }, "compute_grade_weights"),
  },

  // ── B. RAG / retrieval ─────────────────────────────────────────────────────────
  {
    name: "rag_search",
    description:
      "Search the student's OWN uploaded course materials (notes, slides, readings, transcripts) and return the most relevant passages. Call this BEFORE answering any content question so you ground the answer in their materials instead of guessing.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to look up in the student's materials." },
        courseId: { type: ["string", "null"], description: "Optional course filter (DB uuid)." },
        maxSections: { type: "integer", description: "Max passages to return (default 4)." },
      },
      required: ["query"],
    },
    invoke: (a, ctx) => call(rag, { query: { action: "query" }, body: { userId: ctx.userId, query: a.query, courseId: a.courseId ?? ctx.courseId ?? null, maxSections: a.maxSections ?? 4 } }, "rag_search"),
  },

  // ── D. Generation ────────────────────────────────────────────────────────────
  {
    name: "generate_quiz",
    description:
      "Generate a practice quiz from a source: a documentId, a courseId, or raw text. Call for 'quiz me', 'make practice questions'.",
    input_schema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Raw source text (use this OR documentId OR courseId)." },
        documentId: { type: "string" },
        courseId: { type: ["string", "integer"] },
        count: { type: "integer", description: "Number of questions (default 5, max 20)." },
        difficulty: { enum: ["easy", "medium", "hard"] },
      },
      required: [],
    },
    invoke: (a, ctx) => call(exam, { body: { action: "generate_quiz", userId: ctx.userId, text: a.text, documentId: a.documentId, courseId: a.courseId ?? ctx.courseId, count: a.count, difficulty: a.difficulty } }, "generate_quiz"),
  },
  {
    name: "evaluate_answers",
    description:
      "Grade the student's answers against reference answers/rubric — per-item correct/score/feedback + total. Call after they submit practice answers.",
    input_schema: {
      type: "object",
      properties: {
        items: {
          type: "array", minItems: 1,
          items: {
            type: "object",
            properties: {
              question: { type: "string" },
              studentAnswer: { type: "string" },
              referenceAnswer: { type: "string" },
              rubric: { type: "string" },
              type: { enum: ["multiple_choice", "short_answer"] },
            },
            required: ["question", "studentAnswer"],
          },
        },
      },
      required: ["items"],
    },
    invoke: (a) => call(exam, { body: { action: "evaluate_answers", items: a.items } }, "evaluate_answers"),
  },
  {
    name: "generate_study_plan",
    description: "Produce a dated study plan for an upcoming exam. Call for 'help me plan for my exam on <date>'.",
    input_schema: {
      type: "object",
      properties: {
        courseId: { type: ["string", "integer"] },
        examDate: { type: "string", description: "Exam date, YYYY-MM-DD." },
        topics: { type: "array", items: { type: "string" } },
        dailyMinutes: { type: "integer" },
      },
      required: ["courseId", "examDate"],
    },
    invoke: (a, ctx) => call(exam, { body: { action: "generate_plan", userId: ctx.userId, courseId: a.courseId ?? ctx.courseId, examDate: a.examDate, topics: a.topics, dailyMinutes: a.dailyMinutes } }, "generate_study_plan"),
  },
  {
    name: "generate_framework",
    description: "Build a concept map (nodes + directed edges) for a topic or the student's materials, for the whiteboard. Call for 'map out how these concepts connect'.",
    input_schema: {
      type: "object",
      properties: { topic: { type: "string" }, documentIds: { type: "array", items: { type: "string" } } },
      required: [],
    },
    invoke: (a, ctx) => call(exam, { body: { action: "generate_framework", userId: ctx.userId, topic: a.topic, documentIds: a.documentIds } }, "generate_framework"),
  },
  {
    name: "list_flashcards",
    description: "Load the student's saved flashcards for a course. Call to review existing cards.",
    input_schema: { type: "object", properties: { courseId: { type: ["string", "integer"] } }, required: ["courseId"] },
    invoke: (a, ctx) => call(flashcards, { body: { action: "load", userId: ctx.userId, courseId: a.courseId ?? ctx.courseId } }, "list_flashcards"),
  },
  {
    name: "save_flashcards",
    description: "Save new flashcards for a course. Call after generating cards the student wants to keep.",
    input_schema: {
      type: "object",
      properties: {
        courseId: { type: ["string", "integer"] },
        cards: { type: "array", minItems: 1, items: { type: "object", properties: { question: { type: "string" }, answer: { type: "string" } }, required: ["question", "answer"] } },
      },
      required: ["courseId", "cards"],
    },
    invoke: (a, ctx) => call(flashcards, { body: { action: "save", userId: ctx.userId, courseId: a.courseId ?? ctx.courseId, cards: a.cards } }, "save_flashcards"),
  },
  {
    name: "summarize_text",
    description: "Summarize a block of text (a reading, lecture transcript, etc.) into key points. Call for 'summarize this'.",
    input_schema: { type: "object", properties: { text: { type: "string" }, title: { type: "string" } }, required: ["text"] },
    invoke: (a) => call(summarize, { body: { text: a.text, title: a.title } }, "summarize_text"),
  },
  {
    name: "what_if_plan",
    description:
      "Recompute a study plan under a hypothetical change (drop topics / move the exam / change daily minutes) → projected plan + readiness (0-1) + a list of deltas. Pure and instant. Pass the current plan (e.g. from generate_study_plan).",
    input_schema: {
      type: "object",
      properties: {
        basePlan: { type: "object", description: "Current plan: { examDate?, sessions:[{date, topic, activities, estimatedMinutes?}] }." },
        changes: { type: "object", properties: { examDate: { type: "string" }, dropTopics: { type: "array", items: { type: "string" } }, dailyMinutes: { type: "integer" } } },
      },
      required: ["basePlan", "changes"],
    },
    invoke: async (a) => whatIf(a.basePlan, a.changes ?? {}),
  },

  // ── E. tokens / gamification ───────────────────────────────────────────────────
  {
    name: "token_summary",
    description: "Get the student's token/points total, tier, and recent activity. Call for 'how many points do I have', 'what tier am I'.",
    input_schema: { type: "object", properties: {}, required: [] },
    invoke: (_a, ctx) => call(tokenEngine, { method: "GET", query: { action: "summary", userId: ctx.userId } }, "token_summary"),
  },
];

export const REGISTRY: Record<string, ReggieTool> = Object.fromEntries(TOOLS.map((t) => [t.name, t]));
export const TOOL_NAMES: string[] = TOOLS.map((t) => t.name);

/** Anthropic `tools` array for a subset of tool names (unknown names are dropped). */
export function toolSpecs(names: string[]): any[] {
  return names
    .map((n) => REGISTRY[n])
    .filter(Boolean)
    .map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema }));
}

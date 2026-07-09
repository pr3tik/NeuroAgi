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
import officeHours from "../office-hours.js";
import writingTracker from "../writing-tracker.js";
import libraryAgent from "../library-agent.js";
import nudge from "../nudge.js";
import universityBrain from "../university-brain.js";
import { whatIf } from "../../src/lib/whatIfPlan.js";
import { callApi } from "./callApi.js";
import { canvasCreds, canvasGET, resolveCanvasCourseId, allCanvasCourseIds, trim } from "./canvasLive.js";

export interface ToolContext {
  userId: string;
  courseId?: any;
  assignmentId?: any;
  /** Public origin of the incoming request (host + proto) — forwarded to handlers that
   *  build self-call URLs from headers (writing-tracker → /api/claude). */
  origin?: { host: string; proto: string };
}

/** Header bag for handlers that derive a base URL from the request. */
function originHeaders(ctx: ToolContext): Record<string, string> {
  const host = ctx.origin?.host || "fschoolai.com";
  const proto = ctx.origin?.proto || "https";
  return { host, "x-forwarded-host": host, "x-forwarded-proto": proto };
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Minimal service-key REST helpers for tool-side lookups (friends, names).
function sbEnv() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase env vars not configured");
  return { url, key, headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" } };
}

/** Accepted friends for a user, with names: [{id, name, friendsSince}]. */
async function friendsOf(userId: string): Promise<Array<{ id: string; name: string; friendsSince: string | null }>> {
  const { url, headers } = sbEnv();
  const r = await fetch(`${url}/rest/v1/rpc/list_friends`, { method: "POST", headers, body: JSON.stringify({ p_user: userId }) });
  if (!r.ok) throw new Error(`friends lookup failed (${r.status})`);
  const rows: any[] = await r.json();
  if (!rows.length) return [];
  const ids = rows.map((f) => f.friend_id).filter(Boolean);
  const nr = await fetch(`${url}/rest/v1/users?id=in.(${ids.map(encodeURIComponent).join(",")})&select=id,name`, { headers });
  const names: any[] = nr.ok ? await nr.json() : [];
  const nameById = Object.fromEntries(names.map((u) => [u.id, u.name]));
  return rows.map((f) => ({ id: f.friend_id, name: nameById[f.friend_id] ?? "(unknown)", friendsSince: f.friends_since ?? null }));
}

// Resolve a course REFERENCE the student gave in words — a course NAME ("BIO 101",
// "Organic Chemistry") or a course CODE — to the canonical DB course id the handlers
// need. If the reference is already an id (uuid) or a purely-numeric Canvas id, it's
// passed straight through (no lookup), so callers that already have an id are unaffected.
// Falls back to the raw value on no-match/lookup-failure so the handler can still try
// (and produce its own clear error) rather than the loop silently doing nothing.
export async function resolveCourse(userId: string, course: any): Promise<any> {
  if (course === undefined || course === null || course === "") return null;
  const raw = String(course).trim();
  if (UUID_RE.test(raw) || /^\d+$/.test(raw)) return raw;   // already an id → don't look up
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return raw;
  try {
    const r = await fetch(`${url}/rest/v1/courses?user_id=eq.${encodeURIComponent(userId)}&select=id,canvas_course_id,course_code,name`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (!r.ok) return raw;
    const rows: any[] = await r.json();
    const lc = raw.toLowerCase();
    const hit =
      rows.find((c) => (c.course_code || "").toLowerCase() === lc || (c.name || "").toLowerCase() === lc) ||       // exact code/name
      rows.find((c) => (c.name || "").toLowerCase().includes(lc) || (c.course_code || "").toLowerCase().includes(lc)); // partial
    return hit ? hit.id : raw;
  } catch {
    return raw;
  }
}

export const TOOLS: ReggieTool[] = [
  // ── A. Canvas / academic data ────────────────────────────────────────────────
  {
    name: "canvas_get_grades",
    description:
      "Get the student's per-course grade standing (current/final %, per-assignment scores + weights) and GPA from synced Canvas data. Call to answer 'how am I doing in X', 'what are my grades', 'my GPA'.",
    input_schema: {
      type: "object",
      properties: { course: { type: ["string", "number", "null"], description: "Optional: one course by NAME, code, or id (e.g. 'BIO 101'). Omit for all courses." } },
      required: [],
    },
    invoke: async (a, ctx) => call(canvasReads, { body: { action: "grades", userId: ctx.userId, courseId: await resolveCourse(ctx.userId, a.course ?? a.courseId ?? ctx.courseId) } }, "canvas_get_grades"),
  },
  {
    name: "canvas_get_upcoming",
    description:
      "List the student's assignments by window. status:'upcoming' (default) = future due, soonest first ('what's due', 'what's next'). status:'overdue' = PAST-DUE and unsubmitted, i.e. what they're BEHIND on ('what's overdue', 'what am I late on', 'what did I miss'). status:'all' = everything. Use 'overdue' for any past-due/behind/late question.",
    input_schema: {
      type: "object",
      properties: {
        status: { enum: ["upcoming", "overdue", "all"], description: "Which window (default 'upcoming'). Use 'overdue' for past-due/behind/late questions." },
        withinDays: { type: "integer", description: "Bound the window to N days (future for upcoming, past for overdue). Omit for no bound." },
        includeSubmitted: { type: "boolean", description: "Include already-submitted work (default false; ignored for overdue)." },
      },
      required: [],
    },
    invoke: (a, ctx) => call(canvasReads, { body: { action: "upcoming", userId: ctx.userId, status: a.status, withinDays: a.withinDays, includeSubmitted: !!a.includeSubmitted } }, "canvas_get_upcoming"),
  },
  {
    name: "compute_grade_weights",
    description:
      "Get a course's grade-category weights and a points-based projected grade. Call when the student asks how their grade is weighted or what their projected grade is.",
    input_schema: {
      type: "object",
      properties: { course: { type: ["string", "number"], description: "Course by NAME, code, or id (e.g. 'BIO 101')." } },
      required: ["course"],
    },
    invoke: async (a, ctx) => call(gradeWeights, { body: { userId: ctx.userId, courseId: await resolveCourse(ctx.userId, a.course ?? a.courseId ?? ctx.courseId) } }, "compute_grade_weights"),
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
        course: { type: ["string", "null"], description: "Optional course filter by NAME, code, or id." },
        maxSections: { type: "integer", description: "Max passages to return (default 4)." },
      },
      required: ["query"],
    },
    invoke: async (a, ctx) => call(rag, { query: { action: "query" }, body: { userId: ctx.userId, query: a.query, courseId: await resolveCourse(ctx.userId, a.course ?? a.courseId ?? ctx.courseId), maxSections: a.maxSections ?? 4 } }, "rag_search"),
  },

  // ── D. Generation ────────────────────────────────────────────────────────────
  {
    name: "generate_quiz",
    description:
      "Generate a practice quiz from a source: a documentId, a courseId, or raw text. Call for 'quiz me', 'make practice questions'.",
    input_schema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Raw source text (use this OR documentId OR course)." },
        documentId: { type: "string" },
        course: { type: ["string", "integer"], description: "Course by NAME, code, or id." },
        count: { type: "integer", description: "Number of questions (default 5, max 20)." },
        difficulty: { enum: ["easy", "medium", "hard"] },
      },
      required: [],
    },
    invoke: async (a, ctx) => call(exam, { body: { action: "generate_quiz", userId: ctx.userId, text: a.text, documentId: a.documentId, courseId: await resolveCourse(ctx.userId, a.course ?? a.courseId ?? ctx.courseId), count: a.count, difficulty: a.difficulty } }, "generate_quiz"),
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
        course: { type: ["string", "integer"], description: "Course by NAME, code, or id." },
        examDate: { type: "string", description: "Exam date, YYYY-MM-DD." },
        topics: { type: "array", items: { type: "string" } },
        dailyMinutes: { type: "integer" },
      },
      required: ["course", "examDate"],
    },
    invoke: async (a, ctx) => call(exam, { body: { action: "generate_plan", userId: ctx.userId, courseId: await resolveCourse(ctx.userId, a.course ?? a.courseId ?? ctx.courseId), examDate: a.examDate, topics: a.topics, dailyMinutes: a.dailyMinutes } }, "generate_study_plan"),
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
    input_schema: { type: "object", properties: { course: { type: ["string", "integer"], description: "Course by NAME, code, or id." } }, required: ["course"] },
    invoke: async (a, ctx) => call(flashcards, { body: { action: "load", userId: ctx.userId, courseId: await resolveCourse(ctx.userId, a.course ?? a.courseId ?? ctx.courseId) } }, "list_flashcards"),
  },
  {
    name: "save_flashcards",
    description: "Save new flashcards for a course. Call after generating cards the student wants to keep.",
    input_schema: {
      type: "object",
      properties: {
        course: { type: ["string", "integer"], description: "Course by NAME, code, or id." },
        cards: { type: "array", minItems: 1, items: { type: "object", properties: { question: { type: "string" }, answer: { type: "string" } }, required: ["question", "answer"] } },
      },
      required: ["course", "cards"],
    },
    invoke: async (a, ctx) => call(flashcards, { body: { action: "save", userId: ctx.userId, courseId: await resolveCourse(ctx.userId, a.course ?? a.courseId ?? ctx.courseId), cards: a.cards } }, "save_flashcards"),
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

  // ── F. app navigation ──────────────────────────────────────────────────────────
  {
    name: "navigate",
    description:
      "Take the student to a page in the app. Call when they want to GO somewhere or START an activity — study/flashcards/review, their courses/Canvas, assignments, the leaderboard, the toolkit, their profile, or the home dashboard. For the study page you can set a course + mode. Give a one-line confirmation alongside calling this.",
    input_schema: {
      type: "object",
      properties: {
        page: { enum: ["work", "canvas", "assignment", "study", "courses", "identity", "leaderboard", "toolkit"], description: "Destination page (work = home dashboard)." },
        course: { type: ["string", "null"], description: "Optional course name/code to open on the study page." },
        mode: { enum: ["flashcards", "quiz", "review", "notes"], description: "Optional study mode for the study page." },
      },
      required: ["page"],
    },
    invoke: async (a) => ({ ok: true, page: a.page, course: a.course ?? null, mode: a.mode ?? null }),
  },

  // ── G. LIVE Canvas reads ─────────────────────────────────────────────────────
  // Direct Canvas REST with the student's stored token (via canvasLive.ts) — content the
  // sync doesn't persist: announcements, module structure, page bodies, quizzes,
  // submission feedback, inbox. All results are trimmed to compact shapes.
  {
    name: "canvas_announcements",
    description:
      "Read the student's recent Canvas ANNOUNCEMENTS (what professors posted) — across all their courses or one course. Call for 'did my prof post/announce anything', 'any updates in X'. Canvas only returns ~14 days by default; pass sinceDays to look further back.",
    input_schema: {
      type: "object",
      properties: {
        course: { type: ["string", "number", "null"], description: "Optional: one course by name/code/Canvas id. Omit for all courses." },
        sinceDays: { type: "integer", description: "Look back N days (default 30)." },
      },
      required: [],
    },
    invoke: async (a, ctx) => {
      const creds = await canvasCreds(ctx.userId);
      const ids = a.course != null ? [await resolveCanvasCourseId(ctx.userId, a.course)] : await allCanvasCourseIds(ctx.userId);
      if (!ids.length) throw new Error("No synced courses found — run a Canvas sync first.");
      const since = new Date(Date.now() - (Number(a.sinceDays) > 0 ? Number(a.sinceDays) : 30) * 86_400_000).toISOString().slice(0, 10);
      const rows = await canvasGET(creds, "/announcements", { "context_codes[]": ids.map((i) => `course_${i}`), start_date: since, per_page: 30 });
      return { announcements: trim.announcements(rows) };
    },
  },
  {
    name: "canvas_modules",
    description:
      "Read a course's Canvas MODULES (the week/topic structure with items). Call for 'what's in module 3', 'what topics does this course cover', 'what's the course structure'.",
    input_schema: {
      type: "object",
      properties: { course: { type: ["string", "number"], description: "Course by name, code, or Canvas id." } },
      required: ["course"],
    },
    invoke: async (a, ctx) => {
      const creds = await canvasCreds(ctx.userId);
      const id = await resolveCanvasCourseId(ctx.userId, a.course);
      const rows = await canvasGET(creds, `/courses/${id}/modules`, { "include[]": "items", per_page: 50 });
      return { modules: trim.modules(rows) };
    },
  },
  {
    name: "canvas_pages",
    description:
      "Read a course's Canvas wiki PAGES. Without pageSlug: list the pages. With pageSlug: return that page's full text content. Call for lecture/session pages, syllabus-style content ('what does the week 5 page say').",
    input_schema: {
      type: "object",
      properties: {
        course: { type: ["string", "number"], description: "Course by name, code, or Canvas id." },
        pageSlug: { type: ["string", "null"], description: "Page slug from the list call — returns the page body." },
      },
      required: ["course"],
    },
    invoke: async (a, ctx) => {
      const creds = await canvasCreds(ctx.userId);
      const id = await resolveCanvasCourseId(ctx.userId, a.course);
      if (a.pageSlug) return { page: trim.page(await canvasGET(creds, `/courses/${id}/pages/${encodeURIComponent(a.pageSlug)}`)) };
      return { pages: trim.pagesIndex(await canvasGET(creds, `/courses/${id}/pages`, { per_page: 50 })) };
    },
  },
  {
    name: "canvas_quizzes",
    description: "List a course's Canvas QUIZZES (title, due date, points, question count). Call for 'do I have any quizzes', 'when is the next quiz in X'.",
    input_schema: {
      type: "object",
      properties: { course: { type: ["string", "number"], description: "Course by name, code, or Canvas id." } },
      required: ["course"],
    },
    invoke: async (a, ctx) => {
      const creds = await canvasCreds(ctx.userId);
      const id = await resolveCanvasCourseId(ctx.userId, a.course);
      return { quizzes: trim.quizzes(await canvasGET(creds, `/courses/${id}/quizzes`, { per_page: 50 })) };
    },
  },
  {
    name: "canvas_submission_feedback",
    description:
      "Read the student's OWN submission for one assignment — score, grade, lateness, the professor's COMMENTS, and rubric points. Call for 'what feedback did I get', 'why did I lose points on X', 'what did the prof say about my essay'. Get the assignment id from canvas_get_upcoming/canvas_get_grades or ask.",
    input_schema: {
      type: "object",
      properties: {
        course: { type: ["string", "number"], description: "Course by name, code, or Canvas id." },
        assignmentId: { type: ["string", "number"], description: "Canvas assignment id." },
      },
      required: ["course", "assignmentId"],
    },
    invoke: async (a, ctx) => {
      const creds = await canvasCreds(ctx.userId);
      const id = await resolveCanvasCourseId(ctx.userId, a.course);
      const s = await canvasGET(creds, `/courses/${id}/assignments/${a.assignmentId}/submissions/self`, { "include[]": ["submission_comments", "rubric_assessment"] });
      return { submission: trim.submission(s) };
    },
  },
  {
    name: "canvas_inbox",
    description:
      "Read the student's Canvas INBOX. Without conversationId: list recent conversations. With conversationId: return that thread's messages. Call for 'any messages from my prof/TA', 'what did X reply'.",
    input_schema: {
      type: "object",
      properties: { conversationId: { type: ["string", "number", "null"], description: "A conversation id from the list call." } },
      required: [],
    },
    invoke: async (a, ctx) => {
      const creds = await canvasCreds(ctx.userId);
      if (a.conversationId) return { conversation: trim.conversation(await canvasGET(creds, `/conversations/${a.conversationId}`)) };
      return { conversations: trim.conversations(await canvasGET(creds, "/conversations", { per_page: 20 })) };
    },
  },
  {
    name: "canvas_course_files",
    description:
      "List a course's Canvas FILES (slides, PDFs, docs). Call for 'what slides/files are posted in X'. Note: some schools restrict the Files tab — a 403 means the student can't access it either.",
    input_schema: {
      type: "object",
      properties: { course: { type: ["string", "number"], description: "Course by name, code, or Canvas id." } },
      required: ["course"],
    },
    invoke: async (a, ctx) => {
      const creds = await canvasCreds(ctx.userId);
      const id = await resolveCanvasCourseId(ctx.userId, a.course);
      return { files: trim.files(await canvasGET(creds, `/courses/${id}/files`, { per_page: 50 })) };
    },
  },
  {
    name: "canvas_past_courses",
    description: "List the student's COMPLETED Canvas courses with final scores/grades. Call for 'what did I take last term', 'what was my grade in <past course>', GPA history questions.",
    input_schema: { type: "object", properties: {}, required: [] },
    invoke: async (_a, ctx) => {
      const creds = await canvasCreds(ctx.userId);
      const rows = await canvasGET(creds, "/courses", { enrollment_state: "completed", "include[]": "total_scores", per_page: 50 });
      return { pastCourses: trim.pastCourses(rows) };
    },
  },

  // ── H. coaching / analysis ──────────────────────────────────────────────────
  {
    name: "office_hours_prep",
    description:
      "Generate personalized questions the student should ASK in office hours for a course, based on their known gaps and recent course material. Call for 'what should I ask my prof', 'help me prep for office hours'.",
    input_schema: {
      type: "object",
      properties: { course: { type: ["string", "number"], description: "Course by name, code, or id." } },
      required: ["course"],
    },
    invoke: async (a, ctx) => call(officeHours, { query: { action: "prep" }, body: { action: "prep", userId: ctx.userId, courseId: await resolveCourse(ctx.userId, a.course) } }, "office_hours_prep"),
  },
  {
    name: "office_hours_capture",
    description:
      "AFTER office hours: capture what was discussed so the tutor's understanding of the student updates. Pass the student's notes/summary of the session. Call when they say 'I went to office hours and…'.",
    input_schema: {
      type: "object",
      properties: {
        sessionNotes: { type: "string", description: "What was discussed / answered / still confusing." },
        course: { type: ["string", "number", "null"], description: "Optional course by name, code, or id." },
      },
      required: ["sessionNotes"],
    },
    invoke: async (a, ctx) => call(officeHours, { query: { action: "capture" }, body: { action: "capture", userId: ctx.userId, sessionNotes: a.sessionNotes, courseId: a.course != null ? await resolveCourse(ctx.userId, a.course) : undefined } }, "office_hours_capture"),
  },
  {
    name: "writing_analyze",
    description:
      "Analyze a piece of the student's WRITING (essay draft, paragraph): objective metrics (sentence variety, lexical diversity), change vs their last analyzed sample, one assessment + one tip. Call for 'how's my writing', 'analyze this draft'. Do NOT rewrite it for them.",
    input_schema: {
      type: "object",
      properties: {
        text: { type: "string", description: "The student's writing sample." },
        title: { type: ["string", "null"], description: "Optional label, e.g. 'History essay draft 2'." },
      },
      required: ["text"],
    },
    invoke: (a, ctx) => call(writingTracker, { headers: originHeaders(ctx), body: { userId: ctx.userId, text: a.text, title: a.title } }, "writing_analyze"),
  },
  {
    name: "library_search",
    description:
      "Search the SHARED class content library (syllabi, lecture notes, announcements, rubrics contributed across students) for a course-knowledge question. Complements rag_search (the student's OWN uploads) — try this when their uploads don't cover it. Returns ranked snippets; empty result means the library has nothing on it yet.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "What to look up." } },
      required: ["query"],
    },
    invoke: async (a, ctx) => {
      // Pass both id spaces — the extension populates course_content.course_id with its
      // own course key; canvas ids are what our synced table has. Extra non-matching
      // values in the in() filter are harmless.
      const ids = await allCanvasCourseIds(ctx.userId);
      return call(libraryAgent, { body: { userId: ctx.userId, message: a.query, force: true, courseIds: ids, activeCourseId: null } }, "library_search");
    },
  },
  {
    name: "list_friends",
    description: "List the student's accepted friends on FschoolAI (id + name). Call before nudge_friend to resolve who they mean, or for 'who are my friends'.",
    input_schema: { type: "object", properties: {}, required: [] },
    invoke: async (_a, ctx) => ({ friends: await friendsOf(ctx.userId) }),
  },
  {
    name: "nudge_friend",
    description:
      "Send a 'come study' nudge to ONE of the student's friends (in-app, with an email fallback if they're offline; server rate-limits 2 per friend per day). ONLY call when the student EXPLICITLY asks to nudge/invite a specific friend — never on your own initiative. If the name is ambiguous, list_friends first and confirm.",
    input_schema: {
      type: "object",
      properties: {
        friend: { type: "string", description: "The friend's name (resolved against their friend list) or user id." },
        roomName: { type: ["string", "null"], description: "Optional study-room name to mention." },
      },
      required: ["friend"],
    },
    invoke: async (a, ctx) => {
      const raw = String(a.friend ?? "").trim();
      let toUserId = raw;
      const friends = await friendsOf(ctx.userId);
      if (!UUID_RE.test(raw)) {
        const lc = raw.toLowerCase();
        const matches = friends.filter((f) => (f.name || "").toLowerCase().includes(lc));
        if (matches.length === 0) throw new Error(`No friend named "${raw}" — call list_friends and confirm who they mean.`);
        if (matches.length > 1) throw new Error(`Multiple friends match "${raw}" (${matches.map((m) => m.name).join(", ")}) — ask which one.`);
        toUserId = matches[0].id;
      } else if (!friends.some((f) => f.id === raw)) {
        throw new Error("That user isn't on the student's friend list — nudges can only go to accepted friends.");
      }
      const { url, headers } = sbEnv();
      const me = await fetch(`${url}/rest/v1/users?id=eq.${encodeURIComponent(ctx.userId)}&select=name&limit=1`, { headers });
      const fromName = ((await me.json().catch(() => [])) as any[])[0]?.name ?? "A friend";
      return call(nudge, { body: { fromUserId: ctx.userId, toUserId, fromName, roomName: a.roomName ?? null, recipientOnline: false } }, "nudge_friend");
    },
  },
  {
    name: "university_brain_profile",
    description:
      "Read the UNIVERSITY BRAIN: the global, cross-student knowledge base of published course/professor facts (syllabus policies, grading structure, teachers). Ask by course OR professor name. Works even if THIS student never contributed — that's the point: one student's contribution serves everyone. Call for 'what do we know about Prof X', 'what's the grading breakdown/late policy in <course>' when the student's own materials don't cover it.",
    input_schema: {
      type: "object",
      properties: {
        course: { type: ["string", "number", "null"], description: "Course by name, code, or Canvas id." },
        professor: { type: ["string", "null"], description: "Professor name (used when no course given)." },
      },
      required: [],
    },
    invoke: (a, ctx) => call(universityBrain, { query: { action: "profile" }, body: { userId: ctx.userId, course: a.course ?? null, professor: a.professor ?? null } }, "university_brain_profile"),
  },
  {
    name: "contribute_course_intel",
    description:
      "CONTRIBUTE to the university brain: pull the published artifacts from this student's own Canvas for a course (syllabus, teachers, grading weights), extract mechanical facts, and add them to the global cross-student knowledge base (deduplicated — re-contributing the same content just counts the crowd). ONLY call when the student explicitly agrees to share/contribute course info. Facts only, never opinions about professors.",
    input_schema: {
      type: "object",
      properties: { course: { type: ["string", "number"], description: "Course by name, code, or Canvas id." } },
      required: ["course"],
    },
    invoke: (a, ctx) => call(universityBrain, { query: { action: "contribute" }, body: { userId: ctx.userId, course: a.course } }, "contribute_course_intel"),
  },
  {
    name: "delete_flashcards",
    description: "Delete ONE saved flashcard by its id (get ids from list_flashcards). Call when the student asks to remove a card. Confirm which card before deleting.",
    input_schema: {
      type: "object",
      properties: { cardId: { type: "string", description: "The card's id from list_flashcards." } },
      required: ["cardId"],
    },
    invoke: (a, ctx) => call(flashcards, { body: { action: "delete", userId: ctx.userId, cardId: a.cardId } }, "delete_flashcards"),
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

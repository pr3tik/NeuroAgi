// @vitest-environment node
// Reggie tool-registry test — the "second verification that every tool actually works":
// invokes EVERY registered tool through its in-process invoker (the exact path Reggie's
// loop uses), with the underlying handlers driven by mocked Supabase + fetch, and asserts
// each returns a well-formed, non-error result. Also asserts registry↔specialist wiring.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { makeSupabaseMock } from "./helpers";

// rag.ts / token-engine.ts build a Supabase CLIENT (lazily). Mock createClient so those
// two handlers run against an in-memory chainable mock. Raw-fetch handlers (canvas-reads,
// grade-weights, exam, flashcards, summarize) are driven by the global fetch stub below.
const supa = makeSupabaseMock((ctx: any) => {
  const single = ctx.filters?.some((f: any[]) => f[0] === "single" || f[0] === "maybeSingle");
  const rows: Record<string, any> = {
    users: { id: "u1", points: 120, name: "Sam" },
    rag_documents: { id: "d1", title: "Notes" },
    rag_sections: { id: "s1", content: "photosynthesis" },
  };
  if (ctx.table?.startsWith("rpc:")) return { data: [], error: null };   // rag_hybrid_search → no hits
  if (ctx.table === "nudges") return { data: null, error: null, count: 0 };   // rate-limit count + insert
  if (ctx.table === "course_content") return { data: [{ id: "cc1", content_type: "syllabus", text: "Late work loses 10% per day.", summary: null, concepts: null, module_name: null, week_number: 1, professor_name: "Prof X", is_private: false, seen_by_count: 3, course_id: "111" }], error: null };
  const one = rows[ctx.table] ?? {};
  return { data: single ? one : [one], error: null };
});
vi.mock("@supabase/supabase-js", () => ({ createClient: () => supa.client }));

beforeEach(() => {
  process.env.SUPABASE_URL = "http://localhost";
  process.env.SUPABASE_SERVICE_KEY = "svc";
  process.env.ANTHROPIC_API_KEY = "test-key";
  process.env.OPENAI_API_KEY = "test-openai";
  process.env.GROQ_KEY = "test-groq";
});
afterEach(() => vi.unstubAllGlobals());

// One JSON object carrying every key the exam actions parse, so a single Anthropic stub
// satisfies quiz / evaluate / plan / framework (each reads its own key). summarize reads
// the text directly, so its summary becomes this string — a valid 200 either way.
const LLM_JSON = JSON.stringify({
  quizQuestions: [{ question: "Q?", type: "short_answer", options: null, answer: "A" }],
  results: [{ correct: true, score: 1, feedback: "ok" }],
  sessions: [{ date: "2026-08-01", topic: "Cells", activities: ["read"], estimatedMinutes: 60 }],
  nodes: [{ id: "n1", label: "A" }],
  edges: [{ from: "n1", to: "n1", relation: "self" }],
  questions: [{ id: "q1", gap: "weak on X", question: "Could you walk me through X?", priority: "high", linked_assignment: null }],
  assessment: "Clear thesis, choppy transitions.",
  tip: "Vary sentence openings.",
});

function stubFetch() {
  const R = (data: any, ok = true, status = 200) => ({ ok, status, json: async () => data, text: async () => JSON.stringify(data) });
  const fn = vi.fn(async (url: any) => {
    const u = String(url);
    if (u.includes("api.anthropic.com")) return R({ content: [{ type: "text", text: LLM_JSON }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } });
    if (u.includes("api.openai.com/v1/embeddings")) return R({ data: [{ embedding: new Array(1536).fill(0) }] });
    if (u.includes("api.openai.com")) return R({ choices: [{ message: { content: "[]" } }] });
    if (u.includes("id=in.")) return R([{ id: "friend-1", name: "Alex Kim" }]);
    if (u.includes("/rest/v1/users")) return R([{ id: "u1", name: "Sam", canvas_token: "ctok", canvas_base_url: "https://canvas.test/api/v1" }]);
    if (u.includes("/rest/v1/courses")) return R([{ id: "c-uuid", canvas_course_id: "111", course_code: "BIO", name: "Bio", current_score: 90, final_score: null }]);
    if (u.includes("/rest/v1/assignments")) return R([{ id: "a1", course_id: "c-uuid", title: "HW1", score: 9, points_possible: 10, weight: null, weight_achieved: null, due_at: "2999-01-01T00:00:00Z", submitted_at: null, missing: false, courses: { name: "Bio" } }]);
    if (u.includes("/rest/v1/canvas_data")) return R([{ payload: [{ courseId: "111", groups: [{ name: "Exams", weight: 100 }] }] }]);
    if (u.includes("/rest/v1/files")) return R([{ content_text: "photosynthesis lecture notes about the Calvin cycle" }]);
    if (u.includes("/rest/v1/flashcards_v2")) return R([{ id: "f1", question: "q", answer: "a", created_at: "2026-01-01" }]);
    // Live-Canvas REST (canvasLive.ts) — host normalized from canvas_base_url above.
    if (u.includes("canvas.test/api/v1/announcements")) return R([{ context_code: "course_111", title: "Midterm moved", posted_at: "2026-07-01", message: "<p>Now on Friday</p>" }]);
    if (u.includes("canvas.test/api/v1/courses/111/modules")) return R([{ name: "Week 1", state: "active", items: [{ title: "Intro", type: "Page" }] }]);
    if (u.includes("canvas.test/api/v1/courses/111/pages/")) return R({ title: "Week 1 notes", updated_at: "2026-07-01", body: "<h1>Notes</h1><p>Cells divide.</p>" });
    if (u.includes("canvas.test/api/v1/courses/111/pages")) return R([{ url: "week-1-notes", title: "Week 1 notes", updated_at: "2026-07-01" }]);
    if (u.includes("canvas.test/api/v1/courses/111/quizzes")) return R([{ id: 9, title: "Quiz 1", due_at: "2026-08-01", points_possible: 10, quiz_type: "assignment", question_count: 5 }]);
    if (u.includes("/submissions/self")) return R({ score: 8, grade: "B+", submitted_at: "2026-06-01", late: false, missing: false, submission_comments: [{ author_name: "Prof", comment: "Good work", created_at: "2026-06-02" }], rubric_assessment: { crit1: { points: 4, comments: "solid" } } });
    if (u.includes("canvas.test/api/v1/conversations/")) return R({ subject: "Extension", messages: [{ author_id: 1, body: "Sure, Friday works", created_at: "2026-06-01" }] });
    if (u.includes("canvas.test/api/v1/conversations")) return R([{ id: 5, subject: "Extension", last_message: "Sure, Friday works", last_message_at: "2026-06-01", workflow_state: "read" }]);
    if (u.includes("canvas.test/api/v1/courses/111/files")) return R([{ id: 3, display_name: "slides.pdf", size: 1000, "content-type": "application/pdf", updated_at: "2026-06-01" }]);
    if (u.includes("canvas.test/api/v1/courses/111/assignment_groups")) return R([{ name: "Exams", group_weight: 60 }, { name: "Labs", group_weight: 40 }]);
    if (u.includes("canvas.test/api/v1/courses/111")) return R({ id: 111, name: "Bio", course_code: "BIO", syllabus_body: "<p>" + "Grading: exams 60%, labs 40%. Late work loses 10% per day. Office hours Tue 2-4pm. ".repeat(3) + "</p>", teachers: [{ display_name: "Dr. Ada Marsh" }] });
    if (u.includes("/rest/v1/course_content?content_hash=")) return R([]);   // no dedup hit -> insert path
    if (u.includes("/rest/v1/course_content?canvas_course_id=")) return R([{ content_type: "syllabus", professor_name: "Dr. Ada Marsh", summary: "Exams 60%, labs 40%; late -10%/day.", concepts: ["Exams 60% / Labs 40%", "Late penalty 10%/day"], seen_by_count: 3, last_seen_at: "2026-07-01" }]);
    if (u.includes("/rest/v1/course_content")) return R([{ id: "cc-new" }]);  // insert (Prefer: representation)
    if (u.includes("canvas.test/api/v1/courses")) return R([{ id: 222, name: "Old Course", course_code: "OLD101", enrollments: [{ computed_final_score: 88, computed_final_grade: "A-" }] }]);
    if (u.includes("/rest/v1/rpc/list_friends")) return R([{ friend_id: "friend-1", friends_since: "2026-06-01" }]);
    // writing-tracker self-calls (via originHeaders default host)
    if (u.includes("/api/claude")) return R({ content: LLM_JSON });
    if (u.includes("/api/brain-")) return R({ ok: false });
    return R([]);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

async function reg() {
  vi.resetModules();
  return await import("../api/_reggie/tools.ts");
}

const CTX = { userId: "u1", courseId: "c-uuid" };

// Per-tool: valid args + a success assertion. Covers EVERY registered tool.
const CASES: Record<string, { args: any; check: (r: any) => void }> = {
  canvas_get_grades: { args: {}, check: (r) => { expect(r.ok).toBe(true); expect(Array.isArray(r.courses)).toBe(true); } },
  canvas_get_upcoming: { args: { withinDays: 30 }, check: (r) => { expect(r.ok).toBe(true); expect(Array.isArray(r.assignments)).toBe(true); } },
  compute_grade_weights: { args: { courseId: "111" }, check: (r) => { expect(r.ok).toBe(true); expect(Array.isArray(r.groups)).toBe(true); } },
  rag_search: { args: { query: "photosynthesis" }, check: (r) => { expect(r).toBeDefined(); expect(typeof r).toBe("object"); } },
  generate_quiz: { args: { text: "the Calvin cycle fixes CO2", count: 1 }, check: (r) => { expect(Array.isArray(r.quizQuestions)).toBe(true); expect(r.quizQuestions.length).toBeGreaterThan(0); } },
  evaluate_answers: { args: { items: [{ question: "q", studentAnswer: "a" }] }, check: (r) => { expect(Array.isArray(r.results)).toBe(true); expect(typeof r.totalScore).toBe("number"); } },
  generate_study_plan: { args: { courseId: 5, examDate: "2026-08-10" }, check: (r) => { expect(typeof r.planId).toBe("string"); expect(Array.isArray(r.sessions)).toBe(true); } },
  generate_framework: { args: { topic: "photosynthesis" }, check: (r) => { expect(Array.isArray(r.nodes)).toBe(true); expect(Array.isArray(r.edges)).toBe(true); } },
  list_flashcards: { args: { courseId: "c-uuid" }, check: (r) => { expect(Array.isArray(r.cards)).toBe(true); } },
  save_flashcards: { args: { courseId: "c-uuid", cards: [{ question: "q", answer: "a" }] }, check: (r) => { expect(r.ok).toBe(true); } },
  summarize_text: { args: { text: "a long reading about cells that should be summarized" }, check: (r) => { expect(typeof r.summary).toBe("string"); } },
  what_if_plan: { args: { basePlan: { examDate: "2026-08-10", sessions: [{ date: "2026-08-01", topic: "Kinetics", activities: ["read"], estimatedMinutes: 60 }] }, changes: { dropTopics: ["Kinetics"] } }, check: (r) => { expect(r.readiness).toBeGreaterThanOrEqual(0); expect(Array.isArray(r.deltas)).toBe(true); } },
  token_summary: { args: {}, check: (r) => { expect(r).toBeDefined(); expect(typeof r).toBe("object"); } },
  navigate: { args: { page: "study", mode: "flashcards" }, check: (r) => { expect(r.ok).toBe(true); expect(r.page).toBe("study"); expect(r.mode).toBe("flashcards"); } },
  canvas_announcements: { args: {}, check: (r) => { expect(r.announcements[0].title).toBe("Midterm moved"); expect(r.announcements[0].message).toContain("Friday"); } },
  canvas_modules: { args: { course: "BIO" }, check: (r) => { expect(r.modules[0].name).toBe("Week 1"); expect(r.modules[0].items[0].title).toBe("Intro"); } },
  canvas_pages: { args: { course: "Bio", pageSlug: "week-1-notes" }, check: (r) => { expect(r.page.title).toBe("Week 1 notes"); expect(r.page.body).toContain("Cells divide"); expect(r.page.body).not.toContain("<p>"); } },
  canvas_quizzes: { args: { course: "111" }, check: (r) => { expect(r.quizzes[0].title).toBe("Quiz 1"); expect(r.quizzes[0].questionCount).toBe(5); } },
  canvas_submission_feedback: { args: { course: "BIO", assignmentId: 777 }, check: (r) => { expect(r.submission.grade).toBe("B+"); expect(r.submission.comments[0].comment).toBe("Good work"); expect(r.submission.rubric[0].points).toBe(4); } },
  canvas_inbox: { args: {}, check: (r) => { expect(r.conversations[0].subject).toBe("Extension"); } },
  canvas_course_files: { args: { course: "BIO" }, check: (r) => { expect(r.files[0].name).toBe("slides.pdf"); } },
  canvas_past_courses: { args: {}, check: (r) => { expect(r.pastCourses[0].finalScore).toBe(88); expect(r.pastCourses[0].code).toBe("OLD101"); } },
  office_hours_prep: { args: { course: "BIO" }, check: (r) => { expect(Array.isArray(r.questions)).toBe(true); expect(r.questions[0].question).toContain("walk me through"); } },
  office_hours_capture: { args: { sessionNotes: "we covered eigenvalues; still fuzzy on proofs" }, check: (r) => { expect(r.ok).toBe(true); } },
  writing_analyze: { args: { text: "The cell divides. It is a process. The process has stages and each stage matters for the outcome of division." }, check: (r) => { expect(r.metrics).toBeDefined(); expect(typeof r.assessment).toBe("string"); } },
  delete_flashcards: { args: { cardId: "f1" }, check: (r) => { expect(r.ok).toBe(true); } },
  library_search: { args: { query: "what is the late policy in the syllabus" }, check: (r) => { expect(r.found).toBe(true); expect(r.snippets.join(" ")).toContain("Late work"); } },
  university_brain_profile: { args: { course: "111" }, check: (r) => { expect(r.found).toBe(true); expect(r.professors).toContain("Dr. Ada Marsh"); expect(r.facts.length).toBeGreaterThan(0); } },
  contribute_course_intel: { args: { course: "111" }, check: (r) => { expect(r.ok).toBe(true); expect(r.contributed.length).toBeGreaterThan(0); expect(r.professor).toBe("Dr. Ada Marsh"); } },
  list_friends: { args: {}, check: (r) => { expect(r.friends[0]).toMatchObject({ id: "friend-1", name: "Alex Kim" }); } },
  nudge_friend: { args: { friend: "Alex" }, check: (r) => { expect(r.sent).toBe(true); } },
};

describe("Reggie tool registry", () => {
  it("every registered tool has a case in this test (coverage guard)", async () => {
    const { TOOL_NAMES } = await reg();
    for (const name of TOOL_NAMES) expect(CASES[name], `missing test case for tool ${name}`).toBeDefined();
    expect(TOOL_NAMES.length).toBe(Object.keys(CASES).length);
  });

  it("every tool has a valid Anthropic spec (name/description/object input_schema)", async () => {
    const { TOOLS } = await reg();
    for (const t of TOOLS) {
      expect(t.name).toMatch(/^[a-z0-9_]+$/);
      expect(t.description.length).toBeGreaterThan(20);
      expect(t.input_schema?.type).toBe("object");
      expect(t.input_schema.properties).toBeDefined();
    }
  });

  // The real verification: run each tool end-to-end through its invoker.
  for (const name of Object.keys(CASES)) {
    it(`tool '${name}' runs end-to-end and returns a valid result`, async () => {
      stubFetch();
      const { REGISTRY } = await reg();
      const tool = REGISTRY[name];
      expect(tool, `tool ${name} not registered`).toBeDefined();
      const result = await tool.invoke(CASES[name].args, CTX);
      CASES[name].check(result);
    });
  }

  it("resolveCourse maps a course NAME/code to its id and passes real ids through", async () => {
    stubFetch();
    const { resolveCourse } = await reg();
    expect(await resolveCourse("u1", "Bio")).toBe("c-uuid");                                   // exact name
    expect(await resolveCourse("u1", "BIO")).toBe("c-uuid");                                   // exact code (case-insensitive)
    expect(await resolveCourse("u1", "bi")).toBe("c-uuid");                                    // partial name
    expect(await resolveCourse("u1", "111")).toBe("111");                                      // numeric Canvas id → pass-through
    expect(await resolveCourse("u1", "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")).toBe("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"); // uuid → pass-through
    expect(await resolveCourse("u1", "No Such Course")).toBe("No Such Course");                // no match → raw fallback
  });

  it("a failing handler surfaces as a thrown tool error (loop turns it into is_error)", async () => {
    // Supabase 500 on the users existence check → canvas_get_grades should throw, not hang.
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}), text: async () => "" })));
    const { REGISTRY } = await reg();
    await expect(REGISTRY.canvas_get_grades.invoke({}, CTX)).rejects.toThrow();
  });
});

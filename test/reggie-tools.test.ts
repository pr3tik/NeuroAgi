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
});

function stubFetch() {
  const R = (data: any, ok = true, status = 200) => ({ ok, status, json: async () => data, text: async () => JSON.stringify(data) });
  const fn = vi.fn(async (url: any) => {
    const u = String(url);
    if (u.includes("api.anthropic.com")) return R({ content: [{ type: "text", text: LLM_JSON }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } });
    if (u.includes("api.openai.com/v1/embeddings")) return R({ data: [{ embedding: new Array(1536).fill(0) }] });
    if (u.includes("api.openai.com")) return R({ choices: [{ message: { content: "[]" } }] });
    if (u.includes("/rest/v1/users")) return R([{ id: "u1" }]);
    if (u.includes("/rest/v1/courses")) return R([{ id: "c-uuid", canvas_course_id: "111", course_code: "BIO", name: "Bio", current_score: 90, final_score: null }]);
    if (u.includes("/rest/v1/assignments")) return R([{ id: "a1", course_id: "c-uuid", title: "HW1", score: 9, points_possible: 10, weight: null, weight_achieved: null, due_at: "2999-01-01T00:00:00Z", submitted_at: null, missing: false, courses: { name: "Bio" } }]);
    if (u.includes("/rest/v1/canvas_data")) return R([{ payload: [{ courseId: "111", groups: [{ name: "Exams", weight: 100 }] }] }]);
    if (u.includes("/rest/v1/files")) return R([{ content_text: "photosynthesis lecture notes about the Calvin cycle" }]);
    if (u.includes("/rest/v1/flashcards_v2")) return R([{ id: "f1", question: "q", answer: "a", created_at: "2026-01-01" }]);
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

  it("a failing handler surfaces as a thrown tool error (loop turns it into is_error)", async () => {
    // Supabase 500 on the users existence check → canvas_get_grades should throw, not hang.
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}), text: async () => "" })));
    const { REGISTRY } = await reg();
    await expect(REGISTRY.canvas_get_grades.invoke({}, CTX)).rejects.toThrow();
  });
});

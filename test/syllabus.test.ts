// @vitest-environment node
// api/_syllabus.ts — the syllabus→deadlines extractor behind /api/extract's
// detectStructure (MVP loop link ②). Covers LLM-output cleaning (dates, names,
// points), non-syllabus handling, and the idempotent row builder (deterministic
// ids + batch-safe slug dedup — one upsert can't hit the same conflict key twice).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseSyllabusStructure, syllabusRows } from "../api/_syllabus";

beforeEach(() => { process.env.OPENAI_API_KEY = "test-key"; });
afterEach(() => { vi.unstubAllGlobals(); delete process.env.OPENAI_API_KEY; });

const openAiReply = (obj: any) => ({
  ok: true, status: 200,
  json: async () => ({ choices: [{ message: { content: JSON.stringify(obj) } }] }),
});

describe("parseSyllabusStructure", () => {
  it("returns null when OPENAI_API_KEY is missing (feature silently off)", async () => {
    delete process.env.OPENAI_API_KEY;
    expect(await parseSyllabusStructure("some syllabus text")).toBeNull();
  });

  it("returns null on empty text", async () => {
    expect(await parseSyllabusStructure("   ")).toBeNull();
  });

  it("parses and CLEANS the model output: ISO dates, dropped empty names, coerced points", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => openAiReply({
      is_syllabus: true, course_name: "Intro to Biology", course_code: "BIO 101",
      assignments: [
        { name: "Midterm Exam", due_date: "2026-10-15", points_possible: 100 },
        { name: "Lab Report 1", due_date: "not a date", points_possible: "25" },  // bad date → null; string points → number
        { name: "   ",          due_date: "2026-09-01", points_possible: 10 },     // empty name → dropped
        { name: "Essay",        due_date: null,          points_possible: -5 },    // negative points → null
      ],
    })));
    const r = await parseSyllabusStructure("SYLLABUS BIO 101 Fall 2026 …", "syllabus.pdf");
    expect(r?.isSyllabus).toBe(true);
    expect(r?.courseCode).toBe("BIO 101");
    expect(r?.assignments).toHaveLength(3);                                   // empty name filtered
    expect(r?.assignments[0]).toEqual({ name: "Midterm Exam", dueDate: new Date("2026-10-15").toISOString(), pointsPossible: 100 });
    expect(r?.assignments[1]).toEqual({ name: "Lab Report 1", dueDate: null, pointsPossible: 25 });
    expect(r?.assignments[2]).toEqual({ name: "Essay",        dueDate: null, pointsPossible: null });
  });

  it("a non-syllabus document comes back isSyllabus:false with no assignments", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => openAiReply({ is_syllabus: false, course_name: null, course_code: null, assignments: [] })));
    const r = await parseSyllabusStructure("lecture notes about mitochondria");
    expect(r?.isSyllabus).toBe(false);
    expect(r?.assignments).toEqual([]);
  });

  it("returns null when the model reply isn't JSON", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "sorry, I can't" } }] }),
    })));
    expect(await parseSyllabusStructure("text")).toBeNull();
  });

  it("throws on an OpenAI HTTP error (caller catches — upload never fails)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })));
    await expect(parseSyllabusStructure("text")).rejects.toThrow(/500/);
  });
});

describe("syllabusRows", () => {
  it("builds idempotent rows: deterministic syl:<course>:<slug> ids, source manual", () => {
    const rows = syllabusRows("u1", 42, [
      { name: "Midterm Exam!", dueDate: "2026-10-15T00:00:00.000Z", pointsPossible: 100 },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      user_id: "u1", course_id: 42,
      canvas_assignment_id: "syl:42:midterm-exam",   // punctuation stripped, deterministic
      title: "Midterm Exam!", due_at: "2026-10-15T00:00:00.000Z",
      points_possible: 100, source: "manual",
    });
  });

  it("dedupes identical slugs within a batch (a single upsert can't hit one key twice)", () => {
    const rows = syllabusRows("u1", "c9", [
      { name: "Quiz", dueDate: null, pointsPossible: 10 },
      { name: "Quiz", dueDate: null, pointsPossible: 10 },
      { name: "quiz", dueDate: null, pointsPossible: 10 },
    ]);
    const ids = rows.map(r => r.canvas_assignment_id);
    expect(new Set(ids).size).toBe(3);
    expect(ids).toEqual(["syl:c9:quiz", "syl:c9:quiz-2", "syl:c9:quiz-3"]);
  });
});

// @vitest-environment node
// A3 / BR-03 — the parse/shape contract of the broadened Course Brain extraction. The live LLM is
// mocked; these pin the robustness that keeps a stray model output from writing junk into the shared
// course_content library (concepts must stay a clean string[], caps enforced, guardrails present).
import { describe, it, expect, vi, beforeEach } from "vitest";

const gw = vi.hoisted(() => ({ result: null as any, calls: [] as any[] }));
vi.mock("../api/_gateway.ts", () => ({
  callModel: async (req: any) => { gw.calls.push(req); return gw.result; },
}));

import { extractFacts, EXTRACTION_CATEGORIES } from "../api/university-brain.ts";

const ok = (content: string) => ({ ok: true, content });
const longSyllabus = "Course syllabus. ".repeat(20); // > 80 chars

beforeEach(() => { gw.result = null; gw.calls = []; });

describe("extractFacts (BR-03 broadened)", () => {
  it("skips the LLM for too-short input", async () => {
    const out = await extractFacts("too short");
    expect(out).toEqual({ summary: null, concepts: null });
    expect(gw.calls.length).toBe(0);
  });

  it("parses clean JSON into summary + string[] facts", async () => {
    gw.result = ok('{"summary":"Grading is 40% exams.","facts":["Midterm: 25%, Oct 17","Final: 35%, cumulative"]}');
    const out = await extractFacts(longSyllabus);
    expect(out.summary).toBe("Grading is 40% exams.");
    expect(out.concepts).toEqual(["Midterm: 25%, Oct 17", "Final: 35%, cumulative"]);
  });

  it("extracts JSON embedded in prose", async () => {
    gw.result = ok('Here you go:\n{"summary":"s","facts":["a","b"]}\nHope that helps!');
    const out = await extractFacts(longSyllabus);
    expect(out.concepts).toEqual(["a", "b"]);
  });

  it("coerces object-shaped facts to strings (defensive)", async () => {
    gw.result = ok('{"summary":"s","facts":[{"fact":"Submit via Gradescope"},{"text":"PDF only"},"Group of 3"]}');
    const out = await extractFacts(longSyllabus);
    expect(out.concepts).toEqual(["Submit via Gradescope", "PDF only", "Group of 3"]);
  });

  it("caps facts at 14", async () => {
    const many = Array.from({ length: 30 }, (_, i) => `fact ${i}`);
    gw.result = ok(JSON.stringify({ summary: "s", facts: many }));
    const out = await extractFacts(longSyllabus);
    expect(out.concepts).toHaveLength(14);
  });

  it("drops empty/whitespace facts and nulls a fully-empty list", async () => {
    gw.result = ok('{"summary":"s","facts":["  ","",null]}');
    const out = await extractFacts(longSyllabus);
    expect(out.concepts).toBeNull();
    expect(out.summary).toBe("s");
  });

  it("falls back to a trimmed summary when JSON is unparseable", async () => {
    gw.result = ok("The professor published a late penalty of 10% per day.");
    const out = await extractFacts(longSyllabus);
    expect(out.summary).toContain("late penalty");
    expect(out.concepts).toBeNull();
  });

  it("returns nulls when the model call fails", async () => {
    gw.result = { ok: false, content: "" };
    const out = await extractFacts(longSyllabus);
    expect(out).toEqual({ summary: null, concepts: null });
  });

  it("prompt covers the broadened categories AND keeps the anti-opinion / anti-quotation guardrails", async () => {
    gw.result = ok('{"summary":"s","facts":["a"]}');
    await extractFacts(longSyllabus);
    const sys: string = gw.calls[0].system;
    // Broadened coverage (the four A3 additions)
    expect(sys).toMatch(/exam dates/i);
    expect(sys).toMatch(/schedule outline/i);
    expect(sys).toMatch(/submission mechanics/i);
    expect(sys).toMatch(/course-conduct style/i);
    // Guardrails must survive the broadening
    expect(sys).toMatch(/never student-derived or aggregate/i);
    expect(sys).toMatch(/facts over quotation/i);
    expect(sys).toMatch(/never opinions/i);
    // Category list is the single source of truth shared with the code
    expect(EXTRACTION_CATEGORIES.length).toBe(8);
  });
});

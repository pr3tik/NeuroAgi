import { describe, it, expect } from "vitest";
import { countSyllables, countCitations, analyzeWriting, compareMetrics } from "../src/lib/writingMetrics";

describe("countSyllables", () => {
  it("counts common words with the heuristic", () => {
    expect(countSyllables("cat")).toBe(1);
    expect(countSyllables("hello")).toBe(2);
    expect(countSyllables("table")).toBe(2);
    expect(countSyllables("university")).toBeGreaterThanOrEqual(4);
    expect(countSyllables("")).toBe(0);
  });
});

describe("countCitations", () => {
  it("detects APA, numeric, and et al. citations", () => {
    expect(countCitations("As shown (Smith, 2020) and (Doe & Lee, 2019).")).toBe(2);
    expect(countCitations("See [1] and [2] for detail.")).toBe(2);
    expect(countCitations("Baddeley et al. found this.")).toBe(1);
  });
  it("returns 0 when there are no citations", () => {
    expect(countCitations("Just plain prose with no references.")).toBe(0);
  });
});

describe("analyzeWriting", () => {
  it("returns all-zero metrics for empty text", () => {
    const m = analyzeWriting("");
    expect(m.words).toBe(0);
    expect(m.fleschKincaidGrade).toBe(0);
    expect(m.vocabDiversity).toBe(0);
  });

  it("counts words, sentences, and paragraphs", () => {
    const m = analyzeWriting("The cat sat. The dog ran.\n\nA new idea here.");
    expect(m.words).toBe(10);
    expect(m.sentences).toBe(3);
    expect(m.paragraphs).toBe(2);
  });

  it("computes vocabulary diversity (type-token ratio)", () => {
    // 6 words, "the" repeated → 4 unique / 6 total
    const m = analyzeWriting("the the the cat dog bird");
    expect(m.vocabDiversity).toBeCloseTo(4 / 6, 2);
  });

  it("produces a sensible reading grade and ease for normal prose", () => {
    const m = analyzeWriting("Working memory has a limited capacity. Most adults can hold about seven items at once.");
    expect(m.fleschKincaidGrade).toBeGreaterThan(0);
    expect(m.fleschKincaidGrade).toBeLessThan(20);
    expect(m.fleschReadingEase).toBeGreaterThan(0);
    expect(m.avgSentenceLength).toBeGreaterThan(0);
  });

  it("flags complex (3+ syllable) words", () => {
    const simple  = analyzeWriting("the cat sat on a mat and ran");
    const complex = analyzeWriting("epistemological frameworks necessitate sophisticated interpretation");
    expect(complex.complexWordRatio).toBeGreaterThan(simple.complexWordRatio);
  });

  it("counts citations into the profile", () => {
    expect(analyzeWriting("Per Cowan (2001), capacity is four items.").citations).toBe(1);
  });
});

describe("compareMetrics", () => {
  it("reports headline deltas between two submissions and drops unchanged ones", () => {
    const a = analyzeWriting("the cat sat on the mat");
    const b = analyzeWriting("The sophisticated epistemological framework necessitates careful, nuanced interpretation (Smith, 2020).");
    const deltas = compareMetrics(a, b);
    const byKey = Object.fromEntries(deltas.map(d => [d.key, d.delta]));
    // b is more complex and adds a citation
    expect(byKey["complexWordRatio"]).toBeGreaterThan(0);
    expect(byKey["citations"]).toBe(1);
    // every reported delta is a real change
    expect(deltas.every(d => d.delta !== 0)).toBe(true);
  });

  it("returns no deltas for identical writing", () => {
    const m = analyzeWriting("Same text here, exactly the same.");
    expect(compareMetrics(m, m)).toEqual([]);
  });
});

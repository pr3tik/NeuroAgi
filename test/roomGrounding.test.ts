import { describe, it, expect } from "vitest";
import { groundingChips } from "../src/lib/roomGrounding";

describe("groundingChips — room AI grounding payload → renderable chips", () => {
  it("returns nothing to show for null / undefined / non-object", () => {
    for (const g of [null, undefined, 42 as any, "x" as any]) {
      const r = groundingChips(g);
      expect(r.show).toBe(false);
      expect(r.sources).toEqual([]);
      expect(r.boardRevision).toBeNull();
      expect(r.general).toBe(false);
    }
  });

  it("dedupes source titles and drops empty/whitespace ones", () => {
    const r = groundingChips({
      sources: [
        { documentId: "1", title: "Lecture 3" },
        { documentId: "2", title: "Lecture 3" },       // dup
        { documentId: "3", title: "  " },               // empty after trim
        { documentId: "4", title: "Syllabus" },
        { documentId: "5", title: "" },                 // empty
      ],
    });
    expect(r.sources).toEqual(["Lecture 3", "Syllabus"]);
    expect(r.show).toBe(true);
  });

  it("caps at 6 source chips", () => {
    const sources = Array.from({ length: 10 }, (_, i) => ({ documentId: String(i), title: `Doc ${i}` }));
    expect(groundingChips({ sources }).sources).toHaveLength(6);
  });

  it("surfaces a numeric board revision, including 0", () => {
    expect(groundingChips({ boardRevision: 7 }).boardRevision).toBe(7);
    expect(groundingChips({ boardRevision: 0 }).boardRevision).toBe(0);
    expect(groundingChips({ boardRevision: 0 }).show).toBe(true);
    expect(groundingChips({ boardRevision: null }).boardRevision).toBeNull();
  });

  it("shows the honest 'general knowledge' label only when nothing was cited", () => {
    expect(groundingChips({ generalKnowledge: true }).general).toBe(true);
    expect(groundingChips({ generalKnowledge: true }).show).toBe(true);
  });

  it("never contradicts a real source/board with 'general knowledge'", () => {
    expect(groundingChips({ generalKnowledge: true, sources: [{ documentId: "1", title: "Notes" }] }).general).toBe(false);
    expect(groundingChips({ generalKnowledge: true, boardRevision: 2 }).general).toBe(false);
  });

  it("real payload: sources + board render together, no general flag", () => {
    const r = groundingChips({
      sources: [{ documentId: "d1", title: "Chapter 4" }],
      boardRevision: 3,
      planVersion: null,
      generalKnowledge: false,
    });
    expect(r.sources).toEqual(["Chapter 4"]);
    expect(r.boardRevision).toBe(3);
    expect(r.general).toBe(false);
    expect(r.show).toBe(true);
  });
});

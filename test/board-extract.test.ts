// @vitest-environment node
// BE-07 / AI-06: board extraction against fixture strokes.
//
// The headline test is the one that catches the bug the sprint plan would have caused:
// the plan describes typed text as `mode: "text"`, but the real model is
// `{ mode: "pen", style: "text", points: [{ x, y, t }] }`. Extraction keyed on `mode`
// would silently return zero texts and the AI would answer with no board context at all.
import { describe, it, expect } from "vitest";
import { extractBoard, toExtractedText, boardDigest, type BoardStroke } from "../api/_board";

const stroke = (over: Partial<BoardStroke> = {}): BoardStroke => ({
  id: "s1", room_id: "r1", user_id: "u1", name: "Priya",
  mode: "pen", style: "normal", color: "#000", width: 3,
  points: [{ x: 0, y: 0 }], created_at: "2026-07-17T14:00:00Z",
  ...over,
} as BoardStroke);

const text = (t: string, x: number, y: number, over: Partial<BoardStroke> = {}) =>
  stroke({ style: "text", points: [{ x, y, t }], ...over });

describe("extractBoard — typed text", () => {
  it("lifts typed text out of points[0].t (NOT mode:'text', which does not exist)", async () => {
    const out = extractBoard([text("greedy fails for {1,5,12}", 10, 20)], 7);

    expect(out.revision).toBe(7);
    expect(out.texts).toHaveLength(1);
    expect(out.texts[0]).toMatchObject({
      stroke_id: "s1", text: "greedy fails for {1,5,12}", x: 10, y: 20, author_name: "Priya", author_id: "u1",
    });
  });

  it("orders text in reading order (top-to-bottom, then left-to-right), not stroke order", async () => {
    // Authored out of order — a person reading the board sees top-left first.
    const out = extractBoard([
      text("third",  10, 300),
      text("first",  10, 100),
      text("second", 90, 100),
    ], 1);

    expect(out.texts.map(t => t.text)).toEqual(["first", "second", "third"]);
  });

  it("drops empty and whitespace-only text boxes", async () => {
    const out = extractBoard([text("", 0, 0), text("   ", 1, 1), text("real", 2, 2)], 1);
    expect(out.texts.map(t => t.text)).toEqual(["real"]);
  });

  it("trims surrounding whitespace", async () => {
    const out = extractBoard([text("  spaced  ", 0, 0)], 1);
    expect(out.texts[0].text).toBe("spaced");
  });

  it("keeps per-author attribution so the AI can say who wrote what", async () => {
    const out = extractBoard([
      text("mine",  0, 0, { id: "a", user_id: "u1", name: "Priya" }),
      text("yours", 0, 10, { id: "b", user_id: "u2", name: "Marcus" }),
    ], 1);
    expect(out.texts.map(t => [t.author_name, t.text])).toEqual([["Priya", "mine"], ["Marcus", "yours"]]);
  });
});

describe("extractBoard — non-text strokes", () => {
  it("counts freehand ink without interpreting it (semantic ink is deferred)", async () => {
    const out = extractBoard([
      stroke({ id: "a", style: "normal" }),
      stroke({ id: "b", style: "highlighter" }),
      stroke({ id: "c", style: "pencil" }),
    ], 1);
    expect(out.ink_stroke_count).toBe(3);
    expect(out.texts).toHaveLength(0);
  });

  it("tallies shapes by kind", async () => {
    const out = extractBoard([
      stroke({ id: "a", style: "rect" }),
      stroke({ id: "b", style: "rect" }),
      stroke({ id: "c", style: "arrow" }),
    ], 1);
    expect(out.shape_counts).toEqual({ rect: 2, arrow: 1 });
    expect(out.ink_stroke_count).toBe(0);
  });

  it("captures images with their placement", async () => {
    const out = extractBoard([
      stroke({ id: "img", mode: "image", url: "https://x/y.png", x: 5, y: 6, w: 100, h: 50 }),
    ], 1);
    expect(out.images).toEqual([{ stroke_id: "img", url: "https://x/y.png", x: 5, y: 6, w: 100, h: 50 }]);
  });

  it("ignores erase strokes — they are a compositing artifact, not content", async () => {
    const out = extractBoard([stroke({ id: "e", mode: "erase" })], 1);
    expect(out.ink_stroke_count).toBe(0);
    expect(out.texts).toHaveLength(0);
  });

  it("skips an image stroke with no url rather than emitting a broken ref", async () => {
    const out = extractBoard([stroke({ id: "img", mode: "image", url: undefined })], 1);
    expect(out.images).toHaveLength(0);
  });
});

describe("extractBoard — hostile input", () => {
  // These strokes arrive from a browser, so the extractor must not throw on junk.
  it("survives a non-array", async () => {
    expect(extractBoard(null as any, 1).texts).toEqual([]);
    expect(extractBoard(undefined as any, 1).texts).toEqual([]);
  });

  it("survives null entries and a text stroke with no points", async () => {
    const out = extractBoard([
      null as any,
      "nonsense" as any,
      stroke({ style: "text", points: [] }),
      stroke({ id: "ok", style: "text", points: [{ x: 1, y: 1, t: "survived" }] }),
    ], 1);
    expect(out.texts.map(t => t.text)).toEqual(["survived"]);
  });

  it("returns an empty digest for an empty board", async () => {
    expect(extractBoard([], 3)).toEqual({
      revision: 3, texts: [], images: [], ink_stroke_count: 0, shape_counts: {},
    });
  });
});

describe("toExtractedText", () => {
  it("flattens the board to text in reading order", () => {
    const x = extractBoard([text("second", 0, 50), text("first", 0, 10)], 1);
    expect(toExtractedText(x)).toBe("first\nsecond");
  });

  it("is empty for a board with no typed text", () => {
    expect(toExtractedText(extractBoard([stroke({ style: "normal" })], 1))).toBe("");
  });
});

describe("boardDigest — change detection", () => {
  // The digest decides whether a snapshot is a no-op, so what does and does not move it
  // is the whole contract.
  it("is stable for identical content", () => {
    const a = extractBoard([text("hello", 1, 2)], 1);
    const b = extractBoard([text("hello", 1, 2)], 1);
    expect(boardDigest(a)).toBe(boardDigest(b));
  });

  it("ignores the revision — otherwise every emit would look like a change", () => {
    const a = extractBoard([text("hello", 1, 2)], 1);
    const b = extractBoard([text("hello", 1, 2)], 99);
    expect(boardDigest(a)).toBe(boardDigest(b));
  });

  it("changes when the text changes", () => {
    const a = extractBoard([text("hello", 1, 2)], 1);
    const b = extractBoard([text("goodbye", 1, 2)], 1);
    expect(boardDigest(a)).not.toBe(boardDigest(b));
  });

  it("changes when text moves — position is meaning on a board", () => {
    const a = extractBoard([text("hello", 1, 2)], 1);
    const b = extractBoard([text("hello", 500, 900)], 1);
    expect(boardDigest(a)).not.toBe(boardDigest(b));
  });

  it("changes when freehand ink is added, even though ink is never interpreted", () => {
    const a = extractBoard([text("x", 0, 0)], 1);
    const b = extractBoard([text("x", 0, 0), stroke({ id: "ink", style: "normal" })], 1);
    expect(boardDigest(a)).not.toBe(boardDigest(b));
  });

  it("is insensitive to stroke ORDER — Yjs does not guarantee array order across peers", () => {
    const a = extractBoard([text("top", 0, 0), text("bottom", 0, 100)], 1);
    const b = extractBoard([text("bottom", 0, 100), text("top", 0, 0)], 1);
    expect(boardDigest(a)).toBe(boardDigest(b));
  });
});

import { describe, it, expect } from "vitest";
import { groundingToast } from "../src/lib/studyGrounding";

describe("groundingToast — flashcards", () => {
  it("is a success when grounded in real course material", () => {
    const t = groundingToast("flashcards", true, 8);
    expect(t.kind).toBe("ok");
    expect(t.message).toContain("8 new flashcards");
  });

  it("WARNS when ungrounded so students aren't misled (B1/B9)", () => {
    const t = groundingToast("flashcards", false, 5);
    expect(t.kind).toBe("warn");
    expect(t.message).toContain("5 cards");
    expect(t.message).toMatch(/general knowledge/i);
  });
});

describe("groundingToast — guide", () => {
  it("is a success when grounded", () => {
    const t = groundingToast("guide", true);
    expect(t.kind).toBe("ok");
    expect(t.message).toBe("Study guide saved!");
  });

  it("WARNS when ungrounded that the guide isn't from their materials (B1)", () => {
    const t = groundingToast("guide", false);
    expect(t.kind).toBe("warn");
    expect(t.message).toMatch(/general knowledge|not your uploaded materials/i);
  });
});

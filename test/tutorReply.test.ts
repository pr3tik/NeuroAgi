import { describe, it, expect } from "vitest";
import { isFillerOnly, tutorFallback, ensureTutorReply } from "../src/lib/tutorReply";

describe("isFillerOnly", () => {
  it("flags bare stall/acknowledgement phrases", () => {
    for (const f of ["One sec.", "one second", "Just a sec", "hold on", "Let me check.",
                     "let me look that up", "give me a moment", "sure", "Okay!", "ok…"]) {
      expect(isFillerOnly(f), `"${f}" should be filler`).toBe(true);
    }
  });

  it("does NOT flag substantive answers, even short ones", () => {
    for (const real of ["Sure, here's how mitosis works…", "Photosynthesis converts light to sugar.",
                        "Yes — the answer is 42.", "Let me check your notes: chapter 3 covers this."]) {
      expect(isFillerOnly(real), `"${real}" should NOT be filler`).toBe(false);
    }
  });

  it("treats empty/whitespace as not-filler (handled by the empty branch instead)", () => {
    expect(isFillerOnly("")).toBe(false);
    expect(isFillerOnly("   ")).toBe(false);
  });
});

describe("ensureTutorReply", () => {
  it("replaces an empty reply with a grounding-aware fallback", () => {
    expect(ensureTutorReply("", { isNav: false, hasGrounding: false }))
      .toBe(tutorFallback(false));
    expect(ensureTutorReply("   ", { isNav: false, hasGrounding: true }))
      .toBe(tutorFallback(true));
  });

  it("replaces a filler-only reply (the 'One sec.' bug) with the fallback", () => {
    expect(ensureTutorReply("One sec.", { isNav: false, hasGrounding: false }))
      .toBe(tutorFallback(false));
  });

  it("uses the ungrounded fallback when there is no source material", () => {
    expect(ensureTutorReply("", { isNav: false, hasGrounding: false }))
      .toMatch(/don't have any of your course materials/i);
  });

  it("uses the grounded fallback when material was retrieved", () => {
    expect(ensureTutorReply("", { isNav: false, hasGrounding: true }))
      .toMatch(/couldn't pull that together/i);
  });

  it("leaves a real answer untouched", () => {
    const real = "Mitosis has four phases: prophase, metaphase, anaphase, telophase.";
    expect(ensureTutorReply(real, { isNav: false, hasGrounding: true })).toBe(real);
  });

  it("never substitutes when navigating — empty text is intentional there", () => {
    expect(ensureTutorReply("", { isNav: true, hasGrounding: false })).toBe("");
    expect(ensureTutorReply("One sec.", { isNav: true, hasGrounding: false })).toBe("One sec.");
  });
});

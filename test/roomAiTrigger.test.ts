// @vitest-environment node
// roomAiTrigger — driver election + wake-word parsing + prompt building (SPEC R3/R4).
import { describe, it, expect } from "vitest";
import { electDriver, isDriver, parseWakeWord, buildAiPrompt, detectConfusion, buildProactivePrompt, isProactiveSilent, isSolveDone, buildSolvePrompt, stripSolvedToken, hasSolvedToken } from "../src/lib/roomAiTrigger";

describe("driver election", () => {
  it("elects the smallest userId, deterministically for every client", () => {
    const roster = ["zoe", "amy", "bob"];
    expect(electDriver(roster)).toBe("amy");
    expect(electDriver([...roster].reverse())).toBe("amy");   // order-independent
  });

  it("returns null for an empty roster", () => {
    expect(electDriver([])).toBeNull();
  });

  it("isDriver: exactly one member is the driver; a lone user is their own driver", () => {
    const roster = ["m", "a", "z"];
    expect(roster.filter(id => isDriver(roster, id))).toEqual(["a"]);
    expect(isDriver([], "solo")).toBe(true);   // alone in the room
  });
});

describe("wake word", () => {
  it("detects a summon and returns the trailing question", () => {
    expect(parseWakeWord("hey Reggie what is a hash map")).toBe("what is a hash map");
    expect(parseWakeWord("ok reggie, explain recursion")).toBe("explain recursion");
    expect(parseWakeWord("Reggie: summarize this")).toBe("summarize this");
  });

  it("survives real STT mis-hearings of the name", () => {
    // ElevenLabs commonly hears "Reggie" as these.
    expect(parseWakeWord("rajeev what is recursion")).toBe("what is recursion");
    expect(parseWakeWord("hey rajiv explain this")).toBe("explain this");
    expect(parseWakeWord("reggy can you help")).toBe("can you help");
    expect(parseWakeWord("hey veggie summarize")).toBe("summarize");   // r→v mishear
  });

  it("catches the name as an address anywhere in the utterance, not just the start", () => {
    // The real failing case: one STT segment with the name at the end.
    expect(parseWakeWord("I'm stuck. Reggie, help me out")).toBe("help me out");
    expect(parseWakeWord("ok so, reggie what should i read")).toBe("what should i read");
    expect(parseWakeWord("can you help me out, reggie")).toBe("can you help me out");   // name at end
  });

  it("returns '' when summoned with no explicit question", () => {
    expect(parseWakeWord("hey reggie")).toBe("");
    expect(parseWakeWord("reggie?")).toBe("");
  });

  it("returns null when not summoned, and does not fire on substrings or mid-sentence names", () => {
    expect(parseWakeWord("let's aggregate the data")).toBeNull();
    expect(parseWakeWord("what is a binary tree")).toBeNull();
    expect(parseWakeWord("are you ready to start")).toBeNull();
    expect(parseWakeWord("we won the reggie award last year")).toBeNull();   // name not at start / no greeting
  });
});

describe("prompt building", () => {
  it("includes the conversation, the question, and voice-agent instructions", () => {
    const p = buildAiPrompt("Alice: what's a heap\nBob: not sure", "Bob", "what is a heap");
    expect(p).toContain("Alice: what's a heap");
    expect(p).toContain('Bob just asked you, out loud, in the room: "what is a heap"');
    expect(p).toMatch(/short spoken sentences/i);
    expect(p).toMatch(/no markdown/i);
  });

  it("handles an empty question (summoned to help generally)", () => {
    const p = buildAiPrompt("Alice: I'm stuck", "Alice", "");
    expect(p).toContain("summoned you to help");
    expect(p).not.toContain('asked you, out loud');
  });

  it("omits the conversation block when there's no transcript yet", () => {
    const p = buildAiPrompt("", "Sam", "hi");
    expect(p).not.toContain("Room conversation so far");
  });
});

describe("proactive gate (R7)", () => {
  it("Stage A detects confusion / help-request signals", () => {
    for (const s of [
      "honestly I'm so confused about this",
      "wait what",
      "I don't get how recursion works",
      "can someone explain big-O",
      "why does the loop never end",
      "how do I balance this equation",
      "no idea what that means",
    ]) expect(detectConfusion(s)).toBe(true);
  });

  it("Stage A stays quiet on normal conversation", () => {
    for (const s of [
      "let's aggregate the results",
      "the answer is 42",
      "sounds good, I finished that part",
      "nice, that makes sense now",
      "",
    ]) expect(detectConfusion(s)).toBe(false);
  });

  it("isProactiveSilent treats SILENT / empty as no-interjection", () => {
    expect(isProactiveSilent("SILENT")).toBe(true);
    expect(isProactiveSilent("  silent  ")).toBe(true);
    expect(isProactiveSilent("")).toBe(true);
    expect(isProactiveSilent("Try factoring out the x first.")).toBe(false);
  });

  it("buildProactivePrompt instructs the SILENT-or-one-hint contract", () => {
    const p = buildProactivePrompt("Alice: I'm stuck on this");
    expect(p).toContain("Alice: I'm stuck on this");
    expect(p).toMatch(/EXACTLY the single word: SILENT/);
    expect(p).toMatch(/ONE short spoken sentence/i);
  });
});

describe("solve loop", () => {
  it("isSolveDone detects a satisfied user", () => {
    for (const s of ["thanks reggie", "ok got it", "that makes sense now", "we're good", "i understand it now", "no more questions"])
      expect(isSolveDone(s)).toBe(true);
  });

  it("isSolveDone keeps the loop going on a follow-up", () => {
    for (const s of ["wait what about the base case", "can you explain that part again", "i still don't get it", "why though"])
      expect(isSolveDone(s)).toBe(false);
  });

  it("buildSolvePrompt frames an ongoing back-and-forth and the check-in + [SOLVED] contract", () => {
    const p = buildSolvePrompt("Bob: why is it O(n)\nReggie: because...");
    expect(p).toContain("Bob: why is it O(n)");
    expect(p).toMatch(/ongoing back-and-forth/i);
    expect(p).toMatch(/check in/i);
    expect(p).toMatch(/\[SOLVED\]/);
  });

  it("buildAiPrompt (the first ask) also carries the check-in + [SOLVED] contract", () => {
    const p = buildAiPrompt("", "Sam", "what is a stack");
    expect(p).toMatch(/anything else/i);
    expect(p).toMatch(/\[SOLVED\]/);
  });

  it("stripSolvedToken removes the token; hasSolvedToken detects it", () => {
    expect(hasSolvedToken("Glad that clicked! [SOLVED]")).toBe(true);
    expect(hasSolvedToken("here's another way to see it")).toBe(false);
    expect(stripSolvedToken("Nice, you've got it now. [SOLVED]")).toBe("Nice, you've got it now.");
    expect(stripSolvedToken("no token here")).toBe("no token here");
  });
});

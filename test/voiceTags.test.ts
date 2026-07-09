// @vitest-environment node
// Voice-tag protocol tests (src/lib/voiceTags.ts) — shared by the classic tutor and
// Reggie mode, so this file is the single source of truth for tag semantics.
import { describe, it, expect } from "vitest";
import { parseVoiceTags, stripAgentJSON, VOICE_TAGS_ADDENDUM } from "../src/lib/voiceTags";

describe("parseVoiceTags", () => {
  it("extracts value tags and strips them from the text", () => {
    const { tags, cleaned } = parseVoiceTags("Sure, switching now. [VOICE:deep male] [SPEED:1.2] [TONE:calm]");
    expect(tags.VOICE).toBe("deep male");
    expect(tags.SPEED).toBe("1.2");
    expect(tags.TONE).toBe("calm");
    expect(cleaned).toBe("Sure, switching now.");
  });

  it("argument-less tags become true ([SYNC])", () => {
    const { tags, cleaned } = parseVoiceTags("On it — refreshing your Canvas data. [SYNC]");
    expect(tags.SYNC).toBe(true);
    expect(cleaned).toBe("On it — refreshing your Canvas data.");
  });

  it("GENERATE_FLASHCARDS carries the course name", () => {
    const { tags } = parseVoiceTags("Making them now! [GENERATE_FLASHCARDS:BIO 101]");
    expect(tags.GENERATE_FLASHCARDS).toBe("BIO 101");
  });

  it("multiple tags anywhere in the reply, case-insensitive", () => {
    const { tags, cleaned } = parseVoiceTags("[sync] Let me refresh. [tone:energetic] Done soon!");
    expect(tags.SYNC).toBe(true);
    expect(tags.TONE).toBe("energetic");
    expect(cleaned).toBe("Let me refresh.  Done soon!");   // tags removed; inner spacing untouched
    expect(cleaned).not.toMatch(/\[/);
  });

  it("no tags → empty tags, text unchanged", () => {
    const { tags, cleaned } = parseVoiceTags("Just a normal answer about mitosis.");
    expect(Object.keys(tags)).toHaveLength(0);
    expect(cleaned).toBe("Just a normal answer about mitosis.");
  });

  it("does NOT treat ordinary brackets as tags", () => {
    const { tags, cleaned } = parseVoiceTags("See [Chapter 3] and [1] in your notes.");
    expect(Object.keys(tags)).toHaveLength(0);
    expect(cleaned).toContain("[Chapter 3]");
  });
});

describe("stripAgentJSON", () => {
  it("removes stray tool-call JSON but keeps normal text", () => {
    const out = stripAgentJSON('Here you go. {"name":"recall","arguments":{"query":"cells"}} The answer is 4.');
    expect(out).not.toContain('"name"');
    expect(out).toContain("The answer is 4.");
  });
  it("passes non-strings through", () => {
    expect(stripAgentJSON(null)).toBeNull();
    expect(stripAgentJSON(undefined)).toBeUndefined();
  });
});

describe("VOICE_TAGS_ADDENDUM ↔ parser consistency", () => {
  it("every tag the addendum teaches is one the parser extracts", () => {
    for (const tag of ["SYNC", "GENERATE_FLASHCARDS", "VOICE", "SPEED", "TONE"]) {
      expect(VOICE_TAGS_ADDENDUM).toContain(`[${tag}`);
      const probe = tag === "SYNC" ? `[${tag}]` : `[${tag}:x]`;
      expect(Object.keys(parseVoiceTags(`hi ${probe}`).tags)).toContain(tag);
    }
  });
});

// @vitest-environment node
// Sentence chunker for streamed TTS (src/lib/ttsChunker.ts): audio must start on the
// first completed sentence, never split decimals, and honor reset (Reggie's pre-tool
// preamble discard) + flush (end of stream).
import { describe, it, expect } from "vitest";
import { createSentenceChunker } from "../src/lib/ttsChunker";

function collect() {
  const out: string[] = [];
  const c = createSentenceChunker((s) => out.push(s));
  return { out, c };
}

describe("createSentenceChunker", () => {
  it("emits a sentence the moment it closes, across token-sized deltas", () => {
    const { out, c } = collect();
    for (const d of ["Your grade", " is 92%.", " Keep it", " up!", " More soon."]) c.feed(d);
    expect(out).toEqual(["Your grade is 92%.", "Keep it up!"]);
    c.flush();
    expect(out).toEqual(["Your grade is 92%.", "Keep it up!", "More soon."]);
  });

  it("multiple sentences arriving in one delta all emit, in order", () => {
    const { out, c } = collect();
    c.feed("First one. Second one! Third one? And a tail");
    expect(out).toEqual(["First one.", "Second one!", "Third one?"]);
    c.flush();
    expect(out[3]).toBe("And a tail");
  });

  it("does not split decimals or dotted numbers", () => {
    const { out, c } = collect();
    c.feed("Your GPA is 3.5 right now. Nice work.");
    expect(out).toEqual(["Your GPA is 3.5 right now."]);   // "Nice work." buffers until flush —
    c.flush();                                             // mid-stream, more text could follow
    expect(out).toEqual(["Your GPA is 3.5 right now.", "Nice work."]);
  });

  it("handles terminators followed by closing quotes", () => {
    const { out, c } = collect();
    c.feed('The prof said "well done." Then she moved on. ');
    expect(out[0]).toBe('The prof said "well done."');
    expect(out[1]).toBe("Then she moved on.");
  });

  it("reset drops the buffered partial without emitting (pre-tool preamble discard)", () => {
    const { out, c } = collect();
    c.feed("Let me check your grades first. Meanwhile I was about to say someth");
    expect(out).toEqual(["Let me check your grades first."]);   // complete sentence already spoken
    c.reset();
    c.flush();                                                   // buffer was dropped — nothing more
    expect(out).toEqual(["Let me check your grades first."]);
    c.feed("Here is the real answer. ");
    expect(out[1]).toBe("Here is the real answer.");
  });

  it("flush on an empty/whitespace buffer emits nothing", () => {
    const { out, c } = collect();
    c.feed("   ");
    c.flush();
    expect(out).toEqual([]);
  });

  it("never splits inside a voice-UI tag argument ([VOICE:Dr. Smith])", () => {
    const { out, c } = collect();
    c.feed("Switching now. [VOICE:Dr. ");
    expect(out).toEqual(["Switching now."]);       // boundary inside the open tag must wait
    c.feed("Smith] There we go. ");
    expect(out[1]).toBe("[VOICE:Dr. Smith] There we go.");   // whole tag kept for the stripper
  });

  it("bare numbered-list markers are not spoken as their own chunk", () => {
    const { out, c } = collect();
    c.feed("Here is the plan. 1. Read the notes. 2. Do the quiz. ");
    expect(out).toEqual(["Here is the plan.", "Read the notes.", "Do the quiz."]);
  });

  it("newlines count as sentence boundaries", () => {
    const { out, c } = collect();
    c.feed("Point one.\nPoint two.\n");
    expect(out).toEqual(["Point one.", "Point two."]);
  });
});

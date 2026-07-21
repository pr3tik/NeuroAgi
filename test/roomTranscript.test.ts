// @vitest-environment node
// roomTranscript — the shared single-source-of-truth transcript store (SPEC R2).
//
// The load-bearing guarantee is CONVERGENCE: every client feeds the same set of utterances
// in whatever order their broadcasts happen to arrive, and all clients must end up with the
// identical ordered transcript. These tests pin that, plus dedupe, ordering, and the LLM
// rendering the AI layer will consume.
import { describe, it, expect, vi } from "vitest";
import { RoomTranscript, type Utterance } from "../src/lib/roomTranscript";

function u(speakerId: string, seq: number, ts: number, text: string, name = speakerId): Utterance {
  return { id: `${speakerId}:${seq}`, speakerId, speakerName: name, text, ts, seq };
}

describe("dedupe + ingest", () => {
  it("ignores a repeat of the same id (broadcast echo / re-delivery)", () => {
    const t = new RoomTranscript();
    expect(t.add(u("a", 1, 100, "hello"))).toBe(true);
    expect(t.add(u("a", 1, 100, "hello"))).toBe(false);   // same id → dropped
    expect(t.size()).toBe(1);
  });

  it("rejects empty or malformed utterances", () => {
    const t = new RoomTranscript();
    expect(t.add({ id: "a:1", speakerId: "a", speakerName: "A", text: "", ts: 1, seq: 1 })).toBe(false);
    expect(t.add(null as any)).toBe(false);
    expect(t.size()).toBe(0);
  });
});

describe("ordering", () => {
  it("orders across speakers by timestamp", () => {
    const t = new RoomTranscript();
    t.add(u("b", 1, 300, "third"));
    t.add(u("a", 1, 100, "first"));
    t.add(u("a", 2, 200, "second"));
    expect(t.list().map(x => x.text)).toEqual(["first", "second", "third"]);
  });

  it("keeps one speaker's segments in seq order when timestamps tie", () => {
    const t = new RoomTranscript();
    t.add(u("a", 3, 100, "three"));
    t.add(u("a", 1, 100, "one"));
    t.add(u("a", 2, 100, "two"));
    expect(t.list().map(x => x.text)).toEqual(["one", "two", "three"]);
  });

  it("inserts a late out-of-order arrival at the correct position", () => {
    const t = new RoomTranscript();
    t.add(u("a", 1, 100, "a1"));
    t.add(u("b", 1, 300, "b1"));
    t.add(u("a", 2, 200, "a2"));   // arrives last, belongs in the middle
    expect(t.list().map(x => x.text)).toEqual(["a1", "a2", "b1"]);
  });
});

describe("convergence (the SSOT guarantee)", () => {
  it("two clients given the same utterances in different arrival orders match exactly", () => {
    const utts = [
      u("a", 1, 100, "hi"),
      u("b", 1, 150, "hey"),
      u("a", 2, 220, "how are you"),
      u("b", 2, 220, "good thanks"),   // same ts as a:2 → speakerId tiebreak (a before b)
      u("a", 3, 400, "cool"),
    ];
    const c1 = new RoomTranscript();
    const c2 = new RoomTranscript();
    utts.forEach(x => c1.add(x));                 // in order
    [...utts].reverse().forEach(x => c2.add(x));   // reversed arrival
    expect(c1.list().map(x => x.id)).toEqual(c2.list().map(x => x.id));
    expect(c1.forPrompt()).toBe(c2.forPrompt());
  });
});

describe("windows + prompt rendering", () => {
  it("recent(n) returns the last n in order", () => {
    const t = new RoomTranscript();
    for (let i = 1; i <= 5; i++) t.add(u("a", i, i * 10, `m${i}`));
    expect(t.recent(2).map(x => x.text)).toEqual(["m4", "m5"]);
  });

  it("since(ts) returns utterances at or after a time", () => {
    const t = new RoomTranscript();
    t.add(u("a", 1, 100, "old"));
    t.add(u("a", 2, 200, "mid"));
    t.add(u("a", 3, 300, "new"));
    expect(t.since(200).map(x => x.text)).toEqual(["mid", "new"]);
  });

  it("forPrompt renders 'Name: text' lines and trims from the front on maxChars", () => {
    const t = new RoomTranscript();
    t.add(u("a", 1, 100, "hello", "Alice"));
    t.add(u("b", 1, 200, "hi there", "Bob"));
    expect(t.forPrompt()).toBe("Alice: hello\nBob: hi there");
    // maxChars keeps the newest content
    expect(t.forPrompt({ maxChars: 12 })).toBe("Bob: hi there".slice(-12));
  });
});

describe("subscription", () => {
  it("notifies subscribers on add and stops after unsubscribe", () => {
    const t = new RoomTranscript();
    const fn = vi.fn();
    const off = t.subscribe(fn);
    t.add(u("a", 1, 100, "x"));
    expect(fn).toHaveBeenCalledTimes(1);
    off();
    t.add(u("a", 2, 200, "y"));
    expect(fn).toHaveBeenCalledTimes(1);   // no more calls
  });

  it("clear() empties the store and notifies", () => {
    const t = new RoomTranscript();
    t.add(u("a", 1, 100, "x"));
    const fn = vi.fn();
    t.subscribe(fn);
    t.clear();
    expect(t.size()).toBe(0);
    expect(fn).toHaveBeenCalled();
  });
});

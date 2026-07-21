import { describe, it, expect, vi } from "vitest";
import { MUSIC_PRESETS, stopAudio, cycleIndex } from "../src/lib/focusMusic";

describe("stopAudio — closing the player must silence + rewind", () => {
  it("pauses AND rewinds to 0, and reports not-playing", () => {
    const a = { pause: vi.fn(), currentTime: 17 };
    const playing = stopAudio(a);
    expect(a.pause).toHaveBeenCalledOnce();
    expect(a.currentTime).toBe(0);
    expect(playing).toBe(false);
  });

  it("is safe on null/undefined (nothing to stop)", () => {
    expect(stopAudio(null)).toBe(false);
    expect(stopAudio(undefined)).toBe(false);
  });

  it("swallows an audio error and still reports not-playing", () => {
    const a = { pause: () => { throw new Error("detached"); }, currentTime: 5 };
    expect(() => stopAudio(a)).not.toThrow();
    expect(stopAudio(a)).toBe(false);
  });
});

describe("cycleIndex — next track wraps", () => {
  it("advances then wraps at the end", () => {
    expect(cycleIndex(0, 3)).toBe(1);
    expect(cycleIndex(1, 3)).toBe(2);
    expect(cycleIndex(2, 3)).toBe(0); // wrap
  });
  it("is safe with no tracks", () => {
    expect(cycleIndex(0, 0)).toBe(0);
    expect(cycleIndex(5, 0)).toBe(0);
  });
});

describe("MUSIC_PRESETS", () => {
  it("offers several curated, well-formed presets", () => {
    expect(MUSIC_PRESETS.length).toBeGreaterThanOrEqual(3);
    for (const p of MUSIC_PRESETS) {
      expect(p.label.trim()).not.toBe("");
      expect(p.query.trim()).not.toBe("");
    }
  });
});

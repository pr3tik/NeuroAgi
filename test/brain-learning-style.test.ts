// @vitest-environment node
import { describe, it, expect } from "vitest";
import { InMemoryStore, remember } from "../api/_brain/kernel.ts";
import { deriveTraits, runTraitPass, resolveLearningStyle } from "../api/_brain/traits.ts";

describe("learning-style as a mined trait (not a static string)", () => {
  it("mines the format the student engages with, when there's a clear leader", () => {
    const sigs = [
      ...Array(4).fill(0).map(() => ({ body: { format: "problem", helpful: true } })),
      ...Array(3).fill(0).map(() => ({ body: { format: "read", helpful: false } })),
    ] as any;
    const pref = deriveTraits(sigs).find((t) => t.key === "learning_pref");
    expect(pref?.format).toBe("problem");
  });

  it("stays silent when no clear leader (caller falls back to the static value)", () => {
    const sigs = [
      ...Array(3).fill(0).map(() => ({ body: { format: "problem", helpful: true } })),
      ...Array(3).fill(0).map(() => ({ body: { format: "read", helpful: true } })),
    ] as any;
    expect(deriveTraits(sigs).find((t) => t.key === "learning_pref")).toBeUndefined();
  });

  it("resolveLearningStyle prefers the mined trait, else the static fallback", async () => {
    const s = new InMemoryStore();
    expect(await resolveLearningStyle(s, "person:a", "diagram")).toBe("diagram"); // no trait yet
    for (let i = 0; i < 4; i++) await remember(s, { subject: "person:a", kind: "signal", body: { format: "problem", helpful: true } });
    await runTraitPass(s, "person:a");
    expect(await resolveLearningStyle(s, "person:a", "diagram")).toBe("problem"); // mined supersedes static
  });
});

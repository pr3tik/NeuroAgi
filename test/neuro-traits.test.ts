// @vitest-environment node
// Unit tests for the trait derivation layer (api/_brain/traits.ts).
import { describe, it, expect } from "vitest";
import { deriveTraits, runTraitPass } from "../api/_brain/traits.ts";
import { InMemoryStore, remember, recall, renderStudentBrainState } from "../api/_brain/kernel.ts";

const sig = (body: any) => ({ id: "x", subject: "s", kind: "signal", body, salience: 1, audience: [], source: null, happened_at: "", last_seen_at: "", forgotten_at: null, created_at: "" });

describe("deriveTraits", () => {
  it("needs enough signals to characterize", () => {
    expect(deriveTraits([sig({ time_of_day: "late_night" })])).toEqual([]);
  });

  it("derives a dominant study time and deep-engagement style", () => {
    const signals = [
      sig({ time_of_day: "late_night", message_length: 300 }),
      sig({ time_of_day: "late_night", message_length: 250 }),
      sig({ time_of_day: "late_night", message_length: 280 }),
      sig({ time_of_day: "morning", message_length: 260 }),
    ];
    const traits = deriveTraits(signals);
    const time = traits.find((t) => t.key === "study_time");
    const eng = traits.find((t) => t.key === "engagement");
    expect(time?.text).toContain("late at night");
    expect(eng?.text).toContain("in depth");
  });

  it("derives terse-engagement for short messages", () => {
    const traits = deriveTraits(Array.from({ length: 5 }, () => sig({ message_length: 20 })));
    expect(traits.find((t) => t.key === "engagement")?.text).toContain("short");
  });
});

describe("runTraitPass", () => {
  async function seed() {
    const s = new InMemoryStore();
    for (let i = 0; i < 5; i++) await remember(s, { subject: "person:p", kind: "signal", body: { signal_type: "behavioral", time_of_day: "late_night", message_length: 300 } });
    return s;
  }

  it("writes traits that surface in STUDENT BRAIN STATE, without duplicating on re-run", async () => {
    const s = await seed();
    await runTraitPass(s, "person:p");
    await runTraitPass(s, "person:p"); // idempotent by key
    const traits = await recall(s, ["person:p"], { kind: "trait", reinforce: false });
    expect(traits.length).toBe(2); // study_time + engagement, not 4
    const block = renderStudentBrainState(await recall(s, ["person:p"], { reinforce: false }));
    expect(block).toContain("trait:");
    expect(block).toContain("late at night");
  });
});

// @vitest-environment node
// Unit tests for the hypothesis engine (api/_brain/hypothesis.ts) over the InMemoryStore.
import { describe, it, expect } from "vitest";
import { mineHypotheses, runHypothesisPass } from "../api/_brain/hypothesis.ts";
import { InMemoryStore, remember, recall, renderStudentBrainState } from "../api/_brain/kernel.ts";

const sig = (body: any) => ({ id: "x", subject: "s", kind: "signal", body, salience: 1, audience: [], source: null, happened_at: "", last_seen_at: "", forgotten_at: null, created_at: "" });

describe("mineHypotheses", () => {
  it("needs at least 3 corroborating signals", () => {
    expect(mineHypotheses([sig({ emotional_tone: "stressed" }), sig({ emotional_tone: "stressed" })])).toEqual([]);
  });
  it("clusters repeated stress into a hypothesis with rising confidence", () => {
    const three = mineHypotheses(Array.from({ length: 3 }, () => sig({ emotional_tone: "stressed" })));
    expect(three).toHaveLength(1);
    expect(three[0]).toMatchObject({ key: "emotion:stressed", dimension: "emotion", evidence: 3 });
    expect(three[0].confidence).toBeCloseTo(0.6, 5);
    const five = mineHypotheses(Array.from({ length: 5 }, () => sig({ emotional_tone: "stressed" })));
    expect(five[0].confidence).toBeCloseTo(1, 5);
  });
});

describe("runHypothesisPass", () => {
  async function seed(n: number) {
    const s = new InMemoryStore();
    for (let i = 0; i < n; i++) await remember(s, { subject: "person:p", kind: "signal", body: { signal_type: "behavioral", emotional_tone: "stressed" }, salience: 0.35 });
    return s;
  }

  it("promotes a confident hypothesis to a focus the tutor surfaces", async () => {
    const s = await seed(4); // confidence 0.8 ≥ promote
    const hyps = await runHypothesisPass(s, "person:p");
    expect(hyps.map((h) => h.key)).toContain("emotion:stressed");
    const focus = await recall(s, ["person:p"], { kind: "focus", reinforce: false });
    expect(focus).toHaveLength(1);
    const block = renderStudentBrainState(await recall(s, ["person:p"], { reinforce: false }));
    expect(block).toContain("focus:");
    expect(block).toContain("stressed");
  });

  it("does not duplicate on a second pass (reinforces instead)", async () => {
    const s = await seed(4);
    await runHypothesisPass(s, "person:p");
    await runHypothesisPass(s, "person:p");
    const hyp = await recall(s, ["person:p"], { kind: "hypothesis", reinforce: false });
    const focus = await recall(s, ["person:p"], { kind: "focus", reinforce: false });
    expect(hyp).toHaveLength(1);
    expect(focus).toHaveLength(1);
  });
});

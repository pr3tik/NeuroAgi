// @vitest-environment node
import { describe, it, expect } from "vitest";
import { InMemoryStore, remember } from "../api/_brain/kernel.ts";
import { verifySkills, brainHealth, exportBrain } from "../api/_brain/derived.ts";

describe("derived layers: skill-verification + brain-health", () => {
  it("verifySkills marks a skill verified at >=3 demonstrations and >=0.7 success", async () => {
    const s = new InMemoryStore();
    for (const c of [true, true, true, false]) await remember(s, { subject: "person:a", kind: "signal", body: { skill: "derivatives", correct: c } });
    for (const c of [false, false]) await remember(s, { subject: "person:a", kind: "signal", body: { skill: "integrals", correct: c } });
    const skills = await verifySkills(s, "person:a");
    expect(skills.find((x) => x.skill === "derivatives")?.verified).toBe(true);   // 3/4 = 0.75
    expect(skills.find((x) => x.skill === "integrals")?.verified).toBe(false);    // 0/2, under min
  });

  it("brainHealth summarizes count, freshness, traits, dominant tone", async () => {
    const s = new InMemoryStore();
    await remember(s, { subject: "person:a", kind: "signal", body: { emotional_tone: "stressed" } });
    await remember(s, { subject: "person:a", kind: "signal", body: { emotional_tone: "stressed" } });
    await remember(s, { subject: "person:a", kind: "trait", body: { key: "x", text: "t" } });
    const h = await brainHealth(s, "person:a");
    expect(h.memories).toBe(3);
    expect(h.fresh).toBe(3);
    expect(h.traits).toBe(1);
    expect(h.dominantTone).toBe("stressed");
  });

  it("exportBrain returns only the subject's own memories", async () => {
    const s = new InMemoryStore();
    await remember(s, { subject: "person:a", kind: "signal", body: {} });
    await remember(s, { subject: "person:b", kind: "signal", body: {} });
    expect((await exportBrain(s, "person:a")).length).toBe(1);
  });
});

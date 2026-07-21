// @vitest-environment node
import { describe, it, expect } from "vitest";
import { InMemoryStore, remember } from "../api/_brain/kernel.ts";
import { verifySkills, brainHealth, exportBrain, synthesizeContext } from "../api/_brain/derived.ts";

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

describe("synthesizeContext (kernel context synthesis)", () => {
  it("derives stress from stressed/confused-tone density + dominant tone", async () => {
    const s = new InMemoryStore();
    for (let i = 0; i < 3; i++) await remember(s, { subject: "person:a", kind: "signal", body: { emotional_tone: "stressed" } });
    const ctx = await synthesizeContext(s, "person:a");
    expect(ctx.stressLevel).toBe(6); // 3 stressed × 2
    expect(ctx.tone).toBe("stressed");
  });
  it("surfaces the top focus and the living-mind digest summary", async () => {
    const s = new InMemoryStore();
    await remember(s, { subject: "person:a", kind: "focus", salience: 0.9, body: { text: "stressed about midterms" } });
    await remember(s, { subject: "person:a", kind: "digest", body: { summary: "Strong in calculus" } });
    const ctx = await synthesizeContext(s, "person:a");
    expect(ctx.focus).toBe("stressed about midterms");
    expect(ctx.recentSummary).toBe("Strong in calculus");
  });
  it("empty brain → zero stress, steady momentum", async () => {
    const s = new InMemoryStore();
    const ctx = await synthesizeContext(s, "person:a");
    expect(ctx.stressLevel).toBe(0);
    expect(ctx.momentum).toBe("steady");
  });
});

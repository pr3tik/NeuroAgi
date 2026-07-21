// @vitest-environment node
import { describe, it, expect } from "vitest";
import { InMemoryStore, remember } from "../api/_brain/kernel.ts";
import { proactiveCandidates, gate } from "../api/_brain/policy.ts";

const cand = (salience: number) => ({ key: "k", dimension: "emotion", text: "stressed", salience });

describe("proactive policy gate", () => {
  it("rejects below the importance floor", () => {
    expect(gate(cand(0.5), {}).allow).toBe(false);
    expect(gate(cand(0.7), {}).allow).toBe(true);
  });
  it("respects the daily budget", () => {
    expect(gate(cand(0.9), { deliveredToday: 3 }).allow).toBe(false);
    expect(gate(cand(0.9), { deliveredToday: 2 }).allow).toBe(true);
  });
  it("respects the cooldown", () => {
    const now = 10_000_000_000;
    expect(gate(cand(0.9), { lastDeliveredAt: now - 60 * 60_000 }, { cooldownMins: 240 }, now).allow).toBe(false);
    expect(gate(cand(0.9), { lastDeliveredAt: now - 300 * 60_000 }, { cooldownMins: 240 }, now).allow).toBe(true);
  });
  it("suppresses during quiet hours (wrapping window)", () => {
    const at = (h: number) => new Date(2026, 0, 1, h, 0, 0).getTime();
    expect(gate(cand(0.9), {}, { quietHours: [22, 8] }, at(2)).allow).toBe(false);
    expect(gate(cand(0.9), {}, { quietHours: [22, 8] }, at(14)).allow).toBe(true);
  });
  it("derives candidates from focus memories, strongest first", async () => {
    const s = new InMemoryStore();
    await remember(s, { subject: "person:a", kind: "focus", salience: 0.9, body: { key: "emotion:stressed", dimension: "emotion", text: "persistently stressed" } });
    await remember(s, { subject: "person:a", kind: "focus", salience: 0.7, body: { key: "habit:late", dimension: "habit", text: "studies late" } });
    await remember(s, { subject: "person:a", kind: "signal", body: {} });
    const c = await proactiveCandidates(s, "person:a");
    expect(c.length).toBe(2);
    expect(c[0].key).toBe("emotion:stressed");
  });
});

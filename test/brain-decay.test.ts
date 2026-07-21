// @vitest-environment node
import { describe, it, expect } from "vitest";
import { InMemoryStore, remember, tickDecay, recall } from "../api/_brain/kernel.ts";

describe("decay sweep (tickDecay via sweepDue)", () => {
  it("forgets memories past the threshold, keeps fresh ones", async () => {
    const s = new InMemoryStore();
    const t0 = Date.parse("2026-01-01T00:00:00Z");
    await remember(s, { subject: "person:a", kind: "signal", body: { old: true }, salience: 0.3 }, t0);
    await remember(s, { subject: "person:a", kind: "signal", body: { fresh: true }, salience: 1 }, t0);
    // 60 days on, 14d half-life: 0.3·2^-(60/14) ≈ 0.0153 < 0.05 (dead); 1·2^-(60/14) ≈ 0.0511 > 0.05 (alive).
    const later = t0 + 60 * 86400000;
    const dead = await tickDecay(s, ["person:a"], later);
    expect(dead.length).toBe(1);
    const live = await recall(s, ["person:a"], { now: later, reinforce: false });
    expect(live.length).toBe(1);
    expect(live[0].body.fresh).toBe(true);
  });
  it("no-op on empty scopes", async () => {
    const s = new InMemoryStore();
    expect(await tickDecay(s, [])).toEqual([]);
  });
});

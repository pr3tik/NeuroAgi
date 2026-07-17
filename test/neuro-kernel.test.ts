// @vitest-environment node
// Unit tests for the NeuroAGI kernel (api/_brain/kernel.ts) against the zero-dependency
// InMemoryStore — no DB, no network. Locks the invariants: deterministic decay, recall
// ordering + threshold, recall-reinforces (use-it-or-lose-it), forget, and the decay sweep.
import { describe, it, expect } from "vitest";
import {
  InMemoryStore, remember, recall, forget, reinforce, tickDecay,
  effective, renderStudentBrainState, HALF_LIFE_DAYS, FORGET_THRESHOLD,
} from "../api/_brain/kernel.ts";

const DAY = 86_400_000;
const T0 = Date.parse("2026-01-01T00:00:00.000Z");

describe("decay", () => {
  it("halves salience after one half-life", () => {
    const m = { salience: 1, last_seen_at: new Date(T0).toISOString() };
    const later = T0 + HALF_LIFE_DAYS * DAY;
    expect(effective(m, later)).toBeCloseTo(0.5, 5);
  });

  it("does not amplify in the past (days clamped at 0)", () => {
    const m = { salience: 0.8, last_seen_at: new Date(T0).toISOString() };
    expect(effective(m, T0 - 5 * DAY)).toBeCloseTo(0.8, 5);
  });
});

describe("recall", () => {
  it("returns strongest first and drops sub-threshold memories", async () => {
    const s = new InMemoryStore();
    const subj = "person:test";
    await remember(s, { subject: subj, kind: "signal", body: { t: "fresh" }, salience: 1 }, T0);
    await remember(s, { subject: subj, kind: "signal", body: { t: "old-faint" }, salience: 0.2 }, T0 - 40 * DAY);
    // Read 60 days after T0: fresh one decayed a lot, faint one should be below threshold.
    const now = T0 + 60 * DAY;
    const got = await recall(s, [subj], { now, reinforce: false });
    expect(got.length).toBe(1);
    expect(got[0].body.t).toBe("fresh");
  });

  it("isolates subjects — one person's recall never sees another's", async () => {
    const s = new InMemoryStore();
    await remember(s, { subject: "person:a", kind: "signal", body: { who: "a" } }, T0);
    await remember(s, { subject: "person:b", kind: "signal", body: { who: "b" } }, T0);
    const a = await recall(s, ["person:a"], { now: T0, reinforce: false });
    expect(a.map((m) => m.body.who)).toEqual(["a"]);
  });

  it("filters by kind", async () => {
    const s = new InMemoryStore();
    const subj = "person:test";
    await remember(s, { subject: subj, kind: "signal", body: {} }, T0);
    await remember(s, { subject: subj, kind: "todo", body: {} }, T0);
    const todos = await recall(s, [subj], { kind: "todo", now: T0, reinforce: false });
    expect(todos.length).toBe(1);
    expect(todos[0].kind).toBe("todo");
  });

  it("reinforces what it returns — recall keeps a memory alive past the sweep", async () => {
    const s = new InMemoryStore();
    const subj = "person:test";
    await remember(s, { subject: subj, kind: "signal", body: {}, salience: 1 }, T0);
    // 12 days later: still alive, and recall (default reinforce) bumps last_seen to now.
    const t1 = T0 + 12 * DAY;
    const seen = await recall(s, [subj], { now: t1 });
    expect(seen.length).toBe(1);
    // Now jump another 12 days. Without the reinforce it'd be ~0.55 of original from T0
    // (24 days ≈ 0.30) — reinforced, it's only 12 days old again, so it survives.
    const t2 = t1 + 12 * DAY;
    const still = await recall(s, [subj], { now: t2, reinforce: false });
    expect(still.length).toBe(1);
    expect(effective(still[0], t2)).toBeGreaterThan(FORGET_THRESHOLD);
  });
});

describe("forget / reinforce / tick", () => {
  it("forget removes a memory from recall", async () => {
    const s = new InMemoryStore();
    const subj = "person:test";
    const m = await remember(s, { subject: subj, kind: "signal", body: {} }, T0);
    await forget(s, [m.id], T0);
    expect((await recall(s, [subj], { now: T0, reinforce: false })).length).toBe(0);
  });

  it("reinforce with a boost raises salience", async () => {
    const s = new InMemoryStore();
    const subj = "person:test";
    const m = await remember(s, { subject: subj, kind: "signal", body: {}, salience: 0.5 }, T0);
    await reinforce(s, m.id, T0, 0.3);
    const got = await recall(s, [subj], { now: T0, reinforce: false });
    expect(got[0].salience).toBeCloseTo(0.8, 5);
  });

  it("tickDecay soft-forgets everything under threshold", async () => {
    const s = new InMemoryStore();
    const subj = "person:test";
    await remember(s, { subject: subj, kind: "signal", body: { t: "keep" }, salience: 1 }, T0);
    await remember(s, { subject: subj, kind: "signal", body: { t: "drop" }, salience: 0.2 }, T0 - 40 * DAY);
    const now = T0 + 60 * DAY;
    const forgotten = await tickDecay(s, [subj], now);
    expect(forgotten.length).toBe(1);
    const left = await recall(s, [subj], { now, reinforce: false });
    expect(left.map((m) => m.body.t)).toEqual(["keep"]);
  });
});

describe("renderStudentBrainState (recall → prompt fold)", () => {
  const mk = (kind: string, body: any) => ({ id: "x", subject: "person:p", kind, body, salience: 1, audience: [], source: null, happened_at: "", last_seen_at: "", forgotten_at: null, created_at: "" });

  it("returns null when there's nothing to inject", () => {
    expect(renderStudentBrainState([])).toBeNull();
    expect(renderStudentBrainState([mk("signal", {})])).toBeNull();
  });

  it("folds digest + traits + recent signal tone into a labeled block", () => {
    const out = renderStudentBrainState([
      mk("digest", { summary: "Strong in calculus, avoids writing." }),
      mk("trait", { text: "visual learner" }),
      mk("signal", { emotional_tone: "stressed" }),
      mk("signal", { emotional_tone: "stressed" }),
      mk("signal", { event: "session_end" }),
    ]);
    expect(out).toContain("STUDENT BRAIN STATE (NeuroAGI):");
    expect(out).toContain("Living mind: Strong in calculus");
    expect(out).toContain("trait: visual learner");
    expect(out).toContain("recent tone: stressed");   // de-duped
    expect(out).toContain("recent: session_end");
  });
});

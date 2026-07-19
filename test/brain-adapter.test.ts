// @vitest-environment node
// A4 / BR-04 — the NeuroAGI linkage adapter, mock-first (InMemoryStore, no live brain). These pin
// the §18.4 mapping, the ONE-WAY linkage guarantee (person-scoped subject + fixed source stamp,
// no shared-space write path), and graceful degradation within the cross-project hop budget.
import { describe, it, expect } from "vitest";
import { brainRead, brainWrite, BRAIN_HOP_BUDGET_MS } from "../api/_brain/adapter.ts";
import { InMemoryStore, remember, type Store } from "../api/_brain/kernel.ts";

const PERSON = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";

async function seededStore(): Promise<InMemoryStore> {
  const s = new InMemoryStore();
  await remember(s, { subject: `person:${PERSON}`, kind: "trait", body: { text: "prefers worked examples" }, salience: 0.9 });
  await remember(s, { subject: `person:${PERSON}`, kind: "signal", body: { event: "missed_quiz", emotional_tone: "anxious" }, salience: 0.6 });
  await remember(s, { subject: `person:${OTHER}`, kind: "trait", body: { text: "SHOULD NOT LEAK" }, salience: 0.9 });
  return s;
}

describe("brainRead — brain.read → recall(person:<id>)", () => {
  it("returns the person's memories and a folded brain-state block", async () => {
    const store = await seededStore();
    const ctx = await brainRead(PERSON, { store });
    expect(ctx.degraded).toBe(false);
    expect(ctx.memories.length).toBe(2);
    expect(ctx.brainState).toBeTruthy();
    expect(ctx.brainState).toContain("trait: prefers worked examples");
  });

  it("scopes strictly to the person — another person's memory never leaks in", async () => {
    const store = await seededStore();
    const ctx = await brainRead(PERSON, { store });
    const blob = JSON.stringify(ctx);
    expect(blob).not.toContain("SHOULD NOT LEAK");
    expect(ctx.memories.every((m) => m.subject === `person:${PERSON}`)).toBe(true);
  });

  it("does NOT reinforce on a grounding read (last_seen_at unchanged)", async () => {
    const store = await seededStore();
    const before = store.rows.map((r) => r.last_seen_at);
    await brainRead(PERSON, { store });
    expect(store.rows.map((r) => r.last_seen_at)).toEqual(before);
  });

  it("degrades to empty context when transport is unconfigured (store: null)", async () => {
    const ctx = await brainRead(PERSON, { store: null });
    expect(ctx).toEqual({ personId: PERSON, memories: [], brainState: null, degraded: true });
  });

  it("degrades — never throws — when the transport errors", async () => {
    const boom: Store = {
      insert: async () => { throw new Error("x"); },
      bySubjects: async () => { throw new Error("brain down"); },
      touch: async () => {}, forget: async () => {}, reinforce: async () => {},
    };
    const ctx = await brainRead(PERSON, { store: boom });
    expect(ctx.degraded).toBe(true);
    expect(ctx.memories).toEqual([]);
  });

  it("degrades when a read exceeds the hop budget instead of stalling the turn", async () => {
    const slow: Store = {
      insert: async () => { throw new Error("x"); },
      bySubjects: () => new Promise(() => {}), // never resolves
      touch: async () => {}, forget: async () => {}, reinforce: async () => {},
    };
    const t0 = Date.now();
    const ctx = await brainRead(PERSON, { store: slow, hopBudgetMs: 50 });
    expect(ctx.degraded).toBe(true);
    expect(Date.now() - t0).toBeLessThan(BRAIN_HOP_BUDGET_MS); // returned well under the default budget
  });

  it("returns empty for a falsy personId", async () => {
    const ctx = await brainRead("", { store: await seededStore() });
    expect(ctx.degraded).toBe(true);
    expect(ctx.memories).toEqual([]);
  });
});

describe("brainWrite — brain.write → remember({kind:signal, source:fschoolai})", () => {
  it("writes a person-scoped signal with the fixed source stamp", async () => {
    const store = new InMemoryStore();
    const res = await brainWrite(PERSON, { body: { event: "asked_for_hint" } }, { store });
    expect(res.ok).toBe(true);
    expect(store.rows).toHaveLength(1);
    const m = store.rows[0];
    expect(m.subject).toBe(`person:${PERSON}`);
    expect(m.kind).toBe("signal");
    expect(m.source).toBe("fschoolai");
  });

  it("ONE-WAY: the write is always person-scoped — no way to target a shared/course subject", async () => {
    const store = new InMemoryStore();
    // The API takes a personId, not a subject: a caller cannot redirect the write at course:/room:.
    await brainWrite(PERSON, { body: { x: 1 } }, { store });
    expect(store.rows.every((m) => m.subject.startsWith("person:"))).toBe(true);
    expect(store.rows.some((m) => m.subject.startsWith("course:") || m.subject.startsWith("room:"))).toBe(false);
  });

  it("source stamp is non-overridable even if a caller smuggles one in", async () => {
    const store = new InMemoryStore();
    // `source` is not part of BrainSignal; a rogue extra field must be ignored.
    await brainWrite(PERSON, { body: { x: 1 }, source: "canvas", subject: `course:cs101` } as any, { store });
    expect(store.rows[0].source).toBe("fschoolai");
    expect(store.rows[0].subject).toBe(`person:${PERSON}`);
  });

  it("degrades to a no-op when transport is unconfigured (store: null)", async () => {
    const res = await brainWrite(PERSON, { body: { x: 1 } }, { store: null });
    expect(res).toEqual({ ok: false, degraded: true });
  });

  it("degrades — never throws — when the transport errors", async () => {
    const boom: Store = {
      insert: async () => { throw new Error("brain down"); },
      bySubjects: async () => [], touch: async () => {}, forget: async () => {}, reinforce: async () => {},
    };
    const res = await brainWrite(PERSON, { body: { x: 1 } }, { store: boom });
    expect(res).toEqual({ ok: false, degraded: true });
  });

  it("rejects a signal with no body", async () => {
    const store = new InMemoryStore();
    const res = await brainWrite(PERSON, {} as any, { store });
    expect(res.ok).toBe(false);
    expect(store.rows).toHaveLength(0);
  });

  it("round-trips: a written signal is read back by brainRead", async () => {
    const store = new InMemoryStore();
    await brainWrite(PERSON, { body: { event: "solved_problem" }, salience: 0.7 }, { store });
    const ctx = await brainRead(PERSON, { store });
    expect(ctx.memories.some((m) => m.body?.event === "solved_problem")).toBe(true);
  });
});

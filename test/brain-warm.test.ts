// @vitest-environment node
// A5 — the warm-context digest materializer (api/_brainWarm.ts), mock-first with InMemoryStore.
// Pins: rebuild-when-stale, no-op-when-warm, no-op-when-empty, single-current-digest (old ones
// retired), and that a rebuilt digest is what recall returns.
import { describe, it, expect } from "vitest";
import { materializeDigestIfStale, DIGEST_KIND, DIGEST_FRESH_MS } from "../api/_brainWarm.ts";
import { InMemoryStore, remember, recall } from "../api/_brain/kernel.ts";

const SUBJECT = "person:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

describe("materializeDigestIfStale", () => {
  it("no-ops when there is nothing worth digesting", async () => {
    const store = new InMemoryStore();
    const r = await materializeDigestIfStale(store, SUBJECT);
    expect(r).toEqual({ warmed: false, reason: "nothing-to-digest" });
    expect(store.rows).toHaveLength(0);
  });

  it("rebuilds a digest from raw memories when none exists", async () => {
    const store = new InMemoryStore();
    await remember(store, { subject: SUBJECT, kind: "signal", body: { event: "missed_quiz", emotional_tone: "anxious" }, salience: 0.6 });
    const r = await materializeDigestIfStale(store, SUBJECT);
    expect(r).toEqual({ warmed: true, reason: "rebuilt" });
    const digests = store.rows.filter((m) => m.kind === DIGEST_KIND && !m.forgotten_at);
    expect(digests).toHaveLength(1);
    expect(digests[0].body.summary).toContain("STUDENT BRAIN STATE");
    expect(digests[0].source).toBe("fschoolai");
  });

  it("is a no-op when a fresh digest already exists (idempotent within the window)", async () => {
    const store = new InMemoryStore();
    await remember(store, { subject: SUBJECT, kind: "signal", body: { event: "asked_hint" }, salience: 0.6 });
    const first = await materializeDigestIfStale(store, SUBJECT);
    expect(first.warmed).toBe(true);
    const second = await materializeDigestIfStale(store, SUBJECT);
    expect(second).toEqual({ warmed: false, reason: "already-warm" });
    expect(store.rows.filter((m) => m.kind === DIGEST_KIND && !m.forgotten_at)).toHaveLength(1);
  });

  it("rebuilds when the existing digest is stale, retiring the old one so recall returns exactly one", async () => {
    const store = new InMemoryStore();
    const now = Date.now();
    await remember(store, { subject: SUBJECT, kind: "signal", body: { event: "solved_problem" }, salience: 0.6 }, now);
    // A digest written well outside the freshness window.
    await remember(store, { subject: SUBJECT, kind: DIGEST_KIND, body: { summary: "OLD" }, salience: 0.9 }, now - DIGEST_FRESH_MS - 60_000);
    const r = await materializeDigestIfStale(store, SUBJECT, now);
    expect(r).toEqual({ warmed: true, reason: "rebuilt" });
    const live = await recall(store, [SUBJECT], { kind: DIGEST_KIND, reinforce: false, now });
    expect(live).toHaveLength(1);
    expect(live[0].body.summary).not.toBe("OLD"); // the stale one was retired
  });
});

// @vitest-environment node
import { describe, it, expect } from "vitest";
import { InMemoryStore, remember, recall } from "../api/_brain/kernel.ts";

describe("idempotency (idem key)", () => {
  it("same (subject, idem) updates in place, not duplicated", async () => {
    const s = new InMemoryStore();
    await remember(s, { subject: "person:a", kind: "signal", body: { v: 1 }, idem: "sess-1" });
    await remember(s, { subject: "person:a", kind: "signal", body: { v: 2 }, idem: "sess-1" });
    const got = await recall(s, ["person:a"], { reinforce: false });
    expect(got.length).toBe(1);
    expect(got[0].body.v).toBe(2); // latest write wins
  });
  it("different idem → separate rows", async () => {
    const s = new InMemoryStore();
    await remember(s, { subject: "person:a", kind: "signal", body: {}, idem: "x" });
    await remember(s, { subject: "person:a", kind: "signal", body: {}, idem: "y" });
    expect((await recall(s, ["person:a"], { reinforce: false })).length).toBe(2);
  });
  it("null idem → ordinary append (no dedup)", async () => {
    const s = new InMemoryStore();
    await remember(s, { subject: "person:a", kind: "signal", body: {} });
    await remember(s, { subject: "person:a", kind: "signal", body: {} });
    expect((await recall(s, ["person:a"], { reinforce: false })).length).toBe(2);
  });
  it("idem is scoped per subject", async () => {
    const s = new InMemoryStore();
    await remember(s, { subject: "person:a", kind: "signal", body: {}, idem: "same" });
    await remember(s, { subject: "person:b", kind: "signal", body: {}, idem: "same" });
    expect((await recall(s, ["person:a"], { reinforce: false })).length).toBe(1);
    expect((await recall(s, ["person:b"], { reinforce: false })).length).toBe(1);
  });
});

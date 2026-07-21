// @vitest-environment node
import { describe, it, expect } from "vitest";
import { InMemoryStore, remember, semanticRecall } from "../api/_brain/kernel.ts";

describe("semantic recall (embeddings)", () => {
  it("returns nearest by cosine, strongest first", async () => {
    const s = new InMemoryStore();
    await remember(s, { subject: "person:a", kind: "signal", body: { t: "calc" }, embedding: [1, 0, 0] });
    await remember(s, { subject: "person:a", kind: "signal", body: { t: "bio" }, embedding: [0, 1, 0] });
    await remember(s, { subject: "person:a", kind: "signal", body: { t: "chem" }, embedding: [0, 0, 1] });
    const got = await semanticRecall(s, ["person:a"], [0.9, 0.1, 0], { limit: 2 });
    expect(got[0].body.t).toBe("calc");
    expect(got.length).toBe(2);
  });
  it("ignores memories stored without an embedding", async () => {
    const s = new InMemoryStore();
    await remember(s, { subject: "person:a", kind: "signal", body: {} });
    expect((await semanticRecall(s, ["person:a"], [1, 0, 0])).length).toBe(0);
  });
  it("empty query or scopes → []", async () => {
    const s = new InMemoryStore();
    expect(await semanticRecall(s, [], [1, 0, 0])).toEqual([]);
    expect(await semanticRecall(s, ["person:a"], [])).toEqual([]);
  });
});

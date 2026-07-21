// @vitest-environment node
// Sharing semantics on InMemoryStore: membership, audience-aware recall, write-auth, isolation.
import { describe, it, expect } from "vitest";
import {
  InMemoryStore, remember, recall, readableScopes, canWrite, addMember, removeMember,
} from "../api/_brain/kernel.ts";

describe("sharing: membership + audience-aware recall + write-auth", () => {
  it("readableScopes = own subject + member spaces", async () => {
    const s = new InMemoryStore();
    await addMember(s, "course:CS", "person:a", "reader");
    await addMember(s, "room:1", "person:a", "writer");
    expect((await readableScopes(s, "person:a")).sort()).toEqual(["course:CS", "person:a", "room:1"]);
    expect(await readableScopes(s, "person:b")).toEqual(["person:b"]);
  });

  it("canWrite: own scope always; a shared space needs writer/owner", async () => {
    const s = new InMemoryStore();
    await addMember(s, "course:CS", "person:a", "reader");
    await addMember(s, "course:CS", "person:b", "writer");
    expect(await canWrite(s, "person:a", "person:a")).toBe(true);   // own personal scope
    expect(await canWrite(s, "course:CS", "person:a")).toBe(false); // reader may not write
    expect(await canWrite(s, "course:CS", "person:b")).toBe(true);  // writer may
    expect(await canWrite(s, "course:CS", "person:x")).toBe(false); // non-member may not
  });

  it("a member recalls a shared scope's memories; a non-member gets nothing", async () => {
    const s = new InMemoryStore();
    await remember(s, { subject: "course:CS", kind: "signal", body: { note: "midterm hard" } });
    expect((await recall(s, await readableScopes(s, "person:a"))).length).toBe(0); // not a member
    await addMember(s, "course:CS", "person:a", "reader");
    const got = await recall(s, await readableScopes(s, "person:a"));
    expect(got.map((m) => m.subject)).toContain("course:CS");
  });

  it("audience-aware recall: a directed share reaches the target, not third parties", async () => {
    const s = new InMemoryStore();
    await remember(s, { subject: "person:a", kind: "signal", body: { x: 1 }, audience: ["person:b"] });
    expect((await recall(s, ["person:b"])).length).toBe(1);
    expect((await recall(s, ["person:c"])).length).toBe(0);
  });

  it("public audience '*' is readable by anyone", async () => {
    const s = new InMemoryStore();
    await remember(s, { subject: "person:a", kind: "signal", body: {}, audience: ["*"] });
    expect((await recall(s, ["person:anyone"])).length).toBe(1);
  });

  it("isolation holds: B cannot read A's private memories", async () => {
    const s = new InMemoryStore();
    await remember(s, { subject: "person:a", kind: "signal", body: { secret: true } });
    expect((await recall(s, ["person:b"])).length).toBe(0);
  });

  it("removeMember revokes read access", async () => {
    const s = new InMemoryStore();
    await remember(s, { subject: "room:1", kind: "signal", body: {} });
    await addMember(s, "room:1", "person:a", "reader");
    expect((await recall(s, await readableScopes(s, "person:a"))).length).toBe(1);
    await removeMember(s, "room:1", "person:a");
    expect((await recall(s, await readableScopes(s, "person:a"))).length).toBe(0);
  });
});

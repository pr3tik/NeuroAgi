// @vitest-environment node
// Unit tests for the capability bus (api/_brain/bus.ts): local invoke in-process, unknown
// capability throws, and ingest (agent -> brain) writes a memory. No DB.
import { describe, it, expect, afterEach, vi } from "vitest";
import { registerLocal, _clearLocal, invoke, ingest } from "../api/_brain/bus.ts";
import { InMemoryStore, recall } from "../api/_brain/kernel.ts";

afterEach(() => { _clearLocal(); vi.unstubAllGlobals(); });

describe("bus", () => {
  it("invokes a local capability in-process (no DB)", async () => {
    registerLocal("echo", async (action, args) => ({ action, args }));
    const out = await invoke({ url: "http://x", key: "k" }, "echo", "say", { t: "hi" });
    expect(out).toEqual({ action: "say", args: { t: "hi" } });
  });

  it("throws on an unknown capability", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => [] })));
    await expect(invoke({ url: "http://x", key: "k" }, "nope", "a", {})).rejects.toThrow(/unknown capability/);
  });

  it("ingest feeds a memory back onto a subject (agent -> brain)", async () => {
    const s = new InMemoryStore();
    await ingest(s, "person:p", "insight", { note: "from agent" }, { salience: 0.5, source: "coach" });
    const mems = await recall(s, ["person:p"], { reinforce: false });
    expect(mems.length).toBe(1);
    expect(mems[0].kind).toBe("insight");
    expect(mems[0].source).toBe("coach");
  });
});

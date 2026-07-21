// @vitest-environment node
// LIVE endpoint e2e (via harness invoke, product DB fallback): the derived read-only actions
// health / skills / export operate over the caller's own brain.
import { describe, it, expect, afterAll } from "vitest";
import { LIVE, ns, invoke, cleanupTag } from "./e2e/brain-harness.ts";
import brain from "../api/brain.ts";

const N = ns("derived");
afterAll(async () => { if (LIVE) await cleanupTag(N.tag); });

describe.skipIf(!LIVE)("brain endpoint: derived actions (live)", () => {
  it("health / skills / export over the caller's own brain", async () => {
    await cleanupTag(N.tag);
    const uid = N.localId(1);
    for (let i = 0; i < 3; i++) {
      await invoke(brain, { userId: uid, query: { action: "remember" }, body: { kind: "signal", body: { skill: "x", correct: true, emotional_tone: "calm" } } });
    }
    const health = await invoke(brain, { userId: uid, query: { action: "health" } });
    expect(health.statusCode).toBe(200);
    expect(health.body.health.memories).toBeGreaterThanOrEqual(3);

    const skills = await invoke(brain, { userId: uid, query: { action: "skills" } });
    expect(skills.body.skills.find((x: any) => x.skill === "x")?.verified).toBe(true);

    const exp = await invoke(brain, { userId: uid, query: { action: "export" } });
    expect(exp.body.memories.length).toBeGreaterThanOrEqual(3);
  });
});

// @vitest-environment node
// LIVE (harness invoke, product-DB fallback): the D bridge — brain-sync records a compact
// canvas_sync signal in the caller's KERNEL brain (single source of truth), independent of the
// legacy fschool_* path (BRAIN_SUPABASE_* unset here, so only the kernel bridge runs).
import { describe, it, expect, afterAll } from "vitest";
import { LIVE, ns, store, invoke, cleanupTag, conn } from "./e2e/brain-harness.ts";
import { resolveFschoolPerson } from "../api/_brain/identity.ts";
import { recall } from "../api/_brain/kernel.ts";
import brainSync from "../api/brain-sync.ts";

const N = ns("synbridge");
afterAll(async () => { if (LIVE) await cleanupTag(N.tag); });

describe.skipIf(!LIVE)("brain-sync kernel bridge (live)", () => {
  it("records a canvas_sync kernel signal for the caller", async () => {
    await cleanupTag(N.tag);
    const uid = N.localId(1);
    const res = await invoke(brainSync, { userId: uid, body: {
      courses: [{ id: 1, name: "Bio" }, { id: 2, name: "Chem" }],
      assignments: [{ id: 9, courseId: 1, name: "Lab", dueAt: new Date(Date.now() + 86400000).toISOString(), submission: { missing: false } }],
    } });
    expect(res.statusCode).toBe(200);
    expect(res.body.kernelBridged).toBe(true);

    const pid = await resolveFschoolPerson(conn(), uid);
    const mems = await recall(store(), [`person:${pid}`], { kind: "signal", reinforce: false });
    expect(mems.some((m) => m.body?.event === "canvas_sync" && m.body?.courses === 2)).toBe(true);
  });
});

// @vitest-environment node
// LIVE endpoint e2e: /api/brain shared-scope authorization. Uses the trusted in-process path
// (harness invoke) against the product DB (brainConn falls back to product when NEURO_* is unset in
// the test runner). Proves: writing a shared scope needs membership (403 → 200), a member recalls
// the shared memory, a non-member does not.
import { describe, it, expect, afterAll } from "vitest";
import { LIVE, ns, store, conn, invoke, sql, cleanupTag } from "./e2e/brain-harness.ts";
import { addMember } from "../api/_brain/kernel.ts";
import { resolveFschoolPerson } from "../api/_brain/identity.ts";
import brain from "../api/brain.ts";

const N = ns("endshare");
const COURSE = `course:${N.tag}`;

async function wipe() {
  await cleanupTag(N.tag);
  await sql(`delete from public.neuro_memory where subject = '${COURSE}';`);
  await sql(`delete from public.neuro_membership where space = '${COURSE}';`);
}
afterAll(async () => { if (LIVE) await wipe(); });

describe.skipIf(!LIVE)("brain endpoint: shared-scope authorization (live)", () => {
  it("write-auth gates a shared scope; members read it, non-members don't", async () => {
    await wipe();
    const aId = await resolveFschoolPerson(conn(), N.localId("a"));
    const subjA = `person:${aId}`;

    // A is not a member → writing the course is refused.
    const r403 = await invoke(brain, { userId: N.localId("a"), query: { action: "remember" }, body: { kind: "signal", body: { x: 1 }, scope: COURSE } });
    expect(r403.statusCode).toBe(403);

    // Grant A writer → the write now succeeds.
    await addMember(store(), COURSE, subjA, "writer");
    const rOk = await invoke(brain, { userId: N.localId("a"), query: { action: "remember" }, body: { kind: "signal", body: { note: "shared" }, scope: COURSE } });
    expect(rOk.statusCode).toBe(200);
    expect(rOk.body?.ok).toBe(true);

    // A (member) recalls → sees the course memory.
    const aRecall = await invoke(brain, { userId: N.localId("a"), query: { action: "recall" }, body: { limit: 50 } });
    expect(aRecall.statusCode).toBe(200);
    expect(aRecall.body.memories.some((m: any) => m.subject === COURSE)).toBe(true);

    // B (not a member) recalls → does NOT see it.
    const bRecall = await invoke(brain, { userId: N.localId("b"), query: { action: "recall" }, body: { limit: 50 } });
    expect(bRecall.body.memories.some((m: any) => m.subject === COURSE)).toBe(false);
  });
});

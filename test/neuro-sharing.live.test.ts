// @vitest-environment node
// LIVE sharing e2e against the NeuroAGI project (neuroagi-v2): proves the PostgrestStore audience
// overlap query (or=/ov) and neuro_membership CRUD actually work against real PostgREST. Reads
// NEURO_SUPABASE_* from .env.local; skips when absent (CI). Namespaced + self-cleaning.
import { describe, it, expect, afterAll } from "vitest";
import { readFileSync } from "fs";
import { postgrestStore, remember, recall, readableScopes, canWrite, addMember, removeMember } from "../api/_brain/kernel.ts";

const env = (() => { try { return readFileSync(".env.local", "utf8"); } catch { return ""; } })();
const g = (k: string) => (env.match(new RegExp(`^${k}=(.+)$`, "m")) || [])[1]?.trim();
const URL_ = g("NEURO_SUPABASE_URL"), KEY = g("NEURO_SUPABASE_SERVICE_KEY");
const LIVE = !!(URL_ && KEY);

const TAG = "e2eshare";
const COURSE = `course:${TAG}`, ROOM = `room:${TAG}`;
const A = `person:${TAG}:a`, B = `person:${TAG}:b`, C = `person:${TAG}:c`;

async function cleanup() {
  if (!LIVE) return;
  const h = { apikey: KEY!, Authorization: `Bearer ${KEY}` };
  await fetch(`${URL_}/rest/v1/neuro_memory?subject=like.*${TAG}*`, { method: "DELETE", headers: h });
  await fetch(`${URL_}/rest/v1/neuro_memory?audience=ov.{"${A}","${B}","${C}"}`, { method: "DELETE", headers: h }).catch(() => {});
  await fetch(`${URL_}/rest/v1/neuro_membership?space=like.*${TAG}*`, { method: "DELETE", headers: h });
}
afterAll(cleanup);

describe.skipIf(!LIVE)("sharing (live, neuroagi-v2)", () => {
  it("membership CRUD + shared read + write-auth + directed audience, against real PostgREST", async () => {
    await cleanup();
    const s = postgrestStore(URL_!, KEY!);

    // A is a course reader, B a course writer.
    await addMember(s, COURSE, A, "reader");
    await addMember(s, COURSE, B, "writer");
    expect((await s.membersOf(COURSE)).map((m) => m.subject).sort()).toEqual([A, B].sort());
    expect((await readableScopes(s, A)).sort()).toEqual([A, COURSE].sort());

    // write-auth: writer B may write the course; reader A may not.
    expect(await canWrite(s, COURSE, B)).toBe(true);
    expect(await canWrite(s, COURSE, A)).toBe(false);

    // B writes a course memory; A (member) recalls it, C (non-member) does not.
    await remember(s, { subject: COURSE, kind: "signal", body: { note: `${TAG} shared` } });
    const aSees = await recall(s, await readableScopes(s, A), { reinforce: false });
    expect(aSees.some((m) => m.subject === COURSE)).toBe(true);
    const cSees = await recall(s, await readableScopes(s, C), { reinforce: false });
    expect(cSees.some((m) => m.subject === COURSE)).toBe(false);

    // directed audience share: A → B only (the or=/ov overlap query).
    await remember(s, { subject: A, kind: "signal", body: { dm: 1 }, audience: [B] });
    expect((await recall(s, [B], { reinforce: false })).some((m) => m.body?.dm === 1)).toBe(true);
    expect((await recall(s, [C], { reinforce: false })).some((m) => m.body?.dm === 1)).toBe(false);

    // revoke: A loses course read.
    await removeMember(s, COURSE, A);
    expect((await readableScopes(s, A))).toEqual([A]);
  });
});

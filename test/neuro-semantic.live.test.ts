// @vitest-environment node
// LIVE semantic recall against neuroagi-v2: proves the pgvector column + neuro_semantic_recall RPC
// return cosine nearest neighbours. Uses 1536-d one-hot vectors. Reads NEURO_* from .env.local.
import { describe, it, expect, afterAll } from "vitest";
import { readFileSync } from "fs";
import { postgrestStore, remember, semanticRecall } from "../api/_brain/kernel.ts";

const env = (() => { try { return readFileSync(".env.local", "utf8"); } catch { return ""; } })();
const g = (k: string) => (env.match(new RegExp(`^${k}=(.+)$`, "m")) || [])[1]?.trim();
const URL_ = g("NEURO_SUPABASE_URL"), KEY = g("NEURO_SUPABASE_SERVICE_KEY");
const LIVE = !!(URL_ && KEY);
const TAG = "e2esem", SUBJ = `person:${TAG}`;
const vec = (hot: number) => Array.from({ length: 1536 }, (_, i) => (i === hot ? 1 : 0));

async function cleanup() {
  if (!LIVE) return;
  await fetch(`${URL_}/rest/v1/neuro_memory?subject=like.*${TAG}*`, { method: "DELETE", headers: { apikey: KEY!, Authorization: `Bearer ${KEY}` } });
}
afterAll(cleanup);

describe.skipIf(!LIVE)("semantic recall (live neuroagi-v2 pgvector)", () => {
  it("returns the cosine-nearest memory first", async () => {
    await cleanup();
    const s = postgrestStore(URL_!, KEY!);
    await remember(s, { subject: SUBJ, kind: "signal", body: { t: "calc" }, embedding: vec(0) });
    await remember(s, { subject: SUBJ, kind: "signal", body: { t: "bio" }, embedding: vec(1) });
    await remember(s, { subject: SUBJ, kind: "signal", body: { t: "chem" }, embedding: vec(2) });
    const got = await semanticRecall(s, [SUBJ], vec(0), { limit: 2 });
    expect(got.length).toBeGreaterThanOrEqual(1);
    expect(got[0].body.t).toBe("calc"); // nearest to the query one-hot at dim 0
  });
});

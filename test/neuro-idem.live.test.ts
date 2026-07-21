// @vitest-environment node
// LIVE idempotency against neuroagi-v2: proves the PostgREST partial-index upsert on (subject, idem)
// dedups, and null-idem still appends. Reads NEURO_* from .env.local; skips when absent.
import { describe, it, expect, afterAll } from "vitest";
import { readFileSync } from "fs";
import { postgrestStore, remember, recall } from "../api/_brain/kernel.ts";

const env = (() => { try { return readFileSync(".env.local", "utf8"); } catch { return ""; } })();
const g = (k: string) => (env.match(new RegExp(`^${k}=(.+)$`, "m")) || [])[1]?.trim();
const URL_ = g("NEURO_SUPABASE_URL"), KEY = g("NEURO_SUPABASE_SERVICE_KEY");
const LIVE = !!(URL_ && KEY);
const TAG = "e2eidem", SUBJ = `person:${TAG}`;

async function cleanup() {
  if (!LIVE) return;
  await fetch(`${URL_}/rest/v1/neuro_memory?subject=like.*${TAG}*`, { method: "DELETE", headers: { apikey: KEY!, Authorization: `Bearer ${KEY}` } });
}
afterAll(cleanup);

describe.skipIf(!LIVE)("idempotency (live neuroagi-v2)", () => {
  it("upsert on (subject, idem) dedups; null idem still appends", async () => {
    await cleanup();
    const s = postgrestStore(URL_!, KEY!);
    await remember(s, { subject: SUBJ, kind: "signal", body: { v: 1 }, idem: "sess" });
    await remember(s, { subject: SUBJ, kind: "signal", body: { v: 2 }, idem: "sess" });
    let got = await recall(s, [SUBJ], { reinforce: false });
    expect(got.filter((m) => m.body?.v != null).length).toBe(1); // one idem'd row
    expect(got.find((m) => m.body?.v != null)?.body.v).toBe(2);   // latest wins
    await remember(s, { subject: SUBJ, kind: "signal", body: { plain: true } });
    await remember(s, { subject: SUBJ, kind: "signal", body: { plain: true } });
    got = await recall(s, [SUBJ], { reinforce: false });
    expect(got.length).toBe(3); // 1 idem'd + 2 plain appends
  });
});

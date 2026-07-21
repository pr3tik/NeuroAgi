// @vitest-environment node
// LIVE decay sweep against neuroagi-v2: proves the neuro_sweep_due RPC forgets the decayed set in
// SQL and leaves fresh memories. Reads NEURO_* from .env.local; skips when absent.
import { describe, it, expect, afterAll } from "vitest";
import { readFileSync } from "fs";
import { postgrestStore, remember, tickDecay, recall } from "../api/_brain/kernel.ts";

const env = (() => { try { return readFileSync(".env.local", "utf8"); } catch { return ""; } })();
const g = (k: string) => (env.match(new RegExp(`^${k}=(.+)$`, "m")) || [])[1]?.trim();
const URL_ = g("NEURO_SUPABASE_URL"), KEY = g("NEURO_SUPABASE_SERVICE_KEY");
const LIVE = !!(URL_ && KEY);
const TAG = "e2edecay", SUBJ = `person:${TAG}`;

async function cleanup() {
  if (!LIVE) return;
  await fetch(`${URL_}/rest/v1/neuro_memory?subject=like.*${TAG}*`, { method: "DELETE", headers: { apikey: KEY!, Authorization: `Bearer ${KEY}` } });
}
afterAll(cleanup);

describe.skipIf(!LIVE)("decay sweep (live neuroagi-v2 RPC)", () => {
  it("sweeps the decayed row, keeps the fresh one", async () => {
    await cleanup();
    const s = postgrestStore(URL_!, KEY!);
    const now = Date.now();
    await remember(s, { subject: SUBJ, kind: "signal", body: { old: true }, salience: 0.3 }, now - 60 * 86400000); // last_seen 60d ago → dead
    await remember(s, { subject: SUBJ, kind: "signal", body: { fresh: true }, salience: 1 }, now);
    const dead = await tickDecay(s, [SUBJ], now);
    expect(dead.length).toBeGreaterThanOrEqual(1);
    const live = await recall(s, [SUBJ], { now, reinforce: false });
    expect(live.some((m) => m.body?.fresh)).toBe(true);
    expect(live.some((m) => m.body?.old)).toBe(false);
  });
});

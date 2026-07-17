// @vitest-environment node
// LIVE integration test for PostgrestStore against the real neuro_memory table.
// Skipped unless NEURO_LIVE=1 and SUPABASE_URL/SUPABASE_SERVICE_KEY are set, so it never
// runs in CI (Node-20, no creds). Uses a dedicated self-test subject and hard-deletes its
// rows afterward so it leaves no residue in prod.
import { describe, it, expect, afterAll } from "vitest";
import { postgrestStore, remember, recall, forget } from "../api/_brain/kernel.ts";

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
const LIVE = process.env.NEURO_LIVE === "1" && !!URL && !!KEY;
const SUBJ = "person:selftest:pr1";
const DAY = 86_400_000;

async function hardDelete() {
  await fetch(`${URL}/rest/v1/neuro_memory?subject=eq.${encodeURIComponent(SUBJ)}`, {
    method: "DELETE",
    headers: { apikey: KEY!, Authorization: `Bearer ${KEY}`, Prefer: "return=minimal" },
  }).catch(() => {});
}

describe.skipIf(!LIVE)("PostgrestStore against live neuro_memory", () => {
  afterAll(hardDelete);

  it("remember → recall → decay-filter → forget round-trips through the real DB", async () => {
    await hardDelete(); // clean slate
    const s = postgrestStore(URL!, KEY!);
    const now = Date.now();

    const m = await remember(s, { subject: SUBJ, kind: "signal", body: { hello: "world" }, salience: 1 }, now);
    expect(m.id).toBeTruthy();

    const got = await recall(s, [SUBJ], { now, reinforce: false });
    expect(got.length).toBe(1);
    expect(got[0].body.hello).toBe("world");

    // A 90-day-old faint memory is below threshold → recall must exclude it.
    await remember(s, { subject: SUBJ, kind: "signal", body: { old: true }, salience: 0.2 }, now - 90 * DAY);
    const alive = await recall(s, [SUBJ], { now, reinforce: false });
    expect(alive.length).toBe(1);

    await forget(s, [m.id], now);
    expect((await recall(s, [SUBJ], { now, reinforce: false })).length).toBe(0);
  });
});

// @vitest-environment node
// LIVE (neuroagi-v2): runTraitPass mines a learning_pref trait from format signals and persists it;
// resolveLearningStyle returns the mined value over the static fallback. Reads NEURO_* from .env.local.
import { describe, it, expect, afterAll } from "vitest";
import { readFileSync } from "fs";
import { postgrestStore, remember } from "../api/_brain/kernel.ts";
import { runTraitPass, resolveLearningStyle } from "../api/_brain/traits.ts";

const env = (() => { try { return readFileSync(".env.local", "utf8"); } catch { return ""; } })();
const g = (k: string) => (env.match(new RegExp(`^${k}=(.+)$`, "m")) || [])[1]?.trim();
const URL_ = g("NEURO_SUPABASE_URL"), KEY = g("NEURO_SUPABASE_SERVICE_KEY");
const LIVE = !!(URL_ && KEY);
const TAG = "e2els", SUBJ = `person:${TAG}`;

async function cleanup() {
  if (!LIVE) return;
  await fetch(`${URL_}/rest/v1/neuro_memory?subject=like.*${TAG}*`, { method: "DELETE", headers: { apikey: KEY!, Authorization: `Bearer ${KEY}` } });
}
afterAll(cleanup);

describe.skipIf(!LIVE)("learning-style mined trait (live neuroagi-v2)", () => {
  it("mines + persists learning_pref; resolveLearningStyle prefers it over the static fallback", async () => {
    await cleanup();
    const s = postgrestStore(URL_!, KEY!);
    expect(await resolveLearningStyle(s, SUBJ, "diagram")).toBe("diagram"); // nothing learned yet
    for (let i = 0; i < 4; i++) await remember(s, { subject: SUBJ, kind: "signal", body: { format: "problem", helpful: true } });
    const traits = await runTraitPass(s, SUBJ);
    expect(traits.some((t) => t.key === "learning_pref" && t.format === "problem")).toBe(true);
    expect(await resolveLearningStyle(s, SUBJ, "diagram")).toBe("problem");
  });
});

// @vitest-environment node
// LIVE test for the capability registry against neuro_capability. Skipped unless NEURO_LIVE=1.
// Proves register → get and idempotent merge-update. Cleans up its row.
import { describe, it, expect, afterAll } from "vitest";
import { registerCapability, getCapability } from "../api/_brain/bus.ts";

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
const LIVE = process.env.NEURO_LIVE === "1" && !!URL && !!KEY;
const NAME = "selftest-cap";

async function cleanup() {
  await fetch(`${URL}/rest/v1/neuro_capability?name=eq.${NAME}`, {
    method: "DELETE", headers: { apikey: KEY!, Authorization: `Bearer ${KEY}`, Prefer: "return=minimal" },
  }).catch(() => {});
}

describe.skipIf(!LIVE)("capability registry", () => {
  afterAll(cleanup);

  it("register → get, then idempotent merge-update", async () => {
    await cleanup();
    const conn = { url: URL!, key: KEY! };
    await registerCapability(conn, { name: NAME, kind: "http", endpoint: "https://x/api", manifest: { actions: { a: {} } } });
    let cap = await getCapability(conn, NAME);
    expect(cap?.endpoint).toBe("https://x/api");
    await registerCapability(conn, { name: NAME, kind: "http", endpoint: "https://y/api", manifest: {} });
    cap = await getCapability(conn, NAME);
    expect(cap?.endpoint).toBe("https://y/api"); // merged, not duplicated
  });
});

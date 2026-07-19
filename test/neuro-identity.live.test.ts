// @vitest-environment node
// LIVE integration test for the global identity resolver (api/_brain/identity.ts) against the real
// neuro_person / neuro_person_link tables. Skipped unless NEURO_LIVE=1 + creds. Proves the two
// load-bearing invariants: idempotency (link fast path) and cross-product merge by email (one
// person, one brain across products). Cleans up via ON DELETE CASCADE on neuro_person.
import { describe, it, expect, afterAll } from "vitest";
import { resolvePersonId } from "../api/_brain/identity.ts";

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
const LIVE = process.env.NEURO_LIVE === "1" && !!URL && !!KEY;
const EMAIL = "selftest.pr2@neuro.invalid";

async function cleanup() {
  const auth = { apikey: KEY!, Authorization: `Bearer ${KEY}` };
  const r = await fetch(`${URL}/rest/v1/neuro_person?email=eq.${encodeURIComponent(EMAIL)}&select=id`, { headers: auth }).catch(() => null);
  if (r && r.ok) {
    for (const p of await r.json()) {
      // cascade deletes the person's links too
      await fetch(`${URL}/rest/v1/neuro_person?id=eq.${p.id}`, { method: "DELETE", headers: { ...auth, Prefer: "return=minimal" } }).catch(() => {});
    }
  }
}

describe.skipIf(!LIVE)("global identity resolver", () => {
  afterAll(cleanup);

  it("is idempotent and merges one email across products into one brain", async () => {
    await cleanup();
    const conn = { url: URL!, key: KEY! };

    const a1 = await resolvePersonId(conn, { product: "selftestA", localId: "u1", email: EMAIL, name: "Self Test" });
    expect(a1).toBeTruthy();

    // Same (product, localId) again → link fast path, same id, no email needed.
    const a2 = await resolvePersonId(conn, { product: "selftestA", localId: "u1" });
    expect(a2).toBe(a1);

    // DIFFERENT product, SAME email → the SAME person. One person, one brain across products.
    const b1 = await resolvePersonId(conn, { product: "selftestB", localId: "v1", email: EMAIL });
    expect(b1).toBe(a1);

    // MIXED-CASE variant of the same email → still the SAME person (regression: used to return null).
    const c1 = await resolvePersonId(conn, { product: "selftestC", localId: "w1", email: EMAIL.toUpperCase() });
    expect(c1).toBe(a1);
  });
});

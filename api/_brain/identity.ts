// api/_brain/identity.ts
// The "one person, one brain across products" spine. Resolves a product's LOCAL user id to the
// GLOBAL NeuroAGI person id (neuro_person), creating the person + a neuro_person_link on first
// sight and merging by email so the same human seen from two different child products collapses
// to a single brain. Raw PostgREST fetch with the service key — no supabase-js at import.

const DEFAULT_PRODUCT = "fschoolai";

type Conn = { url: string; key: string };
function headers(key: string, extra?: Record<string, string>) {
  return { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(extra || {}) };
}
const rest = (url: string) => url.replace(/\/+$/, "") + "/rest/v1";

/**
 * Global neuro_person id for (product, localId). Fast path: an existing link. Otherwise find a
 * person by email (cross-product merge) or create one, then record the link. Returns null only if
 * a person can neither be found nor created.
 */
export async function resolvePersonId(
  { url, key }: Conn,
  opts: { product?: string; localId: string; email?: string | null; name?: string | null; metadata?: any },
): Promise<string | null> {
  const product = opts.product ?? DEFAULT_PRODUCT;
  const base = rest(url);
  const email = opts.email?.trim() || null;

  // 1. Existing link → done (no email needed).
  const linkRes = await fetch(
    `${base}/neuro_person_link?product=eq.${encodeURIComponent(product)}&local_id=eq.${encodeURIComponent(opts.localId)}&select=person_id&limit=1`,
    { headers: headers(key) },
  );
  if (linkRes.ok) {
    const rows = await linkRes.json();
    if (rows?.[0]?.person_id) return rows[0].person_id;
  }

  // 2. Find the person by email (merges the same human across products), else create.
  let personId: string | null = null;
  const findByEmail = async (): Promise<string | null> => {
    if (!email) return null;
    const r = await fetch(`${base}/neuro_person?email=eq.${encodeURIComponent(email)}&select=id&limit=1`, { headers: headers(key) });
    if (!r.ok) return null;
    const rows = await r.json();
    return rows?.[0]?.id ?? null;
  };

  personId = await findByEmail();
  if (!personId) {
    const cr = await fetch(`${base}/neuro_person`, {
      method: "POST",
      headers: headers(key, { Prefer: "return=representation" }),
      body: JSON.stringify({ name: opts.name ?? null, email, metadata: opts.metadata ?? {} }),
    });
    if (cr.ok) {
      const rows = await cr.json();
      personId = Array.isArray(rows) ? rows[0]?.id : rows?.id;
    } else {
      // Likely a unique-email race — re-read.
      personId = await findByEmail();
    }
  }
  if (!personId) return null;

  // 3. Record the link (idempotent; the (product, local_id) PK makes a re-run a no-op).
  await fetch(`${base}/neuro_person_link`, {
    method: "POST",
    headers: headers(key, { Prefer: "resolution=ignore-duplicates,return=minimal" }),
    body: JSON.stringify({ product, local_id: opts.localId, person_id: personId }),
  }).catch(() => {});

  return personId;
}

/**
 * FschoolAI convenience: resolve the caller's global person id, sourcing email/name from the users
 * row when a person must be created, and backfilling users.brain_person_id so the rest of the
 * product (and analytics) see the link. This is what dissolves the 0/140 gap — each user is linked
 * the first time they touch the brain.
 */
export async function resolveFschoolPerson({ url, key }: Conn, userId: string): Promise<string | null> {
  const base = rest(url);
  // users.id is TEXT; NOTE the row has no created_at column (selecting it 42703's — see brain-person-link).
  const ur = await fetch(
    `${base}/users?id=eq.${encodeURIComponent(userId)}&select=email,name,school,gpa,brain_person_id&limit=1`,
    { headers: headers(key) },
  );
  const user = ur.ok ? (await ur.json())?.[0] : null;

  const personId = await resolvePersonId(
    { url, key },
    { localId: userId, email: user?.email ?? null, name: user?.name ?? null, metadata: { school: user?.school ?? null, gpa: user?.gpa ?? null } },
  );
  if (!personId) return null;

  if (user && user.brain_person_id !== personId) {
    await fetch(`${base}/users?id=eq.${encodeURIComponent(userId)}`, {
      method: "PATCH",
      headers: headers(key, { Prefer: "return=minimal" }),
      body: JSON.stringify({ brain_person_id: personId }),
    }).catch(() => {});
  }
  return personId;
}

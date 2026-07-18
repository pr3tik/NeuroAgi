# F-5 · Brain DB write key bundled into the client · **P0 (pending Vercel confirmation)**

**Found:** 2026-07-18 (reported by a teammate; verified against code here). **Owner:** Vivek.
**Status:** OPEN — code path confirmed; severity hinges on one Vercel env value (see "The one check").

---

## Finding

`src/api/canvasSync.ts` contains `syncToBrainDB(...)` (`:797`), which runs **in the browser**
(it uses `import.meta.env` and the browser `supabase` client, and is reached via
`AppContext.tsx`). It reads:

```ts
const brainKey = import.meta.env?.VITE_BRAIN_SUPABASE_KEY;   // canvasSync.ts:799
```

The **`VITE_` prefix means Vite inlines this value into the client JS bundle** — whatever it is
ships to every visitor's browser. The code then uses it as both `apikey` and
`Authorization: Bearer` (`:814-819`) to **directly POST** person-scoped rows to
`fschool_courses` (`:836`) and `fschool_assignments` (`:864`) in the NeuroAGI Brain DB.

### Why this is (potentially) critical
If `VITE_BRAIN_SUPABASE_KEY` holds the **Brain DB `service_role` key**, then that key is sitting
in plaintext in every browser bundle. Anyone can open devtools, extract it, and gain **full
read/write access to the entire Brain DB — every student's person-scoped brain data (stress
levels, momentum, deadlines, courses, assignments) — bypassing RLS entirely.** The service key
bypasses row-level security by design, so a leaked service key is a total-compromise credential,
not a scoped one.

### The evidence that it's likely the service key (the "tell")
1. **A separate, non-anon-named var exists.** `src/api/brain.ts` — which documents itself as
   *"the ONLY place the frontend talks to the brain DB"* and *"The frontend NEVER writes directly
   to brain.\* tables"* (`:6-9`) — uses an explicitly-named **`VITE_BRAIN_SUPABASE_ANON_KEY`**
   (`:25`) for its (read-only) client. `canvasSync.ts` instead uses a **different** var,
   `VITE_BRAIN_SUPABASE_KEY` (no `ANON`).
2. **The write-path violates the documented contract.** `brain.ts` says the frontend never writes
   directly; `canvasSync.ts` does exactly that.
3. **`api/brain-scheduler.ts:15`** documents the non-`VITE_` server var `BRAIN_SUPABASE_KEY` as the
   *"Brain DB service_role key."* A `VITE_`-prefixed sibling used for **writes** most plausibly
   holds the same elevated key — because if the anon key + RLS permitted these writes, whoever wrote
   this would have reused the existing `VITE_BRAIN_SUPABASE_ANON_KEY`. Needing a different key
   implies they needed to get *past* RLS, i.e. service-role.

Circumstantially this leans **service key**. **Treat as P0 until proven otherwise.**

### What is NOT verifiable from the repo
The Brain env vars are **not** in local `.env.local` (only the product `SUPABASE_*` /
`VITE_SUPABASE_*` keys are). `VITE_BRAIN_SUPABASE_KEY` is set in **Vercel production**, which can't
be read from the codebase. So the actual value — service vs anon — must be confirmed in Vercel.

---

## The one check that sets severity
Vercel → Project → Settings → Environment Variables → open **`VITE_BRAIN_SUPABASE_KEY`**:

| Value looks like | Severity | Meaning |
|---|---|---|
| `sb_secret_…`, or a JWT whose payload has `"role":"service_role"` | 🔴 **P0 — live breach** | Brain service key is in every browser bundle → full Brain DB r/w to anyone, RLS bypassed. |
| `sb_publishable_…`, or a JWT with `"role":"anon"` | 🟠 **Downgrade** | Shipping a Brain *anon* key is by-design (brain.ts already does), but a direct client write is still architecturally wrong; must confirm `fschool_*` tables have RLS or anon can still write arbitrary `person_id` rows. |

(To decode a JWT role without exposing the secret: take the middle `.`-segment, base64-decode it,
read the `role` claim. The signature — the third segment — is the secret part, not the payload.)

---

## Fix

### If it is the service key (P0) — do in order:
1. **Rotate the Brain DB `service_role` key** in the Brain Supabase project immediately. It has been
   shipping in the public bundle → it is compromised. ⚠️ Rotating breaks `api/brain-scheduler.ts`
   and everything server-side using `BRAIN_SUPABASE_KEY` until the **new** key is pasted into Vercel
   — coordinate that swap so the scheduler doesn't go dark.
2. **Move the write server-side.** Add a Vercel `api/` endpoint (e.g. `api/brain-sync.ts`) that runs
   the `syncToBrainDB` logic using `process.env.BRAIN_SUPABASE_KEY` (server-only, never `VITE_`).
   The client calls that endpoint after a Canvas sync instead of writing to the Brain DB directly.
   This matches how the entire rest of the app keeps the service key off the client.
   - *Quick-but-inferior alternative:* switch `canvasSync.ts` to `VITE_BRAIN_SUPABASE_ANON_KEY` and
     add owner-scoped RLS policies to `fschool_courses` / `fschool_assignments`. Still leaves a
     cross-DB direct client write, which the architecture explicitly forbids — prefer the endpoint.
3. **Delete `VITE_BRAIN_SUPABASE_KEY` from Vercel** once no code references it, so it stops being
   bundled on the next deploy.
4. Optionally audit the Brain DB for rows whose `person_id` doesn't belong to the writing user
   (evidence of abuse). Likely none yet if undiscovered externally — but rotation is mandatory
   regardless, because the key must now be treated as public.

### General rule this reinforces (applies to the mobile app too)
**Clients — web *and* mobile — get the publishable/anon key only.** Any privileged write goes
through a server (`api/*`) endpoint. Mobile bundles are decompilable, so embedding a `sb_secret_`
key in the mobile app is the identical failure mode as this `VITE_` bundling. This is the same
lesson as F-4 (Canvas token off the client): **secrets never reach a client.**

---

## Verification before/after
- **Before:** in a production build, grep the bundled JS for the Brain key value / project ref — it
  will be present. After the fix + `VITE_BRAIN_SUPABASE_KEY` removal + redeploy, it must be absent.
- **After:** Canvas sync still lands course/assignment rows in the Brain DB — now via the server
  endpoint (using `process.env.BRAIN_SUPABASE_KEY`), with the client holding no Brain write key.
- Confirm `brain-scheduler.ts` still runs against the **rotated** key.

## Related
- **F-4** — Canvas access token round-trips to the browser (same class: high-value credential on the
  client). F-5 is more severe if confirmed, because a service key bypasses RLS for *all* users, not
  just one.

# A1 — person_id ↔ user_id bridge (PRD §17.1 Gap 1): VERDICT

**Author:** Siddharth (Brain workstream) · **Date:** 18 Jul 2026 · **Branch:** `feat/studyroom-session-jobs`
**For:** Vivek, Ryan Lin. Complements `STUDYROOM_ARCHITECTURE.md` §9.4/§9.5 (do not edit the frozen contract).

## Verdict

**Gap 1 is CLOSED in code and schema.** The bridge is real, single-DB, and **survives the new auth.**
The PRD's fear ("every chat loads the wrong brain context or fails") was written against the
never-provisioned two-DB Brain design; the shipped design is a single-DB kernel reached with the
service key. No fix required. One **latent edge** is noted below (emailless account merge) — low
risk, not blocking.

## Traced path (evidence, file:line)

1. **JWT → userId (public.users.id).** `api/_auth.ts:34-66` `requireUser()`: verifies the bearer
   token via GoTrue (`sb.auth.getUser`, `:44`), maps `auth_id → users.id` (`:47`), and **self-heals
   legacy accounts** by linking an unlinked `users` row via the JWT's verified email (`:55-62`).
   Returns `userId = public.users.id` (TEXT). This is the only identity every enforced endpoint trusts.

2. **userId → personId (global neuro_person).** `api/_brain/identity.ts:83-106`
   `resolveFschoolPerson()` → `resolvePersonId()` (`:20-75`):
   - fast path: `neuro_person_link (product='fschoolai', local_id=userId) → person_id` (`:31-38`);
   - else merge-by-email into an existing `neuro_person`, else create one (`:42-64`);
   - records the link (`:68-72`) and backfills `users.brain_person_id` (`:98-104`).

3. **personId → brain context.** Subject is always `` `person:${personId}` `` derived server-side —
   `api/brain-signal.ts:32-42` (write), `api/brain.ts` recall (per §9.4, subject never read from body).
   Kernel store = `postgrestStore` over `public.neuro_memory` (`api/_brain/kernel.ts:209-276`).

4. **Schema is provisioned.** `supabase-neuro-kernel-migration.sql:11/29/40` create
   `neuro_memory` / `neuro_person` / `neuro_person_link` (all RLS-on, deny-all to client keys;
   service role bypasses). `users.brain_person_id` at `supabase.sql:354`.

## Does it survive the new auth? YES — and here is *why*, precisely

The bridge keys off `userId = public.users.id`, which is exactly what the post-change `requireUser()`
returns. New authed users resolve on first brain touch (person + link created on sight). Legacy
users self-heal via the `_auth.ts:55-62` email link. **No brain read depends on any pre-auth id.**

### Latent edge (documented, not blocking)

`neuro_person_link.local_id` has **no FK** to `public.users`
(`supabase-neuro-kernel-migration.sql:40-46`), so `merge_user_ids()`
(`supabase-identity-merge.sql`) — which re-keys only FK-discovered children — does **not** re-key the
brain link on a guest→authed merge. It still resolves correctly **because** `resolvePersonId` merges
by email (`identity.ts:42-50`): the canonical user's email re-finds the same `neuro_person`, and a
fresh link is written. The orphaned `(fschoolai, old_id)` link is harmless.

**The only way this splits a brain:** a merged account with **no email** on its `users` row — then the
email fallback returns null and a second `neuro_person` is created. Authed users always carry an email
(GoTrue requires it), so the authed path is safe. If guest-merge ever needs brain continuity, add
`neuro_person_link` re-keying to `merge_user_ids` (re-point `local_id = p_old → p_new`, ignore-dup).

## What could NOT be verified here (needs live env)

Empirical end-to-end trace of one real user requires Supabase credentials (`SUPABASE_URL`,
`SUPABASE_SERVICE_KEY`) which are **absent from this checkout**. The verdict above is a
static/code+schema proof; a one-user live trace should confirm it once env is provisioned.
Static baseline at time of writing: `tsc --noEmit` clean, `vitest run` 684 passed / 7 skipped.

# F-1 fix proposal — authenticate the extension sync path

Owner: Vivek. Addresses SEC-01 F-1 (`SECURITY-REVIEW-2026-07-17.md`). **Proposal — not merged.**
This is a two-sided, rollout-gated change; it needs a go on the rollout strategy (§4) before code
ships, because getting it wrong breaks Canvas sync for existing users.

## The gap (one sentence)

`api/extension-content` (and its siblings `extension-sync`, `lms-ingest`) write into shared /
per-user tables with **no caller verification** — the extension sends no token and the server checks
none — so anyone on the internet can write into `course_content`, which every student's tutor reads.

## Why it's two-sided, not one line

| Side | Today | Needs |
|---|---|---|
| **Extension** (`chrome-extension/background.js:841`) | sends `Content-Type` + `userId` in body; **no `Authorization`** | attach `Authorization: Bearer <access_token>` on every sync call |
| **Server** (`api/extension-content.ts`, `extension-sync.ts`, `lms-ingest.ts`) | reads `userId` from body, presence-check only | verify the token → derive the real user → **ignore** the body `userId` |

The token already exists: the popup logs in via Supabase (`extension/popup/popup.js:57`) and holds a
real `access_token`. Nothing new to invent — the extension just has to *send* it, and the server has
to *check* it. `requireUserOr401` (`api/_auth.ts`) already verifies exactly this kind of Supabase JWT
and is the same guard the 26 enforced endpoints use.

## The catch — rollout (this is the real decision)

The moment the server *requires* the token, **every user still running the current extension breaks**
— their sync sends no token → 401 → Canvas sync silently stops. Options:

1. **Grace period (recommended).** Ship the extension update that sends the token first. Server
   *accepts either* (token → verified user; no token → today's behavior) for N days, logging which
   path each call took. When the logs show ~all traffic is tokened, flip the server to require it.
2. **Version gate.** Extension sends its version; server requires a token only for versions ≥ the
   tokened build. Cleaner telemetry, more code.
3. **Hard cut.** Require immediately, force-update the extension. Fastest, breaks anyone who doesn't
   update in time. Only acceptable if the install base is tiny and reachable.

**This choice is not mine to make unilaterally** — it depends on how many users are on the extension
and how they update. It is the one thing to settle with the owner before writing the server side.

## Do-it-yourself plan (the steps, in order)

1. **Scope the blast radius.** Confirm every endpoint the extension calls unauthenticated. Start:
   `grep -rn "/api/extension\|/api/lms-ingest\|/api/rag" chrome-extension/ extension/`. `extension-sync`
   is confirmed (`background.js:841`); check whether `extension-content` is called directly or only via
   `extension-sync`'s `upsert_course_content` action, and whether `lms-ingest`/`rag` are also exposed.
2. **Pick the rollout** (§4) with the owner. Everything below assumes option 1 (grace period).
3. **Extension side** — in `background.js`, attach the stored `access_token` as
   `Authorization: Bearer <token>` on the sync `fetch`. Handle token refresh/expiry (the popup already
   has `refresh_token` — reuse its refresh path). Bump the extension version.
4. **Server side** — in each endpoint, at the top: try `requireUserOr401`; if a valid token is
   present, use its user id and **ignore** the body `userId`. During the grace period, if no token is
   present, fall through to today's behavior **and log it** (`console.log` a `no-token` counter) so
   you can measure the migration.
5. **The isolation piece** (this is the part that's yours as Brain lead, not just an auth chore):
   once the caller is verified, `extension-content` still writes into a **shared** store. Verifying
   *who* wrote it does not stop them writing a *student fact* into `course_content`. So this fix closes
   the "anonymous stranger" hole; **BR-06 must still prove that even an authenticated caller's write is
   a course fact, not a person fact.** F-1 and BR-06 are related but not the same gate.
6. **Test.** You can't test the extension locally (no dev proxy; `extension-content` 404s under
   `npm run dev`). Load the unpacked extension in Chrome against staging, run a real Canvas sync, and
   confirm: tokened call → verified + written; no-token call → logged; forged `userId` in body →
   ignored. Do **not** test the require-token flip against prod until the grace-period logs are clean.
7. **Flip.** When logs show ~all sync traffic carries a token, change the server from "accept either"
   to "require token." Update `API-SECURITY.md`: move these endpoints out of "Deliberately NOT
   enforced" into "Enforced," and close SEC-01 F-1.

## Acceptance

- Extension sync calls carry a verified Supabase token; server derives the user from it, never the body.
- A body `userId` that disagrees with the token is ignored (no IDOR).
- No token during the grace period is logged; after the flip, no token → 401.
- `API-SECURITY.md` updated; SEC-01 F-1 closed; BR-06 still owns the course-fact-vs-student-fact proof.

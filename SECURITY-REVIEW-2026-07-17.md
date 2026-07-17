# Security review — 2026-07-17 (SEC-01)

Owner: Vivek. Companion audit to `API-SECURITY.md` (Ryan's posture doc) — this file does not
change that contract, it **checks its claims against the code as of `frontend/dev`** and records
where they diverge. Every finding below was verified today: code read at `file:line`, and where
noted, probed against production.

Method note: `API-SECURITY.md` is the source of truth for *intended* posture. A finding here is a
place where the *implemented* posture is weaker than the documented one — the same doc-vs-code
drift class that has already cost this repo real outages (join-by-code, 2026-07-14).

---

## Findings

### F-1 · `extension-content` verifies no auth token — the documented mitigation does not exist · **P0**

**Doc claims** (`API-SECURITY.md`, "Deliberately NOT enforced"): `extension-content` is acceptable
without a web JWT because "the Chrome extension authenticates with its **own paired token**." The
residual-risk column already flags "needs an extension-token verification pass (separate effort)."

**Code says** (`api/extension-content.ts`): no token is verified. Line 91 only *allows* the
`Authorization` header via CORS (`Access-Control-Allow-Headers`); nothing reads or checks it. There
is no `requireUserOr401`, no paired-token check, no HMAC. `userId` is taken from the body and
presence-checked only (`:110`); `text` is inserted verbatim into `course_content` (`:173-189`).

**The mitigation isn't even sent, let alone checked.** The extension's own sync caller
(`chrome-extension/background.js:841-844`) attaches only `Content-Type: application/json` and puts
`userId` in the body — **no `Authorization` header at all** — even though the extension *has* a real
Supabase `access_token` from its popup login (`extension/popup/popup.js:57`). The old pairing
endpoint `api/extension-auth.ts` is now a `410 Gone` tombstone directing users to "sign in via the
popup (Supabase Auth)." So the intended token exists and is obtainable, but the client never sends
it and the server never checks it. The "paired token" mitigation is absent on **both** sides.

**Verified against production 2026-07-17:** `POST /api/extension-content` with body `{}` → **400**
(`userId required`). The authed writer to the same table, `university-brain.ts`, returns **401** on
the same probe. 400-not-401 confirms nothing authenticates the caller.

**Why this is P0 and not just an extension-auth gap.** `course_content` is a **cross-account shared
store** — `Study.tsx:826` reads it into every student-in-the-course's tutor prompt under the header
"COURSE LIBRARY (shared content from all students in this course)." So an unauthenticated write here
is:
1. The reverse write path that **BR-01 §9.4 requires to be absent** — person data reaching a shared
   subject. A caller can post `{contentType:"lecture", text:"<student X> finds the Krebs cycle hard"}`
   and it lands in every classmate's tutor context. This is §9.2's *catastrophic* row, reachable today.
2. A prompt-injection surface into other students' tutor context.
3. Uncontrolled pollution of the shared library.

The `content_type` CHECK constraint blocks the *labels* `inbox`/`grade`/`submission`, not the
*content* — `lecture`, `file`, `module` accept arbitrary text. The CHECK is not an isolation boundary.

**Fix** (own PR, needs the extension flow traced end-to-end so it doesn't break Canvas sync): verify
the extension's paired token before the insert, matching the "separate effort" the doc already names.
Track as the closure for BR-01 §9.4 row 3 and a precondition for the BR-06 isolation proof.

---

### F-2 · `route-intent` calls the paid gateway with no rate limit — documented as rate-limited · **P1**

**Doc claims** (`API-SECURITY.md`): `route-intent` is listed with `claude`, `groq`, `tts`, `stt`,
`summarize` as public/stateless, with "Cost/abuse handled by rate limiting (the LLM ones)."

**Code says:** of those six, five call `rateLimit(...)`. `route-intent.ts` does not — 0 calls. It
imports `callModel` (`:6`) and invokes the paid gateway (`:35`) with no throttle and no auth.

**Verified against production 2026-07-17:** `POST /api/route-intent` with `{}` → **400** (no auth
layer; sailed to body validation).

**Impact:** an unauthenticated, unthrottled endpoint that spends on the Anthropic/Groq key — the
PRD §17.4 "denial-of-wallet / open LLM proxy" P0 class, for this one endpoint. Lower severity than
F-1 (no data boundary crossed), but it is the single endpoint in its documented group where the
stated mitigation is absent.

**Fix** (one line, low risk): add `rateLimit(req, res, "route-intent", { anonMax, authMax })`,
matching `claude.ts:18`.

---

### F-3 · Anon rate-limit bucket keys on a client-controlled header — **UNCONFIRMED, needs a controlled probe**

**Code** (`api/_ratelimit.ts:16-20`): the anon bucket keys on `clientIp()`, which returns the
**first** comma-separated entry of `X-Forwarded-For` — the client-supplied end of the chain. If an
attacker can prepend an arbitrary XFF value that survives to the handler, they get a fresh bucket per
request, defeating the `anonMax` limit that F-2's fix (and `claude.ts`) rely on as the *only* guard.

**Not yet confirmed.** Exploitability depends entirely on how Vercel's edge handles a client-supplied
`X-Forwarded-For` (append-real-IP vs. pass-through). This has **not** been tested — doing so safely
needs a controlled request against a non-prod target, not hammering production.

**Next step:** confirm Vercel's XFF handling in staging. If it passes the client value through, every
anon rate limit in the app (including the F-2 fix) is bypassable, and the keying must move to a
trusted source (`x-real-ip` / Vercel's `x-vercel-forwarded-for`, or `ipOnly` keyed server-side).

---

## Confirmed accurate in `API-SECURITY.md` (spot-checks, 2026-07-17)

Not everything drifted — the doc is mostly right, and the review says so:

- **`daily-room`** — doc says now membership-checked (was fully unauthenticated). **Confirmed:**
  `requireUserOr401` (`:41`) + joined-member check (`:53`); prod probe with no auth → **401**. This
  is **SEC-02, closed** — the finding was real (pre-`4656c89`) and is fixed (PR #214). Evidence:
  commit `4656c89`, live 401.
- **`university-brain`** — doc lists it enforced. **Confirmed:** `requireUserOr401` + server-side
  `userId` override (`:168-169`); prod probe → **401**.
- **`api/brain.ts`** (person kernel) — subject derived from the verified session, never the body
  (`:38-43`); ownership-guarded `forget`/`reinforce`. Matches BR-01 §9.4.

---

## Disposition

| # | Endpoint | Severity | State | Fix owner |
|---|---|---|---|---|
| F-1 | `extension-content` | P0 | open — mitigation absent | own PR (extension-token pass); closes BR-01 §9.4 row 3 |
| F-2 | `route-intent` | P1 | open — one-line fix | own PR |
| F-3 | XFF rate-limit key | P1? | unconfirmed | verify in staging first |
| SEC-02 | `daily-room` | — | **closed** (`4656c89`) | — |

F-1 is the priority: it is the live half of the BR-01 isolation gate, not merely an extension-auth
to-do. It should close before any BR-03/BR-05 grounding work exposes `course_content` further.

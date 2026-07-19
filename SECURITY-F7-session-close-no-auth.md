# F-7 · `session-close.ts` has no authentication — unauthenticated cross-user brain write · **P1**

**Found:** 2026-07-18 (surfaced by the new `test/session-close.test.ts` while pinning current
behavior). **Owner:** Vivek. **Status:** OPEN — NOT auto-fixed (adding auth interacts with the
`sendBeacon` call path; needs care — see below).

### F-7 · `api/session-close.ts` trusts `body.userId` with no session check · **P1**

`api/session-close.ts` never imports `./_auth.js` and never calls `requireUserOr401`. It reads
`userId` straight from the request body and uses it — with the **service key** (which bypasses RLS) —
to:
- overwrite that user's `tutor_mind` living-mind document (`upsert` to `/rest/v1/tutor_mind`), and
- emit `brain.signals` + `brain.context_window` writes attributed to them (when the Brain DB is
  configured).

**Why it matters — broken access control (OWASP A01).** Every sibling brain endpoint gates on the
verified session and explicitly *"never trusts body.userId"* — e.g. `tutor-context.ts` and
`agent-manager.ts` both do `const uid = await requireUserOr401(req, res); if (!uid) return;` and then
use the verified id. `session-close.ts` does not. So **any unauthenticated caller can POST an arbitrary
`userId`** and:
- **corrupt/poison another student's living mind** (the `tutor_mind` doc that grounds their tutor), and
- inject brain signals/context in their name.

It's a cross-user **write/integrity** abuse (not data exfiltration), server-side, RLS-bypassing. Blast
radius: any user's brain state can be tampered with by anyone who can reach the endpoint. Rating **P1**
because it's an active, unauthenticated, cross-user write — adjust down to P2 if you judge the impact
(brain-state corruption vs. data theft) as lower.

**Fix — add the same auth gate the sibling endpoints use.**
```ts
import { requireUserOr401 } from "./_auth.js";
// ...at the top of the handler, before reading userId:
const uid = await requireUserOr401(req, res);
if (!uid) return;                 // 401 already sent
// then use `uid` for ALL reads/writes; ignore body.userId entirely.
```

**⚠️ Why this is NOT auto-applied (the caveat).** `session-close` is fired at **session end**, and the
code has a `sendBeacon` path (it parses a `text/plain` string body — the shape `navigator.sendBeacon`
sends on page unload). **`sendBeacon` requests may not carry the auth header/cookie** the way a normal
`fetch` does, so naively adding `requireUserOr401` could make session-close **401 on the beacon path
and silently stop closing sessions**. Before shipping the fix, confirm how the client calls this:
- If it's a normal authenticated `fetch` → the fix is safe as-is.
- If it uses `sendBeacon` (or an unauthenticated unload path) → either switch the client to an
  authenticated `fetch` with `keepalive: true`, or pass+verify a short-lived signed token in the beacon
  body. Don't just bolt on `requireUserOr401` without checking, or you'll break session close.

**Verification.**
- Before: `POST /api/session-close` with `{ userId: "<someone-else>", messages: [...] }` and **no
  session** succeeds and writes their `tutor_mind`.
- After: the same unauthenticated request returns `401`; a properly authenticated session-end still
  closes (verify the real client path — fetch vs beacon — still works).

## Related
- Same class as **SEC-01/SEC-02** (auth on server endpoints). Complements the brain-data-handling
  findings (F-5). The test that found it (`test/session-close.test.ts`) pins the *current* (vulnerable)
  behavior — update that test's expectations when the auth gate lands.

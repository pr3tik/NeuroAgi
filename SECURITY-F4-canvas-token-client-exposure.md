# F-4 · Canvas access token round-trips to the browser · **P2**

**Found:** 2026-07-18 (follow-on to SEC-01). **Owner:** Vivek. **Status:** OPEN — hardening, not an active breach.

### F-4 · A sensitive, full-scope Canvas credential lives client-side · **P2**

The Canvas personal access token is used correctly *server-side* — `canvasCreds` reads it with the
**service key** and all Canvas API calls run from the backend (`api/_reggie/canvasLive.ts:14-27`).
The problem is that the same token **also round-trips to the browser**:

- `src/context/AppContext.tsx:207` and `:326` — `if (user.canvas_token) setCanvasToken(user.canvas_token)`
  read the raw token out of the loaded user row into **client state**.
- `src/context/AppContext.tsx:361` writes it back (`{ ..., canvas_token: token, ... }`).
- The client loads its own `users` row via the anon key (owner-scoped by RLS), and `canvas_token`
  is a column on that row — so a `select` returns the token **to the browser**.

**Why it matters.** A Canvas *personal* access token is the sharp kind of credential:
- **Full account scope** — it inherits *all* the student's Canvas permissions (read *and* write);
  a personal token cannot be scoped down.
- **Long-lived** — no short expiry; valid until the student manually revokes it.

Once such a credential exists in browser JS/state, its exfiltration surface widens to anything that
can read the page context: an XSS bug, a malicious browser extension, a shared/compromised device,
or an accidental log/screenshot. The token itself then grants an attacker full, persistent access to
that student's Canvas.

**What it is NOT.** This is **not** a cross-account leak — RLS scopes the `users` read to the
caller's own row, so a user only ever sees *their own* token. That is why this is **P2** (unnecessary
exposure of each user's own high-value credential, exploitable only via a secondary vector like XSS)
and not P0/P1. It complements **F-1** (securing the Course Brain write door) as the other half of
"Canvas-credential handling."

**⚠️ CORRECTION (2026-07-18, on investigation) — the fix is bigger than first written.**
The original fix below assumed the client only needs a `canvas_connected` boolean. **That is wrong.**
The client-side token is **load-bearing**: `src/api/canvasSync.ts` (`syncCanvasData` +
`fetchCourses/fetchAssignments/fetchModules/...`) and `src/pages/Canvas.tsx:698-701` pass `canvasToken`
to drive the Canvas sync through the `/api/canvas` proxy, and `AppContext.tsx:271` gates the sync on it.
Simply revoking client read / gating on a boolean would **break Canvas sync**. So this is not a small
client change — it needs the sync moved server-side first.

**Real fix — move the client-driven Canvas sync server-side, THEN take the token off the client.**
1. **Server-side sync.** Add/extend a server endpoint that performs the Canvas fetches using the token
   the server *already* holds (`canvasCreds` reads it with the service key). The client triggers sync by
   sending only `userId` (its verified session) — never the token. This is a real refactor: `canvasSync.ts`
   is client-side today and drives many fetches, so it's a scoped task, not a one-liner.
2. **Then stop returning the token to the browser.** Once nothing client-side needs it: column-level
   `REVOKE SELECT (canvas_token)` (PostgREST honors column grants) or a view exposing a computed
   `canvas_connected boolean`, and replace `if (user.canvas_token)` gates (`AppContext.tsx:207/326`,
   `Assignment.tsx`, `Work.tsx`, `Canvas.tsx`) with `if (user.canvas_connected)`.
3. **Write path may stay** (`AppContext.tsx:361`) — the client can still *set* the token on connect
   (over TLS); the requirement is that it's never **read back** into client state.

**Urgency note:** **F-6** (stored XSS via assignment description) makes this worse — while the token
lives in client state, an F-6 payload can steal it outright. Prioritize F-6's sanitizer alongside this.

**Defense in depth / roadmap.**
- **Encrypt `canvas_token` at rest** (column-level encryption) so a DB-level compromise doesn't yield
  plaintext tokens.
- **Longer term: OAuth via institutional deals** replaces manual full-scope tokens with *scoped,
  short-lived* tokens (≈1h + refresh) — which shrinks the blast radius and exposure window of this
  entire class of issue. GTM-driven, but a real security side-benefit.

**Verification before/after.**
- Confirm the exposure: as an authenticated user, `select canvas_token from users where id = <me>` via
  the anon key currently returns the token. After the column revoke/view, it should return nothing (or
  the column should be absent), while server-side `canvasCreds` (service key) still works.
- Confirm no UI regressions: Canvas-connected gating still lights up (now driven by `canvas_connected`).

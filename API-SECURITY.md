# API authorization & security posture

How access control works across the FschoolAI backend, and what is deliberately left open.

## Layers

1. **Row-Level Security (RLS)** — every `public.*` user-data table has RLS on. Policies key on
   `current_profile_id()` (= `users.id` where `auth_id = auth.uid()`). The anon key can no longer
   read/write another user's rows directly. The server uses the service-role key, which bypasses
   RLS — so **RLS does not protect the API endpoints**; those enforce auth themselves (below).
   `users` is owner-only; cross-user public fields flow through the `users_public` view.

2. **SECURITY DEFINER RPCs** (`supabase-authz-rpc-hardening.sql`) — friend/room/chat RPCs bypass
   RLS, so they derive the acting user from `current_profile_id()` (never a client-supplied param)
   and are `EXECUTE`-revoked from `anon`/`PUBLIC` (authenticated + service_role only).

3. **API endpoint auth** — the browser attaches the session JWT to every `/api/*` call
   (`src/api/installApiAuth.ts`). Endpoints that touch a user's private data call
   `requireUserOr401(req,res)` (`api/_auth.ts`), which verifies the JWT (or a trusted in-process
   `__internalUserId` set by Reggie's `callApi`) and yields the caller's profile id — used
   INSTEAD of any `userId` in the request body/query. This closes the IDOR where anyone could pass
   another user's id.

   **Enforced (26):** agent-manager, canvas-reads, grade-weights, exam, flashcards, deck-profile,
   digest-lecture, tutor-context, tutor-impression, monitor-agent, office-hours, self-write,
   token-engine, transcribe, writing-tracker, university-brain, content-connector, file-url
   (path-ownership), brain-person-link, brain-signal, nudge, drive-auth + lms-microsoft (data
   actions only), **room-session** (membership-checked per action; proposals owner-only), and
   **daily-room** (was fully unauthenticated — now requires a joined room member; Daily rooms are
   created private with server-minted tokens and profile-locked display names).

4. **Rate limiting** (`supabase-rate-limit-migration.sql`, `api/_ratelimit.ts`) — public
   unauthenticated endpoints (cost/abuse vectors) are fixed-window limited: by session-token hash
   when present (generous), by IP otherwise (strict; `ipOnly` forces IP-keying on fully-public
   endpoints so rotated Bearer tokens can't mint buckets). Applied to claude, groq, tts, stt,
   summarize, extract, guest-demo, waitlist-join (ipOnly + per-IP daily cap + honeypot),
   room-session, daily-room. Join-code brute force is limited inside the `join_room` RPC
   (10 attempts / 5 min / user). Fails open.

5. **Study-room sprint tables** (`supabase-studyroom-sprint-migration.sql`) — all 17 new tables
   (sessions, sources, brains, private threads, jobs, prompt_runs, …) are RLS-on with ZERO client
   policies + privilege revokes: the anon/authenticated keys cannot touch them at all; only
   `/api/room-session` (and future room-AI endpoints) reach them via the service key.
   Realtime private-channel policies gate `room:{id}` / `wb-{id}` / `private:{thread}` topics by
   membership once clients opt into `{ private: true }`. Verifier: `scripts/rls-verify-studyroom.mjs`.

## Deliberately NOT enforced (and why)

These are intentionally left without the web-JWT check — enforcing it would break them. Each has
a bounded residual risk; revisit if the threat model changes.

| Endpoint(s) | Why not JWT-enforced | Residual risk / mitigation |
|---|---|---|
| `extract`, `rag` | Shared by the browser (JWT), the **public guest demo**, AND the **extension** (its own token) — no single auth context | Write-to-RAG / query IDOR. Rate-limited (extract). Fix later: split public vs authed ingest, or accept an extension-token check. |
| `session-close` | Fired via `navigator.sendBeacon` on unload — **cannot set an Authorization header** | Low: writes session memory for a passed userId. Fix later: put a short-lived token in the beacon body. |
| `extension-sync`, `lms-ingest`, `extension-content`, `extension-auth` | The Chrome extension authenticates with its **own paired token**, not a Supabase web JWT | Needs an extension-token verification pass (separate effort). |
| `guest-demo` | Public by design (logged-out demo) | Rate-limited. |
| `email` | Verify/reset links are **one-time-token-gated** (clicked from email, no session) | Token is the auth. |
| `claude`, `groq`, `tts`, `stt`, `summarize`, `route-intent`, `course-resolver`, `leaderboard` | Public/stateless (used in demo + logged-out flows) or read-only | Cost/abuse handled by rate limiting (the LLM ones). |
| cron endpoints (`arbiter`, `brain-scheduler*`, `assignment-reminder`, `exam-mastery-reminder`, `brain-intervention`) | Gated by `CRON_SECRET` | Fail-closed bearer check. |
| `auth-migrate` | Owns its verification (GoTrue password grant) | — |

## Operational notes
- Migrations/RPCs here were applied to prod via the Supabase Management API (see the memory note);
  the `.sql` files are the committed record — re-run them on a fresh project.
- `requireUser` calls GoTrue `getUser` per request; if GoTrue latency spikes, enforced endpoints
  inherit it (same dependency as login).

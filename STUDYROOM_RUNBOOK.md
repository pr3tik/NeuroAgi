# Study Room sprint — Runbook & Known Issues (QA-09 / QA-10)

Owner: Ryan. Last updated 2026-07-16 (Day 1-equivalent: foundations shipped).

## What is live right now
- DB: all sprint tables + RLS + `rag_room_search` + `claim_job` + realtime private-channel
  policies + join-code rate limit (`supabase-studyroom-sprint-migration.sql`, applied to prod).
- API: `/api/room-session` (start/end/review/proposal/sources), hardened `/api/daily-room`.
- Runtime: persona policies + layered prompt builder (`api/_personas.ts`), shared contracts
  (`api/_contracts.ts`), gateway→`prompt_runs` telemetry.
- QA: endpoint suite, injection/persona suites, eval harness, RLS verifier, fixture seeder.

## Demo script (target flow once Pratik wires the UI)
1. `node scripts/seed-studyroom-fixture.mjs` — seeds 3 students (zfix-stu-1/2/3), a room
   (join code `ZFIX01`), 7 documents, 2 Brains, and a board with known text.
2. Sign in as the e2e student (hidden login, top-right of landing nav) or a zfix account.
3. Open the room → Start session (POST `/api/room-session?action=start`) → verify the
   response shows `roomPlan.participant_count: 3` and a persona/config.
4. Bind sources (`action=sources`) → ask the room AI a course question (Siddharth's endpoint)
   → verify source chips + `prompt_runs` row appears.
5. End session (`action=end`) → jobs appear in `jobs` table → worker produces summary +
   quizzes → `action=review` shows the group summary and YOUR quiz only.
6. Accept a Brain proposal (`action=proposal`) → `brain_versions` gains an immutable row.
7. Cleanup: `node scripts/seed-studyroom-fixture.mjs --clean`.

## Verification commands
- `npm run typecheck && npm run build && npm test` — full local gate.
- `node scripts/rls-verify-studyroom.mjs` — proves every sprint table + RPC is closed to the
  anon key (run against prod; read-only).
- `node scripts/ai-eval.mjs` — AI-13 harness: persona rubric sweep, leakage battery, quiz
  schema, brain-patch safety; writes `eval-report.md`.
- Cost/latency: `select scope, count(*), round(sum(cost_usd)::numeric,4) usd, round(avg(latency_ms)) ms from prompt_runs group by scope;`

## Rollback
- Code: everything is additive (new endpoint + new tables). Revert the PR; the app behaves
  exactly as before — no existing flow reads the new tables.
- daily-room hardening: if voice breaks for legit members, the suspect is the membership
  check (user not `status=joined`). Do NOT revert to unauthenticated; fix membership.
- DB: tables can stay (RLS-deny, invisible to clients). To remove the join-code limiter,
  re-run the previous `join_room` body from git history (`git show <sha>:supabase-…`).

## Fixed during the sprint review (previously-live prod bugs)
- **Join-by-code was dead in prod**: since RLS went on (2026-07-14), the clients' direct
  `study_rooms` code lookup returned nothing for non-members — exactly the users the feature
  exists for. Fixed with the rate-limited `find_room_by_code` SECURITY DEFINER RPC (live) and
  client swaps in web `StudyRooms.tsx` + `mobile/app/rooms.tsx`.
- **daily-room was fully unauthenticated** — anyone could mint Daily rooms/tokens with any
  display name. Now member-gated with private rooms + server-minted tokens.

## Known issues / cuts (QA-10 triage)
| # | Item | Sev | Owner |
|---|---|---|---|
| 1 | Group AI endpoint + trigger engine not yet built — foundations only (personas, retrieval fn, budgets, telemetry are ready) | P0 next | Siddharth |
| 2 | Jobs worker absent: `end` enqueues, nothing drains yet; `review` will show `queued` forever until AI-10/11/12 land | P0 next | Siddharth |
| 3 | Room UI: no session start/end/AI panel wiring; room not full-bleed; verify-pending copy on channels remains public until `private: true` flip | P0 next | Pratik |
| 4 | Whiteboard extraction pipeline (Yjs → `whiteboard_snapshots`) not built; the 4s PNG bridge in StudyAssistant remains the only board→AI path | P1 | Siddharth + board owner |
| 5 | Invite rate limit deferred (join-code path is covered; invites need `check_rate_limit` inside the RPC when next touched) | P2 | Ryan |
| 6 | Legacy direct-Anthropic callers bypass `prompt_runs` (none on the room path) | P2 | rolling |
| 7 | Composer pairs peers only when strength/gap topic strings match exactly (case-insensitive); embedding-similarity matching is a Phase-2 upgrade | P2 | Siddharth |
| 8 | Mobile: LiveKit spike still unstarted; deps installed in `mobile/` only | P1 | Sarim |

## Release-gate status (sprint §9.5, Ryan-owned gates)
- **Security**: PASS — RLS verifier green, daily-room closed, no client-key path to any new table.
- **Operations**: PASS for the foundations — runbook + rollback + fixtures + telemetry in place.
- **AI quality / Core path / Realtime / Voice / Mobile**: NOT YET — blocked on items 1–4 above (other owners' workstreams).

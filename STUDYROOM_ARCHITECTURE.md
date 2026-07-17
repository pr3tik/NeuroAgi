# Study Room — Architecture Contract (Day-1 freeze)

**Status: FROZEN 2026-07-16.** Owner: Ryan. Changes to anything in this document require a
migration review — build against it, don't drift from it. Everything marked **LIVE** is
already applied to production (DB) or merged (code); everything marked **(owner)** is the
named teammate's workstream building on these interfaces.

This adapts the 8-day sprint plan (14 July) to the repo's real conventions. Key deltas from
the plan document: endpoints are **action-routed flat files** (never `/rooms/:id/...` paths —
the SPA rewrite swallows non-`/api` paths and the repo treats function count as constrained);
the room-wide timed occurrence is **`room_ai_sessions`** (the name `room_sessions` was already
taken by per-member attendance rows); voice stays on **Daily.co** for web (LiveKit remains the
mobile spike only); and the whiteboard keeps its **Yjs-over-Broadcast** engine (it already
avoids per-stroke Postgres writes — the plan's assumption it needed replacing was wrong).

---

## 1. Data model — LIVE

Reused as-is: `study_rooms` (identity, join_code, yjs_doc, pomodoro_state, course_id BIGINT),
`room_members`, `room_messages`, `room_sessions` (per-member attendance — do not confuse with
`room_ai_sessions`), `rag_documents/rag_sections/rag_chunks`, `deck_profiles`, `users` intake
columns (`learning_style`, `help_seeking`, `explanation_style`).

New (see `supabase-studyroom-sprint-migration.sql`; **all RLS-on, deny-all to client keys —
access is via /api endpoints only**):

| Table | Purpose | Written by |
|---|---|---|
| `room_configs` | Versioned room config: persona, intensity, duration | room-session `start` |
| `room_sources` | Explicit doc shares: room → `rag_documents` | room-session `sources` |
| `room_ai_sessions` | Room-wide AI session (one `active` per room, enforced by partial unique index) | room-session |
| `whiteboard_snapshots` | AI-readable board revisions: `extracted_json`, `render_path`, `digest` | board pipeline (Siddharth AI-06) |
| `private_threads` / `private_messages` | Private help — owner-only | private AI (Siddharth AI-05) |
| `student_brains` / `brain_versions` / `brain_update_proposals` | Canonical versioned Brain + approval flow | room-session `proposal`, proposal jobs (AI-12) |
| `room_brain_snapshots` | Room teaching plan — **server-only, never sent to clients** | room-session `start` |
| `activity_events` / `participant_metrics` / `intervention_events` | Participation + proactivity audit | trigger engine (Siddharth AI-07/08) |
| `session_summaries` / `quiz_sets` | Session outputs (group + per-user) | jobs worker (AI-10/11) |
| `jobs` (+ `claim_job(p_types,p_lease)`) | Idempotent background work | room-session `end` enqueues; worker drains (BE-08) |
| `prompt_runs` | LLM telemetry (no prompt text) | gateway trace sink — automatic |

ID spaces (never "fix" these): `users.id` TEXT · `study_rooms.id` UUID ·
`study_rooms.course_id` BIGINT (Canvas) · `rag_documents.id/course_id` UUID ·
`deck_profiles.course_id` TEXT.

## 2. API surface — action-routed

### `POST/GET /api/room-session?action=…` — **LIVE**
| Action | Method | Auth | Behavior |
|---|---|---|---|
| `start` | POST `{roomId, persona?, intensity?, durationMinutes?}` | member | Freezes `room_configs` vN, creates the session, composes + stores the room teaching plan. Idempotent (resumes the active session). Returns `StartSessionResponse` — clients get only `RoomPlanSummary`, never the plan. |
| `end` | POST `{sessionId}` | member | Freezes the session, enqueues `generate_session_summary` (×1), `generate_quiz` + `propose_brain_update` (×member) with idempotency keys. Safe to repeat. |
| `review` | GET `&sessionId=` | member | Group summary + **caller's own** summary/quiz/proposals/job states. Never another student's. |
| `proposal` | POST `{proposalId, decision, patch?}` | **owner only** | accept/edit → new immutable `brain_versions` row + `student_brains.active_version_id`; reject → status only. Conditional PATCH (`status=eq.pending`) makes concurrent decisions safe. |
| `sources` | POST `{roomId, documentIds[]}` / GET `&roomId=` | member; docs must be caller-owned | Explicit share of ingested docs into the room (≤12). |

DTOs: `api/_contracts.ts` (client imports **types only**: `import type {...} from "../../api/_contracts"`).

### `POST /api/daily-room` — **LIVE (hardened this sprint)**
Now requires: signed-in caller → joined member of the room. Daily rooms are created
`privacy:"private"`; the server mints the meeting token and locks the display name to the
verified profile name. Previously this endpoint was fully unauthenticated (threat closed).

### For Siddharth (AI orchestration) — interfaces ready, not yet built here
- **Group/private AI endpoint**: build on `api/_reggie/loop.ts` (streaming, tools) +
  `buildRoomSystemPrompt()` from `api/_personas.ts`. Group turns run under the **room-session
  identity decision**: tools execute as the *asking student* for private turns, and as the
  *session starter* for group turns — never mix.
- **Retrieval**: `rag_room_search(p_document_ids uuid[], p_query_embedding, p_query_text, …)`
  (**LIVE**, service-role only). Resolve enabled ids from `room_sources` first; membership
  check is the caller's job — the function trusts its input by design.
- **Gateway metadata**: pass `metadata: { scope, user_id, room_id, session_id, persona }` on
  every `callModel/openStream` — the trace sink lifts these into `prompt_runs` columns.
- **Jobs worker**: `claim_job(array['generate_session_summary',…], 120)` → do work → set
  `done` + `output_ref`, or `failed` + `last_error` (+ bump `run_after` for backoff).
  Validate quizzes with `validateQuizSet()` before persisting; exactly five.

## 3. Realtime channels — **LIVE (policies), opt-in (client)**
| Channel | Payloads | Auth once `{ private: true }` |
|---|---|---|
| `room:{room_uuid}` | presence + broadcast: `chat_message`, `pomodoro`, `raise_hand`, `wb_live/wb_cursor/wb_laser`, `room_closed`, `access_changed`, + new `ai_message`, `ai_speaking`, `session_state` | joined members (`is_room_member`) |
| `wb-{room_uuid}` | Yjs `yjs_update` / `yjs_sync_req` / `yjs_sync_res` | joined members |
| `private:{thread_uuid}` | private AI stream state | thread owner only |

Policies on `realtime.messages` are live and **only bind when the client opens the channel
with `private: true`** — existing public channels keep working, so Pratik can migrate
channel-by-channel with zero downtime. Do not invent new topic shapes without updating
`topic_room_uuid()`.

## 4. Personas & prompt layering — LIVE (`api/_personas.ts`)
Six personas (facilitator, peer_teaching, clarifier, challenger, timekeeper, observer), each
with goal/loop/constraints/direct-answer policy and per-intensity proactive budgets
(observer = 0 unsolicited at low/balanced — "Silent" was renamed per the plan).
`buildRoomSystemPrompt()` enforces layer order: security (immutable) → scope (group|private)
→ grounding → persona → teaching plan / student profile → task context, with ALL untrusted
text fenced in `<untrusted>` blocks (fence-escape stripped, 20k cap). Group prompts never
attribute a gap to a named student; peer-teaching pairs surface only as "you worked on this
part". `personaRubric()` is the machine-checkable contract used by QA-04 and the eval harness.

## 5. Rate limits (BE-11)
| Surface | Limit | Where |
|---|---|---|
| Join-code attempts | 10 / 5 min / user (returns `rate_limited`) | in `join_room` RPC — **LIVE** |
| room-session actions | 60/min per user | endpoint — **LIVE** |
| daily-room provisioning | 20/min per user | endpoint — **LIVE** |
| Group/private AI turns | 30/min per user + persona proactive budgets per block | Siddharth's endpoint — REQUIRED |
| Invites | reuse `invite_to_room` RPC; add `check_rate_limit('invite:'||user, 30, 3600)` when touched next | follow-up |

## 6. Observability (BE-12) — LIVE
Every gateway call lands in `prompt_runs` (task, scope, user/room/session/persona, provider,
model, tokens, cache hits, latency, cost, status, fallback). **No prompt/response text is
persisted** — deliberate (threat: sensitive logs). Known gap: legacy direct-Anthropic callers
(none on the room path) bypass the gateway and therefore the sink; migrate them onto
`callModel` as touched. Cost query for QA-08:
`select scope, count(*), sum(cost_usd), avg(latency_ms) from prompt_runs group by scope;`

## 7. Threat model (repo-specific)
| Threat | Mitigation | Status |
|---|---|---|
| Cross-room data leakage | RLS-deny on all new tables; membership checks in every action; realtime policies for private channels | LIVE |
| Brain leakage into group | Full plan server-only; response carries `RoomPlanSummary` only; prompt layer bans attribution; QA tests assert both | LIVE |
| Private-thread leakage | Owner-only tables + `owns_private_thread` policy; review returns caller's rows only | LIVE (tables/policies), AI-05 must keep scope |
| Prompt injection (courseware/board/chat) | `fenceEvidence` + immutable security layer first + injection suite | LIVE |
| Join-code brute force | `join_room` rate check 10/5min | LIVE |
| Voice abuse (was: unauthenticated Daily minting) | requireUser + membership + private rooms + server-side names | LIVE |
| AI spam/cost attack | per-user endpoint limits + persona budgets + `prompt_runs` cost visibility | LIVE (endpoint), budgets enforced in trigger engine |
| Proposal forgery | ownership check + conditional PATCH + patch whitelist (`applyBrainPatch` drops unknown sections) + schema validation | LIVE |
| Sensitive logs | no prompt text in `prompt_runs`; metadata only | LIVE |
| Job double-execution | idempotency keys + `claim_job` FOR UPDATE SKIP LOCKED + lease | LIVE |

## 8. Open decisions made (so nobody re-litigates)
1. **Brain lives in the FschoolAI DB** (`public` schema), not the NeuroAGI project — the
   composer must stay on the request path and the cross-project hop costs ~600ms. The live
   NeuroAGI signals/context_window system is untouched and remains the *tutor's* behavioral
   layer; `brain_nodes`/`brain_edges` (graph, 0 rows) stays dormant — do not build on it this
   sprint.
2. **Composer v1 is deterministic** (intake + deck_profiles + explicit Brain versions), no
   LLM call at session start — instant, free, and privacy-analyzable. An LLM-composed
   strategy can replace `group_strategy` later without schema change.
3. **Quiz storage**: `quiz_sets.questions` uses the existing `exam.ts` MCQ shape
   (`{question, options[4], correctIndex, rationale}`) so DocQuiz-style UI can render it.
4. **Consent defaults ON** (`consent_room_pedagogy`, `consent_updates`) with per-student
   opt-out columns already in place — surfacing the toggle is a UI task (Pratik, Session
   Review screen).

## 9. The linkage rule (BR-01) — GATE

**Status: SIGNED 2026-07-17.** Owner: Vivek. Gates BR-03, BR-04, BR-05.
A private, per-person layer is being connected to a cross-account layer. This rule exists
*before* the code that could leak, per the v3.0 build spec §8.1.

### 9.1 The rule — the arrow points one way

```
Course Brain  ──►  room grounding  ──►  context for Reggie      ALLOWED
Derived person-level signals  ──►  NeuroAGI kernel              ALLOWED (source-stamped 'fschoolai')
Person brain data  ──►  Course Brain, or any shared subject     NEVER — no write path exists
```

**The Course Brain holds facts about the COURSE, never facts about STUDENTS.** If the arrow
points one direction only, cross-account leakage cannot happen by construction — there is
nothing to guard, because there is nothing to reach.

"No write path" means **absent, not guarded**. A guarded path is a path someone later
un-guards. See §9.4 for the two places this is not yet true.

### 9.2 The boundary, by example

| Fact | Verdict | Why |
|---|---|---|
| "The 2025 midterm asked about the Krebs cycle." | ALLOWED | Course fact. Exactly what the Course Brain is for. |
| "Late submissions lose 10%/day." | ALLOWED | Mechanical policy. Already extracted by `university-brain.ts`. |
| "Students find the Krebs cycle difficult." | BLOCKED this sprint | Aggregate. Requires k-anon ≥10 on a cohort subject [PRD §18.4]; Cohort is out of scope. |
| "Aisha finds the Krebs cycle difficult." | **CATASTROPHIC** | Student fact in a cross-account store. No code path may write this. |

### 9.3 Why one-way, and not an ACL

| Source | Says |
|---|---|
| [PRD §18.1] | Hard rule — "Education objects (`knowledge_gaps`, `courses`, `assignments`) are *product data*, not brain schema. The brain stores person-level abstractions only." |
| [PRD §12.3] | "Raw domain data stays in FschoolAI; only learned abstractions enter the Brain." |
| [PRD §19.9] | "Course-material RAG = product (`rag.*` over the student's uploads); global/profile retrieval = brain (`recall`). Raw course content never enters the brain — only derived signals." |
| [CORE2] honest-verdict | The kernel's own authors: shared-space writes have **no authorization**; `subject` is **self-reported**; shares **cannot be revoked**; sharing is "undefended against malicious callers." |

The last row is decisive. **We cannot buy isolation with an ACL on a store whose own authors
say the ACL is undefended and un-revocable.** Keeping course facts in FschoolAI's `course_content`
— where RLS, `requireUserOr401` and the service-key boundary already work — sidesteps all four
gaps. The [PRD §18.1] product-data rule and the [CORE2] security reality point at the same
architecture; this rule is that architecture written down.

### 9.4 Conformance — verified 2026-07-17

| Path | Rule holds? | Evidence |
|---|---|---|
| `api/brain.ts` — person brain read/write | **YES, by construction** | `subject` is derived from the verified session (`:38-43`: `requireUserOr401` → `resolveFschoolPerson` → `` subject = `person:${personId}` ``). It is **never read from the body** — there is no parameter with which to name another subject. `recall` reads `[subject]` only; `forget`/`reinforce` are ownership-guarded (`:63`, `:71`). This closes the [CORE2] "subject is self-reported" gap for our kernel. |
| `api/university-brain.ts` — Course Brain write | **YES** | `requireUserOr401` (`:168`) and a server-side `userId` override (`:169`) — a caller cannot contribute as someone else. Input is professor-published Canvas artifacts fetched server-side with the contributor's own token; the extraction prompt (`:69`) forbids opinions and difficulty judgments. |
| `api/extension-content.ts` — Course Brain write | **NO — OPEN** | **P0. No `requireUserOr401`.** CORS `*`; `userId` taken from the body and presence-checked only (`:110`); `text` inserted verbatim into `course_content` (`:173-189`). Verified against production 2026-07-17: `POST` with `{}` → **400** (validation), where `university-brain` on the same table → **401** (auth). The `content_type` CHECK blocks the *label* `inbox`/`grade`, not the *content* — `lecture` accepts arbitrary text. §9.2's catastrophic row is writable today by an unauthenticated caller. |
| `api/brain.ts` — `audience` field | **LATENT** | `audience` is accepted from the request body unvalidated (`:46`, `:48`) and stored. **No read path honors it today** — `bySubjects()` filters on `subject` only — so it leaks nothing now. It becomes a client-controlled ACL the moment audience-based recall is built. Derive it server-side or reject it from the body before that happens. |

**The rule is signed. It is not yet true.** Row 3 must close before any BR-03/BR-05 grounding
work ships; row 4 must close before any sharing read path is built. BR-06 proves both at the
service boundary — RLS cannot, because RLS does not reach a second project and does not
adjudicate `subject` strings inside one table.

### 9.5 Note — §8.1 is stale as of 2026-07-17

§8.1 states the NeuroAGI signals/context_window system "is untouched." PR1–PR9 (2026-07-17)
introduced `neuro_memory`/`neuro_person`/`neuro_person_link` in the product DB and began
migrating producers onto it: `brain-signal.ts` now writes only to the kernel, `session-close.ts`
dual-writes, and `tutor-context.ts:106` marks the old `context_window` read as "a fallback until
PR7." Six files still reach the separate Brain DB. **Open question for the kernel owner: the
schedulers synthesize `brain.context_window` from `brain.signals`, which `brain-signal.ts` no
longer writes — what feeds them during the migration?**

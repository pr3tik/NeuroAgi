# Post-MVP Backlog — things we deliberately deferred

Things we know we'll need to handle, but chose NOT to block the **July 23 investor demo**
or the ~Aug 1 waitlist launch on. Written 2026-07-20. Each item: what it is, why it can
wait, and roughly what fixing it takes. Ordered by priority within each section.

Priority legend: **P0** must fix before real users trust it · **P1** important soon after
launch · **P2** cleanup / robustness.

---

## 0. Proactive study planning — Reggie coaches *when*, not just *what*  `vision / P1`

**The idea (founder, 2026-07-20).** Right now the guided session estimates how long the
*work* takes. The bigger product is Reggie proactively planning a student's time around
their real deadlines and the science of spaced repetition — turning "here's what to study"
into "here's *when* and *in what order* to study it, so you actually retain it."

Two concrete behaviours:
1. **Single-task time coaching.** "This assignment usually takes ~3 hours and it's due
   Thursday — start by Tuesday evening so you're not rushed." Uses the per-task time
   estimate (see §1-of-study-room-polish, realistic ETA) + the real Canvas due date.
2. **Multi-session spaced-repetition planning.** "You have a quiz Wednesday. It's Saturday.
   These 4 topics each take ~40 min; for retention you should study them across today,
   Monday, and Tuesday in this order, using active recall — here's the schedule." Combines:
   the assignment/quiz deadline (Canvas), the topic breakdown (Reggie's plan generator),
   per-topic time estimates, and the SM-2 spacing logic we already have in `src/lib/srs.ts`.

**Why it's differentiated.** This is the "persistent Brain that actually helps you manage
your semester" story — it's what a good human tutor does and what ChatGPT can't, because it
requires knowing the student's real deadlines, their materials, and their retention state
over time. It ties together three things we already have: Canvas deadlines, the guided-session
plan generator, and SRS scheduling.

**What it needs.** A planner that: reads upcoming Canvas assignments/quizzes with due dates →
decomposes each into topics with time estimates → lays them out backward from the deadline
across available days with spacing → surfaces it proactively (a Reggie nudge / a "study plan"
card), not only when asked. The `planner` specialist route (`api/_reggie/specialists.ts`)
and the guided-session engine are the natural homes. Prerequisite: reliable per-task time
estimates (the realistic-ETA work) and reliable Canvas deadline data (now flowing after the
file-ingestion work).

**Effort.** Multi-day feature, post-MVP. Worth a dedicated spec when it comes up.

---

## 1. Canvas token expiry — self-service re-auth + proactive nudge  `P0`

**The problem.** Canvas access tokens expire (UofT's expired after ~10 days in testing —
the demo account's token silently died and served stale cached data until it was manually
replaced). When a token expires, **everything live-Canvas breaks**: file sync stops,
Reggie's live Canvas tools all return "Canvas rejected the stored token," and course data
goes stale — with no signal to the student that anything is wrong.

**What must NOT happen:** the student should never have to make a new account. Their brain,
history, courses, and indexed materials all persist — only the token is stale.

**The fix (two parts).**
1. **In-app re-auth.** A "Reconnect Canvas" affordance in the profile/settings that lets a
   student paste a fresh token (or re-run OAuth if we move to OAuth) without touching the
   rest of their account. The write path already exists — `saveCanvasCredentials` in
   `src/context/AppContext.tsx` upserts `canvas_token`/`canvas_base_url` in place. This is
   mostly a UI surface + a "your Canvas connection expired" empty-state.
2. **Proactive detection + Reggie nudge.** Detect the 401 from Canvas (the sync effect in
   `AppContext` and `api/_reggie/canvasLive.ts:canvasGET` already surface it) and, instead
   of failing silently, (a) set a `canvas_token_expired` flag on the user, and (b) have
   Reggie open a chat: *"Heads up — your Canvas connection expired, so I can't see your
   latest courses. Want to reconnect? It takes 30 seconds."* with a deep link to the
   reconnect screen.

**Why it can wait for the demo:** we control the demo account and just refreshed its token.
But this is **P0 for real users** — expired tokens are the single most common way the
product silently degrades to "a ChatGPT wrapper" for a paying student, and they won't know
why.

**Effort:** ~half a day (UI + flag + one detection hook + Reggie message template).

---

## 2. Canvas file ingestion — productionize the pipeline  `P1`

**Context.** As of 2026-07-20 we ship server-side Canvas file indexing (`api/canvas-files.ts`)
— it discovers files via the Files tab AND Modules (most instructors disable the Files tab),
downloads bytes with the student's token, and runs them through the existing extract → OCR →
chunk → embed pipeline. It's triggered client-side from `AppContext` after a Canvas sync,
looping batches until drained. **Verified end-to-end on a real UofT account: 40/48 files
indexed, ~2,300 chunks embedded, retrieval returns real lecture content.**

**What's still rough for scale:**
- **Client-driven loop.** The batch loop runs in the browser tab (`indexCanvasFiles` in
  `AppContext`). If the student closes the tab mid-drain, indexing pauses until their next
  visit. For a 40-file account that's ~1–2 min of foreground time. **Better:** move it to
  the `api/jobs.ts` cron worker — enqueue one job per file after sync, drain server-side.
  The job type needs no migration (`jobs.type` is free text).
- **Embedding rate-limit stranding.** A fast bulk run trips OpenAI's embedding rate limit;
  `ingestLmsFile` catches the failure as non-fatal ("backfill will retry") and leaves chunks
  inserted-but-not-embedded. In testing, ~1,700 of 2,269 chunks were stranded and needed a
  manual re-embed pass. **We need an automatic backfill cron** that finds
  `rag_chunks WHERE embedding IS NULL` and embeds them on a schedule, so nothing stays
  keyword-only silently. (`api/rag.ts?action=backfill` exists but only rescues files with
  extracted `content_text` — it does NOT catch modern `document_id`-linked rows with null
  embeddings. Close that gap.)
- **Locked/release-gated files.** Some Canvas files return an empty download URL
  (`locked_for_user: true`) until the instructor releases them. We mark these `unavailable`
  and skip them. **Follow-up:** periodically retry `unavailable` files, since a locked
  week-5 lecture becomes available later.
- **File-reader UI shows blank.** RAG-indexed files have `document_id` set but `content_text`
  null. The mobile Spaces reader and `DocReader.tsx` render `content_text` directly, so a
  Canvas-indexed file is tutor-visible but blank in the file viewer. Either dual-write a
  text preview or point those readers at the RAG sections.

**Effort:** ~1 day to move to the job queue + write the embedding backfill cron.

---

## 3. Security holes found during the file-ingestion work  `P0`

These are pre-existing (not introduced by recent work) but surfaced during it. All are
**deferred-past-demo per the MVP scope decision**, but they're real.

- **`api/lms-ingest.ts` has no authentication at all.** It reads `userId` straight from the
  request body — no JWT, no bearer, no rate limit. Anyone on the internet can POST arbitrary
  bytes attributed to any user and burn OCR/embedding budget (denial-of-wallet). Compare
  `api/lms-proxy.ts` which requires `EXTENSION_AUTH_SECRET`. **Fix:** require a verified JWT
  or a shared secret; the new `api/canvas-files.ts` already does (`requireUserOr401`), so it
  can serve as the authed entry point and `lms-ingest`'s HTTP surface can be locked down.
- **`api/rag.ts?action=query` read IDOR.** Trusts a body-supplied `userId` and returns that
  user's document text. Documented in-code, deferred for guest-demo compatibility. RLS is
  off on all `rag_*` tables, so the service key is the only gate.
- **`api/extension-content.ts` accepts unauthenticated writes** into the shared
  `course_content` table that every student's tutor reads. Currently harmless only because
  nothing writes to that table — but it becomes a poisoning vector the moment University
  Brain ingestion is turned on (see §5). This is the F-1 item; spec in
  `SECURITY-F1-extension-auth-proposal.md`. **Merge the guard and lock this before §5.**

**Effort:** ~half a day for lms-ingest auth; the others are tracked in the SECURITY-F* docs.

---

## 4. Job queue lease vs. handler duration  `P1`

`api/jobs.ts` sets `LEASE_SECS = 120` but the handlers it drains have `maxDuration = 300`.
A slow job (scanned-PDF OCR + embedding can run 150–250s) exceeds its lease, so a second
worker re-claims it while the first is still running → duplicate OCR spend + duplicate
embeddings. `ingestLmsFile`'s dedup makes this *mostly* idempotent, but only after the first
run finishes — which is exactly what the lease expiry interrupts. **Fix:** raise `LEASE_SECS`
above the slowest handler's `maxDuration`, or split OCR into its own sub-job kept under 120s.

**Effort:** ~1 hr.

---

## 5. University / Course Brain — turn on ingestion  `P1`

The shared "Course Brain" (`course_content`) is fully built — extraction formatters, dedup,
institution scoping, the isolation guard (BR-06, now merged), and the grounding read path —
but **nothing ever triggers a contribution**, so the live table has ~2 junk rows. This is the
"data moat" layer (your professor weights the final at 40%, doesn't accept late work, etc.).

**What it takes to actually fill it (all three needed, not just the first):**
1. **A contribution trigger** — call `POST /api/university-brain?action=contribute` per course
   after a Canvas sync (or a nightly cron over Canvas-connected users). Requires a **consent
   decision** — decided 2026-07-20: onboarding opt-in checkbox, shipped dark, turned on after
   the demo. (Build was scoped but paused; recon complete.)
2. **Fix the syllabus-source gap** — `university-brain.ts` reads Canvas's `syllabus_body`
   field, which is empty when the syllabus is an uploaded PDF (the common case at UofT). Route
   a syllabus-like file through `api/extract.ts` first. Without this the richest artifact
   never fires.
3. **Run two pending migrations** (Supabase SQL Editor):
   `supabase-course-content-assessment-type-migration.sql` (without it an entire artifact type
   fails silently, swallowed by a catch that assumes a restricted Canvas tab) and
   `supabase-university-id-scoping-migration.sql`.
4. **Skip 0%-weight junk rows** — `university-brain.ts` writes "Assignments — 0%" rows with no
   `weight > 0` guard. Both current live rows are this. Add the guard + a cleanup delete.
5. **Merge/lock before enabling:** the isolation guard is merged, but `extension-content`'s
   open write door (§3) must be closed before contributions flow at volume.

**Effort:** ~2–3 days for a genuinely useful Course Brain. Note only ~21/141 users have
Canvas connected, so the initial harvest is limited regardless.

---

## 6. Retrieval quality — the fixes not yet in prod  `P1`

Being handled by the retrieval-focused engineer, tracked here for completeness:
- **Make retrieval automatic**, not model-discretionary — the base Reggie prompt currently
  discourages tool use for "general-knowledge" questions, so it skips searching the student's
  own indexed material. (Biggest single accuracy win.)
- **Add a citation instruction** to the default Reggie path (`api/_reggie/specialists.ts`
  `base()`); other paths cite, this one doesn't.
- ~~**Run `supabase-rag-fts-order-fix.sql` in prod**~~ — ✅ DONE 2026-07-20. The full-text
  arm of hybrid search applied `LIMIT` without `ORDER BY`, returning arbitrary rows on broad
  queries. Migration run in the Supabase SQL Editor; live functions fixed and verified
  (broad query returns real passages, fallback=false).
- **`rag_search` shared rate-limit bucket** — in-process tool calls fall back to
  `ip:unknown`, so all users share one 20/min bucket; retrieval 429s under load and Reggie
  silently answers ungrounded.
- **Two live callers drop `courseId`** (`NeuralRing.tsx`, `StudyAssistant.tsx`) → retrieval
  spans all courses, cross-course contamination.
- **The no-hits fallback** returns an arbitrary recent document labeled as "retrieved right
  now" — a machine for confident wrong answers. Make it honest or drop it. (Low risk once
  accounts have many docs, since the fallback only fires with ≤5 documents.)

---

## 7. Misc smaller items  `P2`

- **`tutor-context`'s `sources` array is built and shipped on every turn but never consumed**
  by any frontend — either render source chips from it or stop computing it.
- **`tutor-context`'s classifier bypasses the gateway** (raw fetch to api.anthropic.com), so
  it gets no retry/cost-accounting/tracing unlike every other model call.
- **`api/route-intent.ts` is dead code** (no production caller) — `tutor-context` inlines its
  own copy of the classifier.
- **`is_private` column on `course_content` exists in the live DB but in no migration file** —
  someone added it by hand. Capture it in a migration so fresh setups don't break.
- **Rotate the pasted/committed Anthropic key + the demo Canvas token** before any shared
  deploy (both have appeared in chat logs).

---

*This doc is a living backlog — add to it as we discover more "later" items rather than
letting them live only in someone's head.*

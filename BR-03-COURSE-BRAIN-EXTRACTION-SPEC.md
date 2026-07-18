# BR-03 — Broaden the University Brain extraction

**Status: DRAFT 2026-07-18.** Owner: Vivek. Depends on BR-01 (signed) + BR-02 (merged, live).
Scope: the **authenticated** `api/university-brain.ts` contribute path only — not the extension.

## 1. Summary

The University Brain (`api/university-brain.ts`, `contribute` action) turns one student's Canvas
into shared, institution-scoped course facts that every other student at the same school can read.
Today it extracts **two** artifacts per course. BR-03 broadens that to **five** by pulling three
more *published, mechanical* artifact types Canvas already exposes — the assessment calendar, the
topic sequence, and the posted-materials list — so a course/professor lookup returns a far richer
profile without any new Canvas plumbing.

## 2. What exists today

`contribute` (`university-brain.ts:82`) fetches, with the contributor's **own** Canvas token:

| # | Artifact | Canvas source | `content_type` | Extraction |
|---|----------|---------------|----------------|-----------|
| 1 | Syllabus facts | `syllabus_body` | `syllabus` | LLM (`extractFacts`, `:63`) — freeform prose → mechanical facts |
| 2 | Grading structure | `/assignment_groups` (`group_weight`) | `rubric` | Deterministic string (`:104-114`) |

Both go through `upsertArtifact` (`:39`), which dedups on
`content_hash = sha256(university_id|course_id|content_type|text[:500])`, keyed to
**institution + course + professor** (never the contributing account). Reads are scoped to the
caller's own `university_id` by BR-02.

## 3. What BR-03 adds (three artifacts)

| Artifact | Canvas source | Trimmer (exists) | `content_type` | Migration |
|----------|---------------|------------------|----------------|-----------|
| **Assessment schedule** | `/courses/:id/assignments` + `/courses/:id/quizzes` | `trim.quizzes` | `assessment` | ⚠️ 1-line CHECK extension |
| **Topic sequence** | `/courses/:id/modules?include[]=items` | `trim.modules` | `module` | none (already allowed) |
| **Posted materials** | `/courses/:id/files` | `trim.files` | `file` | none (already allowed) |

`'module'` and `'file'` are **already in the `content_type` CHECK** (`course-content-migration.sql:26`)
— the schema was built anticipating exactly this. Only `assessment` is new.

**Deliberately out of scope** (may revisit): lecture-note page bodies (`trim.page`) — heavy payloads,
real LLM extraction cost; announcements (`trim.announcements`) — ephemeral/noisy, not durable course
facts.

## 4. Design decisions

### 4a. New `content_type = 'assessment'` (RULED: add the migration)
No existing type cleanly means "the graded-work calendar." A dedicated type keeps it queryable and
distinct from `rubric` (grading *weights*, not *dates*). One 1-line CHECK extension (§7). Rejected
alternative: folding the calendar into the `rubric` artifact (muddies two distinct facts).

### 4b. No LLM for the three new artifacts (RULED)
All three are **structured data** (names, dates, points, titles, filenames). We format them into a
fact sentence **deterministically** — no `callModel`. Consequences: cheaper, faster, and **zero
hallucination risk** (the model cannot invent a due date it never saw). Only the freeform syllabus
(existing) still needs the LLM.

### 4c. Snapshot-upsert for the three new artifacts (RULED)
A schedule/module/file list **grows through the term**, so content-hash dedup would accumulate stale
rows (one per edit). Instead these three use **snapshot semantics**: exactly one current row per
`(university_id, course_id, content_type)` **that this endpoint owns**, replaced on each
re-contribute. Add `upsertSnapshot()` next to `upsertArtifact()` — finds the row for that tuple,
PATCHes `text`/`content_hash`/`last_seen_at` if present, else INSERTs. The syllabus + rubric keep
content-hash dedup unchanged.

**Ownership guard (correctness):** `'module'` and `'file'` are *also* written by the browser
extension (`extension-content.ts`). So the snapshot find/replace is scoped by a sentinel
`source_url = 'university-brain'` — we only ever replace *our own* structured snapshot, never an
extension-scraped row of the same type. The content-hash is namespaced (`snapshot:<type>`) so a
snapshot row can never collide with an extension/artifact hash on the UNIQUE `content_hash` index.

## 5. Stored-fact shapes

```
assessment: "BIO130 assessment schedule: Quiz 1 (Oct 3, 20 pts), Problem Set 2 (Oct 10, 5%),
             Midterm (Nov 5, 100 pts), Final (Dec 12, 40%)."
             → also: module_name=null, concepts=null, summary=first 300 chars

module:     "BIO130 topic sequence: 1. Cell structure · 2. Membranes · 3. Metabolism · 4. ..."
             → concepts = ["Cell structure","Membranes","Metabolism", ...]  (topics are the concepts)

file:       "BIO130 posted materials: Lecture01.pdf, Ch3-reading.pdf, LabManual.pdf, ..."
             → concepts = null
```

Each row also carries `professor_name` (already resolved in `contribute` at `:88`) and
`canvas_course_id`, so profile reads and BR-05 grounding join exactly as they do for syllabus/rubric.

## 6. Implementation sketch

All in `api/university-brain.ts`, inside `contribute` (after the existing Artifact 1 + 2 blocks):

1. **`upsertSnapshot(row)`** — new helper beside `upsertArtifact` (`:39`). Same insert shape; dedups on
   `(university_id, course_id, content_type)` via a `select id` then PATCH-or-INSERT.
2. **Artifact 3 — assessment**: `canvasGET(creds, /courses/:id/assignments, {per_page:100})` +
   `canvasGET(.../quizzes)`; merge to `{title, dueAt, points}[]` sorted by `dueAt`; format sentence;
   `upsertSnapshot({content_type:'assessment', ...})`. Wrap in try/catch — a restricted tab must not
   fail the whole contribution (same pattern as the grading block `:104-115`).
3. **Artifact 4 — module**: `canvasGET(.../modules, {'include[]':'items', per_page:50})` → `trim.modules`;
   format sentence; `concepts` = the item/topic titles; `upsertSnapshot({content_type:'module', ...})`.
4. **Artifact 5 — file**: `canvasGET(.../files, {per_page:50})` → `trim.files`; format sentence;
   `upsertSnapshot({content_type:'file', ...})`.
5. The `contributed[]` response array gains the three new entries (each `{type, id, deduped|replaced}`).

No read-side change: `profile` (`:123`) already `select`s all content types for a course and dedups
`concepts`/`summaries` across rows, so the three new types surface automatically. BR-02 scoping is
inherited unchanged.

## 7. Migration

`supabase-course-content-assessment-type-migration.sql` (run in the Supabase SQL Editor):

```sql
-- BR-03: add 'assessment' to the course_content content_type CHECK.
alter table public.course_content
  drop constraint if exists course_content_content_type_check;
alter table public.course_content
  add constraint course_content_content_type_check
  check (content_type in
    ('syllabus','lecture','rubric','announcement','module','file','assessment'));
notify pgrst, 'reload schema';
```

Idempotent (drop-if-exists → add). No data change; existing rows are unaffected.

## 8. BR-01 compliance (§9.2)

Every new artifact is a **mechanical, professor-published COURSE fact** — dates, points, titles,
filenames, topic labels. Explicitly:
- Quizzes contribute **titles/dates/points/question-count only** — never questions or answers
  (`trim.quizzes` already excludes them).
- No student data, no submissions, no opinions, no difficulty judgments (those are the k≥10
  behavioral tier, out of scope).
- Fetched server-side with the contributor's own token; `contribute` is `requireUserOr401`-guarded
  (`:174`) with a server-side `userId` override (`:175`) — §9.4 row 2 (compliant) is unchanged.

## 9. Gate / out of scope

- **Does not touch F-1** (the unauthenticated `extension-content.ts` write door). BR-03 is the
  *authenticated* path. Per the owner's ruling, BR-03 extraction is **not** gated on F-1; only BR-05
  room grounding is.
- No new Canvas capability, no other LMS. Brightspace/Moodle/etc. remain a separate future adapter.

## 10. Testing

- **Unit** (`test/university-brain.test.ts` — new or extended): the three formatters are pure
  (structured input → fact string); assert deterministic output + BR-01 exclusions (a quiz object
  with a `question` field never leaks the question into the string). Mock `canvasGET`; assert
  `upsertSnapshot` PATCHes on a second call with changed input (snapshot semantics), never a 2nd row.
- **Build/typecheck/test**: `npm run build && npm run typecheck && npm test` green before done.
- **Live**: after the migration, one real contribute against a UofT course; confirm 3 new rows,
  correct `content_type`s, and that a re-contribute replaces (not duplicates) them.

## 11. Open decisions

None blocking — 4a/4b/4c ruled. Revisit lecture-note bodies + announcements post-launch if grounding
wants more depth.

# BR-06 · Course Brain Isolation Proof — Design Spec

**Status:** Approved design (2026-07-18). **Owner:** Vivek. **Gate:** HARD LAUNCH GATE.
**Depends on:** BR-01 (linkage rule), BR-02 (Course Brain contract), BR-03 (broadened extraction).

---

## 1. The invariant we must guarantee

From BR-01, restated as the property this work enforces:

> **Person-scoped data must never enter the shared `course_content` table.**

`course_content` is the shared, deduped, institution-scoped course library. It has **no
`user_id`/owner column** and is served to **every student in the course** (consumers filter
`is_private = false`: `tutor-context.ts`, `library-agent.ts`, `office-hours.ts`, `Study.tsx`).

**This is NOT "don't collect student data."** Student-specific data (grades, scores, submissions)
is collected and stored in **person-scoped tables** (`courses`, `assignments`, `files`,
`canvas_data` — `user_id`-scoped, RLS-guarded) where only that student reads it. That is correct
and necessary — the tutor needs your grades to help *you*.

The leak we prevent is the **two streams crossing**: person data landing in the *shared* bucket,
where another student would read it.

| ✅ Professor-published (shareable) | ❌ Person-scoped (never in `course_content`) |
|---|---|
| Syllabus, modules, topic sequence | A student's grade / score |
| Files the professor posted | A student's submission / submitted files |
| Announcements, rubrics | Discussion posts a student wrote |
| Assignment prompts, assessment schedule | Prof feedback on a student's work |

---

## 2. Threat model — the doors into `course_content`

The write doors are **server endpoints**, not extension code. They are publicly reachable HTTP, so
a modified extension, an old client version, or a plain `curl` can hit them. The guard therefore
lives **server-side at each endpoint's DB-write boundary** — never in the client.

| Door | Endpoint | What it writes | Risk |
|---|---|---|---|
| **1** | `api/university-brain.ts` (`upsertArtifact`, `upsertSnapshot`) | Deterministic **formatter output**, controlled fields (BR-03) | 🟢 Low |
| **2** | `api/extension-content.ts` | **Raw scraped page `text`** (≤50k chars) | 🔴 Unbounded |
| **3** | `api/extension-sync.ts` → `upsert_course_content` | **Client-supplied `rows[]` verbatim** | 🔴 Unbounded |

**Consumer side** (where a leak would surface to another student): any `is_private = false` read.
Note Door 2 currently never sets `is_private` → defaults to `false` → shared.

**Why tests alone are insufficient:** Doors 2 and 3 accept unbounded input (raw text / arbitrary
rows). A finite test set can never *prove* the invariant for unbounded input. A launch gate needs an
**enforced runtime property**, not a CI-time check — hence the guard.

**Open item to confirm (does not block design):** whether Doors 2/3 have any live client caller
today. `extension/background.js` writes only person-tables; no active caller of `extension-content.ts`
was found. If confirmed dormant → guard-and-deprecate; if live → guard-and-keep.

---

## 3. Design decision

**Chosen: Option B (runtime write-boundary guard) + the one slice of Option C that closes the
raw-text scrape door.** Alternatives considered:

- **A — Tests only.** Rejected: cannot cover unbounded scrape input; CI-check, not an enforced gate.
- **C — Full architectural lockdown** (shared table writable only by server formatters). Rejected
  *for launch*: largest behavior change, overlaps F-1, risks shrinking library coverage. Kept as a
  documented post-launch follow-up.
- **B + close scrape door — chosen.** Enforced runtime gate; eliminates the worst (unbounded) vector
  structurally; additive + testable, so low regression risk to the fragile Canvas sync; shippable
  before launch.

---

## 4. The guard — `assertCourseFact(input)`

New pure module `api/_brain/courseFactGuard.ts`, exporting:

```ts
// Throws CourseFactRejected(reason) on any violation; otherwise returns a REBUILT,
// allowlisted row safe to write to course_content.
export function assertCourseFact(input: Record<string, unknown>): CleanCourseFact;
```

Every `course_content` write path calls it immediately before the insert/upsert and, on
`CourseFactRejected`, **skips the shared write (fail-closed) and logs it** — the write is dropped,
never partially applied.

### 4a. Field allowlist — *airtight*
The guard does not sanitize the caller's object; it **rebuilds** the row from only these columns:

```
university_id, course_id, canvas_course_id, content_type, content_hash,
text, summary, concepts, week_number, module_name, professor_name,
source_url, seen_by_count, is_private, last_seen_at
```

Any other key the caller sent is **dropped** (never forwarded). Any recognizably person-linking key
present in the input (`user_id`, `person_id`, `student_name`, `score`, `grade`, `submission*`,
`submitted_at`) → **reject** (its mere presence signals a mis-routed person payload). `is_private` is
forced to `false` — the guard writes **professor facts only**. A caller passing `is_private: true`
(an attempt to store person content in the shared table) is **rejected**, not silently written.
*(Open item: confirm no live door legitimately writes `is_private: true`; if one does, that write is
itself a latent leak — person content in a no-owner table — and gets routed to person storage.)*

### 4b. `content_type` allowlist — *airtight*
Must be one of `syllabus | lecture | rubric | announcement | module | file | assessment`
(matches the BR-03 DB CHECK constraint). Otherwise → reject.

### 4c. Text person-data screen — *heuristic, defense-in-depth*
Reject when `text` (or `summary`) trips **high-signal** person-data patterns:
- **Numeric grades:** `\b\d{1,3}\s*/\s*\d{1,3}\b` or `\b\d{1,3}\s?%` in proximity to
  `score|grade|points|mark|result`.
- **First/second-person result language:** `your (grade|score|submission|mark)`, `you (scored|
  submitted|received)`, `submitted (at|on)`, `late submission`, `missing`.
- **Grade-table shapes:** ≥3 lines matching `<label> | <n> | <n>` / `<label> … <n>/<n>`.

Deliberately targets **high-signal** patterns (actual numeric grades, "your grade/score"), not
generic second person — a syllabus saying "you will submit assignments online" must still pass.
Fail-closed on a match: drop the shared write (the data may still reach person tables elsewhere).

---

## 5. Close the scrape door (the slice of C)

`extension-content.ts` is the only door ingesting **raw whole-page scraped text** — the unbounded
vector. Plan:
1. Route its write through `assertCourseFact` (the raw `text` now faces the person-data screen).
2. **Flag `extension-content.ts` for deprecation** — confirm no live caller with the team, then have
   it return `410 Gone`.
3. Whole-page scrapes should only ever reach the student's **own consent-gated RAG**
   (`chrome-extension/content.js` already gates capture with a consent bar), never the shared table.

---

## 6. The proof battery (tests)

`test/course-fact-guard.test.ts` — unit tests on the guard:
- Field allowlist: extra keys dropped; person-linking keys (`user_id`, `score`, `submitted_at`, …)
  rejected; output contains *only* allowlisted columns.
- `content_type` allowlist: bad type rejected; each valid type passes.
- Text screen: grade patterns (`18/20`, `82%` near "score"), "your grade", "submitted at", grade-table
  shapes → rejected; clean professor text (syllabus/module/assessment) → passes.
- `is_private` forced explicit.

Per-door routing tests (extend existing suites):
- A person-tainted payload to each of the three doors **never reaches the `course_content` write**
  (assert the insert/upsert is skipped and the drop is logged).
- The existing **BR-01 leak test** (BR-03 suite) folds into this battery.

Green bar = layers 1 (written argument, this doc) + 2 (mechanical proof) of the gate satisfied.

---

## 7. Residual risk (honesty)

- **Airtight:** the field allowlist (row is rebuilt, not sanitized) and the `content_type` allowlist.
  `course_content` has no person columns, and after the guard no non-allowlisted field can be written.
- **Probabilistic:** the free-text person-data screen. A professor-fact `text` that embeds person data
  yet evades the patterns could pass. Mitigated because (a) the raw-text door is being closed, and
  (b) the remaining live door (`university-brain.ts`) emits **deterministic formatter output** that
  never carries raw person text by construction.
- **Net:** the strong guarantee is structural (allowlist + scrape-door closure); the text screen is
  belt-and-suspenders, not the primary defense.

---

## 8. Out of scope (post-launch / blocked)

- **Layer 3 — live staging proof:** two real student accounts contributing to the same course in
  staging, DB-inspected for zero crossover. Blocked on staging + Canvas; final belt-and-suspenders.
- **Full architectural lockdown (Option C):** `course_content` writable only by server-side
  formatters. Roadmap follow-up; overlaps F-1 (extension auth).
- **Cleaning up legacy `is_private = true` rows** in `course_content`: existing private rows are
  unattributable (no owner column) — `library-agent.ts` already ignores them. The guard stops *new*
  ones; auditing/removing existing ones is a separate follow-up.

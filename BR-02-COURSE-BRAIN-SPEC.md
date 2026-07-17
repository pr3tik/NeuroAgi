# BR-02 — Course Brain scoping (Gap 8) — spec & progress

Owner: Vivek. Branch: `br-02/course-brain-scoping`. **Not merged — prepped for review.**
Status: foundation written + tested; read-filter wiring partially done; migration ready to run.

This makes the Course Brain (`course_content`) **scoped by institution** so a course/professor
lookup can't surface another school's facts. It completes the "institution" half of the BR-01
linkage rule and sets up BR-06's proof *"Course Brain rows never cross `university_id`."*

---

## 1. Live DB reality (verified read-only against prod, 2026-07-17)

Grounded facts — not the repo's docs:

| Fact | Value | Implication |
|---|---|---|
| `course_content` rows | **2** (both `university_id='q.utoronto.ca'`) | Nearly empty → canonicalization is trivially safe |
| `course_content.university_id` format | **hostname** already | Our canonical choice is what the seed writes |
| `users.university_id` | **exists live, NULL for all, in NO committed migration** | Schema drift — must track + populate |
| `users` total / with Canvas | **141 / 21** (all `https://q.utoronto.ca`) | Backfill populates 21; the other 120 have no course brain to scope |
| `course_id` format | course codes (`GGRC25H3 F LEC01`) | School-specific — not globally unique, so needs `university_id` scoping |

**Verified the fix works, live:** `course_content?university_id=eq.q.utoronto.ca` → 2 rows;
`=eq.canvas.ubc.ca` → 0 rows (leak blocked); no filter → all rows (today's leak).

## 2. The canonical key (decided): **hostname**

`university_id` = the hostname of the user's Canvas base URL, e.g. `q.utoronto.ca`.
Chosen because `university-brain.ts` (the seed) already writes it. Both write paths now agree.

**Known tradeoff (open):** raw hostname means a school's multiple portals
(`canvas.` / `q.` / `portal.utoronto.ca`) are **distinct keys**. `university-brain` already had
this. A portal→canonical-host normalization map is a **Phase-2** refinement if intra-school
fragmentation shows up. Flagged in code at `extension-content.ts` `deriveUniversityId`.

## 3. What's DONE on this branch (written + tested: typecheck, build, suite 667✓)

| Change | File | What |
|---|---|---|
| **Migration** | `supabase-university-id-scoping-migration.sql` | Tracks `users.university_id` (`add column if not exists`), indexes it, **backfills** from `canvas_base_url` hostname. Idempotent. **← run this first, in the SQL Editor.** |
| **Resolve helper** | `api/_reggie/canvasLive.ts` → `userUniversityId(userId)` | Reads `users.university_id`; falls back to deriving from `canvas_base_url` (works pre-backfill); returns `null` when no Canvas → callers skip the filter (degrade, don't return empty). |
| **Write canonicalization** | `api/extension-content.ts` | `deriveUniversityId` now returns the **hostname** (was short-id `uoft`); server-derived value preferred over the client-supplied one. Tests updated to hostname expectations. |
| **Read scoping (2 of 6)** | `api/university-brain.ts` `profile()` | Both reads (course `:131`, **professor `:140` — the worst leak**) now append `&university_id=eq.<caller's uni>` when resolvable. |

## 4. What's LEFT (do together on return)

### 4a. Run the migration (needs Supabase dashboard access — ask Ryan/Vincent)
Apply `supabase-university-id-scoping-migration.sql` in the SQL Editor. Verify with the queries at
its bottom (~21 users scoped, distinct = `q.utoronto.ca`). **Everything below assumes this ran.**

### 4b. Wire the remaining 4 read paths (same pattern as §3)
Resolve `userUniversityId(userId)` and append the `&university_id=eq.<uni>` filter (conditional):

| Read | File:line | Current filter | Note |
|---|---|---|---|
| Reggie grounding | `tutor-context.ts:149` | `course_id`/`canvas` + `is_private` | Main path — has `userId` in scope |
| Library search | `library-agent.ts:110,129` | `course_id` | Two queries |
| Office-hours prep | `office-hours.ts:82` | `canvas_course_id` | Has `userId` |
| Frontend library | `src/pages/Study.tsx:826` | `canvas_course_id` | Client — resolve via an API or pass `university_id` from user context |

`Study.tsx` is the odd one: it's the **browser** with the anon key. Cleanest is to route its
`course_content` read through a small server endpoint (or include the user's `university_id` in the
already-loaded profile and filter client-side-safe). Decide on return.

### 4c. Canonicalize the last write path
`extension-sync.ts:141` `upsert_course_content` takes client rows **verbatim** (client-controlled
`university_id`). Derive it server-side (from the caller's `canvas_base_url`) instead of trusting the
body. **Note:** this overlaps the `extension-content` **auth** P0 (F-1) — do them together as the
"secure the Course Brain write door" chunk, which is also part of **BR-06**.

### 4d. Populate on Canvas connect (so new users get scoped without a re-backfill)
Where `canvas_base_url` is saved (`src/api/canvasSync.ts`), also set
`users.university_id = new URL(canvas_base_url).hostname`. Small, one write site.

## 5. How it fits

- **BR-01** (linkage rule): a course fact is scoped to *institution + course*. This is the code that
  enforces the *institution* half. Completes the contract.
- **BR-06** (isolation proof): proof (d) is literally "rows never cross `university_id`." The
  live-verified filter (§1) is the mechanism BR-06's adversarial test will assert.
- **BR-03/BR-05**: they read/write `course_content`; once scoping is correct, they inherit it.
- **F-1 / extension-content auth**: §4c ties the Course Brain's write-door lock into this workstream.

## 6. Testing status (honest)

- ✅ Code: typecheck, build, full suite (667) green.
- ✅ Read filter **verified against live data** (read-only): correct school → its rows, other school → 0.
- ⚠️ Not yet exercised end-to-end (needs the migration run + a real multi-school dataset — today prod
  has one school, so cross-school scoping can't be *demonstrated* live until a second school exists;
  the filter is proven correct by the `=eq.canvas.ubc.ca → 0` probe).
- Migration: written, **not run** (needs dashboard access).

## 7. Open decisions for you

1. **Portal fragmentation** (§2) — accept raw hostname for now, or add a normalization map? (Rec: accept now, Phase-2 if needed.)
2. **`Study.tsx` read** (§4b) — route through a server endpoint, or filter with the user's own `university_id` from context?
3. **§4c + F-1 together** — bundle the extension-sync canonicalization with the extension-content auth fix as one "secure the write door" PR (recommended, it's also BR-06).

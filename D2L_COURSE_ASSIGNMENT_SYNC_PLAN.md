# D2L Course / Assignment / Grade Sync — Implementation Plan

**Author:** Sarim Khan · **Date:** 2026-07-10 · **Branch context:** `fix/d2l-extension-file-import`

## 1. Goal

Give D2L (Brightspace) students the same experience Canvas students get today: real course
names, assignments, due dates, and grades showing up in the app — not just imported files.

## 2. Current state (verified against the running code, 2026-07-10)

- **Canvas** gets course/assignment/grade data from a completely different path than files do:
  `src/api/canvasSync.ts` + `canvas-module/canvasApi.ts`, running **in the web app**, calling
  Canvas's REST API directly with a **personal access token the student generates themselves**
  (Canvas → Account → Settings → New Access Token — a token Canvas exposes to any student
  self-serve). This has nothing to do with the browser extension.
- **D2L today** only gets data through `chrome-extension/background.js`'s `enumD2LSW`, and that
  function only enumerates **files** — it discards the course name (`o.Name`) and never touches
  assignments, due dates, or grades. That's why every D2L file lands with a
  `courseId "X" is not an app UUID and no uuid-keyed course row matched — ingesting unlinked`
  warning: no D2L course row is ever created for the ingest step to link against.
- There **is** proven-working D2L logic for this already in the repo, just in the now-dead
  `extension/shared-sync.js` (superseded 2026-07-02, see git log): it pulls course names via
  `/d2l/api/lp/{v}/enrollments/myenrollments/`, due dates via `dropbox/folders/` and `quizzes/`,
  and computed grades via `grades/categories/` + `grades/values/myGradeValues/`.
  ⚠️ **That grade-weight code has a known bug** (see memory: per-item weight uses the wrong
  denominator for "best N of M" drop schemes) — do not port it verbatim, fix it in the process.

## 3. The real open question: can a student self-serve a D2L API credential?

Canvas's whole approach depends on students being able to generate their own access token with
no institutional admin involved. **D2L/Brightspace does not universally offer this.** Valence API
access is typically either:
- OAuth 2.0, which requires the **institution** to register an app — not something we control, or
- Legacy App ID/Key + User ID/Key (HMAC), which *some* tenants expose to students under
  Account Settings → "Manage Extensibility," but many institutions disable this for students.

**This determines the whole architecture** and needs a real answer before building:
- If students *can* self-generate D2L keys → mirror the Canvas path exactly: new
  `src/api/d2lSync.ts` + `d2l-module/` + a `/api/d2l` proxy, independent of the extension.
- If they generally *can't* (the likely case for most schools) → the only viable path is
  **extending the existing browser extension**, since it already rides the student's live D2L
  session (cookie + XSRF token) with zero extra setup from the student — no key generation needed.

**Recommendation: build on the extension path.** It works today with zero additional student
action (proven — files are already flowing this way), whereas the token path has an unresolved
institutional dependency that could block the feature entirely for some/most schools.

## 4. Proposed implementation (extension-based path)

### 4a. Extension side — `chrome-extension/background.js`
- In `enumD2LSW`, **stop discarding `o.Name`** — return `{ id, name, code }` per course instead of
  just an id string.
- Port (with the weight-bug fixed) from `extension/shared-sync.js`:
  - Assignments + due dates: `dropbox/folders/` (`DueDate`) and `quizzes/` (`DueDate`).
  - Grades: `grades/categories/` + `grades/values/myGradeValues/`, computing each item's weight
    as `catWeight × (childMax / totalChildrenMax_excludingDropped)` — the denominator MUST exclude
    dropped items, unlike the old code.
  - Final grade override: `grades/final/values/myGradeValue/` when present.
- This is a second, parallel return shape (`courses`/`assignments` with real fields, not just
  `files`) — `enumerateSW`'s dispatch and `runFullSync`'s file-import loop stay as-is; add a new
  step that upserts courses/assignments the same run.

### 4b. Server side — `api/lms-ingest.ts` (or a new endpoint)
- Currently only handles file rows. Needs a course/assignment upsert path mirroring
  `ingestApiData` from the dead `extension/background.js` (already-solved reference code):
  upsert `courses` keyed on `(user_id, canvas_course_id)` using the D2L native id as
  `canvas_course_id` (same column Canvas uses — this is why the "unlinked" warning will
  **disappear on its own** once this ships: the file-linking lookup already tries this exact match,
  it just never finds a row today), then upsert `assignments` keyed similarly.

### 4c. Verify no Canvas-only assumptions downstream
- Spot-check the dashboard/assignments/grades UI and `api/tutor-context.ts` for anything that
  assumes Canvas-specific fields or a Canvas-only code path before considering this "done."

## 5. Effort / risk

- **Effort:** medium — most of the hard D2L API work already exists and is proven (dead
  extension code), so this is mostly porting + wiring + fixing the known weight bug, not new
  research. Still a real feature, not a bug-fix-sized change.
- **Risk:** D2L's LP/LE API version is auto-discovered per tenant and can silently mismatch
  (already hardened for the file path this session — same caution applies here).
- **Blocking risk:** section 3's open question. Worth a quick confirmation from Ryan/Johan on
  whether an institutional OAuth app is realistically on the table, since it changes the
  architecture — but the extension-based path doesn't need to wait on that answer either way.

## 6. Suggested next step

Confirm scope/priority (currently: asked Ryan, no response), then implement 4a → 4b → 4c in that
order — each step is independently testable against a real D2L course.

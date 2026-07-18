# BR-03 — Broaden University Brain Extraction — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `api/university-brain.ts` `contribute` from 2 → 5 extracted artifacts by pulling the assessment schedule, topic sequence, and posted-materials list from Canvas — all deterministic (no LLM), snapshot-upserted, and BR-01 compliant.

**Architecture:** Three pure formatters turn structured Canvas data into fact sentences; a new `upsertSnapshot()` helper keeps exactly one current row per `(school, course, type)` that this endpoint owns; three try/catch blocks in `contribute` wire the existing `canvasGET` + `trim.*` readers to those formatters. One idempotent migration adds the `assessment` content_type.

**Tech Stack:** TypeScript, Vercel serverless (`api/*.ts`), Supabase Postgres via PostgREST, vitest. Canvas REST via existing `api/_reggie/canvasLive.ts` helpers.

## Global Constraints

- **BR-01 (§9.2):** every artifact is a mechanical, professor-published COURSE fact. Quizzes contribute titles/dates/points only — NEVER questions or answers. No student data, no opinions.
- **Repo rule:** do NOT commit or push unless the user asks. The `Commit` steps below are the intended checkpoints; during execution, stage and pause for the user's go-ahead instead of auto-committing.
- **Migrations run by hand** in the Supabase SQL Editor — never from here.
- **api/ imports use `.js` extensions** even from `.ts` (ESM/Vercel). Keep this style.
- **After any non-trivial change:** `npm run build && npm run typecheck && npm test` must be green before "done."
- **No LLM** for the three new artifacts — deterministic formatting only.

---

### Task 1: Migration — add `assessment` content_type

**Files:**
- Create: `supabase-course-content-assessment-type-migration.sql`

**Interfaces:**
- Produces: the `assessment` value accepted by `course_content.content_type` (consumed by Task 4).

- [ ] **Step 1: Write the migration**

```sql
-- supabase-course-content-assessment-type-migration.sql
-- BR-03: add 'assessment' to the course_content content_type CHECK so the University Brain can
-- store a course's graded-work calendar as its own type (distinct from 'rubric' = grading weights).
-- Idempotent (drop-if-exists → add). No data change; existing rows unaffected.
-- Run in: Supabase Dashboard → SQL Editor → Run.
alter table public.course_content
  drop constraint if exists course_content_content_type_check;
alter table public.course_content
  add constraint course_content_content_type_check
  check (content_type in
    ('syllabus','lecture','rubric','announcement','module','file','assessment'));

notify pgrst, 'reload schema';
```

- [ ] **Step 2: Verify it's self-consistent (no run here)**

Confirm the CHECK list is the original six (`course-content-migration.sql:26`) **plus** `assessment`. This file is applied by the user in the dashboard, not from this environment.

- [ ] **Step 3: Commit** *(stage + pause per repo rule)*

```bash
git add supabase-course-content-assessment-type-migration.sql
git commit -m "feat(br-03): migration adding 'assessment' content_type"
```

---

### Task 2: Pure formatters + `fmtDate`

**Files:**
- Modify: `api/university-brain.ts` (add exported pure functions near the top, after `hashOf` at `:35`)
- Test: `test/university-brain.test.ts` (create)

**Interfaces:**
- Produces (consumed by Task 4):
  - `fmtDate(iso: string | null | undefined): string` — `"2026-10-03T..."` → `"Oct 3"`; falsy/invalid → `""`.
  - `formatAssessmentSchedule(courseLabel: string, items: { title: string; dueAt: string | null; points: number | null }[]): string | null`
  - `formatTopicSequence(courseLabel: string, modules: { name: string }[]): { text: string; concepts: string[] } | null`
  - `formatPostedMaterials(courseLabel: string, files: { name: string }[]): string | null`

- [ ] **Step 1: Write the failing tests**

```ts
// test/university-brain.test.ts
import { describe, it, expect, vi } from "vitest";

// university-brain imports _gateway/_auth/canvasLive; none build a client at load, but mock the
// LLM gateway defensively so importing never reaches network code.
vi.mock("../api/_gateway", () => ({ callModel: vi.fn(async () => ({ ok: false, content: "" })) }));

import {
  fmtDate, formatAssessmentSchedule, formatTopicSequence, formatPostedMaterials,
} from "../api/university-brain";

describe("fmtDate", () => {
  it("formats an ISO timestamp to 'Mon D' (UTC, deterministic)", () => {
    expect(fmtDate("2026-10-03T23:59:00Z")).toBe("Oct 3");
    expect(fmtDate("2026-01-09")).toBe("Jan 9");
  });
  it("returns '' for null/invalid", () => {
    expect(fmtDate(null)).toBe("");
    expect(fmtDate("not a date")).toBe("");
  });
});

describe("formatAssessmentSchedule", () => {
  it("merges + sorts by due date and includes points", () => {
    const out = formatAssessmentSchedule("BIO130", [
      { title: "Final", dueAt: "2026-12-12", points: 200 },
      { title: "Quiz 1", dueAt: "2026-10-03", points: 20 },
    ]);
    expect(out).toBe("BIO130 assessment schedule: Quiz 1 (Oct 3, 20 pts); Final (Dec 12, 200 pts).");
  });
  it("returns null when there are no items", () => {
    expect(formatAssessmentSchedule("BIO130", [])).toBe(null);
  });
  it("BR-01: never emits any field other than title/date/points (a leaked question stays out)", () => {
    const out = formatAssessmentSchedule("BIO130", [
      { title: "Quiz 1", dueAt: "2026-10-03", points: 20, question: "What is ATP?", answer: "energy" } as any,
    ]);
    expect(out).not.toContain("ATP");
    expect(out).not.toContain("energy");
  });
});

describe("formatTopicSequence", () => {
  it("numbers module names and returns them as concepts", () => {
    const out = formatTopicSequence("BIO130", [{ name: "Cell structure" }, { name: "Membranes" }]);
    expect(out).toEqual({
      text: "BIO130 topic sequence: 1. Cell structure · 2. Membranes.",
      concepts: ["Cell structure", "Membranes"],
    });
  });
  it("returns null when there are no modules", () => {
    expect(formatTopicSequence("BIO130", [])).toBe(null);
  });
});

describe("formatPostedMaterials", () => {
  it("joins deduped file names", () => {
    expect(formatPostedMaterials("BIO130", [{ name: "L1.pdf" }, { name: "L1.pdf" }, { name: "Lab.pdf" }]))
      .toBe("BIO130 posted materials: L1.pdf, Lab.pdf.");
  });
  it("returns null when there are no files", () => {
    expect(formatPostedMaterials("BIO130", [])).toBe(null);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- university-brain`
Expected: FAIL — `fmtDate`/`formatAssessmentSchedule`/… are not exported.

- [ ] **Step 3: Implement the formatters** (in `api/university-brain.ts`, right after `hashOf` at `:35`)

```ts
// ── BR-03 formatters (pure, deterministic — no LLM, no I/O) ──────────────────
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

/** ISO timestamp → "Oct 3" (UTC, deterministic). Falsy/invalid → "". */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
  if (!m) return "";
  const mon = MONTHS[Number(m[2]) - 1];
  return mon ? `${mon} ${Number(m[3])}` : "";
}

/** Merge assignments + quizzes into one dated schedule sentence. Only ever reads title/dueAt/points
 *  — any other field on an item (e.g. a quiz's question/answer) is unreachable here (BR-01). */
export function formatAssessmentSchedule(
  courseLabel: string,
  items: { title: string; dueAt: string | null; points: number | null }[],
): string | null {
  const clean = (items ?? [])
    .filter((i) => i && i.title)
    .map((i) => ({ title: String(i.title).trim(), dueAt: i.dueAt ?? null, points: i.points ?? null }))
    .sort((a, b) => (a.dueAt ?? "~").localeCompare(b.dueAt ?? "~")); // undated sorts last
  if (!clean.length) return null;
  const parts = clean.map((i) => {
    const meta = [fmtDate(i.dueAt), i.points != null ? `${i.points} pts` : ""].filter(Boolean).join(", ");
    return meta ? `${i.title} (${meta})` : i.title;
  });
  return `${courseLabel} assessment schedule: ${parts.join("; ")}.`;
}

/** Module names → numbered topic sequence + concepts[] (the topic titles). */
export function formatTopicSequence(
  courseLabel: string,
  modules: { name: string }[],
): { text: string; concepts: string[] } | null {
  const names = (modules ?? []).filter((m) => m && m.name).map((m) => String(m.name).trim());
  const concepts = [...new Set(names)].slice(0, 40);
  if (!concepts.length) return null;
  const text = `${courseLabel} topic sequence: ${concepts.map((n, i) => `${i + 1}. ${n}`).join(" · ")}.`;
  return { text, concepts };
}

/** Published file names → materials list sentence. Names only (BR-01: never file contents). */
export function formatPostedMaterials(
  courseLabel: string,
  files: { name: string }[],
): string | null {
  const names = [...new Set((files ?? []).filter((f) => f && f.name).map((f) => String(f.name).trim()))].slice(0, 60);
  if (!names.length) return null;
  return `${courseLabel} posted materials: ${names.join(", ")}.`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- university-brain`
Expected: PASS (all formatter + fmtDate tests green).

- [ ] **Step 5: Commit** *(stage + pause per repo rule)*

```bash
git add api/university-brain.ts test/university-brain.test.ts
git commit -m "feat(br-03): pure formatters for assessment/topic/materials artifacts"
```

---

### Task 3: `upsertSnapshot` helper

**Files:**
- Modify: `api/university-brain.ts` (add after `upsertArtifact` at `:60`)
- Test: `test/university-brain.test.ts` (extend)

**Interfaces:**
- Consumes: `sb()` (`:27`), `hashOf` (`:34`).
- Produces (consumed by Task 4):
  `upsertSnapshot(row: { university_id: string; course_id: string; canvas_course_id: string; content_type: string; text: string; professor_name: string | null; summary: string | null; concepts: string[] | null }): Promise<{ id: any; replaced: boolean }>`

- [ ] **Step 1: Write the failing test** (append to `test/university-brain.test.ts`)

```ts
import { upsertSnapshot } from "../api/university-brain";

describe("upsertSnapshot", () => {
  const row = {
    university_id: "q.utoronto.ca", course_id: "BIO130", canvas_course_id: "123",
    content_type: "assessment", text: "sched v1", professor_name: "Prof X", summary: "sched v1", concepts: null,
  };
  beforeEach(() => {
    process.env.SUPABASE_URL = "http://localhost";
    process.env.SUPABASE_SERVICE_KEY = "test";
  });

  it("INSERTs when this endpoint has no existing row for the tuple", async () => {
    const calls: { method: string; url: string; body?: any }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, opts: any = {}) => {
      calls.push({ method: opts.method ?? "GET", url: String(url), body: opts.body && JSON.parse(opts.body) });
      if ((opts.method ?? "GET") === "GET") return { ok: true, json: async () => [] };          // select → none
      return { ok: true, json: async () => [{ id: "new-1" }], text: async () => "" };            // insert
    }));
    const out = await upsertSnapshot(row);
    expect(out).toEqual({ id: "new-1", replaced: false });
    const insert = calls.find((c) => c.method === "POST");
    expect(insert?.body.source_url).toBe("university-brain");   // ownership sentinel
    vi.unstubAllGlobals();
  });

  it("PATCHes the existing owned row (never a 2nd row) on re-contribute", async () => {
    const calls: { method: string }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, opts: any = {}) => {
      calls.push({ method: opts.method ?? "GET" });
      if ((opts.method ?? "GET") === "GET") return { ok: true, json: async () => [{ id: "row-9" }] }; // select → hit
      return { ok: true, json: async () => [], text: async () => "" };                                // patch
    }));
    const out = await upsertSnapshot({ ...row, text: "sched v2" });
    expect(out).toEqual({ id: "row-9", replaced: true });
    expect(calls.some((c) => c.method === "PATCH")).toBe(true);
    expect(calls.some((c) => c.method === "POST")).toBe(false);  // no insert → no duplicate
    vi.unstubAllGlobals();
  });
});
```

(Add `beforeEach` to the existing import: `import { describe, it, expect, vi, beforeEach } from "vitest";`.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- university-brain`
Expected: FAIL — `upsertSnapshot` is not exported.

- [ ] **Step 3: Implement `upsertSnapshot`** (after `upsertArtifact` at `:60` in `api/university-brain.ts`)

```ts
const UB_SOURCE = "university-brain"; // sentinel: rows THIS endpoint owns (never clobber extension rows)

/** Snapshot upsert: exactly one current row per (university_id, course_id, content_type) that this
 *  endpoint owns (source_url = UB_SOURCE). Replaces on re-contribute; never duplicates, never touches
 *  extension-written rows of the same type. content_hash is namespaced ("snapshot:<type>") so it can
 *  never collide with an extension/artifact hash on the UNIQUE content_hash index. */
async function upsertSnapshot(row: {
  university_id: string; course_id: string; canvas_course_id: string; content_type: string;
  text: string; professor_name: string | null; summary: string | null; concepts: string[] | null;
}): Promise<{ id: any; replaced: boolean }> {
  const { url, headers } = sb();
  const content_hash = hashOf(row.university_id, row.course_id, `snapshot:${row.content_type}`, row.text);
  const body = { ...row, content_hash, source_url: UB_SOURCE, is_private: false,
    text: row.text.slice(0, 50000), last_seen_at: new Date().toISOString() };
  const q = `${url}/rest/v1/course_content?university_id=eq.${encodeURIComponent(row.university_id)}` +
            `&course_id=eq.${encodeURIComponent(row.course_id)}` +
            `&content_type=eq.${encodeURIComponent(row.content_type)}` +
            `&source_url=eq.${encodeURIComponent(UB_SOURCE)}&select=id&limit=1`;
  const hit = ((await (await fetch(q, { headers })).json().catch(() => [])) as any[])[0];
  if (hit) {
    const upd = await fetch(`${url}/rest/v1/course_content?id=eq.${hit.id}`,
      { method: "PATCH", headers, body: JSON.stringify(body) });
    if (!upd.ok) throw new Error(`snapshot update failed (${upd.status}): ${(await upd.text()).slice(0, 200)}`);
    return { id: hit.id, replaced: true };
  }
  const ins = await fetch(`${url}/rest/v1/course_content`,
    { method: "POST", headers: { ...headers, Prefer: "return=representation" }, body: JSON.stringify(body) });
  if (!ins.ok) throw new Error(`snapshot insert failed (${ins.status}): ${(await ins.text()).slice(0, 200)}`);
  return { id: ((await ins.json()) as any[])[0]?.id, replaced: false };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- university-brain`
Expected: PASS (INSERT path sets `source_url`; re-contribute PATCHes, no 2nd row).

- [ ] **Step 5: Commit** *(stage + pause per repo rule)*

```bash
git add api/university-brain.ts test/university-brain.test.ts
git commit -m "feat(br-03): upsertSnapshot with ownership sentinel + namespaced hash"
```

---

### Task 4: Wire the three artifacts into `contribute`

**Files:**
- Modify: `api/university-brain.ts` — import `trim`; add three blocks in `contribute` after Artifact 2 (`:115`)

**Interfaces:**
- Consumes: `canvasGET` + `trim` (`canvasLive.ts`), `formatAssessmentSchedule` / `formatTopicSequence` / `formatPostedMaterials` (Task 2), `upsertSnapshot` (Task 3).
- Produces: three new entries in the `contributed[]` response array (`{ type, id, replaced }`).

- [ ] **Step 1: Add `trim` to the canvasLive import** (`api/university-brain.ts:24`)

```ts
import { canvasCreds, canvasGET, resolveCanvasCourseId, stripHtml, trim, userUniversityId } from "./_reggie/canvasLive.js";
```

- [ ] **Step 2: Add the three artifact blocks** in `contribute`, immediately after the grading-structure block ends (`:115`, before the `if (!contributed.length)` check)

```ts
  // Artifact 3: assessment schedule (assignments + quizzes — published dates/points only).
  try {
    const [assignments, quizzes] = await Promise.all([
      canvasGET(creds, `/courses/${canvasCourseId}/assignments`, { per_page: 100 }).catch(() => []),
      canvasGET(creds, `/courses/${canvasCourseId}/quizzes`, { per_page: 100 }).catch(() => []),
    ]);
    const items = [
      ...((assignments ?? []) as any[]).map((a) => ({ title: a.name, dueAt: a.due_at ?? null, points: a.points_possible ?? null })),
      ...trim.quizzes(quizzes ?? []).map((q) => ({ title: q.title, dueAt: q.dueAt, points: q.points })),
    ];
    const text = formatAssessmentSchedule(courseKey, items);
    if (text) contributed.push({ type: "assessment", ...(await upsertSnapshot({
      university_id: universityId, course_id: courseKey, canvas_course_id: String(canvasCourseId),
      content_type: "assessment", text, professor_name: professor, summary: text.slice(0, 300), concepts: null,
    })) });
  } catch { /* assignments/quizzes tab restricted — other artifacts still contribute */ }

  // Artifact 4: topic sequence (module structure — published course map).
  try {
    const modules = await canvasGET(creds, `/courses/${canvasCourseId}/modules`, { "include[]": "items", per_page: 50 });
    const seq = formatTopicSequence(courseKey, trim.modules(modules ?? []));
    if (seq) contributed.push({ type: "module", ...(await upsertSnapshot({
      university_id: universityId, course_id: courseKey, canvas_course_id: String(canvasCourseId),
      content_type: "module", text: seq.text, professor_name: professor, summary: seq.text.slice(0, 300), concepts: seq.concepts,
    })) });
  } catch { /* modules tab restricted */ }

  // Artifact 5: posted materials (published file names only — an index, not contents).
  try {
    const files = await canvasGET(creds, `/courses/${canvasCourseId}/files`, { per_page: 50 });
    const text = formatPostedMaterials(courseKey, trim.files(files ?? []).map((f: any) => ({ name: f.name })));
    if (text) contributed.push({ type: "file", ...(await upsertSnapshot({
      university_id: universityId, course_id: courseKey, canvas_course_id: String(canvasCourseId),
      content_type: "file", text, professor_name: professor, summary: text.slice(0, 300), concepts: null,
    })) });
  } catch { /* files tab restricted */ }
```

- [ ] **Step 3: Verify build + typecheck + full suite**

Run: `npm run build && npm run typecheck && npm test`
Expected: build clean, no type errors, all tests pass (incl. Task 2/3 + existing 667).

- [ ] **Step 4: Commit** *(stage + pause per repo rule)*

```bash
git add api/university-brain.ts
git commit -m "feat(br-03): contribute assessment schedule, topic sequence, posted materials"
```

---

### Task 5: Live verification (after the user runs the migration)

**Files:** none (manual).

- [ ] **Step 1:** User applies `supabase-course-content-assessment-type-migration.sql` in the Supabase SQL Editor.
- [ ] **Step 2:** One real `contribute` (POST `api/university-brain?action=contribute` with a UofT course) → response `contributed[]` includes `assessment`, `module`, `file` entries.
- [ ] **Step 3:** In the DB, confirm exactly one `source_url='university-brain'` row per new `content_type` for that `(university_id, course_id)`.
- [ ] **Step 4:** Re-run the same contribute → the three rows are **replaced** (`replaced:true`), not duplicated (row count unchanged).

---

## Self-Review

**Spec coverage:** §3 three artifacts → Tasks 2+4; §4a migration → Task 1; §4b no-LLM → Task 2 (pure fns); §4c snapshot + ownership sentinel → Task 3; §5 stored shapes → Task 2 assertions; §8 BR-01 → Task 2 leak test + titles/dates/points-only mapping; §10 testing → Tasks 2/3 unit + Task 5 live. No uncovered requirement.

**Placeholder scan:** none — every step has concrete code/SQL/commands.

**Type consistency:** `upsertSnapshot` signature identical in Task 3 (definition) and Task 4 (call sites); formatter signatures identical in Task 2 (def) and Task 4 (calls); `trim.quizzes`/`trim.modules`/`trim.files` shapes match `canvasLive.ts:160/154/178`.

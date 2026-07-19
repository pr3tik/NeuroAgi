# BR-06 Course Brain Isolation Proof — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce, at every server write boundary, that person-scoped data can never enter the shared `course_content` table.

**Architecture:** A single pure guard `assertCourseFact(input)` rebuilds each outgoing `course_content` row from a field allowlist, enforces the `content_type` allowlist, and fail-closed rejects person-linking keys / `is_private:true` / person-data text patterns. It is wired into all three write doors (`university-brain.ts`, `extension-content.ts`, `extension-sync.ts`). The raw-text scrape door is additionally routed through the guard and flagged for deprecation.

**Tech Stack:** TypeScript, Vercel serverless (`api/*.ts`), Supabase/PostgREST, Vitest.

## Global Constraints

- **Repo rule — DO NOT commit or push unless Vivek asks.** The `git commit` steps below mark intended checkpoints; hold them (or batch into one commit) until Vivek approves.
- `api/` imports use **`.js`** extensions even from `.ts` (ESM on Vercel). Test files import **without** `.js`.
- Lenient tsconfig (`strict:false`, `noImplicitAny:false`) — `: any` params are fine.
- `course_content` columns (the entire allowlist): `university_id, course_id, canvas_course_id, content_type, content_hash, text, summary, concepts, week_number, module_name, professor_name, source_url, seen_by_count, is_private, last_seen_at`.
- `content_type` allowlist (matches the DB CHECK from BR-03): `syllabus | lecture | rubric | announcement | module | file | assessment`.
- Run the whole suite with `npm test`; single file with `npx vitest run test/<file>`. Baseline: **678 passing / 6 skipped** — must stay green.

---

### Task 1: Guard module — structural checks (field + content_type + person-keys + is_private)

**Files:**
- Create: `api/course-fact-guard.ts`
- Test: `test/course-fact-guard.test.ts`

**Interfaces:**
- Produces: `assertCourseFact(input: Record<string, unknown>): Record<string, unknown>` — returns a rebuilt allowlisted row or throws `CourseFactRejected`. `class CourseFactRejected extends Error { reason: string }`.

- [ ] **Step 1: Write the failing tests**

```ts
// test/course-fact-guard.test.ts
import { describe, it, expect } from "vitest";
import { assertCourseFact, CourseFactRejected } from "../api/course-fact-guard";

const base = {
  university_id: "q.utoronto.ca", course_id: "BIO130", canvas_course_id: "123",
  content_type: "syllabus", content_hash: "abc",
  text: "Grading breakdown: midterm 40%, final 60%. Office hours Tue 2pm.",
};

describe("assertCourseFact — field allowlist", () => {
  it("drops non-allowlisted keys, keeps allowlisted ones", () => {
    const out = assertCourseFact({ ...base, bogus: "x", internal_note: "y" });
    expect(out).not.toHaveProperty("bogus");
    expect(out).not.toHaveProperty("internal_note");
    expect(out.university_id).toBe("q.utoronto.ca");
    expect(out.content_hash).toBe("abc");
  });
  it("rejects person-linking keys (mis-routed person payload)", () => {
    expect(() => assertCourseFact({ ...base, user_id: "u1" })).toThrow(CourseFactRejected);
    expect(() => assertCourseFact({ ...base, score: 18 })).toThrow(CourseFactRejected);
    expect(() => assertCourseFact({ ...base, submitted_at: "2026-01-01" })).toThrow(CourseFactRejected);
    expect(() => assertCourseFact({ ...base, submission_id: "s1" })).toThrow(CourseFactRejected);
  });
});

describe("assertCourseFact — content_type allowlist", () => {
  it("passes every allowed type", () => {
    for (const ct of ["syllabus","lecture","rubric","announcement","module","file","assessment"])
      expect(assertCourseFact({ ...base, content_type: ct }).content_type).toBe(ct);
  });
  it("rejects an unknown type", () => {
    expect(() => assertCourseFact({ ...base, content_type: "grades" })).toThrow(CourseFactRejected);
    expect(() => assertCourseFact({ ...base, content_type: undefined })).toThrow(CourseFactRejected);
  });
});

describe("assertCourseFact — is_private", () => {
  it("forces is_private=false on clean input", () => {
    expect(assertCourseFact(base).is_private).toBe(false);
  });
  it("rejects an explicit is_private=true", () => {
    expect(() => assertCourseFact({ ...base, is_private: true })).toThrow(CourseFactRejected);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/course-fact-guard.test.ts`
Expected: FAIL — `Cannot find module '../api/course-fact-guard'`.

- [ ] **Step 3: Write the minimal implementation (structural only)**

```ts
// api/course-fact-guard.ts
// BR-06 write-boundary guard: the ONLY sanctioned gate for writes to the shared
// course_content table. Rebuilds each row from an allowlist and fail-closed rejects
// anything that looks person-scoped. Pure + dependency-free so it's trivially testable.

export class CourseFactRejected extends Error {
  constructor(public reason: string) {
    super(`course_content write rejected: ${reason}`);
    this.name = "CourseFactRejected";
  }
}

const ALLOWED_FIELDS = [
  "university_id", "course_id", "canvas_course_id", "content_type", "content_hash",
  "text", "summary", "concepts", "week_number", "module_name", "professor_name",
  "source_url", "seen_by_count", "is_private", "last_seen_at",
] as const;

const ALLOWED_CONTENT_TYPES = new Set([
  "syllabus", "lecture", "rubric", "announcement", "module", "file", "assessment",
]);

// Bare column names that only appear on PERSON tables — their presence signals a
// mis-routed person payload, so we reject rather than silently drop.
const PERSON_LINKING_KEYS = new Set([
  "user_id", "person_id", "student_name", "score", "grade", "submitted_at",
]);

export function assertCourseFact(input: Record<string, unknown>): Record<string, unknown> {
  if (!input || typeof input !== "object") throw new CourseFactRejected("not an object");

  // 1. person-linking keys → reject
  for (const k of Object.keys(input)) {
    if (PERSON_LINKING_KEYS.has(k) || /^submission/i.test(k)) {
      throw new CourseFactRejected(`person-linking key present: ${k}`);
    }
  }

  // 2. content_type allowlist
  const ct = input.content_type;
  if (typeof ct !== "string" || !ALLOWED_CONTENT_TYPES.has(ct)) {
    throw new CourseFactRejected(`content_type not allowed: ${String(ct)}`);
  }

  // 3. is_private must not be true — the guard writes professor facts only
  if (input.is_private === true || input.is_private === "true") {
    throw new CourseFactRejected("is_private:true not permitted in shared table");
  }

  // 4. rebuild from allowlist + force is_private=false
  const clean: Record<string, unknown> = {};
  for (const f of ALLOWED_FIELDS) {
    if (f in input && (input as any)[f] !== undefined) clean[f] = (input as any)[f];
  }
  clean.is_private = false;
  return clean;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/course-fact-guard.test.ts`
Expected: PASS (all structural tests green).

- [ ] **Step 5: Commit** *(hold per Global Constraints)*

```bash
git add api/course-fact-guard.ts test/course-fact-guard.test.ts
git commit -m "feat(br-06): course_content write guard — structural allowlist"
```

---

### Task 2: Guard — person-data text screen (heuristic)

**Files:**
- Modify: `api/course-fact-guard.ts`
- Test: `test/course-fact-guard.test.ts` (append)

**Interfaces:**
- Consumes/Produces: same `assertCourseFact` signature; now also throws on person-data text patterns in `text`/`summary`.

- [ ] **Step 1: Write the failing tests (append to the file)**

```ts
describe("assertCourseFact — person-data text screen", () => {
  it("rejects numeric grade patterns", () => {
    expect(() => assertCourseFact({ ...base, text: "Assignment 1 score 18/20" })).toThrow(CourseFactRejected);
    expect(() => assertCourseFact({ ...base, text: "Your grade: 82% on the midterm" })).toThrow(CourseFactRejected);
  });
  it("rejects submission / result language", () => {
    expect(() => assertCourseFact({ ...base, text: "You submitted at 11:59pm — late submission" })).toThrow(CourseFactRejected);
    expect(() => assertCourseFact({ ...base, text: "your submission was received" })).toThrow(CourseFactRejected);
  });
  it("passes clean professor text — incl. 'you will submit' and a grading breakdown", () => {
    expect(() => assertCourseFact({ ...base, text: "You will submit assignments online via the portal." })).not.toThrow();
    expect(() => assertCourseFact({ ...base, text: "Grading breakdown: midterm 40%, final 60%, participation 10%." })).not.toThrow();
    expect(() => assertCourseFact({ ...base, text: "Topics: cells, membranes, ATP. Midterm covers weeks 1-6." })).not.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `npx vitest run test/course-fact-guard.test.ts -t "person-data text screen"`
Expected: FAIL — the "rejects…" cases currently pass through (no screen yet).

- [ ] **Step 3: Add the text screen**

Insert these patterns after the `PERSON_LINKING_KEYS` constant:

```ts
// High-signal person-data text patterns. Deliberately narrow so professor facts
// (grading breakdowns, "you will submit online") still pass.
const PERSON_TEXT_PATTERNS: RegExp[] = [
  /\byour\s+(grade|score|submission|mark)\b/i,
  /\byou\s+(scored|submitted|received)\b/i,
  /\bsubmitted\s+(at|on)\b/i,
  /\blate\s+submission\b/i,
  /\b\d{1,3}\s*\/\s*\d{1,3}\b.{0,20}\b(score|grade|points|mark|result)\b/i,
  /\b(score|grade|points|mark|result)\b.{0,20}\b\d{1,3}\s*\/\s*\d{1,3}\b/i,
  /\byour\b.{0,20}\b\d{1,3}\s?%/i,
];
```

Then insert this block into `assertCourseFact` **between step 3 (is_private) and step 4 (rebuild)**:

```ts
  // 3b. person-data text screen (defense-in-depth, heuristic)
  const text = typeof input.text === "string" ? input.text : "";
  const summary = typeof input.summary === "string" ? input.summary : "";
  const haystack = `${text}\n${summary}`;
  for (const re of PERSON_TEXT_PATTERNS) {
    if (re.test(haystack)) throw new CourseFactRejected(`person-data text pattern: ${re}`);
  }
```

- [ ] **Step 4: Run the full guard test file to verify all pass**

Run: `npx vitest run test/course-fact-guard.test.ts`
Expected: PASS (structural + text-screen).

- [ ] **Step 5: Commit** *(hold per Global Constraints)*

```bash
git add api/course-fact-guard.ts test/course-fact-guard.test.ts
git commit -m "feat(br-06): add person-data text screen to course_content guard"
```

---

### Task 3: Wire the guard into `university-brain.ts`

**Files:**
- Modify: `api/university-brain.ts` (import + `upsertArtifact` insert `:106-109` + `upsertSnapshot` body `:126-129`)
- Test: `test/university-brain.test.ts` (append)

**Interfaces:**
- Consumes: `assertCourseFact` from `./course-fact-guard.js`.

- [ ] **Step 1: Write the failing test (append to `test/university-brain.test.ts`)**

```ts
describe("BR-06: upsertSnapshot routes through the guard", () => {
  const cleanRow = {
    university_id: "q.utoronto.ca", course_id: "BIO130", canvas_course_id: "123",
    content_type: "assessment", text: "sched v1", professor_name: "Prof X", summary: "sched v1", concepts: null,
  };
  beforeEach(() => {
    process.env.SUPABASE_URL = "http://localhost";
    process.env.SUPABASE_SERVICE_KEY = "test";
  });
  it("rejects a snapshot whose text carries person data — no POST", async () => {
    const methods: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, opts: any = {}) => {
      methods.push(opts.method ?? "GET");
      return { ok: true, json: async () => [], text: async () => "" };
    }));
    await expect(
      upsertSnapshot({ ...cleanRow, text: "Your grade: 18/20 on the midterm" } as any),
    ).rejects.toThrow(/rejected/);
    expect(methods.includes("POST")).toBe(false);
    vi.unstubAllGlobals();
  });
});
```

*(Self-contained: its own `cleanRow` fixture + env `beforeEach` so it doesn't depend on the `upsertSnapshot` describe block's scope. `beforeEach` is already imported at the top of this test file.)*

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/university-brain.test.ts -t "routes through the guard"`
Expected: FAIL — the tainted snapshot is currently written (a POST is recorded / no throw).

- [ ] **Step 3: Wire the guard in**

Add the import near the other `./` imports at the top of `api/university-brain.ts`:

```ts
import { assertCourseFact } from "./course-fact-guard.js";
```

In `upsertArtifact`, replace the insert body (`:106-109`):

```ts
  const insertRow = assertCourseFact({ ...row, content_hash, is_private: false, text: row.text.slice(0, 50000), last_seen_at: new Date().toISOString() });
  const ins = await fetch(`${url}/rest/v1/course_content`, {
    method: "POST", headers: { ...headers, Prefer: "return=representation" },
    body: JSON.stringify(insertRow),
  });
```

In `upsertSnapshot`, replace the `const body = {...}` assignment (`:126-129`):

```ts
  const body = assertCourseFact({
    ...row, content_hash, source_url: UB_SOURCE, is_private: false,
    text: row.text.slice(0, 50000), last_seen_at: new Date().toISOString(),
  });
```

- [ ] **Step 4: Run the whole file to verify pass + no regression**

Run: `npx vitest run test/university-brain.test.ts`
Expected: PASS — the new guard test passes AND all existing tests (incl. the BR-01 leak test, `upsertSnapshot` INSERT/PATCH tests) stay green.

- [ ] **Step 5: Commit** *(hold per Global Constraints)*

```bash
git add api/university-brain.ts test/university-brain.test.ts
git commit -m "feat(br-06): route university-brain writes through course_content guard"
```

---

### Task 4: Wire the guard into `extension-content.ts` + deprecation flag

**Files:**
- Modify: `api/extension-content.ts` (import + guard after `buildContentHash` `:126` + insert `:159-175` + deprecation header)
- Test: `test/extension-content.test.ts` (append)

**Interfaces:**
- Consumes: `assertCourseFact`, `CourseFactRejected` from `./course-fact-guard.js`.

- [ ] **Step 1: Write the failing test (append inside the existing handler describe block)**

```ts
it("BR-06: rejects a scrape whose text carries person data — no insert", async () => {
  const { handler, calls } = await loadHandler((ctx) => {
    if (ctx.table === "course_content" && ctx.op === "select") return { data: null, error: null };
    if (ctx.table === "course_content" && ctx.op === "insert") return { data: { id: "new-1" }, error: null };
    return { data: null, error: null };
  });
  const res = makeRes();
  await handler(post({ ...ok, text: "Your grade: 18/20. You submitted at 11:59pm — late submission." }), res);
  expect(res.body.status).toBe("rejected");
  expect(calls.some(c => c.table === "course_content" && c.op === "insert")).toBe(false);
});
```

*(`ok` and `post`/`loadHandler`/`makeRes` are already defined in this test file. `ok` must have a valid `contentType` so it passes the existing 400 check and reaches the guard.)*

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/extension-content.test.ts -t "carries person data"`
Expected: FAIL — the tainted scrape is inserted (`res.body.status` is `"created"`, an insert is recorded).

- [ ] **Step 3: Wire the guard in**

Add the import near the top of `api/extension-content.ts`:

```ts
import { assertCourseFact, CourseFactRejected } from "./course-fact-guard.js";
```

Immediately after `const contentHash = buildContentHash(...)` (`:126`), insert:

```ts
  // BR-06: guard the row before any DB op. Rebuilds from allowlist + screens person data.
  let guardedRow: Record<string, unknown>;
  try {
    guardedRow = assertCourseFact({
      university_id: universityId, course_id: normalizedCourseKey, canvas_course_id: canvasCourseId || null,
      content_type: contentType, content_hash: contentHash, text: text.slice(0, 50000),
      week_number: weekNumber || null, module_name: moduleName || fileName || null,
      professor_name: professorName || null, source_url: sourceUrl || null, seen_by_count: 1,
    });
  } catch (e) {
    if (e instanceof CourseFactRejected) {
      console.warn("[extension-content] BR-06 guard rejected write:", e.reason);
      return res.status(200).json({ status: "rejected", reason: "content_screen", contentHash });
    }
    throw e;
  }
```

Replace the insert object (`:159-175`) so it writes the guarded row:

```ts
  const { data: inserted, error: insertErr } = await supabase
    .from("course_content")
    .insert(guardedRow)
    .select("id")
    .single();
```

Add the deprecation signal near the start of the handler (right after the method/CORS guards, before the body is processed):

```ts
  // BR-06: this raw-text scrape door is slated for removal (410) once callers are confirmed gone.
  res.setHeader("Deprecation", "true");
  console.warn("[extension-content] DEPRECATED (BR-06) — pending 410; use the API-first sync path.");
```

- [ ] **Step 4: Run the whole file to verify pass + no regression**

Run: `npx vitest run test/extension-content.test.ts`
Expected: PASS — the rejection test passes AND the existing `already_exists` / `created` tests stay green (the clean `ok` payload passes the guard unchanged).

- [ ] **Step 5: Commit** *(hold per Global Constraints)*

```bash
git add api/extension-content.ts test/extension-content.test.ts
git commit -m "feat(br-06): guard extension-content writes + flag endpoint deprecated"
```

---

### Task 5: Wire the guard into `extension-sync.ts` (`upsert_course_content`, per-row fail-closed)

**Files:**
- Modify: `api/extension-sync.ts` (import + `upsert_course_content` case `:141-150`)
- Test: Create `test/extension-sync.test.ts`

**Interfaces:**
- Consumes: `assertCourseFact`, `CourseFactRejected` from `./course-fact-guard.js`.

- [ ] **Step 1: Write the failing test**

```ts
// test/extension-sync.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { makeSupabaseMock, makeRes } from "./helpers";

vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }));
import { createClient } from "@supabase/supabase-js";

beforeEach(() => {
  process.env.SUPABASE_URL = "http://localhost";
  process.env.SUPABASE_SERVICE_KEY = "test";
});
afterEach(() => vi.unstubAllGlobals());

async function loadHandler(router: (ctx: any) => any) {
  const { client, calls } = makeSupabaseMock(router);
  vi.resetModules();
  (createClient as any).mockReturnValue(client);
  const mod = await import("../api/extension-sync.ts");
  return { handler: mod.default, calls };
}

// Router: auth (users select) passes; course_content upsert echoes success.
const router = (ctx: any) => {
  if (ctx.table === "users" && ctx.op === "select") return { data: { id: "u1", email: "a@b.c" }, error: null };
  return { data: null, error: null };
};

describe("extension-sync upsert_course_content — BR-06 guard", () => {
  it("drops person-tainted rows, upserts only clean ones", async () => {
    const { handler, calls } = await loadHandler(router);
    const res = makeRes();
    await handler({ method: "POST", body: {
      userId: "u1", action: "upsert_course_content",
      rows: [
        { university_id: "q.utoronto.ca", course_id: "BIO130", canvas_course_id: "1", content_type: "syllabus", content_hash: "h1", text: "Grading: midterm 40%, final 60%." },
        { university_id: "q.utoronto.ca", course_id: "BIO130", canvas_course_id: "1", content_type: "syllabus", content_hash: "h2", text: "Your grade: 18/20", user_id: "someone" },
      ],
    } }, res);
    expect(res.body.ok).toBe(true);
    expect(res.body.count).toBe(1);
    expect(res.body.dropped).toBe(1);
    const upserts = calls.filter(c => c.table === "course_content" && c.op === "upsert");
    expect(upserts.length).toBe(1);
    expect(upserts[0].payload).toHaveLength(1);            // only the clean row
    expect(upserts[0].payload[0]).not.toHaveProperty("user_id");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/extension-sync.test.ts`
Expected: FAIL — currently both rows upsert verbatim (`count` is 2, no `dropped`, `user_id` present).

- [ ] **Step 3: Wire the guard in**

Add the import near the top of `api/extension-sync.ts`:

```ts
import { assertCourseFact, CourseFactRejected } from "./course-fact-guard.js";
```

Replace the `upsert_course_content` case (`:141-150`) with:

```ts
      // ── course_content (shared library) ─────────────────────────────────
      case "upsert_course_content": {
        const { rows } = payload;
        if (!Array.isArray(rows)) return res.status(400).json({ error: "rows[] required" });
        // BR-06: every row must pass the shared-write guard. Fail-closed per row.
        const clean: Record<string, unknown>[] = [];
        let dropped = 0;
        for (const r of rows) {
          try { clean.push(assertCourseFact(r)); }
          catch (e) {
            if (e instanceof CourseFactRejected) { dropped++; console.warn("[extension-sync] BR-06 dropped row:", e.reason); }
            else throw e;
          }
        }
        if (clean.length) {
          const { error } = await supabase
            .from("course_content")
            .upsert(clean, { onConflict: "canvas_course_id,content_hash" });
          if (error) throw error;
        }
        return res.status(200).json({ ok: true, count: clean.length, dropped });
      }
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run test/extension-sync.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit** *(hold per Global Constraints)*

```bash
git add api/extension-sync.ts test/extension-sync.test.ts
git commit -m "feat(br-06): guard extension-sync upsert_course_content per-row"
```

---

### Task 6: Full-suite verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: **all prior tests green + the new BR-06 tests**; count ≥ 678 passing / 6 skipped, zero failures. Confirm the BR-01 leak test (in `test/university-brain.test.ts`) is still green.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: build succeeds (catches import/resolve errors — verifies the `.js` guard import resolves).

- [ ] **Step 4: Commit** *(hold per Global Constraints — likely the single squash point)*

```bash
git commit --allow-empty -m "test(br-06): full suite + typecheck + build green"
```

---

## Self-Review

**Spec coverage** (against `BR-06-ISOLATION-PROOF-SPEC.md`):
- §4a field allowlist → Task 1. §4b content_type allowlist → Task 1. §4a person-linking keys + is_private → Task 1. §4c text screen → Task 2. §2/§4 wiring all three doors → Tasks 3–5. §5 close scrape door (guard + deprecation flag) → Task 4. §6 proof battery (unit + per-door routing + BR-01 leak test folded via Task 3/6) → Tasks 1–6.
- **Out of scope (correctly absent):** §8 live staging proof (blocked), full architectural lockdown, legacy `is_private=true` cleanup, and the `410` flip (deferred until callers confirmed gone — Task 4 only sets the Deprecation header + warning).
- **Layer-1 written threat-model** = the spec doc itself (already written); no separate task needed.

**Placeholder scan:** none — every code/test step shows complete content.

**Type consistency:** `assertCourseFact` / `CourseFactRejected` names and the `(input) → row | throw` contract are identical across Tasks 1–5; import path `./course-fact-guard.js` (source) vs `../api/course-fact-guard` (tests) is consistent with repo convention.

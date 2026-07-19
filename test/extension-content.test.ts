import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { makeSupabaseMock, makeRes } from "./helpers";

// extension-content builds a Supabase client at module load + calls the course-resolver.
vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }));
import { createClient } from "@supabase/supabase-js";
vi.mock("../api/course-resolver", () => ({
  resolveAndEnrichCourse: vi.fn(async () => null),
  normalizeCourseCode: vi.fn((s: string) => s),
}));

import { deriveUniversityId, buildContentHash } from "../api/extension-content";

beforeEach(() => {
  process.env.SUPABASE_URL = "http://localhost";
  process.env.SUPABASE_SERVICE_KEY = "test";
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}), text: async () => "" })));
});
afterEach(() => vi.unstubAllGlobals());

async function loadHandler(router: (ctx: any) => any) {
  const { client, calls } = makeSupabaseMock(router);
  vi.resetModules();
  (createClient as any).mockReturnValue(client);
  const mod = await import("../api/extension-content.ts");
  return { handler: mod.default, calls };
}
const post = (body: any) => ({ method: "POST", body });

// ── Pure: LMS URL → canonical hostname (BR-02: matches university-brain's key) ────
describe("deriveUniversityId", () => {
  it("returns the LMS hostname (lowercased)", () => {
    expect(deriveUniversityId("https://canvas.utoronto.ca/courses/1")).toBe("canvas.utoronto.ca");
    expect(deriveUniversityId("https://q.utoronto.ca/d2l/home")).toBe("q.utoronto.ca");
    expect(deriveUniversityId("https://Canvas.MIT.edu/x")).toBe("canvas.mit.edu");
    expect(deriveUniversityId("https://courseworks.columbia.edu/x")).toBe("courseworks.columbia.edu");
  });
  it("keeps the full hostname including subdomains (no short-id collapsing)", () => {
    // Previously collapsed to 'ubc'; now distinct per host — consistent with university-brain.
    expect(deriveUniversityId("https://sub.canvas.ubc.ca/x")).toBe("sub.canvas.ubc.ca");
    expect(deriveUniversityId("https://learn.someschool.edu/x")).toBe("learn.someschool.edu");
  });
  it("returns null for empty or invalid input (caller falls back to 'unknown')", () => {
    expect(deriveUniversityId("")).toBe(null);
    expect(deriveUniversityId("not a url")).toBe(null);
  });
});

// ── Pure: dedup hash (the key the shared library dedups on) ──────────────────
describe("buildContentHash", () => {
  it("is deterministic for identical inputs", () => {
    expect(buildContentHash("uoft", "ECON201", "lecture", "the text"))
      .toBe(buildContentHash("uoft", "ECON201", "lecture", "the text"));
  });
  it("changes when course / type / text change", () => {
    const base = buildContentHash("uoft", "ECON201", "lecture", "x");
    expect(buildContentHash("uoft", "ECON202", "lecture", "x")).not.toBe(base);
    expect(buildContentHash("uoft", "ECON201", "rubric",  "x")).not.toBe(base);
    expect(buildContentHash("uoft", "ECON201", "lecture", "y")).not.toBe(base);
  });
  it("hashes only the first 500 chars (trivial tail edits still dedup together)", () => {
    const head = "a".repeat(500);
    expect(buildContentHash("u", "c", "lecture", head + "TAIL-ONE"))
      .toBe(buildContentHash("u", "c", "lecture", head + "a-totally-different-tail"));
  });
});

// ── Handler: validation + dedup behavior ────────────────────────────────────
describe("extension-content handler", () => {
  const ok = { userId: "u1", courseId: "ECON 201", contentType: "lecture", text: "Monetary policy lecture notes here." };

  it("guards method and validates required fields", async () => {
    const { handler } = await loadHandler(() => ({ data: null, error: null }));
    let res = makeRes(); await handler({ method: "GET" }, res);                  expect(res.statusCode).toBe(405);
    res = makeRes();     await handler({ method: "OPTIONS" }, res);              expect(res.statusCode).toBe(204);
    res = makeRes();     await handler(post({ ...ok, userId: undefined }), res); expect(res.statusCode).toBe(400);
    res = makeRes();     await handler(post({ ...ok, courseId: undefined }), res); expect(res.statusCode).toBe(400);
    res = makeRes();     await handler(post({ ...ok, text: "short" }), res);      expect(res.statusCode).toBe(400);
    res = makeRes();     await handler(post({ ...ok, contentType: "bogus" }), res); expect(res.statusCode).toBe(400);
  });

  it("returns 'already_exists' + increments seen_by_count when the hash matches", async () => {
    const { handler, calls } = await loadHandler((ctx) =>
      ctx.table === "course_content" && ctx.op === "select"
        ? { data: { id: "row-9", seen_by_count: 4, content_hash: "h" }, error: null }
        : { data: null, error: null });
    const res = makeRes();
    await handler(post(ok), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe("already_exists");
    expect(res.body.seenByCount).toBe(5); // 4 + 1
    expect(calls.some(c => c.table === "course_content" && c.op === "update")).toBe(true);
  });

  it("inserts new content and returns 'created'", async () => {
    const { handler, calls } = await loadHandler((ctx) => {
      if (ctx.table === "course_content" && ctx.op === "select") return { data: null, error: null }; // not seen before
      if (ctx.table === "course_content" && ctx.op === "insert") return { data: { id: "new-1" }, error: null };
      return { data: null, error: null };
    });
    const res = makeRes();
    await handler(post(ok), res);
    expect(res.statusCode).toBe(201);
    expect(res.body.status).toBe("created");
    expect(res.body.id).toBe("new-1");
    expect(calls.some(c => c.table === "course_content" && c.op === "insert")).toBe(true);
  });
});

describe("BR-06: extension-content guard", () => {
  const okBase = {
    userId: "u1", universityId: "q.utoronto.ca", courseId: "BIO130", canvasCourseId: "123",
    contentType: "syllabus",
    text: "Weekly topics, readings, and lecture schedule for the course across the term.",
    sourceUrl: "https://q.utoronto.ca/courses/1",
  };
  it("rejects a scrape whose text carries person data — no insert", async () => {
    const { handler, calls } = await loadHandler((ctx) => {
      if (ctx.table === "course_content" && ctx.op === "select") return { data: null, error: null };
      if (ctx.table === "course_content" && ctx.op === "insert") return { data: { id: "new-1" }, error: null };
      return { data: null, error: null };
    });
    const res = makeRes();
    const tainted = "Your grade: 18/20 on the midterm. You submitted at 11:59pm — late submission. "
      + "Additional benign course notes and reading material to exceed any minimum length. ".repeat(4);
    await handler(post({ ...okBase, text: tainted }), res);
    expect(res.body.status).toBe("rejected");
    expect(calls.some(c => c.table === "course_content" && c.op === "insert")).toBe(false);
  });
});

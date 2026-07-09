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

// ── Pure: LMS hostname → university id ──────────────────────────────────────
describe("deriveUniversityId", () => {
  it("maps known LMS hostnames to university ids", () => {
    expect(deriveUniversityId("https://canvas.utoronto.ca/courses/1")).toBe("uoft");
    expect(deriveUniversityId("https://q.utoronto.ca/d2l/home")).toBe("uoft");
    expect(deriveUniversityId("https://canvas.mit.edu/x")).toBe("mit");
    expect(deriveUniversityId("https://courseworks.columbia.edu/x")).toBe("columbia");
  });
  it("matches subdomains of a known host", () => {
    expect(deriveUniversityId("https://sub.canvas.ubc.ca/x")).toBe("ubc");
  });
  it("falls back to the second-level domain for unknown hosts", () => {
    expect(deriveUniversityId("https://learn.someschool.edu/x")).toBe("someschool");
  });
  it("returns 'unknown' for empty or invalid input", () => {
    expect(deriveUniversityId("")).toBe("unknown");
    expect(deriveUniversityId("not a url")).toBe("unknown");
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

import { describe, it, expect } from "vitest";
import { makeRes } from "./helpers";
import handler, { deriveUniversityId, buildContentHash } from "../api/extension-content";

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
    expect(deriveUniversityId("https://sub.canvas.ubc.ca/x")).toBe("sub.canvas.ubc.ca");
    expect(deriveUniversityId("https://learn.someschool.edu/x")).toBe("learn.someschool.edu");
  });
  it("returns null for empty or invalid input (caller falls back to 'unknown')", () => {
    expect(deriveUniversityId("")).toBe(null);
    expect(deriveUniversityId("not a url")).toBe(null);
  });
});

// ── Pure: dedup hash (still exported for hash-compat callers) ──────────────────
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

// ── Handler: RETIRED (BR-06 §9.1) ─────────────────────────────────────────────
// The unauthenticated raw-text scrape door into the SHARED course library is GONE, not guarded.
// Course facts now enter the shared library only via the authenticated api/university-brain path.
describe("extension-content handler (retired)", () => {
  const anyPost = { userId: "u1", courseId: "ECON 201", contentType: "lecture", text: "Monetary policy lecture notes here." };

  it("returns 410 Gone on POST — the write path is absent", async () => {
    const res = makeRes();
    await handler(post(anyPost), res);
    expect(res.statusCode).toBe(410);
    expect(res.body.error).toBe("gone");
  });

  it("still answers the CORS preflight (OPTIONS → 204)", async () => {
    const res = makeRes();
    await handler({ method: "OPTIONS" }, res);
    expect(res.statusCode).toBe(204);
  });

  it("a person-tainted scrape cannot reach the shared library — the door is gone, not merely screened", async () => {
    const res = makeRes();
    const tainted = "Your grade: 18/20 on the midterm. You submitted at 11:59pm — late submission.";
    await handler(post({ userId: "u1", courseId: "BIO130", contentType: "syllabus", text: tainted }), res);
    expect(res.statusCode).toBe(410); // never inserted; there is no insert path anymore
  });
});

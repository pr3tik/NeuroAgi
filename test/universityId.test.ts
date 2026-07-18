import { describe, it, expect } from "vitest";
import { canonicalUniversityId } from "../api/_universityId";

describe("canonicalUniversityId", () => {
  it("returns a lowercase bare host from a full URL", () => {
    expect(canonicalUniversityId("https://canvas.utoronto.ca/")).toBe("canvas.utoronto.ca");
    expect(canonicalUniversityId("http://Q.UTORONTO.CA/courses/12")).toBe("q.utoronto.ca");
  });

  it("is a no-op on values the old write path already produced (bare hostname)", () => {
    // The old write stored `new URL(creds.host).hostname` — read-side scoping must match those rows.
    expect(canonicalUniversityId("canvas.utoronto.ca")).toBe("canvas.utoronto.ca");
    expect(canonicalUniversityId("q.mcgill.ca")).toBe("q.mcgill.ca");
  });

  it("strips port and path when given a bare host:port", () => {
    expect(canonicalUniversityId("canvas.x.edu:443")).toBe("canvas.x.edu");
    expect(canonicalUniversityId("canvas.x.edu/courses/9")).toBe("canvas.x.edu");
  });

  it("does NOT collapse subdomains (that needs a live backfill first)", () => {
    // canvas.x.edu and q.x.edu remain distinct — deliberate; documented in _universityId.ts.
    expect(canonicalUniversityId("canvas.x.edu")).not.toBe(canonicalUniversityId("q.x.edu"));
  });

  it("returns null for empty / non-host / hostless input (caller must skip scoping, not scope to '')", () => {
    expect(canonicalUniversityId(null)).toBeNull();
    expect(canonicalUniversityId(undefined)).toBeNull();
    expect(canonicalUniversityId("")).toBeNull();
    expect(canonicalUniversityId("   ")).toBeNull();
    expect(canonicalUniversityId("localhost")).toBeNull(); // no dot → not an institution host
    expect(canonicalUniversityId("not a url")).toBeNull();
  });

  it("tolerates a trailing FQDN dot", () => {
    expect(canonicalUniversityId("canvas.utoronto.ca.")).toBe("canvas.utoronto.ca");
  });
});

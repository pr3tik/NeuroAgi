import { describe, it, expect } from "vitest";
import { jobsPending } from "../src/lib/sessionReview";

describe("jobsPending — keep polling the review until async jobs finish", () => {
  it("is false when there are no jobs (nothing queued)", () => {
    expect(jobsPending(null)).toBe(false);
    expect(jobsPending(undefined)).toBe(false);
    expect(jobsPending({})).toBe(false);
  });

  it("is true while any job is not terminal", () => {
    expect(jobsPending({ generate_quiz: "pending" })).toBe(true);
    expect(jobsPending({ generate_session_summary: "running" })).toBe(true);
    expect(jobsPending({ generate_quiz: "done", propose_brain_update: "queued" })).toBe(true);
  });

  it("is false once every job is terminal (done/failed/etc, case-insensitive)", () => {
    expect(jobsPending({ generate_quiz: "done", generate_session_summary: "done" })).toBe(false);
    expect(jobsPending({ generate_quiz: "FAILED" })).toBe(false);
    expect(jobsPending({ a: "succeeded", b: "skipped", c: "error" })).toBe(false);
  });
});

// @vitest-environment node
import { describe, it, expect } from "vitest";
import { buildRetrievalQuery, RAG_SKIP_CHARS, RAG_QUERY_CAP } from "../src/lib/ragQuery";

describe("buildRetrievalQuery", () => {
  it("passes a normal-length prompt through unchanged (no retrieval slowdown)", () => {
    const q = "explain the calvin cycle from my notes";
    expect(buildRetrievalQuery(q)).toEqual({ skip: false, query: q });
  });

  it("skips retrieval for a big self-contained paste", () => {
    const big = "x".repeat(RAG_SKIP_CHARS + 1);
    expect(buildRetrievalQuery(big)).toEqual({ skip: true, query: "" });
  });

  it("caps a medium prompt to head+tail so a trailing question still drives retrieval", () => {
    const body = "MID".repeat(600);                       // ~1800 chars, between cap and skip
    const text = `explain: ${body} what does this mean?`;
    const r = buildRetrievalQuery(text);
    expect(r.skip).toBe(false);
    expect(r.query.length).toBeLessThan(RAG_QUERY_CAP + 12);   // head + " … " + tail
    expect(r.query).toContain("explain:");                     // leading framing kept
    expect(r.query).toContain("what does this mean?");         // trailing question kept
  });

  it("handles empty / whitespace input", () => {
    expect(buildRetrievalQuery("   ")).toEqual({ skip: false, query: "" });
    expect(buildRetrievalQuery("" as any)).toEqual({ skip: false, query: "" });
  });
});

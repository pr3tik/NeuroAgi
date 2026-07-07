// @vitest-environment node
// Handler tests for api/route-intent.ts (through the real gateway + stubbed fetch).
// Covers a valid classification, validation, fail-open on model error, and enum-guarding
// an unknown type.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { makeRes } from "./helpers";

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = "test-key";
});
afterEach(() => vi.unstubAllGlobals());

function stubAnthropic({ text = "{}", ok = true }: any = {}) {
  const fn = vi.fn(async (url: any) => {
    if (String(url).includes("api.anthropic.com")) {
      if (!ok) return { ok: false, status: 400, json: async () => ({}), text: async () => '{"error":{"message":"bad"}}' };
      return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text }], stop_reason: "end_turn", usage: {} }), text: async () => JSON.stringify({ content: [{ type: "text", text }], stop_reason: "end_turn", usage: {} }) };
    }
    return { ok: true, status: 200, json: async () => ([]), text: async () => "[]" };
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

async function load() {
  vi.resetModules();
  return (await import("../api/route-intent.ts")).default;
}

describe("route-intent handler", () => {
  it("400 without userMessage", async () => {
    stubAnthropic();
    const h = await load(); const res = makeRes();
    await h({ method: "POST", body: {} }, res);
    expect(res.statusCode).toBe(400);
  });

  it("classifies a query into {type, keyword}", async () => {
    stubAnthropic({ text: '{"type":"course_grades","keyword":"BIO 101"}' });
    const h = await load(); const res = makeRes();
    await h({ method: "POST", body: { userMessage: "What's my score in BIO 101?" } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ type: "course_grades", keyword: "BIO 101" });
  });

  it("fail-open to {type:'none',keyword:null} on model failure (200, never throws)", async () => {
    stubAnthropic({ ok: false });
    const h = await load(); const res = makeRes();
    await h({ method: "POST", body: { userMessage: "hello" } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ type: "none", keyword: null });
  });

  it("guards an unknown type from the model → falls back to 'none'", async () => {
    stubAnthropic({ text: '{"type":"totally_made_up","keyword":"x"}' });
    const h = await load(); const res = makeRes();
    await h({ method: "POST", body: { userMessage: "??" } }, res);
    expect(res.body.type).toBe("none");
    expect(res.body.keyword).toBe("x");
  });
});

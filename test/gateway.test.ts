// @vitest-environment node
// Unit tests for the LLM gateway (api/_gateway.ts). Mocks global fetch so no network
// is hit; asserts the load-bearing behaviors: routing, cost accounting, provider body
// shaping (Anthropic never gets temperature/budget_tokens; Groq does get temperature),
// prompt-cache breakpoints, retry-on-429, model fallback, hard-error short-circuit,
// missing-key handling, sanitization, and trace emission.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { callModel, openStream, resolveRoute, costUSD, setTraceSink, type TraceSpan } from "../api/_gateway.ts";

// ── fetch mock that records request bodies and replays a queued response sequence ──
function makeResponse({ ok = true, status = 200, body = {} as any, stream = null as any }) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return { ok, status, text: async () => text, json: async () => JSON.parse(text), body: stream };
}
function captureFetch(responses: any[]) {
  const calls: any[] = [];
  const fn = vi.fn(async (url: string, opts: any) => {
    calls.push({ url, body: JSON.parse(opts.body), headers: opts.headers });
    return makeResponse(responses[Math.min(calls.length - 1, responses.length - 1)]);
  });
  vi.stubGlobal("fetch", fn);
  return { fn, calls };
}

const ANTHROPIC_OK = { ok: true, status: 200, body: {
  content: [{ type: "text", text: "Hi" }],
  stop_reason: "end_turn",
  usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
}};
const GROQ_OK = { ok: true, status: 200, body: {
  choices: [{ message: { content: "yo" }, finish_reason: "stop" }],
  usage: { prompt_tokens: 8, completion_tokens: 3 },
}};
const msg = [{ role: "user", content: "hello" }];

let spans: TraceSpan[];
beforeEach(() => {
  spans = [];
  setTraceSink((s) => spans.push(s));
  process.env.ANTHROPIC_API_KEY = "sk-ant-test";
  process.env.GROQ_KEY = "gsk-test";
  delete process.env.ANTHROPIC_MODEL;
  delete process.env.ANTHROPIC_MODEL_CHEAP;
  delete process.env.ANTHROPIC_MODEL_DEEP;
  delete process.env.GROQ_MODEL;
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

// ─────────────────────────────────────────────────────────────────────────────
describe("resolveRoute", () => {
  it("default task → Anthropic Sonnet, fallback enabled", () => {
    const r = resolveRoute({ messages: msg });
    expect(r.provider).toBe("anthropic");
    expect(r.model).toBe("claude-sonnet-4-6");
    expect(r.allowFallback).toBe(true);
  });

  it("cheap → Groq llama; summarize → Haiku; deep → Opus with thinking", () => {
    expect(resolveRoute({ task: "cheap", messages: msg })).toMatchObject({ provider: "groq", model: "llama-3.1-8b-instant" });
    expect(resolveRoute({ task: "summarize", messages: msg }).model).toBe("claude-haiku-4-5");
    const deep = resolveRoute({ task: "deep", messages: msg });
    expect(deep.model).toBe("claude-opus-4-8");
    expect(deep.thinking).toBe(true);
  });

  it("explicit model override infers provider from the id", () => {
    expect(resolveRoute({ model: "claude-opus-4-8", messages: msg }).provider).toBe("anthropic");
    expect(resolveRoute({ model: "llama-3.3-70b", messages: msg }).provider).toBe("groq");
  });

  it("ANTHROPIC_MODEL env overrides the default/tutor model", () => {
    process.env.ANTHROPIC_MODEL = "claude-opus-4-8";
    expect(resolveRoute({ task: "tutor", messages: msg }).model).toBe("claude-opus-4-8");
  });

  it("unknown task falls back to the default route", () => {
    expect(resolveRoute({ task: "totally-made-up", messages: msg }).model).toBe("claude-sonnet-4-6");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("costUSD", () => {
  it("prices Sonnet input+output correctly", () => {
    // (10 * $3 + 5 * $15) / 1e6
    expect(costUSD("claude-sonnet-4-6", { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }))
      .toBeCloseTo(0.000105, 9);
  });
  it("prices cache reads at ~0.1× input", () => {
    // 1000 * ($3/1e6) * 0.1
    expect(costUSD("claude-sonnet-4-6", { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0 }))
      .toBeCloseTo(0.0003, 9);
  });
  it("unknown model and null usage price at 0", () => {
    expect(costUSD("mystery-model", { input_tokens: 999, output_tokens: 999, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })).toBe(0);
    expect(costUSD("claude-sonnet-4-6", null)).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("callModel — happy paths", () => {
  it("Anthropic: normalized content/usage/cost + trace span", async () => {
    captureFetch([ANTHROPIC_OK]);
    const r = await callModel({ messages: msg });
    expect(r.ok).toBe(true);
    expect(r.content).toBe("Hi");
    expect(r.contentBlocks).toHaveLength(1);
    expect(r.stop_reason).toBe("end_turn");
    expect(r.usage).toEqual({ input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 });
    expect(r.model).toBe("claude-sonnet-4-6");
    expect(r.provider).toBe("anthropic");
    expect(r.cost_usd).toBeCloseTo(0.000105, 9);
    expect(r.fell_back).toBe(false);

    // trace span is load-bearing — assert it carries the real numbers, not zeros
    expect(spans).toHaveLength(1);
    expect(spans[0]).toMatchObject({ evt: "llm_call", ok: true, model: "claude-sonnet-4-6", task: "default", streamed: false });
    expect(spans[0].cost_usd).toBeCloseTo(0.000105, 9);
    expect(spans[0].usage?.input_tokens).toBe(10);
  });

  it("Groq: content from choices[0], normalized usage", async () => {
    const { calls } = captureFetch([GROQ_OK]);
    const r = await callModel({ task: "cheap", messages: msg, system: "be brief" });
    expect(r.ok).toBe(true);
    expect(r.provider).toBe("groq");
    expect(r.model).toBe("llama-3.1-8b-instant");
    expect(r.content).toBe("yo");
    expect(r.usage).toEqual({ input_tokens: 8, output_tokens: 3, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 });
    // Groq is OpenAI-shaped: system folds into messages[0], and temperature IS sent
    expect(calls[0].url).toContain("groq.com");
    expect(calls[0].body.messages[0]).toEqual({ role: "system", content: "be brief" });
    expect(calls[0].body.temperature).toBe(0.7);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("callModel — provider body shaping (Anthropic 400-avoidance)", () => {
  it("never sends temperature/top_p/top_k to Anthropic, even if asked", async () => {
    const { calls } = captureFetch([ANTHROPIC_OK]);
    await callModel({ messages: msg, temperature: 0.9 } as any);
    expect(calls[0].body.temperature).toBeUndefined();
    expect(calls[0].body.top_p).toBeUndefined();
    expect(calls[0].body.top_k).toBeUndefined();
  });

  it("deep route enables adaptive thinking (never budget_tokens) on a supporting model", async () => {
    const { calls } = captureFetch([ANTHROPIC_OK]);
    await callModel({ task: "deep", messages: msg });
    expect(calls[0].body.model).toBe("claude-opus-4-8");
    expect(calls[0].body.thinking).toEqual({ type: "adaptive" });
    expect(calls[0].body.budget_tokens).toBeUndefined();
  });

  it("does NOT enable thinking on a model that doesn't support it (haiku)", async () => {
    const { calls } = captureFetch([ANTHROPIC_OK]);
    await callModel({ task: "summarize", thinking: true, messages: msg });
    expect(calls[0].body.model).toBe("claude-haiku-4-5");
    expect(calls[0].body.thinking).toBeUndefined();
  });

  it("cache:true adds an ephemeral breakpoint on the last system block", async () => {
    const { calls } = captureFetch([ANTHROPIC_OK]);
    await callModel({ messages: msg, system: "big stable preamble", cache: true });
    expect(calls[0].body.system).toEqual([{ type: "text", text: "big stable preamble", cache_control: { type: "ephemeral" } }]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("callModel — resilience", () => {
  it("retries on 429 then succeeds (attempts increments)", async () => {
    captureFetch([{ ok: false, status: 429, body: { error: { message: "rate limited" } } }, ANTHROPIC_OK]);
    const r = await callModel({ messages: msg, maxRetries: 2 });
    expect(r.ok).toBe(true);
    expect(r.attempts).toBe(2);
    expect(r.fell_back).toBe(false);
  });

  it("falls back to the secondary model on a 404 (model inaccessible)", async () => {
    captureFetch([{ ok: false, status: 404, body: { error: { message: "model not found" } } }, ANTHROPIC_OK]);
    const r = await callModel({ messages: msg });           // default: sonnet → fallback haiku
    expect(r.ok).toBe(true);
    expect(r.model).toBe("claude-haiku-4-5");
    expect(r.fell_back).toBe(true);
    expect(r.attempts).toBe(2);
    expect(spans[0].fell_back).toBe(true);
  });

  it("a hard 400 short-circuits: no retry, no fallback", async () => {
    const { fn } = captureFetch([{ ok: false, status: 400, body: { error: { message: "bad request" } } }]);
    const r = await callModel({ messages: msg });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(400);
    expect(r.error).toBe("bad request");
    expect(fn).toHaveBeenCalledTimes(1);   // proves: no retry AND no fallback attempt
  });

  it("does not allow fallback when the caller opts out", async () => {
    const { fn } = captureFetch([{ ok: false, status: 404, body: { error: { message: "nope" } } }]);
    const r = await callModel({ messages: msg, fallback: false });
    expect(r.ok).toBe(false);
    expect(fn).toHaveBeenCalledTimes(1);   // primary only — fallback suppressed
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("callModel — guards", () => {
  it("missing ANTHROPIC_API_KEY → 500, no fetch attempted", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const { fn } = captureFetch([ANTHROPIC_OK]);
    const r = await callModel({ messages: msg });           // both default candidates are anthropic
    expect(r.ok).toBe(false);
    expect(r.status).toBe(500);
    expect(r.error).toContain("ANTHROPIC_API_KEY");
    expect(fn).not.toHaveBeenCalled();
  });

  it("empty/whitespace-only messages → 400 before any fetch", async () => {
    const { fn } = captureFetch([ANTHROPIC_OK]);
    const r = await callModel({ messages: [{ role: "user", content: "   " }] });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(400);
    expect(fn).not.toHaveBeenCalled();
  });

  it("drops empty turns but keeps array (tool) content untouched", async () => {
    const { calls } = captureFetch([ANTHROPIC_OK]);
    await callModel({ messages: [
      { role: "user", content: "" },                                   // dropped
      { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "x", input: {} }] }, // kept verbatim
      { role: "user", content: "  real  " },                           // trimmed
    ]});
    const sent = calls[0].body.messages;
    expect(sent).toHaveLength(2);
    expect(sent[0].content).toEqual([{ type: "tool_use", id: "t1", name: "x", input: {} }]);
    expect(sent[1].content).toBe("real");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("openStream", () => {
  it("returns the raw upstream body to pipe + emits a streamed trace span", async () => {
    const fakeBody = { getReader: () => ({}) };
    captureFetch([{ ok: true, status: 200, stream: fakeBody }]);
    const out = await openStream({ messages: msg });
    expect(out.ok).toBe(true);
    expect(out.stream).toBe(fakeBody);
    expect(spans[0]).toMatchObject({ ok: true, streamed: true });
  });

  it("surfaces an error (no stream) when the upstream fails hard", async () => {
    captureFetch([{ ok: false, status: 400, body: { error: { message: "bad" } } }]);
    const out = await openStream({ messages: msg });
    expect(out.ok).toBe(false);
    expect(out.stream).toBeNull();
    expect(out.error).toBe("bad");
  });
});

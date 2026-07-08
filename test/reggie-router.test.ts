// @vitest-environment node
// Reggie intent-router tests: the three tiers (hint → keyword → model) + closed-set guard.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { classifyIntent, hintToRoute } from "../api/_reggie/router";
import { ROUTES } from "../api/_reggie/specialists";

beforeEach(() => { process.env.ANTHROPIC_API_KEY = "test-key"; });
afterEach(() => vi.unstubAllGlobals());

const anthropic = (label: string) => {
  const d = { content: [{ type: "text", text: label }], stop_reason: "end_turn", usage: {} };
  return { ok: true, status: 200, json: async () => d, text: async () => JSON.stringify(d) };
};

describe("reggie router", () => {
  it("hintToRoute maps explicit product actions; null otherwise", () => {
    expect(hintToRoute("weekly_plan")).toBe("planner");
    expect(hintToRoute("grades")).toBe("insight_explainer");
    expect(hintToRoute("quiz")).toBe("content_synthesizer");
    expect(hintToRoute("office_hours")).toBe("question_coach");
    expect(hintToRoute("nope")).toBeNull();
    expect(hintToRoute(null)).toBeNull();
  });

  it("routes via keyword rules WITHOUT a model call", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    expect(await classifyIntent("what's my grade in bio", ROUTES)).toBe("insight_explainer");
    expect(await classifyIntent("what's due this week", ROUTES)).toBe("planner");
    expect(await classifyIntent("make me a quiz on chapter 3", ROUTES)).toBe("content_synthesizer");
    expect(await classifyIntent("help me outline my essay", ROUTES)).toBe("writing_coach");
    // precise-rule regressions: specific phrases must NOT be hijacked by generic words
    expect(await classifyIntent("grade my answers to this quiz", ROUTES)).toBe("question_coach"); // "grade" ≠ insight_explainer
    expect(await classifyIntent("what if I drop kinetics from my plan?", ROUTES)).toBe("insight_explainer"); // "what if" beats "plan"
    expect(await classifyIntent("how many points do I have?", ROUTES)).toBe("tutor"); // tokens → tutor (holds token_summary)
    expect(await classifyIntent("how am I doing in my courses?", ROUTES)).toBe("insight_explainer");
    expect(spy).not.toHaveBeenCalled();
  });

  it("honors an explicit hint over keywords", async () => {
    expect(await classifyIntent("some ambiguous request", ROUTES, "writing")).toBe("writing_coach");
  });

  it("falls back to the model for ambiguous text, guarded to the closed set", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => anthropic("question_coach")));
    expect(await classifyIntent("hmm i'm not really sure", ROUTES)).toBe("question_coach");
  });

  it("fails open to tutor when the model errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 400, json: async () => ({}), text: async () => '{"error":{"message":"x"}}' })));
    expect(await classifyIntent("zzz gibberish qqq", ROUTES)).toBe("tutor");
  });

  it("never returns a label outside the provided set (model hallucination guard)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => anthropic("not_a_real_route")));
    expect(ROUTES).toContain(await classifyIntent("zzz gibberish qqq", ROUTES));
  });
});

// @vitest-environment node
// Handler tests for api/session-close.ts — the fire-and-forget "session close" queue that
// rewrites the student's living-mind doc and writes brain signals. Per the file's own
// ARCHITECTURE CONTRACT comment: fires on NeuralRing close, never blocks the UI, always
// responds 200 (errors are swallowed into { ok:false, reason }) except for the method guard.
//
// Deps mocked so importing/calling the handler never touches the network (session-close.ts
// itself talks to Supabase + Anthropic via raw `fetch`, which we stub per-test; it has no
// ./_auth.js import at all — see BUGS FOUND below):
//  - ./rag.js            → embed (only reached by the pattern-recognition harvest, which our
//                          fetch stub keeps un-triggered by making classify return resolved:false)
//  - ./_achievements.js   → awardTechniqueTypeIfEligible (same harvest-only path)
//  - ./_brain/kernel.js   → postgrestStore/remember (kernel-write sub-block)
//  - ./_brain/identity.js → resolveFschoolPerson (gates the kernel-write sub-block entirely)
//  - ./_brain/hypothesis.js, ./_brain/traits.js → runHypothesisPass/runTraitPass (reflection,
//                          only reached inside the same personId-gated sub-block)
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { makeRes } from "./helpers";

vi.mock("../api/rag.ts", () => ({
  embed: vi.fn(async (xs: string[]) => xs.map(() => [0.01, 0.02])),
}));
vi.mock("../api/_achievements.ts", () => ({
  awardTechniqueTypeIfEligible: vi.fn(async () => {}),
}));
vi.mock("../api/_brain/kernel.ts", () => ({
  postgrestStore: vi.fn(() => ({})),
  remember: vi.fn(async () => {}),
}));
vi.mock("../api/_brain/identity.ts", () => ({
  resolveFschoolPerson: vi.fn(async () => null),
}));
vi.mock("../api/_brain/hypothesis.ts", () => ({
  runHypothesisPass: vi.fn(async () => []),
}));
vi.mock("../api/_brain/traits.ts", () => ({
  runTraitPass: vi.fn(async () => []),
}));

type Call = { method: string; url: string; body?: any };

// Generic Supabase/Anthropic fetch router keyed by URL substring + method, mirroring the
// university-brain.test.ts fetch-stub pattern. First api.anthropic.com call is the living-mind
// rewrite; the second is the pattern-recognition classify call (kept resolved:false by default
// so the harvest sub-path — and its embed/achievements deps — never actually fires).
function stubFetch(opts: { mindDoc?: string; classifyText?: string; userRow?: any } = {}) {
  const calls: Call[] = [];
  let anthropicCalls = 0;
  const fn = vi.fn(async (url: any, init: any = {}) => {
    const method = init.method ?? "GET";
    let body: any;
    try { body = init.body ? JSON.parse(init.body) : undefined; } catch { body = init.body; }
    const u = String(url);
    calls.push({ method, url: u, body });

    if (u.startsWith("https://api.anthropic.com")) {
      anthropicCalls++;
      if (anthropicCalls === 1) {
        return { ok: true, json: async () => ({ content: [{ text: opts.mindDoc ?? "WHO THEY ARE\nA diligent student." }] }) };
      }
      return { ok: true, json: async () => ({ content: [{ text: opts.classifyText ?? '{"resolved":false}' }] }) };
    }
    if (u.includes("/rest/v1/tutor_mind") && method === "GET") {
      return { ok: true, json: async () => [] }; // no existing living-mind doc
    }
    if (u.includes("/rest/v1/users") && method === "GET") {
      return { ok: true, json: async () => [opts.userRow ?? { id: "user-1", name: "Ann", brain_person_id: null, gpa: 3.5, streak: 4, school: "UofT" }] };
    }
    if (u.includes("/rest/v1/tutor_impressions") && method === "GET") {
      return { ok: true, json: async () => [] };
    }
    if (u.includes("/rest/v1/tutor_mind") && method === "POST") {
      return { ok: true, json: async () => ({}), text: async () => "" }; // upsert
    }
    if (u.includes("/rest/v1/signals") && method === "POST") {
      return { ok: true, json: async () => ({}), text: async () => "" };
    }
    if (u.includes("/rest/v1/context_window") && method === "POST") {
      return { ok: true, json: async () => ({}), text: async () => "" };
    }
    return { ok: true, json: async () => ([]), text: async () => "" };
  });
  return { fn, calls };
}

async function load() {
  vi.resetModules();
  return (await import("../api/session-close.ts")).default;
}

const longMsg1 = "Can you explain how mitochondria produce ATP via the electron transport chain?";
const longMsg2 = "Sure — protons get pumped across the inner membrane, and that gradient drives ATP synthase.";

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY    = "test-anthropic-key";
  process.env.SUPABASE_URL         = "http://example.test";
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
  delete process.env.SUPABASE_ANON_KEY;
  delete process.env.BRAIN_SUPABASE_URL;
  delete process.env.BRAIN_SUPABASE_KEY;
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.ANTHROPIC_API_KEY;
});

describe("session-close handler — pinned core behavior", () => {
  it("405s on non-POST (only guard that isn't a swallowed 200)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("fetch should not be called"); }));
    const handler = await load();
    const res = makeRes();
    await handler({ method: "GET", body: {} }, res);
    expect(res.statusCode).toBe(405);
    expect(res.body).toEqual({ error: "Method not allowed" });
  });

  it("short-circuits 200 { ok:false, reason:'missing env' } when required env is absent — no fetch attempted", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const fetchMock = vi.fn(async () => { throw new Error("fetch should not be called"); });
    vi.stubGlobal("fetch", fetchMock);
    const handler = await load();
    const res = makeRes();
    await handler({ method: "POST", body: { userId: "user-1", sessionMessages: [] } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: false, reason: "missing env" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 200 { ok:false, reason:'missing userId' } when userId is absent", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("fetch should not be called"); }));
    const handler = await load();
    const res = makeRes();
    await handler({ method: "POST", body: { sessionMessages: [{ role: "user", content: longMsg1 }] } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: false, reason: "missing userId" });
  });

  it("returns 200 { ok:false, reason:'session too short' } with fewer than 2 qualifying messages", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("fetch should not be called"); }));
    const handler = await load();
    const res = makeRes();
    // Only one message clears the role+length(>10) filter; a second exists but is too short.
    await handler(
      { method: "POST", body: { userId: "user-1", sessionMessages: [{ role: "user", content: longMsg1 }, { role: "assistant", content: "ok" }] } },
      res,
    );
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: false, reason: "session too short" });
  });

  it("happy path: rewrites the living mind (tutor_mind upsert) and fans out brain-DB writes when configured", async () => {
    process.env.BRAIN_SUPABASE_URL = "http://brain.example.test";
    process.env.BRAIN_SUPABASE_KEY = "brain-key";
    const userRow = { id: "user-1", name: "Ann", brain_person_id: "person-1", gpa: 3.5, streak: 4, school: "UofT" };
    const { fn: fetchMock, calls } = stubFetch({ mindDoc: "WHO THEY ARE\nAnn is a UofT student.", userRow });
    vi.stubGlobal("fetch", fetchMock);

    const handler = await load();
    const res = makeRes();
    await handler(
      { method: "POST", body: { userId: "user-1", sessionMessages: [{ role: "user", content: longMsg1 }, { role: "assistant", content: longMsg2 }] } },
      res,
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });

    // READS: tutor_mind (existing doc) + users (profile) + tutor_impressions (last 10).
    expect(calls.some(c => c.url.includes("/rest/v1/tutor_mind") && c.method === "GET")).toBe(true);
    expect(calls.some(c => c.url.includes("/rest/v1/users") && c.method === "GET")).toBe(true);
    expect(calls.some(c => c.url.includes("/rest/v1/tutor_impressions") && c.method === "GET")).toBe(true);

    // WRITE: tutor_mind upsert carries the rewritten doc for this user.
    const upsert = calls.find(c => c.url.includes("/rest/v1/tutor_mind") && c.method === "POST");
    expect(upsert?.body).toMatchObject({ user_id: "user-1", mind_doc: "WHO THEY ARE\nAnn is a UofT student." });
    expect(typeof upsert?.body.updated_at).toBe("string");

    // WRITE: fire-and-forget brain.signals + brain.context_window, only fired because
    // BRAIN_SUPABASE_URL/KEY are set AND the user row has a brain_person_id.
    const signal = calls.find(c => c.url.includes("/rest/v1/signals") && c.method === "POST");
    expect(signal?.body).toMatchObject({ person_id: "person-1", signal_type: "academic", source: "fschoolai" });
    expect(signal?.body.payload).toMatchObject({ event: "session_end", session_messages: 2 });

    const contextWindow = calls.find(c => c.url.includes("/rest/v1/context_window") && c.method === "POST");
    expect(contextWindow?.body).toMatchObject({ person_id: "person-1" });
    expect(contextWindow?.body.recent_summary).toContain("Ann is a UofT student");
  });

  it("E1 resilience: writes the kernel signal + runs reflection even when the living-mind rewrite fails", async () => {
    const handler = await load();
    const { resolveFschoolPerson } = await import("../api/_brain/identity.ts");
    const { remember } = await import("../api/_brain/kernel.ts");
    const { runHypothesisPass } = await import("../api/_brain/hypothesis.ts");
    const { runTraitPass } = await import("../api/_brain/traits.ts");
    (resolveFschoolPerson as any).mockResolvedValue("person-1"); // kernel block active

    // Claude (first anthropic call) FAILS → the living-mind rewrite is lost.
    const fetchMock = vi.fn(async (url: any, init: any = {}) => {
      const u = String(url), method = init.method ?? "GET";
      if (u.startsWith("https://api.anthropic.com")) return { ok: false, json: async () => ({}), text: async () => "boom" };
      if (u.includes("/rest/v1/users") && method === "GET") return { ok: true, json: async () => [{ id: "user-1", brain_person_id: null, gpa: 3.5 }] };
      return { ok: true, json: async () => [], text: async () => "" };
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = makeRes();
    await handler({ method: "POST", body: { userId: "user-1", sessionMessages: [{ role: "user", content: longMsg1 }, { role: "assistant", content: longMsg2 }] } }, res);

    // Claude failed → ok:false, BUT the academic signal + reflection already ran (block 4a, before the Claude call).
    expect(res.body).toEqual({ ok: false, reason: "claude error" });
    const signalCall = (remember as any).mock.calls.find((c: any[]) => c[1]?.kind === "signal");
    expect(signalCall, "academic signal written despite the rewrite failing").toBeTruthy();
    expect(signalCall[1].body).toMatchObject({ event: "session_end" });
    expect(runHypothesisPass).toHaveBeenCalled();
    expect(runTraitPass).toHaveBeenCalled();
    // No digest — mindDoc is empty because Claude failed.
    expect((remember as any).mock.calls.some((c: any[]) => c[1]?.kind === "digest")).toBe(false);
  });
});

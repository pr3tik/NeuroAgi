// @vitest-environment node
// AI-04 — api/room-ai.ts, the group AI turn.
//
// The headline tests are the PRIVACY ones. STUDYROOM_ARCHITECTURE.md §7 lists "Brain
// leakage into group" as a release-gate threat, and the sprint plan puts AI-02's isolation
// properties on the never-cut list. The room teaching plan may reach the system prompt and
// nothing else — so these tests assert on what leaves the endpoint, not just what it does.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { makeRes } from "./helpers";

const authState = vi.hoisted(() => ({ userId: "priya" as string | null }));
vi.mock("../api/_auth.ts", () => ({
  requireUser: async () => (authState.userId ? { userId: authState.userId, authId: "t" } : null),
  requireUserOr401: async (_req: any, res: any) => {
    if (!authState.userId) { res.status(401).json({ error: "Authentication required." }); return null; }
    return authState.userId;
  },
}));
const rlState = vi.hoisted(() => ({ allow: true }));
vi.mock("../api/_ratelimit.ts", () => ({
  rateLimit: async (_req: any, res: any) => {
    if (!rlState.allow) { res.status(429).json({ error: "Too many requests" }); return false; }
    return true;
  },
}));

// The gateway is mocked so we can inspect the SYSTEM PROMPT + metadata it receives.
const gw = vi.hoisted(() => ({
  calls: [] as any[],
  result: null as any,
}));
vi.mock("../api/_gateway.ts", () => ({
  callModel: async (req: any) => {
    gw.calls.push(req);
    return gw.result ?? {
      ok: true, status: 200, content: "Because greedy lacks the greedy-choice property.",
      contentBlocks: [], stop_reason: "end_turn", usage: null, model: "m", provider: "anthropic",
      cost_usd: 0.001, trace_id: "trace-1", attempts: 1, fell_back: false,
    };
  },
}));

const retrieval = vi.hoisted(() => ({
  result: {
    passages: [{ document_id: "doc-a", title: "Lecture 07.pdf", heading: "7.4 Coin Change", loc: "p.16", text: "greedy fails for {1,5,12}" }],
    source_refs: [{ document_id: "doc-a", title: "Lecture 07.pdf", heading: "7.4 Coin Change", loc: "p.16" }],
    used: 1,
  } as any,
}));
vi.mock("../api/_roomRetrieval.ts", () => ({ searchRoomSources: async () => retrieval.result }));

const boardState = vi.hoisted(() => ({ ctx: null as any }));
vi.mock("../api/room-board.ts", () => ({ latestBoardContext: async () => boardState.ctx }));

function R(data: any) { return { ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) }; }
function stubDb(route: (u: string) => any | undefined) {
  vi.stubGlobal("fetch", vi.fn(async (url: any) => route(String(url)) ?? R([])));
}

const ROOM = "11111111-1111-4111-8111-111111111111";
const SESSION = "22222222-2222-4222-8222-222222222222";

// A plan containing a NAMED student with a NAMED gap — the exact thing that must never
// reach a client.
const PLAN_SNAP = {
  participant_summaries: [
    { user_id: "marcus", display_name: "Marcus", invite_style: "no_cold_call", strengths: ["recursion"], topic_gaps: ["dynamic programming"], teaching_preferences: ["visual"] },
  ],
  group_strategy: { default_explanation: "visual_then_stepwise", peer_teaching_pairs: [{ explainer: "Priya", listener: "Marcus" }], avoid: ["cold-calling Marcus"] },
};

function routes({ member = [{ user_id: "priya" }] as any[], session = { id: SESSION, config_version: 3 } as any, cfg = { persona: "challenger", intervention_intensity: "active" } as any, snap = PLAN_SNAP as any } = {}) {
  stubDb(u => {
    if (u.includes("room_members?")) return R(member);
    if (u.includes("room_ai_sessions?")) return R(session ? [session] : []);
    if (u.includes("room_configs?")) return R(cfg ? [cfg] : []);
    if (u.includes("room_brain_snapshots?")) return R(snap ? [snap] : []);
    return undefined;
  });
}

let mod: any;
const post = (body: any) => ({ method: "POST", query: { action: "group" }, headers: {}, body });

beforeEach(async () => {
  process.env.SUPABASE_URL = "http://localhost";
  process.env.SUPABASE_SERVICE_KEY = "svc";
  authState.userId = "priya";
  rlState.allow = true;
  gw.calls = [];
  gw.result = null;
  boardState.ctx = null;
  retrieval.result = {
    passages: [{ document_id: "doc-a", title: "Lecture 07.pdf", heading: "7.4 Coin Change", loc: "p.16", text: "greedy fails for {1,5,12}" }],
    source_refs: [{ document_id: "doc-a", title: "Lecture 07.pdf", heading: "7.4 Coin Change", loc: "p.16" }],
    used: 1,
  };
  vi.resetModules();
  mod = await import("../api/room-ai.ts");
});
afterEach(() => vi.unstubAllGlobals());

describe("gates", () => {
  it("401s an anonymous caller", async () => {
    authState.userId = null; routes();
    const res = makeRes();
    await mod.default(post({ roomId: ROOM, message: "hi" }), res);
    expect(res.statusCode).toBe(401);
  });

  it("403s a non-member and never calls the model", async () => {
    routes({ member: [] });
    const res = makeRes();
    await mod.default(post({ roomId: ROOM, message: "hi" }), res);
    expect(res.statusCode).toBe(403);
    expect(gw.calls).toHaveLength(0);
  });

  it("429s when rate-limited, before spending anything", async () => {
    rlState.allow = false; routes();
    const res = makeRes();
    await mod.default(post({ roomId: ROOM, message: "hi" }), res);
    expect(res.statusCode).toBe(429);
    expect(gw.calls).toHaveLength(0);
  });

  it("409s when no AI session is active rather than answering with default settings", async () => {
    routes({ session: null });
    const res = makeRes();
    await mod.default(post({ roomId: ROOM, message: "hi" }), res);
    expect(res.statusCode).toBe(409);
    expect(gw.calls).toHaveLength(0);
  });

  it.each([
    ["a non-uuid roomId", { roomId: "nope", message: "hi" }],
    ["an empty message", { roomId: ROOM, message: "   " }],
  ])("400s %s", async (_l, body) => {
    routes();
    const res = makeRes();
    await mod.default(post(body), res);
    expect(res.statusCode).toBe(400);
  });

  it("413s an oversized message", async () => {
    routes();
    const res = makeRes();
    await mod.default(post({ roomId: ROOM, message: "x".repeat(4001) }), res);
    expect(res.statusCode).toBe(413);
  });
});

describe("PRIVACY — the room plan must never leave the server", () => {
  it("does not put the plan, participants, or a named gap in the response", async () => {
    routes();
    const res = makeRes();

    await mod.default(post({ roomId: ROOM, message: "why does greedy fail?" }), res);

    const wire = JSON.stringify(res.body);
    expect(wire).not.toContain("Marcus");
    expect(wire).not.toContain("dynamic programming");     // Marcus's gap
    expect(wire).not.toContain("participant_summaries");
    expect(wire).not.toContain("peer_teaching_pairs");
    expect(res.body.plan).toBeUndefined();
    expect(res.body.grounded.planVersion).toBe(3);          // a number only
  });

  it("DOES give the plan to the system prompt — that is the whole point of composing it", async () => {
    routes();
    const res = makeRes();

    await mod.default(post({ roomId: ROOM, message: "q" }), res);

    // Guards against the opposite failure: a "safe" endpoint that silently drops the plan
    // would pass the leak test above while making AI-02 pointless.
    expect(gw.calls[0].system).toContain("ROOM TEACHING PLAN");
    expect(gw.calls[0].system).toContain("Marcus");
  });
});

describe("grounding", () => {
  it("builds a group-scope prompt with the session's persona", async () => {
    routes();
    const res = makeRes();
    await mod.default(post({ roomId: ROOM, message: "q" }), res);
    expect(gw.calls[0].system).toContain("SCOPE (group turn)");
    expect(res.body.persona).toBe("challenger");
  });

  it("cites the retrieved sources in the grounding ref", async () => {
    routes();
    const res = makeRes();
    await mod.default(post({ roomId: ROOM, message: "q" }), res);
    expect(res.body.grounded.sources).toEqual([{ documentId: "doc-a", title: "Lecture 07.pdf" }]);
    expect(res.body.grounded.generalKnowledge).toBe(false);
  });

  it("names the board revision it used, so the model can cite it", async () => {
    boardState.ctx = { revision: 47, extract: { revision: 47, texts: [{ text: "DP[i] = min(...)" }], images: [], ink_stroke_count: 0, shape_counts: {} }, digest: "d", render_path: null, created_at: "t" };
    routes();
    const res = makeRes();

    await mod.default(post({ roomId: ROOM, message: "what's on the board?" }), res);

    expect(res.body.grounded.boardRevision).toBe(47);
    expect(gw.calls[0].system).toContain("Board revision in context: 47");
    expect(gw.calls[0].system).toContain("DP[i] = min(...)");
  });

  it("flags generalKnowledge when nothing grounds the answer", async () => {
    retrieval.result = { passages: [], source_refs: [], used: 0, reason: "no_room_sources" };
    boardState.ctx = null;
    routes();
    const res = makeRes();

    await mod.default(post({ roomId: ROOM, message: "unrelated" }), res);

    expect(res.body.grounded).toMatchObject({ sources: [], boardRevision: null, generalKnowledge: true });
  });

  it("is NOT general knowledge when only the board grounds it", async () => {
    retrieval.result = { passages: [], source_refs: [], used: 0, reason: "no_hits" };
    boardState.ctx = { revision: 2, extract: { revision: 2, texts: [{ text: "on the board" }], images: [], ink_stroke_count: 0, shape_counts: {} }, digest: "d", render_path: null, created_at: "t" };
    routes();
    const res = makeRes();

    await mod.default(post({ roomId: ROOM, message: "q" }), res);

    expect(res.body.grounded.generalKnowledge).toBe(false);
  });

  it("still answers when the room has no plan yet", async () => {
    routes({ snap: null });
    const res = makeRes();
    await mod.default(post({ roomId: ROOM, message: "q" }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.grounded.planVersion).toBeNull();
  });
});

describe("BE-12 telemetry + failure", () => {
  it("passes the metadata the trace sink lifts into prompt_runs", async () => {
    routes();
    const res = makeRes();

    await mod.default(post({ roomId: ROOM, message: "q" }), res);

    expect(gw.calls[0].metadata).toEqual({
      scope: "group", user_id: "priya", room_id: ROOM, session_id: SESSION, persona: "challenger",
    });
    expect(res.body.trace_id).toBe("trace-1");
  });

  it("surfaces a gateway failure instead of returning an empty answer as success", async () => {
    gw.result = { ok: false, status: 503, content: "", error: "upstream down", trace_id: "t" };
    routes();
    const res = makeRes();

    await mod.default(post({ roomId: ROOM, message: "q" }), res);

    expect(res.statusCode).toBe(503);
    expect(res.body.error).toContain("upstream down");
  });

  it("rejects an unknown action", async () => {
    routes();
    const res = makeRes();
    await mod.default({ method: "POST", query: { action: "private" }, headers: {}, body: {} }, res);
    expect(res.statusCode).toBe(400);
  });
});

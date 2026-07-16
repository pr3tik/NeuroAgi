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

// Marcus's private Brain + thread. Neither may ever surface on Priya's turn.
const MARCUS_BRAIN = "# Learning profile — Marcus\n## Working on\n- dynamic programming (confidence 30%)";
const PRIYA_BRAIN = "# Learning profile — Priya\n## Working on\n- recurrences (confidence 40%)";

type Calls = { url: string; method: string; body?: any }[];
function routes({
  member = [{ user_id: "priya" }] as any[],
  session = { id: SESSION, config_version: 3 } as any,
  cfg = { persona: "challenger", intervention_intensity: "active" } as any,
  snap = PLAN_SNAP as any,
  brain = { active_version_id: "ver-priya" } as any,
  version = { profile: null, markdown: PRIYA_BRAIN } as any,
  thread = { id: "thread-priya" } as any,
  history = [] as any[],
} = {}) {
  const calls: Calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url: any, init: any = {}) => {
    const u = String(url);
    const method = String(init.method ?? "GET").toUpperCase();
    calls.push({ url: u, method, body: typeof init.body === "string" ? JSON.parse(init.body) : undefined });
    if (u.includes("room_members?")) return R(member);
    if (u.includes("room_ai_sessions?")) return R(session ? [session] : []);
    if (u.includes("room_configs?")) return R(cfg ? [cfg] : []);
    if (u.includes("room_brain_snapshots?")) return R(snap ? [snap] : []);
    if (u.includes("student_brains?")) return R(brain ? [brain] : []);
    if (u.includes("brain_versions?")) return R(version ? [version] : []);
    if (u.includes("private_threads?") && method === "GET") return R(thread ? [thread] : []);
    if (u.includes("private_threads") && method === "POST") return R([{ id: "thread-new" }]);
    if (u.includes("private_messages?") && method === "GET") return R(history);
    if (u.includes("private_messages") && method === "POST") return R([]);
    return R([]);
  }));
  return calls;
}

let mod: any;
const post = (body: any) => ({ method: "POST", query: { action: "group" }, headers: {}, body });
const postPrivate = (body: any) => ({ method: "POST", query: { action: "private" }, headers: {}, body });

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
    await mod.default({ method: "POST", query: { action: "bogus" }, headers: {}, body: {} }, res);
    expect(res.statusCode).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AI-05 — private turn. STUDYROOM_ARCHITECTURE.md §7 lists "Private-thread leakage"
// as a release-gate threat and the plan puts AI-05 isolation on the never-cut list.
// Ryan adversarially tests this, so these are written as the attacks he'd run.
// ─────────────────────────────────────────────────────────────────────────────
describe("AI-05 private — ISOLATION (the attacks)", () => {
  it("NEVER puts the room plan in a private prompt — a 1:1 turn must not carry group pedagogy", async () => {
    // The plan names Marcus and his gap. In a private turn with Priya, that is a
    // cross-student leak, so buildRoomSystemPrompt is contractually passed null.
    routes();
    const res = makeRes();

    await mod.default(postPrivate({ roomId: ROOM, message: "I'm stuck" }), res);

    expect(gw.calls[0].system).not.toContain("ROOM TEACHING PLAN");
    expect(gw.calls[0].system).not.toContain("Marcus");
    expect(gw.calls[0].system).not.toContain("dynamic programming");
    expect(res.body.grounded.planVersion).toBeNull();
  });

  it("reads the CALLER'S Brain and only the caller's — never a peer's", async () => {
    const calls = routes({ version: { profile: null, markdown: PRIYA_BRAIN } });
    const res = makeRes();

    await mod.default(postPrivate({ roomId: ROOM, message: "help" }), res);

    expect(gw.calls[0].system).toContain("Priya");
    expect(gw.calls[0].system).not.toContain(MARCUS_BRAIN);
    // Both Brain reads must be keyed by the caller — no addressable path to a peer's.
    expect(calls.find(c => c.url.includes("student_brains?"))!.url).toContain("user_id=eq.priya");
    expect(calls.find(c => c.url.includes("brain_versions?"))!.url).toContain("user_id=eq.priya");
  });

  it("ignores a userId in the body — the JWT identity is the only one that counts", async () => {
    // The IDOR: ask as Priya, claim to be Marcus, hope to get Marcus's Brain.
    const calls = routes();
    const res = makeRes();

    await mod.default(postPrivate({ roomId: ROOM, message: "help", userId: "marcus" }), res);

    for (const frag of ["student_brains?", "brain_versions?", "private_threads?"]) {
      const c = calls.find(x => x.url.includes(frag));
      expect(c!.url).toContain("priya");
      expect(c!.url).not.toContain("marcus");
    }
  });

  it("scopes the thread lookup to the caller, so a peer's thread is not addressable", async () => {
    const calls = routes();
    const res = makeRes();

    await mod.default(postPrivate({ roomId: ROOM, message: "help" }), res);

    const t = calls.find(c => c.url.includes("private_threads?"))!;
    expect(t.url).toContain("user_id=eq.priya");
    expect(t.url).toContain(`session_id=eq.${SESSION}`);
  });

  it("403s a non-member before touching any Brain", async () => {
    const calls = routes({ member: [] });
    const res = makeRes();

    await mod.default(postPrivate({ roomId: ROOM, message: "help" }), res);

    expect(res.statusCode).toBe(403);
    expect(calls.find(c => c.url.includes("student_brains?"))).toBeUndefined();
    expect(gw.calls).toHaveLength(0);
  });

  it("401s an anonymous caller", async () => {
    authState.userId = null;
    routes();
    const res = makeRes();
    await mod.default(postPrivate({ roomId: ROOM, message: "help" }), res);
    expect(res.statusCode).toBe(401);
  });
});

describe("AI-05 private — behaviour", () => {
  it("builds a private-scope prompt", async () => {
    routes();
    const res = makeRes();
    await mod.default(postPrivate({ roomId: ROOM, message: "help" }), res);
    expect(gw.calls[0].system).toContain("SCOPE (private turn)");
    expect(res.body.scope).toBe("private");
  });

  it("still grounds in the SHARED sources and board — those are not private", async () => {
    boardState.ctx = { revision: 12, extract: { revision: 12, texts: [{ text: "board note" }], images: [], ink_stroke_count: 0, shape_counts: {} }, digest: "d", render_path: null, created_at: "t" };
    routes();
    const res = makeRes();

    await mod.default(postPrivate({ roomId: ROOM, message: "explain this" }), res);

    expect(res.body.grounded.sources).toEqual([{ documentId: "doc-a", title: "Lecture 07.pdf" }]);
    expect(res.body.grounded.boardRevision).toBe(12);
  });

  it("reuses the caller's open thread instead of opening a second one", async () => {
    const calls = routes({ thread: { id: "thread-priya" } });
    const res = makeRes();

    await mod.default(postPrivate({ roomId: ROOM, message: "again" }), res);

    expect(res.body.threadId).toBe("thread-priya");
    expect(calls.filter(c => c.method === "POST" && c.url.includes("private_threads"))).toHaveLength(0);
  });

  it("opens a thread on the first ask", async () => {
    const calls = routes({ thread: null });
    const res = makeRes();

    await mod.default(postPrivate({ roomId: ROOM, message: "first time" }), res);

    expect(res.body.threadId).toBe("thread-new");
    const created = calls.find(c => c.method === "POST" && c.url.includes("private_threads"))!;
    expect(created.body).toMatchObject({ user_id: "priya", room_id: ROOM, session_id: SESSION, status: "open" });
  });

  it("feeds the caller's own history back as conversation context", async () => {
    routes({ history: [{ author_type: "ai", body: "earlier answer" }, { author_type: "user", body: "earlier question" }] });
    const res = makeRes();

    await mod.default(postPrivate({ roomId: ROOM, message: "follow up" }), res);

    // Stored newest-first, replayed oldest-first, with the new turn last.
    expect(gw.calls[0].messages).toEqual([
      { role: "user", content: "earlier question" },
      { role: "assistant", content: "earlier answer" },
      { role: "user", content: "follow up" },
    ]);
  });

  it("persists both turns after a successful answer", async () => {
    const calls = routes();
    const res = makeRes();

    await mod.default(postPrivate({ roomId: ROOM, message: "my question" }), res);

    const saved = calls.find(c => c.method === "POST" && c.url.includes("private_messages"))!;
    expect(saved.body).toEqual([
      { thread_id: "thread-priya", author_type: "user", body: "my question" },
      { thread_id: "thread-priya", author_type: "ai", body: "Because greedy lacks the greedy-choice property." },
    ]);
  });

  it("saves NOTHING when the model call fails — a dangling user turn would replay as context", async () => {
    gw.result = { ok: false, status: 503, content: "", error: "upstream down", trace_id: "t" };
    const calls = routes();
    const res = makeRes();

    await mod.default(postPrivate({ roomId: ROOM, message: "q" }), res);

    expect(res.statusCode).toBe(503);
    expect(calls.filter(c => c.method === "POST" && c.url.includes("private_messages"))).toHaveLength(0);
  });

  it("still helps a student who has no Brain yet, just un-personalised", async () => {
    routes({ brain: null });
    const res = makeRes();

    await mod.default(postPrivate({ roomId: ROOM, message: "help" }), res);

    expect(res.statusCode).toBe(200);
    expect(gw.calls[0].system).not.toContain("STUDENT LEARNING PROFILE");
  });

  it("falls back to the canonical profile when the markdown projection is missing", async () => {
    routes({
      version: { markdown: null, profile: {
        identity: { display_name: "Priya" }, strengths: [], gaps: [{ topic: "recurrences", confidence: 0.4 }],
        teaching_preferences: [], known_examples: [], mastery_evidence: [],
        interaction_preferences: { invite_style: "open_invite", private_first: false },
        accessibility: [], do_not_use: [],
      } },
    });
    const res = makeRes();

    await mod.default(postPrivate({ roomId: ROOM, message: "help" }), res);

    expect(gw.calls[0].system).toContain("Priya");
    expect(gw.calls[0].system).toContain("recurrences");
  });

  it("tags telemetry as private scope", async () => {
    routes();
    const res = makeRes();
    await mod.default(postPrivate({ roomId: ROOM, message: "q" }), res);
    expect(gw.calls[0].metadata).toMatchObject({ scope: "private", user_id: "priya", session_id: SESSION });
  });
});

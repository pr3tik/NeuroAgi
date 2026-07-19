// @vitest-environment node
// BE-10 — api/room-activity.ts, the participation ingest.
//
// The headline test is the exit criterion: a synthetic burst flood must NOT create a
// row-per-event. The batch is aggregated by type before it hits activity_events, and
// participant_metrics is recomputed from the log (not incremented) so replay can't inflate.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { makeRes } from "./helpers";

const authState = vi.hoisted(() => ({ userId: "priya" as string | null }));
vi.mock("../api/_auth.ts", () => ({
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

function R(data: any) { return { ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) }; }
type Call = { url: string; method: string; body?: any };
function stubDb(route: (u: string, method: string, body: any) => any | undefined) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: any, init: any = {}) => {
    const u = String(url);
    const method = String(init.method ?? "GET").toUpperCase();
    const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ url: u, method, body });
    return route(u, method, body) ?? R([]);
  }));
  return calls;
}

const ROOM = "11111111-1111-4111-8111-111111111111";
const SESSION = "22222222-2222-4222-8222-222222222222";

/** `logRows` = what a recompute read of activity_events returns (type+magnitude). */
function routes({ member = [{ user_id: "priya" }] as any[], session = [{ id: SESSION }] as any[], logRows = [] as any[] } = {}) {
  return stubDb((u, method) => {
    if (u.includes("room_members?")) return R(member);
    if (u.includes("room_ai_sessions?")) return R(session);
    if (u.includes("activity_events?") && method === "GET") return R(logRows);   // recompute read
    if (u.includes("activity_events") && method === "POST") return R(null);       // log insert
    if (u.includes("participant_metrics")) return R(null);                        // metrics upsert
    return undefined;
  });
}

let mod: any;
const post = (body: any) => ({ method: "POST", query: {}, headers: {}, body });

beforeEach(async () => {
  process.env.SUPABASE_URL = "http://localhost";
  process.env.SUPABASE_SERVICE_KEY = "svc";
  authState.userId = "priya";
  rlState.allow = true;
  vi.resetModules();
  mod = await import("../api/room-activity.ts");
});
afterEach(() => vi.unstubAllGlobals());

describe("gates", () => {
  it("401s an anonymous caller", async () => {
    authState.userId = null; routes();
    const res = makeRes();
    await mod.default(post({ sessionId: SESSION, roomId: ROOM, events: [{ type: "chat_sent" }] }), res);
    expect(res.statusCode).toBe(401);
  });

  it("403s a non-member and writes nothing", async () => {
    const calls = routes({ member: [] });
    const res = makeRes();
    await mod.default(post({ sessionId: SESSION, roomId: ROOM, events: [{ type: "chat_sent" }] }), res);
    expect(res.statusCode).toBe(403);
    expect(calls.filter(c => c.method === "POST" && c.url.includes("activity_events"))).toHaveLength(0);
  });

  it("409s when the session does not belong to the room (cross-session write)", async () => {
    const calls = routes({ session: [] });
    const res = makeRes();
    await mod.default(post({ sessionId: SESSION, roomId: ROOM, events: [{ type: "chat_sent" }] }), res);
    expect(res.statusCode).toBe(409);
    expect(calls.filter(c => c.method === "POST" && c.url.includes("activity_events"))).toHaveLength(0);
  });

  it("429s when rate-limited", async () => {
    rlState.allow = false; routes();
    const res = makeRes();
    await mod.default(post({ sessionId: SESSION, roomId: ROOM, events: [{ type: "chat_sent" }] }), res);
    expect(res.statusCode).toBe(429);
  });

  it.each([
    ["non-uuid sessionId", { sessionId: "x", roomId: ROOM, events: [{ type: "chat_sent" }] }],
    ["non-uuid roomId", { sessionId: SESSION, roomId: "x", events: [{ type: "chat_sent" }] }],
    ["empty events", { sessionId: SESSION, roomId: ROOM, events: [] }],
    ["missing events", { sessionId: SESSION, roomId: ROOM }],
  ])("400s %s", async (_l, body) => {
    routes();
    const res = makeRes();
    await mod.default(post(body), res);
    expect(res.statusCode).toBe(400);
  });

  it("413s an over-long batch", async () => {
    routes();
    const res = makeRes();
    await mod.default(post({ sessionId: SESSION, roomId: ROOM, events: new Array(201).fill({ type: "chat_sent" }) }), res);
    expect(res.statusCode).toBe(413);
  });
});

describe("EXIT CRITERION — burst flood does not create row-per-event", () => {
  it("collapses 50 same-type events into ONE aggregated row of summed magnitude", async () => {
    const calls = routes();
    const res = makeRes();

    await mod.default(post({ sessionId: SESSION, roomId: ROOM, events: new Array(50).fill({ type: "chat_sent" }) }), res);

    const insert = calls.find(c => c.method === "POST" && c.url.includes("activity_events"))!;
    expect(insert.body).toHaveLength(1);                 // one row, not 50
    expect(insert.body[0]).toMatchObject({ type: "chat_sent", magnitude: 50 });
    expect(res.body).toMatchObject({ ok: true, buckets_written: 1, events_received: 50 });
  });

  it("writes one row per DISTINCT type, magnitudes summed within type", async () => {
    const calls = routes();
    const res = makeRes();

    await mod.default(post({ sessionId: SESSION, roomId: ROOM, events: [
      { type: "chat_sent" }, { type: "chat_sent" }, { type: "board_burst", magnitude: 3 }, { type: "board_burst", magnitude: 2 },
    ] }), res);

    const insert = calls.find(c => c.method === "POST" && c.url.includes("activity_events"))!;
    const rows = Object.fromEntries(insert.body.map((r: any) => [r.type, r.magnitude]));
    expect(insert.body).toHaveLength(2);
    expect(rows).toEqual({ chat_sent: 2, board_burst: 5 });
  });

  it("caps a single aggregated magnitude so one call cannot inflate a channel", async () => {
    const calls = routes();
    const res = makeRes();

    await mod.default(post({ sessionId: SESSION, roomId: ROOM, events: [{ type: "chat_sent", magnitude: 99999 }] }), res);

    const insert = calls.find(c => c.method === "POST" && c.url.includes("activity_events"))!;
    expect(insert.body[0].magnitude).toBe(600);          // MAX_MAGNITUDE
  });

  it("drops unknown event types without failing the whole batch", async () => {
    const calls = routes();
    const res = makeRes();

    await mod.default(post({ sessionId: SESSION, roomId: ROOM, events: [
      { type: "chat_sent" }, { type: "not_a_real_type" }, { type: "definitely_fake" },
    ] }), res);

    const insert = calls.find(c => c.method === "POST" && c.url.includes("activity_events"))!;
    expect(insert.body).toHaveLength(1);
    expect(insert.body[0].type).toBe("chat_sent");
    expect(res.body.dropped).toBe(2);
  });

  it("400s when every event in the batch is an unknown type", async () => {
    routes();
    const res = makeRes();
    await mod.default(post({ sessionId: SESSION, roomId: ROOM, events: [{ type: "fake" }] }), res);
    expect(res.statusCode).toBe(400);
  });
});

describe("participant_metrics — recomputed from the log, not incremented", () => {
  it("derives sub-scores by summing the activity log per channel (idempotent)", async () => {
    const calls = routes({ logRows: [
      { type: "chat_sent", magnitude: 10 },
      { type: "board_burst", magnitude: 4 },
      { type: "peer_reply", magnitude: 2 },
      { type: "talk_to_ai", magnitude: 1 },
      { type: "focus_state", magnitude: 120 },
      { type: "hand_raise", magnitude: 5 },   // not a scored channel → ignored
    ] });
    const res = makeRes();

    await mod.default(post({ sessionId: SESSION, roomId: ROOM, events: [{ type: "chat_sent" }] }), res);

    const upsert = calls.find(c => c.method === "POST" && c.url.includes("participant_metrics"))!;
    expect(upsert.url).toContain("on_conflict=session_id,user_id");     // keyed upsert, not blind insert
    expect(upsert.body).toMatchObject({
      session_id: SESSION, user_id: "priya",
      chat_score: 10, board_score: 4, peer_score: 2, help_score: 1, active_seconds: 120,
    });
    expect(res.body.metrics).toMatchObject({ chat_score: 10, board_score: 4, peer_score: 2, help_score: 1 });
  });

  it("recompute reads the CALLER's own rows only", async () => {
    const calls = routes({ logRows: [] });
    const res = makeRes();

    await mod.default(post({ sessionId: SESSION, roomId: ROOM, events: [{ type: "chat_sent" }] }), res);

    const read = calls.find(c => c.method === "GET" && c.url.includes("activity_events?"))!;
    expect(read.url).toContain("user_id=eq.priya");
    expect(read.url).toContain(`session_id=eq.${SESSION}`);
  });
});

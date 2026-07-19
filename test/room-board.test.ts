// @vitest-environment node
// AI-06 / BE-07 — api/room-board.ts, the board snapshot pipeline.
//
// Covers the auth gate, the client-push contract, and the three ways a snapshot can be a
// no-op: unchanged digest, stale revision, and a race lost to another client. Those matter
// because the board emits continuously and whiteboard_snapshots is immutable + uniquely
// keyed on (room_id, revision) — every one of these paths is reachable in a real session.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { makeRes } from "./helpers";

const authState = vi.hoisted(() => ({ userId: "priya" as string | null }));
vi.mock("../api/_auth.ts", () => ({
  requireUser: async () => (authState.userId ? { userId: authState.userId, authId: "test" } : null),
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

function R(data: any, opts: { ok?: boolean; status?: number } = {}) {
  const { ok = true, status = 200 } = opts;
  return { ok, status, json: async () => data, text: async () => JSON.stringify(data) };
}
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

const textStroke = (t: string, x = 0, y = 0, id = "s1") => ({
  id, room_id: ROOM, user_id: "priya", name: "Priya",
  mode: "pen", style: "text", color: "#000", width: 3,
  points: [{ x, y, t }], created_at: "2026-07-17T14:00:00Z",
});

/** `latest` = the newest whiteboard_snapshots row (null = board never snapshotted). */
function routes({ member = [{ user_id: "priya" }] as any[], latest = null as any, insert = null as any } = {}) {
  return stubDb((u, method) => {
    if (u.includes("room_members?")) return R(member);
    if (u.includes("whiteboard_snapshots?") && method === "GET") return R(latest ? [latest] : []);
    if (u.includes("whiteboard_snapshots") && method === "POST") {
      if (insert === "duplicate") return R({ message: "duplicate key value violates unique constraint (23505)" }, { ok: false, status: 409 });
      return R([{ id: "snap-1", revision: insert?.revision ?? 5, digest: insert?.digest ?? "d" }]);
    }
    return undefined;
  });
}

let mod: any;
const post = (body: any) => ({ method: "POST", query: { action: "snapshot" }, headers: {}, body });

beforeEach(async () => {
  process.env.SUPABASE_URL = "http://localhost";
  process.env.SUPABASE_SERVICE_KEY = "svc";
  authState.userId = "priya";
  rlState.allow = true;
  vi.resetModules();
  mod = await import("../api/room-board.ts");
});
afterEach(() => vi.unstubAllGlobals());

describe("snapshot — auth", () => {
  it("401s an anonymous caller", async () => {
    authState.userId = null;
    routes();
    const res = makeRes();
    await mod.default(post({ roomId: ROOM, revision: 1, strokes: [] }), res);
    expect(res.statusCode).toBe(401);
  });

  it("403s a non-member and writes nothing", async () => {
    const calls = routes({ member: [] });
    const res = makeRes();
    await mod.default(post({ roomId: ROOM, revision: 1, strokes: [textStroke("hi")] }), res);
    expect(res.statusCode).toBe(403);
    expect(calls.filter(c => c.method === "POST" && c.url.includes("whiteboard_snapshots"))).toHaveLength(0);
  });

  it("429s when rate-limited", async () => {
    rlState.allow = false;
    routes();
    const res = makeRes();
    await mod.default(post({ roomId: ROOM, revision: 1, strokes: [] }), res);
    expect(res.statusCode).toBe(429);
  });
});

describe("snapshot — validation", () => {
  it.each([
    ["a non-uuid roomId", { roomId: "not-a-uuid", revision: 1, strokes: [] }],
    ["a non-uuid sessionId", { roomId: ROOM, sessionId: "nope", revision: 1, strokes: [] }],
    ["a negative revision", { roomId: ROOM, revision: -1, strokes: [] }],
    ["a fractional revision", { roomId: ROOM, revision: 1.5, strokes: [] }],
    ["missing strokes", { roomId: ROOM, revision: 1 }],
    ["missing strokes with no revision either", { roomId: ROOM }],
  ])("400s %s", async (_label, body) => {
    routes();
    const res = makeRes();
    await mod.default(post(body), res);
    expect(res.statusCode).toBe(400);
  });

  it("413s an implausibly huge board instead of extracting it", async () => {
    routes();
    const res = makeRes();
    await mod.default(post({ roomId: ROOM, revision: 1, strokes: new Array(20_001).fill(textStroke("x")) }), res);
    expect(res.statusCode).toBe(413);
  });
});

describe("snapshot — server-assigned revision", () => {
  // Clients omit `revision`: a board has many concurrent editors and no leader, so no
  // client can know the current revision. The server is the only correct assigner.
  it("assigns revision 1 for a board that has never been snapshotted", async () => {
    const calls = routes({ latest: null });
    const res = makeRes();

    await mod.default(post({ roomId: ROOM, strokes: [textStroke("first")] }), res);

    expect(res.statusCode).toBe(200);
    expect(calls.find(c => c.method === "POST" && c.url.includes("whiteboard_snapshots"))!.body.revision).toBe(1);
  });

  it("assigns latest+1 when snapshots already exist", async () => {
    const calls = routes({ latest: { revision: 46, extracted_json: {}, digest: "other", render_path: null, created_at: "t" } });
    const res = makeRes();

    await mod.default(post({ roomId: ROOM, strokes: [textStroke("next")] }), res);

    expect(calls.find(c => c.method === "POST" && c.url.includes("whiteboard_snapshots"))!.body.revision).toBe(47);
  });

  it("stamps the assigned revision into extracted_json, so the digest's board self-describes", async () => {
    const calls = routes({ latest: { revision: 3, extracted_json: {}, digest: "other", render_path: null, created_at: "t" } });
    const res = makeRes();

    await mod.default(post({ roomId: ROOM, strokes: [textStroke("x")] }), res);

    expect(calls.find(c => c.method === "POST" && c.url.includes("whiteboard_snapshots"))!.body.extracted_json.revision).toBe(4);
  });

  it("still suppresses an unchanged board when the client omits revision", async () => {
    const { extractBoard, boardDigest } = await import("../api/_board.ts");
    const digest = boardDigest(extractBoard([textStroke("same") as any], 0));
    const calls = routes({ latest: { revision: 4, extracted_json: {}, digest, render_path: null, created_at: "t" } });
    const res = makeRes();

    await mod.default(post({ roomId: ROOM, strokes: [textStroke("same")] }), res);

    expect(res.body).toMatchObject({ ok: true, unchanged: true, revision: 4 });
    expect(calls.filter(c => c.method === "POST" && c.url.includes("whiteboard_snapshots"))).toHaveLength(0);
  });
});

describe("snapshot — persistence", () => {
  it("extracts the board and persists json, text and digest together", async () => {
    const calls = routes({ insert: { revision: 5 } });
    const res = makeRes();

    await mod.default(post({ roomId: ROOM, sessionId: SESSION, revision: 5, strokes: [textStroke("greedy fails", 0, 10)] }), res);

    expect(res.statusCode).toBe(200);
    const [ins] = calls.filter(c => c.method === "POST" && c.url.includes("whiteboard_snapshots"));
    expect(ins.body).toMatchObject({ room_id: ROOM, session_id: SESSION, revision: 5 });
    expect(ins.body.extracted_json.texts[0].text).toBe("greedy fails");
    expect(ins.body.extracted_text).toBe("greedy fails");     // derived from the same extract
    expect(ins.body.digest).toMatch(/^[0-9a-f]{64}$/);         // sha256 hex
    expect(res.body).toMatchObject({ ok: true, unchanged: false });
  });

  it("accepts a snapshot with no active session (session_id null)", async () => {
    const calls = routes({ insert: { revision: 1 } });
    const res = makeRes();
    await mod.default(post({ roomId: ROOM, revision: 1, strokes: [textStroke("x")] }), res);
    expect(res.statusCode).toBe(200);
    expect(calls.find(c => c.method === "POST" && c.url.includes("whiteboard_snapshots"))!.body.session_id).toBeNull();
  });

  it("suppresses a no-op when the digest is unchanged, reporting the existing revision", async () => {
    // The board emits continuously; re-persisting identical content would burn rows and
    // make "board revision N" meaningless.
    const { extractBoard, boardDigest } = await import("../api/_board.ts");
    const digest = boardDigest(extractBoard([textStroke("same") as any], 4));
    const calls = routes({ latest: { revision: 4, extracted_json: {}, digest, render_path: null, created_at: "t" } });
    const res = makeRes();

    await mod.default(post({ roomId: ROOM, revision: 5, strokes: [textStroke("same")] }), res);

    expect(res.body).toMatchObject({ ok: true, unchanged: true, revision: 4 });
    expect(calls.filter(c => c.method === "POST" && c.url.includes("whiteboard_snapshots"))).toHaveLength(0);
  });

  it("409s a stale revision — a lagging client must not rewrite history", async () => {
    const calls = routes({ latest: { revision: 9, extracted_json: {}, digest: "other", render_path: null, created_at: "t" } });
    const res = makeRes();

    await mod.default(post({ roomId: ROOM, revision: 7, strokes: [textStroke("late")] }), res);

    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({ error: "stale revision", latestRevision: 9 });
    expect(calls.filter(c => c.method === "POST" && c.url.includes("whiteboard_snapshots"))).toHaveLength(0);
  });

  it("treats a lost race on (room_id, revision) as a no-op, not an error", async () => {
    // Two members hit the same milestone. The loser's content is equivalent — surfacing a
    // 409 to a student mid-session would be noise.
    routes({ insert: "duplicate" });
    const res = makeRes();

    await mod.default(post({ roomId: ROOM, revision: 5, strokes: [textStroke("x")] }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, unchanged: true, raced: true });
  });
});

describe("context / latestBoardContext", () => {
  it("returns the newest revision for the room", async () => {
    const calls = routes({ latest: { revision: 12, extracted_json: { revision: 12, texts: [{ text: "hi" }] }, digest: "d", render_path: "p.png", created_at: "t" } });

    const ctx = await mod.latestBoardContext(ROOM);

    expect(ctx).toMatchObject({ revision: 12, digest: "d", render_path: "p.png" });
    // Must ask for the LATEST, or the model would cite an arbitrary old board.
    const q = calls.find(c => c.url.includes("whiteboard_snapshots?"))!;
    expect(q.url).toContain("order=revision.desc");
    expect(q.url).toContain("limit=1");
  });

  it("returns null when the board has never been snapshotted", async () => {
    routes({ latest: null });
    expect(await mod.latestBoardContext(ROOM)).toBeNull();
  });

  it("tolerates a row with null extracted_json rather than handing the model undefined", async () => {
    routes({ latest: { revision: 3, extracted_json: null, digest: null, render_path: null, created_at: "t" } });
    const ctx = await mod.latestBoardContext(ROOM);
    expect(ctx.extract).toMatchObject({ revision: 3, texts: [], images: [] });
  });

  it("403s a non-member asking for board context over HTTP", async () => {
    routes({ member: [] });
    const res = makeRes();
    await mod.default({ method: "GET", query: { action: "context", roomId: ROOM }, headers: {} }, res);
    expect(res.statusCode).toBe(403);
  });

  it("rejects an unknown action", async () => {
    routes();
    const res = makeRes();
    await mod.default({ method: "POST", query: { action: "bogus" }, headers: {}, body: {} }, res);
    expect(res.statusCode).toBe(400);
  });
});

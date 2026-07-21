// @vitest-environment node
// AI-08 — api/room-triggers.ts, the cron tick that drives the pure engine over live sessions.
// Covers the fail-closed CRON_SECRET gate and the gather → evaluate → persist orchestration
// (including that a decision lands in intervention_events with a minted message_id on send).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { makeRes } from "./helpers";

function R(data: any) { return { ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) }; }
type Call = { url: string; method: string; body?: any };
function stubDb(route: (u: string, method: string) => any | undefined) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: any, init: any = {}) => {
    const u = String(url);
    const method = String(init.method ?? "GET").toUpperCase();
    const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ url: u, method, body });
    return route(u, method) ?? R([]);
  }));
  return calls;
}

const NOW = Date.now();
const SESSION = "22222222-2222-4222-8222-222222222222";
const ROOM = "11111111-1111-4111-8111-111111111111";

// A session that has been silent for >180s with budget available → the tick should SEND.
function routes({
  sessions = [{ id: SESSION, room_id: ROOM, config_version: 1, state: "active", started_at: new Date(NOW - 20 * 60000).toISOString() }] as any[],
  lastActivity = new Date(NOW - 5 * 60000).toISOString(),   // 5 min ago → silent
  history = [] as any[],
  metrics = [] as any[],
  duration = 60 as number | null,
} = {}) {
  return stubDb((u, method) => {
    if (u.includes("room_ai_sessions?state=eq.active")) return R(sessions);
    if (u.includes("room_configs?")) return R([{ persona: "facilitator", intervention_intensity: "balanced", duration_minutes: duration }]);
    if (u.includes("activity_events?") && u.includes("order=created_at.desc")) return R(lastActivity ? [{ created_at: lastActivity }] : []);
    if (u.includes("intervention_events?") && method === "GET") return R(history);
    if (u.includes("participant_metrics?")) return R(metrics);
    if (u.includes("private_threads?")) return R([]);
    if (u.includes("intervention_events") && method === "POST") return R(null);
    return undefined;
  });
}

let mod: any;
const tick = (headers: any) => ({ method: "POST", query: { action: "tick" }, headers });

beforeEach(async () => {
  process.env.SUPABASE_URL = "http://localhost";
  process.env.SUPABASE_SERVICE_KEY = "svc";
  process.env.CRON_SECRET = "test-secret";
  vi.resetModules();
  mod = await import("../api/room-triggers.ts");
});
afterEach(() => vi.unstubAllGlobals());

describe("auth — fail closed", () => {
  it("401s without the cron secret", async () => {
    routes();
    const res = makeRes();
    await mod.default(tick({}), res);
    expect(res.statusCode).toBe(401);
  });

  it("401s when CRON_SECRET is unset entirely", async () => {
    delete process.env.CRON_SECRET;
    routes();
    const res = makeRes();
    await mod.default(tick({ authorization: "Bearer anything" }), res);
    expect(res.statusCode).toBe(401);
  });

  it("accepts Bearer and x-cron-secret", async () => {
    for (const headers of [{ authorization: "Bearer test-secret" }, { "x-cron-secret": "test-secret" }]) {
      routes();
      const res = makeRes();
      await mod.default(tick(headers), res);
      expect(res.statusCode).toBe(200);
    }
  });

  it("400s an unknown action", async () => {
    routes();
    const res = makeRes();
    await mod.default({ method: "POST", query: { action: "bogus" }, headers: { authorization: "Bearer test-secret" } }, res);
    expect(res.statusCode).toBe(400);
  });
});

describe("orchestration", () => {
  it("evaluates a silent session and persists a SENT decision with a message_id", async () => {
    const calls = routes();
    const res = makeRes();

    await mod.default(tick({ authorization: "Bearer test-secret" }), res);

    expect(res.statusCode).toBe(200);
    const write = calls.find(c => c.method === "POST" && c.url.includes("intervention_events"))!;
    expect(write.body).toMatchObject({ session_id: SESSION, rule: "silence", decision: "sent" });
    expect(write.body.message_id).toBeTruthy();               // minted on send
    expect(write.body.state.message).toBeTruthy();            // template stored for the audit
    expect(res.body.results[0]).toMatchObject({ rule: "silence", decision: "sent" });
  });

  it("does not write a row when no rule fires (no-op)", async () => {
    // Recent activity → not silent; all milestones fired; no metrics → no uneven.
    const calls = routes({ lastActivity: new Date(NOW - 10_000).toISOString(), history: [
      { rule: "time_milestone", decision: "sent", state: { milestone: "25", block: 0 }, created_at: new Date(NOW).toISOString() },
      { rule: "time_milestone", decision: "sent", state: { milestone: "50", block: 0 }, created_at: new Date(NOW).toISOString() },
      { rule: "time_milestone", decision: "sent", state: { milestone: "75", block: 0 }, created_at: new Date(NOW).toISOString() },
      { rule: "time_milestone", decision: "sent", state: { milestone: "5min_left", block: 0 }, created_at: new Date(NOW).toISOString() },
    ] });
    const res = makeRes();

    await mod.default(tick({ authorization: "Bearer test-secret" }), res);

    expect(calls.filter(c => c.method === "POST" && c.url.includes("intervention_events"))).toHaveLength(0);
    expect(res.body.results[0]).toMatchObject({ decision: "no_op" });
  });

  it("suppresses (no message_id) when the silence cooldown is active", async () => {
    // No planned duration → no milestone candidates, so the ONLY live candidate is the
    // cooled-down silence (one prior send → budget still available).
    const calls = routes({ duration: null, history: [
      { rule: "silence", decision: "sent", state: { block: 0 }, created_at: new Date(NOW - 60_000).toISOString() },
    ] });
    const res = makeRes();

    await mod.default(tick({ authorization: "Bearer test-secret" }), res);

    const write = calls.find(c => c.method === "POST" && c.url.includes("intervention_events"))!;
    expect(write.body).toMatchObject({ rule: "silence", decision: "suppressed_cooldown", message_id: null });
  });

  it("one failing session does not abort the tick for the others", async () => {
    const good = { id: SESSION, room_id: ROOM, config_version: 1, state: "active", started_at: new Date(NOW - 20 * 60000).toISOString() };
    const bad = { id: "bad", room_id: "bad", config_version: 1, state: "active", started_at: new Date(NOW - 20 * 60000).toISOString() };
    // Make the bad session's config read throw by returning a non-ok for its room.
    const calls = stubDb((u, method) => {
      if (u.includes("room_ai_sessions?state=eq.active")) return R([bad, good]);
      if (u.includes("room_configs?room_id=eq.bad")) return { ok: false, status: 500, json: async () => ({}), text: async () => "boom" };
      if (u.includes("room_configs?")) return R([{ persona: "facilitator", intervention_intensity: "balanced", duration_minutes: 60 }]);
      if (u.includes("activity_events?")) return R([{ created_at: new Date(NOW - 5 * 60000).toISOString() }]);
      if (u.includes("intervention_events?") && method === "GET") return R([]);
      if (u.includes("participant_metrics?")) return R([]);
      if (u.includes("private_threads?")) return R([]);
      if (u.includes("intervention_events") && method === "POST") return R(null);
      return undefined;
    });
    const res = makeRes();

    await mod.default(tick({ authorization: "Bearer test-secret" }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.sessions).toBe(2);
    expect(res.body.results.find((r: any) => r.session === "bad").error).toBeTruthy();
    expect(res.body.results.find((r: any) => r.session === SESSION).decision).toBe("sent");
  });
});

describe("stale-room sweep (auto-close)", () => {
  const ROOM_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const ROOM_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

  function sweepRoutes({ stale = [] as any[], freshSessions = [] as any[] } = {}) {
    return stubDb((u, method) => {
      if (u.includes("room_ai_sessions?state=eq.active")) return R([]);   // no trigger work this tick
      if (u.includes("study_rooms?is_active=eq.true") && method === "GET") return R(stale);
      if (u.includes("room_sessions?room_id=in.") && method === "GET") return R(freshSessions);
      if (method === "PATCH") return R(null);
      return undefined;
    });
  }

  it("closes an idle room and stamps left_at on its dangling sessions", async () => {
    const calls = sweepRoutes({ stale: [{ id: ROOM_A }] });
    const res = makeRes();
    await mod.default(tick({ authorization: "Bearer test-secret" }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.sweep).toMatchObject({ closed: 1, roomIds: [ROOM_A] });
    const patches = calls.filter(c => c.method === "PATCH");
    const roomPatch = patches.find(c => c.url.includes("study_rooms?id=in."));
    expect(roomPatch?.url).toContain(ROOM_A);
    expect(roomPatch?.body).toEqual({ is_active: false });
    const sessPatch = patches.find(c => c.url.includes("room_sessions?room_id=in."));
    expect(sessPatch?.url).toContain("left_at=is.null");
    expect(typeof sessPatch?.body?.left_at).toBe("string");
  });

  it("spares a room with an open session that started inside the idle window", async () => {
    const calls = sweepRoutes({
      stale: [{ id: ROOM_A }, { id: ROOM_B }],
      freshSessions: [{ room_id: ROOM_A }],   // someone just joined A; heartbeat hasn't fired yet
    });
    const res = makeRes();
    await mod.default(tick({ authorization: "Bearer test-secret" }), res);
    expect(res.body.sweep).toMatchObject({ closed: 1, roomIds: [ROOM_B] });
    const roomPatch = calls.find(c => c.method === "PATCH" && c.url.includes("study_rooms?id=in."));
    expect(roomPatch?.url).toContain(ROOM_B);
    expect(roomPatch?.url).not.toContain(ROOM_A);
  });

  it("no stale rooms → no writes at all", async () => {
    const calls = sweepRoutes({ stale: [] });
    const res = makeRes();
    await mod.default(tick({ authorization: "Bearer test-secret" }), res);
    expect(res.body.sweep).toMatchObject({ closed: 0 });
    expect(calls.filter(c => c.method === "PATCH")).toHaveLength(0);
  });

  it("a sweep failure does not fail trigger delivery", async () => {
    stubDb((u, method) => {
      if (u.includes("room_ai_sessions?state=eq.active")) return R([]);
      if (u.includes("study_rooms?is_active=eq.true")) return { ok: false, status: 500, json: async () => ({}), text: async () => "boom" } as any;
      return undefined;
    });
    const res = makeRes();
    await mod.default(tick({ authorization: "Bearer test-secret" }), res);
    expect(res.statusCode).toBe(200);   // tick still succeeds
    expect(res.body.sweep?.error).toBeTruthy();
  });
});

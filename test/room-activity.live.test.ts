// @vitest-environment node
// BE-10 LIVE end-to-end — exercises api/room-activity against the REAL Supabase database.
//
// This is the verification the mocked suite cannot give: does a POST actually AGGREGATE the
// batch, land bucketed rows in activity_events, and RECOMPUTE participant_metrics in live
// Postgres? Auth is the only thing not exercised over the wire — we use the in-process
// trusted bypass (req.__internalUserId, which a real HTTP request can never set; see
// api/_auth.ts) so no JWT is needed. The auth gate itself is already proven live (401 probe)
// and unit-tested.
//
// SELF-SKIPS when SUPABASE creds are absent (CI, fresh checkout) — same pattern as the other
// *.live.test.ts files, so `npm test` stays green without a DB. Run explicitly:
//   npx vitest run test/room-activity.live.test.ts
// Everything it writes is marked `zfixE2E` and torn down in afterAll (FK order).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { randomUUID } from "crypto";
import { makeRes } from "./helpers";

function loadEnvLocal(): Record<string, string> {
  try {
    const raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
    const out: Record<string, string> = {};
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
    return out;
  } catch { return {}; }
}

const ENV = loadEnvLocal();
const URL = ENV.SUPABASE_URL || ENV.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
const KEY = ENV.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_KEY || "";
// Opt-in flag (matches the NEURO_LIVE convention) so a normal `npm test` SKIPS this — it
// must not hit the DB on every run. Run it explicitly:  ROOM_LIVE=1 npx vitest run <this>
const HAVE_DB = process.env.ROOM_LIVE === "1" && Boolean(URL && KEY);

const REST = `${URL.replace(/\/$/, "")}/rest/v1`;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

async function rest(method: string, path: string, body?: any, prefer?: string) {
  const r = await fetch(`${REST}/${path}`, {
    method, headers: prefer ? { ...H, Prefer: prefer } : H,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

// Unique per run so re-runs never collide.
const USER = "zfixE2E-user";
const ROOM = randomUUID();
let SESSION = "";

const d = describe.skipIf(!HAVE_DB);

d("BE-10 live — real DB aggregation + recompute", () => {
  beforeAll(async () => {
    // Env for the handler's db() (reads process.env at call time).
    process.env.SUPABASE_URL = URL;
    process.env.SUPABASE_SERVICE_KEY = KEY;

    // Seed the minimum valid graph (FKs: rooms/members → users; session → room).
    await rest("POST", "users", [{ id: USER, name: "ZFix E2E", email: "zfix-e2e@fixture.invalid" }], "resolution=merge-duplicates");
    await rest("POST", "study_rooms", [{ id: ROOM, created_by: USER, name: "ZFix E2E Room" }], "resolution=merge-duplicates");
    await rest("POST", "room_members", [{ room_id: ROOM, user_id: USER, role: "host", status: "joined" }], "resolution=merge-duplicates");
    const [s] = await rest("POST", "room_ai_sessions", [{ room_id: ROOM, started_by: USER, state: "active" }], "return=representation");
    SESSION = s.id;
  }, 30000);

  afterAll(async () => {
    // Teardown in FK order. Best-effort — a failed assertion must still clean up.
    for (const p of [
      `activity_events?session_id=eq.${SESSION}`,
      `participant_metrics?session_id=eq.${SESSION}`,
      `room_ai_sessions?id=eq.${SESSION}`,
      `room_members?room_id=eq.${ROOM}`,
      `study_rooms?id=eq.${ROOM}`,
      `users?id=eq.${USER}`,
    ]) { try { await rest("DELETE", p); } catch { /* ignore */ } }
  }, 30000);

  it("aggregates a 50-event burst into bucketed rows and recomputes metrics in real Postgres", async () => {
    const mod = await import("../api/room-activity.ts");

    // 50 chat_sent + 3 board_burst(magnitude 2). __internalUserId is the trusted in-process
    // auth path — unforgeable over HTTP, so this authenticates as USER without a JWT.
    const req: any = {
      method: "POST", query: {}, headers: {}, __internalUserId: USER,
      body: {
        sessionId: SESSION, roomId: ROOM,
        events: [
          ...Array(50).fill({ type: "chat_sent" }),
          ...Array(3).fill({ type: "board_burst", magnitude: 2 }),
        ],
      },
    };
    const res = makeRes();
    await mod.default(req, res);

    // 1) The endpoint reports the flood was collapsed.
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, events_received: 53, buckets_written: 2 });

    // 2) activity_events in the REAL DB: two aggregated rows, not 53.
    const events = await rest("GET", `activity_events?session_id=eq.${SESSION}&user_id=eq.${USER}&select=type,magnitude,bucket_start`);
    expect(events.length).toBe(2);
    const byType = Object.fromEntries(events.map((e: any) => [e.type, e.magnitude]));
    expect(byType).toEqual({ chat_sent: 50, board_burst: 6 });
    // Bucket is truncated to the minute (its :ss must be 00).
    expect(new Date(events[0].bucket_start).getUTCSeconds()).toBe(0);

    // 3) participant_metrics recomputed from that log.
    const [pm] = await rest("GET", `participant_metrics?session_id=eq.${SESSION}&user_id=eq.${USER}&select=*`);
    expect(pm).toMatchObject({ chat_score: 50, board_score: 6, peer_score: 0, help_score: 0 });

    // 4) IDEMPOTENCE: post the SAME 50-chat burst again. activity_events grows (append log),
    // but the recompute-from-log keeps chat_score correct at the true total — never doubles
    // from a stale increment. (Same-minute bucket → still few rows, not row-per-event.)
    const req2: any = { ...req, body: { sessionId: SESSION, roomId: ROOM, events: Array(50).fill({ type: "chat_sent" }) } };
    const res2 = makeRes();
    await mod.default(req2, res2);
    expect(res2.statusCode).toBe(200);

    const [pm2] = await rest("GET", `participant_metrics?session_id=eq.${SESSION}&user_id=eq.${USER}&select=chat_score`);
    expect(pm2.chat_score).toBe(100);   // 50 + 50, summed from the log — not 150, not doubled
  }, 45000);
});

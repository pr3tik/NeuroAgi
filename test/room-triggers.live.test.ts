// @vitest-environment node
// AI-08 LIVE end-to-end — the trigger tick against the REAL Supabase database.
// Seeds a silent active session (started 20 min ago, no recent activity), runs the cron
// handler, and confirms a real intervention_events row lands with decision=sent and a minted
// message_id. Then re-runs to confirm the silence cooldown suppresses the second one.
// Gated on ROOM_LIVE=1 so `npm test` skips it. Run:  ROOM_LIVE=1 npx vitest run <this>
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
const LIVE = process.env.ROOM_LIVE === "1" && Boolean(URL && KEY);

const REST = `${URL.replace(/\/$/, "")}/rest/v1`;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };
async function rest(method: string, path: string, body?: any, prefer?: string) {
  const r = await fetch(`${REST}/${path}`, { method, headers: prefer ? { ...H, Prefer: prefer } : H, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

const USER = "zfixT8-user";
const ROOM = randomUUID();
let SESSION = "";

describe.skipIf(!LIVE)("AI-08 live — trigger tick over a real session", () => {
  beforeAll(async () => {
    process.env.SUPABASE_URL = URL; process.env.SUPABASE_SERVICE_KEY = KEY; process.env.CRON_SECRET = "zfix-live-secret";
    await rest("POST", "users", [{ id: USER, name: "T8", email: "zfixt8@fixture.invalid" }], "resolution=merge-duplicates");
    await rest("POST", "study_rooms", [{ id: ROOM, created_by: USER, name: "ZFix T8 Room" }], "resolution=merge-duplicates");
    await rest("POST", "room_members", [{ room_id: ROOM, user_id: USER, role: "host", status: "joined" }], "resolution=merge-duplicates");
    // Config version 1 + a session started 20 min ago (so it's mid-block, milestones may be due).
    await rest("POST", "room_configs", [{ room_id: ROOM, version: 1, persona: "facilitator", intervention_intensity: "balanced", duration_minutes: null, created_by: USER }], "resolution=merge-duplicates");
    const startedAt = new Date(Date.now() - 20 * 60000).toISOString();
    const [s] = await rest("POST", "room_ai_sessions", [{ room_id: ROOM, config_version: 1, state: "active", started_by: USER, started_at: startedAt }], "return=representation");
    SESSION = s.id;
    // One activity 10 min ago → the room HAS spoken but has since gone silent (>180s).
    await rest("POST", "activity_events", [{ session_id: SESSION, room_id: ROOM, user_id: USER, type: "chat_sent", magnitude: 1, created_at: new Date(Date.now() - 10 * 60000).toISOString() }]);
  }, 30000);

  afterAll(async () => {
    for (const p of [
      `intervention_events?session_id=eq.${SESSION}`,
      `activity_events?session_id=eq.${SESSION}`,
      `room_ai_sessions?id=eq.${SESSION}`,
      `room_configs?room_id=eq.${ROOM}`,
      `room_members?room_id=eq.${ROOM}`,
      `study_rooms?id=eq.${ROOM}`,
      `users?id=eq.${USER}`,
    ]) { try { await rest("DELETE", p); } catch { /* ignore */ } }
  }, 30000);

  it("fires a silence intervention, records it live, then suppresses the second on cooldown", async () => {
    // Exercise the per-session code path the cron runs (gather context → evaluate → persist)
    // against real Postgres, scoped to OUR session so it's isolated from other active
    // sessions in the DB. The full-scan loop is covered by room-triggers.test.ts.
    const mod = await import("../api/room-triggers.ts");
    const { buildContextAndEvaluate, recordDecision } = mod as any;
    const url = process.env.SUPABASE_URL!, key = process.env.SUPABASE_SERVICE_KEY!;
    const d = {
      async select(path: string) { const r = await fetch(`${url}/rest/v1/${path}`, { headers: H }); return (await r.json()) as any[]; },
      async insert(table: string, body: any) { const r = await fetch(`${url}/rest/v1/${table}`, { method: "POST", headers: H, body: JSON.stringify(body) }); if (!r.ok) throw new Error(await r.text()); },
    };
    const sessionRow = { id: SESSION, room_id: ROOM, config_version: 1, state: "active", started_at: new Date(Date.now() - 20 * 60000).toISOString() };

    // ── Evaluation 1: the session is silent → SENT silence intervention, persisted. ──
    const { decision: dec1 } = await buildContextAndEvaluate(d, sessionRow);
    expect(dec1).toMatchObject({ rule: "silence", decision: "sent" });
    const messageId = await recordDecision(d, SESSION, dec1);
    expect(messageId).toBeTruthy();

    const rows = await rest("GET", `intervention_events?session_id=eq.${SESSION}&select=rule,decision,message_id,state&order=created_at.desc`);
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatchObject({ rule: "silence", decision: "sent" });
    expect(rows[0].message_id).toBeTruthy();
    expect(rows[0].state.message).toBeTruthy();

    // ── Evaluation 2: immediately again → the silence cooldown reads the row we just wrote
    //    from the live DB and suppresses. ──
    const { decision: dec2 } = await buildContextAndEvaluate(d, sessionRow);
    expect(dec2).toMatchObject({ rule: "silence", decision: "suppressed_cooldown" });
    await recordDecision(d, SESSION, dec2);

    const sentRows = await rest("GET", `intervention_events?session_id=eq.${SESSION}&decision=eq.sent&select=id`);
    expect(sentRows.length).toBe(1);   // still exactly one SENT — no double-fire
  }, 60000);
});

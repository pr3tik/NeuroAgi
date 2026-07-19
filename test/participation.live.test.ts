// @vitest-environment node
// AI-07 LIVE end-to-end — loadSessionParticipation against the REAL Supabase database.
// Seeds participant_metrics + student_brains consent, verifies the scoring, median, and
// opt-out exclusion read back from live Postgres, then tears everything down.
// Gated on ROOM_LIVE=1 so `npm test` skips it. Run:  ROOM_LIVE=1 npx vitest run <this>
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { randomUUID } from "crypto";

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

const SESSION = randomUUID();
const U_A = "zfixP7-a", U_B = "zfixP7-b", U_C = "zfixP7-c";

describe.skipIf(!LIVE)("AI-07 live — scoring from real participant_metrics", () => {
  beforeAll(async () => {
    process.env.SUPABASE_URL = URL; process.env.SUPABASE_SERVICE_KEY = KEY;
    // users (FK target for student_brains)
    await rest("POST", "users", [
      { id: U_A, name: "P7 A", email: "zfixp7a@fixture.invalid" },
      { id: U_B, name: "P7 B", email: "zfixp7b@fixture.invalid" },
      { id: U_C, name: "P7 C", email: "zfixp7c@fixture.invalid" },
    ], "resolution=merge-duplicates");
    // metrics: A active (chat 20 → score 7), B active but OPTED OUT with a huge score,
    // C quiet (chat 1 → score 0.35). Median over {A, C} must ignore B.
    await rest("POST", "participant_metrics", [
      { session_id: SESSION, user_id: U_A, chat_score: 20, active_seconds: 60 },
      { session_id: SESSION, user_id: U_B, chat_score: 1000, active_seconds: 60 },
      { session_id: SESSION, user_id: U_C, chat_score: 1, active_seconds: 60 },
    ], "resolution=merge-duplicates");
    // B opts out of pedagogy use.
    await rest("POST", "student_brains", [
      { user_id: U_B, consent_room_pedagogy: false },
    ], "resolution=merge-duplicates");
  }, 30000);

  afterAll(async () => {
    for (const p of [
      `participant_metrics?session_id=eq.${SESSION}`,
      `student_brains?user_id=in.("${U_A}","${U_B}","${U_C}")`,
      `users?id=in.("${U_A}","${U_B}","${U_C}")`,
    ]) { try { await rest("DELETE", p); } catch { /* ignore */ } }
  }, 30000);

  it("scores participants, marks opt-out, and excludes the opted-out from the median", async () => {
    const mod = await import("../api/_participation");
    const { participants, median } = await mod.loadSessionParticipation(SESSION);

    expect(participants.map(p => p.userId).sort()).toEqual([U_A, U_B, U_C]);

    const a = participants.find(p => p.userId === U_A)!;
    const b = participants.find(p => p.userId === U_B)!;
    expect(a.score).toBeCloseTo(7, 4);          // 0.35 * 20, 1 min present
    expect(b.optedOut).toBe(true);              // consent_room_pedagogy=false read from live DB
    // B's huge score is capped AND excluded — median is over {A:7, C:0.35}.
    expect(median).toBeCloseTo((7 + 0.35) / 2, 4);

    // The opted-out student is never flagged as under-participating.
    expect(mod.isUnderparticipating(b, median)).toBe(false);
    // The quiet one (ratio 0.35/3.675 ≈ 0.095 < 0.35) IS.
    const c = participants.find(p => p.userId === U_C)!;
    expect(mod.isUnderparticipating(c, median)).toBe(true);
  }, 30000);
});

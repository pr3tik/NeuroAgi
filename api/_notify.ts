// api/_notify.ts — server-side notification helpers (underscore = not a Vercel function).
//
// Two paths:
//   • notify()           — IMMEDIATE delivery for transactional events (friend
//                          requests, room invites, token milestones). Writes
//                          public.notifications directly; the client's realtime
//                          subscription picks it up. Bypasses the Arbiter.
//   • proposeProactive() — writes a CANDIDATE to public.proactive_signals for a
//                          background/brain agent (Intervention, Cohort). The
//                          Signal Arbiter (api/arbiter.ts) decides whether/when it
//                          actually reaches the student.
//
// deliverInApp() / deliverDiscord() are the shared delivery primitives the
// Arbiter calls once a candidate is approved.
import { createClient } from "@supabase/supabase-js";

// Lazily construct the Supabase client on FIRST DB use. Building it at module load runs
// supabase-js's realtime client, which throws "Node.js 20 detected without native
// WebSocket support" on Node 20 — that broke any importer wanting only deliverSMS (which
// never touches the DB), e.g. the notify-sms test on CI's Node 20 runner.
let _db: any = null;
function db() {
  if (!_db) {
    const supaUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "";
    const supaKey = process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? "";
    _db = createClient(supaUrl, supaKey, { db: { schema: "public" } });
  }
  return _db;
}

export type NotifType =
  | "friend_request"
  | "request_accepted"
  | "nudge"
  | "room_invite"
  | "assignment_due"
  | "milestone"
  | "ranking"
  | "intervention";

export interface NotifPayload {
  title?: string | null;
  body?: string | null;
  data?: Record<string, unknown> | null;
}

// ── Immediate in-app delivery ────────────────────────────────────────────────
// Inserts a public.notifications row. Returns the new row id (or null on error).
export async function deliverInApp(
  userId: string,
  type: string,
  opts: NotifPayload = {}
): Promise<string | null> {
  const { title = null, body = null, data = null } = opts;
  const { data: row, error } = await db()
    .from("notifications")
    .insert({ user_id: userId, type, title, body, data })
    .select("id")
    .single();
  if (error) { console.error("[notify] in-app insert failed:", error.message); return null; }
  return (row as { id?: string } | null)?.id ?? null;
}

// Backwards-compatible transactional helper (unchanged signature/behaviour).
// The client's postgres_changes subscription on notifications delivers it live.
export async function notify(
  userId: string,
  type: NotifType,
  opts: NotifPayload = {}
): Promise<void> {
  await deliverInApp(userId, type, opts);
}

// ── Discord DM delivery (shared by the Arbiter) ──────────────────────────────
const DISCORD_API = "https://discord.com/api/v10";

/** Send a Discord DM to the user behind `userId`. Returns true on success.
 *  Looks up users.discord_user_id; no-op (false) if unset or bot token missing. */
export async function deliverDiscord(userId: string, content: string): Promise<boolean> {
  const botToken = process.env.DISCORD_BOT_TOKEN;
  if (!botToken) return false;

  const { data: user } = await db()
    .from("users").select("discord_user_id").eq("id", userId).maybeSingle();
  const discordUserId = (user as { discord_user_id?: string } | null)?.discord_user_id;
  if (!discordUserId) return false;

  const headers = { Authorization: `Bot ${botToken}`, "Content-Type": "application/json" };
  // Bound each Discord call so one hung request can't stall the Arbiter past its
  // cron window (which would let the next run overlap — see api/arbiter.ts).
  const withTimeout = (ms: number) => {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), ms);
    return { signal: ac.signal, done: () => clearTimeout(t) };
  };
  try {
    const a = withTimeout(8000);
    const dm = await fetch(`${DISCORD_API}/users/@me/channels`, {
      method: "POST", headers, body: JSON.stringify({ recipient_id: discordUserId }), signal: a.signal,
    }).finally(a.done);
    if (!dm.ok) { console.error("[notify] discord createDM", dm.status); return false; }
    const { id: channelId } = await dm.json();
    const b = withTimeout(8000);
    const msg = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
      method: "POST", headers, body: JSON.stringify({ content }), signal: b.signal,
    }).finally(b.done);
    if (!msg.ok) { console.error("[notify] discord sendDM", msg.status); return false; }
    return true;
  } catch (e) {
    console.error("[notify] discord error:", (e as Error).message);
    return false;
  }
}

// ── SMS delivery (Twilio) ─────────────────────────────────────────────────────
/** Send a transactional SMS via Twilio. Returns true if Twilio accepted it for
 *  delivery; false (no throw) when Twilio env is unset, args are empty, or the API
 *  returns non-2xx. Shared primitive extracted from the assignment-reminder cron so
 *  any caller (Arbiter, tutor tools) can reach the SMS channel. */
export async function deliverSMS(to: string, body: string): Promise<boolean> {
  const sid = process.env.TWILIO_SID, token = process.env.TWILIO_TOKEN, from = process.env.TWILIO_FROM;
  if (!sid || !token || !from || !to || !body) return false;
  const creds = Buffer.from(`${sid}:${token}`).toString("base64");
  try {
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: { Authorization: `Basic ${creds}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ To: to, From: from, Body: body }).toString(),
    });
    if (!r.ok) console.error("[notify] sms non-2xx:", r.status);
    return r.ok;
  } catch (e) {
    console.error("[notify] sms error:", (e as Error).message);
    return false;
  }
}

// ── Proactive candidate (background/brain agents → the Arbiter) ───────────────
export interface ProactiveCandidate {
  agentSource: string;          // 'intervention' | 'cohort' | …
  type: string;                 // 'intervention' | 'nudge' | …
  urgencyScore?: number;        // 0-1, time sensitivity
  valueScore?: number;          // 0-1, estimated benefit
  title?: string | null;
  body?: string | null;
  data?: Record<string, unknown> | null;
  channelHint?: "in_app" | "discord";
  dedupKey?: string | null;     // de-duplicates re-proposals for the same user while pending
  expiresInHours?: number;      // default 14 — must outlast the quiet-hours window (see arbiter.ts)
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/** Write a candidate to public.proactive_signals. Idempotent per
 *  (user_id, dedupKey) while pending — a duplicate insert is treated as a no-op.
 *  Returns 'created' | 'duplicate' | 'error'. */
export async function proposeProactive(
  userId: string,
  c: ProactiveCandidate
): Promise<"created" | "duplicate" | "error"> {
  const expiresAt = new Date(Date.now() + (c.expiresInHours ?? 14) * 3600_000).toISOString();
  const { error } = await db().from("proactive_signals").insert({
    user_id:       userId,
    agent_source:  c.agentSource,
    type:          c.type,
    urgency_score: clamp01(c.urgencyScore ?? 0.5),
    value_score:   clamp01(c.valueScore ?? 0.5),
    title:         c.title ?? null,
    body:          c.body ?? null,
    data:          c.data ?? null,
    channel_hint:  c.channelHint ?? "in_app",
    dedup_key:     c.dedupKey ?? null,
    status:        "pending",
    expires_at:    expiresAt,
  });
  if (!error) return "created";
  // 23505 = unique_violation → a pending candidate with this dedup_key already exists.
  if ((error as { code?: string }).code === "23505") return "duplicate";
  console.error("[notify] proposeProactive failed:", error.message);
  return "error";
}

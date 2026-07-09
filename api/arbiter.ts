/**
 * api/arbiter.ts — the Signal Arbiter (Vercel Cron).
 *
 * The confidence gate for ALL background/brain-initiated notifications. Background
 * agents (Intervention now, Cohort later) write candidates to public.proactive_signals
 * instead of delivering directly; this job batches them per student and decides
 * what actually reaches them:
 *
 *   pending proactive_signals  ──group by user──▶  dedup → rank (urgency×value)
 *      → rate-limit (≤1/hr, ≤3/day)  → quiet hours (local 23:00–08:00, urgent bypasses)
 *      → claim top candidate (atomic)  → reserve notification_queue row → deliver
 *      → (public.notifications  ±  Discord DM)  → stamp delivered_at
 *
 * Runs every 5 min (see vercel.json) — the gap between runs IS the debounce window
 * that batches a student's candidates. Each run also (a) reclaims stale 'approved'
 * rows whose run died mid-delivery and (b) sweeps expired candidates.
 *
 * Concurrency note: maxDuration (below) + per-Discord-call timeouts keep a run well
 * inside the 5-min cadence, so overlapping runs are not expected. The per-user rate
 * budget counts notification_queue reservations by created_at (in-flight rows are
 * visible), and the single-candidate claim is atomic. A per-user advisory-lock RPC
 * would make the cross-candidate budget airtight if overlap ever becomes real.
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_KEY (required — RLS is disabled, server-only),
 *      CRON_SECRET (fail-closed), DISCORD_BOT_TOKEN (optional),
 *      QUIET_HOURS_TZ (optional, default America/Toronto).
 */
import { createClient } from "@supabase/supabase-js";
import { deliverInApp, deliverDiscord } from "./_notify.js";

// Cap runtime so a slow run cannot bleed past the */5 cadence and overlap the next.
export const config = { maxDuration: 60 };

const supaUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "";
// Server-only cron: require the service key (RLS is disabled on these tables).
const supaKey = process.env.SUPABASE_SERVICE_KEY ?? "";
const db = createClient(supaUrl, supaKey, { db: { schema: "public" } });

// ── Tunables ──────────────────────────────────────────────────────────────────
export const MAX_PER_DAY    = 3;        // ≤ 3 proactive messages per student per day
export const RATE_WINDOW_MS = 60 * 60 * 1000;   // ≤ 1 per hour
export const URGENT_AT      = 0.95;     // urgency ≥ this bypasses quiet hours + rate limits
const URGENT_EPS           = 1e-6;      // REAL(float4) stores 0.95 as ~0.94999999 — compare with slack
const RECLAIM_AFTER_MS     = 5 * 60 * 1000;     // an 'approved' row idle this long → run died, reclaim it
const DEFAULT_TZ           = process.env.QUIET_HOURS_TZ || "America/Toronto";
const DEFAULT_QUIET_START  = 23;        // local hour [start, end) is quiet
const DEFAULT_QUIET_END    = 8;

// ── Pure helpers (exported for tests) ──────────────────────────────────────────
export interface Candidate {
  id: string;
  user_id: string;
  urgency_score: number;
  value_score: number;
  channel_hint: string;
  dedup_key: string | null;
  created_at: string;
  [k: string]: unknown;
}

/** rank score: urgency × value (PRD §3.5.2). */
export const score = (c: Pick<Candidate, "urgency_score" | "value_score">) =>
  c.urgency_score * c.value_score;

export const isUrgent = (c: Pick<Candidate, "urgency_score">) =>
  c.urgency_score >= URGENT_AT - URGENT_EPS;

export const EXPLORE_RATE = 0.15;   // ε-greedy: share of deliveries that probe the non-preferred channel
const otherChannel = (ch: string) => (ch === "discord" ? "in_app" : "discord");

/** Pick the delivery channel. Honors the learned preference, but ε-greedily probes the
 *  OTHER channel a fraction of the time so a learned pref can't permanently starve the
 *  alternative of samples (anti-lock-in). No valid pref → use the candidate's own hint. */
export function chooseChannel(
  hint: string,
  pref: string | null,
  rand: () => number = Math.random,
  exploreRate = EXPLORE_RATE,
): string {
  if (pref !== "in_app" && pref !== "discord") return hint;
  return rand() < exploreRate ? otherChannel(pref) : pref;
}

/** Collapse candidates that share a (non-null) dedup_key, keeping the highest-scored.
 *  Returns the survivors and the dropped duplicates (to be marked 'rejected'). */
export function dedupe(cands: Candidate[]): { kept: Candidate[]; dropped: Candidate[] } {
  const best = new Map<string, Candidate>();
  const kept: Candidate[] = [];
  const dropped: Candidate[] = [];
  for (const c of cands) {
    if (!c.dedup_key) { kept.push(c); continue; }   // no key → never a duplicate
    const cur = best.get(c.dedup_key);
    if (!cur) { best.set(c.dedup_key, c); continue; }
    if (score(c) > score(cur)) { dropped.push(cur); best.set(c.dedup_key, c); }
    else                       { dropped.push(c); }
  }
  return { kept: [...kept, ...best.values()], dropped };
}

/** Highest urgency×value first; tie-break by urgency, then oldest first (anti-starvation). */
export function rank(cands: Candidate[]): Candidate[] {
  return [...cands].sort((a, b) =>
    score(b) - score(a) ||
    b.urgency_score - a.urgency_score ||
    new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
}

/** The student's local hour (0-23) in IANA `tz`; falls back to UTC on any error. */
export function localHour(date: Date, tz: string): number {
  try {
    const s = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hour12: false }).format(date);
    const h = parseInt(s, 10);
    return Number.isFinite(h) ? h % 24 : date.getUTCHours();
  } catch { return date.getUTCHours(); }
}

/** Is `hour` inside the quiet window [start, end)? Handles windows that wrap midnight. */
export function isQuietHours(hour: number, start = DEFAULT_QUIET_START, end = DEFAULT_QUIET_END): boolean {
  if (start === end) return false;
  return start < end ? (hour >= start && hour < end) : (hour >= start || hour < end);
}

// ── DB IO ───────────────────────────────────────────────────────────────────
async function pendingCandidates(): Promise<Candidate[]> {
  const nowIso = new Date().toISOString();
  const { data, error } = await db
    .from("proactive_signals").select("*")
    .eq("status", "pending").gt("expires_at", nowIso)
    .order("created_at", { ascending: true }).limit(2000);
  if (error) throw new Error(`load pending: ${error.message}`);
  return (data ?? []) as Candidate[];
}

/** Per-user budget: count notification_queue RESERVATIONS (rows created in the window).
 *  Counting by created_at — not delivered_at — makes an in-flight reservation visible
 *  to a concurrent run, and failed deliveries delete their row so they don't count. */
async function recentDelivery(userId: string): Promise<{ dayCount: number; lastHour: boolean }> {
  const dayAgo  = new Date(Date.now() - 24 * 3600_000).toISOString();
  const hourAgo = new Date(Date.now() - RATE_WINDOW_MS).toISOString();
  const { data } = await db
    .from("notification_queue").select("created_at")
    .eq("user_id", userId).gte("created_at", dayAgo);
  const rows = (data ?? []) as { created_at: string }[];
  return { dayCount: rows.length, lastHour: rows.some(r => r.created_at >= hourAgo) };
}

/** Learned best channel for this user (effectiveness feedback §3.5.4); null = use candidate hint. */
async function userChannelPref(userId: string): Promise<string | null> {
  const { data } = await db.from("intervention_tuning").select("channel_pref").eq("user_id", userId).maybeSingle();
  return ((data ?? {}) as { channel_pref?: string | null }).channel_pref ?? null;
}

async function userQuietPrefs(userId: string): Promise<{ tz: string; start: number; end: number }> {
  const { data } = await db
    .from("users").select("timezone,quiet_hours_start,quiet_hours_end").eq("id", userId).maybeSingle();
  const u = (data ?? {}) as { timezone?: string; quiet_hours_start?: number; quiet_hours_end?: number };
  return {
    tz:    u.timezone ?? DEFAULT_TZ,
    start: u.quiet_hours_start ?? DEFAULT_QUIET_START,
    end:   u.quiet_hours_end ?? DEFAULT_QUIET_END,
  };
}

/** Atomically claim a pending candidate (pending → approved + claimed_at). True iff we won. */
async function claim(id: string): Promise<boolean> {
  const { data, error } = await db
    .from("proactive_signals")
    .update({ status: "approved", claimed_at: new Date().toISOString() })
    .eq("id", id).eq("status", "pending").select("id");
  if (error) { console.error("[arbiter] claim:", error.message); return false; }
  return (data?.length ?? 0) > 0;
}

async function setStatus(ids: string[], status: string): Promise<void> {
  if (!ids.length) return;
  await db.from("proactive_signals").update({ status }).in("id", ids);
}

/** Release a claim back to pending (e.g. blocked by rate/quiet after we already claimed). */
async function release(id: string): Promise<void> {
  await db.from("proactive_signals").update({ status: "pending", claimed_at: null }).eq("id", id);
}

/** Reclaim 'approved' rows whose run died before finalizing. If the message actually
 *  went out (a delivered queue row exists) finalize as delivered; otherwise re-pend. */
async function reclaimStale(): Promise<number> {
  const staleIso = new Date(Date.now() - RECLAIM_AFTER_MS).toISOString();
  const { data } = await db
    .from("proactive_signals").select("id")
    .eq("status", "approved").lt("claimed_at", staleIso).limit(500);
  const rows = (data ?? []) as { id: string }[];
  for (const r of rows) {
    const { data: q } = await db
      .from("notification_queue").select("id")
      .eq("proactive_signal_id", r.id).not("delivered_at", "is", null).limit(1);
    if ((q?.length ?? 0) > 0) await setStatus([r.id], "delivered");  // it did deliver — don't resend
    else                      await release(r.id);                   // never delivered — let it retry
  }
  return rows.length;
}

/** Deliver an approved candidate: reserve a queue row → in-app (+ optional Discord). */
async function deliver(c: Candidate): Promise<boolean> {
  const wantDiscord = c.channel_hint === "discord";
  const channel = wantDiscord ? "discord" : "in_app";

  // The queue row is the budget reservation — created BEFORE the slow delivery so a
  // concurrent run's recentDelivery() (by created_at) can see it.
  const { data: q, error: qErr } = await db.from("notification_queue").insert({
    user_id: c.user_id, proactive_signal_id: c.id, type: c.type as string,
    channel, title: (c.title as string) ?? null, body: (c.body as string) ?? null,
    data: (c.data as Record<string, unknown>) ?? null, scheduled_for: new Date().toISOString(),
  }).select("id").single();
  if (qErr) { console.error("[arbiter] queue insert:", qErr.message); return false; }
  const queueId = (q as { id: string }).id;

  const inAppId = await deliverInApp(c.user_id, c.type as string, {
    title: (c.title as string) ?? null,
    body:  (c.body as string) ?? null,
    data:  { ...((c.data as Record<string, unknown>) ?? {}), queue_id: queueId },  // for client opened_at
  });

  let discordOk = false;
  if (wantDiscord) {
    const text = [c.title, c.body].filter(Boolean).join("\n\n") || (c.body as string) || "";
    discordOk = await deliverDiscord(c.user_id, text);
  }

  const delivered = inAppId !== null || discordOk;
  if (delivered) {
    // Record the channel that ACTUALLY delivered, not the one requested. If a Discord DM
    // silently fails (user not linked / DM closed) but the in-app insert succeeds, label it
    // 'in_app' — otherwise the feedback loop would credit in-app engagement to a Discord
    // message that never arrived and skew channel-learning toward a dead channel.
    const actualChannel = discordOk ? "discord" : "in_app";
    const { error: stampErr } = await db.from("notification_queue")
      .update({ delivered_at: new Date().toISOString(), channel: actualChannel }).eq("id", queueId);
    if (stampErr) console.error("[arbiter] delivered_at stamp failed:", stampErr.message, queueId);
  } else {
    // Nothing went out — drop the reservation so it doesn't consume the rate budget or leak.
    await db.from("notification_queue").delete().eq("id", queueId);
  }
  return delivered;
}

// ── Main handler ──────────────────────────────────────────────────────────────
export default async function handler(req: any, res: any) {
  // Fail-closed: this delivers messages + calls Discord — must not be publicly triggerable.
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return res.status(500).json({ error: "CRON_SECRET not configured" });
  const auth = req.headers?.authorization ?? req.headers?.["x-cron-secret"];
  if (auth !== `Bearer ${cronSecret}` && auth !== cronSecret) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (!supaUrl || !supaKey) return res.status(200).json({ ok: false, reason: "supabase service key not configured" });

  const started = Date.now();
  const out = { delivered: 0, deferred: 0, rejected: 0, expired: 0, reclaimed: 0, errors: 0 };

  try {
    // 0a. Reclaim stale claims (a prior run died between claim and finalize).
    out.reclaimed = await reclaimStale();

    // 0b. Sweep expired candidates (event/run missed them — §3.5.2 safety sweep).
    const nowIso = new Date().toISOString();
    const { data: exp } = await db
      .from("proactive_signals").update({ status: "expired" })
      .eq("status", "pending").lt("expires_at", nowIso).select("id");
    out.expired = exp?.length ?? 0;

    // 1. Load pending candidates and group by user.
    const all = await pendingCandidates();
    const byUser = new Map<string, Candidate[]>();
    for (const c of all) (byUser.get(c.user_id) ?? byUser.set(c.user_id, []).get(c.user_id)!).push(c);

    // 2. One batch decision per student.
    for (const [userId, cands] of byUser) {
      try {
        const { kept, dropped } = dedupe(cands);
        if (dropped.length) { await setStatus(dropped.map(d => d.id), "rejected"); out.rejected += dropped.length; }

        const top = rank(kept)[0];
        if (!top) continue;
        const urgent = isUrgent(top);

        // Rate limits (urgent bypasses, but still reserves/logs).
        if (!urgent) {
          const { dayCount, lastHour } = await recentDelivery(userId);
          if (lastHour || dayCount >= MAX_PER_DAY) { out.deferred++; continue; }  // stays pending → retry
        }
        // Quiet hours (urgent bypasses).
        if (!urgent) {
          const { tz, start, end } = await userQuietPrefs(userId);
          if (isQuietHours(localHour(new Date(), tz), start, end)) { out.deferred++; continue; }
        }

        // Atomically claim, then deliver. Release the claim if delivery itself fails.
        if (!(await claim(top.id))) { out.deferred++; continue; }
        // Deliver on the LEARNED channel, ε-greedily probing the other channel so a learned
        // pref can't lock in (chooseChannel). REMAINING LIMITATION: engagement (opened_at/
        // action_taken) is only observed via the in-app bell — Discord reads aren't visible —
        // so a genuine "Discord is better" preference can't yet be learned; that needs a
        // Discord interaction webhook (future feature, not polish).
        const pref = await userChannelPref(userId);
        top.channel_hint = chooseChannel(top.channel_hint as string, pref);
        const ok = await deliver(top);
        if (ok) { await setStatus([top.id], "delivered"); out.delivered++; }
        else    { await release(top.id); out.errors++; }  // re-pend so a transient failure retries
      } catch (e) {
        console.error(`[arbiter] user ${userId}:`, (e as Error).message);
        out.errors++;
      }
    }

    const elapsed = Date.now() - started;
    console.log(`[arbiter] done ${elapsed}ms`, out);
    return res.status(200).json({ ok: true, elapsed_ms: elapsed, ...out });
  } catch (e) {
    console.error("[arbiter] fatal:", (e as Error).message);
    return res.status(500).json({ ok: false, error: (e as Error).message });
  }
}

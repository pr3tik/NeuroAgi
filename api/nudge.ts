// api/nudge.ts — "Come study" friend nudges: rate-limited, email fallback.
// POST { fromUserId, toUserId, roomId, fromName, roomName, recipientOnline }
//   1. Rate-limit: max 2 invite nudges from→to per rolling 24h (server-enforced).
//   2. Insert the nudge row (kind 'invite') — this fires the in-app realtime
//      delivery for any recipient currently subscribed (online).
//   3. If recipientOnline is false, send a Resend "come study" email so an
//      offline friend still hears about it.
// Mirrors api/email.ts conventions (service-key Supabase + Resend + getBaseUrl).

import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import { notify } from "./_notify.js";

// Lazy clients — building them at module load breaks two ways: (1) `new Resend(undefined)`
// THROWS, turning every dev request into a 502 when RESEND_API_KEY isn't set (the in-app
// nudge needs no email at all); (2) module-load createClient crashes the Node-20 CI suite
// (supabase-js realtime needs WebSocket). Same lazy pattern as rag.ts/token-engine.ts.
let _supabase: any = null;
function db() {
  if (!_supabase) {
    _supabase = createClient(
      process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "",
      process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? ""
    );
  }
  return _supabase;
}
// null when email isn't configured — the in-app nudge still goes through; we just
// skip the offline-email fallback (emailSent stays false).
function mailer() {
  const key = process.env.RESEND_API_KEY;
  return key ? new Resend(key) : null;
}

const RATE_LIMIT = 2;                       // max nudges per friend …
const WINDOW_MS  = 24 * 60 * 60 * 1000;     // … per rolling 24h

// Same logic as api/email.ts — never link to an auth-walled *.vercel.app preview.
function getBaseUrl(req) {
  const host  = req.headers["x-forwarded-host"] || req.headers.host;
  const proto = req.headers["x-forwarded-proto"] || "https";
  const PROD_HOSTS = ["fschoolai.com", "fschool-ai.vercel.app", "neuro-agi-topaz.vercel.app", "neuro-agi.vercel.app"];
  if (host && (PROD_HOSTS.includes(host) || !host.endsWith(".vercel.app"))) {
    return `${proto}://${host}`;
  }
  return "https://fschoolai.com";
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST")    return res.status(405).end();

  const { fromUserId, toUserId, roomId, fromName, roomName, recipientOnline } = req.body ?? {};
  if (!fromUserId || !toUserId) return res.status(400).json({ error: "fromUserId and toUserId required" });
  if (fromUserId === toUserId)  return res.status(400).json({ error: "cannot nudge yourself" });

  // ── 1. Rate-limit (server-enforced — client can't bypass) ──────────────────
  const since = new Date(Date.now() - WINDOW_MS).toISOString();
  const { count } = await db()
    .from("nudges").select("id", { count: "exact", head: true })
    .eq("from_user_id", fromUserId).eq("to_user_id", toUserId).eq("kind", "invite")
    .gte("created_at", since);
  if ((count ?? 0) >= RATE_LIMIT) {
    return res.status(200).json({ sent: false, reason: "rate_limited" });
  }

  // ── 2. Write the nudge (fires in-app realtime for online recipients) ───────
  const { error: insErr } = await db().from("nudges").insert({
    from_user_id: fromUserId, to_user_id: toUserId,
    room_id: roomId ?? null, kind: "invite",
  });
  if (insErr) {
    console.error("[nudge] insert failed:", insErr.message);
    return res.status(500).json({ error: "Failed to write nudge" });
  }

  // ── 2b. Persist to notifications table so the bell picks it up ────────────
  // room_invite when roomId is present; plain nudge otherwise.
  const notifType = roomId ? "room_invite" : "nudge";
  const notifTitle = roomId
    ? `${fromName || "Someone"} invited you to a study room`
    : `${fromName || "Someone"} wants you to study`;
  notify(toUserId, notifType, {
    title: notifTitle,
    body: roomId && roomName ? `Join "${roomName}"` : undefined,
    data: { from_user_id: fromUserId, from_name: fromName ?? null, room_id: roomId ?? null, room_name: roomName ?? null },
  }).catch(() => {}); // non-blocking — nudge row is what matters for realtime

  // ── 3. Email fallback when the friend isn't currently online ───────────────
  let emailSent = false;
  const resend = mailer();
  if (!recipientOnline && resend) {
    const { data: recipient } = await db()
      .from("users").select("email, name").eq("id", toUserId).maybeSingle();

    if (recipient?.email) {
      const who  = fromName || "A friend";
      const room = roomName ? `“${roomName}”` : "a study room";
      const appUrl = getBaseUrl(req);
      try {
        await resend.emails.send({
          from:    "FSchoolAI <noreply@fschoolai.com>",
          to:      recipient.email,
          subject: `${who} wants you to study`,
          html: "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><style>body{margin:0;padding:0;background:#FDFAF4}</style></head><body>"
            + "<table width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"background:#FDFAF4\">"
            + "<tr><td align=\"center\" style=\"padding:48px 24px\">"
            + "<table width=\"480\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"max-width:480px;width:100%;background:#FDFAF4;border-top:3px solid #C49A3C\">"
            + "<tr><td style=\"padding:40px 40px 0 40px\">"
            + "<p style=\"font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:3px;text-transform:uppercase;color:rgba(26,24,20,0.4);margin:0 0 28px 0;font-weight:500\">FSchoolAI · Study Rooms</p>"
            + "<h2 style=\"font-family:Georgia,'Times New Roman',serif;font-size:28px;font-weight:700;color:#1a1814;margin:0 0 16px 0;line-height:1.2\">" + who + " is studying" + (recipient.name ? ", " + recipient.name : "") + ".</h2>"
            + "<p style=\"font-family:-apple-system,Helvetica,Arial,sans-serif;color:rgba(26,24,20,0.55);margin:0 0 32px 0;line-height:1.7;font-size:15px\">They invited you to join " + room + " on FSchoolAI. Hop in and study together.</p>"
            + "<table cellpadding=\"0\" cellspacing=\"0\" border=\"0\"><tr><td style=\"border-radius:10px;background:#1a1814\">"
            + "<a href=\"" + appUrl + "\" style=\"display:inline-block;background:#1a1814;color:#F6F2E9;text-decoration:none;padding:14px 28px;border-radius:10px;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:15px;font-weight:600\">Join the room &rarr;</a>"
            + "</td></tr></table>"
            + "</td></tr>"
            + "<tr><td style=\"padding:32px 40px 40px 40px\">"
            + "<p style=\"font-family:-apple-system,Helvetica,Arial,sans-serif;color:rgba(26,24,20,0.3);font-size:12px;line-height:1.6;margin:0;border-top:1px solid rgba(26,24,20,0.08);padding-top:24px\">You're getting this because a friend invited you to study. Manage friends in the app.</p>"
            + "</td></tr>"
            + "</table></td></tr></table>"
            + "</body></html>",
        });
        emailSent = true;
      } catch (emailErr) {
        console.error("[nudge] resend failed:", emailErr.message);
      }
    }
  }

  return res.status(200).json({ sent: true, emailSent });
}

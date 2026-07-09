// api/email.js — unified email handler
// Routes:
//   POST /api/email?action=send          — generate token, store on user, send via Resend
//   GET  /api/email?action=verify        — mark verified, show success page
//   POST /api/email?action=reset         — send password reset email (alias: send-reset)
//   GET  /api/email?action=reset-confirm — validate reset token, redirect to app

import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";

// Lazy clients (same fix as api/nudge.ts): `new Resend(undefined)` at module load THROWS,
// so with RESEND_API_KEY absent (local dev) every email action 502'd before running; and
// module-load createClient crashes the Node-20 CI suite. Call db()/mailer() per request.
let _supabase: any = null;
function db() {
  if (!_supabase) {
    _supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY,
      { db: { schema: "public" } }  // app data lives in `neuroagi`, not public.* (Vincent's)
    );
  }
  return _supabase;
}
function mailer() {
  const key = process.env.RESEND_API_KEY;
  return key ? new Resend(key) : null;
}

// Build the public base URL for email links.
// Only use the request host when it is a known production or custom domain.
// Vercel preview URLs (*.vercel.app except the production one) require
// authentication — clicking them from an email lands on the Vercel login page
// instead of running the function. Always fall back to the production domain
// for any preview or unknown host so email links work for everyone.
function getBaseUrl(req) {
  const host  = req.headers["x-forwarded-host"] || req.headers.host;
  const proto = req.headers["x-forwarded-proto"] || "https";
  // Accept known production subdomains or any custom domain (not a .vercel.app preview).
  const PROD_HOSTS = ["fschoolai.com", "fschool-ai.vercel.app", "neuro-agi-topaz.vercel.app", "neuro-agi.vercel.app"];
  if (host && (PROD_HOSTS.includes(host) || !host.endsWith(".vercel.app"))) {
    return `${proto}://${host}`;
  }
  return "https://fschoolai.com";
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();

  const action = req.query.action;

  // ── POST /api/email?action=send ──────────────────────────────────────────
  if (action === "send") {
    if (req.method !== "POST") return res.status(405).end();

    const { userId, email, name } = req.body;
    if (!userId || !email) return res.status(400).json({ error: "userId and email required" });

    const token = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, "");

    const { error } = await db()
      .from("users")
      .update({
        email_verify_token:   token,
        email_verify_sent_at: new Date().toISOString(),
        beta_signup:          true,
        beta_expires_at:      new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      })
      .eq("id", userId);

    if (error) {
      console.error("[email/send] supabase update failed:", error);
      return res.status(500).json({ error: "Failed to store token" });
    }

    const verifyUrl = getBaseUrl(req) + "/api/email?action=verify&token=" + token + "&userId=" + userId;

    try {
      await mailer()!.emails.send({
        from:    "FSchoolAI <noreply@fschoolai.com>",
        to:      email,
        subject: "Verify your FSchoolAI account",
        html: "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><style>body{margin:0;padding:0;background:#FDFAF4}</style></head><body>"
          + "<table width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"background:#FDFAF4\">"
          + "<tr><td align=\"center\" style=\"padding:48px 24px\">"
          + "<table width=\"480\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"max-width:480px;width:100%;background:#FDFAF4;border-top:3px solid #C49A3C\">"
          + "<tr><td style=\"padding:40px 40px 0 40px\">"
          + "<p style=\"font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:3px;text-transform:uppercase;color:rgba(26,24,20,0.4);margin:0 0 28px 0;font-weight:500\">FSchoolAI Beta</p>"
          + "<h2 style=\"font-family:Georgia,'Times New Roman',serif;font-size:28px;font-weight:700;color:#1a1814;margin:0 0 16px 0;line-height:1.2\">Welcome" + (name ? ", " + name : "") + ".</h2>"
          + "<p style=\"font-family:-apple-system,Helvetica,Arial,sans-serif;color:rgba(26,24,20,0.55);margin:0 0 32px 0;line-height:1.7;font-size:15px\">You’re in the beta. Verify your email to activate your free 1-month subscription and unlock full access.</p>"
          + "<table cellpadding=\"0\" cellspacing=\"0\" border=\"0\"><tr><td style=\"border-radius:10px;background:#1a1814\">"
          + "<a href=\"" + verifyUrl + "\" style=\"display:inline-block;background:#1a1814;color:#F6F2E9;text-decoration:none;padding:14px 28px;border-radius:10px;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:15px;font-weight:600\">Verify my email &rarr;</a>"
          + "</td></tr></table>"
          + "</td></tr>"
          + "<tr><td style=\"padding:32px 40px 40px 40px\">"
          + "<p style=\"font-family:-apple-system,Helvetica,Arial,sans-serif;color:rgba(26,24,20,0.3);font-size:12px;line-height:1.6;margin:0;border-top:1px solid rgba(26,24,20,0.08);padding-top:24px\">This link expires in 24 hours. If you didn’t sign up for FSchoolAI, you can safely ignore this email.</p>"
          + "</td></tr>"
          + "</table></td></tr></table>"
          + "</body></html>",
      });
    } catch (emailErr) {
      console.error("[email/send] resend failed:", emailErr.message);
      return res.status(200).json({ success: true, emailSent: false });
    }

    return res.status(200).json({ success: true, emailSent: true });
  }

  // ── GET /api/email?action=verify&token=X&userId=Y ────────────────────────
  if (action === "verify") {
    if (req.method !== "GET") return res.status(405).end();

    const { token, userId } = req.query;
    if (!token || !userId) return res.redirect("/?verify=error&reason=missing");

    const { data: user, error } = await db()
      .from("users")
      .select("id, email_verify_token, email_verify_sent_at, email_verified")
      .eq("id", userId)
      .maybeSingle();

    if (error || !user) return res.redirect("/?verify=error&reason=not_found");
    if (user.email_verified) return res.redirect("/?verify=already_done");
    if (user.email_verify_token !== token) return res.redirect("/?verify=error&reason=invalid_token");

    const sentAt     = new Date(user.email_verify_sent_at);
    const hoursSince = (Date.now() - sentAt.getTime()) / (1000 * 60 * 60);
    if (hoursSince > 24) return res.redirect("/?verify=error&reason=expired");

    const { error: updateErr } = await db()
      .from("users")
      .update({ email_verified: true, email_verify_token: null })
      .eq("id", userId);

    if (updateErr) {
      console.error("[email/verify] update failed:", updateErr);
      return res.redirect("/?verify=error&reason=db_failed");
    }

    // Standalone success page — no redirect into app so opening on phone doesn't log into someone's account
    res.setHeader("Content-Type", "text/html");
    return res.status(200).send(
      `<!DOCTYPE html><html lang="en"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Email verified — FSchoolAI</title>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,700&display=swap" rel="stylesheet"/>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#F6F2E9;color:#1a1814;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",sans-serif;min-height:100dvh;display:flex;align-items:center;justify-content:center;padding:24px}
.card{max-width:360px;width:100%;text-align:center;animation:settle .5s cubic-bezier(0.0,0.0,0.2,1.0) both}
@keyframes settle{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
@keyframes sealIn{from{opacity:0;transform:scale(.80)}to{opacity:1;transform:scale(1)}}
.seal{margin:0 auto 32px;width:80px;height:80px;animation:sealIn .55s cubic-bezier(0.34,1.15,0.64,1) both .1s}
.eyebrow{font-size:11px;letter-spacing:3px;text-transform:uppercase;color:rgba(26,24,20,0.38);font-weight:500;margin-bottom:20px}
h1{font-family:"Fraunces",Georgia,"Times New Roman",serif;font-size:36px;font-weight:700;letter-spacing:-0.5px;color:#1a1814;margin-bottom:14px;line-height:1.15}
p{font-size:15px;color:rgba(26,24,20,0.5);line-height:1.7;margin-bottom:36px}
a.btn{display:inline-block;background:#1a1814;color:#F6F2E9;text-decoration:none;padding:14px 32px;border-radius:10px;font-size:15px;font-weight:600;letter-spacing:-0.1px;transition:opacity .15s}
a.btn:hover{opacity:.82}
</style></head><body>
<div class="card">
<div class="seal">
<svg width="80" height="80" viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
<circle cx="40" cy="40" r="38" stroke="#C49A3C" stroke-width="1" stroke-dasharray="4.5 3" opacity="0.45"/>
<circle cx="40" cy="40" r="31" stroke="#C49A3C" stroke-width="1.5" opacity="0.65"/>
<circle cx="40" cy="40" r="23" fill="rgba(196,154,60,0.07)" stroke="#C49A3C" stroke-width="1.5"/>
<path d="M28 40.5l8.5 8.5 15.5-16" stroke="#C49A3C" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
</div>
<p class="eyebrow">FSchoolAI &middot; Beta</p>
<h1>Email verified.</h1>
<p>Your 1-month free subscription is active.<br/>Open the app on your device to get started.</p>
<a class="btn" href="https://fschoolai.com">Open FSchoolAI &rarr;</a>
</div></body></html>`
    );
  }

  // ── POST /api/email?action=reset (alias: send-reset) ─────────────────────
  if (action === "reset" || action === "send-reset") {
    if (req.method !== "POST") return res.status(405).end();
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "email required" });

    const { data: user } = await db()
      .from("users")
      .select("id, name")
      .eq("email", email.toLowerCase().trim())
      .maybeSingle();

    // Always return 200 — don't reveal if email exists (security)
    if (!user) return res.status(200).json({ success: true });

    // Dedicated reset_token columns — resets used to piggyback on email_verify_token,
    // which meant requesting a reset KILLED any pending verification link (and vice
    // versa): whichever email the user clicked second always failed. Never share
    // one-time-token columns between flows.
    const token = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, "");
    await db()
      .from("users")
      .update({ reset_token: token, reset_token_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString() })
      .eq("id", user.id);

    const resetUrl = getBaseUrl(req) + "/api/email?action=reset-confirm&token=" + token + "&userId=" + user.id;

    try {
      await mailer()!.emails.send({
        from:    "FSchoolAI <noreply@fschoolai.com>",
        to:      email,
        subject: "Reset your FSchoolAI password",
        html: "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><style>body{margin:0;padding:0;background:#FDFAF4}</style></head><body>"
          + "<table width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"background:#FDFAF4\">"
          + "<tr><td align=\"center\" style=\"padding:48px 24px\">"
          + "<table width=\"480\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"max-width:480px;width:100%;background:#FDFAF4;border-top:3px solid #C49A3C\">"
          + "<tr><td style=\"padding:40px 40px 0 40px\">"
          + "<p style=\"font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:3px;text-transform:uppercase;color:rgba(26,24,20,0.4);margin:0 0 28px 0;font-weight:500\">FSchoolAI</p>"
          + "<h2 style=\"font-family:Georgia,'Times New Roman',serif;font-size:28px;font-weight:700;color:#1a1814;margin:0 0 16px 0;line-height:1.2\">Reset your password.</h2>"
          + "<p style=\"font-family:-apple-system,Helvetica,Arial,sans-serif;color:rgba(26,24,20,0.55);margin:0 0 32px 0;line-height:1.7;font-size:15px\">Click below to set a new password. This link expires in 1 hour.</p>"
          + "<table cellpadding=\"0\" cellspacing=\"0\" border=\"0\"><tr><td style=\"border-radius:10px;background:#1a1814\">"
          + "<a href=\"" + resetUrl + "\" style=\"display:inline-block;background:#1a1814;color:#F6F2E9;text-decoration:none;padding:14px 28px;border-radius:10px;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:15px;font-weight:600\">Set new password &rarr;</a>"
          + "</td></tr></table>"
          + "</td></tr>"
          + "<tr><td style=\"padding:32px 40px 40px 40px\">"
          + "<p style=\"font-family:-apple-system,Helvetica,Arial,sans-serif;color:rgba(26,24,20,0.3);font-size:12px;line-height:1.6;margin:0;border-top:1px solid rgba(26,24,20,0.08);padding-top:24px\">If you didn't request a password reset, you can safely ignore this email.</p>"
          + "</td></tr>"
          + "</table></td></tr></table>"
          + "</body></html>",
      });
    } catch (emailErr) {
      console.error("[email/reset] resend failed:", emailErr.message);
    }

    return res.status(200).json({ success: true });
  }

  // ── GET /api/email?action=reset-confirm&token=X&userId=Y ─────────────────
  if (action === "reset-confirm") {
    if (req.method !== "GET") return res.status(405).end();
    const { token, userId } = req.query;
    if (!token || !userId) return res.redirect("/?reset=error");

    const { data: user } = await db()
      .from("users")
      .select("id, reset_token, reset_token_expires_at")
      .eq("id", userId)
      .maybeSingle();

    if (!user || !user.reset_token || user.reset_token !== token) return res.redirect("/?reset=error");
    if (user.reset_token_expires_at && Date.now() > new Date(user.reset_token_expires_at).getTime()) {
      return res.redirect("/?reset=expired");
    }

    return res.redirect("/?reset=confirm&token=" + token + "&userId=" + userId);
  }

  // Unknown action
  return res.status(400).json({ error: "Unknown action. Use ?action=send, verify, reset, send-reset, or reset-confirm" });
}

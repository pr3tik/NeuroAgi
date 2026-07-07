/**
 * api/assignment-reminder.js — Vercel Cron Job
 * Runs daily at 8AM UTC. Finds all users with assignments due within 48h
 * that haven't been submitted, and sends a Twilio SMS reminder.
 *
 * Add to vercel.json:
 * {
 *   "crons": [{ "path": "/api/assignment-reminder", "schedule": "0 8 * * *" }]
 * }
 *
 * Requires env vars: TWILIO_SID, TWILIO_TOKEN, TWILIO_FROM, SUPABASE_URL, SUPABASE_SERVICE_KEY
 * Note: uses SUPABASE_SERVICE_KEY (not anon key) to read all users server-side
 */

import { deliverSMS } from "./_notify.js";

const TWILIO_SID   = process.env.TWILIO_SID;
const TWILIO_TOKEN = process.env.TWILIO_TOKEN;
const TWILIO_FROM  = process.env.TWILIO_FROM;
const SB_URL       = process.env.SUPABASE_URL;
const SB_KEY       = process.env.SUPABASE_SERVICE_KEY; // service role key for server-side reads

const H48          = 48 * 60 * 60 * 1000;

async function sbFetch(path, params = {}) {
  const url = new URL(`${SB_URL}/rest/v1/${path}`);
  // Array value → append the same key multiple times (e.g. a two-sided due_at range,
  // which PostgREST ANDs together). Scalars use set (single filter).
  Object.entries(params).forEach(([k, v]) => {
    if (Array.isArray(v)) v.forEach((val) => url.searchParams.append(k, String(val)));
    else url.searchParams.set(k, String(v));
  });
  const res = await fetch(url.toString(), {
    headers: {
      apikey:        SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      "Content-Type": "application/json",
      "Accept-Profile":  "public",   // unified on public.* (live fschoolai.com schema)
      "Content-Profile": "public",
    },
  });
  return res.json();
}

// SMS delivery is now the shared deliverSMS() primitive (api/_notify.ts) — same Twilio
// call, reusable from any caller (this cron, the Arbiter, tutor tools).
const sendSMS = deliverSMS;

export default async function handler(req, res) {
  // Vercel cron sends GET; reject other methods in prod
  if (req.method !== "GET" && req.headers["x-vercel-cron"] !== "1") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!TWILIO_SID || !TWILIO_TOKEN || !TWILIO_FROM || !SB_KEY) {
    return res.status(500).json({ error: "Missing env vars" });
  }

  try {
    const now  = new Date();
    const h48  = new Date(now.getTime() + H48).toISOString();

    // Get all users who have a phone number stored
    const users = await sbFetch("users", {
      select: "id,name,phone",
      "phone": "not.is.null",
    });

    if (!Array.isArray(users) || !users.length) {
      return res.status(200).json({ sent: 0, message: "No users with phone numbers" });
    }

    let sent = 0;

    await Promise.allSettled(users.map(async (user) => {
      if (!user.phone) return;

      // Get upcoming unsubmitted assignments due within 48h
      const assignments = await sbFetch("assignments", {
        select: "title,due_at,courses(name)",
        user_id: `eq.${user.id}`,
        submitted_at: "is.null",
        // Two-sided window: due from now through +48h (h48). Previously only the lower
        // bound was applied, so the "due soon" text fired for ALL future assignments.
        due_at: [`gte.${now.toISOString()}`, `lte.${h48}`],
      });

      if (!Array.isArray(assignments) || !assignments.length) return;

      const lines = assignments.slice(0, 3).map(a => {
        const due = new Date(a.due_at);
        const h   = Math.round((+due - +now) / 3600000);
        return `• ${a.title} (${a.courses?.name ?? "?"}) — ${h}h left`;
      });

      const more = assignments.length > 3 ? `\n+${assignments.length - 3} more` : "";
      const body = `Hey ${user.name ?? "there"}! 📚 You have ${assignments.length} assignment${assignments.length > 1 ? "s" : ""} due soon:\n${lines.join("\n")}${more}\n\nfschoolai.com`;

      const ok = await sendSMS(user.phone, body);
      if (ok) sent++;
    }));

    return res.status(200).json({ sent, total: users.length });
  } catch (err) {
    console.error("Reminder cron error:", err);
    return res.status(500).json({ error: err.message });
  }
}

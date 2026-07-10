// api/waitlist.ts — Join waitlist endpoint.
// Inserts email into `waitlist` table, returns position, sends Resend confirmation.
// Table (run once in SQL editor):
//   create table if not exists waitlist (
//     id uuid default gen_random_uuid() primary key,
//     email text unique not null,
//     created_at timestamptz default now()
//   );
//   alter table waitlist disable row level security;
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

export const maxDuration = 10;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { email } = req.body ?? {};
  const clean = typeof email === "string" ? email.trim().toLowerCase() : "";
  if (!clean || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) {
    return res.status(400).json({ error: "Valid email required" });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
  );

  const { error } = await supabase.from("waitlist").insert({ email: clean });

  if (error) {
    if (error.code === "23505") {
      return res.status(200).json({ already: true });
    }
    console.error("Waitlist insert error:", error);
    return res.status(500).json({ error: "Failed to join" });
  }

  const { count } = await supabase
    .from("waitlist")
    .select("*", { count: "exact", head: true });

  const position = count ?? 1;

  // Resend confirmation email (non-fatal if it fails)
  try {
    const key = process.env.RESEND_API_KEY;
    if (key) {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "FschoolAI <hello@fschoolai.com>",
          to: clean,
          subject: "You're on the FschoolAI waitlist — launching August 1st",
          html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display',sans-serif;max-width:480px;margin:0 auto;padding:48px 24px;background:#fff;color:#1d1d1f">
            <h1 style="font-size:32px;font-weight:600;letter-spacing:-0.02em;margin:0 0 16px;color:#1d1d1f">You're on the list.</h1>
            <p style="font-size:17px;color:#6e6e73;line-height:1.6;margin:0 0 24px">You're <strong style="color:#1d1d1f">#${position}</strong> on the FschoolAI waitlist. We launch <strong style="color:#0066cc">August 1st, 2026</strong> — and you'll be the first to know.</p>
            <p style="font-size:15px;color:#6e6e73;line-height:1.65;margin:0 0 40px">FschoolAI gives you an AI tutor grounded in your actual lecture notes, live transcription, spaced-repetition flashcards, and a Canvas-connected grade tracker — all in one place.</p>
            <hr style="border:none;border-top:1px solid #e6e6e6;margin:0 0 24px">
            <p style="font-size:13px;color:#a3a3a3">© 2026 FschoolAI · You're receiving this because you joined the waitlist at fschoolai.com</p>
          </div>`,
        }),
      });
    }
  } catch (e) {
    console.error("Resend error (non-fatal):", e);
  }

  return res.status(200).json({ success: true, position });
}

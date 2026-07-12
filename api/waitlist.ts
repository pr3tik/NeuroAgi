// api/waitlist.ts — launch waitlist: join, position, batch invites.
//   POST ?action=join   { email, name?, source?, ref? }   (public)
//     → { ok, position, total, alreadyJoined } + a confirmation email (best-effort).
//   GET  ?action=stats                                     (public)
//     → { total } — social proof for the landing modal.
//   POST ?action=invite { emails: string[] }               (admin: Bearer CRON_SECRET)
//     → sets invited_at + sends each person an invite email with a ?invite=<id> link
//     that bypasses waitlist mode on the landing page and opens real signup.
// Table: public.waitlist (supabase-waitlist-migration.sql) — RLS-on server-only; the
// browser only ever talks to this endpoint. Emails via lazy Resend (nudge.ts pattern).
import { Resend } from "resend";

function sb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase env vars not configured");
  return { url, headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" } as Record<string, string> };
}
function mailer() {
  const key = process.env.RESEND_API_KEY;
  return key ? new Resend(key) : null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function appUrl(req: any) {
  const host = req.headers?.["x-forwarded-host"] || req.headers?.host;
  const PROD = ["fschoolai.com", "fschool-ai.vercel.app"];
  if (host && (PROD.includes(host) || !String(host).endsWith(".vercel.app"))) {
    const proto = req.headers?.["x-forwarded-proto"] || "https";
    return `${proto}://${host}`;
  }
  return "https://fschoolai.com";
}

async function positionOf(createdAt: string): Promise<{ position: number; total: number }> {
  const { url, headers } = sb();
  const at = encodeURIComponent(createdAt);
  const [posRes, totalRes] = await Promise.all([
    fetch(`${url}/rest/v1/waitlist?created_at=lte.${at}&select=id`, { headers: { ...headers, Prefer: "count=exact", Range: "0-0" } }),
    fetch(`${url}/rest/v1/waitlist?select=id`, { headers: { ...headers, Prefer: "count=exact", Range: "0-0" } }),
  ]);
  const count = (r: Response) => parseInt((r.headers.get("content-range") ?? "/0").split("/")[1] || "0", 10);
  return { position: count(posRes), total: count(totalRes) };
}

function confirmationHtml(name: string | null, position: number) {
  const who = name ? `, ${name}` : "";
  return `<!DOCTYPE html><html><body style="margin:0;background:#FDFAF4;font-family:-apple-system,Helvetica,Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:48px 24px">
<table width="480" style="max-width:480px;width:100%;border-top:3px solid #C49A3C">
<tr><td style="padding:40px 40px 0">
<p style="font-size:11px;letter-spacing:3px;text-transform:uppercase;color:rgba(26,24,20,.4);margin:0 0 28px;font-weight:500">FSchoolAI</p>
<h2 style="font-family:Georgia,serif;font-size:28px;color:#1a1814;margin:0 0 16px">You're on the list${who}.</h2>
<p style="color:rgba(26,24,20,.55);line-height:1.7;font-size:15px;margin:0 0 12px">You're <b>#${position}</b> in line. We're letting students in gradually so every brain gets the attention it deserves — you'll get an invite email the moment your spot opens.</p>
<p style="color:rgba(26,24,20,.35);font-size:12px;line-height:1.6;border-top:1px solid rgba(26,24,20,.08);padding-top:20px;margin-top:28px">You're receiving this because this address joined the FschoolAI waitlist. If it wasn't you, ignore this email.</p>
</td></tr></table></td></tr></table></body></html>`;
}

function inviteHtml(link: string) {
  return `<!DOCTYPE html><html><body style="margin:0;background:#FDFAF4;font-family:-apple-system,Helvetica,Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:48px 24px">
<table width="480" style="max-width:480px;width:100%;border-top:3px solid #C49A3C">
<tr><td style="padding:40px 40px 40px">
<p style="font-size:11px;letter-spacing:3px;text-transform:uppercase;color:rgba(26,24,20,.4);margin:0 0 28px;font-weight:500">FSchoolAI</p>
<h2 style="font-family:Georgia,serif;font-size:28px;color:#1a1814;margin:0 0 16px">Your spot is ready.</h2>
<p style="color:rgba(26,24,20,.55);line-height:1.7;font-size:15px;margin:0 0 32px">You're off the waitlist — create your account and your AI tutor starts learning how you learn from the first session.</p>
<a href="${link}" style="display:inline-block;background:#1a1814;color:#F6F2E9;text-decoration:none;padding:14px 28px;border-radius:10px;font-size:15px;font-weight:600">Create my account &rarr;</a>
</td></tr></table></td></tr></table></body></html>`;
}

export default async function handler(req: any, res: any) {
  res.setHeader?.("Access-Control-Allow-Origin", "*");
  res.setHeader?.("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();
  const action = req.query?.action ?? req.body?.action ?? "join";

  try {
    // ── public: social-proof count ────────────────────────────────────────────
    if (action === "stats") {
      const { url, headers } = sb();
      const r = await fetch(`${url}/rest/v1/waitlist?select=id`, { headers: { ...headers, Prefer: "count=exact", Range: "0-0" } });
      const total = parseInt((r.headers.get("content-range") ?? "/0").split("/")[1] || "0", 10);
      return res.status(200).json({ total });
    }

    // ── admin: full dashboard data (Bearer CRON_SECRET — exposes emails, so gated) ──
    // Powers waitlist.fschoolai.com. Aggregates server-side with the service key so it
    // works regardless of RLS on the table.
    if (action === "admin") {
      // Server-side password check. Default "abc" (override with WAITLIST_DASH_PASSWORD);
      // the prod CRON_SECRET also works so an admin/cron caller can reuse this endpoint.
      const password = process.env.WAITLIST_DASH_PASSWORD || "abc";
      const secret = process.env.CRON_SECRET;
      const key = (req.headers?.authorization ?? "").replace(/^Bearer\s+/i, "") || req.query?.key || "";
      if (key !== password && !(secret && key === secret)) return res.status(401).json({ error: "Unauthorized" });

      const { url, headers } = sb();
      // select=* so an absent optional column can't 400 the whole read; cap generously.
      const r = await fetch(`${url}/rest/v1/waitlist?select=*&order=created_at.asc&limit=50000`, { headers });
      if (!r.ok) return res.status(502).json({ error: `waitlist read failed (${r.status}) — is the DB up + migration run?` });
      const rows = (await r.json()) as any[];

      const total = rows.length;
      const invited = rows.filter(x => x.invited_at).length;
      const referred = rows.filter(x => x.referred_by).length;

      const now = Date.now();
      const within = (ms: number) => rows.filter(x => x.created_at && now - new Date(x.created_at).getTime() <= ms).length;

      const bySourceMap: Record<string, number> = {};
      for (const x of rows) { const s = (x.source || "unknown").toString(); bySourceMap[s] = (bySourceMap[s] || 0) + 1; }
      const bySource = Object.entries(bySourceMap).map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count);

      // Per-day buckets (UTC date) → daily count + running cumulative.
      const dayMap = new Map<string, number>();
      for (const x of rows) { const d = (x.created_at || "").slice(0, 10); if (d) dayMap.set(d, (dayMap.get(d) || 0) + 1); }
      let cum = 0;
      const daily = [...dayMap.keys()].sort().map(date => { cum += dayMap.get(date)!; return { date, count: dayMap.get(date)!, cumulative: cum }; });

      const recent = rows.slice(-30).reverse().map(x => ({
        email: x.email, name: x.name ?? null, source: x.source ?? null,
        referred_by: x.referred_by ?? null, created_at: x.created_at ?? null, invited: !!x.invited_at,
      }));

      return res.status(200).json({
        total, invited, pending: total - invited, referred,
        last24h: within(86_400_000), last7d: within(7 * 86_400_000), last30d: within(30 * 86_400_000),
        bySource, daily, recent, generatedAt: new Date().toISOString(),
      });
    }

    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    // ── public: join ──────────────────────────────────────────────────────────
    if (action === "join") {
      const email = String(req.body?.email ?? "").trim().toLowerCase();
      const name = String(req.body?.name ?? "").trim() || null;
      const source = String(req.body?.source ?? "landing").slice(0, 60);
      const ref = String(req.body?.ref ?? "").trim() || null;
      if (!EMAIL_RE.test(email)) return res.status(400).json({ error: "A valid email is required." });

      const { url, headers } = sb();
      const existing = await fetch(`${url}/rest/v1/waitlist?email=eq.${encodeURIComponent(email)}&select=id,created_at,invited_at`, { headers });
      if (!existing.ok) throw new Error(`waitlist read failed (${existing.status}) — has supabase-waitlist-migration.sql been run?`);
      const hit = ((await existing.json()) as any[])[0];
      if (hit) {
        const { position, total } = await positionOf(hit.created_at);
        return res.status(200).json({ ok: true, success: true, already: true, alreadyJoined: true, invited: !!hit.invited_at, position, total });
      }

      const ins = await fetch(`${url}/rest/v1/waitlist`, {
        method: "POST", headers: { ...headers, Prefer: "return=representation" },
        body: JSON.stringify({ email, name, source, referred_by: ref }),
      });
      if (!ins.ok) throw new Error(`waitlist insert failed (${ins.status}): ${(await ins.text()).slice(0, 150)}`);
      const row = ((await ins.json()) as any[])[0];
      const { position, total } = await positionOf(row.created_at);

      // Emails are FIRE-AND-FORGET — never await them before responding. A slow/hung
      // Resend call was blocking the join response, so the button spun forever. The join
      // is already persisted at this point; email is best-effort.
      const resend = mailer();
      if (resend) {
        // Joiner confirmation.
        resend.emails.send({
          from: "FSchoolAI <noreply@fschoolai.com>",
          to: email,
          subject: `You're #${position} on the FschoolAI waitlist`,
          html: confirmationHtml(name, position),
        }).catch((e: any) => console.error("[waitlist] confirmation email failed:", e?.message));

        // Internal: notify Vincent on every NEW signup with the running waitlist count.
        resend.emails.send({
          from: "FSchoolAI <noreply@fschoolai.com>",
          to: "vincent@fschoolai.com",
          subject: `New waitlist signup — ${total} total`,
          html: `<p>New FschoolAI waitlist signup: <b>${email}</b>${name ? ` (${name})` : ""}.</p>`
              + `<p>The waitlist now has <b>${total}</b> ${total === 1 ? "person" : "people"}.</p>`,
        }).catch((e: any) => console.error("[waitlist] signup notify failed:", e?.message));
      }
      return res.status(200).json({ ok: true, success: true, already: false, alreadyJoined: false, position, total, emailSent: !!resend });
    }

    // ── admin: batch invite (Bearer CRON_SECRET — same fail-closed pattern as crons) ──
    if (action === "invite") {
      const secret = process.env.CRON_SECRET;
      if (!secret) return res.status(500).json({ error: "CRON_SECRET not configured" });
      const auth = req.headers?.authorization ?? "";
      if (auth !== `Bearer ${secret}`) return res.status(401).json({ error: "Unauthorized" });

      const emails: string[] = Array.isArray(req.body?.emails) ? req.body.emails.map((e: string) => String(e).trim().toLowerCase()) : [];
      if (!emails.length) return res.status(400).json({ error: "emails[] is required" });
      const resend = mailer();
      if (!resend) return res.status(500).json({ error: "RESEND_API_KEY not configured" });

      const { url, headers } = sb();
      const base = appUrl(req);
      const results: any[] = [];
      for (const email of emails) {
        try {
          const r = await fetch(`${url}/rest/v1/waitlist?email=eq.${encodeURIComponent(email)}&select=id,invited_at`, { headers });
          if (!r.ok) { results.push({ email, ok: false, reason: `lookup failed (${r.status})` }); continue; }
          const row = ((await r.json().catch(() => [])) as any[])[0];
          if (!row) { results.push({ email, ok: false, reason: "not on the waitlist" }); continue; }
          await resend.emails.send({
            from: "FSchoolAI <noreply@fschoolai.com>",
            to: email,
            subject: "Your FschoolAI invite is here",
            html: inviteHtml(`${base}/?invite=${row.id}`),
          });
          await fetch(`${url}/rest/v1/waitlist?id=eq.${row.id}`, {
            method: "PATCH", headers, body: JSON.stringify({ invited_at: new Date().toISOString() }),
          });
          results.push({ email, ok: true, reinvite: !!row.invited_at });
        } catch (e: any) {
          results.push({ email, ok: false, reason: e?.message ?? "failed" });
        }
      }
      return res.status(200).json({ ok: true, invited: results.filter((x) => x.ok).length, results });
    }

    return res.status(400).json({ error: "Unknown action. Use join, stats, or invite." });
  } catch (e: any) {
    return res.status(502).json({ error: e?.message ?? "waitlist failed" });
  }
}

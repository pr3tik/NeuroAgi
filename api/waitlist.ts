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
import { createHmac, timingSafeEqual } from "node:crypto";

// ── Dashboard session tokens ──────────────────────────────────────────────────
// A correct password buys a signed, self-contained 30-day token (HMAC over its expiry
// with a server-only secret). The password itself is never stored client-side.
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
function dashSecret() { return process.env.SUPABASE_SERVICE_KEY || process.env.CRON_SECRET || "fschool-waitlist-dev"; }
function signSession(exp: number): string {
  return `${exp}.${createHmac("sha256", dashSecret()).update(String(exp)).digest("base64url")}`;
}
function verifySession(token: string): boolean {
  const [expStr, sig] = String(token || "").split(".");
  const exp = parseInt(expStr, 10);
  if (!expStr || !sig || !Number.isFinite(exp) || Date.now() > exp) return false;
  const expected = createHmac("sha256", dashSecret()).update(expStr).digest("base64url");
  try { return sig.length === expected.length && timingSafeEqual(Buffer.from(sig), Buffer.from(expected)); }
  catch { return false; }
}

// ── Email-verification tokens ───────────────────────────────────────────────────
// A signup is only "officially" on the list (counted, positioned, invited) once its email
// is verified — this stops bots/typos/spam from inflating the list. The verify link carries
// a stateless HMAC token over the row id (an unguessable uuid) + expiry, so no token column
// is needed and a forged or expired link is rejected.
const VERIFY_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
function signVerify(id: string, exp: number): string {
  const sig = createHmac("sha256", dashSecret()).update(`${id}.${exp}`).digest("base64url");
  return `${id}.${exp}.${sig}`;
}
function readVerify(token: string): string | null {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) return null;                 // id has no dots (uuid), exp is digits, sig base64url
  const [id, expStr, sig] = parts;
  const exp = parseInt(expStr, 10);
  if (!id || !Number.isFinite(exp) || Date.now() > exp) return null;
  const expected = createHmac("sha256", dashSecret()).update(`${id}.${expStr}`).digest("base64url");
  try { return sig.length === expected.length && timingSafeEqual(Buffer.from(sig), Buffer.from(expected)) ? id : null; }
  catch { return null; }
}

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
  // Position + total count ONLY verified members — unverified/spam rows never affect the line.
  const [posRes, totalRes] = await Promise.all([
    fetch(`${url}/rest/v1/waitlist?verified_at=not.is.null&created_at=lte.${at}&select=id`, { headers: { ...headers, Prefer: "count=exact", Range: "0-0" } }),
    fetch(`${url}/rest/v1/waitlist?verified_at=not.is.null&select=id`, { headers: { ...headers, Prefer: "count=exact", Range: "0-0" } }),
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

function verificationHtml(name: string | null, link: string) {
  const who = name ? `, ${name}` : "";
  return `<!DOCTYPE html><html><body style="margin:0;background:#FDFAF4;font-family:-apple-system,Helvetica,Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:48px 24px">
<table width="480" style="max-width:480px;width:100%;border-top:3px solid #C49A3C">
<tr><td style="padding:40px 40px 40px">
<p style="font-size:11px;letter-spacing:3px;text-transform:uppercase;color:rgba(26,24,20,.4);margin:0 0 28px;font-weight:500">FSchoolAI</p>
<h2 style="font-family:Georgia,serif;font-size:28px;color:#1a1814;margin:0 0 16px">Confirm your email${who}.</h2>
<p style="color:rgba(26,24,20,.55);line-height:1.7;font-size:15px;margin:0 0 28px">One tap to lock in your spot on the FschoolAI waitlist. You're not counted until you confirm — so we know every name on the list is a real student. This link expires in 24 hours.</p>
<a href="${link}" style="display:inline-block;background:#1a1814;color:#F6F2E9;text-decoration:none;padding:14px 28px;border-radius:10px;font-size:15px;font-weight:600">Confirm my spot &rarr;</a>
<p style="color:rgba(26,24,20,.35);font-size:12px;line-height:1.6;border-top:1px solid rgba(26,24,20,.08);padding-top:20px;margin-top:32px">If you didn't request this, just ignore this email — nothing was added.</p>
</td></tr></table></td></tr></table></body></html>`;
}

// Fire-and-forget the verification email (never awaited before responding).
function sendVerification(resend: any, base: string, id: string, email: string, name: string | null) {
  const link = `${base}/api/waitlist?action=verify&token=${encodeURIComponent(signVerify(id, Date.now() + VERIFY_TTL_MS))}`;
  resend.emails.send({
    from: "FSchoolAI <noreply@fschoolai.com>",
    to: email,
    subject: "Confirm your email to join the FschoolAI waitlist",
    html: verificationHtml(name, link),
  }).catch((e: any) => console.error("[waitlist] verification email failed:", e?.message));
}

// A tiny standalone HTML page shown when the verify link is bad/expired (success redirects
// to the app instead). Keeps the failure case from dumping raw JSON on the user.
function verifyErrorHtml(base: string) {
  return `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#FDFAF4;font-family:-apple-system,Helvetica,Arial,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center">
<div style="max-width:420px;text-align:center;padding:32px">
<h2 style="font-family:Georgia,serif;color:#1a1814;font-size:26px;margin:0 0 12px">This link has expired.</h2>
<p style="color:rgba(26,24,20,.55);line-height:1.7;font-size:15px;margin:0 0 24px">Confirmation links last 24 hours. Head back and join again — we'll send a fresh one.</p>
<a href="${base}/?waitlist=1" style="display:inline-block;background:#1a1814;color:#F6F2E9;text-decoration:none;padding:13px 26px;border-radius:10px;font-size:15px;font-weight:600">Back to FschoolAI</a>
</div></body></html>`;
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
    // ── public: social-proof count (VERIFIED members only) ─────────────────────
    if (action === "stats") {
      const { url, headers } = sb();
      const r = await fetch(`${url}/rest/v1/waitlist?verified_at=not.is.null&select=id`, { headers: { ...headers, Prefer: "count=exact", Range: "0-0" } });
      const total = parseInt((r.headers.get("content-range") ?? "/0").split("/")[1] || "0", 10);
      return res.status(200).json({ total });
    }

    // ── public: verify an email (the link from the confirmation email) ─────────
    // GET so it works from an email click. Stamps verified_at (idempotent), then — only on
    // the FIRST verification — sends the position confirmation + notifies internally, and
    // redirects into the app with ?verified=1&pos=<n>. Bad/expired token → friendly HTML.
    if (action === "verify") {
      const base = appUrl(req);
      const id = readVerify(String(req.query?.token ?? ""));
      const sendErr = () => { res.status(200); res.setHeader?.("Content-Type", "text/html; charset=utf-8"); return res.end(verifyErrorHtml(base)); };
      if (!id) return sendErr();

      const { url, headers } = sb();
      const r = await fetch(`${url}/rest/v1/waitlist?id=eq.${encodeURIComponent(id)}&select=id,email,name,created_at,verified_at`, { headers });
      const row = r.ok ? ((await r.json()) as any[])[0] : null;
      if (!row) return sendErr();

      const wasVerified = !!row.verified_at;
      if (!wasVerified) {
        // Only-if-still-null keeps it idempotent under double-clicks / link prefetchers.
        await fetch(`${url}/rest/v1/waitlist?id=eq.${encodeURIComponent(id)}&verified_at=is.null`, {
          method: "PATCH", headers, body: JSON.stringify({ verified_at: new Date().toISOString() }),
        }).catch(() => {});
      }

      const { position, total } = await positionOf(row.created_at);

      if (!wasVerified) {
        const resend = mailer();
        if (resend) {
          resend.emails.send({
            from: "FSchoolAI <noreply@fschoolai.com>", to: row.email,
            subject: `You're #${position} on the FschoolAI waitlist`,
            html: confirmationHtml(row.name, position),
          }).catch((e: any) => console.error("[waitlist] confirmation email failed:", e?.message));
          resend.emails.send({
            from: "FSchoolAI <noreply@fschoolai.com>", to: "vincent@fschoolai.com",
            subject: `New VERIFIED waitlist signup — ${total} total`,
            html: `<p>Verified FschoolAI waitlist signup: <b>${row.email}</b>${row.name ? ` (${row.name})` : ""}.</p><p>The waitlist now has <b>${total}</b> verified ${total === 1 ? "member" : "members"}.</p>`,
          }).catch((e: any) => console.error("[waitlist] verified notify failed:", e?.message));
        }
      }

      res.status(302);
      res.setHeader?.("Location", `${base}/?verified=1&pos=${position}`);
      return res.end();
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
      // Accept a valid 30-day session token, the raw password, or the prod CRON_SECRET.
      if (!verifySession(key) && key !== password && !(secret && key === secret)) return res.status(401).json({ error: "Unauthorized" });

      const { url, headers } = sb();
      // select=* so an absent optional column can't 400 the whole read; cap generously.
      const r = await fetch(`${url}/rest/v1/waitlist?select=*&order=created_at.asc&limit=50000`, { headers });
      if (!r.ok) return res.status(502).json({ error: `waitlist read failed (${r.status}) — is the DB up + migration run?` });
      const rows = (await r.json()) as any[];

      const total = rows.length;
      const invited = rows.filter(x => x.invited_at).length;
      const referred = rows.filter(x => x.referred_by).length;
      const verified = rows.filter(x => x.verified_at).length;
      const unverified = total - verified;

      const now = Date.now();
      const within = (ms: number) => rows.filter(x => x.created_at && now - new Date(x.created_at).getTime() <= ms).length;

      const bySourceMap: Record<string, number> = {};
      for (const x of rows) { const s = (x.source || "unknown").toString(); bySourceMap[s] = (bySourceMap[s] || 0) + 1; }
      const bySource = Object.entries(bySourceMap).map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count);

      // Location breakdown (rows with a captured country — signups since the geo
      // migration; older rows have no IP-derived location to backfill from).
      const byCountryMap: Record<string, number> = {};
      for (const x of rows) { if (x.country) byCountryMap[x.country] = (byCountryMap[x.country] || 0) + 1; }
      const byCountry = Object.entries(byCountryMap).map(([country, count]) => ({ country, count })).sort((a, b) => b.count - a.count).slice(0, 25);
      const located = rows.filter(x => x.country).length;

      // Per-day buckets (UTC date) → daily count + running cumulative.
      const dayMap = new Map<string, number>();
      for (const x of rows) { const d = (x.created_at || "").slice(0, 10); if (d) dayMap.set(d, (dayMap.get(d) || 0) + 1); }
      let cum = 0;
      const daily = [...dayMap.keys()].sort().map(date => { cum += dayMap.get(date)!; return { date, count: dayMap.get(date)!, cumulative: cum }; });

      const recent = rows.slice(-30).reverse().map(x => ({
        email: x.email, name: x.name ?? null, source: x.source ?? null,
        referred_by: x.referred_by ?? null, created_at: x.created_at ?? null, invited: !!x.invited_at,
        verified: !!x.verified_at,
        country: x.country ?? null, region: x.region ?? null, city: x.city ?? null,
      }));

      return res.status(200).json({
        total, verified, unverified, invited, pending: total - invited, referred,
        last24h: within(86_400_000), last7d: within(7 * 86_400_000), last30d: within(30 * 86_400_000),
        bySource, byCountry, located, daily, recent, generatedAt: new Date().toISOString(),
      });
    }

    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    // ── admin login: exchange the password for a signed 30-day session token ──
    if (action === "admin-login") {
      const password = process.env.WAITLIST_DASH_PASSWORD || "abc";
      const secret = process.env.CRON_SECRET;
      const pw = String(req.body?.password ?? "");
      if (pw !== password && !(secret && pw === secret)) return res.status(401).json({ error: "Wrong password." });
      const exp = Date.now() + TOKEN_TTL_MS;
      return res.status(200).json({ token: signSession(exp), exp });
    }

    // ── public: join ──────────────────────────────────────────────────────────
    if (action === "join") {
      const email = String(req.body?.email ?? "").trim().toLowerCase();
      const name = String(req.body?.name ?? "").trim() || null;
      const source = String(req.body?.source ?? "landing").slice(0, 60);
      const ref = String(req.body?.ref ?? "").trim() || null;
      if (!EMAIL_RE.test(email)) return res.status(400).json({ error: "A valid email is required." });

      const { url, headers } = sb();
      const base = appUrl(req);
      const resend = mailer();
      // select=* (not naming verified_at) so a not-yet-migrated column can't 400 the whole
      // dedup read and block joins — hit.verified_at is simply undefined until the migration runs.
      const existing = await fetch(`${url}/rest/v1/waitlist?email=eq.${encodeURIComponent(email)}&select=*`, { headers });
      if (!existing.ok) throw new Error(`waitlist read failed (${existing.status}) — has supabase-waitlist-migration.sql been run?`);
      const hit = ((await existing.json()) as any[])[0];
      if (hit) {
        if (hit.verified_at) {
          // Already a confirmed member — return their real position.
          const { position, total } = await positionOf(hit.created_at);
          return res.status(200).json({ ok: true, success: true, already: true, alreadyJoined: true, verified: true, invited: !!hit.invited_at, position, total });
        }
        // Signed up before but never confirmed → re-send the verification link, stay pending.
        if (resend) sendVerification(resend, base, hit.id, email, name);
        return res.status(200).json({ ok: true, success: true, already: true, alreadyJoined: false, needsVerification: true, pending: true, resent: true, emailSent: !!resend });
      }

      // Location from Vercel's edge geo headers — free, per-request, no external API.
      // Absent in local dev (nulls). City is percent-encoded UTF-8 per Vercel docs.
      const geoHdr = (k: string) => {
        const v = req.headers?.[k];
        if (!v) return null;
        try { return decodeURIComponent(String(v)).slice(0, 80) || null; } catch { return String(v).slice(0, 80); }
      };
      const geo = {
        country: geoHdr("x-vercel-ip-country"),
        region:  geoHdr("x-vercel-ip-country-region"),
        city:    geoHdr("x-vercel-ip-city"),
      };

      const baseRow = { email, name, source, referred_by: ref };
      const insert = (body: any) => fetch(`${url}/rest/v1/waitlist`, {
        method: "POST", headers: { ...headers, Prefer: "return=representation" },
        body: JSON.stringify(body),
      });
      let ins = await insert({ ...baseRow, ...geo });
      if (!ins.ok) {
        const errText = (await ins.text()).slice(0, 300);
        // Geo columns not migrated yet (PGRST204 "column ... schema cache") → a join must
        // NEVER fail over optional location data: retry without it.
        if (/column|schema cache/i.test(errText)) {
          ins = await insert(baseRow);
          if (!ins.ok) throw new Error(`waitlist insert failed (${ins.status}): ${(await ins.text()).slice(0, 150)}`);
        } else {
          throw new Error(`waitlist insert failed (${ins.status}): ${errText.slice(0, 150)}`);
        }
      }
      const row = ((await ins.json()) as any[])[0];

      // NEW signup starts UNVERIFIED — not counted, no position yet. Send the verification
      // link; the position confirmation + internal notify fire on verify. Fire-and-forget so
      // a slow Resend call never blocks the response.
      if (resend) sendVerification(resend, base, row.id, email, name);
      return res.status(200).json({ ok: true, success: true, already: false, alreadyJoined: false, needsVerification: true, pending: true, emailSent: !!resend });
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

    return res.status(400).json({ error: "Unknown action. Use join, verify, stats, or invite." });
  } catch (e: any) {
    return res.status(502).json({ error: e?.message ?? "waitlist failed" });
  }
}

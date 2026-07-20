// api/founding-card.ts — Founding Card claim form (/card).
//   POST ?action=apply  { name, school, email, colorway, delivery, website? }  (public)
//     → { ok, already? }
//
// Uses the EXISTING public.waitlist table (no new migration needed):
//   email, name          → applicant email + engraved name
//   source               → "founding-card"
//   referred_by          → compact meta: "fc|school=…|cw=white|d=standard"
// Soft caps counted among source=eq.founding-card rows.
// Optional Resend notify to vincent@.
import { Resend } from "resend";
import { createHmac } from "node:crypto";
import { rateLimit } from "./_ratelimit.js";

const COLORWAYS = new Set(["white", "violet", "pink", "blue", "green", "black"]);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const STANDARD_CAP = 500;
const FOUNDER_CAP = 5;
const SOURCE = "founding-card";

function dashSecret() {
  return process.env.SUPABASE_SERVICE_KEY || process.env.CRON_SECRET || "fschool-founding-card-dev";
}

function clientIp(req: any): string | null {
  const xff = req.headers?.["x-forwarded-for"];
  if (xff) return String(xff).split(",")[0].trim() || null;
  const xr = req.headers?.["x-real-ip"];
  return xr ? String(xr) : null;
}

const ipHash = (ip: string) =>
  createHmac("sha256", dashSecret()).update(`ip:${ip}`).digest("base64url").slice(0, 24);

function sb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase env vars not configured");
  return {
    url,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    } as Record<string, string>,
  };
}

function mailer() {
  const key = process.env.RESEND_API_KEY;
  return key ? new Resend(key) : null;
}

const esc = (s: any) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string),
  );

const cleanText = (s: any, max: number): string =>
  String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** Pack school/colorway/delivery into waitlist.referred_by (TEXT, already exists). */
function packMeta(school: string, colorway: string, delivery: string): string {
  // Pipe-safe: strip | from school so parse stays unambiguous
  const s = school.replace(/\|/g, "/").slice(0, 100);
  return `fc|school=${s}|cw=${colorway}|d=${delivery}`;
}

function unpackMeta(ref: string | null | undefined): { school?: string; colorway?: string; delivery?: string } {
  if (!ref || !String(ref).startsWith("fc|")) return {};
  const out: any = {};
  for (const part of String(ref).slice(3).split("|")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i);
    const v = part.slice(i + 1);
    if (k === "school") out.school = v;
    if (k === "cw") out.colorway = v;
    if (k === "d") out.delivery = v;
  }
  return out;
}

export default async function handler(req: any, res: any) {
  res.setHeader?.("Access-Control-Allow-Origin", "*");
  res.setHeader?.("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader?.("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();

  const action = req.query?.action ?? req.body?.action ?? "apply";

  try {
    if (action !== "apply") return res.status(400).json({ error: "Unknown action" });
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    if (!(await rateLimit(req, res, "founding-card-apply", { anonMax: 5, authMax: 5, windowSecs: 60, ipOnly: true }))) {
      return;
    }

    if (String(req.body?.website ?? "").trim()) {
      return res.status(200).json({ ok: true, already: true });
    }

    const email = String(req.body?.email ?? "").trim().toLowerCase();
    const name = cleanText(req.body?.name, 80);
    const school = cleanText(req.body?.school, 120);
    let delivery = String(req.body?.delivery ?? "standard").trim().toLowerCase();
    if (delivery !== "founder") delivery = "standard";
    let colorway = String(req.body?.colorway ?? "white").trim().toLowerCase();
    if (delivery === "founder") colorway = "black";
    if (!COLORWAYS.has(colorway)) colorway = "white";

    if (name.length < 2) return res.status(400).json({ error: "Name is required." });
    if (school.length < 2) return res.status(400).json({ error: "School is required." });
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: "A valid email is required." });

    const { url, headers } = sb();
    const meta = packMeta(school, colorway, delivery);

    // Same email already on waitlist (landing OR card) → idempotent success
    const existing = await fetch(
      `${url}/rest/v1/waitlist?email=eq.${encodeURIComponent(email)}&select=id,email,name,source,referred_by,created_at`,
      { headers },
    );
    if (!existing.ok) {
      throw new Error(`waitlist read failed (${existing.status})`);
    }
    const hit = ((await existing.json()) as any[])[0];
    if (hit) {
      const prev = unpackMeta(hit.referred_by);
      // If they applied via landing first, upgrade meta/source so we keep card details
      if (hit.source !== SOURCE || !hit.referred_by?.startsWith?.("fc|")) {
        await fetch(`${url}/rest/v1/waitlist?id=eq.${encodeURIComponent(hit.id)}`, {
          method: "PATCH",
          headers,
          body: JSON.stringify({
            source: SOURCE,
            name: name || hit.name,
            referred_by: meta,
          }),
        }).catch(() => null);
      }
      return res.status(200).json({
        ok: true,
        already: true,
        colorway: prev.colorway || colorway,
        delivery: prev.delivery || delivery,
      });
    }

    // Soft caps among founding-card rows only (fail open)
    try {
      const cr = await fetch(
        `${url}/rest/v1/waitlist?source=eq.${encodeURIComponent(SOURCE)}&select=id,referred_by`,
        { headers },
      );
      if (cr.ok) {
        const rows = (await cr.json()) as any[];
        const founderN = rows.filter((r) => unpackMeta(r.referred_by).delivery === "founder").length;
        const standardN = rows.length - founderN;
        if (delivery === "founder" && founderN >= FOUNDER_CAP) {
          return res.status(409).json({ error: "Founder Delivery applications are full." });
        }
        if (delivery === "standard" && standardN >= STANDARD_CAP) {
          return res.status(409).json({ error: "Founding Card applications are full for now." });
        }
      }
    } catch { /* fail open */ }

    const ip = clientIp(req);
    const ipH = ip ? ipHash(ip) : null;
    const geoHdr = (k: string) => {
      const v = req.headers?.[k];
      if (!v) return null;
      try {
        return decodeURIComponent(String(v)).slice(0, 80) || null;
      } catch {
        return String(v).slice(0, 80);
      }
    };

    // Instant-join style: stamp verified_at so they count on the waitlist too
    const baseRow: any = {
      email,
      name,
      source: SOURCE,
      referred_by: meta,
      verified_at: new Date().toISOString(),
    };
    const extras: any = {
      country: geoHdr("x-vercel-ip-country"),
      region: geoHdr("x-vercel-ip-country-region"),
      city: geoHdr("x-vercel-ip-city"),
    };
    if (ipH) extras.ip_hash = ipH;

    const insert = (body: any) =>
      fetch(`${url}/rest/v1/waitlist`, {
        method: "POST",
        headers: { ...headers, Prefer: "return=representation" },
        body: JSON.stringify(body),
      });

    let ins = await insert({ ...baseRow, ...extras });
    if (!ins.ok) {
      const errText = (await ins.text()).slice(0, 300);
      if (/duplicate|unique/i.test(errText)) {
        return res.status(200).json({ ok: true, already: true, colorway, delivery });
      }
      if (/column|schema cache/i.test(errText)) {
        // Drop optional cols / verified_at if not migrated
        const core = { email, name, source: SOURCE, referred_by: meta };
        ins = await insert(core);
        if (!ins.ok) {
          throw new Error(`waitlist insert failed (${ins.status}): ${(await ins.text()).slice(0, 150)}`);
        }
      } else {
        throw new Error(`waitlist insert failed (${ins.status}): ${errText.slice(0, 150)}`);
      }
    }

    const row = ((await ins.json()) as any[])[0];

    const resend = mailer();
    if (resend) {
      const tier = delivery === "founder" ? "Founder Delivery ($3k)" : "Standard (free)";
      resend.emails
        .send({
          from: "FSchoolAI <noreply@fschoolai.com>",
          to: "vincent@fschoolai.com",
          subject: `Founding Card apply — ${tier} — ${colorway}`,
          html: `<p><b>${esc(name)}</b> (${esc(email)}) · ${esc(school)}</p>
<p>Colorway: <b>${esc(colorway)}</b> · Delivery: <b>${esc(delivery)}</b></p>
<p>waitlist id: ${esc(row?.id)}</p>`,
          text: `${name} (${email}) · ${school}\nColorway: ${colorway} · Delivery: ${delivery}\nid: ${row?.id}`,
        })
        .catch((e: any) => console.error("[founding-card] notify failed:", e?.message));
    }

    return res.status(200).json({ ok: true, already: false, colorway, delivery, id: row?.id });
  } catch (e: any) {
    console.error("[founding-card]", e?.message || e);
    return res.status(500).json({ error: e?.message || "Something went wrong." });
  }
}

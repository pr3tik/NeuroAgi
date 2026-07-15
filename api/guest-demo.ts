// api/guest-demo.ts — anonymous pre-signup "instant demo" (PRD §5.1 v2.1, S1). Lets a
// visitor drop a question/file and get one real tutor answer BEFORE creating an account.
// Server-enforced rate limit (guest uid + IP) — this is a NEW, isolated endpoint rather
// than touching api/claude.ts or api/extract.ts, so the shared, already-live tutor/upload
// paths used by every existing account are completely unaffected.
import { createClient } from "@supabase/supabase-js";
import { rateLimit } from "./_ratelimit.js";
import { callModel } from "./_gateway.js";

const GUEST_LIMIT  = 3;   // per guest uid, within the window
const IP_LIMIT      = 9;   // harder backstop across guest uids sharing one IP
const WINDOW_HOURS  = 24;

let _supabase: any = null;
function getSupabase() {
  if (_supabase) return _supabase;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  _supabase = url && key ? createClient(url, key) : null;
  return _supabase;
}

function clientIp(req): string {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length) return fwd.split(",")[0].trim();
  return req.socket?.remoteAddress || "unknown";
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!(await rateLimit(req, res, "guest-demo", { anonMax: 15, authMax: 60 }))) return;

  const { guestUid, question, base64, file_type, name } = req.body ?? {};
  if (!guestUid) return res.status(400).json({ error: "guestUid required" });
  if (!question && !base64) return res.status(400).json({ error: "A question or a file is required" });

  const supabase = getSupabase();
  if (!supabase) return res.status(500).json({ error: "Not configured" });

  const ip = clientIp(req);
  const since = new Date(Date.now() - WINDOW_HOURS * 3600 * 1000).toISOString();

  const [gRes, ipRes] = await Promise.all([
    supabase.from("guest_demo_usage").select("id", { count: "exact", head: true })
      .eq("guest_uid", guestUid).gte("created_at", since),
    supabase.from("guest_demo_usage").select("id", { count: "exact", head: true })
      .eq("ip", ip).gte("created_at", since),
  ]);
  // Fail CLOSED on a count error: previously { count } was destructured and .error
  // ignored, so a DB error → count=null → limit read as 0 → unlimited free previews.
  if (gRes.error || ipRes.error) {
    return res.status(503).json({ blocked: true, reason: "rate_check_failed", message: "Please try again in a moment." });
  }
  const guestCount = gRes.count, ipCount = ipRes.count;

  if ((guestCount ?? 0) >= GUEST_LIMIT) {
    return res.status(429).json({ blocked: true, reason: "guest_limit", message: "You've used your free preview — sign up to keep going." });
  }
  if ((ipCount ?? 0) >= IP_LIMIT) {
    return res.status(429).json({ blocked: true, reason: "ip_limit", message: "Too many previews from this network — sign up to keep going." });
  }

  // Record the attempt BEFORE doing the expensive work (fail-closed): a failed
  // extraction/LLM call still counts, so retrying on failure can't be used to
  // dodge the limit.
  await supabase.from("guest_demo_usage").insert({ guest_uid: guestUid, ip });

  let text = question ?? "";
  if (base64) {
    try {
      const base = `${req.headers["x-forwarded-proto"] ?? "http"}://${req.headers.host}`;
      const er = await fetch(`${base}/api/extract`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base64, file_type, name }),
      });
      const ed = await er.json().catch(() => ({}));
      if (!er.ok || !ed.text) return res.status(200).json({ error: ed.error || "Couldn't read that file." });
      text = ed.text;
    } catch {
      return res.status(200).json({ error: "Couldn't read that file." });
    }
  }

  // A course CODE (e.g. "BIO 201") is only ever real if it's actually printed in an
  // uploaded file (a syllabus, etc.) — never inventable from a typed question alone.
  // Fabricating a plausible-sounding code when there's no real evidence is dishonest
  // and erodes trust the moment a student notices it's made up.
  const hadFile = Boolean(base64);
  const system = [
    "You are FschoolAI's tutor, answering a question for someone who hasn't signed up yet —",
    "this is their very first interaction with the product. Give a genuinely useful, focused",
    "answer (not padded), written as plain conversational chat text: no markdown headings",
    "(#, ##), just short paragraphs, **bold** for key terms, and simple '- ' bullets where a",
    "list genuinely helps.",
    hadFile
      ? "Then on a final separate line, output EXACTLY this format: ###COURSE: <code>|<topic>### " +
        "— e.g. ###COURSE: BIO 201|cell metabolism###. Only put a real course code in <code> if " +
        "the text above actually contains one (e.g. printed on a syllabus) — never invent a " +
        "plausible-sounding one. If there's no real course code in the text, output " +
        "###COURSE: null|<topic>### with just a short topic label."
      : "This is a typed question with no file attached, so there is NO way to know their real " +
        "course number — never invent one, even a plausible-sounding one. On a final separate " +
        "line, output EXACTLY this format: ###COURSE: null|<topic>### with a short topic label " +
        "for what this question is about, e.g. ###COURSE: null|cell metabolism###.",
  ].join(" ");

  const r = await callModel({
    task: "default",
    messages: [{ role: "user", content: String(text).slice(0, 20000) }],
    system,
  });

  if (!r.ok) return res.status(200).json({ error: "The tutor's a little busy — try again in a moment." });

  const marker = r.content.match(/###COURSE:\s*(.*?)\|(.*?)###/);
  const rawCode = marker ? marker[1].trim() : null;
  const courseCode = rawCode && rawCode !== "null" ? rawCode : null;
  const topic = marker ? marker[2].trim() : null;
  const answer = r.content.replace(/###COURSE:.*?###/, "").trim();

  return res.status(200).json({
    answer,
    courseCode,
    topic,
    remaining: Math.max(0, GUEST_LIMIT - (guestCount ?? 0) - 1),
  });
}

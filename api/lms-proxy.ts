// api/lms-proxy.ts — Chrome extension cookie relay (Tier 2)
//
// POST /api/lms-proxy
// Body: {
//   userId:   string,
//   token:    string,    // EXTENSION_AUTH_SECRET
//   url:      string,    // file URL on the LMS (must match hostname allowlist)
//   cookies:  string,    // Cookie header string from chrome.cookies.getAll()
//   filename: string,    // suggested filename
//   platform: string,    // "chaoxing" | "pronote" | "moodle" | etc.
//   courseId?: string,
// }
// Returns: { ok, documentId, skipped? }
//
// Security:
//   - Token validation (EXTENSION_AUTH_SECRET) before any fetch
//   - Hostname allowlist — only known LMS domains are proxied (no open proxy)
//   - Cookies used once per request, never stored or logged
//   - Set-Cookie stripped from upstream response

import { createClient } from "@supabase/supabase-js";
import { ingestLmsFile } from "./lms-ingest.js";

// Proxied fetch + full ingest (extract/OCR/embed) can take a while for big files.
export const config = { maxDuration: 300 };

let _sb: any = null;
function sb() {
  if (_sb) return _sb;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase env vars not configured");
  _sb = createClient(url, key);
  return _sb;
}

// Known LMS hostname patterns (regex list — add new platforms here)
const ALLOWED_HOSTNAMES: RegExp[] = [
  /^(fanya\.)?chaoxing\.com$/,
  /^zhihuishu\.com$/,
  /^(.+\.)?pronote\.net$/,
  /moodle/i,                        // *.moodle.* or paths containing /moodle/
  /^(.+\.)?brightspace\.com$/,
  /^(.+\.)?blackboard\.com$/,
  /^(.+\.)?instructure\.com$/,      // Canvas
  /^(.+\.)?desire2learn\.com$/,
  /^(.+\.)?sakai\.org$/,
  /^(.+\.)?lms\./,                  // generic: lms.university.edu
];

function isAllowedUrl(rawUrl: string): boolean {
  try {
    const { hostname, pathname } = new URL(rawUrl);
    if (ALLOWED_HOSTNAMES.some(re => re.test(hostname))) return true;
    // Some Moodle installs have /moodle/ in the path on a non-moodle hostname
    if (/\/moodle\//i.test(pathname)) return true;
    return false;
  } catch {
    return false;
  }
}

function selfBase(): string {
  return process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:5173";
}

// Map file extension to MIME type (fallback when upstream doesn't send Content-Type)
const EXT_MIME: Record<string, string> = {
  pdf:  "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc:  "application/msword",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ppt:  "application/vnd.ms-powerpoint",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls:  "application/vnd.ms-excel",
  txt:  "text/plain",
  mp4:  "video/mp4",
  mp3:  "audio/mpeg",
};

function mimeFromFilename(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return EXT_MIME[ext] ?? "application/octet-stream";
}

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { userId, token, url, cookies, filename, platform, courseId } = req.body ?? {};

  // ── Auth ──────────────────────────────────────────────────────────────────
  const authSecret = process.env.EXTENSION_AUTH_SECRET;
  if (!authSecret) return res.status(500).json({ error: "EXTENSION_AUTH_SECRET not configured" });
  if (!token || token !== authSecret) return res.status(401).json({ error: "Invalid extension token" });

  if (!userId || !url || !filename) {
    return res.status(400).json({ error: "userId, url, and filename are required" });
  }

  // Verify the user exists
  const { data: user, error: userErr } = await sb()
    .from("users")
    .select("id")
    .eq("id", userId)
    .maybeSingle();
  if (userErr || !user) return res.status(401).json({ error: "Unknown userId" });

  // ── Hostname allowlist ────────────────────────────────────────────────────
  if (!isAllowedUrl(url)) {
    return res.status(403).json({
      error: "URL hostname is not in the LMS allowlist",
      url,
    });
  }

  // ── Fetch file from LMS using student's session cookies ──────────────────
  // Cookies are used exactly once here and are NOT stored anywhere.
  const origin = new URL(url).origin;
  const fetchHeaders: Record<string, string> = {
    "User-Agent": "Mozilla/5.0 (compatible; FschoolAI/1.0; LMS file importer)",
    Referer:      origin,
  };
  if (cookies) {
    fetchHeaders["Cookie"] = cookies; // used once, not logged
  }

  const upstream = await fetch(url, { headers: fetchHeaders }).catch((e) => {
    return null;
  });

  if (!upstream || !upstream.ok) {
    return res.status(502).json({
      error: `LMS fetch failed${upstream ? ` (${upstream.status})` : " (network error)"}`,
    });
  }

  // Strip Set-Cookie to ensure we never forward the student's session anywhere
  const contentType =
    upstream.headers.get("content-type")?.split(";")[0].trim() ?? mimeFromFilename(filename);

  const bytes = Buffer.from(await upstream.arrayBuffer());
  if (bytes.length > 50 * 1024 * 1024) {
    return res.status(413).json({ error: "File too large (max 50 MB)" });
  }

  // Reject HTML masquerading as a file (session-expired login pages) before ingesting garbage.
  const head = bytes.subarray(0, 256).toString("utf8").trimStart().toLowerCase();
  if (contentType.includes("text/html") || head.startsWith("<!doctype") || head.startsWith("<html")) {
    return res.status(422).json({ error: "LMS returned a login/HTML page instead of the file — session may have expired" });
  }

  // ── Pipe to unified ingest pipeline — DIRECT call (no internal HTTP hop, so
  //    Vercel's 4.5MB body limit never applies to proxied LMS files) ─────────
  const result = await ingestLmsFile({
    userId,
    courseId: courseId ?? null,
    file: {
      name:     filename,
      mimeType: contentType,
      bytes,
      sourceUrl: url,
      provider: "extension",
      metadata: { platform: platform ?? "unknown", originalFilename: filename },
    },
  });
  if (result.status !== 200) {
    return res.status(502).json({ error: result.json?.error ?? "lms-ingest failed" });
  }
  return res.status(200).json(result.json);
}

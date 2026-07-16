// api/file-url.js — mint a short-lived signed URL for a stored course file.
//
// The `course-files` bucket is PRIVATE: file bytes are never world-readable.
// Downloads happen only through these server-minted links (service key), so a
// link "just opens the PDF" for the student but expires and can't be guessed.
//
// POST { path: "<userId>/<lms_file_id>.pdf", expiresIn?: seconds } → { url }

import { requireUserOr401 } from "./_auth.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_KEY;   // signing requires read perms → service key
  if (!supabaseUrl || !serviceKey) return res.status(500).json({ error: "storage not configured" });

  const _uid = await requireUserOr401(req, res); if (!_uid) return;
  const { path, expiresIn = 3600 } = req.body ?? {};
  if (!path || typeof path !== "string") return res.status(400).json({ error: "path required" });
  // Storage layout is `<userId>/...` — a caller may only sign their OWN files. Reject anything
  // whose first segment isn't the caller, plus any `..`/empty segment (a naive first-segment
  // check is defeated by `<myId>/../<victimId>/secret.pdf`).
  const _seg = String(path).split("/");
  if (_seg[0] !== _uid || _seg.some(p => p === "" || p === "..")) return res.status(403).json({ error: "forbidden" });

  try {
    const r = await fetch(`${supabaseUrl}/storage/v1/object/sign/course-files/${path}`, {
      method:  "POST",
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
      body:    JSON.stringify({ expiresIn }),
    });
    if (!r.ok) return res.status(r.status).json({ error: "could not sign", detail: await r.text() });
    const { signedURL } = await r.json();
    // signedURL is bucket-relative ("/object/sign/course-files/...?token=..").
    return res.status(200).json({ url: `${supabaseUrl}/storage/v1${signedURL}` });
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
}

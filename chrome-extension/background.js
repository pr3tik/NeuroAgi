// background.js — FschoolAI Extension service worker
//
// Roles:
//   • Fetches file bytes cross-origin (host_permissions bypass CORS; content scripts can't)
//   • Routes every import through /api/lms-ingest — small files inline (base64),
//     big files via ?action=sign → PUT to storage → ingest by storagePath
//     (Vercel rejects request bodies over ~4.5MB, so inline-only would silently
//     fail on lecture decks — the most valuable files)
//   • Serializes imports through a queue (many tabs / auto-capture can't stampede)
//   • Tracks per-URL capture history so auto-capture never re-imports
//   • Captures completed downloads from academic sites (pending list / opt-in auto)

// Dev vs prod: change to "http://localhost:5173" for local testing
const FSCHOOLAI_ORIGIN = "http://localhost:5173";
const API_BASE         = FSCHOOLAI_ORIGIN;

const FULL_SYNC_TTL_MS = 6 * 60 * 60 * 1000;    // re-sync a given LMS host at most every 6h

const INLINE_B64_LIMIT = 3_000_000;             // base64 chars (~2.2MB binary) — under Vercel's cap
const INLINE_RAW_LIMIT = Math.floor(INLINE_B64_LIMIT * 0.75);   // raw-byte equivalent (base64 inflates ~4/3)
const MAX_FILE_BYTES   = 100 * 1024 * 1024;     // absolute cap, matches the course-files bucket's 100MB limit
const CAPTURED_MAX     = 800;                    // LRU size of the "already imported" URL set
const QUEUE_MAX        = 40;                     // max queued imports at once

// No transcription pipeline is wired into this extension for either LMS — a
// video/audio file uploads fine then always dead-ends at "no text extracted".
// Skip by filename BEFORE even fetching, wherever the LMS gives us a title —
// pure wasted bandwidth/storage otherwise, on exactly the largest files.
const VIDEO_AUDIO_EXT_RE = /\.(mp4|mov|avi|wmv|flv|m4v|webm|mkv|mp3|wav|m4a|ogg|aac|flac)(\?|#|$)/i;
const looksLikeVideoAudio = (name) => VIDEO_AUDIO_EXT_RE.test(String(name || ""));

// ── Auth state ─────────────────────────────────────────────────────────────

async function getAuth() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["userId", "token", "expiresAt"], (data) => {
      if (!data.userId || !data.token) return resolve(null);
      if (data.expiresAt && Date.now() > data.expiresAt) return resolve(null);
      resolve({ userId: data.userId, token: data.token });
    });
  });
}

async function setAuth(userId, token, expiresAt) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ userId, token, expiresAt }, resolve);
  });
}

// ── Settings ────────────────────────────────────────────────────────────────
// autoCapture: content scripts auto-import files found on LMS-looking pages (default ON)
// autoImportDownloads: completed downloads from academic sites import silently (default OFF)

const SETTING_DEFAULTS = { autoCapture: true, autoImportDownloads: false };

async function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["settings"], ({ settings }) =>
      resolve({ ...SETTING_DEFAULTS, ...(settings ?? {}) }));
  });
}

// ── Captured-URL memory (auto-capture dedup across visits) ──────────────────
// Server dedups too (files.source_url), but this avoids even re-downloading.

async function getCaptured() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["capturedUrls"], ({ capturedUrls }) =>
      resolve(Array.isArray(capturedUrls) ? capturedUrls : []));
  });
}

async function markCaptured(url) {
  const list = await getCaptured();
  if (list.includes(url)) return;
  const updated = [url, ...list].slice(0, CAPTURED_MAX);
  await new Promise((r) => chrome.storage.local.set({ capturedUrls: updated }, r));
}

// Mirror of the server's canonicalizeSourceUrl — keeps client dedup keys aligned
// with what drive-auth's Classroom sync and lms-ingest store.
function canonicalizeUrl(raw) {
  const s = String(raw ?? "");
  const drive = s.match(/drive\.google\.com\/(?:file\/d\/|open\?.*?id=|uc\?.*?id=)([\w-]{10,})/);
  if (drive) return `https://drive.google.com/file/d/${drive[1]}`;
  const gdoc = s.match(/docs\.google\.com\/(document|presentation|spreadsheets)\/d\/([\w-]{10,})/);
  if (gdoc) return `https://docs.google.com/${gdoc[1]}/d/${gdoc[2]}`;
  return s;
}

// ── Failure memory (auto-capture backoff) ────────────────────────────────────
// Files that permanently fail (scanned PDF over OCR cap, 422s, dead links) must not
// re-download on every page visit. 3 strikes → skip for 7 days.

const FAIL_MAX = 3;
const FAIL_TTL_MS = 7 * 24 * 60 * 60 * 1000;

async function getFailures() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["failedUrls"], ({ failedUrls }) =>
      resolve(failedUrls && typeof failedUrls === "object" ? failedUrls : {}));
  });
}

async function recordFailure(key) {
  const map = await getFailures();
  const cur = map[key] ?? { n: 0, t: 0 };
  map[key] = { n: cur.n + 1, t: Date.now() };
  // Bound the map — drop expired entries.
  for (const k of Object.keys(map)) if (Date.now() - map[k].t > FAIL_TTL_MS) delete map[k];
  await new Promise((r) => chrome.storage.local.set({ failedUrls: map }, r));
}

async function isBlockedByFailures(key) {
  const map = await getFailures();
  const f = map[key];
  return !!f && f.n >= FAIL_MAX && Date.now() - f.t < FAIL_TTL_MS;
}

// ── SSRF guard ───────────────────────────────────────────────────────────────
// Auto-capture fetches URLs harvested from page DOMs. A hostile page could plant
// links to internal services (localhost, router admin, cloud metadata) and have the
// extension exfiltrate them into the user's own account. Refuse private targets.

function isPrivateTarget(rawUrl) {
  try {
    const u = new URL(rawUrl);
    if (!/^https?:$/.test(u.protocol)) return true;
    const h = u.hostname.toLowerCase();
    if (h === "localhost" || h === "0.0.0.0" || h.endsWith(".local") || h.endsWith(".internal")) return true;
    if (h === "[::1]" || h === "::1") return true;
    if (/^127\.|^10\.|^192\.168\.|^169\.254\.|^0\./.test(h)) return true;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
    return false;
  } catch { return true; }
}

// ── SW keepalive while the import queue is busy ──────────────────────────────
// MV3 kills idle service workers after ~30s; long ingest awaits (OCR, embedding)
// can exceed the extended grace. A trivial API heartbeat keeps the worker alive
// exactly while queueDepth > 0.

let keepaliveTimer = null;
function keepaliveStart() {
  if (keepaliveTimer) return;
  keepaliveTimer = setInterval(() => chrome.runtime.getPlatformInfo(() => {}), 20_000);
}
function keepaliveStop() {
  // Keep the worker alive while EITHER a file is queued OR a full sync is running
  // (its enumeration phase has queueDepth 0 but must survive the popup closing /
  // tab switch — otherwise MV3 evicts the worker and the sync dies).
  if (keepaliveTimer && queueDepth === 0 && !fullSyncActive) { clearInterval(keepaliveTimer); keepaliveTimer = null; }
}

// ── Byte helpers ─────────────────────────────────────────────────────────────

function bufferToBase64(buffer) {
  const uint8 = new Uint8Array(buffer);
  const CHUNK = 8192;
  let binary = "";
  for (let i = 0; i < uint8.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, uint8.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

// Decode the first bytes of a base64 string and check for an HTML page —
// an expired LMS session serves a login page instead of the file.
function base64LooksLikeHtml(b64) {
  try {
    const head = atob(String(b64).slice(0, 120)).trimStart().toLowerCase();
    return head.startsWith("<!doctype") || head.startsWith("<html") || head.startsWith("<head");
  } catch { return false; }
}

// ── Cloud storage file fetcher ─────────────────────────────────────────────
// Covers: Google Drive/Docs, Dropbox, OneDrive, SharePoint, Box.

function transformCloudUrl(href) {
  try {
    const u = new URL(href);
    const h = u.hostname;

    // ── Google Drive ──────────────────────────────────────────────────────
    if (/drive\.google\.com/.test(h)) {
      const fileMatch = u.pathname.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
      if (fileMatch) return `https://drive.google.com/uc?export=download&id=${fileMatch[1]}`;
      const id = u.searchParams.get("id");
      if (id) return `https://drive.google.com/uc?export=download&id=${id}`;
    }

    // ── Google Docs / Slides / Sheets → export as PDF ────────────────────
    if (/docs\.google\.com/.test(h)) {
      const docMatch = u.pathname.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
      if (docMatch) return `https://docs.google.com/document/d/${docMatch[1]}/export?format=pdf`;

      const slidesMatch = u.pathname.match(/\/presentation\/d\/([a-zA-Z0-9_-]+)/);
      if (slidesMatch) return `https://docs.google.com/presentation/d/${slidesMatch[1]}/export/pdf`;

      const sheetsMatch = u.pathname.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
      if (sheetsMatch) return `https://docs.google.com/spreadsheets/d/${sheetsMatch[1]}/export?format=pdf`;
    }

    // ── Dropbox ───────────────────────────────────────────────────────────
    if (/(^|\.)dropbox\.com$/.test(h)) {
      u.hostname = "dl.dropboxusercontent.com";
      u.searchParams.set("dl", "1");
      return u.toString();
    }

    // ── OneDrive personal — handled by fetchOneDriveFile() (no static URL) ─

    // ── SharePoint / OneDrive for Business ───────────────────────────────
    if (/sharepoint\.com/.test(h)) {
      u.searchParams.set("download", "1");
      return u.toString();
    }

    // ── Box ───────────────────────────────────────────────────────────────
    if (/box\.com/.test(h)) {
      const shareMatch = u.pathname.match(/\/s\/([a-zA-Z0-9]+)/);
      if (shareMatch) return `https://app.box.com/shared/static/${shareMatch[1]}`;
    }

  } catch {}
  return null;
}

// OneDrive personal share links need a redirect-following two-step (no static URL).
async function fetchOneDriveFile(href) {
  let res = await fetch(href, { credentials: "include", redirect: "follow" });
  let ct  = res.headers.get("content-type") ?? "";

  if (res.ok && !ct.includes("text/html")) {
    const mimeType = ct.split(";")[0]?.trim() || "application/octet-stream";
    return { bytes: bufferToBase64(await res.arrayBuffer()), mimeType };
  }

  let resolved;
  try { resolved = new URL(res.url); } catch { resolved = null; }
  if (resolved) {
    resolved.searchParams.set("download", "1");
    res = await fetch(resolved.toString(), { credentials: "include", redirect: "follow" });
    ct  = res.headers.get("content-type") ?? "";
  }

  if (!res.ok || ct.includes("text/html")) {
    throw new Error("OneDrive needs sign-in. Open the link in this browser while signed in to OneDrive, or download the file and import it manually.");
  }
  const mimeType = ct.split(";")[0]?.trim() || "application/octet-stream";
  return { bytes: bufferToBase64(await res.arrayBuffer()), mimeType };
}

async function fetchCloudFile(href) {
  let host = "";
  try { host = new URL(href).hostname; } catch {}
  if (/(^|\.)1drv\.ms$|(^|\.)onedrive\.live\.com$/.test(host)) {
    return fetchOneDriveFile(href);
  }

  const downloadUrl = transformCloudUrl(href);
  if (!downloadUrl) throw new Error("Not a recognised cloud storage URL");

  let res = await fetch(downloadUrl, { credentials: "include" });

  // Google Drive: large files return a virus-scan HTML page → confirm token retry.
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("text/html")) {
    const html = await res.text();
    const confirmMatch = html.match(/[?&]confirm=([0-9A-Za-z_-]+)/);
    if (!confirmMatch) throw new Error("Cloud storage returned HTML — file may be private or login required");
    const sep = downloadUrl.includes("?") ? "&" : "?";
    res = await fetch(`${downloadUrl}${sep}confirm=${confirmMatch[1]}`, { credentials: "include" });
    const ct2 = res.headers.get("content-type") ?? "";
    if (ct2.includes("text/html")) throw new Error("Cloud storage returned HTML — file may be private or login required");
  }

  if (!res.ok) throw new Error(`Cloud fetch failed: HTTP ${res.status}`);

  const mimeType = res.headers.get("content-type")?.split(";")[0]?.trim() ?? "application/octet-stream";
  const buffer   = await res.arrayBuffer();
  return { bytes: bufferToBase64(buffer), mimeType };
}

// ── SW-side file fetch (CORS bypass; used when the content script can't) ────

// Server-declared filename beats anything guessed from link text — viewer links
// (D2L topics, Canvas files, Moodle resources) carry no filename in the URL at all.
function filenameFromDisposition(cd) {
  if (!cd) return null;
  // RFC 5987: filename*=UTF-8'lang'encoded — the language tag is optional but
  // legal (UTF-8'en'r%C3%A9sum%C3%A9.pdf); preferred when both forms are present.
  let m = cd.match(/filename\*\s*=\s*utf-8'[^']*'([^;]+)/i);
  if (m) { try { return decodeURIComponent(m[1].trim()); } catch { /* fall through */ } }
  m = cd.match(/filename\s*=\s*"([^"]+)"/i) || cd.match(/filename\s*=\s*([^;]+)/i);
  if (m) return m[1].trim().replace(/^"+|"+$/g, "") || null;
  return null;
}

// Fallback: the final (post-redirect) URL often carries the real filename —
// e.g. Moodle's /pluginfile.php/.../lecture1.pdf, D2L's signed CDN URLs.
function filenameFromUrl(u) {
  try {
    const seg = new URL(u).pathname.split("/").filter(Boolean).pop() ?? "";
    if (/\.[a-z0-9]{2,8}$/i.test(seg)) return decodeURIComponent(seg);
  } catch {}
  return null;
}

// Redirect chains that end on an SSO/login endpoint mean the LMS session is
// stale — an environmental condition, not a property of the file. Detecting it
// gives a precise error AND keeps it out of the permanent failure backoff.
function looksLikeLoginUrl(u) {
  try {
    const { hostname, pathname } = new URL(u);
    return /(^|\/)(login|signin|sign-in|sso|saml2?|cas|adfs|idp|oauth2?|authorize|authentication)(\/|$|\.)/i.test(pathname)
        || /^(login|sso|auth|idp|cas|adfs)\./i.test(hostname);
  } catch { return false; }
}

function transientError(message) {
  const e = new Error(message);
  e.transient = true;      // importFileWork surfaces this so backoff never strikes it
  return e;
}

// Shared response→bytes pipeline: size caps, HTML/login-wall rejection, and
// server-declared filename extraction (Content-Disposition, then final URL).
async function bytesFromResponse(res, allowedHost) {
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  // Redirect chains can land anywhere — a public viewer URL 302ing to an internal
  // host must not have its content ingested (same rationale as isPrivateTarget on
  // the entry URL; this covers every resolver-derived and post-redirect fetch).
  if (res.url && isPrivateTarget(res.url)) throw new Error("Refusing a private/internal address");
  // A same-origin file URL that 302s to an arbitrary PUBLIC third party must not be
  // ingested either (RAG poisoning via open-redirect / attacker-posted link — most
  // relevant to the generic crawler). When the caller passes the consented host, the
  // FINAL url must be same-origin or a known LMS CDN — isAllowedSyncFileUrl still
  // permits Canvas inst-fs / D2L CDN, so this doesn't break the API adapters.
  if (allowedHost && res.url && !isAllowedSyncFileUrl(res.url, allowedHost)) throw new Error("Refusing a cross-origin redirect target");
  const mimeType = res.headers.get("content-type")?.split(";")[0]?.trim() ?? "application/octet-stream";
  // Reject oversized files from the Content-Length header BEFORE downloading the
  // body — a 500MB lecture video used to be fully downloaded just to be thrown
  // away here, stalling the whole sync. Cancel the stream so the transfer stops.
  const declaredLen = Number(res.headers.get("content-length") || 0);
  if (declaredLen > MAX_FILE_BYTES) {
    try { res.body?.cancel(); } catch { /* already consumed/locked */ }
    throw new Error("File too large (max 100 MB)");
  }
  // D2L sometimes wraps a media download (e.g. a lecture video topic) in a ZIP
  // container instead of serving the raw file — /api/extract has no text to pull
  // from a zip, so this used to fully download (often huge, since it's video),
  // upload to storage, and only THEN fail at the extract step. Reject upfront —
  // this extension has no zip-extraction path, so nothing is lost by skipping fast.
  if (mimeType === "application/zip" || mimeType === "application/x-zip-compressed") {
    try { res.body?.cancel(); } catch { /* already consumed/locked */ }
    throw new Error("Zip-wrapped file (likely a video) — no extractable text, skipped");
  }
  const buffer = await res.arrayBuffer();
  if (buffer.byteLength > MAX_FILE_BYTES) throw new Error("File too large (max 100 MB)");
  if (buffer.byteLength === 0) throw new Error("Empty response");
  // HTML/login-wall sniffing only needs the FRONT of the file, not the whole thing
  // base64-encoded — for a 90MB file that used to mean encoding 90MB just to peek
  // at it. Sniff a small prefix instead; base64 the full buffer only when the
  // caller actually needs it (small files bound for the inline-JSON path).
  const sniffLen = Math.min(buffer.byteLength, 4096);
  const prefixB64 = bufferToBase64(buffer.slice(0, sniffLen));
  if (mimeType.includes("text/html") || base64LooksLikeHtml(prefixB64)) {
    if (looksLikeLoginUrl(res.url)) throw transientError("LMS session expired — log in to your LMS and retry");
    throw new Error("Got a login/HTML page instead of the file — are you signed in to the LMS?");
  }
  const filename = filenameFromDisposition(res.headers.get("content-disposition")) || filenameFromUrl(res.url);
  // Big files (headed for the storage-upload path) keep the raw buffer and skip
  // base64 entirely — uploadViaStorage can PUT it directly. Small files still get
  // base64 now since they're bound for an inline JSON body either way.
  const bytes = buffer.byteLength > INLINE_RAW_LIMIT ? null : bufferToBase64(buffer);
  return { bytes, buffer, mimeType, filename, finalUrl: res.url };
}

async function fetchFileBytes(url, allowedHost) {
  const res = await fetch(url, { credentials: "include", redirect: "follow" });
  return bytesFromResponse(res, allowedHost);
}

// Diagnostic: fetch a URL the exact same way the download does, but report the
// RAW result (status, where it redirected to, content-type, a body snippet)
// instead of a cleaned-up error. This is how we see what the LMS actually returns
// to the service worker, rather than guessing from a summarized message.
async function diagnoseFetch(url) {
  try {
    const res = await fetch(url, { credentials: "include", redirect: "follow" });
    let snippet = "";
    try { snippet = (await res.clone().text()).slice(0, 180).replace(/\s+/g, " ").trim(); } catch {}
    const diag = {
      status: res.status,
      ok: res.ok,
      redirected: res.redirected,
      finalUrl: res.url,
      ctype: (res.headers.get("content-type") || "").split(";")[0].trim(),
      snippet,
    };
    console.log("[FschoolAI] diagnose", url, "→", diag);
    return diag;
  } catch (e) {
    const diag = { error: String((e && e.message) || e) };
    console.log("[FschoolAI] diagnose", url, "→ threw", diag.error);
    return diag;
  }
}

// ── Viewer-link resolver ─────────────────────────────────────────────────────
// Some LMS links need more than a straight fetch (see viewerRuleFor in content.js):
//   canvas-module-item — /courses/{c}/modules/items/{i} 302s to the item; only
//     File items land on /files/{id} (then rewritten to the raw-bytes URL).
//     fetch() can't expose Location headers (opaqueredirect), so we follow the
//     redirect chain and inspect the FINAL URL instead.
//   moodle-resource — /mod/resource/view.php?id= 302s straight to /pluginfile.php
//     in the common display modes (plain fetch works); embed/frame modes return
//     an HTML wrapper whose pluginfile link we extract (same-origin only).
// Everything else: plain fetch + HTML rejection is the verification.

async function resolveViewerFile(url, hint, allowedHost) {
  if (hint === "canvas-module-item") {
    const res = await fetch(url, { credentials: "include", redirect: "follow" });
    // A stale Canvas session redirects to SSO — that's not "not a file".
    if (looksLikeLoginUrl(res.url)) throw transientError("LMS session expired — log in to your LMS and retry");
    const m = (res.url ?? "").match(/\/files\/(\d+)/);
    if (!m) throw new Error("Not a file (module item is a page/quiz/link)");
    const origin = new URL(res.url).origin;
    return fetchFileBytes(`${origin}/files/${m[1]}/download?download_frd=1`, allowedHost);
  }

  if (hint === "moodle-resource") {
    const res = await fetch(url, { credentials: "include", redirect: "follow" });
    const ct = res.headers.get("content-type") ?? "";
    if (res.ok && !ct.includes("text/html")) return bytesFromResponse(res, allowedHost);  // 302'd straight to the file
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    // Embed/in-frame display mode: the wrapper HTML carries the pluginfile link.
    // The FIRST match isn't necessarily the resource — intro/description images
    // are served via pluginfile too. Score every candidate: the mod_resource
    // content area is the actual file, and document extensions beat images.
    const html = await res.text();
    const candidates = [...html.matchAll(/(?:href|src)\s*=\s*"([^"]*\/pluginfile\.php\/[^"]+)"/gi)]
      .map((m) => m[1].replace(/&amp;/g, "&"));
    if (!candidates.length) throw new Error("No file found in Moodle resource page");
    const score = (u) =>
      (/\/mod_resource\/content\//i.test(u) ? 2 : 0) +
      (/\.(pdf|docx?|pptx?|xlsx?|txt|csv)([?#]|$)/i.test(u) ? 1 : 0);
    candidates.sort((a, b) => score(b) - score(a));
    const target = new URL(candidates[0], res.url);
    if (target.origin !== new URL(url).origin) throw new Error("Cross-origin file blocked");
    return fetchFileBytes(target.toString(), allowedHost);
  }

  return fetchFileBytes(url, allowedHost);
}

// ── Signed-upload path for big files (Vercel body limit) ────────────────────

// Accepts either a raw ArrayBuffer (preferred — no re-encode) or a base64 string
// (defensive fallback for a caller that only ever had bytes, e.g. content.js's
// direct-fetch path, which in practice never exceeds INLINE_RAW_LIMIT anyway).
async function uploadViaStorage(auth, filename, bufferOrB64, mimeType) {
  const signRes = await fetch(`${API_BASE}/api/lms-ingest?action=sign`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ userId: auth.userId, name: filename }),
  });
  const sign = await signRes.json().catch(() => ({}));
  if (!signRes.ok || !sign.signedUrl) throw new Error(sign.error ?? "could not get upload URL");

  let body;
  if (bufferOrB64 instanceof ArrayBuffer) {
    body = bufferOrB64;
  } else {
    const bin = atob(bufferOrB64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    body = arr;
  }

  const putRes = await fetch(sign.signedUrl, {
    method:  "PUT",
    headers: { "Content-Type": mimeType || "application/octet-stream" },
    body,
  });
  if (!putRes.ok) {
    // Surface the actual rejection reason (was previously discarded) — a bare
    // status code isn't enough to diagnose a signed-upload failure.
    const detail = await putRes.text().catch(() => "");
    throw new Error(`storage upload failed (${putRes.status})${detail ? `: ${detail.slice(0, 200)}` : ""}`);
  }
  return { storagePath: sign.path, bucket: sign.bucket };
}

// ── File import (single entry point; queue-serialized) ──────────────────────

const IMPORT_CONCURRENCY = 8;   // parallel imports — raised from 4 now that big files use a raw
                                 // ArrayBuffer (not a duplicated base64 string), so memory pressure
                                 // per concurrent import is lower than it used to be
let activeImports = 0;
const importWaiters = [];       // resolvers parked while the pool is full
let queueDepth  = 0;
const inFlight  = new Set();   // canonical URLs currently queued/downloading (cross-frame dedup)

// ── Live activity (surfaced to the popup so it isn't a static screen) ────────
// The popup is a throwaway context and can't read the SW's in-memory queue vars,
// so we mirror a compact snapshot into chrome.storage.local. The popup renders it
// on open (via GET_STATUS, which also wakes the SW for a fresh read) and then
// updates live through chrome.storage.onChanged. The counter + recent feed are
// restored from the last snapshot on SW (re)start (see the startup block) so an
// open popup's number never jumps backward when MV3 recycles the worker; both
// reset on sign-out.

let activeFile       = null;   // filename currently importing, or null when idle
let sessionImported  = 0;      // successful (non-skipped) imports, restored across SW recycles
const recentActivity = [];     // [{ name, status: "done"|"skipped"|"failed", t }]
const RECENT_MAX = 6;
let fullSyncActive   = false;   // an LMS full-course API sync is in progress

function buildLiveState() {
  return {
    scanning:        queueDepth > 0,
    queueDepth,
    inFlight:        inFlight.size,
    activeFile,
    sessionImported,
    recent:          recentActivity.slice(),
    fullSync:        fullSyncActive,
    updatedAt:       Date.now(),
  };
}

// Trailing-debounced mirror: a batch of auto-captured files fires many queue/
// activity transitions in a burst — collapse them into one storage write per
// ~120ms so the popup gets a steady stream, not a stampede of onChanged events.
// Always converges to the latest state within the window.
//
// flush=true bypasses the debounce and writes synchronously — used for the queue
// rising/falling edges so the "scanning" spinner turns on/off instantly and can't
// be lost to an MV3 worker eviction inside the debounce window (a pending
// setTimeout doesn't keep the worker alive; the eager set() is issued in the same
// tick, before keepalive teardown can let the worker sleep).
let liveTimer = null, liveDirty = false;
function writeLiveState(flush = false) {
  liveDirty = true;
  if (flush) {
    if (liveTimer) { clearTimeout(liveTimer); liveTimer = null; }
    liveDirty = false;
    chrome.storage.local.set({ liveState: buildLiveState() });
    return;
  }
  if (liveTimer) return;
  liveTimer = setTimeout(() => {
    liveTimer = null;
    if (!liveDirty) return;
    liveDirty = false;
    chrome.storage.local.set({ liveState: buildLiveState() });
  }, 120);
}

function pushActivity(name, status, error) {
  recentActivity.unshift({ name: name || "file", status, error: error || null, t: Date.now() });
  if (recentActivity.length > RECENT_MAX) recentActivity.length = RECENT_MAX;
  writeLiveState();
}

function enqueueImport(task) {
  if (queueDepth >= QUEUE_MAX) {
    // transient: queue pressure says nothing about the file — must not burn backoff strikes.
    return Promise.resolve({ error: "Import queue is full — try again in a minute", transient: true });
  }
  queueDepth++;
  keepaliveStart();
  writeLiveState(queueDepth === 1);       // 0→1: flush so the spinner turns on instantly
  const run = (async () => {
    // Bounded POOL, not a serial chain: the old `importChain.then(task)` pattern
    // meant every import in the whole extension ran one-at-a-time — runFullSync's
    // 12-wide download pool all funnelled into a single-file pipeline, which was
    // the dominant cause of hour-long syncs. Concurrency is kept small because a
    // task can hold a whole file (as base64) in SW memory while uploading.
    while (activeImports >= IMPORT_CONCURRENCY) {
      await new Promise((r) => importWaiters.push(r));
    }
    activeImports++;
    try { return await task(); }
    finally { activeImports--; importWaiters.shift()?.(); }
  })().finally(() => {
    queueDepth--; keepaliveStop();
    writeLiveState(queueDepth === 0);     // →0: flush the idle edge before the worker can sleep
  });
  return run;
}

// Filename ↔ mimeType reconciliation: auto-captured "/files/download?id=N"-style links
// have no real filename, and a guessed wrong extension would mislead the server's
// type detection (it prefers the name's extension). Trust the fetched mimeType.
const MIME_EXT = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-excel": "xls",
  "text/plain": "txt",
  "text/csv": "csv",
};
function reconcileFilename(filename, mimeType) {
  const wantExt = MIME_EXT[mimeType];
  if (!wantExt) return filename;
  const m = String(filename ?? "file").match(/^(.*?)(\.[a-z0-9]{2,5})?$/i);
  const stem = (m?.[1] || "file").replace(/\.$/, "");
  const haveExt = (m?.[2] ?? "").slice(1).toLowerCase();
  return haveExt === wantExt ? filename : `${stem}.${wantExt}`;
}

// Thin wrapper around the real import: tracks the active filename + records the
// outcome so the popup can show live "Importing X…" and a ticking counter. Never
// lets a thrown error leave activeFile stuck (which would spin the popup forever).
async function importFileInner(payload) {
  const displayName = String(payload.filename || "file").split(/[/\\]/).pop() || "file";
  activeFile = displayName;
  writeLiveState();
  let result;
  try {
    result = await importFileWork(payload);
  } catch (e) {
    result = { error: e?.message ?? "Network error" };
  }
  activeFile = null;
  if (result?.ok && !result.skipped) sessionImported++;
  pushActivity(displayName, result?.ok ? (result.skipped ? "skipped" : "done") : "failed", result?.ok ? null : result?.error);
  return result;
}

async function importFileWork({ url, filename, pageUrl, courseId, bytes, buffer, mimeType, platform, fetchUrl, resolveHint, allowedHost }) {
  const auth = await getAuth();
  // transient: signed-out is not a property of the file — must not burn backoff strikes.
  if (!auth) return { error: "Not signed in. Open the extension popup to sign in.", transient: true };

  const canonicalKey = canonicalizeUrl(url ?? fetchUrl);
  try {
    // Cross-frame race: top frame and an iframe often list the same file — the second
    // occurrence waits in the queue, so re-check history when its turn comes.
    if ((await getCaptured()).includes(canonicalKey)) return { ok: true, skipped: true };

    // Fetch here (SW bypasses CORS) when the content script couldn't, or for
    // pending-download imports where only the URL is known. Viewer links carry a
    // resolveHint and go through the platform resolver.
    if (!bytes && !buffer && fetchUrl) {
      if (isPrivateTarget(fetchUrl)) return { error: "Refusing to fetch a private/internal address" };
      const fetched = await resolveViewerFile(fetchUrl, resolveHint, allowedHost);
      bytes    = fetched.bytes;    // null for big files — buffer carries them instead
      buffer   = fetched.buffer;
      mimeType = mimeType && mimeType !== "application/octet-stream" ? mimeType : fetched.mimeType;
      // Server-declared name (Content-Disposition / final URL) beats link-text guesses.
      if (fetched.filename) filename = fetched.filename;
    }
    if (!bytes && !buffer) return { error: "No file data" };
    // bytesFromResponse already HTML-sniffs buffer-only (big) files internally —
    // this second check only applies when we have a base64 string to look at.
    if (bytes && base64LooksLikeHtml(bytes)) {
      return { error: "Got a login/HTML page instead of the file — are you signed in to the LMS?" };
    }

    filename = reconcileFilename(filename, mimeType);
    const sourceUrl = canonicalKey;
    const filePayload = {
      name:      filename,
      mimeType:  mimeType ?? "application/octet-stream",
      sourceUrl,
      provider:  "extension",
      metadata:  { platform: platform ?? "web", courseId: courseId ?? null },
    };

    // Big files can't ride an inline JSON body (Vercel ~4.5MB cap) → storage path.
    // Prefer the raw buffer when we have one — skips a base64 encode+decode
    // round trip that used to double memory/CPU on exactly the biggest files.
    const isBig = buffer ? buffer.byteLength > INLINE_RAW_LIMIT : bytes.length > INLINE_B64_LIMIT;
    if (isBig) {
      const { storagePath, bucket } = await uploadViaStorage(auth, filename, buffer || bytes, filePayload.mimeType);
      filePayload.storagePath = storagePath;
      filePayload.bucket      = bucket;
    } else {
      filePayload.bytes = bytes;
    }

    const res = await fetch(`${API_BASE}/api/lms-ingest`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ userId: auth.userId, courseId: courseId ?? null, file: filePayload }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { error: data.error ?? `Ingest failed (${res.status})` };

    await markCaptured(sourceUrl);
    // Imported downloads leave the pending list (and the badge shrinks with them).
    if (platform === "download") {
      chrome.storage.local.get(["pendingDownloads"], ({ pendingDownloads = [] }) => {
        const remaining = pendingDownloads.filter(d => d.url !== (fetchUrl ?? url));
        chrome.storage.local.set({ pendingDownloads: remaining });
        chrome.action.setBadgeText({ text: remaining.length ? String(remaining.length) : "" });
      });
    }
    return { ok: true, skipped: data.skipped, documentId: data.documentId };
  } catch (e) {
    // Environmental failures must not burn backoff strikes: fetch() throws
    // TypeError on network-level failures (offline, DNS, blocked), and resolvers
    // flag login-wall redirects with e.transient (see transientError()).
    return { error: e.message ?? "Network error", transient: e instanceof TypeError || e?.transient === true };
  }
}

function importFile(payload) {
  return enqueueImport(() => importFileInner(payload));
}

// ── Auto-capture (from content scripts on LMS-looking pages) ────────────────

async function autoImportBatch({ items, pageUrl, platform }) {
  const auth = await getAuth();
  if (!auth) return { ok: false, reason: "signed-out" };
  const settings = await getSettings();
  if (!settings.autoCapture) return { ok: false, reason: "disabled" };

  const captured = await getCaptured();
  const fresh = [];
  const seenThisBatch = new Set();
  for (const it of (items ?? [])) {
    const key = canonicalizeUrl(it.url);
    if (captured.includes(key) || seenThisBatch.has(key) || inFlight.has(key)) continue;
    if (isPrivateTarget(it.url)) continue;              // SSRF guard (defense in depth)
    if (await isBlockedByFailures(key)) continue;       // 3-strike backoff — no eternal retries
    seenThisBatch.add(key);
    inFlight.add(key);
    fresh.push({ ...it, key });
  }

  let imported = 0, skipped = 0, failed = 0;
  const strikeKeys = [];
  try {
    for (const it of fresh) {
      const r = await importFile({
        url: it.url, fetchUrl: it.url, filename: it.filename,
        pageUrl, courseId: null, platform, resolveHint: it.resolveHint,
      });
      if (r?.ok) { if (r.skipped) skipped++; else imported++; }
      else {
        failed++;
        // Only permanent failures count toward the 3-strike/7-day backoff.
        // Queue-full, signed-out, and network errors are transient — striking
        // them would silently blacklist perfectly good files for a week.
        if (!r?.transient) strikeKeys.push(it.key);
      }
    }
  } finally {
    for (const it of fresh) inFlight.delete(it.key);
  }
  // Login-wall heuristic: when EVERYTHING in a 3+ batch failed and nothing
  // actually imported, the cause is almost certainly environmental (expired LMS
  // session serving login pages) — don't strike, or good files get blacklisted
  // while the user is merely logged out. Mixed batches strike normally: a
  // failure next to real imports is file-specific (e.g. a D2L Link topic).
  // Note `skipped` doesn't count as proof of life — dedup-skips never hit the
  // network, so they say nothing about whether the LMS session works.
  if (imported > 0 || strikeKeys.length < 3) {
    for (const k of strikeKeys) await recordFailure(k);
  }
  if (imported > 0) bumpStat("autoImported", imported);
  return { ok: true, imported, skipped, failed, considered: fresh.length };
}

function bumpStat(key, by) {
  chrome.storage.local.get(["stats"], ({ stats = {} }) => {
    stats[key] = (stats[key] ?? 0) + by;
    chrome.storage.local.set({ stats });
  });
}

// ── Full-course API sync ─────────────────────────────────────────────────────
// The zero-friction path: once the user has consented to a host, enumerate EVERY
// course file via the LMS's own API (injected into the page's MAIN world) and
// import them all — no tabs opened, no page-by-page clicking. Gated on consent
// (mode "on"), throttled per host, and serialized through the same import queue
// (with a small pool so we never overflow QUEUE_MAX or hammer the LMS).

const fullSyncHosts = new Set();   // hosts with a sync in flight (re-entry guard)
const SYNC_ERROR_COOLDOWN_MS = 5 * 60 * 1000;   // back off a host after a transient enum error
const syncErrorAt = new Map();                   // host → last-error ts (in-memory)

// In-memory cache of hosts the user consented to ("on"), so tabs.onUpdated can
// pre-filter with a synchronous Set lookup instead of a storage read on EVERY
// navigation the user makes anywhere. Repopulated on SW start; kept in sync by
// SET_SITE_MODE and a storage.onChanged listener.
const consentedHosts = new Set();
async function refreshConsentedHosts() {
  const autoSites = await new Promise((r) => chrome.storage.local.get(["autoSites"], ({ autoSites = {} }) => r(autoSites)));
  consentedHosts.clear();
  for (const h in autoSites) if (autoSites[h] === "on") consentedHosts.add(h);
}

// eTLD+1 approximation (no public-suffix list in a service worker): the last two
// labels. Defence-in-depth only — it over-allows within a shared ccTLD but never
// under-allows a legitimate same-host file, and pairs with the CDN allowlist.
function registrableDomain(host) {
  const p = String(host || "").toLowerCase().split(".").filter(Boolean);
  return p.slice(-2).join(".");
}
// LMS file CDNs that legitimately serve files off a different domain than the portal.
const LMS_FILE_HOST_ALLOW = [
  /(^|\.)inscloudgate\.net$/,        // Canvas inst-fs
  /(^|\.)instructure-uploads[.-]/,   // Canvas S3 upload buckets
  /(^|\.)brightspace\.com$/,         // D2L CDN
  /(^|\.)brightspacecdn\.com$/,
  /(^|\.)desire2learn\.com$/,
];
// The enumerated file URL comes from the page's MAIN world, which the site fully
// controls (it can override window.fetch/ENV to return arbitrary URLs). Before
// fetching it WITH CREDENTIALS, constrain it to the consented host's own org
// domain or a known LMS CDN — otherwise a hostile consented page could drive
// credentialed cross-origin GETs or poison the RAG with third-party content.
function isAllowedSyncFileUrl(fileUrl, tabHost) {
  try {
    const h = new URL(fileUrl).hostname.toLowerCase();
    const th = String(tabHost || "").toLowerCase();
    if (!h) return false;
    if (h === th || h.endsWith("." + th) || th.endsWith("." + h)) return true;
    if (registrableDomain(h) && registrableDomain(h) === registrableDomain(th)) return true;
    return LMS_FILE_HOST_ALLOW.some((re) => re.test(h));
  } catch { return false; }
}

async function getSyncTimes() {
  return new Promise((r) => chrome.storage.local.get(["syncTimes"], ({ syncTimes }) =>
    r(syncTimes && typeof syncTimes === "object" ? syncTimes : {})));
}
async function markSynced(host) {
  const m = await getSyncTimes();
  m[host] = Date.now();
  const keys = Object.keys(m);
  if (keys.length > 100) delete m[keys[0]];   // bound the map
  await new Promise((r) => chrome.storage.local.set({ syncTimes: m }, r));
}

// Bounded-concurrency runner: caps outstanding work so we neither overflow the
// import queue nor stampede the LMS with parallel downloads.
async function runPool(items, limit, fn) {
  let i = 0;
  const worker = async () => { while (i < items.length) { const idx = i++; try { await fn(items[idx]); } catch { /* isolate */ } } };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

async function siteMode(host) {
  return new Promise((r) => chrome.storage.local.get(["autoSites"], ({ autoSites = {} }) =>
    r(autoSites[host])));
}

// ── LMS enumeration IN THE SERVICE WORKER ────────────────────────────────────
// Research-verified: an MV3 SW fetch with host_permissions + credentials:"include"
// sends the LMS session cookies (SameSite Lax/Strict) AND bypasses CORS, so it can
// read the cross-origin inst-fs/S3 CDN that Canvas 302-redirects downloads to. A
// content-script/page fetch runs with the PAGE origin, ignores host_permissions,
// and is CORS-blocked on that CDN hop — which is exactly the wall the in-page
// approach hit. So ALL authenticated I/O (enumerate + download) happens HERE.
// Canvas needs no token (cookie authorizes); D2L needs its XSRF token and Moodle
// its sesskey, which only the page can read, so the content script passes them in.

async function swGetJSON(url, headers) {
  const r = await fetch(url, { credentials: "include", headers: { Accept: "application/json", ...(headers || {}) } });
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return { r, data: await r.json() };
}

async function enumCanvasSW(origin) {
  const pageAll = async (path) => {
    let url = origin + "/api/v1" + path + (path.includes("?") ? "&" : "?") + "per_page=100";
    const out = [];
    for (let i = 0; i < 40 && url; i++) {
      const { r, data } = await swGetJSON(url);
      if (Array.isArray(data)) out.push(...data); else break;
      const m = (r.headers.get("Link") || "").match(/<([^>]+)>;\s*rel="next"/);
      url = m ? m[1] : null;
    }
    return out;
  };
  let courses = await pageAll("/courses?enrollment_state=active&enrollment_type=student");
  if (!courses.length) courses = await pageAll("/courses");
  courses = courses.filter((c) => c.id && c.name && !c.access_restricted_by_date);
  const files = [];
  const seen = new Set();
  const add = (cid, fid, name) => {
    const k = "f:" + cid + ":" + fid;
    if (!fid || seen.has(k)) return;
    seen.add(k);
    // The SW's credentials:"include" fetch lets the session cookie authorize this
    // download and follow the 302 to the inst-fs CDN — no verifier needed. The real
    // filename comes back via Content-Disposition, so a null name is fine here.
    files.push({ url: `${origin}/courses/${cid}/files/${fid}/download?download_frd=1`, filename: name || ("file_" + fid), courseId: String(cid) });
  };
  const addUrl = (cid, url) => {
    if (!url || seen.has("u:" + url)) return;
    seen.add("u:" + url);
    files.push({ url, filename: null, courseId: String(cid) });
  };
  // UNIVERSAL file extractor: given ANY page's HTML, pull out every downloadable
  // file the user could see on it — however the LMS structures things:
  //   (a) Canvas file ids anywhere (/files/{id}, incl. preview/embed/api forms)
  //   (b) direct href/src links to a document, a /download, or a pluginfile.
  // This is the general "if it's on a page the user can reach, we get it" rule.
  const DOC_EXT_RE = /\.(pdf|docx?|pptx?|xlsx?|txt|csv|rtf|odt|odp)(\?|#|$)/i;
  const addFromHtml = (cid, html) => {
    if (!html || typeof html !== "string") return;
    let m;
    const idRe = /\/files\/(\d+)/g;
    while ((m = idRe.exec(html))) add(cid, m[1], null);
    const attrRe = /(?:href|src|data-api-endpoint|data-url)\s*=\s*["']([^"'\s>]+)["']/gi;
    while ((m = attrRe.exec(html))) {
      const raw = m[1].replace(/&amp;/g, "&");
      if (/\/files\/\d+/.test(raw)) continue;   // Canvas file — handled by add() above
      if (!DOC_EXT_RE.test(raw) && !/\/(pluginfile\.php|files\/download|download\?)/i.test(raw)) continue;
      let abs; try { abs = new URL(raw, origin).toString(); } catch { continue; }
      if (abs.startsWith(origin + "/")) addUrl(cid, abs);   // same-origin course resource only
    }
  };
  // Fetch a Page's HTML and harvest its files. Reached via the module item the user
  // actually clicks, so it works even when the Files/Pages TABS are disabled.
  const scanPage = async (cid, slug) => {
    try { const { data } = await swGetJSON(`${origin}/api/v1/courses/${cid}/pages/${encodeURIComponent(slug)}`); addFromHtml(cid, data && data.body); } catch { /* page blocked */ }
  };
  await Promise.all(courses.map(async (c) => {
    // Walk EVERY module item the user can click — not just File items. Page items
    // ("Class 3 slides", etc.) hold their PDFs in the page body, so fetch + extract.
    try {
      const mods = await pageAll(`/courses/${c.id}/modules?include[]=items&include[]=content_details`);
      const pageSlugs = new Set();
      for (const mod of mods) for (const it of (mod.items || [])) {
        const displayName = it.title || (it.content_details && it.content_details.display_name);
        if (it.type === "File" && it.content_id && !looksLikeVideoAudio(displayName)) add(c.id, it.content_id, displayName);
        else if (it.type === "Page" && it.page_url) pageSlugs.add(it.page_url);
      }
      await Promise.all([...pageSlugs].map((slug) => scanPage(c.id, slug)));
    } catch { /* modules off */ }
    // Files tab (best effort; often 403 for students).
    try {
      for (const f of await pageAll(`/courses/${c.id}/files`)) {
        const name = f.display_name || f.filename;
        if (!looksLikeVideoAudio(name)) add(c.id, f.id, name);
      }
    } catch { /* files tab off */ }
    // Syllabus body.
    try { const { data } = await swGetJSON(`${origin}/api/v1/courses/${c.id}?include[]=syllabus_body`); addFromHtml(c.id, data && data.syllabus_body); } catch { /* no syllabus */ }
    // Pages index (catches pages not linked from any module), bounded.
    try {
      const pages = await pageAll(`/courses/${c.id}/pages`);
      await Promise.all(pages.slice(0, 80).map((pg) => pg.url ? scanPage(c.id, pg.url) : null));
    } catch { /* pages tab off — module Page items above already covered the reachable ones */ }
    // Assignment descriptions.
    try { for (const a of await pageAll(`/courses/${c.id}/assignments`)) addFromHtml(c.id, a && a.description); } catch { /* assignments off */ }
  }));
  return { lms: "canvas", files, courses: courses.length };
}

async function enumD2LSW(origin, xsrf) {
  const dget = async (p) => (await swGetJSON(origin + p, { "X-Csrf-Token": xsrf || "" })).data;
  let lpV = "1.30", leV = "1.50";
  try { const vers = await dget("/d2l/api/versions/"); const pick = (c) => (vers.find((v) => v.ProductCode === c) || {}).LatestVersion; lpV = pick("lp") || lpV; leV = pick("le") || leV; } catch { /* defaults */ }
  // Full course objects (not just ids) — needed so course names/codes/grades can be
  // synced alongside files, matching what the app already does for Canvas.
  const courses = []; let bm = "";
  for (let i = 0; i < 25; i++) {
    const ps = await dget(`/d2l/api/lp/${lpV}/enrollments/myenrollments/?orgUnitTypeId=3&isActive=true${bm ? `&bookmark=${encodeURIComponent(bm)}` : ""}`);
    for (const it of (ps.Items || [])) {
      const o = it.OrgUnit || {};
      if (o.Id) courses.push({ id: String(o.Id), name: o.Name || "", code: o.Code || "", currentScore: null, finalScore: null });
    }
    if (ps.PagingInfo && ps.PagingInfo.HasMoreItems) bm = ps.PagingInfo.Bookmark; else break;
  }
  const files = [];
  const seen = new Set();
  const addUrl = (url, ou) => { if (!url || seen.has(url)) return; seen.add(url); files.push({ url, filename: null, courseId: String(ou) }); };
  // Universal extractor for a D2L content page's HTML — pulls out embedded files
  // however they're linked (same principle as Canvas): direct document links,
  // /content/enforced/ course-file paths, and DirectFileTopicDownload links.
  const DOC_EXT_RE = /\.(pdf|docx?|pptx?|xlsx?|txt|csv|rtf|odt|odp)(\?|#|$)/i;
  const addFromHtml = (html, ou) => {
    if (!html || typeof html !== "string") return;
    let m; const re = /(?:href|src|data-url)\s*=\s*["']([^"'\s>]+)["']/gi;
    while ((m = re.exec(html))) {
      const raw = m[1].replace(/&amp;/g, "&");
      if (!DOC_EXT_RE.test(raw) && !/DirectFileTopicDownload|\/content\/enforced\//i.test(raw)) continue;
      let abs; try { abs = new URL(raw, origin).toString(); } catch { continue; }
      if (abs.startsWith(origin + "/")) addUrl(abs, ou);   // same-origin course resource only
    }
  };
  // One pass per course: TOC + dropbox + quizzes + grades are all independent API
  // calls, so they're fetched CONCURRENTLY (not one-after-another) and their results
  // shared between file-discovery and assignment/grade extraction — the previous
  // two-pass version fetched dropbox/quizzes twice per course and ran the second
  // pass only after every course's first pass finished, which was needlessly slow.
  let tocFailures = 0;
  const assignments = [];
  await Promise.all(courses.map(async (course) => {
    const ou = course.id;

    const [toc, dropbox, quizzes, catList, items, finalGrade] = await Promise.all([
      dget(`/d2l/api/le/${leV}/${ou}/content/toc`).catch(() => { tocFailures++; return null; }),
      dget(`/d2l/api/le/${leV}/${ou}/dropbox/folders/`).catch(() => []),
      dget(`/d2l/api/le/${leV}/${ou}/quizzes/`).catch(() => null),
      dget(`/d2l/api/le/${leV}/${ou}/grades/categories/`).catch(() => []),
      dget(`/d2l/api/le/${leV}/${ou}/grades/values/myGradeValues/`).catch(() => []),
      dget(`/d2l/api/le/${leV}/${ou}/grades/final/values/myGradeValue/`).catch(() => null),
    ]);
    if (!toc) return;   // TOC failed — the tenant-version check below handles reporting this

    // Walk the TOC. File topics → the direct download. Content/HTML topics (and any
    // topic whose Url isn't an external Link) → fetch the page the user would see
    // and extract embedded files — so a PDF linked inside an HTML content topic
    // (D2L's equivalent of a Canvas "Class N slides" page) is no longer missed.
    const htmlUrls = new Set();
    const walk = (mod) => {
      for (const t of (mod.Topics || [])) {
        if (t.TypeIdentifier === "File" && t.TopicId && !looksLikeVideoAudio(t.Title)) {
          addUrl(`${origin}/d2l/le/content/${ou}/topics/files/download/${t.TopicId}/DirectFileTopicDownload`, ou);
        }
        // Skip external links (Url/Link topics point off-site).
        if (t.Url && t.TypeIdentifier !== "Link" && t.TypeIdentifier !== "Url") {
          let u; try { u = new URL(t.Url, origin); } catch { u = null; }
          if (u && u.origin === origin) {
            if (DOC_EXT_RE.test(u.pathname)) addUrl(u.toString(), ou);       // directly-linked document
            else if (/\.html?$/i.test(u.pathname) || t.TypeIdentifier !== "File") htmlUrls.add(u.toString());
          }
        }
      }
      for (const s of (mod.Modules || [])) walk(s);
    };
    for (const m of ((toc && toc.Modules) || [])) walk(m);
    // Fetch content-page HTML (bounded, concurrency-limited) and extract embedded files.
    await runPool([...htmlUrls].slice(0, 120), 6, async (u) => {
      try {
        const r = await fetch(u, { credentials: "include", redirect: "follow" });
        if (r.ok && (r.headers.get("content-type") || "").includes("text/html")) addFromHtml(await r.text(), ou);
      } catch { /* page blocked */ }
    });
    // Assignment (Dropbox) + quiz instructions can embed course materials the same
    // way a Canvas assignment description can — scan them too, mirroring
    // enumCanvasSW's "Assignment descriptions" pass so D2L reaches the same coverage.
    for (const f of (dropbox || [])) {
      const instr = f && f.CustomInstructions;
      addFromHtml(instr && (instr.Html || instr.Text), ou);
    }
    for (const q of ((quizzes && quizzes.Objects) || (Array.isArray(quizzes) ? quizzes : []))) {
      const instr = q && q.Instructions;
      addFromHtml(instr && (instr.Html || instr.Text), ou);
    }

    // ── Assignments + grades (parity with Canvas's canvasSync.ts) ──────────
    // Mirrors the D2L logic proven out in the old extension (extension/shared-sync.js),
    // with one fix: per-item weight's denominator must EXCLUDE items the "best N of M"
    // scheme dropped for this student (they show as 0/0 in myGradeValues), otherwise
    // weight gets diluted across items that don't actually count toward the grade —
    // e.g. "best 8 of 10 quizzes, 24% of grade, 3pts each" should give each counted
    // quiz 24%×(3/24)=3%, not 24%×(3/30)=2.4% (using all 10 as the denominator).
    const norm = (s) => (s || "").toLowerCase().replace(/\s+/g, " ").trim();
    const byTitle = new Map();
    const titleId = (k) => {
      let h = 0; for (let i = 0; i < k.length; i++) h = (Math.imul(h, 31) + k.charCodeAt(i)) | 0;
      return "d2l_" + ou + "_" + (h >>> 0).toString(36) + "_" + k.slice(0, 32);
    };
    const upsertAssign = (title, patch) => {
      const k = norm(title);
      if (!k) return;
      const cur = byTitle.get(k) || {
        courseId: ou, id: titleId(k), title,
        dueAt: null, pointsPossible: null, score: null,
        weight: null, weightAchieved: null, submittedAt: null, missing: false,
      };
      byTitle.set(k, Object.assign(cur, patch));
    };

    for (const f of (dropbox || [])) upsertAssign(f.Name || "Assignment", { dueAt: f.DueDate || null });
    for (const q of ((quizzes && quizzes.Objects) || (Array.isArray(quizzes) ? quizzes : [])))
      upsertAssign(q.Name || "Quiz", { dueAt: q.DueDate || null });

    const valById = {};
    for (const it of items) valById[String(it.GradeObjectIdentifier)] = it;

    // Per-category weight info — totalMax sums only children that actually count
    // for THIS student (a real PointsDenominator in their own grade value), so a
    // dropped item's max points don't dilute the others' weight.
    const childIds = new Set();
    const childWeight = {};
    for (const cat of catList) {
      const kids = cat.Grades || [];
      const counted = kids.filter((g) => { const v = valById[String(g.Id)]; return v && v.PointsDenominator; });
      const totalMax = counted.reduce((s, g) => s + (g.MaxPoints || 0), 0);
      for (const g of kids) {
        childIds.add(String(g.Id));
        childWeight[String(g.Id)] = { catWeight: cat.Weight, totalMax, childMax: g.MaxPoints || 0 };
      }
    }

    const r2 = (n) => (n == null ? null : Math.round(n * 100) / 100);
    for (const it of items) {
      if (it.GradeObjectTypeName === "Category") continue;
      const id = String(it.GradeObjectIdentifier);
      let weight = null, weightAch = null;
      const ci = childWeight[id];
      if (ci && ci.totalMax > 0) {
        weight = ci.catWeight * (ci.childMax / ci.totalMax);
        weightAch = it.PointsDenominator ? weight * (it.PointsNumerator / it.PointsDenominator) : null;
      } else if (it.WeightedDenominator != null) {
        weight = it.WeightedDenominator; weightAch = it.WeightedNumerator;
      }
      upsertAssign(it.GradeObjectName, {
        score:          it.PointsNumerator != null && it.PointsNumerator > 0 ? it.PointsNumerator : null,
        pointsPossible: it.PointsDenominator ?? null,
        weight:         r2(weight),
        weightAchieved: r2(weightAch),
      });
    }

    // Overall course grade: categories → average only their graded children
    // (ungraded/dropped = 0/0, excluded, not treated as a real zero), scaled by
    // category weight; standalone items → their own weighted contribution.
    let num = 0, den = 0;
    for (const cat of catList) {
      const w = cat.Weight;
      if (w == null) continue;
      let cn = 0, cd = 0;
      for (const g of (cat.Grades || [])) {
        const v = valById[String(g.Id)];
        if (v && v.PointsNumerator > 0 && v.PointsDenominator) { cn += v.PointsNumerator; cd += v.PointsDenominator; }
      }
      if (cd > 0) { num += w * (cn / cd); den += w; }
    }
    for (const it of items) {
      const id = String(it.GradeObjectIdentifier);
      if (childIds.has(id) || it.GradeObjectTypeName === "Category") continue;
      if (!(it.PointsNumerator > 0)) continue;
      if (it.WeightedNumerator != null && it.WeightedDenominator != null) { num += it.WeightedNumerator; den += it.WeightedDenominator; }
    }
    if (den > 0) course.currentScore = Math.round((num / den) * 1000) / 10;

    if (finalGrade && finalGrade.PointsNumerator != null && finalGrade.PointsDenominator)
      course.finalScore = Math.round((finalGrade.PointsNumerator / finalGrade.PointsDenominator) * 1000) / 10;

    assignments.push(...byTitle.values());
  }));

  // Unlike Canvas's fixed "v1" API, D2L's LP/LE versions are auto-discovered per
  // tenant (line ~895) and can be wrong. If every course's content/toc call failed,
  // the sync would otherwise silently report "0 files, done" with no clue why —
  // surface it as a real, diagnosable error instead (matches the Moodle no-sesskey
  // error shape below).
  if (courses.length > 0 && tocFailures === courses.length) {
    return {
      lms: "d2l", error: true, files: [],
      detail: `content/toc failed for all ${courses.length} course(s) — LE API version ${leV} may not match this tenant, or the session/XSRF token is stale`,
    };
  }
  return { lms: "d2l", files, courses, assignments };
}

async function enumMoodleSW(origin, sesskey) {
  if (!sesskey) return { lms: "moodle", error: true, files: [], detail: "no sesskey (open a Moodle page while logged in)" };
  const call = async (methodname, args) => {
    const r = await fetch(`${origin}/lib/ajax/service.php?sesskey=${encodeURIComponent(sesskey)}&info=${methodname}`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify([{ index: 0, methodname, args }]) });
    if (!r.ok) throw new Error(`moodle ${methodname} -> ${r.status}`);
    const data = await r.json();
    if (Array.isArray(data) && data[0] && !data[0].error) return data[0].data;
    throw new Error("moodle " + methodname);
  };
  const cres = await call("core_course_get_enrolled_courses_by_timeline_classification", { classification: "all", limit: 0, offset: 0, sort: "fullname" });
  const mc = (cres && cres.courses) || [];
  const files = [];
  await Promise.all(mc.map(async (c) => {
    try {
      const secs = await call("core_course_get_contents", { courseid: Number(c.id) });
      for (const sec of (secs || [])) for (const mod of (sec.modules || [])) for (const ct of (mod.contents || [])) {
        const name = ct.filename || mod.name || "file";
        if (ct.type === "file" && ct.fileurl && !looksLikeVideoAudio(name)) files.push({ url: ct.fileurl, filename: name, courseId: String(c.id) });
      }
    } catch { /* skip */ }
  }));
  return { lms: "moodle", files, courses: mc.length };
}

// GENERAL crawler — the server-rendered / unknown-LMS case (Moodle-classic,
// Blackboard Original, Sakai, itslearning, self-hosted portals, …). No platform
// API: just the "if the user can click to it, so can we" rule, done safely:
//   • Same-origin GET navigation only, breadth-first over <a href> links. The SW
//     fetches — it can't click — so it can NEVER fire a mutating onClick (submit /
//     start-attempt / delete). This is read-only by construction, which is what
//     makes a generic crawl safe where an in-page click-crawler would not be.
//   • Every page's HTML is mined for (a) file links (by extension or by a
//     download/pluginfile/attachment path) and (b) more same-origin pages to visit.
//   • A queued "page" whose response is NOT html but a document content-type IS a
//     file — catches extension-less "clean" download URLs (e.g. /resource/view?id=).
//   • Bounded by page count AND wall-clock so calendars / pagination can't run away;
//     a denylist skips auth/mutation/infinite surfaces (logout, edit, search, …).
// SPA-routed navigation (targets computed in JS, not in the DOM) is out of reach
// here by design — that's the per-platform API's job (Canvas/D2L/Moodle above).
async function enumGenericSW(origin, startUrl) {
  const MAX_PAGES = 150, MAX_FILES = 600, CONCURRENCY = 6, TIME_BUDGET_MS = 60_000;
  const t0 = Date.now();
  const files = [];
  const seenFile = new Set();
  const addFile = (url) => {
    if (!url || files.length >= MAX_FILES || seenFile.has(url)) return;
    if (!url.startsWith(origin + "/")) return;   // same-origin only (SSRF / RAG-poison guard)
    seenFile.add(url);
    files.push({ url, filename: null, courseId: null });   // no course structure in the generic case
  };
  const DOC_EXT_RE  = /\.(pdf|docx?|pptx?|xlsx?|txt|csv|rtf|odt|odp|epub)(\?|#|$)/i;
  const FILE_URL_RE = /\/(pluginfile\.php|files?\/download|download|attachment|getfile|servefile|content\/enforced)\b/i;
  const ASSET_RE    = /\.(css|js|mjs|png|jpe?g|gif|svg|ico|webp|woff2?|ttf|eot|mp4|mp3|wav|mov|zip|json|xml|rss)(\?|#|$)/i;
  const SKIP_PATH_RE = /\/(logout|sign-?out|log-?in|sign-?in|auth|oauth|account|profile|preferences?|settings|admin|edit|new|create|upload|print|rss|feed|search|calendar|messages?|inbox|mail|notifications?|help|support)\b/i;
  const SKIP_QS_RE  = /[?&](sort|dir|page|start|offset|order|tsort|do|op|cmd|task|method)=/i;
  // Mutating actions that legacy server-rendered LMSs expose over GET. NEVER follow
  // these (file OR page). The SW can only GET — this is the guard against a crawl that
  // GET-triggers delete/submit/withdraw through a harvested link carrying the live
  // session. Checked before file/page classification so "/download?action=delete"
  // can't slip through as a "file". (action=download stays allowed — we match the
  // destructive verb, not the param name.)
  const DESTRUCTIVE_RE = /(?:^|[/?&=._-])(delete|remove|destroy|reset|unenrol|unenroll|withdraw|deregister|expel|logout|logoff|sign-?out|submit|purge|revoke|deactivate|disable|drop)/i;

  const norm = (u) => { try { const x = new URL(u); x.hash = ""; return x.toString(); } catch { return null; } };

  // Parse one page: collect file URLs, return the same-origin pages worth visiting.
  const parse = (html, base) => {
    const next = [];
    let m; const attrRe = /(?:href|src|data-url|data-href|data-download-url)\s*=\s*["']([^"'\s>]+)["']/gi;
    while ((m = attrRe.exec(html))) {
      const raw = m[1].replace(/&amp;/g, "&");
      if (/^(javascript:|mailto:|tel:|data:|blob:|#)/i.test(raw)) continue;
      let abs; try { abs = new URL(raw, base); } catch { continue; }
      if (abs.origin !== origin) continue;                         // same-origin only
      const path = abs.pathname;
      if (DESTRUCTIVE_RE.test(path + abs.search)) continue;        // never GET a mutating link (file OR page)
      if (DOC_EXT_RE.test(path) || FILE_URL_RE.test(path)) { addFile(abs.toString()); continue; }
      if (ASSET_RE.test(path)) continue;                           // css/img/media — not a page, not a doc
      if (SKIP_PATH_RE.test(path) || SKIP_QS_RE.test(abs.search)) continue;
      next.push(abs.toString());
    }
    return next;
  };

  const visited = new Set();
  let frontier = [];
  // Seed by PARSED origin, not a string prefix — startsWith("https://host") would also
  // accept "https://host.evil.com/…" and seed a cross-origin URL into the frontier.
  let seed = origin + "/";
  try { if (startUrl && new URL(startUrl).origin === origin) seed = startUrl; } catch { /* bad startUrl → root */ }
  for (const s of [seed, origin + "/"]) { const n = norm(s); if (n) frontier.push(n); }
  let pagesFetched = 0;

  while (frontier.length && visited.size < MAX_PAGES && files.length < MAX_FILES && Date.now() - t0 < TIME_BUDGET_MS) {
    const batch = [];
    for (const u of frontier) {
      if (visited.size >= MAX_PAGES) break;
      if (visited.has(u)) continue;
      visited.add(u); batch.push(u);
    }
    if (!batch.length) break;
    const nextFrontier = [];
    await runPool(batch, CONCURRENCY, async (u) => {
      if (files.length >= MAX_FILES || Date.now() - t0 >= TIME_BUDGET_MS) return;
      // redirect:"manual" → a 3xx yields an opaque, un-fetched response (r.ok false),
      // so the crawl NEVER follows a redirect to another host carrying the live cookie
      // (SSRF to localhost / 169.254.169.254 / LAN). We only ever read same-origin 2xx.
      let r; try { r = await fetch(u, { credentials: "include", redirect: "manual" }); } catch { return; }
      if (!r.ok || r.type === "opaqueredirect") return;
      const ct = (r.headers.get("content-type") || "").toLowerCase();
      if (!ct.includes("text/html") && !ct.includes("xhtml")) {
        // A "page" link that resolves to a document (extension-less download) IS a file.
        // Classify on the MIME essence, ANCHORED — a substring "xml" would wrongly drop
        // docx/xlsx/pptx (their MIME is "…openxmlformats…"); json/js/xml/rss/plain/css excluded.
        const essence = ct.split(";")[0].trim();
        if (/^(application|text)\//.test(essence)
            && !/^text\/(css|plain|javascript|xml)$/.test(essence)
            && !/^application\/(x-)?(javascript|ecmascript|json|xml)$/.test(essence)
            && !/\+xml$/.test(essence)) {
          addFile((r.url && r.url.startsWith(origin + "/")) ? r.url : u);
        }
        return;
      }
      pagesFetched++;
      let html; try { html = await r.text(); } catch { return; }
      for (const p of parse(html, r.url || u)) if (!visited.has(p)) nextFrontier.push(p);
    });
    frontier = nextFrontier;
  }
  return { lms: "generic", files, pages: pagesFetched };
}

// Dispatch to the right adapter. Throws → caller treats as a retryable enum error.
async function enumerateSW(lms, origin, tokens = {}) {
  if (lms === "canvas")  return enumCanvasSW(origin);
  if (lms === "d2l")     return enumD2LSW(origin, tokens.xsrf);
  if (lms === "moodle")  return enumMoodleSW(origin, tokens.sesskey);
  if (lms === "generic") return enumGenericSW(origin, tokens.startUrl);   // server-rendered / unknown LMS
  return { lms: null, files: [] };
}

// Human-readable summary of a runFullSync result (shown by the popup's Sync button).
function summarizeSync(r) {
  if (!r) return "Sync failed.";
  switch (r.reason) {
    case "no-content-script": return "Couldn't reach the page — reload the LMS tab, then Sync.";
    case "no-lms":            return "This tab doesn't look like a course site. Open your LMS course area and try again.";
    case "enum-error":        return `Couldn't read your courses${r.detail ? ` (${String(r.detail).slice(0, 60)})` : ""}. Are you logged into the LMS?`;
    case "signed-out":        return "Sign into the extension first.";
    case "autocapture-off":   return "Auto-capture is turned off (see the toggle below).";
    case "already-running":   return "A sync is already running…";
    case "throttled":         return "Already synced recently — files are up to date.";
    case "done": {
      const label = r.lms === "generic" ? "This site" : r.lms;
      if (r.total === 0) return `${label}: no files found on the pages I could reach.`;
      const parts = [];
      if (r.imported > 0) parts.push(`imported ${r.imported}`);
      if (r.skipped > 0)  parts.push(`${r.skipped} already`);
      if (r.failed > 0)   parts.push(`${r.failed} failed`);
      let m = parts.join(", ") || "done";
      // On ANY failure, show the RAW response of a FAILING file so the real cause
      // is visible (login page? locked? redirect to a library system?).
      if (r.failed > 0 && r.diag) {
        m += r.diag.error
          ? ` — [fetch threw: ${r.diag.error}]`
          : ` — [HTTP ${r.diag.status}${r.diag.redirected ? " →redirected" : ""}, ${r.diag.ctype || "?"}; ${r.diag.finalUrl || ""}; body: ${r.diag.snippet || ""}]`;
      } else if (r.failed > 0 && r.lastError) {
        m += ` — ${String(r.lastError).slice(0, 80)}`;
      }
      return m;
    }
    default: return "Sync started.";
  }
}

async function runFullSync(tabId, host, { force = false } = {}) {
  // Atomic re-entry guard: claim the host SYNCHRONOUSLY before any await, so two
  // near-simultaneous triggers (two tabs, or consent racing an onUpdated) can't
  // both pass a check-then-act gate and double-enumerate the whole library.
  if (!host || fullSyncHosts.has(host)) return { ok: false, reason: "already-running" };
  fullSyncHosts.add(host);
  let started = false;
  try {
    const auth = await getAuth();
    if (!auth) return { ok: false, reason: "signed-out" };
    if (await siteMode(host) !== "on") return { ok: false, reason: "no-consent" };
    if (!(await getSettings()).autoCapture) return { ok: false, reason: "autocapture-off" };
    if (!force) {
      const times = await getSyncTimes();
      if (times[host] && Date.now() - times[host] < FULL_SYNC_TTL_MS) return { ok: true, reason: "throttled" };
      const eAt = syncErrorAt.get(host);
      if (eAt && Date.now() - eAt < SYNC_ERROR_COOLDOWN_MS) return { ok: false, reason: "cooldown" };
    }

    started = true;
    fullSyncActive = true;
    keepaliveStart();   // survive the popup closing / tab switch for the WHOLE sync
    writeLiveState();

    // Ask the top frame ONLY for what the SW can't read itself: which LMS this is,
    // plus D2L's XSRF token / Moodle's sesskey (page-scoped). Canvas needs neither.
    const ctx = await new Promise((resolve) => {
      chrome.tabs.sendMessage(tabId, { type: "GET_LMS_CONTEXT" }, { frameId: 0 },
        (r) => resolve(chrome.runtime.lastError ? null : r));
    });
    if (!ctx) return { ok: false, reason: "no-content-script" };
    if (!ctx.lms) return { ok: false, reason: "no-lms" };

    // Enumerate + download entirely in the SW (credentials:"include" → cookies
    // sent + CORS bypassed, so the inst-fs CDN redirect is readable).
    const origin = "https://" + host;
    let res;
    try {
      res = await enumerateSW(ctx.lms, origin, { xsrf: ctx.xsrf, sesskey: ctx.sesskey, startUrl: ctx.url });
    } catch (e) {
      syncErrorAt.set(host, Date.now());
      return { ok: false, reason: "enum-error", lms: ctx.lms, detail: String((e && e.message) || e) };
    }
    if (res && res.error) { syncErrorAt.set(host, Date.now()); return { ok: false, reason: "enum-error", lms: ctx.lms, detail: res.detail }; }
    if (!res || !res.lms) return { ok: false, reason: "no-lms" };
    syncErrorAt.delete(host);

    // Course/assignment/grade sync (currently D2L only — see enumD2LSW). Runs BEFORE
    // files so the courses table already has a row by the time file ingest tries to
    // link a course_id (same lookup api/lms-ingest.ts already does for Canvas).
    if (Array.isArray(res.courses) && res.courses.length) {
      try {
        const cr = await fetch(`${API_BASE}/api/lms-ingest?action=courses`, {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ userId: auth.userId, courses: res.courses, assignments: res.assignments ?? [] }),
        });
        const crBody = await cr.text();
        if (!cr.ok) console.error(`[FschoolAI] course/assignment sync HTTP ${cr.status}:`, crBody.slice(0, 300));
        else console.log("[FschoolAI] course/assignment sync ok:", crBody.slice(0, 200));
      } catch (e) { console.error("[FschoolAI] course/assignment sync failed (network):", e.message); }
    } else {
      console.warn("[FschoolAI] no res.courses to sync — enumD2LSW returned", Array.isArray(res.courses) ? "an empty array" : typeof res.courses);
    }

    const files = Array.isArray(res.files) ? res.files : [];
    let imported = 0, skipped = 0, failed = 0, blocked = 0, lastError = null, firstFailUrl = null;
    // 12 concurrent downloads (was 6) — most files are either a near-instant size
    // reject or a real extraction+embedding call, so doubling throughput here is
    // the single biggest lever on total sync wall-clock time.
    await runPool(files, 12, async (f) => {
      if (!f || !f.url) return;
      // isPrivateTarget blocks internal hosts; isAllowedSyncFileUrl blocks
      // third-party URLs (credentialed-fetch SSRF / RAG poison).
      if (isPrivateTarget(f.url) || !isAllowedSyncFileUrl(f.url, host)) { blocked++; return; }
      const key = canonicalizeUrl(f.url);
      if (inFlight.has(key)) { skipped++; return; }   // always: concurrent-download dedup
      // A forced/manual sync bypasses the per-browser capture history + failure
      // backoff so it actually RE-imports under the current account (recovers from
      // "35 already" after an account switch). The server still dedups per user.
      if (!force) {
        if ((await getCaptured()).includes(key)) { skipped++; return; }   // already imported (this browser)
        if (await isBlockedByFailures(key)) { skipped++; return; }        // 3-strike backoff
      }
      inFlight.add(key);
      try {
        // Download in the SW (credentials:"include" → session cookie authorizes the
        // download and follows the 302 to the CDN, which the SW can read).
        const r = await importFile({ url: f.url, fetchUrl: f.url, filename: f.filename, courseId: f.courseId ?? null, platform: res.lms, allowedHost: host });
        if (r?.ok) { if (r.skipped) skipped++; else imported++; }
        else { failed++; lastError = r?.error || lastError; if (!firstFailUrl) firstFailUrl = f.url; if (!r?.transient) await recordFailure(key); }
      } finally {
        inFlight.delete(key);
      }
    });
    if (blocked > 0) console.warn(`[FschoolAI] full-sync skipped ${blocked} off-domain file URL(s) on ${host}`);
    if (imported > 0) bumpStat("autoImported", imported);
    // Throttle only when something actually worked (or there was nothing to do).
    // A non-empty enumeration that imported/skipped NOTHING (every file failed)
    // smells transient — ingest down, expired session — so leave the host
    // un-throttled and a refresh retries. Per-file 3-strike backoff still bounds it.
    if (files.length === 0 || imported > 0 || skipped > 0) await markSynced(host);
    console.log(`[FschoolAI] full-sync ${res.lms} on ${host}: ${files.length} files → ${imported} imported, ${skipped} skipped, ${failed} failed, ${blocked} blocked${lastError ? ` (last error: ${lastError})` : ""}`);
    // Any failures → capture the RAW response of a FAILING file (status / redirect
    // target / content-type / body snippet), so we can see exactly what the LMS
    // returns for the files that don't work — not the ones that do.
    let diag = null;
    if (failed > 0) { try { diag = await diagnoseFetch(firstFailUrl || files[0].url); } catch {} }
    return { ok: true, reason: "done", lms: res.lms, total: files.length, imported, skipped, failed, blocked, lastError, diag, sampleUrl: firstFailUrl };
  } finally {
    fullSyncHosts.delete(host);
    // Only touch the live flag if we actually started work — gate-bail
    // navigations (throttled revisits) must not churn storage.
    if (started) {
      fullSyncActive = fullSyncHosts.size > 0;
      keepaliveStop();   // release the worker once no sync/queue needs it
      writeLiveState();
    }
  }
}

// ── Message handlers ───────────────────────────────────────────────────────

// (No onMessageExternal handler: web pages must never be able to set this
// extension's identity. The popup's GoTrue login is the only session entry.)

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "IMPORT_FILE") {
    importFile(msg.payload).then(sendResponse);
    return true;
  }

  if (msg.type === "IMPORT_CLOUD_FILE") {
    const { href, filename, pageUrl, platform } = msg.payload;
    (async () => {
      const auth = await getAuth();
      if (!auth) return { error: "Not signed in. Open the extension popup to sign in." };
      try {
        const { bytes, mimeType } = await fetchCloudFile(href);
        return await importFile({ url: href, filename, pageUrl, courseId: null, bytes, mimeType, platform });
      } catch (e) {
        return { error: e.message ?? "Cloud fetch failed" };
      }
    })().then(sendResponse);
    return true;
  }

  if (msg.type === "AUTO_IMPORT") {
    autoImportBatch(msg.payload ?? {}).then(sendResponse);
    return true;
  }

  if (msg.type === "GET_AUTH_STATUS") {
    getAuth().then(auth => sendResponse({ signedIn: !!auth, userId: auth?.userId ?? null }));
    return true;
  }

  // Live activity snapshot for the popup — one round-trip for live state + the
  // current settings + all-time stats. Reading it also wakes the SW, so a stale
  // "scanning" mirror from a previously-killed worker self-heals (queueDepth is 0
  // on a fresh worker → scanning:false).
  if (msg.type === "GET_STATUS") {
    (async () => {
      const settings = await getSettings();
      const { stats = {} } = await new Promise(r => chrome.storage.local.get(["stats"], r));
      return { ...buildLiveState(), settings, stats };
    })().then(sendResponse);
    return true;
  }

  if (msg.type === "GET_SETTINGS") {
    (async () => {
      const settings = await getSettings();
      const captured = await getCaptured();
      const { stats = {} } = await new Promise(r => chrome.storage.local.get(["stats"], r));
      return { settings, capturedCount: captured.length, stats };
    })().then(sendResponse);
    return true;
  }

  if (msg.type === "SET_SETTINGS") {
    (async () => {
      const current = await getSettings();
      const settings = { ...current, ...(msg.payload ?? {}) };
      await new Promise(r => chrome.storage.local.set({ settings }, r));
      return { ok: true, settings };
    })().then(sendResponse);
    return true;
  }

  // Content script on a supported LMS asks us to sync this tab's whole library
  // (e.g. it's already consented but no tab-load fired, or the user just signed
  // in). Host is taken from the trusted sender tab; runFullSync re-checks consent
  // + throttle, so this is safe and idempotent.
  if (msg.type === "FULL_SYNC_NUDGE") {
    const tabId = sender.tab?.id;
    let host = "";
    try { host = new URL(sender.tab?.url || "").hostname; } catch { /* no tab url */ }
    if (tabId && host) runFullSync(tabId, host);
    sendResponse({ ok: true });
    return false;
  }

  // Manual "Sync my courses now" from the popup. Clicking it in the extension UI
  // IS explicit consent for the active tab's host, so we set consent on and force
  // past the 6h throttle. Gives the user a reliable retry when a sync failed.
  if (msg.type === "FORCE_SYNC") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs && tabs[0];
      let host = "";
      try { host = new URL(tab?.url || "").hostname; } catch { /* no url */ }
      if (!tab?.id || !host) { sendResponse({ ok: false, error: "Open your LMS in this tab, then click Sync." }); return; }
      chrome.storage.local.get(["autoSites"], ({ autoSites = {} }) => {
        autoSites[host] = "on";
        consentedHosts.add(host);
        const keys = Object.keys(autoSites);
        if (keys.length > 200) delete autoSites[keys[0]];
        chrome.storage.local.set({ autoSites }, async () => {
          // Clear the activity feed so the user sees ONLY this run's results,
          // not stale entries from earlier extension versions.
          recentActivity.length = 0; writeLiveState();
          const r = await runFullSync(tab.id, host, { force: true });
          const message = summarizeSync(r);
          // Persist the result so it's shown even if the popup was closed during
          // the sync (the whole point — it runs in the background).
          chrome.storage.local.set({ lastSyncMsg: { text: message, at: Date.now() } });
          sendResponse({ ok: !!r?.ok, host, message });
        });
      });
    });
    return true;
  }

  if (msg.type === "GET_SITE_MODE") {
    chrome.storage.local.get(["autoSites"], ({ autoSites = {} }) => {
      const mode = autoSites[msg.payload?.host];
      sendResponse({ mode: mode === "on" || mode === "off" ? mode : "unknown" });
    });
    return true;
  }

  if (msg.type === "SET_SITE_MODE") {
    chrome.storage.local.get(["autoSites"], ({ autoSites = {} }) => {
      const host = String(msg.payload?.host ?? "");
      const mode = msg.payload?.mode === "on" ? "on" : "off";
      if (host) autoSites[host] = mode;
      if (host) { if (mode === "on") consentedHosts.add(host); else consentedHosts.delete(host); }
      // Bound the map.
      const keys = Object.keys(autoSites);
      if (keys.length > 200) delete autoSites[keys[0]];
      chrome.storage.local.set({ autoSites }, () => {
        sendResponse({ ok: true });
        // Consent just granted → immediately pull the whole course library via
        // the LMS API (force past the throttle: this is the user's first opt-in).
        if (mode === "on" && sender.tab?.id) runFullSync(sender.tab.id, host, { force: true });
      });
    });
    return true;
  }

  if (msg.type === "CLEAR_PENDING") {
    chrome.storage.local.set({ pendingDownloads: [] }, () => {
      chrome.action.setBadgeText({ text: "" });
      sendResponse({ ok: true });
    });
    return true;
  }

  if (msg.type === "SIGN_IN") {
    const { userId, token, expiresAt } = msg.payload;
    setAuth(userId, token, expiresAt).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (msg.type === "SIGN_OUT") {
    // Reset the live counters/feed so the next user doesn't inherit this session's numbers.
    sessionImported = 0; activeFile = null; recentActivity.length = 0;
    // Clear the per-browser capture memory too: capturedUrls / failedUrls / syncTimes
    // are keyed by URL, NOT by account. Leaving them means a DIFFERENT user who
    // signs in next gets every file skipped as "already captured" even though it
    // was only ever indexed under the previous account (the "35 already" bug).
    chrome.storage.local.remove(
      ["userId", "token", "expiresAt", "capturedUrls", "failedUrls", "syncTimes"],
      () => { writeLiveState(true); sendResponse({ ok: true }); });
    return true;
  }
});

// ── Download capture ─────────────────────────────────────────────────────────
// Completed downloads from academic sites are queued in the popup ("Captured
// downloads"), or imported silently when autoImportDownloads is on.

const ACADEMIC_PATTERNS = [
  /(^|\.)edu(\.[a-z]{2})?$/,     // *.edu / *.edu.au — anchored ("seduction.com" must not match)
  /\.ac\.[a-z]{2}$/, /chaoxing\.com$/, /zhihuishu\.com$/,
  /pronote\.net$/, /brightspace\.com$/, /blackboard\.com$/,
  /instructure\.com$/, /desire2learn\.com$/, /moodle/,
  /sharepoint\.com$/, /teams\.microsoft\.com$/,
];

const DOC_EXT_RE = /\.(pdf|docx?|pptx?|xlsx?|txt|csv)(\?|#|$)/i;

function isAcademic(url) {
  try {
    const { hostname } = new URL(url);
    return ACADEMIC_PATTERNS.some(p => p.test(hostname));
  } catch { return false; }
}

chrome.downloads.onChanged.addListener(async (delta) => {
  if (!delta.state || delta.state.current !== "complete") return;

  const [item] = await new Promise(resolve => chrome.downloads.search({ id: delta.id }, resolve));
  if (!item) return;

  // referrer is "" (not null) when absent — `??` would never fall back to the URL.
  const refUrl = item.referrer || item.url;
  if (!isAcademic(refUrl)) return;

  const netUrl = item.finalUrl ?? item.url;           // the network URL (never file://)
  const name   = (item.filename ?? "").split(/[/\\]/).pop() || "file";

  const settings = await getSettings();
  const auth     = await getAuth();

  // Opt-in silent auto-import — document types only.
  if (settings.autoImportDownloads && auth && DOC_EXT_RE.test(netUrl + name)) {
    const r = await importFile({ url: netUrl, fetchUrl: netUrl, filename: name, platform: "download" });
    if (r?.ok) { bumpStat("autoImported", 1); return; }
    // fall through to the pending list so the user can retry manually
  }

  chrome.storage.local.get(["pendingDownloads"], ({ pendingDownloads = [] }) => {
    const updated = [
      { id: delta.id, filename: name, url: netUrl, referrer: item.referrer, timestamp: Date.now() },
      ...pendingDownloads.filter(d => d.url !== netUrl).slice(0, 9),
    ];
    chrome.storage.local.set({ pendingDownloads: updated });
    chrome.action.setBadgeText({ text: String(updated.length) });
    chrome.action.setBadgeBackgroundColor({ color: "#4285F4" });
  });
});

// Subsequent visits to an already-consented LMS: re-run the full API sync on
// page load (self-gates on consent "on" + the 6h throttle inside runFullSync).
// Cheap when it no-ops — a couple of storage reads, no executeScript unless due.
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete" || !tab.url) return;
  let host;
  try {
    const u = new URL(tab.url);
    if (!/^https?:$/.test(u.protocol)) return;
    host = u.hostname;
  } catch { return; }
  // Cheap synchronous gate: only ever touch consented hosts. Non-LMS browsing
  // (news, email, shopping) never wakes the sync path. runFullSync re-checks
  // consent authoritatively from storage.
  if (!consentedHosts.has(host)) return;
  runFullSync(tabId, host);
});

// Keep the consented-host cache correct if autoSites is written anywhere.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.autoSites) refreshConsentedHosts();
});

// On SW (re)start nothing is running yet. Restore the running counter + recent
// feed from the last snapshot (so an open popup's counter doesn't jump backward
// when MV3 recycles the worker), then publish a clean snapshot — queueDepth is 0
// on a fresh worker, so this also forces scanning:false, healing any stale
// "scanning" state a killed worker left behind. Counters are only restored while
// signed in; a signed-out start clears them.
(async () => {
  const auth = await getAuth();
  const { liveState } = await new Promise((r) => chrome.storage.local.get(["liveState"], r));
  if (auth && liveState && typeof liveState === "object") {
    sessionImported = Number(liveState.sessionImported) || 0;
    if (Array.isArray(liveState.recent)) {
      recentActivity.length = 0;
      recentActivity.push(...liveState.recent.slice(0, RECENT_MAX));
    }
  }
  writeLiveState(true);
  await refreshConsentedHosts();   // repopulate the consented-host cache after an SW (re)start
})();

// api/canvas-files.ts — server-side Canvas course-file ingestion.
//
// WHY THIS EXISTS
// Canvas was the only major LMS with no server-side byte path. `src/api/canvasSync.ts`
// fetches file METADATA (including download URLs) but parks it in the `canvas_data`
// JSON blob — it never lands in `files`, and nothing ever downloads the bytes. The
// Chrome extension was the *only* thing that ever read a Canvas file's contents
// (extension/background.js, via /api/lms-ingest). So a student who connects Canvas in
// the web app gets courses and deadlines, but the tutor cannot read a word of their
// actual course material — retrieval has nothing to retrieve.
//
// This closes the loop entirely server-side: list files per course with the student's
// stored token, download the bytes with that same token, hand them to ingestLmsFile()
// — which already does storage → extract → OCR fallback → chunk → embed → files link.
// Google Drive, Microsoft and generic-LMS already call it the same way.
//
// BATCHING
// One file can take minutes (scanned-PDF OCR then embedding), and ingestLmsFile awaits
// its embed loop deliberately — Vercel freezes the lambda after the response, so a
// fire-and-forget embed silently never finishes. Each invocation therefore processes at
// most `limit` files and reports `remaining`; callers loop until it reaches 0. Keep
// `limit` low enough that limit × slowest-file stays under maxDuration.
//
// HTTP surface:
//   POST /api/canvas-files?action=sync   { courseId?, limit? }  → ingest a batch
//   POST /api/canvas-files?action=status                        → counts, no work done
//
// userId always comes from the verified JWT — a student can only ingest their own files.

import { createClient } from "@supabase/supabase-js";
import { canvasCreds, canvasGET, type CanvasCreds } from "./_reggie/canvasLive.js";
import { ingestLmsFile } from "./lms-ingest.js";
import { requireUserOr401 } from "./_auth.js";

export const config = { maxDuration: 300 };

// Types the extract pipeline can actually read. Images/video/zip are skipped rather
// than burned through OCR — video belongs in api/transcribe.ts, not here.
const INGESTIBLE      = /\.(pdf|docx?|pptx?|txt|md|rtf|odt|odp)$/i;
// Fallback verdict for module items whose title carries no file extension.
const INGESTIBLE_MIME = /(pdf|msword|wordprocessing|presentation|powerpoint|opendocument|text\/plain|markdown|rtf)/i;
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const DEFAULT_LIMIT  = 5;
const MAX_LIMIT      = 15;
const DOWNLOAD_TIMEOUT_MS = 60_000;   // large PDFs over a slow Canvas need more than canvasGET's 12s

let _sb: any = null;
function sb() {
  if (_sb) return _sb;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase env vars not configured");
  _sb = createClient(url, key, { auth: { persistSession: false } });
  return _sb;
}

/** Stable per-file dedup key. Canvas file ids are stable across syncs; the `url`
 *  field is NOT (it carries a rotating `verifier` token), so never key on the URL. */
const fileKey = (canvasFileId: any) => `canvas_${canvasFileId}`;

/** Download one Canvas file's bytes with the student's token. */
async function canvasFileBytes(creds: CanvasCreds, url: string): Promise<{ bytes: Buffer; contentType: string }> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), DOWNLOAD_TIMEOUT_MS);
  let r: Response;
  try {
    r = await fetch(url, {
      headers:  { Authorization: `Bearer ${creds.token}` },
      redirect: "follow",
      signal:   ac.signal,
    });
  } catch (e: any) {
    if (e?.name === "AbortError") throw new Error("Canvas download timed out");
    throw e;
  } finally {
    clearTimeout(timer);
  }
  if (!r.ok) {
    if (r.status === 401) throw new Error("Canvas rejected the stored token — reconnect Canvas in the app.");
    throw new Error(`Canvas download failed (${r.status})`);
  }

  // Reject oversized files before buffering them into memory when Canvas tells us the size.
  const declared = Number(r.headers.get("content-length") ?? 0);
  if (declared > MAX_FILE_BYTES) throw new Error(`File too large (${Math.round(declared / 1e6)}MB, max 50MB)`);

  const bytes = Buffer.from(await r.arrayBuffer());
  if (bytes.length > MAX_FILE_BYTES) throw new Error("File too large (max 50MB)");
  if (!bytes.length) throw new Error("Canvas returned an empty file");

  const contentType = r.headers.get("content-type")?.split(";")[0].trim() || "application/octet-stream";

  // An expired/invalid token makes Canvas serve a login page with HTTP 200. Ingesting
  // that would index a login form as course material — same guard as api/lms-proxy.ts.
  const head = bytes.subarray(0, 256).toString("utf8").trimStart().toLowerCase();
  if (contentType.includes("text/html") || head.startsWith("<!doctype") || head.startsWith("<html")) {
    throw new Error("Canvas returned an HTML/login page instead of the file — the token may have expired");
  }
  return { bytes, contentType };
}

interface Candidate {
  canvasFileId: string;
  courseId:     string;
  name:         string;
  downloadUrl?: string;   // present when found via the Files tab — ready to fetch
  fileApiPath?: string;   // present when found via Modules — resolve lazily for the URL
}

/** Every ingestible file across the student's active courses (or one course).
 *
 *  Two discovery paths, because the obvious one usually fails: most instructors
 *  DISABLE the course Files tab (every UofT course tested returns 403), and put the
 *  same PDFs in Modules instead. Modules is therefore the path that actually works,
 *  and Files is the bonus when it happens to be open. */
async function listCandidates(creds: CanvasCreds, courseId?: string | null): Promise<Candidate[]> {
  const courses = courseId
    ? [{ id: courseId }]
    : ((await canvasGET(creds, "/courses", { enrollment_state: "active", per_page: 50 })) ?? []);

  const out: Candidate[] = [];
  const seen = new Set<string>();

  for (const c of courses) {
    // ── 1. Files tab — authoritative when available, 403 when the instructor disabled it
    try {
      const listed = (await canvasGET(creds, `/courses/${c.id}/files`, { per_page: 100 })) ?? [];
      for (const f of listed) {
        const name = f?.display_name || f?.filename || "";
        const key  = String(f?.id ?? "");
        if (!name || !key || !f?.url || seen.has(key)) continue;
        if (!INGESTIBLE.test(name)) continue;
        seen.add(key);
        out.push({ canvasFileId: key, courseId: String(c.id), name, downloadUrl: f.url });
      }
    } catch { /* Files tab disabled — Modules below usually exposes the same files */ }

    // ── 2. Modules — where course material actually lives at most schools
    try {
      const mods = (await canvasGET(creds, `/courses/${c.id}/modules`, { "include[]": "items", per_page: 50 })) ?? [];
      for (const m of mods) {
        for (const it of m?.items ?? []) {
          if (it?.type !== "File" || !it?.content_id) continue;
          const key = String(it.content_id);
          if (seen.has(key)) continue;
          const title = String(it.title ?? "");
          // Module item titles are usually filenames but can be friendly ("Day 1 Slides").
          // Reject only titles with an extension we know we can't read; keep extension-less
          // ones and let the resolved content-type decide at download time.
          if (/\.[a-z0-9]{2,5}$/i.test(title) && !INGESTIBLE.test(title)) continue;
          seen.add(key);
          out.push({
            canvasFileId: key,
            courseId:     String(c.id),
            name:         title || `canvas-file-${key}`,
            fileApiPath:  `/courses/${c.id}/files/${key}`,
          });
        }
      }
    } catch { /* Modules disabled too — nothing discoverable for this course */ }
  }
  return out;
}

/** Turn a candidate into a fetchable download URL. Module-discovered files carry only
 *  an API path, so we resolve the file object here rather than for every candidate —
 *  a 50-file course would otherwise cost 50 extra Canvas calls just to report status. */
async function resolveDownload(creds: CanvasCreds, cand: Candidate) {
  if (cand.downloadUrl) return { url: cand.downloadUrl, name: cand.name, contentType: null as string | null, size: 0 };
  const f = await canvasGET(creds, cand.fileApiPath!);
  if (!f?.url) throw new Error("Canvas file has no download URL (deleted or locked)");
  return {
    url:         f.url as string,
    name:        (f["display_name"] || f["filename"] || cand.name) as string,
    contentType: (f["content-type"] || f["content_type"] || null) as string | null,
    size:        Number(f.size ?? 0),
  };
}

// Statuses that mean "don't try this file again" — a locked/release-gated or
// unsupported file will fail identically on every run, so we record it once and skip
// it thereafter. Without this, terminally-failing files sort to the front of `pending`
// every batch and starve the files that would actually index.
const TERMINAL_STATUSES = ["indexed", "unavailable", "unsupported"];

/** lms_file_id values we should NOT re-download: already indexed, or terminally skipped. */
async function resolvedSet(userId: string): Promise<Set<string>> {
  try {
    const { data } = await sb()
      .from("files")
      .select("lms_file_id, document_id, status")
      .eq("user_id", userId);
    const s = new Set<string>();
    for (const r of data ?? []) {
      if (r.document_id != null || TERMINAL_STATUSES.includes(String(r.status))) s.add(String(r.lms_file_id));
    }
    return s;
  } catch {
    return new Set();   // files table may predate a column — degrade to re-checking in ingestLmsFile
  }
}

/** Record a file we won't retry (locked, unsupported, too large) so future runs skip it. */
async function markSkipped(userId: string, cand: Candidate, name: string, status: string) {
  try {
    await sb().from("files").upsert(
      { user_id: userId, lms_file_id: fileKey(cand.canvasFileId), name, provider: "canvas", status },
      { onConflict: "user_id,lms_file_id" },
    );
  } catch { /* non-fatal — worst case we retry it next run */ }
}

async function sync(userId: string, courseId: string | null, limit: number) {
  const creds      = await canvasCreds(userId);
  const candidates = await listCandidates(creds, courseId);
  const resolved   = await resolvedSet(userId);

  const pending = candidates.filter((f) => !resolved.has(fileKey(f.canvasFileId)));
  const batch   = pending.slice(0, limit);

  const results: any[] = [];
  for (const f of batch) {
    try {
      let meta;
      try {
        meta = await resolveDownload(creds, f);
      } catch (e: any) {
        // Locked / release-gated / deleted → no download URL. Terminal: record and move on.
        await markSkipped(userId, f, f.name, "unavailable");
        results.push({ name: f.name, ok: false, skipped: true, error: e?.message ?? "unavailable" });
        continue;
      }

      // Extension-less module titles get their verdict here, from the real content type.
      if (!INGESTIBLE.test(meta.name) && !(meta.contentType && INGESTIBLE_MIME.test(meta.contentType))) {
        await markSkipped(userId, f, meta.name, "unsupported");
        results.push({ name: meta.name, ok: false, skipped: true, error: `unsupported type (${meta.contentType ?? "unknown"})` });
        continue;
      }
      if (meta.size && meta.size > MAX_FILE_BYTES) {
        await markSkipped(userId, f, meta.name, "unsupported");
        results.push({ name: meta.name, ok: false, skipped: true, error: `too large (${Math.round(meta.size / 1e6)}MB)` });
        continue;
      }

      const { bytes, contentType } = await canvasFileBytes(creds, meta.url);
      const r = await ingestLmsFile({
        userId,
        courseId: f.courseId,          // native Canvas id — ingestLmsFile maps it to the app course
        file: {
          name:      meta.name,
          mimeType:  meta.contentType || contentType,
          bytes,
          sourceUrl: meta.url,
          provider:  "canvas",
          lmsFileId: fileKey(f.canvasFileId),
          metadata:  { platform: "canvas", courseId: f.courseId, originalFilename: meta.name },
        },
      });
      results.push(
        r.status === 200
          ? { name: f.name, ok: true, skipped: !!r.json?.skipped, documentId: r.json?.documentId ?? null }
          : { name: f.name, ok: false, error: r.json?.error ?? `ingest failed (${r.status})` },
      );
    } catch (e: any) {
      // One bad file must never abort the batch — a restricted or corrupt file is
      // normal, and the next invocation will move past it.
      results.push({ name: f.name, ok: false, error: e?.message ?? "download failed" });
    }
  }

  const indexedCount = results.filter((r) => r.ok).length;
  return {
    ok:        true,
    candidates: candidates.length,
    processed: batch.length,
    indexed:   indexedCount,
    failed:    results.length - indexedCount,
    remaining: Math.max(0, pending.length - batch.length),
    results,
  };
}

async function status(userId: string, courseId: string | null) {
  const creds      = await canvasCreds(userId);
  const candidates = await listCandidates(creds, courseId);
  const resolved   = await resolvedSet(userId);
  const pending    = candidates.filter((f) => !resolved.has(fileKey(f.canvasFileId)));
  return { ok: true, candidates: candidates.length, pending: pending.length, resolved: candidates.length - pending.length };
}

export default async function handler(req: any, res: any) {
  res.setHeader?.("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const userId = await requireUserOr401(req, res);
  if (!userId) return;

  const action   = req.query?.action ?? req.body?.action ?? "sync";
  const courseId = req.body?.courseId != null ? String(req.body.courseId) : null;
  const limit    = Math.min(MAX_LIMIT, Math.max(1, parseInt(String(req.body?.limit ?? DEFAULT_LIMIT), 10) || DEFAULT_LIMIT));

  try {
    if (action === "status") return res.status(200).json(await status(userId, courseId));
    if (action === "sync")   return res.status(200).json(await sync(userId, courseId, limit));
    return res.status(400).json({ error: "Unknown action. Use sync or status." });
  } catch (e: any) {
    return res.status(502).json({ error: e?.message ?? "canvas-files failed" });
  }
}

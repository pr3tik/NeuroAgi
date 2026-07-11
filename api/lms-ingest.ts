// api/lms-ingest.ts — Unified LMS file ingestion pipeline.
//
// HTTP surface:
//   POST /api/lms-ingest                → ingest one file (small files inline as base64;
//                                         large files via ?action=sign + storage upload)
//   POST /api/lms-ingest?action=sign    → { userId, name } → signed storage-upload URL
//
// Body (default action): {
//   userId:    string,
//   courseId?: string,
//   file: {
//     name:      string,        // "lecture3.pdf"
//     mimeType:  string,
//     bytes?:    string,        // base64 — ONLY for files ≤ ~2.5MB (Vercel body limit is 4.5MB)
//     storagePath?: string,     // alternative to bytes: path in `bucket` uploaded via ?action=sign
//     bucket?:   string,        // default "course-files"
//     sourceUrl: string,        // original URL — canonicalized + used for dedup
//     provider:  string,        // "google" | "microsoft" | "extension"
//     metadata?: { courseId?, platform?, assignmentId?, originalFilename? }
//   }
// }
// Returns: { ok, documentId, skipped?, storagePath? }
//
// Server-side callers (drive-auth, lms-microsoft, lms-proxy) import ingestLmsFile()
// DIRECTLY — no internal HTTP hop, so Vercel's 4.5MB request-body limit never applies
// to server-fetched files. Browser/extension callers use ?action=sign for big files.
//
// Design: storage-first. Bytes are persisted to the private `course-files` bucket
// (path `<userId>/lms/...`) BEFORE extraction, so (a) extract reads by storagePath —
// a tiny JSON body — regardless of file size, and (b) the original file stays
// available to the student through api/file-url.ts signed links.

import { createClient } from "@supabase/supabase-js";
import { ingest, embedBatch } from "./rag.js";

// OCR + big-document embedding can take a while.
export const config = { maxDuration: 300 };

const DEFAULT_BUCKET   = "course-files";
const MAX_FILE_BYTES   = 100 * 1024 * 1024;  // absolute cap, matches the course-files bucket's 100MB limit
const INLINE_B64_LIMIT = 3_500_000;          // base64 chars ≈ 2.6MB binary; Vercel body cap is ~4.5MB
const OCR_MAX_BYTES    = 10 * 1024 * 1024;  // Claude document-block practical cap (base64 inflation)
const EMBED_MAX_LOOPS  = 12;                 // 12 × 64 chunks ≈ multi-hundred-page doc; rest → backfill

let _sb: any = null;
function sb() {
  if (_sb) return _sb;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase env vars not configured");
  _sb = createClient(url, key);
  return _sb;
}

// Base URL for the internal /api/extract call. MUST be a PUBLIC host: the
// deployment-specific VERCEL_URL is behind Vercel Deployment Protection and
// returns an HTML auth page (so `extractRes.json()` throws "Unexpected token
// '<' …"). Prefer the caller-supplied host (derived from the incoming request's
// public domain, e.g. fschoolai.com) or PUBLIC_BASE_URL; only fall back to
// VERCEL_URL as a last resort.
function selfBaseUrl(explicit?: string | null): string {
  if (explicit) return explicit.replace(/\/+$/, "");
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/+$/, "");
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:5173";
}

// Canonicalize cloud URLs so the SAME file reached via different links (Classroom
// attachment vs share link vs uc?export=download) dedups to one document. Must match
// the form drive-auth's Classroom sync writes (`https://drive.google.com/file/d/<id>`).
export function canonicalizeSourceUrl(raw: string): string {
  const s = String(raw ?? "");
  const drive = s.match(/drive\.google\.com\/(?:file\/d\/|open\?.*?id=|uc\?.*?id=)([\w-]{10,})/);
  if (drive) return `https://drive.google.com/file/d/${drive[1]}`;
  const gdoc = s.match(/docs\.google\.com\/(document|presentation|spreadsheets)\/d\/([\w-]{10,})/);
  if (gdoc) return `https://docs.google.com/${gdoc[1]}/d/${gdoc[2]}`;
  const dropbox = s.match(/dropbox(?:usercontent)?\.com\/(s|scl\/fi)\/([\w-]+[^?#]*)/);
  if (dropbox) return `https://www.dropbox.com/${dropbox[1]}/${dropbox[2]}`.replace(/\/+$/, "");
  return s;
}

// api/extract.ts routes on `file_type` (extension) + `name`, NOT a MIME string.
function deriveFileType(name: string, mimeType: string): string {
  const fromName = name.split(".").pop()?.toLowerCase();
  if (fromName && fromName.length <= 5 && /^[a-z0-9]+$/.test(fromName)) return fromName;
  const sub = mimeType.split("/")[1]?.toLowerCase() ?? "";
  if (sub.includes("pdf")) return "pdf";
  if (sub.includes("wordprocessingml")) return "docx";
  if (sub.includes("presentationml")) return "pptx";
  if (sub.includes("spreadsheetml")) return "xlsx";
  return sub || "txt";
}

function djb2(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function safeName(name: string): string {
  return String(name ?? "file").replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "file";
}

// Claude native PDF OCR — fallback for scanned documents where extract returns no text.
// Model via ANTHROPIC_MODEL_OCR (default Haiku — fast/cheap; sonnet for handwriting).
async function claudePdfOcr(base64: string): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY not set");
  const model = process.env.ANTHROPIC_MODEL_OCR ?? process.env.ANTHROPIC_MODEL_CHEAP ?? "claude-haiku-4-5-20251001";

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method:  "POST",
    headers: {
      "Content-Type":      "application/json",
      "x-api-key":         key,
      "anthropic-version": "2023-06-01",
      "anthropic-beta":    "pdfs-2024-09-25",
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      messages: [{
        role: "user",
        content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } },
          { type: "text", text: "Extract all text from this document verbatim. Preserve structure (headings, paragraphs, lists). Output only the extracted text, no commentary or formatting." },
        ],
      }],
    }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`Claude OCR ${res.status}: ${err.slice(0, 300)}`);
  }
  const data = await res.json();
  return data.content?.[0]?.text ?? "";
}

function sanitize(raw: string): string {
  return raw.replace(/ /g, "").replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
}

// ── Courses + assignments (currently D2L only — see chrome-extension's enumD2LSW) ──
// Mirrors src/api/canvasSync.ts's upsert shape/keys exactly so both LMSs land in the
// same courses/assignments tables the rest of the app already reads from. Runs BEFORE
// file ingest (caller's responsibility) so ingestLmsFile's course_id lookup — which
// already matches on canvas_course_id — finds a row instead of ingesting unlinked.
export async function ingestLmsCourses({ userId, courses, assignments = [] }: {
  userId: string;
  courses: { id: string; name?: string; code?: string; currentScore?: number | null; finalScore?: number | null }[];
  assignments?: { courseId: string; id: string; title?: string; dueAt?: string | null; pointsPossible?: number | null;
    score?: number | null; weight?: number | null; weightAchieved?: number | null; submittedAt?: string | null; missing?: boolean }[];
}): Promise<{ status: number; json: any }> {
  if (!userId || !Array.isArray(courses) || !courses.length)
    return { status: 400, json: { error: "Required: userId, courses[]" } };

  const supabase = sb();
  const now = new Date().toISOString();

  const courseRows = courses.filter((c) => c?.id).map((c) => ({
    user_id:          userId,
    canvas_course_id: String(c.id),
    name:             c.name || c.code || String(c.id),
    course_code:      c.code || null,
    current_score:    c.currentScore ?? null,
    final_score:      c.finalScore ?? null,
    source:           "extension",
    updated_at:       now,
  }));
  const { data: upserted, error: courseErr } = await supabase
    .from("courses")
    .upsert(courseRows, { onConflict: "user_id,canvas_course_id" })
    .select("id, canvas_course_id");
  if (courseErr) return { status: 500, json: { error: `courses upsert: ${courseErr.message}` } };

  const idByCourse: Record<string, string> = {};
  (upserted || []).forEach((c: any) => { idByCourse[String(c.canvas_course_id)] = c.id; });

  if (assignments.length) {
    const assignRows = assignments.filter((a) => a?.id && a?.courseId).map((a) => ({
      user_id:              userId,
      course_id:            idByCourse[String(a.courseId)] ?? null,
      canvas_assignment_id: String(a.id),
      title:                a.title || "Assignment",
      due_at:               a.dueAt || null,
      points_possible:      a.pointsPossible ?? null,
      score:                a.score ?? null,
      weight:               a.weight ?? null,
      weight_achieved:      a.weightAchieved ?? null,
      submitted_at:         a.submittedAt || null,
      missing:              Boolean(a.missing),
      source:               "extension",
      updated_at:           now,
    }));
    if (assignRows.length) {
      const { error: assignErr } = await supabase
        .from("assignments")
        .upsert(assignRows, { onConflict: "user_id,canvas_assignment_id" });
      if (assignErr) return { status: 500, json: { error: `assignments upsert: ${assignErr.message}` } };
    }
  }

  return { status: 200, json: { ok: true, courses: courseRows.length, assignments: assignments.length } };
}

// ── Core (exported — server-side callers import this directly, no HTTP hop) ──
export async function ingestLmsFile({ userId, courseId = null, file, baseUrl = null }: {
  userId: string; courseId?: string | null;
  baseUrl?: string | null;   // public origin for the internal /api/extract call
  file: {
    name: string; mimeType: string; sourceUrl: string; provider: string;
    bytes?: Buffer | string | null; storagePath?: string | null; bucket?: string | null;
    metadata?: any;
  };
}): Promise<{ status: number; json: any }> {
  if (!userId || !file?.name || !file?.sourceUrl || !file?.provider)
    return { status: 400, json: { error: "Required: userId, file.name, file.sourceUrl, file.provider" } };
  if (!file.bytes && !file.storagePath)
    return { status: 400, json: { error: "Required: file.bytes (base64) or file.storagePath" } };

  const supabase  = sb();
  const bucket    = file.bucket || DEFAULT_BUCKET;
  const canonical = canonicalizeSourceUrl(file.sourceUrl);
  const mimeType  = file.mimeType || "application/octet-stream";

  // The extension/LMS sends the platform's NATIVE course id (e.g. Canvas "434720"),
  // but the app's course_id columns are UUIDs referencing our own courses table.
  // Passing a numeric id into a uuid column throws "invalid input syntax for type
  // uuid". Map it to the app course when we can; otherwise ingest UNLINKED (null) —
  // the file is still fully RAG-indexed and findable, just not tied to a course row.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  let courseUuid: string | null = null;
  if (courseId && UUID_RE.test(String(courseId))) {
    courseUuid = String(courseId);
  } else if (courseId) {
    // Best-effort map: the app may have a course row keyed by the LMS's native id.
    for (const col of ["canvas_course_id", "lms_course_id", "external_id"]) {
      try {
        const { data, error } = await supabase.from("courses")
          .select("id").eq("user_id", userId).eq(col, String(courseId)).limit(1).maybeSingle();
        if (!error && data?.id) { courseUuid = data.id; break; }
      } catch { /* column doesn't exist — try the next */ }
    }
    // The matched course row's id must ITSELF be a uuid — some courses tables key
    // rows by the native LMS id (so `id` could be "4552"). Only keep a real uuid.
    if (courseUuid && !UUID_RE.test(String(courseUuid))) courseUuid = null;
    if (!courseUuid) console.warn(`[lms-ingest] courseId "${courseId}" is not an app UUID and no uuid-keyed course row matched — ingesting unlinked`);
  }

  // ── 1. Dedup (canonical AND raw form — older rows stored the raw URL) ────
  try {
    const { data: existing } = await supabase
      .from("files")
      .select("id, document_id")
      .eq("user_id", userId)
      .in("source_url", canonical === file.sourceUrl ? [canonical] : [canonical, file.sourceUrl])
      .not("document_id", "is", null)
      .limit(1)
      .maybeSingle();
    if (existing) return { status: 200, json: { ok: true, documentId: existing.document_id, skipped: true } };
  } catch { /* files table may lack source_url column (migration not run) — skip dedup */ }

  // ── 2. Persist bytes to storage (storage-first; also what file-url signs) ─
  let storagePath = file.storagePath ?? null;
  let buf: Buffer | null = null;
  if (file.bytes) {
    buf = Buffer.isBuffer(file.bytes) ? file.bytes : Buffer.from(String(file.bytes), "base64");
    if (!buf.length) return { status: 400, json: { error: "Empty file" } };
    if (buf.length > MAX_FILE_BYTES) return { status: 413, json: { error: "File too large (max 100 MB)" } };
    if (!storagePath) {
      storagePath = `${userId}/lms/${Date.now()}-${djb2(canonical)}-${safeName(file.name)}`;
      const { error: upErr } = await supabase.storage.from(bucket)
        .upload(storagePath, buf, { contentType: mimeType, upsert: true });
      if (upErr) {
        // Storage down shouldn't kill small-file ingestion — fall back to inline extract.
        console.error("[lms-ingest] storage upload failed (continuing inline):", upErr.message);
        storagePath = null;
      }
    }
  }

  // ── 3. Extract text (by storagePath when available → tiny request body) ──
  const fileType = deriveFileType(file.name, mimeType);
  const extractBody: any = storagePath
    ? { storagePath, bucket, keepFile: true, file_type: fileType, name: file.name }
    : { base64: buf!.toString("base64"), file_type: fileType, name: file.name };
  const extractRes = await fetch(`${selfBaseUrl(baseUrl)}/api/extract`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(extractBody),
  });
  if (!extractRes.ok) {
    const detail = await extractRes.text().catch(() => "");
    console.error("[lms-ingest] extract failed", extractRes.status, detail.slice(0, 200));
    return { status: 502, json: { error: `extract failed (${extractRes.status})` } };
  }
  // Defensive: if extract ever returns HTML (e.g. a deployment-protection auth
  // page from a protected base URL), surface a clear error instead of throwing a
  // raw "Unexpected token '<' …" JSON-parse error to the caller.
  const extractCt = extractRes.headers.get("content-type") || "";
  if (!extractCt.includes("application/json")) {
    const snippet = (await extractRes.text().catch(() => "")).slice(0, 120).replace(/\s+/g, " ");
    console.error("[lms-ingest] extract returned non-JSON", extractRes.status, extractCt, snippet);
    return { status: 502, json: { error: `extract returned non-JSON (protected host?) — ${snippet}` } };
  }
  const { text: rawText } = await extractRes.json();

  // ── 3b. Claude OCR fallback — scanned PDFs return < 40 chars of text ─────
  let text: string;
  if (!rawText?.trim() || rawText.trim().length < 40) {
    if (fileType !== "pdf")
      return { status: 422, json: { error: "No text could be extracted from file" } };
    try {
      if (!buf && storagePath) {
        const { data: blob, error } = await supabase.storage.from(bucket).download(storagePath);
        if (error || !blob) throw new Error(error?.message ?? "storage download failed");
        buf = Buffer.from(await blob.arrayBuffer());
      }
      if (!buf) throw new Error("no bytes available for OCR");
      if (buf.length > OCR_MAX_BYTES) throw new Error("PDF too large for OCR fallback");
      const ocrText = await claudePdfOcr(buf.toString("base64"));
      if (!ocrText?.trim())
        return { status: 422, json: { error: "No text could be extracted from file (OCR found nothing)" } };
      text = sanitize(ocrText);
    } catch (ocrErr: any) {
      console.error("[lms-ingest] Claude OCR failed:", ocrErr.message);
      return { status: 422, json: { error: "No text could be extracted from file" } };
    }
  } else {
    text = sanitize(rawText);
  }

  // ── 4. RAG ingest — direct call, no HTTP hop ──────────────────────────────
  const ragResult = await ingest({
    userId,
    courseId:  courseUuid,
    title:     file.name,
    kind:      "lms",
    sourceUrl: canonical,
    text,
  });
  if (ragResult.status !== 200) {
    const detail = ragResult.json?.error ?? `rag ingest failed (${ragResult.status})`;
    console.error("[lms-ingest] rag ingest failed:", detail);
    return { status: 502, json: { error: detail } };
  }
  const { documentId } = ragResult.json;
  if (!documentId) return { status: 502, json: { error: "RAG ingest returned no documentId" } };

  // ── 5. Embed — AWAITED (Vercel freezes the lambda after the response, so a
  //      fire-and-forget here would silently leave chunks without vectors and
  //      hybrid search would degrade to keyword-only). Bounded; rag.ts's
  //      ?action=backfill can finish any remainder for very large docs.
  try {
    for (let i = 0; i < EMBED_MAX_LOOPS; i++) {
      // 128 = embedBatch's clamp ceiling — halves the OpenAI round trips per
      // document vs the default 64, which is most of a large file's wall time.
      const r = await embedBatch({ userId, documentId, batchSize: 128 });
      if (r.status !== 200 || r.json?.done) break;
    }
  } catch (e: any) {
    console.error("[lms-ingest] embed failed (non-fatal, backfill will retry):", e.message);
  }

  // ── 6. Record in files table (upsert — safe on re-ingest) ────────────────
  const fileRow: Record<string, any> = {
    user_id:      userId,
    course_id:    courseUuid,
    lms_file_id:  `ing_${djb2(canonical)}`,
    name:         file.metadata?.originalFilename ?? file.name,
    file_type:    fileType,
    source_url:   canonical,
    provider:     file.provider,
    document_id:  documentId,
    storage_path: storagePath,
    status:       "indexed",
  };
  const { error: upsertErr } = await supabase
    .from("files")
    .upsert(fileRow, { onConflict: "user_id,lms_file_id" });
  if (upsertErr) {
    // Older schemas may lack columns (storage_path/provider) — retry minimal shape.
    const { error: retryErr } = await supabase.from("files").insert({
      user_id: userId, course_id: courseUuid,
      name: fileRow.name, source_url: canonical, document_id: documentId,
    });
    if (retryErr) console.error("[lms-ingest] files upsert error (non-fatal):", upsertErr.message);
  }

  return { status: 200, json: { ok: true, documentId, storagePath } };
}

// ── HTTP handler ──────────────────────────────────────────────────────────────
export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // ── courses: course/assignment/grade sync (D2L today — see enumD2LSW) ────
  if (req.query?.action === "courses") {
    try {
      const { userId, courses, assignments } = req.body ?? {};
      console.log(`[lms-ingest] courses action: userId=${userId} courses=${courses?.length ?? 0} assignments=${assignments?.length ?? 0}`);
      const result = await ingestLmsCourses({ userId, courses, assignments });
      if (result.status !== 200) console.error("[lms-ingest] courses action failed:", result.json?.error);
      else console.log(`[lms-ingest] courses action ok: upserted ${result.json.courses} course(s), ${result.json.assignments} assignment(s)`);
      return res.status(result.status).json(result.json);
    } catch (e: any) {
      console.error("[lms-ingest] courses action error:", e.message);
      return res.status(500).json({ error: e.message ?? "courses ingest failed" });
    }
  }

  // ── sign: signed upload URL for files too big for an inline JSON body ────
  if (req.query?.action === "sign") {
    const { userId, name } = req.body ?? {};
    if (!userId || !name) return res.status(400).json({ error: "userId and name required" });
    // Path-traversal guard: userId becomes a storage path segment.
    if (!/^[\w-]{1,64}$/.test(String(userId))) return res.status(400).json({ error: "invalid userId" });
    try {
      const path = `${userId}/lms/${Date.now()}-${safeName(name)}`;
      const { data, error } = await sb().storage.from(DEFAULT_BUCKET).createSignedUploadUrl(path);
      if (error || !data) return res.status(502).json({ error: error?.message ?? "could not sign upload" });
      return res.status(200).json({ path: data.path ?? path, token: data.token, signedUrl: data.signedUrl, bucket: DEFAULT_BUCKET });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  }

  const { userId, courseId, file } = req.body ?? {};
  if (!userId || !file?.name || !file?.sourceUrl || !file?.provider || (!file?.bytes && !file?.storagePath)) {
    return res.status(400).json({
      error: "Required: userId, file.name, file.sourceUrl, file.provider, and file.bytes (base64) or file.storagePath",
    });
  }
  // Inline base64 must stay under Vercel's ~4.5MB request-body cap. Bigger files:
  // ?action=sign → PUT bytes to the signed URL → re-call with file.storagePath.
  if (typeof file.bytes === "string" && file.bytes.length > INLINE_B64_LIMIT) {
    return res.status(413).json({
      error: "File too large for inline upload — use ?action=sign then pass file.storagePath",
      useUpload: true,
    });
  }

  try {
    // Derive the PUBLIC origin this request came in on (e.g. https://fschoolai.com)
    // so the internal /api/extract call hits the unprotected custom domain, not
    // the deployment-protected VERCEL_URL.
    const host  = req.headers["x-forwarded-host"] || req.headers.host;
    // Default https ONLY for real hosts — the vite dev server sets no x-forwarded-proto,
    // and https://localhost:5173 makes the internal /api/extract self-call "fetch failed".
    const proto = req.headers["x-forwarded-proto"]
      || (/^(localhost|127\.)/i.test(String(host ?? "")) ? "http" : "https");
    const baseUrl = host ? `${proto}://${host}` : null;
    const result = await ingestLmsFile({ userId, courseId, file, baseUrl });
    return res.status(result.status).json(result.json);
  } catch (e: any) {
    console.error("[lms-ingest] error:", e.message);
    return res.status(500).json({ error: e.message ?? "ingest failed" });
  }
}

// api/transcribe.ts — large audio/video → transcript → RAG, via direct-to-Storage
// upload + ElevenLabs Scribe. Action-routed (one function to respect the Vercel limit):
//   POST /api/transcribe?action=sign    { userId, filename }                  → signed upload URL
//   POST /api/transcribe?action=start   { userId, storagePath, title,
//                                         courseId?, kind? }                  → { jobId, status }
//   POST /api/transcribe?action=status  { jobId }                            → { job }
//
// The browser uploads the file straight to Storage (bypassing the ~4.5MB function body
// limit). `start` then downloads it server-side and transcribes it via ElevenLabs
// Scribe (synchronous), ingests the transcript into RAG, and returns the final status.
// (Scribe is sync, so we don't poll — `status` is just a convenience/fallback.)

export const config = { maxDuration: 300 }; // give long transcriptions room (Vercel Pro)

import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import { ingest, embedBatch } from "./rag.js";
import { requireUserOr401 } from "./_auth.js";

const BUCKET = "media-uploads";
const STT_URL = "https://api.elevenlabs.io/v1/speech-to-text";
const STT_MODEL = "scribe_v1";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_ANON_KEY,
);
const elevenKey = () => process.env.ELEVENLABS_API_KEY;

// ── sign: short-lived signed upload URL so the browser uploads directly to Storage ─
async function sign(body) {
  const { userId, filename } = body ?? {};
  if (!userId) return { status: 400, json: { error: "userId required" } };
  const safe = String(filename || "media").replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
  const path = `${userId}/${Date.now()}-${safe}`;
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error) return { status: 500, json: { error: `sign: ${error.message}` } };
  return { status: 200, json: { path: data.path, token: data.token } };
}

// ── start: download the upload, transcribe via Scribe, ingest into RAG ──────────
async function start(body) {
  const { userId, storagePath, title = "Recording", courseId = null, kind = "audio" } = body ?? {};
  if (!userId || !storagePath) return { status: 400, json: { error: "userId and storagePath required" } };
  // Uploads live under `<userId>/...`; reject any path outside the caller's namespace so a
  // client can't have us download/transcribe/delete another user's media by its path.
  if (!String(storagePath).startsWith(userId + "/") || String(storagePath).includes("..")) return { status: 403, json: { error: "forbidden storage path" } };
  if (!elevenKey()) return { status: 500, json: { error: "ELEVENLABS_API_KEY not configured" } };

  const jobId = randomUUID();
  await supabase.from("media_jobs").insert({
    id: jobId, user_id: userId, course_id: courseId, title, kind,
    storage_path: storagePath, provider: "elevenlabs", status: "transcribing",
  });

  try {
    // Pull the uploaded file server-side (no client body limit).
    const { data: blob, error: dlErr } = await supabase.storage.from(BUCKET).download(storagePath);
    if (dlErr || !blob) throw new Error(`download: ${dlErr?.message || "file not found"}`);

    // Transcribe with ElevenLabs Scribe (multipart upload).
    const filename = storagePath.split("/").pop() || "audio";
    const form = new FormData();
    form.append("model_id", STT_MODEL);
    form.append("file", blob, filename);
    const tr = await fetch(STT_URL, { method: "POST", headers: { "xi-api-key": elevenKey() }, body: form });
    if (!tr.ok) throw new Error(`ElevenLabs STT ${tr.status}: ${(await tr.text()).slice(0, 200)}`);
    const tj = await tr.json();
    const text = String(tj.text || "").trim();
    if (!text) throw new Error("empty transcript");

    // Ingest the transcript → chunk → embed.
    await supabase.from("media_jobs").update({ status: "indexing" }).eq("id", jobId);
    const ing = await ingest({ userId, courseId, title, kind, text });
    const documentId = ing.json?.documentId;
    if (!documentId) throw new Error(ing.json?.error || "ingest failed");
    for (let i = 0; i < 1000; i++) {
      const e = await embedBatch({ userId, documentId });
      if (e.status !== 200 || e.json?.done) break;
    }

    await supabase.from("media_jobs").update({ status: "done", document_id: documentId }).eq("id", jobId);

    // The transcript is now in RAG — delete the raw media from Storage. A 1-hour lecture
    // is ~60MB (video far more); these objects were never removed, so the bucket only
    // ever grew. Best-effort: a failed remove never fails the job (media_jobs keeps
    // storage_path, so a later sweep can still find orphans).
    await supabase.storage.from(BUCKET).remove([storagePath]).catch(() => {});

    return { status: 200, json: { jobId, status: "done", documentId } };
  } catch (err) {
    const msg = String(err?.message || err).slice(0, 300);
    await supabase.from("media_jobs").update({ status: "error", error: msg }).eq("id", jobId);
    return { status: 200, json: { jobId, status: "error", error: msg } };
  }
}

// ── status: return the job row (Scribe is sync, so this is just a fallback) ──────
async function status(body) {
  const { jobId, userId } = body ?? {};
  if (!jobId) return { status: 400, json: { error: "jobId required" } };
  // Scope to the caller (userId is the verified id set by the handler) so a job can't be read
  // cross-user by its id.
  let q = supabase.from("media_jobs").select("id, status, error, document_id, title").eq("id", jobId);
  if (userId) q = q.eq("user_id", userId);
  const { data } = await q.maybeSingle();
  return { status: 200, json: { job: data || null } };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const _uid = await requireUserOr401(req, res); if (!_uid) return;
  if (req.body && typeof req.body === "object") req.body.userId = _uid;
  if (req.query && typeof req.query === "object") req.query.userId = _uid;

  if (!process.env.SUPABASE_URL || !(process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_ANON_KEY))
    return res.status(500).json({ error: "Supabase env not configured" });

  const action = req.query?.action;
  try {
    const result = action === "sign"   ? await sign(req.body)
                 : action === "start"  ? await start(req.body)
                 : action === "status" ? await status(req.body)
                 : { status: 400, json: { error: "Unknown action. Use ?action=sign|start|status" } };
    return res.status(result.status).json(result.json);
  } catch (err) {
    console.error("[transcribe] error:", err?.message ?? err);
    return res.status(502).json({ error: err?.message ?? "transcription error" });
  }
}

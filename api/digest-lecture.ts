// api/digest-lecture.ts — lecture audio/video → structured study package.
// Action-routed (same pattern as api/transcribe.ts):
//   POST /api/digest-lecture?action=sign    { userId, filename }                       → signed upload URL
//   POST /api/digest-lecture?action=start   { userId, storagePath, title, courseId?,
//                                              language? }                             → { jobId, status, digest }
//   POST /api/digest-lecture?action=status  { jobId }                                  → { job }
//
// Pipeline (see FEATURE_PLAN_DIGEST_OFFICEHOURS.md): Storage → ElevenLabs Scribe
// (word timestamps + diarization) → rule-based emphasis pass (no LLM) → Claude
// Haiku confirms/ranks emphasis → Claude Sonnet generates the full digest →
// flashcards saved to flashcards_v2 → transcript ingested into RAG.

export const config = { maxDuration: 300 }; // same budget as api/transcribe.ts

import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import { ingest, embedBatch } from "./rag.js";

const BUCKET = "media-uploads";
const STT_URL = "https://api.elevenlabs.io/v1/speech-to-text";
const STT_MODEL = "scribe_v1";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const HAIKU_MODEL = "claude-haiku-4-5-20251001";
const SONNET_MODEL = "claude-sonnet-4-6";
// Bound transcript length fed to Claude — long lectures can run 10k+ words;
// this keeps both passes well within context/cost limits without losing the arc.
const MAX_TRANSCRIPT_CHARS = 24000;

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_ANON_KEY,
);
const elevenKey = () => process.env.ELEVENLABS_API_KEY;
const anthropicKey = () => process.env.ANTHROPIC_API_KEY;

// ── sign: identical shape to api/transcribe.ts?action=sign ──────────────────────
async function sign(body) {
  const { userId, filename } = body ?? {};
  if (!userId) return { status: 400, json: { error: "userId required" } };
  const safe = String(filename || "lecture").replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
  const path = `${userId}/${Date.now()}-${safe}`;
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error) return { status: 500, json: { error: `sign: ${error.message}` } };
  return { status: 200, json: { path: data.path, token: data.token } };
}

// ── Claude helpers ────────────────────────────────────────────────────────────
async function askClaude(model, content, maxTokens) {
  const key = anthropicKey();
  if (!key) throw new Error("ANTHROPIC_API_KEY not configured");
  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [{ role: "user", content }],
    }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`Claude ${res.status}: ${err.slice(0, 300)}`);
  }
  const data = await res.json();
  return data.content?.[0]?.text ?? "";
}

/** Claude sometimes wraps JSON in ```json fences despite instructions — strip them. */
function parseJsonLoose(text, fallback) {
  const stripped = String(text || "").replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try { return JSON.parse(stripped); } catch { return fallback; }
}

// ── Rule-based emphasis detection (no LLM, instant) ──────────────────────────────
const MARKER_RE = /\b(remember|important|key point|this will be on the (exam|test|midterm|final)|don'?t forget|pay attention|critical|take note)\b/i;
const TRANSITION_RE = /\b(moving on to|next topic|so to summarize|let'?s talk about)\b/i;
const PAUSE_GAP_SECONDS = 1.5;

/** Pick the speaker with the most words — the professor, in a lecture recording. */
function dominantSpeaker(words) {
  const counts: Record<string, number> = {};
  for (const w of words) {
    const id = w.speaker_id ?? "unknown";
    counts[id] = (counts[id] ?? 0) + 1;
  }
  let best = null, bestCount = -1;
  for (const [id, c] of Object.entries(counts)) if (c > bestCount) { best = id; bestCount = c; }
  return best;
}

/** Group a speaker's words into sentence-like segments with start/end timestamps. */
function segmentWords(words) {
  const segments = [];
  let buf = [];
  const flush = () => {
    if (!buf.length) return;
    segments.push({
      text: buf.map(w => w.text).join(" ").replace(/\s+([.,!?])/g, "$1"),
      start: buf[0].start,
      end: buf[buf.length - 1].end,
    });
    buf = [];
  };
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w.type === "spacing") continue;
    const prev = buf[buf.length - 1];
    const gap = prev ? w.start - prev.end : 0;
    if (prev && gap > 2) flush();
    buf.push(w);
    if (/[.!?]$/.test(w.text) && buf.length >= 4) flush();
  }
  flush();
  return segments;
}

/** Pass 1 — regex + timing heuristics over the professor's speech. Returns candidates. */
function ruleBasedEmphasis(words) {
  const profId = dominantSpeaker(words);
  const profWords = words.filter(w => (w.speaker_id ?? "unknown") === profId && w.type !== "spacing");
  const segments = segmentWords(profWords);
  const candidates = [];

  // Explicit markers + structural transitions.
  for (const seg of segments) {
    if (MARKER_RE.test(seg.text)) {
      candidates.push({ timestamp_seconds: Math.round(seg.start), quote: seg.text.slice(0, 200), reason: "explicit emphasis marker", importance: 0.6 });
    } else if (TRANSITION_RE.test(seg.text)) {
      candidates.push({ timestamp_seconds: Math.round(seg.start), quote: seg.text.slice(0, 200), reason: "structural transition", importance: 0.4 });
    }
  }

  // Slow-down + pause before a phrase.
  for (let i = 1; i < profWords.length; i++) {
    const gap = profWords[i].start - profWords[i - 1].end;
    if (gap > PAUSE_GAP_SECONDS) {
      const phrase = profWords.slice(i, i + 10).map(w => w.text).join(" ");
      if (phrase.trim()) {
        candidates.push({ timestamp_seconds: Math.round(profWords[i].start), quote: phrase.slice(0, 200), reason: "pause before emphasis", importance: 0.3 });
      }
    }
  }

  // Repeated phrases (3+ occurrences of the same normalized 5-gram anywhere in the lecture).
  const seen = new Map();
  for (const seg of segments) {
    const norm = seg.text.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(Boolean);
    for (let i = 0; i + 5 <= norm.length; i++) {
      const gram = norm.slice(i, i + 5).join(" ");
      if (gram.length < 12) continue; // skip low-signal short grams
      const entry = seen.get(gram);
      if (entry) entry.count++; else seen.set(gram, { count: 1, timestamp: seg.start, quote: seg.text.slice(0, 200) });
    }
  }
  for (const [gram, entry] of seen) {
    if (entry.count >= 3) {
      candidates.push({ timestamp_seconds: Math.round(entry.timestamp), quote: entry.quote, reason: `repeated phrase (${entry.count}x): "${gram}"`, importance: 0.5 });
    }
  }

  // Bound candidate count so the Haiku prompt stays small; keep the highest-importance ones.
  candidates.sort((a, b) => b.importance - a.importance);
  return { candidates: candidates.slice(0, 40), professorText: segments.map(s => s.text).join(" ") };
}

// ── Pass 2 — Claude Haiku confirms/ranks emphasis candidates ────────────────────
async function confirmEmphasis(transcript, candidates) {
  const list = candidates.map((c, i) => `[${i}] t=${c.timestamp_seconds}s "${c.quote}" (${c.reason})`).join("\n");
  const prompt = `You are analyzing a lecture transcript to find the moments the professor emphasized most.

TRANSCRIPT EXCERPT (may be truncated):
${transcript.slice(0, MAX_TRANSCRIPT_CHARS)}

RULE-BASED CANDIDATES (regex/timing heuristics — confirm, discard filler, or add ones the rules missed):
${list || "(none found)"}

TASK:
- Confirm which candidates are genuinely important vs. filler
- Identify conceptual emphasis not captured by keywords (e.g. "this is subtle but...")
- Produce a ranked list of the 5-8 most important moments with a one-sentence "why"

Return ONLY JSON, no markdown fences: {"emphasis": [{"timestamp_seconds": number, "quote": string, "reason": string, "importance": number}]}`;
  const text = await askClaude(HAIKU_MODEL, prompt, 1200);
  const parsed = parseJsonLoose(text, { emphasis: candidates.slice(0, 8) });
  return Array.isArray(parsed.emphasis) ? parsed.emphasis : candidates.slice(0, 8);
}

// ── Pass 3 — Claude Sonnet generates the full digest package ────────────────────
async function generateDigest(transcript, emphasis, courseContext) {
  const emphasisList = emphasis.map(e => `t=${e.timestamp_seconds}s "${e.quote}" — ${e.reason}`).join("\n");
  const prompt = `You are an academic assistant producing a study package from a lecture transcript.

${courseContext ? `COURSE CONTEXT:\n${courseContext}\n\n` : ""}TRANSCRIPT:
${transcript.slice(0, MAX_TRANSCRIPT_CHARS)}

EMPHASIS MOMENTS (what the professor stressed):
${emphasisList || "(none detected)"}

TASK — produce a complete study package:
1. summary: 3-5 paragraphs of prose covering the FULL lecture arc (not just the beginning)
2. keyPoints: 6-10 items, each tied to a timestamp from the emphasis list or transcript content
3. glossary: every new term introduced, each with a one-sentence definition
4. flashcards: 10-15 question/answer pairs covering the lecture's content
5. quizQuestions: exactly 5, a mix of multiple-choice (with options) and short-answer

Return ONLY JSON, no markdown fences:
{
  "summary": string,
  "keyPoints": [{"timestamp_seconds": number, "heading": string, "body": string}],
  "glossary": [{"term": string, "definition": string}],
  "flashcards": [{"question": string, "answer": string}],
  "quizQuestions": [{"question": string, "type": "multiple_choice"|"short_answer", "options": string[]|null, "answer": string}]
}`;
  const text = await askClaude(SONNET_MODEL, prompt, 4096);
  return parseJsonLoose(text, null);
}

// ── start: the full pipeline ──────────────────────────────────────────────────
async function start(body) {
  const { userId, storagePath, title = "Lecture", courseId = null, language = "en" } = body ?? {};
  if (!userId || !storagePath) return { status: 400, json: { error: "userId and storagePath required" } };
  if (!elevenKey()) return { status: 500, json: { error: "ELEVENLABS_API_KEY not configured" } };
  if (!anthropicKey()) return { status: 500, json: { error: "ANTHROPIC_API_KEY not configured" } };

  const { data: row, error: insErr } = await supabase.from("lecture_digests")
    .insert({ user_id: userId, course_id: courseId, title, storage_path: storagePath, status: "transcribing" })
    .select("id").single();
  if (insErr || !row) return { status: 500, json: { error: `insert: ${insErr?.message ?? "failed"}` } };
  const jobId = row.id;

  try {
    // 1. Download the uploaded file server-side (no client body limit).
    const { data: blob, error: dlErr } = await supabase.storage.from(BUCKET).download(storagePath);
    if (dlErr || !blob) throw new Error(`download: ${dlErr?.message || "file not found"}`);

    // 2. ElevenLabs Scribe — word timestamps + speaker diarization.
    const filename = storagePath.split("/").pop() || "lecture";
    const form = new FormData();
    form.append("model_id", STT_MODEL);
    form.append("file", blob, filename);
    form.append("timestamps_granularity", "word");
    form.append("diarize", "true");
    form.append("language_code", language || "en");
    const tr = await fetch(STT_URL, { method: "POST", headers: { "xi-api-key": elevenKey() }, body: form });
    if (!tr.ok) throw new Error(`ElevenLabs STT ${tr.status}: ${(await tr.text()).slice(0, 200)}`);
    const tj = await tr.json();
    const transcript = String(tj.text || "").trim();
    const words = Array.isArray(tj.words) ? tj.words : [];
    if (!transcript) throw new Error("empty transcript");

    await supabase.from("lecture_digests").update({ status: "emphasizing", transcript }).eq("id", jobId);

    // 3. Rule-based emphasis (Pass 1) — falls back to the whole transcript if diarization is unavailable.
    const { candidates, professorText } = words.length
      ? ruleBasedEmphasis(words)
      : { candidates: [], professorText: transcript };

    // 4. Claude Haiku confirms/ranks emphasis (Pass 2).
    const emphasis = await confirmEmphasis(professorText || transcript, candidates);

    await supabase.from("lecture_digests").update({ status: "digesting", emphasis }).eq("id", jobId);

    // 5. Optional lightweight course context (best-effort, non-fatal).
    let courseContext = null;
    if (courseId) {
      try {
        const { data: course } = await supabase.from("courses").select("name, course_code").eq("id", courseId).maybeSingle();
        if (course) courseContext = `${course.course_code ?? ""} ${course.name ?? ""}`.trim();
      } catch { /* non-fatal */ }
    }

    // 6. Claude Sonnet generates the full digest (Pass 3).
    const digest = await generateDigest(transcript, emphasis, courseContext);
    if (!digest) throw new Error("digest generation returned invalid JSON");

    // 7. Save flashcards to flashcards_v2 (same table/shape as api/flashcards.ts) —
    // requires a courseId since the column is NOT NULL; skip (non-fatal) without one.
    if (courseId && Array.isArray(digest.flashcards) && digest.flashcards.length) {
      const rows = digest.flashcards
        .filter(c => c?.question && c?.answer)
        .map(c => ({ user_id: userId, course_id: courseId, question: c.question, answer: c.answer }));
      if (rows.length) await supabase.from("flashcards_v2").insert(rows);
    }

    // 8. Ingest transcript into RAG so the tutor/Study Assistant can answer questions about it.
    // NOTE: RAG's course_id column is uuid (see supabase-rag-migration.sql), but
    // public.courses.id is bigint — different id spaces. Passing the bigint courseId here
    // makes the rag_documents insert fail on the uuid cast, and the catch below swallows it,
    // so the lecture would silently never get ingested. RAG is queried per-user anyway
    // (StudyAssistant sends no courseId), so scope to the user and leave course_id null.
    let documentId = null;
    try {
      const ing = await ingest({ userId, courseId: null, title, kind: "lecture", text: transcript });
      documentId = ing.json?.documentId ?? null;
      if (documentId) {
        for (let i = 0; i < 1000; i++) {
          const e = await embedBatch({ userId, documentId });
          if (e.status !== 200 || e.json?.done) break;
        }
      }
    } catch { /* non-fatal — digest still succeeds without RAG ingestion */ }

    await supabase.from("lecture_digests").update({
      status: "done",
      summary: digest.summary ?? null,
      key_points: digest.keyPoints ?? null,
      glossary: digest.glossary ?? null,
      quiz_questions: digest.quizQuestions ?? null,
      document_id: documentId,
      updated_at: new Date().toISOString(),
    }).eq("id", jobId);

    return { status: 200, json: { jobId, status: "done", digest: { ...digest, emphasis, documentId } } };
  } catch (err) {
    const msg = String(err?.message || err).slice(0, 300);
    await supabase.from("lecture_digests").update({ status: "error", error: msg }).eq("id", jobId);
    return { status: 200, json: { jobId, status: "error", error: msg } };
  }
}

// ── status: poll fallback ────────────────────────────────────────────────────
async function status(body) {
  const { jobId } = body ?? {};
  if (!jobId) return { status: 400, json: { error: "jobId required" } };
  const { data } = await supabase
    .from("lecture_digests")
    .select("id, status, error, title, summary, key_points, glossary, quiz_questions, emphasis, document_id")
    .eq("id", jobId).maybeSingle();
  return { status: 200, json: { job: data || null } };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

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
    console.error("[digest-lecture] error:", err?.message ?? err);
    return res.status(502).json({ error: err?.message ?? "digest error" });
  }
}

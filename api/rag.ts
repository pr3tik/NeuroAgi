// api/rag.ts — Retrieval-Augmented Generation over student-uploaded documents.
// Single action-routed function (to stay under Vercel's function limit):
//   POST /api/rag?action=ingest  { userId, courseId?, title, kind?, sourceUrl?, text }
//   POST /api/rag?action=query   { userId, courseId?, query, maxSections? }
//
// Design (see supabase-rag-migration.sql): embed SMALL chunks, return the BIG
// parent section ("small-to-big"). Embeddings: OpenAI text-embedding-3-small.
// Retrieval: hybrid (pgvector + full-text) fused with RRF in a Postgres RPC.

import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";

const EMBED_MODEL = "text-embedding-3-small"; // 1536 dims — must match the vector() column
const EMBED_DIM   = 1536;
const MAX_CONTEXT_CHARS = 6000;               // cap injected passage text per query
const EMBED_BATCH = 64;                       // chunks embedded per /embed request (bounded so it never times out)

// Lazy client (import-safe): supabase-js's realtime client needs a global WebSocket,
// absent on Node 20 — building it at module load would crash any importer (e.g. Reggie's
// in-process tool loop) on Node-20 CI. The proxy defers createClient to first use; every
// `supabase.from/rpc/...` call-site stays unchanged. (See PRD §19.12 import-safety rule.)
let _sb: any = null;
const supabase: any = new Proxy({}, {
  get(_t, prop) {
    if (!_sb) {
      _sb = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_ANON_KEY,
      );
    }
    const v = _sb[prop];
    return typeof v === "function" ? v.bind(_sb) : v;
  },
});

// ── OpenAI embeddings ────────────────────────────────────────────────────────
/** Embed an array of strings → array of 1536-d vectors (order preserved). */
export async function embed(texts) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY not configured");
  const out = [];
  // Batch to stay well within request limits.
  for (let i = 0; i < texts.length; i += 100) {
    const batch = texts.slice(i, i + 100);
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method:  "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body:    JSON.stringify({ model: EMBED_MODEL, input: batch }),
    });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300);
      throw new Error(`OpenAI embeddings ${res.status}: ${detail}`);
    }
    const json = await res.json();
    // Sort by index so the order matches the input batch exactly.
    const sorted = (json.data ?? []).sort((a, b) => a.index - b.index);
    for (const d of sorted) out.push(d.embedding);
  }
  return out;
}

// ── Sectioning + chunking ────────────────────────────────────────────────────
// Heuristic structure: split into sections at heading-like lines, then split each
// section into small chunks. Sections are what we return; chunks are what we embed.

const HEADING_RE = [
  /^#{1,6}\s+\S/,                                   // markdown headings
  /^(chapter|section|unit|part|module|lecture)\s+[\w\d]/i,
  /^\d+(\.\d+){0,3}\s+\S/,                           // "1.2 Title"
];
export function isHeading(line) {
  const l = line.trim();
  if (!l || l.length > 90) return false;
  if (HEADING_RE.some(re => re.test(l))) return true;
  // Short, title-cased / all-caps line with no terminal punctuation.
  if (l.length <= 70 && !/[.!?,:;]$/.test(l) && /^[A-Z0-9]/.test(l)) {
    const letters = l.replace(/[^A-Za-z]/g, "");
    if (letters && letters === letters.toUpperCase()) return true;
  }
  return false;
}

const SECTION_MAX = 2200; // chars — soft cap before forcing a new section

/** Split raw text into [{ heading, text }] sections. */
export function sectionize(text) {
  const blocks = String(text).replace(/\r\n/g, "\n").split(/\n{2,}/).map(b => b.trim()).filter(Boolean);
  const sections = [];
  let cur = { heading: null, text: "" };
  const push = () => { if (cur.text.trim()) sections.push({ heading: cur.heading, text: cur.text.trim() }); };

  for (const block of blocks) {
    const firstLine = block.split("\n")[0];
    const headingHere = block.split("\n").length === 1 && isHeading(firstLine);
    if (headingHere) {
      push();
      cur = { heading: firstLine.replace(/^#{1,6}\s+/, "").trim(), text: "" };
      continue;
    }
    if (cur.text && (cur.text.length + block.length) > SECTION_MAX) {
      push();
      cur = { heading: cur.heading, text: "" }; // carry heading for continued sections
    }
    cur.text += (cur.text ? "\n\n" : "") + block;
  }
  push();
  return sections.length ? sections : [{ heading: null, text: String(text).trim() }];
}

/** Page-aware sectionizer: splits [{page, text}] into sections tagged with the
 *  page range they span, so retrieved passages can cite real page numbers. */
export function sectionizePages(pages) {
  const sections = [];
  let cur = { heading: null, text: "", locStart: null, locEnd: null };
  const push = () => {
    if (cur.text.trim())
      sections.push({ heading: cur.heading, text: cur.text.trim(), locStart: cur.locStart, locEnd: cur.locEnd });
  };
  for (const pg of pages) {
    const page = pg?.page ?? null;
    const blocks = String(pg?.text ?? "").replace(/\r\n/g, "\n").split(/\n{2,}/).map(b => b.trim()).filter(Boolean);
    for (const block of blocks) {
      const firstLine = block.split("\n")[0];
      const headingHere = block.split("\n").length === 1 && isHeading(firstLine);
      if (headingHere) {
        push();
        cur = { heading: firstLine.replace(/^#{1,6}\s+/, "").trim(), text: "", locStart: page, locEnd: page };
        continue;
      }
      if (cur.text && (cur.text.length + block.length) > SECTION_MAX) {
        push();
        cur = { heading: cur.heading, text: "", locStart: page, locEnd: page };
      }
      if (cur.locStart == null) cur.locStart = page;
      cur.locEnd = page;
      cur.text += (cur.text ? "\n\n" : "") + block;
    }
  }
  push();
  return sections;
}

const CHUNK_MAX = 900; // chars per embedded chunk

/** Split section text into small chunks on paragraph/sentence boundaries. */
export function chunkText(text) {
  const paras = text.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  const chunks = [];
  let buf = "";
  const flush = () => { if (buf.trim()) chunks.push(buf.trim()); buf = ""; };

  for (const para of paras) {
    if (para.length > CHUNK_MAX) {
      flush();
      // Break an oversized paragraph on sentence boundaries.
      const sentences = para.match(/[^.!?]+[.!?]+|\S[^.!?]*$/g) ?? [para];
      let sBuf = "";
      for (const s of sentences) {
        if ((sBuf + s).length > CHUNK_MAX) { if (sBuf.trim()) chunks.push(sBuf.trim()); sBuf = ""; }
        sBuf += s;
      }
      if (sBuf.trim()) chunks.push(sBuf.trim());
    } else if ((buf + "\n\n" + para).length > CHUNK_MAX) {
      flush();
      buf = para;
    } else {
      buf += (buf ? "\n\n" : "") + para;
    }
  }
  flush();
  return chunks;
}

// rag course_id columns are uuid, but callers pass all sorts of native ids (LMS course
// numbers, the live courses.id BIGINT). Anything non-UUID must be coerced to null BEFORE
// it reaches Postgres: in an insert it throws 22P02; in the rag_hybrid_search RPC it
// 400s → query() returned 500 → callers saw "no passages" → Study.tsx re-ingested the
// whole course (the duplicate-ingest loop that produced ~39% duplicate rag docs).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function coerceUuid(v) {
  return (v != null && UUID_RE.test(String(v))) ? String(v) : null;
}

// ── Ingest ────────────────────────────────────────────────────────────────────
// Exported so server-side callers (e.g. api/transcribe.ts) can ingest text directly.
// REPLACE semantics: re-ingesting a document the user already has (same title) deletes
// the old rag_documents row first (sections/chunks cascade), so no caller can ever
// duplicate the index — re-uploads and retries update in place.
export async function ingest(body) {
  const { userId, courseId = null, title = "Untitled", kind = "text", sourceUrl = null, text, pages } = body ?? {};
  if (!userId) return { status: 400, json: { error: "userId required" } };

  const cid = coerceUuid(courseId);

  // Prefer structured per-page input (real page-number citations); fall back to
  // a flat text string for callers that don't have page structure.
  let sections;
  if (Array.isArray(pages) && pages.some(p => p?.text && String(p.text).trim())) {
    sections = sectionizePages(pages);
  } else if (text && typeof text === "string" && text.trim()) {
    sections = sectionize(text).map(s => ({ ...s, locStart: null, locEnd: null }));
  } else {
    return { status: 400, json: { error: "text or pages required" } };
  }
  if (!sections.length) return { status: 400, json: { error: "no content to index" } };

  // Build section + chunk rows with client-generated ids so chunk→section linkage
  // is deterministic (no reliance on insert ordering).
  const documentId = randomUUID();
  const sectionRows = [];
  const chunkRows   = [];
  sections.forEach((sec, idx) => {
    const sectionId = randomUUID();
    sectionRows.push({
      id: sectionId, document_id: documentId, user_id: userId, course_id: cid,
      heading: sec.heading, ordinal: idx, loc_start: sec.locStart ?? null, loc_end: sec.locEnd ?? null, full_text: sec.text,
    });
    for (const content of chunkText(sec.text)) {
      chunkRows.push({
        id: randomUUID(), section_id: sectionId, document_id: documentId,
        user_id: userId, course_id: cid, content, embedding: null,
      });
    }
  });

  if (!chunkRows.length) return { status: 400, json: { error: "no content to index" } };

  // Replace, never duplicate: drop any prior copies of this document (same user+title).
  // FK cascade removes their sections/chunks (and embeddings). Best-effort — a failed
  // delete must not block indexing the new copy.
  const { error: delErr } = await supabase
    .from("rag_documents").delete().eq("user_id", userId).eq("title", title);
  if (delErr) console.warn("[rag] dedup delete failed (continuing):", delErr.message);

  // Persist rows WITHOUT embeddings first — fast and never times out. Embeddings get
  // filled in afterward in bounded batches via action=embed, so a 300-page textbook
  // can't blow the serverless time limit in one request. Chunks are immediately
  // keyword-searchable (FTS); vector search activates per chunk as embeddings land.
  const { error: dErr } = await supabase.from("rag_documents").insert({
    id: documentId, user_id: userId, course_id: cid, title, kind, source_url: sourceUrl,
  });
  if (dErr) return { status: 500, json: { error: `document insert: ${dErr.message}` } };

  const { error: sErr } = await supabase.from("rag_sections").insert(sectionRows);
  if (sErr) return { status: 500, json: { error: `sections insert: ${sErr.message}` } };

  for (let i = 0; i < chunkRows.length; i += 200) {
    const { error: cErr } = await supabase.from("rag_chunks").insert(chunkRows.slice(i, i + 200));
    if (cErr) return { status: 500, json: { error: `chunks insert: ${cErr.message}` } };
  }

  return { status: 200, json: { ok: true, documentId, sections: sectionRows.length, chunks: chunkRows.length } };
}

// ── Embed (bounded batch) ─────────────────────────────────────────────────────
// Embeds the next batch of not-yet-embedded chunks for a document. The client calls
// this repeatedly until { done: true }, so total embedding work is spread across many
// short requests instead of one that would time out on a large document.
export async function embedBatch(body) {
  const { userId, documentId, batchSize = EMBED_BATCH } = body ?? {};
  if (!userId || !documentId) return { status: 400, json: { error: "userId and documentId required" } };
  const limit = Math.min(Math.max(Number(batchSize) || EMBED_BATCH, 1), 128);

  // Pull the next slice of un-embedded chunks (full rows so we can upsert them back).
  const { data: pending, error: pErr } = await supabase
    .from("rag_chunks")
    .select("id, section_id, document_id, user_id, course_id, content")
    .eq("user_id", userId)
    .eq("document_id", documentId)
    .is("embedding", null)
    .limit(limit);
  if (pErr) return { status: 500, json: { error: `fetch pending: ${pErr.message}` } };
  if (!pending?.length) return { status: 200, json: { embedded: 0, done: true } };

  const vectors = await embed(pending.map(c => c.content));
  const rows = pending.map((c, i) => ({ ...c, embedding: vectors[i] }));

  // One bulk upsert (vs N concurrent updates) — onConflict id updates the embedding.
  const { error: uErr } = await supabase.from("rag_chunks").upsert(rows, { onConflict: "id" });
  if (uErr) return { status: 500, json: { error: `embed upsert: ${uErr.message}` } };

  // Fewer than a full batch means we've drained the queue.
  return { status: 200, json: { embedded: pending.length, done: pending.length < limit } };
}

// ── Reranking ─────────────────────────────────────────────────────────────────
// Hybrid search (RRF) is recall-oriented; a cross-encoder-style rerank by actual
// query↔passage relevance lifts precision so the tutor grounds on the BEST chunks. We use
// a fast LLM (gpt-4o-mini, listwise) and fall back to the RRF order on any failure, so
// reranking can never break retrieval.

/** Reorder `hits` by the reranker's index order: dedups, drops invalid, appends any omitted. Pure. */
export function applyRerankOrder(hits, order) {
  const seen = new Set();
  const out = [];
  for (const i of Array.isArray(order) ? order : []) {
    if (Number.isInteger(i) && i >= 0 && i < hits.length && !seen.has(i)) { seen.add(i); out.push(hits[i]); }
  }
  hits.forEach((h, i) => { if (!seen.has(i)) out.push(h); }); // keep anything the reranker omitted
  return out;
}

async function rerankHits(q, hits) {
  const key = process.env.OPENAI_API_KEY;
  if (!key || hits.length <= 1) return hits;
  try {
    const list = hits.map((h, i) => `[${i}] ${String(h.content || "").replace(/\s+/g, " ").slice(0, 600)}`).join("\n\n");
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method:  "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: "gpt-4o-mini", temperature: 0, max_tokens: 200,
        response_format: { type: "json_object" },
        messages: [{ role: "user", content:
          `Rank these passages by how well each helps answer the question.\n` +
          `Question: "${String(q)}"\n\nPassages:\n${list}\n\n` +
          `Respond ONLY as JSON: {"order": [passage indices, most relevant first; omit clearly irrelevant ones]}.` }],
      }),
    });
    if (!res.ok) return hits;
    const json = await res.json();
    const order = JSON.parse(json.choices?.[0]?.message?.content || "{}").order;
    return applyRerankOrder(hits, order);
  } catch { return hits; } // never break retrieval
}

// ── Query ───────────────────────────────────────────────────────────────────
async function query(body) {
  const { userId, courseId = null, query: q, maxSections = 4, rerank = true } = body ?? {};
  if (!userId) return { status: 400, json: { error: "userId required" } };
  if (!q || !String(q).trim()) return { status: 400, json: { error: "query required" } };

  // Cap the query for retrieval — the embedding + full-text search don't benefit from
  // more than the gist, and an unbounded query (e.g. a whole pasted essay) is slow to
  // embed and search. Clients should pre-trim (src/lib/ragQuery), this is the backstop.
  const qStr = String(q).slice(0, 2000);
  const [queryEmbedding] = await embed([qStr]);

  const { data: hits, error } = await supabase.rpc("rag_hybrid_search", {
    p_user_id:         userId,
    p_query_embedding: queryEmbedding,
    p_query_text:      qStr,
    // Non-UUID course ids (live courses.id is BIGINT) used to reach the uuid RPC param
    // raw → 22P02 → 500 → callers treated it as "no passages" and re-ingested. Coerce:
    // an unlinkable id degrades to an all-courses search instead of an error.
    p_course_id:       coerceUuid(courseId),
    p_match_count:     12,
  });
  if (error) return { status: 500, json: { error: `search: ${error.message}` } };
  if (!hits?.length) {
    // No hybrid hit — typical for meta/vague queries ("summarize my notes") whose words
    // aren't in the documents, or briefly while a doc's chunks are still being embedded
    // (vector search needs embeddings; without them only literal keyword matches work).
    // Fall back to the user's most recent document so those queries still ground — but
    // only when the corpus is small enough that surfacing a whole doc is sensible.
    const { data: docs } = await supabase
      .from("rag_documents").select("id, title")
      .eq("user_id", userId).order("created_at", { ascending: false }).limit(6);
    if (!docs?.length || docs.length > 5) return { status: 200, json: { passages: [], used: 0 } };
    const { data: secs } = await supabase
      .from("rag_sections").select("heading, loc_start, loc_end, full_text")
      .eq("document_id", docs[0].id).order("ordinal", { ascending: true }).limit(5);
    const passages = [];
    let total = 0;
    for (const s of secs ?? []) {
      let t = s.full_text ?? "";
      if (total + t.length > MAX_CONTEXT_CHARS) t = t.slice(0, Math.max(0, MAX_CONTEXT_CHARS - total));
      if (!t) break;
      passages.push({
        title: docs[0].title ?? "Document", heading: s.heading ?? null,
        loc: s.loc_start != null ? `p.${s.loc_start}${s.loc_end && s.loc_end !== s.loc_start ? `-${s.loc_end}` : ""}` : null,
        text: t,
      });
      total += t.length;
      if (total >= MAX_CONTEXT_CHARS) break;
    }
    return { status: 200, json: { passages, used: passages.length, fallback: true } };
  }

  // Rerank candidate chunks by query relevance (precision boost over RRF) before choosing
  // which parent sections to inject. Falls back to the RRF order on any failure.
  const ranked = rerank ? await rerankHits(q, hits) : hits;

  // Map winning chunks to their parent sections, best section first, deduped.
  const sectionOrder = [];
  const seen = new Set();
  for (const h of ranked) {
    if (h.section_id && !seen.has(h.section_id)) { seen.add(h.section_id); sectionOrder.push(h.section_id); }
    if (sectionOrder.length >= maxSections) break;
  }

  const { data: sections } = await supabase
    .from("rag_sections")
    .select("id, document_id, heading, ordinal, loc_start, loc_end, full_text")
    .in("id", sectionOrder);

  const { data: docs } = await supabase
    .from("rag_documents")
    .select("id, title")
    .in("id", (sections ?? []).map(s => s.document_id));
  const titleById = Object.fromEntries((docs ?? []).map(d => [d.id, d.title]));

  // Preserve ranked order; cap total injected text.
  const byId = Object.fromEntries((sections ?? []).map(s => [s.id, s]));
  const passages = [];
  let total = 0;
  for (const sid of sectionOrder) {
    const s = byId[sid];
    if (!s) continue;
    let textOut = s.full_text ?? "";
    if (total + textOut.length > MAX_CONTEXT_CHARS) textOut = textOut.slice(0, Math.max(0, MAX_CONTEXT_CHARS - total));
    if (!textOut) break;
    passages.push({
      title:   titleById[s.document_id] ?? "Document",
      heading: s.heading ?? null,
      loc:     s.loc_start != null ? `p.${s.loc_start}${s.loc_end && s.loc_end !== s.loc_start ? `-${s.loc_end}` : ""}` : null,
      text:    textOut,
    });
    total += textOut.length;
    if (total >= MAX_CONTEXT_CHARS) break;
  }

  return { status: 200, json: { passages, used: passages.length } };
}

// ── Backfill ──────────────────────────────────────────────────────────────────
// Index already-uploaded files that predate RAG auto-ingest (or whose fire-and-forget
// ingest never completed) so the tutor can find old materials WITHOUT re-uploading.
// Idempotent (skips anything already indexed, deduped by title) and paginated (a bounded
// number of files per call) so it never times out — the client loops until { done: true }.
// Nothing is deleted: this only ADDS missing index rows for content that's already in `files`.
async function backfill(body) {
  const { userId, limit = 3 } = body ?? {};
  if (!userId) return { status: 400, json: { error: "userId required" } };

  // Metadata-only pass first — this endpoint runs on EVERY tutor mount, and the common
  // case is "everything already indexed". Selecting content_text here used to ship the
  // user's ENTIRE library text out of Postgres (megabytes of billed egress) just to
  // decide there was nothing to do. Text is fetched below, only for the files that
  // actually need indexing (≤ limit rows).
  const { data: files, error: fErr } = await supabase
    .from("files")
    .select("id, name, course_id, source_url")
    .eq("user_id", userId)
    .not("content_text", "is", null)
    .limit(500);
  if (fErr) return { status: 500, json: { error: `files read: ${fErr.message}` } };
  if (!files?.length) return { status: 200, json: { indexed: 0, done: true } };

  // Skip anything already in the index (dedup by title) → safe to run repeatedly.
  const { data: existing } = await supabase
    .from("rag_documents").select("title").eq("user_id", userId);
  const have = new Set((existing ?? []).map(d => d.title));

  const pendingFiles = files.filter(f => !have.has(f.name));

  // ── Phase 1: index files that have text but aren't in the index yet ──
  let indexed = 0, skipped = 0;
  for (const f of pendingFiles.slice(0, limit)) {
    // Fetch this one file's text now (single-row egress, only for real work).
    const { data: fullRows } = await supabase
      .from("files").select("content_text").eq("id", f.id).limit(1);
    const contentText = String(fullRows?.[0]?.content_text ?? "");
    if (!contentText.trim()) { skipped++; continue; }  // blank text — nothing to index
    const result = await ingest({
      userId, courseId: f.course_id ?? null, title: f.name, kind: "document",
      text: contentText, sourceUrl: f.source_url ?? null,
    });
    if (result.status === 200 && result.json?.documentId) {
      for (let i = 0; i < 3; i++) {
        const eb = await embedBatch({ userId, documentId: result.json.documentId });
        if (eb.json?.done) break;
      }
      indexed++;
    } else {
      skipped++;  // unindexable (e.g. whitespace-only) — don't count it as still-pending
    }
  }
  if (pendingFiles.length > indexed + skipped) {
    // More files to index — keep looping (progressed iff we indexed at least one).
    return { status: 200, json: { phase: "index", indexed, progressed: indexed > 0, done: false } };
  }

  // ── Phase 2: finish embedding any chunks left un-embedded (e.g. by the old
  // fire-and-forget ingest that got cut off on serverless). Without embeddings,
  // vector search is dead and only literal keyword matches work — so semantic/meta
  // queries ("summarize my notes") return nothing. This re-embeds them. ──
  const { data: pendingChunk } = await supabase
    .from("rag_chunks").select("document_id")
    .eq("user_id", userId).is("embedding", null).limit(1);
  if (pendingChunk?.length) {
    let embedded = 0;
    for (let i = 0; i < 4; i++) {
      const eb = await embedBatch({ userId, documentId: pendingChunk[0].document_id });
      embedded += eb.json?.embedded ?? 0;
      if (eb.json?.done) break;
    }
    return { status: 200, json: { phase: "embed", embedded, progressed: embedded > 0, done: false } };
  }

  return { status: 200, json: { indexed, done: true, progressed: false } };
}

// ── Handler ───────────────────────────────────────────────────────────────────
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
    const result = action === "ingest"   ? await ingest(req.body)
                 : action === "embed"    ? await embedBatch(req.body)
                 : action === "query"    ? await query(req.body)
                 : action === "backfill" ? await backfill(req.body)
                 : { status: 400, json: { error: "Unknown action. Use ?action=ingest|embed|query|backfill" } };
    return res.status(result.status).json(result.json);
  } catch (err) {
    console.error("[rag] error:", err?.message ?? err);
    return res.status(502).json({ error: err?.message ?? "RAG error" });
  }
}

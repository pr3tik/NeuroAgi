// api/extract.ts — file → text extractor that PRESERVES STRUCTURE.
// The extension (or the in-app uploader) base64-encodes a file's bytes and POSTs
// here. For PDFs we reconstruct lines from pdfjs text items, detect headings by
// font size, infer paragraph breaks from vertical gaps, and keep PER-PAGE text so
// downstream RAG can cite real page numbers. No more flattening to one blob and no
// 20k-char cap (that truncated ~300-page textbooks to ~5 pages).
//
// Response: { text, pages: [{ page, text }], chars, pageCount, truncated }
//   - `text`  = all pages joined (back-compat: the extension stores this as content_text)
//   - `pages` = structured per-page text (RAG ingest uses this for page locators)

import { createClient } from "@supabase/supabase-js";

const MAX_PAGES = 300;          // generous; most uploads are far smaller
const SAFETY_CHARS = 1_500_000; // hard ceiling (~375k tokens) to avoid OOM on pathological files

// Lazy service-role client for reading large uploads straight from Storage. Created at
// request time (not module load) so it picks up env injected by the dev proxy. This lets
// files that exceed Vercel's ~4.5MB request-body limit be extracted — any type, any size.
let _supabase: any = null;
function getSupabase() {
  if (_supabase) return _supabase;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_ANON_KEY;
  _supabase = url && key ? createClient(url, key) : null;
  return _supabase;
}

// Reconstruct one page's text from pdfjs text items, preserving line breaks,
// paragraph breaks (large vertical gaps), and headings (markdown `#`, by font size).
// Lines are grouped by Y position (robust across PDF generators — doesn't depend
// on pdfjs setting hasEOL), ordered top-to-bottom, left-to-right within a line.
export function reconstructPage(items: any[]): string {
  const toks = (items || [])
    .filter(it => it?.str && it.str.trim())
    .map(it => ({
      str: it.str,
      x: it.transform ? it.transform[4] : 0,
      y: it.transform ? it.transform[5] : 0,
      h: it.height || (it.transform ? Math.abs(it.transform[3]) : 0),
    }));
  if (!toks.length) return "";

  const medianH = [...toks].map(t => t.h).filter(Boolean).sort((a, b) => a - b)[Math.floor(toks.length / 2)] || 10;
  const tol = Math.max(2, medianH * 0.5);

  // Group tokens into lines by Y (within tolerance), top-to-bottom.
  toks.sort((a, b) => (b.y - a.y) || (a.x - b.x));
  const lines: { y: number; size: number; text: string }[] = [];
  let group: { y: number; size: number; items: any[] } | null = null;
  for (const t of toks) {
    if (group && Math.abs(group.y - t.y) <= tol) {
      group.items.push(t);
      group.size = Math.max(group.size, t.h);
    } else {
      if (group) lines.push(finishLine(group, medianH));
      group = { y: t.y, size: t.h, items: [t] };
    }
  }
  if (group) lines.push(finishLine(group, medianH));

  // Body font size = median; typical line gap = median vertical delta.
  const sizes = lines.map(l => l.size).filter(Boolean).sort((a, b) => a - b);
  const body = sizes.length ? sizes[Math.floor(sizes.length / 2)] : 0;
  const gaps: number[] = [];
  for (let i = 1; i < lines.length; i++) gaps.push(Math.abs(lines[i - 1].y - lines[i].y));
  gaps.sort((a, b) => a - b);
  // Use a LOW percentile as the baseline "normal" line spacing, so paragraph/heading
  // gaps (the larger outliers) stand out — the median gets skewed by those outliers
  // when a page has few lines.
  const lineGap = gaps.length ? gaps[Math.floor(gaps.length * 0.35)] : 0;

  // Emit: headings get markdown `#`; large vertical gaps become paragraph breaks.
  let out = "";
  lines.forEach((l, i) => {
    if (!l.text) return;
    const isHeading = body > 0 && l.size > body * 1.25 && l.text.length < 120;
    const bigGap = i > 0 && lineGap > 0 && Math.abs(lines[i - 1].y - l.y) > lineGap * 1.6;
    if (isHeading)      out += `\n\n# ${l.text}\n\n`;
    else { if (bigGap) out += "\n\n"; out += l.text + "\n"; }
  });
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

// Join one line's tokens left-to-right, inserting a space across visual gaps.
function finishLine(group: { y: number; size: number; items: any[] }, medianH: number) {
  group.items.sort((a, b) => a.x - b.x);
  let s = "";
  let prevX: number | null = null;
  for (const it of group.items) {
    if (prevX != null && it.x - prevX > medianH * 0.3 && !s.endsWith(" ")) s += " ";
    s += it.str;
    prevX = it.x;
  }
  return { y: group.y, size: group.size, text: s.replace(/\s+/g, " ").trim() };
}

async function pdfToPages(bytes: Uint8Array): Promise<{ pages: { page: number; text: string }[]; pageCount: number; truncated: boolean }> {
  // pdfjs-dist uses DOMMatrix for transform operations. It's a browser-only API;
  // Vercel's Node.js runtime doesn't have it. Polyfill the minimum pdfjs needs
  // for text extraction (identity matrix + 6-element array constructor).
  if (typeof (globalThis as any).DOMMatrix === "undefined") {
    (globalThis as any).DOMMatrix = class DOMMatrix {
      a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
      constructor(init?: number[] | string) {
        if (Array.isArray(init) && init.length >= 6) {
          [this.a, this.b, this.c, this.d, this.e, this.f] = init as number[];
        }
      }
      multiply(_m: any) { return new (globalThis as any).DOMMatrix(); }
      inverse()         { return new (globalThis as any).DOMMatrix(); }
      transformPoint(p: any) { return { x: p?.x ?? 0, y: p?.y ?? 0 }; }
    };
  }
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // Point pdfjs to the worker file explicitly. Without this, pdfjs v5 tries to
  // resolve it relative to the module and fails in Vercel's bundled environment.
  // includeFiles in vercel.json ensures the file is present in the deployment.
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc =
      new URL("pdfjs-dist/legacy/build/pdf.worker.mjs", import.meta.url).href;
  }
  const doc = await pdfjs.getDocument({ data: bytes, isEvalSupported: false, useSystemFonts: true } as any).promise;
  const pageCount = doc.numPages;
  const limit = Math.min(pageCount, MAX_PAGES);
  const pages: { page: number; text: string }[] = [];
  let total = 0;
  for (let i = 1; i <= limit; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    const text = reconstructPage(content.items as any[]);
    if (text) { pages.push({ page: i, text }); total += text.length; }
    if (total > SAFETY_CHARS) return { pages, pageCount, truncated: true };
  }
  return { pages, pageCount, truncated: pageCount > limit };
}

function decodeXml(s: string): string {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
          .replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&");
}

// DOCX → text (mammoth yields clean paragraph text; keep paragraph breaks).
async function docxToPages(bytes: Uint8Array) {
  const mammoth: any = await import("mammoth");
  const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
  const text = String(value || "").replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return text ? [{ page: 1, text }] : [];
}

// PPTX → one "page" per slide; slide text lives in <a:t> runs inside <a:p> paragraphs.
async function pptxToPages(bytes: Uint8Array) {
  const JSZip: any = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(bytes);
  const slideNames = Object.keys(zip.files)
    .filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => (parseInt(a.match(/(\d+)/)![1], 10) - parseInt(b.match(/(\d+)/)![1], 10)));
  const pages: { page: number; text: string }[] = [];
  for (let i = 0; i < slideNames.length; i++) {
    const xml: string = await zip.files[slideNames[i]].async("string");
    const paras = [...xml.matchAll(/<a:p>([\s\S]*?)<\/a:p>/g)]
      .map(pm => [...pm[1].matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map(m => decodeXml(m[1])).join("").trim())
      .filter(Boolean);
    if (paras.length) pages.push({ page: i + 1, text: `# Slide ${i + 1}\n\n${paras.join("\n")}` });
  }
  return pages;
}

// ZIP archive — extract text from readable files; emit a manifest for the rest
// (e.g. MP4 lecture recordings) so content_text is never left null and the
// background alarm doesn't retry the same ZIP forever.
async function zipToPages(bytes: Uint8Array): Promise<{ page: number; text: string }[]> {
  const JSZip: any = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(bytes);
  const pages: { page: number; text: string }[] = [];
  let pageNum = 0;
  const skipped: string[] = [];

  const entries = Object.keys(zip.files)
    .filter(name => !zip.files[name].dir && !name.startsWith("__MACOSX/") && !name.startsWith("."))
    .sort();

  for (const name of entries) {
    const lower = name.toLowerCase();
    const basename = name.split("/").pop() || name;
    const isPdf  = lower.endsWith(".pdf");
    const isDocx = lower.endsWith(".docx");
    const isPptx = lower.endsWith(".pptx");
    const isTxt  = /\.(txt|md|csv|html?|xml)$/.test(lower);

    if (!isPdf && !isDocx && !isPptx && !isTxt) {
      skipped.push(basename);
      continue;
    }

    try {
      const entryBuf = new Uint8Array(await zip.files[name].async("arraybuffer"));
      let entryPages: { page: number; text: string }[] = [];
      if (isPdf) {
        const r = await pdfToPages(entryBuf);
        entryPages = r.pages;
      } else if (isDocx) {
        entryPages = await docxToPages(entryBuf);
      } else if (isPptx) {
        entryPages = await pptxToPages(entryBuf);
      } else {
        const text = Buffer.from(entryBuf).toString("utf8")
          .replace(/<[^>]+>/g, " ").replace(/\r\n/g, "\n")
          .replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
        if (text) entryPages = [{ page: 1, text }];
      }
      if (entryPages.length) {
        const body = entryPages.map(p => p.text).join("\n\n");
        pages.push({ page: ++pageNum, text: `## ${basename}\n\n${body}` });
      }
    } catch { skipped.push(basename); }
  }

  // Always emit a manifest page so content_text is non-null even for video-only ZIPs.
  if (skipped.length) {
    const note = skipped.map(n => `- ${n}`).join("\n");
    pages.push({ page: ++pageNum, text: `## ZIP contents (not yet extracted)\n\n${note}` });
  }

  return pages;
}

// Legacy .ppt is an OLE2 compound file (NOT a zip like .pptx), so jszip can't read it.
// Its text lives in the "PowerPoint Document" stream as a tree of binary records;
// the actual characters are in TextCharsAtom (0x0FA0, UTF-16LE) and TextBytesAtom
// (0x0FA8, 1-byte/char) leaf records. We walk the record stream, bucketing text by
// slide boundary (Slide container 0x03EE / SlidePersistAtom 0x03F3) and de-duplicating
// runs (the outline mirrors per-slide text, so the same string appears twice).
const RT_SLIDE         = 0x03EE; // Slide container
const RT_SLIDEPERSIST  = 0x03F3; // SlidePersistAtom — delimits slides in the outline
const RT_TEXTCHARS     = 0x0FA0; // TextCharsAtom — UTF-16LE
const RT_TEXTBYTES     = 0x0FA8; // TextBytesAtom — 1 byte/char (cp1252/latin1)

export function extractPptText(stream: Uint8Array): { page: number; text: string }[] {
  const buf = Buffer.from(stream);
  const seen = new Set<string>();
  const buckets: string[][] = [[]]; // buckets[0] = text before the first slide boundary
  const clean = (s: string) => s
    .replace(/\x00/g, "")
    .replace(/[\x0B\x0D]/g, "\n")          // vertical-tab / CR → line break
    .replace(/[\x00-\x08\x0C\x0E-\x1F]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  let p = 0;
  while (p + 8 <= buf.length) {
    const verInstance = buf.readUInt16LE(p);
    const recType     = buf.readUInt16LE(p + 2);
    const recLen      = buf.readUInt32LE(p + 4);
    const isContainer = (verInstance & 0x000F) === 0x000F;
    p += 8;

    if (recType === RT_SLIDE || recType === RT_SLIDEPERSIST) {
      buckets.push([]);                       // start a new slide
      if (recType === RT_SLIDEPERSIST) p += recLen; // it's an atom → skip its body
      continue;                               // Slide is a container → descend (don't skip)
    }
    if (isContainer) continue;                // descend into children (inline)

    if (recType === RT_TEXTCHARS || recType === RT_TEXTBYTES) {
      const raw = buf.subarray(p, Math.min(p + recLen, buf.length));
      const t = clean(raw.toString(recType === RT_TEXTCHARS ? "utf16le" : "latin1"));
      if (t && !seen.has(t)) { seen.add(t); buckets[buckets.length - 1].push(t); }
    }
    p += recLen;
  }

  const pages: { page: number; text: string }[] = [];
  for (const runs of buckets) {
    const text = runs.join("\n").trim();
    if (text) { const n = pages.length + 1; pages.push({ page: n, text: `# Slide ${n}\n\n${text}` }); }
  }
  return pages;
}

async function pptToPages(bytes: Uint8Array) {
  const mod: any = await import("cfb");
  const CFB = mod.default ?? mod;
  let container: any;
  try { container = CFB.read(bytes, { type: "buffer" }); }
  catch { throw new Error("Could not read .ppt (not a valid PowerPoint file) — try re-saving as .pptx"); }
  const entry = CFB.find(container, "PowerPoint Document") || CFB.find(container, "/PowerPoint Document");
  if (!entry?.content) throw new Error("No PowerPoint Document stream in .ppt — try re-saving as .pptx");
  return extractPptText(entry.content);
}

// Image → OCR via OpenAI vision (gpt-4o-mini). Returns the extracted text.
async function imageOcrToPages(base64: string, mime: string) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY not configured (needed for image OCR)");
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method:  "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      max_tokens: 4096,
      messages: [{ role: "user", content: [
        { type: "text", text: "Extract ALL text from this image verbatim, preserving line breaks and reading order. Output only the extracted text — no commentary." },
        { type: "image_url", image_url: { url: `data:${mime || "image/png"};base64,${base64}` } },
      ] }],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI vision ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  const text = String(json.choices?.[0]?.message?.content || "").trim();
  return text ? [{ page: 1, text }] : [];
}

// Audio/Video → transcript via OpenAI Whisper. Note: the request body must fit
// Vercel's ~4.5MB limit (base64), so this currently handles small clips; large
// media needs a Storage-based upload flow (follow-up).
async function transcribeToPages(bytes: Uint8Array, name: string, mime: string) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY not configured (needed for transcription)");
  const form = new FormData();
  form.append("file", new Blob([bytes as any], { type: mime || "application/octet-stream" }), name || "media");
  form.append("model", "whisper-1");
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST", headers: { Authorization: `Bearer ${key}` }, body: form,
  });
  if (!res.ok) throw new Error(`OpenAI transcription ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  const text = String(json.text || "").trim();
  return text ? [{ page: 1, text }] : [];
}

function youtubeId(url: string): string | null {
  const m = String(url).match(/(?:v=|youtu\.be\/|\/embed\/|\/shorts\/)([A-Za-z0-9_-]{11})/);
  if (m) return m[1];
  return /^[A-Za-z0-9_-]{11}$/.test(String(url).trim()) ? String(url).trim() : null;
}

// YouTube → transcript via the InnerTube ANDROID player. The caption URLs on the
// public watch page are now "pot"-gated (they return 200 with an EMPTY body without
// a proof-of-origin token). The ANDROID InnerTube client returns caption URLs that
// aren't gated, so we go through it. Fails gracefully (no captions / blocked).
const YT_INNERTUBE_KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8"; // public web key (fallback)
const YT_ANDROID_VER = "20.10.38";

async function youtubeToPages(url: string) {
  const id = youtubeId(url);
  if (!id) throw new Error("Couldn't parse a YouTube video id from that link.");
  const base = { "User-Agent": "Mozilla/5.0", "Accept-Language": "en-US,en" };

  // Pull the current InnerTube key from the watch page (falls back to the web key).
  let key = YT_INNERTUBE_KEY;
  try {
    const page = await (await fetch(`https://www.youtube.com/watch?v=${id}&hl=en`, { headers: base })).text();
    key = (page.match(/"INNERTUBE_API_KEY":"([^"]+)"/) || [])[1] || key;
  } catch { /* use fallback key */ }

  const pr = await fetch(`https://www.youtube.com/youtubei/v1/player?key=${key}`, {
    method:  "POST",
    headers: {
      ...base, "Content-Type": "application/json",
      "X-YouTube-Client-Name": "3", "X-YouTube-Client-Version": YT_ANDROID_VER,
      "User-Agent": `com.google.android.youtube/${YT_ANDROID_VER} (Linux; U; Android 14) gzip`,
    },
    body: JSON.stringify({
      context: { client: { clientName: "ANDROID", clientVersion: YT_ANDROID_VER, androidSdkVersion: 34, hl: "en" } },
      videoId: id,
    }),
  });
  const pj: any = await pr.json().catch(() => ({}));
  const tracks: any[] = pj?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
  if (!tracks.length) throw new Error("No captions are available for this video.");

  // Prefer English, and prefer human captions over auto-generated (asr) when both exist.
  const en = tracks.filter(t => (t.languageCode || "").startsWith("en"));
  const pool = en.length ? en : tracks;
  const track = pool.find(t => t.kind !== "asr") || pool[0];
  if (!track?.baseUrl) throw new Error("No caption track found.");

  // The ANDROID caption URL bakes in &fmt=srv3 (XML). SET fmt=json3 (replacing srv3)
  // for clean JSON; fall back to parsing srv3 <p>/<s> cues if json3 isn't returned.
  let text = "";
  try {
    const u = new URL(track.baseUrl); u.searchParams.set("fmt", "json3");
    const j: any = await (await fetch(u.toString(), { headers: base })).json();
    text = (j.events ?? [])
      .flatMap((e: any) => (e.segs ?? []).map((s: any) => s.utf8 ?? ""))
      .join("").replace(/\s+/g, " ").trim();
  } catch { /* fall back to srv3 XML */ }

  if (!text) {
    const xml = await (await fetch(track.baseUrl, { headers: base })).text();
    text = [...xml.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)]
      .map(mm => decodeXml(mm[1].replace(/<[^>]+>/g, ""))) // strip <s> tokens, keep their text + spacing
      .join(" ").replace(/\s+/g, " ").trim();
  }

  if (!text) throw new Error("The transcript came back empty.");
  return [{ page: 1, text }];
}

// Scanned PDF (no text layer) → OCR via OpenAI's PDF vision (Responses API
// `input_file`). The model reads the PDF directly — no client-side rasterization
// or canvas dependency. Bounded by OpenAI's PDF limits + our request-body size.
async function pdfOcrViaOpenAI(base64: string) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY not configured (needed to OCR scanned PDFs)");
  const res = await fetch("https://api.openai.com/v1/responses", {
    method:  "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      input: [{ role: "user", content: [
        { type: "input_text", text: "This is a scanned document. Extract ALL text from it verbatim, preserving reading order and structure. Output only the extracted text." },
        { type: "input_file", filename: "document.pdf", file_data: `data:application/pdf;base64,${base64}` },
      ] }],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI PDF OCR ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  let text = String(json.output_text || "");
  if (!text) {
    text = (json.output ?? [])
      .flatMap((o: any) => o.content ?? [])
      .map((c: any) => c?.text || "")
      .join("\n");
  }
  text = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return text ? [{ page: 1, text }] : [];
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { base64, storagePath, bucket = "media-uploads", keepFile = false, file_type, name, youtubeUrl, userId, courseId } = req.body ?? {};

  // YouTube — URL-based, no file bytes.
  if (youtubeUrl) {
    try {
      const pages = await youtubeToPages(youtubeUrl);
      const combined = pages.map(p => p.text).join("\n\n");
      return res.status(200).json({ text: combined, pages, chars: combined.length, pageCount: pages.length, truncated: false });
    } catch (err) {
      return res.status(200).json({ text: "", pages: [], error: err.message });
    }
  }

  // Large files (e.g. .ppt/.pdf over Vercel's ~4.5MB body limit) are uploaded straight to
  // Storage and read here server-side, so file size is never a limit — for any type.
  let bytes: Uint8Array;
  let b64: string = base64;
  if (storagePath) {
    const supabase = getSupabase();
    if (!supabase) return res.status(500).json({ error: "Storage not configured (SUPABASE_URL / SUPABASE_SERVICE_KEY)" });
    try {
      const { data: blob, error } = await supabase.storage.from(bucket).download(storagePath);
      if (error || !blob) throw new Error(error?.message || "file not found");
      bytes = new Uint8Array(await blob.arrayBuffer());
      b64 = Buffer.from(bytes).toString("base64"); // OCR paths still need base64
    } catch (e: any) {
      return res.status(400).json({ error: `storage download: ${e.message}` });
    }
    if (!keepFile) supabase.storage.from(bucket).remove([storagePath]).catch(() => {}); // best-effort temp cleanup for media-uploads
  } else {
    if (!base64) return res.status(400).json({ error: "base64, storagePath, or youtubeUrl required" });
    try { bytes = new Uint8Array(Buffer.from(base64, "base64")); }
    catch { return res.status(400).json({ error: "invalid base64" }); }
  }

  const ext = String(file_type || name || "").toLowerCase();
  const isImage = /image\/|\.(png|jpe?g|webp|gif|bmp|tiff?)\b/.test(ext);
  const isMedia = /audio\/|video\/|\.(mp3|wav|m4a|aac|ogg|flac|mp4|mov|webm|mpeg|mpga)\b/.test(ext);
  try {
    let pages: { page: number; text: string }[];
    let truncated = false;

    if (ext.includes("pdf")) {
      const r = await pdfToPages(bytes);
      pages = r.pages; truncated = r.truncated;
      // Scanned PDFs have no text layer → pdfjs returns ~nothing. Auto-OCR the PDF
      // via OpenAI vision (no manual image conversion needed).
      const chars = pages.reduce((n, p) => n + p.text.length, 0);
      if (chars < 40) pages = await pdfOcrViaOpenAI(b64);
    } else if (/wordprocessingml|\.docx\b/.test(ext)) {
      pages = await docxToPages(bytes);
    } else if (/presentationml|\.pptx\b/.test(ext)) {
      pages = await pptxToPages(bytes);
    } else if (/ms-powerpoint|\.ppt\b/.test(ext)) {
      pages = await pptToPages(bytes); // legacy binary PowerPoint (OLE2)
    } else if (/^zip$|\.zip\b|application\/zip/.test(ext) ||
               (bytes.length > 3 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04)) {
      pages = await zipToPages(bytes);
    } else if (isImage) {
      pages = await imageOcrToPages(b64, file_type);
    } else if (isMedia) {
      pages = await transcribeToPages(bytes, name, file_type);
    } else {
      // Plain text / html / md — strip tags, decode utf-8, keep line structure.
      let text = Buffer.from(bytes).toString("utf8").replace(/<[^>]+>/g, " ");
      if (text.length > SAFETY_CHARS) { text = text.slice(0, SAFETY_CHARS); truncated = true; }
      text = text.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
      pages = text ? [{ page: 1, text }] : [];
    }

    const combined = pages.map(p => p.text).join("\n\n");

    // Auto-ingest into RAG tables if userId provided — enables hybrid search for flashcards.
    // Fire-and-forget: never blocks the response or fails the extraction.
    if (userId && combined.trim()) {
      // MUST be awaited before responding. On serverless, work started after the
      // response is sent is frozen/killed — so the previous fire-and-forget ingest
      // silently never completed in production, which is why uploaded files never
      // reached the tutor. Awaiting keeps it inside the request so it actually runs.
      // (The document insert is the load-bearing part: even before embeddings land,
      // chunks are immediately keyword-searchable via full-text in hybrid search.)
      try {
        const { ingest, embedBatch } = await import("./rag");
        const result = await ingest({ userId, courseId: courseId ?? null, title: name ?? "Document", kind: "document", pages, text: combined });
        if (result.status === 200 && result.json?.documentId) {
          // Embed a few bounded batches inline (covers typical docs); kept small so a
          // huge file can't hit the function time limit. Any tail stays FTS-searchable.
          for (let i = 0; i < 3; i++) {
            const eb = await embedBatch({ userId, documentId: result.json.documentId });
            if (eb.json?.done) break;
          }
        } else if (result.status !== 200) {
          console.error("[extract] RAG ingest failed:", result.json?.error);
        }
      } catch (e: any) {
        console.error("[extract] RAG ingest error:", e?.message ?? e);
      }
    }

    return res.status(200).json({ text: combined, pages, chars: combined.length, pageCount: pages.length, truncated });
  } catch (err) {
    console.error("[extract] failed:", err.message);
    return res.status(200).json({ text: "", pages: [], error: err.message }); // soft-fail: caller stores no content
  }
}

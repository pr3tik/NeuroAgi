// background.js — NeuroAgi extension service worker
// Receives page content, uses Claude to extract academic data,
// then writes structured results to Supabase.
// Files never touch the user's disk — Supabase writes happen in memory.

// Shared with the popup: lmsApiSync() + extractPageContent(), injected into pages.
importScripts("shared-sync.js");

const SUPABASE_URL  = "https://wqgxpouhbwhwpzudrptp.supabase.co";
const SUPABASE_ANON = "sb_publishable_e-3KMudaL-iXf5GGsuiQaA_VW21ZZFA";

// Write to the isolated `neuroagi` schema — the SAME schema the app reads from
// (src/supabase.js + every api/* route set schema = 'neuroagi'). Both sides MUST
// match or synced data is invisible to the app. NOT public.* — that's Vincent's.
const SB_PROFILE = { "Accept-Profile": "public", "Content-Profile": "public" };

// ── Claude extraction via Vercel proxy ────────────────────────────────────────
// We route through our own API to keep ANTHROPIC_API_KEY server-side.
async function callClaude(system, userContent) {
  const res = await fetch("https://fschoolai.com/api/claude", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system,
      messages:   [{ role: "user", content: userContent }],
      max_tokens: 1500,
    }),
  });
  if (!res.ok) throw new Error(`Claude proxy ${res.status}`);
  const { content } = await res.json();
  return content ?? "";
}

const EXTRACT_SYSTEM = `You are an AI that extracts structured academic data from university portal pages.
The user will paste raw text scraped from their portal. Extract whatever academic data is present.

Return ONLY valid JSON with this exact shape — no explanation, no markdown:
{
  "pageType": "courses | assignments | grades | schedule | other",
  "courses": [
    { "name": "string", "code": "string", "instructor": "string", "term": "string" }
  ],
  "assignments": [
    { "name": "string", "course": "string", "dueDate": "string or null", "status": "pending|submitted|graded", "grade": "string or null", "pointsPossible": "string or null" }
  ],
  "grades": [
    { "course": "string", "grade": "string", "score": "string or null", "percentage": "string or null" }
  ]
}

Rules:
- Include ONLY fields you actually found on the page — leave arrays empty if no data
- dueDate: use the format you see on the page, or null
- grade: letter grade (A, B+, etc.) or percentage — whatever is shown
- If the page is a login page or has no academic data, return { "pageType": "other", "courses": [], "assignments": [], "grades": [] }`;

// ── Supabase write ────────────────────────────────────────────────────────────
// onConflict (e.g. "user_id,data_type") is required so PostgREST UPDATES the
// existing row instead of INSERTing a duplicate (which hits the unique constraint).
async function sbUpsert(table, rows, onConflict) {
  if (!rows?.length) return;
  const url = onConflict
    ? `${SUPABASE_URL}/rest/v1/${table}?on_conflict=${onConflict}`
    : `${SUPABASE_URL}/rest/v1/${table}`;
  const res = await fetch(url, {
    method:  "POST",
    headers: {
      "apikey":        SUPABASE_ANON,
      "Authorization": `Bearer ${SUPABASE_ANON}`,
      "Content-Type":  "application/json",
      "Prefer":        "resolution=merge-duplicates",
      ...SB_PROFILE,
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    const body = await res.text();
    console.error(`[NeuroAgi] Supabase ${table} error:`, body);
    throw new Error(`Supabase ${table} write failed (${res.status}): ${body.slice(0, 200)}`);
  }
}

// Read existing canvas_data blob, append new items (deduped by key), write back.
// Needed because auto-crawl captures many courses — each must add to the blob, not replace it.
async function appendBlob(userId, dataType, newItems, keyFn) {
  let existing = [];
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/canvas_data?user_id=eq.${userId}&data_type=eq.${dataType}&select=payload`,
      { headers: { "apikey": SUPABASE_ANON, "Authorization": `Bearer ${SUPABASE_ANON}`, ...SB_PROFILE } }
    );
    const rows = await res.json();
    if (Array.isArray(rows?.[0]?.payload)) existing = rows[0].payload;
  } catch { /* no existing row */ }

  // Merge + dedup
  const seen = new Set(existing.map(keyFn));
  const merged = [...existing];
  for (const item of newItems) {
    const k = keyFn(item);
    if (!seen.has(k)) { seen.add(k); merged.push(item); }
  }

  await sbUpsert("canvas_data", [{
    user_id:   userId,
    data_type: dataType,
    payload:   merged,
    synced_at: new Date().toISOString(),
  }], "user_id,data_type");
}

// ── Structured-table ingest ───────────────────────────────────────────────────
// Derive a stable join key from any course string:
//   "CPS420 - Discrete Structures" → "cps420"
//   "cp8204cps506_w26_01"          → "cp8204"
//   "CMTH108 - Linear Algebra"     → "cmth108"
function deriveCode(s) {
  const str = String(s || "").trim().toLowerCase();
  const m = str.match(/^[a-z]{2,}\s*\d+/);
  return m ? m[0].replace(/\s+/g, "") : str.slice(0, 24);
}

// Parse "85%", "85 / 100", "85" → number (0-100). Letter grades → null.
function parseScore(g) {
  if (g == null) return null;
  const s = String(g);
  const pct  = s.match(/(\d{1,3}(?:\.\d+)?)\s*%/);          if (pct)  return parseFloat(pct[1]);
  const frac = s.match(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/); if (frac) return (parseFloat(frac[1]) / parseFloat(frac[2])) * 100;
  const num  = s.match(/^\s*(\d{1,3}(?:\.\d+)?)\s*$/);      if (num)  return parseFloat(num[1]);
  return null;
}
function parseNum(v) {
  if (v == null) return null;
  const n = parseFloat(String(v).replace(/[^\d.]/g, ""));
  return isNaN(n) ? null : n;
}

async function ingestStructured(userId, parsed) {
  const now = new Date().toISOString();
  const courses     = parsed.courses     ?? [];
  const assignments = parsed.assignments ?? [];
  const grades      = parsed.grades      ?? [];

  // 1. Upsert courses (keyed by derived code in canvas_course_id)
  for (const c of courses) {
    const code = deriveCode(c.code || c.name);
    await sbUpsert("courses", [{
      user_id:          userId,
      canvas_course_id: code,
      name:             c.name || c.code || code,
      course_code:      c.code || code,
      source:           "extension",
      updated_at:       now,
    }], "user_id,canvas_course_id");
  }

  // 2. Grades → average percentage per course → set current_score
  const pctByCode = {};
  for (const g of grades) {
    const code = deriveCode(g.course);
    const pct  = parseScore(g.percentage) ?? parseScore(g.score);
    if (pct != null) (pctByCode[code] ||= []).push(pct);
  }
  for (const [code, pcts] of Object.entries(pctByCode)) {
    const avg = pcts.reduce((a, b) => a + b, 0) / pcts.length;
    await sbUpsert("courses", [{
      user_id:          userId,
      canvas_course_id: code,
      current_score:    Math.round(avg * 10) / 10,
      source:           "extension",
      updated_at:       now,
    }], "user_id,canvas_course_id");
  }

  // 3. Fetch course UUIDs so assignments can reference them
  const codeToId = {};
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/courses?user_id=eq.${userId}&select=id,canvas_course_id`,
      { headers: { "apikey": SUPABASE_ANON, "Authorization": `Bearer ${SUPABASE_ANON}`, ...SB_PROFILE } }
    );
    (await res.json()).forEach(r => { codeToId[r.canvas_course_id] = r.id; });
  } catch { /* leave empty */ }

  // 4. Upsert assignments (canvas_assignment_id = stable code_name key)
  for (const a of assignments) {
    const code = deriveCode(a.course);
    const due  = a.dueDate ? new Date(a.dueDate) : null;
    const submitted = a.status === "submitted" || a.status === "graded";
    await sbUpsert("assignments", [{
      user_id:              userId,
      course_id:            codeToId[code] ?? null,
      canvas_assignment_id: `${code}_${String(a.name || "").slice(0, 48)}`,
      title:                a.name || "Assignment",
      due_at:               due && !isNaN(due.getTime()) ? due.toISOString() : null,
      points_possible:      parseNum(a.pointsPossible),
      score:                parseScore(a.grade),
      submitted_at:         submitted ? now : null,
      missing:              a.status === "missing",
      source:               "extension",
      updated_at:           now,
    }], "user_id,canvas_assignment_id");
  }

  return { courses: courses.length, assignments: assignments.length, grades: grades.length };
}

// ── Main extraction handler ───────────────────────────────────────────────────
// ── Structured ingest straight from an LMS API (no Claude needed) ─────────────
async function ingestApiData(userId, data) {
  const now = new Date().toISOString();
  const courses     = data.courses     || [];
  const assignments = data.assignments || [];
  const files       = data.files       || [];

  // 1. Bulk-upsert courses, keyed by the real LMS course id.
  if (courses.length) {
    await sbUpsert("courses", courses.map(c => ({
      user_id:          userId,
      canvas_course_id: String(c.id),
      name:             c.name || c.course_code || String(c.id),
      course_code:      c.course_code || null,
      current_score:    c.current_score ?? null,
      final_score:      c.final_score ?? null,
      source:           "extension",
      updated_at:       now,
    })), "user_id,canvas_course_id");
  }

  // 2. Map course id → row UUID so assignments can reference it.
  const refToId = {};
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/courses?user_id=eq.${userId}&select=id,canvas_course_id`,
      { headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}`, ...SB_PROFILE } }
    );
    (await res.json()).forEach(r => { refToId[String(r.canvas_course_id)] = r.id; });
  } catch { /* leave empty */ }

  // 3. Bulk-upsert assignments. Dedupe by canvas_assignment_id first: PostgREST
  //    rejects a batch that tries to upsert the same conflict key twice
  //    ("ON CONFLICT DO UPDATE cannot affect row a second time", 21000).
  if (assignments.length) {
    const rowByKey = new Map();
    for (const a of assignments) {
      rowByKey.set(String(a.id), {
        user_id:              userId,
        course_id:            refToId[String(a.course_ref)] ?? null,
        canvas_assignment_id: String(a.id),
        title:                a.title || "Assignment",
        description:          a.description ?? null,   // instructions (stripped HTML) for the tutor
        due_at:               a.due_at || null,
        points_possible:      a.points_possible ?? null,
        score:                a.score ?? null,
        weight:               a.weight ?? null,
        weight_achieved:      a.weight_achieved ?? null,
        submitted_at:         a.submitted_at || null,
        missing:              Boolean(a.missing),
        source:               "extension",
        updated_at:           now,
      });
    }
    await sbUpsert("assignments", [...rowByKey.values()], "user_id,canvas_assignment_id");
  }

  // 4. Prune stale assignments: rows in these same courses from an earlier sync
  //    (older updated_at) that we did NOT just write — clears leftovers from
  //    removed/renamed items or older id schemes, preventing duplicate buildup.
  const syncedCourseIds = [...new Set(Object.values(refToId))];
  if (syncedCourseIds.length) {
    try {
      await fetch(
        `${SUPABASE_URL}/rest/v1/assignments?user_id=eq.${userId}&source=eq.extension` +
        `&course_id=in.(${syncedCourseIds.join(",")})&updated_at=lt.${now}`,
        { method: "DELETE", headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}`, ...SB_PROFILE } }
      );
    } catch (e) { console.warn("[NeuroAgi] assignment prune failed:", e.message); }
  }

  // 5. Files index. Tag each file to its course UUID and (Canvas submissions) its
  //    assignment UUID, then upsert + prune stale rows exactly like assignments.
  if (files.length) {
    const assignRefToId = {};
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/assignments?user_id=eq.${userId}&select=id,canvas_assignment_id`,
        { headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}`, ...SB_PROFILE } }
      );
      (await res.json()).forEach(r => { assignRefToId[String(r.canvas_assignment_id)] = r.id; });
    } catch { /* leave empty */ }

    const fileByKey = new Map();   // dedupe by lms_file_id (PostgREST rejects dup conflict keys)
    for (const f of files) {
      if (!f.id) continue;
      fileByKey.set(String(f.id), {
        user_id:       userId,
        course_id:     refToId[String(f.course_ref)] ?? null,
        assignment_id: f.assignment_ref != null ? (assignRefToId[String(f.assignment_ref)] ?? null) : null,
        lms_file_id:   String(f.id),
        name:          f.name || "file",
        file_type:     f.file_type || null,
        size_bytes:    f.size_bytes ?? null,
        source_url:    f.source_url || null,
        folder:        f.folder || null,
        status:        f.status || null,
        // content_text intentionally left unset — phase 2 extraction fills it.
        source:        "extension",
        updated_at:    now,
      });
    }
    await sbUpsert("files", [...fileByKey.values()], "user_id,lms_file_id");

    const syncedCourseIds = [...new Set(Object.values(refToId))];
    if (syncedCourseIds.length) {
      try {
        await fetch(
          `${SUPABASE_URL}/rest/v1/files?user_id=eq.${userId}&source=eq.extension` +
          `&course_id=in.(${syncedCourseIds.join(",")})&updated_at=lt.${now}`,
          { method: "DELETE", headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}`, ...SB_PROFILE } }
        );
      } catch (e) { console.warn("[NeuroAgi] file prune failed:", e.message); }
    }
  }

  return {
    courses:     courses.length,
    assignments: assignments.length,
    files:       files.length,
    grades:      courses.filter(c => c.current_score != null).length
                 + assignments.filter(a => a.score != null).length,
  };
}

// ── File content extraction + binary storage (phase 2 / layer b) ──────────────
// For each synced file we fetch its bytes through the student's LMS session (only
// the extension can — the urls are cookie-gated), then do TWO things:
//   1. Upload the raw bytes to the private `course-files` Storage bucket so the
//      student can open the ACTUAL document later (PDFs open inline) via a
//      server-minted signed URL — no LMS session needed. → files.storage_path
//   2. Send the bytes to /api/extract (PDF/text → plain text) so the tutor can
//      READ the file's contents, not just link it. → files.content_text
// Bounded + skips files that already have BOTH stored.
// NOTE: points at the same Vercel base as the Claude proxy — /api/extract must be
// DEPLOYED there. For local testing, set EXTRACT_URL to http://localhost:5173/api/extract.
const EXTRACT_URL = "https://fschoolai.com/api/extract";
const MAX_EXTRACT_PER_SYNC = 25;
const MAX_FILE_BYTES = 25_000_000;   // matches the bucket's file_size_limit

const MIME_BY_EXT = {
  pdf:  "application/pdf",
  doc:  "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ppt:  "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xls:  "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  txt:  "text/plain", csv: "text/csv", md: "text/markdown", rtf: "application/rtf",
  png:  "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
};

// Best-effort file extension for a synced file (from file_type, else its name).
function fileExt(f) {
  const t = String(f.file_type || "").toLowerCase();
  if (t && MIME_BY_EXT[t]) return t;
  const m = String(f.name || "").toLowerCase().match(/\.([a-z0-9]{1,5})$/);
  return m ? m[1] : "";
}

function abToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = "";
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(bin);
}

async function extractFileContents(userId, files) {
  // Build candidate list from passed files, or query Supabase for ALL pending files
  // when called from the alarm (no files passed) — this lets re-scheduled runs
  // cover files beyond the last sync's batch.
  let candidates;
  if (files?.length) {
    candidates = files.filter(f => f.source_url && f.id);
  } else {
    try {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/files?user_id=eq.${userId}&content_text=is.null&source_url=not.is.null&select=lms_file_id,name,file_type,source_url,course_id`,
        { headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}`, ...SB_PROFILE } }
      );
      candidates = r.ok ? (await r.json()).map(f => ({ ...f, id: f.lms_file_id })) : [];
    } catch { candidates = []; }
  }
  if (!candidates.length) return false;

  // Mark done by content_text only — storage_path is separate and its failure
  // should not cause a file to be re-extracted on every sync.
  let done = new Set();
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/files?user_id=eq.${userId}&content_text=not.is.null&select=lms_file_id`,
      { headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}`, ...SB_PROFILE } }
    );
    if (r.ok) done = new Set((await r.json()).map(x => String(x.lms_file_id)));
  } catch { /* fall through and re-attempt */ }

  const targets = candidates
    .filter(f => !done.has(String(f.id)))
    .slice(0, MAX_EXTRACT_PER_SYNC);

  if (!targets.length) return false;

  // Use the user's JWT for storage uploads — the anon key doesn't have write
  // permission on the course-files bucket.
  const { neuroagi_user } = await chrome.storage.local.get("neuroagi_user");
  const userJwt = neuroagi_user?.access_token || SUPABASE_ANON;

  for (const f of targets) {
    try {
      const key = encodeURIComponent(String(f.id));

      // YouTube links: send URL directly to extract for transcript — no bytes to fetch.
      if (f.file_type === "youtube") {
        const ex = await fetch(EXTRACT_URL, {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ youtubeUrl: f.source_url, name: f.name, userId }),
        }).then(r => (r.ok ? r.json() : null)).catch(() => null);
        if (ex?.text) {
          await fetch(`${SUPABASE_URL}/rest/v1/files?user_id=eq.${userId}&lms_file_id=eq.${key}`, {
            method:  "PATCH",
            headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}`, "Content-Type": "application/json", Prefer: "return=minimal", ...SB_PROFILE },
            body:    JSON.stringify({ content_text: ex.text }),
          });
        }
        continue;
      }

      // Google Drive / generic external links — no auth available, skip.
      if (f.file_type === "gdrive" || f.file_type === "link") continue;

      // Video files (MP4, MOV, etc.) are lecture recordings — too large to download
      // in a service worker. D2L also wraps them as ZIPs on download. Mark them so
      // they stop being retried; server-side Scribe transcription handles these.
      const isVideoType = /^(mp4|mov|webm|avi|mkv|wmv|flv|m4v|zip)$/.test(String(f.file_type || "").toLowerCase());
      if (isVideoType) {
        await fetch(`${SUPABASE_URL}/rest/v1/files?user_id=eq.${userId}&lms_file_id=eq.${key}`, {
          method:  "PATCH",
          headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}`, "Content-Type": "application/json", Prefer: "return=minimal", ...SB_PROFILE },
          body:    JSON.stringify({ content_text: "[Video lecture — transcription pending]" }),
        });
        continue;
      }

      // Fetch the file via the student's session (cookies).
      const resp = await fetch(f.source_url, { credentials: "include" });
      if (!resp.ok) continue;

      // D2L sometimes wraps downloads as application/zip even for non-ZIP file types.
      // If the response is a ZIP and we weren't expecting one, treat as video recording.
      const respCtype0 = (resp.headers.get("content-type") || "").split(";")[0].trim();
      if (respCtype0 === "application/zip") {
        await fetch(`${SUPABASE_URL}/rest/v1/files?user_id=eq.${userId}&lms_file_id=eq.${key}`, {
          method:  "PATCH",
          headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}`, "Content-Type": "application/json", Prefer: "return=minimal", ...SB_PROFILE },
          body:    JSON.stringify({ content_text: "[Video lecture — transcription pending]" }),
        });
        continue;
      }

      const buf = await resp.arrayBuffer();
      if (buf.byteLength > MAX_FILE_BYTES) continue;

      // If D2L returned an HTML page instead of a binary file, extract the text
      // and scrape any external links out of it — this captures content pages where
      // professors paste URLs (e.g. de.torontomu.ca course modules) rather than
      // uploading files directly.
      const respCtype = (resp.headers.get("content-type") || "").split(";")[0].trim();
      if (respCtype === "text/html") {
        const html = new TextDecoder().decode(buf);
        const text = html
          .replace(/<script[\s\S]*?<\/script>/gi, "")
          .replace(/<style[\s\S]*?<\/style>/gi, "")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        if (text.length > 100) {
          await fetch(`${SUPABASE_URL}/rest/v1/files?user_id=eq.${userId}&lms_file_id=eq.${key}`, {
            method:  "PATCH",
            headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}`, "Content-Type": "application/json", Prefer: "return=minimal", ...SB_PROFILE },
            body:    JSON.stringify({ content_text: text.slice(0, 50000) }),
          });
        }
        // Extract external links and add them as new file rows so they get indexed.
        if (f.course_id) {
          const now = new Date().toISOString();
          const seen = new Set();
          const newRows = [];
          for (const m of html.matchAll(/(?:href|src)=["'](https?:\/\/[^"'#][^"']*?)["']/gi)) {
            const url = m[1];
            if (seen.has(url) || /\/d2l\/|learn\.torontomu\.ca/i.test(url)) continue;
            seen.add(url);
            let h = 0;
            for (let i = 0; i < url.length; i++) h = (Math.imul(h, 31) + url.charCodeAt(i)) | 0;
            const isYt = /youtu\.?be/i.test(url);
            const isGd = /drive\.google|docs\.google/i.test(url);
            newRows.push({
              user_id: userId, course_id: f.course_id,
              lms_file_id: "page_link_" + (h >>> 0).toString(36),
              name: url.slice(0, 100),
              file_type: isYt ? "youtube" : isGd ? "gdrive" : "link",
              source_url: url, status: "external_link",
              source: "extension", updated_at: now,
            });
            if (newRows.length >= 10) break; // cap at 10 links per page
          }
          if (newRows.length) await sbUpsert("files", newRows, "user_id,lms_file_id").catch(() => {});
        }
        continue;
      }

      // 1. Upload raw bytes using the user's JWT so the bucket accepts the write.
      const ext  = fileExt(f);
      const safe = String(f.id).replace(/[^A-Za-z0-9._-]/g, "_") + (ext ? `.${ext}` : "");
      const path = `${userId}/${safe}`;
      const ctype = (resp.headers.get("content-type") || "").split(";")[0].trim()
                    || MIME_BY_EXT[ext] || "application/octet-stream";
      let storagePath = null;
      try {
        const up = await fetch(`${SUPABASE_URL}/storage/v1/object/course-files/${path}`, {
          method:  "POST",
          headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${userJwt}`, "Content-Type": ctype, "x-upsert": "true" },
          body:    buf,
        });
        if (up.ok) storagePath = path;
        else console.warn("[NeuroAgi] storage upload failed", up.status, await up.text().catch(() => ""));
      } catch (e) { console.warn("[NeuroAgi] storage upload error", e.message); }

      // 2. Extract readable text for the tutor.
      const ex = await fetch(EXTRACT_URL, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ base64: abToBase64(buf), file_type: f.file_type, name: f.name, userId }),
      }).then(r => (r.ok ? r.json() : null)).catch(() => null);

      const patch = {};
      if (ex?.text)    patch.content_text = ex.text;
      else if (storagePath) patch.content_text = "[File indexed — text extraction unavailable]";
      if (storagePath) patch.storage_path = storagePath;
      if (Object.keys(patch).length) {
        const pr = await fetch(`${SUPABASE_URL}/rest/v1/files?user_id=eq.${userId}&lms_file_id=eq.${key}`, {
          method:  "PATCH",
          headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}`, "Content-Type": "application/json", Prefer: "return=minimal", ...SB_PROFILE },
          body:    JSON.stringify(patch),
        });
        if (!pr.ok) console.warn("[NeuroAgi] patch failed", pr.status, await pr.text().catch(() => ""));
      }
    } catch { /* skip this file */ }
  }

  // Return true if we hit the batch limit — caller can re-schedule for the remainder.
  return targets.length >= MAX_EXTRACT_PER_SYNC;
}

async function extract(userId, pageContent, stepHint) {
  const { text, tables, url, title } = pageContent;

  const userContent = `Page URL: ${url}
Page title: ${title}
Step hint: I'm expecting to find "${stepHint}" data on this page.

Page content:
${text}

${tables ? `Tables found:\n${tables}` : ""}`;

  // Call Claude to parse
  const raw = await callClaude(EXTRACT_SYSTEM, userContent);

  // Parse JSON from Claude response — robustly extract the JSON object
  let parsed;
  try {
    let jsonStr = raw.trim();
    // Strip markdown code fences if present
    jsonStr = jsonStr.replace(/^```[a-z]*\s*/i, "").replace(/\s*```$/i, "");
    // Extract the outermost { ... } object even if Claude added prose around it
    const first = jsonStr.indexOf("{");
    const last  = jsonStr.lastIndexOf("}");
    if (first !== -1 && last !== -1 && last > first) {
      jsonStr = jsonStr.slice(first, last + 1);
    }
    parsed = JSON.parse(jsonStr);
  } catch (err) {
    console.error("[NeuroAgi] JSON parse failed. Raw was:", raw);
    throw new Error(`Could not parse Claude response: ${raw.slice(0, 120)}`);
  }

  if (parsed.pageType === "other") {
    return {
      ok:      true,
      message: "No academic data found on this page — try a different page",
      stats:   await getCurrentStats(userId),
    };
  }

  // Write to the structured courses + assignments tables so the WHOLE app
  // (dashboard, study page, AI tutor) sees the data — not just blobs.
  const counts = await ingestStructured(userId, parsed);
  const stats  = await getCurrentStats(userId);

  const parts = [];
  if (counts.courses)     parts.push(`${counts.courses} courses`);
  if (counts.assignments) parts.push(`${counts.assignments} assignments`);
  if (counts.grades)      parts.push(`${counts.grades} grades`);

  return {
    ok:      true,
    message: parts.length ? `Captured ${parts.join(", ")} ✓` : "Page captured — minimal data found",
    stats,
    counts,
  };
}

async function getCurrentStats(userId) {
  // Count rows in the structured tables (HEAD request returns Content-Range count)
  const stats = { courses: "—", assignments: "—", grades: "—", files: "—" };
  try {
    const headers = {
      "apikey": SUPABASE_ANON,
      "Authorization": `Bearer ${SUPABASE_ANON}`,
      "Prefer": "count=exact",
      "Range": "0-0",
      ...SB_PROFILE,
    };
    const countFrom = async (q) => {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/${q}`, { headers });
      const cr  = res.headers.get("content-range"); // e.g. "0-0/23"
      const total = cr?.split("/")?.[1];
      return total != null ? Number(total) : "—";
    };
    stats.courses     = await countFrom(`courses?user_id=eq.${userId}&source=eq.extension&select=id`);
    stats.assignments = await countFrom(`assignments?user_id=eq.${userId}&source=eq.extension&select=id`);
    stats.grades      = await countFrom(`assignments?user_id=eq.${userId}&source=eq.extension&score=not.is.null&select=id`);
    stats.files       = await countFrom(`files?user_id=eq.${userId}&source=eq.extension&select=id`);
  } catch { /* leave dashes */ }
  return stats;
}

// ── Adaptive auto-crawl ───────────────────────────────────────────────────────
// Instead of hardcoding each LMS's URLs, we DISCOVER navigation by reading the
// real links on the page, then LEARN (cache) the working URL template per domain
// so future syncs are instant. Falls back to Claude link-reasoning for portals
// the heuristics don't recognize, and self-heals when a template stops working.

const NAV_DISCOVERY_SYSTEM = `You help a browser extension navigate a student's university LMS — could be Canvas, Moodle, Blackboard, Brightspace/D2L, or anything else.
You get the current page URL and a list of on-page links ({t: visible text, h: url}). Identify navigation targets.
Return ONLY JSON, no prose, no markdown:
{
  "courseLinks": [{ "id": "short id from the url", "name": "course name", "href": "exact url" }],
  "assignmentsHref": "exact url of the link on THIS page leading to assignments/coursework/tasks, or null",
  "gradesHref": "exact url of the link on THIS page leading to grades/marks/results, or null"
}
Rules:
- courseLinks = links to individual course home pages only (ignore global nav, calendars, settings). Empty array if this isn't a course-list page.
- assignmentsHref / gradesHref = the single best link for the CURRENT course, or null if not present on this page.
- Always copy exact href strings from the input.`;

function parseClaudeJSON(raw) {
  let s = (raw || "").trim().replace(/^```[a-z]*\s*/i, "").replace(/\s*```$/i, "");
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a !== -1 && b > a) s = s.slice(a, b + 1);
  return JSON.parse(s);
}

// Claude fallback: reason over the page's links when heuristics come up empty.
async function discoverNav(pageContent, pageUrl) {
  const linkList = (pageContent.links || []).map(l => `${l.t} -> ${l.h}`).join("\n").slice(0, 8000);
  try { return parseClaudeJSON(await callClaude(NAV_DISCOVERY_SYSTEM, `Current page: ${pageUrl}\n\nLinks on this page:\n${linkList}`)); }
  catch { return { courseLinks: [], assignmentsHref: null, gradesHref: null }; }
}

// Cheap heuristic course-link detection for the common LMSs (no Claude call).
function harvestCourseLinks(links = []) {
  const pats = [
    /\/courses\/(\d+)/,                            // Canvas
    /[?&]ou=(\d+)/,                                // D2L Brightspace
    /\/course\/view\.php\?id=(\d+)/,               // Moodle
    /\/ultra\/courses\/_(\d+)_/,                   // Blackboard Ultra
    /\/webapps\/blackboard\/.*course_id=_(\d+)_/,  // Blackboard classic
  ];
  const byId = new Map();
  for (const l of links) {
    for (const p of pats) {
      const m = l.h.match(p);
      if (m) { if (!byId.has(m[1])) byId.set(m[1], { id: m[1], href: l.h, name: l.t || "" }); break; }
    }
  }
  return [...byId.values()];
}

// Pick a link by keyword on its visible text first, then its url.
function findLinkByKeywords(links = [], re) {
  return (links.find(l => re.test(l.t)) || links.find(l => re.test(l.h)) || null)?.h ?? null;
}

// Generalize a discovered URL into a reusable template by masking origin + course id.
function toTemplate(href, origin, id) {
  return href.split(origin).join("{origin}").split(id).join("{id}");
}
function fillTemplate(t, origin, id) {
  return t.split("{origin}").join(origin).split("{id}").join(id);
}

// Per-domain learned patterns — the "self-training" memory.
const PATTERNS_KEY = "neuroagi_portal_patterns";
async function getPattern(domain) {
  const { [PATTERNS_KEY]: all = {} } = await chrome.storage.local.get(PATTERNS_KEY);
  return all[domain] ?? null;
}
async function savePattern(domain, pattern) {
  const { [PATTERNS_KEY]: all = {} } = await chrome.storage.local.get(PATTERNS_KEY);
  all[domain] = { ...pattern, learnedAt: Date.now() };
  await chrome.storage.local.set({ [PATTERNS_KEY]: all });
}

async function autoCrawl(userId, pageContent, originTabId) {
  const baseUrl = (await chrome.tabs.get(originTabId)).url;
  const origin  = new URL(baseUrl).origin;
  const domain  = new URL(baseUrl).host;

  // 1. Discover the course list — heuristic first, Claude fallback.
  let courses = harvestCourseLinks(pageContent.links);
  if (courses.length === 0) {
    const disc = await discoverNav(pageContent, baseUrl);
    courses = (disc.courseLinks || []).filter(c => c.href && c.id);
  }
  if (courses.length === 0) return { totalAssignments: 0, totalGrades: 0, note: "no courses found on this page" };

  // 2. Load any learned URL templates for this portal.
  let tpl = await getPattern(domain);   // { assignmentsTemplate, gradesTemplate } | null

  let totalAssignments = 0, totalGrades = 0;

  for (const course of courses) {
    if (!course.id) continue;
    try {
      let assignUrl = tpl?.assignmentsTemplate ? fillTemplate(tpl.assignmentsTemplate, origin, course.id) : null;
      let gradesUrl = tpl?.gradesTemplate     ? fillTemplate(tpl.gradesTemplate, origin, course.id)     : null;

      // 3. No template yet → discover from this course's own page, then LEARN it.
      if (!assignUrl || !gradesUrl) {
        const coursePage = await fetchPageContent(course.href);
        const clinks = coursePage?.links || [];
        let aHref = assignUrl || findLinkByKeywords(clinks, /assignment|dropbox|coursework|\btask/i);
        let gHref = gradesUrl || findLinkByKeywords(clinks, /grade|\bmark|result|score|progress/i);
        if ((!aHref || !gHref) && clinks.length) {
          const disc = await discoverNav(coursePage, course.href);   // Claude fallback
          aHref = aHref || disc.assignmentsHref;
          gHref = gHref || disc.gradesHref;
        }
        assignUrl = aHref || assignUrl;
        gradesUrl = gHref || gradesUrl;
        if (!tpl && (aHref || gHref)) {
          tpl = {
            assignmentsTemplate: aHref ? toTemplate(aHref, origin, course.id) : null,
            gradesTemplate:      gHref ? toTemplate(gHref, origin, course.id) : null,
          };
          await savePattern(domain, tpl);  // reused for every later course + future syncs
        }
      }

      if (assignUrl) {
        const c = await fetchPageContent(assignUrl);
        if (c) { const r = await extract(userId, c, "assignments"); if (r.ok) totalAssignments += r.counts?.assignments ?? 0; }
      }
      if (gradesUrl) {
        const c = await fetchPageContent(gradesUrl);
        if (c) { const r = await extract(userId, c, "grades"); if (r.ok) totalGrades += r.counts?.grades ?? 0; }
      }
    } catch { /* skip failed course */ }
  }

  return { totalAssignments, totalGrades };
}

// Fetch a page's text content via a background tab (invisible to user)
async function fetchPageContent(url) {
  return new Promise((resolve) => {
    chrome.tabs.create({ url, active: false }, (tab) => {
      const tabId = tab.id;
      // Wait for page to load
      function onUpdated(updatedTabId, info) {
        if (updatedTabId !== tabId || info.status !== "complete") return;
        chrome.tabs.onUpdated.removeListener(onUpdated);
        // Inject content extractor
        chrome.scripting.executeScript(
          { target: { tabId }, func: extractPageContentFn },
          (results) => {
            chrome.tabs.remove(tabId); // close background tab
            resolve(results?.[0]?.result ?? null);
          }
        );
      }
      chrome.tabs.onUpdated.addListener(onUpdated);
      // Timeout after 10s
      setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(onUpdated);
        chrome.tabs.remove(tabId).catch(() => {});
        resolve(null);
      }, 10000);
    });
  });
}

// Shadow-DOM-piercing extractor injected into background tabs (D2L uses web components)
function extractPageContentFn() {
  function deepText(root) {
    let out = "";
    const skip = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "SVG"]);
    function walk(node) {
      if (!node) return;
      if (node.nodeType === Node.TEXT_NODE) {
        const t = node.textContent.replace(/\s+/g, " ").trim();
        if (t) out += t + " ";
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      if (skip.has(node.tagName)) return;
      if (node.shadowRoot) node.shadowRoot.childNodes.forEach(walk);
      if (node.tagName === "IFRAME") {
        try { const doc = node.contentDocument; if (doc?.body) walk(doc.body); } catch {}
        return;
      }
      node.childNodes.forEach(walk);
    }
    walk(root);
    return out;
  }
  const text = deepText(document.body).replace(/\s{3,}/g, "\n").trim().slice(0, 10000);
  const tables = [];
  function collectTables(root) {
    root.querySelectorAll?.("table").forEach(t => {
      const rows = [];
      t.querySelectorAll("tr").forEach(row => {
        const cells = [...row.querySelectorAll("th,td")].map(c => c.innerText.trim());
        if (cells.some(c => c)) rows.push(cells.join(" | "));
      });
      if (rows.length > 1) tables.push(rows.join("\n"));
    });
    root.querySelectorAll?.("*").forEach(el => { if (el.shadowRoot) collectTables(el.shadowRoot); });
  }
  collectTables(document);
  const links = [];
  const seenHref = new Set();
  function collectLinks(root) {
    root.querySelectorAll?.("a[href]").forEach(a => {
      const h = a.href;
      if (!h || seenHref.has(h) || !h.startsWith(location.origin)) return;
      seenHref.add(h);
      links.push({ t: (a.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80), h });
    });
    root.querySelectorAll?.("*").forEach(el => { if (el.shadowRoot) collectLinks(el.shadowRoot); });
  }
  collectLinks(document);
  return { text, tables: tables.slice(0, 5).join("\n\n"), url: location.href, title: document.title, links: links.slice(0, 200) };
}

// ── Auto-sync (content script trigger) ────────────────────────────────────────
// Same API-first → scrape-fallback flow as the popup button, but driven by the
// content script as the student browses. Because it runs the SAME lmsApiSync, it
// writes the SAME real course ids the popup does — so the upsert merges instead of
// creating duplicate rows. Scrape only runs when no LMS API is available.
async function autoSync(userId, tabId) {
  // Try the LMS API in the page's MAIN world (reads window.ENV / M.cfg / D2L token).
  let api = null;
  try {
    const [inj] = await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", func: lmsApiSync });
    api = inj?.result ?? null;
  } catch { /* injection blocked → fall through to scrape */ }

  if (api?.lms && (api.courses?.length || api.assignments?.length)) {
    await ingestApiData(userId, api);
    // Await (don't fire-and-forget): an MV3 service worker is killed once its
    // triggering event settles, which would abort an unawaited extraction loop.
    await extractFileContents(userId, api.files).catch(() => {});  // fill content_text
    const stats = await getCurrentStats(userId);
    const caps = [{ step: "courses", auto: true, timestamp: Date.now() }];
    if (api.assignments?.length) caps.push({ step: "assignments", auto: true, timestamp: Date.now() });
    if (api.files?.length) caps.push({ step: "files", auto: true, timestamp: Date.now() });
    if ((api.courses || []).some(c => c.current_score != null)) caps.push({ step: "grades", auto: true, timestamp: Date.now() });
    await chrome.storage.local.set({ neuroagi_captures: caps, neuroagi_stats: stats });
    return { ok: true, via: api.lms };
  }

  // Fallback: scrape the current page + Claude (unsupported portals only).
  try {
    const [{ result: pageContent }] = await chrome.scripting.executeScript({ target: { tabId }, func: extractPageContent });
    if (pageContent?.text) {
      const { neuroagi_captures = [] } = await chrome.storage.local.get("neuroagi_captures");
      const steps = ["courses", "assignments", "grades"];
      const stepHint = steps[Math.min(neuroagi_captures.length, steps.length - 1)];
      const result = await extract(userId, pageContent, stepHint);
      if (result.ok) {
        const updated = [...neuroagi_captures, { step: stepHint, auto: true, timestamp: Date.now() }];
        await chrome.storage.local.set({ neuroagi_captures: updated, neuroagi_stats: result.stats });
      }
      return { ok: true, via: "scrape" };
    }
  } catch { /* nothing usable on this page */ }
  return { ok: false };
}

// ── Always-on background sync (Option C) ──────────────────────────────────────
// A chrome.alarms timer wakes the service worker on a schedule so data syncs even
// when the student isn't reloading a portal page. The LMS API calls need a
// logged-in portal tab's session, so the alarm finds one and runs the SAME
// autoSync the content script uses — files included. If no portal tab is open it
// quietly waits for the next tick (nothing to sync against).
const SYNC_ALARM      = "neuroagi_periodic_sync";
const SYNC_PERIOD_MIN = 30;
const PORTAL_RE = [
  /\/d2l\//i,
  /instructure\.com/i,
  /\/course\/view\.php|\/my\/.*moodle|\/moodle\//i,
  /blackboard\.com|\/ultra\/|\/webapps\/blackboard/i,
];
const looksLikePortal = (url) => !!url && PORTAL_RE.some(re => re.test(url));

function ensureSyncAlarm() {
  chrome.alarms.get(SYNC_ALARM, (a) => {
    if (!a) chrome.alarms.create(SYNC_ALARM, { periodInMinutes: SYNC_PERIOD_MIN });
  });
}
chrome.runtime.onInstalled.addListener(ensureSyncAlarm);
chrome.runtime.onStartup.addListener(ensureSyncAlarm);

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === SYNC_ALARM) {
    const { neuroagi_user } = await chrome.storage.local.get("neuroagi_user");
    if (!neuroagi_user?.id) return;                       // not logged in
    const tabs = await chrome.tabs.query({});
    const portalTab = tabs.find(t => looksLikePortal(t.url));
    if (!portalTab) return;                               // no session context right now
    try {
      await autoSync(neuroagi_user.id, portalTab.id);
      await chrome.storage.local.set({ neuroagi_last_autosync: Date.now() });
    } catch (e) { console.warn("[NeuroAgi] periodic sync failed:", e.message); }
  }

  if (alarm.name === "neuroagi_file_extract") {
    try {
      const { neuroagi_extract_pending } = await chrome.storage.local.get("neuroagi_extract_pending");
      if (neuroagi_extract_pending?.userId) {
        const { userId, files } = neuroagi_extract_pending;
        // After the first batch, pass null so subsequent runs query ALL pending files
        // from Supabase rather than re-processing just the last sync's list.
        const hasMore = await extractFileContents(userId, files).catch(() => false);
        if (hasMore) {
          await chrome.storage.local.set({ neuroagi_extract_pending: { userId } });
          chrome.alarms.create("neuroagi_file_extract", { delayInMinutes: 0.5 }); // 30s between batches
        } else {
          await chrome.storage.local.remove("neuroagi_extract_pending");
        }
      }
    } catch (e) { console.warn("[NeuroAgi] file extraction alarm failed:", e.message); }
  }
});

// ── Message listener ──────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "NEUROAGI_EXTRACT") {
    extract(msg.userId, msg.pageContent, msg.stepHint)
      .then(result => sendResponse(result))
      .catch(err   => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (msg.type === "NEUROAGI_AUTO_SYNC") {
    const tabId = _sender.tab?.id;
    if (!tabId) { sendResponse({ ok: false, error: "no tab" }); return true; }
    autoSync(msg.userId, tabId)
      .then(r => sendResponse(r))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (msg.type === "NEUROAGI_AUTOCRAWL") {
    autoCrawl(msg.userId, msg.pageContent, msg.originTabId)
      .then(result => sendResponse({ ok: true, ...result }))
      .catch(err   => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (msg.type === "NEUROAGI_API_INGEST") {
    (async () => {
      const counts = await ingestApiData(msg.userId, msg.data);
      const stats  = await getCurrentStats(msg.userId);
      // Schedule file extraction via alarm so the popup response is not blocked by
      // it — extraction can take minutes per file (fetch + upload + /api/extract).
      // Store userId only; the alarm queries Supabase for all pending files itself.
      if (msg.data.files?.length) {
        await chrome.storage.local.set({
          neuroagi_extract_pending: { userId: msg.userId, files: msg.data.files },
        });
        chrome.alarms.create("neuroagi_file_extract", { delayInMinutes: 0.1 });
      }
      return { ok: true, counts, stats };
    })().then(sendResponse).catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (msg.type === "NEUROAGI_STATS") {
    getCurrentStats(msg.userId)
      .then(stats => sendResponse({ ok: true, stats }))
      .catch(err  => sendResponse({ ok: false, error: err.message }));
    return true;
  }
});

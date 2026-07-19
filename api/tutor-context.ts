// api/tutor-context.js — Dynamic context fetcher for chatbot agent upgrade
//
// FIRES:  before Claude responds, when the query seems to need live DB data
//         that isn't already in the system prompt
// READS:  Supabase — assignments, courses, flashcards — filtered to what's relevant
//         NeuroAGI Brain DB — brain.context_window (pre-cached student state)
//         Library — course_content (shared lecture notes, syllabus, announcements)
// WRITES: nothing — read-only
// RETURNS: a context string injected into the Claude call as an extra system section
//
// WHAT THIS SOLVES:
//   The system prompt has static context (top 5 assignments, course list, GPA).
//   But students ask specific questions: "What's my score in BIO 101?"
//   "What flashcards do I have for Media Studies?" "Which assignments am I missing?"
//   "What did the professor say about the rubric?" "What's in the syllabus for week 3?"
//   This endpoint detects those queries and fetches the exact data needed.
//
// BRAIN CONTEXT (NeuroAGI Brain DB):
//   brain.context_window is pre-cached by brain_scheduler (runs in background).
//   It contains: stress_level, momentum_state, active_deadline, recent_summary,
//   what_to_focus_on, what_not_to_mention — all pre-computed, 0ms read latency.
//   This is fetched in PARALLEL with FschoolAI DB queries (Promise.all).
//   Brain DB has ~600ms latency — pre-caching eliminates this from the hot path.
//
// LIBRARY AGENT:
//   Searches course_content (shared library) for relevant lecture notes, syllabus,
//   announcements, and module pages. Runs in parallel with brain fetch.
//   Returns top 3 scored snippets injected as [Source]: text blocks.
//
// QUERY CLASSIFICATION (done by Claude Haiku — fast, cheap):
//   assignment_detail  → fetch specific assignment(s) matching query
//   course_grades      → fetch all courses with scores
//   missing_late       → fetch missing/late assignments
//   flashcard_detail   → fetch flashcards for a specific course
//   none               → no DB fetch needed (but brain + library context still returned)
//
// NOTE: unlike most api/ files, vite.config.js imports this file STATICALLY at
// its own top level (a legacy pattern predating the handlerProxy() lazy-import
// factory used elsewhere). That means any static import chain from here that
// evaluates env-dependent code at module load (like rag.ts's top-level
// createClient() call) breaks `vite build` locally, since env vars aren't
// injected until request time. embed() below is imported dynamically inside
// the function body specifically to avoid that — don't change it to a static
// top-level import.

import { requireUserOr401 } from "./_auth.js";
// Safe to import statically — these build no Supabase client at module load (raw fetch only).
import { postgrestStore, recall, renderStudentBrainState } from "./_brain/kernel.js";
import { resolveFschoolPerson } from "./_brain/identity.js";
import { courseSourceBoost, courseSourceLabel } from "./course-source.js";
import { userUniversityId } from "./_reggie/canvasLive.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const supabaseUrl  = process.env.SUPABASE_URL;
  const supabaseKey  = process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_ANON_KEY;
  // Brain DB env vars (NeuroAGI) — optional, gracefully skipped if not configured
  const brainUrl = process.env.BRAIN_SUPABASE_URL;
  const brainKey = process.env.BRAIN_SUPABASE_KEY;

  if (!anthropicKey || !supabaseUrl || !supabaseKey) {
    return res.status(200).json({ context: null, reason: "missing env" });
  }

  const _uid = await requireUserOr401(req, res); if (!_uid) return;
  if (req.body && typeof req.body === "object") req.body.userId = _uid;
  const { userId, userMessage, courseIds = [], activeCourseId = null } = req.body ?? {};
  // Resolve the brain person from the verified user — never trust a body brainPersonId (that
  // let anyone read another user's brain context by passing their person id).
  let brainPersonId = null;
  { const sbU = process.env.SUPABASE_URL, sbK = process.env.SUPABASE_SERVICE_KEY;
    if (sbU && sbK) {
      const r = await fetch(`${sbU}/rest/v1/users?id=eq.${encodeURIComponent(userId)}&select=brain_person_id`, { headers: { apikey: sbK, Authorization: `Bearer ${sbK}` } }).catch(() => null);
      if (r && r.ok) brainPersonId = ((await r.json().catch(() => []))?.[0]?.brain_person_id) ?? null;
    } }
  if (!userId || !userMessage) return res.status(200).json({ context: null });

  const sbHeaders = {
    "apikey":        supabaseKey,
    "Authorization": `Bearer ${supabaseKey}`,
    "Content-Type":  "application/json",
    "Accept-Profile":  "public",   // unified on public.* (live fschoolai.com schema)
    "Content-Profile": "public",
  };

  // ── 0a. Fetch brain.context_window in parallel with classification ─────────
  // Pre-cached by brain_scheduler — no 600ms Brain DB penalty on hot path
  let brainContext = null;
  const brainFetch = (brainUrl && brainKey && brainPersonId)
    ? fetch(
        `${brainUrl}/rest/v1/context_window?person_id=eq.${brainPersonId}&select=stress_level,momentum_state,active_deadline,recent_summary,what_to_focus_on,what_not_to_mention&limit=1`,
        {
          headers: {
            "apikey":         brainKey,
            "Authorization":  `Bearer ${brainKey}`,
            "Content-Type":   "application/json",
            "Accept-Profile": "brain",   // context_window lives in brain schema
          },
        }
      ).then(r => r.ok ? r.json() : null).catch(() => null)
    : Promise.resolve(null);

  // ── 0a′. NeuroAGI kernel recall — the LIVE brain (product DB). Runs in parallel. ─────
  // Pulls the person's most-salient recent memories (digest / traits / focus / signals) via the
  // kernel and folds them into STUDENT BRAIN STATE. This is the real brain read now; the legacy
  // context_window fetch above stays only as a fallback until PR7. Ambient read → reinforce:false
  // (recalling the firehose every message must NOT keep everything alive and defeat decay).
  const kernelFetch = (supabaseUrl && supabaseKey)
    ? (async () => {
        try {
          const pid = brainPersonId ?? await resolveFschoolPerson({ url: supabaseUrl, key: supabaseKey }, userId);
          if (!pid) return null;
          const store = postgrestStore(supabaseUrl, supabaseKey);
          const mems = await recall(store, [`person:${pid}`], { limit: 15, reinforce: false });
          return mems.length ? mems : null;
        } catch { return null; }
      })()
    : Promise.resolve(null);

  // ── 0b. Library agent search — runs in parallel with brain fetch ───────────
  // Searches shared course_content for relevant lecture notes, syllabus, announcements
  const LIBRARY_SIGNALS = [
    "syllabus", "lecture", "notes", "slides", "professor", "prof",
    "rubric", "module", "week", "reading", "chapter", "announcement",
    "said", "mentioned", "covered", "taught", "according to", "from class",
    "what is", "what are", "explain", "define", "how does", "why does",
  ];
  const lowerMsg = userMessage.toLowerCase();
  const isLibraryQuery = LIBRARY_SIGNALS.some(s => lowerMsg.includes(s));

  const libraryFetch = (isLibraryQuery && supabaseUrl && supabaseKey)
    ? (async () => {
        try {
          // Extract keywords for search
          const stopWords = new Set(["the","a","an","is","are","was","were","be","have","has","do","does","will","would","could","should","i","my","me","we","you","it","this","that","and","or","but","for","in","on","at","to","of","with","about","from"]);
          const keywords = userMessage.toLowerCase().replace(/[^\w\s]/g, " ").split(/\s+/).filter(w => w.length > 2 && !stopWords.has(w)).slice(0, 6);

          if (!keywords.length) return null;

          // Build course filter
          const courseFilter = activeCourseId
            ? `course_id=eq.${encodeURIComponent(activeCourseId)}`
            : courseIds.length > 0
              ? `course_id=in.(${courseIds.map(c => encodeURIComponent(String(c))).join(",")})`
              : null;

          if (!courseFilter) return null;

          // BR-02 (Gap 8): scope the shared course library to the caller's own institution so
          // course facts can't cross schools. Degrade to unscoped when no Canvas is connected.
          const uni = await userUniversityId(userId);
          const uniFilter = uni ? `&university_id=eq.${encodeURIComponent(uni)}` : "";

          const libUrl = `${supabaseUrl}/rest/v1/course_content?${courseFilter}${uniFilter}&is_private=eq.false&select=id,content_type,text,summary,module_name,week_number,seen_by_count&order=seen_by_count.desc&limit=20`;
          const libResp = await fetch(libUrl, { headers: sbHeaders });
          if (!libResp.ok) return null;

          const rows = await libResp.json();
          if (!rows?.length) return null;

          // Score by keyword relevance
          const scored = rows.map(row => {
            const searchText = `${row.text || ""} ${row.summary || ""} ${row.module_name || ""}`.toLowerCase();
            let score = keywords.reduce((s, kw) => s + (searchText.match(new RegExp(kw, "g")) || []).length * 2, 0);
            score += Math.log1p(row.seen_by_count || 0) * 0.5;
            score += courseSourceBoost(row.content_type);
            return { ...row, score };
          }).filter(r => r.score > 0).sort((a, b) => b.score - a.score).slice(0, 3);

          if (!scored.length) return null;

          const snippets = scored.map(r => {
            const src = courseSourceLabel(r);
            const text = r.summary || (r.text ? r.text.slice(0, 400) : "");
            return `[${src}]: ${text}`;
          });

          return {
            text: snippets.join("\n\n"),
            sources: scored.map(r => ({ id: r.id, type: r.content_type, label: courseSourceLabel(r) })),
          };
        } catch { return null; }
      })()
    : Promise.resolve(null);

  // ── 0c. Pattern-recognition hint — runs in parallel, gated on the same
  // "student is asking to understand a concept" signal as the library search.
  // See supabase-teaching-strategies-migration.sql. Never compares this student
  // to any other student directly — only looks up this user's own affinity row.
  const strategyHintFetch = (isLibraryQuery && supabaseUrl && supabaseKey)
    ? (async () => {
        try {
          const { embed } = await import("./rag.js");
          const [queryEmbedding] = await embed([userMessage]);
          const r = await fetch(`${supabaseUrl}/rest/v1/rpc/find_teaching_strategy_hint`, {
            method:  "POST",
            headers: sbHeaders,
            body: JSON.stringify({ p_concept_embedding: queryEmbedding, p_user_id: userId, p_limit: 1 }),
          });
          if (!r.ok) return null;
          const rows = await r.json();
          return rows?.[0] ?? null;
        } catch { return null; }
      })()
    : Promise.resolve(null);

  // Resolve a keyword → matching files (with extracted content_text when present).
  // Shared by `file_lookup` AND `assignment_detail`: for many courses the actual
  // instructions live in an attached file, NOT the assignment's `description`
  // field (which is often empty), so an assignment query must also surface files.
  async function fetchFilesContext(kw, { contentChars = 4000, limit = 25 } = {}) {
    let courseIds = [];
    if (kw) {
      const cr = await fetch(
        `${supabaseUrl}/rest/v1/courses?user_id=eq.${userId}&select=id&or=(name.ilike.*${encodeURIComponent(kw)}*,course_code.ilike.*${encodeURIComponent(kw)}*)`,
        { headers: sbHeaders }
      );
      if (cr.ok) courseIds = (await cr.json()).map(c => c.id);
    }

    // Files with extracted content rank first (nulls last) so the model sees
    // readable text, not just an index of links — and so content-bearing files
    // aren't pushed off the end by the row `limit`.
    let url = `${supabaseUrl}/rest/v1/files?user_id=eq.${userId}&select=name,file_type,status,folder,source_url,storage_path,content_text,courses(name,course_code)&order=content_text.desc.nullslast,name.asc&limit=${limit}`;
    if (kw) {
      const k   = encodeURIComponent(kw);
      const ors = [`name.ilike.*${k}*`, `folder.ilike.*${k}*`];
      if (courseIds.length) ors.push(`course_id.in.(${courseIds.join(",")})`);
      url += `&or=(${ors.join(",")})`;
    }
    const r = await fetch(url, { headers: sbHeaders });
    if (!r.ok) return null;
    const rows = await r.json();
    if (!rows.length) return null;

    // Mint a signed link (private bucket) for stored files so the tutor can hand
    // the student a URL that opens the actual document. Done in parallel, capped.
    await Promise.all(
      rows.filter(f => f.storage_path).slice(0, 10).map(async (f) => {
        try {
          const s = await fetch(`${supabaseUrl}/storage/v1/object/sign/course-files/${f.storage_path}`, {
            method:  "POST",
            headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, "Content-Type": "application/json" },
            body:    JSON.stringify({ expiresIn: 3600 }),
          });
          if (s.ok) f._openUrl = `${supabaseUrl}/storage/v1${(await s.json()).signedURL}`;
        } catch { /* leave unlinked — content_text + source_url still available */ }
      })
    );

    const anyText = rows.some(f => f.content_text);
    const header = anyText
      ? "FILES (some include extracted CONTENT — use it to answer; 'open' is a ready-to-share link to the actual file):\n"
      : "FILES (synced index — share the 'open' link or source_url; don't invent contents):\n";
    return header + rows
      .map(f => {
        const course = f.courses?.course_code || f.courses?.name || "";
        const line = [
          `• ${f.name}`,
          f.file_type ? `(${f.file_type})` : null,
          course      ? `— ${course}` : null,
          f.status    ? `— ${f.status}` : null,
          f._openUrl   ? `— open: ${f._openUrl}` : (f.source_url ? `— ${f.source_url}` : null),
        ].filter(Boolean).join(" ");
        const body = kw && f.content_text
          ? `\n   content: ${String(f.content_text).slice(0, contentChars)}`
          : "";
        return line + body;
      })
      .join("\n");
  }

  // ── 1. Classify the query ──────────────────────────────────────────────────
  let queryType = "none";
  let keyword   = null;

  try {
    const classifyRes = await fetch("https://api.anthropic.com/v1/messages", {
      method:  "POST",
      headers: {
        "Content-Type":      "application/json",
        "x-api-key":         anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model:      "claude-haiku-4-5-20251001",
        max_tokens: 40,
        messages:   [{
          role: "user",
          content: `Classify this student query for a DB lookup. Return JSON only: {"type":"assignment_detail"|"course_grades"|"missing_late"|"flashcard_detail"|"file_lookup"|"none","keyword":"extracted course/assignment/file name or null"}

Query: "${userMessage.slice(0, 200)}"

Examples:
"What's my score in BIO 101?" → {"type":"course_grades","keyword":"BIO 101"}
"Which assignments am I missing?" → {"type":"missing_late","keyword":null}
"Show me my Physics flashcards" → {"type":"flashcard_detail","keyword":"Physics"}
"What's due for Media Studies essay?" → {"type":"assignment_detail","keyword":"Media Studies"}
"Do you have the Haskell project file?" → {"type":"file_lookup","keyword":"Haskell project"}
"What files / readings do I have for Linear Algebra?" → {"type":"file_lookup","keyword":"Linear Algebra"}
"Send me the syllabus" → {"type":"file_lookup","keyword":"syllabus"}
"How's my GPA?" → {"type":"none","keyword":null}
"What's up?" → {"type":"none","keyword":null}`,
        }],
      }),
    });

    if (classifyRes.ok) {
      const data = await classifyRes.json();
      const text = data.content?.[0]?.text?.trim() ?? "{}";
      // Strip possible markdown fences
      const clean = text.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(clean);
      queryType = parsed.type  ?? "none";
      keyword   = parsed.keyword ?? null;
    }
  } catch { /* fall through to none */ }

  // Await brain context, kernel recall, library, and the strategy hint (all in parallel)
  const [brainRows, kernelMems, librarySnippets, strategyHint] = await Promise.all([brainFetch, kernelFetch, libraryFetch, strategyHintFetch]);
  const brainWindow = brainRows?.[0] ?? null;
  if (brainWindow) {
    const parts = [];
    if (brainWindow.stress_level != null)  parts.push(`stress level: ${Math.round(brainWindow.stress_level)}/10`);
    if (brainWindow.momentum_state)        parts.push(`momentum: ${brainWindow.momentum_state}`);
    if (brainWindow.active_deadline)       parts.push(`active deadline: ${brainWindow.active_deadline}`);
    if (brainWindow.recent_summary)        parts.push(`\nRecent student context: ${brainWindow.recent_summary}`);
    if (brainWindow.what_to_focus_on)      parts.push(`\nFocus on: ${brainWindow.what_to_focus_on}`);
    if (brainWindow.what_not_to_mention)   parts.push(`\nAvoid mentioning: ${brainWindow.what_not_to_mention}`);
    if (parts.length) {
      brainContext = `STUDENT BRAIN STATE (NeuroAGI):\n${parts.join(" | ")}`;
    }
  }
  // Live kernel memories take precedence over the (legacy, usually-empty) context_window.
  const kernelState = renderStudentBrainState(kernelMems ?? []);
  if (kernelState) brainContext = kernelState;

  // Build library context block
  let libraryContext = null;
  if (librarySnippets?.text) {
    libraryContext = `COURSE LIBRARY (from your actual course materials):\n${librarySnippets.text}`;
  }
  const librarySources = librarySnippets?.sources ?? [];

  // A hint, never a script — the tutor may draw on it, not required to follow it.
  // strategyHintId/strategyHintKind are returned separately (not embedded in the
  // text) so the caller can report back later whether it actually helped, without
  // parsing prose — session-close.ts uses these to close the feedback loop.
  let strategyContext = null;
  const strategyHintId   = strategyHint?.strategy_id   ?? null;
  const strategyHintKind = strategyHint?.strategy_kind ?? null;
  if (strategyHint) {
    strategyContext = `PEDAGOGICAL NOTE (a technique that's worked before for a concept like this — use it if it fits, adapt it, don't force it): ${strategyHint.strategy_summary}`;
  }

  if (queryType === "none") {
    // Even if no DB query needed, return brain + library + strategy context if available
    const parts = [brainContext, libraryContext, strategyContext].filter(Boolean);
    return res.status(200).json({ context: parts.length ? parts.join("\n\n") : null, sources: librarySources, strategyHintId, strategyHintKind });
  }

  // ── 2. Fetch relevant data ─────────────────────────────────────────────────
  let context = null;

  try {
    if (queryType === "course_grades") {
      // All courses with scores
      let url = `${supabaseUrl}/rest/v1/courses?user_id=eq.${userId}&select=name,course_code,current_score,final_score,professor&order=name.asc`;
      if (keyword) url += `&or=(name.ilike.*${encodeURIComponent(keyword)}*,course_code.ilike.*${encodeURIComponent(keyword)}*)`;
      let r = await fetch(url, { headers: sbHeaders });
      // professor may not exist yet (pre-migration) — a bad column 400s the whole select, so retry without it.
      if (!r.ok) r = await fetch(url.replace(",professor", ""), { headers: sbHeaders });
      if (r.ok) {
        const rows = await r.json();
        if (rows.length) {
          context = "LIVE GRADE DATA:\n" + rows
            .map(c => `• ${c.course_code ?? ""} ${c.name}: current ${c.current_score ?? "N/A"}%, final ${c.final_score ?? "N/A"}%${c.professor ? ` — Prof. ${c.professor}` : ""}`)
            .join("\n");
        }
      }
    }

    else if (queryType === "missing_late") {
      const r = await fetch(
        `${supabaseUrl}/rest/v1/assignments?user_id=eq.${userId}&or=(missing.eq.true,late.eq.true)&select=title,due_at,missing,late,score,points_possible&order=due_at.desc&limit=15`,
        { headers: sbHeaders }
      );
      if (r.ok) {
        const rows = await r.json();
        if (rows.length) {
          context = "MISSING / LATE ASSIGNMENTS:\n" + rows
            .map(a => `• ${a.title} — ${a.missing ? "MISSING" : "LATE"} — due ${a.due_at ? new Date(a.due_at).toLocaleDateString() : "unknown"}${a.score != null ? ` — scored ${a.score}/${a.points_possible}` : ""}`)
            .join("\n");
        } else {
          context = "MISSING / LATE ASSIGNMENTS: None found — all caught up.";
        }
      }
    }

    else if (queryType === "assignment_detail") {
      // `description` = the assignment instructions, so the tutor can advise on what
      // the work actually requires (keyword-matched queries pull the most detail).
      let url = `${supabaseUrl}/rest/v1/assignments?user_id=eq.${userId}&select=title,due_at,score,points_possible,missing,late,submitted_at,manual_done_at,description&order=due_at.asc&limit=20`;
      if (keyword) url += `&title=ilike.*${encodeURIComponent(keyword)}*`;
      const r = await fetch(url, { headers: sbHeaders });
      if (r.ok) {
        const rows = await r.json();
        if (rows.length) {
          // When the query targets a specific assignment (keyword), include the full
          // instructions for the top matches; otherwise just the one-line summary.
          context = "ASSIGNMENT DETAILS:\n" + rows
            .map(a => {
              const line = [
                `• ${a.title}`,
                a.due_at        ? `due ${new Date(a.due_at).toLocaleDateString()}` : null,
                a.score != null ? `score ${a.score}/${a.points_possible}` : null,
                (a.submitted_at || a.manual_done_at) ? `submitted` : null,
                a.missing       ? "MISSING" : null,
                a.late          ? "LATE"    : null,
              ].filter(Boolean).join(" | ");
              const instr = keyword && a.description
                ? `\n   instructions: ${String(a.description).slice(0, 1200)}`
                : "";
              return line + instr;
            })
            .join("\n");
        }
      }
      // The assignment's own `description` is frequently empty — the real brief
      // lives in an attached file. Always append matching file content so
      // "guide me through <assignment>" can actually read the instructions.
      if (keyword) {
        const filesCtx = await fetchFilesContext(keyword, { contentChars: 6000, limit: 8 });
        if (filesCtx) context = (context ? context + "\n\n" : "") + filesCtx;
      }
    }

    else if (queryType === "file_lookup") {
      // Resolves the keyword against file name/folder AND course (so "Linear
      // Algebra" and "Haskell project" both work) and surfaces extracted content.
      context = await fetchFilesContext(keyword)
        ?? "FILES: none matching that in the synced index.";
    }

    else if (queryType === "flashcard_detail") {
      // Find course_id first
      let courseUrl = `${supabaseUrl}/rest/v1/courses?user_id=eq.${userId}&select=id,name,course_code`;
      if (keyword) courseUrl += `&or=(name.ilike.*${encodeURIComponent(keyword)}*,course_code.ilike.*${encodeURIComponent(keyword)}*)`;
      const cr = await fetch(courseUrl, { headers: sbHeaders });
      if (cr.ok) {
        const courses = await cr.json();
        if (courses.length) {
          const courseId = courses[0].id;
          const fr = await fetch(
            `${supabaseUrl}/rest/v1/flashcards?user_id=eq.${userId}&course_id=eq.${courseId}&select=cards`,
            { headers: sbHeaders }
          );
          if (fr.ok) {
            const frows = await fr.json();
            const cards = frows?.[0]?.cards;
            if (cards?.length) {
              context = `FLASHCARDS for ${courses[0].name}:\n` + cards
                .slice(0, 8)
                .map(c => `Q: ${c.question}\nA: ${c.answer}`)
                .join("\n---\n");
            }
          }
        }
      }
    }
  } catch (err) {
    console.error("[tutor-context] fetch error:", err.message);
  }

  // Merge all context layers: brain + library + strategy hint + DB
  const contextParts = [brainContext, libraryContext, strategyContext, context].filter(Boolean);
  return res.status(200).json({ context: contextParts.length ? contextParts.join("\n\n") : null, sources: librarySources, strategyHintId, strategyHintKind });
}

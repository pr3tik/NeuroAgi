// api/office-hours.ts — Office Hours Prep: generate targeted, gap-grounded
// questions before a student meets their professor, and capture what was
// learned afterward. Action-routed:
//   POST /api/office-hours?action=prep     { userId, courseId, courseName,
//                                             professorName?, hoursFromNow? }
//                                           → { questions, context_used }
//   POST /api/office-hours?action=capture  { userId, courseId, sessionNotes,
//                                             questionIds? }               → { ok }
//
// Data sources: tutor_mind (living mind), tutor_impressions (recent
// observations), assignments (what's due), course_content + files (professor's
// actual language — including any Digest Lecture transcripts already
// ingested), and optionally the Brain DB's knowledge_gaps[] if configured.

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const SONNET_MODEL = "claude-sonnet-4-6";
const HAIKU_MODEL = "claude-haiku-4-5-20251001";

function sbHeaders(key) {
  return {
    "apikey": key,
    "Authorization": `Bearer ${key}`,
    "Content-Type": "application/json",
    "Accept-Profile": "public",
    "Content-Profile": "public",
  };
}

async function askClaude(key, model, content, maxTokens) {
  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: "user", content }] }),
  });
  if (!res.ok) throw new Error(`Claude ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return data.content?.[0]?.text ?? "";
}

function parseJsonLoose(text, fallback) {
  const stripped = String(text || "").replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try { return JSON.parse(stripped); } catch { return fallback; }
}

// ── prep: generate 5-7 targeted questions ────────────────────────────────────
async function prep(body, supabaseUrl, supabaseKey, anthropicKey) {
  const { userId, courseId, courseName, professorName, hoursFromNow } = body ?? {};
  if (!userId || !courseId) return { status: 400, json: { error: "userId and courseId required" } };

  const headers = sbHeaders(supabaseKey);

  // ── Living mind + recent impressions ──────────────────────────────────────
  let mindDoc = null, impressions = [];
  try {
    const [mindRes, impRes] = await Promise.all([
      fetch(`${supabaseUrl}/rest/v1/tutor_mind?user_id=eq.${userId}&select=mind_doc`, { headers }),
      fetch(`${supabaseUrl}/rest/v1/tutor_impressions?user_id=eq.${userId}&order=created_at.desc&limit=10&select=impression`, { headers }),
    ]);
    if (mindRes.ok) mindDoc = (await mindRes.json())?.[0]?.mind_doc ?? null;
    if (impRes.ok) impressions = await impRes.json();
  } catch { /* non-fatal — degrade gracefully */ }

  // ── Open assignments for this course ──────────────────────────────────────
  let assignments = [];
  try {
    const aRes = await fetch(
      `${supabaseUrl}/rest/v1/assignments?user_id=eq.${userId}&course_id=eq.${courseId}&submitted_at=is.null&select=title,description,due_at,points_possible&order=due_at.asc&limit=10`,
      { headers }
    );
    if (aRes.ok) assignments = await aRes.json();
  } catch { /* non-fatal */ }

  // ── Course material context: course_content (professor's language) + files (ingested transcripts) ──
  let courseSnippets = [], fileSnippets = [];
  try {
    const cRes = await fetch(`${supabaseUrl}/rest/v1/courses?id=eq.${courseId}&select=canvas_course_id,name,course_code`, { headers });
    const course = cRes.ok ? (await cRes.json())?.[0] : null;
    if (course?.canvas_course_id) {
      const ccRes = await fetch(
        `${supabaseUrl}/rest/v1/course_content?canvas_course_id=eq.${course.canvas_course_id}&select=content_type,summary,text,module_name&order=week_number.desc&limit=3`,
        { headers }
      );
      if (ccRes.ok) courseSnippets = await ccRes.json();
    }
  } catch { /* non-fatal */ }
  try {
    const fRes = await fetch(
      `${supabaseUrl}/rest/v1/files?user_id=eq.${userId}&course_id=eq.${courseId}&select=name,file_type&order=created_at.desc&limit=2`,
      { headers }
    );
    if (fRes.ok) fileSnippets = await fRes.json();
  } catch { /* non-fatal */ }

  // ── Optional Brain DB knowledge gaps ───────────────────────────────────────
  let knowledgeGaps = [];
  const brainUrl = process.env.BRAIN_SUPABASE_URL, brainKey = process.env.BRAIN_SUPABASE_KEY;
  if (brainUrl && brainKey) {
    try {
      const bRes = await fetch(`${brainUrl}/rest/v1/brain_context?user_id=eq.${userId}&select=knowledge_gaps`, { headers: sbHeaders(brainKey) });
      if (bRes.ok) knowledgeGaps = (await bRes.json())?.[0]?.knowledge_gaps ?? [];
    } catch { /* Brain DB is optional enrichment — never block prep on it */ }
  }

  const impressionList = impressions.map(i => `• ${i.impression}`).join("\n") || "None";
  const assignmentList = assignments.map(a =>
    `• ${a.title}${a.due_at ? ` (due ${new Date(a.due_at).toLocaleDateString()})` : ""}${a.description ? `: ${a.description.slice(0, 150)}` : ""}`
  ).join("\n") || "None";
  const materialContext = [
    ...courseSnippets.map(s => `[${s.content_type}${s.module_name ? " — " + s.module_name : ""}] ${s.summary || (s.text || "").slice(0, 300)}`),
    ...fileSnippets.map(f => `[Ingested file] ${f.name}`),
  ].join("\n") || "None available";
  const gapsList = Array.isArray(knowledgeGaps) && knowledgeGaps.length
    ? knowledgeGaps.map(g => `• ${typeof g === "string" ? g : JSON.stringify(g)}`).join("\n")
    : null;

  const prompt = `You are an academic tutor helping a student prepare for office hours with their professor.

STUDENT PROFILE (from living mind):
${mindDoc ?? "No living mind yet — first session."}

RECENT OBSERVATIONS:
${impressionList}

COURSE: ${courseName ?? "Unknown course"}
PROFESSOR: ${professorName || "the professor"}
${hoursFromNow != null ? `OFFICE HOURS IN: ${hoursFromNow}h` : ""}

OPEN ASSIGNMENTS (what's currently due):
${assignmentList}

COURSE MATERIAL CONTEXT (professor's language and examples):
${materialContext}
${gapsList ? `\nKNOWLEDGE GAPS (from Brain DB):\n${gapsList}` : ""}

TASK:
Generate exactly 5-7 office hours questions for this student.

Each question must:
1. Be tied to a SPECIFIC gap or confusion from the student profile above
2. Use the professor's own terminology (from course material context) when available
3. Be formulated professionally — the student can say this out loud directly
4. Not be generic ("can you explain X?") — be specific
5. If an open assignment is relevant, reference it

Return ONLY JSON, no markdown fences:
{"questions": [{"id": "q1", "gap": "one-sentence description of what gap this addresses", "question": "the full question the student can say out loud", "priority": "high"|"medium", "linked_assignment": "assignment title or null"}]}`;

  const text = await askClaude(anthropicKey, SONNET_MODEL, prompt, 1600);
  const parsed = parseJsonLoose(text, { questions: [] });
  const questions = Array.isArray(parsed.questions) ? parsed.questions : [];
  if (!questions.length) return { status: 502, json: { error: "question generation returned invalid JSON" } };

  return { status: 200, json: { questions, context_used: mindDoc ? "living mind + impressions + course material" : "impressions + course material only" } };
}

// ── capture: distill session notes into a living-mind update ────────────────
async function capture(body, supabaseUrl, supabaseKey, anthropicKey) {
  const { userId, courseId, sessionNotes, questionIds } = body ?? {};
  if (!userId || !sessionNotes) return { status: 400, json: { error: "userId and sessionNotes required" } };

  const headers = sbHeaders(supabaseKey);

  let existingMind = null;
  try {
    const mindRes = await fetch(`${supabaseUrl}/rest/v1/tutor_mind?user_id=eq.${userId}&select=mind_doc`, { headers });
    if (mindRes.ok) existingMind = (await mindRes.json())?.[0]?.mind_doc ?? null;
  } catch { /* non-fatal */ }

  const prompt = `A student just came back from office hours. Distill what was clarified into ONE short paragraph (max 3 sentences), written for a tutor's living mind about this student — note what gap was resolved, and how confidently.

SESSION NOTES (what the student says was clarified):
${sessionNotes}

Return ONLY the paragraph, no preamble, no markdown.`;
  const gapUpdate = (await askClaude(anthropicKey, HAIKU_MODEL, prompt, 200)).trim();
  if (!gapUpdate) return { status: 502, json: { error: "empty distillation" } };

  const dateLabel = new Date().toLocaleDateString();
  const appended = `${existingMind ?? ""}\n\nOffice hours ${dateLabel}: ${gapUpdate}`.trim();

  const upsertRes = await fetch(`${supabaseUrl}/rest/v1/tutor_mind`, {
    method: "POST",
    headers: { ...headers, "Prefer": "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ user_id: userId, mind_doc: appended, updated_at: new Date().toISOString() }),
  });
  if (!upsertRes.ok) return { status: 502, json: { error: `tutor_mind upsert failed: ${(await upsertRes.text()).slice(0, 200)}` } };

  // Best-effort Brain DB signal — never blocks capture on failure.
  const brainUrl = process.env.BRAIN_SUPABASE_URL, brainKey = process.env.BRAIN_SUPABASE_KEY;
  if (brainUrl && brainKey && courseId) {
    fetch(`${brainUrl}/rest/v1/signals`, {
      method: "POST",
      headers: { ...sbHeaders(brainKey), "Prefer": "return=minimal" },
      body: JSON.stringify({ user_id: userId, course_id: courseId, kind: "office_hours_clarified", detail: gapUpdate, created_at: new Date().toISOString() }),
    }).catch(() => {});
  }

  return { status: 200, json: { ok: true, gapUpdate, questionsAsked: Array.isArray(questionIds) ? questionIds.length : 0 } };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_ANON_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!supabaseUrl || !supabaseKey) return res.status(500).json({ error: "Supabase env not configured" });
  if (!anthropicKey) return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured" });

  const action = req.query?.action;
  try {
    const result = action === "prep"    ? await prep(req.body, supabaseUrl, supabaseKey, anthropicKey)
                 : action === "capture" ? await capture(req.body, supabaseUrl, supabaseKey, anthropicKey)
                 : { status: 400, json: { error: "Unknown action. Use ?action=prep|capture" } };
    return res.status(result.status).json(result.json);
  } catch (err) {
    console.error("[office-hours] error:", err?.message ?? err);
    return res.status(502).json({ error: err?.message ?? "office-hours error" });
  }
}

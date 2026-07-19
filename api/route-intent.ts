// api/route-intent.ts — classify a student query into a DB-lookup intent so the tutor
// knows what live data to fetch. Extracted from the inline classifier in
// api/tutor-context.ts, now behind the gateway (task:'classify' → Haiku). Fail-open:
// any error/parse failure returns {type:'none', keyword:null} (same as the inline impl).
// Contract: fschoolai_tool_contracts.md §F (route.intent).
import { callModel } from "./_gateway.js";
import { rateLimit } from "./_ratelimit.js";

const TYPES = ["assignment_detail", "course_grades", "missing_late", "flashcard_detail", "file_lookup", "none"];

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  // This endpoint reaches the paid gateway (callModel) but has no auth (public: used in
  // logged-out/demo flows). Rate-limit before any model call so it can't be used as an
  // unthrottled LLM proxy (SEC-01 F-2). Same limits as api/claude.ts.
  if (!(await rateLimit(req, res, "route-intent", { anonMax: 20, authMax: 120 }))) return;
  const { userMessage } = req.body ?? {};
  if (!userMessage || !String(userMessage).trim()) {
    return res.status(400).json({ error: "userMessage is required" });
  }

  // JSON.stringify safely quotes + escapes the message so a stray double-quote can't
  // break out of the delimiter and steer the classifier.
  const prompt = `Classify this student query for a DB lookup. Return JSON only: {"type":"assignment_detail"|"course_grades"|"missing_late"|"flashcard_detail"|"file_lookup"|"none","keyword":"extracted course/assignment/file name or null"}

Query: ${JSON.stringify(String(userMessage).slice(0, 200))}

Examples:
"What's my score in BIO 101?" → {"type":"course_grades","keyword":"BIO 101"}
"Which assignments am I missing?" → {"type":"missing_late","keyword":null}
"Show me my Physics flashcards" → {"type":"flashcard_detail","keyword":"Physics"}
"What's due for Media Studies essay?" → {"type":"assignment_detail","keyword":"Media Studies"}
"Do you have the Haskell project file?" → {"type":"file_lookup","keyword":"Haskell project"}
"How's my GPA?" → {"type":"none","keyword":null}
"What's up?" → {"type":"none","keyword":null}`;

  let type = "none";
  let keyword: string | null = null;
  try {
    const r = await callModel({
      task: "classify",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 120, // 40 could truncate a long extracted keyword → JSON parse fail → fail-open loss

      metadata: { tool: "route.intent" },
    });
    if (r.ok) {
      const clean = String(r.content || "").replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(clean);
      if (TYPES.includes(parsed?.type)) type = parsed.type;
      keyword = parsed?.keyword ?? null;
    }
  } catch { /* fall through to none */ }

  return res.status(200).json({ type, keyword });
}

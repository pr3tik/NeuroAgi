/**
 * Library Agent — api/library-agent.js
 *
 * Semantic search over the shared course_content library.
 * Called by tutor-context.js before every Reggie response.
 *
 * Architecture:
 *   1. Detect if the student's question is a "library query" (course-specific knowledge)
 *   2. If yes: search course_content by keyword + courseId + content_type
 *   3. Return ranked snippets (max 3) for injection into the tutor prompt
 *   4. Private content (is_private=true) is only returned for the content owner
 *
 * Shared vs Private:
 *   Shared (is_private=false): syllabus, lecture notes, announcements, rubrics, module pages
 *   Private (is_private=true): inbox messages, personal submissions, grades
 */

import { createClient } from "@supabase/supabase-js";
import { requireUserOr401 } from "./_auth.js";
import { userUniversityId } from "./_reggie/canvasLive.js";

// Lazy client — module-load createClient crashes the Node-20 CI suite (supabase-js
// realtime needs WebSocket) and breaks import-safety for Reggie's in-process tool calls.
let _supabase: any = null;
function db() {
  if (!_supabase) {
    _supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  }
  return _supabase;
}

// Content types that are always private (never shared across students)
const PRIVATE_CONTENT_TYPES = new Set(["inbox", "submission", "grade", "personal_note"]);

// Keywords that signal a library query (student asking about course material)
const LIBRARY_QUERY_SIGNALS = [
  "syllabus", "lecture", "notes", "slides", "professor", "prof",
  "assignment", "rubric", "due", "deadline", "module", "week",
  "reading", "textbook", "chapter", "exam", "midterm", "final",
  "announcement", "said", "mentioned", "covered", "taught",
  "what is", "what are", "explain", "define", "how does", "why does",
  "according to", "based on", "from class", "in class", "course",
];

/**
 * Detect if a message is likely a library query.
 * Returns true if the message contains course-specific knowledge signals.
 */
function isLibraryQuery(message) {
  const lower = message.toLowerCase();
  return LIBRARY_QUERY_SIGNALS.some(signal => lower.includes(signal));
}

/**
 * Extract keywords from a message for search.
 * Removes stop words and returns meaningful terms.
 */
function extractKeywords(message) {
  const stopWords = new Set([
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "must", "can", "i", "my", "me", "we", "our",
    "you", "your", "it", "its", "this", "that", "these", "those", "what",
    "how", "why", "when", "where", "who", "which", "and", "or", "but",
    "for", "in", "on", "at", "to", "of", "with", "about", "from",
  ]);

  return message
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w))
    .slice(0, 8); // max 8 keywords
}

/**
 * Search the library for relevant content.
 *
 * @param {object} params
 * @param {string} params.userId - The student's user ID
 * @param {string} params.message - The student's message
 * @param {string[]} params.courseIds - Array of course IDs the student is enrolled in
 * @param {string} [params.activeCourseId] - The currently active course (if known)
 * @returns {object} { found: boolean, snippets: string[], sources: object[] }
 */
export async function queryLibrary({ userId, message, courseIds = [], activeCourseId = null , force = false }) {
  // `force` skips the keyword gate — a deliberate tool call (Reggie's library_search)
  // has already decided this IS a library query; the gate exists for the passive
  // tutor-context path that runs on every message.
  if (!force && !isLibraryQuery(message)) {
    return { found: false, snippets: [], sources: [] };
  }

  const keywords = extractKeywords(message);
  if (keywords.length === 0) {
    return { found: false, snippets: [], sources: [] };
  }

  // BR-02 (Gap 8): scope the shared library to the caller's institution so course facts
  // can't cross schools. null (no Canvas) → skip the filter, degrade to unscoped.
  const uni = await userUniversityId(userId);
  const scopeUni = (q: any) => (uni ? q.eq("university_id", uni) : q);

  try {
    // Build the search query
    // Priority order:
    //   1. Active course content (most relevant)
    //   2. All enrolled courses (shared content only)
    //   3. Student's own private content (inbox, etc.)

    const results = [];

    // Search 1: Active course — all content types including private for this student
    if (activeCourseId) {
      const { data: activeResults } = await scopeUni(db()
        .from("course_content")
        .select("id, content_type, text, summary, concepts, module_name, week_number, professor_name, is_private, seen_by_count, course_id")
        .eq("course_id", activeCourseId)
        // course_content is a SHARED table with no per-user ownership column (see the
        // migration header), so private rows are unattributable — return shared only.
        // (The previous .or() embedded a raw SQL subquery, which PostgREST rejects with
        // a 400 that the destructure swallowed — this branch silently returned nothing.)
        .eq("is_private", false))
        .order("seen_by_count", { ascending: false })
        .limit(20);

      if (activeResults?.length) {
        results.push(...activeResults);
      }
    }

    // Search 2: All enrolled courses — shared content only
    if (courseIds.length > 0) {
      const { data: enrolledResults } = await scopeUni(db()
        .from("course_content")
        .select("id, content_type, text, summary, concepts, module_name, week_number, professor_name, is_private, seen_by_count, course_id")
        .in("course_id", courseIds)
        .eq("is_private", false))
        .order("seen_by_count", { ascending: false })
        .limit(30);

      if (enrolledResults?.length) {
        // Add only if not already in results
        const existingIds = new Set(results.map(r => r.id));
        enrolledResults.forEach(r => {
          if (!existingIds.has(r.id)) results.push(r);
        });
      }
    }

    if (results.length === 0) {
      return { found: false, snippets: [], sources: [] };
    }

    // Score results by keyword relevance
    const scored = results.map(row => {
      const searchText = `${row.text || ""} ${row.summary || ""} ${row.module_name || ""}`.toLowerCase();
      let score = 0;

      keywords.forEach(kw => {
        // Exact match in text
        const count = (searchText.match(new RegExp(kw, "g")) || []).length;
        score += count * 2;

        // Match in concepts
        if (row.concepts) {
          const conceptStr = JSON.stringify(row.concepts).toLowerCase();
          if (conceptStr.includes(kw)) score += 3;
        }
      });

      // Boost by seen_by_count (popular = more reliable)
      score += Math.log1p(row.seen_by_count || 0) * 0.5;

      // Boost syllabus and lecture notes (most authoritative)
      if (row.content_type === "syllabus") score += 5;
      if (row.content_type === "lecture") score += 3;
      if (row.content_type === "announcement") score += 2;

      return { ...row, score };
    });

    // Sort by score, take top 3
    const topResults = scored
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    if (topResults.length === 0) {
      return { found: false, snippets: [], sources: [] };
    }

    // Format snippets for injection into tutor prompt
    const snippets = topResults.map(r => {
      const source = r.content_type === "syllabus" ? "Course Syllabus"
        : r.content_type === "lecture" ? `Lecture Notes${r.week_number ? ` (Week ${r.week_number})` : ""}${r.module_name ? ` — ${r.module_name}` : ""}`
        : r.content_type === "announcement" ? "Course Announcement"
        : r.content_type === "inbox" ? "Professor Message (Private)"
        : r.content_type;

      const text = r.summary || (r.text ? r.text.slice(0, 500) : "");
      return `[${source}]: ${text}`;
    });

    const sources = topResults.map(r => ({
      id: r.id,
      contentType: r.content_type,
      moduleName: r.module_name,
      weekNumber: r.week_number,
      seenByCount: r.seen_by_count,
    }));

    return { found: true, snippets, sources };

  } catch (err) {
    console.error("[library-agent] search error:", err.message);
    return { found: false, snippets: [], sources: [] };
  }
}

/**
 * HTTP handler — called directly as a Vercel function for testing.
 * In production, queryLibrary() is imported directly by tutor-context.js.
 */
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const _uid = await requireUserOr401(req, res); if (!_uid) return;
  if (req.body && typeof req.body === "object") req.body.userId = _uid;
  const { userId, message, courseIds, activeCourseId, force } = req.body;
  if (!userId || !message) return res.status(400).json({ error: "userId and message required" });

  const result = await queryLibrary({ userId, message, courseIds, activeCourseId, force: !!force });
  return res.status(200).json(result);
}

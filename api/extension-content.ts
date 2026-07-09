// api/extension-content.js — Shared Course Library ingestion endpoint.
//
// Called by the browser extension when a student visits a course page.
// Implements the "puzzle" deduplication: if another student already fetched
// this content, we increment seen_by_count and return the existing record.
// Only the first student to fetch triggers a new insert.
//
// POST /api/extension-content
// Body: {
//   userId       string   — FschoolAI user ID
//   universityId string   — e.g. "uoft", "ubc" (derived from LMS URL)
//   courseId     string   — Canvas course ID or course code
//   canvasCourseId string — Original LMS course ID (optional)
//   contentType  string   — "syllabus" | "lecture" | "rubric" | "announcement" | "module" | "file"
//   text         string   — Full extracted text (up to 50,000 chars)
//   weekNumber   number   — For lectures: week of semester (optional)
//   moduleName   string   — For modules: module title (optional)
//   professorName string  — Extracted from page (optional)
//   sourceUrl    string   — Original LMS URL
//   fileName     string   — For file content type: original file name (optional)
// }
//
// Response: {
//   status: "created" | "already_exists"
//   id: string
//   seenByCount: number
//   contentHash: string
// }

import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";
import { resolveAndEnrichCourse, normalizeCourseCode } from "./course-resolver.js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ── University ID detection from LMS URL ─────────────────────────────────────
// Maps known LMS hostnames to short university IDs.
// Aryan: extend this map as new universities are added.
const UNIVERSITY_MAP = {
  "canvas.utoronto.ca":       "uoft",
  "q.utoronto.ca":            "uoft",
  "portal.utoronto.ca":       "uoft",
  "canvas.ubc.ca":            "ubc",
  "canvas.mcmaster.ca":       "mcmaster",
  "avenue.mcmaster.ca":       "mcmaster",
  "canvas.queensu.ca":        "queens",
  "onq.queensu.ca":           "queens",
  "learn.uwaterloo.ca":       "uwaterloo",
  "canvas.uwaterloo.ca":      "uwaterloo",
  "owl.uwo.ca":               "uwo",
  "canvas.uwo.ca":            "uwo",
  "mycourses.mcgill.ca":      "mcgill",
  "canvas.mcgill.ca":         "mcgill",
  "brightspace.dal.ca":       "dal",
  "canvas.mit.edu":           "mit",
  "canvas.stanford.edu":      "stanford",
  "canvas.harvard.edu":       "harvard",
  "courseworks.columbia.edu": "columbia",
  "canvas.uchicago.edu":      "uchicago",
};

export function deriveUniversityId(url) {
  if (!url) return "unknown";
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    for (const [pattern, uid] of Object.entries(UNIVERSITY_MAP)) {
      if (hostname === pattern || hostname.endsWith(`.${pattern}`)) return uid;
    }
    // Fallback: use the second-level domain
    const parts = hostname.split(".");
    return parts.length >= 2 ? parts[parts.length - 2] : hostname;
  } catch {
    return "unknown";
  }
}

// ── Content hash — the deduplication key ─────────────────────────────────────
// SHA-256 of (universityId + courseId + contentType + first 500 chars of text)
// Same content from any student at any time → same hash → no duplicate.
export function buildContentHash(universityId, courseId, contentType, text) {
  const seed = `${universityId}|${courseId}|${contentType}|${(text || "").slice(0, 500)}`;
  return crypto.createHash("sha256").update(seed).digest("hex");
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const {
    userId,
    universityId: rawUniversityId,
    courseId,
    canvasCourseId,
    contentType,
    text,
    weekNumber,
    moduleName,
    professorName,
    sourceUrl,
    fileName,
  } = req.body || {};

  // ── Validation ──────────────────────────────────────────────────────────────
  if (!userId)      return res.status(400).json({ error: "userId required" });
  if (!courseId)    return res.status(400).json({ error: "courseId required" });
  if (!contentType) return res.status(400).json({ error: "contentType required" });
  if (!text || text.trim().length < 10) {
    return res.status(400).json({ error: "text required (min 10 chars)" });
  }

  const VALID_TYPES = ["syllabus", "lecture", "rubric", "announcement", "module", "file"];
  if (!VALID_TYPES.includes(contentType)) {
    return res.status(400).json({ error: `contentType must be one of: ${VALID_TYPES.join(", ")}` });
  }

  // ── Derive university ID ────────────────────────────────────────────────────
  const universityId = rawUniversityId || deriveUniversityId(sourceUrl) || "unknown";

  // ── Resolve canonical course ID (H4 fix) ────────────────────────────────────
  // Ensures all 3 ingestion paths (Canvas API, extension, manual) resolve to the
  // same courses.id row regardless of whether they use numeric or text course IDs.
  const canonicalCourseId = await resolveAndEnrichCourse({
    userId,
    canvasCourseId: canvasCourseId || null,
    courseCode: courseId,  // courseId from extension is the text code
    courseName: null,
    professor: professorName || null,
  }).catch(() => null);

  // Normalize courseId to base code for consistent hashing
  const normalizedCourseKey = normalizeCourseCode(courseId) || courseId;

  // ── Build content hash ──────────────────────────────────────────────────────
  const contentHash = buildContentHash(universityId, normalizedCourseKey, contentType, text);

  // ── Dedup check: does this content already exist? ───────────────────────────
  const { data: existing, error: fetchErr } = await supabase
    .from("course_content")
    .select("id, seen_by_count, content_hash")
    .eq("content_hash", contentHash)
    .maybeSingle();

  if (fetchErr) {
    console.error("[extension-content] fetch error:", fetchErr.message);
    return res.status(500).json({ error: "Database error" });
  }

  // ── ALREADY EXISTS: increment seen_by_count, return existing ───────────────
  if (existing) {
    const newCount = (existing.seen_by_count ?? 1) + 1;
    await supabase
      .from("course_content")
      .update({ seen_by_count: newCount, last_seen_at: new Date().toISOString() })
      .eq("id", existing.id);

    return res.status(200).json({
      status:      "already_exists",
      id:          existing.id,
      seenByCount: newCount,
      contentHash,
    });
  }

  // ── NEW CONTENT: insert into library ────────────────────────────────────────
  const truncatedText = text.slice(0, 50000); // hard cap at 50k chars

  const { data: inserted, error: insertErr } = await supabase
    .from("course_content")
    .insert({
      university_id:    universityId,
      course_id:        normalizedCourseKey,
      canvas_course_id: canvasCourseId || null,
      content_type:     contentType,
      content_hash:     contentHash,
      text:             truncatedText,
      week_number:      weekNumber || null,
      module_name:      moduleName || fileName || null,
      professor_name:   professorName || null,
      source_url:       sourceUrl || null,
      seen_by_count:    1,
    })
    .select("id")
    .single();

  if (insertErr) {
    // Handle race condition: another student inserted between our check and insert
    if (insertErr.code === "23505") {
      // Unique violation on content_hash — fetch and increment
      const { data: raceExisting } = await supabase
        .from("course_content")
        .select("id, seen_by_count")
        .eq("content_hash", contentHash)
        .maybeSingle();

      if (raceExisting) {
        await supabase
          .from("course_content")
          .update({ seen_by_count: (raceExisting.seen_by_count ?? 1) + 1 })
          .eq("id", raceExisting.id);

        return res.status(200).json({
          status:      "already_exists",
          id:          raceExisting.id,
          seenByCount: (raceExisting.seen_by_count ?? 1) + 1,
          contentHash,
        });
      }
    }
    console.error("[extension-content] insert error:", insertErr.message);
    return res.status(500).json({ error: "Failed to store content" });
  }

  // ── Trigger Library Organizer Agent (non-blocking) ──────────────────────────
  // Queues the new content for Claude summarization + concept extraction.
  // Runs async — doesn't block the response.
  triggerLibraryOrganizer(inserted.id, universityId, courseId, contentType, truncatedText)
    .catch(e => console.warn("[extension-content] organizer trigger failed:", e.message));

  return res.status(201).json({
    status:      "created",
    id:          inserted.id,
    seenByCount: 1,
    contentHash,
  });
}

// ── Library Organizer Agent ───────────────────────────────────────────────────
// Runs after a new content item is inserted.
// Calls Claude to generate a summary and extract concept list.
// Updates course_content.summary and course_content.concepts.
async function triggerLibraryOrganizer(id, universityId, courseId, contentType, text) {
  const claudeUrl = process.env.CLAUDE_API_URL || "https://api.anthropic.com/v1/messages";
  const claudeKey = process.env.ANTHROPIC_API_KEY;

  if (!claudeKey) {
    console.warn("[library-organizer] ANTHROPIC_API_KEY not set — skipping summarization");
    return;
  }

  // Only summarize if text is substantial
  if (text.length < 200) return;

  const prompt = `You are analyzing university course content to build a shared knowledge library.

Content type: ${contentType}
Course: ${courseId} at ${universityId}

Content (first 3000 chars):
${text.slice(0, 3000)}

Respond with valid JSON only, no markdown:
{
  "summary": "2-3 sentence summary of what this content covers",
  "concepts": ["concept1", "concept2", "concept3"],
  "professor_name": "extracted professor name or null",
  "week_number": null or integer if this is a weekly lecture
}`;

  try {
    const response = await fetch(claudeUrl, {
      method: "POST",
      headers: {
        "Content-Type":      "application/json",
        "x-api-key":         claudeKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        // Use ANTHROPIC_MODEL env var (same pattern as api/claude.js) so both
        // routes stay in sync. Fall back to dated Haiku — cheap, fast, good
        // enough for summary/concept extraction. "claude-haiku-4-5" (undated)
        // is not a confirmed valid API string; dated form is required.
        model:      (process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001").trim(),
        max_tokens: 500,
        messages:   [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      console.warn("[library-organizer] Claude error:", response.status);
      return;
    }

    const data = await response.json();
    const raw  = data?.content?.[0]?.text || "";

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Try extracting JSON from response
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) parsed = JSON.parse(match[0]);
      else return;
    }

    // Update the course_content record with extracted intelligence
    await supabase
      .from("course_content")
      .update({
        summary:        parsed.summary        || null,
        concepts:       parsed.concepts       || null,
        professor_name: parsed.professor_name || null,
        week_number:    parsed.week_number    || null,
      })
      .eq("id", id);

    console.log(`[library-organizer] Processed ${contentType} for ${courseId}@${universityId} — ${(parsed.concepts || []).length} concepts extracted`);
  } catch (e) {
    console.warn("[library-organizer] Failed:", e.message);
  }
}

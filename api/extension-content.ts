// api/extension-content.ts — RETIRED (BR-06 §9.1).
//
// This was the UNAUTHENTICATED raw-text scrape door into the SHARED Course Library
// (course_content). Per BR-06 the shared-library write path must be ABSENT, not merely guarded
// ("a guarded path is one someone later un-guards"). No live extension caller writes here — the
// extension uses the authenticated API-first sync path and the student's own consent-gated RAG.
// Course facts now enter the shared library ONLY via api/university-brain (requireUserOr401 + the
// BR-06 course-fact guard). This handler therefore returns 410 Gone.
//
// The pure hostname/hash helpers remain exported: unit tests and any content-hash-compat callers
// still use them, and they touch no database or auth.

import crypto from "crypto";

// CANONICAL institution key = the LMS hostname (e.g. 'q.utoronto.ca'). Sanitized to valid
// hostname chars — some stored Canvas URLs carry stray characters that would fragment a school.
export function deriveUniversityId(url) {
  if (!url) return null;
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/[^a-z0-9.-]/g, "");
    return host || null;
  } catch {
    return null;
  }
}

// Content hash — the dedup key: SHA-256 of (universityId|courseId|contentType|first 500 chars).
export function buildContentHash(universityId, courseId, contentType, text) {
  const seed = `${universityId}|${courseId}|${contentType}|${(text || "").slice(0, 500)}`;
  return crypto.createHash("sha256").update(seed).digest("hex");
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();
  // BR-06 §9.1: shared-library scrape door retired. Course facts enter only via the authenticated
  // api/university-brain contribute path; a student's own page content ingests via their private RAG.
  return res.status(410).json({
    error: "gone",
    detail: "extension-content is retired (BR-06); use the authenticated sync path",
  });
}

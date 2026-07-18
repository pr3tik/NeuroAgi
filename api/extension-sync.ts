/**
 * api/extension-sync.js — Secure proxy for Chrome extension Supabase writes
 *
 * WHY THIS EXISTS:
 *   The Chrome extension previously used a hardcoded publishable anon key for all
 *   Supabase writes. This bypasses RLS and exposes the key in the extension bundle.
 *   This endpoint replaces all direct Supabase calls from the extension:
 *     - The extension sends { userId, action, ...payload }
 *     - This server validates the user exists (auth check)
 *     - All writes use SUPABASE_SERVICE_KEY (server-side only, never exposed)
 *
 * ACTIONS:
 *   upsert_canvas_data    — canvas_data blob (courses/assignments/grades)
 *   upsert_courses        — courses table
 *   upsert_assignments    — assignments table
 *   upsert_files          — files table
 *   upsert_course_content — course_content (shared library)
 *   delete_stale          — prune stale extension rows
 *   get_courses           — read courses for a user (for assignment linking)
 *   get_assignments       — read assignments for a user (for file linking)
 *   get_stats             — current sync stats for popup display
 *
 * SECURITY:
 *   - userId is validated against the users table on every request
 *   - All writes are scoped to userId (server enforces, not client)
 *   - No keys are exposed in the extension bundle
 */

import { createClient } from "@supabase/supabase-js";
import { assertCourseFact, CourseFactRejected } from "./course-fact-guard.js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { db: { schema: "public" } }
);

// ── CORS headers ──────────────────────────────────────────────────────────────
const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default async function handler(req, res) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST")    return res.status(405).json({ error: "POST only" });

  const { userId, action, ...payload } = req.body ?? {};

  if (!userId || !action) {
    return res.status(400).json({ error: "userId and action are required" });
  }

  // ── Auth check: verify userId exists ─────────────────────────────────────
  const { data: userRow, error: userErr } = await supabase
    .from("users")
    .select("id, email")
    .eq("id", userId)
    .maybeSingle();

  if (userErr || !userRow) {
    return res.status(401).json({ error: "Invalid userId" });
  }

  try {
    switch (action) {

      // ── canvas_data blob ────────────────────────────────────────────────
      case "upsert_canvas_data": {
        const { dataType, items } = payload;
        if (!dataType || !Array.isArray(items)) {
          return res.status(400).json({ error: "dataType and items[] required" });
        }
        // Read existing blob, merge, write back
        const { data: existing } = await supabase
          .from("canvas_data")
          .select("payload")
          .eq("user_id", userId)
          .eq("data_type", dataType)
          .maybeSingle();

        const existingItems = Array.isArray(existing?.payload) ? existing.payload : [];
        const keyFn = payload.keyFn === "canvas_course_id"
          ? (x) => x.canvas_course_id
          : (x) => x.canvas_assignment_id ?? x.canvas_course_id ?? JSON.stringify(x);

        const seen    = new Set(existingItems.map(keyFn));
        const merged  = [...existingItems];
        for (const item of items) {
          const k = keyFn(item);
          if (!seen.has(k)) { seen.add(k); merged.push(item); }
        }

        const { error } = await supabase
          .from("canvas_data")
          .upsert({ user_id: userId, data_type: dataType, payload: merged, synced_at: new Date().toISOString() },
                  { onConflict: "user_id,data_type" });
        if (error) throw error;
        return res.status(200).json({ ok: true, count: merged.length });
      }

      // ── courses ─────────────────────────────────────────────────────────
      case "upsert_courses": {
        const { rows } = payload;
        if (!Array.isArray(rows)) return res.status(400).json({ error: "rows[] required" });
        // Enforce userId on every row
        const safe = rows.map(r => ({ ...r, user_id: userId }));
        const { error } = await supabase
          .from("courses")
          .upsert(safe, { onConflict: "user_id,canvas_course_id" });
        if (error) throw error;
        return res.status(200).json({ ok: true, count: safe.length });
      }

      // ── assignments ──────────────────────────────────────────────────────
      case "upsert_assignments": {
        const { rows } = payload;
        if (!Array.isArray(rows)) return res.status(400).json({ error: "rows[] required" });
        const safe = rows.map(r => ({ ...r, user_id: userId }));
        const { error } = await supabase
          .from("assignments")
          .upsert(safe, { onConflict: "user_id,canvas_assignment_id" });
        if (error) throw error;
        return res.status(200).json({ ok: true, count: safe.length });
      }

      // ── files ────────────────────────────────────────────────────────────
      case "upsert_files": {
        const { rows } = payload;
        if (!Array.isArray(rows)) return res.status(400).json({ error: "rows[] required" });
        const safe = rows.map(r => ({ ...r, user_id: userId }));
        const { error } = await supabase
          .from("files")
          .upsert(safe, { onConflict: "user_id,lms_file_id" });
        if (error) throw error;
        return res.status(200).json({ ok: true, count: safe.length });
      }

      // ── course_content (shared library) ─────────────────────────────────
      case "upsert_course_content": {
        const { rows } = payload;
        if (!Array.isArray(rows)) return res.status(400).json({ error: "rows[] required" });
        // BR-06: every row must pass the shared-write guard. Fail-closed per row.
        const clean: Record<string, unknown>[] = [];
        let dropped = 0;
        for (const r of rows) {
          try { clean.push(assertCourseFact(r)); }
          catch (e) {
            if (e instanceof CourseFactRejected) { dropped++; console.warn("[extension-sync] BR-06 dropped row:", e.reason); }
            else throw e;
          }
        }
        if (clean.length) {
          const { error } = await supabase
            .from("course_content")
            .upsert(clean, { onConflict: "canvas_course_id,content_hash" });
          if (error) throw error;
        }
        return res.status(200).json({ ok: true, count: clean.length, dropped });
      }

      // ── delete stale rows ────────────────────────────────────────────────
      case "delete_stale": {
        const { table, column, keepIds } = payload;
        const ALLOWED_TABLES = ["assignments", "files"];
        if (!ALLOWED_TABLES.includes(table)) {
          return res.status(400).json({ error: `table must be one of: ${ALLOWED_TABLES.join(", ")}` });
        }
        if (!Array.isArray(keepIds) || keepIds.length === 0) {
          return res.status(400).json({ error: "keepIds[] required" });
        }
        const { error } = await supabase
          .from(table)
          .delete()
          .eq("user_id", userId)
          .eq("source", "extension")
          .not(column, "in", `(${keepIds.join(",")})`);
        if (error) throw error;
        return res.status(200).json({ ok: true });
      }

      // ── read courses (for assignment linking) ────────────────────────────
      case "get_courses": {
        const { data, error } = await supabase
          .from("courses")
          .select("id, canvas_course_id")
          .eq("user_id", userId);
        if (error) throw error;
        return res.status(200).json({ ok: true, courses: data });
      }

      // ── read assignments (for file linking) ──────────────────────────────
      case "get_assignments": {
        const { data, error } = await supabase
          .from("assignments")
          .select("id, canvas_assignment_id")
          .eq("user_id", userId);
        if (error) throw error;
        return res.status(200).json({ ok: true, assignments: data });
      }

      // ── sync stats for popup display ─────────────────────────────────────
      case "get_stats": {
        const [coursesRes, assignmentsRes, filesRes] = await Promise.all([
          supabase.from("courses").select("id", { count: "exact", head: true }).eq("user_id", userId),
          supabase.from("assignments").select("id", { count: "exact", head: true }).eq("user_id", userId),
          supabase.from("files").select("id", { count: "exact", head: true }).eq("user_id", userId),
        ]);
        return res.status(200).json({
          ok: true,
          stats: {
            courses:     coursesRes.count     ?? 0,
            assignments: assignmentsRes.count ?? 0,
            files:       filesRes.count       ?? 0,
          },
        });
      }

      default:
        return res.status(400).json({ error: `Unknown action: ${action}` });
    }
  } catch (err) {
    console.error("[extension-sync] error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}

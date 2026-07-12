-- supabase-assignment-done-migration.sql
-- Adds an app-only "marked done" flag to public.assignments so a student can complete a
-- task inside FschoolAI (Study Room / Assignment page) and have it flow back to the
-- dashboard + mission queue and STAY done across a Canvas re-sync.
--
-- Why a separate column (not submitted_at): syncCanvasData upserts submitted_at from the
-- live Canvas submission, so writing a local "done" into submitted_at would be clobbered
-- on the next sync. manual_done_at is never written by Canvas sync; loadCanvasData +
-- syncCanvasData OR it into submission.submittedAt at map time, so every "done" check in
-- the app reflects it without touching each read site.
--
-- Run this in the Supabase dashboard SQL Editor (no psql/CLI available from the app).

alter table public.assignments
  add column if not exists manual_done_at timestamptz;

-- PostgREST caches the schema; reload so the new column is queryable immediately
-- (otherwise reads/writes hit PGRST204 "column not found in schema cache").
notify pgrst, 'reload schema';

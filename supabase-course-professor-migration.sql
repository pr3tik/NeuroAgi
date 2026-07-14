-- supabase-course-professor-migration.sql
-- Adds a professor/instructor column to public.courses so Canvas-synced courses can carry
-- the teacher name (captured via include[]=teachers in the Canvas course fetch).
--
-- Run in: Supabase Dashboard → SQL Editor → Run.
-- Idempotent — safe to re-run.
--
-- NOTE: the canvasSync courses upsert degrades gracefully if this hasn't been run yet
-- (it retries without professor), so sync never breaks — but professor is only persisted
-- once this migration is applied.

alter table public.courses add column if not exists professor text;

-- Reload PostgREST's schema cache so the new column is queryable immediately.
notify pgrst, 'reload schema';

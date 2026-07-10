-- Allow Google Classroom and Microsoft Teams as course sources.
--
-- The original courses_source_check only allowed
-- ('manual','canvas','past_canvas','extension'), so every course row written by
-- the Google Classroom sync (api/drive-auth.ts, source='google_classroom') and
-- the Teams sync (api/lms-microsoft.ts, source='microsoft_teams') was rejected
-- with a check violation — silently, because the callers ignored the supabase-js
-- error. Assignments/files then landed with course_id = null (orphaned).
--
-- APPLIED to FschoolAI Production 2026-07-10 via the Supabase MCP connector
-- (migration name: allow_lms_course_sources). Kept here so other environments
-- can run it from the dashboard SQL editor.

alter table public.courses drop constraint courses_source_check;
alter table public.courses add constraint courses_source_check
  check (source = any (array[
    'manual'::text,
    'canvas'::text,
    'past_canvas'::text,
    'extension'::text,
    'google_classroom'::text,
    'microsoft_teams'::text
  ]));

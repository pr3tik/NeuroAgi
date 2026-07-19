-- supabase-course-content-assessment-type-migration.sql
-- BR-03: add 'assessment' to the course_content content_type CHECK so the University Brain can
-- store a course's graded-work calendar as its own type (distinct from 'rubric' = grading weights).
--
-- Idempotent (drop-if-exists -> add). No data change; existing rows are unaffected. The constraint
-- is the unnamed inline CHECK from supabase-course-content-migration.sql:26, which Postgres
-- auto-named 'course_content_content_type_check'.
--
-- Run in: Supabase Dashboard -> SQL Editor -> Run. (No CLI here -- see CLAUDE.md.)

alter table public.course_content
  drop constraint if exists course_content_content_type_check;

alter table public.course_content
  add constraint course_content_content_type_check
  check (content_type in
    ('syllabus','lecture','rubric','announcement','module','file','assessment'));

notify pgrst, 'reload schema';

-- ── Verification (run after applying) ──────────────────────────────────────────
-- Should succeed (returns 0 rows, no error):
--   insert into public.course_content (university_id, course_id, content_type, content_hash, text)
--   values ('__probe__','__probe__','assessment','__probe_hash__','x')
--   on conflict (content_hash) do nothing;
--   delete from public.course_content where content_hash = '__probe_hash__';

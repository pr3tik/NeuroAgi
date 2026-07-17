-- supabase-university-id-scoping-migration.sql
-- BR-02 (Gap 8): scope the Course Brain (course_content) by institution.
--
-- PROBLEM: course_content rows carry a university_id (hostname, e.g. 'q.utoronto.ca'), but
-- (a) no read path filters on it, so a course/professor lookup matches EVERY school, and
-- (b) users.university_id exists live but is NULL for everyone and is UNTRACKED (added via the
--     dashboard, in no committed migration — schema drift). Reads therefore can't resolve the
--     caller's institution to scope by.
--
-- This migration makes users.university_id tracked + populated so the read-filter code (BR-02)
-- can scope every course_content read to the caller's own institution. Idempotent; safe to
-- re-run. Run in the Supabase SQL Editor (no CLI here — see CLAUDE.md).
--
-- Live state when written (2026-07-17, prod, read-only check):
--   course_content: 2 rows, all university_id='q.utoronto.ca' (hostname; format already correct).
--   users: 141 total; 21 have canvas_base_url (all 'https://q.utoronto.ca'); university_id all NULL.

-- 1. Track the column (it already exists live as drift — IF NOT EXISTS makes the schema
--    reproducible without erroring on the existing column).
alter table public.users
  add column if not exists university_id text;

comment on column public.users.university_id is
  'Canonical institution key = hostname of the user''s Canvas base URL (e.g. q.utoronto.ca). '
  'Scopes Course Brain (course_content) reads to the user''s own school. Populated on Canvas '
  'connect and by the backfill below. NULL = no Canvas connected yet.';

-- 2. Index for the read-filter path (course_content reads will resolve the caller's uni first).
create index if not exists users_university_id_idx
  on public.users (university_id) where university_id is not null;

-- 3. Backfill from the already-stored Canvas base URL. hostname = the host portion of the URL.
--    substring(... from '^https?://([^/]+)') -> 'q.utoronto.ca' for 'https://q.utoronto.ca'.
--    (Strips any :port too, which Canvas URLs effectively never have.)
update public.users
   set university_id = lower(split_part(substring(canvas_base_url from '^https?://([^/]+)'), ':', 1))
 where canvas_base_url is not null
   and (university_id is null or university_id = '');

-- 4. course_content.university_id is already hostname-format and NOT NULL DEFAULT 'unknown'
--    (supabase-course-content-migration.sql). No change needed to existing rows; the WRITE
--    canonicalization (extension-content -> hostname) is a code change, not SQL. The
--    (university_id, course_id) index already exists there.

notify pgrst, 'reload schema';

-- ── Verification (run after applying) ──────────────────────────────────────────
-- select count(*) filter (where university_id is not null) as scoped,
--        count(*)                                          as total
--   from public.users;                       -- expect ~21 scoped / 141 total
-- select distinct university_id from public.users where university_id is not null;
--                                            -- expect 'q.utoronto.ca'

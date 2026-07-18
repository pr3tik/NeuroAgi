-- supabase-university-id-migration.sql
-- A2 / PRD §17.1 Gap 8 — give every reader a stable `university_id` so the shared Course Brain
-- (public.course_content) can be scoped per school. Without this, an unscoped read leaks one
-- school's material into another (two universities share the same integer canvas_course_id and
-- the same professor names).
--
-- Run in: Supabase Dashboard → SQL Editor → Run. Idempotent — safe to re-run.
-- NOTE: course_content.university_id ALREADY exists (supabase-course-content-migration.sql:20);
-- this migration adds the READER side (users.university_id) + indexes, and backfills.

-- ── 1. Column on users ─────────────────────────────────────────────────────────
-- TEXT to match course_content.university_id and the derivation (a Canvas host string).
alter table public.users
  add column if not exists university_id text;

comment on column public.users.university_id is
  'Canonical institution key = lowercase bare Canvas host (e.g. canvas.utoronto.ca). '
  'Derived from canvas_base_url. Matches course_content.university_id written by api/university-brain.ts. '
  'Read-scope key for the Course Brain (PRD Gap 8). Kept as full host (no subdomain collapse) so it '
  'never orphans rows written before A2 — see api/_universityId.ts.';

-- ── 2. Backfill from canvas_base_url ───────────────────────────────────────────
-- Extract the bare host exactly like canonicalUniversityId(): lowercase, strip scheme/port/path.
-- Only touch rows that have a canvas_base_url and no university_id yet (re-run safe).
update public.users
set university_id = lower(regexp_replace(canvas_base_url, '^\s*https?://([^/:]+).*$', '\1'))
where canvas_base_url is not null
  and canvas_base_url ~* '^\s*https?://[^/:]+'
  and (university_id is null or university_id = '');

-- ── 3. Indexes ─────────────────────────────────────────────────────────────────
-- Reader lookup by school, and the hot read-scope filter on the shared library.
create index if not exists users_university_id_idx
  on public.users (university_id);
create index if not exists course_content_university_id_idx
  on public.course_content (university_id);

-- ── 4. RLS ─────────────────────────────────────────────────────────────────────
-- public.users is already RLS-on (owner-scoped on current_profile_id()); adding a column does not
-- change its posture, so nothing to enable here. course_content stays RLS-off (extension-written).

-- ── 5. Reload PostgREST schema cache (new column/indexes) ───────────────────────
notify pgrst, 'reload schema';

-- ────────────────────────────────────────────────────────────────────────────────
-- KNOWN CAVEAT — verify before trusting the scope in prod (do NOT run blind):
-- The extension write path historically stamped SHORT ids ('uoft','ubc') while
-- api/university-brain.ts stamps the full host ('canvas.utoronto.ca'). Read-side scoping
-- (api/university-brain.ts profile) filters by the full host, so extension rows with short ids
-- will NOT match and become invisible to profile reads for that school. Inspect the live
-- distribution first:
--
--   select university_id, count(*) from public.course_content group by 1 order by 2 desc;
--
-- If short ids exist for schools you care about, map them to the host form with a targeted UPDATE
-- (one per school, verified by hand) — there is no safe automatic short-id → host mapping.
-- ────────────────────────────────────────────────────────────────────────────────

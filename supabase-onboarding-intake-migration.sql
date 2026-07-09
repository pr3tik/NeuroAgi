-- Onboarding intake (PRD §5.1 v2.1): the five scenario questions asked during
-- the S6 sync wait. Declared data that seeds the model — behavior overrides it
-- from session one. Each column is a named agent field:
--   learning_style    → tutor response-format choice, library matching
--   help_seeking      → what the student does when stuck ('close' = avoidance signal)
--   explanation_style → explanation depth/order from message one
--   prep_style        → planner session design + SRS format weighting
--   study_window      → planner stated hours + reminder scheduling
-- All nullable: a skipped question stores NULL here and is recorded in
-- intake_meta.skipped (the skip itself is a signal).

alter table public.users add column if not exists learning_style    text;
alter table public.users add column if not exists help_seeking      text;
alter table public.users add column if not exists explanation_style text;
alter table public.users add column if not exists prep_style        text;
alter table public.users add column if not exists study_window      text;

-- { version: 'onboarding-v2.1', skipped: text[], completed_at: timestamptz }
alter table public.users add column if not exists intake_meta jsonb;

-- guard against unexpected values (option ids from INTAKE_QUESTIONS in
-- src/pages/Onboarding.tsx — keep in sync)
alter table public.users drop constraint if exists users_learning_style_check;
alter table public.users add  constraint users_learning_style_check
  check (learning_style is null or learning_style in ('diagram', 'talk', 'read', 'problem', 'mix'));

alter table public.users drop constraint if exists users_help_seeking_check;
alter table public.users add  constraint users_help_seeking_check
  check (help_seeking is null or help_seeking in ('rewatch', 'explain', 'notes', 'grind', 'close'));

alter table public.users drop constraint if exists users_explanation_style_check;
alter table public.users add  constraint users_explanation_style_check
  check (explanation_style is null or explanation_style in ('quick', 'steps', 'why', 'worked'));

alter table public.users drop constraint if exists users_prep_style_check;
alter table public.users add  constraint users_prep_style_check
  check (prep_style is null or prep_style in ('mindmaps', 'aloud', 'rewrite', 'pastpapers', 'cram'));

alter table public.users drop constraint if exists users_study_window_check;
alter table public.users add  constraint users_study_window_check
  check (study_window is null or study_window in ('weeknights', 'latenight', 'mornings', 'weekends', 'deadline'));

-- If the app hits PGRST204 after this runs, refresh the PostgREST schema cache:
-- notify pgrst, 'reload schema';

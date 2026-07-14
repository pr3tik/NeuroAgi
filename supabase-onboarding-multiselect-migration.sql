-- Onboarding multi-select (PRD §5.1): the five scenario questions now accept MORE THAN
-- ONE answer each (students genuinely fit multiple — e.g. learns from diagrams AND by
-- trying problems). The intake columns stay `text`, but a multi-answer is stored as a
-- comma-joined string ("diagram,problem"). This migration swaps the old single-value
-- CHECK constraints for ones that validate EVERY comma-separated token against the allowed
-- option-id set (so multi-values pass, garbage still fails). Idempotent.
--
-- Run in: Supabase Dashboard → SQL Editor → Run.
-- Until this runs, the app falls back to persisting the FIRST pick per question
-- (App.tsx handleOnboardingComplete), so no intake is lost in the meantime.

alter table public.users drop constraint if exists users_learning_style_check;
alter table public.users add  constraint users_learning_style_check
  check (learning_style is null or string_to_array(learning_style, ',') <@ array['diagram','talk','read','problem','mix']);

alter table public.users drop constraint if exists users_help_seeking_check;
alter table public.users add  constraint users_help_seeking_check
  check (help_seeking is null or string_to_array(help_seeking, ',') <@ array['rewatch','explain','notes','grind','close']);

alter table public.users drop constraint if exists users_explanation_style_check;
alter table public.users add  constraint users_explanation_style_check
  check (explanation_style is null or string_to_array(explanation_style, ',') <@ array['quick','steps','why','worked']);

alter table public.users drop constraint if exists users_prep_style_check;
alter table public.users add  constraint users_prep_style_check
  check (prep_style is null or string_to_array(prep_style, ',') <@ array['mindmaps','aloud','rewrite','pastpapers','cram']);

alter table public.users drop constraint if exists users_study_window_check;
alter table public.users add  constraint users_study_window_check
  check (study_window is null or string_to_array(study_window, ',') <@ array['weeknights','latenight','mornings','weekends','deadline']);

-- If the app hits PGRST204 after this runs, refresh the PostgREST schema cache:
-- notify pgrst, 'reload schema';

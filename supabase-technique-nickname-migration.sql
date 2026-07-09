-- Technique-nickname achievements: change bump_student_strategy_affinity to return
-- the post-bump row so the caller (api/session-close.ts) can check the student's
-- personal success rate for that technique without a second round trip.
-- Non-breaking: existing callers ignore the return value (previously void).
--
-- NOTE: Postgres's CREATE OR REPLACE FUNCTION cannot change a function's return
-- type (void -> table(...) here) — it errors with "cannot change return type of
-- existing function". Must DROP first. (First version of this migration used
-- `create or replace` directly and silently never applied — this is the fix.)
drop function if exists public.bump_student_strategy_affinity(text, text, boolean);

create function public.bump_student_strategy_affinity(
  p_user_id       text,
  p_strategy_kind text,
  p_success       boolean
)
returns table (success_count int, attempt_count int)
language sql
as $$
  insert into public.student_strategy_affinity (user_id, strategy_kind, success_count, attempt_count, updated_at)
  values (p_user_id, p_strategy_kind, case when p_success then 1 else 0 end, 1, now())
  on conflict (user_id, strategy_kind) do update set
    success_count = public.student_strategy_affinity.success_count + excluded.success_count,
    attempt_count = public.student_strategy_affinity.attempt_count + excluded.attempt_count,
    updated_at    = now()
  returning student_strategy_affinity.success_count, student_strategy_affinity.attempt_count;
$$;

notify pgrst, 'reload schema';

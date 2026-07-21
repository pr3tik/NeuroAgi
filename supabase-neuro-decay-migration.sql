-- supabase-neuro-decay-migration.sql
-- SQL-side decay for scale. The decay curve is a function of a row's own salience + last_seen_at, so
-- it can't be a generated column (timestamptz math isn't immutable → 42P17). Instead a set-based
-- function soft-forgets the whole dead set in ONE indexed UPDATE — the same rule as the kernel's
-- effective(m,t) = salience·exp(-λ·days) < FORGET_THRESHOLD, evaluated in SQL — so tickDecay no
-- longer fetches + scores every row in app. λ = ln2/14 (14-day half-life), threshold 0.05.
create or replace function public.neuro_sweep_due(p_subjects text[], p_now timestamptz)
returns setof uuid
language sql
as $$
  update public.neuro_memory
     set forgotten_at = p_now
   where subject = any(p_subjects)
     and forgotten_at is null
     and salience * exp( -(ln(2.0)/14.0) * greatest(0, extract(epoch from (p_now - last_seen_at)) / 86400.0) ) < 0.05
  returning id;
$$;

-- Service-role only (the kernel reaches this server-side via the service key); deny anon/authenticated.
revoke all on function public.neuro_sweep_due(text[], timestamptz) from public;
revoke all on function public.neuro_sweep_due(text[], timestamptz) from anon;
revoke all on function public.neuro_sweep_due(text[], timestamptz) from authenticated;
grant execute on function public.neuro_sweep_due(text[], timestamptz) to service_role;

notify pgrst, 'reload schema';

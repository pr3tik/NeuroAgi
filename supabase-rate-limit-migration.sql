-- supabase-rate-limit-migration.sql
-- Fixed-window rate limiter for the PUBLIC (unauthenticated) API endpoints — they cost money
-- (LLM/TTS/STT) or are spammable, and Stage 2 left them open by design. One atomic RPC does the
-- increment; endpoints call it with the service key via /rest/v1/rpc. Applied via Management API.

create table if not exists public.rate_limits (
  key          text        primary key,
  count        integer     not null default 0,
  window_start timestamptz not null default now()
);
alter table public.rate_limits enable row level security;   -- server-only; service key bypasses

-- Returns true if the caller is UNDER the limit for this key/window (and counts the hit),
-- false if over. Fixed window: the first hit after the window elapses resets the counter.
create or replace function public.check_rate_limit(p_key text, p_max integer, p_window_secs integer)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_count integer;
begin
  insert into public.rate_limits (key, count, window_start)
  values (p_key, 1, now())
  on conflict (key) do update set
    count = case when now() - public.rate_limits.window_start > make_interval(secs => p_window_secs)
                 then 1 else public.rate_limits.count + 1 end,
    window_start = case when now() - public.rate_limits.window_start > make_interval(secs => p_window_secs)
                        then now() else public.rate_limits.window_start end
  returning count into v_count;
  return v_count <= p_max;
end;
$$;

-- Server-only (endpoints call it with the service_role key, which bypasses these grants).
revoke execute on function public.check_rate_limit(text, integer, integer) from public, anon, authenticated;

notify pgrst, 'reload schema';

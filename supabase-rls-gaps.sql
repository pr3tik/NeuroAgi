-- supabase-rls-gaps.sql — closes the RLS gaps left open after the two existing files.
--
-- RUN ORDER:
--   1. supabase-rls-server-only.sql      (already run)
--   2. supabase-rls-client-tables.sql    (already run — defines reset_policies(), current_profile_id(), users_public)
--   3. THIS FILE
--
-- This file is idempotent (re-defines its helpers with create-or-replace; loops are drop-then-create).
-- Server endpoints use the service_role key, which BYPASSES RLS — so every server-only lock below is
-- safe. PREREQ confirmed live: current_profile_id() resolves for the browser (canary on public.courses
-- returned the caller's own rows under RLS), so owner-scoped enables below are safe for logged-in users.
-- (Any user who has NOT logged in since the Supabase Auth deploy must log in again — lazy migration.)

-- ── helpers (idempotent; mirror supabase-rls-client-tables.sql so this runs standalone) ──
create or replace function public.reset_policies(p_table text)
returns void language plpgsql as $$
declare r record;
begin
  for r in select policyname from pg_policies where schemaname = 'public' and tablename = p_table loop
    execute format('drop policy %I on public.%I;', r.policyname, p_table);
  end loop;
end $$;

-- ════════════════════════════════════════════════════════════════════════════════
-- (1) neuroagi.* — SERVER-ONLY schema. CROWN-JEWEL FIX.
-- The browser never touches this schema (verified: 0 client refs; the frontend's "brain"
-- client is a SEPARATE Supabase project on schema 'brain'). RLS is already ON here, but every
-- table carries an `open_all USING (true)` policy, so it is world-readable through the anon key —
-- including neuroagi.users.password_hash and neuroagi.users.canvas_token. Dropping those policies
-- leaves RLS-on + no-policy = deny-by-default for anon; the service_role key still bypasses, so the
-- server keeps working.  ⚠️ Requires SUPABASE_SERVICE_KEY to be set in prod (it is).
-- ════════════════════════════════════════════════════════════════════════════════
do $$
declare r record;
begin
  for r in select tablename, policyname from pg_policies where schemaname = 'neuroagi' loop
    execute format('drop policy %I on neuroagi.%I;', r.policyname, r.tablename);
  end loop;
  for r in select tablename from pg_tables where schemaname = 'neuroagi' loop
    execute format('alter table neuroagi.%I enable row level security;', r.tablename);
  end loop;
end $$;

-- ════════════════════════════════════════════════════════════════════════════════
-- (2) Newer public client tables that had NO policy (added after the RLS files were written).
-- All carry a user_id; owner-scoped, same pattern as Tier A. Server writes (agents/queues) use
-- the service key and bypass RLS, so this only restricts the anon/browser path to the owner's rows.
-- ⚠️ AFTER RUNNING, spot-check: Spaces, Exams, Flashcards (v2) still load and save. If a feature's
-- data vanishes or a save 403s, that table's client write sets user_id differently — disable RLS on
-- just that table (`alter table public.<t> disable row level security;`) and report it.
-- NOTE: if you later add space SHARING (space_member), spaces/space_items/space_chats will need a
-- membership policy like study_rooms; today they are per-user, so owner-scoped is correct.
-- ════════════════════════════════════════════════════════════════════════════════
do $$
declare t text;
begin
  foreach t in array array[
    'flashcards_v2','exam_attempts','exams','token_events','impressions','content_connections',
    'spaces','space_items','space_chats','feedback','proactive_signals','notification_queue',
    'intervention_tuning','modules','knowledge_graph'
  ] loop
    perform public.reset_policies(t);
    execute format('alter table public.%I enable row level security;', t);
    -- cast user_id::text so this works whether the column is uuid or text (current_profile_id() is text)
    execute format(
      'create policy %I on public.%I for all '
      'using (user_id::text = public.current_profile_id()) '
      'with check (user_id::text = public.current_profile_id());', t || '_self', t);
  end loop;
end $$;

-- leaderboard — read by EVERYONE (cross-user rankings), written server-side (service key).
-- Owner-only would hide everyone else's rows, so reads are open; the anon key cannot write
-- (no insert/update/delete policy), and the service_role key bypasses RLS for the ranking job.
select public.reset_policies('leaderboard');
create policy leaderboard_read on public.leaderboard for select using (true);
alter table public.leaderboard enable row level security;

-- ════════════════════════════════════════════════════════════════════════════════
-- (3) Identity lookups as SECURITY DEFINER — so friend search keeps working once public.users
-- RLS is strict (step 4). They run as the function owner (bypass RLS) but only return safe columns
-- for a SPECIFIC lookup (by exact email, partial name, or explicit id list) — no bulk dump of the
-- table. Wire these in src/api/friends.ts BEFORE running step 4 (see message / PR notes).
-- ════════════════════════════════════════════════════════════════════════════════
create or replace function public.find_user_by_email(p_email text)
returns table(id text, name text, email text)
language sql security definer stable as $$
  select id, name, email from public.users where email ilike trim(p_email) limit 1;
$$;

create or replace function public.search_users_by_name(p_query text)
returns table(id text, name text, email text)
language sql security definer stable as $$
  select id, name, email from public.users where name ilike '%' || trim(p_query) || '%' limit 8;
$$;

create or replace function public.get_user_profiles(p_ids text[])
returns table(id text, name text, email text)
language sql security definer stable as $$
  select id, name, email from public.users where id = any(p_ids);
$$;

grant execute on function
  public.find_user_by_email(text),
  public.search_users_by_name(text),
  public.get_user_profiles(text[])
to anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════════
-- (4) GATED — lock public.users (still wide open via `open_users USING (true)`; holds email,
-- password_hash, auth_id, canvas_token). DO THIS LAST, and only AFTER:
--   (a) src/api/friends.ts is swapped to the RPCs above and DEPLOYED, and
--   (b) you have tested login + profile save on staging — the self-write path (the AppContext
--       profile upsert) must satisfy `with check (auth_id = auth.uid())`.
-- StudyRooms already reads users_public (shipped in this PR), so only friends.ts remains.
-- Uncomment and run as the final step:
--
--   revoke select (password_hash, canvas_token) on public.users from anon, authenticated;
--   select public.reset_policies('users');
--   create policy users_self on public.users for all
--     using (auth_id = auth.uid()) with check (auth_id = auth.uid());
--   alter table public.users enable row level security;
-- ════════════════════════════════════════════════════════════════════════════════

notify pgrst, 'reload schema';

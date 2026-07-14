-- supabase-rls-users-lockdown.sql
-- Locks public.users so the anon key can no longer read every user's name/email/school/scores.
-- Cross-user identity now flows through:
--   • users_public (view: id/name/school/location only — bypasses users RLS as owner)
--   • find_user_by_email(text) (SECURITY DEFINER RPC — email match, bypasses RLS)
-- The server (service_role key) bypasses RLS, so API endpoints + signup/auth-migrate are unaffected.
--
-- APPLY ONLY AFTER the matching client changes are deployed (friends.ts reroutes cross-user reads
-- through the view/RPC; AppContext awaits getSession() before reading users so the boot read
-- carries the auth token). Applied to prod via the Management API. Reversible:
--   alter table public.users disable row level security;

drop policy if exists open_users on public.users;
drop policy if exists users_self on public.users;

-- Owner-only access (auth_id links the app profile to the GoTrue session — same expr as
-- current_profile_id(), so all the other tables' policies keep resolving through it).
create policy users_self on public.users for all
  using (auth_id = auth.uid())
  with check (auth_id = auth.uid());

alter table public.users enable row level security;

notify pgrst, 'reload schema';

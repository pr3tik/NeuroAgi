-- Fixes a second, more serious instance of the same bug class as the schools
-- dropdown: App.tsx's handleOnboardingComplete() and Identity.tsx both read/write
-- users.school_city / users.school_country / users.school_continent, but only
-- users.school actually exists in production. Supabase upsert() rejects the
-- WHOLE row when any column is unknown, and the call site never checks
-- `.error` (await supabase.from("users").upsert(...) with no error check) —
-- so completing onboarding with a school selected has been silently failing
-- to save ANYTHING (not even the `school` text field) for every user who
-- picked a school. Confirmed live: an account that went through onboarding
-- had users.school = null.

alter table public.users add column if not exists school_city      text;
alter table public.users add column if not exists school_country   text;
alter table public.users add column if not exists school_continent text;

notify pgrst, 'reload schema';

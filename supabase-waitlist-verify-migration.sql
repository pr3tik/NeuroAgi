-- supabase-waitlist-verify-migration.sql
-- Adds email verification to the waitlist. A signup is only "officially" on the list
-- (counted, positioned, invited) once verified_at is set — this stops bots/typos/spam
-- from inflating the list. verified_at is stamped by /api/waitlist?action=verify when the
-- user clicks the confirmation link.
--
-- Run in: Supabase Dashboard → SQL Editor → Run. Idempotent — safe to re-run.

alter table public.waitlist add column if not exists verified_at timestamptz;

-- Fast "verified members only" counts (position/total/stats all filter on this).
create index if not exists waitlist_verified_idx on public.waitlist (verified_at) where verified_at is not null;

notify pgrst, 'reload schema';

-- NOTE (optional, do NOT run blindly): any rows created BEFORE this feature shipped have
-- verified_at = null and will drop out of the public count. If you want to grandfather
-- existing signups in as verified, run:
--   update public.waitlist set verified_at = created_at where verified_at is null;

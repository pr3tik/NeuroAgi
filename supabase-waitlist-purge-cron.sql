-- supabase-waitlist-purge-cron.sql
-- RETIRED 2026-07-15: unverified waitlist signups are NO LONGER auto-removed.
--
-- This file used to schedule a daily pg_cron job (`purge-unverified-waitlist`) that deleted
-- signups still unverified 7 days after their verification email. Decision (2026-07-15):
-- keep every signup forever — unverified rows simply aren't counted, positioned, or invited
-- (see api/waitlist.ts). The job was unscheduled in prod via the Management API the same day.
--
-- Running this file is idempotent: it removes the job if it somehow exists, and schedules
-- nothing. Kept in the repo so the history + decision are visible next to the other
-- waitlist migrations.

do $$
begin
  -- Guarded so this really is a no-op anywhere: on a DB without the pg_cron extension
  -- (fresh project, local Postgres) cron.job doesn't exist and a bare select would error.
  if to_regclass('cron.job') is not null
     and exists (select 1 from cron.job where jobname = 'purge-unverified-waitlist') then
    perform cron.unschedule('purge-unverified-waitlist');
  end if;
end $$;

-- inspect (should return 0 rows):
--   select jobname, schedule, active from cron.job where jobname = 'purge-unverified-waitlist';

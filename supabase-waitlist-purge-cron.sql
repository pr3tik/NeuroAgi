-- supabase-waitlist-purge-cron.sql
-- Auto-remove waitlist signups that never confirm their email. A signup gets a verification
-- link when it joins (or via the one-time /api/waitlist?action=verify-blast catch-up); if it
-- isn't verified within a week of that email, it's deleted from the DB (and therefore from the
-- public count + the admin dashboard).
--
-- This is applied via the Supabase Management API (pg_cron runs it in-DB — a single filtered
-- DELETE, never a REST loop). Committed here for visibility. Re-run to update the schedule.
--
-- The DELETE only touches rows that were ACTUALLY emailed (verification_sent_at IS NOT NULL),
-- so a row is never purged before its verification email went out, regardless of ordering.

create extension if not exists pg_cron;

-- idempotent re-schedule
select cron.unschedule('purge-unverified-waitlist') from cron.job where jobname = 'purge-unverified-waitlist';

select cron.schedule(
  'purge-unverified-waitlist',
  '0 8 * * *',                       -- daily, 08:00 UTC
  $$delete from public.waitlist
      where verified_at is null
        and verification_sent_at is not null
        and verification_sent_at < now() - interval '7 days'$$
);

-- inspect:  select jobname, schedule, active from cron.job where jobname = 'purge-unverified-waitlist';
-- runs:     select * from cron.job_run_details where jobid = (select jobid from cron.job where jobname='purge-unverified-waitlist') order by start_time desc limit 10;

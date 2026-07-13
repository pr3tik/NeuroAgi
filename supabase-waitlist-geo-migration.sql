-- supabase-waitlist-geo-migration.sql — location capture for waitlist signups.
-- Run in: Supabase Dashboard → SQL Editor → Run. Idempotent.
--
-- Populated at join time from Vercel's edge geo headers (x-vercel-ip-country/-region/
-- -city) — free, no external geolocation API. Only signups AFTER this ships carry
-- location (IPs were never stored, so existing rows can't be backfilled).

ALTER TABLE public.waitlist ADD COLUMN IF NOT EXISTS country TEXT;  -- ISO 3166-1 alpha-2 ("CA")
ALTER TABLE public.waitlist ADD COLUMN IF NOT EXISTS region  TEXT;  -- e.g. "ON"
ALTER TABLE public.waitlist ADD COLUMN IF NOT EXISTS city    TEXT;  -- e.g. "Waterloo"

NOTIFY pgrst, 'reload schema';

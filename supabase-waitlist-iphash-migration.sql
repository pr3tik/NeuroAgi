-- supabase-waitlist-iphash-migration.sql
-- Per-IP abuse throttling for instant (no-verification) waitlist joins.
--
-- api/waitlist.ts stamps ip_hash = HMAC-SHA256(server secret, client IP) — a keyed hash, never
-- the raw address — on each new signup, and rejects a NEW signup when its network already
-- created IP_DAILY_MAX rows in the last 24h. The join handler fails OPEN if this column is
-- missing, so running this migration is what actually arms the cap.
--
-- Applied via the Supabase Management API on 2026-07-15; committed here for visibility.

alter table public.waitlist add column if not exists ip_hash text;
create index if not exists waitlist_ip_hash_created_idx on public.waitlist (ip_hash, created_at desc);

notify pgrst, 'reload schema';

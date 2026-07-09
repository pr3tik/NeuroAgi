-- supabase-writing-snapshots.sql — timeline table for the Writing Evolution Tracker.
-- Run this in the Supabase SQL editor. Project convention: RLS disabled, anon (client) /
-- service (server) key access.

create table if not exists public.writing_snapshots (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,
  title       text,
  word_count  integer,
  metrics     jsonb not null default '{}'::jsonb,  -- WritingMetrics: readability/vocab/complexity/citations
  assessment  text,
  tip         text,
  created_at  timestamptz not null default now()
);

create index if not exists writing_snapshots_user_idx
  on public.writing_snapshots (user_id, created_at desc);

alter table public.writing_snapshots disable row level security;

-- If PostgREST 404s the new table (PGRST205) right after creating it, refresh its cache:
-- notify pgrst, 'reload schema';

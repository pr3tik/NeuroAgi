-- supabase-content-connections.sql — feed table for the Content Connector agent.
-- Run this in the Supabase SQL editor (there's no CLI/DB connection from the app).
-- Follows the project convention: RLS disabled, accessed with anon (client) / service (server) keys.

create table if not exists public.content_connections (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null,
  source_url      text,
  source_title    text,
  content_summary text,
  connections     jsonb not null default '[]'::jsonb,  -- [{concept, course, explanation}]
  created_at      timestamptz not null default now()
);

create index if not exists content_connections_user_idx
  on public.content_connections (user_id, created_at desc);

alter table public.content_connections disable row level security;

-- If PostgREST 404s the new table (PGRST205) right after creating it, refresh its cache:
-- notify pgrst, 'reload schema';

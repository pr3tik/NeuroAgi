-- supabase-neuro-membership-migration.sql
-- Sharing layer for the NeuroAGI kernel: explicit membership of shared "space" scopes
-- (course:<id> | room:<id> | prof:<id>). Personal 'person:<id>' scopes need NO row here — the
-- subject is its own sole owner. This is what lets a course/room brain be read by its members
-- (and only its members): readableScopes(person) = person + spacesFor(person); canWrite() gates
-- shared writes to role writer|owner. Lives alongside neuro_memory (same project as the memory
-- store — the NeuroAGI project once NEURO_SUPABASE_* is set, product DB as the fallback).
create table if not exists public.neuro_membership (
  space     text        not null,                      -- 'course:<id>' | 'room:<id>' | 'prof:<id>'
  subject   text        not null,                      -- member's subject, usually 'person:<id>'
  role      text        not null default 'reader',     -- reader | writer | owner
  added_at  timestamptz not null default now(),
  primary key (space, subject)
);
create index if not exists neuro_membership_subject_idx on public.neuro_membership (subject);

-- RLS on + no policy = deny anon/authenticated; the service role bypasses (the kernel reaches this
-- only server-side via the service key), matching neuro_memory's posture.
alter table public.neuro_membership enable row level security;

notify pgrst, 'reload schema';

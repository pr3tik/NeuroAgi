-- supabase-neuro-kernel-migration.sql
-- NeuroAGI kernel store — the product-agnostic PARENT brain, bootstrapped inside the FschoolAI
-- product DB. Tables are prefixed neuro_ in `public` so the existing service-key PostgREST path
-- reaches them with NO schema-exposure change; on extraction to a dedicated NeuroAGI Supabase
-- project these map to a `neuro` schema. Reached ONLY server-side via the service key (the brain's
-- REST contract, api/brain.ts) — never the browser anon client. This is the target v2 kernel model:
-- ONE append-only memory log + deterministic decay + subject scopes ("sub-brains = scopes").

-- 1. The append-only memory log — the whole kernel. New info types need zero schema change:
--    they are just a new `kind`. Every "sub-brain" (personal/course/prof/room) is a `subject`.
create table if not exists public.neuro_memory (
  id           uuid        primary key default gen_random_uuid(),
  subject      text        not null,                    -- scope: 'person:<uuid>' | 'course:<id>' | 'prof:<id>' | 'room:<id>'
  kind         text        not null,                    -- 'signal'|'todo'|'focus'|'digest'|'hypothesis'|'trait'|'schedule'|'outbox'|...
  body         jsonb       not null default '{}'::jsonb,
  salience     real        not null default 1.0,        -- base importance 0..1 (decays over time)
  audience     text[]      not null default '{}',       -- extra readers beyond `subject`; '*' = public
  source       text,                                    -- writing product, e.g. 'fschoolai'
  happened_at  timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),      -- recall reinforces (bumps this) — use-it-or-lose-it
  forgotten_at timestamptz,                             -- soft-forget (kept for audit / undo)
  created_at   timestamptz not null default now()
);
create index if not exists neuro_memory_subject_idx  on public.neuro_memory (subject)       where forgotten_at is null;
create index if not exists neuro_memory_kind_idx     on public.neuro_memory (subject, kind) where forgotten_at is null;
create index if not exists neuro_memory_lastseen_idx on public.neuro_memory (last_seen_at)  where forgotten_at is null;

-- 2. Global person identity — the "one person, one brain across products" spine.
create table if not exists public.neuro_person (
  id         uuid        primary key default gen_random_uuid(),
  name       text,
  email      text,
  created_at timestamptz not null default now(),
  metadata   jsonb       not null default '{}'::jsonb
);
create unique index if not exists neuro_person_email_idx on public.neuro_person (lower(email)) where email is not null;

-- 3. Product -> person mapping: each child product maps its LOCAL user id to the global person.
--    (FschoolAI users.id is TEXT.) This is what lets a second product read the SAME person's brain.
create table if not exists public.neuro_person_link (
  product    text        not null,               -- 'fschoolai', ...
  local_id   text        not null,               -- product's own user id
  person_id  uuid        not null references public.neuro_person(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (product, local_id)
);
create index if not exists neuro_person_link_person_idx on public.neuro_person_link (person_id);

-- RLS on + no policy = deny anon/authenticated; the service role bypasses RLS, so the brain's
-- server-side REST contract still works. Matches the project's locked-down posture for non-public data.
alter table public.neuro_memory      enable row level security;
alter table public.neuro_person      enable row level security;
alter table public.neuro_person_link enable row level security;

notify pgrst, 'reload schema';

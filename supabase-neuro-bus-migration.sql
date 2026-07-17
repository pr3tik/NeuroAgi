-- supabase-neuro-bus-migration.sql
-- NeuroAGI capability bus registry. Capabilities are agents/skills the brain can invoke
-- (brain -> agent) and that feed the brain back via ingest (agent -> brain = remember). http
-- capabilities expose POST {endpoint}/invoke {action,args}; local ones are in-process handlers
-- registered at runtime; mcp is reserved. Server-only (service key) like the rest of the kernel.
create table if not exists public.neuro_capability (
  name       text        primary key,
  kind       text        not null default 'http',   -- 'local' | 'http' | 'mcp'
  endpoint   text,
  manifest   jsonb       not null default '{}'::jsonb,
  enabled    boolean     not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.neuro_capability enable row level security;

notify pgrst, 'reload schema';

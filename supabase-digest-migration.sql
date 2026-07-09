-- lecture_digests: one row per lecture digest job (Digest Lecture feature).
-- Mirrors media_jobs' status-machine pattern (see api/transcribe.ts) but carries
-- the full digest payload alongside the job status.
create table if not exists public.lecture_digests (
  id              uuid primary key default gen_random_uuid(),
  user_id         text references public.users(id) on delete cascade,
  course_id       bigint references public.courses(id),
  title           text,
  storage_path    text,
  status          text default 'transcribing',  -- transcribing | emphasizing | digesting | done | error
  transcript      text,
  emphasis        jsonb,   -- [{ timestamp_seconds, quote, reason, importance }]
  summary         text,
  key_points      jsonb,   -- [{ timestamp_seconds, heading, body }]
  glossary        jsonb,   -- [{ term, definition }]
  quiz_questions  jsonb,   -- [{ question, type, options?, answer }]
  document_id     uuid,    -- RAG document reference
  error           text,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

create index if not exists lecture_digests_user_updated_idx
  on public.lecture_digests (user_id, updated_at desc);

-- RLS-off + service-key pattern (matches every other app table — see CLAUDE.md).
alter table public.lecture_digests disable row level security;

-- supabase-neuro-idem-migration.sql
-- Idempotency for the NeuroAGI kernel: a memory may carry an `idem` key; a repeated remember() with
-- the same (subject, idem) updates the existing row instead of appending a duplicate. Null idem =
-- ordinary append (the partial unique index ignores nulls, so normal writes are unaffected). Lets
-- producers dedup naturally — e.g. a session_end signal keyed by session id fired twice.
alter table public.neuro_memory add column if not exists idem text;
-- FULL unique index (NOT partial): Postgres treats NULLs as distinct, so unlimited null-idem
-- appends are allowed, while non-null (subject, idem) dedups. A PARTIAL index can't be an
-- ON CONFLICT target (Postgres 42P10) — which the idempotent upsert relies on.
drop index if exists public.neuro_memory_subject_idem_uidx;
create unique index if not exists neuro_memory_subject_idem_uidx
  on public.neuro_memory (subject, idem);
notify pgrst, 'reload schema';

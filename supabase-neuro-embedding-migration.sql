-- supabase-neuro-embedding-migration.sql
-- Semantic recall for the kernel: an optional 1536-d embedding (OpenAI text-embedding-3-small — the
-- project's RAG embedder) per memory, + cosine nearest-neighbour search via an RPC (PostgREST can't
-- express vector ORDER BY in its filter syntax). The kernel stays embed-free: callers pass the query
-- vector; embedding generation lives in the RAG layer. Subject-scoped + non-forgotten only.
create extension if not exists vector;
alter table public.neuro_memory add column if not exists embedding vector(1536);
create index if not exists neuro_memory_embedding_idx
  on public.neuro_memory using hnsw (embedding vector_cosine_ops);

create or replace function public.neuro_semantic_recall(p_subjects text[], p_query text, p_limit int)
returns setof public.neuro_memory
language sql stable
as $$
  select * from public.neuro_memory
   where subject = any(p_subjects) and forgotten_at is null and embedding is not null
   order by embedding <=> p_query::vector
   limit greatest(p_limit, 1);
$$;
revoke all on function public.neuro_semantic_recall(text[], text, int) from public;
revoke all on function public.neuro_semantic_recall(text[], text, int) from anon;
revoke all on function public.neuro_semantic_recall(text[], text, int) from authenticated;
grant execute on function public.neuro_semantic_recall(text[], text, int) to service_role;
notify pgrst, 'reload schema';

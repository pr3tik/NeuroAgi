-- RAG: per-student document retrieval (textbooks, PDFs, lecture transcripts).
-- Pattern: embed SMALL chunks, retrieve the BIG parent section ("small-to-big").
-- Hybrid search = pgvector similarity + Postgres full-text, fused with RRF.
-- Embeddings: OpenAI text-embedding-3-small (1536 dims) — dimension is locked in
-- the vector() column; do not mix embedding models in this table.

create extension if not exists vector;

-- ── documents ────────────────────────────────────────────────
create table if not exists public.rag_documents (
  id         uuid primary key default gen_random_uuid(),
  user_id    text,
  course_id  uuid,                       -- optional; no FK (courses churn on re-sync)
  title      text,
  kind       text,                       -- pdf | docx | text | audio | video | youtube
  source_url text,
  created_at timestamptz default now()
);

-- ── sections (the "big" unit returned to the model) ──────────
create table if not exists public.rag_sections (
  id          uuid primary key default gen_random_uuid(),
  document_id uuid references public.rag_documents(id) on delete cascade,
  user_id     text,
  course_id   uuid,
  heading     text,
  ordinal     int,
  loc_start   int,                        -- generic locator: page OR timestamp start
  loc_end     int,
  full_text   text
);

-- ── chunks (the "small" unit embedded) ───────────────────────
create table if not exists public.rag_chunks (
  id          uuid primary key default gen_random_uuid(),
  section_id  uuid references public.rag_sections(id) on delete cascade,
  document_id uuid references public.rag_documents(id) on delete cascade,
  user_id     text,
  course_id   uuid,
  content     text,
  embedding   vector(1536),
  tsv         tsvector generated always as (to_tsvector('english', coalesce(content, ''))) stored
);

-- Indexes: HNSW for vector similarity (cosine), GIN for full-text, btree for filters.
create index if not exists rag_chunks_embedding_idx on public.rag_chunks using hnsw (embedding vector_cosine_ops);
create index if not exists rag_chunks_tsv_idx        on public.rag_chunks using gin (tsv);
create index if not exists rag_chunks_owner_idx      on public.rag_chunks (user_id, course_id);
create index if not exists rag_sections_doc_idx      on public.rag_sections (document_id, ordinal);
create index if not exists rag_documents_owner_idx   on public.rag_documents (user_id, course_id);

-- This app uses the anon key client-side and the service key server-side, with no
-- Supabase Auth on these tables — keep RLS off (matches chat_logs/users/etc.).
-- All RAG reads/writes go through the api/rag.ts function using the service key.
alter table public.rag_documents disable row level security;
alter table public.rag_sections  disable row level security;
alter table public.rag_chunks    disable row level security;

-- ── Hybrid search: vector + full-text, fused with Reciprocal Rank Fusion ──────
-- Returns the top chunks; the caller maps these to their parent sections.
create or replace function public.rag_hybrid_search(
  p_user_id         text,
  p_query_embedding vector(1536),
  p_query_text      text,
  p_course_id       uuid  default null,
  p_match_count     int   default 8,
  p_pool            int   default 30,
  p_rrf_k           int   default 60
)
returns table (
  chunk_id    uuid,
  section_id  uuid,
  document_id uuid,
  content     text,
  score       double precision
)
language sql stable
as $$
  with vec as (
    select id, section_id, document_id, content,
           row_number() over (order by embedding <=> p_query_embedding) as rank
    from public.rag_chunks
    where user_id = p_user_id
      and (p_course_id is null or course_id = p_course_id)
      and embedding is not null
    order by embedding <=> p_query_embedding
    limit p_pool
  ),
  fts as (
    select id, section_id, document_id, content,
           row_number() over (
             order by ts_rank_cd(tsv, websearch_to_tsquery('english', p_query_text)) desc
           ) as rank
    from public.rag_chunks
    where user_id = p_user_id
      and (p_course_id is null or course_id = p_course_id)
      and p_query_text <> ''
      and tsv @@ websearch_to_tsquery('english', p_query_text)
    order by ts_rank_cd(tsv, websearch_to_tsquery('english', p_query_text)) desc
    limit p_pool
  )
  select
    coalesce(vec.id, fts.id)                   as chunk_id,
    coalesce(vec.section_id, fts.section_id)   as section_id,
    coalesce(vec.document_id, fts.document_id) as document_id,
    coalesce(vec.content, fts.content)         as content,
    coalesce(1.0 / (p_rrf_k + vec.rank), 0.0)
      + coalesce(1.0 / (p_rrf_k + fts.rank), 0.0) as score
  from vec
  full outer join fts on vec.id = fts.id
  order by score desc
  limit p_match_count;
$$;

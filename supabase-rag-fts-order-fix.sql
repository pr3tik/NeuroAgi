-- ─────────────────────────────────────────────────────────────────────────────
-- FIX: the full-text arm of hybrid search applied LIMIT without ORDER BY.
--
-- Both rag_hybrid_search and rag_room_search computed a correct relevance rank
-- via row_number() over (order by ts_rank_cd(...) desc), but then applied
-- `limit p_pool` to the CTE with no ordering on the CTE itself. Postgres is free
-- to return ANY p_pool rows from the match set, so for any query matching more
-- than p_pool (30) chunks, the keyword half of hybrid search fed RRF an
-- arbitrary subset — frequently omitting the top-ranked chunks entirely.
--
-- Only bites on queries with a large match set, which is why it went unnoticed:
-- narrow queries match < 30 chunks and are unaffected. Broad, common questions
-- are exactly the ones that degrade.
--
-- The vector arm was always correct (it has `order by embedding <=> ... limit`).
--
-- Fix is one added ORDER BY per fts CTE. Return types are unchanged, so
-- `create or replace` is safe here (no drop needed).
--
-- Source files also patched: supabase-rag-migration.sql,
-- supabase-studyroom-sprint-migration.sql — this file exists because those
-- already ran against the live DB.
--
-- Run this in the Supabase dashboard SQL Editor.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Live tutor retrieval ──────────────────────────────────────────────────
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

-- ── 2. Study-room retrieval (sibling; service-role only) ─────────────────────
create or replace function public.rag_room_search(
  p_document_ids uuid[],
  p_query_embedding vector,
  p_query_text text,
  p_match_count integer default 8,
  p_pool integer default 30,
  p_rrf_k integer default 60
)
returns table(chunk_id uuid, section_id uuid, document_id uuid, content text, score double precision)
language sql
stable
security definer
set search_path to 'public'
as $$
  with vec as (
    select id, section_id, document_id, content,
           row_number() over (order by embedding <=> p_query_embedding) as rank
    from public.rag_chunks
    where document_id = any(p_document_ids)
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
    where document_id = any(p_document_ids)
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

-- security posture preserved from the original migration
revoke all on function public.rag_room_search(uuid[], vector, text, integer, integer, integer) from public, anon, authenticated;

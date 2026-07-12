-- supabase-cost-reduction-migration.sql
-- Cost-reduction pass (2026-07-12). Run in the Supabase dashboard SQL Editor.
-- Section 1 is the only part that executes as-is; 2-4 are documented/manual steps.

-- ── 1. Lobby RPC: stop returning the whole whiteboard to every visitor ─────────
-- list_accessible_rooms returned SETOF study_rooms (SELECT r.*), which includes
-- yjs_doc — the FULL base64-encoded whiteboard (easily 50-500KB per active board) —
-- and pomodoro_state, for up to 50 rooms, on every lobby load AND every lobby
-- refetch. The lobby renders none of that; the room view fetches its own row.
--
-- NOTE: CREATE OR REPLACE cannot change a function's return type (and silently keeps
-- the OLD function running if you miss the error) — DROP first. See CLAUDE.md.
DROP FUNCTION IF EXISTS public.list_accessible_rooms(text);

CREATE FUNCTION public.list_accessible_rooms(p_user text)
RETURNS TABLE (
  id          uuid,
  created_by  text,
  name        text,
  course_id   bigint,
  room_type   text,
  max_members integer,
  is_active   boolean,
  created_at  timestamptz,
  last_active timestamptz,
  join_code   text,
  access_filters jsonb,
  topic       text,
  ai_mode     text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.id, r.created_by, r.name, r.course_id, r.room_type, r.max_members,
         r.is_active, r.created_at, r.last_active, r.join_code, r.access_filters,
         r.topic, r.ai_mode
  FROM public.study_rooms r
  WHERE r.is_active = true
    AND public.check_room_access(p_user, r.id)
  ORDER BY r.last_active DESC
  LIMIT 50;
$$;

NOTIFY pgrst, 'reload schema';

-- ── 2. One-time space reclaim after the duplicate-RAG purge ────────────────────
-- The duplicate rag_documents (same user_id+title, ~39% of the table) are deleted via
-- the app/REST path; their sections/chunks cascade. Postgres marks that space reusable
-- but the BILLED database size only shrinks after a full vacuum of the big tables.
-- Run during a quiet window (VACUUM FULL takes an exclusive lock):
--   VACUUM FULL VERBOSE public.rag_chunks;
--   VACUUM FULL VERBOSE public.rag_sections;
--   VACUUM FULL VERBOSE public.rag_documents;
--   REINDEX TABLE public.rag_chunks;   -- shrinks the HNSW index after the purge

-- ── 3. OPTIONAL: halve the embedding footprint (halfvec) ──────────────────────
-- rag_chunks.embedding is vector(1536) float32 (~6.1KB/row) + an HNSW index of
-- comparable size. pgvector's halfvec stores float16 (~3KB/row) with negligible
-- retrieval-quality loss and NO re-embedding needed. Requires pgvector >= 0.7.
-- The rag_hybrid_search RPC and api/rag.ts keep working unchanged (Postgres casts
-- the incoming query vector). Uncomment to apply:
--   ALTER TABLE public.rag_chunks ALTER COLUMN embedding TYPE halfvec(1536);
--   DROP INDEX IF EXISTS rag_chunks_embedding_idx;
--   CREATE INDEX rag_chunks_embedding_idx ON public.rag_chunks
--     USING hnsw (embedding halfvec_cosine_ops);
--   -- then: update rag_hybrid_search's parameter/cast if it names vector(1536) explicitly.
-- (A further ~3x is available by re-embedding at dimensions:512 — bigger job, do later.)

-- ── 4. Diagnostics: what is actually big right now ─────────────────────────────
--   SELECT relname, pg_size_pretty(pg_total_relation_size(relid)) AS total
--   FROM pg_catalog.pg_statio_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 15;

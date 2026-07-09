-- LMS File Pipeline migration
-- Run in: Supabase dashboard → SQL Editor
-- Run AFTER: supabase-rag-migration.sql (needs rag_documents table for doc references)

-- OAuth token storage (Tier 1a Google + Tier 1b Microsoft)
CREATE TABLE IF NOT EXISTS user_oauth (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       text        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider      text        NOT NULL,          -- 'google' | 'microsoft'
  refresh_token text        NOT NULL,
  scopes        text[],
  connected_at  timestamptz DEFAULT now(),
  UNIQUE (user_id, provider)
);
ALTER TABLE user_oauth DISABLE ROW LEVEL SECURITY;

-- files table: add LMS columns if not present
ALTER TABLE files ADD COLUMN IF NOT EXISTS source_url   text;
ALTER TABLE files ADD COLUMN IF NOT EXISTS provider     text;    -- 'google' | 'microsoft' | 'extension'
ALTER TABLE files ADD COLUMN IF NOT EXISTS document_id  uuid;    -- RAG rag_documents.id reference

-- Speed up dedup check (source_url + user_id)
CREATE INDEX IF NOT EXISTS files_source_url_user_idx ON files (user_id, source_url)
  WHERE source_url IS NOT NULL;

-- Notify PostgREST to reload schema (fixes PGRST204 if it appears)
NOTIFY pgrst, 'reload schema';

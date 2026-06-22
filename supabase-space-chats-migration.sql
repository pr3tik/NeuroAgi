-- supabase-space-chats-migration.sql
-- YouLearn Phase 3: persistent space chat history.
-- Run in: Supabase Dashboard → SQL Editor → Run
-- Idempotent (IF NOT EXISTS / safe to re-run).

CREATE TABLE IF NOT EXISTS public.space_chats (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id   uuid        NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  user_id    text        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role       text        NOT NULL CHECK (role IN ('user', 'assistant')),
  content    text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_space_chats
  ON public.space_chats(space_id, user_id, created_at ASC);

-- RLS disabled — same pattern as spaces, space_items, flashcards_v2
ALTER TABLE public.space_chats DISABLE ROW LEVEL SECURITY;

-- supabase-spaces-migration.sql
-- YouLearn Phase 3: Spaces workspace hub.
-- Run in: Supabase Dashboard → SQL Editor → Run
-- Idempotent (IF NOT EXISTS / safe to re-run).

CREATE TABLE IF NOT EXISTS public.spaces (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     text        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name        text        NOT NULL,
  color       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  last_active timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.space_items (
  id         uuid  PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id   uuid  NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  user_id    text  NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  item_type  text  NOT NULL CHECK (item_type IN ('document','chat','flashcard_set','exam')),
  item_ref   text  NOT NULL,   -- file id / chat id / flashcard course_id / exam id
  title      text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_space_items ON public.space_items(space_id, item_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_spaces_user ON public.spaces(user_id, last_active DESC);

-- RLS disabled — app uses service key server-side, anon key client-side (same pattern as files, notifications)
ALTER TABLE public.spaces      DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.space_items DISABLE ROW LEVEL SECURITY;

-- supabase-exams-migration.sql
-- YouLearn Phase 4: Exams within Spaces.
-- Run in: Supabase Dashboard → SQL Editor → Run
-- Idempotent (IF NOT EXISTS / safe to re-run).

CREATE TABLE IF NOT EXISTS public.exams (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id   uuid        REFERENCES public.spaces(id) ON DELETE CASCADE,
  user_id    text        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  title      text,
  questions  jsonb       NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.exam_attempts (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id      uuid        REFERENCES public.exams(id) ON DELETE CASCADE,
  user_id      text        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  answers      jsonb,
  results      jsonb,
  score        numeric,
  submitted_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_exams_space  ON public.exams(space_id, user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_exam_attempts ON public.exam_attempts(exam_id, user_id, created_at DESC);

ALTER TABLE public.exams         DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_attempts DISABLE ROW LEVEL SECURITY;

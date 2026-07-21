-- supabase-exam-plans-migration.sql
-- Persisted dated study plans (generated on request by the planner specialist, and
-- UNPROMPTED by the exam-mastery-reminder cron — proactive study planning).
-- api/exam.ts generatePlanCore() has always written here best-effort; this creates the
-- table so those writes finally land. Run in Supabase Dashboard → SQL Editor.
-- Idempotent — safe to re-run.

CREATE TABLE IF NOT EXISTS public.exam_plans (
  id         TEXT        PRIMARY KEY,            -- "ep_<base36>" minted by the server
  user_id    TEXT        NOT NULL,
  course_id  TEXT,                               -- liberal: courses.id is numeric in prod, uuid elsewhere
  exam_date  DATE        NOT NULL,
  sessions   JSONB       NOT NULL DEFAULT '[]',  -- [{date,topic,activities,materialIds,estimatedMinutes}]
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_exam_plans_user ON public.exam_plans(user_id, exam_date DESC, created_at DESC);

-- New-table convention (CLAUDE.md): RLS ON. The browser READS plans (Home card) via the
-- user's JWT → owner-scoped select policy; all writes go through the service key (bypasses).
ALTER TABLE public.exam_plans ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'exam_plans' AND policyname = 'exam_plans_owner_read') THEN
    CREATE POLICY exam_plans_owner_read ON public.exam_plans
      FOR SELECT USING (user_id = public.current_profile_id());
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

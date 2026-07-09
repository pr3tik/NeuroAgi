-- supabase-intervention-tuning-migration.sql
-- Run in Supabase Dashboard → SQL Editor (FschoolAI MAIN DB).
-- Requires supabase-proactive-signals-migration.sql first.
--
-- The effectiveness feedback loop (PRD §3.5.4). Each delivered intervention is a
-- label: positive if the student opened/acted on it, negative if 2h passed with no
-- engagement. After ≥20 labels, per-student thresholds are tuned:
--   • stress_threshold — raised if the student ignores stress nudges, lowered if responsive
--   • channel_pref     — the channel (in_app/discord) the student engages with most
-- brain-intervention reads stress_threshold; the Arbiter reads channel_pref.

CREATE TABLE IF NOT EXISTS public.intervention_tuning (
  user_id          TEXT        PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  stress_threshold INT         NOT NULL DEFAULT 7,   -- high-stress trigger (0-10), tuned per student
  channel_pref     TEXT,                              -- learned best channel ('in_app'|'discord'); null = use candidate hint
  label_count      INT         NOT NULL DEFAULT 0,    -- decided labels at last tuning (for observability)
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Match the rest of the pipeline (app uses the anon key; RLS would 401).
ALTER TABLE public.intervention_tuning DISABLE ROW LEVEL SECURITY;

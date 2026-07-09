-- supabase-proactive-signals-migration.sql
-- Run in Supabase Dashboard → SQL Editor (FschoolAI MAIN DB, not the Brain DB).
--
-- Adds the proactive-delivery pipeline that sits in front of the existing
-- public.notifications table (see supabase-notifications-migration.sql):
--
--   background agents → proactive_signals (candidates)
--        → Signal Arbiter (api/arbiter.ts: dedup, rank, rate-limit, quiet hours)
--        → notification_queue (approved, with delivery + effectiveness tracking)
--        → delivery (insert into public.notifications  ±  Discord DM)
--
-- Transactional notifications (friend_request, room_invite, …) still write
-- public.notifications directly and bypass this pipeline.

-- ── proactive_signals — candidate interventions awaiting the Arbiter ──────────
CREATE TABLE IF NOT EXISTS public.proactive_signals (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       TEXT        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  agent_source  TEXT        NOT NULL,                       -- 'intervention' | 'cohort' | …
  type          TEXT        NOT NULL,                       -- nudge | assignment_due | milestone | intervention | …
  urgency_score REAL        NOT NULL DEFAULT 0.5 CHECK (urgency_score BETWEEN 0 AND 1),  -- time sensitivity
  value_score   REAL        NOT NULL DEFAULT 0.5 CHECK (value_score   BETWEEN 0 AND 1),  -- benefit to student
  title         TEXT,
  body          TEXT,
  data          JSONB,
  channel_hint  TEXT        NOT NULL DEFAULT 'in_app',      -- 'in_app' | 'discord'
  dedup_key     TEXT,                                       -- candidates sharing this (per user, while pending) are dupes
  status        TEXT        NOT NULL DEFAULT 'pending',     -- pending | approved | delivered | rejected | expired
  claimed_at    TIMESTAMPTZ,                                -- set when the Arbiter claims (pending→approved); reclaimed if stale
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 14h, NOT 6h: a candidate must outlast the worst-case quiet-hours suppression
  -- (23:00–08:00 = 9h) plus rate-limit spacing, or evening candidates expire unseen.
  expires_at    TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '14 hours'
);

-- Arbiter scan: pending candidates for a user, newest first
CREATE INDEX IF NOT EXISTS proactive_signals_pending_idx
  ON public.proactive_signals (user_id, status, created_at DESC);
-- Expiry sweep
CREATE INDEX IF NOT EXISTS proactive_signals_expiry_idx
  ON public.proactive_signals (status, expires_at);
-- Reclaim sweep: 'approved' rows whose claim went stale (run died mid-delivery)
CREATE INDEX IF NOT EXISTS proactive_signals_claimed_idx
  ON public.proactive_signals (claimed_at)
  WHERE status = 'approved';
-- Idempotency: a producer re-proposing the same (user, dedup_key) while one is
-- still pending must NOT create a duplicate candidate.
CREATE UNIQUE INDEX IF NOT EXISTS proactive_signals_dedup_uq
  ON public.proactive_signals (user_id, dedup_key)
  WHERE status = 'pending' AND dedup_key IS NOT NULL;

-- ── notification_queue — approved interventions, with delivery tracking ───────
CREATE TABLE IF NOT EXISTS public.notification_queue (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             TEXT        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  proactive_signal_id UUID        REFERENCES public.proactive_signals(id) ON DELETE SET NULL,
  type                TEXT        NOT NULL,
  channel             TEXT        NOT NULL DEFAULT 'in_app',   -- channel actually chosen by the Arbiter
  title               TEXT,
  body                TEXT,
  data                JSONB,
  scheduled_for       TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at        TIMESTAMPTZ,                              -- set when delivery succeeds
  opened_at           TIMESTAMPTZ,                              -- effectiveness: student opened it
  action_taken        BOOLEAN     NOT NULL DEFAULT false,       -- effectiveness: student acted on it
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Rate-limit lookup: deliveries for a user within a recent window
CREATE INDEX IF NOT EXISTS notification_queue_rate_idx
  ON public.notification_queue (user_id, delivered_at DESC);

-- ── per-user proactivity preferences (quiet hours + Discord) ──────────────────
-- All nullable with sensible Arbiter-side defaults, so this is non-breaking.
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS timezone          TEXT;  -- IANA, e.g. 'America/Toronto'
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS quiet_hours_start INT;   -- local hour 0-23 (default 23)
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS quiet_hours_end   INT;   -- local hour 0-23 (default 8)
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS discord_user_id   TEXT;  -- for Discord DM delivery

-- CRITICAL: match the notifications table — the app uses the anon key, so RLS
-- would 401 every read/write. Keep RLS DISABLED for consistency.
ALTER TABLE public.proactive_signals  DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_queue DISABLE ROW LEVEL SECURITY;

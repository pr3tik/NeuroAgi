-- supabase-waitlist-migration.sql — the launch waitlist.
-- Run in: Supabase Dashboard → SQL Editor → Run. Idempotent.
--
-- One row per email. Position is derived (count of earlier rows), never stored — no
-- renumbering problems. invited_at flips when an invite email goes out; converted_at
-- when the account actually signs up (set by auth flows later).

CREATE TABLE IF NOT EXISTS public.waitlist (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email        TEXT        NOT NULL UNIQUE,
  name         TEXT,
  source       TEXT,                    -- 'landing' | 'presignup-demo' | campaign tags
  referred_by  TEXT,                    -- another waitlist row's id (viral loop, phase 2)
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  invited_at   TIMESTAMPTZ,             -- set when the invite email is sent
  converted_at TIMESTAMPTZ              -- set when they actually create an account
);

CREATE INDEX IF NOT EXISTS waitlist_created_idx ON public.waitlist (created_at);
CREATE INDEX IF NOT EXISTS waitlist_invited_idx ON public.waitlist (invited_at) WHERE invited_at IS NULL;

-- Server-only table: RLS on + no policies = anon key denied, service key bypasses.
-- (Same doctrine as the 2026-07-09 Phase-1 RLS migration — the browser talks to
-- /api/waitlist, never to this table directly.)
ALTER TABLE public.waitlist ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';

-- supabase-founding-card-migration.sql — OPTIONAL dedicated table.
--
-- CURRENT SHIP PATH (2026-07): /api/founding-card writes into the EXISTING
-- public.waitlist table (source='founding-card', referred_by packs school/cw/delivery).
-- You do NOT need to run this file for the claim form to work.
--
-- Keep this around if you later want a proper founding_card_applications table
-- (cleaner columns, separate from launch waitlist). Then point api/founding-card.ts
-- at it and run this in SQL Editor.

CREATE TABLE IF NOT EXISTS public.founding_card_applications (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email            TEXT        NOT NULL UNIQUE,
  name             TEXT        NOT NULL,                 -- engraved name
  school           TEXT        NOT NULL,
  colorway         TEXT        NOT NULL,                 -- white|violet|pink|blue|green|black
  delivery         TEXT        NOT NULL DEFAULT 'standard'
                                 CHECK (delivery IN ('standard', 'founder')),
  source           TEXT        DEFAULT 'card',
  status           TEXT        NOT NULL DEFAULT 'applied'
                                 CHECK (status IN ('applied', 'approved', 'rejected', 'shipped')),
  founding_number  INT,                                  -- assign later; NULL until approved
  ip_hash          TEXT,
  country          TEXT,
  region           TEXT,
  city             TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  notified_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS fca_created_idx  ON public.founding_card_applications (created_at);
CREATE INDEX IF NOT EXISTS fca_delivery_idx ON public.founding_card_applications (delivery);
CREATE INDEX IF NOT EXISTS fca_status_idx   ON public.founding_card_applications (status);

ALTER TABLE public.founding_card_applications ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';

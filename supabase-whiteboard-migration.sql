-- supabase-whiteboard-migration.sql
-- Phase 3: Session-only collaborative whiteboard (v2 — pen styles, dual erasers, backgrounds).
-- Run in Supabase Dashboard → SQL Editor → Run. Idempotent — safe to re-run.
--
-- MODEL: strokes are append-only rows. They live only for the duration of a
-- session — when the LAST present member leaves, the client calls clear_whiteboard
-- and the rows (and the chosen background) are wiped. While anyone is still online,
-- strokes persist so a member returning from a break sees the board intact.
--
-- Two erasers:
--   • Area eraser  → an 'erase'-mode stroke, composited with destination-out (a row).
--   • Stroke eraser → deletes a whole stroke row (delete_whiteboard_stroke).
--
-- Background is shared: stored on study_rooms.whiteboard_bg so late-joiners and
-- reloads see the same board surface. Reset to default (white) on clear.
--
-- All reads + writes go through SECURITY DEFINER RPCs; direct table access is revoked.

-- ── 1. Table + columns ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.whiteboard_strokes (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id    UUID        NOT NULL REFERENCES public.study_rooms(id) ON DELETE CASCADE,
  user_id    TEXT        NOT NULL,
  name       TEXT        NOT NULL,
  mode       TEXT        NOT NULL DEFAULT 'pen' CHECK (mode IN ('pen', 'erase')),
  color      TEXT        NOT NULL,
  width      INT         NOT NULL CHECK (width BETWEEN 1 AND 200),
  points     JSONB       NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- v2 additions (idempotent for boards created by the v1 migration).
ALTER TABLE public.whiteboard_strokes ADD COLUMN IF NOT EXISTS style TEXT NOT NULL DEFAULT 'normal';
ALTER TABLE public.study_rooms        ADD COLUMN IF NOT EXISTS whiteboard_bg TEXT;

CREATE INDEX IF NOT EXISTS whiteboard_strokes_room_created
  ON public.whiteboard_strokes (room_id, created_at);

-- ── 2. RPC: add a stroke (verifies sender is a joined member) ─────────────────
-- Drop the v1 signature first; adding a param would otherwise create an overload.
DROP FUNCTION IF EXISTS public.add_whiteboard_stroke(text, uuid, text, text, int, jsonb);

CREATE OR REPLACE FUNCTION public.add_whiteboard_stroke(
  p_user text, p_room uuid, p_mode text, p_style text, p_color text, p_width int, p_points jsonb
)
RETURNS public.whiteboard_strokes
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  stroke public.whiteboard_strokes;
  uname  text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.room_members
    WHERE room_id = p_room AND user_id = public.current_profile_id() AND status = 'joined'
  ) THEN
    RAISE EXCEPTION 'not a joined member';
  END IF;

  SELECT name INTO uname FROM public.users WHERE id = public.current_profile_id();

  INSERT INTO public.whiteboard_strokes(room_id, user_id, name, mode, style, color, width, points)
  VALUES (p_room, public.current_profile_id(), COALESCE(uname, 'Anonymous'), p_mode, p_style, p_color, p_width, p_points)
  RETURNING * INTO stroke;

  RETURN stroke;
END;
$$;

-- ── 3. RPC: load the board (verifies caller is a joined member) ───────────────
CREATE OR REPLACE FUNCTION public.load_whiteboard(
  p_user text, p_room uuid
)
RETURNS SETOF public.whiteboard_strokes
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.room_members
    WHERE room_id = p_room AND user_id = public.current_profile_id() AND status = 'joined'
  ) THEN
    RAISE EXCEPTION 'not a joined member';
  END IF;

  RETURN QUERY
    SELECT * FROM public.whiteboard_strokes
    WHERE room_id = p_room
    ORDER BY created_at ASC;
END;
$$;

-- ── 4. RPC: delete one stroke (stroke eraser — any joined member) ─────────────
CREATE OR REPLACE FUNCTION public.delete_whiteboard_stroke(
  p_user text, p_room uuid, p_id uuid
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.room_members
    WHERE room_id = p_room AND user_id = public.current_profile_id() AND status = 'joined'
  ) THEN
    RAISE EXCEPTION 'not a joined member';
  END IF;

  DELETE FROM public.whiteboard_strokes WHERE id = p_id AND room_id = p_room;
END;
$$;

-- ── 5. RPC: set the shared background (any joined member) ─────────────────────
CREATE OR REPLACE FUNCTION public.set_whiteboard_bg(
  p_user text, p_room uuid, p_bg text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.room_members
    WHERE room_id = p_room AND user_id = public.current_profile_id() AND status = 'joined'
  ) THEN
    RAISE EXCEPTION 'not a joined member';
  END IF;

  UPDATE public.study_rooms SET whiteboard_bg = p_bg WHERE id = p_room;
END;
$$;

-- ── 6. RPC: clear the board + reset background (last member to leave) ─────────
CREATE OR REPLACE FUNCTION public.clear_whiteboard(
  p_user text, p_room uuid
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.room_members
    WHERE room_id = p_room AND user_id = public.current_profile_id() AND status = 'joined'
  ) THEN
    RAISE EXCEPTION 'not a joined member';
  END IF;

  DELETE FROM public.whiteboard_strokes WHERE room_id = p_room;
  UPDATE public.study_rooms SET whiteboard_bg = NULL WHERE id = p_room;
END;
$$;

-- ── 7. Grants + lockdown ──────────────────────────────────────────────────────
-- The acting user is derived from current_profile_id() (the JWT), NOT the p_user param, so a
-- session is required — revoke EXECUTE from PUBLIC (anon inherits it) + anon, grant only to
-- authenticated + service_role. (p_user stays in the signature but is ignored by the bodies.)
REVOKE EXECUTE ON FUNCTION public.add_whiteboard_stroke(text, uuid, text, text, text, int, jsonb) FROM public, anon;
REVOKE EXECUTE ON FUNCTION public.load_whiteboard(text, uuid)                                      FROM public, anon;
REVOKE EXECUTE ON FUNCTION public.delete_whiteboard_stroke(text, uuid, uuid)                       FROM public, anon;
REVOKE EXECUTE ON FUNCTION public.set_whiteboard_bg(text, uuid, text)                              FROM public, anon;
REVOKE EXECUTE ON FUNCTION public.clear_whiteboard(text, uuid)                                     FROM public, anon;

GRANT EXECUTE ON FUNCTION public.add_whiteboard_stroke(text, uuid, text, text, text, int, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.load_whiteboard(text, uuid)                                      TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_whiteboard_stroke(text, uuid, uuid)                       TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_whiteboard_bg(text, uuid, text)                              TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.clear_whiteboard(text, uuid)                                     TO authenticated, service_role;

REVOKE INSERT, UPDATE, DELETE, SELECT ON public.whiteboard_strokes FROM anon, authenticated;

-- Achievements: persistent unlock records for the badge/achievements system.
-- Metadata (name/icon/description) lives in a TS constant (src/lib/achievements.ts),
-- same pattern as TOKEN_LABELS/TOKEN_ICONS in Identity.tsx — not a DB catalog table.

create table if not exists public.user_achievements (
  user_id          text not null references public.users(id) on delete cascade,
  achievement_key  text not null,
  unlocked_at      timestamptz default now(),
  meta             jsonb,
  primary key (user_id, achievement_key)
);

alter table public.user_achievements disable row level security;

notify pgrst, 'reload schema';

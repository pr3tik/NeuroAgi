-- Guest demo usage (PRD §5.1 v2.1, S1): tracks anonymous pre-signup "instant demo"
-- calls so they can be rate-limited server-side. Keyed by BOTH the browser's guest
-- uid (src/context/AppContext.tsx getOrCreateUserId) and IP — uid alone is trivially
-- bypassed by clearing localStorage, IP alone over-blocks shared networks.

create table if not exists public.guest_demo_usage (
  id         uuid primary key default gen_random_uuid(),
  guest_uid  text not null,
  ip         text not null,
  created_at timestamptz not null default now()
);

create index if not exists guest_demo_usage_guest_uid_idx on public.guest_demo_usage (guest_uid, created_at);
create index if not exists guest_demo_usage_ip_idx        on public.guest_demo_usage (ip, created_at);

alter table public.guest_demo_usage disable row level security;

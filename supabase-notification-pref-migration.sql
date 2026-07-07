-- S9 (PRD §5.1 v2.1): notification-permission ask, shown once after the
-- student's first completed tutor session (never during onboarding itself).
--   notification_permission → 'granted' | 'denied' | 'dismissed' (browser
--     Notification.permission result, or 'dismissed' if they tapped "Not now")
--   notification_asked_at    → when the one-time ask was shown, so it never
--     shows twice even across devices/browsers

alter table public.users add column if not exists notification_permission text;
alter table public.users add column if not exists notification_asked_at   timestamptz;

alter table public.users drop constraint if exists users_notification_permission_check;
alter table public.users add  constraint users_notification_permission_check
  check (notification_permission is null or notification_permission in ('granted', 'denied', 'dismissed'));

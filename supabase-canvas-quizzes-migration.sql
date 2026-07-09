-- Persists Canvas quiz/exam data with real due dates — previously fetched (with
-- due_at, quiz_type, title already parsed by canvasTransform.normalizeQuiz) but only
-- ever saved to the canvas_data blob, never a queryable structured table. The
-- exam-mastery reminder cron (api/exam-mastery-reminder.ts) needs to scan across ALL
-- users for upcoming quizzes, which a per-user blob can't support efficiently.
--
-- course_id is `text`, matching flashcards_v2/srs_reviews/deck_profiles — courses.id
-- is numeric/text-compatible in this app, not uuid (see supabase-srs-course-id-fix-migration.sql).

create table if not exists public.canvas_quizzes (
  id                 uuid primary key default gen_random_uuid(),
  user_id            text not null references public.users(id) on delete cascade,
  course_id          text not null,
  external_quiz_id   text not null,   -- Canvas's own quiz id, for upsert-on-resync
  title              text not null,
  due_at             timestamptz,
  quiz_type          text,
  points_possible    numeric,
  topics             jsonb,           -- lazily filled by the reminder cron on first sighting within window
  topics_generated_at timestamptz,
  created_at         timestamptz default now(),
  unique (user_id, external_quiz_id)
);

create index if not exists canvas_quizzes_due_idx on public.canvas_quizzes (user_id, due_at);

alter table public.canvas_quizzes disable row level security;

notify pgrst, 'reload schema';

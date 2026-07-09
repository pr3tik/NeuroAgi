-- Deck Signature Analysis: a cached, AI-generated profile of what a student's
-- flashcard deck for a course actually covers and how well, built from their real
-- flashcards (mostly hand-written) plus their real srs_reviews performance history.
-- Feeds both the exam-mastery reminder and the "suggest more cards" deck-expansion
-- feature (see api/deck-profile.ts).
--
-- course_id is `text`, NOT `uuid` — courses.id is actually numeric/text-compatible in
-- this app (confirmed live: flashcards_v2.course_id and srs_reviews.course_id are both
-- `text`, not `uuid`, despite what earlier migration files assumed). Matching that here
-- on purpose to avoid the exact type mismatch that broke srs_reviews.

create table if not exists public.deck_profiles (
  user_id      text not null references public.users(id) on delete cascade,
  course_id    text not null,
  topics       jsonb not null,   -- [{ topic, confidence (0-1), card_count }, ...]
  style_notes  text,             -- brief description of the deck's own voice/format
  card_count   int not null,     -- snapshot at generation time, to detect staleness
  generated_at timestamptz default now(),
  primary key (user_id, course_id)
);

alter table public.deck_profiles disable row level security;

notify pgrst, 'reload schema';

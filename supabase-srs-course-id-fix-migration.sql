-- Fix srs_reviews.course_id type mismatch: the original srs migration declared it
-- `uuid`, but courses.id is actually numeric (bigint/serial) and flashcards_v2.course_id
-- (the equivalent column on the sibling table) is `text`, not `uuid`. Confirmed live:
-- inserting a numeric course id into flashcards_v2.course_id succeeds and is stored/
-- returned as text; the same value into srs_reviews.course_id fails with
-- "invalid input syntax for type uuid". Align srs_reviews with the working pattern.

alter table public.srs_reviews alter column course_id type text using course_id::text;

notify pgrst, 'reload schema';

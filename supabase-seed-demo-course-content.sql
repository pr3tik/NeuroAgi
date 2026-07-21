-- supabase-seed-demo-course-content.sql
-- Seeds a rich, self-contained DEMO Course Brain so the shared-library grounding is visible in a
-- demo without polluting real students' data. Everything is scoped to an ISOLATED demo institution
-- (university_id = 'demo.fschoolai.com') and a made-up course/professor, and wired to the reusable
-- e2e demo account (e2e.student@fschoolai.com). Real q.utoronto.ca users never see these rows
-- (course-library reads are university_id-scoped).
--
-- Idempotent: safe to re-run (course_content rows keyed by the source_url sentinel are cleared
-- first; the demo course upserts on its unique key).
--
-- To show it in the demo: sign in as e2e.student, open the tutor, select COG250 as the active
-- course, and ask a course question (e.g. "what is on the midterm?" / "explain the grading").

-- 1. Point the e2e demo account at the isolated demo institution.
update public.users
   set university_id  = 'demo.fschoolai.com',
       canvas_base_url = 'https://demo.fschoolai.com'
 where email = 'e2e.student@fschoolai.com';

-- 2. Enroll the demo account in the demo course (idempotent on user_id+canvas_course_id).
insert into public.courses (user_id, canvas_course_id, name, course_code, professor, semester, source, current_score)
select u.id, 'DEMOCOG250', 'COG250: Introduction to Cognitive Science', 'COG250', 'Dr. Ada Reyes', 'Fall 2026', 'manual', 88
  from public.users u
 where u.email = 'e2e.student@fschoolai.com'
on conflict (user_id, canvas_course_id) do update
   set name = excluded.name, course_code = excluded.course_code, professor = excluded.professor;

-- 3. Seed the Course Brain (5 professor-published artifact types). Clear prior seed rows first.
delete from public.course_content where source_url = 'seed://demo-cog250';

insert into public.course_content
  (university_id, course_id, canvas_course_id, content_type, content_hash, text, summary, concepts,
   module_name, professor_name, source_url, first_seen_at, last_seen_at, seen_by_count, is_private)
values
  ('demo.fschoolai.com','COG250','DEMOCOG250','syllabus', md5('demo-cog250-syllabus'),
   'COG250 Introduction to Cognitive Science, instructor Dr. Ada Reyes. An interdisciplinary survey of the mind spanning psychology, neuroscience, linguistics, computer science, and philosophy. Weekly topics: what is cognitive science, perception and the visual system, attention and working memory, long-term memory and learning, language and the mental lexicon, concepts and categorization, reasoning and decision-making, problem solving, consciousness, cognitive development, computational models and neural networks, and a final review. Lectures Tuesday and Thursday with one weekly tutorial.',
   'Course overview and weekly topic list for COG250 (Intro to Cognitive Science) with Dr. Ada Reyes.',
   '["cognitive science","perception","attention","memory","language","categorization","reasoning"]'::jsonb,
   null, 'Dr. Ada Reyes', 'seed://demo-cog250', now(), now(), 9, false),

  ('demo.fschoolai.com','COG250','DEMOCOG250','rubric', md5('demo-cog250-rubric'),
   'Grading structure for COG250: midterm exam 30 percent, final exam 40 percent, two written assignments 20 percent (10 percent each), and tutorial participation 10 percent. Late assignments lose 5 percent per day. The final exam is cumulative.',
   'COG250 grading breakdown: midterm 30, final 40, assignments 20, participation 10.',
   '["grading","midterm","final","assignments","participation"]'::jsonb,
   null, 'Dr. Ada Reyes', 'seed://demo-cog250', now(), now(), 9, false),

  ('demo.fschoolai.com','COG250','DEMOCOG250','assessment', md5('demo-cog250-assessment'),
   'Assessment schedule for COG250: Assignment 1 (a concept map) is due in Week 4. The midterm exam is in Week 6 and covers Weeks 1 to 5. Assignment 2 (a short research review) is due in Week 10. The final exam is during the December exam period and is cumulative.',
   'COG250 assessment schedule: A1 Week 4, midterm Week 6, A2 Week 10, cumulative final in December.',
   '["assignment 1","midterm","assignment 2","final exam","schedule"]'::jsonb,
   null, 'Dr. Ada Reyes', 'seed://demo-cog250', now(), now(), 9, false),

  ('demo.fschoolai.com','COG250','DEMOCOG250','module', md5('demo-cog250-module'),
   'Course topic sequence for COG250: 1 foundations of cognitive science, 2 perception, 3 attention and working memory, 4 memory and learning, 5 language, 6 concepts and categorization, 7 reasoning and decision-making, 8 problem solving, 9 consciousness, 10 cognitive development, 11 computational models and neural networks.',
   'COG250 module sequence across the term, from foundations through computational models.',
   '["perception","attention","working memory","language","categorization","decision-making","neural networks"]'::jsonb,
   'Full course topic sequence', 'Dr. Ada Reyes', 'seed://demo-cog250', now(), now(), 9, false),

  ('demo.fschoolai.com','COG250','DEMOCOG250','file', md5('demo-cog250-file'),
   'Posted materials for COG250: lecture slides for Weeks 1 to 12, a reading list (a cognitive science textbook chapters 4 to 9 plus selected papers on attention and memory), tutorial worksheets, a practice midterm, and a study guide for the final exam.',
   'COG250 posted materials: slides, readings, worksheets, practice midterm, final study guide.',
   '["lecture slides","readings","worksheets","practice midterm","study guide"]'::jsonb,
   null, 'Dr. Ada Reyes', 'seed://demo-cog250', now(), now(), 9, false);

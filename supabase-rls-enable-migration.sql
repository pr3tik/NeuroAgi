-- supabase-rls-enable-migration.sql
-- Turns ON row-level security for tables whose policies were already written (via
-- current_profile_id() = the app profile for the current Supabase Auth session) but never
-- enabled — so the anon key could read/write everyone's data. Server code uses the service
-- role, which BYPASSES RLS, so API endpoints are unaffected; only direct browser (anon-key)
-- access is now restricted to the signed-in user's own rows.
--
-- Applied via the Supabase Management API. Reversible: `alter table X disable row level security`.
--
-- NOT enabled here (need separate work):
--   users, friendships — currently have wide-open ALL:true policies; enabling gives no security.
--     users needs a self policy + public name-reads routed through the users_public view.
--   beta_sessions — looks like pre-login analytics (may run without a session).

-- add missing self-policies (these three had a user_id but no policy)
drop policy if exists canvas_quizzes_self on public.canvas_quizzes;
create policy canvas_quizzes_self on public.canvas_quizzes for all using (user_id = current_profile_id()) with check (user_id = current_profile_id());
drop policy if exists deck_profiles_self on public.deck_profiles;
create policy deck_profiles_self on public.deck_profiles for all using (user_id = current_profile_id()) with check (user_id = current_profile_id());
drop policy if exists lecture_digests_self on public.lecture_digests;
create policy lecture_digests_self on public.lecture_digests for all using (user_id = current_profile_id()) with check (user_id = current_profile_id());

-- enable RLS (policies already resolve for logged-in users; legacy accounts auto-link on next login)
alter table public.assignments        enable row level security;
alter table public.canvas_data         enable row level security;
alter table public.canvas_quizzes      enable row level security;
alter table public.chat_conversations  enable row level security;
alter table public.chat_logs           enable row level security;
alter table public.course_content      enable row level security;
alter table public.courses             enable row level security;
alter table public.deck_profiles       enable row level security;
alter table public.files               enable row level security;
alter table public.flashcards          enable row level security;
alter table public.lecture_digests     enable row level security;
alter table public.notifications       enable row level security;
alter table public.nudges              enable row level security;
alter table public.rag_documents       enable row level security;
alter table public.room_members        enable row level security;
alter table public.room_sessions       enable row level security;
alter table public.schools             enable row level security;
alter table public.srs_reviews         enable row level security;
alter table public.study_rooms         enable row level security;
alter table public.tutor_impressions   enable row level security;
alter table public.tutor_mind          enable row level security;

notify pgrst, 'reload schema';

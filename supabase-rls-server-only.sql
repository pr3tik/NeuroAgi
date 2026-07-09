-- RLS Phase 1 -- server-only tables. APPLIED TO PROD 2026-07-09 via Supabase MCP
-- migration 'rls_phase1_server_only_tables' (this file now mirrors what ran).
--
-- Every table below had ZERO references in src/ (verified 2026-07-09) and no realtime
-- (postgres_changes) subscription -- the browser never touches them with the anon key.
-- service_role BYPASSES RLS, so all server endpoints keep working; the public anon key
-- is denied ("RLS on + no policy" = deny-by-default). Leftover permissive policies were
-- dropped in the same migration -- Postgres ORs permissive policies, so a stray
-- open_all USING(true) would have re-opened the table the moment RLS turned on.
--
-- Client-facing tables are Phase 2 (supabase-rls-client-tables.sql) and are BLOCKED on
-- auth_id coverage: 2026-07-09 measurement = 133 users, 63 with auth_id, 70 without
-- (15 of them active). Enabling owner-scoped policies today locks those 70 out --
-- finish the GoTrue migration/backfill first.

alter table public.rag_chunks                     enable row level security;
alter table public.rag_sections                   enable row level security;
alter table public.media_jobs                     enable row level security;
alter table public.brain_nodes                    enable row level security;
alter table public.brain_edges                    enable row level security;
alter table public.brain_node_sources             enable row level security;
alter table public.room_messages                  enable row level security;
alter table public.whiteboard_strokes             enable row level security;
alter table public.strategy_provenance            enable row level security;
alter table public.student_strategy_affinity      enable row level security;
alter table public.teaching_strategies            enable row level security;
alter table public.session_close_queue            enable row level security;
alter table public.user_id_merges                 enable row level security;
alter table public.user_oauth                     enable row level security;
alter table public.guest_demo_usage               enable row level security;
alter table public.deploy_log                     enable row level security;
alter table public.lecture_recordings             enable row level security;
alter table public.weekly_plans                   enable row level security;
alter table public.intervention_tuning            enable row level security;
alter table public.proactive_signals              enable row level security;
alter table public.knowledge_graph                enable row level security;
alter table public.impressions                    enable row level security;
alter table public.students                       enable row level security;
alter table public.sessions                       enable row level security;
alter table public.messages                       enable row level security;
alter table public.chat_sessions                  enable row level security;
alter table public.flashcard_attempts             enable row level security;
alter table public.user_achievements              enable row level security;
alter table public.calendar_connections           enable row level security;
alter table public.token_events                   enable row level security;
alter table public.reggie_founding_record         enable row level security;

-- Strip leftover permissive policies on the Phase-1 set (see header).
do $$
declare t text; r record;
begin
  foreach t in array array[
    'rag_chunks','rag_sections','media_jobs','brain_nodes','brain_edges','brain_node_sources','room_messages','whiteboard_strokes','strategy_provenance','student_strategy_affinity','teaching_strategies','session_close_queue','user_id_merges','user_oauth','guest_demo_usage','deploy_log','lecture_recordings','weekly_plans','intervention_tuning','proactive_signals','knowledge_graph','impressions','students','sessions','messages','chat_sessions','flashcard_attempts','user_achievements','calendar_connections','token_events','reggie_founding_record'
  ] loop
    for r in select policyname from pg_policies where schemaname='public' and tablename=t loop
      execute format('drop policy %I on public.%I;', r.policyname, t);
    end loop;
  end loop;
end $$;

notify pgrst, 'reload schema';

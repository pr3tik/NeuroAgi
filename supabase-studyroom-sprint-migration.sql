-- supabase-studyroom-sprint-migration.sql
-- Study Room sprint foundations (BE-01/BE-02/BE-05/BE-11 + AI-01/AI-12 schema).
-- Applied to prod via the Supabase Management API on 2026-07-16. Committed for visibility.
--
-- Design decisions (see STUDYROOM_ARCHITECTURE.md for the full contract):
--  • EXISTING tables are reused, not duplicated: study_rooms (room identity, join_code,
--    yjs_doc, pomodoro_state), room_members (membership), room_messages (group chat),
--    room_sessions (per-MEMBER attendance rows — already live with 400+ rows).
--    The plan's "timed room-wide occurrence" is therefore named room_ai_sessions
--    to avoid colliding with the existing per-member room_sessions.
--  • ID spaces follow the live DB: users.id TEXT, study_rooms.id UUID,
--    study_rooms.course_id BIGINT (Canvas space), rag_documents.id/course_id UUID.
--    [[postgrest-uuid-cast-gotcha]]
--  • RLS posture: every new table is RLS-ON with NO client policies (deny-all for
--    anon/authenticated; the server's service key bypasses). Client access goes through
--    /api endpoints only. This matches the current API-SECURITY.md posture.
--  • High-volume tables (activity_events, prompt_runs) carry no FKs to users so system
--    actors ("reggie", crons) and retention deletes stay cheap.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Room configuration (versioned; persona + proactivity live here)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.room_configs (
  id                     uuid primary key default gen_random_uuid(),
  room_id                uuid not null references public.study_rooms(id) on delete cascade,
  version                int  not null,
  persona                text not null default 'facilitator'
                         check (persona in ('facilitator','peer_teaching','clarifier','challenger','timekeeper','observer')),
  intervention_intensity text not null default 'balanced'
                         check (intervention_intensity in ('low','balanced','active')),
  duration_minutes       int  check (duration_minutes between 15 and 180),
  focus_blocks           jsonb,
  participant_cap        int  check (participant_cap between 2 and 50),
  created_by             text not null,
  created_at             timestamptz not null default now(),
  unique (room_id, version)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Room sources — references the student's EXISTING ingested documents.
--    Binding a doc to a room is an explicit share: room AI may retrieve from it.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.room_sources (
  id          uuid primary key default gen_random_uuid(),
  room_id     uuid not null references public.study_rooms(id) on delete cascade,
  document_id uuid not null references public.rag_documents(id) on delete cascade,
  added_by    text not null,
  enabled     boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (room_id, document_id)
);
create index if not exists room_sources_room_idx on public.room_sources (room_id) where enabled;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Room AI sessions — the timed room-wide occurrence the AI facilitates.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.room_ai_sessions (
  id                 uuid primary key default gen_random_uuid(),
  room_id            uuid not null references public.study_rooms(id) on delete cascade,
  config_version     int,
  state              text not null default 'active' check (state in ('active','ended','frozen')),
  started_by         text not null,
  started_at         timestamptz not null default now(),
  ended_at           timestamptz,
  final_board_digest text,
  created_at         timestamptz not null default now()
);
create index if not exists room_ai_sessions_room_idx on public.room_ai_sessions (room_id, started_at desc);
-- one ACTIVE session per room at a time
create unique index if not exists room_ai_sessions_one_active
  on public.room_ai_sessions (room_id) where state = 'active';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Whiteboard snapshots — AI-readable immutable revisions (the live board stays
--    Yjs-over-broadcast; this is the extraction the AI/summary path reads).
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.whiteboard_snapshots (
  id             uuid primary key default gen_random_uuid(),
  room_id        uuid not null references public.study_rooms(id) on delete cascade,
  session_id     uuid references public.room_ai_sessions(id) on delete set null,
  revision       int  not null,
  extracted_text text,
  extracted_json jsonb,
  render_path    text,          -- Supabase Storage path of the rendered PNG, if any
  digest         text,          -- content hash for change detection
  created_at     timestamptz not null default now(),
  unique (room_id, revision)
);
create index if not exists whiteboard_snapshots_latest_idx on public.whiteboard_snapshots (room_id, revision desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Private help threads — strictly per-student; NEVER readable by peers.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.private_threads (
  id         uuid primary key default gen_random_uuid(),
  session_id uuid references public.room_ai_sessions(id) on delete cascade,
  room_id    uuid not null references public.study_rooms(id) on delete cascade,
  user_id    text not null references public.users(id) on delete cascade,
  status     text not null default 'open' check (status in ('open','closed')),
  retention  text not null default 'standard' check (retention in ('standard','short')),
  created_at timestamptz not null default now()
);
create index if not exists private_threads_user_idx on public.private_threads (user_id, created_at desc);

create table if not exists public.private_messages (
  id          uuid primary key default gen_random_uuid(),
  thread_id   uuid not null references public.private_threads(id) on delete cascade,
  author_type text not null check (author_type in ('user','ai')),
  body        text not null,
  created_at  timestamptz not null default now()
);
create index if not exists private_messages_thread_idx on public.private_messages (thread_id, created_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Student Brain — canonical, versioned, consent-gated (AI-01).
--    The profile is a structured JSON document (contract in api/_contracts.ts;
--    schema_version 1). Versions are immutable; student_brains points at the
--    active one. Proposals NEVER mutate directly (AI-12).
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.student_brains (
  user_id               text primary key references public.users(id) on delete cascade,
  active_version_id     uuid,
  consent_room_pedagogy boolean not null default true,   -- may scoped fields feed a room teaching plan?
  consent_updates       boolean not null default true,   -- may sessions propose profile updates?
  updated_at            timestamptz not null default now()
);

create table if not exists public.brain_versions (
  id             uuid primary key default gen_random_uuid(),
  user_id        text not null references public.users(id) on delete cascade,
  schema_version int  not null default 1,
  profile        jsonb not null,
  markdown       text,                       -- human-readable projection (derived, non-canonical)
  source         text not null default 'init' check (source in ('init','proposal','manual')),
  created_at     timestamptz not null default now()
);
create index if not exists brain_versions_user_idx on public.brain_versions (user_id, created_at desc);

create table if not exists public.brain_update_proposals (
  id         uuid primary key default gen_random_uuid(),
  session_id uuid references public.room_ai_sessions(id) on delete set null,
  user_id    text not null references public.users(id) on delete cascade,
  patch      jsonb not null,                 -- partial profile: sections to merge
  evidence   jsonb,                          -- [{kind, ref, note}]
  confidence real check (confidence between 0 and 1),
  status     text not null default 'pending' check (status in ('pending','accepted','edited','rejected','expired')),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days'
);
create index if not exists brain_proposals_user_idx on public.brain_update_proposals (user_id, status, created_at desc);

-- Room teaching plan snapshot — SERVER-ONLY derived artefact. Clients only ever
-- receive the benign group summary via the API, never this row.
create table if not exists public.room_brain_snapshots (
  id                    uuid primary key default gen_random_uuid(),
  session_id            uuid not null references public.room_ai_sessions(id) on delete cascade,
  source_version_ids    jsonb,               -- brain_versions ids (or null for intake-derived)
  participant_summaries jsonb not null,      -- scoped per-student pedagogy fields ONLY
  group_strategy        jsonb not null,
  content_hash          text,
  created_at            timestamptz not null default now()
);
create index if not exists room_brain_snapshots_session_idx on public.room_brain_snapshots (session_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Participation + proactivity audit
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.activity_events (
  id           bigint generated always as identity primary key,
  session_id   uuid not null,
  room_id      uuid not null,
  user_id      text not null,
  type         text not null check (type in
               ('chat_sent','board_burst','talk_to_ai','peer_reply','focus_state','hand_raise','private_help_state','timer_milestone','session_started','session_ended')),
  magnitude    real not null default 1,
  bucket_start timestamptz not null default date_trunc('minute', now()),
  meta         jsonb,
  created_at   timestamptz not null default now()
);
create index if not exists activity_events_session_idx on public.activity_events (session_id, bucket_start, user_id);

create table if not exists public.participant_metrics (
  session_id     uuid not null,
  user_id        text not null,
  chat_score     real not null default 0,
  board_score    real not null default 0,
  peer_score     real not null default 0,
  help_score     real not null default 0,
  active_seconds int  not null default 0,
  computed_at    timestamptz not null default now(),
  primary key (session_id, user_id)
);

create table if not exists public.intervention_events (
  id             uuid primary key default gen_random_uuid(),
  session_id     uuid not null,
  rule           text not null,
  target_user_id text,
  state          jsonb,
  decision       text not null check (decision in ('sent','suppressed_cooldown','suppressed_budget','suppressed_optout','suppressed_paused','no_op')),
  message_id     uuid,
  created_at     timestamptz not null default now()
);
create index if not exists intervention_events_session_idx on public.intervention_events (session_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Session outputs
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.session_summaries (
  id         uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.room_ai_sessions(id) on delete cascade,
  scope      text not null check (scope in ('group','individual')),
  user_id    text,                           -- null for group scope
  summary    jsonb not null,
  version    int not null default 1,
  status     text not null default 'complete' check (status in ('pending','complete','failed')),
  created_at timestamptz not null default now()
);
create unique index if not exists session_summaries_group_uniq
  on public.session_summaries (session_id, scope) where user_id is null;
create unique index if not exists session_summaries_indiv_uniq
  on public.session_summaries (session_id, scope, user_id) where user_id is not null;

create table if not exists public.quiz_sets (
  id         uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.room_ai_sessions(id) on delete cascade,
  user_id    text not null,
  questions  jsonb not null,                 -- exactly five {question, options[4], correctIndex, rationale, evidence}
  evidence   jsonb,
  version    int not null default 1,
  created_at timestamptz not null default now(),
  unique (session_id, user_id)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. Jobs (BE-08 contract — table + claim function; the worker is Siddharth's)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.jobs (
  id              uuid primary key default gen_random_uuid(),
  type            text not null,
  idempotency_key text not null unique,
  payload         jsonb,
  status          text not null default 'queued' check (status in ('queued','running','done','failed','dead')),
  attempts        int not null default 0,
  run_after       timestamptz not null default now(),
  lease_until     timestamptz,
  last_error      text,
  output_ref      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists jobs_runnable_idx on public.jobs (status, run_after) where status in ('queued','failed');

-- Atomic claim: takes the oldest runnable job of the given types, marks it running
-- with a lease. Server-only (service key); workers call this instead of ad-hoc UPDATEs.
create or replace function public.claim_job(p_types text[], p_lease_secs int default 120)
returns setof public.jobs
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  return query
  update public.jobs j
     set status = 'running', attempts = j.attempts + 1,
         lease_until = now() + make_interval(secs => p_lease_secs), updated_at = now()
   where j.id = (
     select id from public.jobs
      where status in ('queued','failed') and run_after <= now() and type = any(p_types)
      order by created_at
      for update skip locked
      limit 1)
  returning *;
end;
$$;
revoke all on function public.claim_job(text[], int) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. prompt_runs — LLM observability (BE-12). Written by the gateway trace sink.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.prompt_runs (
  id            bigint generated always as identity primary key,
  trace_id      text not null,
  ts            timestamptz not null default now(),
  task          text,
  scope         text,                        -- group | private | tutor | job | other
  user_id       text,
  room_id       uuid,
  session_id    uuid,
  persona       text,
  provider      text,
  model         text,
  input_tokens  int,
  output_tokens int,
  cache_read    int,
  cache_write   int,
  latency_ms    int,
  cost_usd      numeric(12,6),
  status        text,
  fell_back     boolean,
  attempts      int,
  error         text,
  metadata      jsonb
);
create index if not exists prompt_runs_ts_idx    on public.prompt_runs (ts desc);
create index if not exists prompt_runs_trace_idx on public.prompt_runs (trace_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 11. RLS: every new table is server-only. RLS-on + zero policies denies the anon
--     and authenticated roles; the service key bypasses. Belt-and-braces revokes.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'room_configs','room_sources','room_ai_sessions','whiteboard_snapshots',
    'private_threads','private_messages',
    'student_brains','brain_versions','brain_update_proposals','room_brain_snapshots',
    'activity_events','participant_metrics','intervention_events',
    'session_summaries','quiz_sets','jobs','prompt_runs'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 12. rag_room_search — document-ID-scoped retrieval for room AI (sibling of
--     rag_hybrid_search; the live tutor path is untouched). Bypasses per-user
--     scoping BY DESIGN: binding a doc into room_sources is an explicit share,
--     and the ONLY caller is the server, which must verify room membership and
--     resolve the room's enabled document ids first. Service-role only.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.rag_room_search(
  p_document_ids uuid[],
  p_query_embedding vector,
  p_query_text text,
  p_match_count integer default 8,
  p_pool integer default 30,
  p_rrf_k integer default 60
)
returns table(chunk_id uuid, section_id uuid, document_id uuid, content text, score double precision)
language sql
stable
security definer
set search_path to 'public'
as $$
  with vec as (
    select id, section_id, document_id, content,
           row_number() over (order by embedding <=> p_query_embedding) as rank
    from public.rag_chunks
    where document_id = any(p_document_ids)
      and embedding is not null
    order by embedding <=> p_query_embedding
    limit p_pool
  ),
  fts as (
    select id, section_id, document_id, content,
           row_number() over (
             order by ts_rank_cd(tsv, websearch_to_tsquery('english', p_query_text)) desc
           ) as rank
    from public.rag_chunks
    where document_id = any(p_document_ids)
      and p_query_text <> ''
      and tsv @@ websearch_to_tsquery('english', p_query_text)
    limit p_pool
  )
  select
    coalesce(vec.id, fts.id)                   as chunk_id,
    coalesce(vec.section_id, fts.section_id)   as section_id,
    coalesce(vec.document_id, fts.document_id) as document_id,
    coalesce(vec.content, fts.content)         as content,
    coalesce(1.0 / (p_rrf_k + vec.rank), 0.0)
      + coalesce(1.0 / (p_rrf_k + fts.rank), 0.0) as score
  from vec
  full outer join fts on vec.id = fts.id
  order by score desc
  limit p_match_count;
$$;
revoke all on function public.rag_room_search(uuid[], vector, text, integer, integer, integer) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 13. BE-11: join-code brute-force guard. Same signature + return type as the live
--     join_room (safe CREATE OR REPLACE); adds a per-user rate check ONLY on the
--     code-attempt path (10 attempts / 5 min) using the existing check_rate_limit.
--     New return value 'rate_limited' — clients treat unknown returns as failure.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.join_room(p_user text, p_room uuid, p_code text default null::text)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_me text := public.current_profile_id();
  r public.study_rooms%rowtype;
  existing public.room_members%rowtype;
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  select * into r from public.study_rooms where id = p_room;
  if not found or not r.is_active then return 'not_found'; end if;
  if r.created_by = v_me then
    insert into public.room_members(room_id, user_id, role, status) values (p_room, v_me, 'host', 'joined')
    on conflict (room_id, user_id) do update set role = 'host', status = 'joined';
    return 'joined';
  end if;
  select * into existing from public.room_members where room_id = p_room and user_id = v_me;
  if found and existing.status = 'joined' then return 'joined'; end if;
  if found and existing.status = 'invited' then
    update public.room_members set status = 'joined', role = 'member' where room_id = p_room and user_id = v_me;
    return 'joined';
  end if;
  if p_code is not null and r.join_code is not null then
    -- brute-force guard: 10 code attempts per user per 5 minutes, across all rooms
    if not public.check_rate_limit('join-code:' || v_me, 10, 300) then
      return 'rate_limited';
    end if;
    if upper(p_code) = upper(r.join_code) then
      insert into public.room_members(room_id, user_id, role, status) values (p_room, v_me, 'member', 'joined')
      on conflict (room_id, user_id) do update set status = 'joined';
      return 'joined';
    end if;
  end if;
  if not public.check_room_access(v_me, p_room) then return 'denied'; end if;
  if r.room_type = 'invite' then
    insert into public.room_members(room_id, user_id, role, status) values (p_room, v_me, 'member', 'requested')
    on conflict (room_id, user_id) do update set status = case when room_members.status = 'joined' then 'joined' else 'requested' end;
    return 'requested';
  end if;
  insert into public.room_members(room_id, user_id, role, status) values (p_room, v_me, 'member', 'joined')
  on conflict (room_id, user_id) do update set status = 'joined';
  return 'joined';
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 14. BE-05: Realtime channel authorization for PRIVATE channels.
--     Contract (STUDYROOM_ARCHITECTURE.md): when the client flips a channel to
--     { private: true }, these policies gate it by room membership:
--       room:{room_uuid}   — presence + broadcast events (chat, pomodoro, wb_live…)
--       wb-{room_uuid}     — Yjs whiteboard doc sync
--       private:{thread_uuid} — private-help thread streaming (owner only)
--     Existing PUBLIC channels are unaffected until the client opts in — zero-risk rollout.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.topic_room_uuid(p_topic text)
returns uuid
language plpgsql
immutable
as $$
begin
  if p_topic like 'room:%' then return substring(p_topic from 6)::uuid; end if;
  if p_topic like 'wb-%'   then return substring(p_topic from 4)::uuid; end if;
  return null;
exception when others then
  return null;
end;
$$;

-- SELF-SCOPED (review hardening): these are granted to `authenticated` because the
-- realtime policies evaluate them as the querying role — but that grant would otherwise
-- let any signed-in user probe ANY user's membership/threads (an oracle). When a caller
-- has a profile (JWT context), p_user MUST be themselves; service contexts (no JWT →
-- current_profile_id() is null) are unrestricted.
create or replace function public.is_room_member(p_user text, p_room uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select case
    when public.current_profile_id() is not null and p_user is distinct from public.current_profile_id() then false
    else exists (
      select 1 from public.room_members
      where room_id = p_room and user_id = p_user and status = 'joined'
    )
  end;
$$;
grant execute on function public.is_room_member(text, uuid) to authenticated;

create or replace function public.owns_private_thread(p_user text, p_thread uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select case
    when public.current_profile_id() is not null and p_user is distinct from public.current_profile_id() then false
    else exists (select 1 from public.private_threads where id = p_thread and user_id = p_user)
  end;
$$;
grant execute on function public.owns_private_thread(text, uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 15. find_room_by_code — fixes a real prod break the sprint review surfaced:
--     since RLS went on, study_rooms only shows rooms you created or joined, so the
--     clients' direct code-lookup read returns nothing for exactly the users who need
--     it — join-by-code was dead. This SECURITY DEFINER lookup returns MINIMAL lobby
--     metadata for an active room matching the code, with its own rate budget
--     (15 lookups / 5 min / user, silent-empty when exceeded) so codes can't be
--     brute-forced through it. join_room re-verifies the code on join.
-- ─────────────────────────────────────────────────────────────────────────────
-- volatile (default): check_rate_limit writes its counter row, which a STABLE fn may not.
create or replace function public.find_room_by_code(p_code text)
returns table(id uuid, name text, room_type text, max_members int)
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_me text := public.current_profile_id();
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  if p_code is null or length(trim(p_code)) < 4 then return; end if;
  if not public.check_rate_limit('code-lookup:' || v_me, 15, 300) then return; end if;
  return query
    select r.id, r.name, r.room_type, r.max_members
    from public.study_rooms r
    where r.is_active and r.join_code is not null and upper(r.join_code) = upper(trim(p_code))
    limit 1;
end;
$$;
revoke all on function public.find_room_by_code(text) from public, anon;
grant execute on function public.find_room_by_code(text) to authenticated;

drop policy if exists "room members receive" on realtime.messages;
create policy "room members receive" on realtime.messages
  for select to authenticated
  using (
    (
      public.topic_room_uuid(realtime.topic()) is not null
      and public.is_room_member(public.current_profile_id(), public.topic_room_uuid(realtime.topic()))
    )
    or (
      realtime.topic() like 'private:%'
      and public.owns_private_thread(public.current_profile_id(), (substring(realtime.topic() from 9))::uuid)
    )
  );

drop policy if exists "room members send" on realtime.messages;
create policy "room members send" on realtime.messages
  for insert to authenticated
  with check (
    (
      public.topic_room_uuid(realtime.topic()) is not null
      and public.is_room_member(public.current_profile_id(), public.topic_room_uuid(realtime.topic()))
    )
    or (
      realtime.topic() like 'private:%'
      and public.owns_private_thread(public.current_profile_id(), (substring(realtime.topic() from 9))::uuid)
    )
  );

notify pgrst, 'reload schema';

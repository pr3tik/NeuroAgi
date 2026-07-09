-- supabase-identity-merge.sql
-- One canonical id per person. merge_user_ids(p_old, p_new) re-keys ALL data from a
-- stale/guest uid onto the auth-linked canonical profile id. Called ONLY server-side
-- (service key, via /api/auth-migrate?action=adopt) after the caller proved via JWT
-- that p_new is their profile and p_old is unowned or theirs. Idempotent; atomic
-- (single transaction — a failure rolls everything back, nothing half-merged).
-- Run in Supabase Dashboard → SQL Editor.

-- Audit trail: lets support alias old→new later (stale email links, OAuth state, brain DB).
create table if not exists public.user_id_merges (
  old_id    text primary key,
  new_id    text not null,
  merged_at timestamptz not null default now()
);
alter table public.user_id_merges disable row level security;

create or replace function public.merge_user_ids(p_old text, p_new text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  fk  record;
  t   record;
  r   record;
  col record;
begin
  if p_old is null or p_new is null or p_old = p_new then return; end if;
  if not exists (select 1 from public.users where id = p_new) then
    raise exception 'merge_user_ids: target profile % does not exist', p_new;
  end if;

  ------------------------------------------------------------------------
  -- 1. courses colliding on unique(user_id, canvas_course_id): repoint every
  --    FK child of the losing (old-uid) course to the surviving (new-uid)
  --    course, then delete the loser. Children discovered from pg_constraint
  --    so live-only tables are covered automatically.
  ------------------------------------------------------------------------
  for r in
    select oc.id as loser, nc.id as survivor
    from public.courses oc
    join public.courses nc
      on nc.user_id = p_new and nc.canvas_course_id = oc.canvas_course_id
    where oc.user_id = p_old and oc.canvas_course_id is not null
  loop
    for fk in
      select con.conrelid::regclass::text as child_tbl, att.attname as child_col
      from pg_constraint con
      join pg_attribute att on att.attrelid = con.conrelid and att.attnum = any(con.conkey)
      where con.contype = 'f' and con.confrelid = 'public.courses'::regclass
    loop
      for t in execute format('select ctid from %s where %I = $1', fk.child_tbl, fk.child_col) using r.loser
      loop
        begin
          execute format('update %s set %I = $1 where ctid = $2', fk.child_tbl, fk.child_col)
            using r.survivor, t.ctid;
        exception when unique_violation then
          -- survivor already has this row (e.g. flashcards unique(user_id,course_id)) → drop old copy
          execute format('delete from %s where ctid = $1', fk.child_tbl) using t.ctid;
        end;
      end loop;
    end loop;
    delete from public.courses where id = r.loser;  -- childless now; ON DELETE CASCADE is a no-op
  end loop;

  ------------------------------------------------------------------------
  -- 2. assignments colliding on unique(user_id, canvas_assignment_id): same
  --    pattern (files.assignment_id etc. repointed to the survivor).
  ------------------------------------------------------------------------
  for r in
    select oa.id as loser, na.id as survivor
    from public.assignments oa
    join public.assignments na
      on na.user_id = p_new and na.canvas_assignment_id = oa.canvas_assignment_id
    where oa.user_id = p_old and oa.canvas_assignment_id is not null
  loop
    for fk in
      select con.conrelid::regclass::text as child_tbl, att.attname as child_col
      from pg_constraint con
      join pg_attribute att on att.attrelid = con.conrelid and att.attnum = any(con.conkey)
      where con.contype = 'f' and con.confrelid = 'public.assignments'::regclass
    loop
      for t in execute format('select ctid from %s where %I = $1', fk.child_tbl, fk.child_col) using r.loser
      loop
        begin
          execute format('update %s set %I = $1 where ctid = $2', fk.child_tbl, fk.child_col)
            using r.survivor, t.ctid;
        exception when unique_violation then
          execute format('delete from %s where ctid = $1', fk.child_tbl) using t.ctid;
        end;
      end loop;
    end loop;
    delete from public.assignments where id = r.loser;
  end loop;

  ------------------------------------------------------------------------
  -- 3. friendships (canonical-pair shape user_low_id/user_high_id,
  --    unique index idx_friendships_pair)
  ------------------------------------------------------------------------
  if to_regclass('public.friendships') is not null then
    -- a relationship between the two ids being merged would become a self-pair → drop it
    delete from public.friendships
     where least(user_low_id, user_high_id) = least(p_old, p_new)
       and greatest(user_low_id, user_high_id) = greatest(p_old, p_new);

    for r in
      select id, user_low_id, user_high_id from public.friendships
      where user_low_id = p_old or user_high_id = p_old
    loop
      begin
        update public.friendships
           set user_low_id  = least(p_new, case when r.user_low_id = p_old then r.user_high_id else r.user_low_id end),
               user_high_id = greatest(p_new, case when r.user_low_id = p_old then r.user_high_id else r.user_low_id end),
               requested_by = case when requested_by = p_old then p_new else requested_by end,
               responded_by = case when responded_by = p_old then p_new else responded_by end,
               blocked_by   = case when blocked_by   = p_old then p_new else blocked_by   end
         where id = r.id;
      exception when unique_violation then
        delete from public.friendships where id = r.id;  -- same friendship already exists under canonical id
      end;
    end loop;
  end if;

  ------------------------------------------------------------------------
  -- 4. EVERY public table with a user_id column (schema-driven, so live-only
  --    tables — modules, knowledge_graph, impressions, feedback, leaderboard,
  --    token_events, transcription/media jobs, rag_*, spaces, notifications,
  --    user_oauth, srs_reviews, tutor_mind, intervention_tuning, room_members,
  --    room_sessions, room_messages, whiteboard_strokes, writing_snapshots,
  --    brain_nodes/edges, canvas_data, files, flashcards*, chat_*, exams*,
  --    content_connections, proactive_signals, notification_queue, beta_sessions
  --    — are all covered automatically). Row-by-row: on any unique collision
  --    (user_oauth(user_id,provider), canvas_data(user_id,data_type),
  --    files(user_id,lms_file_id), flashcards(user_id,course_id),
  --    srs_reviews pk(user_id,card_key), tutor_mind pk(user_id),
  --    intervention_tuning pk(user_id), leaderboard(user_id), ...)
  --    the canonical (p_new) row wins and the old duplicate is dropped.
  ------------------------------------------------------------------------
  for t in
    select c.table_name, c.data_type
    from information_schema.columns c
    join information_schema.tables tb
      on tb.table_schema = c.table_schema and tb.table_name = c.table_name
    where c.table_schema = 'public'
      and c.column_name  = 'user_id'
      and tb.table_type  = 'BASE TABLE'
      and c.table_name  <> 'users'
  loop
    -- Some live tables type user_id as uuid instead of text (preflight 2026-07-02:
    -- sessions, content_connections, calendar_connections, weekly_plans). Cast the
    -- text params for those; `uuid = text` has no operator and would abort the merge.
    declare cast_sfx text := case when t.data_type = 'uuid' then '::uuid' else '' end;
    begin
      -- Fast path: one bulk UPDATE per table. Tables without a user_id-scoped unique
      -- constraint (rag_chunks and friends — the big ones) finish in a single statement,
      -- keeping heavy accounts inside the function/HTTP timeout.
      begin
        execute format('update public.%I set user_id = $1%s where user_id = $2%s',
                       t.table_name, cast_sfx, cast_sfx)
          using p_new, p_old;
      exception
        when unique_violation then
          -- Collisions exist (user_oauth, canvas_data, files, ...): the failed bulk update
          -- rolled back to its savepoint; redo row-by-row, canonical row wins.
          for r in execute format('select ctid from public.%I where user_id = $1%s', t.table_name, cast_sfx) using p_old
          loop
            begin
              execute format('update public.%I set user_id = $1%s where ctid = $2',
                             t.table_name, cast_sfx)
                using p_new, r.ctid;
            exception when unique_violation then
              execute format('delete from public.%I where ctid = $1', t.table_name) using r.ctid;
            end;
          end loop;
        when invalid_text_representation then
          -- p_old isn't uuid-shaped (odd legacy id): a uuid column cannot contain it → skip table
          null;
      end;
    end;
  end loop;

  ------------------------------------------------------------------------
  -- 5. owner columns not named user_id
  ------------------------------------------------------------------------
  if to_regclass('public.study_rooms') is not null then
    update public.study_rooms set created_by = p_new where created_by = p_old;
  end if;
  if to_regclass('public.nudges') is not null then
    update public.nudges set from_user_id = p_new where from_user_id = p_old;
    update public.nudges set to_user_id   = p_new where to_user_id   = p_old;
  end if;

  ------------------------------------------------------------------------
  -- 6. merge the users row itself (only if an old row exists — guest uids may
  --    have none). Canonical row keeps its values; nulls backfilled from the
  --    old row; counters take the safe variant. Column list read from the live
  --    catalog so repo/live schema drift (points, discord_user_id,
  --    brain_person_id, nav_mode, ...) cannot break it.
  ------------------------------------------------------------------------
  if exists (select 1 from public.users where id = p_old) then
    for col in
      select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'users'
        and column_name not in ('id','email','auth_id','password_hash','email_verify_token','created_at')
    loop
      if col.column_name in ('points','streak') then
        execute format('update public.users n set %1$I = greatest(coalesce(n.%1$I,0), coalesce(o.%1$I,0)) from public.users o where n.id = $1 and o.id = $2', col.column_name) using p_new, p_old;
      elsif col.column_name = 'study_time' then
        execute format('update public.users n set %1$I = coalesce(n.%1$I,0) + coalesce(o.%1$I,0) from public.users o where n.id = $1 and o.id = $2', col.column_name) using p_new, p_old;
      else
        execute format('update public.users n set %1$I = coalesce(n.%1$I, o.%1$I) from public.users o where n.id = $1 and o.id = $2', col.column_name) using p_new, p_old;
      end if;
    end loop;

    -- all children were re-keyed above → the ON DELETE CASCADE on this delete is a no-op
    delete from public.users where id = p_old;
  end if;

  -- keep leaderboard.points consistent with the merged users.points
  if to_regclass('public.leaderboard') is not null then
    update public.leaderboard lb set points = u.points
      from public.users u
     where lb.user_id = p_new and u.id = p_new and u.points is not null;
  end if;

  insert into public.user_id_merges (old_id, new_id) values (p_old, p_new)
  on conflict (old_id) do update set new_id = excluded.new_id, merged_at = now();
end;
$$;

-- service-role only: never callable with the anon key or a user JWT
revoke all on function public.merge_user_ids(text, text) from public;
revoke all on function public.merge_user_ids(text, text) from anon;
revoke all on function public.merge_user_ids(text, text) from authenticated;
grant execute on function public.merge_user_ids(text, text) to service_role;

notify pgrst, 'reload schema';

-- NOTE ON BACKFILL: no bulk re-key of existing rows is possible or needed server-side.
-- Guest/stale uids have NULL email + NULL auth_id, so ONLY the browser still holding the
-- old fschool_uid can attribute them — which is exactly what the boot/login-time
-- ?action=adopt call does, lazily, per browser, with proof of ownership. unique(email)
-- + users_auth_id_key guarantee there is exactly one canonical row per account, so there
-- is no duplicate-email class of rows to backfill. Orphan uids on abandoned browsers
-- remain (harmless, invisible), recoverable later via user_id_merges if a device returns.

-- supabase-authz-rpc-hardening.sql
-- Fixes broken authorization in the SECURITY DEFINER RPCs. They bypass RLS and used to TRUST a
-- client-supplied "acting user" id (p_user/p_owner/p_requester/p_inviter) with no verification —
-- so anyone with the public anon key could read any user's friends/room messages, post as anyone,
-- change room access, remove members, etc. (classic IDOR).
--
-- Fix: derive the acting user from public.current_profile_id() (= users.id where auth_id = auth.uid(),
-- i.e. the CALLER's own profile) instead of the passed param, and REVOKE EXECUTE from anon so a
-- session is required. All these RPCs are called from the browser with the user's JWT, so
-- current_profile_id() resolves; the passed param is now ignored (kept in the signature so client
-- calls don't break). Applied via the Management API.

-- ── Friends ────────────────────────────────────────────────────────────────────
create or replace function public.list_friends(p_user text)
 returns table(friend_id text, friends_since timestamp with time zone)
 language sql security definer set search_path to 'public'
as $function$
  select case when user_low_id = public.current_profile_id() then user_high_id else user_low_id end,
         coalesce(responded_at, created_at)
  from public.friendships
  where status = 'accepted'
    and (user_low_id = public.current_profile_id() or user_high_id = public.current_profile_id());
$function$;

create or replace function public.list_friend_requests(p_user text)
 returns table(friendship_id uuid, other_user_id text, direction text, requested_at timestamp with time zone)
 language sql security definer set search_path to 'public'
as $function$
  select id,
    case when user_low_id = public.current_profile_id() then user_high_id else user_low_id end,
    case when requested_by = public.current_profile_id() then 'outgoing' else 'incoming' end,
    created_at
  from public.friendships
  where status = 'pending'
    and (user_low_id = public.current_profile_id() or user_high_id = public.current_profile_id());
$function$;

create or replace function public.send_friend_request(p_requester text, p_addressee text)
 returns text language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_me  text := public.current_profile_id();
  lo    text := least(v_me, p_addressee);
  hi    text := greatest(v_me, p_addressee);
  existing public.friendships%rowtype;
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  if v_me = p_addressee then raise exception 'cannot friend yourself'; end if;
  select * into existing from public.friendships where user_low_id = lo and user_high_id = hi limit 1;
  if found then
    if existing.status = 'accepted' then raise exception 'already friends';
    elsif existing.status = 'blocked' then raise exception 'blocked';
    elsif existing.status = 'pending' then
      if existing.requested_by = p_addressee then
        update public.friendships set status = 'accepted', responded_by = v_me, responded_at = now() where id = existing.id;
        return 'accepted';
      end if;
      return 'pending';
    else
      update public.friendships set requested_by = v_me, responded_by = null, blocked_by = null,
             status = 'pending', created_at = now(), responded_at = null where id = existing.id;
      return 'pending';
    end if;
  end if;
  insert into public.friendships (user_low_id, user_high_id, status, requested_by)
  values (lo, hi, 'pending', v_me);
  return 'pending';
end;
$function$;

create or replace function public.respond_friend_request(p_user text, p_other text, p_accept boolean)
 returns text language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_me text := public.current_profile_id();
  lo   text := least(v_me, p_other);
  hi   text := greatest(v_me, p_other);
  existing public.friendships%rowtype;
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  select * into existing from public.friendships
   where user_low_id = lo and user_high_id = hi and status = 'pending' and requested_by = p_other limit 1;
  if not found then raise exception 'no pending request'; end if;
  update public.friendships set status = case when p_accept then 'accepted' else 'declined' end,
         responded_by = v_me, responded_at = now() where id = existing.id;
  return case when p_accept then 'accepted' else 'declined' end;
end;
$function$;

create or replace function public.remove_friend(p_user text, p_other text)
 returns void language sql security definer set search_path to 'public'
as $function$
  delete from public.friendships
  where user_low_id = least(public.current_profile_id(), p_other)
    and user_high_id = greatest(public.current_profile_id(), p_other);
$function$;

create or replace function public.block_user(p_user text, p_other text)
 returns friendships language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_me  text := public.current_profile_id();
  v_low text := least(v_me, p_other);
  v_high text := greatest(v_me, p_other);
  v_row public.friendships;
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  insert into public.friendships (user_low_id, user_high_id, status, requested_by, blocked_by, responded_at)
  values (v_low, v_high, 'blocked', v_me, v_me, now())
  on conflict (user_low_id, user_high_id)
  do update set status = 'blocked', blocked_by = v_me, responded_at = now()
  returning * into v_row;
  return v_row;
end $function$;

create or replace function public.unblock_user(p_user text, p_other text)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_me text := public.current_profile_id();
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  delete from public.friendships
   where user_low_id = least(v_me, p_other) and user_high_id = greatest(v_me, p_other)
     and status = 'blocked' and blocked_by = v_me;
end $function$;

-- ── Rooms / chat ─────────────────────────────────────────────────────────────────
create or replace function public.join_room(p_user text, p_room uuid, p_code text default null)
 returns text language plpgsql security definer set search_path to 'public'
as $function$
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
  if p_code is not null and r.join_code is not null and upper(p_code) = upper(r.join_code) then
    insert into public.room_members(room_id, user_id, role, status) values (p_room, v_me, 'member', 'joined')
    on conflict (room_id, user_id) do update set status = 'joined';
    return 'joined';
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
$function$;

create or replace function public.leave_room(p_user text, p_room uuid)
 returns void language sql security definer set search_path to 'public'
as $function$
  delete from public.room_members where room_id = p_room and user_id = public.current_profile_id();
$function$;

create or replace function public.post_room_message(p_user text, p_room uuid, p_name text, p_body text)
 returns room_messages language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_me text := public.current_profile_id();
  msg public.room_messages;
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from public.room_members where room_id = p_room and user_id = v_me and status = 'joined') then
    raise exception 'not a joined member';
  end if;
  insert into public.room_messages(room_id, user_id, name, body) values (p_room, v_me, p_name, trim(p_body)) returning * into msg;
  return msg;
end;
$function$;

create or replace function public.list_room_messages(p_user text, p_room uuid, p_limit integer default 100)
 returns setof room_messages language plpgsql security definer set search_path to 'public'
as $function$
declare v_me text := public.current_profile_id();
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from public.room_members where room_id = p_room and user_id = v_me and status = 'joined') then
    raise exception 'not a joined member';
  end if;
  return query select * from public.room_messages where room_id = p_room order by created_at asc limit greatest(1, least(p_limit, 500));
end;
$function$;

create or replace function public.invite_to_room(p_inviter text, p_room uuid, p_invitee text)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare v_me text := public.current_profile_id();
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from public.room_members where room_id = p_room and user_id = v_me and status = 'joined') then
    raise exception 'inviter not in room';
  end if;
  insert into public.room_members(room_id, user_id, role, status) values (p_room, p_invitee, 'member', 'invited')
  on conflict (room_id, user_id) do nothing;
end;
$function$;

create or replace function public.respond_room_request(p_owner text, p_room uuid, p_member text, p_accept boolean)
 returns text language plpgsql security definer set search_path to 'public'
as $function$
declare v_me text := public.current_profile_id(); r public.study_rooms%rowtype;
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  select * into r from public.study_rooms where id = p_room;
  if not found then return 'not_found'; end if;
  if r.created_by <> v_me then raise exception 'not room owner'; end if;
  if p_accept then
    update public.room_members set status = 'joined' where room_id = p_room and user_id = p_member;
    return 'joined';
  else
    delete from public.room_members where room_id = p_room and user_id = p_member;
    return 'declined';
  end if;
end;
$function$;

create or replace function public.set_room_access(p_owner text, p_room uuid, p_filters jsonb)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare v_me text := public.current_profile_id(); r public.study_rooms%rowtype;
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  select * into r from public.study_rooms where id = p_room;
  if not found then raise exception 'room not found'; end if;
  if r.created_by <> v_me then raise exception 'not room owner'; end if;
  update public.study_rooms set access_filters = coalesce(p_filters, '{}'::jsonb) where id = p_room;
end;
$function$;

create or replace function public.list_accessible_rooms(p_user text)
 returns setof study_rooms language sql stable security definer set search_path to 'public'
as $function$
  select r.* from public.study_rooms r
  where r.is_active = true and public.check_room_access(public.current_profile_id(), r.id)
  order by r.last_active desc limit 50;
$function$;

-- ── EXECUTE grants: require a session. Functions default to EXECUTE granted to PUBLIC (anon
-- inherits it), so we must revoke from PUBLIC (not just anon), then grant explicitly. ──
revoke execute on function
  public.list_friends(text), public.list_friend_requests(text),
  public.send_friend_request(text,text), public.respond_friend_request(text,text,boolean),
  public.remove_friend(text,text), public.block_user(text,text), public.unblock_user(text,text),
  public.join_room(text,uuid,text), public.leave_room(text,uuid),
  public.post_room_message(text,uuid,text,text), public.list_room_messages(text,uuid,integer),
  public.invite_to_room(text,uuid,text), public.respond_room_request(text,uuid,text,boolean),
  public.set_room_access(text,uuid,jsonb), public.list_accessible_rooms(text),
  public.check_room_access(text,uuid), public.find_user_by_email(text)
from public, anon;

grant execute on function
  public.list_friends(text), public.list_friend_requests(text),
  public.send_friend_request(text,text), public.respond_friend_request(text,text,boolean),
  public.remove_friend(text,text), public.block_user(text,text), public.unblock_user(text,text),
  public.join_room(text,uuid,text), public.leave_room(text,uuid),
  public.post_room_message(text,uuid,text,text), public.list_room_messages(text,uuid,integer),
  public.invite_to_room(text,uuid,text), public.respond_room_request(text,uuid,text,boolean),
  public.set_room_access(text,uuid,jsonb), public.list_accessible_rooms(text),
  public.check_room_access(text,uuid), public.find_user_by_email(text)
to authenticated, service_role;

-- Dead client-side (friends.ts now uses users_public) + email-returning → service_role only.
-- rls_auto_enable is an event-trigger helper, never called directly.
revoke execute on function
  public.get_user_profiles(text[]), public.search_users_by_name(text), public.rls_auto_enable()
from public, anon, authenticated;

notify pgrst, 'reload schema';

-- ── Re-sweep follow-up (applied live via Management API) ──────────────────────────
-- check_room_access(text,uuid) trusted its p_user param (an authenticated "can user X access
-- room Y" oracle). Hardened to override p_user := current_profile_id() at the top of the body
-- (so it only ever evaluates the CALLER's access; internal callers already pass that), and
-- EXECUTE revoked from public/anon, granted to authenticated/service_role.
-- (The rewrite is done by fetching pg_get_functiondef and injecting the override — see
-- scratchpad/fix-check-room-access.js — because the body is large; recorded here for the log.)

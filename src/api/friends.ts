// friends.js — friend operations, backed by Supabase.
//
// USER IDENTITY (name, email, id) lives in Supabase `public.users`.
// THE FRIENDSHIP GRAPH lives in Supabase `public.friendships`, reached through
// the SECURITY DEFINER RPCs from migrations 004/005:
//   send_friend_request, respond_friend_request, remove_friend,
//   list_friends, list_friend_requests
//
// The acting user's id is the app-generated uuid stored in localStorage
// ("fschool_uid") and passed explicitly as the p_user / p_requester argument —
// the same trust model the rest of the app uses with the anon key.
//
// NOTE: users.id is TEXT in this project, so the RPC params are text too.

import { supabase } from './supabase';

// One-time cleanup: the friendship graph used to live in localStorage under
// "fschool_friendships". It now lives in Supabase, so that key is dead weight —
// drop it on load. Safe to keep: it's a no-op once the key is gone.
try { localStorage.removeItem('fschool_friendships'); } catch { /* ignore */ }

// ─────────────────────────────────────────────────────────────────────────────
// Supabase — USER IDENTITY (live, canonical)
// ─────────────────────────────────────────────────────────────────────────────

// public.users is RLS-locked to the owner, so cross-user identity lookups go through the
// find_user_by_email SECURITY DEFINER RPC (email match, bypasses RLS) and the users_public
// view (id/name/location only — no email/scores). Do NOT read public.users directly here.

/** Look up a user by email (case-insensitive). Returns { id, name, email } or null. */
export async function findUserByEmail(email) {
  const { data, error } = await supabase.rpc('find_user_by_email', { p_email: email.trim() });
  if (error) throw error;
  return (Array.isArray(data) ? data[0] : data) ?? null;
}

/** Search users by partial name (for an add-by-name flow). Returns [{ id, name }]. */
export async function searchUsersByName(query) {
  const { data, error } = await supabase
    .from('users_public')
    .select('id, name')
    .ilike('name', `%${query.trim()}%`)
    .limit(8);
  if (error) throw error;
  return data ?? [];
}

/** Fetch user profiles for a list of ids. Returns { [id]: { name } }. */
export async function getUserProfiles(ids) {
  if (!ids.length) return {};
  const { data, error } = await supabase
    .from('users_public')
    .select('id, name')
    .in('id', ids);
  if (error) throw error;
  return Object.fromEntries((data ?? []).map(u => [u.id, u]));
}

// ─────────────────────────────────────────────────────────────────────────────
// Supabase RPCs — THE FRIENDSHIP GRAPH (migrations 004/005)
// ─────────────────────────────────────────────────────────────────────────────

/** List accepted friends. Returns [{ friend_id, friends_since }]. */
export async function listFriends(userId) {
  const { data, error } = await supabase.rpc('list_friends', { p_user: userId });
  if (error) throw error;
  return data ?? [];
}

/** List pending requests, both directions. Returns [{ friendship_id, other_user_id, direction, requested_at }]. */
export async function listFriendRequests(userId) {
  const { data, error } = await supabase.rpc('list_friend_requests', { p_user: userId });
  if (error) throw error;
  return data ?? [];
}

/** Send a friend request. Creates a pending row (or auto-accepts if the other side already asked). */
export async function sendFriendRequest(requesterId, addresseeId) {
  const { data, error } = await supabase.rpc('send_friend_request', {
    p_requester: requesterId,
    p_addressee: addresseeId,
  });
  if (error) throw error;
  return data;
}

/** Accept or decline a pending request. */
export async function respondFriendRequest(userId, otherId, accept) {
  const { data, error } = await supabase.rpc('respond_friend_request', {
    p_user: userId,
    p_other: otherId,
    p_accept: accept,
  });
  if (error) throw error;
  return data;
}

/** Remove an accepted/pending/declined link. */
export async function removeFriend(userId, otherId) {
  const { error } = await supabase.rpc('remove_friend', {
    p_user: userId,
    p_other: otherId,
  });
  if (error) throw error;
}

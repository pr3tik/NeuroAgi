// rooms.ts — client wrappers for the server-enforced Study Room RPCs
// (supabase-room-access-migration.sql). All room_members writes go through these
// SECURITY DEFINER functions; direct table writes are revoked for the anon key.
// The acting user's id is the localStorage uuid, passed explicitly (same trust
// model as friends.js).

import { supabase } from "./supabase";

export type AccessFilters = {
  university?: boolean;
  friends?: boolean;
  fof?: boolean;
  course?: boolean;
};

export type JoinStatus = "joined" | "requested" | "denied" | "not_found";

/** Active rooms the user is eligible to see (server-filtered). Returns full rows. */
export async function listAccessibleRooms(userId: string) {
  const { data, error } = await supabase.rpc("list_accessible_rooms", { p_user: userId });
  if (error) throw error;
  return data ?? [];
}

/** Attempt to join. `code` bypasses room type + filters when it matches. */
export async function joinRoom(userId: string, roomId: string, code: string | null = null): Promise<JoinStatus> {
  const { data, error } = await supabase.rpc("join_room", {
    p_user: userId, p_room: roomId, p_code: code,
  });
  if (error) throw error;
  return (data ?? "denied") as JoinStatus;
}

/** Host accepts/declines a pending request. */
export async function respondRoomRequest(ownerId: string, roomId: string, memberId: string, accept: boolean) {
  const { data, error } = await supabase.rpc("respond_room_request", {
    p_owner: ownerId, p_room: roomId, p_member: memberId, p_accept: accept,
  });
  if (error) throw error;
  return data as string;
}

/** A joined member invites someone (writes an 'invited' row). */
export async function inviteToRoom(inviterId: string, roomId: string, inviteeId: string) {
  const { error } = await supabase.rpc("invite_to_room", {
    p_inviter: inviterId, p_room: roomId, p_invitee: inviteeId,
  });
  if (error) throw error;
}

/** Leave a room (deletes own membership row). */
export async function leaveRoom(userId: string, roomId: string) {
  const { error } = await supabase.rpc("leave_room", { p_user: userId, p_room: roomId });
  if (error) throw error;
}

/** Owner-only: replace the room's access filters. */
export async function setRoomAccess(ownerId: string, roomId: string, filters: AccessFilters) {
  const { error } = await supabase.rpc("set_room_access", {
    p_owner: ownerId, p_room: roomId, p_filters: filters ?? {},
  });
  if (error) throw error;
}

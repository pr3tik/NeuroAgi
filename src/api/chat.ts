// chat.ts — client wrappers for the Phase 2 in-room chat RPCs.
// All writes go through post_room_message (SECURITY DEFINER); direct inserts
// on room_messages are revoked for the anon key.

import { supabase } from "./supabase";

export type ChatMessage = {
  id: string;
  room_id: string;
  user_id: string;
  name: string;
  body: string;
  created_at: string;
};

/**
 * Load the last N messages for a room, oldest-first.
 * Goes through list_room_messages (SECURITY DEFINER) — a plain table SELECT is
 * blocked by RLS / would leak other rooms, so the RPC is the only correct read path.
 */
export async function loadRecentMessages(
  userId: string, roomId: string, limit = 100
): Promise<ChatMessage[]> {
  const { data, error } = await supabase.rpc("list_room_messages", {
    p_user: userId, p_room: roomId, p_limit: limit,
  });
  if (error) throw error;
  return (data ?? []) as ChatMessage[];
}

/** Post a message. Server verifies the sender is a joined member. */
export async function postRoomMessage(
  userId: string, roomId: string, name: string, body: string
): Promise<ChatMessage> {
  const { data, error } = await supabase.rpc("post_room_message", {
    p_user: userId, p_room: roomId, p_name: name, p_body: body,
  });
  if (error) throw error;
  return data as ChatMessage;
}

/**
 * Upload an image file to Supabase Storage and return a long-lived signed URL.
 * Stored at chat-images/{roomId}/{uuid}.{ext} in the media-uploads bucket.
 * The bucket must allow anon-key uploads (no RLS / open INSERT policy).
 * Image messages are stored as "[img]<url>" in the body field.
 */
export async function uploadChatImage(roomId: string, file: File): Promise<string> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
  const path = `chat-images/${roomId}/${crypto.randomUUID()}.${ext}`;
  const { error: uploadErr } = await supabase.storage
    .from("media-uploads")
    .upload(path, file, { contentType: file.type, upsert: false });
  if (uploadErr) throw uploadErr;
  const { data } = await supabase.storage
    .from("media-uploads")
    .createSignedUrl(path, 31536000); // 1-year expiry
  if (!data?.signedUrl) throw new Error("Could not get signed URL for uploaded image");
  return data.signedUrl;
}

/** Upload an image to the whiteboard-images prefix and return a signed URL. */
export async function uploadWhiteboardImage(roomId: string, file: File): Promise<string> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
  const path = `whiteboard-images/${roomId}/${crypto.randomUUID()}.${ext}`;
  const { error: uploadErr } = await supabase.storage
    .from("media-uploads")
    .upload(path, file, { contentType: file.type, upsert: false });
  if (uploadErr) throw uploadErr;
  const { data } = await supabase.storage
    .from("media-uploads")
    .createSignedUrl(path, 31536000);
  if (!data?.signedUrl) throw new Error("Could not get signed URL for whiteboard image");
  return data.signedUrl;
}

// whiteboard.ts — client wrappers for the Phase 3 session-only whiteboard RPCs.
// All reads + writes go through SECURITY DEFINER functions; direct table access on
// whiteboard_strokes is revoked for the anon key. Background is stored on the room.

import { supabase } from "./supabase";

export type Point = { x: number; y: number; t?: string };

export type PenStyle = "normal" | "highlighter" | "pencil" | "ink" | "marker" | "text" | "rect" | "circle" | "line" | "arrow";

export type Stroke = {
  id: string;
  room_id: string;
  user_id: string;
  name: string;
  mode: "pen" | "erase" | "image";
  style: PenStyle;
  color: string;
  width: number;
  points: Point[];
  // image-stroke fields (mode === "image" only)
  url?: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  created_at: string;
};

/** Load every stroke for a room, oldest-first. Caller must be a joined member. */
export async function loadStrokes(userId: string, roomId: string): Promise<Stroke[]> {
  const { data, error } = await supabase.rpc("load_whiteboard", {
    p_user: userId, p_room: roomId,
  });
  if (error) throw error;
  return (data ?? []) as Stroke[];
}

/** The room's shared whiteboard background (null until someone sets one). */
export async function loadBackground(roomId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("study_rooms").select("whiteboard_bg").eq("id", roomId).maybeSingle();
  if (error) throw error;
  return (data?.whiteboard_bg ?? null) as string | null;
}

/** Persist one completed stroke (pen or area-eraser). Server verifies membership. */
export async function addStroke(
  userId: string, roomId: string,
  mode: "pen" | "erase", style: PenStyle, color: string, width: number, points: Point[]
): Promise<Stroke> {
  const { data, error } = await supabase.rpc("add_whiteboard_stroke", {
    p_user: userId, p_room: roomId,
    p_mode: mode, p_style: style, p_color: color, p_width: width, p_points: points,
  });
  if (error) throw error;
  return data as Stroke;
}

/** Stroke eraser — delete one whole stroke. Any joined member may erase any stroke. */
export async function deleteStroke(userId: string, roomId: string, strokeId: string): Promise<void> {
  const { error } = await supabase.rpc("delete_whiteboard_stroke", {
    p_user: userId, p_room: roomId, p_id: strokeId,
  });
  if (error) throw error;
}

/** Set the shared board background. */
export async function setBackground(userId: string, roomId: string, bg: string): Promise<void> {
  const { error } = await supabase.rpc("set_whiteboard_bg", {
    p_user: userId, p_room: roomId, p_bg: bg,
  });
  if (error) throw error;
}

/** Wipe the board + reset background. Called manually, or by the last member to leave. */
export async function clearBoard(userId: string, roomId: string): Promise<void> {
  const { error } = await supabase.rpc("clear_whiteboard", {
    p_user: userId, p_room: roomId,
  });
  if (error) throw error;
}

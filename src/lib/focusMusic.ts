// src/lib/focusMusic.ts — pure helpers for the in-room focus-music mini-player.
// Kept out of the component so the "actually stop the audio" and track-cycling logic are
// unit-testable with a fake audio element (no DOM / no <audio> needed).

export type MusicPreset = { label: string; query: string };

/** Curated preset queries offered in the mini-player (feed the iTunes preview search). */
export const MUSIC_PRESETS: MusicPreset[] = [
  { label: "Lo-fi", query: "lofi study beats" },
  { label: "Classical", query: "classical study focus" },
  { label: "Ambient", query: "ambient focus music" },
  { label: "Jazz", query: "jazz study cafe" },
];

/** The minimal audio surface we manipulate — lets tests pass a fake in place of HTMLAudioElement. */
export type AudioLike = { pause: () => void; currentTime: number };

/** Fully stop playback: pause AND rewind to 0 so closing the player (or toggling music off)
 *  truly silences it and a later re-open starts clean — not the old "pause without reset, keep
 *  playing on close" behavior. Safe on null; swallows any audio error. Returns the new
 *  isPlaying value (always false) so callers can sync React state from it. */
export function stopAudio(a: AudioLike | null | undefined): boolean {
  if (a) {
    try {
      a.pause();
      a.currentTime = 0;
    } catch {
      /* audio element not ready / detached — nothing to stop */
    }
  }
  return false;
}

/** Next track index with wraparound; safe when there are no tracks. */
export function cycleIndex(idx: number, len: number): number {
  if (len <= 0) return 0;
  return (idx + 1) % len;
}

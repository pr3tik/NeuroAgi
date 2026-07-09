// src/lib/achievements.ts — client-side achievement metadata (name/icon/description).
// Server-side unlock logic lives in api/_achievements.ts; keep `key` values in sync
// between the two lists when adding a new achievement.
import { RefreshCw, Sparkles, Flame, Users, ClipboardCheck, Layers } from "lucide-react";

export interface AchievementDef {
  key: string;
  name: string;
  description: string;
  icon: any;
}

export const ACHIEVEMENTS: AchievementDef[] = [
  { key: "first_canvas_sync",          name: "Synced Up",          description: "Connected your first course",            icon: RefreshCw },
  { key: "first_quiz_perfect",         name: "Perfectionist",      description: "Perfect score on a quiz",                 icon: Sparkles },
  { key: "streak_7",                   name: "One Week Strong",    description: "7-day study streak",                      icon: Flame },
  { key: "first_room_join",            name: "Not Studying Alone", description: "Joined your first Study Room",            icon: Users },
  { key: "first_assignment_submitted", name: "On It",              description: "Logged your first submitted assignment",  icon: ClipboardCheck },
  { key: "first_flashcards_generated", name: "Deck Builder",       description: "Generated your first flashcard set",      icon: Layers },
];

export const ACHIEVEMENTS_BY_KEY: Record<string, AchievementDef> =
  Object.fromEntries(ACHIEVEMENTS.map(a => [a.key, a]));

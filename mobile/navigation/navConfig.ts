export type PageKey =
  | "work" | "assignment" | "study" | "files"
  | "spaces" | "canvas" | "rooms" | "toolkit"
  | "identity" | "leaderboard";

// Tab bar only (no swipe nav — matches web's BottomNav.tsx, which never had
// a swipe mode either). PRIMARY are the always-visible tabs; MORE lives
// behind the "More" sheet. Same split web uses for its own primary/secondary.
export const PRIMARY: PageKey[] = ["work", "canvas", "study", "leaderboard", "identity"];
export const MORE: PageKey[] = ["assignment", "toolkit", "files", "rooms", "spaces"];

export const LABEL: Record<PageKey, string> = {
  work:        "Work",
  canvas:      "Canvas",
  assignment:  "Assignment",
  study:       "Study",
  files:       "Files",
  rooms:       "Rooms",
  toolkit:     "Toolkit",
  identity:    "Identity",
  leaderboard: "Leaderboard",
  spaces:      "Spaces",
};

// Compact labels for the bottom bar's tight cells — mirrors web's BottomNav.tsx
// ITEMS[].short fallback. Only the primary tabs need one; falls back to LABEL.
export const SHORT_LABEL: Partial<Record<PageKey, string>> = {
  leaderboard: "Ranks",
  identity:    "You",
};

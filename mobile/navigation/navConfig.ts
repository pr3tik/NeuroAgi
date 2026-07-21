// navConfig.ts — Spotify-style information architecture.
//
// Four bottom tabs (Home / Learn / Library / Community) replace the old five
// flat tabs + "More" sheet. Each tab that owns more than one screen surfaces its
// siblings through a horizontally-scrollable chip row (SubNav) instead of burying
// them — the same move Spotify makes with its Library filter chips. Profile
// (identity) is reached from the Header avatar, not a bottom tab.

export type PageKey =
  | "work" | "assignment" | "study" | "files"
  | "spaces" | "canvas" | "rooms" | "toolkit"
  | "identity" | "leaderboard";

export type TabKey = "home" | "learn" | "library" | "community";

// Bottom-bar order + display metadata. `home` (the default route each tab opens
// to) doubles as the route BottomNav navigates to when the tab is tapped.
export const TABS: { key: TabKey; label: string; home: PageKey }[] = [
  { key: "home",      label: "Home",        home: "work"       },
  { key: "community", label: "Rooms",       home: "rooms"      },
  { key: "learn",     label: "Learn",       home: "assignment" },
  { key: "library",   label: "Library",     home: "canvas"     },
];

// Which bottom tab a given screen belongs under. `identity` is the profile
// screen (Header avatar) and belongs to no tab — nothing in the bar highlights
// while it's open.
export const TAB_OF: Record<PageKey, TabKey | null> = {
  work:        "home",
  assignment:  "learn",
  study:       "learn",
  canvas:      "library",
  spaces:      "library",
  files:       "library",
  toolkit:     "library",
  rooms:       "community",
  leaderboard: "community",
  identity:    null,
};

// A single entry in a tab's chip row. `mode`/`tab` disambiguate two chips that
// share one route: Flashcards vs Study Guide both open /study (differing by the
// ?mode= param), and Files vs Notes both open the merged /toolkit page (differing
// by the ?tab= param).
export type SubItem = {
  key: PageKey;
  label: string;
  href: string;
  mode?: "flashcards" | "guide";
  tab?: "files" | "notes";
};

// The chip row for each tab. Tabs with fewer than two entries render no row.
export const SUBNAV: Record<TabKey, SubItem[]> = {
  home: [],
  learn: [
    { key: "assignment", label: "Assignments", href: "/assignment" },
    { key: "study",      label: "Flashcards",  href: "/study?mode=flashcards", mode: "flashcards" },
    { key: "study",      label: "Study Guide", href: "/study?mode=guide",      mode: "guide" },
  ],
  library: [
    { key: "canvas",  label: "Courses", href: "/canvas" },
    { key: "spaces",  label: "Spaces",  href: "/spaces" },
    // Files + Notes are one merged page (/toolkit) reached by a single chip; its
    // own internal tab bar (Files / Notes / Recordings / …) handles the rest.
    { key: "toolkit", label: "Files",   href: "/toolkit" },
  ],
  community: [
    { key: "rooms",       label: "Rooms",       href: "/rooms" },
    { key: "leaderboard", label: "Leaderboard", href: "/leaderboard" },
  ],
};

// Per-screen title shown in the Header. Tabbed pages show their tab label instead
// (see Header); this stays the source of truth for the profile screen and any
// non-tab route.
export const LABEL: Record<PageKey, string> = {
  work:        "Home",
  assignment:  "Assignments",
  study:       "Study",
  files:       "Files",
  rooms:       "Rooms",
  toolkit:     "Toolkit",
  identity:    "Profile",
  leaderboard: "Leaderboard",
  spaces:      "Spaces",
  canvas:      "Courses",
};

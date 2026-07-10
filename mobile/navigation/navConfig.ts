export type PageKey =
  | "work" | "assignment" | "study" | "files"
  | "spaces" | "canvas" | "rooms" | "toolkit"
  | "identity" | "leaderboard";

export type Direction = "left" | "right" | "up" | "down";

export const NAV: Record<PageKey, Partial<Record<Direction, PageKey>>> = {
  work:        { right: "assignment", left: "canvas",      up: "identity",    down: "toolkit"  },
  assignment:  { left: "work",        down: "study"                                            },
  study:       { up: "assignment",    left: "rooms"                                            },
  files:       { right: "identity",   down: "spaces"                                           },
  spaces:      { up: "files"                                                                   },
  canvas:      { right: "work",       down: "rooms"                                            },
  rooms:       { up: "canvas",        right: "toolkit"                                         },
  toolkit:     { up: "work",          left: "rooms"                                            },
  identity:    { down: "work",        right: "leaderboard", left: "files"                      },
  leaderboard: { left: "identity"                                                              },
};

export const DOT_GRID: (PageKey | null)[][] = [
  ["files",  "identity", "leaderboard"],
  ["canvas", "work",     "assignment" ],
  ["rooms",  "toolkit",  "study"      ],
];

export const LABEL: Record<PageKey, string> = {
  work:        "Work",
  canvas:      "Canvas",
  assignment:  "Assignments",
  study:       "Study",
  files:       "Files",
  rooms:       "Rooms",
  toolkit:     "Toolkit",
  identity:    "Identity",
  leaderboard: "Leaderboard",
  spaces:      "Spaces",
};

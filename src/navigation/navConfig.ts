// navConfig.js — The only file to touch when adding or rearranging pages.
// NAV defines which page lives in each direction from a given page.
// DOT_GRID defines the 3×3 visual map shown in PageDots.
// LABEL maps page keys to display names used in the header.

export const NAV = {
  work:        { right: "assignment", left: "canvas",      up: "identity",    down: "toolkit" },
  assignment:  { left: "work",        down: "study" },
  study:       { up: "assignment",    left: "rooms" },
  files:       { right: "identity",   down: "spaces",      up: "connections" },
  spaces:      { up: "files" },
  connections: { down: "files" },
  canvas:      { right: "work",       down: "rooms" },
  rooms:       { up: "canvas",        right: "toolkit" },
  toolkit:     { up: "work",          left: "rooms" },
  identity:    { down: "work",        right: "leaderboard", left: "files", up: "studyAssistant" },
  leaderboard: { left: "identity" },
  studyAssistant: { down: "identity" },
};

export const DOT_GRID = [
  ["files",  "identity",   "leaderboard"],
  ["canvas", "work",       "assignment" ],
  ["rooms",  "toolkit",    "study"      ],
];

export const LABEL = {
  work:        "Work",
  canvas:      "Canvas",
  assignment:  "Assignment",
  study:       "Study",
  files:       "Files",
  rooms:       "Rooms",
  toolkit:     "Toolkit",
  courses:     "Courses",
  identity:    "Identity",
  leaderboard: "Leaderboard",
  spaces:      "Spaces",
  connections: "Connections",
  studyAssistant: "Study Assistant",
};

// Shared founding-card constants + draft persistence (landing colorway ↔ claim form).

export const CARD_IMAGES_LIGHT = {
  white:  "/cards/card-mockups/white.png",
  violet: "/cards/card-mockups/violet.png",
  pink:   "/cards/card-mockups/pink.png",
  blue:   "/cards/card-mockups/blue.png",
  green:  "/cards/card-mockups/green.png",
  black:  "/cards/black_cropped.png",
};

export const COLORWAYS = [
  { id: "white",  name: "Base White",   tag: "Clean. Timeless. Iconic.",          dot: "#e8e4dc", accentDot: "#bbb" },
  { id: "violet", name: "Aura Purple",  tag: "Vivid. Confident. Distinct.",       dot: "#C8B8E8", accentDot: "#9b7ec8" },
  { id: "pink",   name: "Royal Pink",   tag: "Bold. Expressive. Unforgettable.",  dot: "#EFA9B5", accentDot: "#d06080" },
  { id: "blue",   name: "Sky Blue",     tag: "Clear. Focused. Elevated.",         dot: "#B8D4F0", accentDot: "#4a90d9" },
  { id: "green",  name: "Sage Green",   tag: "Fresh. Grounded. Original.",        dot: "#b8e8b0", accentDot: "#3a9a50" },
];

export const CLAIM_DRAFT_KEY = "fschoolai-founding-card-draft-v2";

export function loadClaimDraft() {
  try {
    const raw = localStorage.getItem(CLAIM_DRAFT_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function patchClaimDraft(partial) {
  try {
    const prev = loadClaimDraft() || {};
    localStorage.setItem(CLAIM_DRAFT_KEY, JSON.stringify({ ...prev, ...partial }));
  } catch { /* ignore quota / private mode */ }
}

export function clampColorIndex(i) {
  const n = Number(i);
  if (!Number.isFinite(n) || n < 0 || n >= COLORWAYS.length) return 0;
  return Math.floor(n);
}

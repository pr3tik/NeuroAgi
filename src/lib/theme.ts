// theme.ts — JS-side design tokens for code that can't consume CSS variables:
// 2D-canvas fillStyle interpolation, WebGL/OGL shader uniforms, html2canvas
// snapshots, and prompt strings that describe the design language to the model.
//
// These values MIRROR tokens.css (:root, dark theme). If you change a colour
// there, change it here too. Plain CSS/JSX styles should keep using
// var(--gold) / rgba(var(--gold-rgb), α) from tokens.css instead of this file.

export const GOLD = "#C49A3C";
export const GOLD_RGB = { r: 196, g: 154, b: 60 } as const;

export const GOLD_BRIGHT_RGB = { r: 255, g: 215, b: 80 } as const;

export const CREAM = "#F6F2E9";
export const CREAM_RGB = { r: 246, g: 242, b: 233 } as const;

export const TEAL_RGB = { r: 0, g: 210, b: 190 } as const;

export const AMBER_RGB = { r: 255, g: 190, b: 0 } as const;

/** Warm near-black used by legacy brand surfaces (NeuralRing prompt, ShareCard). */
export const INK_WARM = "#1a1814";

/** rgba() string for a token triplet at the given alpha — canvas-safe. */
export const rgba = (c: { r: number; g: number; b: number }, a: number) =>
  `rgba(${c.r}, ${c.g}, ${c.b}, ${a})`;

export const goldAlpha = (a: number) => rgba(GOLD_RGB, a);
export const goldBrightAlpha = (a: number) => rgba(GOLD_BRIGHT_RGB, a);
export const tealAlpha = (a: number) => rgba(TEAL_RGB, a);
export const creamAlpha = (a: number) => rgba(CREAM_RGB, a);
export const amberAlpha = (a: number) => rgba(AMBER_RGB, a);

// theme.ts — JS-side design tokens for code that can't consume CSS variables:
// 2D-canvas fillStyle interpolation, WebGL/OGL shader uniforms, html2canvas
// snapshots, and prompt strings that describe the design language to the model.
//
// These values MIRROR tokens.css (:root, dark theme). If you change a colour
// there, change it here too. Plain CSS/JSX styles should keep using
// var(--gold) / rgba(var(--gold-rgb), α) from tokens.css instead of this file.

export const GOLD = "#C9D4FF";
export const GOLD_RGB = { r: 201, g: 212, b: 255 } as const;

export const GOLD_BRIGHT_RGB = { r: 230, g: 236, b: 255 } as const;

export const CREAM = "#F0F3FF";
export const CREAM_RGB = { r: 240, g: 243, b: 255 } as const;

export const TEAL_RGB = { r: 122, g: 140, b: 245 } as const;

export const AMBER_RGB = { r: 255, g: 190, b: 0 } as const;

/** Warm near-black used by legacy brand surfaces (NeuralRing prompt, ShareCard). */
export const INK_WARM = "#1A1D33";

/** rgba() string for a token triplet at the given alpha — canvas-safe. */
export const rgba = (c: { r: number; g: number; b: number }, a: number) =>
  `rgba(${c.r}, ${c.g}, ${c.b}, ${a})`;

export const goldAlpha = (a: number) => rgba(GOLD_RGB, a);
export const goldBrightAlpha = (a: number) => rgba(GOLD_BRIGHT_RGB, a);
export const tealAlpha = (a: number) => rgba(TEAL_RGB, a);
export const creamAlpha = (a: number) => rgba(CREAM_RGB, a);
export const amberAlpha = (a: number) => rgba(AMBER_RGB, a);

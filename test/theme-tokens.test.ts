// theme-tokens.test.ts — guards the contract that src/lib/theme.ts (JS-side
// tokens for canvas/WebGL/prompt code) mirrors tokens.css (:root dark theme).
// If someone retunes a colour in one place and not the other, this fails.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  GOLD, GOLD_RGB, GOLD_BRIGHT_RGB, CREAM, CREAM_RGB, TEAL_RGB, AMBER_RGB,
  INK_WARM, rgba, goldAlpha,
} from "../src/lib/theme";

const css = readFileSync(resolve(__dirname, "../tokens.css"), "utf8");
// Everything before the light-theme block = the :root dark defaults.
const dark = css.split(':root[data-theme="light"]')[0];

/** Pull a token's value out of the dark :root block. */
function token(name: string): string {
  const m = dark.match(new RegExp(`${name}:\\s*([^;]+);`));
  if (!m) throw new Error(`token ${name} not found in tokens.css :root`);
  return m[1].trim();
}

const rgbTriplet = (c: { r: number; g: number; b: number }) => `${c.r}, ${c.g}, ${c.b}`;

describe("theme.ts mirrors tokens.css (dark :root)", () => {
  it("solid hex tokens match", () => {
    expect(token("--gold").toLowerCase()).toBe(GOLD.toLowerCase());
    expect(token("--cream").toLowerCase()).toBe(CREAM.toLowerCase());
    expect(token("--ink-warm").toLowerCase()).toBe(INK_WARM.toLowerCase());
  });

  it("rgb triplet tokens match", () => {
    expect(token("--gold-rgb")).toBe(rgbTriplet(GOLD_RGB));
    expect(token("--gold-bright-rgb")).toBe(rgbTriplet(GOLD_BRIGHT_RGB));
    expect(token("--cream-rgb")).toBe(rgbTriplet(CREAM_RGB));
    expect(token("--teal-rgb")).toBe(rgbTriplet(TEAL_RGB));
    expect(token("--amber-rgb")).toBe(rgbTriplet(AMBER_RGB));
  });

  it("existing amber tokens still align with the amber triplet", () => {
    expect(token("--color-amber")).toBe(`rgba(${rgbTriplet(AMBER_RGB)}, 0.8)`);
    expect(token("--color-amber-bar")).toBe(`rgba(${rgbTriplet(AMBER_RGB)}, 0.65)`);
  });

  it("rgba helpers emit canvas-safe strings", () => {
    expect(rgba(GOLD_RGB, 0.35)).toBe("rgba(201, 212, 255, 0.35)");
    // goldAlpha() derives from GOLD_RGB, which was re-themed gold→indigo (#C9D4FF) — keep this
    // expectation in lockstep with the constant above rather than the pre-re-theme gold literal.
    expect(goldAlpha(1)).toBe("rgba(201, 212, 255, 1)");
  });

  it("light theme overrides every colour token it redefines from :root", () => {
    const light = css.split(':root[data-theme="light"]')[1] ?? "";
    for (const name of ["--color-bg", "--text-primary", "--gold", "--gold-rgb", "--teal-rgb", "--cream"]) {
      expect(light, `${name} missing from light theme`).toMatch(new RegExp(`${name}:`));
    }
  });
});

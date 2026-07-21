// appTheme.tsx — runtime light/dark theming for Warm Ink.
//
// The app's screens were built with hardcoded dark color literals, so a working
// light mode needs a theme layer. This provides the palette + a persisted toggle.
//
// Rollout model: converting every screen's static StyleSheet to dynamic colors is
// incremental. Until a screen is converted it renders its dark styles; ScreenWrapper
// gates light mode per-page (LIGHT_READY) so an un-converted screen stays cleanly
// dark instead of showing near-white text on a light ground. As screens are
// converted they're added to LIGHT_READY.

import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

export type ThemeMode = "dark" | "light";

export type ThemeColors = {
  scheme: ThemeMode;        // which theme this palette is (both use LIGHT text)
  bg: string;
  surface: string;          // solid elevated surface (cards)
  surfaceTranslucent: string;
  border: string;
  borderStrong: string;
  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
  textDim: string;
  accent: string;           // sage
  accentSoft: string;
  accentLine: string;
  gold: string;
};

export const DARK: ThemeColors = {
  scheme:             "dark",
  bg:                 "#141216",
  surface:            "#1d1b20",
  surfaceTranslucent: "rgba(255,255,255,0.05)",
  border:             "rgba(255,255,255,0.08)",
  borderStrong:       "rgba(255,255,255,0.14)",
  textPrimary:        "#ECE8E1",
  textSecondary:      "rgba(255,255,255,0.45)",
  textTertiary:       "rgba(255,255,255,0.25)",
  textDim:            "rgba(255,255,255,0.35)",
  accent:             "rgb(90,165,116)",
  accentSoft:         "rgba(90,165,116,0.14)",
  accentLine:         "rgba(90,165,116,0.4)",
  gold:               "#C49A3C",
};

// "Light mode" = a clean WHITE ground with dark ink and frosted-white "liquid
// glass" panels — the bright, easy-on-the-eyes look the team asked for. The ground
// is a barely-cool near-white so the white glass panels (see Glass) still read as
// distinct frosted surfaces (border + blur lift them off the ground). isLightBg is
// luminance-based, so this ground reads as "light" → ink and the NeuralRing flip
// dark automatically. (This replaces the earlier periwinkle-blue / light-ink look.)
export const LIGHT: ThemeColors = {
  scheme:             "light",
  bg:                 "#F5F7FB",                 // near-white cool ground
  surface:            "#FFFFFF",                 // solid white card
  surfaceTranslucent: "rgba(255,255,255,0.60)",  // subtle white fill (inputs/chips)
  border:             "rgba(26,34,52,0.10)",     // dark hairline (reads on white)
  borderStrong:       "rgba(26,34,52,0.17)",
  textPrimary:        "#1B2432",                 // dark ink
  textSecondary:      "rgba(27,36,50,0.58)",
  textTertiary:       "rgba(27,36,50,0.38)",
  textDim:            "rgba(27,36,50,0.46)",
  accent:             "rgb(63,125,87)",          // sage that reads on white
  accentSoft:         "rgba(63,125,87,0.12)",
  accentLine:         "rgba(63,125,87,0.40)",
  gold:               "#A07621",                 // deeper gold reads on white
};

const PALETTE: Record<ThemeMode, ThemeColors> = { dark: DARK, light: LIGHT };

type ThemeValue = {
  mode: ThemeMode;
  colors: ThemeColors;
  setMode: (m: ThemeMode) => void;
  toggle: () => void;
};

const ThemeContext = createContext<ThemeValue | null>(null);
const STORAGE_KEY = "fschool_theme_mode";

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>("dark");

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then(v => { if (v === "light" || v === "dark") setModeState(v); })
      .catch(() => {});
  }, []);

  const setMode = useCallback((m: ThemeMode) => {
    setModeState(m);
    AsyncStorage.setItem(STORAGE_KEY, m).catch(() => {});
  }, []);

  const toggle = useCallback(() => {
    setModeState(prev => {
      const next = prev === "dark" ? "light" : "dark";
      AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
      return next;
    });
  }, []);

  return (
    <ThemeContext.Provider value={{ mode, colors: PALETTE[mode], setMode, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

/** Global theme (user's chosen mode). Screens read this for their own colors. */
export function useTheme(): ThemeValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme() must be used within <ThemeProvider>");
  return ctx;
}

export function useThemeColors(): ThemeColors {
  return useTheme().colors;
}

/** Pages whose bodies have been converted to dynamic theming and may render in
 *  light mode. Others stay dark (see ScreenWrapper). Grow this as screens convert. */
export const LIGHT_READY = new Set<string>([
  "identity", "rooms", "work",
  "study", "canvas", "leaderboard", "toolkit", "spaces", "assignment",
]);

/** The effective colors for a page's body — mirrors ScreenWrapper's gate so a
 *  screen's own StyleSheet uses the exact same light/dark decision as its chrome.
 *  A converted screen does: `const c = usePageTheme("work"); const st = useMemo(
 *  () => makeStyles(c), [c]);`. */
export function usePageTheme(page: string): ThemeColors {
  const { mode, colors } = useTheme();
  return mode === "light" && LIGHT_READY.has(page) ? colors : DARK;
}

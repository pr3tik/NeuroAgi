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

import { createContext, useContext, useEffect, useState, useCallback, useRef, ReactNode } from "react";
import { Animated, Easing } from "react-native";
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

// "Light mode" = the periwinkle-blue frosted look of the WEB app's light theme
// (tokens.css [data-theme="light"]) — brought over to match it exactly: a saturated
// royal-blue ground (AmbientBackground lifts the centre to a brighter periwinkle and
// deepens the far corner), translucent white "liquid glass" panels, and LIGHT text —
// the study-room mockups. It is NOT a white-ground / dark-ink light mode; the ground
// is a mid-luminance blue, so the same light text and white NeuralRing the dark
// theme uses stay correct (see isLightBg, which is luminance-based and reads this
// ground as "not light" → keeps ink white). Values match the web's periwinkle tokens.
export const LIGHT: ThemeColors = {
  scheme:             "light",
  bg:                 "#4657CE",                 // royal periwinkle base (ambient shades it)
  surface:            "rgba(255,255,255,0.10)",  // frosted white glass over the blue
  surfaceTranslucent: "rgba(255,255,255,0.07)",
  border:             "rgba(255,255,255,0.22)",
  borderStrong:       "rgba(255,255,255,0.34)",
  textPrimary:        "#F4F6FF",                 // cool near-white
  textSecondary:      "rgba(255,255,255,0.74)",
  textTertiary:       "rgba(255,255,255,0.52)",
  textDim:            "rgba(255,255,255,0.60)",
  accent:             "rgb(120,205,150)",        // brightened sage reads on the blue
  accentSoft:         "rgba(120,205,150,0.18)",
  accentLine:         "rgba(120,205,150,0.5)",
  gold:               "#EBC25E",                 // brightened gold for the blue ground
};

const PALETTE: Record<ThemeMode, ThemeColors> = { dark: DARK, light: LIGHT };

type ThemeValue = {
  mode: ThemeMode;
  colors: ThemeColors;
  setMode: (m: ThemeMode) => void;
  toggle: () => void;
  /** 0 = dark, 1 = light. Tweens over THEME_ANIM_MS on a toggle so the ground /
   *  ambient / nav CROSS-FADE between modes instead of snapping (web parity —
   *  the web app transitions background+color 0.4s var(--ease-apple)). */
  anim: Animated.Value;
};

// Match the web's `transition: … 0.4s var(--ease-apple)` (tokens.css).
export const THEME_ANIM_MS = 400;
const THEME_EASE = Easing.bezier(0.25, 0.46, 0.45, 0.94);

const ThemeContext = createContext<ThemeValue | null>(null);
const STORAGE_KEY = "fschool_theme_mode";

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>("dark");
  const anim = useRef(new Animated.Value(0)).current;

  // backgroundColor can't run on the native driver, so this one-off 400ms colour
  // tween runs on JS — trivial for a single interaction.
  const animateTo = useCallback((m: ThemeMode) => {
    Animated.timing(anim, {
      toValue: m === "light" ? 1 : 0,
      duration: THEME_ANIM_MS,
      easing: THEME_EASE,
      useNativeDriver: false,
    }).start();
  }, [anim]);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then(v => {
        if (v === "light" || v === "dark") {
          setModeState(v);
          anim.setValue(v === "light" ? 1 : 0);   // snap on cold start — no launch fade
        }
      })
      .catch(() => {});
  }, [anim]);

  const setMode = useCallback((m: ThemeMode) => {
    setModeState(m);
    animateTo(m);
    AsyncStorage.setItem(STORAGE_KEY, m).catch(() => {});
  }, [animateTo]);

  const toggle = useCallback(() => {
    setModeState(prev => {
      const next = prev === "dark" ? "light" : "dark";
      animateTo(next);
      AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
      return next;
    });
  }, [animateTo]);

  return (
    <ThemeContext.Provider value={{ mode, colors: PALETTE[mode], setMode, toggle, anim }}>
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
  "study", "canvas", "leaderboard", "toolkit", "spaces", "assignment", "files",
]);

/** The effective colors for a page's body — mirrors ScreenWrapper's gate so a
 *  screen's own StyleSheet uses the exact same light/dark decision as its chrome.
 *  A converted screen does: `const c = usePageTheme("work"); const st = useMemo(
 *  () => makeStyles(c), [c]);`. */
export function usePageTheme(page: string): ThemeColors {
  const { mode, colors } = useTheme();
  return mode === "light" && LIGHT_READY.has(page) ? colors : DARK;
}

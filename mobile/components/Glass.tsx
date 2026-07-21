// Glass.tsx — the app's frosted "liquid glass" surface primitive.
//
// This is the shared material for elevated surfaces (cards, sheets, chrome pills)
// across the app: a real UIVisualEffectView (expo-blur) that refracts whatever is
// behind it, with a translucent tint for contrast and a hairline edge. It is NOT
// the cheap gradient "glassmorphism" look — it's the Apple tab-bar material,
// applied consistently.
//
// Usage: replace a solid `<View style={{ backgroundColor: C.surface, ... }}>` with
// `<Glass colors={C} radius={16} style={layoutOnlyStyle}>`. The style you pass
// should carry layout only (padding / margin / radius) — Glass supplies the fill
// and border, so DON'T also set backgroundColor/borderWidth (a solid background
// would sit behind the blur and defeat the effect).

import React from "react";
import { View, Pressable, StyleSheet, ViewStyle, StyleProp } from "react-native";
import { BlurView } from "expo-blur";
import { ThemeColors, DARK } from "../constants/appTheme";

export function isLightBg(colors: ThemeColors) {
  // Luminance-based so it works for any light palette (not a hardcoded hex).
  const h = colors.bg.replace("#", "");
  if (h.length < 6) return false;
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b > 150;
}

type Props = {
  // Optional — defaults to DARK. Dark-only screens (not yet LIGHT_READY) can omit
  // it; theme-driven screens pass their effective colors so glass follows the mode.
  colors?: ThemeColors;
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  radius?: number;
  intensity?: number;
  tint?: any;
  onPress?: () => void;
  disabled?: boolean;
};

export default function Glass({ colors = DARK, children, style, radius = 16, intensity, tint, onPress, disabled }: Props) {
  // Light mode: a frosted WHITE panel on the near-white ground — a bright glass lift
  // with a dark hairline (so the edge reads on white) and the iOS light chrome blur.
  // Dark mode: a subtle white lift over the near-black ground, as before.
  const light     = colors.scheme === "light";
  const fill      = light ? "rgba(255,255,255,0.55)" : "rgba(255,255,255,0.06)";
  const border    = light ? "rgba(26,34,52,0.10)"    : "rgba(255,255,255,0.12)";
  const blurTint  = tint ?? (light ? "systemChromeMaterialLight" : "systemChromeMaterialDark");
  const blurAmt   = intensity ?? (light ? 46 : 42);

  const base: ViewStyle = { borderRadius: radius, overflow: "hidden", borderWidth: 1, borderColor: border };

  const inner = (
    <>
      <BlurView intensity={blurAmt} tint={blurTint} style={StyleSheet.absoluteFill} />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: fill }]} pointerEvents="none" />
      {children}
    </>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        disabled={disabled}
        style={({ pressed }) => [base, style, pressed && !disabled && { opacity: 0.75 }]}
      >
        {inner}
      </Pressable>
    );
  }
  return <View style={[base, style]}>{inner}</View>;
}

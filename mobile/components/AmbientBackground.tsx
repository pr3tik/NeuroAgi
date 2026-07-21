// AmbientBackground.tsx — soft ambient color glows behind every screen.
//
// The frosted-glass surfaces (see Glass) only read as "liquid glass" when there's
// something behind them to refract. On a flat near-black ground the frost is
// nearly invisible; with a couple of large, very-soft radial glows behind it, the
// glass picks up subtle colour and depth — the look from the reference screenshots.
//
// Deliberately restrained: two diffuse glows in the brand's own hues (sage + a
// soft cool indigo), low opacity, fully transparent at the edges. This is NOT a
// loud gradient-blob hero — it's ambient light the glass sits in.

import { View, StyleSheet } from "react-native";
import Svg, { Defs, RadialGradient, Stop, Rect } from "react-native-svg";
import { ThemeColors } from "../constants/appTheme";

export default function AmbientBackground({ colors }: { colors: ThemeColors }) {
  const light = colors.scheme === "light";

  // The difference is the ground the glass sits in.
  // Dark:  sage (top-left) + soft indigo (bottom-right) over near-black — brand hues.
  // Light: the ground stays WHITE — just the faintest brand-hue washes (cool at
  // top-left, sage at bottom-right) so the frosted glass has something to refract
  // without tinting the page. Kept very low-opacity so it still reads clean white.
  const glow1 = light ? "rgb(150,170,255)" : "rgb(96,170,122)";   // faint cool / sage
  const glow2 = light ? "rgb(150,205,175)" : "rgb(124,134,224)";  // faint sage / indigo
  const glow1Top = light ? 0.10 : 0.20;
  const glow2Top = light ? 0.08 : 0.15;
  const r1 = light ? "72%" : "62%";
  const r2 = light ? "62%" : "68%";

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width="100%" height="100%">
        <Defs>
          <RadialGradient id="ambGlow1" cx="22%" cy="8%" r={r1}>
            <Stop offset="0" stopColor={glow1} stopOpacity={glow1Top} />
            <Stop offset="1" stopColor={glow1} stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="ambGlow2" cx="90%" cy="92%" r={r2}>
            <Stop offset="0" stopColor={glow2} stopOpacity={glow2Top} />
            <Stop offset="1" stopColor={glow2} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#ambGlow1)" />
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#ambGlow2)" />
      </Svg>
    </View>
  );
}

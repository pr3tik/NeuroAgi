// AmbientBackground.tsx — soft ambient color glows behind every screen.
//
// The frosted-glass surfaces (see Glass) only read as "liquid glass" when there's
// something behind them to refract. Two large, very-soft radial glows give the
// glass subtle colour and depth — the look from the reference screenshots.
//
// Two palettes are rendered at once and CROSS-FADED by the theme progress (0 = dark,
// 1 = light) so the ground animates with the toggle instead of snapping — matching
// the web app's `transition: background 0.4s`.
//   Dark:  sage (top-left) + soft indigo (bottom-right) over near-black — brand hues.
//   Light: a bright periwinkle bloom top-left lifts the centre and a deep indigo pool
//          bottom-right shades the far corner — the web/reference radial over #4657CE.

import { Animated, StyleSheet } from "react-native";
import Svg, { Defs, RadialGradient, Stop, Rect } from "react-native-svg";

type Props = { progress: Animated.Value | Animated.AnimatedInterpolation<number> };

function GlowLayer({ variant }: { variant: "dark" | "light" }) {
  const light = variant === "light";
  const glow1 = light ? "rgb(132,144,246)" : "rgb(96,170,122)";   // periwinkle bloom / sage
  const glow2 = light ? "rgb(40,52,158)"   : "rgb(124,134,224)";  // deep indigo / soft indigo
  const glow1Top = light ? 0.55 : 0.20;
  const glow2Top = light ? 0.45 : 0.15;
  const r1 = light ? "82%" : "62%";
  const r2 = light ? "66%" : "68%";
  return (
    <Svg width="100%" height="100%">
      <Defs>
        <RadialGradient id={`ambGlow1_${variant}`} cx="22%" cy="8%" r={r1}>
          <Stop offset="0" stopColor={glow1} stopOpacity={glow1Top} />
          <Stop offset="1" stopColor={glow1} stopOpacity={0} />
        </RadialGradient>
        <RadialGradient id={`ambGlow2_${variant}`} cx="90%" cy="92%" r={r2}>
          <Stop offset="0" stopColor={glow2} stopOpacity={glow2Top} />
          <Stop offset="1" stopColor={glow2} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill={`url(#ambGlow1_${variant})`} />
      <Rect x="0" y="0" width="100%" height="100%" fill={`url(#ambGlow2_${variant})`} />
    </Svg>
  );
}

export default function AmbientBackground({ progress }: Props) {
  const darkOpacity  = progress.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });
  const lightOpacity = progress.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });
  return (
    <>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: darkOpacity }]} pointerEvents="none">
        <GlowLayer variant="dark" />
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: lightOpacity }]} pointerEvents="none">
        <GlowLayer variant="light" />
      </Animated.View>
    </>
  );
}

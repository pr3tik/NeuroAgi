// ScreenWrapper.tsx — page shell: Header on top, scrollable content in the
// middle, and the floating glass BottomNav overlaying the bottom.
//
// The nav is a floating "liquid glass" pill (see BottomNav), so it sits ON TOP of
// the content rather than in the layout flow. Two content modes:
//   • default    — content is padded to clear the nav, so nothing hides behind it.
//   • edgeToEdge — content fills to the bottom and scrolls UNDER the glass (the
//                  dramatic look); the screen adds its own scroll bottom padding.
//
// Theming: light mode applies per-page. A page renders light only once its body
// has been converted to dynamic colors (LIGHT_READY); until then it stays dark so
// nothing shows near-white text on a light ground. The chrome (Header/SubNav/
// BottomNav) follows the same effective mode so the whole screen is consistent.

import { View, StyleSheet, Animated } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import Header from "./Header";
import BottomNav, { NAV_CLEARANCE } from "./BottomNav";
import SubNav from "./SubNav";
import AmbientBackground from "./AmbientBackground";
import { PageKey } from "../navigation/navConfig";
import { useTheme, DARK, LIGHT, LIGHT_READY, ThemeColors } from "../constants/appTheme";

// Frozen progress for pages that never render light (not LIGHT_READY) — their
// ground / ambient / nav stay dark regardless of the global toggle.
const FROZEN_DARK = new Animated.Value(0);

type Props = { page: PageKey; children: React.ReactNode; edgeToEdge?: boolean };

export default function ScreenWrapper({ page, children, edgeToEdge }: Props) {
  const { mode, colors, anim } = useTheme();
  const insets = useSafeAreaInsets();
  const lightReady = LIGHT_READY.has(page);
  // Light only when the user chose it AND this page is converted; otherwise dark.
  const c: ThemeColors = mode === "light" && lightReady ? colors : DARK;

  // Clearance for the floating nav. NAV_CLEARANCE covers the bar itself; the nav
  // floats `insets.bottom` above the screen edge, so content must clear BOTH or it
  // tucks under the bar on any device with a home indicator. (This was the bug: a
  // static clearance left ~a home-indicator's worth of content under the nav.)
  const navClear = NAV_CLEARANCE + insets.bottom;

  // Light-ready pages cross-fade their ground with the toggle; others stay dark.
  // A full-screen animated ground sits behind everything (under the safe area too),
  // so the whole screen — not just the padded content — transitions.
  const progress = lightReady ? anim : FROZEN_DARK;
  const ground = lightReady
    ? anim.interpolate({ inputRange: [0, 1], outputRange: [DARK.bg, LIGHT.bg] })
    : DARK.bg;

  return (
    <View style={styles.root}>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: ground }]} pointerEvents="none" />
      <AmbientBackground progress={progress} />
      <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
        <View style={styles.container}>
          <Header page={page} colors={c} />
          {/* Chip row for tabs that own multiple screens (Learn/Library/Community);
              renders nothing for single-screen tabs like Home. */}
          <SubNav page={page} colors={c} />
          <View style={[styles.content, !edgeToEdge && { paddingBottom: navClear }]}>
            {children}
          </View>
        </View>
      </SafeAreaView>
      <BottomNav current={page} colors={c} progress={progress} />
    </View>
  );
}

const styles = StyleSheet.create({
  root:      { flex: 1, backgroundColor: DARK.bg },
  safe:      { flex: 1 },
  container: { flex: 1, padding: 20, paddingBottom: 0 },
  content:   { flex: 1, position: "relative" },
});

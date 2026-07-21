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

import { View, StyleSheet } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import Header from "./Header";
import BottomNav, { NAV_CLEARANCE } from "./BottomNav";
import SubNav from "./SubNav";
import AmbientBackground from "./AmbientBackground";
import { PageKey } from "../navigation/navConfig";
import { useTheme, DARK, LIGHT_READY, ThemeColors } from "../constants/appTheme";

type Props = { page: PageKey; children: React.ReactNode; edgeToEdge?: boolean };

export default function ScreenWrapper({ page, children, edgeToEdge }: Props) {
  const { mode, colors } = useTheme();
  const insets = useSafeAreaInsets();
  // Light only when the user chose it AND this page is converted; otherwise dark.
  const c: ThemeColors = mode === "light" && LIGHT_READY.has(page) ? colors : DARK;

  // Clearance for the floating nav. NAV_CLEARANCE covers the bar itself; the nav
  // floats `insets.bottom` above the screen edge, so content must clear BOTH or it
  // tucks under the bar on any device with a home indicator. (This was the bug: a
  // static clearance left ~a home-indicator's worth of content under the nav.)
  const navClear = NAV_CLEARANCE + insets.bottom;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.bg }]} edges={["top", "left", "right"]}>
      <AmbientBackground colors={c} />
      <View style={styles.container}>
        <Header page={page} colors={c} />
        {/* Chip row for tabs that own multiple screens (Learn/Library/Community);
            renders nothing for single-screen tabs like Home. */}
        <SubNav page={page} colors={c} />
        <View style={[styles.content, !edgeToEdge && { paddingBottom: navClear }]}>
          {children}
        </View>
      </View>
      <BottomNav current={page} colors={c} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:      { flex: 1 },
  container: { flex: 1, padding: 20, paddingBottom: 0 },
  content:   { flex: 1, position: "relative" },
});

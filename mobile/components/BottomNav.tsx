// BottomNav.tsx — floating "liquid glass" tab bar (Home / Learn / Library /
// Community), modeled on the iOS WhatsApp/Apple tab bar: a translucent blurred
// pill that floats over the content with a moving selection capsule.
//
// Interaction: press-hold-drag-to-choose. Touch the bar and the sage capsule
// springs under your finger; slide across tabs and it tracks you with a haptic
// tick at each one; release to commit. A quick tap selects instantly (the same
// begin→finalize path). The capsule is driven by Reanimated shared values so it
// follows the finger at 60fps off the JS thread.

import { useEffect, useState } from "react";
import { View, Text, StyleSheet, useWindowDimensions } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BlurView } from "expo-blur";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { useSharedValue, useAnimatedStyle, withSpring, withTiming, runOnJS } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import Svg, { Path, Circle, Rect } from "react-native-svg";
import { PageKey, TabKey, TABS, TAB_OF } from "../navigation/navConfig";
import { ThemeColors } from "../constants/appTheme";

const BAR_MARGIN = 14;   // gap from screen edges
const BAR_PAD    = 6;    // inner padding before first tab
const BAR_HEIGHT = 60;
const BAR_GAP    = 8;    // gap above the home-indicator / safe area
const CAP_INSET  = 6;    // capsule horizontal inset within a tab cell
const SPRING     = { damping: 20, stiffness: 260, mass: 0.7 };
const N          = TABS.length;

// Height a screen must leave clear at the bottom so the floating bar never
// covers content. Screens that render edge-to-edge (content behind the glass)
// add this to their own scroll padding; ScreenWrapper reserves it otherwise.
export const NAV_CLEARANCE = BAR_HEIGHT + BAR_GAP + 20;

// One glyph per tab. Home = house, Learn = book, Library = grid, Community = people.
function Icon({ tab, color }: { tab: TabKey; color: string }) {
  const c = { width: 23, height: 23, viewBox: "0 0 24 24", fill: "none", stroke: color, strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (tab) {
    case "home":      return <Svg {...c}><Path d="M3 10.5 12 3l9 7.5" /><Path d="M5 9.5V20h14V9.5" /></Svg>;
    case "learn":     return <Svg {...c}><Path d="M4 5.5A2 2 0 0 1 6 4h6v15H6a2 2 0 0 0-2 1.2z" /><Path d="M20 5.5A2 2 0 0 0 18 4h-6v15h6a2 2 0 0 1 2 1.2z" /></Svg>;
    case "library":   return <Svg {...c}><Rect x="3.5" y="3.5" width="7" height="7" rx="1.6" /><Rect x="13.5" y="3.5" width="7" height="7" rx="1.6" /><Rect x="3.5" y="13.5" width="7" height="7" rx="1.6" /><Rect x="13.5" y="13.5" width="7" height="7" rx="1.6" /></Svg>;
    case "community": return <Svg {...c}><Circle cx="9" cy="8.5" r="2.8" /><Path d="M3.5 19a5.5 5.5 0 0 1 11 0" /><Path d="M16 6.2a2.8 2.8 0 0 1 0 5.2" /><Path d="M17.5 14a5.5 5.5 0 0 1 3 4.9" /></Svg>;
  }
}

export default function BottomNav({ current, colors }: { current: PageKey; colors: ThemeColors }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  const activeTab = TAB_OF[current];
  const activeIndex = TABS.findIndex(t => t.key === activeTab); // -1 on non-tab screens (profile)
  const safeIndex = activeIndex < 0 ? 0 : activeIndex;

  const barW  = width - BAR_MARGIN * 2;
  const tabW  = (barW - BAR_PAD * 2) / N;
  const capW  = tabW - CAP_INSET * 2;
  const xForBase = BAR_PAD + CAP_INSET;                          // left of capsule at index 0
  const idxToX = (i: number) => xForBase + i * tabW;

  const isLight = colors.scheme === "light";

  // display drives icon/label tint (-1 = no tab lit, on the profile screen).
  const [display, setDisplay] = useState(activeIndex);
  const highlightX = useSharedValue(idxToX(safeIndex));
  const capOpacity = useSharedValue(activeTab ? 1 : 0);
  const pressed    = useSharedValue(0);
  const hoverIdx   = useSharedValue(safeIndex);
  const lastIdx    = useSharedValue(safeIndex);

  // Re-sync to the route whenever it changes (e.g. navigated from elsewhere).
  useEffect(() => {
    setDisplay(activeIndex);
    highlightX.value = withSpring(idxToX(safeIndex), SPRING);
    hoverIdx.value = safeIndex;
    lastIdx.value = safeIndex;
    capOpacity.value = withTiming(activeTab ? 1 : 0, { duration: 160 });
  }, [activeIndex, tabW]); // eslint-disable-line react-hooks/exhaustive-deps

  const onHover = (i: number) => { setDisplay(i); try { Haptics.selectionAsync(); } catch {} };
  const commit = (i: number) => {
    try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch {}
    router.replace(`/${TABS[i].home}`);
  };

  const pan = Gesture.Pan()
    .minDistance(0)
    .shouldCancelWhenOutside(false)
    .onBegin(e => {
      // Inlined (not idxToX): this runs as a UI-thread worklet, which can't call
      // a plain JS closure. xForBase/tabW/CAP_INSET are captured primitives.
      const i = Math.min(N - 1, Math.max(0, Math.floor((e.x - BAR_PAD) / tabW)));
      pressed.value = withSpring(1, SPRING);
      capOpacity.value = withTiming(1, { duration: 120 });
      highlightX.value = withSpring(xForBase + i * tabW, SPRING);
      hoverIdx.value = i;
      if (i !== lastIdx.value) { lastIdx.value = i; runOnJS(onHover)(i); }
      else { runOnJS(setDisplay)(i); }
    })
    .onUpdate(e => {
      const i = Math.min(N - 1, Math.max(0, Math.floor((e.x - BAR_PAD) / tabW)));
      highlightX.value = withSpring(xForBase + i * tabW, SPRING);
      hoverIdx.value = i;
      if (i !== lastIdx.value) { lastIdx.value = i; runOnJS(onHover)(i); }
    })
    .onFinalize(() => {
      pressed.value = withSpring(0, SPRING);
      runOnJS(commit)(hoverIdx.value);
    });

  const capStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: highlightX.value }, { scale: 1 + pressed.value * 0.04 }],
    opacity: capOpacity.value,
  }));

  const baseFill  = isLight ? "rgba(255,255,255,0.55)" : "rgba(24,22,27,0.42)";
  const hairline  = isLight ? "rgba(0,0,0,0.08)" : "rgba(255,255,255,0.14)";

  return (
    <View style={[styles.wrap, { bottom: insets.bottom + BAR_GAP }]} pointerEvents="box-none">
      <GestureDetector gesture={pan}>
        <View style={[styles.shadow, { width: barW }]}>
          <View style={[styles.clip, { backgroundColor: baseFill }]}>
            <BlurView
              intensity={isLight ? 55 : 34}
              tint={isLight ? "systemChromeMaterialLight" : "systemChromeMaterialDark"}
              style={StyleSheet.absoluteFill}
            />
            <View style={[styles.hairline, { borderColor: hairline }]} pointerEvents="none" />

            {/* moving selection capsule (sage) */}
            <Animated.View
              style={[styles.capsule, { width: capW, backgroundColor: colors.accentSoft, borderColor: colors.accentLine }, capStyle]}
              pointerEvents="none"
            />

            {/* tabs */}
            <View style={styles.row} pointerEvents="none">
              {TABS.map((t, i) => {
                const on = display === i;
                const color = on ? colors.accent : colors.textSecondary;
                return (
                  <View key={t.key} style={[styles.item, { width: tabW }]}>
                    <Icon tab={t.key} color={color} />
                    <Text style={[styles.label, { color }]} numberOfLines={1}>{t.label}</Text>
                  </View>
                );
              })}
            </View>
          </View>
        </View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 0, right: 0, alignItems: "center" },
  shadow: {
    borderRadius: BAR_HEIGHT / 2,
    shadowColor: "#000", shadowOpacity: 0.28, shadowRadius: 22, shadowOffset: { width: 0, height: 10 },
  },
  clip: { height: BAR_HEIGHT, borderRadius: BAR_HEIGHT / 2, overflow: "hidden", justifyContent: "center", paddingHorizontal: BAR_PAD },
  hairline: { ...StyleSheet.absoluteFillObject, borderRadius: BAR_HEIGHT / 2, borderWidth: 1 },
  capsule: {
    position: "absolute", top: 7, left: 0, height: BAR_HEIGHT - 14,
    borderRadius: (BAR_HEIGHT - 14) / 2, borderWidth: 1,
  },
  row:   { flexDirection: "row", alignItems: "center" },
  item:  { alignItems: "center", justifyContent: "center", gap: 3, height: BAR_HEIGHT },
  label: { fontWeight: "600", fontSize: 10, letterSpacing: 0.1 },
});

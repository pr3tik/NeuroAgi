import { useEffect, useState } from "react";
import { View, Text, StyleSheet, Dimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
} from "react-native-reanimated";
import { useSwipeNav, EASE_APPLE } from "../navigation/useSwipeNav";
import Header from "./Header";
import { PageKey } from "../navigation/navConfig";
import { lastDirection } from "../navigation/transitionStore";

const { width: W, height: H } = Dimensions.get("window");
// Matches web's --ease-apple transition duration/curve exactly (tokens.css) —
// see useSwipeNav.ts for why the previous poly(4) curve looked instant.
const DURATION = 220;
const EDGE_STRIP = 48;

function getInitialOffset(dir: typeof lastDirection) {
  if (dir === "right") return { x: W,  y: 0 };
  if (dir === "left")  return { x: -W, y: 0 };
  if (dir === "down")  return { x: 0,  y: H };
  if (dir === "up")    return { x: 0,  y: -H };
  return { x: 0, y: 0 };
}

type Props = { page: PageKey; children: React.ReactNode };

export default function ScreenWrapper({ page, children }: Props) {
  const { x: ix, y: iy } = getInitialOffset(lastDirection);

  const translateX = useSharedValue(ix);
  const translateY = useSharedValue(iy);
  const opacity    = useSharedValue(ix !== 0 || iy !== 0 ? 0.75 : 1);

  // TEMPORARY — diagnosing why vertical swipe isn't reliable. Remove this
  // whole debugLog block + the debugBox render once that's confirmed fixed.
  const [debugLog, setDebugLog] = useState<string[]>([]);
  function pushDebug(msg: string) {
    const t = new Date().toISOString().slice(14, 23);
    setDebugLog(prev => [...prev.slice(-5), `${t} ${msg}`]);
  }

  const { horizontalGesture, topEdgeGesture, bottomEdgeGesture } = useSwipeNav(page, translateX, translateY, opacity, pushDebug);

  useEffect(() => {
    translateX.value = withTiming(0, { duration: DURATION, easing: EASE_APPLE });
    translateY.value = withTiming(0, { duration: DURATION, easing: EASE_APPLE });
    opacity.value    = withTiming(1, { duration: DURATION, easing: EASE_APPLE });
  }, []);

  const animStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
    ],
    opacity: opacity.value,
  }));

  return (
    <SafeAreaView style={styles.safe}>
      <Animated.View style={[{ flex: 1 }, animStyle]}>
        <GestureDetector gesture={horizontalGesture}>
          <View style={styles.container}>
            {/* Matches App.tsx's <header className="app-header"> — page label,
                token/tier pill, notification bell, and the page-dots nav map
                all live up here on web, not in a bottom footer. */}
            <Header page={page} />
            <View style={styles.content}>
              {children}
              {/* Thin edge strips for vertical (up/down) nav — kept off the main
                  content so they never compete with a screen's own ScrollView.
                  No pointerEvents="box-none" here: these strips have no
                  children, and box-none makes a childless view untouchable —
                  it was silently killing gesture recognition on both strips. */}
              <GestureDetector gesture={topEdgeGesture}>
                <View style={styles.topEdge} />
              </GestureDetector>
              <GestureDetector gesture={bottomEdgeGesture}>
                <View style={styles.bottomEdge} />
              </GestureDetector>
            </View>
          </View>
        </GestureDetector>
      </Animated.View>

      {/* TEMPORARY debug overlay — see the note above debugLog's declaration. */}
      <View style={styles.debugBox} pointerEvents="none">
        {debugLog.map((l, i) => (
          <Text key={i} style={styles.debugText}>{l}</Text>
        ))}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:      { flex: 1, backgroundColor: "#0f0f0f" },
  container: { flex: 1, padding: 20 },
  content:   { flex: 1, position: "relative" },
  topEdge:    { position: "absolute", top: 0, left: 0, right: 0, height: EDGE_STRIP, zIndex: 10, elevation: 10 },
  bottomEdge: { position: "absolute", bottom: 0, left: 0, right: 0, height: EDGE_STRIP, zIndex: 10, elevation: 10 },
  debugBox: {
    position: "absolute", top: 100, left: 8, right: 8,
    backgroundColor: "rgba(255,0,0,0.85)", borderRadius: 6, padding: 6,
    zIndex: 999, elevation: 999,
  },
  debugText: { color: "#fff", fontSize: 10, fontFamily: "monospace" },
});

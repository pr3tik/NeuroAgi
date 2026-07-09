import { useEffect } from "react";
import { View, StyleSheet, Dimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
} from "react-native-reanimated";
import { useSwipeNav } from "../navigation/useSwipeNav";
import PageDots from "./PageDots";
import { PageKey } from "../navigation/navConfig";
import { lastDirection } from "../navigation/transitionStore";

const { width: W, height: H } = Dimensions.get("window");
const DURATION = 300;
const EASE = Easing.out(Easing.poly(4));
const EDGE_STRIP = 24;

function getInitialOffset(dir: typeof lastDirection) {
  if (dir === "right") return { x: W,  y: 0 };
  if (dir === "left")  return { x: -W, y: 0 };
  if (dir === "down")  return { x: 0,  y: H };
  if (dir === "up")    return { x: 0,  y: -H };
  return { x: 0, y: 0 };
}

type Props = { page: PageKey; children: React.ReactNode };

export default function ScreenWrapper({ page, children }: Props) {
  const { horizontalGesture, topEdgeGesture, bottomEdgeGesture } = useSwipeNav(page);
  const { x: ix, y: iy } = getInitialOffset(lastDirection);

  const translateX = useSharedValue(ix);
  const translateY = useSharedValue(iy);
  const opacity    = useSharedValue(ix !== 0 || iy !== 0 ? 0.75 : 1);

  useEffect(() => {
    translateX.value = withTiming(0, { duration: DURATION, easing: EASE });
    translateY.value = withTiming(0, { duration: DURATION, easing: EASE });
    opacity.value    = withTiming(1, { duration: DURATION, easing: EASE });
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
            <View style={styles.content}>
              {children}
              {/* Thin edge strips for vertical (up/down) nav — kept off the main
                  content so they never compete with a screen's own ScrollView. */}
              <GestureDetector gesture={topEdgeGesture}>
                <View style={styles.topEdge} pointerEvents="box-none" />
              </GestureDetector>
              <GestureDetector gesture={bottomEdgeGesture}>
                <View style={styles.bottomEdge} pointerEvents="box-none" />
              </GestureDetector>
            </View>
            <View style={styles.footer}>
              <PageDots current={page} />
            </View>
          </View>
        </GestureDetector>
      </Animated.View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:      { flex: 1, backgroundColor: "#0f0f0f" },
  container: { flex: 1, padding: 20 },
  content:   { flex: 1, position: "relative" },
  footer:    { alignItems: "center", paddingVertical: 12 },
  topEdge:    { position: "absolute", top: 0, left: 0, right: 0, height: EDGE_STRIP },
  bottomEdge: { position: "absolute", bottom: 0, left: 0, right: 0, height: EDGE_STRIP },
});

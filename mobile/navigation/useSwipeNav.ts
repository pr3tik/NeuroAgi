// useSwipeNav.ts — gesture-handler-based port of src/navigation/useSwipe.ts.
//
// Raw View onTouchStart/onTouchEnd (the old approach) doesn't reliably fire
// on native: once a descendant ScrollView claims the touch responder for a
// scroll, the parent gets onTouchCancel instead of onTouchEnd, and the swipe
// is silently dropped. (The web version doesn't have this problem — DOM
// touch events bubble to ancestors regardless of a child's scroll handling.)
// react-native-gesture-handler's native gesture composition is the actual
// fix: failOffsetY lets a ScrollView win any vertical drag while our Pan
// still reliably wins clearly-horizontal ones.
//
// Vertical (up/down) nav is edge-gated instead — mirrors the web's "only
// navigate vertically when the gesture starts at the scroll boundary" rule,
// approximated here as two thin swipe strips at the very top/bottom of the
// content area (see ScreenWrapper.tsx), so it can't fight normal scrolling.

import { Gesture } from "react-native-gesture-handler";
import { runOnJS } from "react-native-reanimated";
import { useRouter } from "expo-router";
import { NAV, PageKey, Direction } from "./navConfig";
import { setLastDirection } from "./transitionStore";

const MIN_DIST = 50;
const MIN_VEL  = 300; // px/s (gesture-handler velocity is px/s, not px/ms)

export function useSwipeNav(currentPage: PageKey) {
  const router = useRouter();

  function navigate(direction: Direction) {
    const target = NAV[currentPage]?.[direction];
    if (target) {
      setLastDirection(direction);
      router.replace(`/${target}`);
    }
  }

  // .onEnd() callbacks run as UI-thread worklets (gesture-handler + reanimated
  // auto-integration) — router.replace() etc. are plain JS-thread functions,
  // so they must be dispatched back via runOnJS instead of called directly
  // (calling them directly throws at runtime, tearing down the app on swipe).
  const horizontalGesture = Gesture.Pan()
    .activeOffsetX([-15, 15])
    .failOffsetY([-15, 15])
    .onEnd(e => {
      "worklet";
      const dist = Math.abs(e.translationX);
      if (dist < MIN_DIST && Math.abs(e.velocityX) < MIN_VEL) return;
      runOnJS(navigate)(e.translationX < 0 ? "right" : "left");
    });

  // Pulling down from the top-edge strip → "up" (mirrors a pull-to-refresh
  // gesture); only the downward bound is reachable, so upward drags here
  // (unlikely in a 24px strip anyway) don't accidentally activate it.
  const topEdgeGesture = Gesture.Pan()
    .activeOffsetY([-1000, 12])
    .onEnd(e => {
      "worklet";
      if (e.translationY < MIN_DIST && e.velocityY < MIN_VEL) return;
      runOnJS(navigate)("up");
    });

  // Pulling up from the bottom-edge strip → "down".
  const bottomEdgeGesture = Gesture.Pan()
    .activeOffsetY([-12, 1000])
    .onEnd(e => {
      "worklet";
      if (e.translationY > -MIN_DIST && e.velocityY > -MIN_VEL) return;
      runOnJS(navigate)("down");
    });

  return { horizontalGesture, topEdgeGesture, bottomEdgeGesture, navigate };
}

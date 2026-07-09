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
// horizontalGesture.requireExternalGestureToFail(...) below makes it wait for
// the edge gestures to fail first when a touch starts inside their strip —
// without this, RNGH doesn't automatically treat a parent gesture (attached
// to the whole container) and a child gesture (attached to a small nested
// strip) as mutually exclusive, so the parent could still win a touch that
// started inside the strip.
//
// Live drag-follow: the screen tracks your finger in real time via onUpdate
// (driving the same translateX/translateY/opacity shared values
// ScreenWrapper uses for its entrance animation) and either commits —
// animating the rest of the way off-screen, then navigating — or springs
// back to 0 if the drag didn't clear the threshold.
//
// Easing matches the web app's actual transition exactly (tokens.css
// --ease-apple: cubic-bezier(0.25, 0.46, 0.45, 0.94)) — the previous
// Easing.poly(4) curve front-loaded ~95% of the motion into the first third
// of the duration, so it visually snapped into place and then sat still for
// the rest, reading as instant instead of smooth.

import { Gesture } from "react-native-gesture-handler";
import { SharedValue, runOnJS, withTiming, Easing } from "react-native-reanimated";
import { Dimensions } from "react-native";
import { useRouter } from "expo-router";
import { NAV, PageKey, Direction } from "./navConfig";
import { setLastDirection } from "./transitionStore";

const { width: W, height: H } = Dimensions.get("window");
const MIN_DIST = 50;
const MIN_VEL  = 300; // px/s (gesture-handler velocity is px/s, not px/ms)
const COMMIT_DURATION = 220;
const CANCEL_DURATION = 220;
export const EASE_APPLE = Easing.bezier(0.25, 0.46, 0.45, 0.94);

export function useSwipeNav(
  currentPage: PageKey,
  translateX: SharedValue<number>,
  translateY: SharedValue<number>,
  opacity: SharedValue<number>
) {
  const router = useRouter();

  function completeNavigate(direction: Direction) {
    const target = NAV[currentPage]?.[direction];
    if (target) {
      setLastDirection(direction);
      router.replace(`/${target}`);
    }
  }

  const horizontalGesture = Gesture.Pan()
    .activeOffsetX([-15, 15])
    .failOffsetY([-15, 15])
    .onUpdate(e => {
      translateX.value = e.translationX;
      opacity.value = Math.max(0.4, 1 - Math.abs(e.translationX) / W);
    })
    .onEnd(e => {
      const direction = e.translationX < 0 ? "right" : "left";
      const target = NAV[currentPage]?.[direction];
      const past = Math.abs(e.translationX) > MIN_DIST || Math.abs(e.velocityX) > MIN_VEL;
      if (target && past) {
        translateX.value = withTiming(e.translationX < 0 ? -W : W, { duration: COMMIT_DURATION, easing: EASE_APPLE },
          finished => { if (finished) runOnJS(completeNavigate)(direction); });
        opacity.value = withTiming(0, { duration: COMMIT_DURATION, easing: EASE_APPLE });
      } else {
        translateX.value = withTiming(0, { duration: CANCEL_DURATION, easing: EASE_APPLE });
        opacity.value = withTiming(1, { duration: CANCEL_DURATION, easing: EASE_APPLE });
      }
    });

  // Pulling down from the top-edge strip → "up" (mirrors a pull-to-refresh
  // gesture); only the downward bound is reachable, so upward drags here
  // (unlikely in a 48px strip anyway) don't accidentally activate it.
  const topEdgeGesture = Gesture.Pan()
    .activeOffsetY([-1000, 12])
    .onUpdate(e => {
      translateY.value = Math.max(0, e.translationY);
      opacity.value = Math.max(0.4, 1 - Math.abs(e.translationY) / H);
    })
    .onEnd(e => {
      const target = NAV[currentPage]?.up;
      const past = e.translationY > MIN_DIST || e.velocityY > MIN_VEL;
      if (target && past) {
        translateY.value = withTiming(H, { duration: COMMIT_DURATION, easing: EASE_APPLE }, finished => {
          if (finished) runOnJS(completeNavigate)("up");
        });
        opacity.value = withTiming(0, { duration: COMMIT_DURATION, easing: EASE_APPLE });
      } else {
        translateY.value = withTiming(0, { duration: CANCEL_DURATION, easing: EASE_APPLE });
        opacity.value = withTiming(1, { duration: CANCEL_DURATION, easing: EASE_APPLE });
      }
    });

  // Pulling up from the bottom-edge strip → "down".
  const bottomEdgeGesture = Gesture.Pan()
    .activeOffsetY([-12, 1000])
    .onUpdate(e => {
      translateY.value = Math.min(0, e.translationY);
      opacity.value = Math.max(0.4, 1 - Math.abs(e.translationY) / H);
    })
    .onEnd(e => {
      const target = NAV[currentPage]?.down;
      const past = e.translationY < -MIN_DIST || e.velocityY < -MIN_VEL;
      if (target && past) {
        translateY.value = withTiming(-H, { duration: COMMIT_DURATION, easing: EASE_APPLE }, finished => {
          if (finished) runOnJS(completeNavigate)("down");
        });
        opacity.value = withTiming(0, { duration: COMMIT_DURATION, easing: EASE_APPLE });
      } else {
        translateY.value = withTiming(0, { duration: CANCEL_DURATION, easing: EASE_APPLE });
        opacity.value = withTiming(1, { duration: CANCEL_DURATION, easing: EASE_APPLE });
      }
    });

  // Without this, RNGH treats the parent (horizontalGesture, on the whole
  // container) and the child (edge gestures, on their own small strips) as
  // fully independent recognizers — a touch starting inside a strip isn't
  // guaranteed to go to the more specific gesture first.
  horizontalGesture.requireExternalGestureToFail(topEdgeGesture, bottomEdgeGesture);

  return { horizontalGesture, topEdgeGesture, bottomEdgeGesture };
}

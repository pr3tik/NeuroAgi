// PageDots.tsx — port of src/components/PageDots.tsx: SVG 3×3 page map with
// directional connection lines derived from NAV, current-page pulse, and
// 3-tier dot shading (current / one-swipe-reachable / other).

import { useEffect, useMemo } from "react";
import { useRouter } from "expo-router";
import Svg, { Line, Circle } from "react-native-svg";
import Animated, {
  useSharedValue, useAnimatedProps, withRepeat, withTiming, Easing,
} from "react-native-reanimated";
import { DOT_GRID, NAV, PageKey } from "../navigation/navConfig";

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const DOT_R = 3;
const STEP  = 11;
const COLS  = DOT_GRID[0].length;
const ROWS  = DOT_GRID.length;
const SVG_W = (COLS - 1) * STEP + DOT_R * 2;
const SVG_H = (ROWS - 1) * STEP + DOT_R * 2;
const PAD   = 12; // extra room for the outer glow ring + bigger tap targets

const cx = (c: number) => c * STEP + DOT_R;
const cy = (r: number) => r * STEP + DOT_R;

const posMap: Partial<Record<PageKey, { r: number; c: number }>> = {};
DOT_GRID.forEach((row, r) => row.forEach((page, c) => { if (page) posMap[page] = { r, c }; }));

const LINES = (() => {
  const seen = new Set<string>();
  const lines: { x1: number; y1: number; x2: number; y2: number; from: PageKey; to: PageKey }[] = [];
  (Object.entries(NAV) as [PageKey, Partial<Record<string, PageKey>>][]).forEach(([from, dirs]) => {
    Object.values(dirs).forEach(to => {
      if (!to) return;
      const key = [from, to].sort().join("|");
      if (!seen.has(key) && posMap[from] && posMap[to]) {
        seen.add(key);
        const a = posMap[from]!, b = posMap[to]!;
        lines.push({ x1: cx(a.c), y1: cy(a.r), x2: cx(b.c), y2: cy(b.r), from, to });
      }
    });
  });
  return lines;
})();

function PulseDot({ x, y, r, color }: { x: number; y: number; r: number; color: string }) {
  const opacity = useSharedValue(0.4);
  useEffect(() => {
    opacity.value = withRepeat(
      withTiming(0.15, { duration: 1500, easing: Easing.inOut(Easing.ease) }),
      -1, true
    );
  }, []);
  const animatedProps = useAnimatedProps(() => ({ opacity: opacity.value }));
  return <AnimatedCircle cx={x} cy={y} r={r} fill={color} animatedProps={animatedProps} />;
}

export default function PageDots({ current }: { current: PageKey }) {
  const router = useRouter();
  const reachable = useMemo(
    () => new Set(Object.values(NAV[current] ?? {}).filter(Boolean) as PageKey[]),
    [current]
  );
  const pos = posMap[current];
  const dotFill = (page: PageKey) => page === current
    ? "rgba(255,255,255,0.9)"
    : reachable.has(page) ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.18)";

  return (
    <Svg width={SVG_W + PAD * 2} height={SVG_H + PAD * 2} viewBox={`${-PAD} ${-PAD} ${SVG_W + PAD * 2} ${SVG_H + PAD * 2}`}>
      {LINES.map((l, i) => {
        const isCurrent = l.from === current || l.to === current;
        return (
          <Line
            key={i} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2}
            stroke={isCurrent ? "rgba(255,255,255,0.28)" : "rgba(255,255,255,0.10)"}
            strokeWidth={isCurrent ? 1 : 0.75}
            strokeLinecap="round"
          />
        );
      })}

      {/* Invisible larger hit targets — the visible dots are too small to tap reliably */}
      {DOT_GRID.flat().map((page, i) => {
        if (!page) return null;
        const col = i % COLS, row = Math.floor(i / COLS);
        return (
          <Circle
            key={`hit-${page}`}
            cx={cx(col)} cy={cy(row)} r={9}
            fill="transparent"
            onPress={() => router.replace(`/${page}`)}
          />
        );
      })}

      {DOT_GRID.flat().map((page, i) => {
        if (!page) return null;
        const col = i % COLS, row = Math.floor(i / COLS);
        const isCurrent = page === current;
        return isCurrent ? (
          <PulseDot key={`pulse-${page}`} x={cx(col)} y={cy(row)} r={DOT_R + 0.5} color={dotFill(page)} />
        ) : (
          <Circle key={page} cx={cx(col)} cy={cy(row)} r={DOT_R} fill={dotFill(page)} />
        );
      })}

      {pos && (
        <Circle
          cx={cx(pos.c)} cy={cy(pos.r)} r={DOT_R + 3}
          fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth={1}
        />
      )}
    </Svg>
  );
}

// NeuralRing.tsx — Reggie's visual identity, ported from the web NeuralRing.
//
// The web draws a rotating wireframe sphere on <canvas> (28 fibonacci-sphere
// nodes, edges between near points, white→gold by state, pulsing halo). RN has
// no canvas and per-frame SVG re-renders jank while scrolling, so this renders
// the same orb statically at a pleasing 3/4 rotation with a native-driven halo
// pulse — the recognizable identity without the perf cost. Geometry constants
// (N, EDGE_THRESHOLD, RADIUS/SIZE ratio, node/edge alphas) match the web.

import { useEffect, useMemo, useRef } from "react";
import { View, Animated, Easing } from "react-native";
import Svg, { Circle, Line } from "react-native-svg";

const N = 28;
const EDGE_THRESHOLD = 0.72;
const ROT = 0.6;               // fixed 3/4 view (web rotates; we hold a nice angle)

function fibonacciSphere(n: number) {
  const pts: { x: number; y: number; z: number }[] = [];
  const phi = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const t = phi * i;
    pts.push({ x: r * Math.cos(t), y, z: r * Math.sin(t) });
  }
  return pts;
}
const NODES = fibonacciSphere(N);

export default function NeuralRing({
  size = 44, color = "255,255,255", pulse = true,
}: { size?: number; color?: string; pulse?: boolean }) {
  const R = size * 0.35;         // web RADIUS/SIZE = 24/68 ≈ 0.35
  const c = size / 2;
  const k = size / 68;           // scale node/edge weights to web's SIZE=68

  const { dots, edges } = useMemo(() => {
    const proj = NODES.map(({ x, y, z }) => {
      const rx = x * Math.cos(ROT) + z * Math.sin(ROT);
      const rz = -x * Math.sin(ROT) + z * Math.cos(ROT);
      return { sx: rx * R + c, sy: y * R + c, depth: (rz + 1) * 0.5 };
    });
    const es: { a: any; b: any; alpha: number }[] = [];
    const thr = R * 2 * EDGE_THRESHOLD;
    for (let i = 0; i < proj.length; i++) {
      for (let j = i + 1; j < proj.length; j++) {
        const dx = proj[i].sx - proj[j].sx, dy = proj[i].sy - proj[j].sy;
        if (Math.sqrt(dx * dx + dy * dy) < thr) {
          es.push({ a: proj[i], b: proj[j], alpha: 0.06 + (proj[i].depth + proj[j].depth) * 0.09 });
        }
      }
    }
    return { dots: proj, edges: es };
  }, [R, c]);

  const halo = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!pulse) return;
    const loop = Animated.loop(
      Animated.timing(halo, { toValue: 1, duration: 4200, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, halo]);
  const haloScale = halo.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 1.22, 1] });
  const haloOpacity = halo.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.16, 0.04, 0.16] });

  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      {pulse && (
        <Animated.View
          pointerEvents="none"
          style={{
            position: "absolute", width: size * 0.84, height: size * 0.84, borderRadius: size,
            borderWidth: 1, borderColor: `rgba(${color},0.5)`,
            transform: [{ scale: haloScale }], opacity: haloOpacity,
          }}
        />
      )}
      <Svg width={size} height={size}>
        {edges.map((e, i) => (
          <Line key={`e${i}`} x1={e.a.sx} y1={e.a.sy} x2={e.b.sx} y2={e.b.sy}
            stroke={`rgba(${color},${e.alpha.toFixed(2)})`} strokeWidth={0.7 * k} />
        ))}
        {dots.map((d, i) => (
          <Circle key={`n${i}`} cx={d.sx} cy={d.sy} r={(0.9 + d.depth * 0.8) * k}
            fill={`rgba(${color},${(0.5 + d.depth * 0.4).toFixed(2)})`} />
        ))}
      </Svg>
    </View>
  );
}

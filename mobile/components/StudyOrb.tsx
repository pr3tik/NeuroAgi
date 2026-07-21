// StudyOrb.tsx — the living focus orb at the heart of a study room (mobile port of
// src/components/StudyOrb.tsx). Pure react-native-svg + reanimated (no WebGL): a
// breathing warm→cool core, a soft glow, two counter-rotating dashed orbit rings,
// drifting particles, and the room's members orbiting the core. During an active
// focus sprint everything brightens and speeds up. Honours Reduce Motion.

import React, { useEffect, useMemo } from "react";
import { View, Text, StyleSheet } from "react-native";
import Animated, {
  useSharedValue, useAnimatedStyle, withRepeat, withTiming, Easing, useReducedMotion,
} from "react-native-reanimated";
import Svg, { Circle, Defs, RadialGradient, Stop } from "react-native-svg";
import { ThemeColors } from "../constants/appTheme";

const GOLD = "#C49A3C";
const g = (a: number) => `rgba(196,154,60,${a})`;
const COOL = "rgba(118,148,210,";

export type OrbMember = { userId?: string; name?: string; initial?: string };

export default function StudyOrb({
  colors, active = false, members = [], size = 190, speakingNames = [],
}: {
  colors: ThemeColors;
  active?: boolean;
  members?: OrbMember[];
  size?: number;
  speakingNames?: string[];
}) {
  const reduce = useReducedMotion();
  const orbiters = members.slice(0, 8);
  const speaking = useMemo(() => new Set(speakingNames), [speakingNames]);
  const pulse = active ? 1 : 0.68;
  const memberSpinSec = active ? 42 : 66;

  // One shared value per independently-animated layer.
  const ring1 = useSharedValue(0);
  const ring2 = useSharedValue(0);
  const parts = useSharedValue(0);
  const mem   = useSharedValue(0);
  const breathe = useSharedValue(0.5);
  const glow  = useSharedValue(0.5);

  useEffect(() => {
    const spin = (sv: { value: number }, sec: number) => {
      sv.value = 0;
      sv.value = withRepeat(withTiming(1, { duration: sec * 1000, easing: Easing.linear }), -1, false);
    };
    if (reduce) {
      ring1.value = 0; ring2.value = 0; parts.value = 0; mem.value = 0;
      breathe.value = 0.5; glow.value = 0.6;
      return;
    }
    spin(ring1, active ? 30 : 48);
    spin(ring2, active ? 36 : 62);
    spin(parts, active ? 18 : 30);
    spin(mem,   memberSpinSec);
    breathe.value = withRepeat(withTiming(1, { duration: 4600, easing: Easing.inOut(Easing.ease) }), -1, true);
    glow.value    = withRepeat(withTiming(1, { duration: 5000, easing: Easing.inOut(Easing.ease) }), -1, true);
  }, [reduce, active, memberSpinSec]);

  const ring1St = useAnimatedStyle(() => ({ transform: [{ rotate: `${ring1.value * 360}deg` }] }));
  const ring2St = useAnimatedStyle(() => ({ transform: [{ rotate: `${-ring2.value * 360}deg` }] }));
  const partsSt = useAnimatedStyle(() => ({ transform: [{ rotate: `${parts.value * 360}deg` }] }));
  const memSt   = useAnimatedStyle(() => ({ transform: [{ rotate: `${mem.value * 360}deg` }] }));
  const memCtr  = useAnimatedStyle(() => ({ transform: [{ rotate: `${-mem.value * 360}deg` }] }));
  const coreSt  = useAnimatedStyle(() => ({ transform: [{ scale: 1 + breathe.value * 0.055 }] }));
  const glowSt  = useAnimatedStyle(() => ({ opacity: (0.45 + glow.value * 0.4) * pulse }));

  const layer = { position: "absolute" as const, width: size, height: size };

  return (
    <View style={{ width: "100%", alignItems: "center", marginTop: 0, marginBottom: 12 }}>
      <View style={{ width: size, height: size }}>
        {/* Soft warm/cool glow behind everything */}
        <Animated.View style={[layer, { top: -size * 0.14, left: -size * 0.14, width: size * 1.28, height: size * 1.28 }, glowSt]}>
          <Svg width={size * 1.28} height={size * 1.28} viewBox="0 0 200 200">
            <Defs>
              <RadialGradient id="orb-glow" cx="50%" cy="44%" r="55%">
                <Stop offset="0%" stopColor={GOLD} stopOpacity={0.34} />
                <Stop offset="40%" stopColor={`${COOL}1)`} stopOpacity={0.14} />
                <Stop offset="72%" stopColor={`${COOL}1)`} stopOpacity={0} />
              </RadialGradient>
            </Defs>
            <Circle cx="100" cy="100" r="100" fill="url(#orb-glow)" />
          </Svg>
        </Animated.View>

        {/* Rotating dashed orbits */}
        <Animated.View style={[layer, ring1St]}>
          <Svg width={size} height={size} viewBox="0 0 200 200">
            <Circle cx="100" cy="100" r="80" fill="none" stroke={`${COOL}0.22)`} strokeWidth="1" strokeDasharray="2 8" />
          </Svg>
        </Animated.View>
        <Animated.View style={[layer, ring2St]}>
          <Svg width={size} height={size} viewBox="0 0 200 200">
            <Circle cx="100" cy="100" r="66" fill="none" stroke={g(0.26)} strokeWidth="1" strokeDasharray="1 9" />
          </Svg>
        </Animated.View>

        {/* Breathing core */}
        <Animated.View style={[layer, coreSt]}>
          <Svg width={size} height={size} viewBox="0 0 200 200">
            <Defs>
              <RadialGradient id="orb-core" cx="50%" cy="42%" r="62%">
                <Stop offset="0%"   stopColor="#FBEBC8" stopOpacity={0.95} />
                <Stop offset="34%"  stopColor={GOLD}    stopOpacity={0.85} />
                <Stop offset="74%"  stopColor="#6E5FA8" stopOpacity={0.32} />
                <Stop offset="100%" stopColor="#3A4A78" stopOpacity={0} />
              </RadialGradient>
              <RadialGradient id="orb-rim" cx="50%" cy="50%" r="50%">
                <Stop offset="76%" stopColor={GOLD} stopOpacity={0} />
                <Stop offset="92%" stopColor={g(0.45)} stopOpacity={0.45} />
                <Stop offset="100%" stopColor={GOLD} stopOpacity={0} />
              </RadialGradient>
            </Defs>
            <Circle cx="100" cy="100" r="94" fill="url(#orb-rim)" />
            <Circle cx="100" cy="100" r="55" fill="url(#orb-core)" />
            <Circle cx="100" cy="100" r="55" fill="none" stroke="rgba(251,235,200,0.35)" strokeWidth="0.75" />
          </Svg>
        </Animated.View>

        {/* Drifting particles */}
        <Animated.View style={[layer, partsSt]}>
          <Svg width={size} height={size} viewBox="0 0 200 200">
            {PARTICLES.map((p, i) => (
              <Circle
                key={i}
                cx={100 + Math.cos(p.a) * p.r}
                cy={100 + Math.sin(p.a) * p.r}
                r={p.s}
                fill={i % 2 ? g(0.9) : "rgba(150,180,230,0.85)"}
              />
            ))}
          </Svg>
        </Animated.View>

        {/* Members orbiting the core */}
        {orbiters.length > 0 && (
          <Animated.View pointerEvents="none" style={[layer, memSt]}>
            {orbiters.map((m, i) => {
              const ang = (i / orbiters.length) * Math.PI * 2 - Math.PI / 2;
              const R = size * 0.43;
              const x = size / 2 + Math.cos(ang) * R;
              const y = size / 2 + Math.sin(ang) * R;
              const isSpeaking = speaking.has(m.name || "");
              return (
                <View
                  key={m.userId || i}
                  style={[
                    styles.orbiter,
                    { left: x - 13, top: y - 13, borderColor: isSpeaking ? "rgba(74,222,128,0.85)" : g(0.5), borderWidth: isSpeaking ? 1.5 : 1 },
                  ]}
                >
                  <Animated.View style={memCtr}>
                    <Text style={[styles.orbiterText, { color: isSpeaking ? "#4ade80" : "#F4E9CB" }]}>
                      {(m.name?.[0] || m.initial || "?").toUpperCase()}
                    </Text>
                  </Animated.View>
                </View>
              );
            })}
          </Animated.View>
        )}
      </View>
    </View>
  );
}

// Stable particle ring (same every render so they don't jump).
const PARTICLES = Array.from({ length: 7 }, (_, i) => ({
  a: (i / 7) * Math.PI * 2,
  r: 60 + (i % 3) * 9,
  s: 1.3 + (i % 4) * 0.5,
}));

const styles = StyleSheet.create({
  orbiter: {
    position: "absolute", width: 26, height: 26, borderRadius: 13,
    backgroundColor: "rgba(18,18,24,0.92)",
    alignItems: "center", justifyContent: "center",
  },
  orbiterText: { fontSize: 11, fontWeight: "700" },
});

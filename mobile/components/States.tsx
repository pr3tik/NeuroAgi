// States.tsx — the app's shared loading / empty / error vocabulary.
//
// Before this, every screen invented its own "no data" text, its own centred
// ActivityIndicator, and mostly had no error or pull-to-refresh handling at all —
// so the same three moments looked different on every tab. This module is the one
// place those three states live, so they read identically everywhere:
//
//   • <Skeleton>            — a shimmering placeholder block (loading, content-shaped)
//   • <LoadingState>        — a centred spinner + label (loading, when a skeleton is overkill)
//   • <EmptyState>          — teaches what will appear here + a way to make it happen
//   • <ErrorState>          — says what broke + a Try-again button
//   • useRefresh()          — wires pull-to-refresh with a consistent spinner
//   • <ThemedRefreshControl>— the pre-tinted RefreshControl the hook pairs with
//
// All of it is theme-driven: pass the screen's effective `colors` (from
// usePageTheme / useTheme) and it renders correct in both the dark and the
// periwinkle-glass light theme. Motion honours Reduce Motion.

import React, { useCallback, useEffect, useState } from "react";
import {
  View, Text, StyleSheet, ActivityIndicator, RefreshControl,
  TouchableOpacity, StyleProp, ViewStyle, LayoutChangeEvent,
} from "react-native";
import Animated, {
  useSharedValue, useAnimatedStyle, withRepeat, withTiming, Easing,
  useReducedMotion,
} from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import { AlertTriangle } from "lucide-react-native";
import { ThemeColors } from "../constants/appTheme";
import { isLightBg } from "./Glass";

// A lucide icon component, e.g. `BookOpen` — same shape work.tsx's tiles accept.
type IconCmp = React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;

// ── Skeleton ─────────────────────────────────────────────────────────────────
// A placeholder block with a light sweep across it, the iOS "redacted" feel. The
// product register prefers content-shaped skeletons over a spinner floating in the
// middle of a screen, so compose these into the rough shape of what's loading.

export function Skeleton({
  colors, width = "100%", height = 16, radius = 8, style,
}: {
  colors: ThemeColors;
  width?: number | `${number}%`;
  height?: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const reduce = useReducedMotion();
  const [w, setW] = useState(0);
  const x = useSharedValue(0);

  useEffect(() => {
    if (reduce || w === 0) return;
    x.value = 0;
    x.value = withRepeat(withTiming(1, { duration: 1150, easing: Easing.inOut(Easing.ease) }), -1, false);
  }, [reduce, w]);

  const band = useAnimatedStyle(() => ({
    transform: [{ translateX: -w + x.value * 2 * w }],
  }));

  const onLayout = (e: LayoutChangeEvent) => {
    const next = Math.round(e.nativeEvent.layout.width);
    if (next && next !== w) setW(next);
  };

  const light = isLightBg(colors) || colors.scheme === "light";
  const highlight = light ? "rgba(255,255,255,0.16)" : "rgba(255,255,255,0.09)";

  return (
    <View
      onLayout={onLayout}
      style={[{ width, height, borderRadius: radius, backgroundColor: colors.surfaceTranslucent, overflow: "hidden" }, style]}
    >
      {!reduce && w > 0 && (
        <Animated.View style={[StyleSheet.absoluteFill, { width: w }, band]}>
          <LinearGradient
            colors={["transparent", highlight, "transparent"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      )}
    </View>
  );
}

// ── LoadingState ──────────────────────────────────────────────────────────────
// A centred spinner with an optional label — for the lighter cases where laying
// out a bespoke skeleton isn't worth it (a modal body, a short list).

export function LoadingState({
  colors, label, style,
}: {
  colors: ThemeColors;
  label?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.center, style]}>
      <ActivityIndicator color={colors.accent} />
      {label ? <Text style={[styles.loadingLabel, { color: colors.textSecondary }]}>{label}</Text> : null}
    </View>
  );
}

// ── EmptyState ──────────────────────────────────────────────────────────────
// Teaches the interface rather than saying "nothing here": an icon, a title, one
// line of why-this-matters, and (optionally) the single action that fills it.

export function EmptyState({
  colors, Icon, title, message, actionLabel, onAction, compact, style,
}: {
  colors: ThemeColors;
  Icon?: IconCmp;
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.center, { paddingVertical: compact ? 40 : 72 }, style]}>
      {Icon && (
        <View style={[styles.iconWrap, { backgroundColor: colors.accentSoft, borderColor: colors.accentLine }]}>
          <Icon size={26} color={colors.accent} strokeWidth={1.8} />
        </View>
      )}
      <Text style={[styles.title, { color: colors.textPrimary }]}>{title}</Text>
      {message ? <Text style={[styles.message, { color: colors.textSecondary }]}>{message}</Text> : null}
      {actionLabel && onAction ? (
        <TouchableOpacity onPress={onAction} activeOpacity={0.85} style={[styles.action, { backgroundColor: colors.accent }]}>
          <Text style={[styles.actionText, { color: actionInk(colors) }]}>{actionLabel}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

// ── ErrorState ────────────────────────────────────────────────────────────────
// Says what broke, calmly, and offers the one useful action: try again. The tint
// is amber (a warning), not the accent — this isn't a success surface.

export function ErrorState({
  colors, title = "Something went wrong", message = "We couldn't load this just now. Check your connection and try again.", onRetry, retryLabel = "Try again", compact, style,
}: {
  colors: ThemeColors;
  title?: string;
  message?: string;
  onRetry?: () => void;
  retryLabel?: string;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const warn = colors.gold;
  return (
    <View style={[styles.center, { paddingVertical: compact ? 40 : 72 }, style]}>
      <View style={[styles.iconWrap, { backgroundColor: "rgba(235,194,94,0.14)", borderColor: "rgba(235,194,94,0.32)" }]}>
        <AlertTriangle size={24} color={warn} strokeWidth={1.9} />
      </View>
      <Text style={[styles.title, { color: colors.textPrimary }]}>{title}</Text>
      {message ? <Text style={[styles.message, { color: colors.textSecondary }]}>{message}</Text> : null}
      {onRetry ? (
        <TouchableOpacity
          onPress={onRetry}
          activeOpacity={0.85}
          style={[styles.actionGhost, { borderColor: colors.borderStrong }]}
        >
          <Text style={[styles.actionGhostText, { color: colors.textPrimary }]}>{retryLabel}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

// ── Pull-to-refresh ─────────────────────────────────────────────────────────
// useRefresh(fn) manages the spinner lifecycle around a reload; pair it with
// ThemedRefreshControl so every ScrollView pulls the same way, tinted to accent.

export function useRefresh(onRefresh: () => void | Promise<void>) {
  const [refreshing, setRefreshing] = useState(false);
  const run = useCallback(async () => {
    setRefreshing(true);
    try { await onRefresh(); } catch { /* the reload surfaces its own error state */ } finally { setRefreshing(false); }
  }, [onRefresh]);
  return { refreshing, onRefresh: run };
}

export function ThemedRefreshControl({
  colors, refreshing, onRefresh,
}: {
  colors: ThemeColors;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  return (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={onRefresh}
      tintColor={colors.accent}
      colors={[colors.accent]}
      progressBackgroundColor={colors.surface}
    />
  );
}

// Ink for a filled accent button — dark on the light sage so the label reads.
function actionInk(colors: ThemeColors): string {
  return colors.scheme === "light" ? "#10241A" : "#121414";
}

const styles = StyleSheet.create({
  center:       { flexGrow: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32 },
  loadingLabel: { marginTop: 12, fontSize: 13, fontWeight: "400" },
  iconWrap:     { width: 56, height: 56, borderRadius: 18, borderWidth: 1, alignItems: "center", justifyContent: "center", marginBottom: 18 },
  title:        { fontSize: 17, fontWeight: "700", letterSpacing: -0.2, textAlign: "center" },
  message:      { fontSize: 14, fontWeight: "400", lineHeight: 20, textAlign: "center", marginTop: 8, maxWidth: 300 },
  action:       { minHeight: 44, borderRadius: 12, paddingHorizontal: 22, alignItems: "center", justifyContent: "center", marginTop: 22 },
  actionText:   { fontSize: 15, fontWeight: "600", letterSpacing: -0.1 },
  actionGhost:  { minHeight: 44, borderRadius: 12, borderWidth: 1, paddingHorizontal: 22, alignItems: "center", justifyContent: "center", marginTop: 22 },
  actionGhostText: { fontSize: 15, fontWeight: "600", letterSpacing: -0.1 },
});

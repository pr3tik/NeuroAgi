// BottomNav.tsx — port of src/components/BottomNav.tsx's mobile branch (the
// bottom bar + "More" sheet; web's sidebar branch only applies at its ≥768px
// breakpoint, which mobile never hits). Tab bar only — no swipe nav, matching
// web (which never had one either).

import { useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Modal } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path, Circle, Rect } from "react-native-svg";
import { PageKey, PRIMARY, MORE, LABEL, SHORT_LABEL } from "../navigation/navConfig";

const ACCENT   = "rgba(0,210,190,0.95)";
const INACTIVE = "rgba(255,255,255,0.42)";
const BORDER   = "rgba(255,255,255,0.08)";

// Same path data as web's BottomNav.tsx Icon() — kept pixel-identical so the
// two platforms read as the same product.
function Icon({ name, color }: { name: string; color: string }) {
  const c = { width: 22, height: 22, viewBox: "0 0 24 24", fill: "none", stroke: color, strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (name) {
    case "work":        return <Svg {...c}><Path d="M3 10.5 12 3l9 7.5" /><Path d="M5 9.5V20h14V9.5" /></Svg>;
    case "canvas":      return <Svg {...c}><Path d="M12 3 21 8l-9 5-9-5 9-5Z" /><Path d="M3 12l9 5 9-5" /></Svg>;
    case "study":       return <Svg {...c}><Rect x="3" y="6" width="13" height="12" rx="2" /><Path d="M8 4h11a2 2 0 0 1 2 2v9" /></Svg>;
    case "leaderboard": return <Svg {...c}><Path d="M6 20V11" /><Path d="M12 20V5" /><Path d="M18 20v-6" /></Svg>;
    case "identity":    return <Svg {...c}><Circle cx="12" cy="8" r="3.5" /><Path d="M5 20a7 7 0 0 1 14 0" /></Svg>;
    case "more":        return <Svg {...c}><Circle cx="5" cy="12" r="1.4" fill={color} stroke="none" /><Circle cx="12" cy="12" r="1.4" fill={color} stroke="none" /><Circle cx="19" cy="12" r="1.4" fill={color} stroke="none" /></Svg>;
    case "assignment":  return <Svg {...c}><Path d="M7 3h7l4 4v14H7z" /><Path d="M14 3v4h4" /><Path d="M10 13h5M10 16h3" /></Svg>;
    case "toolkit":     return <Svg {...c}><Path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /></Svg>;
    case "files":       return <Svg {...c}><Path d="M4 7h6l2 2h8v9a1 1 0 0 1-1 1H4z" /></Svg>;
    case "rooms":       return <Svg {...c}><Circle cx="9" cy="9" r="2.6" /><Path d="M3.5 19a5.5 5.5 0 0 1 11 0" /><Path d="M16 7.5a2.6 2.6 0 0 1 0 5" /><Path d="M17 14.5a5.5 5.5 0 0 1 3.5 4.5" /></Svg>;
    case "spaces":      return <Svg {...c}><Path d="M12 3l7 4v5c0 4-3 7-7 9-4-2-7-5-7-9V7l7-4z" /></Svg>;
    default:            return null;
  }
}

function BarItem({ pageKey, iconName, label, active, onPress, grid }: {
  pageKey: PageKey | "more"; iconName?: string; label?: string; active: boolean; onPress: () => void;
  /** True inside the "More" sheet's wrapped grid, where a fixed-width cell is
   *  needed instead of flex:1 (which doesn't produce even columns once rows wrap). */
  grid?: boolean;
}) {
  const color = active ? ACCENT : INACTIVE;
  const text = label ?? (pageKey === "more" ? "More" : SHORT_LABEL[pageKey as PageKey] ?? LABEL[pageKey as PageKey]);
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7} style={grid ? styles.gridItem : styles.item}>
      <Icon name={iconName ?? pageKey} color={color} />
      <Text style={[styles.itemLabel, { color }]} numberOfLines={1}>{text}</Text>
    </TouchableOpacity>
  );
}

export default function BottomNav({ current }: { current: PageKey }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [moreOpen, setMoreOpen] = useState(false);

  const go = (key: PageKey) => { setMoreOpen(false); router.replace(`/${key}`); };
  const moreActive = MORE.includes(current);

  return (
    <>
      <Modal visible={moreOpen} transparent animationType="fade" onRequestClose={() => setMoreOpen(false)}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setMoreOpen(false)} />
        <View style={[styles.sheet, { bottom: 64 + insets.bottom + 12 }]}>
          {MORE.map(key => (
            <BarItem key={key} pageKey={key} active={current === key} onPress={() => go(key)} grid />
          ))}
        </View>
      </Modal>

      <View style={[styles.bar, { paddingBottom: 8 + insets.bottom }]}>
        {PRIMARY.map(key => (
          <BarItem key={key} pageKey={key} active={current === key} onPress={() => go(key)} />
        ))}
        <BarItem
          pageKey="more" iconName="more" label="More"
          active={moreOpen || moreActive}
          onPress={() => setMoreOpen(v => !v)}
        />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row", alignItems: "center",
    paddingTop: 8, paddingHorizontal: 6,
    backgroundColor: "rgba(12,13,16,0.96)",
    borderTopWidth: 1, borderTopColor: BORDER,
  },
  item: {
    flex: 1, alignItems: "center", justifyContent: "center", gap: 3, paddingVertical: 2,
  },
  gridItem: {
    width: "25%", alignItems: "center", justifyContent: "center", gap: 5, paddingVertical: 10,
  },
  itemLabel: { fontFamily: "Inter_500Medium", fontSize: 10, letterSpacing: 0.1 },
  backdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: {
    position: "absolute", left: 12, right: 12,
    padding: 10, backgroundColor: "rgba(18,19,23,0.98)",
    borderWidth: 1, borderColor: BORDER, borderRadius: 18,
    flexDirection: "row", flexWrap: "wrap",
  },
});

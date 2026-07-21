// SubNav.tsx — the horizontally-scrollable chip row a tab shows when it owns
// more than one screen (Learn, Library, Community). Modeled on Spotify's Library
// filter chips: the active chip is a filled accent pill, the rest are quiet
// outlines. Tapping a chip router.replace()s to that sibling route — the same
// swap-not-push navigation the whole app already uses (see app/_layout.tsx).
//
// Rendered centrally by ScreenWrapper, so no screen body has to know it exists.

import { ScrollView, Text, TouchableOpacity, StyleSheet } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { PageKey, TAB_OF, SUBNAV, SubItem } from "../navigation/navConfig";
import { ThemeColors } from "../constants/appTheme";

// A chip is active when its route matches the current page. For chips that share
// a page but differ by a query param — the two Study chips (?mode=) and the two
// merged Files/Notes chips (?tab=) — that param has to match too. Params default
// so the first chip lights up on the bare route (Flashcards on /study, Files on
// /toolkit).
function isActive(item: SubItem, page: PageKey, mode: string, tab: string): boolean {
  if (item.key !== page) return false;
  if (item.mode) return item.mode === mode;
  if (item.tab)  return item.tab === tab;
  return true;
}

export default function SubNav({ page, colors }: { page: PageKey; colors: ThemeColors }) {
  const router = useRouter();
  const params = useLocalSearchParams<{ mode?: string; tab?: string }>();
  const mode = params.mode === "guide" ? "guide" : "flashcards";
  const subTab = params.tab === "notes" ? "notes" : "files";

  const tab = TAB_OF[page];
  const items = tab ? SUBNAV[tab] : [];
  if (items.length < 2) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      style={styles.scroll}
    >
      {items.map((item, i) => {
        const active = isActive(item, page, mode, subTab);
        return (
          <TouchableOpacity
            key={`${item.key}-${item.mode ?? i}`}
            onPress={() => router.replace(item.href as any)}
            activeOpacity={0.7}
            style={[
              styles.chip,
              active
                ? { backgroundColor: colors.accentSoft, borderColor: colors.accentLine }
                : { backgroundColor: colors.surfaceTranslucent, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.chipText, { color: active ? colors.accent : colors.textSecondary }]}>
              {item.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 0, marginBottom: 16 },
  row:    { gap: 8, paddingRight: 20 },
  chip: {
    paddingHorizontal: 15, height: 32, borderRadius: 16,
    alignItems: "center", justifyContent: "center",
    borderWidth: 1,
  },
  chipText: { fontWeight: "500", fontSize: 13, letterSpacing: 0.1 },
});

// ScreenWrapper.tsx — page shell: Header on top, scrollable content in the
// middle, BottomNav pinned at the bottom. Tab bar only, no swipe nav (matches
// web's BottomNav.tsx, which never had a swipe mode either).

import { View, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Header from "./Header";
import BottomNav from "./BottomNav";
import { PageKey } from "../navigation/navConfig";

type Props = { page: PageKey; children: React.ReactNode };

export default function ScreenWrapper({ page, children }: Props) {
  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <View style={styles.container}>
        <Header page={page} />
        <View style={styles.content}>
          {children}
        </View>
      </View>
      <BottomNav current={page} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:      { flex: 1, backgroundColor: "#0f0f0f" },
  container: { flex: 1, padding: 20, paddingBottom: 0 },
  content:   { flex: 1, position: "relative" },
});

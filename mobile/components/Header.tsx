// Header.tsx — port of App.tsx's <header className="app-header"> shell: page
// label, token/tier pill (tappable → leaderboard), notification bell + panel,
// and the page-dots nav map (web puts these in the header, not a bottom
// footer — this replaces ScreenWrapper's old bottom PageDots placement).

import { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { Bell } from "lucide-react-native";
import { supabase } from "../services/supabase";
import { apiGet } from "../services/api";
import { useUserId } from "../context/AuthContext";
import PageDots from "./PageDots";
import NotificationPanel from "./NotificationPanel";
import { PageKey, LABEL } from "../navigation/navConfig";

export default function Header({ page }: { page: PageKey }) {
  const router = useRouter();
  const userId = useUserId();
  const [tokenSummary, setTokenSummary] = useState<{ points: number; tier: string } | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [panelOpen, setPanelOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;

    // Same /api/token-engine?action=summary endpoint src/api/tokens.ts hits —
    // best-effort, the pill just doesn't render if it fails.
    apiGet(`/api/token-engine?action=summary&userId=${encodeURIComponent(userId)}`)
      .then(s => { if (!cancelled && s) setTokenSummary({ points: s.points ?? 0, tier: s.tier ?? "Basic" }); })
      .catch(() => {});

    supabase.from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId).eq("read", false)
      .then(({ count }) => { if (!cancelled) setUnreadCount(count ?? 0); });

    return () => { cancelled = true; };
  }, [page, userId]);

  return (
    <>
      <View style={styles.header}>
        <Text style={styles.pageLabel}>{LABEL[page]}</Text>

        <View style={styles.cluster}>
          {tokenSummary && (
            <>
              <TouchableOpacity
                style={styles.tokenBtn}
                onPress={() => router.replace("/leaderboard")}
                activeOpacity={0.72}
              >
                <View style={styles.tokenDot} />
                <Text style={styles.tokenPoints}>{tokenSummary.points}</Text>
                <Text style={styles.tokenSep}>·</Text>
                <Text style={styles.tokenTier}>{tokenSummary.tier}</Text>
              </TouchableOpacity>
              <View style={styles.divider} />
            </>
          )}
          <TouchableOpacity
            style={[styles.bellBtn, !tokenSummary && styles.bellBtnStandalone]}
            onPress={() => setPanelOpen(true)}
            activeOpacity={0.8}
          >
            <Bell size={17} color={unreadCount > 0 ? "#C49A3C" : "rgba(255,255,255,0.38)"} />
            {unreadCount > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{unreadCount > 99 ? "99+" : unreadCount}</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>

        <PageDots current={page} />
      </View>

      <NotificationPanel
        visible={panelOpen}
        onClose={() => setPanelOpen(false)}
        onUnreadChange={setUnreadCount}
      />
    </>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    marginBottom: 20,
  },
  pageLabel: {
    fontFamily: "Inter_500Medium", fontSize: 11, color: "rgba(255,255,255,0.35)",
    letterSpacing: 2, textTransform: "uppercase",
  },
  cluster: {
    flexDirection: "row", alignItems: "center", height: 32,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.09)",
    borderRadius: 16,
  },
  tokenBtn: {
    flexDirection: "row", alignItems: "center", gap: 5,
    height: "100%", paddingLeft: 11, paddingRight: 8,
  },
  tokenDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#C49A3C" },
  tokenPoints: { fontFamily: "Inter_600SemiBold", fontSize: 11, color: "#C49A3C", letterSpacing: -0.1 },
  tokenSep: { fontFamily: "Inter_400Regular", fontSize: 10, color: "rgba(196,154,60,0.45)", marginHorizontal: 1 },
  tokenTier: { fontFamily: "Inter_400Regular", fontSize: 10, color: "rgba(255,255,255,0.3)", letterSpacing: 0.3 },
  divider: { width: 1, height: 16, backgroundColor: "rgba(255,255,255,0.09)" },
  bellBtn: {
    width: 32, height: 32, alignItems: "center", justifyContent: "center",
    borderTopRightRadius: 15, borderBottomRightRadius: 15,
  },
  bellBtnStandalone: { borderRadius: 15 },
  badge: {
    position: "absolute", top: 3, right: 3, minWidth: 15, height: 15,
    backgroundColor: "#C49A3C", borderRadius: 8,
    alignItems: "center", justifyContent: "center", paddingHorizontal: 3,
  },
  badgeText: { fontFamily: "Inter_700Bold", fontSize: 9, color: "#111" },
});

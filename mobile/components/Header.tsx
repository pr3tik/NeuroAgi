// Header.tsx — port of App.tsx's <header className="app-header"> shell: page
// label, token/tier pill (tappable → leaderboard), notification bell + panel.

import { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { Bell, User } from "lucide-react-native";
import { supabase } from "../services/supabase";
import { apiGet } from "../services/api";
import { useAuth } from "../context/AuthContext";
import NotificationPanel from "./NotificationPanel";
import Glass from "./Glass";
import { PageKey, LABEL, TAB_OF, TABS } from "../navigation/navConfig";
import { ThemeColors } from "../constants/appTheme";

export default function Header({ page, colors }: { page: PageKey; colors: ThemeColors }) {
  const router = useRouter();
  const { userId, profile } = useAuth();

  // Tabbed screens show their tab's name ("LEARN"); non-tab screens (profile)
  // fall back to their own label.
  const tab = TAB_OF[page];
  const title = (tab ? TABS.find(t => t.key === tab)?.label : null) ?? LABEL[page];
  const initial = profile?.name?.trim()?.[0]?.toUpperCase() ?? "";
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
        <View style={styles.left}>
          <Glass colors={colors} radius={16} onPress={() => router.replace("/identity")} style={styles.avatar}>
            {initial
              ? <Text style={[styles.avatarText, { color: colors.textPrimary }]}>{initial}</Text>
              : <User size={15} color={colors.textSecondary} />}
          </Glass>
          {/* Page label removed — each screen carries its own title, and the tab
              name already shows in the bottom bar. No uppercase eyebrow here. */}
        </View>

        <Glass colors={colors} radius={16} style={styles.cluster}>
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
                <Text style={[styles.tokenTier, { color: colors.textTertiary }]}>{tokenSummary.tier}</Text>
              </TouchableOpacity>
              <View style={[styles.divider, { backgroundColor: colors.border }]} />
            </>
          )}
          <TouchableOpacity
            style={[styles.bellBtn, !tokenSummary && styles.bellBtnStandalone]}
            onPress={() => setPanelOpen(true)}
            activeOpacity={0.8}
          >
            <Bell size={17} color={unreadCount > 0 ? "#C49A3C" : colors.textDim} />
            {unreadCount > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{unreadCount > 99 ? "99+" : unreadCount}</Text>
              </View>
            )}
          </TouchableOpacity>
        </Glass>
      </View>

      <NotificationPanel
        visible={panelOpen}
        colors={colors}
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
  left: { flexDirection: "row", alignItems: "center", gap: 11, flexShrink: 1 },
  avatar: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: "center", justifyContent: "center",
  },
  avatarText: {
    fontWeight: "600", fontSize: 13, color: "rgba(255,255,255,0.82)",
  },
  pageLabel: {
    fontWeight: "500", fontSize: 11, color: "rgba(255,255,255,0.35)",
    letterSpacing: 0.2,   },
  cluster: {
    flexDirection: "row", alignItems: "center", height: 32,
    borderRadius: 16,
  },
  tokenBtn: {
    flexDirection: "row", alignItems: "center", gap: 5,
    height: "100%", paddingLeft: 11, paddingRight: 8,
  },
  tokenDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#C49A3C" },
  tokenPoints: { fontWeight: "600", fontSize: 11, color: "#C49A3C", letterSpacing: -0.1 },
  tokenSep: { fontWeight: "400", fontSize: 10, color: "rgba(196,154,60,0.45)", marginHorizontal: 1 },
  tokenTier: { fontWeight: "400", fontSize: 10, color: "rgba(255,255,255,0.3)", letterSpacing: 0.3 },
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
  badgeText: { fontWeight: "700", fontSize: 9, color: "#111" },
});

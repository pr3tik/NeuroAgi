// NotificationPanel.tsx — mobile v1 of src/components/NotificationPanel.tsx.
// Same notifications table/API (RLS disabled, safe with the anon key). Ported:
// type icons, default titles, relative time, mark-read (tap) / mark-all-read.
// Skipped for v1 (web-only for now): friend-request accept/decline buttons,
// avatar-colored initials, live postgres_changes subscription — this fetches
// on open instead of streaming in real time.

import { useEffect, useState } from "react";
import { Modal, View, Text, TouchableOpacity, ScrollView, StyleSheet } from "react-native";
import {
  UserPlus, Check, MessageCircle, DoorOpen, ClipboardList, Trophy, TrendingUp, Brain, Bell, X,
} from "lucide-react-native";
import { supabase } from "../services/supabase";
import { useUserId } from "../context/AuthContext";
import { ThemeColors } from "../constants/appTheme";

type AppNotification = {
  id: string;
  type: string;
  title: string | null;
  body: string | null;
  read: boolean;
  created_at: string;
};

const TYPE_CFG: Record<string, { icon: any; defaultTitle: string }> = {
  friend_request:   { icon: UserPlus,      defaultTitle: "Friend request" },
  request_accepted: { icon: Check,         defaultTitle: "Now connected" },
  nudge:            { icon: MessageCircle, defaultTitle: "Study nudge" },
  room_invite:      { icon: DoorOpen,      defaultTitle: "Room invite" },
  assignment_due:   { icon: ClipboardList, defaultTitle: "Assignment due soon" },
  milestone:        { icon: Trophy,        defaultTitle: "Milestone reached" },
  ranking:          { icon: TrendingUp,    defaultTitle: "Leaderboard update" },
  intervention:     { icon: Brain,         defaultTitle: "A nudge from Reggie" },
};

function relativeTime(iso: string): string {
  const sec = (Date.now() - new Date(iso).getTime()) / 1000;
  if (sec < 60) return "now";
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  return `${Math.floor(sec / 86400)}d`;
}

export default function NotificationPanel({
  visible, colors, onClose, onUnreadChange,
}: {
  visible: boolean;
  colors?: ThemeColors;
  onClose: () => void;
  onUnreadChange: (n: number) => void;
}) {
  const userId = useUserId();
  // Both grounds are deep with light text, so only the sheet's own fill changes:
  // a deep periwinkle glass in light mode (matches the web notif panel over the blue
  // ground), the near-black sheet in dark. Text/icons stay light on both.
  const light = colors?.scheme === "light";
  const sheetTheme = light
    ? { backgroundColor: "rgba(28,36,92,0.94)", borderColor: "rgba(255,255,255,0.20)" }
    : null;
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setLoading(true);
    supabase.from("notifications")
      .select("id, type, title, body, read, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(30)
      .then(({ data }) => {
        if (cancelled) return;
        setItems((data ?? []) as AppNotification[]);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [visible, userId]);

  async function markRead(id: string) {
    setItems(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
    onUnreadChange(items.filter(n => !n.read && n.id !== id).length);
    supabase.from("notifications").update({ read: true }).eq("id", id).then(() => {});
  }

  async function markAllRead() {
    const unreadIds = items.filter(n => !n.read).map(n => n.id);
    setItems(prev => prev.map(n => ({ ...n, read: true })));
    onUnreadChange(0);
    if (unreadIds.length) {
      supabase.from("notifications").update({ read: true }).in("id", unreadIds).then(() => {});
    }
  }

  const unreadCount = items.filter(n => !n.read).length;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
      <View style={[styles.sheet, sheetTheme]}>
        <View style={styles.header}>
          <Text style={styles.title}>Notifications</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
            {unreadCount > 0 && (
              <TouchableOpacity onPress={markAllRead}>
                <Text style={styles.markAll}>Mark all read</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={onClose} hitSlop={8}>
              <X size={18} color="rgba(255,255,255,0.4)" />
            </TouchableOpacity>
          </View>
        </View>

        <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false}>
          {loading && <Text style={styles.empty}>Loading…</Text>}
          {!loading && items.length === 0 && (
            <View style={styles.emptyWrap}>
              <Bell size={22} color="rgba(255,255,255,0.15)" />
              <Text style={styles.empty}>You're all caught up</Text>
            </View>
          )}
          {items.map(n => {
            const cfg = TYPE_CFG[n.type] ?? { icon: Bell, defaultTitle: "Notification" };
            const Icon = cfg.icon;
            return (
              <TouchableOpacity
                key={n.id}
                style={[styles.row, !n.read && styles.rowUnread]}
                onPress={() => markRead(n.id)}
                activeOpacity={0.7}
              >
                <View style={styles.iconWrap}>
                  <Icon size={15} color="#C49A3C" />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.rowTitle} numberOfLines={1}>{n.title ?? cfg.defaultTitle}</Text>
                  {n.body ? <Text style={styles.rowBody} numberOfLines={2}>{n.body}</Text> : null}
                </View>
                <View style={{ alignItems: "flex-end", gap: 6 }}>
                  <Text style={styles.rowTime}>{relativeTime(n.created_at)}</Text>
                  {!n.read && <View style={styles.dot} />}
                </View>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.5)" },
  sheet: {
    position: "absolute", top: 90, left: 16, right: 16,
    backgroundColor: "#17181c", borderRadius: 18,
    borderWidth: 1, borderColor: "rgba(255,255,255,0.08)",
    overflow: "hidden",
  },
  header: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.06)",
  },
  title: { fontWeight: "600", fontSize: 14, color: "#ECE8E1" },
  markAll: { fontWeight: "400", fontSize: 12, color: "#C49A3C" },
  emptyWrap: { alignItems: "center", gap: 8, paddingVertical: 36 },
  empty: { fontWeight: "400", fontSize: 12, color: "rgba(255,255,255,0.3)", textAlign: "center", paddingVertical: 20 },
  row: {
    flexDirection: "row", alignItems: "flex-start", gap: 12,
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.04)",
  },
  rowUnread: { backgroundColor: "rgba(196,154,60,0.04)" },
  iconWrap: {
    width: 28, height: 28, borderRadius: 14, marginTop: 2,
    backgroundColor: "rgba(196,154,60,0.14)",
    alignItems: "center", justifyContent: "center", flexShrink: 0,
  },
  rowTitle: { fontWeight: "500", fontSize: 13, color: "#ECE8E1", marginBottom: 2 },
  rowBody: { fontWeight: "400", fontSize: 12, color: "rgba(255,255,255,0.45)", lineHeight: 17 },
  rowTime: { fontWeight: "400", fontSize: 10, color: "rgba(255,255,255,0.3)" },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#C49A3C" },
});

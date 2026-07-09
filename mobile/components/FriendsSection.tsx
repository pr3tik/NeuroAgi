// FriendsSection.tsx — mobile port of src/components/FriendsSection.tsx.
// Same friends social graph UI, embedded in the Identity screen.
//
// Data strategy (mirrors the web component exactly):
//   • user lookup (name/email) → direct `public.users` selects (RLS is not yet
//     enabled on that table — see supabase-rls-client-tables.sql "users — NEEDS
//     A CODE CHANGE FIRST" gate — so the anon key can still read id/name/email).
//   • friendship mutations (list/send/accept/decline/remove) → the SECURITY
//     DEFINER RPCs from supabase-friends-migration.sql: list_friends,
//     list_friend_requests, send_friend_request, respond_friend_request,
//     remove_friend. `public.friendships` itself has RLS enabled, but every
//     access goes through these RPCs (granted to anon), so that's fine.
//   • local cache → AsyncStorage (RN's localStorage equivalent) keyed by
//     userId, so the list paints instantly on re-mount while the network
//     request is in flight.
//
// Writes are optimistic-but-safe: local state updates immediately, the
// Supabase write fires after, and a failure rolls the optimistic change back
// (or surfaces an inline message) instead of throwing.

import { useState, useCallback, useEffect, useRef } from "react";
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Search, Check } from "lucide-react-native";
import { supabase } from "../services/supabase";

// ── tokens.css equivalents (mirrors identity.tsx / leaderboard.tsx) ──────────
const C = {
  textPrimary:   "#F5F5F5",
  textSecondary: "rgba(255,255,255,0.45)",
  textDim:       "rgba(255,255,255,0.35)",
  surface:       "rgba(255,255,255,0.05)",
  border:        "rgba(255,255,255,0.08)",
  gold:          "#C49A3C",
  radiusCard:    16,
};

// ── types ──────────────────────────────────────────────────────────────────

type Profile = { id: string; name?: string | null; email?: string | null };
type Friend = { id: string; name?: string | null; email?: string | null; friends_since?: string | null };
type FriendRequest = {
  friendship_id: string;
  other_user_id: string;
  direction: "incoming" | "outgoing";
  requested_at: string;
};
type Relationship = "self" | "friend" | "pending" | "incoming" | "none";
type LoadState = "warm" | "live" | "error";

type CachedData = {
  friends: Friend[];
  requests: FriendRequest[];
  profiles: Record<string, Profile>;
};

// ── data layer — same tables/RPCs as src/api/friends.ts ──────────────────────

async function findUserByEmail(email: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from("users")
    .select("id, name, email")
    .ilike("email", email.trim())
    .maybeSingle();
  if (error) throw error;
  return data as Profile | null;
}

async function searchUsersByName(query: string): Promise<Profile[]> {
  const { data, error } = await supabase
    .from("users")
    .select("id, name, email")
    .ilike("name", `%${query.trim()}%`)
    .limit(8);
  if (error) throw error;
  return (data ?? []) as Profile[];
}

async function getUserProfiles(ids: string[]): Promise<Record<string, Profile>> {
  if (!ids.length) return {};
  const { data, error } = await supabase
    .from("users")
    .select("id, name, email")
    .in("id", ids);
  if (error) throw error;
  const out: Record<string, Profile> = {};
  for (const u of (data ?? []) as Profile[]) out[u.id] = u;
  return out;
}

async function listFriends(userId: string): Promise<{ friend_id: string; friends_since: string }[]> {
  const { data, error } = await supabase.rpc("list_friends", { p_user: userId });
  if (error) throw error;
  return data ?? [];
}

async function listFriendRequests(userId: string): Promise<FriendRequest[]> {
  const { data, error } = await supabase.rpc("list_friend_requests", { p_user: userId });
  if (error) throw error;
  return data ?? [];
}

async function sendFriendRequest(requesterId: string, addresseeId: string): Promise<string> {
  const { data, error } = await supabase.rpc("send_friend_request", {
    p_requester: requesterId,
    p_addressee: addresseeId,
  });
  if (error) throw error;
  return data as string;
}

async function respondFriendRequest(userId: string, otherId: string, accept: boolean): Promise<string> {
  const { data, error } = await supabase.rpc("respond_friend_request", {
    p_user: userId,
    p_other: otherId,
    p_accept: accept,
  });
  if (error) throw error;
  return data as string;
}

async function removeFriendRpc(userId: string, otherId: string): Promise<void> {
  const { error } = await supabase.rpc("remove_friend", { p_user: userId, p_other: otherId });
  if (error) throw error;
}

/** Fire-and-forget insert — mirrors src/api/notifications.ts createNotification.
 *  Notifications RLS status is unresolved in prod (see supabase-rls-client-tables.sql
 *  TIER A), same caveat mobile/components/NotificationPanel.tsx already accepts. */
async function createNotification(
  userId: string,
  type: "friend_request" | "request_accepted",
  opts: { title?: string; data?: Record<string, unknown> } = {}
): Promise<void> {
  const { title = null, data = null } = opts;
  await supabase.from("notifications").insert({ user_id: userId, type, title, data });
}

// ── local cache (AsyncStorage — RN equivalent of the web's localStorage cache) ─

function cacheKey(userId: string) { return `fschool_friends_cache_${userId}`; }

async function readLocal(userId: string): Promise<CachedData | null> {
  try {
    const raw = await AsyncStorage.getItem(cacheKey(userId));
    if (!raw) return null;
    return JSON.parse(raw) as CachedData;
  } catch { return null; }
}

async function writeLocal(userId: string, data: CachedData): Promise<void> {
  try {
    await AsyncStorage.setItem(cacheKey(userId), JSON.stringify({ ...data, cachedAt: new Date().toISOString() }));
  } catch { /* quota / unavailable — non-fatal */ }
}

// ── Avatar — same hashed-hue initials circle as the web version ──────────────

function avatarBg(name: string | null | undefined): string {
  const n = name || "?";
  let h = 0;
  for (const c of n) h = (h * 31 + c.charCodeAt(0)) | 0;
  return `hsl(${Math.abs(h) % 360}, 22%, 28%)`;
}

function avatarInitials(name: string | null | undefined): string {
  return (name || "?").split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();
}

function Avatar({ name, size = 32 }: { name?: string | null; size?: number }) {
  return (
    <View style={[
      styles.avatar,
      { width: size, height: size, borderRadius: size / 2, backgroundColor: avatarBg(name) },
    ]}>
      <Text style={{ fontSize: size * 0.38, fontFamily: "Inter_600SemiBold", color: "rgba(255,255,255,0.75)", letterSpacing: 0.5 }}>
        {avatarInitials(name)}
      </Text>
    </View>
  );
}

// ── FriendsSection ─────────────────────────────────────────────────────────

export default function FriendsSection({ userId, ownName }: { userId: string; ownName?: string }) {
  const [friends, setFriends]         = useState<Friend[]>([]);
  const [requests, setRequests]       = useState<FriendRequest[]>([]);
  const [reqProfiles, setReqProfiles] = useState<Record<string, Profile>>({});

  const [query, setQuery]           = useState("");
  const [results, setResults]       = useState<Profile[] | null>(null); // null = not searched; [] = no matches
  const [searching, setSearching]   = useState(false);
  const [actionMsg, setActionMsg]   = useState("");
  const [inputFocus, setInputFocus] = useState(false);
  const [pendingIds, setPendingIds] = useState<Record<string, boolean>>({});

  // false = the acting userId has no public.users row — any friend write would
  // hit a foreign-key violation. Starts true to avoid a flash; flipped below.
  const [accountReady, setAccountReady] = useState(true);
  const [loadState, setLoadState] = useState<LoadState>("warm");

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const applyData = useCallback((data: CachedData, persist = true) => {
    setFriends(data.friends ?? []);
    setRequests(data.requests ?? []);
    setReqProfiles(data.profiles ?? {});
    if (persist) void writeLocal(userId, data);
  }, [userId]);

  const load = useCallback(async () => {
    // 1. Paint cached data immediately.
    const cached = await readLocal(userId);
    if (cached) applyData(cached, false);

    // 2. Fetch live from Supabase.
    try {
      const [friendRows, reqRows] = await Promise.all([
        listFriends(userId),
        listFriendRequests(userId),
      ]);

      const allIds = [
        ...friendRows.map(r => r.friend_id),
        ...reqRows.map(r => r.other_user_id),
      ];
      const profiles = await getUserProfiles([...new Set(allIds)]);

      const hydratedFriends: Friend[] = friendRows.map(r => ({
        ...(profiles[r.friend_id] ?? {}),
        id: r.friend_id,
        friends_since: r.friends_since,
      }));

      applyData({ friends: hydratedFriends, requests: reqRows, profiles });
      setLoadState("live");
    } catch (e: any) {
      console.warn("[FriendsSection] load error:", e?.message);
      setLoadState(cached ? "warm" : "error"); // keep showing cache on error
    }
  }, [userId, applyData]);

  useEffect(() => { void load(); }, [load]);

  // Confirm the acting user actually exists in public.users — a client-only
  // uid has no row, so friend writes would fail the FK constraint.
  useEffect(() => {
    let alive = true;
    getUserProfiles([userId])
      .then(profs => { if (alive) setAccountReady(Boolean(profs[userId])); })
      .catch(() => { /* network issue — stay optimistic */ });
    return () => { alive = false; };
  }, [userId]);

  // ── Live search — fires 350ms after typing stops ──────────────────────────

  const runSearch = useCallback(async (q: string) => {
    setSearching(true);
    try {
      const found = q.includes("@")
        ? await findUserByEmail(q).then(u => (u ? [u] : []))
        : await searchUsersByName(q);
      setResults(found.filter(u => u.id !== userId));
    } catch (e: any) {
      console.warn("[FriendsSection] search error:", e?.message);
      setResults([]);
    }
    setSearching(false);
  }, [userId]);

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const q = query.trim();
    if (q.length === 0) { setResults(null); return; }
    if (q.length < 2) return; // wait for at least 2 chars
    if (q.includes("@") && q.split("@")[1].length < 1) return; // wait for a char after @

    searchTimer.current = setTimeout(() => { void runSearch(q); }, 350);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [query, runSearch]);

  async function handleSearchSubmit() {
    const q = query.trim();
    if (!q) { setResults(null); return; }
    setActionMsg("");
    await runSearch(q);
  }

  function relationshipFor(id: string): Relationship {
    if (id === userId) return "self";
    if (friends.some(f => f.id === id)) return "friend";
    if (pendingIds[id]) return "pending";
    const req = requests.find(r => r.other_user_id === id);
    if (req?.direction === "outgoing") return "pending";
    if (req?.direction === "incoming") return "incoming";
    return "none";
  }

  // ── Add (send request) ──────────────────────────────────────────────────

  const NOT_SET_UP_MSG = "Your account isn't fully set up yet — log out and back in to add friends.";

  async function handleSendRequest(target: Profile) {
    if (!accountReady) { setActionMsg(NOT_SET_UP_MSG); return; }
    setPendingIds(p => ({ ...p, [target.id]: true })); // optimistic
    setActionMsg("");
    try {
      await sendFriendRequest(userId, target.id);
      setActionMsg(`Request sent to ${target.name || target.email || "user"}.`);
      // Notify the recipient — non-blocking, fire-and-forget.
      createNotification(target.id, "friend_request", {
        title: `${ownName || "Someone"} sent you a friend request`,
        data: { from_user_id: userId, from_name: ownName ?? null },
      }).catch(() => {});
      await load(); // refresh friends + requests from Supabase
    } catch (e: any) {
      setPendingIds(p => { const n = { ...p }; delete n[target.id]; return n; }); // rollback
      // FK violation (code 23503) = the acting uid has no public.users row.
      if (e?.code === "23503" || /foreign key|violates/i.test(e?.message || "")) {
        setAccountReady(false);
        setActionMsg(NOT_SET_UP_MSG);
        return;
      }
      const msg =
        e?.message?.includes("blocked")        ? "This user isn't accepting requests."
        : e?.message?.includes("already friends") ? "You're already friends."
        : e?.message?.includes("yourself")        ? "That's you!"
        : e?.message || "Couldn't send request.";
      setActionMsg(msg);
    }
  }

  // ── Accept / Decline ────────────────────────────────────────────────────

  async function handleRespond(otherId: string, accept: boolean) {
    // Optimistic: drop the request from local state immediately.
    const prevRequests = requests;
    setRequests(prev => prev.filter(r => r.other_user_id !== otherId));
    try {
      await respondFriendRequest(userId, otherId, accept);
      if (accept) {
        createNotification(otherId, "request_accepted", {
          title: `${ownName || "Someone"} accepted your friend request`,
          data: { from_user_id: userId, from_name: ownName ?? null },
        }).catch(() => {});
      }
      await load();
    } catch (e: any) {
      console.warn("[FriendsSection] respond error:", e?.message);
      setRequests(prevRequests); // rollback
      setActionMsg("Couldn't respond to that request.");
    }
  }

  // ── Remove ───────────────────────────────────────────────────────────────

  async function handleRemove(friendId: string) {
    const prevFriends = friends;
    const next = friends.filter(f => f.id !== friendId);
    setFriends(next); // optimistic
    void writeLocal(userId, { friends: next, requests, profiles: reqProfiles });
    try {
      await removeFriendRpc(userId, friendId);
    } catch (e: any) {
      console.warn("[FriendsSection] remove error:", e?.message);
      setFriends(prevFriends); // rollback
      await load();
    }
  }

  // ── Derived ──────────────────────────────────────────────────────────────

  const incoming = requests.filter(r => r.direction === "incoming");
  const outgoing = requests.filter(r => r.direction === "outgoing");

  function fmtSince(iso?: string | null) {
    if (!iso) return "";
    return new Date(iso).toLocaleDateString("en-US", { month: "short", year: "numeric" });
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <View style={{ marginBottom: 32 }}>
      <Text style={styles.label}>Friends</Text>

      {/* ── Find & add people (by name or email) ─────────────────────── */}
      <View style={[styles.card, { marginBottom: 12 }]}>
        <Text style={styles.cardSubtitle}>Find people by name or email</Text>

        <View style={{ position: "relative", justifyContent: "center" }}>
          <View style={styles.searchIcon} pointerEvents="none">
            <Search size={15} color="rgba(255,255,255,0.4)" />
          </View>
          <TextInput
            placeholder="Search by name or email…"
            placeholderTextColor="rgba(255,255,255,0.3)"
            value={query}
            onChangeText={t => { setQuery(t); if (actionMsg) setActionMsg(""); }}
            onSubmitEditing={handleSearchSubmit}
            returnKeyType="search"
            autoCapitalize="none"
            autoCorrect={false}
            onFocus={() => setInputFocus(true)}
            onBlur={() => setInputFocus(false)}
            style={[styles.searchInput, inputFocus && styles.searchInputFocused]}
          />
          {searching && (
            <View style={styles.searchSpinner}>
              <ActivityIndicator size="small" color={C.textDim} />
            </View>
          )}
        </View>

        {!accountReady && (
          <Text style={styles.warnText}>
            Your account isn&rsquo;t fully set up yet — log in to add friends.
          </Text>
        )}

        {actionMsg ? <Text style={styles.actionMsg}>{actionMsg}</Text> : null}

        {/* Results */}
        {results !== null && (
          results.length === 0 ? (
            <Text style={styles.emptyResults}>
              No one found{query.includes("@") ? " with that email" : ""}. Try a different spelling.
            </Text>
          ) : (
            <View style={{ marginTop: 8 }}>
              {results.map((u, i) => {
                const rel = relationshipFor(u.id);
                return (
                  <View key={u.id} style={[styles.row, i < results.length - 1 && styles.rowBorder]}>
                    <Avatar name={u.name} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.rowName} numberOfLines={1}>{u.name || "Unknown"}</Text>
                      <Text style={styles.rowEmail} numberOfLines={1}>
                        {u.email || u.id.slice(0, 8) + "…"}
                      </Text>
                    </View>
                    {rel === "friend" && (
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                        <Check size={12} color="rgba(52,199,89,0.8)" />
                        <Text style={styles.friendTag}>Friend</Text>
                      </View>
                    )}
                    {rel === "pending" && <Text style={styles.pendingTag}>Pending</Text>}
                    {rel === "incoming" && (
                      <TouchableOpacity onPress={() => handleRespond(u.id, true)} style={styles.acceptBtn} activeOpacity={0.7}>
                        <Text style={styles.acceptBtnText}>Accept</Text>
                      </TouchableOpacity>
                    )}
                    {rel === "none" && (
                      <TouchableOpacity
                        onPress={() => handleSendRequest(u)}
                        disabled={!accountReady}
                        style={[styles.addBtn, !accountReady && { opacity: 0.5 }]}
                        activeOpacity={0.7}
                      >
                        <Text style={styles.addBtnText}>Add</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                );
              })}
            </View>
          )
        )}
      </View>

      {/* ── Incoming requests ─────────────────────────────────────────── */}
      {incoming.length > 0 && (
        <View style={[styles.card, { marginBottom: 12 }]}>
          <Text style={styles.subLabel}>Requests · {incoming.length}</Text>
          {incoming.map((r, i) => {
            const p = reqProfiles[r.other_user_id] ?? {};
            return (
              <View key={r.friendship_id} style={[styles.row, i < incoming.length - 1 && styles.rowBorder]}>
                <Avatar name={p.name} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.rowName} numberOfLines={1}>{p.name || "Unknown"}</Text>
                  <Text style={styles.rowEmail} numberOfLines={1}>
                    {p.email || r.other_user_id.slice(0, 8) + "…"}
                  </Text>
                </View>
                <TouchableOpacity onPress={() => handleRespond(r.other_user_id, true)} style={styles.acceptBtn} activeOpacity={0.7}>
                  <Text style={styles.acceptBtnText}>Accept</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => handleRespond(r.other_user_id, false)} style={styles.declineBtn} activeOpacity={0.7}>
                  <Text style={styles.declineBtnText}>Decline</Text>
                </TouchableOpacity>
              </View>
            );
          })}
        </View>
      )}

      {/* ── Outgoing pending ──────────────────────────────────────────── */}
      {outgoing.length > 0 && (
        <View style={[styles.card, { marginBottom: 12 }]}>
          <Text style={styles.subLabel}>Sent · {outgoing.length}</Text>
          {outgoing.map((r, i) => {
            const p = reqProfiles[r.other_user_id] ?? {};
            return (
              <View key={r.friendship_id} style={[styles.row, i < outgoing.length - 1 && styles.rowBorder]}>
                <Avatar name={p.name} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.rowName} numberOfLines={1}>{p.name || "Unknown"}</Text>
                  <Text style={styles.rowEmail}>Pending</Text>
                </View>
                <TouchableOpacity onPress={() => handleRemove(r.other_user_id)} style={styles.declineBtn} activeOpacity={0.7}>
                  <Text style={styles.declineBtnText}>Cancel</Text>
                </TouchableOpacity>
              </View>
            );
          })}
        </View>
      )}

      {/* ── Friends list ──────────────────────────────────────────────── */}
      {loadState === "error" && friends.length === 0 ? (
        <Text style={styles.errorText}>Couldn&rsquo;t load friends. Check your connection.</Text>
      ) : friends.length === 0 && incoming.length === 0 ? (
        <Text style={styles.emptyText}>
          {loadState === "warm" ? "Loading…" : "No friends yet — add someone above."}
        </Text>
      ) : friends.length > 0 ? (
        <View style={styles.card}>
          <Text style={styles.subLabel}>Friends · {friends.length}</Text>
          {friends.map((f, i) => (
            <View key={f.id} style={[styles.row, i < friends.length - 1 && styles.rowBorder]}>
              <Avatar name={f.name} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.rowName} numberOfLines={1}>{f.name || "Unknown"}</Text>
                <Text style={styles.rowEmail} numberOfLines={1}>
                  {[f.email, f.friends_since && `since ${fmtSince(f.friends_since)}`].filter(Boolean).join(" · ")}
                </Text>
              </View>
              <TouchableOpacity onPress={() => handleRemove(f.id)} hitSlop={8} style={styles.removeBtn}>
                <Text style={styles.removeBtnText}>×</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

// ── styles ────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  label: {
    fontFamily: "Inter_400Regular", fontSize: 11, color: C.textDim,
    letterSpacing: 2, textTransform: "uppercase", marginBottom: 12,
  },
  subLabel: {
    fontFamily: "Inter_400Regular", fontSize: 11, color: C.textDim,
    letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 2,
  },
  card: {
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
    borderRadius: C.radiusCard, paddingVertical: 14, paddingHorizontal: 16,
  },
  cardSubtitle: { fontFamily: "Inter_400Regular", fontSize: 12, color: C.textSecondary, marginBottom: 10 },

  searchIcon: { position: "absolute", left: 14, zIndex: 1 },
  searchInput: {
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1.5, borderColor: "rgba(255,255,255,0.10)",
    borderRadius: 12, paddingVertical: 13, paddingLeft: 40, paddingRight: 44,
    color: C.textPrimary, fontSize: 14, fontFamily: "Inter_400Regular",
  },
  searchInputFocused: { borderColor: "rgba(196,154,60,0.55)" },
  searchSpinner: { position: "absolute", right: 14 },

  warnText:  { fontFamily: "Inter_400Regular", fontSize: 11, marginTop: 8, color: "rgba(255,180,90,0.85)" },
  actionMsg: { fontFamily: "Inter_400Regular", fontSize: 12, marginTop: 8, color: "rgba(255,255,255,0.6)" },
  emptyResults: { fontFamily: "Inter_400Regular", fontSize: 12, color: C.textDim, marginTop: 10 },

  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.05)" },

  avatar: { alignItems: "center", justifyContent: "center", flexShrink: 0 },

  rowName:  { fontFamily: "Inter_500Medium", fontSize: 13, color: C.textPrimary },
  rowEmail: { fontFamily: "Inter_400Regular", fontSize: 11, color: C.textSecondary, marginTop: 1 },

  friendTag:  { fontFamily: "Inter_500Medium", fontSize: 12, color: "rgba(52,199,89,0.8)" },
  pendingTag: { fontFamily: "Inter_400Regular", fontSize: 12, color: C.textDim },

  acceptBtn: {
    backgroundColor: "rgba(52,199,89,0.12)", borderWidth: 1, borderColor: "rgba(52,199,89,0.25)",
    borderRadius: 8, paddingVertical: 5, paddingHorizontal: 12,
  },
  acceptBtnText: { fontFamily: "Inter_400Regular", fontSize: 12, color: "rgba(52,199,89,0.9)" },

  declineBtn: {
    backgroundColor: "transparent", borderWidth: 1, borderColor: "rgba(255,255,255,0.1)",
    borderRadius: 8, paddingVertical: 5, paddingHorizontal: 10,
  },
  declineBtnText: { fontFamily: "Inter_400Regular", fontSize: 12, color: C.textDim },

  addBtn: {
    backgroundColor: "rgba(255,255,255,0.08)", borderWidth: 1, borderColor: "rgba(255,255,255,0.12)",
    borderRadius: 8, paddingVertical: 5, paddingHorizontal: 12,
  },
  addBtnText: { fontFamily: "Inter_500Medium", fontSize: 12, color: C.textPrimary },

  removeBtn: { paddingVertical: 4, paddingHorizontal: 8 },
  removeBtnText: { fontSize: 16, lineHeight: 16, color: "rgba(255,255,255,0.18)" },

  errorText: { fontFamily: "Inter_400Regular", fontSize: 13, color: "rgba(255,100,90,0.7)", paddingVertical: 4 },
  emptyText: { fontFamily: "Inter_400Regular", fontSize: 13, color: C.textDim, paddingVertical: 4 },
});

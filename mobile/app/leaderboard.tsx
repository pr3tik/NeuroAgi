// leaderboard.tsx — mobile port of src/pages/Leaderboard.tsx.
// The web page POSTs to /api/leaderboard, which reads the whole opted-in population
// (users + leaderboard tables) and ranks server-side. Mobile reproduces the exact same
// two Supabase reads directly (same columns, same 2000-row cap) and reuses the same
// pure ranking logic (scopeFilter / rankRows / findUserRank from src/lib/leaderboard.ts)
// client-side, so every tab/sort combination yields the same board as the web.

import { useState, useEffect, useMemo, useCallback } from "react";
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Svg, { Circle } from "react-native-svg";
import { Trophy } from "lucide-react-native";
import ScreenWrapper from "../components/ScreenWrapper";
import Glass from "../components/Glass";
import { Skeleton, EmptyState, ErrorState, useRefresh, ThemedRefreshControl } from "../components/States";
import { supabase } from "../services/supabase";
import { useUserId } from "../context/AuthContext";
import { usePageTheme, ThemeColors } from "../constants/appTheme";

const PAGE = "leaderboard";

const MAX_POPULATION = 2000; // same cap as api/leaderboard.ts
const TOP_N = 50;            // same visible top-N as the web page

// ── bespoke local tokens (not part of the shared theme palette) ───────────────
const LOCAL = {
  radiusCard: 16,                    // --radius-card
  teal:       "rgba(90,165,116,0.9)",
};

// ── constants mirrored from the web page ─────────────────────────────────────
const TIER_COLORS: Record<string, { text: string; bg: string; border: string }> = {
  "Brain Owner": { text: "rgba(196,154,60,0.9)",  bg: "rgba(196,154,60,0.1)",  border: "rgba(196,154,60,0.25)" },
  Mastermind:    { text: "rgba(175,130,255,0.85)", bg: "rgba(175,130,255,0.1)", border: "rgba(175,130,255,0.25)" },
  Scholar:       { text: "rgba(100,220,180,0.85)", bg: "rgba(100,220,180,0.1)", border: "rgba(100,220,180,0.25)" },
};

const TABS  = ["University", "City", "Country", "Global"] as const;
const SORTS = ["Tokens", "GPA", "Streak", "Study Time"] as const;
type Tab  = typeof TABS[number];
type Sort = typeof SORTS[number];

// sort pill → metric field on a row (tokens live on `points`, merged from `leaderboard`)
const METRIC: Record<Sort, string> = { Tokens: "points", GPA: "gpa", Streak: "streak", "Study Time": "study_time" };

const FMT: Record<Sort, (v: number | null | undefined) => string> = {
  GPA:          v => v != null ? Number(v).toFixed(2) : "—",
  Streak:       v => v != null ? `${v} day${v !== 1 ? "s" : ""}` : "—",
  "Study Time": v => v != null ? `${v} hrs` : "—",
  Tokens:       v => v != null ? `${v} pts` : "—",
};

const TIER_ORDER = ["Basic", "Scholar", "Mastermind", "Brain Owner"];
const TIER_MIN: Record<string, number> = { Basic: 0, Scholar: 100, Mastermind: 500, "Brain Owner": 2000 };

function tierProgress(points: number, tier: string) {
  const idx      = TIER_ORDER.indexOf(tier ?? "Basic");
  const nextName = TIER_ORDER[idx + 1];
  if (!nextName) return { pct: 1, label: "Max tier reached", nextTier: null as string | null };
  const min = TIER_MIN[tier] ?? 0;
  const max = TIER_MIN[nextName];
  const pct = Math.min(Math.max((points - min) / (max - min), 0), 1);
  return { pct, label: `${points - min} / ${max - min} to ${nextName}`, nextTier: nextName };
}

type Row = {
  userId: string;
  name: string;
  school: string | null;
  city: string | null;
  country: string | null;
  points: number | null;
  tier: string;
  study_time: number | null;
  streak: number | null;
  gpa: number | null;
};
type Ranked = Row & { rank: number; value: number };

const TAB_FILTER_FIELD: Record<Tab, keyof Row | null> = {
  University: "school", City: "city", Country: "country", Global: null,
};
const TAB_SUBLABEL: Record<Tab, (r: Row) => string | null> = {
  University: r => r.city ?? r.country ?? null,
  City:       r => r.school ?? null,
  Country:    r => r.city ?? null,
  Global:     r => r.school ?? null,
};

// ── ranking logic (mirrors src/lib/leaderboard.ts exactly) ───────────────────
function scopeFilter(rows: Row[], tab: Tab, scopeValue: string | null): Row[] {
  const field = TAB_FILTER_FIELD[tab];
  if (!field || !scopeValue) return rows;
  return rows.filter(r => r[field] != null && r[field] === scopeValue);
}

function rankRows(rows: Row[], metric: string): Ranked[] {
  const scored = rows
    .filter(r => (r as any)[metric] != null && !Number.isNaN(Number((r as any)[metric])))
    .map(r => ({ ...r, value: Number((r as any)[metric]) }))
    .sort((a, b) => b.value - a.value);

  let prevValue: number | null = null;
  let prevRank = 0;
  return scored.map((r, i) => {
    const rank = (prevValue !== null && r.value === prevValue) ? prevRank : i + 1;
    prevValue = r.value;
    prevRank = rank;
    return { ...r, rank };
  });
}

// ── medal + avatar palettes (verbatim from the web page) ─────────────────────
const MEDAL = [
  { ring: "rgba(90,165,116,0.65)",   bg: "rgba(90,165,116,0.12)",   text: "rgba(90,165,116,0.95)",  rowBg: "rgba(90,165,116,0.06)",   rowBorder: "rgba(90,165,116,0.22)" },
  { ring: "rgba(185,200,215,0.55)", bg: "rgba(185,200,215,0.08)", text: "rgba(195,210,225,0.9)", rowBg: "rgba(255,255,255,0.03)", rowBorder: "rgba(185,200,215,0.14)" },
  { ring: "rgba(205,165,75,0.55)",  bg: "rgba(205,165,75,0.1)",   text: "rgba(215,175,85,0.9)",  rowBg: "rgba(205,165,75,0.04)",  rowBorder: "rgba(205,165,75,0.16)" },
];

const AVATAR_HUE = [
  "rgba(90,165,116,0.65)",
  "rgba(100,150,255,0.65)",
  "rgba(255,130,100,0.65)",
  "rgba(175,130,255,0.65)",
  "rgba(70,200,130,0.65)",
  "rgba(255,175,50,0.65)",
];
function avatarHue(name = "") {
  const n = [...name].reduce((a, c) => a + c.charCodeAt(0), 0);
  return AVATAR_HUE[n % AVATAR_HUE.length];
}

// ── sub-components ────────────────────────────────────────────────────────────

function TierBadge({ tier }: { tier?: string | null }) {
  const C = usePageTheme(PAGE);
  const styles = useMemo(() => makeStyles(C), [C]);
  const c = tier ? TIER_COLORS[tier] : null;
  if (!c) return null;
  return (
    <View style={[styles.tierBadge, { backgroundColor: c.bg, borderColor: c.border }]}>
      <Text style={[styles.tierBadgeText, { color: c.text }]}>{tier}</Text>
    </View>
  );
}

// SVG progress ring around the avatar (Tokens sort only)
function TierRing({ points, tier, size }: { points: number | null; tier: string | null; size: number }) {
  const C = usePageTheme(PAGE);
  const { pct } = tierProgress(points ?? 0, tier ?? "Basic");
  const r    = (size - 5) / 2;
  const circ = 2 * Math.PI * r;
  const dash = pct * circ;
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={StyleSheet.absoluteFill} pointerEvents="none">
      <Circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(196,154,60,0.12)" strokeWidth={2.5} />
      <Circle
        cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke={C.gold} strokeWidth={2.5}
        strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
        rotation={-90} originX={size / 2} originY={size / 2}
      />
    </Svg>
  );
}

function BoardRow({ row, rank, isMe, sort, sublabel, maxVal, myTier }: {
  row: Ranked; rank: number; isMe: boolean; sort: Sort;
  sublabel: string | null; maxVal: number; myTier: string | null;
}) {
  const C = usePageTheme(PAGE);
  const styles = useMemo(() => makeStyles(C), [C]);
  const isTop3  = rank <= 3;
  const medal   = isTop3 ? MEDAL[rank - 1] : null;
  const hue     = avatarHue(row.name ?? "");
  const initial = (row.name ?? "?")[0].toUpperCase();
  const val     = row.value;
  const barPct  = maxVal > 0 && val != null ? Math.max(8, (val / maxVal) * 100) : 0;
  const avSize  = isTop3 ? 36 : 30;

  const rowBg     = isMe ? "rgba(90,165,116,0.07)" : medal ? medal.rowBg : C.surface;
  const rowBorder = isMe ? "rgba(90,165,116,0.3)"  : medal ? medal.rowBorder : C.border;

  return (
    <View style={[
      styles.row,
      {
        gap: isTop3 ? 12 : 10,
        backgroundColor: rowBg,
        borderColor: rowBorder,
        paddingVertical: isTop3 ? 18 : 13,
        paddingHorizontal: isTop3 ? 16 : 14,
        opacity: isMe ? 1 : (isTop3 ? 0.92 : 0.72),
      },
    ]}>
      {/* Ambient glow on rank 1 */}
      {rank === 1 && <View style={styles.rankOneGlow} />}

      {/* Rank indicator */}
      {isTop3 && medal ? (
        <View style={[styles.medalCircle, { backgroundColor: medal.bg, borderColor: medal.ring }]}>
          <Text style={[styles.medalText, { color: medal.text }]}>{rank}</Text>
        </View>
      ) : (
        <Text style={styles.rankText}>{rank}</Text>
      )}

      {/* Avatar with initial + optional tier ring */}
      <View style={{ position: "relative", width: avSize, height: avSize, flexShrink: 0 }}>
        {sort === "Tokens" && <TierRing points={row.value} tier={row.tier} size={avSize} />}
        <LinearGradient
          colors={[hue, "rgba(0,0,0,0.25)"]}
          start={{ x: 0.2, y: 0.2 }}
          end={{ x: 1, y: 1 }}
          style={[
            styles.avatar,
            { width: avSize, height: avSize, borderRadius: avSize / 2 },
            sort !== "Tokens" && { borderWidth: 1, borderColor: hue },
          ]}
        >
          <Text style={[styles.avatarInitial, { fontSize: isTop3 ? 14 : 11 }]}>{initial}</Text>
        </LinearGradient>
      </View>

      {/* Name + sublabel */}
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: "row", alignItems: "center", minWidth: 0 }}>
          <Text
            numberOfLines={1}
            style={[
              styles.rowName,
              {
                color: isMe ? "rgba(90,165,116,0.95)" : C.textPrimary,
                fontSize: isTop3 ? 15 : 13,
                fontFamily: isTop3 ? "Inter_600SemiBold" : "Inter_500Medium",
                flexShrink: 1,
              },
            ]}
          >
            {row.name ?? "Anonymous"}{isMe ? " · You" : ""}
          </Text>
          {(sort === "Tokens" && row.tier) ? <TierBadge tier={row.tier} /> : null}
          {(sort !== "Tokens" && isMe && myTier) ? <TierBadge tier={myTier} /> : null}
        </View>
        {sublabel ? (
          <Text numberOfLines={1} style={styles.rowSublabel}>{sublabel}</Text>
        ) : null}
      </View>

      {/* Stat value + relative bar */}
      <View style={{ alignItems: "flex-end", flexShrink: 0, gap: 4 }}>
        <Text style={[
          styles.rowValue,
          {
            fontSize: isTop3 ? 16 : 14,
            color: isMe ? (sort === "Tokens" ? C.gold : LOCAL.teal) : C.textPrimary,
          },
        ]}>
          {FMT[sort](row.value)}
        </Text>
        {val != null && (
          <View style={styles.barTrack}>
            <View style={[
              styles.barFill,
              {
                width: `${barPct}%`,
                backgroundColor: isMe
                  ? "rgba(90,165,116,0.8)"
                  : rank === 1
                  ? "rgba(90,165,116,0.5)"
                  : C.scheme === "light" ? C.accent : "rgba(255,255,255,0.28)",
              },
            ]} />
          </View>
        )}
      </View>
    </View>
  );
}

// ── main screen ───────────────────────────────────────────────────────────────

export default function LeaderboardScreen() {
  const C = usePageTheme(PAGE);
  const styles = useMemo(() => makeStyles(C), [C]);
  const userId = useUserId();
  const [tab,  setTab]  = useState<Tab>("University");
  const [sort, setSort] = useState<Sort>("Tokens");

  const [rows,    setRows]    = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  // Hoisted so pull-to-refresh re-runs the exact same reads.
  const reload = useCallback(async () => {
    try {
      // Same reads as api/leaderboard.ts: full population + tokens table, merged by user_id.
      const [usersRes, lbRes] = await Promise.all([
        supabase
          .from("users")
          .select("id, name, school, city, country, continent, leaderboard_opt_in, gpa, streak, study_time")
          .limit(MAX_POPULATION),
        supabase
          .from("leaderboard")
          .select("user_id, points, tier")
          .limit(MAX_POPULATION),
      ]);

      if (usersRes.error) {
        setError(usersRes.error.message);
        return;
      }

      const pointsMap: Record<string, number> = {};
      const tierMap: Record<string, string> = {};
      (lbRes.data ?? []).forEach((r: any) => {
        pointsMap[r.user_id] = r.points ?? 0;
        tierMap[r.user_id]   = r.tier ?? "Basic";
      });

      setRows((usersRes.data ?? []).map((u: any) => ({
        userId:     u.id,
        // Opted-out students still appear (ranking integrity) but never by name.
        name:       u.leaderboard_opt_in === false ? "Anonymous Scholar" : (u.name ?? "Anonymous"),
        school:     u.school ?? null,
        city:       u.city ?? null,
        country:    u.country ?? null,
        points:     pointsMap[u.id] ?? null,
        tier:       tierMap[u.id] ?? "Basic",
        study_time: u.study_time ?? null,
        streak:     u.streak ?? null,
        gpa:        u.gpa ?? null,
      })));
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? "network");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const { refreshing, onRefresh } = useRefresh(reload);

  // My row (for scope derivation, "You" pinned card, and tier badge on non-token sorts)
  const meRow = useMemo(() => rows.find(r => r.userId === userId) ?? null, [rows, userId]);

  const scopeValue = useMemo(() => {
    if (tab === "Global") return null;
    const field = TAB_FILTER_FIELD[tab]!;
    return (meRow?.[field] as string | null) ?? null;
  }, [tab, meRow]);

  const ranked = useMemo(
    () => rankRows(scopeFilter(rows, tab, scopeValue), METRIC[sort]),
    [rows, tab, scopeValue, sort],
  );
  const visible = ranked.slice(0, TOP_N);
  const maxVal  = Math.max(visible[0]?.value ?? 1, 1);

  const me        = ranked.find(r => r.userId === userId) ?? null;
  const meVisible = me != null && visible.some(r => r.userId === userId);

  const scopeLabel = (tab === "Global" || !scopeValue) ? "Global" : `${tab}: ${scopeValue}`;
  const myPoints   = meRow?.points ?? null;
  const myTier     = meRow?.tier ?? null;
  const progress   = myPoints != null ? tierProgress(myPoints, myTier ?? "Basic") : null;

  return (
    <ScreenWrapper page="leaderboard">
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 8 }}
        refreshControl={<ThemedRefreshControl colors={C} refreshing={refreshing} onRefresh={onRefresh} />}
      >

        {/* ── Header ── */}
        <View style={{ marginBottom: 24 }}>
          <Text style={styles.title}>Leaderboard</Text>
          <Text style={styles.subtitle}>
            {scopeLabel} · {visible.length} student{visible.length !== 1 ? "s" : ""}
          </Text>
        </View>

        {/* ── Scope tabs ── */}
        <Glass colors={C} radius={12} style={styles.tabsWrap}>
          {TABS.map(t => (
            <TouchableOpacity
              key={t}
              onPress={() => setTab(t)}
              style={[styles.tabBtn, tab === t && styles.tabBtnActive]}
              activeOpacity={0.7}
            >
              <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>{t}</Text>
            </TouchableOpacity>
          ))}
        </Glass>

        {/* ── Sort pills ── */}
        <View style={styles.sortRow}>
          {SORTS.map(s => (
            <TouchableOpacity
              key={s}
              onPress={() => setSort(s)}
              style={[styles.sortPill, sort === s && styles.sortPillActive]}
              activeOpacity={0.7}
            >
              <Text style={[styles.sortText, sort === s && styles.sortTextActive]}>{s}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* ── Pinned "You" card — always visible on Tokens sort ── */}
        {sort === "Tokens" && myPoints != null && (
          <View style={styles.youCard}>
            <View style={styles.youCardTop}>
              <View style={{ flexDirection: "row", alignItems: "center", flexShrink: 1 }}>
                <Text style={styles.youName} numberOfLines={1}>{meRow?.name ?? "You"}</Text>
                <TierBadge tier={myTier} />
              </View>
              <Text style={styles.youPoints}>{myPoints} pts</Text>
            </View>
            {progress?.nextTier ? (
              <>
                <View style={styles.youBarTrack}>
                  <View style={[styles.youBarFill, { width: `${progress.pct * 100}%` }]} />
                </View>
                <Text style={styles.youBarLabel}>{progress.label}</Text>
              </>
            ) : (
              <Text style={styles.youMaxTier}>Max tier</Text>
            )}
          </View>
        )}

        {/* ── Loading (skeleton rows) ── */}
        {loading && (
          <View style={{ gap: 8, marginTop: 4 }}>
            {[0, 1, 2, 3, 4, 5].map(i => (
              <Skeleton key={i} colors={C} height={56} radius={12} />
            ))}
          </View>
        )}

        {/* ── Error state ── */}
        {!loading && error && (
          <ErrorState
            colors={C}
            title="Couldn't load the leaderboard"
            onRetry={reload}
          />
        )}

        {/* ── Empty state — not enough real data for this tab ── */}
        {!loading && !error && visible.length < 3 && (
          <EmptyState
            colors={C}
            Icon={Trophy}
            title={sort === "GPA" ? "Not enough GPA data yet" : sort === "Tokens" ? "The leaderboard is warming up" : "Not enough data yet"}
            message={sort === "GPA" ? "Sync your LMS to join this board." : "Earn tokens to claim an early spot."}
          />
        )}

        {/* ── Rows ── */}
        {!loading && !error && (
          <View style={{ gap: 6 }}>
            {visible.map((row, i) => {
              const rank = i + 1;
              const el = (
                <BoardRow
                  key={row.userId}
                  row={row}
                  rank={rank}
                  isMe={row.userId === userId}
                  sort={sort}
                  sublabel={TAB_SUBLABEL[tab](row)}
                  maxVal={maxVal}
                  myTier={myTier}
                />
              );
              // Subtle divider between the podium (top 3) and the rest
              if (rank === 4 && visible.length > 3) {
                return (
                  <View key={row.userId} style={{ gap: 6 }}>
                    <View style={styles.podiumDivider} />
                    {el}
                  </View>
                );
              }
              return el;
            })}
          </View>
        )}

        {/* ── Your rank — when you're outside the visible top-N ── */}
        {!loading && !error && me && !meVisible && (
          <View style={styles.meCard}>
            <Text style={styles.meCardRank}>#{me.rank} · You</Text>
            <Text style={styles.meCardValue}>{FMT[sort](me.value)}</Text>
          </View>
        )}

      </ScrollView>
    </ScreenWrapper>
  );
}

// ── styles ────────────────────────────────────────────────────────────────────

const makeStyles = (C: ThemeColors) => StyleSheet.create({
  title:    { fontWeight: "600", fontSize: 26, color: C.textPrimary, letterSpacing: -0.3, marginBottom: 4 },
  subtitle: { fontWeight: "400", fontSize: 13, color: C.textDim },

  tabsWrap: {
    flexDirection: "row", gap: 2,
    borderRadius: 12, padding: 3, marginBottom: 10,
  },
  tabBtn: {
    flex: 1, borderRadius: 9,
    paddingVertical: 7, paddingHorizontal: 10,
    borderWidth: 1, borderColor: "transparent",
    alignItems: "center",
  },
  tabBtnActive:  { backgroundColor: C.accentSoft, borderColor: C.accentLine },
  tabText:       { fontWeight: "400", fontSize: 12, color: C.textDim },
  tabTextActive: { fontWeight: "600", color: C.textPrimary },

  sortRow: { flexDirection: "row", gap: 6, marginBottom: 20 },
  sortPill: {
    borderRadius: 20, paddingVertical: 5, paddingHorizontal: 14,
    borderWidth: 1, borderColor: C.border, backgroundColor: "transparent",
  },
  sortPillActive: { backgroundColor: "rgba(90,165,116,0.1)", borderColor: "rgba(90,165,116,0.3)" },
  sortText:       { fontWeight: "400", fontSize: 12, color: C.textDim },
  sortTextActive: { fontWeight: "600", color: LOCAL.teal },

  youCard: {
    backgroundColor: "rgba(196,154,60,0.06)",
    borderWidth: 1, borderColor: "rgba(196,154,60,0.25)",
    borderRadius: LOCAL.radiusCard,
    paddingVertical: 14, paddingHorizontal: 16, marginBottom: 14,
  },
  youCardTop:  { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  youName:     { fontWeight: "700", fontSize: 13, color: C.gold, flexShrink: 1 },
  youPoints:   { fontWeight: "700", fontSize: 18, color: C.gold, letterSpacing: -0.5 },
  youBarTrack: { height: 3, backgroundColor: "rgba(196,154,60,0.12)", borderRadius: 2, marginBottom: 5, overflow: "hidden" },
  youBarFill:  { height: "100%", backgroundColor: C.gold, borderRadius: 2 },
  youBarLabel: { fontWeight: "400", fontSize: 10, color: "rgba(196,154,60,0.5)", letterSpacing: 0.3 },
  youMaxTier:  { fontWeight: "400", fontSize: 10, color: "rgba(196,154,60,0.6)", letterSpacing: 0.5 },

  emptyCard: {
    alignItems: "center", paddingVertical: 48, paddingHorizontal: 24,
    borderRadius: LOCAL.radiusCard,
    marginBottom: 16,
  },
  emptyTitle: { fontWeight: "600", fontSize: 14, color: "rgba(196,154,60,0.6)", marginBottom: 6, textAlign: "center" },
  emptySub:   { fontWeight: "400", fontSize: 13, color: C.textDim, textAlign: "center" },

  row: {
    flexDirection: "row", alignItems: "center",
    borderWidth: 1, borderRadius: LOCAL.radiusCard,
    position: "relative", overflow: "hidden",
  },
  rankOneGlow: {
    position: "absolute", top: -28, right: -28,
    width: 100, height: 100, borderRadius: 50,
    backgroundColor: "rgba(90,165,116,0.05)",
  },
  medalCircle: {
    width: 28, height: 28, borderRadius: 14,
    borderWidth: 1.5, alignItems: "center", justifyContent: "center", flexShrink: 0,
  },
  medalText: { fontWeight: "700", fontSize: 11 },
  rankText: {
    fontWeight: "600", fontSize: 12, color: C.textDim,
    minWidth: 22, textAlign: "right", flexShrink: 0,
  },

  avatar:        { alignItems: "center", justifyContent: "center" },
  avatarInitial: { fontWeight: "700", color: "#fff" },

  rowName:     { letterSpacing: -0.2 },
  rowSublabel: { fontWeight: "400", fontSize: 11, color: C.textDim, marginTop: 2 },
  rowValue:    { fontWeight: "700", letterSpacing: -0.3 },

  barTrack: { height: 2, borderRadius: 1, backgroundColor: C.surfaceTranslucent, width: 38, overflow: "hidden" },
  barFill:  { height: "100%", borderRadius: 1 },

  podiumDivider: { height: 1, backgroundColor: C.border, marginVertical: 2 },

  meCard: {
    marginTop: 10, flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    backgroundColor: "rgba(90,165,116,0.07)",
    borderWidth: 1, borderColor: "rgba(90,165,116,0.3)",
    borderRadius: LOCAL.radiusCard,
    paddingVertical: 13, paddingHorizontal: 14,
  },
  meCardRank:  { fontWeight: "600", fontSize: 13, color: "rgba(90,165,116,0.95)" },
  meCardValue: { fontWeight: "700", fontSize: 14, color: LOCAL.teal },

  tierBadge: {
    paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: 8, borderWidth: 1,
    marginLeft: 5, flexShrink: 0,
  },
  tierBadgeText: { fontWeight: "600", fontSize: 9, letterSpacing: 0.5 },
});

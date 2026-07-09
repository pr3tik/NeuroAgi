// Leaderboard.jsx — Geographic hierarchy: University → City → Country → Continent → Global
// Placeholder students are stored here and filtered client-side by the user's location.
// Live data comes from Supabase (leaderboard_opt_in = true).

/* Hallmark · macrostructure: App Shell · tone: luxury-minimal · anchor hue: teal
 * pre-emit critique: P5 H5 E5 S4 R5 V4 */

import { useState, useEffect } from "react";
import { useApp }              from "../context/AppContext";

const TIER_COLORS = {
  "Brain Owner": "rgba(196,154,60,0.9)",
  Mastermind:    "rgba(175,130,255,0.85)",
  Scholar:       "rgba(100,220,180,0.85)",
};
function TierBadge({ tier }) {
  const color = TIER_COLORS[tier];
  if (!color) return null;
  return (
    <span style={{
      fontSize: "9px", fontWeight: "600", padding: "2px 6px",
      borderRadius: "8px", letterSpacing: "0.5px",
      background: `${color.replace("0.9", "0.1").replace("0.85", "0.1")}`,
      border: `1px solid ${color.replace("0.9", "0.25").replace("0.85", "0.25")}`,
      color, marginLeft: "5px", flexShrink: 0,
    }}>
      {tier}
    </span>
  );
}

const TABS  = ["University", "City", "Country", "Global"];
const SORTS = ["Tokens", "GPA", "Streak", "Study Time"]; // Tokens first = default

const SORT_COL = { GPA: "gpa", Streak: "streak", "Study Time": "study_time", Tokens: "points" };
const SORT_FMT = {
  gpa:        v => v != null ? Number(v).toFixed(2) : "—",
  streak:     v => v != null ? `${v} day${v !== 1 ? "s" : ""}` : "—",
  study_time: v => v != null ? `${v} hrs` : "—",
  points:     v => v != null ? `${v} pts` : "—",
};

// Map the UI's sort pill → the agent's category, and the scope tab → the agent's scope.
const CATEGORY = { Tokens: "tokens", GPA: "gpa", Streak: "streak", "Study Time": "study_time" };
const SCOPE    = { University: "university", City: "city", Country: "country", Global: "global" };
const FMT_BY_CATEGORY = { tokens: SORT_FMT.points, gpa: SORT_FMT.gpa, streak: SORT_FMT.streak, study_time: SORT_FMT.study_time };

const TIER_ORDER  = ["Basic", "Scholar", "Mastermind", "Brain Owner"];
const TIER_MIN    = { Basic: 0, Scholar: 100, Mastermind: 500, "Brain Owner": 2000 };

function tierProgress(points, tier) {
  const idx      = TIER_ORDER.indexOf(tier ?? "Basic");
  const nextName = TIER_ORDER[idx + 1];
  if (!nextName) return { pct: 1, label: "Max tier reached", nextTier: null };
  const min = TIER_MIN[tier] ?? 0;
  const max = TIER_MIN[nextName];
  const pct = Math.min(Math.max((points - min) / (max - min), 0), 1);
  return { pct, label: `${points - min} / ${max - min} to ${nextName}`, nextTier: nextName };
}

const TAB_FILTER_COL = {
  University: "school",
  City:       "city",
  Country:    "country",
  Global:     null,
};

const TAB_SUBLABEL = {
  University: r => r.city ?? r.country ?? null,
  City:       r => r.school ?? null,
  Country:    r => r.city ?? null,
  Global:     r => r.school ?? null,
};

// SVG progress ring around avatar (Tokens tab only)
function TierRing({ points, tier, size }) {
  const { pct } = tierProgress(points ?? 0, tier ?? "Basic");
  const r    = (size - 5) / 2;
  const circ = 2 * Math.PI * r;
  const dash = pct * circ;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}
      style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      <circle cx={size/2} cy={size/2} r={r} fill="none"
        stroke="rgba(196,154,60,0.12)" strokeWidth="2.5" />
      <circle cx={size/2} cy={size/2} r={r} fill="none"
        stroke="#C49A3C" strokeWidth="2.5"
        strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
        transform={`rotate(-90 ${size/2} ${size/2})`}
        style={{ transition: "stroke-dasharray 0.6s ease-out" }} />
    </svg>
  );
}

const DEFAULT_LOCATION = {
  school:    "University of Toronto",
  city:      "Toronto",
  country:   "Canada",
  continent: "North America",
};

// ── Medal palette ─────────────────────────────────────────────────────────────
const MEDAL = [
  { ring: "rgba(0,210,190,0.65)",    bg: "rgba(0,210,190,0.12)",    text: "rgba(0,210,190,0.95)",    rowBg: "rgba(0,210,190,0.06)",    rowBorder: "rgba(0,210,190,0.22)" },
  { ring: "rgba(185,200,215,0.55)",  bg: "rgba(185,200,215,0.08)",  text: "rgba(195,210,225,0.9)",   rowBg: "rgba(255,255,255,0.03)",  rowBorder: "rgba(185,200,215,0.14)" },
  { ring: "rgba(205,165,75,0.55)",   bg: "rgba(205,165,75,0.1)",    text: "rgba(215,175,85,0.9)",    rowBg: "rgba(205,165,75,0.04)",   rowBorder: "rgba(205,165,75,0.16)" },
];

// ── Avatar colours ────────────────────────────────────────────────────────────
const AVATAR_HUE = [
  "rgba(0,210,190,0.65)",
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

// Placeholder data removed — all tabs now use real Supabase leaderboard data

export default function Leaderboard() {
  const { userId, userData, tokenSummary } = useApp();
  const [tab,       setTab]     = useState(0);
  const [sort,      setSort]    = useState("Tokens");
  const [mounted,   setMounted] = useState(false);
  const [board,     setBoard]   = useState(null);  // /api/leaderboard response: { rows, me, available, scope, scopeValue, count }
  const [lbLoading, setLbLoading] = useState(true);

  useEffect(() => { const t = setTimeout(() => setMounted(true), 30); return () => clearTimeout(t); }, []);

  const tabName = TABS[tab];

  // Server-side ranking via the leaderboard agent: it ranks the WHOLE opted-in population
  // for the chosen category + scope (the old client path only re-sorted the top-50-by-
  // points, so the GPA / streak / study-time boards weren't the true top). Refetch on any
  // tab / sort / identity change.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLbLoading(true);
      const category = CATEGORY[sort];
      const scope    = SCOPE[tabName];
      const scopeValue = scope === "global"    ? null
                       : scope === "university" ? (userData?.school  ?? null)
                       : scope === "city"       ? (userData?.city    ?? null)
                       :                          (userData?.country ?? null);
      try {
        const res  = await fetch("/api/leaderboard", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ userId, category, scope, scopeValue, limit: 50 }),
        });
        const data = res.ok ? await res.json() : null;
        if (!cancelled) setBoard(data);
      } catch {
        if (!cancelled) setBoard(null);
      }
      if (!cancelled) setLbLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [tab, sort, userId, userData?.school, userData?.city, userData?.country]);

  const rows       = board?.rows ?? [];
  const fmt        = FMT_BY_CATEGORY[CATEGORY[sort]] ?? (v => `${v}`);
  const maxVal     = Math.max(rows[0]?.value ?? 1, 1);
  const me         = board?.me ?? null;
  const meVisible  = me != null && rows.some(r => r.userId === userId);
  const scopeLabel = (board?.scope === "global" || !board?.scopeValue) ? "Global" : `${tabName}: ${board.scopeValue}`;

  return (
    <div style={{ maxWidth: "800px", margin: "0 auto", width: "100%" }}>
      {/* Header */}
      <div style={{ marginBottom: "24px" }}>
        <h1 style={{ fontSize: "26px", fontWeight: "600", color: "var(--text-primary)", letterSpacing: "-0.3px", marginBottom: "4px" }}>
          Leaderboard
        </h1>
        <p style={{ color: "var(--text-dim)", fontSize: "13px" }}>
          {scopeLabel} · {rows.length} student{rows.length !== 1 ? "s" : ""}
        </p>
      </div>

      {/* Controls row — scope tabs + sort in one line */}
      <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "20px" }}>
        {/* Scope tabs */}
        <div style={{
          display: "flex", gap: "2px",
          background: "rgba(255,255,255,0.04)",
          border: "1px solid var(--color-border)",
          borderRadius: "12px", padding: "3px",
          overflowX: "auto",
        }}>
          {TABS.map((t, i) => (
            <button
              key={t}
              onClick={() => setTab(i)}
              style={{
                flex: "1 0 auto",
                background: tab === i ? "rgba(255,255,255,0.09)" : "transparent",
                border: tab === i ? "1px solid rgba(255,255,255,0.12)" : "1px solid transparent",
                borderRadius: "9px",
                padding: "7px 10px",
                color: tab === i ? "var(--text-primary)" : "var(--text-dim)",
                fontSize: "12px",
                fontWeight: tab === i ? "600" : "400",
                cursor: "pointer",
                fontFamily: "inherit",
                whiteSpace: "nowrap",
                transition: "all 0.15s",
              }}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Sort pills */}
        <div style={{ display: "flex", gap: "6px" }}>
          {SORTS.map(s => (
            <button
              key={s}
              onClick={() => setSort(s)}
              style={{
                background: sort === s ? "rgba(0,210,190,0.1)" : "transparent",
                border: `1px solid ${sort === s ? "rgba(0,210,190,0.3)" : "rgba(255,255,255,0.08)"}`,
                borderRadius: "20px",
                padding: "5px 14px",
                color: sort === s ? "rgba(0,210,190,0.9)" : "var(--text-dim)",
                fontSize: "12px",
                fontWeight: sort === s ? "600" : "400",
                cursor: "pointer",
                fontFamily: "inherit",
                transition: "all 0.15s",
              }}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Pinned "You" card — always visible on Tokens tab */}
      {sort === "Tokens" && tokenSummary && (
        <div style={{
          background: "rgba(196,154,60,0.06)", border: "1px solid rgba(196,154,60,0.25)",
          borderRadius: "var(--radius-card)", padding: "14px 16px", marginBottom: "14px",
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
            <div>
              <span style={{ color: "#C49A3C", fontSize: "13px", fontWeight: "700" }}>{userData?.name ?? "You"}</span>
              <TierBadge tier={tokenSummary.tier} />
            </div>
            <span style={{ color: "#C49A3C", fontSize: "18px", fontWeight: "700", letterSpacing: "-0.5px" }}>
              {tokenSummary.points} pts
            </span>
          </div>
          {(() => {
            const { pct, label, nextTier } = tierProgress(tokenSummary.points, tokenSummary.tier);
            return nextTier ? (
              <>
                <div style={{ height: "3px", background: "rgba(196,154,60,0.12)", borderRadius: "2px", marginBottom: "5px" }}>
                  <div style={{ height: "100%", background: "#C49A3C", borderRadius: "2px", width: `${pct * 100}%`, transition: "width 0.6s ease" }} />
                </div>
                <p style={{ color: "rgba(196,154,60,0.5)", fontSize: "10px", letterSpacing: "0.3px" }}>{label}</p>
              </>
            ) : (
              <p style={{ color: "rgba(196,154,60,0.6)", fontSize: "10px", letterSpacing: "0.5px" }}>MAX TIER</p>
            );
          })()}
        </div>
      )}

      {/* Empty state — not enough real data for this tab */}
      {!lbLoading && rows.length < 3 && (
        <div style={{ textAlign: "center", padding: "48px 24px", background: "rgba(255,255,255,0.02)", borderRadius: "var(--radius-card)", border: "1px solid rgba(255,255,255,0.05)", marginBottom: "16px" }}>
          <p style={{ color: "rgba(196,154,60,0.6)", fontSize: "14px", fontWeight: "600", marginBottom: "6px" }}>
            {sort === "GPA" ? "Not enough GPA data yet" : sort === "Tokens" ? "The leaderboard is warming up" : "Not enough data yet"}
          </p>
          <p style={{ color: "var(--text-dim)", fontSize: "13px" }}>
            {sort === "GPA" ? "Sync Canvas to join this board" : "Earn tokens to claim an early spot."}
          </p>
        </div>
      )}

      {/* Rows */}
      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        {rows.flatMap((row, i) => {
            const rank     = i + 1;
            const isTop3   = rank <= 3;
            const isMe     = row.userId === userId;
            const sublabel = TAB_SUBLABEL[tabName]?.(row);
            const val      = row.value;
            const barPct   = maxVal > 0 && val != null ? Math.max(8, (val / maxVal) * 100) : 0;
            const medal    = isTop3 ? MEDAL[rank - 1] : null;
            const hue      = avatarHue(row.name ?? "");
            const initial  = (row.name ?? "?")[0].toUpperCase();

            const rowBg     = isMe ? "rgba(0,210,190,0.07)" : medal ? medal.rowBg : "var(--color-surface)";
            const rowBorder = isMe ? "rgba(0,210,190,0.3)"  : medal ? medal.rowBorder : "var(--color-border)";
            const rowShadow = isMe
              ? "0 0 0 1px rgba(0,210,190,0.12), 0 4px 16px rgba(0,210,190,0.06)"
              : "var(--depth-line)";

            const rowEl = (
              <div
                key={row.userId}
                style={{
                  display:      "flex",
                  alignItems:   "center",
                  gap:          isTop3 ? "12px" : "10px",
                  background:   rowBg,
                  border:       `1px solid ${rowBorder}`,
                  borderRadius: "var(--radius-card)",
                  padding:      isTop3 ? "18px 16px" : "13px 14px",
                  opacity:      isMe ? 1 : (rank <= 3 ? 0.92 : 0.72),
                  boxShadow:    rowShadow,
                  transition:   "opacity 0.2s",
                  position:     "relative",
                  overflow:     "hidden",
                }}
              >
                {/* Ambient glow on rank 1 */}
                {rank === 1 && (
                  <div style={{
                    position: "absolute", top: -28, right: -28,
                    width: 100, height: 100,
                    background: "radial-gradient(circle, rgba(0,210,190,0.07) 0%, transparent 70%)",
                    pointerEvents: "none",
                  }} />
                )}

                {/* Rank indicator */}
                {isTop3 ? (
                  <div style={{
                    width: 28, height: 28, borderRadius: "50%",
                    background: medal.bg,
                    border: `1.5px solid ${medal.ring}`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    flexShrink: 0,
                  }}>
                    <span style={{ fontSize: "11px", fontWeight: "700", color: medal.text }}>
                      {rank}
                    </span>
                  </div>
                ) : (
                  <span style={{
                    fontSize: "12px", fontWeight: "600",
                    color: "var(--text-dim)",
                    minWidth: "22px", textAlign: "right",
                    flexShrink: 0,
                  }}>
                    {rank}
                  </span>
                )}

                {/* Avatar with initial + optional tier ring */}
                <div style={{ position: "relative", flexShrink: 0, width: isTop3 ? 36 : 30, height: isTop3 ? 36 : 30 }}>
                  {sort === "Tokens" && <TierRing points={row.value} tier={row.tier} size={isTop3 ? 36 : 30} />}
                <div style={{
                  width:        isTop3 ? 36 : 30,
                  height:       isTop3 ? 36 : 30,
                  borderRadius: "50%",
                  background:   `radial-gradient(circle at 35% 35%, ${hue}, rgba(0,0,0,0.25))`,
                  border:       sort === "Tokens" ? "none" : `1px solid ${hue}`,
                  display:      "flex",
                  alignItems:   "center",
                  justifyContent: "center",
                  flexShrink:   0,
                }}>
                  <span style={{
                    fontSize:   isTop3 ? "14px" : "11px",
                    fontWeight: "700",
                    color:      "#fff",
                  }}>
                    {initial}
                  </span>
                </div>
                </div>{/* end avatar wrapper */}

                {/* Name + sublabel */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", minWidth: 0 }}>
                    <p style={{
                      color:         isMe ? "rgba(0,210,190,0.95)" : "var(--text-primary)",
                      fontSize:      isTop3 ? "15px" : "13px",
                      fontWeight:    isTop3 ? "600" : "500",
                      overflow:      "hidden",
                      textOverflow:  "ellipsis",
                      whiteSpace:    "nowrap",
                      letterSpacing: "-0.2px",
                    }}>
                      {row.name ?? "Anonymous"}{isMe ? " · You" : ""}
                    </p>
                    {(sort === "Tokens" && row.tier) && <TierBadge tier={row.tier} />}
                    {(sort !== "Tokens" && isMe && tokenSummary?.tier) && <TierBadge tier={tokenSummary.tier} />}
                  </div>
                  {sublabel && (
                    <p style={{
                      color:        "var(--text-dim)",
                      fontSize:     "11px",
                      marginTop:    "2px",
                      overflow:     "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace:   "nowrap",
                    }}>
                      {sublabel}
                    </p>
                  )}
                </div>

                {/* Stat value + relative bar */}
                <div style={{
                  display:        "flex",
                  flexDirection:  "column",
                  alignItems:     "flex-end",
                  flexShrink:     0,
                  gap:            "4px",
                }}>
                  <span style={{
                    fontSize:      isTop3 ? "16px" : "14px",
                    fontWeight:    "700",
                    color:         isMe ? (sort === "Tokens" ? "#C49A3C" : "rgba(0,210,190,0.9)") : "var(--text-primary)",
                    letterSpacing: "-0.3px",
                  }}>
                    {fmt(row.value)}
                  </span>
                  {val != null && (
                    <div style={{
                      height:       2,
                      borderRadius: 1,
                      background:   "rgba(255,255,255,0.07)",
                      width:        38,
                      overflow:     "hidden",
                    }}>
                      <div style={{
                        width:        `${barPct}%`,
                        height:       "100%",
                        background:   isMe
                          ? "rgba(0,210,190,0.8)"
                          : rank === 1
                          ? "rgba(0,210,190,0.5)"
                          : "rgba(255,255,255,0.28)",
                        borderRadius: 1,
                        transition:   "width 0.5s var(--ease-apple)",
                      }} />
                    </div>
                  )}
                </div>
              </div>
            );

            // Insert a subtle divider between the podium (top 3) and the rest
            if (rank === 4 && rows.length > 3) {
              return [
                <div key="__podium-sep__" style={{
                  height:     "1px",
                  background: "var(--color-border)",
                  margin:     "2px 0",
                }} />,
                rowEl,
              ];
            }
            return rowEl;
          })}
      </div>

      {/* Your rank — shown when you're outside the visible top-N (server gives the true rank) */}
      {me && !meVisible && !lbLoading && (
        <div style={{
          marginTop: "10px", display: "flex", alignItems: "center", justifyContent: "space-between",
          background: "rgba(0,210,190,0.07)", border: "1px solid rgba(0,210,190,0.3)",
          borderRadius: "var(--radius-card)", padding: "13px 14px",
        }}>
          <span style={{ color: "rgba(0,210,190,0.95)", fontSize: "13px", fontWeight: 600 }}>
            #{me.rank} · You
          </span>
          <span style={{ color: "rgba(0,210,190,0.9)", fontSize: "14px", fontWeight: 700 }}>
            {fmt(me.value)}
          </span>
        </div>
      )}
    </div>
  );
}

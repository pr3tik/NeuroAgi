// Identity.jsx — Student profile with live Supabase data, GradeGraph, and ShareCard.

import { useState, useCallback, useEffect } from "react";
import { useApp }                    from "../context/AppContext";
import { signOut }                   from "../api/auth";
import GradeGraph, { COURSE_COLORS } from "../components/GradeGraph";
import ShareCard                     from "../components/ShareCard";
import FriendsSection                from "../components/FriendsSection";
import WritingTracker                from "../components/WritingTracker";
import { LogIn, RefreshCw, Layers, CircleDot, Sparkles, Check, Hexagon, ArrowUp, Star, ChevronUp, ChevronDown, ArrowUpRight } from "lucide-react";
import { coursesToGpa } from "../lib/gpa";
import { ACHIEVEMENTS } from "../lib/achievements";
import { TECHNIQUE_TYPES_BY_KIND } from "../lib/techniqueTypes";

// Deterministic fallback grade (72–97) derived from the course code string.
function fallbackGrade(seed) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) { h = Math.imul(31, h) + seed.charCodeAt(i) | 0; }
  return 72 + (Math.abs(h) % 26);
}

// Update this when the server invite URL changes — no redeploy needed if set via env.
const DISCORD_INVITE_URL = "https://discord.gg/SpFXzPZxBX";

const TOKEN_LABELS = {
  daily_login:          "Daily login",
  canvas_sync:          "Canvas synced",
  flashcards_generated: "Flashcards generated",
  quiz_completed:       "Quiz completed",
  quiz_perfect:         "Perfect score",
  assignment_submitted: "Assignment done",
  discord_connected:    "Discord connected",
  streak_day:           "Streak extended",
  streak_milestone:     "Streak milestone",
};

const TOKEN_ICONS = {
  daily_login:          LogIn,
  canvas_sync:          RefreshCw,
  flashcards_generated: Layers,
  quiz_completed:       CircleDot,
  quiz_perfect:         Sparkles,
  assignment_submitted: Check,
  discord_connected:    Hexagon,
  streak_day:           ArrowUp,
  streak_milestone:     Star,
};

// Tier thresholds — keep in sync with api/token-engine.js
const TIERS = [
  { name: "Basic",       min: 0    },
  { name: "Scholar",     min: 100  },
  { name: "Mastermind",  min: 500  },
  { name: "Brain Owner", min: 2000 },
];

function getNextTier(points) {
  for (const t of TIERS) {
    if (points < t.min) return t;
  }
  return null; // already at max
}

function tierProgressPct(points) {
  // Find current and next tier
  let curr = TIERS[0];
  for (let i = TIERS.length - 1; i >= 0; i--) {
    if (points >= TIERS[i].min) { curr = TIERS[i]; break; }
  }
  const next = TIERS[TIERS.indexOf(curr) + 1];
  if (!next) return 100;
  return Math.min(100, Math.round(((points - curr.min) / (next.min - curr.min)) * 100));
}

function fmtAgo(iso) {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function fmtEventDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const diffDays = Math.floor((+now - +d) / 86400000);
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "yesterday";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function Identity() {
  const { userData, courses, assignments, canvasToken, updateUserField, tokenSummary, userId } = useApp();
  const [tokenExpanded, setTokenExpanded] = useState(false);

  // Editable name
  const currentName = userData?.name || localStorage.getItem("fschool_name") || "";
  const [editingName, setEditingName] = useState(false);
  const [nameInput,   setNameInput]   = useState(currentName);

  // Voice is now changed conversationally via voice mode in the chat sheet.
  // The picker was removed — users say "use a British voice" and the intent tag handles it.

  const commitName = useCallback(async () => {
    setEditingName(false);
    const trimmed = nameInput.trim();
    if (!trimmed || trimmed === currentName) return;
    localStorage.setItem("fschool_name", trimmed);
    await updateUserField("name", trimmed);
  }, [nameInput, currentName, updateUserField]);

  const gpaVal      = userData?.gpa ?? coursesToGpa(courses);
  const gpa         = gpaVal != null ? Number(gpaVal).toFixed(2) : "—";
  const streak      = `${userData?.streak     ?? 0}d`;
  const studyTime   = `${userData?.study_time ?? 0}h`;
  const totalDone   = assignments.filter(a => a.submission?.submittedAt).length || 0;

  const STATS = [
    { label: "GPA",         value: gpa },
    { label: "Assignments", value: totalDone || (userData?.assignments ?? "—") },
    { label: "Streak",      value: streak },
    { label: "Study Time",  value: studyTime },
  ];

  // Technique-type achievements land in the same user_achievements table as the
  // regular badge shelf — filter for the "type_*" key convention (see
  // api/_achievements.ts's awardTechniqueTypeIfEligible) rather than a new endpoint.
  const typeUnlock = (tokenSummary?.unlockedAchievements ?? []).find(u => u.achievement_key?.startsWith("type_"));
  const yourType   = typeUnlock ? TECHNIQUE_TYPES_BY_KIND[typeUnlock.meta?.strategyKind] : null;

  // Course performance from Canvas data only — hidden when Canvas isn't connected.
  // pct is null when no grade exists for a real course; the bar shows "—" in that case.
  const coursePerf = courses.map(c => ({
    name: c.name,
    code: c.courseCode,
    pct:  c.currentScore ?? c.finalScore ?? null,
  }));

  async function handleSignOut() {
    // signOut() ends the GoTrue session (hang-proof) and clears the full local
    // identity — especially fschool_uid, whose leftover value made the next signup
    // reuse this user's id and overwrite their row (accounts collapsed).
    await signOut();
    window.location.reload();
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
        <div>
          <p style={{ fontSize: "11px", color: "var(--text-dim)", letterSpacing: "2px", textTransform: "uppercase", marginBottom: "6px" }}>Identity</p>
          {editingName ? (
            <input
              autoFocus
              value={nameInput}
              onChange={e => setNameInput(e.target.value)}
              onBlur={commitName}
              onKeyDown={e => e.key === "Enter" && commitName()}
              style={{
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.18)",
                borderRadius: "8px",
                padding: "4px 10px",
                color: "var(--text-primary)",
                fontSize: "22px",
                fontWeight: "600",
                letterSpacing: "-0.3px",
                outline: "none",
                fontFamily: "inherit",
                width: "180px",
              }}
            />
          ) : (
            <h1
              onClick={() => { setNameInput(currentName); setEditingName(true); }}
              style={{ fontSize: "26px", fontWeight: "600", color: "var(--text-primary)", letterSpacing: "-0.3px", cursor: "text" }}
              title="Tap to edit name"
            >
              {currentName || "Your Name"}
            </h1>
          )}
          {(userData?.school || userData?.school_city || userData?.school_country) && (
            <p style={{ fontSize: "13px", color: "var(--text-secondary)", marginTop: "4px" }}>
              {[userData.school, userData.school_city, userData.school_country].filter(Boolean).join(" · ")}
            </p>
          )}
        </div>
        <button
          onClick={handleSignOut}
          style={{
            background: "transparent",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: "8px",
            color: "rgba(255,255,255,0.35)",
            fontSize: "11px",
            letterSpacing: "1.5px",
            textTransform: "uppercase",
            padding: "6px 12px",
            cursor: "pointer",
          }}
        >
          Sign Out
        </button>
      </div>

      {/* 2×2 stat grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "32px" }}>
        {STATS.map(s => (
          <div key={s.label} style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-card)", boxShadow: "var(--depth-line)", padding: "20px 16px" }}>
            <p style={{ color: "var(--text-primary)", fontSize: "28px", fontWeight: "600", letterSpacing: "-0.5px", marginBottom: "4px" }}>
              {s.value}
            </p>
            <p style={{ color: "var(--text-secondary)", fontSize: "12px" }}>{s.label}</p>
          </div>
        ))}
      </div>

      {/* Grade graph */}
      <div style={{ marginBottom: "32px" }}>
        <GradeGraph
          courses={courses}
          assignments={assignments}
          connected={courses.length > 0}
        />
      </div>

      {/* Writing Evolution Tracker — profile a piece of writing + track growth over time */}
      <WritingTracker />

      {/* Course performance bars — only shown when Canvas is connected */}
      {coursePerf.length > 0 && (
        <>
          <p style={{ fontSize: "11px", color: "var(--text-dim)", letterSpacing: "2px", textTransform: "uppercase", marginBottom: "16px" }}>
            Course Performance
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: "16px", marginBottom: "8px" }}>
            {coursePerf.map((c, i) => {
              const color = COURSE_COLORS[i % COURSE_COLORS.length];
              return (
                <div key={c.code ?? c.name}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "7px" }}>
                    <div>
                      <span style={{ color: "var(--text-primary)", fontSize: "14px", fontWeight: "500" }}>{c.name}</span>
                      <span style={{ color: "var(--text-tertiary)", fontSize: "12px", marginLeft: "8px" }}>{c.code}</span>
                    </div>
                    <span style={{ fontSize: "13px", fontWeight: "600", color, flexShrink: 0, marginLeft: "8px" }}>
                      {c.pct != null ? `${Math.round(c.pct)}%` : "—"}
                    </span>
                  </div>
                  <div style={{ background: "rgba(255,255,255,0.06)", borderRadius: "4px", height: "4px" }}>
                    <div style={{ background: color, height: "100%", borderRadius: "4px", width: `${c.pct ?? 0}%`, transition: "width 0.5s var(--ease-apple)" }} />
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Token wallet + activity */}
      {tokenSummary && (
        <div style={{ marginBottom: "32px" }}>
          <p style={{ fontSize: "11px", color: "var(--text-dim)", letterSpacing: "2px", textTransform: "uppercase", marginBottom: "12px" }}>
            Tokens
          </p>

          {/* Summary card */}
          <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-card)", padding: "16px 18px", marginBottom: "10px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "12px" }}>
              <div>
                <p style={{ fontSize: "28px", fontWeight: "600", color: "#C49A3C", letterSpacing: "-0.5px", lineHeight: 1 }}>
                  {tokenSummary.points ?? 0}
                </p>
                <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: "3px" }}>
                  {tokenSummary.tier}
                  {tokenSummary.todayEarned > 0 && (
                    <span style={{ color: "rgba(196,154,60,0.65)", marginLeft: "8px" }}>+{tokenSummary.todayEarned} today</span>
                  )}
                </p>
              </div>
              {getNextTier(tokenSummary.points ?? 0) && (
                <p style={{ fontSize: "11px", color: "var(--text-dim)", textAlign: "right", lineHeight: 1.4 }}>
                  {getNextTier(tokenSummary.points ?? 0).min - (tokenSummary.points ?? 0)} to<br/>
                  <span style={{ color: "rgba(196,154,60,0.7)" }}>{getNextTier(tokenSummary.points ?? 0).name}</span>
                </p>
              )}
            </div>
            {/* Tier progress bar */}
            <div style={{ background: "rgba(255,255,255,0.06)", borderRadius: "3px", height: "3px" }}>
              <div style={{
                background: "linear-gradient(90deg, #C49A3C, rgba(196,154,60,0.6))",
                height: "100%", borderRadius: "3px",
                width: `${tierProgressPct(tokenSummary.points ?? 0)}%`,
                transition: "width 0.6s var(--ease-apple)",
              }} />
            </div>
          </div>

          {/* Recent events — capped at 5, expandable */}
          {(tokenSummary.recentEvents?.length ?? 0) > 0 && (
            <>
              <div style={{ display: "flex", flexDirection: "column" }}>
                {(tokenExpanded
                  ? tokenSummary.recentEvents
                  : tokenSummary.recentEvents.slice(0, 5)
                ).map((e, i, arr) => (
                  <div key={i} style={{
                    display: "flex", alignItems: "center", gap: "10px",
                    padding: "8px 4px",
                    borderBottom: i < arr.length - 1 ? "1px solid rgba(255,255,255,0.05)" : "none",
                  }}>
                    <span style={{ color: "rgba(196,154,60,0.6)", width: "16px", display: "inline-flex", justifyContent: "center", flexShrink: 0 }}>
                      {(() => { const Ic = TOKEN_ICONS[e.action]; return Ic ? <Ic size={13} /> : "·"; })()}
                    </span>
                    <span style={{ color: "var(--text-secondary)", fontSize: "13px", flex: 1 }}>
                      {TOKEN_LABELS[e.action] ?? e.action}
                    </span>
                    <span style={{ color: "#C49A3C", fontSize: "12px", fontWeight: "700", flexShrink: 0 }}>+{e.tokens}</span>
                    <span style={{ color: "var(--text-dim)", fontSize: "11px", flexShrink: 0, minWidth: "44px", textAlign: "right" }}>
                      {fmtAgo(e.created_at)}
                    </span>
                  </div>
                ))}
              </div>
              {tokenSummary.recentEvents.length > 5 && (
                <button
                  onClick={() => setTokenExpanded(v => !v)}
                  style={{
                    marginTop: "8px", background: "none", border: "none", padding: "4px 0",
                    color: "var(--text-dim)", fontSize: "12px", cursor: "pointer", fontFamily: "inherit",
                    letterSpacing: "0.3px",
                  }}
                >
                  {tokenExpanded
                    ? <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>Show less<ChevronUp size={13} /></span>
                    : <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>View all {tokenSummary.recentEvents.length}<ChevronDown size={13} /></span>}
                </button>
              )}
            </>
          )}
        </div>
      )}

      {/* Your type — technique-type achievement, separate from the general badge shelf */}
      {yourType && (
        <div style={{ marginBottom: "32px" }}>
          <p style={{ fontSize: "11px", color: "var(--text-dim)", letterSpacing: "2px", textTransform: "uppercase", marginBottom: "12px" }}>
            Your Type
          </p>
          <div style={{
            display: "flex", alignItems: "center", gap: "14px",
            padding: "16px 18px",
            background: "rgba(196,154,60,0.08)",
            border: "1px solid rgba(196,154,60,0.25)",
            borderRadius: "var(--radius-card)",
          }}>
            <span style={{ fontSize: "28px", lineHeight: 1 }}>{yourType.emoji}</span>
            <div>
              <p style={{ color: "var(--text-primary)", fontSize: "15px", fontWeight: "600" }}>{yourType.nickname}</p>
              <p style={{ color: "var(--text-secondary)", fontSize: "12px", marginTop: "2px" }}>{yourType.blurb}</p>
            </div>
          </div>
        </div>
      )}

      {/* Achievements */}
      {tokenSummary && (
        <div style={{ marginBottom: "32px" }}>
          <p style={{ fontSize: "11px", color: "var(--text-dim)", letterSpacing: "2px", textTransform: "uppercase", marginBottom: "12px" }}>
            Achievements
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(84px, 1fr))", gap: "10px" }}>
            {ACHIEVEMENTS.map(a => {
              const unlocked = (tokenSummary.unlockedAchievements ?? []).some(u => u.achievement_key === a.key);
              const Ic = a.icon;
              return (
                <div key={a.key} title={a.description} style={{
                  display: "flex", flexDirection: "column", alignItems: "center", gap: "6px",
                  padding: "12px 8px",
                  background: unlocked ? "rgba(196,154,60,0.08)" : "var(--color-surface)",
                  border: `1px solid ${unlocked ? "rgba(196,154,60,0.25)" : "var(--color-border)"}`,
                  borderRadius: "var(--radius-card)",
                  opacity: unlocked ? 1 : 0.35,
                }}>
                  <Ic size={20} color={unlocked ? "#C49A3C" : "var(--text-dim)"} />
                  <span style={{ fontSize: "10px", color: unlocked ? "var(--text-primary)" : "var(--text-dim)", textAlign: "center", lineHeight: 1.3 }}>
                    {a.name}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Discord connection */}
      {userData && (
        <div style={{ marginBottom: "32px" }}>
          <p style={{ fontSize: "11px", color: "var(--text-dim)", letterSpacing: "2px", textTransform: "uppercase", marginBottom: "12px" }}>
            Community
          </p>
          {userData.discord_user_id ? (
            <div style={{
              display: "flex", alignItems: "center", gap: "12px",
              padding: "14px 16px",
              background: "var(--color-surface)",
              border: "1px solid var(--color-border)",
              borderRadius: "var(--radius-card)",
              marginBottom: "8px",
            }}>
              <img src="/discord-logo.svg" alt="Discord" style={{ width: "20px", height: "20px", opacity: 0.55, flexShrink: 0 }} />
              <span style={{ color: "var(--text-secondary)", fontSize: "13px" }}>Discord connected</span>
              <span style={{ color: "rgba(52,199,89,0.8)", display: "inline-flex", marginLeft: "auto" }}><Check size={15} /></span>
            </div>
          ) : (
            <a
              href="#"
              onClick={async (e) => {
                e.preventDefault();
                if (!userId) return;
                // Fetch (so the JWT is attached) → server derives the uid from the session +
                // signs it into the OAuth state → navigate. Never passes uid in the URL.
                try {
                  const r = await fetch("/api/discord?action=login");
                  const d = await r.json().catch(() => null);
                  if (d?.url) window.location.href = d.url;
                } catch { /* ignore */ }
              }}
              style={{
                display: "flex", alignItems: "center", gap: "12px",
                padding: "14px 16px",
                background: "var(--color-surface)",
                border: "1px solid var(--color-border)",
                borderRadius: "var(--radius-card)",
                textDecoration: "none",
                cursor: userId ? "pointer" : "not-allowed",
                transition: "border-color 0.15s",
                marginBottom: "8px",
              }}
              onMouseEnter={e => e.currentTarget.style.borderColor = "rgba(88,101,242,0.45)"}
              onMouseLeave={e => e.currentTarget.style.borderColor = "var(--color-border)"}
            >
              <img src="/discord-logo.svg" alt="Discord" style={{ width: "20px", height: "20px", flexShrink: 0 }} />
              <span style={{ color: "var(--text-primary)", fontSize: "13px", fontWeight: "500" }}>Connect Discord</span>
              <span style={{ color: "var(--text-dim)", fontSize: "12px", marginLeft: "auto" }}>+5 tokens →</span>
            </a>
          )}
          {/* Direct invite — always visible; works even when auto-join fails (max servers, etc.) */}
          <a
            href={DISCORD_INVITE_URL}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "flex", alignItems: "center", gap: "12px",
              padding: "12px 16px",
              background: "transparent",
              border: "1px solid rgba(88,101,242,0.18)",
              borderRadius: "var(--radius-card)",
              textDecoration: "none",
              transition: "border-color 0.15s",
            }}
            onMouseEnter={e => e.currentTarget.style.borderColor = "rgba(88,101,242,0.45)"}
            onMouseLeave={e => e.currentTarget.style.borderColor = "rgba(88,101,242,0.18)"}
          >
            <img src="/discord-logo.svg" alt="Discord" style={{ width: "18px", height: "18px", opacity: 0.6, flexShrink: 0 }} />
            <span style={{ color: "rgba(166,176,255,0.75)", fontSize: "13px" }}>Join our Discord</span>
            <span style={{ color: "rgba(88,101,242,0.5)", marginLeft: "auto", display: "flex" }}><ArrowUpRight size={14} /></span>
          </a>
        </div>
      )}

      {/* Friends */}
      {userId && <FriendsSection userId={userId} ownName={userData?.name} />}

      {/* Share card */}
      <ShareCard />
    </div>
  );
}


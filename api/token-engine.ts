// api/token-engine.js — Server-side token award engine.
// ALL token amounts live here only. Client never controls point values.
// POST ?action=award  { userId, action, meta }
// GET  ?action=summary&userId=X

import { createClient } from "@supabase/supabase-js";
import { notify } from "./_notify.js";
import { awardAchievement, awardFirstTimeAchievement } from "./_achievements.js";

const supabase = createClient(
  process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "",
  process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? ""
);

// ── Token config — source of truth for all award amounts ─────────────────────
const ACTIONS = {
  daily_login:          { tokens: 2,  maxPerDay: 1    },
  canvas_sync:          { tokens: 5,  maxPerDay: 1    },
  flashcards_generated: { tokens: 10, maxPerDay: 3    },
  quiz_completed:       { tokens: 8,  maxPerDay: 5    },
  quiz_perfect:         { tokens: 5,  maxPerDay: 5    },  // bonus, stacks with quiz_completed
  assignment_submitted: { tokens: 15, maxPerDay: null  },  // deduped by meta.assignmentId
  discord_connected:    { tokens: 5,  maxPerDay: null, lifetimeMax: 1 },
  streak_day:           { tokens: 3,  maxPerDay: 1    },
  streak_milestone:     { tokens: 25, maxPerDay: null  },  // deduped by meta.milestone
  study_room_join:      { tokens: 2,  maxPerDay: 3    },  // deduped by meta.sessionId
  study_session_15min:  { tokens: 5,  maxPerDay: null  },  // +5 per 15 min, computed server-side from room_sessions
};

const STREAK_MILESTONES = [7, 14, 30, 60, 100];

// action → achievement_key, for the "first time this action ever fires" achievements.
// study_session_15min isn't here — it has its own award path (returns early, see below).
const FIRST_TIME_ACHIEVEMENTS = {
  canvas_sync:          "first_canvas_sync",
  quiz_perfect:         "first_quiz_perfect",
  study_room_join:      "first_room_join",
  assignment_submitted: "first_assignment_submitted",
  flashcards_generated: "first_flashcards_generated",
};

const TIERS = [
  { name: "Brain Owner", min: 2000 },
  { name: "Mastermind",  min: 500  },
  { name: "Scholar",     min: 100  },
  { name: "Basic",       min: 0    },
];

function getTier(points) {
  return (TIERS.find(t => (points ?? 0) >= t.min) ?? TIERS[3]).name;
}

// ── Rank-change notification (Part C) ────────────────────────────────────────
// Fires at most once per 3 hours, only when the user crosses a meaningful
// milestone rank (top 10 / top 3 / #1). Throttled hard — rank churn is constant.
const RANK_MILESTONES = [1, 3, 10];
async function checkAndNotifyRank(userId: string, newPoints: number, oldPoints: number) {
  try {
    // Count users with strictly MORE points → gives 0-based rank offset
    const [{ count: above }, { count: aboveOld }] = await Promise.all([
      supabase.from("leaderboard").select("user_id", { count: "exact", head: true }).gt("points", newPoints),
      supabase.from("leaderboard").select("user_id", { count: "exact", head: true }).gt("points", oldPoints),
    ]);
    const newRank = (above ?? 0) + 1;
    const oldRank = (aboveOld ?? 0) + 1;

    // Only notify when crossing INTO a milestone rank, not on every improvement
    const crossed = RANK_MILESTONES.find(m => newRank <= m && oldRank > m);
    if (!crossed) return;

    // Throttle: skip if we already sent a ranking notif in the last 3 hours
    const cutoff = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    const { count: recent } = await supabase
      .from("notifications").select("id", { count: "exact", head: true })
      .eq("user_id", userId).eq("type", "ranking").gte("created_at", cutoff);
    if ((recent ?? 0) > 0) return;

    const title = newRank === 1
      ? "You're #1 on the leaderboard! 🏆"
      : `You moved into the top ${crossed}`;
    await notify(userId, "ranking", {
      title,
      body: `${newPoints} points · Rank #${newRank}`,
      data: { newRank, oldRank, points: newPoints },
    });
  } catch { /* non-blocking — never let rank notif break an award */ }
}

function today() {
  return new Date().toISOString().slice(0, 10);
}
function yesterday() {
  return new Date(Date.now() - 86400000).toISOString().slice(0, 10);
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();

  const { action } = req.query;

  // ── GET ?action=summary ────────────────────────────────────────────────────
  if (action === "summary") {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: "userId required" });

    const [{ data: user }, { data: todayRows }, { data: recent }, { data: achievements }] = await Promise.all([
      supabase.from("users").select("points, streak").eq("id", userId).maybeSingle(),
      supabase.from("token_events").select("tokens").eq("user_id", userId).eq("awarded_on", today()),
      supabase.from("token_events").select("action, tokens, meta, created_at")
        .eq("user_id", userId).order("created_at", { ascending: false }).limit(10),
      supabase.from("user_achievements").select("achievement_key, unlocked_at, meta").eq("user_id", userId),
    ]);

    const points      = user?.points ?? 0;
    const todayEarned = (todayRows ?? []).reduce((s, e) => s + (e.tokens ?? 0), 0);

    // Reconcile leaderboard.points drift — if users.points differs, sync it (non-blocking)
    if (user?.points != null) {
      supabase.from("leaderboard").select("points").eq("user_id", userId).maybeSingle()
        .then(({ data: lb }) => {
          if (lb && lb.points !== user.points) {
            supabase.from("leaderboard").upsert({
              user_id:    userId,
              points:     user.points,
              tier:       getTier(user.points),
              updated_at: new Date().toISOString(),
            }, { onConflict: "user_id" }).then(() => {}, () => {});
          }
        }, () => {});
    }

    return res.status(200).json({
      points,
      tier:                 getTier(points),
      streak:               user?.streak ?? 0,
      todayEarned,
      recentEvents:         recent ?? [],
      unlockedAchievements: achievements ?? [],
    });
  }

  // ── POST ?action=award ─────────────────────────────────────────────────────
  if (action === "award") {
    if (req.method !== "POST") return res.status(405).end();

    const { userId, action: awardAction, meta = {} } = req.body ?? {};
    if (!userId || !awardAction) return res.status(400).json({ error: "userId and action required" });

    const cfg = ACTIONS[awardAction];
    if (!cfg) return res.status(400).json({ error: `Unknown action: ${awardAction}` });

    const dt = today();

    // ── Study session: +5 per 15 min, validated SERVER-SIDE ──────────────────
    // Duration is computed from room_sessions.joined_at (DB-stamped on the server
    // at join) up to the earlier of (server now, recorded left_at) — the client's
    // reported duration is never trusted. tokens_awarded on the row tracks what's
    // already been paid, so re-calling (e.g. on leave) only awards NEW 15-min blocks.
    if (awardAction === "study_session_15min") {
      if (!meta.sessionId) return res.status(400).json({ error: "meta.sessionId required" });

      const { data: sess } = await supabase
        .from("room_sessions")
        .select("id, user_id, joined_at, left_at, tokens_awarded")
        .eq("id", meta.sessionId).maybeSingle();

      if (!sess)                   return res.status(200).json({ awarded: false, reason: "no_session" });
      if (sess.user_id !== userId) return res.status(200).json({ awarded: false, reason: "not_your_session" });

      const MAX_SESSION_SECS = 12 * 3600; // cap runaway sessions (tab left open, etc.)
      const startMs = Date.parse(sess.joined_at);
      const leftMs  = sess.left_at ? Date.parse(sess.left_at) : Date.now();
      const endMs   = Math.min(Date.now(), leftMs);     // never credit a future left_at
      const durationSecs = Math.max(0, Math.min(Math.floor((endMs - startMs) / 1000), MAX_SESSION_SECS));

      const blocks  = Math.floor(durationSecs / (15 * 60));
      const earned  = blocks * cfg.tokens;              // total this session is worth
      const already = sess.tokens_awarded ?? 0;
      const delta   = earned - already;

      if (delta <= 0) {
        return res.status(200).json({ awarded: false, reason: "no_new_time", durationSecs });
      }

      await supabase.from("token_events").insert({
        user_id:    userId,
        action:     awardAction,
        tokens:     delta,
        meta:       { sessionId: sess.id, durationSecs, blocks },
        awarded_on: dt,
      });

      const { data: userRow } = await supabase.from("users").select("points").eq("id", userId).maybeSingle();
      const newPoints = (userRow?.points ?? 0) + delta;
      await supabase.from("users").update({ points: newPoints }).eq("id", userId);
      await supabase.from("room_sessions").update({ tokens_awarded: earned }).eq("id", sess.id);

      const tier   = getTier(newPoints);
      const tierUp = tier !== getTier(newPoints - delta);
      supabase.from("leaderboard").upsert({
        user_id: userId, points: newPoints, tier, updated_at: new Date().toISOString(),
      }, { onConflict: "user_id" }).then(() => {}, () => {});

      // Check for milestone rank crossing (non-blocking)
      checkAndNotifyRank(userId, newPoints, newPoints - delta).catch(() => {});

      return res.status(200).json({ awarded: true, tokens: delta, newTotal: newPoints, tier, tierUp, durationSecs });
    }

    // ── Daily limit ──────────────────────────────────────────────────────────
    if (cfg.maxPerDay !== null) {
      const { count } = await supabase
        .from("token_events").select("id", { count: "exact", head: true })
        .eq("user_id", userId).eq("action", awardAction).eq("awarded_on", dt);
      if ((count ?? 0) >= cfg.maxPerDay) {
        return res.status(200).json({ awarded: false, reason: "daily_limit" });
      }
    }

    // ── Lifetime limit (discord_connected) ───────────────────────────────────
    if (cfg.lifetimeMax) {
      const { count } = await supabase
        .from("token_events").select("id", { count: "exact", head: true })
        .eq("user_id", userId).eq("action", awardAction);
      if ((count ?? 0) >= cfg.lifetimeMax) {
        return res.status(200).json({ awarded: false, reason: "lifetime_limit" });
      }
    }

    // ── Anti-cheat: one award per unique assignment ──────────────────────────
    if (awardAction === "assignment_submitted") {
      if (!meta.assignmentId) return res.status(400).json({ error: "meta.assignmentId required" });
      const { count } = await supabase
        .from("token_events").select("id", { count: "exact", head: true })
        .eq("user_id", userId).eq("action", "assignment_submitted")
        .filter("meta->>'assignmentId'", "eq", String(meta.assignmentId));
      if ((count ?? 0) > 0) return res.status(200).json({ awarded: false, reason: "already_awarded" });
    }

    // ── Anti-cheat: one award per streak milestone ───────────────────────────
    if (awardAction === "streak_milestone") {
      if (!meta.milestone) return res.status(400).json({ error: "meta.milestone required" });
      const { count } = await supabase
        .from("token_events").select("id", { count: "exact", head: true })
        .eq("user_id", userId).eq("action", "streak_milestone")
        .filter("meta->>'milestone'", "eq", String(meta.milestone));
      if ((count ?? 0) > 0) return res.status(200).json({ awarded: false, reason: "already_awarded" });
    }

    // ── Anti-cheat: one join award per room session ──────────────────────────
    if (awardAction === "study_room_join") {
      if (!meta.sessionId) return res.status(400).json({ error: "meta.sessionId required" });
      const { count } = await supabase
        .from("token_events").select("id", { count: "exact", head: true })
        .eq("user_id", userId).eq("action", "study_room_join")
        .filter("meta->>'sessionId'", "eq", String(meta.sessionId));
      if ((count ?? 0) > 0) return res.status(200).json({ awarded: false, reason: "already_awarded" });
    }

    // ── Quiz requires score + total ──────────────────────────────────────────
    if (awardAction === "quiz_completed" || awardAction === "quiz_perfect") {
      if (meta.score == null || meta.total == null) {
        return res.status(400).json({ error: "meta.score and meta.total required" });
      }
    }

    // ── Streak logic (streak_day action) ─────────────────────────────────────
    let streakPatch   = null;
    let milestoneBonus = null;

    if (awardAction === "streak_day") {
      const { data: user } = await supabase
        .from("users").select("last_active_date, streak").eq("id", userId).maybeSingle();

      const lastActive    = user?.last_active_date;
      const currentStreak = user?.streak ?? 0;

      if (lastActive === dt) {
        return res.status(200).json({ awarded: false, reason: "already_active_today" });
      }
      if (lastActive === null) {
        // First ever visit — start streak, no award yet
        await supabase.from("users").update({ last_active_date: dt, streak: 1 }).eq("id", userId);
        return res.status(200).json({ awarded: false, reason: "first_visit", newStreak: 1 });
      }
      if (lastActive !== yesterday()) {
        // Streak broken — reset to 1, no award
        await supabase.from("users").update({ last_active_date: dt, streak: 1 }).eq("id", userId);
        return res.status(200).json({ awarded: false, reason: "streak_broken", newStreak: 1 });
      }

      const newStreak = currentStreak + 1;
      streakPatch = { last_active_date: dt, streak: newStreak };

      // Check for milestone
      const hitMilestone = STREAK_MILESTONES.find(m => m === newStreak);
      if (hitMilestone) {
        const { count: mc } = await supabase
          .from("token_events").select("id", { count: "exact", head: true })
          .eq("user_id", userId).eq("action", "streak_milestone")
          .filter("meta->>'milestone'", "eq", String(hitMilestone));
        if ((mc ?? 0) === 0) milestoneBonus = hitMilestone;
      }
    }

    // ── Award ─────────────────────────────────────────────────────────────────
    const tokens = cfg.tokens;

    await supabase.from("token_events").insert({
      user_id:    userId,
      action:     awardAction,
      tokens,
      meta:       Object.keys(meta).length > 0 ? meta : null,
      awarded_on: dt,
    });

    // Achievements: first-time-action unlocks (non-blocking, never fails the award —
    // must run AFTER the insert above so the count check sees this event).
    if (FIRST_TIME_ACHIEVEMENTS[awardAction]) {
      awardFirstTimeAchievement(userId, awardAction, FIRST_TIME_ACHIEVEMENTS[awardAction]).catch(() => {});
    }
    if (awardAction === "streak_day" && milestoneBonus === 7) {
      awardAchievement(userId, "streak_7").catch(() => {});
    }

    // Read current points, apply increment
    const { data: userRow } = await supabase
      .from("users").select("points").eq("id", userId).maybeSingle();
    const newPoints = (userRow?.points ?? 0) + tokens;

    const userPatch = { points: newPoints, ...(streakPatch ?? {}) };
    await supabase.from("users").update(userPatch).eq("id", userId);

    const tier     = getTier(newPoints);
    const prevTier = getTier(newPoints - tokens);
    const tierUp   = tier !== prevTier;

    // Upsert leaderboard — only include streak when it's being updated this award
    // (omitting it preserves the stored streak; writing null would erase it)
    const lbPayload: any = {
      user_id:    userId,
      points:     newPoints,
      tier,
      updated_at: new Date().toISOString(),
    };
    if (streakPatch?.streak != null) lbPayload.streak = streakPatch.streak;
    supabase.from("leaderboard").upsert(lbPayload, { onConflict: "user_id" }).then(() => {}, () => {});

    // Check for milestone rank crossing (non-blocking — rank notif must never block awards)
    checkAndNotifyRank(userId, newPoints, newPoints - tokens).catch(() => {});

    // Award milestone bonus if hit
    let milestoneResult = null;
    if (milestoneBonus) {
      await supabase.from("token_events").insert({
        user_id:    userId,
        action:     "streak_milestone",
        tokens:     ACTIONS.streak_milestone.tokens,
        meta:       { milestone: milestoneBonus },
        awarded_on: dt,
      });
      const bonusPoints = newPoints + ACTIONS.streak_milestone.tokens;
      await supabase.from("users").update({ points: bonusPoints }).eq("id", userId);
      // Sync leaderboard with milestone bonus (was previously missing — caused points drift)
      supabase.from("leaderboard").upsert({
        user_id:    userId,
        points:     bonusPoints,
        tier:       getTier(bonusPoints),
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id" }).then(() => {}, () => {});
      milestoneResult = { milestone: milestoneBonus, bonusTokens: ACTIONS.streak_milestone.tokens };
    }

    return res.status(200).json({
      awarded:   true,
      tokens,
      newTotal:  newPoints + (milestoneResult?.bonusTokens ?? 0),
      tier,
      tierUp,
      streak:    streakPatch?.streak ?? null,
      milestone: milestoneResult ?? null,
    });
  }

  return res.status(400).json({
    error: "Unknown action. Use ?action=award (POST) or ?action=summary (GET)",
  });
}

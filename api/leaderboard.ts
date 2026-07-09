// api/leaderboard.js — Leaderboard ranking agent.
//
// Read-only and product-data only (no brain, no LLM), so it can't interfere with any
// other work. The Leaderboard page today fetches only the top-50-by-points and re-sorts
// client-side, so its GPA / Streak / Study-Time boards aren't actually the true top by
// those metrics. This ranks the whole opted-in population server-side per category and
// returns the visible top-N plus the requester's TRUE rank even when they're outside it.
//
// POST { userId?, category?, scope?, scopeValue?, limit? }
//   category : tokens | study_time | streak | gpa
//              (grind | late_night | social | brain | influencer → declared, not yet rankable)
//   scope    : global | university | city | country   (default global)
//   scopeValue: school/city/country name; derived from userId when omitted

import { createClient } from "@supabase/supabase-js";
import { CATEGORIES, getCategory, scopeFilter, rankRows, findUserRank } from "../src/lib/leaderboard.js";

const MAX_POPULATION = 2000; // rows scanned per request (cap for a single-region board)

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !key) return res.status(500).json({ error: "leaderboard not configured" });
  const supabase = createClient(supabaseUrl, key);

  const { userId = null, category = "tokens", scope = "global", scopeValue = null, limit = 50 } = req.body ?? {};

  const cat = getCategory(category);
  if (!cat) {
    return res.status(400).json({ error: `unknown category "${category}"`, categories: CATEGORIES.map(c => c.key) });
  }
  // Declared-but-not-yet-rankable category: say so honestly instead of faking a board.
  if (!cat.available) {
    return res.status(200).json({ category: cat.key, label: cat.label, available: false, reason: cat.reason, rows: [], me: null });
  }

  try {
    // Base population: users with profile + the rankable metric fields.
    const { data: users, error: uErr } = await supabase
      .from("users")
      .select("id, name, school, city, country, continent, leaderboard_opt_in, gpa, streak, study_time")
      .limit(MAX_POPULATION);
    if (uErr) throw new Error(uErr.message);

    // Tokens live in the leaderboard table — merge them in only when ranking by points.
    const pointsMap: Record<string, number> = {};
    const tierMap: Record<string, string> = {};
    if (cat.metric === "points") {
      const { data: lb } = await supabase.from("leaderboard").select("user_id, points, tier").limit(MAX_POPULATION);
      (lb ?? []).forEach(r => { pointsMap[r.user_id] = r.points ?? 0; tierMap[r.user_id] = r.tier ?? "Basic"; });
    }

    // Derive the requester's scope value (their school/city/country) when not supplied.
    let effScopeValue = scopeValue;
    if (scope !== "global" && !effScopeValue && userId) {
      const meRow = (users ?? []).find(u => u.id === userId);
      const f = scope === "university" ? "school" : scope;
      effScopeValue = meRow?.[f] ?? null;
    }

    const rows = (users ?? []).map(u => ({
      userId:     u.id,
      // Opted-out students still appear (ranking integrity) but never by name.
      name:       u.leaderboard_opt_in === false ? "Anonymous Scholar" : (u.name ?? "Anonymous"),
      school:     u.school ?? null,
      city:       u.city ?? null,
      country:    u.country ?? null,
      continent:  u.continent ?? null,
      optedOut:   u.leaderboard_opt_in === false,
      points:     cat.metric === "points" ? (pointsMap[u.id] ?? null) : null,
      tier:       tierMap[u.id] ?? "Basic",
      study_time: u.study_time ?? null,
      streak:     u.streak ?? null,
      gpa:        u.gpa ?? null,
    }));

    const scoped = scopeFilter(rows, scope, effScopeValue);
    const ranked = rankRows(scoped, cat.metric);
    const me = findUserRank(ranked, userId);
    const top = Math.min(Number(limit) || 50, 200);

    return res.status(200).json({
      category:   cat.key,
      label:      cat.label,
      available:  true,
      scope,
      scopeValue: effScopeValue,
      count:      ranked.length,
      rows: ranked.slice(0, top).map(r => ({
        rank: r.rank, userId: r.userId, name: r.name, value: r.value,
        school: r.school, city: r.city, country: r.country, tier: r.tier,
      })),
      me, // the requester's true {rank, value}, even if outside the top-N above
    });
  } catch (err: any) {
    return res.status(502).json({ error: err.message });
  }
}

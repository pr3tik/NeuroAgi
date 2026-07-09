// api/_achievements.ts — award/check helpers for the achievements system.
// Achievement *metadata* (name/icon/description) lives client-side in
// src/lib/achievements.ts — this file only knows keys and unlock/notify logic.
import { createClient } from "@supabase/supabase-js";
import { notify } from "./_notify.js";

let _db: any = null;
function db() {
  if (!_db) {
    const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "";
    const key = process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? "";
    _db = createClient(url, key);
  }
  return _db;
}

// Notification copy, kept in sync with src/lib/achievements.ts's ACHIEVEMENTS catalog
// (name/description) — duplicated here since server code (api/) can't import from src/.
const ACHIEVEMENT_NOTIF: Record<string, { title: string; body: string }> = {
  first_canvas_sync:          { title: "Achievement unlocked: Synced Up",          body: "You connected your first course." },
  first_quiz_perfect:         { title: "Achievement unlocked: Perfectionist",      body: "Perfect score on a quiz." },
  streak_7:                   { title: "Achievement unlocked: One Week Strong",    body: "7-day study streak." },
  first_room_join:            { title: "Achievement unlocked: Not Studying Alone", body: "Joined your first Study Room." },
  first_assignment_submitted: { title: "Achievement unlocked: On It",              body: "Logged your first submitted assignment." },
  first_flashcards_generated: { title: "Achievement unlocked: Deck Builder",       body: "Generated your first flashcard set." },
  // Technique-type achievements — duplicated from src/lib/techniqueTypes.ts (server
  // code can't import from src/). Keep both lists in sync when adding an 8th technique.
  type_dual_coding:               { title: "Achievement unlocked: The Owl 🦉",       body: "Dual coding — pairing visuals with explanation — is your strongest technique." },
  type_retrieval_practice:        { title: "Achievement unlocked: The Fox 🦊",       body: "Retrieval practice — sharp, quick recall — is your strongest technique." },
  type_elaborative_interrogation: { title: "Achievement unlocked: The Raven 🐦‍⬛",    body: "Elaborative interrogation — digging for \"why\" — is your strongest technique." },
  type_self_explanation:          { title: "Achievement unlocked: The Parrot 🦜",    body: "Self-explanation — talking it through in your own words — is your strongest technique." },
  type_concrete_example:          { title: "Achievement unlocked: The Elephant 🐘",  body: "Concrete examples — vivid, grounded anchors — is your strongest technique." },
  type_interleaving:              { title: "Achievement unlocked: The Chameleon 🦎", body: "Interleaving — mixing topics — is your strongest technique." },
  type_spaced_callback:           { title: "Achievement unlocked: The Tortoise 🐢",  body: "Spaced callback — coming back over time — is your strongest technique." },
};

/** Idempotent: inserts into user_achievements (the (user_id, achievement_key) PK
 *  stops duplicates) and fires a "milestone" notification only on the first real
 *  unlock. `meta` is optional extra context (e.g. { nickname, strategy_kind } for
 *  technique achievements in Phase B). */
export async function awardAchievement(
  userId: string,
  key: string,
  meta: Record<string, unknown> | null = null
): Promise<"unlocked" | "already_unlocked" | "error"> {
  const { error } = await db().from("user_achievements").insert({ user_id: userId, achievement_key: key, meta });
  if (error) {
    if ((error as { code?: string }).code === "23505") return "already_unlocked"; // PK conflict = already unlocked
    console.error("[achievements] insert failed:", error.message);
    return "error";
  }
  const copy = ACHIEVEMENT_NOTIF[key] ?? { title: `Achievement unlocked: ${key}`, body: "" };
  await notify(userId, "milestone", { title: copy.title, body: copy.body, data: { achievementKey: key, ...meta } });
  return "unlocked";
}

/** Has this user already unlocked `key`? */
export async function hasAchievement(userId: string, key: string): Promise<boolean> {
  const { data } = await db().from("user_achievements")
    .select("achievement_key").eq("user_id", userId).eq("achievement_key", key).maybeSingle();
  return !!data;
}

/** First-time-only awarder: checks whether this is the user's first-ever
 *  token_events row for `action`, and if so awards `achievementKey`. Call
 *  fire-and-forget (`.catch(() => {})`) right after a successful award insert in
 *  api/token-engine.ts — must never block or fail the award response. */
export async function awardFirstTimeAchievement(userId: string, action: string, achievementKey: string): Promise<void> {
  const { count } = await db().from("token_events")
    .select("id", { count: "exact", head: true }).eq("user_id", userId).eq("action", action);
  if ((count ?? 0) === 1) await awardAchievement(userId, achievementKey);
}

// ── Technique-type achievements (Phase B) ─────────────────────────────────────
// Not a "learning styles" bucket — an empirical per-technique success rate. Only
// unlocks once there's enough evidence to be confident, matching the same
// cold-start caution as the read-side hint matching in find_teaching_strategy_hint.
const TECHNIQUE_MIN_ATTEMPTS = 5;
const TECHNIQUE_MIN_RATE     = 0.7;

/** Call after bump_student_strategy_affinity's success path, with the row it
 *  returns. Awards `type_${strategyKind}` once the student's own success rate on
 *  that technique crosses the confidence threshold. No-op below threshold;
 *  idempotent above it (awardAchievement handles the PK-conflict case). */
export async function awardTechniqueTypeIfEligible(
  userId: string,
  strategyKind: string,
  successCount: number,
  attemptCount: number
): Promise<void> {
  if (attemptCount < TECHNIQUE_MIN_ATTEMPTS) return;
  if (successCount / attemptCount < TECHNIQUE_MIN_RATE) return;
  await awardAchievement(userId, `type_${strategyKind}`, { strategyKind });
}

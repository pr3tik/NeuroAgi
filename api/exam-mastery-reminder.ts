/**
 * api/exam-mastery-reminder.ts — Vercel Cron Job.
 * Runs daily. Finds canvas_quizzes due within the reminder window that haven't been
 * reminded about yet, and proposes an "exam_mastery" signal to the Arbiter combining:
 *   - days until the exam
 *   - an estimated mastery % on the topics it likely covers, reasoned from the
 *     student's Deck Signature Analysis profile (api/deck-profile.ts, Phase G) — real
 *     per-topic confidence grounded in their actual flashcards + review history, not
 *     a guess from nothing.
 *
 * "Already reminded" is tracked via canvas_quizzes.topics_generated_at (set the first
 * time a quiz is processed) — proposeProactive's dedup only holds while a signal is
 * PENDING, so without this a quiz still in the window would get re-proposed every day.
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_KEY, CRON_SECRET (fail-closed).
 */
import { proposeProactive } from "./_notify.js";
import { fetchDeckData, generateProfile, sbHeaders } from "./deck-profile.js";
import { callModel } from "./_gateway.js";

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

const REMINDER_WINDOW_MS = 3 * 24 * 60 * 60 * 1000; // remind for quizzes due within 3 days

function parseJsonLoose(text: any, fallback: any) {
  const stripped = String(text || "").replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try { return JSON.parse(stripped); } catch { /* fall through */ }
  const m = stripped.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* fall through */ } }
  return fallback;
}

async function getOrGenerateProfile(userId: string, courseId: string) {
  const r = await fetch(
    `${SB_URL}/rest/v1/deck_profiles?user_id=eq.${encodeURIComponent(userId)}&course_id=eq.${encodeURIComponent(courseId)}&select=*&limit=1`,
    { headers: sbHeaders(SB_KEY!) },
  );
  const rows = r.ok ? await r.json() : [];
  if (rows?.[0]) return rows[0];
  const result = await generateProfile(SB_URL!, SB_KEY!, userId, courseId);
  return "error" in result ? null : result.profile;
}

/** One combined call: given the quiz + the deck profile, estimate which topics are
 *  likely tested and an overall mastery %, reasoned from the profile's per-topic
 *  confidence (grounded in real flashcard/review data, not guessed from nothing). */
async function assessMastery(quizTitle: string, courseName: string, profile: any) {
  const sys = "You estimate a student's exam readiness from their study data. Respond with STRICT JSON only, no prose.";
  const prompt = `Exam: "${quizTitle}" in ${courseName}.

This student's flashcard deck for this course has been analyzed with these topics and confidence levels (0-1, grounded in their actual review performance):
${JSON.stringify(profile?.topics ?? [], null, 2)}

Deck style: ${profile?.style_notes || "(not available)"}

Estimate which of these topics (or closely related ones an exam with this title would plausibly cover) are being tested, and produce an overall mastery percentage (0-100) reasoned from the topic confidences above — weight topics likely to be tested more heavily; a topic with no data at all should pull the estimate down, not be ignored.

Return JSON: {"testedTopics":["..."],"masteryPct":0,"weakestTopics":["...","..."]}`;

  const r = await callModel({
    task: "default", system: sys, messages: [{ role: "user", content: prompt }],
    max_tokens: 1500, metadata: { tool: "exam-mastery-reminder.assess" },
  });
  if (!r.ok) return null;
  const parsed = parseJsonLoose(r.content, null);
  if (!parsed) return null;
  const masteryPct = Math.max(0, Math.min(100, Math.round(Number(parsed.masteryPct) || 0)));
  return {
    testedTopics: Array.isArray(parsed.testedTopics) ? parsed.testedTopics : [],
    masteryPct,
    weakestTopics: Array.isArray(parsed.weakestTopics) ? parsed.weakestTopics.slice(0, 2) : [],
  };
}

function composeMessage(quiz: any, courseLabel: string, daysUntil: number, assessment: { masteryPct: number; weakestTopics: string[] }) {
  const dayWord = daysUntil <= 0 ? "today" : daysUntil === 1 ? "1 day" : `${daysUntil} days`;
  let body = `You have ${dayWord} for ${quiz.title} (${courseLabel}) and an estimated mastery of ${assessment.masteryPct}% on the topics being tested.`;
  if (assessment.weakestTopics.length) {
    body += ` Weakest: ${assessment.weakestTopics.join(", ")}.`;
  }
  return body;
}

function urgencyFor(daysUntil: number): number {
  if (daysUntil <= 1) return 0.8;
  if (daysUntil <= 2) return 0.6;
  return 0.4;
}

export default async function handler(req: any, res: any) {
  // Fail-closed — same pattern as api/brain-intervention.ts / api/arbiter.ts,
  // documented in CLAUDE.md's "Conventions & gotchas".
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return res.status(500).json({ error: "CRON_SECRET not configured" });
  const auth = req.headers?.authorization ?? req.headers?.["x-cron-secret"];
  if (auth !== `Bearer ${cronSecret}` && auth !== cronSecret) return res.status(401).json({ error: "Unauthorized" });

  if (!SB_URL || !SB_KEY) return res.status(200).json({ ok: false, reason: "supabase not configured" });

  const started = Date.now();
  const results = { proposed: 0, skipped: 0, errors: 0, quizzes: [] as any[] };

  try {
    const now = new Date();
    const windowEnd = new Date(now.getTime() + REMINDER_WINDOW_MS).toISOString();
    const quizzesRes = await fetch(
      `${SB_URL}/rest/v1/canvas_quizzes?due_at=gte.${encodeURIComponent(now.toISOString())}` +
      `&due_at=lte.${encodeURIComponent(windowEnd)}&topics_generated_at=is.null&select=*`,
      { headers: sbHeaders(SB_KEY) },
    );
    const quizzes = quizzesRes.ok ? await quizzesRes.json() : [];

    for (const quiz of quizzes) {
      try {
        const daysUntil = Math.max(0, Math.round((new Date(quiz.due_at).getTime() - now.getTime()) / 86_400_000));

        const courseRes = await fetch(
          `${SB_URL}/rest/v1/courses?id=eq.${encodeURIComponent(quiz.course_id)}&select=name,course_code&limit=1`,
          { headers: sbHeaders(SB_KEY) },
        );
        const courseRows = courseRes.ok ? await courseRes.json() : [];
        const course = courseRows?.[0];
        const courseLabel = course?.course_code || course?.name || "your course";

        const profile = await getOrGenerateProfile(quiz.user_id, quiz.course_id);
        if (!profile) {
          // No flashcards to reason from yet — mark processed so we don't retry forever,
          // but skip the notification (nothing honest to say about mastery).
          await fetch(`${SB_URL}/rest/v1/canvas_quizzes?id=eq.${quiz.id}`, {
            method: "PATCH", headers: { ...sbHeaders(SB_KEY), Prefer: "return=minimal" },
            body: JSON.stringify({ topics_generated_at: new Date().toISOString() }),
          }).catch(() => {});
          results.skipped++;
          continue;
        }

        const assessment = await assessMastery(quiz.title, courseLabel, profile);
        if (!assessment) { results.errors++; continue; }

        const body = composeMessage(quiz, courseLabel, daysUntil, assessment);
        const outcome = await proposeProactive(quiz.user_id, {
          agentSource: "exam_mastery", type: "exam_mastery",
          urgencyScore: urgencyFor(daysUntil), valueScore: 0.8,
          title: `${courseLabel} exam in ${daysUntil <= 1 ? "1 day" : daysUntil + " days"}`,
          body,
          channelHint: "in_app",
          dedupKey: `exam_mastery:${quiz.id}`,
          data: { quizId: quiz.id, masteryPct: assessment.masteryPct, testedTopics: assessment.testedTopics },
          expiresInHours: 24,
        });

        await fetch(`${SB_URL}/rest/v1/canvas_quizzes?id=eq.${quiz.id}`, {
          method: "PATCH", headers: { ...sbHeaders(SB_KEY), Prefer: "return=minimal" },
          body: JSON.stringify({ topics: assessment.testedTopics, topics_generated_at: new Date().toISOString() }),
        }).catch(() => {});

        if (outcome === "error") results.errors++; else results.proposed++;
        results.quizzes.push({ id: quiz.id, title: quiz.title, daysUntil, masteryPct: assessment.masteryPct, outcome });
      } catch (err) {
        console.error(`[exam-mastery-reminder] error for quiz ${quiz.id}:`, (err as Error).message);
        results.errors++;
      }
    }

    const elapsed = Date.now() - started;
    console.log(`[exam-mastery-reminder] done ${elapsed}ms`, results);
    return res.status(200).json({ ok: true, elapsed_ms: elapsed, ...results });
  } catch (err) {
    console.error("[exam-mastery-reminder] Fatal:", (err as Error).message);
    return res.status(500).json({ ok: false, error: (err as Error).message });
  }
}

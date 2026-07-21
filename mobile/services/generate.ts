// generate.ts — the AI generation pipeline, shared by Study and Reggie chat.
//
// Both surfaces produce the same artifacts (flashcards / a study guide), grounded
// in the student's own course files, and saved to the same tables Study already
// reads (flashcards_v2, canvas_data). This was extracted from app/study.tsx so
// Reggie can kick off generation straight from a chat message (B3 — "make me
// flashcards", "quiz me", "study guide") without the user hunting for a button,
// and without duplicating the prompt / parse / save logic.

import { supabase } from "./supabase";
import { apiFetch } from "./api";

export type GenCourse = { dbId: any; name: string; courseCode?: string };
export type GenCard = { id: string; question: string; answer: string };

// Same /api/groq path the rest of the app already uses.
export async function groqGen(
  messages: { role: string; content: string }[],
  system: string,
  maxTokens = 1200,
): Promise<string> {
  const d = await apiFetch("/api/groq", { messages, system, max_tokens: maxTokens });
  return d?.content ?? "";
}

// Parse the model's "Q: … | A: …" lines into cards.
export function parseCards(raw: string): { question: string; answer: string }[] {
  return raw
    .split("\n")
    .map(l => l.trim())
    .map(l => l.match(/^(?:\d+[.)]\s*)?q:\s*(.+?)\s*\|\s*a:\s*(.+)$/i))
    .filter((m): m is RegExpMatchArray => !!m)
    .map(m => ({ question: m[1].trim(), answer: m[2].trim() }))
    .filter(c => c.question && c.answer);
}

// Pull the course's own material (extension-synced file text) so generation is
// grounded in what the student is actually studying, not generic knowledge.
export async function courseSource(userId: string, courseDbId: any): Promise<string> {
  try {
    const { data } = await supabase.from("files")
      .select("name, content_text")
      .eq("user_id", userId).eq("course_id", courseDbId)
      .limit(8);
    return (data ?? [])
      .filter((f: any) => f.content_text)
      .map((f: any) => `## ${f.name}\n${String(f.content_text).slice(0, 1500)}`)
      .join("\n\n")
      .slice(0, 8000);
  } catch { return ""; }
}

function courseLabel(c: GenCourse): string {
  return c.courseCode ? `${c.courseCode} — ${c.name}` : c.name;
}

export type FlashResult = { cards: GenCard[]; saved: boolean };

// Generate flashcards grounded in the course material and save them to
// flashcards_v2. `existingQuestions` lets a caller ask for cards on DIFFERENT
// points than the ones already on screen. Returns [] cards if the model produced
// nothing parseable; `saved:false` means the insert failed (still returns cards).
export async function generateFlashcards(
  userId: string,
  course: GenCourse,
  existingQuestions: string[] = [],
  count = 8,
): Promise<FlashResult> {
  const label  = courseLabel(course);
  const source = await courseSource(userId, course.dbId);
  const seen   = existingQuestions.slice(0, 40);
  const dedup  = seen.length
    ? `\n\nThese are already covered — make cards on DIFFERENT points:\n${seen.map(q => `- ${q}`).join("\n")}`
    : "";
  const sys = "You are a study assistant. Generate flashcards. Format EVERY card as exactly:\nQ: [question] | A: [answer]\nOne per line. No numbering, no headings, no extra text.";
  const usr = `Generate ${count} flashcards for ${label}.` +
    (source ? `\n\nBase them on this course material:\n\n${source}` : ``) + dedup;

  const parsed = parseCards(await groqGen([{ role: "user", content: usr }], sys, 1200));
  if (!parsed.length) return { cards: [], saved: false };

  const rows = parsed.map(c => ({ user_id: userId, course_id: course.dbId, question: c.question, answer: c.answer }));
  const { data: inserted, error } = await supabase
    .from("flashcards_v2").insert(rows).select("id, question, answer");
  const cards: GenCard[] = (inserted ?? parsed).map((c: any, i: number) => ({
    id: String(c.id ?? `new-${Date.now()}-${i}`), question: c.question, answer: c.answer,
  }));
  return { cards, saved: !error };
}

export type GuideResult = { text: string; saved: boolean };

// Generate an exam-ready study guide grounded in the course material and save it
// to the canvas_data blob Study reads (study_guide_<courseDbId>). Returns empty
// text if the model produced nothing; `saved:false` means the write failed.
export async function generateStudyGuide(userId: string, course: GenCourse): Promise<GuideResult> {
  const label  = courseLabel(course);
  const source = await courseSource(userId, course.dbId);
  const sys = "You are a study assistant. Write a focused, exam-ready study guide using clear markdown headings and concise bullet points. No preamble, no closing remarks.";
  const usr = `Create a study guide for ${label}.` +
    (source ? `\n\nBase it on this course material:\n\n${source}`
            : `\n\nI don't have the material text yet — build a strong general study guide for this course and note (in one line) what to add for a tighter guide.`);

  const text = (await groqGen([{ role: "user", content: usr }], sys, 1600)).trim();
  if (!text) return { text: "", saved: false };

  const dt = `study_guide_${course.dbId}`;
  let saved = true;
  try {
    await supabase.from("canvas_data").delete().eq("user_id", userId).eq("data_type", dt);
    await supabase.from("canvas_data").insert({ user_id: userId, data_type: dt, payload: { text } });
  } catch { saved = false; }
  return { text, saved };
}

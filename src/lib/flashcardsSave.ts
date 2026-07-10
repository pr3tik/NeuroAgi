// src/lib/flashcardsSave.ts — write a course's flashcard deck to flashcards_v2 (per-row),
// replacing any prior deck for that (user, course).
//
// WHY: the app has two flashcard tables. The retired single-row `flashcards` table (one
// jsonb `cards` array per user+course) is NO LONGER READ anywhere — loadCanvasData and
// api/flashcards.ts both read the per-row `flashcards_v2` table. Three client writers
// (Canvas-sync auto-gen, the InlineQuiz "save to flashcards", and voice generate-
// flashcards) were still upserting into the dead `flashcards` table, so every card they
// produced was invisible in Study. This routes them to flashcards_v2 in the shape the
// reader expects. Replace-deck semantics (delete this course's rows, then insert) match
// the old single-row upsert, which replaced the whole deck per course.
//
// Accepts cards shaped {question,answer} OR {q,a}. courseId null → the null-course deck
// (matched with .is, since PostgREST `eq null` never matches).
export async function replaceFlashcardDeck(
  sb: any,
  userId: string,
  courseId: any,
  cards: Array<{ question?: string; answer?: string; q?: string; a?: string }>,
): Promise<{ saved: number }> {
  const rows = (cards || [])
    .map((c) => ({ question: (c.question ?? c.q ?? "").trim(), answer: (c.answer ?? c.a ?? "").trim() }))
    .filter((c) => c.question && c.answer)
    .map((c) => ({ user_id: userId, course_id: courseId ?? null, question: c.question, answer: c.answer }));
  if (!rows.length) return { saved: 0 };

  let del = sb.from("flashcards_v2").delete().eq("user_id", userId);
  del = courseId == null ? del.is("course_id", null) : del.eq("course_id", courseId);
  await del;

  const { error } = await sb.from("flashcards_v2").insert(rows);
  if (error) throw new Error(error.message ?? "flashcard insert failed");
  return { saved: rows.length };
}

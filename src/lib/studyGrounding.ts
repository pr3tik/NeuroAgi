// studyGrounding.ts — decide the toast shown after generating flashcards / a study guide.
// When no real course material was retrieved (RAG, files.content_text, or Canvas all
// empty), the model generates from the course name alone — convincing but ungrounded, so
// the student could study the wrong topics. We still generate, but flag it as a warning
// rather than a success. Pure logic so it can be unit-tested without rendering Study.

export type StudyMode = "flashcards" | "guide";
export interface StudyToast { message: string; kind: "ok" | "warn"; }

export function groundingToast(mode: StudyMode, grounded: boolean, count = 0): StudyToast {
  if (mode === "flashcards") {
    return grounded
      ? { message: `${count} new flashcards added!`, kind: "ok" }
      : {
          message: `Added ${count} cards from general knowledge — upload this course's notes or slides for cards based on your actual material.`,
          kind: "warn",
        };
  }
  return grounded
    ? { message: "Study guide saved!", kind: "ok" }
    : {
        message: "Heads up — this guide is from general knowledge, not your uploaded materials. Upload notes or slides for a guide tied to your actual course.",
        kind: "warn",
      };
}

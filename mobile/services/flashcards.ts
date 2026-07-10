import { apiFetch } from "./api";

export const loadFlashcards = (userId: string, courseId: string) =>
  apiFetch("/api/flashcards", { action: "load", userId, courseId });

export const saveFlashcards = (userId: string, courseId: string, cards: { question: string; answer: string }[]) =>
  apiFetch("/api/flashcards", { action: "save", userId, courseId, cards });

export const deleteFlashcard = (userId: string, cardId: string) =>
  apiFetch("/api/flashcards", { action: "delete", userId, cardId });

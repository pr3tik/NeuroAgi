// src/lib/voiceTags.ts — voice-mode UI tag protocol, shared by the classic tutor and
// Reggie mode (extracted from NeuralRing so both paths parse identically and it's unit-
// testable). The model embeds bracket tags in its reply; the client strips them from the
// displayed/spoken text and executes the action.

/** Extracts [VOICE:x], [SPEED:x], [TONE:x], [READ:x], [QUIZ:x], [SYNC],
 *  [GENERATE_FLASHCARDS:course], [NAVIGATE:page] from a model reply.
 *  Argument-less tags (e.g. [SYNC]) become `true`; others keep their string value. */
export function parseVoiceTags(raw: string): { tags: Record<string, any>; cleaned: string } {
  const tags: Record<string, any> = {};
  let cleaned = raw;
  const re = /\[(VOICE|SPEED|TONE|READ|QUIZ|SYNC|GENERATE_FLASHCARDS|NAVIGATE):?([^\]]*)\]/gi;
  let m;
  while ((m = re.exec(raw)) !== null) {
    tags[m[1].toUpperCase()] = m[2].trim() || true;
    cleaned = cleaned.replace(m[0], "");
  }
  return { tags, cleaned: cleaned.trim() };
}

/** Strip stray tool-call JSON the model sometimes emits as text — e.g.
 *  {"name":"recall","arguments":{...}} — when it believes a tool is wired.
 *  Defensive backstop on final text before display/TTS. */
export function stripAgentJSON(text: any): any {
  if (typeof text !== "string") return text;
  return text
    .replace(/\{\s*"name"\s*:\s*"[^"]+"\s*,\s*"arguments"\s*:\s*\{[^{}]*\}\s*\}/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The system-prompt addendum that TEACHES the model the voice-tag protocol. Served by
 *  Reggie's loop when the client says the student is in voice mode; the classic tutor
 *  carries equivalent instructions in its own system prompt. Keep tag names in sync
 *  with parseVoiceTags. */
export const VOICE_TAGS_ADDENDUM = `
The student is in VOICE mode — your reply is spoken aloud. Keep it conversational and short (2-4 sentences unless asked for detail). You can control the voice UI by embedding bracket tags anywhere in your reply (they are stripped before display/speech):
- [SYNC] — when they ask to sync/refresh their Canvas data.
- [GENERATE_FLASHCARDS:<course name>] — when they ask you to make flashcards BY VOICE for a course.
- [VOICE:<voice name or description>] — when they ask for a different voice.
- [SPEED:<0.7-1.3>] — when they ask you to speak faster or slower.
- [TONE:calm|energetic|neutral|serious] — when they ask for a different tone.
Only emit a tag when the student explicitly asks for that action. Never mention the tags themselves.`;

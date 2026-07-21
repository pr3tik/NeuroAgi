// roomAiTrigger.ts — the pure decision logic behind the in-room AI ("Reggie").
//
// The orchestration (calling the LLM, generating TTS, broadcasting) lives in the room
// component, but the parts that must be deterministic and testable live here:
//
//  1. electDriver — exactly ONE client per room runs the AI loop, or the AI answers
//     twice and talks over itself. The driver is the joined member with the smallest
//     userId; every client computes the same winner from the same roster, with no
//     negotiation round-trip. Re-run it whenever the roster changes.
//  2. parseWakeWord — detect an explicit spoken summon ("hey Reggie, …") in a committed
//     transcript segment and return the actual question.
//  3. buildAiPrompt — assemble the room conversation + the ask into one grounded,
//     voice-appropriate instruction for the group tutor endpoint.

/** The driver = smallest userId among present members. Returns null for an empty room. */
export function electDriver(memberIds: string[]): string | null {
  if (!memberIds.length) return null;
  let min = memberIds[0];
  for (const id of memberIds) if (id < min) min = id;
  return min;
}

/** Am I the one client that should run the AI loop? Alone in the room → yes. */
export function isDriver(memberIds: string[], selfId: string): boolean {
  const d = electDriver(memberIds.length ? memberIds : [selfId]);
  return d === selfId;
}

// Wake-word matching has to survive real STT output: ElevenLabs routinely hears "Reggie"
// as "rajeev", "reggy", "veggie", etc. So we don't match a fixed spelling — we accept a
// small set of known phonetic mis-hearings PLUS anything within edit-distance 2 of the
// name. Greeting words let the name appear a little later in the utterance.
const GREETINGS = new Set(["hey", "hi", "ok", "okay", "yo", "um", "hmm", "so", "hey,"]);
// Words that, right after the name, mark it as a real address ("reggie help", "reggie what…").
const IMPERATIVE = new Set(["help", "explain", "what", "whats", "how", "why", "can", "could", "would",
  "tell", "show", "please", "give", "teach", "walk", "break", "summarize", "summarise", "i", "we", "im", "do", "does"]);
// Phonetic mis-hearings that are NOT close in spelling (edit distance alone won't catch).
const PHONETIC_ALIASES = new Set(["rajeev", "rajiv", "raji", "rajee", "reji", "ragy", "rejee", "rajv", "rajeeu"]);

function normWord(w: string): string { return w.toLowerCase().replace(/[^a-z]/g, ""); }

// Classic Levenshtein, small strings.
function editDistance(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
    dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
  }
  return dp[m][n];
}

/** Does this single word plausibly mean "Reggie" after STT mangling? */
export function isReggieLike(word: string): boolean {
  const w = normWord(word);
  if (!w || w.length < 3) return false;
  if (PHONETIC_ALIASES.has(w)) return true;
  return editDistance(w, "reggie") <= 2 || editDistance(w, "reggy") <= 1;
}

/**
 * If `text` summons the AI, return the question (possibly ""); otherwise null. "" means
 * "summoned with no explicit question". The name counts as a summon when it's a genuine
 * ADDRESS — at the start, after a greeting, comma-adjacent ("…, Reggie, help"), or followed
 * by a request word — anywhere in the utterance, so "I'm stuck. Reggie, help me out" (one
 * STT segment) is caught even though the name isn't first. A stray "reggie"/"veggie" buried
 * in a sentence without any of those signals is ignored.
 */
export function parseWakeWord(text: string): string | null {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    if (!isReggieLike(words[i])) continue;
    const prev = words[i - 1] || "";
    const next = words[i + 1] || "";
    const isAddress =
      i === 0 ||
      GREETINGS.has(normWord(prev)) ||
      words[i].includes(",") ||        // "reggie,"
      prev.endsWith(",") ||            // "…, reggie"
      IMPERATIVE.has(normWord(next));
    if (!isAddress) continue;
    const after = words.slice(i + 1).join(" ").replace(/^[\s,:.!?-]+/, "").trim();
    if (after) return after;
    // Name at the end ("help me out, reggie") → the request is what came before it, minus
    // any leading greeting ("hey reggie" → "").
    const before = words.slice(0, i);
    while (before.length && GREETINGS.has(normWord(before[0]))) before.shift();
    return before.join(" ").replace(/[\s,:.!?-]+$/, "").trim();
  }
  return null;
}

/**
 * Build the group-tutor prompt: the recent room conversation, the ask, and voice-agent
 * instructions (short, spoken, no markdown). `question` may be empty — then the AI helps
 * with whatever the room is currently discussing.
 */
export function buildAiPrompt(transcript: string, askerName: string, question: string): string {
  const convo = transcript ? `Room conversation so far (most recent last):\n${transcript}\n\n` : "";
  const q = String(question || "").trim();
  const ask = q
    ? `${askerName} just asked you, out loud, in the room: "${q}"`
    : `${askerName} summoned you to help with what the room is currently discussing.`;
  return (
    `${convo}${ask}\n\n` +
    `You are Reggie, a friendly study-room tutor speaking OUT LOUD to the whole room. ` +
    `Reply in one to three short spoken sentences — plain words only, no markdown, no lists, ` +
    `no emoji. Speak naturally, like a person in the room: address people by name where it fits ` +
    `(their names are in the transcript) and refer back to what they actually said. Stay ` +
    `encouraging, and ground your answer in what they're discussing.` + SOLVE_TAIL
  );
}

// Shared tail: after each explanation Reggie checks in, and only ends the loop once the
// student confirms. The [SOLVED] token is stripped by the client before anything is spoken
// or shown — it exists purely so the model, not a keyword guess, decides when we're done.
const SOLVE_TAIL =
  `\n\nAfter your answer, check in with the room in one short line — ask if that clears it up ` +
  `or if there's anything else. If (and ONLY if) they then confirm they're satisfied or have ` +
  `no more questions, give a brief warm closer and put the token [SOLVED] at the very end of ` +
  `your message. Never write [SOLVED] at any other time.`;

// ── Proactive / ambient path (R7) ───────────────────────────────────────────────
// Stage A: a free keyword gate the driver runs on the recent conversation before ever
// spending an LLM call. It's intentionally a coarse filter — its only job is to skip the
// vast majority of segments where nobody is asking for or needing help. Stage B (the LLM)
// makes the real decision.
const CONFUSION_PATTERNS: RegExp[] = [
  /\b(?:i|we)\s*(?:'?m|'?re| am| are)?\s*(?:really |so |totally |kinda |a bit )?(?:confused|lost|stuck|puzzled)\b/,
  /\b(?:don'?t|do not|doesn'?t|does not|didn'?t|can'?t)\s+(?:really\s+)?(?:get|understand|follow|figure)\b/,
  /\bno idea\b/,
  /\bnot sure (?:what|how|why|if|about)\b/,
  /\bwait,?\s*what\b/,
  /\bwhat do you mean\b/,
  /\b(?:makes no sense|doesn'?t make sense|no sense)\b/,
  /\bcan (?:someone|somebody|anyone|you) (?:explain|help)\b/,
  /\bhelp\b[^.?!]*\b(?:with|me|understand|this)\b/,
  /\bhow (?:do|does|did|would|can) (?:i|you|we|it|this|that)\b/,
  /\bwhy (?:do|does|is|are|isn'?t|aren'?t|won'?t)\b/,
];

/** Stage A: does the recent text carry a confusion / help-request signal? */
export function detectConfusion(text: string): boolean {
  const s = String(text || "").toLowerCase();
  if (!s) return false;
  return CONFUSION_PATTERNS.some(re => re.test(s));
}

/**
 * Stage B prompt: the LLM both DECIDES and (if it decides to help) GENERATES in one call.
 * It replies with exactly "SILENT" to stay out of the way, otherwise a single spoken hint.
 */
export function buildProactivePrompt(transcript: string): string {
  return (
    `You are Reggie, quietly observing a study room. Here is the recent conversation:\n\n` +
    `${transcript}\n\n` +
    `Decide: is someone clearly stuck or confused, such that one brief hint would help right now?\n` +
    `- If the room is flowing fine, or they're already working it out themselves, reply with EXACTLY the single word: SILENT\n` +
    `- Otherwise reply with ONE short spoken sentence of help — address the stuck person by name (their names are in the transcript), plain words, no markdown, no lists, no emoji — and nothing else.`
  );
}

/** True when the proactive reply means "don't interject" (SILENT / empty). */
export function isProactiveSilent(reply: string): boolean {
  const s = String(reply || "").trim().toUpperCase();
  return s === "" || s === "SILENT" || s.startsWith("SILENT");
}

// ── Query-solving loop ──────────────────────────────────────────────────────────
// Once a question is asked, Reggie stays in a back-and-forth until it's resolved. These
// patterns detect a user signalling they're satisfied, so the loop can end on its own.
const DONE_PATTERNS: RegExp[] = [
  /\b(?:thanks|thank you|thx|ty)\b/,
  /\b(?:got it|makes sense|that helps|helps a lot|understood|i (?:get|understand) (?:it|this|that|now)|i see now|clear now)\b/,
  /\b(?:we'?re good|i'?m good|that'?s all|that'?s it|all good|no more questions|no further questions)\b/,
  /\b(?:that'?s enough|we'?re done|i'?m done|stop reggie|reggie stop)\b/,
];

/** Does the latest message signal the question is resolved (end the solve loop)? */
export function isSolveDone(text: string): boolean {
  const s = String(text || "").toLowerCase();
  if (!s) return false;
  return DONE_PATTERNS.some(re => re.test(s));
}

/**
 * Follow-up prompt for the ongoing solve loop: respond to the latest message, keep helping,
 * and wrap up the moment the room understands or says they're done.
 */
export function buildSolvePrompt(transcript: string): string {
  return (
    `You are Reggie, helping a study room work through a question — this is an ongoing back-and-forth, not a one-off answer.\n\n` +
    `${transcript}\n\n` +
    `Respond to the latest message and keep helping until they understand. A short guiding question is fine if it moves them forward. ` +
    `Reply in one to three short spoken sentences — plain words, no markdown, no lists, no emoji — addressing people by name where it fits.` + SOLVE_TAIL
  );
}

/** Strip the hidden [SOLVED] control token from a reply (never spoken or shown). */
export function stripSolvedToken(text: string): string {
  return String(text || "").replace(/\[solved\]/ig, "").trim();
}

/** Did the reply signal the loop is resolved via the [SOLVED] token? */
export function hasSolvedToken(text: string): boolean {
  return /\[solved\]/i.test(String(text || ""));
}

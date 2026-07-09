// tutorReply.ts — guard the tutor's final text so an empty or filler-only reply never
// reaches the user as a blank/dangling bubble. When grounding comes back empty the model
// sometimes stalls — emitting a filler like "One sec." (often followed by tool-call JSON
// that gets stripped), which left the chat showing a blank bubble or a dangling "One sec."
// and going silent. Pure logic so it can be unit-tested without rendering NeuralRing.

// Matches replies that are ONLY a stall/acknowledgement with no real content.
const FILLER_ONLY = /^(one\s*sec(ond)?|just a sec(ond)?|hold on|let me (check|see|look)( that up)?|give me (a|one) (sec(ond)?|moment)|sure|okay|ok)[\s.,!…]*$/i;

export function isFillerOnly(text: string): boolean {
  const t = (text ?? "").trim();
  return t.length > 0 && FILLER_ONLY.test(t);
}

export function tutorFallback(hasGrounding: boolean): string {
  return hasGrounding
    ? "Sorry — I couldn't pull that together just now. Try rephrasing, or ask about a specific topic and I'll dig in."
    : "I don't have any of your course materials loaded yet, so I can't give you a grounded answer. Upload your notes or a PDF (or sync Canvas) and I'll work from those.";
}

// Final guard applied to the cleaned reply. Empty/filler-only replies become a useful
// fallback — EXCEPT when the model is navigating, where empty text is intentional.
export function ensureTutorReply(
  cleanText: string,
  opts: { isNav: boolean; hasGrounding: boolean }
): string {
  if (opts.isNav) return cleanText;
  const t = (cleanText ?? "").trim();
  if (!t || isFillerOnly(t)) return tutorFallback(opts.hasGrounding);
  return cleanText;
}

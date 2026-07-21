// src/lib/roomGrounding.ts — pure logic for the in-room "grounding chips".
//
// The room AI turn (api/room-ai.ts) returns a `grounded` payload (GroundingRef) alongside every
// answer: which shared room sources it drew on, the whiteboard revision in context, and an honest
// "general knowledge" flag when it grounded on nothing. This helper reduces that raw payload to the
// exact chips the UI should show — deduped, capped, and with the honesty rules applied — so the
// React component stays a thin, dependency-free renderer and the decisions are unit-testable.

export type GroundingRef = {
  sources?: { documentId: string; title: string }[] | null;
  boardRevision?: number | null;
  planVersion?: number | null;
  generalKnowledge?: boolean | null;
};

export type GroundingChips = {
  sources: string[];              // deduped, non-empty source titles (capped)
  boardRevision: number | null;   // whiteboard revision the answer saw, if any
  general: boolean;               // show the honest "general knowledge" label
  show: boolean;                  // whether there is anything at all to render
};

const MAX_SOURCE_CHIPS = 6;

/** Reduce a raw room-ai `grounded` payload to renderable chips. Pure; safe on null/garbage. */
export function groundingChips(g: GroundingRef | null | undefined): GroundingChips {
  const out: GroundingChips = { sources: [], boardRevision: null, general: false, show: false };
  if (!g || typeof g !== "object") return out;

  const seen = new Set<string>();
  for (const s of Array.isArray(g.sources) ? g.sources : []) {
    const t = (s?.title ?? "").trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.sources.push(t);
    if (out.sources.length >= MAX_SOURCE_CHIPS) break;
  }

  out.boardRevision = typeof g.boardRevision === "number" ? g.boardRevision : null;

  // "General knowledge" is only honest — and only worth showing — when the answer truly cited
  // nothing: no room source AND no board. Never contradict a visible source/board chip with it.
  out.general = !!g.generalKnowledge && out.sources.length === 0 && out.boardRevision == null;

  out.show = out.sources.length > 0 || out.boardRevision != null || out.general;
  return out;
}

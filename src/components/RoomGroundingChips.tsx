import type { CSSProperties } from "react";
import { groundingChips, type GroundingRef } from "../lib/roomGrounding";

// Compact "what this answer is grounded in" chips shown under an in-room Reggie reply:
// the shared room sources it used, the whiteboard revision in context, or an honest
// "General knowledge" label when it grounded on nothing. Presentational only — all the
// decisions live in the unit-tested groundingChips() helper.

const CHIP: CSSProperties = {
  fontSize: 10.5,
  padding: "2px 8px",
  borderRadius: 999,
  background: "rgba(var(--teal-rgb),0.14)",
  border: "1px solid rgba(var(--teal-rgb),0.28)",
  color: "var(--text-dim, #9aa0b0)",
  maxWidth: 220,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

export default function RoomGroundingChips({ grounded }: { grounded?: GroundingRef | null }) {
  const g = groundingChips(grounded);
  if (!g.show) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 5 }} aria-label="Sources for this answer">
      {g.sources.map((t, i) => (
        <span key={i} title={t} style={CHIP}>📄 {t.length > 30 ? t.slice(0, 29) + "…" : t}</span>
      ))}
      {g.boardRevision != null && <span style={CHIP}>✎ Board rev {g.boardRevision}</span>}
      {g.general && <span style={{ ...CHIP, opacity: 0.75 }} title="This answer wasn't drawn from your room materials">General knowledge</span>}
    </div>
  );
}

// BoardCards.tsx — structured study cards on the collaborative whiteboard.
// Cards are a THIRD shared structure in the room's Y.Doc (alongside strokes/meta):
// draggable material that any member — or Reggie — can place on the board. Rendered as
// DOM inside the whiteboard's zoom/pan wrapper, positioned in board-percentage space
// exactly like the text-input overlay, so they track pan/zoom for free.
//
// Five kinds, all sharing one chrome (header/drag/delete/attribution) and differing only
// in the body:
//   note      markdown paragraph
//   quiz      question + interactive options, answered collaboratively
//   guide     a structured study guide — markdown sections, wider and taller, scrollable
//   terms     a key-terms definition list (NOT markdown — the shape IS the content)
//   reference points at a REAL indexed course file; the server guarantees the file exists
//
// An unknown/legacy `kind` falls back to the note rendering rather than crashing — the
// Y.Doc is shared and long-lived, so old clients and old cards must keep working.
//
// All mutations go through callbacks — StudyRooms owns the Y.Array; this component
// never touches Yjs directly (same contract as strokes).

import { useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { X, GripHorizontal, Check, Sparkles, BookOpen, ListChecks, FileText } from "lucide-react";

export type BoardCardKind = "note" | "quiz" | "guide" | "terms" | "reference";
export type BoardCardTerm = { term: string; definition: string };

export type BoardCard = {
  id: string;
  kind: BoardCardKind;
  title: string;
  content?: string;          // markdown (quiz: the question text). Absent on terms/reference.
  x: number;                 // board px (0..BOARD_W)
  y: number;                 // board px (0..BOARD_H)
  w: number;                 // board px
  createdBy: string;         // display name; "Reggie" gets the sparkle badge
  createdAt: number;
  // quiz-only
  quizOptions?: string[];
  correctOptionIndex?: number;
  explanation?: string;
  // shared quiz state: latest answer wins the reveal (collaborative, not per-user)
  answeredIndex?: number;
  answeredBy?: string;
  // terms-only
  terms?: BoardCardTerm[];
  // reference-only — documentId/sourceTitle are SERVER-supplied and always name a real
  // indexed course file; api/room-ai.ts drops any reference it can't match to retrieval.
  why?: string;
  documentId?: string;
  sourceTitle?: string;
};

// Accent per kind, as a bare "r, g, b" triple so call sites keep their own alpha.
// NOTE: these values are only ever interpolated into `style` objects (real CSS), never
// into an SVG presentation attribute — that is what lets `guide` use a CSS custom
// property, which var() in a `color=` attribute could not do.
export const CARD_COLORS: Record<BoardCardKind, string> = {
  note:      "122, 140, 245",     // periwinkle
  quiz:      "201, 212, 255",     // ice-lavender
  guide:     "var(--gold-rgb)",   // lavender brand accent, follows the theme
  terms:     "150, 162, 255",     // deeper periwinkle — sits beside note without echoing it
  reference: "126, 198, 158",     // sage green — "this is a real artifact", not a suggestion
};

// Header icon per kind. Kinds without one keep the original sparkle/grip.
const KIND_ICON: Partial<Record<BoardCardKind, typeof BookOpen>> = {
  guide: BookOpen,
  terms: ListChecks,
  reference: FileText,
};

export default function BoardCards({
  cards, boardW, boardH, onMove, onDelete, onAnswer,
}: {
  cards: BoardCard[];
  boardW: number;
  boardH: number;
  onMove: (id: string, x: number, y: number) => void;
  onDelete: (id: string) => void;
  onAnswer: (id: string, optionIndex: number) => void;
}) {
  const layerRef = useRef<HTMLDivElement | null>(null);
  // Local drag preview so the card tracks the pointer at 60fps; the Yjs write
  // happens once on release (every peer then converges on the final position).
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number; x: number; y: number } | null>(null);

  // clientXY → board px, via the layer's own rect (which is inside the zoom/pan
  // transform, so the math holds at any zoom level).
  const toBoard = (clientX: number, clientY: number) => {
    const r = layerRef.current?.getBoundingClientRect();
    if (!r || !r.width) return { x: 0, y: 0 };
    return { x: ((clientX - r.left) / r.width) * boardW, y: ((clientY - r.top) / r.height) * boardH };
  };

  const beginDrag = (card: BoardCard) => (e: React.PointerEvent) => {
    e.stopPropagation(); e.preventDefault();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    const p = toBoard(e.clientX, e.clientY);
    setDrag({ id: card.id, dx: p.x - card.x, dy: p.y - card.y, x: card.x, y: card.y });
  };
  const moveDrag = (e: React.PointerEvent) => {
    if (!drag) return;
    const p = toBoard(e.clientX, e.clientY);
    setDrag(d => d && ({ ...d, x: Math.max(0, Math.min(boardW - 200, p.x - d.dx)), y: Math.max(0, Math.min(boardH - 140, p.y - d.dy)) }));
  };
  const endDrag = () => {
    if (drag) onMove(drag.id, drag.x, drag.y);
    setDrag(null);
  };

  if (!cards.length) return null;
  return (
    <div ref={layerRef} style={{ position: "absolute", inset: 0, zIndex: 12, pointerEvents: "none" }}>
      {cards.map(card => {
        const pos = drag?.id === card.id ? drag : card;
        const rgb = CARD_COLORS[card.kind] ?? CARD_COLORS.note;
        const isReggie = card.createdBy === "Reggie";
        const answered = card.answeredIndex != null;
        // A kind icon replaces the grip/sparkle so the card announces what it is at a
        // glance; Reggie's authorship still reads off the attribution footer, and the
        // header is still the drag handle (cursor: grab) either way.
        const KindIcon = KIND_ICON[card.kind];
        // Which body renders — and therefore whether the markdown stylesheet applies.
        // A `terms` card that somehow arrived without its array falls back to markdown
        // rather than rendering nothing (the Y.Doc outlives any one client version).
        const asTerms = card.kind === "terms" && Array.isArray(card.terms);
        const asReference = card.kind === "reference";
        const isMarkdown = !asTerms && !asReference;
        return (
          <div
            key={card.id}
            style={{
              position: "absolute",
              left: `${(pos.x / boardW) * 100}%`,
              top: `${(pos.y / boardH) * 100}%`,
              width: `${(card.w / boardW) * 100}%`,
              minWidth: 260,
              pointerEvents: "auto",
              background: "rgba(20, 22, 38, 0.92)",
              border: `1px solid rgba(${rgb}, 0.45)`,
              borderRadius: 18,
              boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
              overflow: "hidden",
              fontFamily: "var(--font-sans)",
            }}
          >
            {/* Header — the drag handle */}
            <div
              onPointerDown={beginDrag(card)}
              onPointerMove={moveDrag}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              style={{
                display: "flex", alignItems: "center", gap: 8, padding: "9px 13px",
                background: `rgba(${rgb}, 0.14)`, borderBottom: `1px solid rgba(${rgb}, 0.25)`,
                cursor: "grab", touchAction: "none", userSelect: "none",
              }}
            >
              {KindIcon
                ? <KindIcon size={14} style={{ flexShrink: 0, color: `rgb(${rgb})` }} />
                : isReggie
                  ? <Sparkles size={14} style={{ flexShrink: 0, color: `rgb(${rgb})` }} />
                  : <GripHorizontal size={14} style={{ flexShrink: 0, color: `rgba(${rgb}, 0.8)` }} />}
              <span style={{ flex: 1, fontSize: 14, fontWeight: 700, color: "#EDF0FF", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {card.title}
              </span>
              <button
                onPointerDown={e => e.stopPropagation()}
                onClick={e => { e.stopPropagation(); onDelete(card.id); }}
                title="Remove card"
                style={{ display: "flex", background: "none", border: "none", padding: 2, cursor: "pointer", color: "rgba(255,255,255,0.45)", flexShrink: 0 }}
              ><X size={14} /></button>
            </div>

            {/* Body — a guide carries 2–4 sections, so it gets more room before scrolling */}
            <div
              style={{ padding: "11px 14px", fontSize: 13.5, lineHeight: 1.55, color: "rgba(237,240,255,0.92)", maxHeight: card.kind === "guide" ? 460 : 340, overflowY: "auto" }}
              className={isMarkdown ? "markdown-body board-card-md" : undefined}
            >
              {/* terms — a definition list, not markdown: the shape IS the content, and
                  letting the model's prose decide the layout is what makes a glossary
                  card look like a note with colons in it. */}
              {asTerms ? (
                <>
                  {card.content && (
                    <p style={{ margin: "0 0 10px", fontSize: 12.5, color: "rgba(237,240,255,0.6)" }}>{card.content}</p>
                  )}
                  <dl style={{ margin: 0 }}>
                    {card.terms.map((t, i) => (
                      <div
                        key={i}
                        style={{
                          padding: i === 0 ? "0 0 9px" : "9px 0",
                          borderTop: i === 0 ? "none" : `1px solid rgba(${rgb}, 0.18)`,
                        }}
                      >
                        <dt style={{ fontSize: 13, fontWeight: 700, color: "#EDF0FF" }}>{t.term}</dt>
                        <dd style={{ margin: "3px 0 0", fontSize: 12.5, lineHeight: 1.5, color: "rgba(237,240,255,0.6)" }}>{t.definition}</dd>
                      </div>
                    ))}
                  </dl>
                </>
              ) : asReference ? (
                <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: "rgba(237,240,255,0.85)" }}>{card.why}</p>
              ) : (
                <Markdown remarkPlugins={[remarkGfm]}>{card.content ?? ""}</Markdown>
              )}

              {card.kind === "quiz" && Array.isArray(card.quizOptions) && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
                  {card.quizOptions.map((opt, i) => {
                    const isCorrect = i === card.correctOptionIndex;
                    const isPicked  = i === card.answeredIndex;
                    return (
                      <button
                        key={i}
                        disabled={answered}
                        onClick={() => onAnswer(card.id, i)}
                        style={{
                          display: "flex", alignItems: "center", gap: 8, textAlign: "left",
                          padding: "8px 11px", borderRadius: 10, fontSize: 12.5, fontFamily: "inherit",
                          cursor: answered ? "default" : "pointer",
                          background: answered
                            ? (isCorrect ? "rgba(100,220,130,0.16)" : isPicked ? "rgba(255,100,90,0.14)" : "rgba(255,255,255,0.04)")
                            : "rgba(255,255,255,0.06)",
                          border: `1px solid ${answered && isCorrect ? "rgba(100,220,130,0.5)" : answered && isPicked ? "rgba(255,100,90,0.4)" : "rgba(255,255,255,0.12)"}`,
                          color: "rgba(237,240,255,0.92)",
                        }}
                      >
                        {answered && isCorrect && <Check size={13} color="rgb(100,220,130)" style={{ flexShrink: 0 }} />}
                        <span>{opt}</span>
                      </button>
                    );
                  })}
                  {answered && (
                    <p style={{ margin: "6px 0 0", fontSize: 12, color: "rgba(255,255,255,0.55)" }}>
                      {card.answeredBy ? `${card.answeredBy} answered. ` : ""}{card.explanation ?? ""}
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* reference — the file itself, as a footer chip. This title is server-verified
                against the turn's retrieved sources, so it always names a file the room
                actually has indexed. */}
            {card.kind === "reference" && card.sourceTitle && (
              <div style={{ padding: "0 14px 9px" }}>
                <span
                  title={card.sourceTitle}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 6, maxWidth: "100%",
                    padding: "4px 10px", borderRadius: 999,
                    background: `rgba(${rgb}, 0.13)`, border: `1px solid rgba(${rgb}, 0.32)`,
                    fontSize: 11.5, color: "rgba(237,240,255,0.88)",
                  }}
                >
                  <FileText size={11} style={{ flexShrink: 0 }} />
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{card.sourceTitle}</span>
                </span>
              </div>
            )}

            <div style={{ padding: "0 14px 8px", fontSize: 10.5, letterSpacing: "0.06em", textTransform: "uppercase", color: `rgba(${rgb}, 0.75)` }}>
              {isReggie ? "✦ Reggie" : card.createdBy}
            </div>
          </div>
        );
      })}
    </div>
  );
}

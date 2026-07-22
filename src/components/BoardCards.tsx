// BoardCards.tsx — structured study cards on the collaborative whiteboard.
// Cards are a THIRD shared structure in the room's Y.Doc (alongside strokes/meta):
// draggable markdown notes and interactive quizzes that any member — or Reggie —
// can place on the board. Rendered as DOM inside the whiteboard's zoom/pan wrapper,
// positioned in board-percentage space exactly like the text-input overlay, so they
// track pan/zoom for free.
//
// All mutations go through callbacks — StudyRooms owns the Y.Array; this component
// never touches Yjs directly (same contract as strokes).

import { useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { X, GripHorizontal, Check, Sparkles } from "lucide-react";

export type BoardCard = {
  id: string;
  kind: "note" | "quiz";
  title: string;
  content: string;           // markdown (quiz: the question text)
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
};

export const CARD_COLORS: Record<BoardCard["kind"], string> = {
  note: "122, 140, 245",   // periwinkle
  quiz: "201, 212, 255",   // ice-lavender
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
              {isReggie
                ? <Sparkles size={14} color={`rgb(${rgb})`} style={{ flexShrink: 0 }} />
                : <GripHorizontal size={14} color={`rgba(${rgb}, 0.8)`} style={{ flexShrink: 0 }} />}
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

            {/* Body */}
            <div style={{ padding: "11px 14px", fontSize: 13.5, lineHeight: 1.55, color: "rgba(237,240,255,0.92)", maxHeight: 340, overflowY: "auto" }} className="markdown-body board-card-md">
              <Markdown remarkPlugins={[remarkGfm]}>{card.content}</Markdown>

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

            <div style={{ padding: "0 14px 8px", fontSize: 10.5, letterSpacing: "0.06em", textTransform: "uppercase", color: `rgba(${rgb}, 0.75)` }}>
              {isReggie ? "✦ Reggie" : card.createdBy}
            </div>
          </div>
        );
      })}
    </div>
  );
}

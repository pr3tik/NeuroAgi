// SelectionToolbar.tsx — floating action toolbar for YouLearn Phase 2.
// CRITICAL: rendered via createPortal to document.body so position:fixed is
// relative to the VIEWPORT, not a CSS-transform ancestor (.app-page-transition
// has transform:scale which would otherwise create a wrong containing block).
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";

export type DocAction = "explain" | "chat" | "quiz" | "flashcards";

interface Props {
  rect: DOMRect | null;
  selectedText: string;
  /** true on touch — toolbar goes below selection to avoid iOS/Android native menu */
  preferBelow?: boolean;
  onAction: (action: DocAction) => void;
  onDismiss: () => void;
}

const ACTIONS: { id: DocAction; label: string }[] = [
  { id: "explain",    label: "Explain"    },
  { id: "chat",       label: "Chat"       },
  { id: "quiz",       label: "Quiz"       },
  { id: "flashcards", label: "Flashcards" },
];

const TOOLBAR_W = 288;
const TOOLBAR_H = 40;
const GAP       = 12;

function getPos(rect: DOMRect, below: boolean): { top: number; left: number } {
  let top = below ? rect.bottom + GAP : rect.top - TOOLBAR_H - GAP;
  if (below && top + TOOLBAR_H > window.innerHeight - GAP) top = rect.top - TOOLBAR_H - GAP;
  if (!below && top < GAP) top = rect.bottom + GAP;
  let left = rect.left + rect.width / 2 - TOOLBAR_W / 2;
  left = Math.max(GAP, Math.min(left, window.innerWidth - TOOLBAR_W - GAP));
  return { top, left };
}

export default function SelectionToolbar({ rect, selectedText, preferBelow = false, onAction, onDismiss }: Props) {
  const toolbarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onPD(e: PointerEvent) {
      if (toolbarRef.current?.contains(e.target as Node)) return;
      setTimeout(onDismiss, 60);
    }
    document.addEventListener("pointerdown", onPD);
    return () => document.removeEventListener("pointerdown", onPD);
  }, [onDismiss]);

  const visible = !!rect && !!selectedText.trim();
  const pos = rect ? getPos(rect, preferBelow) : { top: 0, left: 0 };

  const toolbar = (
    <AnimatePresence>
      {visible && (
        <motion.div
          ref={toolbarRef}
          key="sel-toolbar"
          initial={{ opacity: 0, scale: 0.9, y: preferBelow ? -5 : 5 }}
          animate={{ opacity: 1, scale: 1,   y: 0 }}
          exit={{    opacity: 0, scale: 0.95, y: preferBelow ? -3 : 3 }}
          transition={{ type: "spring", stiffness: 560, damping: 36, mass: 0.6 }}
          style={{
            position: "fixed",  // viewport-relative because we're in document.body via portal
            top:  pos.top,
            left: pos.left,
            zIndex: 9100,       // above everything in the app
            display: "flex",
            alignItems: "center",
            gap: "2px",
            background: "#1c1c1f",
            border: "1px solid rgba(255,255,255,0.14)",
            borderRadius: "11px",
            padding: "4px",
            boxShadow: "0 8px 28px rgba(0,0,0,0.6), 0 1px 4px rgba(0,0,0,0.3)",
            userSelect: "none",
            WebkitUserSelect: "none",
          }}
          onMouseDown={e => e.preventDefault()}
          onPointerDown={e => e.preventDefault()}
        >
          {ACTIONS.map(({ id, label }) => (
            <button
              key={id}
              onClick={e => { e.preventDefault(); e.stopPropagation(); onAction(id); }}
              style={{
                background: "none", border: "none", borderRadius: "7px",
                padding: "6px 12px", cursor: "pointer", fontFamily: "inherit",
                fontSize: "12px", fontWeight: "600", color: "rgba(255,255,255,0.7)",
                transition: "background 0.1s, color 0.1s", whiteSpace: "nowrap",
              }}
              onMouseEnter={e => { e.currentTarget.style.background = "rgba(var(--gold-rgb), 0.16)"; e.currentTarget.style.color = "var(--gold)"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = "rgba(255,255,255,0.7)"; }}
            >
              {label}
            </button>
          ))}
        </motion.div>
      )}
    </AnimatePresence>
  );

  // Portal to document.body — escapes any CSS transform containing block
  if (typeof document === "undefined") return null;
  return createPortal(toolbar, document.body);
}

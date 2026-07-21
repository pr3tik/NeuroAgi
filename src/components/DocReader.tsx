// DocReader.tsx — YouLearn Phase 2: document reader + select-text toolbar + chat panel.
// Phase 1: persisted reader with summary + gold highlights.
// Phase 2: text selection → floating toolbar → streaming chat panel.
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {} from "framer-motion"; // framer-motion used in child components
import { supabase } from "../api/supabase";
import { useApp } from "../context/AppContext";
import SelectionToolbar, { type DocAction } from "./SelectionToolbar";
import DocChat from "./DocChat";

// ── Normalize text for matching (keep paragraph breaks, collapse inline spaces) ─
function normalizeForMatch(s: string): string {
  return s
    .replace(/[ \t]+/g, " ")   // collapse horizontal whitespace
    .replace(/\n{3,}/g, "\n\n") // cap blank lines at one
    .trim();
}

// ── Build highlight ranges via indexOf (case-insensitive, whitespace-tolerant) ──
type Range = { start: number; end: number };

function findRanges(text: string, highlights: string[]): Range[] {
  if (!highlights?.length || !text) return [];

  const textLower = text.toLowerCase();
  const raw: Range[] = [];

  for (const hl of highlights) {
    if (!hl?.trim()) continue;
    // Normalize the highlight the same way as the text
    const normHl = normalizeForMatch(hl).toLowerCase();
    if (!normHl) continue;

    let from = 0;
    for (;;) {
      const idx = textLower.indexOf(normHl, from);
      if (idx === -1) break;
      raw.push({ start: idx, end: idx + normHl.length });
      from = idx + normHl.length;
    }
  }

  if (!raw.length) return [];

  // Sort by start, then merge overlapping / adjacent ranges
  raw.sort((a, b) => a.start - b.start);
  const merged: Range[] = [];
  for (const r of raw) {
    const prev = merged[merged.length - 1];
    if (prev && r.start <= prev.end) {
      prev.end = Math.max(prev.end, r.end);
    } else {
      merged.push({ ...r });
    }
  }
  return merged;
}

// ── HighlightedText — renders prose with gold-tinted highlight spans ───────────
function HighlightedText({
  text,
  highlights,
}: {
  text: string;
  highlights: string[];
}) {
  // Normalise the displayed text (same transform applied to highlights in findRanges)
  const normalized = useMemo(() => normalizeForMatch(text), [text]);
  const ranges     = useMemo(() => findRanges(normalized, highlights), [normalized, highlights]);

  // Build display segments
  const segments = useMemo(() => {
    const segs: { text: string; highlighted: boolean }[] = [];
    let pos = 0;
    for (const { start, end } of ranges) {
      if (start > pos) segs.push({ text: normalized.slice(pos, start), highlighted: false });
      segs.push({ text: normalized.slice(start, end), highlighted: true });
      pos = end;
    }
    if (pos < normalized.length) segs.push({ text: normalized.slice(pos), highlighted: false });
    return segs;
  }, [normalized, ranges]);

  const bodyStyle: React.CSSProperties = {
    whiteSpace: "pre-wrap",
    lineHeight: "1.85",
    color: "rgba(245,245,245,0.88)",
    fontSize: "15px",
    margin: 0,
    fontFamily: "var(--font-sans)",
  };

  if (!ranges.length) {
    return <p style={bodyStyle}>{normalized}</p>;
  }

  return (
    <p style={bodyStyle}>
      {segments.map((seg, i) =>
        seg.highlighted ? (
          <mark
            key={i}
            style={{
              background: "rgba(var(--gold-rgb), 0.2)",
              color: "rgba(245,245,245,0.95)",
              borderRadius: "3px",
              padding: "0 1px",
              boxShadow: "inset 0 -1.5px 0 rgba(var(--gold-rgb), 0.5)",
              // No transition — marks are stable after render
            }}
          >
            {seg.text}
          </mark>
        ) : (
          <span key={i}>{seg.text}</span>
        )
      )}
    </p>
  );
}

// ── DocReader ─────────────────────────────────────────────────────────────────
interface DocFile {
  id: string;
  name: string;
  fileType?: string;
  storagePath?: string;
  summary?: string | null;
  highlights?: string[] | null;
  processedAt?: string | null;
  /** courseDbId — threaded to DocChat so flashcards save to the right course */
  courseDbId?: number | null;
}

interface Props {
  file: DocFile;
  onBack: () => void;
  onNavigate?: (page: string) => void;
}

// ── Context window for chat (first 6 000 chars — enough without full chunking) ─
const DOC_CTX_CHARS = 6000;

export default function DocReader({ file, onBack, onNavigate }: Props) {
  const { userId } = useApp();
  const [contentText, setContentText] = useState<string | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState<string | null>(null);

  // ── Phase 2: selection + chat state ─────────────────────────────────────────
  const [selectionText,  setSelectionText]  = useState("");
  const [selectionRect,  setSelectionRect]  = useState<DOMRect | null>(null);
  const [selectionTouch, setSelectionTouch] = useState(false);
  const [chatOpen,       setChatOpen]       = useState(false);
  const [chatAction,     setChatAction]     = useState<DocAction | null>(null);
  const [chatSelection,  setChatSelection]  = useState<string | null>(null);
  const [chatKey,        setChatKey]        = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);

  // ── Document-level mouseup/touchend — catches drags that end outside container
  useEffect(() => {
    // Cast to `any` to avoid Framer Motion's `Range` type shadowing the DOM `Range` type.
    // The DOM Range has getClientRects/getBoundingClientRect; FM's Range has start/end.
    function pickRect(range: any): DOMRect | null {
      const rects: DOMRect[] = Array.from(range.getClientRects() as DOMRectList);
      for (let i = rects.length - 1; i >= 0; i--) {
        if (rects[i].height > 0) return rects[i];
      }
      const r: DOMRect = range.getBoundingClientRect();
      return r.height > 0 ? r : null;
    }

    function handleUp(isTouch: boolean) {
      // Zero-ms for desktop, 400ms for touch so iOS native menu appears first
      const delay = isTouch ? 400 : 0;
      setTimeout(() => {
        if (!containerRef.current) return;
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || !sel.toString().trim()) return;
        if (!sel.rangeCount) return;
        const range = sel.getRangeAt(0) as any;
        // Only show toolbar when the selection is inside our doc text container
        if (!containerRef.current.contains(range.commonAncestorContainer as Node)) return;

        const rect = pickRect(range);
        if (!rect) return;

        setSelectionText(sel.toString().trim());
        setSelectionRect(rect);
        setSelectionTouch(isTouch);
      }, delay);
    }

    const onMouseUp  = () => handleUp(false);
    const onTouchEnd = () => handleUp(true);

    document.addEventListener("mouseup",   onMouseUp);
    document.addEventListener("touchend",  onTouchEnd);
    return () => {
      document.removeEventListener("mouseup",  onMouseUp);
      document.removeEventListener("touchend", onTouchEnd);
    };
  }, []);

  // Recompute on scroll/resize so the toolbar follows the text if user scrolls
  useEffect(() => {
    if (!selectionText) return;
    function update() {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) { setSelectionRect(null); return; }
      const range = sel.getRangeAt(0);
      const rects = Array.from(range.getClientRects());
      for (let i = rects.length - 1; i >= 0; i--) {
        if (rects[i].height > 0) { setSelectionRect(rects[i]); return; }
      }
    }
    window.addEventListener("scroll", update, { passive: true, capture: true });
    window.addEventListener("resize", update, { passive: true });
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [selectionText]);

  function openChat(action: DocAction) {
    setChatAction(action);
    setChatSelection(selectionText || null);
    setChatKey(k => k + 1);
    setChatOpen(true);
    // Clear the selection after opening so toolbar hides
    window.getSelection()?.removeAllRanges();
    setSelectionText("");
    setSelectionRect(null);
  }

  const docContext = contentText
    ? contentText.slice(0, DOC_CTX_CHARS)
    : (file as any).summary ?? "";

  const fetchContent = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await supabase
        .from("files")
        .select("content_text")
        .eq("id", file.id)
        .maybeSingle();
      if (err) throw new Error(err.message);
      let text = data?.content_text ?? "";
      // Server-side Canvas-indexed files store their text in RAG (rag_sections), which
      // is RLS-deny to client keys — fetch it via the server (?action=doc) instead, or
      // these files open as a blank reader.
      const docId = (file as any).documentId ?? (file as any).document_id;
      if (!text && docId && userId) {
        const r = await fetch("/api/rag?action=doc", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId, documentId: docId }),
        });
        if (r.ok) {
          const d = await r.json().catch(() => ({}));
          text = String(d?.text ?? "");
        }
      }
      setContentText(text);
    } catch (e: any) {
      setError(e.message || "Couldn't load document.");
    } finally {
      setLoading(false);
    }
  }, [file.id, userId]);

  useEffect(() => { fetchContent(); }, [fetchContent]);

  const fileExt    = file.fileType?.toUpperCase()
    ?? file.name?.split(".").pop()?.toUpperCase() ?? "DOC";
  const highlights = (file.highlights ?? []) as string[];

  return (
    <div style={{ minHeight: "100%", display: "flex", flexDirection: "column" }}>

      {/* ── Header ────────────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "32px" }}>
        <button
          onClick={onBack}
          aria-label="Back to files"
          style={{
            background: "none", border: "none", cursor: "pointer",
            color: "var(--text-dim)", padding: "6px", borderRadius: "8px",
            display: "flex", alignItems: "center", flexShrink: 0,
            transition: "background 0.12s, color 0.12s",
          }}
          onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.06)"; e.currentTarget.style.color = "var(--text-secondary)"; }}
          onMouseLeave={e => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = "var(--text-dim)"; }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 5l-7 7 7 7"/>
          </svg>
        </button>

        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{
            fontFamily: "var(--font-sans)",
            fontSize: "19px", fontWeight: "600",
            color: "var(--text-primary)",
            letterSpacing: "-0.2px", lineHeight: "1.3",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            margin: 0,
          }}>
            {file.name}
          </h1>
        </div>

        <span style={{
          fontSize: "10px", fontWeight: "700", letterSpacing: "0.6px",
          textTransform: "uppercase", padding: "3px 8px", borderRadius: "5px",
          background: "rgba(var(--gold-rgb), 0.1)", color: "var(--gold)",
          border: "1px solid rgba(var(--gold-rgb), 0.22)", flexShrink: 0,
        }}>
          {fileExt}
        </span>
      </div>

      {/* ── AI Summary ────────────────────────────────────────────────────────── */}
      {file.summary && (
        <section style={{ marginBottom: "28px" }}>
          <p style={{
            fontSize: "11px", fontWeight: "700", letterSpacing: "0.6px",
            textTransform: "uppercase", color: "var(--gold)",
            margin: "0 0 10px",
          }}>
            AI Summary
          </p>
          <div style={{
            borderLeft: "2px solid rgba(var(--gold-rgb), 0.4)",
            paddingLeft: "16px",
          }}>
            <p style={{
              fontSize: "14px", lineHeight: "1.75",
              color: "rgba(245,245,245,0.85)",
              margin: 0,
            }}>
              {file.summary}
            </p>
          </div>
        </section>
      )}

      {/* ── Key Highlights ────────────────────────────────────────────────────── */}
      {highlights.length > 0 && (
        <section style={{ marginBottom: "28px" }}>
          <p style={{
            fontSize: "11px", fontWeight: "700", letterSpacing: "0.6px",
            textTransform: "uppercase", color: "rgba(255,255,255,0.3)",
            margin: "0 0 12px",
          }}>
            Key Passages
          </p>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "10px" }}>
            {highlights.map((h, i) => (
              <li key={i} style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
                <span style={{
                  width: 5, height: 5, borderRadius: "50%",
                  background: "var(--gold)", flexShrink: 0, marginTop: "8px",
                }} />
                <p style={{
                  fontSize: "13px", lineHeight: "1.65",
                  color: "rgba(245,245,245,0.75)",
                  margin: 0, fontStyle: "italic",
                }}>
                  {h}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── Separator ─────────────────────────────────────────────────────────── */}
      {(file.summary || highlights.length > 0) && (
        <hr style={{
          border: "none", borderTop: "1px solid rgba(255,255,255,0.07)",
          marginBottom: "28px",
        }} />
      )}

      {/* ── Document Content ──────────────────────────────────────────────────── */}
      <section style={{ flex: 1 }}>
        <p style={{
          fontSize: "11px", fontWeight: "700", letterSpacing: "0.6px",
          textTransform: "uppercase", color: "rgba(255,255,255,0.3)",
          margin: "0 0 20px",
        }}>
          Full Document
        </p>

        {loading ? (
          <div style={{
            display: "flex", alignItems: "center", gap: "10px",
            padding: "32px 0", color: "var(--text-dim)", fontSize: "14px",
          }}>
            <span style={{
              width: 16, height: 16, borderRadius: "50%",
              border: "2px solid rgba(255,255,255,0.1)",
              borderTopColor: "var(--gold)",
              animation: "docSpin 0.7s linear infinite",
              display: "inline-block", flexShrink: 0,
            }} />
            <style>{`@keyframes docSpin{to{transform:rotate(360deg)}}`}</style>
            Loading document…
          </div>

        ) : error ? (
          <div style={{
            padding: "16px 20px", borderRadius: "12px",
            background: "rgba(255,59,48,0.07)",
            border: "1px solid rgba(255,59,48,0.18)",
            color: "rgba(255,100,90,0.85)", fontSize: "13px",
            display: "flex", alignItems: "center", gap: "12px",
          }}>
            <span style={{ flex: 1 }}>{error}</span>
            <button onClick={fetchContent} style={{
              background: "none", border: "none", color: "var(--gold)",
              cursor: "pointer", fontSize: "13px", fontFamily: "inherit",
              textDecoration: "underline", flexShrink: 0,
            }}>
              Retry
            </button>
          </div>

        ) : !contentText ? (
          <p style={{ color: "var(--text-dim)", fontSize: "14px" }}>
            No text content found in this document.
          </p>

        ) : (
          <div ref={containerRef} style={{ maxWidth: "68ch" }}>
            <HighlightedText text={contentText} highlights={highlights} />
          </div>
        )}
      </section>

      {/* ── Phase 2: floating toolbar + chat panel ──────────────────────────── */}
      <SelectionToolbar
        rect={selectionRect}
        selectedText={selectionText}
        preferBelow={selectionTouch}
        onAction={openChat}
        onDismiss={() => { setSelectionText(""); setSelectionRect(null); }}
      />

      {/* DocChat renders via createPortal at document.body — viewport-fixed, no AnimatePresence needed here */}
      {chatOpen && (
        <DocChat
          key={chatKey}
          docId={file.id}
          docTitle={file.name}
          docContext={docContext}
          courseId={(file as any).courseDbId ?? null}
          initialSelection={chatSelection}
          initialAction={chatAction}
          onClose={() => setChatOpen(false)}
          onNavigate={onNavigate ?? (() => {})}
        />
      )}
    </div>
  );
}

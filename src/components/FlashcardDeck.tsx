// FlashcardDeck.tsx — the Quizlet-shaped flashcard surface.
//
// Purely presentational: it owns index / flip / shuffle / browse state and nothing
// else. It never touches Supabase or src/lib/srs — the host page passes `onGrade`
// and keeps its own SM-2 persistence, so the same component drops into the Study
// page, a study room, or a demo without dragging a data layer along.

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  Check, X, Shuffle, List, Layers, Printer, Copy, Download, RotateCcw,
  ChevronLeft, ChevronRight, ArrowLeft,
} from "lucide-react";
import { toCSV, toAnkiTSV, downloadText, deckFilename } from "../lib/deckExport";

export type FlashcardDeckCard = { q: string; a: string };

export type FlashcardDeckProps = {
  /** The deck. Extra fields are preserved — `onGrade` hands the original object back. */
  cards: FlashcardDeckCard[];
  /** Deck name — shown in the header, used for export filenames and the print handout. */
  title?: string;
  /** Called once per judgement. The host decides what "correct" means for scheduling. */
  onGrade?: (card: FlashcardDeckCard, correct: boolean) => void;
  /** Optional — renders an "Exit" affordance only when provided. */
  onExit?: () => void;
};

// ── Surface tokens ────────────────────────────────────────────────────────────
// Translucent whites only (never a solid fill) so the deck sits correctly on the
// dark app ground *and* on the study room's blue.
const GLASS        = "rgba(255,255,255,0.045)";
const GLASS_LIFT   = "rgba(255,255,255,0.075)";
const BORDER       = "rgba(255,255,255,0.09)";
const BORDER_LIFT  = "rgba(255,255,255,0.14)";
const HAIRLINE     = "rgba(255,255,255,0.07)";
const ACCENT       = "rgb(var(--teal-rgb))";
const ACCENT_SOFT  = "rgba(var(--teal-rgb), 0.14)";
const ACCENT_EDGE  = "rgba(var(--teal-rgb), 0.32)";
const GOOD         = "rgba(72, 210, 110, 0.9)";
const GOOD_SOFT    = "rgba(52, 199, 89, 0.1)";
const GOOD_EDGE    = "rgba(52, 199, 89, 0.26)";
const BAD          = "rgba(255, 95, 85, 0.92)";
const BAD_SOFT     = "rgba(255, 59, 48, 0.1)";
const BAD_EDGE     = "rgba(255, 59, 48, 0.26)";
const EASE         = "cubic-bezier(0.22, 0.61, 0.36, 1)";

const eyebrowStyle: React.CSSProperties = {
  fontSize: 10, letterSpacing: "2.2px", textTransform: "uppercase",
  fontWeight: 700, margin: 0, flexShrink: 0,
};

function chipStyle(active = false): React.CSSProperties {
  return {
    display: "inline-flex", alignItems: "center", gap: 6,
    background: active ? ACCENT_SOFT : GLASS,
    border: `1px solid ${active ? ACCENT_EDGE : BORDER}`,
    borderRadius: 12, padding: "7px 12px",
    color: active ? ACCENT : "var(--text-secondary)",
    fontSize: 12, fontWeight: 600, fontFamily: "inherit",
    cursor: "pointer", whiteSpace: "nowrap",
    transition: `background 0.18s ${EASE}, border-color 0.18s ${EASE}, color 0.18s ${EASE}`,
  };
}

function shuffled<T>(arr: T[]): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export default function FlashcardDeck({ cards, title, onGrade, onExit }: FlashcardDeckProps) {
  // Normalised copy for rendering/exporting; grading still hands back the original object.
  const deck = useMemo<FlashcardDeckCard[]>(
    () => (Array.isArray(cards) ? cards : []).map((c: any) => ({ q: String(c?.q ?? ""), a: String(c?.a ?? "") })),
    [cards],
  );
  // Cheap content signature — resets session state when the deck actually changes,
  // not merely when the parent re-creates the array on every render.
  const deckSig = `${deck.length}|${deck[0]?.q ?? ""}|${deck[deck.length - 1]?.q ?? ""}`;

  const [view,     setView]     = useState<"study" | "browse" | "summary">("study");
  const [order,   setOrder]     = useState<number[]>(() => deck.map((_, i) => i));
  const [pos,      setPos]      = useState(0);
  const [flipped,  setFlipped]  = useState(false);
  const [graded,   setGraded]   = useState<Record<number, boolean>>({}); // deck index → got it?
  const [hardOnly, setHardOnly] = useState(false);
  const [copyState, setCopyState] = useState<"" | "ok" | "err">("");

  const rootRef  = useRef<HTMLDivElement | null>(null);
  const printId  = `fcd-print-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;

  // New deck → fresh session.
  useEffect(() => {
    setOrder(deck.map((_, i) => i));
    setPos(0); setFlipped(false); setGraded({}); setHardOnly(false);
    setView((v) => (v === "browse" ? "browse" : "study"));
  }, [deckSig]); // eslint-disable-line react-hooks/exhaustive-deps

  // Focus the root once so the keyboard map works without a click first.
  useEffect(() => { rootRef.current?.focus?.({ preventScroll: true }); }, []);

  useEffect(() => {
    if (!copyState) return;
    const t = setTimeout(() => setCopyState(""), 1800);
    return () => clearTimeout(t);
  }, [copyState]);

  const missedIdx = useMemo(
    () => Object.keys(graded).filter((k) => graded[Number(k)] === false).map(Number),
    [graded],
  );

  const total   = order.length;
  const cardIdx = order[Math.min(pos, Math.max(total - 1, 0))];
  const card    = deck[cardIdx];

  /** Rebuild the study queue. `hard` filters to this session's misses (falling back to
   *  the whole deck when nothing has been missed yet); `shuffle` randomises the result. */
  const rebuild = useCallback((opts: { hard?: boolean; shuffle?: boolean } = {}) => {
    const hard = opts.hard ?? hardOnly;
    let idxs = deck.map((_, i) => i);
    if (hard) {
      const missed = idxs.filter((i) => graded[i] === false);
      if (missed.length) idxs = missed;
    }
    if (opts.shuffle) idxs = shuffled(idxs);
    setOrder(idxs);
    setPos(0);
    setFlipped(false);
    setView((v) => (v === "browse" ? "browse" : "study"));
  }, [deck, graded, hardOnly]);

  const grade = useCallback((correct: boolean) => {
    if (!total || view === "summary") return;
    const original = (Array.isArray(cards) ? cards[cardIdx] : undefined) ?? deck[cardIdx];
    if (!original) return;
    onGrade?.(original, correct);
    setGraded((g) => ({ ...g, [cardIdx]: correct }));
    setFlipped(false);
    if (pos >= total - 1) setView("summary");
    else setPos((p) => p + 1);
  }, [cardIdx, cards, deck, onGrade, pos, total, view]);

  const goNext = useCallback(() => { setFlipped(false); setPos((p) => Math.min(p + 1, total - 1)); }, [total]);
  const goPrev = useCallback(() => { setFlipped(false); setPos((p) => Math.max(p - 1, 0)); }, []);

  const toggleHard = useCallback(() => {
    const next = !hardOnly;
    setHardOnly(next);
    rebuild({ hard: next });
  }, [hardOnly, rebuild]);

  const studyAgain = useCallback(() => {
    setGraded({}); setHardOnly(false);
    setOrder(deck.map((_, i) => i));
    setPos(0); setFlipped(false); setView("study");
  }, [deck]);

  const studyMissed = useCallback(() => {
    if (!missedIdx.length) return;
    setHardOnly(true);
    setOrder(missedIdx);
    setPos(0); setFlipped(false); setView("study");
  }, [missedIdx]);

  // ── Keyboard map ────────────────────────────────────────────────────────────
  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement | null;
    const tag = t?.tagName ?? "";
    // Never hijack typing, and let a focused button keep its native Enter/Space activation.
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t?.isContentEditable) return;
    if (tag === "BUTTON" && (e.key === "Enter" || e.key === " " || e.code === "Space")) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    const key = e.key;
    if (key === " " || e.code === "Space" || key === "Enter") {
      if (view !== "study") return;
      e.preventDefault(); setFlipped((f) => !f);
    } else if (key === "ArrowLeft") {
      if (view !== "study") return;
      e.preventDefault(); goPrev();
    } else if (key === "ArrowRight") {
      if (view !== "study") return;
      e.preventDefault(); goNext();
    } else if (key === "1") {
      if (view !== "study") return;
      e.preventDefault(); grade(false);
    } else if (key === "2") {
      if (view !== "study") return;
      e.preventDefault(); grade(true);
    } else if (key === "s" || key === "S") {
      e.preventDefault(); rebuild({ shuffle: true });
    } else if (key === "b" || key === "B") {
      e.preventDefault(); setView((v) => (v === "browse" ? "study" : "browse"));
    }
  }, [goNext, goPrev, grade, rebuild, view]);

  // ── Export actions ──────────────────────────────────────────────────────────
  const exportCSV  = () => downloadText(deckFilename(title, "csv"), "text/csv;charset=utf-8", toCSV(deck, title));
  const exportAnki = () => downloadText(deckFilename(title, "txt"), "text/plain;charset=utf-8", toAnkiTSV(deck));

  const copyDeck = async () => {
    const text = toAnkiTSV(deck); // tab-separated pastes straight into Quizlet/Anki
    try {
      if (!navigator?.clipboard?.writeText) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(text);
      setCopyState("ok");
    } catch {
      // Fallback for insecure contexts / older browsers.
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.cssText = "position:fixed;top:-1000px;opacity:0";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand?.("copy");
        ta.remove();
        setCopyState(ok ? "ok" : "err");
      } catch {
        setCopyState("err");
      }
    }
  };

  const printDeck = () => { if (typeof window !== "undefined") window.print(); };

  // ── Print handout (hidden on screen, the only thing visible on paper) ────────
  const printCSS = `
    #${printId} { display: none; }
    @media print {
      body * { visibility: hidden !important; }
      #${printId}, #${printId} * { visibility: visible !important; }
      #${printId} {
        display: block !important; position: absolute !important;
        left: 0; top: 0; width: 100%; margin: 0; padding: 0;
        color: #111; background: #fff;
        font-family: Georgia, "Times New Roman", serif;
      }
      #${printId} h1 { font-size: 15pt; margin: 0 0 4pt; font-weight: 700; }
      #${printId} .fcd-sub { font-size: 9pt; color: #666; margin: 0 0 12pt; }
      #${printId} table { width: 100%; border-collapse: collapse; }
      #${printId} th, #${printId} td {
        text-align: left; vertical-align: top; padding: 6pt 8pt;
        border-bottom: 1px solid #d8d8d8; font-size: 10.5pt; line-height: 1.4;
      }
      #${printId} th {
        font-size: 8pt; text-transform: uppercase; letter-spacing: 0.08em;
        color: #555; border-bottom: 1.5px solid #333;
      }
      #${printId} td:first-child { width: 38%; font-weight: 700; }
      #${printId} tr { page-break-inside: avoid; break-inside: avoid; }
      @page { margin: 14mm; }
    }
  `;

  const printHandout = (
    <>
      <style>{printCSS}</style>
      <div id={printId} aria-hidden="true">
        <h1>{title || "Flashcards"}</h1>
        <p className="fcd-sub">{deck.length} card{deck.length === 1 ? "" : "s"}</p>
        <table>
          <thead><tr><th>Term</th><th>Definition</th></tr></thead>
          <tbody>
            {deck.map((c, i) => (
              <tr key={i}><td>{c.q}</td><td>{c.a}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );

  // ── Empty deck ──────────────────────────────────────────────────────────────
  if (!deck.length) {
    return (
      <div style={{
        fontFamily: "var(--font-sans)", background: GLASS, border: `1px solid ${BORDER}`,
        borderRadius: 20, padding: "28px 24px", textAlign: "center",
      }}>
        <Layers size={20} color={ACCENT} style={{ marginBottom: 10, opacity: 0.8 }} />
        <p style={{ color: "var(--text-primary)", fontSize: 15, fontWeight: 600, margin: "0 0 4px" }}>No cards yet</p>
        <p style={{ color: "var(--text-dim)", fontSize: 13, margin: 0 }}>Generate or add flashcards to start studying.</p>
      </div>
    );
  }

  const gradedCount = Object.keys(graded).length;
  const gotCount    = Object.values(graded).filter(Boolean).length;
  const missCount   = gradedCount - gotCount;
  const progressPct = total ? ((pos + 1) / total) * 100 : 0;

  return (
    <div
      ref={rootRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      role="group"
      aria-label={title ? `${title} flashcards` : "Flashcards"}
      style={{
        fontFamily: "var(--font-sans)", outline: "none",
        width: "100%", display: "flex", flexDirection: "column", alignItems: "stretch", gap: 14,
      }}
    >
      {printHandout}

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        {onExit && (
          <button onClick={onExit} style={{ ...chipStyle(), padding: "7px 11px" }} title="Leave this deck">
            <ArrowLeft size={13} /> Exit
          </button>
        )}
        <div style={{ minWidth: 0, flex: 1 }}>
          <p style={{
            margin: 0, color: "var(--text-primary)", fontSize: 16, fontWeight: 650,
            letterSpacing: "-0.2px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {title || "Flashcards"}
          </p>
          <p style={{ margin: "2px 0 0", color: "var(--text-dim)", fontSize: 12 }}>
            {deck.length} card{deck.length === 1 ? "" : "s"}
            {gradedCount > 0 && ` · ${gotCount} got · ${missCount} missed`}
          </p>
        </div>
        <button
          onClick={() => setView((v) => (v === "browse" ? "study" : "browse"))}
          style={chipStyle(view === "browse")}
          title="Browse the whole deck (B)"
        >
          <List size={13} /> {view === "browse" ? "Study" : "Browse"}
        </button>
      </div>

      {/* ── Export toolbar ─────────────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button onClick={exportCSV} style={chipStyle()} title="Download a CSV spreadsheet of this deck">
          <Download size={13} /> Export CSV
        </button>
        <button onClick={exportAnki} style={chipStyle()} title="Tab-separated file — imports into Anki and Quizlet">
          <Download size={13} /> Export for Anki/Quizlet
        </button>
        <button onClick={copyDeck} style={chipStyle(copyState === "ok")} title="Copy the deck as tab-separated text">
          {copyState === "ok" ? <Check size={13} /> : <Copy size={13} />}
          {copyState === "ok" ? "Copied" : copyState === "err" ? "Copy failed" : "Copy"}
        </button>
        <button onClick={printDeck} style={chipStyle()} title="Print or save as PDF">
          <Printer size={13} /> Print
        </button>
      </div>

      {/* ── Browse view ────────────────────────────────────────────────────── */}
      {view === "browse" && (
        <div style={{ background: GLASS, border: `1px solid ${BORDER}`, borderRadius: 20, overflow: "hidden" }}>
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "12px 18px", borderBottom: `1px solid ${HAIRLINE}`,
          }}>
            <p style={{ ...eyebrowStyle, color: "var(--text-dim)" }}>Term / Definition</p>
            <button onClick={() => setView("study")} style={chipStyle(true)} title="Back to studying (B)">
              <Layers size={13} /> Study
            </button>
          </div>
          <div style={{ maxHeight: 460, overflowY: "auto" }}>
            {deck.map((c, i) => (
              <div key={i} style={{
                display: "flex", alignItems: "flex-start", gap: 16,
                padding: "14px 18px",
                borderBottom: i === deck.length - 1 ? "none" : `1px solid ${HAIRLINE}`,
                background: graded[i] === false ? "rgba(255,59,48,0.045)" : "transparent",
              }}>
                <div style={{ flex: "0 0 38%", minWidth: 0 }}>
                  <p style={{ margin: 0, color: "var(--text-primary)", fontSize: 14, fontWeight: 600, lineHeight: 1.5, overflowWrap: "anywhere" }}>
                    {c.q}
                  </p>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, color: "var(--text-secondary)", fontSize: 14, lineHeight: 1.6, overflowWrap: "anywhere" }}>
                    {c.a}
                  </p>
                </div>
                {graded[i] !== undefined && (
                  <span style={{ flexShrink: 0, marginTop: 3, color: graded[i] ? GOOD : BAD }}>
                    {graded[i] ? <Check size={14} /> : <X size={14} />}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Session summary ────────────────────────────────────────────────── */}
      {view === "summary" && (
        <div style={{
          background: GLASS, border: `1px solid ${BORDER}`, borderRadius: 20,
          padding: "30px 26px", textAlign: "center",
          boxShadow: "0 18px 48px rgba(0,0,0,0.32)",
        }}>
          <p style={{ ...eyebrowStyle, color: "var(--text-dim)", marginBottom: 12 }}>Round complete</p>
          <div style={{
            fontSize: 46, fontWeight: 700, color: "var(--text-primary)",
            letterSpacing: "-1.5px", lineHeight: 1.1, fontVariantNumeric: "tabular-nums",
          }}>
            {gradedCount ? Math.round((gotCount / gradedCount) * 100) : 0}%
          </div>
          <div style={{ display: "flex", justifyContent: "center", gap: 18, margin: "16px 0 24px" }}>
            <span style={{ color: GOOD, fontSize: 14, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 6 }}>
              <Check size={15} /> {gotCount} got it
            </span>
            <span style={{ color: BAD, fontSize: 14, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 6 }}>
              <X size={15} /> {missCount} missed
            </span>
          </div>
          <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
            <button
              onClick={studyAgain}
              style={{
                background: ACCENT_SOFT, border: `1px solid ${ACCENT_EDGE}`, borderRadius: 14,
                padding: "12px 20px", color: ACCENT, fontSize: 14, fontWeight: 650,
                cursor: "pointer", fontFamily: "inherit", display: "inline-flex", alignItems: "center", gap: 7,
              }}
            >
              <RotateCcw size={14} /> Study again
            </button>
            <button
              onClick={studyMissed}
              disabled={!missedIdx.length}
              style={{
                background: missedIdx.length ? BAD_SOFT : GLASS,
                border: `1px solid ${missedIdx.length ? BAD_EDGE : BORDER}`,
                borderRadius: 14, padding: "12px 20px",
                color: missedIdx.length ? BAD : "var(--text-dim)",
                fontSize: 14, fontWeight: 650,
                cursor: missedIdx.length ? "pointer" : "not-allowed",
                fontFamily: "inherit", display: "inline-flex", alignItems: "center", gap: 7,
              }}
            >
              <Layers size={14} /> Study missed only
            </button>
            {onExit && (
              <button
                onClick={onExit}
                style={{
                  background: GLASS_LIFT, border: `1px solid ${BORDER_LIFT}`, borderRadius: 14,
                  padding: "12px 20px", color: "var(--text-primary)", fontSize: 14, fontWeight: 650,
                  cursor: "pointer", fontFamily: "inherit",
                }}
              >
                Done
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Study view ─────────────────────────────────────────────────────── */}
      {view === "study" && card && (
        <>
          <div style={{ display: "flex", justifyContent: "center" }}>
            <div
              onClick={() => setFlipped((f) => !f)}
              role="button"
              aria-label={flipped ? "Answer — click to show the question" : "Question — click to reveal the answer"}
              style={{
                width: "100%", maxWidth: 560,
                height: "clamp(230px, 40vh, 300px)",
                perspective: "1600px", cursor: "pointer",
              }}
            >
              <div style={{
                position: "relative", width: "100%", height: "100%",
                transformStyle: "preserve-3d",
                transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)",
                transition: `transform 0.45s ${EASE}`,
              }}>
                {/* Front — question */}
                <CardFace
                  eyebrow="Question"
                  eyebrowColor="rgba(255,255,255,0.32)"
                  text={card.q}
                  fontSize={20}
                  hint="Click or press Space to flip"
                />
                {/* Back — answer (pre-rotated so it faces the reader once flipped) */}
                <CardFace
                  eyebrow="Answer"
                  eyebrowColor={ACCENT}
                  text={card.a}
                  fontSize={18}
                  back
                />
              </div>
            </div>
          </div>

          {/* Progress */}
          <div style={{ maxWidth: 560, width: "100%", margin: "0 auto" }}>
            <div style={{ height: 3, background: "rgba(255,255,255,0.07)", borderRadius: 3, overflow: "hidden" }}>
              <div style={{
                height: "100%", width: `${progressPct}%`, borderRadius: 3,
                background: `linear-gradient(90deg, rgba(var(--teal-rgb),0.55), ${ACCENT})`,
                transition: `width 0.3s ${EASE}`,
              }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
              <span style={{ color: "var(--text-dim)", fontSize: 12, fontVariantNumeric: "tabular-nums" }}>
                {pos + 1} / {total}
              </span>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => rebuild({ shuffle: true })} style={chipStyle()} title="Shuffle the deck (S)">
                  <Shuffle size={13} /> Shuffle
                </button>
                <button
                  onClick={toggleHard}
                  style={chipStyle(hardOnly)}
                  title={missedIdx.length ? `Study the ${missedIdx.length} card(s) you missed` : "No missed cards yet — studying the full deck"}
                >
                  <Layers size={13} /> Hard only{missedIdx.length ? ` (${missedIdx.length})` : ""}
                </button>
              </div>
            </div>
          </div>

          {/* Controls */}
          <div style={{ maxWidth: 560, width: "100%", margin: "0 auto", display: "flex", gap: 10 }}>
            <button onClick={goPrev} disabled={pos === 0} style={navBtnStyle(pos === 0)} title="Previous card (←)">
              <ChevronLeft size={16} /> Previous
            </button>
            <button
              onClick={() => setFlipped((f) => !f)}
              style={{
                flex: 1.2, background: ACCENT_SOFT, border: `1px solid ${ACCENT_EDGE}`,
                borderRadius: 14, padding: "13px 12px", color: ACCENT,
                fontSize: 14, fontWeight: 650, cursor: "pointer", fontFamily: "inherit",
                display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7,
              }}
              title="Flip the card (Space)"
            >
              <RotateCcw size={15} /> Flip
            </button>
            <button onClick={goNext} disabled={pos >= total - 1} style={navBtnStyle(pos >= total - 1)} title="Next card (→)">
              Next <ChevronRight size={16} />
            </button>
          </div>

          {/* Judge — only meaningful once the answer is showing */}
          <div style={{
            maxWidth: 560, width: "100%", margin: "0 auto", display: "flex", gap: 10,
            opacity: flipped ? 1 : 0,
            transform: flipped ? "translateY(0)" : "translateY(8px)",
            pointerEvents: flipped ? "auto" : "none",
            transition: `opacity 0.24s ${EASE}, transform 0.24s ${EASE}`,
          }}>
            <button onClick={() => grade(false)} style={judgeBtnStyle(false)} title="Missed it (1)">
              <X size={16} /> Missed
            </button>
            <button onClick={() => grade(true)} style={judgeBtnStyle(true)} title="Got it (2)">
              <Check size={16} /> Got it
            </button>
          </div>

          <p style={{
            textAlign: "center", color: "var(--text-dim)", fontSize: 11,
            margin: 0, opacity: 0.75, letterSpacing: "0.2px",
          }}>
            Space flip · ← → move · 1 missed · 2 got it · S shuffle · B browse
          </p>
        </>
      )}
    </div>
  );
}

// ── One face of the flip card ─────────────────────────────────────────────────
function CardFace({
  eyebrow, eyebrowColor, text, fontSize, hint, back = false,
}: {
  eyebrow: string; eyebrowColor: string; text: string; fontSize: number; hint?: string; back?: boolean;
}) {
  return (
    <div style={{
      position: "absolute", inset: 0,
      backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden",
      transform: back ? "rotateY(180deg)" : undefined,
      background: back
        ? "linear-gradient(160deg, rgba(var(--teal-rgb),0.10) 0%, rgba(255,255,255,0.05) 55%, rgba(255,255,255,0.035) 100%)"
        : "linear-gradient(160deg, rgba(255,255,255,0.075) 0%, rgba(255,255,255,0.045) 100%)",
      border: `1px solid ${back ? ACCENT_EDGE : BORDER}`,
      borderRadius: 20,
      boxShadow: "0 20px 50px rgba(0,0,0,0.34)",
      backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)",
      display: "flex", flexDirection: "column",
      padding: "22px 26px 18px",
      overflow: "hidden",
    }}>
      <p style={{ ...eyebrowStyle, color: eyebrowColor }}>{eyebrow}</p>
      {/* margin:auto (not align-items:center) so long text stays scrollable without clipping. */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", width: "100%" }}>
        <p style={{
          margin: "auto", width: "100%", textAlign: "center",
          color: "var(--text-primary)", fontSize, lineHeight: 1.62,
          fontWeight: back ? 400 : 500, letterSpacing: "-0.1px", overflowWrap: "anywhere",
          padding: "10px 0",
        }}>
          {text}
        </p>
      </div>
      {hint && (
        <p style={{ margin: 0, textAlign: "center", color: "rgba(255,255,255,0.24)", fontSize: 11, flexShrink: 0 }}>
          {hint}
        </p>
      )}
    </div>
  );
}

function navBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    flex: 1, background: GLASS, border: `1px solid ${BORDER}`, borderRadius: 14,
    padding: "13px 12px", color: disabled ? "var(--text-dim)" : "var(--text-secondary)",
    fontSize: 14, fontWeight: 600, fontFamily: "inherit",
    cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.45 : 1,
    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5,
  };
}

function judgeBtnStyle(good: boolean): React.CSSProperties {
  return {
    flex: 1, background: good ? GOOD_SOFT : BAD_SOFT,
    border: `1px solid ${good ? GOOD_EDGE : BAD_EDGE}`,
    borderRadius: 14, padding: "14px 12px",
    color: good ? GOOD : BAD, fontSize: 15, fontWeight: 650,
    cursor: "pointer", fontFamily: "inherit",
    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7,
  };
}

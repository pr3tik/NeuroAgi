// Assignment.jsx — Assignment list → detail view with AI draft generation.
// Reads live assignments from Canvas via AppContext.
// Shows empty state when Canvas is not connected.
// Draft supports text-selection toolbar (Shorten / Expand / Change Direction / Suggest / Copy).

import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import { createPortal } from "react-dom";
import { groq } from "../api/groq";
import { ChevronUp, ChevronDown } from "lucide-react";
import { buildStudentContext } from "../data/mockData";
import { useApp } from "../context/AppContext";

const SYSTEM =
  "You are an academic writing assistant. Write thorough, well-structured academic content. Use formal language, clear paragraph structure, and appropriate hedging where needed.";

const EDIT_SYSTEM =
  "You are an academic editing assistant. Follow the instruction precisely. Return ONLY the edited text — no preamble, no explanation, no quotation marks.";

const TOOLBAR_ACTIONS = ["Shorten", "Expand", "Change Direction", "Suggest", "Copy"];

const card = {
  background: "var(--color-surface)",
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius-card)",
  boxShadow: "var(--depth-line)",
};

function NoCanvasState() {
  return (
    <div style={{ ...card, padding: "24px" }}>
      <p style={{ color: "var(--text-secondary)", fontSize: "14px", marginBottom: "4px" }}>No Canvas connected</p>
      <p style={{ color: "var(--text-dim)", fontSize: "12px", lineHeight: "1.6" }}>
        Head to the Canvas page to connect your account and see your real assignments here.
      </p>
    </div>
  );
}

function AllDoneState() {
  return (
    <div style={{ ...card, padding: "24px", textAlign: "center" }}>
      <p style={{ color: "var(--text-secondary)", fontSize: "14px" }}>No pending assignments</p>
    </div>
  );
}

function formatDue(dueAt) {
  if (!dueAt) return null;
  const d = new Date(dueAt);
  const now = new Date();
  const diffDays = Math.round((+d - +now) / 86400000);
  if (diffDays < 0)  return "Past due";
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  if (diffDays < 7)  return `In ${diffDays} days`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function Assignment() {
  const { assignments: liveAssignments, canvasToken } = useApp();

  // Real assignments only — sorted by due date, unsubmitted
  const assignments = useMemo(() => {
    // Show synced assignments whenever they exist — extension-synced users have
    // no canvas_token, so don't gate on it (only on whether data is present).
    if (!liveAssignments.length) return [];
    return [...liveAssignments]
      .filter(a => !a.submission?.submittedAt)
      .sort((a, b) => {
        if (!a.dueAt && !b.dueAt) return 0;
        if (!a.dueAt) return 1;
        if (!b.dueAt) return -1;
        return +new Date(a.dueAt) - +new Date(b.dueAt);
      })
      .slice(0, 20);
  }, [liveAssignments, canvasToken]);

  const [selected, setSelected]   = useState(null);
  const [draft, setDraft]         = useState("");
  const [generating, setGenerating] = useState(false);
  const [selection, setSelection] = useState(null);
  const [toolbarPos, setToolbarPos] = useState(null);
  const [suggestMode, setSuggestMode] = useState(false);
  const [suggestInput, setSuggestInput] = useState("");
  const [editingIdx, setEditingIdx] = useState(null);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const draftRef = useRef(null);


  // Normalise live vs. placeholder assignment shape for the detail view
  const selectedPrompt = selected
    ? (selected.description || selected.prompt || "")
    : "";
  const selectedCourse = selected
    ? (selected.courseCode || selected.course || "")
    : "";
  const selectedTitle = selected?.name || selected?.title || "";

  const generateDraftFor = useCallback(async (assignment) => {
    if (generating) return;
    const prompt = assignment.description || assignment.prompt || "";
    setGenerating(true);
    setDraft("");
    const content = await groq(
      [{ role: "user", content: `Write a detailed academic response to this assignment: ${prompt}` }],
      SYSTEM + "\n\n" + buildStudentContext()
    );
    setDraft(content);
    setGenerating(false);
  }, [generating]);

  const generateDraft = useCallback(() => {
    if (selected) generateDraftFor(selected);
  }, [selected, generateDraftFor]);

  // Dismiss toolbar when tapping outside textarea
  useEffect(() => {
    function onTap(e) {
      if (!toolbarPos) return;
      if (draftRef.current && draftRef.current.contains(e.target)) return;
      setSelection(null);
      setToolbarPos(null);
    }
    document.addEventListener("touchstart", onTap, { passive: true });
    document.addEventListener("mousedown", onTap);
    return () => {
      document.removeEventListener("touchstart", onTap);
      document.removeEventListener("mousedown", onTap);
    };
  }, [toolbarPos]);

  const handleTextSelect = useCallback(() => {
    const ta = draftRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end   = ta.selectionEnd;
    if (start === end) { setSelection(null); setToolbarPos(null); return; }
    const text = ta.value.slice(start, end).trim();
    if (!text) return;
    setSelection({ text, start, end });

    // Approach: place a hidden mirror div INSIDE the page flow (not off-screen)
    // so getBoundingClientRect() gives real viewport coords on all browsers incl. Android.
    const computed = window.getComputedStyle(ta);
    const lineH    = parseFloat(computed.lineHeight) || 20;
    const TOOLBAR_W = 320;
    const TOOLBAR_H = 44;
    const vw = window.innerWidth;
    const vh = window.visualViewport?.height ?? window.innerHeight;

    // Build mirror with same layout as textarea, hidden via opacity+pointer-events
    const mirror = document.createElement("div");
    const copyProps = [
      "boxSizing","width","paddingTop","paddingRight","paddingBottom","paddingLeft",
      "borderTopWidth","borderRightWidth","borderBottomWidth","borderLeftWidth",
      "fontFamily","fontSize","fontWeight","fontStyle","letterSpacing","lineHeight",
      "textTransform","wordBreak","overflowWrap","whiteSpace","tabSize",
    ];
    copyProps.forEach(p => { mirror.style[p] = computed[p]; });
    // Position mirror exactly over the textarea so coords are viewport-accurate
    const taRect = ta.getBoundingClientRect();
    mirror.style.position       = "fixed";
    mirror.style.top            = taRect.top + "px";
    mirror.style.left           = taRect.left + "px";
    mirror.style.height         = taRect.height + "px";
    mirror.style.overflow       = "hidden";
    mirror.style.opacity        = "0";
    mirror.style.pointerEvents  = "none";
    mirror.style.userSelect     = "none";
    mirror.style.zIndex         = "-1";
    mirror.style.whiteSpace     = "pre-wrap";

    // Scroll the mirror to match textarea scroll position
    const mid = Math.floor((start + end) / 2);
    const before = document.createTextNode(ta.value.slice(0, mid));
    const marker = document.createElement("span");
    marker.textContent = ta.value.slice(mid, mid + 1) || "\u200b";
    const after = document.createTextNode(ta.value.slice(mid + 1));
    mirror.appendChild(before);
    mirror.appendChild(marker);
    mirror.appendChild(after);
    document.body.appendChild(mirror);
    mirror.scrollTop = ta.scrollTop;

    const markerRect = marker.getBoundingClientRect();
    document.body.removeChild(mirror);

    // markerRect is now in real viewport coords
    const rawX = markerRect.left + markerRect.width / 2;
    const rawY = markerRect.top;

    const left  = Math.max(TOOLBAR_W / 2 + 8, Math.min(vw - TOOLBAR_W / 2 - 8, rawX));
    const above = rawY - TOOLBAR_H - 8;
    const below = rawY + lineH + 8;
    const top   = above >= 8 ? above : Math.min(below, vh - TOOLBAR_H - 8);

    setToolbarPos({ top, left });
  }, []);

  const applyEdit = useCallback(async (instruction) => {
    if (!selection || !instruction.trim()) return;
    const idx = TOOLBAR_ACTIONS.indexOf("Suggest");
    setEditingIdx(idx);
    setSuggestMode(false);
    setSuggestInput("");
    const edited = await groq(
      [{ role: "user", content: `Original text: "${selection.text}"\n\nInstruction: ${instruction}` }],
      EDIT_SYSTEM
    );
    setDraft(prev => prev.slice(0, selection.start) + edited + prev.slice(selection.end));
    setSelection(null);
    setToolbarPos(null);
    setEditingIdx(null);
  }, [selection]);

  const handleToolbarAction = useCallback(async (action, idx) => {
    if (!selection) return;
    if (action === "Copy") {
      navigator.clipboard.writeText(selection.text);
      setSelection(null);
      setToolbarPos(null);
      return;
    }
    if (action === "Suggest") {
      setSuggestMode(true);
      return;
    }
    const instructionMap = {
      "Shorten":          "Make this shorter and more concise while preserving meaning.",
      "Expand":           "Expand this with more detail and elaboration.",
      "Change Direction": "Rewrite this with a different approach or perspective.",
    };
    setEditingIdx(idx);
    const edited = await groq(
      [{ role: "user", content: `Original text: "${selection.text}"\n\nInstruction: ${instructionMap[action]}` }],
      EDIT_SYSTEM
    );
    setDraft(prev => prev.slice(0, selection.start) + edited + prev.slice(selection.end));
    setSelection(null);
    setToolbarPos(null);
    setEditingIdx(null);
  }, [selection]);

  // ── Detail view ──────────────────────────────────────────────────────────────
  if (selected) {
    return (
      <div>
        <button
          onClick={() => { setSelected(null); setDraft(""); setSelection(null); setToolbarPos(null); setSuggestMode(false); }}
          style={{ background: "none", border: "none", color: "var(--text-secondary)", fontSize: "14px", cursor: "pointer", padding: "0 0 16px", fontFamily: "inherit", display: "flex", alignItems: "center", gap: "6px" }}
        >
          ← Assignments
        </button>

        <h1 style={{ fontSize: "20px", fontWeight: "600", color: "var(--text-primary)", marginBottom: "6px", letterSpacing: "-0.2px" }}>
          {selectedTitle}
        </h1>
        <p style={{ color: "var(--text-secondary)", fontSize: "13px", marginBottom: "16px" }}>{selectedCourse}</p>

        <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "12px", padding: "14px", marginBottom: "20px" }}>
          <div
            dangerouslySetInnerHTML={{ __html: selectedPrompt }}
            style={{ color: "var(--text-secondary)", fontSize: "13px", lineHeight: "1.65" }}
          />
        </div>

        {!draft && (
          generating
            ? <p style={{ color: "var(--text-dim)", fontSize: "13px", letterSpacing: "0.3px" }}>Generating draft…</p>
            : <button
                onClick={generateDraft}
                style={{ background: "var(--color-accent)", color: "#111111", border: "none", borderRadius: "var(--radius-btn)", padding: "12px 24px", fontSize: "14px", fontWeight: "600", cursor: "pointer", fontFamily: "inherit" }}
              >
                Generate Draft
              </button>
        )}

        {draft && (
          <>
            {toolbarPos && selection && createPortal(
              <div style={{ position: "fixed", top: toolbarPos.top, left: toolbarPos.left, transform: "translateX(-50%)", background: "rgba(24,24,24,0.96)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", border: "1px solid var(--color-border-strong)", borderRadius: "var(--radius-btn)", zIndex: 99999, overflow: "hidden", boxShadow: "0 4px 24px rgba(0,0,0,0.5)" }}>
                {!suggestMode ? (
                  <div style={{ display: "flex" }}>
                    {TOOLBAR_ACTIONS.map((action, idx) => (
                      <button key={action} onClick={() => handleToolbarAction(action, idx)} disabled={editingIdx !== null} style={{ background: "none", border: "none", borderRight: idx < TOOLBAR_ACTIONS.length - 1 ? "1px solid rgba(255,255,255,0.06)" : "none", color: editingIdx === idx ? "var(--text-secondary)" : "var(--text-primary)", fontSize: "12px", padding: "9px 12px", cursor: editingIdx !== null ? "not-allowed" : "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }} onMouseEnter={e => { if (editingIdx === null) e.currentTarget.style.background = "rgba(255,255,255,0.07)"; }} onMouseLeave={e => (e.currentTarget.style.background = "none")}>
                        {editingIdx === idx ? "…" : action}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div style={{ display: "flex", gap: "6px", padding: "6px" }}>
                    <input autoFocus placeholder="Your instruction…" value={suggestInput} onChange={e => setSuggestInput(e.target.value)} onKeyDown={e => e.key === "Enter" && applyEdit(suggestInput)} style={{ background: "rgba(255,255,255,0.06)", border: "1px solid var(--color-border)", borderRadius: "8px", padding: "7px 10px", color: "var(--text-primary)", fontSize: "13px", outline: "none", fontFamily: "inherit", width: "190px" }} />
                    <button onClick={() => applyEdit(suggestInput)} style={{ background: "var(--color-accent)", color: "#111", border: "none", borderRadius: "8px", padding: "7px 12px", fontSize: "12px", fontWeight: "600", cursor: "pointer", fontFamily: "inherit" }}>Apply</button>
                    <button onClick={() => setSuggestMode(false)} style={{ background: "none", border: "none", color: "var(--text-secondary)", fontSize: "16px", cursor: "pointer", padding: "0 4px" }}>×</button>
                  </div>
                )}
              </div>,
              document.body
            )}

            <textarea
              ref={draftRef}
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onMouseUp={handleTextSelect}
              onTouchEnd={() => setTimeout(handleTextSelect, 150)}
              onSelect={handleTextSelect}
              style={{ WebkitTouchCallout: "none", background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-card)", padding: "20px", color: "var(--text-primary)", fontSize: "14px", lineHeight: "1.85", whiteSpace: "pre-wrap", marginBottom: "14px", outline: "none", cursor: "text", minHeight: "320px", width: "100%", boxSizing: "border-box", resize: "vertical", fontFamily: "inherit" }}
            />

            <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "12px", marginBottom: "16px", overflow: "hidden" }}>
              <button onClick={() => setSourcesOpen(o => !o)} style={{ width: "100%", background: "none", border: "none", padding: "13px 16px", color: "var(--text-secondary)", fontSize: "13px", textAlign: "left", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", fontFamily: "inherit" }}>
                Sources & Reasoning
                <span style={{ opacity: 0.5, display: "flex" }}>{sourcesOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</span>
              </button>
              {sourcesOpen && (
                <div style={{ padding: "0 16px 14px", color: "var(--text-secondary)", fontSize: "13px", lineHeight: "1.65", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                  <p style={{ marginTop: "12px" }}>This draft was generated from your assignment brief using an AI language model. No external sources were cited automatically — add real academic references before submission.</p>
                </div>
              )}
            </div>

            <div style={{ display: "flex", gap: "10px" }}>
              <button onClick={() => navigator.clipboard.writeText(draft)} style={{ flex: 1, background: "var(--color-surface-hover)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-btn)", padding: "12px", color: "var(--text-primary)", fontSize: "14px", cursor: "pointer", fontFamily: "inherit", transition: "background var(--dur-base) var(--ease-apple)" }} onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.12)")} onMouseLeave={e => (e.currentTarget.style.background = "var(--color-surface-hover)")}>Copy</button>
              <button onClick={generateDraft} disabled={generating} style={{ flex: 1, background: "var(--color-surface-hover)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-btn)", padding: "12px", color: "var(--text-primary)", fontSize: "14px", cursor: generating ? "not-allowed" : "pointer", fontFamily: "inherit", opacity: generating ? 0.5 : 1 }} onMouseEnter={e => { if (!generating) e.currentTarget.style.background = "rgba(255,255,255,0.12)"; }} onMouseLeave={e => (e.currentTarget.style.background = "var(--color-surface-hover)")}>{generating ? "Regenerating…" : "Regenerate"}</button>
            </div>
          </>
        )}
      </div>
    );
  }

  // ── List view ────────────────────────────────────────────────────────────────
  return (
    <div>
      <h1 style={{ fontSize: "26px", fontWeight: "600", color: "var(--text-primary)", marginBottom: "4px", letterSpacing: "-0.3px" }}>
        Assignments
      </h1>
      <p style={{ color: "var(--text-dim)", fontSize: "14px", marginBottom: "28px" }}>
        {assignments.length > 0
          ? `${assignments.length} pending assignment${assignments.length !== 1 ? "s" : ""}`
          : !canvasToken
          ? "Connect Canvas or sync with the extension to see your assignments"
          : "You're all caught up"}
      </p>

      {assignments.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {assignments.map((a) => {
            const due = formatDue(a.dueAt);
            const isLate = a.submission?.missing || (a.dueAt && new Date(a.dueAt) < new Date() && !a.submission?.submittedAt);
            return (
              <button
                key={a.id}
                onClick={() => { setSelected(a); setDraft(""); generateDraftFor(a); }}
                style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-card)", boxShadow: "var(--depth-line)", padding: "18px", cursor: "pointer", textAlign: "left", width: "100%", fontFamily: "inherit", transition: "background var(--dur-base) var(--ease-apple)" }}
                onMouseEnter={e => (e.currentTarget.style.background = "var(--color-surface-hover)")}
                onMouseLeave={e => (e.currentTarget.style.background = "var(--color-surface)")}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px" }}>
                  <p style={{ color: "var(--text-primary)", fontSize: "15px", fontWeight: "500", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {a.name || a.title}
                  </p>
                  {due && (
                    <span style={{ fontSize: "11px", padding: "3px 8px", borderRadius: "20px", background: isLate ? "rgba(255,59,48,0.1)" : "rgba(255,255,255,0.06)", color: isLate ? "rgba(255,100,90,0.85)" : "var(--text-dim)", flexShrink: 0 }}>
                      {due}
                    </span>
                  )}
                </div>
                <p style={{ color: "var(--text-secondary)", fontSize: "12px", marginTop: "4px" }}>
                  {a.courseCode || a.course}
                  {a.pointsPossible > 0 && <span style={{ color: "var(--text-dim)", marginLeft: "8px" }}>{a.pointsPossible} pts</span>}
                </p>
              </button>
            );
          })}
        </div>
      ) : !canvasToken ? (
        <NoCanvasState />
      ) : (
        <AllDoneState />
      )}
    </div>
  );
}



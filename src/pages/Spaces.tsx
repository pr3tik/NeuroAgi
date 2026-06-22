// src/pages/Spaces.tsx — YouLearn Phase 3: Spaces workspace hub.
// A Space = topic workspace (Biology 4.131, CSE 331…) holding documents,
// chat, flashcards, and a future exams tab. Reuses DocReader + flashcards_v2.

import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { supabase } from "../api/supabase";
import { useApp }   from "../context/AppContext";
import DocReader    from "../components/DocReader";

// ── Constants ─────────────────────────────────────────────────────────────

const PALETTE = [
  "#7c6fe0", "#4a9eff", "#50c47a", "#f0a050",
  "#e05c7c", "#c49a3c", "#5bc4c4", "#a870d0",
];

const EASE_OUT: [number, number, number, number] = [0.25, 0.46, 0.45, 0.94];
const SPRING = { type: "spring", stiffness: 380, damping: 36 } as const;

// ── Types ─────────────────────────────────────────────────────────────────

interface Space {
  id: string; name: string; color: string;
  created_at: string; last_active: string;
}

interface SpaceItem {
  id: string; item_type: string; item_ref: string;
  title: string | null; created_at: string;
}

interface DocFile {
  id: string; name: string; file_type: string | null;
  summary: string | null; highlights: string[] | null;
  content_text: string | null; processed_at: string | null;
}

interface Flashcard { id: string; question: string; answer: string; course_id: string; }

// ── Helpers ───────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const d = Date.now() - new Date(iso).getTime();
  const m = Math.floor(d / 60_000);
  if (m < 2)  return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  return days === 1 ? "yesterday" : `${days}d ago`;
}

// ── Space card ────────────────────────────────────────────────────────────

function SpaceCard({
  space, docCount, onOpen, onDelete,
}: {
  space: Space; docCount: number;
  onOpen: () => void; onDelete: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const fn = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", fn);
    return () => document.removeEventListener("mousedown", fn);
  }, [menuOpen]);

  return (
    <motion.div
      layout
      whileHover={{ y: -1 }}
      transition={{ duration: 0.18, ease: EASE_OUT }}
      onClick={onOpen}
      style={{
        display: "flex", alignItems: "center", gap: 14,
        padding: "15px 16px",
        background: "var(--color-surface)",
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-card)",
        cursor: "pointer", position: "relative",
        transition: "border-color 0.15s, box-shadow 0.15s",
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(255,255,255,0.14)";
        (e.currentTarget as HTMLDivElement).style.boxShadow = "0 4px 16px rgba(0,0,0,0.28)";
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(255,255,255,0.08)";
        (e.currentTarget as HTMLDivElement).style.boxShadow = "none";
      }}
    >
      {/* Color dot */}
      <div style={{
        width: 10, height: 10, borderRadius: "50%", flexShrink: 0,
        background: space.color,
        boxShadow: `0 0 10px ${space.color}55`,
      }} />

      {/* Name + meta */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{
          fontSize: 15, fontWeight: 500,
          color: "var(--text-primary)", lineHeight: 1.3,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>{space.name}</p>
        <p style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 3 }}>
          {docCount} doc{docCount !== 1 ? "s" : ""} · {timeAgo(space.last_active)}
        </p>
      </div>

      {/* ··· menu */}
      <div
        ref={menuRef}
        style={{ position: "relative", flexShrink: 0 }}
        onClick={e => e.stopPropagation()}
      >
        <button
          onClick={() => setMenuOpen(v => !v)}
          style={{
            width: 28, height: 28, borderRadius: "50%",
            background: "transparent", border: "none",
            color: "var(--text-dim)", cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 17, letterSpacing: "1px",
            transition: "background 0.12s, color 0.12s",
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.08)";
            (e.currentTarget as HTMLButtonElement).style.color = "var(--text-secondary)";
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLButtonElement).style.background = "transparent";
            (e.currentTarget as HTMLButtonElement).style.color = "var(--text-dim)";
          }}
        >···</button>

        <AnimatePresence>
          {menuOpen && (
            <motion.div
              initial={{ opacity: 0, scale: 0.94, y: -4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.94, y: -4 }}
              transition={{ duration: 0.13, ease: EASE_OUT }}
              style={{
                position: "fixed", zIndex: 400,
                background: "#1e1e1e",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 10, padding: "4px 0",
                minWidth: 130,
                boxShadow: "0 8px 32px rgba(0,0,0,0.55)",
              }}
            >
              <button
                onClick={() => { setMenuOpen(false); onDelete(); }}
                style={{
                  display: "block", width: "100%",
                  padding: "9px 14px",
                  background: "none", border: "none",
                  color: "rgba(255,90,80,0.9)",
                  fontSize: 13, textAlign: "left",
                  cursor: "pointer", fontFamily: "inherit",
                }}
                onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.background = "rgba(255,59,48,0.1)")}
                onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.background = "none")}
              >Delete space</button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Chevron */}
      <svg width="7" height="12" viewBox="0 0 7 12" fill="none" style={{ flexShrink: 0, opacity: 0.2 }}>
        <path d="M1 1l5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </motion.div>
  );
}

// ── Create Space bottom sheet ─────────────────────────────────────────────

function CreateSpaceSheet({
  onClose, onCreate,
}: {
  onClose: () => void; onCreate: (name: string, color: string) => void;
}) {
  const [name, setName]   = useState("");
  const [color, setColor] = useState(PALETTE[0]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 100); }, []);
  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [onClose]);

  const submit = () => { if (name.trim()) onCreate(name.trim(), color); };

  const sheet = (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 500,
        background: "rgba(0,0,0,0.6)", backdropFilter: "blur(10px) saturate(0.8)",
        display: "flex", alignItems: "flex-end", justifyContent: "center",
        paddingBottom: "env(safe-area-inset-bottom,0px)",
      }}
    >
      <motion.div
        initial={{ y: 48, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 40, opacity: 0 }}
        transition={SPRING}
        onClick={e => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: 500,
          background: "#1c1c1e",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: "22px 22px 0 0",
          padding: "10px 22px 40px",
        }}
      >
        {/* Handle */}
        <div style={{
          width: 38, height: 4, borderRadius: 2,
          background: "rgba(255,255,255,0.18)", margin: "8px auto 24px",
        }} />

        <p style={{
          fontSize: 18, fontWeight: 700,
          color: "var(--text-primary)", marginBottom: 20,
          letterSpacing: "-0.2px",
        }}>New Space</p>

        {/* Name input */}
        <input
          ref={inputRef}
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") submit(); }}
          placeholder="e.g. Biology 4.131"
          maxLength={60}
          style={{
            width: "100%", boxSizing: "border-box",
            background: "rgba(255,255,255,0.06)",
            border: "1.5px solid rgba(255,255,255,0.1)",
            borderRadius: "var(--radius-btn)",
            padding: "13px 15px",
            color: "var(--text-primary)", fontSize: 15,
            outline: "none", fontFamily: "inherit",
            marginBottom: 22,
            transition: "border-color 0.15s",
          }}
          onFocus={e  => (e.target.style.borderColor = "rgba(255,255,255,0.3)")}
          onBlur={e   => (e.target.style.borderColor = "rgba(255,255,255,0.1)")}
        />

        {/* Color row */}
        <p style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 12 }}>Accent</p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 28 }}>
          {PALETTE.map(c => (
            <button
              key={c}
              onClick={() => setColor(c)}
              style={{
                width: 30, height: 30, borderRadius: "50%",
                background: c, cursor: "pointer",
                border: color === c ? "2.5px solid white" : "2.5px solid transparent",
                transform: color === c ? "scale(1.18)" : "scale(1)",
                transition: "transform 0.15s, border-color 0.15s, box-shadow 0.15s",
                boxShadow: color === c ? `0 0 12px ${c}99` : "none",
                outline: "none",
              }}
            />
          ))}
        </div>

        {/* Submit */}
        <button
          onClick={submit}
          disabled={!name.trim()}
          style={{
            width: "100%", padding: "14px",
            background: name.trim() ? "rgba(196,154,60,0.14)" : "rgba(255,255,255,0.04)",
            border: `1px solid ${name.trim() ? "rgba(196,154,60,0.38)" : "rgba(255,255,255,0.07)"}`,
            borderRadius: "var(--radius-btn)",
            color: name.trim() ? "#C49A3C" : "var(--text-tertiary)",
            fontSize: 15, fontWeight: 600,
            cursor: name.trim() ? "pointer" : "default",
            fontFamily: "inherit", transition: "all 0.15s",
          }}
        >Create Space</button>
      </motion.div>
    </motion.div>
  );

  return typeof document !== "undefined" ? createPortal(sheet, document.body) : null;
}

// ── Add Document bottom sheet ─────────────────────────────────────────────

function AddDocSheet({
  userId, existingRefs, onAdd, onClose,
}: {
  userId: string; existingRefs: Set<string>;
  onAdd: (file: DocFile) => void; onClose: () => void;
}) {
  const [files, setFiles] = useState<DocFile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.from("files")
      .select("id,name,file_type,summary,highlights,content_text,processed_at")
      .eq("user_id", userId)
      .not("processed_at", "is", null)
      .order("processed_at", { ascending: false })
      .then(({ data }) => {
        setFiles(((data ?? []) as DocFile[]).filter(f => !existingRefs.has(f.id)));
        setLoading(false);
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const sheet = (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 501,
        background: "rgba(0,0,0,0.6)", backdropFilter: "blur(10px)",
        display: "flex", alignItems: "flex-end", justifyContent: "center",
        paddingBottom: "env(safe-area-inset-bottom,0px)",
      }}
    >
      <motion.div
        initial={{ y: 48, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
        exit={{ y: 40, opacity: 0 }} transition={SPRING}
        onClick={e => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: 500,
          background: "#1c1c1e",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: "22px 22px 0 0",
          padding: "10px 22px 40px",
          maxHeight: "72dvh", overflowY: "auto",
        }}
      >
        <div style={{
          width: 38, height: 4, borderRadius: 2,
          background: "rgba(255,255,255,0.18)", margin: "8px auto 20px",
        }} />
        <p style={{ fontSize: 18, fontWeight: 700, color: "var(--text-primary)", marginBottom: 16 }}>
          Add Document
        </p>

        {loading && (
          <p style={{ color: "var(--text-dim)", fontSize: 13, textAlign: "center", padding: "24px 0" }}>
            Loading…
          </p>
        )}
        {!loading && files.length === 0 && (
          <div style={{ textAlign: "center", padding: "28px 0" }}>
            <p style={{ color: "var(--text-secondary)", fontSize: 13, marginBottom: 4 }}>
              No available documents
            </p>
            <p style={{ color: "var(--text-dim)", fontSize: 12 }}>
              Upload files in the Files section first.
            </p>
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {files.map(f => (
            <motion.button
              key={f.id}
              initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
              onClick={() => { onAdd(f); onClose(); }}
              style={{
                display: "flex", alignItems: "center", gap: 12,
                padding: "12px 14px",
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.07)",
                borderRadius: 12, cursor: "pointer",
                textAlign: "left", fontFamily: "inherit",
                transition: "background 0.12s, border-color 0.12s",
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.08)";
                (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(255,255,255,0.12)";
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.04)";
                (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(255,255,255,0.07)";
              }}
            >
              <span style={{ fontSize: 20, flexShrink: 0, lineHeight: 1 }}>
                {f.file_type?.includes("pdf") ? "📄" : f.file_type?.includes("image") ? "🖼" : "📝"}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{
                  fontSize: 13, fontWeight: 500, color: "var(--text-primary)",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>{f.name}</p>
                {f.summary && (
                  <p style={{
                    fontSize: 11, color: "var(--text-dim)", marginTop: 2,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>{f.summary.slice(0, 80)}</p>
                )}
              </div>
            </motion.button>
          ))}
        </div>
      </motion.div>
    </motion.div>
  );

  return typeof document !== "undefined" ? createPortal(sheet, document.body) : null;
}

// ── Space Chat ────────────────────────────────────────────────────────────

function SpaceChat({
  docRefs, userId,
}: {
  docRefs: string[]; userId: string;
}) {
  const [msgs,    setMsgs]   = useState<{ id: string; role: "user" | "assistant"; content: string }[]>([]);
  const [input,   setInput]  = useState("");
  const [busy,    setBusy]   = useState(false);
  const [ctx,     setCtx]    = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  // Build context string from summaries
  useEffect(() => {
    if (!docRefs.length) { setCtx(""); return; }
    supabase.from("files")
      .select("name, summary, content_text")
      .in("id", docRefs)
      .then(({ data }) => {
        const built = (data ?? []).map(d =>
          `Document: "${d.name}"\nSummary: ${d.summary ?? "(none)"}\n${
            d.content_text ? `Excerpt:\n${d.content_text.slice(0, 1500)}` : ""
          }`
        ).join("\n\n---\n\n");
        setCtx(built);
      });
  }, [docRefs.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs]);

  const send = useCallback(async () => {
    if (!input.trim() || busy) return;
    const text = input.trim();
    const uid  = `u${Date.now()}`;
    const aid  = `a${Date.now()}`;
    setMsgs(m => [...m, { id: uid, role: "user", content: text }, { id: aid, role: "assistant", content: "" }]);
    setInput("");
    setBusy(true);

    const system = ctx
      ? `You are a study assistant for this student's space. Use these documents as your primary knowledge:\n\n${ctx}\n\nAnswer concisely and accurately. Refer to specific documents when relevant.`
      : "You are a study assistant. Help the student with their academic questions.";

    const history = msgs.slice(-8).map(m => ({ role: m.role, content: m.content }));

    try {
      const res = await fetch("/api/claude", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [...history, { role: "user", content: text }],
          system, max_tokens: 900, stream: true,
        }),
      });
      if (!res.ok) throw new Error(`${res.status}`);

      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      let buf = "", accumulated = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n"); buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const d = line.slice(5).trim();
          if (!d || d === "[DONE]") continue;
          try {
            const e = JSON.parse(d);
            if (e.type === "content_block_delta" && e.delta?.type === "text_delta") {
              accumulated += e.delta.text;
              const snap = accumulated;
              setMsgs(m => m.map(msg => msg.id === aid ? { ...msg, content: snap } : msg));
            }
          } catch {}
        }
      }
    } catch {
      setMsgs(m => m.map(msg => msg.id === aid
        ? { ...msg, content: "Couldn't reach Claude. Try again." }
        : msg
      ));
    }
    setBusy(false);
  }, [input, busy, msgs, ctx]);

  const isEmpty = msgs.length === 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {/* Messages */}
      <div style={{
        flex: 1, overflowY: "auto", paddingBottom: 8,
        scrollbarWidth: "thin",
      }}>
        {isEmpty && (
          <div style={{
            display: "flex", flexDirection: "column", alignItems: "center",
            justifyContent: "center", padding: "40px 24px",
            color: "var(--text-dim)", textAlign: "center",
          }}>
            <div style={{
              width: 52, height: 52, borderRadius: "50%",
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 22, marginBottom: 14,
            }}>✦</div>
            <p style={{ fontSize: 14, color: "var(--text-secondary)", marginBottom: 6, fontWeight: 500 }}>
              Space Chat
            </p>
            <p style={{ fontSize: 12, lineHeight: 1.6, maxWidth: 240 }}>
              {docRefs.length
                ? `Ask anything across the ${docRefs.length} document${docRefs.length !== 1 ? "s" : ""} in this space.`
                : "Add documents to this space, then ask anything about them."}
            </p>
          </div>
        )}

        {msgs.map(m => (
          <motion.div
            key={m.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18 }}
            style={{
              display: "flex",
              justifyContent: m.role === "user" ? "flex-end" : "flex-start",
              marginBottom: 9,
            }}
          >
            <div style={{
              maxWidth: "86%", padding: "9px 13px",
              borderRadius: m.role === "user"
                ? "16px 16px 4px 16px"
                : "16px 16px 16px 4px",
              background: m.role === "user"
                ? "rgba(196,154,60,0.13)"
                : "rgba(255,255,255,0.06)",
              border: m.role === "user"
                ? "1px solid rgba(196,154,60,0.2)"
                : "1px solid rgba(255,255,255,0.07)",
              color: "var(--text-primary)",
              fontSize: 13, lineHeight: 1.65,
              whiteSpace: "pre-wrap",
            }}>
              {m.content || (m.role === "assistant" && busy ? (
                <span style={{ opacity: 0.4 }}>● ● ●</span>
              ) : null)}
            </div>
          </motion.div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input row */}
      <div style={{
        display: "flex", gap: 8, alignItems: "center",
        paddingTop: 12,
        borderTop: "1px solid rgba(255,255,255,0.06)",
        flexShrink: 0,
      }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder={docRefs.length ? "Ask about this space…" : "Add documents first…"}
          disabled={!docRefs.length}
          style={{
            flex: 1,
            background: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,255,255,0.09)",
            borderRadius: 10, padding: "10px 13px",
            color: "var(--text-primary)", fontSize: 13,
            outline: "none", fontFamily: "inherit",
            opacity: !docRefs.length ? 0.5 : 1,
            transition: "border-color 0.15s",
          }}
          onFocus={e  => (e.target.style.borderColor = "rgba(255,255,255,0.22)")}
          onBlur={e   => (e.target.style.borderColor = "rgba(255,255,255,0.09)")}
        />
        <button
          onClick={send}
          disabled={!input.trim() || busy || !docRefs.length}
          style={{
            width: 36, height: 36, borderRadius: "50%", flexShrink: 0,
            background: input.trim() && !busy && docRefs.length
              ? "rgba(196,154,60,0.18)"
              : "rgba(255,255,255,0.04)",
            border: `1px solid ${input.trim() && !busy && docRefs.length
              ? "rgba(196,154,60,0.32)"
              : "rgba(255,255,255,0.07)"}`,
            color: input.trim() && !busy && docRefs.length ? "#C49A3C" : "var(--text-tertiary)",
            cursor: input.trim() && !busy && docRefs.length ? "pointer" : "default",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 15, transition: "all 0.15s",
          }}
        >↑</button>
      </div>
    </div>
  );
}

// ── Space Detail ──────────────────────────────────────────────────────────

type DetailTab = "docs" | "chat" | "cards" | "exams";

function SpaceDetail({
  space, userId, onBack, onNavigate,
}: {
  space: Space; userId: string;
  onBack: () => void; onNavigate: (page: string) => void;
}) {
  const [tab,       setTab]       = useState<DetailTab>("docs");
  const [items,     setItems]     = useState<SpaceItem[]>([]);
  const [docFiles,  setDocFiles]  = useState<Map<string, DocFile>>(new Map());
  const [cards,     setCards]     = useState<Flashcard[]>([]);
  const [addingDoc, setAddingDoc] = useState(false);
  const [showAdd,   setShowAdd]   = useState(false);
  const [openFile,  setOpenFile]  = useState<DocFile | null>(null);

  const docItems = items.filter(i => i.item_type === "document");
  const docRefs  = docItems.map(i => i.item_ref);

  // Load space items
  useEffect(() => {
    supabase.from("space_items")
      .select("*")
      .eq("space_id", space.id)
      .eq("user_id", userId)
      .order("processed_at", { ascending: false })
      .then(({ data }) => setItems((data ?? []) as SpaceItem[]));
  }, [space.id, userId]);

  // Load file objects for doc items
  useEffect(() => {
    if (!docRefs.length) return;
    supabase.from("files")
      .select("id,name,file_type,summary,highlights,content_text,processed_at")
      .in("id", docRefs)
      .then(({ data }) => {
        const m = new Map<string, DocFile>();
        (data ?? []).forEach(f => m.set(f.id, f as DocFile));
        setDocFiles(m);
      });
  }, [docRefs.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load flashcards for docs in this space
  useEffect(() => {
    if (!docRefs.length || !userId) return;
    supabase.from("flashcards_v2")
      .select("id, question, answer, course_id")
      .eq("user_id", userId)
      .in("course_id", docRefs)
      .then(({ data }) => setCards((data ?? []) as Flashcard[]));
  }, [docRefs.join(","), userId]); // eslint-disable-line react-hooks/exhaustive-deps

  const addDoc = useCallback(async (file: DocFile) => {
    setAddingDoc(true);
    const { data } = await supabase.from("space_items").insert({
      space_id: space.id, user_id: userId,
      item_type: "document", item_ref: file.id, title: file.name,
    }).select().single();
    if (data) {
      setItems(prev => [data as SpaceItem, ...prev]);
      setDocFiles(prev => new Map(prev).set(file.id, file));
    }
    await supabase.from("spaces")
      .update({ last_active: new Date().toISOString() })
      .eq("id", space.id);
    setAddingDoc(false);
  }, [space.id, userId]);

  const removeDoc = useCallback(async (itemId: string, fileId: string) => {
    await supabase.from("space_items").delete().eq("id", itemId);
    setItems(prev => prev.filter(i => i.id !== itemId));
    setDocFiles(prev => { const m = new Map(prev); m.delete(fileId); return m; });
  }, []);

  // When a file is open, show DocReader full-screen
  if (openFile) {
    return (
      <DocReader
        file={openFile as any}
        onClose={() => setOpenFile(null)}
        onNavigate={onNavigate}
      />
    );
  }

  // Group cards by document
  const cardsByDoc = cards.reduce<Record<string, Flashcard[]>>((acc, c) => {
    (acc[c.course_id] ??= []).push(c); return acc;
  }, {});

  const TABS: { key: DetailTab; label: string }[] = [
    { key: "docs",  label: "Documents"  },
    { key: "chat",  label: "Chat"       },
    { key: "cards", label: "Flashcards" },
    { key: "exams", label: "Exams"      },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 24 }}
      transition={{ duration: 0.22, ease: EASE_OUT }}
      style={{
        display: "flex", flexDirection: "column",
        minHeight: "calc(100dvh - 52px)",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 22, flexShrink: 0 }}>
        <button
          onClick={onBack}
          style={{
            width: 32, height: 32, borderRadius: "50%",
            background: "rgba(255,255,255,0.07)",
            border: "1px solid rgba(255,255,255,0.09)",
            color: "var(--text-secondary)", cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0, transition: "background 0.12s",
          }}
          onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.12)")}
          onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.07)")}
        >
          <svg width="7" height="12" viewBox="0 0 7 12" fill="none">
            <path d="M6 1L1 6.5L6 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>

        <div style={{
          width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
          background: space.color, boxShadow: `0 0 10px ${space.color}77`,
        }} />

        <h2 style={{
          fontSize: 19, fontWeight: 700,
          color: "var(--text-primary)", letterSpacing: "-0.2px",
          flex: 1, minWidth: 0,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>{space.name}</h2>
      </div>

      {/* Tab bar */}
      <div style={{
        display: "flex", gap: "2px",
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.07)",
        borderRadius: 11, padding: "3px",
        marginBottom: 20, flexShrink: 0,
      }}>
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              flex: 1, padding: "7px 4px",
              background: tab === t.key ? "rgba(255,255,255,0.1)" : "transparent",
              border: `1px solid ${tab === t.key ? "rgba(255,255,255,0.1)" : "transparent"}`,
              borderRadius: 8,
              color: tab === t.key ? "var(--text-primary)" : "var(--text-dim)",
              fontSize: 12, fontWeight: tab === t.key ? 600 : 400,
              cursor: "pointer", fontFamily: "inherit",
              transition: "all 0.14s", whiteSpace: "nowrap",
            }}
          >{t.label}</button>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, minHeight: 0 }}>
        <AnimatePresence mode="wait">

          {/* DOCUMENTS */}
          {tab === "docs" && (
            <motion.div
              key="docs"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.14 }}
            >
              {docItems.length === 0 ? (
                <div style={{ textAlign: "center", padding: "44px 20px" }}>
                  <div style={{
                    fontSize: 36, marginBottom: 14, opacity: 0.35,
                  }}>📁</div>
                  <p style={{ fontSize: 14, color: "var(--text-secondary)", fontWeight: 500, marginBottom: 5 }}>
                    No documents
                  </p>
                  <p style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.6 }}>
                    Add documents from your library to read and chat with them here.
                  </p>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 9, marginBottom: 14 }}>
                  {docItems.map((item, i) => {
                    const file = docFiles.get(item.item_ref);
                    return (
                      <motion.div
                        key={item.id}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.18, delay: i * 0.04, ease: EASE_OUT }}
                        style={{
                          display: "flex", alignItems: "center", gap: 12,
                          padding: "13px 15px",
                          background: "var(--color-surface)",
                          border: "1px solid var(--color-border)",
                          borderRadius: 13, cursor: "pointer",
                          transition: "border-color 0.14s, box-shadow 0.14s",
                        }}
                        onClick={() => file && setOpenFile(file)}
                        onMouseEnter={e => {
                          (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(255,255,255,0.14)";
                          (e.currentTarget as HTMLDivElement).style.boxShadow = "0 2px 10px rgba(0,0,0,0.22)";
                        }}
                        onMouseLeave={e => {
                          (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(255,255,255,0.08)";
                          (e.currentTarget as HTMLDivElement).style.boxShadow = "none";
                        }}
                      >
                        <span style={{ fontSize: 20, flexShrink: 0, lineHeight: 1 }}>
                          {file?.file_type?.includes("pdf") ? "📄" : "📝"}
                        </span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{
                            fontSize: 13, fontWeight: 500,
                            color: "var(--text-primary)",
                            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                          }}>{item.title ?? "(Untitled)"}</p>
                          {file?.summary && (
                            <p style={{
                              fontSize: 11, color: "var(--text-dim)", marginTop: 2,
                              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                            }}>{file.summary.slice(0, 70)}</p>
                          )}
                        </div>
                        <button
                          onClick={e => { e.stopPropagation(); removeDoc(item.id, item.item_ref); }}
                          title="Remove from space"
                          style={{
                            width: 24, height: 24, borderRadius: "50%", flexShrink: 0,
                            background: "none", border: "none",
                            color: "var(--text-dim)", cursor: "pointer",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            fontSize: 15, transition: "color 0.12s",
                          }}
                          onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.color = "rgba(255,90,80,0.85)")}
                          onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.color = "var(--text-dim)")}
                        >×</button>
                      </motion.div>
                    );
                  })}
                </div>
              )}

              {/* Add document */}
              <button
                onClick={() => setShowAdd(true)}
                disabled={addingDoc}
                style={{
                  width: "100%", padding: "13px",
                  background: "rgba(255,255,255,0.03)",
                  border: "1.5px dashed rgba(255,255,255,0.1)",
                  borderRadius: 13, color: "var(--text-dim)",
                  fontSize: 13, cursor: "pointer",
                  fontFamily: "inherit", transition: "all 0.14s",
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.06)";
                  (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(255,255,255,0.2)";
                  (e.currentTarget as HTMLButtonElement).style.color = "var(--text-secondary)";
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.03)";
                  (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(255,255,255,0.1)";
                  (e.currentTarget as HTMLButtonElement).style.color = "var(--text-dim)";
                }}
              >
                {addingDoc ? "Adding…" : "+ Add document"}
              </button>
            </motion.div>
          )}

          {/* CHAT */}
          {tab === "chat" && (
            <motion.div
              key="chat"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.14 }}
              style={{
                height: "calc(100dvh - 300px)",
                minHeight: 300,
                display: "flex", flexDirection: "column",
              }}
            >
              <SpaceChat docRefs={docRefs} userId={userId} />
            </motion.div>
          )}

          {/* FLASHCARDS */}
          {tab === "cards" && (
            <motion.div
              key="cards"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.14 }}
            >
              {Object.keys(cardsByDoc).length === 0 ? (
                <div style={{ textAlign: "center", padding: "44px 20px" }}>
                  <div style={{ fontSize: 36, marginBottom: 14, opacity: 0.35 }}>🗂</div>
                  <p style={{ fontSize: 14, color: "var(--text-secondary)", fontWeight: 500, marginBottom: 5 }}>
                    No flashcards yet
                  </p>
                  <p style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.6 }}>
                    Open a document → select text → Flashcards to generate cards from it.
                  </p>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {Object.entries(cardsByDoc).map(([docId, deck], i) => {
                    const file = docFiles.get(docId);
                    return (
                      <motion.div
                        key={docId}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.18, delay: i * 0.05 }}
                        style={{
                          padding: "14px 16px",
                          background: "var(--color-surface)",
                          border: "1px solid var(--color-border)",
                          borderRadius: 13,
                        }}
                      >
                        <div style={{
                          display: "flex", alignItems: "center",
                          justifyContent: "space-between", marginBottom: 8,
                        }}>
                          <p style={{
                            fontSize: 13, fontWeight: 600, color: "var(--text-primary)",
                            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                            flex: 1, minWidth: 0, marginRight: 8,
                          }}>{file?.name ?? "Document"}</p>
                          <span style={{
                            fontSize: 11, flexShrink: 0,
                            color: "rgba(196,154,60,0.9)",
                            background: "rgba(196,154,60,0.1)",
                            padding: "2px 9px", borderRadius: 20,
                            border: "1px solid rgba(196,154,60,0.22)",
                          }}>
                            {deck.length} card{deck.length !== 1 ? "s" : ""}
                          </span>
                        </div>
                        <p style={{
                          fontSize: 12, color: "var(--text-dim)",
                          fontStyle: "italic", lineHeight: 1.5,
                          overflow: "hidden", textOverflow: "ellipsis",
                          display: "-webkit-box", WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical",
                        }}>"{deck[0]?.question}"</p>
                      </motion.div>
                    );
                  })}
                </div>
              )}
            </motion.div>
          )}

          {/* EXAMS — Phase 4 placeholder */}
          {tab === "exams" && (
            <motion.div
              key="exams"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.14 }}
              style={{ textAlign: "center", padding: "52px 24px" }}
            >
              <div style={{
                width: 68, height: 68, borderRadius: 18,
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.08)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 30, margin: "0 auto 20px",
              }}>📝</div>
              <p style={{
                fontSize: 16, fontWeight: 600,
                color: "var(--text-secondary)", marginBottom: 8,
              }}>Exams — Phase 4</p>
              <p style={{
                fontSize: 13, color: "var(--text-dim)",
                lineHeight: 1.7, maxWidth: 260, margin: "0 auto",
              }}>
                Generate timed practice exams from your space documents.
                Choose number of questions, type, and difficulty.
              </p>
            </motion.div>
          )}

        </AnimatePresence>
      </div>

      {/* Add document sheet */}
      <AnimatePresence>
        {showAdd && (
          <AddDocSheet
            userId={userId}
            existingRefs={new Set(docRefs)}
            onAdd={addDoc}
            onClose={() => setShowAdd(false)}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ── Main Spaces page ──────────────────────────────────────────────────────

export default function Spaces() {
  const { userId, setPendingNav } = useApp() as any;

  const [spaces,    setSpaces]    = useState<Space[]>([]);
  const [docCounts, setDocCounts] = useState<Map<string, number>>(new Map());
  const [loading,   setLoading]   = useState(true);
  const [openSpace, setOpenSpace] = useState<Space | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const loadSpaces = useCallback(async () => {
    if (!userId) return;
    const { data: rows } = await supabase
      .from("spaces")
      .select("*")
      .eq("user_id", userId)
      .order("last_active", { ascending: false });

    const list = (rows ?? []) as Space[];
    setSpaces(list);

    if (list.length) {
      const { data: items } = await supabase
        .from("space_items")
        .select("space_id")
        .eq("user_id", userId)
        .eq("item_type", "document")
        .in("space_id", list.map(s => s.id));

      const counts = new Map<string, number>();
      (items ?? []).forEach(i => counts.set(i.space_id, (counts.get(i.space_id) ?? 0) + 1));
      setDocCounts(counts);
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => { loadSpaces(); }, [loadSpaces]);

  const createSpace = useCallback(async (name: string, color: string) => {
    if (!userId) return;
    setShowCreate(false);
    const { data } = await supabase.from("spaces").insert({
      user_id: userId, name, color,
    }).select().single();
    if (data) {
      const s = data as Space;
      setSpaces(prev => [s, ...prev]);
      setDocCounts(prev => new Map(prev).set(s.id, 0));
      setOpenSpace(s);
    }
  }, [userId]);

  const deleteSpace = useCallback(async (id: string) => {
    await supabase.from("spaces").delete().eq("id", id);
    setSpaces(prev => prev.filter(s => s.id !== id));
    if (openSpace?.id === id) setOpenSpace(null);
  }, [openSpace]);

  const navigate = useCallback((page: string) => {
    setPendingNav(page);
  }, [setPendingNav]);

  return (
    <div style={{
      padding: "52px 22px 120px",
      fontFamily: "var(--font-sans)",
      minHeight: "100dvh",
    }}>
      <AnimatePresence mode="wait">

        {/* Space detail */}
        {openSpace ? (
          <SpaceDetail
            key={`detail-${openSpace.id}`}
            space={openSpace}
            userId={userId}
            onBack={() => setOpenSpace(null)}
            onNavigate={navigate}
          />
        ) : (

          /* Hub */
          <motion.div
            key="hub"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.22, ease: EASE_OUT }}
          >
            {/* Header */}
            <div style={{
              display: "flex", alignItems: "flex-start",
              justifyContent: "space-between", marginBottom: 28,
            }}>
              <div>
                <h1 style={{
                  fontSize: 28, fontWeight: 700,
                  color: "var(--text-primary)", letterSpacing: "-0.5px",
                  lineHeight: 1.1,
                }}>Spaces</h1>
                <p style={{ fontSize: 13, color: "var(--text-dim)", marginTop: 5 }}>
                  {loading ? "" : spaces.length === 0
                    ? "Workspaces for your subjects"
                    : `${spaces.length} workspace${spaces.length !== 1 ? "s" : ""}`}
                </p>
              </div>
              <button
                onClick={() => setShowCreate(true)}
                style={{
                  display: "flex", alignItems: "center", gap: 5,
                  padding: "9px 16px",
                  background: "rgba(196,154,60,0.1)",
                  border: "1px solid rgba(196,154,60,0.28)",
                  borderRadius: "var(--radius-pill)",
                  color: "#C49A3C", fontSize: 13, fontWeight: 600,
                  cursor: "pointer", fontFamily: "inherit",
                  flexShrink: 0, transition: "background 0.14s",
                }}
                onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.background = "rgba(196,154,60,0.18)")}
                onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.background = "rgba(196,154,60,0.1)")}
              >
                <span style={{ fontSize: 17, lineHeight: 1 }}>+</span> New
              </button>
            </div>

            {/* Skeleton loaders */}
            {loading && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {[1, 2, 3].map(i => (
                  <div key={i} style={{
                    height: 68,
                    borderRadius: "var(--radius-card)",
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid rgba(255,255,255,0.05)",
                    animation: "spaces-pulse 1.6s ease-in-out infinite",
                    animationDelay: `${i * 0.15}s`,
                  }} />
                ))}
              </div>
            )}

            {/* Empty state */}
            {!loading && spaces.length === 0 && (
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, ease: EASE_OUT }}
                style={{ textAlign: "center", paddingTop: 64 }}
              >
                <div style={{
                  width: 84, height: 84, borderRadius: 22,
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 38, margin: "0 auto 22px",
                  boxShadow: "0 0 40px rgba(0,0,0,0.3)",
                }}>⬡</div>

                <p style={{
                  fontSize: 18, fontWeight: 700,
                  color: "var(--text-secondary)", marginBottom: 10,
                  letterSpacing: "-0.2px",
                }}>No spaces yet</p>
                <p style={{
                  fontSize: 13, color: "var(--text-dim)",
                  lineHeight: 1.7, maxWidth: 270, margin: "0 auto 32px",
                }}>
                  Create a space for each subject — Biology, Linear Algebra, History —
                  and keep all your materials, chats, and flashcards together.
                </p>
                <button
                  onClick={() => setShowCreate(true)}
                  style={{
                    padding: "12px 26px",
                    background: "rgba(196,154,60,0.12)",
                    border: "1px solid rgba(196,154,60,0.32)",
                    borderRadius: "var(--radius-pill)",
                    color: "#C49A3C", fontSize: 14, fontWeight: 600,
                    cursor: "pointer", fontFamily: "inherit",
                    transition: "background 0.14s",
                  }}
                  onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.background = "rgba(196,154,60,0.2)")}
                  onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.background = "rgba(196,154,60,0.12)")}
                >Create your first Space</button>
              </motion.div>
            )}

            {/* Space list */}
            {!loading && spaces.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <AnimatePresence>
                  {spaces.map((space, i) => (
                    <motion.div
                      key={space.id}
                      initial={{ opacity: 0, y: 14 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.97 }}
                      transition={{ duration: 0.2, delay: i * 0.05, ease: EASE_OUT }}
                    >
                      <SpaceCard
                        space={space}
                        docCount={docCounts.get(space.id) ?? 0}
                        onOpen={() => setOpenSpace(space)}
                        onDelete={() => deleteSpace(space.id)}
                      />
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Create space sheet */}
      <AnimatePresence>
        {showCreate && (
          <CreateSpaceSheet
            onClose={() => setShowCreate(false)}
            onCreate={createSpace}
          />
        )}
      </AnimatePresence>

      <style>{`
        @keyframes spaces-pulse {
          0%, 100% { opacity: 0.35; }
          50%       { opacity: 0.65; }
        }
      `}</style>
    </div>
  );
}

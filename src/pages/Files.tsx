// Files.tsx — Unified upload (file + YouTube) + My Documents library + Space wiring.
// Part A: one AddMaterial card instead of two separate upload areas.
// Part B: My Documents as a premium card grid, each with Add-to-Space action.
// Part C: YouTube URL → /api/extract transcript → pipeline → video doc.

import { useMemo, useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { useApp }    from "../context/AppContext";
import { supabase }  from "../api/supabase";
import DocReader     from "../components/DocReader";
import ContentConnector from "../components/ContentConnector";
import { FileText, Presentation, Music, Film, Play, Image as ImageIcon, StickyNote, Paperclip, BookOpen, Check } from "lucide-react";

// ── Design tokens ─────────────────────────────────────────────────────────

const surface = {
  background: "var(--color-surface)",
  border:     "1px solid var(--color-border)",
  borderRadius: "var(--radius-card)",
  boxShadow:  "var(--depth-line)",
};

const PALETTE = ["#64b4ff","#64dc9b","#ffc364","#be82ff","#ff8080","#4ecdc4","#ffe66d","#a8e6cf"];
const colorFor = (i: number) => PALETTE[i % PALETTE.length];
const EASE: [number,number,number,number] = [0.25,0.46,0.45,0.94];

// ── Helpers ───────────────────────────────────────────────────────────────

function formatSize(bytes: number | null) {
  if (bytes == null) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function timeAgo(iso: string | null) {
  if (!iso) return null;
  const d = Date.now() - new Date(iso).getTime();
  const m = Math.floor(d / 60_000);
  if (m < 2)   return "just now";
  if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h ago`;
  const days = Math.floor(h / 24);
  return days === 1 ? "yesterday" : `${days}d ago`;
}

function isYouTubeUrl(s: string) {
  return /youtu\.be\/|youtube\.com\/(watch|shorts)/.test(s);
}

function mapFileRow(f: any) {
  return {
    ...f,
    courseDbId:  f.course_id    ?? null,
    sizeBytes:   f.size_bytes   ?? null,
    fileType:    f.file_type    ?? null,
    sourceUrl:   f.source_url   ?? null,
    storagePath: f.storage_path ?? null,
    summary:     f.summary      ?? null,
    highlights:  f.highlights   ?? null,
    processedAt: f.processed_at ?? null,
    contentText: f.content_text ?? null,
  };
}

async function openExternalFile(file: any) {
  if (file.storagePath) {
    try {
      const res = await fetch("/api/file-url", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ path: file.storagePath }),
      });
      const { url } = res.ok ? await res.json() : {};
      if (url) { window.open(url,"_blank","noopener,noreferrer"); return; }
    } catch {}
  }
  if (file.sourceUrl) window.open(file.sourceUrl,"_blank","noopener,noreferrer");
}

// ── processUpload — file → public.files (YouLearn pipeline) ──────────────

async function processUpload(
  file: File, userId: string, onStatus: (s: string) => void, courseId: string | null = null
): Promise<any> {
  onStatus("Uploading…");
  const ext  = file.name.split(".").pop() ?? "pdf";
  const path = `${userId}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g,"_")}`;

  const { error: upErr } = await supabase.storage
    .from("course-files").upload(path, file, { cacheControl:"3600", upsert:false });
  if (upErr) throw new Error(`Upload failed: ${upErr.message}`);

  onStatus("Extracting text…");
  const exRes = await fetch("/api/extract", {
    method:"POST", headers:{"Content-Type":"application/json"},
    // bucket: where the file lives; keepFile: don't delete (permanent storage); userId: for RAG auto-ingest
    body: JSON.stringify({ storagePath:path, bucket:"course-files", keepFile:true, file_type:file.type, name:file.name, userId, courseId }),
  });
  const exData = await exRes.json().catch(() => ({}));
  if (!exRes.ok || !exData.text) throw new Error(exData.error || "Couldn't extract text.");
  const contentText: string = exData.text;

  onStatus("Generating summary…");
  const sumRes  = await fetch("/api/summarize", {
    method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({ text: contentText, title: file.name }),
  });
  const sumData   = await sumRes.json().catch(() => ({}));
  const summary   = sumData.summary    ?? "";
  const highlights= sumData.highlights ?? [];

  onStatus("Saving…");
  const processedAt = new Date().toISOString();
  const { data: row, error: dbErr } = await supabase
    .from("files")
    .insert({ user_id:userId, course_id:courseId, name:file.name, file_type:ext, size_bytes:file.size,
              storage_path:path, content_text:contentText, summary, highlights,
              processed_at:processedAt, status:"course_material" })
    .select("id").single();
  if (dbErr) throw new Error(`Couldn't save: ${dbErr.message}`);

  return { id:row.id, name:file.name, fileType:ext, storagePath:path,
           summary, highlights, processedAt, sizeBytes:file.size, courseDbId:courseId };
}

// ── processYouTube — URL → transcript → public.files ─────────────────────

async function processYouTube(
  url: string, userId: string, onStatus: (s: string) => void, courseId: string | null = null
): Promise<any> {
  onStatus("Fetching transcript…");

  // /api/extract already handles YouTube captions (InnerTube + fallbacks).
  // Pass userId so the transcript is auto-ingested into RAG (tutor can find it).
  const exRes = await fetch("/api/extract", {
    method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({ youtubeUrl: url, userId, courseId }),
  });
  const exData = await exRes.json().catch(() => ({}));
  if (!exRes.ok || !exData.text) {
    throw new Error(exData.error || "Couldn't get a transcript for this video. It may not have captions.");
  }
  const contentText: string = exData.text;

  // Use video title from extract response, or derive from URL
  const title = exData.title
    ?? `YouTube — ${url.replace(/.*v=/,"").replace(/&.*/,"").slice(0,20)}`;

  onStatus("Generating summary…");
  let summary    = "";
  let highlights: string[] = [];
  try {
    const sumRes  = await fetch("/api/summarize", {
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ text: contentText, title }),
    });
    if (sumRes.ok) {
      const sumData = await sumRes.json().catch(() => ({}));
      summary    = sumData.summary    ?? "";
      highlights = sumData.highlights ?? [];
    } else {
      console.warn("[processYouTube] summarize returned", sumRes.status);
    }
  } catch (e) {
    console.warn("[processYouTube] summarize failed:", e);
  }
  // summary/highlights may be empty — file still saves with transcript (content_text)

  onStatus("Saving…");
  const processedAt = new Date().toISOString();
  const { data: row, error: dbErr } = await supabase
    .from("files")
    .insert({ user_id:userId, course_id:courseId, name:title, file_type:"youtube", source_url:url,
              content_text:contentText, summary, highlights,
              processed_at:processedAt, status:"course_material" })
    .select("id").single();
  if (dbErr) throw new Error(`Couldn't save: ${dbErr.message}`);

  return { id:row.id, name:title, fileType:"youtube", storagePath:null,
           sourceUrl:url, summary, highlights, processedAt, courseDbId:courseId };
}

// ── AddMaterialCard — unified upload (Part A) ────────────────────────────

type ProcessState = { phase:"idle" }
  | { phase:"working"; message:string }
  | { phase:"error";   message:string };

function AddMaterialCard({ onProcessed }: { onProcessed: (f: any) => void }) {
  const { userId, courses } = useApp() as any;
  const fileRef  = useRef<HTMLInputElement>(null);
  const [state,    setState]  = useState<ProcessState>({ phase:"idle" });
  const [ytUrl,    setYtUrl]  = useState("");
  const [dragging, setDragging] = useState(false);
  const [courseId, setCourseId] = useState<string>(""); // "" = general library (no course)
  const busy = state.phase === "working";

  // Only courses persisted to the DB can be linked (they have a dbId / UUID).
  const linkableCourses = (courses ?? []).filter((c: any) => c?.dbId);

  async function handleFile(file: File | undefined) {
    if (!file || !userId) return;
    setState({ phase:"working", message:"Starting…" });
    try {
      const result = await processUpload(file, userId, msg => setState({ phase:"working", message:msg }), courseId || null);
      setState({ phase:"idle" });
      onProcessed(result);
    } catch (e: any) {
      setState({ phase:"error", message: e.message || "Something went wrong." });
    }
  }

  async function handleYouTube() {
    const url = ytUrl.trim();
    if (!url || !userId) return;
    if (!isYouTubeUrl(url)) {
      setState({ phase:"error", message:"Please paste a valid YouTube URL." });
      return;
    }
    setState({ phase:"working", message:"Starting…" });
    try {
      const result = await processYouTube(url, userId, msg => setState({ phase:"working", message:msg }), courseId || null);
      setState({ phase:"idle" });
      setYtUrl("");
      onProcessed(result);
    } catch (e: any) {
      setState({ phase:"error", message: e.message || "Couldn't process that video." });
    }
  }

  const onDragOver  = useCallback((e: React.DragEvent) => { e.preventDefault(); setDragging(true); }, []);
  const onDragLeave = useCallback(() => setDragging(false), []);
  const onDrop      = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    handleFile(e.dataTransfer.files[0]);
  }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ ...surface, padding:"20px", marginBottom:"28px" }}>
      <p style={{ fontSize:14, fontWeight:600, color:"var(--text-primary)", marginBottom:3 }}>
        Add material
      </p>
      <p style={{ fontSize:12, color:"var(--text-dim)", marginBottom:12 }}>
        PDF, Word, slides, audio, video — or a YouTube link
      </p>

      {/* Course picker — links the upload to a course so the tutor, flashcards, and
          study guides can ground in it. "General library" leaves it unlinked. */}
      <select
        value={courseId}
        onChange={e => setCourseId(e.target.value)}
        disabled={busy}
        style={{
          width:"100%", marginBottom:14,
          background:"rgba(255,255,255,0.05)",
          border:"1px solid rgba(255,255,255,0.09)",
          borderRadius:"var(--radius-btn)", padding:"9px 12px",
          color:"var(--text-primary)", fontSize:13,
          outline:"none", fontFamily:"inherit",
          opacity: busy ? 0.5 : 1, cursor: busy ? "default" : "pointer",
          // Render the native popup in dark mode so the option list isn't white-on-white.
          colorScheme: "dark",
        }}
      >
        <option value="" style={{ background:"#1a1a1e", color:"#f5f5f5" }}>General library (no course)</option>
        {linkableCourses.map((c: any) => (
          <option key={c.dbId} value={c.dbId} style={{ background:"#1a1a1e", color:"#f5f5f5" }}>
            {c.courseCode ? `${c.courseCode} — ${c.name}` : c.name}
          </option>
        ))}
      </select>

      {/* Drop zone */}
      <div
        onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}
        onClick={() => !busy && fileRef.current?.click()}
        style={{
          border: `1.5px dashed ${dragging ? "rgba(196,154,60,0.6)" : "rgba(255,255,255,0.13)"}`,
          borderRadius: "var(--radius-btn)",
          padding: "22px 16px",
          textAlign:"center", cursor: busy ? "default" : "pointer",
          background: dragging ? "rgba(196,154,60,0.05)" : "rgba(255,255,255,0.02)",
          transition:"all 0.18s",
          marginBottom:12,
        }}
      >
        <div style={{ marginBottom:6, opacity:0.5, display:"flex", justifyContent:"center" }}><Paperclip size={22} /></div>
        <p style={{ fontSize:13, color:"var(--text-secondary)", margin:0 }}>
          {busy ? state.message : "Drag & drop or tap to choose a file"}
        </p>
        {!busy && (
          <p style={{ fontSize:11, color:"var(--text-dim)", marginTop:4, marginBottom:0 }}>
            PDF · Word · PPTX · images · audio · video
          </p>
        )}
      </div>

      <input
        ref={fileRef} type="file"
        accept=".pdf,.docx,.doc,.pptx,.ppt,.txt,.md,.png,.jpg,.jpeg,.webp,.mp3,.wav,.mp4,.mov,.webm"
        style={{ display:"none" }}
        onChange={e => { const f = e.target.files?.[0]; e.target.value=""; handleFile(f); }}
      />

      {/* Separator */}
      <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:12 }}>
        <div style={{ flex:1, height:1, background:"rgba(255,255,255,0.07)" }} />
        <span style={{ fontSize:11, color:"var(--text-dim)", letterSpacing:1 }}>OR</span>
        <div style={{ flex:1, height:1, background:"rgba(255,255,255,0.07)" }} />
      </div>

      {/* YouTube input */}
      <div style={{ display:"flex", gap:8 }}>
        <input
          value={ytUrl}
          onChange={e => setYtUrl(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") handleYouTube(); }}
          placeholder="Paste a YouTube link…"
          disabled={busy}
          style={{
            flex:1, background:"rgba(255,255,255,0.05)",
            border:"1px solid rgba(255,255,255,0.09)",
            borderRadius:"var(--radius-btn)", padding:"9px 12px",
            color:"var(--text-primary)", fontSize:13,
            outline:"none", fontFamily:"inherit",
            opacity: busy ? 0.5 : 1,
            transition:"border-color 0.15s",
          }}
          onFocus={e  => (e.target.style.borderColor="rgba(255,255,255,0.22)")}
          onBlur={e   => (e.target.style.borderColor="rgba(255,255,255,0.09)")}
        />
        <button
          onClick={handleYouTube}
          disabled={busy || !ytUrl.trim()}
          style={{
            padding:"9px 14px", borderRadius:"var(--radius-btn)",
            background: busy || !ytUrl.trim() ? "rgba(255,255,255,0.06)" : "rgba(196,154,60,0.14)",
            border:     busy || !ytUrl.trim() ? "1px solid rgba(255,255,255,0.08)" : "1px solid rgba(196,154,60,0.3)",
            color:      busy || !ytUrl.trim() ? "var(--text-dim)" : "#C49A3C",
            fontSize:13, fontWeight:600, cursor: busy || !ytUrl.trim() ? "default" : "pointer",
            fontFamily:"inherit", transition:"all 0.15s", whiteSpace:"nowrap",
          }}
        >
          {busy ? "…" : "▶ Process"}
        </button>
      </div>

      {/* Progress */}
      {state.phase === "working" && (
        <div style={{ display:"flex", alignItems:"center", gap:8, marginTop:12 }}>
          <span style={{
            width:11, height:11, borderRadius:"50%",
            border:"2px solid rgba(255,255,255,0.1)", borderTopColor:"#C49A3C",
            animation:"f-spin 0.7s linear infinite", display:"inline-block", flexShrink:0,
          }} />
          <span style={{ fontSize:12, color:"var(--text-dim)" }}>{state.message}</span>
          <style>{`@keyframes f-spin{to{transform:rotate(360deg)}}`}</style>
        </div>
      )}
      {state.phase === "error" && (
        <p style={{ fontSize:12, color:"rgba(255,100,90,0.85)", marginTop:10, marginBottom:0 }}>
          {state.message}
          <button onClick={() => setState({ phase:"idle" })}
            style={{ marginLeft:8, background:"none", border:"none",
              color:"#C49A3C", cursor:"pointer", fontFamily:"inherit", fontSize:12 }}>
            Dismiss
          </button>
        </p>
      )}
    </div>
  );
}

// ── AddToSpaceModal (Part B) ──────────────────────────────────────────────

function AddToSpaceModal({ file, userId, onClose }: {
  file: any; userId: string; onClose: () => void;
}) {
  const [spaces,  setSpaces]  = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding,  setAdding]  = useState<string|null>(null);
  const [added,   setAdded]   = useState<Set<string>>(new Set());

  useEffect(() => {
    supabase.from("spaces")
      .select("id, name, color")
      .eq("user_id", userId)
      .order("last_active", { ascending:false })
      .then(({ data }) => { setSpaces(data ?? []); setLoading(false); });
  }, [userId]);

  async function addToSpace(spaceId: string) {
    setAdding(spaceId);
    try {
      await supabase.from("space_items").insert({
        space_id: spaceId, user_id: userId,
        item_type: "document", item_ref: file.id, title: file.name,
      });
      // bump last_active
      await supabase.from("spaces").update({ last_active: new Date().toISOString() }).eq("id", spaceId);
      setAdded(prev => new Set([...prev, spaceId]));
    } catch { /* non-fatal */ }
    setAdding(null);
  }

  const modal = (
    <motion.div
      initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }}
      transition={{ duration:0.15 }}
      onClick={onClose}
      style={{
        position:"fixed", inset:0, zIndex:600,
        background:"rgba(0,0,0,0.55)", backdropFilter:"blur(8px)",
        display:"flex", alignItems:"flex-end", justifyContent:"center",
        paddingBottom:"env(safe-area-inset-bottom,0px)",
      }}
    >
      <motion.div
        initial={{ y:40, opacity:0 }} animate={{ y:0, opacity:1 }}
        exit={{ y:30, opacity:0 }}
        transition={{ type:"spring", stiffness:380, damping:36 }}
        onClick={e => e.stopPropagation()}
        style={{
          width:"100%", maxWidth:480, borderRadius:"20px 20px 0 0",
          background:"#1c1c1e", border:"1px solid rgba(255,255,255,0.1)",
          padding:"10px 22px 40px",
          maxHeight:"72dvh", overflowY:"auto",
        }}
      >
        <div style={{ width:38, height:4, borderRadius:2,
          background:"rgba(255,255,255,0.18)", margin:"8px auto 20px" }} />
        <p style={{ fontSize:17, fontWeight:700, color:"var(--text-primary)", marginBottom:16 }}>
          Add to Space
        </p>
        <p style={{ fontSize:13, color:"var(--text-dim)", marginBottom:16 }}>
          "{file.name}"
        </p>

        {loading && (
          <p style={{ color:"var(--text-dim)", fontSize:13, textAlign:"center", padding:"16px 0" }}>
            Loading spaces…
          </p>
        )}
        {!loading && spaces.length === 0 && (
          <p style={{ color:"var(--text-dim)", fontSize:13, textAlign:"center", padding:"16px 0" }}>
            No spaces yet. Create one in the Spaces section.
          </p>
        )}
        {spaces.map(s => {
          const isAdded   = added.has(s.id);
          const isAdding  = adding === s.id;
          return (
            <button key={s.id} onClick={() => !isAdded && addToSpace(s.id)}
              disabled={isAdded || !!adding}
              style={{
                display:"flex", alignItems:"center", gap:12, width:"100%",
                padding:"12px 14px", borderRadius:12, marginBottom:8,
                background: isAdded ? "rgba(74,222,128,0.08)" : "rgba(255,255,255,0.04)",
                border:`1px solid ${isAdded ? "rgba(74,222,128,0.25)" : "rgba(255,255,255,0.07)"}`,
                cursor: isAdded || !!adding ? "default" : "pointer",
                fontFamily:"inherit", textAlign:"left",
                transition:"background 0.12s",
              }}
            >
              <div style={{
                width:8, height:8, borderRadius:"50%", flexShrink:0,
                background: s.color, boxShadow:`0 0 8px ${s.color}55`,
              }} />
              <span style={{ flex:1, fontSize:14, fontWeight:500, color:"var(--text-primary)" }}>
                {s.name}
              </span>
              <span style={{ fontSize:13, color: isAdded ? "#4ade80" : "var(--text-dim)" }}>
                {isAdding ? "Adding…" : isAdded ? <span style={{ display:"inline-flex", alignItems:"center", gap:4 }}><Check size={13} />Added</span> : "Add →"}
              </span>
            </button>
          );
        })}
      </motion.div>
    </motion.div>
  );

  return typeof document !== "undefined" ? createPortal(modal, document.body) : null;
}

// ── DocCard — premium card for My Documents (Part B) ─────────────────────

function DocCard({ file, color, onOpen, userId }: {
  file: any; color: string; onOpen: (f: any) => void; userId: string;
}) {
  const [showSpaceModal, setShowSpaceModal] = useState(false);
  const isYoutube = file.fileType === "youtube";
  const isPdf     = ["pdf","docx","doc"].includes((file.fileType ?? "").toLowerCase());
  // processedAt = pipeline ran → always open in DocReader even if summary is empty
  const hasReader = !!file.processedAt && (isPdf || isYoutube);
  const ago       = timeAgo(file.processedAt);

  const TypeIcon = isYoutube       ? Play
                 : isPdf           ? FileText
                 : ["pptx","ppt"].includes(file.fileType ?? "") ? Presentation
                 : ["png","jpg","jpeg","webp"].includes(file.fileType ?? "") ? ImageIcon
                 : ["mp3","wav","m4a"].includes(file.fileType ?? "") ? Music
                 : ["mp4","mov","webm"].includes(file.fileType ?? "") ? Film
                 : StickyNote;

  function handleCardClick() {
    if (hasReader) onOpen(file);
    else openExternalFile(file);
  }

  return (
    <>
      <motion.div
        initial={{ opacity:0, y:8 }}
        animate={{ opacity:1, y:0 }}
        transition={{ duration:0.2, ease:EASE }}
        style={{
          ...surface,
          overflow:"hidden", position:"relative",
          cursor:"pointer", display:"flex", flexDirection:"column",
        }}
        whileHover={{ y:-1 }}
        onClick={handleCardClick}
        onMouseEnter={e => {
          (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(255,255,255,0.14)";
          (e.currentTarget as HTMLDivElement).style.boxShadow   = "0 4px 18px rgba(0,0,0,0.28)";
        }}
        onMouseLeave={e => {
          (e.currentTarget as HTMLDivElement).style.borderColor = "var(--color-border)";
          (e.currentTarget as HTMLDivElement).style.boxShadow   = "var(--depth-line)";
        }}
      >
        {/* Color accent strip */}
        <div style={{
          height:3, background:`linear-gradient(90deg, ${color}88, transparent)`,
        }} />

        <div style={{ padding:"14px 14px 12px" }}>
          {/* Icon + type */}
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10 }}>
            <TypeIcon size={20} style={{ color: "var(--text-secondary)" }} />
            {file.fileType && (
              <span style={{
                fontSize:9, fontWeight:700, letterSpacing:"0.5px",
                textTransform:"uppercase", padding:"2px 6px", borderRadius:4,
                background:"rgba(255,255,255,0.06)",
                color:"var(--text-dim)",
              }}>{file.fileType}</span>
            )}
          </div>

          {/* Title */}
          <p style={{
            fontSize:13, fontWeight:600, color:"var(--text-primary)",
            lineHeight:1.4, marginBottom:6,
            overflow:"hidden", display:"-webkit-box",
            WebkitLineClamp:2, WebkitBoxOrient:"vertical",
          }}>{file.name}</p>

          {/* Summary snippet — or transcript hint for YouTube without summary */}
          {file.summary ? (
            <p style={{
              fontSize:11, color:"var(--text-dim)", lineHeight:1.55, marginBottom:8,
              overflow:"hidden", display:"-webkit-box",
              WebkitLineClamp:2, WebkitBoxOrient:"vertical",
            }}>{file.summary}</p>
          ) : isYoutube && file.processedAt ? (
            <p style={{ fontSize:11, color:"var(--text-dim)", lineHeight:1.55, marginBottom:8 }}>
              Transcript ready — tap to read, chat, quiz
            </p>
          ) : null}

          {/* Footer */}
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginTop:"auto" }}>
            {ago && (
              <span style={{ fontSize:10, color:"var(--text-dim)" }}>{ago}</span>
            )}
            {/* Add-to-Space button */}
            <button
              onClick={e => { e.stopPropagation(); setShowSpaceModal(true); }}
              style={{
                fontSize:10, fontWeight:600, padding:"3px 8px", borderRadius:6,
                background:"rgba(196,154,60,0.08)", border:"1px solid rgba(196,154,60,0.2)",
                color:"rgba(196,154,60,0.8)", cursor:"pointer", fontFamily:"inherit",
                transition:"all 0.12s", marginLeft:"auto",
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background="rgba(196,154,60,0.15)"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background="rgba(196,154,60,0.08)"; }}
            >
              + Space
            </button>
          </div>
        </div>
      </motion.div>

      <AnimatePresence>
        {showSpaceModal && (
          <AddToSpaceModal
            file={file}
            userId={userId}
            onClose={() => setShowSpaceModal(false)}
          />
        )}
      </AnimatePresence>
    </>
  );
}

// ── FileRow — flat row for LMS-synced course files ────────────────────────

function FileRow({ file, color, onOpenReader }: { file:any; color:string; onOpenReader:(f:any)=>void }) {
  const size  = formatSize(file.sizeBytes);
  const isPdf = ["pdf","docx","doc","pptx","ppt","txt","md"].includes((file.fileType ?? "").toLowerCase());
  const hasReader = file.summary && isPdf;

  function handleClick() {
    if (hasReader) onOpenReader(file);
    else openExternalFile(file);
  }

  const openable = hasReader || file.storagePath || file.sourceUrl;
  const inner = (
    <>
      <div style={{ minWidth:0, flex:1 }}>
        <div style={{ display:"flex", alignItems:"center", gap:6 }}>
          <p style={{ color:"var(--text-primary)", fontSize:14, fontWeight:500,
            overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", margin:0 }}>
            {file.name}
          </p>
          {hasReader && (
            <span style={{
              fontSize:9, fontWeight:700, letterSpacing:"0.5px", textTransform:"uppercase",
              padding:"2px 6px", borderRadius:4, background:"rgba(196,154,60,0.1)",
              color:"#C49A3C", border:"1px solid rgba(196,154,60,0.22)", flexShrink:0,
            }}>Read</span>
          )}
        </div>
        <p style={{ color:"var(--text-dim)", fontSize:12, marginTop:2, marginBottom:0 }}>
          {[file.folder, size].filter(Boolean).join(" · ") || "—"}
        </p>
      </div>
      {file.fileType && (
        <span style={{ fontSize:10, fontWeight:700, letterSpacing:"0.5px",
          textTransform:"uppercase", color, flexShrink:0 }}>{file.fileType}</span>
      )}
    </>
  );

  const rowStyle = { ...surface, padding:"14px 16px", display:"flex",
    justifyContent:"space-between", alignItems:"center", gap:12 };

  return openable
    ? <div role="button" tabIndex={0} onClick={handleClick}
        onKeyDown={e => { if (e.key==="Enter"||e.key===" ") handleClick(); }}
        style={{ ...rowStyle, cursor:"pointer" }}>{inner}</div>
    : <div style={rowStyle}>{inner}</div>;
}

// ── Main page ─────────────────────────────────────────────────────────────

export default function Files() {
  const { files, courses, userId, setPendingNav } = useApp() as any;
  const [viewingFile, setViewingFile] = useState<any>(null);
  const [savedDocs,   setSavedDocs]   = useState<any[]>([]);

  useEffect(() => {
    if (!userId) return;
    supabase.from("files")
      .select("id,course_id,lms_file_id,name,file_type,size_bytes,source_url,folder,status,storage_path,summary,highlights,processed_at,content_text")
      .eq("user_id", userId)
      .not("processed_at","is",null)
      .order("processed_at", { ascending:false })
      .limit(100)
      .then(({ data }) => { if (data?.length) setSavedDocs(data.map(mapFileRow)); });
  }, [userId]);

  const refreshSavedDocs = useCallback(() => {
    if (!userId) return;
    supabase.from("files")
      .select("id,course_id,lms_file_id,name,file_type,size_bytes,source_url,folder,status,storage_path,summary,highlights,processed_at,content_text")
      .eq("user_id", userId)
      .not("processed_at","is",null)
      .order("processed_at", { ascending:false })
      .limit(100)
      .then(({ data }) => { if (data?.length) setSavedDocs(data.map(mapFileRow)); });
  }, [userId]);

  function handleProcessed(processed: any) {
    const newFile = mapFileRow({
      id: processed.id, name: processed.name, file_type: processed.fileType,
      storage_path: processed.storagePath, source_url: processed.sourceUrl ?? null,
      summary: processed.summary, highlights: processed.highlights,
      processed_at: processed.processedAt,
      size_bytes: processed.sizeBytes ?? null,
      course_id: null, lms_file_id: null, folder: null, status:"course_material",
    });
    setSavedDocs(prev => prev.some(d => d.id === newFile.id) ? prev : [newFile, ...prev]);
    setViewingFile(newFile);
    setTimeout(refreshSavedDocs, 1500);
  }

  // Merge savedDocs + AppContext LMS files, de-duped
  const allFiles = useMemo(() => {
    const seen = new Set(savedDocs.map(f => f.id));
    return [...savedDocs, ...files.filter((f: any) => !seen.has(f.id))];
  }, [files, savedDocs]);

  // Group by course
  const groups = useMemo(() => {
    const byDbId = new Map();
    courses.forEach((c: any, i: number) => {
      if (c.dbId) byDbId.set(c.dbId, { course:c, color:colorFor(i), files:[] as any[] });
    });
    const myDocs = { course:null, color:"var(--text-dim)", files:[] as any[] };
    for (const f of allFiles) {
      const g = (f.courseDbId && byDbId.get(f.courseDbId)) || myDocs;
      g.files.push(f);
    }
    const ordered = [...byDbId.values()].filter(g => g.files.length);
    if (myDocs.files.length) ordered.push(myDocs);
    return ordered;
  }, [allFiles, courses]);

  if (viewingFile) {
    return (
      <DocReader
        file={viewingFile}
        onBack={() => setViewingFile(null)}
        onNavigate={(page: string) => { setViewingFile(null); setPendingNav(page); }}
      />
    );
  }

  const myDocsGroup = groups.find(g => g.course === null);
  const courseGroups = groups.filter(g => g.course !== null);

  return (
    <div>
      <h1 style={{ fontSize:26, fontWeight:600, color:"var(--text-primary)",
        marginBottom:4, letterSpacing:"-0.3px", fontFamily:"'Fraunces',serif" }}>
        Files
      </h1>
      <p style={{ color:"var(--text-dim)", fontSize:14, marginBottom:24 }}>
        {allFiles.length > 0
          ? `${allFiles.length} file${allFiles.length !== 1 ? "s" : ""}`
          : "Add a document or YouTube video to study"}
      </p>

      {/* Unified upload card (Part A) — replaces UploadCard + DocUpload */}
      <AddMaterialCard onProcessed={handleProcessed} />

      {/* Content Connector — tie external content to the student's own coursework */}
      <ContentConnector />

      {allFiles.length === 0 ? (
        <motion.div
          initial={{ opacity:0, y:12 }} animate={{ opacity:1, y:0 }}
          transition={{ duration:0.3, ease:EASE }}
          style={{ ...surface, padding:32, textAlign:"center" }}
        >
          <div style={{ marginBottom:12, opacity:0.35, display:"flex", justifyContent:"center" }}><BookOpen size={32} /></div>
          <p style={{ color:"var(--text-secondary)", fontSize:15, fontWeight:600, marginBottom:6 }}>
            Your library is empty
          </p>
          <p style={{ color:"var(--text-dim)", fontSize:13, lineHeight:1.65, maxWidth:260, margin:"0 auto" }}>
            Upload a PDF, Word doc, audio file, or paste a YouTube link to start studying with AI.
          </p>
        </motion.div>
      ) : (
        <div style={{ display:"flex", flexDirection:"column", gap:28 }}>

          {/* My Documents — premium card grid (Part B) */}
          {myDocsGroup && myDocsGroup.files.length > 0 && (
            <div>
              <div style={{ display:"flex", alignItems:"baseline",
                justifyContent:"space-between", marginBottom:14 }}>
                <span style={{ color:"var(--text-secondary)", fontSize:13,
                  fontWeight:600, letterSpacing:"0.3px" }}>My Documents</span>
                <span style={{ color:"var(--text-dim)", fontSize:11 }}>
                  {myDocsGroup.files.length} item{myDocsGroup.files.length !== 1 ? "s" : ""}
                </span>
              </div>
              <div style={{
                display:"grid",
                gridTemplateColumns:"repeat(auto-fill, minmax(155px, 1fr))",
                gap:12,
              }}>
                {myDocsGroup.files.map((f: any) => (
                  <DocCard
                    key={f.id} file={f}
                    color={colorFor(savedDocs.findIndex(d => d.id === f.id))}
                    onOpen={setViewingFile}
                    userId={userId}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Course-linked files — flat rows (LMS-synced) */}
          {courseGroups.map((g, gi) => (
            <div key={g.course?.dbId ?? `c-${gi}`}>
              <div style={{ display:"flex", alignItems:"baseline",
                justifyContent:"space-between", marginBottom:10 }}>
                <span style={{ color:g.color, fontSize:12, fontWeight:700, letterSpacing:"0.5px" }}>
                  {g.course.courseCode || g.course.name}
                </span>
                <span style={{ color:"var(--text-dim)", fontSize:11 }}>
                  {g.files.length} file{g.files.length !== 1 ? "s" : ""}
                </span>
              </div>
              <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                {g.files.map((f: any) => (
                  <FileRow key={f.id} file={f} color={g.color} onOpenReader={setViewingFile} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

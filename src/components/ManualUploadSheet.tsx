// ManualUploadSheet.jsx — Manual course/assignment upload via AI parsing (Groq).
// Triggered by the dashed "+" card at the bottom of the Canvas course list.
// Steps: 0=input  1=parsing  2=review  3=saved
// FEAT: multi-file upload — attach multiple PDFs/images, all merged before Groq parse.

import { useState, useRef } from "react";
import { FileText, Image as ImageIcon, Paperclip, X, Check, Sparkles, AlertTriangle } from "lucide-react";
import { groq } from "../api/groq";
import { supabase } from "../api/supabase";
import { useApp } from "../context/AppContext";

/* ─── PDF text extraction ───────────────────────────────────── */

async function extractPdfText(file) {
  try {
    const pdfjsLib = await import("pdfjs-dist");
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let fullText = "";
    const maxPages = Math.min(pdf.numPages, 20);
    for (let i = 1; i <= maxPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      fullText += content.items.map((item: any) => item.str).join(" ") + "\n";
    }
    return fullText.trim();
  } catch (err) {
    console.warn("PDF extraction failed:", err);
    return null;
  }
}

/* ─── Groq system prompt ────────────────────────────────────── */

const SYSTEM = `You are a course data extractor. Given a syllabus, assignment sheet, or any academic text, extract course info.
Return ONLY valid JSON — no markdown fences, no explanation:
{
  "courseName": string,
  "courseCode": string | null,
  "assignments": [{ "name": string, "dueDate": string | null, "pointsPossible": number | null }]
}
For dueDate, use ISO format (YYYY-MM-DD) when possible. If unsure, use null.`;

/* ─── Shared styles ─────────────────────────────────────────── */

const S: Record<string, React.CSSProperties> = {
  overlay: {
    position: "fixed", inset: 0, zIndex: 9000,
    background: "rgba(0,0,0,0.72)", backdropFilter: "blur(6px)",
    display: "flex", alignItems: "flex-end", justifyContent: "center",
  },
  sheet: {
    width: "100%", maxWidth: "600px",
    background: "var(--color-surface)",
    border: "1px solid var(--color-border)",
    borderRadius: "20px 20px 0 0",
    padding: "8px 20px 36px",
    maxHeight: "88vh", overflowY: "auto",
  },
  handle: {
    width: "36px", height: "4px", borderRadius: "2px",
    background: "rgba(255,255,255,0.12)", margin: "12px auto 20px",
  },
  input: {
    background: "rgba(255,255,255,0.05)",
    border: "1px solid rgba(255,255,255,0.09)",
    borderRadius: "10px", padding: "12px 14px",
    color: "var(--text-primary)", fontSize: "13px",
    outline: "none", fontFamily: "inherit", width: "100%",
    transition: "border-color 0.15s",
  },
  row: { display: "flex", gap: "8px", marginTop: "16px" },
};

function focusBorder(e)  { e.currentTarget.style.borderColor = "rgba(255,255,255,0.25)"; }
function blurBorder(e)   { e.currentTarget.style.borderColor = "rgba(255,255,255,0.09)"; }

function Btn({ primary, children, ...props }: any) {
  return (
    <button
      style={{
        flex: primary ? 1 : "none",
        background: primary ? "rgba(255,255,255,0.88)" : "rgba(255,255,255,0.07)",
        color: primary ? "#111" : "var(--text-primary)",
        border: "none", borderRadius: "10px",
        padding: "11px 20px", fontSize: "13px", fontWeight: "600",
        cursor: props.disabled ? "not-allowed" : "pointer",
        fontFamily: "inherit", opacity: props.disabled ? 0.4 : 1,
        transition: "opacity 0.15s",
      }}
      {...props}
    >
      {children}
    </button>
  );
}

/* ─── FileChip — individual file pill with remove button ────── */

function FileChip({ file, onRemove, status }) {
  const isPdf = file.type === "application/pdf";
  const isImg = file.type.startsWith("image/");
  const Icon  = isPdf ? FileText : isImg ? ImageIcon : Paperclip;
  const statusColor =
    status === "done"    ? "rgba(100,220,130,0.7)" :
    status === "failed"  ? "rgba(255,196,0,0.7)"   :
    status === "reading" ? "rgba(255,204,0,0.6)"   :
    "rgba(255,255,255,0.35)";

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: "6px",
      background: "rgba(255,255,255,0.06)",
      border: "1px solid rgba(255,255,255,0.1)",
      borderRadius: "8px", padding: "6px 10px",
      maxWidth: "100%",
    }}>
      <span style={{ display: "flex", flexShrink: 0, color: "rgba(255,255,255,0.6)" }}><Icon size={14} /></span>
      <span style={{
        color: statusColor, fontSize: "12px", fontWeight: "500",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        maxWidth: "180px",
      }}>
        {file.name}
      </span>
      {status === "reading" && (
        <span style={{ color: "rgba(255,204,0,0.6)", fontSize: "10px" }}>reading…</span>
      )}
      <button
        onClick={() => onRemove(file.name)}
        style={{
          marginLeft: "2px", background: "none", border: "none",
          color: "rgba(255,255,255,0.3)", fontSize: "13px",
          cursor: "pointer", lineHeight: 1, padding: "0 2px",
          flexShrink: 0,
        }}
      ><X size={13} /></button>
    </div>
  );
}

/* ─── ManualUploadSheet ─────────────────────────────────────── */

export default function ManualUploadSheet({ onClose, onSave }) {
  const { userId } = useApp();
  const [step, setStep]       = useState(0);
  const [text, setText]       = useState("");
  const [files, setFiles]     = useState([]); // array of File objects
  const [fileStatuses, setFileStatuses] = useState({}); // name → "reading"|"done"|"failed"
  const [parsed, setParsed]   = useState(null);
  const [error, setError]     = useState("");
  const [parseStatus, setParseStatus] = useState(""); // "" | "reading" | "parsing"
  const fileRef               = useRef<HTMLInputElement | null>(null);

  /* ── add files (dedupe by name) ── */
  function handleFileSelect(e) {
    const selected = Array.from((e.target as HTMLInputElement).files || []);
    setFiles(prev => {
      const existingNames = new Set(prev.map(f => f.name));
      return [...prev, ...selected.filter(f => !existingNames.has(f.name))];
    });
    // reset input so same file can be re-added after removal
    e.target.value = "";
  }

  function removeFile(name) {
    setFiles(prev => prev.filter(f => f.name !== name));
    setFileStatuses(prev => { const n = { ...prev }; delete n[name]; return n; });
  }

  const canParse = text.trim().length > 0 || files.length > 0;

  /* ── parse ── */
  async function handleParse() {
    if (!canParse) return;
    setStep(1);
    setError("");

    let prompt = text.trim();
    const newStatuses = {};

    // Process all files sequentially
    for (const file of files) {
      if (file.type === "application/pdf") {
        newStatuses[file.name] = "reading";
        setFileStatuses({ ...newStatuses });
        setParseStatus("reading");

        const extracted = await extractPdfText(file);
        if (extracted && extracted.length > 50) {
          newStatuses[file.name] = "done";
          prompt += `\n\n--- File: ${file.name} ---\n${extracted}`;
        } else {
          newStatuses[file.name] = "failed";
          prompt += `\n\n[PDF: ${file.name} — could not extract text automatically]`;
        }
        setFileStatuses({ ...newStatuses });

      } else if (file.type.startsWith("image/")) {
        newStatuses[file.name] = "reading";
        setFileStatuses({ ...newStatuses });

        try {
          const path = `manual/${userId}/${Date.now()}_${file.name}`;
          const { error: upErr } = await supabase.storage
            .from("uploads")
            .upload(path, file, { upsert: true });
          if (!upErr) {
            const { data: { publicUrl } } = supabase.storage
              .from("uploads")
              .getPublicUrl(path);
            prompt += `\n\n[Image: ${file.name} — ${publicUrl}]`;
            newStatuses[file.name] = "done";
          } else {
            newStatuses[file.name] = "failed";
            prompt += `\n\n[Image: ${file.name} — upload failed]`;
          }
        } catch {
          newStatuses[file.name] = "failed";
          prompt += `\n\n[File: ${file.name}]`;
        }
        setFileStatuses({ ...newStatuses });

      } else {
        prompt += `\n\n[File: ${file.name}]`;
        newStatuses[file.name] = "done";
      }
    }

    if (!prompt.trim()) {
      setError("Paste some text or attach a file first.");
      setStep(0);
      return;
    }

    setParseStatus("parsing");

    try {
      const raw = await groq(
        [{ role: "user", content: `Extract course data:\n\n${prompt}` }],
        SYSTEM,
      );
      const clean = raw.replace(/```[a-z]*\n?/gi, "").trim();
      const data  = JSON.parse(clean);
      setParsed({
        courseName:  data.courseName  ?? "Unnamed Course",
        courseCode:  data.courseCode  ?? "",
        assignments: Array.isArray(data.assignments) ? data.assignments : [],
      });
      setStep(2);
    } catch {
      setError("Parsing failed — try adding more descriptive text.");
      setStep(0);
    }
    setParseStatus("");
  }

  /* ── save ── */
  function handleSave() {
    const courseId = `manual_${crypto.randomUUID()}`;
    const course = {
      id:          courseId,
      name:        parsed.courseName,
      courseCode:  parsed.courseCode || parsed.courseName,
      manual:      true,
    };
    const assignments = parsed.assignments.map(a => ({
      id:             `manual_${crypto.randomUUID()}`,
      courseId,
      name:           a.name,
      dueAt:          a.dueDate ? new Date(a.dueDate).toISOString() : null,
      pointsPossible: a.pointsPossible ?? null,
      manual:         true,
    }));
    onSave(course, assignments);
    setStep(3);
  }

  /* ── dismiss on backdrop click ── */
  function onBackdrop(e) {
    if (e.target === e.currentTarget) onClose();
  }

  const anyFailed = Object.values(fileStatuses).some(s => s === "failed");

  return (
    <div style={S.overlay} onClick={onBackdrop}>
      <div style={S.sheet}>
        <div style={S.handle} />

        {/* ── STEP 0: Input ─────────────────────────────── */}
        {step === 0 && (
          <>
            <p style={{ color: "var(--text-primary)", fontSize: "16px", fontWeight: "600", marginBottom: "4px" }}>
              Add Course Manually
            </p>
            <p style={{ color: "var(--text-dim)", fontSize: "13px", lineHeight: "1.6", marginBottom: "16px" }}>
              Paste a syllabus or attach files — AI will extract course details and deadlines.
            </p>

            <textarea
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder="Paste syllabus, assignment sheet, or any course text here…"
              rows={5}
              style={{ ...S.input, resize: "vertical" }}
              onFocus={focusBorder}
              onBlur={blurBorder}
            />

            {/* file attach area */}
            <div style={{ marginTop: "10px" }}>
              {/* file chips */}
              {files.length > 0 && (
                <div style={{
                  display: "flex", flexWrap: "wrap", gap: "6px",
                  marginBottom: "8px",
                }}>
                  {files.map(f => (
                    <FileChip
                      key={f.name}
                      file={f}
                      onRemove={removeFile}
                      status={fileStatuses[f.name] ?? ""}
                    />
                  ))}
                </div>
              )}

              {/* add more files button */}
              <input
                ref={fileRef}
                type="file"
                accept=".pdf,image/*"
                multiple
                style={{ display: "none" }}
                onChange={handleFileSelect}
              />
              <button
                onClick={() => fileRef.current?.click()}
                style={{
                  background: "rgba(255,255,255,0.04)",
                  border: "1px dashed rgba(255,255,255,0.14)",
                  borderRadius: "8px", padding: "8px 13px",
                  color: "var(--text-dim)", fontSize: "12px",
                  cursor: "pointer", fontFamily: "inherit",
                  display: "flex", alignItems: "center", gap: "6px",
                }}
              >
                <span style={{ fontSize: "14px" }}>+</span>
                {files.length === 0 ? "Attach PDFs or images" : "Add more files"}
              </button>

              {files.some(f => f.type === "application/pdf") && (
                <p style={{ color: "rgba(255,255,255,0.3)", fontSize: "11px", marginTop: "6px", paddingLeft: "2px" }}>
                  PDF text will be extracted automatically before parsing
                </p>
              )}
            </div>

            {error && (
              <p style={{ color: "rgba(255,100,90,0.85)", fontSize: "12px", marginTop: "12px" }}>{error}</p>
            )}

            <div style={S.row}>
              <Btn onClick={onClose}>Cancel</Btn>
              <Btn primary disabled={!canParse} onClick={handleParse}>
                Parse with AI →
              </Btn>
            </div>
          </>
        )}

        {/* ── STEP 1: Parsing ───────────────────────────── */}
        {step === 1 && (
          <div style={{ textAlign: "center", padding: "40px 0" }}>
            <p style={{ marginBottom: "14px", opacity: 0.9, display: "flex", justifyContent: "center" }}><Sparkles size={26} /></p>
            <p style={{ color: "var(--text-primary)", fontSize: "15px", fontWeight: "600", marginBottom: "6px" }}>
              {parseStatus === "reading" ? "Reading files…" : "Parsing…"}
            </p>
            <p style={{ color: "var(--text-dim)", fontSize: "13px", marginBottom: "20px" }}>
              {parseStatus === "reading"
                ? `Extracting text from ${files.filter(f => f.type === "application/pdf").length} PDF${files.filter(f => f.type === "application/pdf").length !== 1 ? "s" : ""}`
                : "Extracting course and assignment data"}
            </p>
            {/* per-file progress */}
            {files.length > 1 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", justifyContent: "center" }}>
                {files.map(f => (
                  <FileChip
                    key={f.name}
                    file={f}
                    onRemove={() => {}}
                    status={fileStatuses[f.name] ?? ""}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── STEP 2: Review ────────────────────────────── */}
        {step === 2 && parsed && (
          <>
            <p style={{ color: "var(--text-primary)", fontSize: "16px", fontWeight: "600", marginBottom: "16px" }}>
              Review Extracted Data
            </p>

            {anyFailed && (
              <p style={{ color: "rgba(255,196,0,0.8)", fontSize: "12px", marginBottom: "12px", display: "flex", alignItems: "center", gap: "6px" }}>
                <AlertTriangle size={14} style={{ flexShrink: 0 }} />
                Some files couldn't be read automatically — results may be incomplete.
              </p>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "18px" }}>
              <input
                value={parsed.courseName}
                onChange={e => setParsed(p => ({ ...p, courseName: e.target.value }))}
                placeholder="Course name"
                style={S.input}
                onFocus={focusBorder}
                onBlur={blurBorder}
              />
              <input
                value={parsed.courseCode}
                onChange={e => setParsed(p => ({ ...p, courseCode: e.target.value }))}
                placeholder="Course code (e.g. CSC311)"
                style={S.input}
                onFocus={focusBorder}
                onBlur={blurBorder}
              />
            </div>

            <p style={{
              color: "var(--text-dim)", fontSize: "11px", fontWeight: "600",
              letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: "8px",
            }}>
              {parsed.assignments.length} Assignment{parsed.assignments.length !== 1 ? "s" : ""} detected
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: "5px", maxHeight: "230px", overflowY: "auto", marginBottom: "16px" }}>
              {parsed.assignments.length === 0 && (
                <p style={{ color: "var(--text-dim)", fontSize: "13px" }}>
                  No assignments found — you can add them later.
                </p>
              )}
              {parsed.assignments.map((a, i) => (
                <div
                  key={i}
                  style={{
                    background: "rgba(255,255,255,0.04)", borderRadius: "8px",
                    padding: "10px 12px", display: "flex",
                    justifyContent: "space-between", alignItems: "center", gap: "12px",
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <p style={{ color: "var(--text-primary)", fontSize: "13px", fontWeight: "500", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {a.name}
                    </p>
                    {a.dueDate && (
                      <p style={{ color: "var(--text-dim)", fontSize: "11px", marginTop: "2px" }}>
                        Due {a.dueDate}
                      </p>
                    )}
                  </div>
                  {a.pointsPossible != null && (
                    <span style={{ color: "var(--text-dim)", fontSize: "12px", flexShrink: 0 }}>
                      {a.pointsPossible} pts
                    </span>
                  )}
                </div>
              ))}
            </div>

            <div style={S.row}>
              <Btn onClick={() => setStep(0)}>← Back</Btn>
              <Btn primary onClick={handleSave}>Save Course</Btn>
            </div>
          </>
        )}

        {/* ── STEP 3: Saved ─────────────────────────────── */}
        {step === 3 && (
          <div style={{ textAlign: "center", padding: "40px 0" }}>
            <p style={{ marginBottom: "14px", display: "flex", justifyContent: "center", color: "rgba(100,220,130,0.9)" }}><Check size={28} /></p>
            <p style={{ color: "var(--text-primary)", fontSize: "15px", fontWeight: "600", marginBottom: "6px" }}>
              Course Added
            </p>
            <p style={{ color: "var(--text-dim)", fontSize: "13px", marginBottom: "24px" }}>
              {parsed?.courseName} is now in your course list.
            </p>
            <Btn primary onClick={onClose}>Done</Btn>
          </div>
        )}
      </div>
    </div>
  );
}

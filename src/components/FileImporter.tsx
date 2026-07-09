// FileImporter.tsx — Browse and import LMS files (Google Classroom / Microsoft Teams)
// Props:
//   provider:  "google" | "microsoft"
//   userId:    string
//   onImported?: (name: string) => void

import { useState, useEffect, useCallback } from "react";
import { ChevronDown, ChevronRight, FileText, Download, Check, Loader2 } from "lucide-react";

interface DriveFile {
  driveFileId?: string;  // Google
  downloadUrl?: string;  // Microsoft
  name:         string;
  mimeType:     string | null;
  source:       string;
}

interface CourseGroup {
  courseId?:   string;
  classId?:    string;
  courseName?: string;
  className?:  string;
  files:       DriveFile[];
}

interface Props {
  provider:   "google" | "microsoft";
  userId:     string;
  onImported?: (name: string) => void;
}

const MIME_LABELS: Record<string, string> = {
  "application/pdf": "PDF",
  "application/vnd.google-apps.document": "Doc",
  "application/vnd.google-apps.presentation": "Slides",
  "application/vnd.google-apps.spreadsheet": "Sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "DOCX",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "PPTX",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "XLSX",
  "video/mp4": "MP4",
  "audio/mpeg": "MP3",
};

function mimeLabel(m: string | null): string {
  if (!m) return "File";
  if (MIME_LABELS[m]) return MIME_LABELS[m];
  const parts = m.split("/");
  return parts[parts.length - 1].toUpperCase().slice(0, 6);
}

export default function FileImporter({ provider, userId, onImported }: Props) {
  const [loading,    setLoading]   = useState(true);
  const [error,      setError]     = useState<string | null>(null);
  const [courses,    setCourses]   = useState<CourseGroup[]>([]);
  const [onedrive,   setOnedrive]  = useState<DriveFile[]>([]);  // Microsoft only
  const [expanded,   setExpanded]  = useState<Set<string>>(new Set());
  const [importing,  setImporting] = useState<Set<string>>(new Set());
  const [imported,   setImported]  = useState<Set<string>>(new Set());
  const [importErrs, setImportErrs] = useState<Record<string, string>>({});

  const fileKey = (f: DriveFile) => f.driveFileId ?? f.downloadUrl ?? f.name;

  // Google's OAuth+file handler was renamed /api/lms-google → /api/drive-auth;
  // Microsoft stays /api/lms-microsoft.
  const apiBase = provider === "google" ? "/api/drive-auth" : `/api/lms-${provider}`;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}?action=list&userId=${encodeURIComponent(userId)}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `List failed (${res.status})`);
      }
      const data = await res.json();
      if (provider === "google") {
        setCourses(data.courses ?? []);
      } else {
        setCourses(data.classes ?? []);
        setOnedrive(data.onedrive ?? []);
      }
    } catch (e: any) {
      setError(e.message ?? "Failed to load files");
    } finally {
      setLoading(false);
    }
  }, [provider, userId, apiBase]);

  useEffect(() => { load(); }, [load]);

  async function importFile(f: DriveFile, courseId?: string) {
    const key = fileKey(f);
    if (importing.has(key) || imported.has(key)) return;

    setImporting(prev => new Set([...prev, key]));
    setImportErrs(prev => { const n = { ...prev }; delete n[key]; return n; });

    try {
      const body: Record<string, any> = {
        userId,
        name:     f.name,
        mimeType: f.mimeType,
        courseId: courseId ?? null,
      };
      if (provider === "google")    body.driveFileId = f.driveFileId;
      if (provider === "microsoft") body.downloadUrl = f.downloadUrl;

      const res = await fetch(`${apiBase}?action=fetch`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Import failed (${res.status})`);

      setImported(prev => new Set([...prev, key]));
      onImported?.(f.name);
    } catch (e: any) {
      setImportErrs(prev => ({ ...prev, [key]: e.message ?? "Import failed" }));
    } finally {
      setImporting(prev => { const n = new Set(prev); n.delete(key); return n; });
    }
  }

  function toggleGroup(id: string) {
    setExpanded(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  function FileRow({ file, courseId }: { file: DriveFile; courseId?: string }) {
    const key  = fileKey(file);
    const busy = importing.has(key);
    const done = imported.has(key);
    const err  = importErrs[key];

    return (
      <div style={{
        display:        "flex",
        alignItems:     "center",
        gap:            "10px",
        padding:        "9px 14px",
        borderBottom:   "1px solid rgba(255,255,255,0.04)",
        transition:     "background 0.12s",
      }}
        onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.03)")}
        onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
      >
        <FileText size={14} style={{ color: "rgba(255,255,255,0.3)", flexShrink: 0 }} />
        <span style={{ flex: 1, fontSize: "13px", color: "rgba(255,255,255,0.78)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {file.name}
        </span>
        <span style={{
          fontSize: "10px", padding: "2px 6px", borderRadius: "6px",
          background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.35)",
          flexShrink: 0,
        }}>
          {mimeLabel(file.mimeType)}
        </span>
        {err && (
          <span style={{ fontSize: "11px", color: "#ff6961", flexShrink: 0, maxWidth: "120px", overflow: "hidden", textOverflow: "ellipsis" }} title={err}>
            Error
          </span>
        )}
        <button
          onClick={() => importFile(file, courseId)}
          disabled={busy || done}
          style={{
            display:        "flex",
            alignItems:     "center",
            gap:            "5px",
            padding:        "5px 12px",
            borderRadius:   "8px",
            border:         "none",
            background:     done ? "rgba(48,209,88,0.15)" : "rgba(255,255,255,0.08)",
            color:          done ? "#30d158" : "rgba(255,255,255,0.7)",
            fontSize:       "12px",
            fontWeight:     "500",
            cursor:         busy || done ? "default" : "pointer",
            flexShrink:     0,
            fontFamily:     "inherit",
            transition:     "all 0.15s",
          }}
        >
          {busy ? <Loader2 size={12} style={{ animation: "spin 0.7s linear infinite" }} />
            : done ? <Check size={12} />
            : <Download size={12} />}
          {busy ? "Importing…" : done ? "Indexed" : "Import"}
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ padding: "32px", textAlign: "center", color: "rgba(255,255,255,0.3)", fontSize: "13px" }}>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        <Loader2 size={18} style={{ animation: "spin 0.7s linear infinite", marginBottom: "10px" }} />
        <div>Loading your files…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: "24px", textAlign: "center" }}>
        <div style={{ fontSize: "13px", color: "#ff6961", marginBottom: "12px" }}>{error}</div>
        <button
          onClick={load}
          style={{
            background: "rgba(255,255,255,0.08)", border: "none", borderRadius: "8px",
            padding: "8px 16px", color: "rgba(255,255,255,0.7)", fontSize: "13px",
            cursor: "pointer", fontFamily: "inherit",
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  const empty = courses.length === 0 && onedrive.length === 0;
  if (empty) {
    return (
      <div style={{ padding: "32px", textAlign: "center", color: "rgba(255,255,255,0.3)", fontSize: "13px" }}>
        No files found. Make sure your instructor has posted materials in {provider === "google" ? "Google Classroom" : "Microsoft Teams"}.
      </div>
    );
  }

  const totalFiles = courses.reduce((s, c) => s + c.files.length, 0) + onedrive.length;

  return (
    <div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>

      {/* Summary bar */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "10px 14px",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        fontSize: "12px", color: "rgba(255,255,255,0.35)",
      }}>
        <span>{courses.length} course{courses.length !== 1 ? "s" : ""} · {totalFiles} files</span>
        <button
          onClick={load}
          style={{
            background: "none", border: "none", padding: "2px 6px",
            color: "rgba(255,255,255,0.3)", fontSize: "12px",
            cursor: "pointer", fontFamily: "inherit",
          }}
        >
          Refresh
        </button>
      </div>

      {/* Course groups */}
      {courses.map(group => {
        const id   = group.courseId ?? group.classId ?? group.courseName ?? "";
        const name = group.courseName ?? group.className ?? "Class";
        const open = expanded.has(id);
        return (
          <div key={id} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
            <button
              onClick={() => toggleGroup(id)}
              style={{
                display:        "flex",
                alignItems:     "center",
                gap:            "8px",
                width:          "100%",
                padding:        "11px 14px",
                background:     "transparent",
                border:         "none",
                cursor:         "pointer",
                fontFamily:     "inherit",
                textAlign:      "left",
              }}
              onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.03)")}
              onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
            >
              {open
                ? <ChevronDown  size={14} style={{ color: "rgba(255,255,255,0.4)", flexShrink: 0 }} />
                : <ChevronRight size={14} style={{ color: "rgba(255,255,255,0.4)", flexShrink: 0 }} />}
              <span style={{ fontSize: "13px", fontWeight: "600", color: "rgba(255,255,255,0.8)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {name}
              </span>
              <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.28)" }}>
                {group.files.length} file{group.files.length !== 1 ? "s" : ""}
              </span>
            </button>
            {open && group.files.map(f => (
              <FileRow key={fileKey(f)} file={f} courseId={group.courseId ?? group.classId} />
            ))}
          </div>
        );
      })}

      {/* Personal OneDrive (Microsoft) */}
      {onedrive.length > 0 && (
        <div style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
          <button
            onClick={() => toggleGroup("__onedrive__")}
            style={{
              display: "flex", alignItems: "center", gap: "8px",
              width: "100%", padding: "11px 14px",
              background: "transparent", border: "none",
              cursor: "pointer", fontFamily: "inherit", textAlign: "left",
            }}
            onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.03)")}
            onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
          >
            {expanded.has("__onedrive__")
              ? <ChevronDown  size={14} style={{ color: "rgba(255,255,255,0.4)", flexShrink: 0 }} />
              : <ChevronRight size={14} style={{ color: "rgba(255,255,255,0.4)", flexShrink: 0 }} />}
            <span style={{ fontSize: "13px", fontWeight: "600", color: "rgba(255,255,255,0.8)", flex: 1 }}>
              My OneDrive
            </span>
            <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.28)" }}>
              {onedrive.length} file{onedrive.length !== 1 ? "s" : ""}
            </span>
          </button>
          {expanded.has("__onedrive__") && onedrive.map(f => (
            <FileRow key={fileKey(f)} file={f} />
          ))}
        </div>
      )}
    </div>
  );
}

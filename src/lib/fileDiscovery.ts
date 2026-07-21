// fileDiscovery.ts — pure classification helpers for the Files page discovery layer
// (search / type / status filters). No imports, no I/O.

// Coarse buckets for the type filter. Unrecognized extensions return "other" and only
// surface under "All types" — a filter that hides files it can't classify is a lie.
export type FileTypeBucket = "pdf" | "slides" | "docs" | "media" | "other";

const SLIDES = new Set(["pptx", "ppt", "key", "odp"]);
const DOCS   = new Set(["docx", "doc", "txt", "md", "rtf", "odt", "pages", "html"]);
const MEDIA  = new Set([
  "youtube", "mp3", "wav", "m4a", "ogg",          // audio (+ YouTube transcripts)
  "mp4", "mov", "webm", "avi", "mkv",             // video
  "png", "jpg", "jpeg", "webp", "gif", "heic",    // images
]);

export function bucketFileType(fileType: string | null | undefined): FileTypeBucket {
  const t = String(fileType ?? "").toLowerCase().replace(/^\./, "");
  if (t === "pdf")   return "pdf";
  if (SLIDES.has(t)) return "slides";
  if (DOCS.has(t))   return "docs";
  if (MEDIA.has(t))  return "media";
  return "other";
}

// Status buckets ride the same fields the Files row badges already use:
// document_id ("Searchable"), processed_at ("Read"-able pipeline output), and the
// ingestion pipeline's terminal statuses (canvas-files marks unavailable/unsupported;
// "indexed" is its success state). Everything else is still in flight.
export type FileStatusBucket = "indexed" | "processing" | "failed";

const FAILED_STATUSES = new Set(["unavailable", "unsupported", "failed", "error"]);

export function bucketFileStatus(f: any): FileStatusBucket {
  if (f?.documentId != null || f?.processedAt != null || f?.status === "indexed") return "indexed";
  if (FAILED_STATUSES.has(String(f?.status ?? "").toLowerCase())) return "failed";
  return "processing";
}

// Case-insensitive substring match over name + folder + resolved course name.
// `q` must already be trimmed + lowercased (callers do it once per keystroke, not per file).
export function fileMatchesQuery(f: any, q: string, courseName: string): boolean {
  if (!q) return true;
  return `${f?.name ?? ""} ${f?.folder ?? ""} ${courseName ?? ""}`.toLowerCase().includes(q);
}

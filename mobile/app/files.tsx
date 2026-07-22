// files.tsx — mobile port of src/pages/Files.tsx.
// Add-material card (visual parity, upload/YouTube degrade gracefully — no native
// file-picker deps), My Documents card grid with Add-to-Space, course-grouped
// LMS file rows, and a lightweight in-app reader (summary + highlights +
// transcript) standing in for the web DocReader.

import { useState, useEffect, useMemo, useCallback } from "react";
import {
  View, Text, ScrollView, TextInput, TouchableOpacity,
  StyleSheet, Modal, Linking,
} from "react-native";
import { Redirect } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import {
  FileText, Presentation, Music, Film, Play, Image as ImageIcon,
  StickyNote, Paperclip, BookOpen, Check, ChevronDown,
} from "lucide-react-native";
import Glass from "../components/Glass";
import { Skeleton, EmptyState, ErrorState } from "../components/States";
import { usePageTheme, ThemeColors } from "../constants/appTheme";
import { supabase } from "../services/supabase";
import { useUserId } from "../context/AuthContext";

const PAGE = "toolkit";

// ── Design tokens (tokens.css) ───────────────────────────────────────────────

const TOKENS = {
  depthLine:     { boxShadow: "0 1px 0 rgba(255,255,255,0.06)" },
};

const PALETTE = ["#64b4ff","#64dc9b","#ffc364","#be82ff","#ff8080","#4ecdc4","#ffe66d","#a8e6cf"];
const colorFor = (i: number) => PALETTE[((i % PALETTE.length) + PALETTE.length) % PALETTE.length];

// ── Helpers (ported from web) ────────────────────────────────────────────────

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
  if (m < 2)  return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  return days === 1 ? "yesterday" : `${days}d ago`;
}

type FileItem = {
  id: string;
  name: string;
  courseDbId: string | null;
  fileType: string | null;
  sizeBytes: number | null;
  sourceUrl: string | null;
  storagePath: string | null;
  folder: string | null;
  summary: string | null;
  highlights: string[] | null;
  processedAt: string | null;
  contentText: string | null;
};

function mapFileRow(f: any): FileItem {
  return {
    id:          f.id,
    name:        f.name ?? "Untitled",
    courseDbId:  f.course_id     ?? null,
    fileType:    f.file_type     ?? null,
    sizeBytes:   f.size_bytes    ?? null,
    sourceUrl:   f.source_url    ?? null,
    storagePath: f.storage_path  ?? null,
    folder:      f.folder        ?? null,
    summary:     f.summary       ?? null,
    highlights:  Array.isArray(f.highlights) ? f.highlights : null,
    processedAt: f.processed_at  ?? null,
    contentText: f.content_text  ?? null,
  };
}

function typeIconFor(fileType: string | null) {
  const t = (fileType ?? "").toLowerCase();
  if (t === "youtube")                          return Play;
  if (["pdf","docx","doc"].includes(t))         return FileText;
  if (["pptx","ppt"].includes(t))               return Presentation;
  if (["png","jpg","jpeg","webp"].includes(t))  return ImageIcon;
  if (["mp3","wav","m4a"].includes(t))          return Music;
  if (["mp4","mov","webm"].includes(t))         return Film;
  return StickyNote;
}

function openExternalFile(file: FileItem) {
  // Web resolves storage_path via /api/file-url — no API layer on mobile yet,
  // so only direct source URLs (LMS links, YouTube) can open.
  if (file.sourceUrl) Linking.openURL(file.sourceUrl).catch(() => {});
}

// ── AddMaterialCard — visual parity with web; processing degrades gracefully ─

function AddMaterialCard() {
  const C = usePageTheme(PAGE);
  const styles = useMemo(() => makeStyles(C), [C]);
  const [ytUrl, setYtUrl] = useState("");
  const [note, setNote]   = useState(false);
  const showNote = () => setNote(true);

  return (
    <View style={styles.addCard}>
      <Text style={styles.addTitle}>Add material</Text>
      <Text style={styles.addSub}>PDF, Word, slides, audio, video — or a YouTube link</Text>

      {/* Course picker (web: <select>) — inert until uploads land on mobile */}
      <Glass colors={C} radius={12} style={[styles.coursePicker, { opacity: 0.5 }]}>
        <Text style={styles.coursePickerText}>General library (no course)</Text>
        <ChevronDown size={14} color={C.textDim} />
      </Glass>

      {/* Drop zone → tap target on mobile */}
      <TouchableOpacity style={styles.dropZone} activeOpacity={0.7} onPress={showNote}>
        <View style={{ marginBottom: 6, opacity: 0.5 }}>
          <Paperclip size={22} color={C.textPrimary} />
        </View>
        <Text style={styles.dropText}>Tap to choose a file</Text>
        <Text style={styles.dropHint}>PDF · Word · PPTX · images · audio · video</Text>
      </TouchableOpacity>

      {/* Separator */}
      <View style={styles.orRow}>
        <View style={styles.orLine} />
        <Text style={styles.orText}>OR</Text>
        <View style={styles.orLine} />
      </View>

      {/* YouTube input */}
      <View style={{ flexDirection: "row", gap: 8 }}>
        <TextInput
          value={ytUrl}
          onChangeText={setYtUrl}
          placeholder="Paste a YouTube link…"
          placeholderTextColor={C.textDim}
          style={styles.ytInput}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <TouchableOpacity
          onPress={showNote}
          disabled={!ytUrl.trim()}
          style={[styles.ytButton, ytUrl.trim() ? styles.ytButtonActive : null]}
        >
          <Play size={13} color={ytUrl.trim() ? C.gold : C.textDim} />
          <Text style={[styles.ytButtonText, ytUrl.trim() && { color: C.gold }]}>Process</Text>
        </TouchableOpacity>
      </View>

      {note && (
        <Text style={styles.uploadNote}>
          Uploads and YouTube processing are coming to mobile — use the web app for now.
        </Text>
      )}
    </View>
  );
}

// ── AddToSpaceModal — direct Supabase, same as web ───────────────────────────

function AddToSpaceModal({ file, onClose }: { file: FileItem; onClose: () => void }) {
  const C = usePageTheme(PAGE);
  const styles = useMemo(() => makeStyles(C), [C]);
  const userId = useUserId();
  const [spaces, setSpaces]   = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding]   = useState<string | null>(null);
  const [added, setAdded]     = useState<Set<string>>(new Set());

  useEffect(() => {
    supabase.from("spaces")
      .select("id, name, color")
      .eq("user_id", userId)
      .order("last_active", { ascending: false })
      .then(({ data }) => { setSpaces(data ?? []); setLoading(false); });
  }, [userId]);

  async function addToSpace(spaceId: string) {
    setAdding(spaceId);
    try {
      await supabase.from("space_items").insert({
        space_id: spaceId, user_id: userId,
        item_type: "document", item_ref: file.id, title: file.name,
      });
      await supabase.from("spaces").update({ last_active: new Date().toISOString() }).eq("id", spaceId);
      setAdded(prev => new Set([...prev, spaceId]));
    } catch { /* non-fatal */ }
    setAdding(null);
  }

  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={styles.modalSheet} onPress={() => {}}>
          <View style={styles.modalHandle} />
          <Text style={styles.modalTitle}>Add to Space</Text>
          <Text style={styles.modalFileName} numberOfLines={1}>"{file.name}"</Text>

          {loading && <Text style={styles.modalEmpty}>Loading spaces…</Text>}
          {!loading && spaces.length === 0 && (
            <Text style={styles.modalEmpty}>No spaces yet. Create one in the Spaces section.</Text>
          )}
          <ScrollView style={{ maxHeight: 320 }} showsVerticalScrollIndicator={false}>
            {spaces.map(s => {
              const isAdded  = added.has(s.id);
              const isAdding = adding === s.id;
              return (
                <TouchableOpacity
                  key={s.id}
                  onPress={() => !isAdded && !adding && addToSpace(s.id)}
                  disabled={isAdded || !!adding}
                  style={[styles.spaceRow, isAdded && styles.spaceRowAdded]}
                >
                  <View style={[styles.spaceDot, { backgroundColor: s.color ?? C.gold }]} />
                  <Text style={styles.spaceName} numberOfLines={1}>{s.name}</Text>
                  {isAdding ? (
                    <Text style={styles.spaceAction}>Adding…</Text>
                  ) : isAdded ? (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                      <Check size={13} color="#4ade80" />
                      <Text style={[styles.spaceAction, { color: "#4ade80" }]}>Added</Text>
                    </View>
                  ) : (
                    <Text style={styles.spaceAction}>Add →</Text>
                  )}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

// ── DocCard — premium card for My Documents ──────────────────────────────────

function DocCard({ file, color, onOpen, onAddToSpace }: {
  file: FileItem; color: string;
  onOpen: (f: FileItem) => void; onAddToSpace: (f: FileItem) => void;
}) {
  const C = usePageTheme(PAGE);
  const styles = useMemo(() => makeStyles(C), [C]);
  const isYoutube = file.fileType === "youtube";
  const TypeIcon  = typeIconFor(file.fileType);
  const ago       = timeAgo(file.processedAt);
  // Web opens DocReader when processed; here the in-app reader shows any
  // file that has extracted content or a summary.
  const hasReader = !!file.processedAt && !!(file.summary || file.contentText);

  return (
    <TouchableOpacity
      style={styles.docCard}
      activeOpacity={0.7}
      onPress={() => (hasReader ? onOpen(file) : openExternalFile(file))}
    >
      {/* Color accent strip */}
      <LinearGradient
        colors={[`${color}88`, "transparent"]}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
        style={{ height: 3 }}
      />
      <View style={styles.docCardBody}>
        <View style={styles.docCardHead}>
          <TypeIcon size={20} color={C.textSecondary} />
          {file.fileType ? (
            <View style={styles.typeBadge}>
              <Text style={styles.typeBadgeText}>{file.fileType.toUpperCase()}</Text>
            </View>
          ) : null}
        </View>

        <Text style={styles.docTitle} numberOfLines={2}>{file.name}</Text>

        {file.summary ? (
          <Text style={styles.docSummary} numberOfLines={2}>{file.summary}</Text>
        ) : isYoutube && file.processedAt ? (
          <Text style={styles.docSummary}>Transcript ready — tap to read, chat, quiz</Text>
        ) : null}

        <View style={styles.docFooter}>
          {ago ? <Text style={styles.docAgo}>{ago}</Text> : <View />}
          <TouchableOpacity
            onPress={() => onAddToSpace(file)}
            style={styles.spaceButton}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.spaceButtonText}>+ Space</Text>
          </TouchableOpacity>
        </View>
      </View>
    </TouchableOpacity>
  );
}

// ── FileRow — flat row for LMS-synced course files ───────────────────────────

function FileRow({ file, color, onOpen }: {
  file: FileItem; color: string; onOpen: (f: FileItem) => void;
}) {
  const C = usePageTheme(PAGE);
  const styles = useMemo(() => makeStyles(C), [C]);
  const size  = formatSize(file.sizeBytes);
  const isPdf = ["pdf","docx","doc","pptx","ppt","txt","md"].includes((file.fileType ?? "").toLowerCase());
  const hasReader = !!file.summary && isPdf;
  const openable  = hasReader || !!file.sourceUrl;

  return (
    <Glass
      colors={C}
      radius={16}
      style={[styles.fileRow, { backgroundColor: "transparent" }]}
      onPress={() => { if (hasReader) onOpen(file); else openExternalFile(file); }}
      disabled={!openable}
    >
      <View style={{ minWidth: 0, flex: 1 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Text style={styles.fileRowName} numberOfLines={1}>{file.name}</Text>
          {hasReader && (
            <View style={styles.readBadge}>
              <Text style={styles.readBadgeText}>READ</Text>
            </View>
          )}
        </View>
        <Text style={styles.fileRowMeta}>
          {[file.folder, size].filter(Boolean).join(" · ") || "—"}
        </Text>
      </View>
      {file.fileType ? (
        <Text style={[styles.fileRowType, { color }]}>{file.fileType.toUpperCase()}</Text>
      ) : null}
    </Glass>
  );
}

// ── Reader — lightweight stand-in for the web DocReader ─────────────────────

function ReaderView({ file, onBack }: { file: FileItem; onBack: () => void }) {
  const C = usePageTheme(PAGE);
  const styles = useMemo(() => makeStyles(C), [C]);
  const ago = timeAgo(file.processedAt);
  const content = file.contentText
    ? file.contentText.slice(0, 6000) + (file.contentText.length > 6000 ? "…" : "")
    : null;

  return (
    <View style={{ gap: 16, paddingBottom: 8 }}>
      <TouchableOpacity onPress={onBack}>
        <Text style={styles.back}>←  Files</Text>
      </TouchableOpacity>

      <View>
        <Text style={styles.readerTitle}>{file.name}</Text>
        <View style={{ flexDirection: "row", gap: 8, marginTop: 8, alignItems: "center" }}>
          {file.fileType ? (
            <View style={styles.typeBadge}>
              <Text style={styles.typeBadgeText}>{file.fileType.toUpperCase()}</Text>
            </View>
          ) : null}
          {ago ? <Text style={styles.docAgo}>{ago}</Text> : null}
        </View>
      </View>

      {file.summary ? (
        <Glass colors={C} radius={12} style={styles.readerBox}>
          <Text style={styles.readerSectionTitle}>Summary</Text>
          <Text style={styles.readerText}>{file.summary}</Text>
        </Glass>
      ) : null}

      {file.highlights && file.highlights.length > 0 ? (
        <Glass colors={C} radius={12} style={styles.readerBox}>
          <Text style={styles.readerSectionTitle}>Highlights</Text>
          {file.highlights.map((h, i) => (
            <View key={i} style={{ flexDirection: "row", gap: 8, marginBottom: 6 }}>
              <View style={styles.highlightDot} />
              <Text style={[styles.readerText, { flex: 1 }]}>{String(h)}</Text>
            </View>
          ))}
        </Glass>
      ) : null}

      {content ? (
        <Glass colors={C} radius={12} style={styles.readerBox}>
          <Text style={styles.readerSectionTitle}>
            {file.fileType === "youtube" ? "Transcript" : "Content"}
          </Text>
          <Text style={styles.readerText}>{content}</Text>
          {file.contentText && file.contentText.length > 6000 ? (
            <Text style={styles.readerTrunc}>Full reader available in the web app.</Text>
          ) : null}
        </Glass>
      ) : null}

      {file.sourceUrl ? (
        <TouchableOpacity style={styles.openOriginal} onPress={() => openExternalFile(file)}>
          <Text style={styles.openOriginalText}>Open original</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

// Files now lives inside the merged /toolkit page (Files tab) — this route just
// forwards there so old links / the back stack keep working.
export default function FilesScreen() {
  return <Redirect href="/toolkit?tab=files" />;
}

// FilesLibrary — the Files screen body, without the page shell or an outer
// ScrollView, so it can be dropped into the Toolkit page's Files tab (which owns
// the scrolling). Self-contained: loads its own data and runs the in-app reader.
export function FilesLibrary() {
  const C = usePageTheme(PAGE);
  const styles = useMemo(() => makeStyles(C), [C]);
  const userId = useUserId();
  const [files, setFiles]     = useState<FileItem[]>([]);
  const [courses, setCourses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [viewingFile, setViewingFile] = useState<FileItem | null>(null);
  const [spaceFile, setSpaceFile]     = useState<FileItem | null>(null);

  // Hoisted so the error state's Try-again can re-run the same reads.
  const reload = useCallback(async () => {
    setError(null);
    try {
      const [filesRes, coursesRes] = await Promise.all([
        // Matches AppContext.tsx's files query: order by updated_at first —
        // without it, an unordered LIMIT over 700+ rows returns an arbitrary
        // slice that can exclude exactly the newest extension-synced files.
        supabase.from("files")
          .select("id,course_id,lms_file_id,name,file_type,size_bytes,source_url,folder,status,storage_path,summary,highlights,processed_at,content_text")
          .eq("user_id", userId)
          .order("updated_at", { ascending: false })
          .limit(500),
        supabase.from("courses")
          .select("id, name, course_code")
          .eq("user_id", userId),
      ]);

      if (filesRes.error) {
        setError(filesRes.error.message);
      } else {
        const mapped = (filesRes.data ?? []).map(mapFileRow);
        // Processed docs first (newest first) — matches the web's ordering.
        mapped.sort((a, b) => {
          const ap = a.processedAt ? +new Date(a.processedAt) : 0;
          const bp = b.processedAt ? +new Date(b.processedAt) : 0;
          if (ap !== bp) return bp - ap;
          return a.name.localeCompare(b.name);
        });
        setFiles(mapped);
      }
      setCourses(coursesRes.data ?? []);
    } catch (e: any) {
      setError(e?.message ?? "network");
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { reload(); }, [reload]);

  // Group by course — files without a course land in "My Documents" (web parity).
  const { myDocs, courseGroups } = useMemo(() => {
    const byId = new Map<string, { course: any; color: string; files: FileItem[] }>();
    courses.forEach((c, i) => byId.set(c.id, { course: c, color: colorFor(i), files: [] }));
    const mine: FileItem[] = [];
    for (const f of files) {
      const g = f.courseDbId ? byId.get(f.courseDbId) : null;
      if (g) g.files.push(f); else mine.push(f);
    }
    return {
      myDocs: mine,
      courseGroups: [...byId.values()].filter(g => g.files.length > 0),
    };
  }, [files, courses]);

  if (viewingFile) {
    return <ReaderView file={viewingFile} onBack={() => setViewingFile(null)} />;
  }

  return (
    <>
      <View style={{ gap: 28 }}>
        <AddMaterialCard />

        {loading ? (
          <View style={{ gap: 12 }}>
            {[0, 1, 2].map(i => <Skeleton key={i} colors={C} height={72} radius={14} />)}
          </View>
        ) : error ? (
          <ErrorState colors={C} title="Couldn't load your files" onRetry={reload} />
        ) : files.length === 0 ? (
          <EmptyState
            colors={C}
            Icon={BookOpen}
            title="Your library is empty"
            message="Upload a PDF, Word doc, audio file, or paste a YouTube link to start studying with AI."
          />
        ) : (
          <>
            {/* My Documents — premium card grid */}
            {myDocs.length > 0 && (
              <View>
                <View style={styles.groupHeader}>
                  <Text style={styles.groupTitle}>My Documents</Text>
                  <Text style={styles.groupCount}>
                    {myDocs.length} item{myDocs.length !== 1 ? "s" : ""}
                  </Text>
                </View>
                <View style={styles.docGrid}>
                  {myDocs.map((f, i) => (
                    <DocCard
                      key={f.id} file={f} color={colorFor(i)}
                      onOpen={setViewingFile}
                      onAddToSpace={setSpaceFile}
                    />
                  ))}
                </View>
              </View>
            )}

            {/* Course-linked files — flat rows */}
            {courseGroups.map(g => (
              <View key={g.course.id}>
                <View style={[styles.groupHeader, { marginBottom: 10 }]}>
                  <Text style={[styles.courseTitle, { color: g.color }]}>
                    {g.course.course_code || g.course.name}
                  </Text>
                  <Text style={styles.groupCount}>
                    {g.files.length} file{g.files.length !== 1 ? "s" : ""}
                  </Text>
                </View>
                <View style={{ gap: 10 }}>
                  {g.files.map(f => (
                    <FileRow key={f.id} file={f} color={g.color} onOpen={setViewingFile} />
                  ))}
                </View>
              </View>
            ))}
          </>
        )}
      </View>

      {spaceFile && <AddToSpaceModal file={spaceFile} onClose={() => setSpaceFile(null)} />}
    </>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const makeStyles = (C: ThemeColors) => {
  const SURFACE = {
    ...TOKENS.depthLine,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 16,
  } as const;

  return StyleSheet.create({
  title:        { fontWeight: "600", fontSize: 26, color: C.textPrimary, letterSpacing: -0.3 },
  subtitle:     { fontWeight: "400", fontSize: 14, color: C.textDim, marginTop: 4 },

  // Add material card
  addCard:          { ...SURFACE, padding: 20 },
  addTitle:         { fontWeight: "600", fontSize: 14, color: C.textPrimary, marginBottom: 3 },
  addSub:           { fontWeight: "400", fontSize: 12, color: C.textDim, marginBottom: 12 },
  coursePicker:     { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, marginBottom: 14 },
  coursePickerText: { fontWeight: "400", fontSize: 13, color: C.textPrimary },
  dropZone:         { borderWidth: 1.5, borderStyle: "dashed", borderColor: "rgba(255,255,255,0.13)", borderRadius: 12, paddingVertical: 22, paddingHorizontal: 16, alignItems: "center", backgroundColor: C.surface, marginBottom: 12 },
  dropText:         { fontWeight: "400", fontSize: 13, color: C.textSecondary },
  dropHint:         { fontWeight: "400", fontSize: 11, color: C.textDim, marginTop: 4 },
  orRow:            { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 },
  orLine:           { flex: 1, height: 1, backgroundColor: "rgba(255,255,255,0.07)" },
  orText:           { fontWeight: "400", fontSize: 11, color: C.textDim, letterSpacing: 1 },
  ytInput:          { flex: 1, backgroundColor: C.surfaceTranslucent, borderWidth: 1, borderColor: "rgba(255,255,255,0.09)", borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, fontWeight: "400", fontSize: 13, color: C.textPrimary },
  ytButton:         { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: C.border },
  ytButtonActive:   { backgroundColor: "rgba(196,154,60,0.14)", borderColor: "rgba(196,154,60,0.3)" },
  ytButtonText:     { fontWeight: "600", fontSize: 13, color: C.textDim },
  uploadNote:       { fontWeight: "400", fontSize: 12, color: C.textDim, marginTop: 12, fontStyle: "italic" },

  // Empty / error
  emptyCard:  { ...SURFACE, padding: 32, alignItems: "center" },
  emptyTitle: { fontWeight: "600", fontSize: 15, color: C.textSecondary, marginBottom: 6 },
  emptyBody:  { fontWeight: "400", fontSize: 13, color: C.textDim, lineHeight: 21, textAlign: "center", maxWidth: 260 },

  // Group headers
  groupHeader: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", marginBottom: 14 },
  groupTitle:  { fontWeight: "600", fontSize: 13, color: C.textSecondary, letterSpacing: 0.3 },
  groupCount:  { fontWeight: "400", fontSize: 11, color: C.textDim },
  courseTitle: { fontWeight: "700", fontSize: 12, letterSpacing: 0.5 },

  // DocCard grid
  docGrid:        { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  docCard:        { ...SURFACE, overflow: "hidden", flexBasis: "47%", flexGrow: 1, maxWidth: "48.5%" },
  docCardBody:    { paddingHorizontal: 14, paddingTop: 14, paddingBottom: 12, flex: 1 },
  docCardHead:    { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  typeBadge:      { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, backgroundColor: "rgba(255,255,255,0.06)" },
  typeBadgeText:  { fontWeight: "700", fontSize: 9, letterSpacing: 0.5, color: C.textDim },
  docTitle:       { fontWeight: "600", fontSize: 13, color: C.textPrimary, lineHeight: 18, marginBottom: 6 },
  docSummary:     { fontWeight: "400", fontSize: 11, color: C.textDim, lineHeight: 17, marginBottom: 8 },
  docFooter:      { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: "auto" },
  docAgo:         { fontWeight: "400", fontSize: 10, color: C.textDim },
  spaceButton:    { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: "rgba(196,154,60,0.08)", borderWidth: 1, borderColor: "rgba(196,154,60,0.2)" },
  spaceButtonText:{ fontWeight: "600", fontSize: 10, color: "rgba(196,154,60,0.8)" },

  // FileRow
  fileRow:       { ...SURFACE, paddingHorizontal: 16, paddingVertical: 14, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  fileRowName:   { fontWeight: "500", fontSize: 14, color: C.textPrimary, flexShrink: 1 },
  fileRowMeta:   { fontWeight: "400", fontSize: 12, color: C.textDim, marginTop: 2 },
  fileRowType:   { fontWeight: "700", fontSize: 10, letterSpacing: 0.5, flexShrink: 0 },
  readBadge:     { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, backgroundColor: "rgba(196,154,60,0.1)", borderWidth: 1, borderColor: "rgba(196,154,60,0.22)", flexShrink: 0 },
  readBadgeText: { fontWeight: "700", fontSize: 9, letterSpacing: 0.5, color: C.gold },

  // Reader
  back:               { fontWeight: "400", fontSize: 14, color: C.textSecondary },
  readerTitle:        { fontWeight: "600", fontSize: 20, color: C.textPrimary, letterSpacing: -0.2 },
  readerBox:          { borderRadius: 12, padding: 14 },
  readerSectionTitle: { fontWeight: "600", fontSize: 12, color: C.textSecondary, letterSpacing: 0.3, marginBottom: 8, },
  readerText:         { fontWeight: "400", fontSize: 13, lineHeight: 21, color: C.textSecondary },
  readerTrunc:        { fontWeight: "400", fontSize: 11, color: C.textDim, marginTop: 10, fontStyle: "italic" },
  highlightDot:       { width: 5, height: 5, borderRadius: 3, backgroundColor: C.gold, marginTop: 8, flexShrink: 0 },
  openOriginal:       { ...SURFACE, paddingVertical: 12, alignItems: "center" },
  openOriginalText:   { fontWeight: "600", fontSize: 13, color: C.textPrimary },

  // Add-to-Space modal
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  modalSheet:    { borderTopLeftRadius: 20, borderTopRightRadius: 20, backgroundColor: C.scheme === "light" ? "rgba(28,36,92,0.94)" : "#1c1c1e", borderWidth: 1, borderColor: "rgba(255,255,255,0.1)", paddingTop: 10, paddingHorizontal: 22, paddingBottom: 40, maxHeight: "72%" },
  modalHandle:   { width: 38, height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.18)", alignSelf: "center", marginTop: 8, marginBottom: 20 },
  modalTitle:    { fontWeight: "700", fontSize: 17, color: C.textPrimary, marginBottom: 16 },
  modalFileName: { fontWeight: "400", fontSize: 13, color: C.textDim, marginBottom: 16 },
  modalEmpty:    { fontWeight: "400", fontSize: 13, color: C.textDim, textAlign: "center", paddingVertical: 16 },
  spaceRow:      { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 12, marginBottom: 8, backgroundColor: C.surface, borderWidth: 1, borderColor: "rgba(255,255,255,0.07)" },
  spaceRowAdded: { backgroundColor: "rgba(74,222,128,0.08)", borderColor: "rgba(74,222,128,0.25)" },
  spaceDot:      { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
  spaceName:     { flex: 1, fontWeight: "500", fontSize: 14, color: C.textPrimary },
  spaceAction:   { fontWeight: "400", fontSize: 13, color: C.textDim },
  });
};

// mobile/app/spaces.tsx — Spaces workspace hub, ported from src/pages/Spaces.tsx.
// A Space = topic workspace (Biology 4.131, CSE 331…) holding documents, chat,
// flashcards and exams. Mobile build is read-only: it lists spaces and lets you
// browse a space's documents, chat history, flashcards and exam results.
// Write actions (create space, add/remove docs, send chat, take exams) live on
// the web app and are shown here as clean disabled affordances.

import { useState, useEffect } from "react";
import {
  View, Text, ScrollView, TextInput, TouchableOpacity, StyleSheet,
} from "react-native";
import Animated, {
  useSharedValue, useAnimatedStyle, withRepeat, withTiming, Easing,
} from "react-native-reanimated";
import {
  FileText, Image as ImageIcon, StickyNote, FolderOpen, FolderArchive,
  Sparkles, Hexagon, ArrowUp, ChevronRight, ChevronLeft, PenLine, Medal,
  ClipboardList, X,
} from "lucide-react-native";
import ScreenWrapper from "../components/ScreenWrapper";
import { supabase } from "../services/supabase";
import { useUserId } from "../context/AuthContext";

// ── tokens.css values used by the web page ───────────────────────────────────

const T = {
  surface:       "rgba(255,255,255,0.05)",
  border:        "rgba(255,255,255,0.08)",
  borderStrong:  "rgba(255,255,255,0.14)",
  textPrimary:   "#F5F5F5",
  textSecondary: "rgba(255,255,255,0.45)",
  textTertiary:  "rgba(255,255,255,0.25)",
  textDim:       "rgba(255,255,255,0.35)",
  gold:          "#C49A3C",
  goldBg:        "rgba(196,154,60,0.1)",
  goldBorder:    "rgba(196,154,60,0.28)",
  radiusCard:    16,
  radiusBtn:     12,
  radiusPill:    20,
};

// ── Types ─────────────────────────────────────────────────────────────────────

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

type ChatMsg = { id: string; role: "user" | "assistant"; content: string };

interface Exam {
  id: string; title: string; questions: any[]; created_at: string;
}

interface ExamAttempt {
  id: string; exam_id: string; score: number; submitted_at: string | null;
}

type DetailTab = "docs" | "chat" | "cards" | "exams";

// ── Helpers ───────────────────────────────────────────────────────────────────

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

// Same thresholds as web SpaceExams.
function scoreColor(s: number) {
  if (s >= 85) return "#4ade80";
  if (s >= 70) return "#C49A3C";
  if (s >= 55) return "#60a5fa";
  return "#f87171";
}

// Assistant messages are stored as markdown; strip the common markers for a
// clean plain-text read until the app has a proper markdown renderer.
function stripMd(md: string): string {
  return md
    .replace(/```\w*\n?/g, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^>\s?/gm, "")
    .replace(/^[-*]\s+/gm, "•  ")
    .trim();
}

function docIcon(fileType: string | null | undefined, size = 18) {
  if (fileType?.includes("pdf"))   return <FileText size={size} color={T.textSecondary} strokeWidth={1.8} />;
  if (fileType?.includes("image")) return <ImageIcon size={size} color={T.textSecondary} strokeWidth={1.8} />;
  return <StickyNote size={size} color={T.textSecondary} strokeWidth={1.8} />;
}

// ── Skeleton loader (web's spaces-pulse keyframes) ────────────────────────────

function SkeletonRows() {
  const pulse = useSharedValue(0.35);
  useEffect(() => {
    pulse.value = withRepeat(
      withTiming(0.65, { duration: 800, easing: Easing.inOut(Easing.ease) }),
      -1, true,
    );
  }, []);
  const anim = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <View style={{ gap: 10 }}>
      {[1, 2, 3].map(i => (
        <Animated.View key={i} style={[styles.skeleton, anim]} />
      ))}
    </View>
  );
}

// ── Empty-ish shared bits ─────────────────────────────────────────────────────

function TabEmpty({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <View style={styles.tabEmpty}>
      <View style={{ marginBottom: 14, opacity: 0.35 }}>{icon}</View>
      <Text style={styles.tabEmptyTitle}>{title}</Text>
      <Text style={styles.tabEmptyBody}>{body}</Text>
    </View>
  );
}

function ErrorCard({ text }: { text: string }) {
  return (
    <View style={styles.errorCard}>
      <Text style={styles.errorText}>{text}</Text>
    </View>
  );
}

// ── Space card (hub row) ──────────────────────────────────────────────────────

function SpaceCard({ space, docCount, onOpen }: {
  space: Space; docCount: number; onOpen: () => void;
}) {
  return (
    <TouchableOpacity style={styles.spaceCard} onPress={onOpen} activeOpacity={0.7}>
      <View style={[styles.colorDot, {
        backgroundColor: space.color,
        shadowColor: space.color,
      }]} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.spaceName} numberOfLines={1}>{space.name}</Text>
        <Text style={styles.spaceMeta}>
          {docCount} doc{docCount !== 1 ? "s" : ""} · {timeAgo(space.last_active)}
        </Text>
      </View>
      <ChevronRight size={16} color="rgba(255,255,255,0.2)" strokeWidth={1.5} />
    </TouchableOpacity>
  );
}

// ── Read-only document reader (DocReader degrade) ─────────────────────────────

function DocReaderView({ file, onBack }: { file: DocFile; onBack: () => void }) {
  return (
    <View style={{ flex: 1 }}>
      <View style={styles.detailHeader}>
        <TouchableOpacity style={styles.backBtn} onPress={onBack} activeOpacity={0.7}>
          <ChevronLeft size={16} color={T.textSecondary} strokeWidth={1.8} />
        </TouchableOpacity>
        <View style={{ marginRight: 4 }}>{docIcon(file.file_type)}</View>
        <Text style={styles.detailTitle} numberOfLines={1}>{file.name}</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 14, paddingBottom: 8 }}>
        {file.summary ? (
          <View style={styles.readerBox}>
            <Text style={styles.readerLabel}>SUMMARY</Text>
            <Text style={styles.readerBody}>{file.summary}</Text>
          </View>
        ) : null}

        {file.highlights?.length ? (
          <View style={styles.readerBox}>
            <Text style={styles.readerLabel}>HIGHLIGHTS</Text>
            {file.highlights.map((h, i) => (
              <View key={i} style={{ flexDirection: "row", gap: 8, marginTop: i === 0 ? 0 : 8 }}>
                <Text style={[styles.readerBody, { color: T.gold }]}>•</Text>
                <Text style={[styles.readerBody, { flex: 1 }]}>{h}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {file.content_text ? (
          <View style={styles.readerBox}>
            <Text style={styles.readerLabel}>CONTENT</Text>
            <Text style={styles.readerBody}>{file.content_text}</Text>
          </View>
        ) : null}

        {!file.summary && !file.highlights?.length && !file.content_text && (
          <TabEmpty
            icon={<FileText size={32} color={T.textPrimary} strokeWidth={1.5} />}
            title="Nothing to preview"
            body="This document has no extracted text yet. Open it on the web app for the full reader."
          />
        )}
      </ScrollView>
    </View>
  );
}

// ── Space detail ──────────────────────────────────────────────────────────────

const TABS: { key: DetailTab; label: string }[] = [
  { key: "docs",  label: "Documents"  },
  { key: "chat",  label: "Chat"       },
  { key: "cards", label: "Flashcards" },
  { key: "exams", label: "Exams"      },
];

function SpaceDetail({ space, onBack }: { space: Space; onBack: () => void }) {
  const userId = useUserId();
  const [tab,      setTab]      = useState<DetailTab>("docs");
  const [items,    setItems]    = useState<SpaceItem[]>([]);
  const [docFiles, setDocFiles] = useState<Map<string, DocFile>>(new Map());
  const [cards,    setCards]    = useState<Flashcard[]>([]);
  const [chatMsgs, setChatMsgs] = useState<ChatMsg[]>([]);
  const [exams,    setExams]    = useState<Exam[]>([]);
  const [attempts, setAttempts] = useState<Map<string, ExamAttempt>>(new Map());
  const [openFile, setOpenFile] = useState<DocFile | null>(null);
  const [error,    setError]    = useState("");

  const docItems = items.filter(i => i.item_type === "document");
  const docRefs  = docItems.map(i => i.item_ref);
  const refsKey  = docRefs.join(",");

  // Space items
  useEffect(() => {
    let cancelled = false;
    supabase.from("space_items")
      .select("*")
      .eq("space_id", space.id)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .then(({ data, error: err }) => {
        if (cancelled) return;
        if (err) { setError("Couldn't load this space."); return; }
        setItems((data ?? []) as SpaceItem[]);
      });
    return () => { cancelled = true; };
  }, [space.id, userId]);

  // Chat history (persisted to space_chats on web)
  useEffect(() => {
    let cancelled = false;
    supabase.from("space_chats")
      .select("id, role, content")
      .eq("space_id", space.id)
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .limit(200)
      .then(({ data }) => {
        if (!cancelled && data?.length) setChatMsgs(data as ChatMsg[]);
      });
    return () => { cancelled = true; };
  }, [space.id, userId]);

  // File objects for doc items
  useEffect(() => {
    if (!docRefs.length) { setDocFiles(new Map()); return; }
    let cancelled = false;
    supabase.from("files")
      .select("id,name,file_type,summary,highlights,content_text,processed_at")
      .in("id", docRefs)
      .then(({ data }) => {
        if (cancelled) return;
        const m = new Map<string, DocFile>();
        (data ?? []).forEach((f: any) => m.set(f.id, f as DocFile));
        setDocFiles(m);
      });
    return () => { cancelled = true; };
  }, [refsKey]);

  // Flashcards for docs in this space
  useEffect(() => {
    if (!docRefs.length) { setCards([]); return; }
    let cancelled = false;
    supabase.from("flashcards_v2")
      .select("id, question, answer, course_id")
      .eq("user_id", userId)
      .in("course_id", docRefs)
      .then(({ data }) => {
        if (!cancelled) setCards((data ?? []) as Flashcard[]);
      });
    return () => { cancelled = true; };
  }, [refsKey, userId]);

  // Exams + latest submitted attempt per exam
  useEffect(() => {
    let cancelled = false;
    supabase.from("exams")
      .select("id, title, questions, created_at")
      .eq("space_id", space.id)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        if (cancelled) return;
        const list = (data ?? []) as Exam[];
        setExams(list);
        if (!list.length) return;
        supabase.from("exam_attempts")
          .select("id, exam_id, score, submitted_at")
          .eq("user_id", userId)
          .in("exam_id", list.map(e => e.id))
          .not("submitted_at", "is", null)
          .order("created_at", { ascending: false })
          .then(({ data: ats }) => {
            if (cancelled) return;
            const m = new Map<string, ExamAttempt>();
            (ats ?? []).forEach((a: any) => { if (!m.has(a.exam_id)) m.set(a.exam_id, a as ExamAttempt); });
            setAttempts(m);
          });
      });
    return () => { cancelled = true; };
  }, [space.id, userId]);

  if (openFile) {
    return <DocReaderView file={openFile} onBack={() => setOpenFile(null)} />;
  }

  // Group cards by document (web: cardsByDoc)
  const cardsByDoc = cards.reduce<Record<string, Flashcard[]>>((acc, c) => {
    (acc[c.course_id] ??= []).push(c); return acc;
  }, {});

  return (
    <View style={{ flex: 1 }}>
      {/* Header */}
      <View style={styles.detailHeader}>
        <TouchableOpacity style={styles.backBtn} onPress={onBack} activeOpacity={0.7}>
          <ChevronLeft size={16} color={T.textSecondary} strokeWidth={1.8} />
        </TouchableOpacity>
        <View style={[styles.colorDotSm, { backgroundColor: space.color, shadowColor: space.color }]} />
        <Text style={styles.detailTitle} numberOfLines={1}>{space.name}</Text>
      </View>

      {/* Tab bar */}
      <View style={styles.tabBar}>
        {TABS.map(t => (
          <TouchableOpacity
            key={t.key}
            style={[styles.tabBtn, tab === t.key && styles.tabBtnActive]}
            onPress={() => setTab(t.key)}
            activeOpacity={0.7}
          >
            <Text style={[styles.tabBtnText, tab === t.key && styles.tabBtnTextActive]}>
              {t.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {error ? <ErrorCard text={error} /> : null}

      {/* DOCUMENTS */}
      {tab === "docs" && (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 8 }}>
          {docItems.length === 0 ? (
            <TabEmpty
              icon={<FolderOpen size={32} color={T.textPrimary} strokeWidth={1.5} />}
              title="No documents"
              body="Add documents from your library on the web app to read and chat with them here."
            />
          ) : (
            <View style={{ gap: 9, marginBottom: 14 }}>
              {docItems.map(item => {
                const file = docFiles.get(item.item_ref);
                return (
                  <TouchableOpacity
                    key={item.id}
                    style={styles.docRow}
                    activeOpacity={0.7}
                    disabled={!file}
                    onPress={() => file && setOpenFile(file)}
                  >
                    <View style={{ flexShrink: 0 }}>{docIcon(file?.file_type)}</View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.docName} numberOfLines={1}>{item.title ?? "(Untitled)"}</Text>
                      {file?.summary ? (
                        <Text style={styles.docSummary} numberOfLines={1}>{file.summary.slice(0, 70)}</Text>
                      ) : null}
                    </View>
                    <ChevronRight size={14} color="rgba(255,255,255,0.2)" strokeWidth={1.5} />
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {/* Add document — web-only write action, shown disabled */}
          <View style={styles.addDocBtn}>
            <Text style={styles.addDocText}>+ Add document</Text>
            <Text style={styles.webOnlyHint}>Available on the web app</Text>
          </View>
        </ScrollView>
      )}

      {/* CHAT — read-only history */}
      {tab === "chat" && (
        <View style={{ flex: 1, minHeight: 0 }}>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 8 }}>
            {chatMsgs.length === 0 && (
              <View style={styles.chatEmpty}>
                <View style={styles.chatEmptyIcon}>
                  <Sparkles size={22} color={T.textDim} strokeWidth={1.6} />
                </View>
                <Text style={styles.chatEmptyTitle}>Space Chat</Text>
                <Text style={styles.chatEmptyBody}>
                  {docRefs.length
                    ? `Ask anything across the ${docRefs.length} document${docRefs.length !== 1 ? "s" : ""} in this space — on the web app.`
                    : "Add documents to this space on the web app, then ask anything about them."}
                </Text>
              </View>
            )}

            {chatMsgs.map(m => (
              <View
                key={m.id}
                style={[
                  styles.msgRow,
                  { justifyContent: m.role === "user" ? "flex-end" : "flex-start" },
                ]}
              >
                <View style={[styles.bubble, m.role === "user" ? styles.bubbleUser : styles.bubbleAssistant]}>
                  <Text style={styles.bubbleText}>
                    {m.role === "assistant" ? stripMd(m.content) : m.content}
                  </Text>
                </View>
              </View>
            ))}
          </ScrollView>

          {/* Input row — sending is web-only, shown disabled */}
          <View style={styles.chatInputRow}>
            <TextInput
              style={styles.chatInput}
              placeholder="Chat is available on the web app"
              placeholderTextColor={T.textTertiary}
              editable={false}
            />
            <View style={styles.sendBtn}>
              <ArrowUp size={16} color={T.textTertiary} strokeWidth={2} />
            </View>
          </View>
        </View>
      )}

      {/* FLASHCARDS */}
      {tab === "cards" && (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 8 }}>
          {Object.keys(cardsByDoc).length === 0 ? (
            <TabEmpty
              icon={<FolderArchive size={32} color={T.textPrimary} strokeWidth={1.5} />}
              title="No flashcards yet"
              body="Open a document on the web app, select text, then Flashcards to generate cards from it."
            />
          ) : (
            <View style={{ gap: 10 }}>
              {Object.entries(cardsByDoc).map(([docId, deck]) => {
                const file = docFiles.get(docId);
                return (
                  <View key={docId} style={styles.deckCard}>
                    <View style={styles.deckHeader}>
                      <Text style={styles.deckName} numberOfLines={1}>{file?.name ?? "Document"}</Text>
                      <View style={styles.deckBadge}>
                        <Text style={styles.deckBadgeText}>
                          {deck.length} card{deck.length !== 1 ? "s" : ""}
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.deckPreview} numberOfLines={2}>
                      "{deck[0]?.question}"
                    </Text>
                  </View>
                );
              })}
            </View>
          )}
        </ScrollView>
      )}

      {/* EXAMS — read-only list of exams + results */}
      {tab === "exams" && (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 8 }}>
          <View style={styles.examsHeader}>
            <Text style={styles.examsCount}>
              {exams.length === 0 ? "No exams yet" : `${exams.length} exam${exams.length !== 1 ? "s" : ""}`}
            </Text>
            <View style={styles.createExamBtn}>
              <Text style={styles.createExamText}>+ Create Exam</Text>
            </View>
          </View>

          {exams.length === 0 ? (
            <TabEmpty
              icon={<PenLine size={32} color={T.textPrimary} strokeWidth={1.5} />}
              title="No exams yet"
              body={docRefs.length
                ? "Generate a practice exam from your space documents on the web app."
                : "Add documents first, then create an exam on the web app."}
            />
          ) : (
            <View style={{ gap: 10 }}>
              {exams.map(e => {
                const attempt = attempts.get(e.id) ?? null;
                const done = !!attempt?.submitted_at;
                const sc = done ? Math.round(attempt!.score) : null;
                const col = done ? scoreColor(sc!) : null;
                return (
                  <View key={e.id} style={styles.examCard}>
                    <View style={[
                      styles.examIcon,
                      done && { backgroundColor: `${col}18`, borderColor: `${col}30` },
                    ]}>
                      {done
                        ? (sc! >= 70
                            ? <Medal size={20} color={col!} strokeWidth={1.8} />
                            : <ClipboardList size={20} color={col!} strokeWidth={1.8} />)
                        : <PenLine size={20} color={T.textSecondary} strokeWidth={1.8} />}
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.examTitle} numberOfLines={1}>{e.title}</Text>
                      <Text style={styles.examMeta}>
                        {(e.questions?.length ?? 0)} questions · {timeAgo(e.created_at)}
                        {done ? ` · ${sc}%` : ""}
                      </Text>
                    </View>
                    {done ? (
                      <View style={[styles.examScorePill, { backgroundColor: `${col}18`, borderColor: `${col}38` }]}>
                        <Text style={[styles.examScoreText, { color: col! }]}>{sc}%</Text>
                      </View>
                    ) : (
                      <View style={styles.examNotTaken}>
                        <Text style={styles.examNotTakenText}>Not taken</Text>
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function SpacesScreen() {
  const userId = useUserId();
  const [spaces,    setSpaces]    = useState<Space[]>([]);
  const [docCounts, setDocCounts] = useState<Map<string, number>>(new Map());
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState("");
  const [openSpace, setOpenSpace] = useState<Space | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const { data: rows, error: err } = await supabase
        .from("spaces")
        .select("*")
        .eq("user_id", userId)
        .order("last_active", { ascending: false });
      if (cancelled) return;

      if (err) {
        setError("Couldn't load your spaces. Pull down or reopen to retry.");
        setLoading(false);
        return;
      }

      const list = (rows ?? []) as Space[];
      setSpaces(list);

      if (list.length) {
        const { data: items } = await supabase
          .from("space_items")
          .select("space_id")
          .eq("user_id", userId)
          .eq("item_type", "document")
          .in("space_id", list.map(s => s.id));
        if (cancelled) return;

        const counts = new Map<string, number>();
        (items ?? []).forEach((i: any) => counts.set(i.space_id, (counts.get(i.space_id) ?? 0) + 1));
        setDocCounts(counts);
      }
      setLoading(false);
    }

    load();
    return () => { cancelled = true; };
  }, [userId]);

  if (openSpace) {
    return (
      <ScreenWrapper page="spaces">
        <SpaceDetail space={openSpace} onBack={() => setOpenSpace(null)} />
      </ScreenWrapper>
    );
  }

  return (
    <ScreenWrapper page="spaces">
      {/* Header */}
      <View style={styles.hubHeader}>
        <View>
          <Text style={styles.hubTitle}>Spaces</Text>
          <Text style={styles.hubSubtitle}>
            {loading ? " " : spaces.length === 0
              ? "Workspaces for your subjects"
              : `${spaces.length} workspace${spaces.length !== 1 ? "s" : ""}`}
          </Text>
        </View>
        {/* + New — web-only write action, shown disabled */}
        <View style={styles.newBtn}>
          <Text style={styles.newBtnText}>+ New</Text>
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 8 }}>
        {loading && <SkeletonRows />}

        {!loading && error ? <ErrorCard text={error} /> : null}

        {/* Empty state */}
        {!loading && !error && spaces.length === 0 && (
          <View style={styles.emptyWrap}>
            <View style={styles.emptyIcon}>
              <Hexagon size={38} color={T.textPrimary} strokeWidth={1.4} />
            </View>
            <Text style={styles.emptyTitle}>No spaces yet</Text>
            <Text style={styles.emptyBody}>
              Create a space for each subject — Biology, Linear Algebra, History —
              and keep all your materials, chats, and flashcards together.
            </Text>
            <View style={styles.emptyCTA}>
              <Text style={styles.emptyCTAText}>Create your first Space</Text>
            </View>
            <Text style={styles.webOnlyHint}>Space creation is available on the web app</Text>
          </View>
        )}

        {/* Space list */}
        {!loading && spaces.length > 0 && (
          <View style={{ gap: 10 }}>
            {spaces.map(space => (
              <SpaceCard
                key={space.id}
                space={space}
                docCount={docCounts.get(space.id) ?? 0}
                onOpen={() => setOpenSpace(space)}
              />
            ))}
          </View>
        )}
      </ScrollView>
    </ScreenWrapper>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // Hub header
  hubHeader:    { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 28 },
  hubTitle:     { fontFamily: "Inter_700Bold", fontSize: 28, color: T.textPrimary, letterSpacing: -0.5, lineHeight: 31 },
  hubSubtitle:  { fontFamily: "Inter_400Regular", fontSize: 13, color: T.textDim, marginTop: 5 },
  newBtn:       { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 9, backgroundColor: T.goldBg, borderWidth: 1, borderColor: T.goldBorder, borderRadius: T.radiusPill, opacity: 0.45, flexShrink: 0 },
  newBtnText:   { fontFamily: "Inter_600SemiBold", fontSize: 13, color: T.gold },

  // Skeletons
  skeleton:     { height: 68, borderRadius: T.radiusCard, backgroundColor: "rgba(255,255,255,0.03)", borderWidth: 1, borderColor: "rgba(255,255,255,0.05)" },

  // Empty state
  emptyWrap:    { alignItems: "center", paddingTop: 64 },
  emptyIcon:    { width: 84, height: 84, borderRadius: 22, backgroundColor: "rgba(255,255,255,0.04)", borderWidth: 1, borderColor: T.border, alignItems: "center", justifyContent: "center", marginBottom: 22, opacity: 0.9 },
  emptyTitle:   { fontFamily: "Inter_700Bold", fontSize: 18, color: T.textSecondary, letterSpacing: -0.2, marginBottom: 10 },
  emptyBody:    { fontFamily: "Inter_400Regular", fontSize: 13, color: T.textDim, lineHeight: 22, maxWidth: 270, textAlign: "center", marginBottom: 32 },
  emptyCTA:     { paddingHorizontal: 26, paddingVertical: 12, backgroundColor: "rgba(196,154,60,0.12)", borderWidth: 1, borderColor: "rgba(196,154,60,0.32)", borderRadius: T.radiusPill, opacity: 0.45 },
  emptyCTAText: { fontFamily: "Inter_600SemiBold", fontSize: 14, color: T.gold },
  webOnlyHint:  { fontFamily: "Inter_400Regular", fontSize: 11, color: T.textTertiary, marginTop: 10, textAlign: "center" },

  // Space card
  spaceCard:    { flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 16, paddingVertical: 15, backgroundColor: T.surface, borderWidth: 1, borderColor: T.border, borderRadius: T.radiusCard },
  colorDot:     { width: 10, height: 10, borderRadius: 5, flexShrink: 0, shadowOpacity: 0.55, shadowRadius: 5, shadowOffset: { width: 0, height: 0 } },
  colorDotSm:   { width: 8, height: 8, borderRadius: 4, flexShrink: 0, shadowOpacity: 0.55, shadowRadius: 5, shadowOffset: { width: 0, height: 0 } },
  spaceName:    { fontFamily: "Inter_500Medium", fontSize: 15, color: T.textPrimary, lineHeight: 20 },
  spaceMeta:    { fontFamily: "Inter_400Regular", fontSize: 12, color: T.textDim, marginTop: 3 },

  // Error
  errorCard:    { backgroundColor: "rgba(255,59,48,0.08)", borderWidth: 1, borderColor: "rgba(255,59,48,0.2)", borderRadius: T.radiusBtn, padding: 14, marginBottom: 12 },
  errorText:    { fontFamily: "Inter_400Regular", fontSize: 13, color: "rgba(255,100,90,0.9)", lineHeight: 19 },

  // Detail header
  detailHeader: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 22 },
  backBtn:      { width: 32, height: 32, borderRadius: 16, backgroundColor: "rgba(255,255,255,0.07)", borderWidth: 1, borderColor: "rgba(255,255,255,0.09)", alignItems: "center", justifyContent: "center", flexShrink: 0 },
  detailTitle:  { fontFamily: "Inter_700Bold", fontSize: 19, color: T.textPrimary, letterSpacing: -0.2, flex: 1, minWidth: 0 },

  // Tab bar
  tabBar:        { flexDirection: "row", gap: 2, backgroundColor: "rgba(255,255,255,0.04)", borderWidth: 1, borderColor: "rgba(255,255,255,0.07)", borderRadius: 11, padding: 3, marginBottom: 20 },
  tabBtn:        { flex: 1, paddingVertical: 7, paddingHorizontal: 4, borderRadius: 8, borderWidth: 1, borderColor: "transparent", alignItems: "center" },
  tabBtnActive:  { backgroundColor: "rgba(255,255,255,0.1)", borderColor: "rgba(255,255,255,0.1)" },
  tabBtnText:    { fontFamily: "Inter_400Regular", fontSize: 12, color: T.textDim },
  tabBtnTextActive: { fontFamily: "Inter_600SemiBold", color: T.textPrimary },

  // Tab empty state
  tabEmpty:      { alignItems: "center", paddingVertical: 44, paddingHorizontal: 20 },
  tabEmptyTitle: { fontFamily: "Inter_500Medium", fontSize: 14, color: T.textSecondary, marginBottom: 5 },
  tabEmptyBody:  { fontFamily: "Inter_400Regular", fontSize: 12, color: T.textDim, lineHeight: 19, textAlign: "center", maxWidth: 260 },

  // Documents
  docRow:       { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 15, paddingVertical: 13, backgroundColor: T.surface, borderWidth: 1, borderColor: T.border, borderRadius: 13 },
  docName:      { fontFamily: "Inter_500Medium", fontSize: 13, color: T.textPrimary },
  docSummary:   { fontFamily: "Inter_400Regular", fontSize: 11, color: T.textDim, marginTop: 2 },
  addDocBtn:    { padding: 13, backgroundColor: "rgba(255,255,255,0.03)", borderWidth: 1.5, borderStyle: "dashed", borderColor: "rgba(255,255,255,0.1)", borderRadius: 13, alignItems: "center", opacity: 0.6 },
  addDocText:   { fontFamily: "Inter_400Regular", fontSize: 13, color: T.textDim },

  // Chat
  chatEmpty:      { alignItems: "center", paddingVertical: 40, paddingHorizontal: 24 },
  chatEmptyIcon:  { width: 52, height: 52, borderRadius: 26, backgroundColor: "rgba(255,255,255,0.04)", borderWidth: 1, borderColor: T.border, alignItems: "center", justifyContent: "center", marginBottom: 14 },
  chatEmptyTitle: { fontFamily: "Inter_500Medium", fontSize: 14, color: T.textSecondary, marginBottom: 6 },
  chatEmptyBody:  { fontFamily: "Inter_400Regular", fontSize: 12, color: T.textDim, lineHeight: 19, maxWidth: 240, textAlign: "center" },
  msgRow:         { flexDirection: "row", marginBottom: 9 },
  bubble:         { maxWidth: "88%", paddingHorizontal: 13, paddingVertical: 9, borderWidth: 1 },
  bubbleUser:      { backgroundColor: "rgba(196,154,60,0.13)", borderColor: "rgba(196,154,60,0.2)", borderTopLeftRadius: 16, borderTopRightRadius: 16, borderBottomLeftRadius: 16, borderBottomRightRadius: 4 },
  bubbleAssistant: { backgroundColor: "rgba(255,255,255,0.06)", borderColor: "rgba(255,255,255,0.07)", borderTopLeftRadius: 16, borderTopRightRadius: 16, borderBottomLeftRadius: 4, borderBottomRightRadius: 16 },
  bubbleText:     { fontFamily: "Inter_400Regular", fontSize: 13, color: T.textPrimary, lineHeight: 21 },
  chatInputRow:   { flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 12, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.06)" },
  chatInput:      { flex: 1, backgroundColor: T.surface, borderWidth: 1, borderColor: "rgba(255,255,255,0.09)", borderRadius: 10, paddingHorizontal: 13, paddingVertical: 10, fontFamily: "Inter_400Regular", fontSize: 13, color: T.textPrimary, opacity: 0.5 },
  sendBtn:        { width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.04)", borderWidth: 1, borderColor: "rgba(255,255,255,0.07)", alignItems: "center", justifyContent: "center", flexShrink: 0 },

  // Flashcards
  deckCard:      { paddingHorizontal: 16, paddingVertical: 14, backgroundColor: T.surface, borderWidth: 1, borderColor: T.border, borderRadius: 13 },
  deckHeader:    { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8, gap: 8 },
  deckName:      { fontFamily: "Inter_600SemiBold", fontSize: 13, color: T.textPrimary, flex: 1, minWidth: 0 },
  deckBadge:     { paddingHorizontal: 9, paddingVertical: 2, borderRadius: 20, backgroundColor: T.goldBg, borderWidth: 1, borderColor: "rgba(196,154,60,0.22)", flexShrink: 0 },
  deckBadgeText: { fontFamily: "Inter_400Regular", fontSize: 11, color: "rgba(196,154,60,0.9)" },
  deckPreview:   { fontFamily: "Inter_400Regular", fontSize: 12, color: T.textDim, fontStyle: "italic", lineHeight: 18 },

  // Exams
  examsHeader:      { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 18 },
  examsCount:       { fontFamily: "Inter_400Regular", fontSize: 13, color: T.textDim },
  createExamBtn:    { paddingHorizontal: 14, paddingVertical: 8, borderRadius: T.radiusPill, backgroundColor: "rgba(255,255,255,0.04)", borderWidth: 1, borderColor: "rgba(255,255,255,0.07)" },
  createExamText:   { fontFamily: "Inter_600SemiBold", fontSize: 13, color: T.textTertiary },
  examCard:         { flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 16, paddingVertical: 14, backgroundColor: T.surface, borderWidth: 1, borderColor: T.border, borderRadius: 14 },
  examIcon:         { width: 40, height: 40, borderRadius: 10, backgroundColor: T.surface, borderWidth: 1, borderColor: T.border, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  examTitle:        { fontFamily: "Inter_600SemiBold", fontSize: 13, color: T.textPrimary },
  examMeta:         { fontFamily: "Inter_400Regular", fontSize: 11, color: T.textDim, marginTop: 3 },
  examScorePill:    { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1, flexShrink: 0 },
  examScoreText:    { fontFamily: "Inter_600SemiBold", fontSize: 12 },
  examNotTaken:     { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: "rgba(255,255,255,0.05)", borderWidth: 1, borderColor: "rgba(255,255,255,0.09)", flexShrink: 0 },
  examNotTakenText: { fontFamily: "Inter_500Medium", fontSize: 12, color: T.textSecondary },

  // Doc reader
  readerBox:   { backgroundColor: "rgba(255,255,255,0.03)", borderWidth: 1, borderColor: "rgba(255,255,255,0.06)", borderRadius: 12, padding: 14 },
  readerLabel: { fontFamily: "Inter_600SemiBold", fontSize: 10, color: T.textTertiary, letterSpacing: 1, marginBottom: 8 },
  readerBody:  { fontFamily: "Inter_400Regular", fontSize: 13, color: T.textSecondary, lineHeight: 21 },
});

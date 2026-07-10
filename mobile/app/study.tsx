// study.tsx — mobile port of src/pages/Study.tsx.
// Course picker, Flashcards / Study Guide modes, saved-card list with flip
// previews, and a fullscreen-style flashcard session (flip + got-it/missed)
// that saves study time and writes SM-2 spaced-repetition reviews.
// AI generation (groq via /api) isn't reachable from mobile yet — those
// buttons degrade to a "coming soon" toast.

import { useState, useEffect, useRef, useCallback } from "react";
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, ActivityIndicator,
} from "react-native";
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, Easing,
} from "react-native-reanimated";
import {
  Check, X, AlertTriangle, Sparkles, ChevronDown, RotateCcw,
} from "lucide-react-native";
import ScreenWrapper from "../components/ScreenWrapper";
import { supabase } from "../services/supabase";

// TODO: replace with the real signed-in user once identity.tsx (mobile login)
// is built. This is Sarim Khan's real TMU account — same Supabase project,
// so its courses/flashcards are reachable here too.
const TEST_USER_ID = "26179287-a074-44cf-94a1-c57a8c70cb51";

// ── Design tokens (mirrors tokens.css) ────────────────────────────────────────
const C = {
  bg:            "#111111",
  surface:       "rgba(255,255,255,0.05)",
  surfaceHover:  "rgba(255,255,255,0.08)",
  border:        "rgba(255,255,255,0.08)",
  borderStrong:  "rgba(255,255,255,0.14)",
  accent:        "rgba(255,255,255,0.85)",
  textPrimary:   "#F5F5F5",
  textSecondary: "rgba(255,255,255,0.45)",
  textDim:       "rgba(255,255,255,0.35)",
};
const RADIUS_CARD = 16;
const RADIUS_BTN  = 12;

// ── SRS: SM-2 helpers copied from src/lib/srs.ts (mobile can't import src/) ──
type SrsState = {
  ease: number; interval: number; reps: number; lapses: number; dueAt: string;
};

const GRADE = { again: 2, hard: 3, good: 4, easy: 5 } as const;

function cardKey(courseId: any, question: any): string {
  return `${courseId ?? "none"}::${String(question || "").trim().toLowerCase().slice(0, 240)}`;
}

function sm2(state: Partial<SrsState> | null | undefined, grade: number): SrsState {
  let ease     = state?.ease ?? 2.5;
  let interval = state?.interval ?? 0;
  let reps     = state?.reps ?? 0;
  let lapses   = state?.lapses ?? 0;

  const q = Math.max(0, Math.min(5, Math.round(grade)));

  ease = ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
  if (ease < 1.3) ease = 1.3;
  ease = Math.round(ease * 100) / 100;

  if (q < 3) {
    reps = 0;
    interval = 1;        // relearn tomorrow
    lapses += 1;
  } else {
    reps += 1;
    interval = reps === 1 ? 1 : reps === 2 ? 6 : Math.round(interval * ease);
  }

  const dueAt = new Date(Date.now() + interval * 86_400_000).toISOString();
  return { ease, interval, reps, lapses, dueAt };
}

function isDue(state: Partial<SrsState> | null | undefined, now: number = Date.now()): boolean {
  if (!state || !state.dueAt) return true;
  return new Date(state.dueAt).getTime() <= now;
}

// ── Types ─────────────────────────────────────────────────────────────────────
type Course = { dbId: string; name: string; courseCode: string; label: string };
type Card   = { id: string; question: string; answer: string };
type SrsMap = Record<string, SrsState>;

// Persist one review row (fire-and-forget from the session).
async function saveSrsReview(courseId: string | null, card: Card, next: SrsState) {
  try {
    await supabase.from("srs_reviews").upsert(
      {
        user_id:          TEST_USER_ID,
        card_key:         cardKey(courseId, card.question),
        course_id:        courseId,
        question:         card.question,
        answer:           card.answer,
        ease:             next.ease,
        interval_days:    next.interval,
        reps:             next.reps,
        lapses:           next.lapses,
        due_at:           next.dueAt,
        last_reviewed_at: new Date().toISOString(),
      },
      { onConflict: "user_id,card_key" }
    );
  } catch { /* offline / table missing — session still works locally */ }
}

// ── Fullscreen study session ──────────────────────────────────────────────────
function StudySession({ cards, courseId, srsMap, onSrsUpdate, onExit }: {
  cards: Card[];
  courseId: string | null;
  srsMap: SrsMap;
  onSrsUpdate: (key: string, state: SrsState) => void;
  onExit: () => void;
}) {
  const [idx, setIdx]         = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [results, setResults] = useState<boolean[]>([]);
  const judgeLock             = useRef(false);

  // Timers — mirror the web session: save elapsed minutes, 2-min idle bail-out.
  const sessionStart = useRef(Date.now());
  const idleTimer    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedRef     = useRef(false);
  const IDLE_MS = 2 * 60 * 1000;

  const saveStudyTime = useCallback(async (exitCallback?: () => void) => {
    if (savedRef.current) { exitCallback?.(); return; }
    savedRef.current = true;
    if (idleTimer.current) clearTimeout(idleTimer.current);
    const elapsedMinutes = Math.round((Date.now() - sessionStart.current) / 60000);
    if (elapsedMinutes > 0) {
      try {
        const { data } = await supabase
          .from("users").select("study_time").eq("id", TEST_USER_ID).maybeSingle();
        const prev = data?.study_time ?? 0;
        await supabase.from("users")
          .update({ study_time: prev + elapsedMinutes }).eq("id", TEST_USER_ID);
      } catch { /* non-fatal */ }
    }
    exitCallback?.();
  }, []);

  const resetIdle = useCallback(() => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => { saveStudyTime(onExit); }, IDLE_MS);
  }, [saveStudyTime, onExit]);

  useEffect(() => {
    resetIdle();
    return () => { if (idleTimer.current) clearTimeout(idleTimer.current); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const isDone = idx >= cards.length;
  const card   = cards[idx];

  // Flip + exit animations
  const flip  = useSharedValue(0);   // 0 = question, 1 = answer
  const exitX = useSharedValue(0);   // -1 left, +1 right (normalized)
  const fade  = useSharedValue(1);

  const EASE = Easing.bezier(0.25, 0.46, 0.45, 0.94);

  const doFlip = useCallback(() => {
    if (flipped || judgeLock.current || isDone) return;
    resetIdle();
    setFlipped(true);
    flip.value = withTiming(1, { duration: 420, easing: EASE });
  }, [flipped, isDone, resetIdle]); // eslint-disable-line react-hooks/exhaustive-deps

  const judge = useCallback((correct: boolean) => {
    if (judgeLock.current || isDone || !card) return;
    resetIdle();
    judgeLock.current = true;

    // Write the SM-2 review: got-it → good, missed → again (same as web SRS).
    const key  = cardKey(courseId, card.question);
    const next = sm2(srsMap[key], correct ? GRADE.good : GRADE.again);
    onSrsUpdate(key, next);
    saveSrsReview(courseId, card, next);

    exitX.value = withTiming(correct ? 1 : -1, { duration: 280, easing: EASE });
    fade.value  = withTiming(0, { duration: 280, easing: EASE });
    setTimeout(() => {
      setResults(r => [...r, correct]);
      setIdx(i => i + 1);
      setFlipped(false);
      flip.value  = 0;
      exitX.value = 0;
      fade.value  = 1;
      judgeLock.current = false;
    }, 290);
  }, [isDone, card, courseId, srsMap, onSrsUpdate, resetIdle]); // eslint-disable-line react-hooks/exhaustive-deps

  const wrapStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: exitX.value * 380 },
      { rotate: `${exitX.value * 14}deg` },
    ],
    opacity: fade.value,
  }));
  const frontStyle = useAnimatedStyle(() => ({
    transform: [{ perspective: 1400 }, { rotateY: `${flip.value * 180}deg` }],
  }));
  const backStyle = useAnimatedStyle(() => ({
    transform: [{ perspective: 1400 }, { rotateY: `${180 + flip.value * 180}deg` }],
  }));

  // ── Done screen ─────────────────────────────────────────────────────────────
  if (isDone) {
    const correct = results.filter(Boolean).length;
    const pct     = cards.length > 0 ? Math.round((correct / cards.length) * 100) : 0;
    return (
      <View style={s.doneWrap}>
        <View style={{ alignItems: "center", maxWidth: 320, width: "100%" }}>
          <Text style={s.donePct}>{pct}%</Text>
          <Text style={s.doneSub}>{correct} of {cards.length} correct</Text>
          <View style={s.doneDots}>
            {results.map((r, i) => (
              <View key={i} style={[s.doneDot, {
                backgroundColor: r ? "rgba(52,199,89,0.85)" : "rgba(255,59,48,0.7)",
              }]} />
            ))}
          </View>
          <TouchableOpacity style={s.doneBtn} onPress={() => saveStudyTime(onExit)} activeOpacity={0.8}>
            <Text style={s.doneBtnText}>Done</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={s.retryBtn}
            onPress={() => { setIdx(0); setResults([]); setFlipped(false); flip.value = 0; }}
            activeOpacity={0.8}
          >
            <Text style={s.retryBtnText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── Active session ───────────────────────────────────────────────────────────
  return (
    <View style={{ flex: 1 }}>
      {/* Top bar */}
      <View style={s.sessTop}>
        <TouchableOpacity onPress={() => saveStudyTime(onExit)} hitSlop={12}>
          <Text style={s.sessExit}>←  Exit</Text>
        </TouchableOpacity>
        <Text style={s.sessCount}>{idx + 1} / {cards.length}</Text>
      </View>

      {/* Progress bar */}
      <View style={s.progressTrack}>
        <View style={[s.progressFill, { width: `${(idx / cards.length) * 100}%` }]} />
      </View>

      {/* Judge hint labels */}
      <View style={[s.hintRow, { opacity: flipped ? 1 : 0 }]}>
        <View style={s.hintItem}>
          <X size={12} color="rgba(255,75,65,0.8)" />
          <Text style={s.hintMissed}>Missed</Text>
        </View>
        <View style={s.hintItem}>
          <Text style={s.hintGot}>Got it</Text>
          <Check size={12} color="rgba(52,199,89,0.85)" />
        </View>
      </View>

      {/* Card area */}
      <View style={s.cardArea}>
        <Animated.View style={[{ width: "100%", maxWidth: 400 }, wrapStyle]}>
          <TouchableOpacity activeOpacity={flipped ? 1 : 0.9} onPress={doFlip}>
            <View style={s.cardBox}>
              {/* Front — question */}
              <Animated.View style={[s.cardFace, s.cardFront, frontStyle]}>
                <Text style={s.cardLabel}>QUESTION</Text>
                <Text style={s.cardQuestion}>{card.question}</Text>
                <Text style={s.cardHint}>Tap to reveal</Text>
              </Animated.View>
              {/* Back — answer (pre-rotated 180°) */}
              <Animated.View style={[s.cardFace, s.cardBack, backStyle]}>
                <Text style={[s.cardLabel, { color: "rgba(255,255,255,0.35)" }]}>ANSWER</Text>
                <Text style={s.cardAnswer}>{card.answer}</Text>
              </Animated.View>
            </View>
          </TouchableOpacity>
        </Animated.View>
      </View>

      {/* Judge buttons — appear after flip */}
      <View style={[s.judgeRow, { opacity: flipped ? 1 : 0 }]} pointerEvents={flipped ? "auto" : "none"}>
        <TouchableOpacity style={s.missedBtn} onPress={() => judge(false)} activeOpacity={0.8}>
          <X size={16} color="rgba(255,85,75,0.9)" />
          <Text style={s.missedText}>Missed</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.gotBtn} onPress={() => judge(true)} activeOpacity={0.8}>
          <Text style={s.gotText}>Got it</Text>
          <Check size={16} color="rgba(72,210,110,0.9)" />
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ── Compact flip card for the list view ───────────────────────────────────────
function FlipCard({ card }: { card: Card }) {
  const [flipped, setFlipped] = useState(false);
  return (
    <TouchableOpacity style={s.flipCard} onPress={() => setFlipped(f => !f)} activeOpacity={0.7}>
      <Text style={s.flipLabel}>{flipped ? "ANSWER" : "QUESTION — TAP TO FLIP"}</Text>
      <Text style={s.flipText}>{flipped ? card.answer : card.question}</Text>
    </TouchableOpacity>
  );
}

// ── Lightweight markdown renderer (headings, bold, bullets) ──────────────────
function renderInline(str: string, baseStyle: any) {
  const parts = str.split(/(\*\*[^*]+\*\*)/g);
  return (
    <Text style={baseStyle}>
      {parts.map((part, idx) =>
        part.startsWith("**") && part.endsWith("**")
          ? <Text key={idx} style={s.mdBold}>{part.slice(2, -2)}</Text>
          : <Text key={idx}>{part}</Text>
      )}
    </Text>
  );
}

function MarkdownGuide({ text }: { text: string }) {
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];

  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (!trimmed) { elements.push(<View key={i} style={{ height: 8 }} />); return; }

    if (trimmed.startsWith("### ")) {
      elements.push(<Text key={i} style={s.mdH3}>{trimmed.slice(4).toUpperCase()}</Text>);
    } else if (trimmed.startsWith("## ")) {
      elements.push(<Text key={i} style={s.mdH2}>{trimmed.slice(3)}</Text>);
    } else if (trimmed.startsWith("# ")) {
      elements.push(<Text key={i} style={s.mdH1}>{trimmed.slice(2)}</Text>);
    } else if (trimmed.startsWith("- ") || trimmed.startsWith("• ")) {
      elements.push(
        <View key={i} style={s.mdBulletRow}>
          <Text style={s.mdBulletDot}>·</Text>
          <View style={{ flex: 1 }}>{renderInline(trimmed.slice(2), s.mdBulletText)}</View>
        </View>
      );
    } else {
      elements.push(<View key={i}>{renderInline(trimmed, s.mdPara)}</View>);
    }
  });

  return <View>{elements}</View>;
}

// ── Main screen ───────────────────────────────────────────────────────────────
export default function StudyScreen() {
  const [courses, setCourses]         = useState<Course[]>([]);
  const [coursesLoaded, setCoursesLoaded] = useState(false);
  const [course, setCourse]           = useState<Course | null>(null);
  const [pickerOpen, setPickerOpen]   = useState(false);
  const [mode, setMode]               = useState<"flashcards" | "guide">("flashcards");
  const [loading, setLoading]         = useState(false);
  const [flashcards, setFlashcards]   = useState<Card[]>([]);
  const [guide, setGuide]             = useState("");
  const [srsMap, setSrsMap]           = useState<SrsMap>({});
  const [inSession, setInSession]     = useState(false);
  const [sessionCards, setSessionCards] = useState<Card[]>([]);
  const [toast, setToast]             = useState("");
  const [toastKind, setToastKind]     = useState<"info" | "warn" | "ok">("info");

  const showToast = (msg: string, kind: "info" | "warn" | "ok" = "info") => {
    setToastKind(kind); setToast(msg);
  };

  // Auto-clear toast (matches web's 3s)
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  // Load live courses
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const { data } = await supabase
          .from("courses")
          .select("id, name, course_code")
          .eq("user_id", TEST_USER_ID)
          .order("updated_at", { ascending: false });
        if (cancelled) return;
        const list: Course[] = (data ?? []).map((c: any) => ({
          dbId:       c.id,
          name:       c.name ?? "",
          courseCode: c.course_code ?? "",
          label:      `${c.course_code ?? ""} — ${c.name ?? ""}`,
        }));
        setCourses(list);
        setCourse(list[0] ?? null);
      } catch { /* fall through to empty state */ }
      if (!cancelled) setCoursesLoaded(true);
    }
    load();
    return () => { cancelled = true; };
  }, []);

  // Load saved flashcards + SRS scheduling state for the selected course
  const loadExisting = async () => {
    if (!course) return;
    setLoading(true);
    if (mode === "flashcards") {
      try {
        const [{ data: rows }, { data: srsRows }] = await Promise.all([
          supabase.from("flashcards_v2")
            .select("id, question, answer, created_at")
            .eq("user_id", TEST_USER_ID)
            .eq("course_id", course.dbId)
            .order("created_at", { ascending: false }),
          supabase.from("srs_reviews")
            .select("card_key, ease, interval_days, reps, lapses, due_at")
            .eq("user_id", TEST_USER_ID)
            .eq("course_id", course.dbId),
        ]);
        const loaded: Card[] = (rows ?? []).map((r: any) => ({
          id: String(r.id), question: r.question, answer: r.answer,
        }));
        const map: SrsMap = {};
        (srsRows ?? []).forEach((r: any) => {
          map[r.card_key] = {
            ease: r.ease ?? 2.5, interval: r.interval_days ?? 0,
            reps: r.reps ?? 0, lapses: r.lapses ?? 0, dueAt: r.due_at ?? "",
          };
        });
        if (loaded.length > 0) { setFlashcards(loaded); setSrsMap(map); setGuide(""); }
        else showToast("No saved flashcards yet — generate some on the web app.", "info");
      } catch {
        showToast("Couldn't load flashcards — check your connection.", "warn");
      }
    } else {
      // Study guide — load from canvas_data blob (same as web)
      try {
        const { data } = await supabase
          .from("canvas_data")
          .select("payload")
          .eq("user_id", TEST_USER_ID)
          .eq("data_type", `study_guide_${course.dbId}`)
          .maybeSingle();
        if (data?.payload?.text) setGuide(data.payload.text);
        else showToast("No saved study guide yet — create one on the web app.", "info");
        setFlashcards([]);
      } catch {
        showToast("Couldn't load the study guide — check your connection.", "warn");
      }
    }
    setLoading(false);
  };

  // AI generation needs the groq/RAG serverless endpoints — not reachable from
  // mobile yet, so this degrades to a clean coming-soon affordance.
  const generate = () => {
    showToast(
      mode === "guide"
        ? "Study guide generation is coming soon on mobile — use the web app for now."
        : "Flashcard generation is coming soon on mobile — use the web app for now.",
      "info"
    );
  };

  const deleteCard = async (cardId: string) => {
    setFlashcards(prev => prev.filter(c => c.id !== cardId));
    try {
      await supabase.from("flashcards_v2")
        .delete().eq("id", cardId).eq("user_id", TEST_USER_ID);
    } catch { /* optimistic removal stands */ }
  };

  const selectCourse = (c: Course) => {
    setCourse(c);
    setPickerOpen(false);
    setFlashcards([]);
    setGuide("");
    setSrsMap({});
  };

  const startSession = (cards: Card[]) => {
    setSessionCards(cards);
    setInSession(true);
  };

  const onSrsUpdate = useCallback((key: string, state: SrsState) => {
    setSrsMap(prev => ({ ...prev, [key]: state }));
  }, []);

  const dueCards = course
    ? flashcards.filter(c => isDue(srsMap[cardKey(course.dbId, c.question)]))
    : [];

  // ── Session takes over the whole screen ─────────────────────────────────────
  if (inSession && sessionCards.length > 0) {
    return (
      <ScreenWrapper page="study">
        <StudySession
          cards={sessionCards}
          courseId={course?.dbId ?? null}
          srsMap={srsMap}
          onSrsUpdate={onSrsUpdate}
          onExit={() => setInSession(false)}
        />
      </ScreenWrapper>
    );
  }

  // ── No Canvas courses yet ────────────────────────────────────────────────────
  if (coursesLoaded && courses.length === 0) {
    return (
      <ScreenWrapper page="study">
        <Text style={s.h1}>Study</Text>
        <View style={s.emptyCard}>
          <Text style={s.emptyTitle}>No courses found</Text>
          <Text style={s.emptySub}>
            Connect Canvas on the web app to load your real courses here.
          </Text>
        </View>
      </ScreenWrapper>
    );
  }

  return (
    <ScreenWrapper page="study">
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 8 }}>
        <Text style={s.h1}>Study</Text>

        {!coursesLoaded ? (
          <ActivityIndicator color={C.textDim} style={{ marginTop: 40 }} />
        ) : (
          <>
            {/* Course picker */}
            <TouchableOpacity style={s.select} onPress={() => setPickerOpen(o => !o)} activeOpacity={0.7}>
              <Text style={s.selectText} numberOfLines={1}>{course?.label ?? "Select a course"}</Text>
              <ChevronDown size={14} color={C.textDim} />
            </TouchableOpacity>
            {pickerOpen && (
              <View style={s.dropdown}>
                {courses.map(c => (
                  <TouchableOpacity
                    key={c.dbId}
                    style={[s.dropdownItem, c.dbId === course?.dbId && s.dropdownItemActive]}
                    onPress={() => selectCourse(c)}
                    activeOpacity={0.7}
                  >
                    <Text
                      style={[s.dropdownText, c.dbId === course?.dbId && { color: C.textPrimary }]}
                      numberOfLines={1}
                    >
                      {c.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* Mode toggle */}
            <View style={s.modeToggle}>
              {(["flashcards", "guide"] as const).map(m => (
                <TouchableOpacity
                  key={m}
                  style={[s.modeBtn, mode === m && s.modeBtnActive]}
                  onPress={() => { setMode(m); setFlashcards([]); setGuide(""); }}
                  activeOpacity={0.7}
                >
                  <Text style={[s.modeText, mode === m && s.modeTextActive]}>
                    {m === "guide" ? "Study Guide" : "Flashcards"}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Toast */}
            {toast ? (
              <View style={s.toast}>
                {toastKind === "warn" && <AlertTriangle size={14} color="rgba(255,200,80,0.8)" />}
                {toastKind === "ok"   && <Check size={14} color="rgba(120,220,140,0.9)" />}
                <Text style={s.toastText}>{toast}</Text>
              </View>
            ) : null}

            {/* Action buttons */}
            <View style={s.actionRow}>
              <TouchableOpacity
                style={[s.ghostBtn, loading && { opacity: 0.5 }]}
                onPress={loadExisting}
                disabled={loading}
                activeOpacity={0.7}
              >
                {mode === "guide" ? (
                  <Text style={s.ghostText}>Read Guide</Text>
                ) : (
                  <View style={s.btnInner}>
                    <Text style={s.ghostText}>Study</Text>
                    <Sparkles size={14} color={C.textSecondary} />
                  </View>
                )}
              </TouchableOpacity>

              {/* AI generation — coming-soon affordance on mobile */}
              <TouchableOpacity
                style={[s.primaryBtn, { opacity: 0.55 }]}
                onPress={generate}
                disabled={loading}
                activeOpacity={0.7}
              >
                <View style={s.btnInner}>
                  <Text style={s.primaryText}>
                    {loading ? "Loading…" : mode === "guide" ? "Update Study Guide" : "Add New Flashcards"}
                  </Text>
                  {!loading && <Sparkles size={14} color={C.textPrimary} />}
                </View>
              </TouchableOpacity>
            </View>

            {loading && <ActivityIndicator color={C.textDim} style={{ marginBottom: 16 }} />}

            {/* Flashcard list */}
            {flashcards.length > 0 && (
              <>
                <View style={s.listHeader}>
                  <Text style={s.listCount}>
                    {flashcards.length} cards — tap any card to preview
                  </Text>
                  <TouchableOpacity style={s.studyNowBtn} onPress={() => startSession(flashcards)} activeOpacity={0.8}>
                    <Text style={s.studyNowText}>Study Now  →</Text>
                  </TouchableOpacity>
                </View>

                {/* SRS: review only what's due */}
                {dueCards.length > 0 && (
                  <TouchableOpacity style={s.reviewDueBtn} onPress={() => startSession(dueCards)} activeOpacity={0.8}>
                    <RotateCcw size={14} color={C.textPrimary} />
                    <Text style={s.reviewDueText}>
                      Review {dueCards.length} due
                    </Text>
                    <Text style={s.reviewDueSub}>spaced repetition</Text>
                  </TouchableOpacity>
                )}

                <View style={{ gap: 10 }}>
                  {flashcards.map(card => (
                    <View key={card.id} style={{ position: "relative" }}>
                      <FlipCard card={card} />
                      <TouchableOpacity
                        style={s.deleteBtn}
                        onPress={() => deleteCard(card.id)}
                        hitSlop={8}
                        activeOpacity={0.7}
                      >
                        <X size={12} color="rgba(255,100,100,0.75)" />
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              </>
            )}

            {/* Study guide */}
            {guide ? (
              <View style={s.guideCard}>
                <MarkdownGuide text={guide} />
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </ScreenWrapper>
  );
}

// ── styles ────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  h1: {
    fontFamily: "Inter_600SemiBold", fontSize: 26, color: C.textPrimary,
    marginBottom: 24, letterSpacing: -0.3,
  },

  // Course picker
  select: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
    borderRadius: RADIUS_BTN, paddingVertical: 12, paddingHorizontal: 14,
    marginBottom: 14, gap: 10,
  },
  selectText: { flex: 1, fontFamily: "Inter_400Regular", fontSize: 14, color: C.textPrimary },
  dropdown: {
    backgroundColor: "#1a1a1a", borderWidth: 1, borderColor: C.border,
    borderRadius: RADIUS_BTN, marginTop: -8, marginBottom: 14, overflow: "hidden",
  },
  dropdownItem: {
    paddingVertical: 12, paddingHorizontal: 14,
    borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.04)",
  },
  dropdownItemActive: { backgroundColor: C.surfaceHover },
  dropdownText: { fontFamily: "Inter_400Regular", fontSize: 14, color: C.textSecondary },

  // Mode toggle
  modeToggle: {
    flexDirection: "row", gap: 6, marginBottom: 20,
    backgroundColor: "rgba(255,255,255,0.04)", borderWidth: 1, borderColor: C.border,
    borderRadius: RADIUS_BTN, padding: 4,
  },
  modeBtn: {
    flex: 1, paddingVertical: 8, borderRadius: 9, alignItems: "center",
    borderWidth: 1, borderColor: "transparent",
  },
  modeBtnActive: { backgroundColor: C.surfaceHover, borderColor: C.borderStrong },
  modeText: { fontFamily: "Inter_400Regular", fontSize: 13, color: C.textSecondary },
  modeTextActive: { fontFamily: "Inter_600SemiBold", color: C.textPrimary },

  // Toast
  toast: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)", borderRadius: 12,
    paddingVertical: 12, paddingHorizontal: 16, marginBottom: 14,
  },
  toastText: { flex: 1, fontFamily: "Inter_400Regular", fontSize: 13, color: C.textSecondary },

  // Action buttons
  actionRow: { flexDirection: "row", gap: 8, marginBottom: 24 },
  btnInner:  { flexDirection: "row", alignItems: "center", gap: 6 },
  ghostBtn: {
    flex: 1, backgroundColor: "transparent", borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)", borderRadius: RADIUS_BTN,
    paddingVertical: 13, paddingHorizontal: 10, alignItems: "center", justifyContent: "center",
  },
  ghostText: {
    fontFamily: "Inter_500Medium", fontSize: 13, color: C.textSecondary, letterSpacing: 0.2,
  },
  primaryBtn: {
    flex: 2, backgroundColor: "rgba(255,255,255,0.10)", borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)", borderRadius: RADIUS_BTN,
    paddingVertical: 13, paddingHorizontal: 10, alignItems: "center", justifyContent: "center",
  },
  primaryText: {
    fontFamily: "Inter_600SemiBold", fontSize: 13, color: C.textPrimary, letterSpacing: 0.2,
  },

  // Flashcard list
  listHeader: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    marginBottom: 14,
  },
  listCount: { flex: 1, fontFamily: "Inter_400Regular", fontSize: 12, color: C.textDim },
  studyNowBtn: {
    backgroundColor: C.accent, borderRadius: RADIUS_BTN,
    paddingVertical: 9, paddingHorizontal: 18,
  },
  studyNowText: { fontFamily: "Inter_600SemiBold", fontSize: 13, color: "#111" },
  reviewDueBtn: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.borderStrong,
    borderRadius: RADIUS_BTN, paddingVertical: 12, paddingHorizontal: 16, marginBottom: 14,
  },
  reviewDueText: { fontFamily: "Inter_600SemiBold", fontSize: 13, color: C.textPrimary },
  reviewDueSub:  { fontFamily: "Inter_400Regular", fontSize: 11, color: C.textDim, marginLeft: "auto" },
  flipCard: {
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
    borderRadius: RADIUS_CARD, padding: 22, minHeight: 100, justifyContent: "center",
  },
  flipLabel: {
    fontFamily: "Inter_400Regular", fontSize: 10, color: C.textDim,
    letterSpacing: 1.5, marginBottom: 8,
  },
  flipText: { fontFamily: "Inter_400Regular", fontSize: 15, color: C.textPrimary, lineHeight: 24 },
  deleteBtn: {
    position: "absolute", top: 8, right: 8,
    backgroundColor: "rgba(255,60,60,0.12)", borderWidth: 1,
    borderColor: "rgba(255,60,60,0.22)", borderRadius: 6,
    paddingVertical: 3, paddingHorizontal: 7,
  },

  // Study guide card
  guideCard: {
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
    borderRadius: RADIUS_CARD, paddingVertical: 20, paddingHorizontal: 22,
  },

  // Empty state
  emptyCard: {
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
    borderRadius: RADIUS_CARD, padding: 24,
  },
  emptyTitle: { fontFamily: "Inter_400Regular", fontSize: 14, color: C.textSecondary, marginBottom: 4 },
  emptySub:   { fontFamily: "Inter_400Regular", fontSize: 12, color: C.textDim, lineHeight: 19 },

  // Markdown guide
  mdBold: { fontFamily: "Inter_600SemiBold", color: C.textPrimary },
  mdH3: {
    fontFamily: "Inter_700Bold", fontSize: 13, color: C.textPrimary, opacity: 0.6,
    letterSpacing: 1.5, marginTop: 20, marginBottom: 8,
  },
  mdH2: { fontFamily: "Inter_700Bold", fontSize: 15, color: C.textPrimary, marginTop: 22, marginBottom: 8 },
  mdH1: { fontFamily: "Inter_700Bold", fontSize: 17, color: C.textPrimary, marginTop: 24, marginBottom: 10 },
  mdBulletRow:  { flexDirection: "row", gap: 10, marginBottom: 6, alignItems: "flex-start" },
  mdBulletDot:  { fontFamily: "Inter_400Regular", fontSize: 13, color: C.textDim, marginTop: 1 },
  mdBulletText: { fontFamily: "Inter_400Regular", fontSize: 14, color: C.textSecondary, lineHeight: 24 },
  mdPara:       { fontFamily: "Inter_400Regular", fontSize: 14, color: C.textSecondary, lineHeight: 24, marginBottom: 6 },

  // ── Session ──
  sessTop: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingTop: 8,
  },
  sessExit:  { fontFamily: "Inter_400Regular", fontSize: 14, color: C.textSecondary },
  sessCount: { fontFamily: "Inter_400Regular", fontSize: 13, color: C.textDim, fontVariant: ["tabular-nums"] },
  progressTrack: {
    height: 2, backgroundColor: "rgba(255,255,255,0.06)", marginTop: 14, borderRadius: 2,
  },
  progressFill: { height: "100%", backgroundColor: "rgba(255,255,255,0.55)", borderRadius: 2 },
  hintRow: {
    flexDirection: "row", justifyContent: "space-between",
    paddingTop: 14, paddingHorizontal: 6,
  },
  hintItem:   { flexDirection: "row", alignItems: "center", gap: 3 },
  hintMissed: { fontFamily: "Inter_600SemiBold", fontSize: 12, color: "rgba(255,75,65,0.8)" },
  hintGot:    { fontFamily: "Inter_600SemiBold", fontSize: 12, color: "rgba(52,199,89,0.85)" },

  cardArea: { flex: 1, alignItems: "center", justifyContent: "center" },
  cardBox:  { width: "100%", aspectRatio: 100 / 68 },
  cardFace: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
    backfaceVisibility: "hidden", borderRadius: 22,
    justifyContent: "center", paddingVertical: 30, paddingHorizontal: 26,
    shadowColor: "#000", shadowOffset: { width: 0, height: 24 },
    shadowOpacity: 0.45, shadowRadius: 30, elevation: 12,
  },
  cardFront: {
    backgroundColor: "rgba(255,255,255,0.055)", borderWidth: 1,
    borderColor: "rgba(255,255,255,0.09)",
  },
  cardBack: {
    backgroundColor: "rgba(255,255,255,0.07)", borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  cardLabel: {
    fontFamily: "Inter_400Regular", fontSize: 10, color: "rgba(255,255,255,0.28)",
    letterSpacing: 2, marginBottom: 14,
  },
  cardQuestion: {
    fontFamily: "Inter_500Medium", fontSize: 18, color: C.textPrimary, lineHeight: 29,
  },
  cardAnswer: {
    fontFamily: "Inter_400Regular", fontSize: 17, color: C.textPrimary, lineHeight: 29,
  },
  cardHint: {
    fontFamily: "Inter_400Regular", fontSize: 12, color: "rgba(255,255,255,0.2)", marginTop: 22,
  },

  judgeRow: { flexDirection: "row", gap: 12, paddingBottom: 12, paddingTop: 8 },
  missedBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    backgroundColor: "rgba(255,59,48,0.1)", borderWidth: 1,
    borderColor: "rgba(255,59,48,0.22)", borderRadius: RADIUS_BTN, paddingVertical: 16,
  },
  missedText: { fontFamily: "Inter_600SemiBold", fontSize: 15, color: "rgba(255,85,75,0.9)" },
  gotBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    backgroundColor: "rgba(52,199,89,0.08)", borderWidth: 1,
    borderColor: "rgba(52,199,89,0.22)", borderRadius: RADIUS_BTN, paddingVertical: 16,
  },
  gotText: { fontFamily: "Inter_600SemiBold", fontSize: 15, color: "rgba(72,210,110,0.9)" },

  // Done screen
  doneWrap: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 8 },
  donePct: {
    fontFamily: "Inter_700Bold", fontSize: 60, color: C.textPrimary,
    letterSpacing: -2, marginBottom: 8,
  },
  doneSub: { fontFamily: "Inter_400Regular", fontSize: 15, color: C.textSecondary, marginBottom: 32 },
  doneDots: {
    flexDirection: "row", flexWrap: "wrap", gap: 6, justifyContent: "center", marginBottom: 40,
  },
  doneDot: { width: 10, height: 10, borderRadius: 5 },
  doneBtn: {
    width: "100%", backgroundColor: C.accent, borderRadius: RADIUS_BTN,
    paddingVertical: 14, alignItems: "center", marginBottom: 12,
  },
  doneBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 15, color: "#111" },
  retryBtn: {
    width: "100%", backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1,
    borderColor: C.border, borderRadius: RADIUS_BTN, paddingVertical: 14, alignItems: "center",
  },
  retryBtnText: { fontFamily: "Inter_400Regular", fontSize: 15, color: C.textPrimary },
});

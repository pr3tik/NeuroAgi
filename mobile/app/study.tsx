// study.tsx — mobile port of src/pages/Study.tsx.
// Course picker, Flashcards / Study Guide modes, saved-card list with flip
// previews, and a fullscreen-style flashcard session (flip + got-it/missed)
// that saves study time and writes SM-2 spaced-repetition reviews.
// AI generation (grounded in the course's own files) runs through
// services/generate.ts — the same pipeline Reggie chat triggers by intent.

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, ActivityIndicator,
} from "react-native";
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, Easing,
} from "react-native-reanimated";
import {
  Check, X, AlertTriangle, Sparkles, ChevronDown, RotateCcw, BookOpen,
} from "lucide-react-native";
import { useLocalSearchParams } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import ScreenWrapper from "../components/ScreenWrapper";
import Glass from "../components/Glass";
import { Skeleton, EmptyState, ErrorState, useRefresh, ThemedRefreshControl } from "../components/States";
import { usePageTheme, ThemeColors } from "../constants/appTheme";
import { supabase } from "../services/supabase";
import { generateFlashcards, generateStudyGuide } from "../services/generate";
import { useUserId } from "../context/AuthContext";

// Key for the last-studied context (course + mode), so Home's "Jump back in"
// and this screen both resume exactly where the user left off.
export const LAST_STUDY_KEY = "last_study_v1";

// AI generation (flashcards / study guide) lives in services/generate.ts so Reggie
// chat can trigger the same grounded pipeline — see generateFlashcards / generateStudyGuide.

const PAGE = "study";

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
async function saveSrsReview(userId: string, courseId: string | null, card: Card, next: SrsState) {
  try {
    await supabase.from("srs_reviews").upsert(
      {
        user_id:          userId,
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
  const userId = useUserId();
  const C = usePageTheme(PAGE);
  const s = useMemo(() => makeStyles(C), [C]);
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
          .from("users").select("study_time").eq("id", userId).maybeSingle();
        const prev = data?.study_time ?? 0;
        await supabase.from("users")
          .update({ study_time: prev + elapsedMinutes }).eq("id", userId);
      } catch { /* non-fatal */ }
    }
    exitCallback?.();
  }, [userId]);

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
    saveSrsReview(userId, courseId, card, next);

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
  }, [isDone, card, courseId, srsMap, onSrsUpdate, resetIdle, userId]); // eslint-disable-line react-hooks/exhaustive-deps

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
                <Text style={s.cardLabel}>Question</Text>
                <Text style={s.cardQuestion}>{card.question}</Text>
                <Text style={s.cardHint}>Tap to reveal</Text>
              </Animated.View>
              {/* Back — answer (pre-rotated 180°) */}
              <Animated.View style={[s.cardFace, s.cardBack, backStyle]}>
                <Text style={[s.cardLabel, { color: C.textDim }]}>Answer</Text>
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
  const C = usePageTheme(PAGE);
  const s = useMemo(() => makeStyles(C), [C]);
  const [flipped, setFlipped] = useState(false);
  return (
    <Glass colors={C} radius={RADIUS_CARD} onPress={() => setFlipped(f => !f)} style={s.flipCard}>
      <Text style={s.flipLabel}>{flipped ? "Answer" : "Question — tap to flip"}</Text>
      <Text style={s.flipText}>{flipped ? card.answer : card.question}</Text>
    </Glass>
  );
}

// ── Lightweight markdown renderer (headings, bold, bullets) ──────────────────
function renderInline(str: string, baseStyle: any, s: any) {
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
  const C = usePageTheme(PAGE);
  const s = useMemo(() => makeStyles(C), [C]);
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
          <View style={{ flex: 1 }}>{renderInline(trimmed.slice(2), s.mdBulletText, s)}</View>
        </View>
      );
    } else {
      elements.push(<View key={i}>{renderInline(trimmed, s.mdPara, s)}</View>);
    }
  });

  return <View>{elements}</View>;
}

// ── Main screen ───────────────────────────────────────────────────────────────
export default function StudyScreen() {
  const userId = useUserId();
  const C = usePageTheme(PAGE);
  const s = useMemo(() => makeStyles(C), [C]);
  // Mode is driven by the Learn tab's Flashcards / Study Guide chips, which open
  // this screen as /study?mode=flashcards|guide (see navigation/navConfig.ts).
  const { mode: modeParam, courseId: courseIdParam } = useLocalSearchParams<{ mode?: string; courseId?: string }>();
  const [courses, setCourses]         = useState<Course[]>([]);
  const [coursesLoaded, setCoursesLoaded] = useState(false);
  const [coursesError, setCoursesError] = useState(false);
  const [course, setCourse]           = useState<Course | null>(null);
  const [pickerOpen, setPickerOpen]   = useState(false);
  const [mode, setMode]               = useState<"flashcards" | "guide">(
    modeParam === "guide" ? "guide" : "flashcards",
  );

  // Keep mode in sync when the Learn chip changes the ?mode= param without
  // remounting. Clear any loaded content on the switch, mirroring what the old
  // in-screen toggle did.
  useEffect(() => {
    if (modeParam !== "guide" && modeParam !== "flashcards") return;
    setMode(prev => {
      if (prev !== modeParam) { setFlashcards([]); setGuide(""); }
      return modeParam;
    });
  }, [modeParam]);
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

  // Load live courses. Hoisted so pull-to-refresh re-runs the same fetch.
  const loadCourses = useCallback(async () => {
    setCoursesError(false);
    try {
      const { data, error } = await supabase
        .from("courses")
        .select("id, name, course_code")
        .eq("user_id", userId)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      const list: Course[] = (data ?? []).map((c: any) => ({
        dbId:       c.id,
        name:       c.name ?? "",
        courseCode: c.course_code ?? "",
        label:      `${c.course_code ?? ""} — ${c.name ?? ""}`,
      }));
      setCourses(list);

      // Resume where the user left off: reopen the last-studied course (and
      // mode, unless the caller passed an explicit ?mode=). Falls back to the
      // most-recently-updated course for a first-time visit.
      let initial = list[0] ?? null;
      try {
        const raw = await AsyncStorage.getItem(LAST_STUDY_KEY);
        if (raw) {
          const saved = JSON.parse(raw);
          const match = list.find(c => String(c.dbId) === String(saved.courseId));
          if (match) initial = match;
          if (!modeParam && (saved.mode === "guide" || saved.mode === "flashcards")) setMode(saved.mode);
        }
      } catch { /* no saved context — first run */ }
      // A deep-link from Reggie ("Review flashcards") names the exact course it
      // built for — open that one directly, overriding the last-studied resume.
      if (courseIdParam) {
        const deep = list.find(c => String(c.dbId) === String(courseIdParam));
        if (deep) initial = deep;
      }
      // Only seed the picker on first load; a refresh shouldn't yank the user
      // off a course they've since selected.
      setCourse(prev => prev ?? initial);
    } catch {
      setCoursesError(true);
    } finally {
      setCoursesLoaded(true);
    }
  }, [userId, modeParam, courseIdParam]);

  useEffect(() => { loadCourses(); }, [loadCourses]);

  // Persist the current course + mode so a later "Jump back in" resumes here.
  useEffect(() => {
    if (!course) return;
    AsyncStorage.setItem(LAST_STUDY_KEY, JSON.stringify({
      courseId: course.dbId, courseCode: course.courseCode, name: course.name, mode,
    })).catch(() => {});
  }, [course, mode]);

  // Load saved flashcards + SRS scheduling state for the selected course
  const loadExisting = useCallback(async () => {
    if (!course) return;
    setLoading(true);
    if (mode === "flashcards") {
      try {
        const [{ data: rows }, { data: srsRows }] = await Promise.all([
          supabase.from("flashcards_v2")
            .select("id, question, answer, created_at")
            .eq("user_id", userId)
            .eq("course_id", course.dbId)
            .order("created_at", { ascending: false }),
          supabase.from("srs_reviews")
            .select("card_key, ease, interval_days, reps, lapses, due_at")
            .eq("user_id", userId)
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
          .eq("user_id", userId)
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
  }, [course, mode, userId]);

  // Pull-to-refresh: refresh the course list, then re-pull the current course's
  // saved cards / guide so it reflects anything generated on another surface.
  const reload = useCallback(async () => {
    await loadCourses();
    if (course) await loadExisting();
  }, [loadCourses, loadExisting, course]);

  const { refreshing, onRefresh } = useRefresh(reload);

  // Arriving from Reggie with ?courseId= means "show me this course's deck now" —
  // auto-run the load once so the generated cards / guide are on screen with no tap.
  const didAutoLoad = useRef(false);
  useEffect(() => {
    if (!coursesLoaded || !courseIdParam || didAutoLoad.current) return;
    if (course && String(course.dbId) === String(courseIdParam)) {
      didAutoLoad.current = true;
      loadExisting();
    }
  }, [coursesLoaded, courseIdParam, course, loadExisting]);

  // Generate flashcards / a study guide with AI, grounded in the course's own
  // material (shared pipeline in services/generate.ts — Reggie chat uses the same).
  const generate = async () => {
    if (!course || loading) return;
    setLoading(true);
    try {
      if (mode === "guide") {
        const { text, saved } = await generateStudyGuide(userId, course);
        if (!text) { showToast("Couldn't generate a study guide — try again.", "warn"); return; }
        setGuide(text); setFlashcards([]);
        showToast(saved ? "Study guide ready." : "Generated, but couldn't save — check your connection.", saved ? "ok" : "warn");
      } else {
        const { cards, saved } = await generateFlashcards(userId, course, flashcards.map(c => c.question));
        if (!cards.length) { showToast("Couldn't generate cards — try again.", "warn"); return; }
        setFlashcards(prev => [...cards, ...prev]); setGuide("");
        showToast(
          saved ? `Added ${cards.length} flashcard${cards.length !== 1 ? "s" : ""}.` : "Generated, but couldn't save — check your connection.",
          saved ? "ok" : "warn",
        );
      }
    } catch {
      showToast("Generation failed — try again in a moment.", "warn");
    } finally {
      setLoading(false);
    }
  };

  const deleteCard = async (cardId: string) => {
    setFlashcards(prev => prev.filter(c => c.id !== cardId));
    try {
      await supabase.from("flashcards_v2")
        .delete().eq("id", cardId).eq("user_id", userId);
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

  // ── No courses yet, or the course fetch failed ───────────────────────────────
  if (coursesLoaded && courses.length === 0) {
    return (
      <ScreenWrapper page="study">
        <Text style={s.h1}>Study</Text>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ flexGrow: 1 }}
          refreshControl={<ThemedRefreshControl colors={C} refreshing={refreshing} onRefresh={onRefresh} />}
        >
          {coursesError ? (
            <ErrorState colors={C} onRetry={reload} message="We couldn't load your courses. Pull down to refresh or try again." />
          ) : (
            <EmptyState
              colors={C}
              Icon={BookOpen}
              title="No courses yet"
              message="Connect Canvas on the web app and your courses will show up here. Pull down to refresh."
            />
          )}
        </ScrollView>
      </ScreenWrapper>
    );
  }

  return (
    <ScreenWrapper page="study">
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 8 }}
        refreshControl={<ThemedRefreshControl colors={C} refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <Text style={s.h1}>Study</Text>

        {!coursesLoaded ? (
          <View style={{ gap: 12, marginTop: 4 }}>
            <Skeleton colors={C} height={44} radius={RADIUS_BTN} />
            <View style={{ flexDirection: "row", gap: 12 }}>
              <Skeleton colors={C} height={44} radius={RADIUS_BTN} style={{ flex: 1 }} />
              <Skeleton colors={C} height={44} radius={RADIUS_BTN} style={{ flex: 1 }} />
            </View>
            <Skeleton colors={C} height={116} radius={RADIUS_CARD} style={{ marginTop: 6 }} />
            <Skeleton colors={C} height={116} radius={RADIUS_CARD} />
          </View>
        ) : (
          <>
            {/* Course picker */}
            <Glass colors={C} radius={RADIUS_BTN} onPress={() => setPickerOpen(o => !o)} style={s.select}>
              <Text style={s.selectText} numberOfLines={1}>{course?.label ?? "Select a course"}</Text>
              <ChevronDown size={14} color={C.textDim} />
            </Glass>
            {pickerOpen && (
              <Glass colors={C} radius={RADIUS_BTN} style={s.dropdown}>
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
              </Glass>
            )}

            {/* Flashcards / Study Guide mode is chosen from the Learn tab's chip
                row (SubNav), so no in-screen toggle here anymore. */}

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

              {/* AI generation — grounded in the course's own files */}
              <TouchableOpacity
                style={[s.primaryBtn, loading && { opacity: 0.55 }]}
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
                  <Glass colors={C} radius={RADIUS_BTN} onPress={() => startSession(dueCards)} style={s.reviewDueBtn}>
                    <RotateCcw size={14} color={C.textPrimary} />
                    <Text style={s.reviewDueText}>
                      Review {dueCards.length} due
                    </Text>
                    <Text style={s.reviewDueSub}>spaced repetition</Text>
                  </Glass>
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
              <Glass colors={C} radius={RADIUS_CARD} style={s.guideCard}>
                <MarkdownGuide text={guide} />
              </Glass>
            ) : null}
          </>
        )}
      </ScrollView>
    </ScreenWrapper>
  );
}

// ── styles ────────────────────────────────────────────────────────────────────
const makeStyles = (C: ThemeColors) => StyleSheet.create({
  h1: {
    fontWeight: "600", fontSize: 26, color: C.textPrimary,
    marginBottom: 24, letterSpacing: -0.3,
  },

  // Course picker
  select: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    borderRadius: RADIUS_BTN, paddingVertical: 12, paddingHorizontal: 14,
    marginBottom: 14, gap: 10,
  },
  selectText: { flex: 1, fontWeight: "400", fontSize: 14, color: C.textPrimary },
  dropdown: {
    borderRadius: RADIUS_BTN, marginTop: -8, marginBottom: 14, overflow: "hidden",
  },
  dropdownItem: {
    paddingVertical: 12, paddingHorizontal: 14,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  dropdownItemActive: { backgroundColor: C.border },
  dropdownText: { fontWeight: "400", fontSize: 14, color: C.textSecondary },

  // Mode toggle
  modeToggle: {
    flexDirection: "row", gap: 6, marginBottom: 20,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
    borderRadius: RADIUS_BTN, padding: 4,
  },
  modeBtn: {
    flex: 1, paddingVertical: 8, borderRadius: 9, alignItems: "center",
    borderWidth: 1, borderColor: "transparent",
  },
  modeBtnActive: { backgroundColor: C.border, borderColor: C.borderStrong },
  modeText: { fontWeight: "400", fontSize: 13, color: C.textSecondary },
  modeTextActive: { fontWeight: "600", color: C.textPrimary },

  // Toast
  toast: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: C.surfaceTranslucent, borderWidth: 1,
    borderColor: C.border, borderRadius: 12,
    paddingVertical: 12, paddingHorizontal: 16, marginBottom: 14,
  },
  toastText: { flex: 1, fontWeight: "400", fontSize: 13, color: C.textSecondary },

  // Action buttons
  actionRow: { flexDirection: "row", gap: 8, marginBottom: 24 },
  btnInner:  { flexDirection: "row", alignItems: "center", gap: 6 },
  ghostBtn: {
    flex: 1, backgroundColor: "transparent", borderWidth: 1,
    borderColor: C.border, borderRadius: RADIUS_BTN,
    paddingVertical: 13, paddingHorizontal: 10, alignItems: "center", justifyContent: "center",
  },
  ghostText: {
    fontWeight: "500", fontSize: 13, color: C.textSecondary, letterSpacing: 0.2,
  },
  primaryBtn: {
    flex: 2, backgroundColor: C.surfaceTranslucent, borderWidth: 1,
    borderColor: C.borderStrong, borderRadius: RADIUS_BTN,
    paddingVertical: 13, paddingHorizontal: 10, alignItems: "center", justifyContent: "center",
  },
  primaryText: {
    fontWeight: "600", fontSize: 13, color: C.textPrimary, letterSpacing: 0.2,
  },

  // Flashcard list
  listHeader: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    marginBottom: 14,
  },
  listCount: { flex: 1, fontWeight: "400", fontSize: 12, color: C.textDim },
  studyNowBtn: {
    backgroundColor: C.scheme === "light" ? C.accent : "rgba(255,255,255,0.85)", borderRadius: RADIUS_BTN,
    paddingVertical: 9, paddingHorizontal: 18,
  },
  studyNowText: { fontWeight: "600", fontSize: 13, color: C.scheme === "light" ? "#10241A" : "#111" },
  reviewDueBtn: {
    flexDirection: "row", alignItems: "center", gap: 8,
    borderRadius: RADIUS_BTN, paddingVertical: 12, paddingHorizontal: 16, marginBottom: 14,
  },
  reviewDueText: { fontWeight: "600", fontSize: 13, color: C.textPrimary },
  reviewDueSub:  { fontWeight: "400", fontSize: 11, color: C.textDim, marginLeft: "auto" },
  flipCard: {
    borderRadius: RADIUS_CARD, padding: 22, minHeight: 100, justifyContent: "center",
  },
  flipLabel: {
    fontWeight: "400", fontSize: 10, color: C.textDim,
    letterSpacing: 0.2, marginBottom: 8,
  },
  flipText: { fontWeight: "400", fontSize: 15, color: C.textPrimary, lineHeight: 24 },
  deleteBtn: {
    position: "absolute", top: 8, right: 8,
    backgroundColor: "rgba(255,60,60,0.12)", borderWidth: 1,
    borderColor: "rgba(255,60,60,0.22)", borderRadius: 6,
    paddingVertical: 3, paddingHorizontal: 7,
  },

  // Study guide card
  guideCard: {
    borderRadius: RADIUS_CARD, paddingVertical: 20, paddingHorizontal: 22,
  },

  // Empty state
  emptyCard: {
    borderRadius: RADIUS_CARD, padding: 24,
  },
  emptyTitle: { fontWeight: "400", fontSize: 14, color: C.textSecondary, marginBottom: 4 },
  emptySub:   { fontWeight: "400", fontSize: 12, color: C.textDim, lineHeight: 19 },

  // Markdown guide
  mdBold: { fontWeight: "600", color: C.textPrimary },
  mdH3: {
    fontWeight: "700", fontSize: 13, color: C.textPrimary, opacity: 0.6,
    letterSpacing: 0.2, marginTop: 20, marginBottom: 8,
  },
  mdH2: { fontWeight: "700", fontSize: 15, color: C.textPrimary, marginTop: 22, marginBottom: 8 },
  mdH1: { fontWeight: "700", fontSize: 17, color: C.textPrimary, marginTop: 24, marginBottom: 10 },
  mdBulletRow:  { flexDirection: "row", gap: 10, marginBottom: 6, alignItems: "flex-start" },
  mdBulletDot:  { fontWeight: "400", fontSize: 13, color: C.textDim, marginTop: 1 },
  mdBulletText: { fontWeight: "400", fontSize: 14, color: C.textSecondary, lineHeight: 24 },
  mdPara:       { fontWeight: "400", fontSize: 14, color: C.textSecondary, lineHeight: 24, marginBottom: 6 },

  // ── Session ──
  sessTop: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingTop: 8,
  },
  sessExit:  { fontWeight: "400", fontSize: 14, color: C.textSecondary },
  sessCount: { fontWeight: "400", fontSize: 13, color: C.textDim, fontVariant: ["tabular-nums"] },
  progressTrack: {
    height: 2, backgroundColor: C.surfaceTranslucent, marginTop: 14, borderRadius: 2,
  },
  progressFill: { height: "100%", backgroundColor: C.scheme === "light" ? C.accent : "rgba(255,255,255,0.55)", borderRadius: 2 },
  hintRow: {
    flexDirection: "row", justifyContent: "space-between",
    paddingTop: 14, paddingHorizontal: 6,
  },
  hintItem:   { flexDirection: "row", alignItems: "center", gap: 3 },
  hintMissed: { fontWeight: "600", fontSize: 12, color: "rgba(255,75,65,0.8)" },
  hintGot:    { fontWeight: "600", fontSize: 12, color: "rgba(52,199,89,0.85)" },

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
    backgroundColor: C.surfaceTranslucent, borderWidth: 1,
    borderColor: C.border,
  },
  cardBack: {
    backgroundColor: C.surfaceTranslucent, borderWidth: 1,
    borderColor: C.border,
  },
  cardLabel: {
    fontWeight: "400", fontSize: 10, color: C.textTertiary,
    letterSpacing: 0.2, marginBottom: 14,
  },
  cardQuestion: {
    fontWeight: "500", fontSize: 18, color: C.textPrimary, lineHeight: 29,
  },
  cardAnswer: {
    fontWeight: "400", fontSize: 17, color: C.textPrimary, lineHeight: 29,
  },
  cardHint: {
    fontWeight: "400", fontSize: 12, color: C.textTertiary, marginTop: 22,
  },

  judgeRow: { flexDirection: "row", gap: 12, paddingBottom: 12, paddingTop: 8 },
  missedBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    backgroundColor: "rgba(255,59,48,0.1)", borderWidth: 1,
    borderColor: "rgba(255,59,48,0.22)", borderRadius: RADIUS_BTN, paddingVertical: 16,
  },
  missedText: { fontWeight: "600", fontSize: 15, color: "rgba(255,85,75,0.9)" },
  gotBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    backgroundColor: "rgba(52,199,89,0.08)", borderWidth: 1,
    borderColor: "rgba(52,199,89,0.22)", borderRadius: RADIUS_BTN, paddingVertical: 16,
  },
  gotText: { fontWeight: "600", fontSize: 15, color: "rgba(72,210,110,0.9)" },

  // Done screen
  doneWrap: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 8 },
  donePct: {
    fontWeight: "700", fontSize: 60, color: C.textPrimary,
    letterSpacing: -2, marginBottom: 8,
  },
  doneSub: { fontWeight: "400", fontSize: 15, color: C.textSecondary, marginBottom: 32 },
  doneDots: {
    flexDirection: "row", flexWrap: "wrap", gap: 6, justifyContent: "center", marginBottom: 40,
  },
  doneDot: { width: 10, height: 10, borderRadius: 5 },
  doneBtn: {
    width: "100%", backgroundColor: C.scheme === "light" ? C.accent : "rgba(255,255,255,0.85)", borderRadius: RADIUS_BTN,
    paddingVertical: 14, alignItems: "center", marginBottom: 12,
  },
  doneBtnText: { fontWeight: "600", fontSize: 15, color: C.scheme === "light" ? "#10241A" : "#111" },
  retryBtn: {
    width: "100%", backgroundColor: C.surfaceTranslucent, borderWidth: 1,
    borderColor: C.border, borderRadius: RADIUS_BTN, paddingVertical: 14, alignItems: "center",
  },
  retryBtnText: { fontWeight: "400", fontSize: 15, color: C.textPrimary },
});

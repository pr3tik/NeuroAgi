// tutor.tsx — Reggie, always one tap away. A standalone 1:1 chat with the AI
// tutor, reachable from the Home "Reggie" hero. Proactive by design: Reggie
// greets first and offers concrete next steps rather than waiting to be asked.
//
// Reuses tutorReply() (the same /api/groq path the in-room "Ask Reggie" uses).
// The thread persists to AsyncStorage so the conversation survives navigation.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  View, Text, ScrollView, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ArrowLeft, Send, Trash2, Layers, BookOpen, ChevronRight } from "lucide-react-native";
import AmbientBackground from "../components/AmbientBackground";
import NeuralRing from "../components/NeuralRing";
import { isLightBg } from "../components/Glass";
import { useTheme, ThemeColors } from "../constants/appTheme";
import { tutorReply, Msg } from "../components/RoomSession";
import { supabase } from "../services/supabase";
import { useUserId } from "../context/AuthContext";
import { generateFlashcards, generateStudyGuide, GenCourse } from "../services/generate";
import { LAST_STUDY_KEY } from "./study";

const THREAD_KEY = "reggie_thread_v1";
const GREETING =
  "Hey — I'm Reggie 👋  What are you working on right now? I can explain a concept, " +
  "walk you through a problem step by step, or — just ask — build you flashcards or a " +
  "study guide straight from your own course files. Where should we start?";

// A reggie turn can carry one follow-up action (e.g. open the deck it just made).
// Kept serializable (a route, not a closure) so it survives the AsyncStorage thread.
type TurnAction = { label: string; route: string; kind: "flashcards" | "guide" };
type Turn = { id: string; role: "user" | "reggie"; body: string; action?: TurnAction };
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

// ── Generation intent ─────────────────────────────────────────────────────────
// Reggie shouldn't make the student hunt for a "generate" button — if a message
// clearly asks for flashcards / a quiz / a study guide, kick off the same grounded
// pipeline Study uses (services/generate.ts) right from the chat.
type GenIntent = { kind: "flashcards" | "guide" };

function detectGenIntent(text: string): GenIntent | null {
  const t = text.toLowerCase();
  if (/\b(study|revision|exam)\s*guide\b/.test(t) ||
      /\b(make|create|write|build|generate|prep(?:are)?|give me)\b[\s\S]*\bguide\b/.test(t)) {
    return { kind: "guide" };
  }
  if (/\b(flash\s?cards?|quiz me|test me|practice questions)\b/.test(t) ||
      /\b(make|create|generate|build|give me)\b[\s\S]*\bcards?\b/.test(t) ||
      /\bquiz me\b/.test(t)) {
    return { kind: "flashcards" };
  }
  return null;
}

// Which course to build for: an explicit mention wins, else the last-studied one,
// else the most-recently-updated course. Null only when the student has no courses.
function resolveCourse(text: string, courses: GenCourse[], lastCourseId: any): GenCourse | null {
  if (!courses.length) return null;
  const t = text.toLowerCase();
  const mentioned = courses.find(c =>
    (c.courseCode && t.includes(c.courseCode.toLowerCase())) ||
    (c.name && c.name.trim().length > 3 && t.includes(c.name.toLowerCase())),
  );
  if (mentioned) return mentioned;
  if (lastCourseId != null) {
    const last = courses.find(c => String(c.dbId) === String(lastCourseId));
    if (last) return last;
  }
  return courses[0]; // courses are loaded ordered by updated_at desc
}

export default function TutorScreen() {
  const router = useRouter();
  const userId = useUserId();
  const C = useTheme().colors;                       // full standalone screen → follows the chosen mode
  const styles = useMemo(() => makeStyles(C), [C]);
  const ringColor = isLightBg(C) ? "50,70,105" : "255,255,255";
  const { q } = useLocalSearchParams<{ q?: string }>();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const [thinking, setThinking] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [courses, setCourses] = useState<GenCourse[]>([]);
  const [lastCourseId, setLastCourseId] = useState<any>(null);
  const scrollRef = useRef<ScrollView>(null);
  const sentInitial = useRef(false);

  // Load the student's courses (+ last-studied one) so Reggie can figure out which
  // course to build for when a message asks for flashcards / a study guide.
  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase
          .from("courses").select("id, name, course_code")
          .eq("user_id", userId).order("updated_at", { ascending: false });
        setCourses((data ?? []).map((c: any) => ({ dbId: c.id, name: c.name ?? "", courseCode: c.course_code ?? "" })));
      } catch { /* generation just falls back to a "no courses" reply */ }
      try {
        const raw = await AsyncStorage.getItem(LAST_STUDY_KEY);
        if (raw) setLastCourseId(JSON.parse(raw)?.courseId ?? null);
      } catch { /* no saved course context */ }
    })();
  }, [userId]);

  // Hydrate the saved thread; if there's nothing (and no incoming question),
  // open with Reggie's proactive greeting so the screen is never empty.
  useEffect(() => {
    (async () => {
      let saved: Turn[] = [];
      try { const raw = await AsyncStorage.getItem(THREAD_KEY); if (raw) saved = JSON.parse(raw); } catch {}
      if (!saved.length && !q) saved = [{ id: uid(), role: "reggie", body: GREETING }];
      setTurns(saved);
      setHydrated(true);
    })();
  }, []);

  // Persist (cap the stored history).
  useEffect(() => {
    if (hydrated) AsyncStorage.setItem(THREAD_KEY, JSON.stringify(turns.slice(-60))).catch(() => {});
  }, [turns, hydrated]);

  // Auto-send a question handed in from the Home hero.
  useEffect(() => {
    if (hydrated && q && !sentInitial.current) { sentInitial.current = true; send(String(q)); }
  }, [hydrated, q]);

  useEffect(() => {
    const t = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 60);
    return () => clearTimeout(t);
  }, [turns.length, thinking]);

  const addReggie = (body: string, action?: TurnAction) =>
    setTurns(prev => [...prev, { id: uid(), role: "reggie", body, action }]);

  async function send(raw?: string) {
    const body = (raw ?? text).trim();
    if (!body || thinking) return;
    if (!raw) setText("");
    const recent: Msg[] = turns.slice(-8).map(t => ({
      id: t.id, user_id: t.role, name: t.role === "reggie" ? "Reggie" : "You",
      body: t.body, created_at: "", tutor: t.role === "reggie",
    }));
    setTurns(prev => [...prev, { id: uid(), role: "user", body }]);

    // Proactive: if they asked for an artifact, build it instead of just talking.
    const intent = detectGenIntent(body);
    if (intent) { await runGeneration(intent, body); return; }

    setThinking(true);
    const reply = await tutorReply(body, recent, null);
    setThinking(false);
    addReggie(reply);
  }

  // Build flashcards / a study guide from the student's own material and hand back
  // a one-tap way into Study to use them.
  async function runGeneration(intent: GenIntent, body: string) {
    setThinking(true);
    try {
      const course = resolveCourse(body, courses, lastCourseId);
      if (!course) {
        addReggie("I'd love to build that for you — but I don't see any courses yet. Connect Canvas on the web app (or add a course), then ask me again and I'll ground it in your own materials.");
        return;
      }
      const label = course.courseCode || course.name || "your course";

      if (intent.kind === "guide") {
        const { text: guide, saved } = await generateStudyGuide(userId, course);
        if (!guide) { addReggie("I couldn't put that study guide together just now — give it another try in a moment."); return; }
        addReggie(
          `Done — I wrote you an exam-ready study guide for ${label}, grounded in your course files.${saved ? "" : " (Heads up: I couldn't save it, so it might not stick.)"}`,
          { label: "Open study guide", route: `/study?mode=guide&courseId=${course.dbId}`, kind: "guide" },
        );
      } else {
        const { cards, saved } = await generateFlashcards(userId, course);
        if (!cards.length) { addReggie("I couldn't generate cards just now — try again in a moment."); return; }
        addReggie(
          `Made you ${cards.length} flashcard${cards.length !== 1 ? "s" : ""} for ${label}, based on your own material.${saved ? " They're saved to your deck." : " (I couldn't save them, though.)"} Want to run through them?`,
          { label: "Review flashcards", route: `/study?mode=flashcards&courseId=${course.dbId}`, kind: "flashcards" },
        );
      }
    } catch {
      addReggie("Something went wrong while I was building that. Try again in a moment.");
    } finally {
      setThinking(false);
    }
  }

  function clearThread() {
    setTurns([{ id: uid(), role: "reggie", body: GREETING }]);
  }

  const canSend = !!text.trim();

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <AmbientBackground colors={C} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.replace("/work")} style={styles.headerBtn} hitSlop={8}>
          <ArrowLeft size={20} color={C.textSecondary} strokeWidth={2} />
        </TouchableOpacity>
        <View style={styles.headerTitle}>
          <NeuralRing size={30} color={ringColor} />
          <Text style={styles.headerName}>Reggie</Text>
        </View>
        <TouchableOpacity onPress={clearThread} style={styles.headerBtn} hitSlop={8}>
          <Trash2 size={17} color={C.textDim} strokeWidth={2} />
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }} keyboardVerticalOffset={8}>
        <ScrollView ref={scrollRef} style={{ flex: 1 }} contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          {turns.map(t => {
            const reggie = t.role === "reggie";
            return (
              <View key={t.id} style={[styles.wrap, { alignItems: reggie ? "flex-start" : "flex-end" }]}>
                {reggie && (
                  <View style={styles.reggieHead}>
                    <Text style={styles.reggieName}>Reggie</Text>
                  </View>
                )}
                <View style={[styles.bubble, reggie ? styles.bubbleReggie : styles.bubbleMine]}>
                  <Text style={styles.body}>{t.body}</Text>
                </View>
                {reggie && t.action && (
                  <TouchableOpacity
                    style={styles.actionPill}
                    onPress={() => router.push(t.action!.route as any)}
                    activeOpacity={0.85}
                  >
                    {t.action.kind === "guide"
                      ? <BookOpen size={15} color={C.accent} strokeWidth={2} />
                      : <Layers size={15} color={C.accent} strokeWidth={2} />}
                    <Text style={styles.actionPillText}>{t.action.label}</Text>
                    <ChevronRight size={15} color={C.accent} strokeWidth={2} />
                  </TouchableOpacity>
                )}
              </View>
            );
          })}
          {thinking && (
            <View style={[styles.wrap, { alignItems: "flex-start" }]}>
              <View style={styles.reggieHead}>
                <Text style={styles.reggieName}>Reggie</Text>
              </View>
              <View style={[styles.bubble, styles.bubbleReggie]}>
                <ActivityIndicator size="small" color={C.textDim} />
              </View>
            </View>
          )}
        </ScrollView>

        <View style={styles.inputRow}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Ask Reggie anything…"
            placeholderTextColor={C.textDim}
            style={styles.input}
            multiline
          />
          <TouchableOpacity onPress={() => send()} disabled={!canSend || thinking} style={[styles.send, (!canSend || thinking) && { opacity: 0.5 }]} hitSlop={6}>
            <Send size={17} color={C.bg} strokeWidth={2.2} />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const makeStyles = (C: ThemeColors) => StyleSheet.create({
  safe:        { flex: 1, backgroundColor: C.bg },
  header:      { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12 },
  headerBtn:   { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  headerTitle: { flexDirection: "row", alignItems: "center", gap: 8 },
  headerGlyph: { width: 26, height: 26, borderRadius: 8, backgroundColor: C.accentSoft, alignItems: "center", justifyContent: "center" },
  headerName:  { fontWeight: "700", fontSize: 18, color: C.textPrimary, letterSpacing: -0.3 },

  scroll:      { paddingHorizontal: 16, paddingVertical: 10, gap: 12, flexGrow: 1 },
  wrap:        { width: "100%" },
  reggieHead:  { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 4, marginLeft: 4 },
  reggieName:  { fontWeight: "700", fontSize: 11, color: C.accent, letterSpacing: 0.2 },
  bubble:      { maxWidth: "86%", borderRadius: 18, paddingVertical: 11, paddingHorizontal: 15, borderWidth: 1 },
  bubbleReggie:{ backgroundColor: C.accentSoft, borderColor: C.accentLine, borderBottomLeftRadius: 6 },
  bubbleMine:  { backgroundColor: C.surface, borderColor: C.border, borderBottomRightRadius: 6 },
  body:        { fontWeight: "400", fontSize: 15, lineHeight: 22, color: C.textPrimary },

  // Follow-up action under a Reggie message (e.g. open the deck it just built)
  actionPill:     { flexDirection: "row", alignItems: "center", gap: 7, alignSelf: "flex-start", marginTop: 8, marginLeft: 4, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: C.accentLine, backgroundColor: C.accentSoft },
  actionPillText: { fontWeight: "600", fontSize: 13, color: C.accent, letterSpacing: -0.1 },

  inputRow:    { flexDirection: "row", alignItems: "flex-end", gap: 8, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 10 },
  input:       { flex: 1, minHeight: 46, maxHeight: 130, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 23, paddingHorizontal: 18, paddingTop: 13, paddingBottom: 13, fontSize: 15, color: C.textPrimary },
  send:        { width: 46, height: 46, borderRadius: 23, backgroundColor: C.accent, alignItems: "center", justifyContent: "center" },
});

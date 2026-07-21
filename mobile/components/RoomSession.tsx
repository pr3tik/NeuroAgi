// RoomSession.tsx — the in-room study experience for mobile Study Rooms (MVP).
//
// A room you can actually be IN and study in. Everything here talks the SAME
// contract the web app uses, so a mobile student and a web student in one room
// see each other live:
//   • Chat / "transcript" — real. Loads history via the list_room_messages RPC,
//     posts via post_room_message, and broadcasts on channel "room:{id}" with
//     event "chat_message" (mirrors src/api/chat.ts + StudyRooms.tsx).
//   • Ask your tutor — a lightweight reply via the existing /api/groq endpoint,
//     seeded with the room's course + recent transcript. Shown locally in the
//     thread (the full room-ai "Reggie" session engine is Phase 2).
//   • Focus timer — displays/controls the shared Pomodoro (study_rooms.pomodoro_state
//     + "pomodoro" broadcast), matching the web's payload shape.
//   • Board — view-only: the latest whiteboard snapshot's text digest if the
//     client can read it; otherwise an honest "runs on web" placeholder.

import { useEffect, useRef, useState, useCallback } from "react";
import {
  View, Text, ScrollView, TextInput, TouchableOpacity, StyleSheet,
  Image, KeyboardAvoidingView, Platform, ActivityIndicator,
} from "react-native";
import { Send, Sparkles, Play, Pause, RotateCcw, Pen, BookOpen, ChevronRight } from "lucide-react-native";
import { supabase } from "../services/supabase";
import { apiFetch } from "../services/api";
import { ThemeColors } from "../constants/appTheme";

// ── Message model (mirrors src/api/chat.ts ChatMessage) ───────────────────────
export type Msg = {
  id: string;
  room_id?: string;
  user_id: string;
  name: string;
  body: string;
  created_at: string;
  tutor?: boolean;        // local-only tutor reply (never broadcast)
};

const TUTOR_ID = "__tutor__";

// ── RPC wrappers (mirror src/api/chat.ts — mobile can't import from src/) ──────
async function loadRecentMessages(userId: string, roomId: string, limit = 100): Promise<Msg[]> {
  const { data, error } = await supabase.rpc("list_room_messages", {
    p_user: userId, p_room: roomId, p_limit: limit,
  });
  if (error) throw error;
  return (data ?? []) as Msg[];
}
async function postRoomMessage(userId: string, roomId: string, name: string, body: string): Promise<Msg> {
  const { data, error } = await supabase.rpc("post_room_message", {
    p_user: userId, p_room: roomId, p_name: name, p_body: body,
  });
  if (error) throw error;
  return data as Msg;
}

// ── Tutor reply via the existing /api/groq (same endpoint the app already uses) ─
export async function tutorReply(question: string, recent: Msg[], courseLabel: string | null): Promise<string> {
  const ctx = recent.slice(-8).map(m => `${m.tutor ? "Reggie" : m.name}: ${m.body}`).join("\n");
  const system =
    `You are Reggie, the student's study tutor, inside a focused study room` +
    (courseLabel ? ` for ${courseLabel}` : "") +
    `. Be concise, warm, and Socratic — nudge them toward the answer rather than dumping it. Keep replies to 1–4 sentences.`;
  const content = (ctx ? `Recent room chat:\n${ctx}\n\n` : "") + `Question: ${question}`;
  try {
    const d = await apiFetch("/api/groq", { messages: [{ role: "user", content }], system, max_tokens: 400 });
    return (d?.content ?? "").trim() || "I'm here — could you rephrase that?";
  } catch {
    return "I couldn't reach the tutor just now. Try again in a moment.";
  }
}

// ── Pomodoro (mirrors the web study_rooms.pomodoro_state contract) ─────────────
export type Pomo = {
  phase: "focus" | "break" | "idle";
  paused: boolean;
  startedAt: number | null;
  durationSec: number;
  pausedRemaining: number | null;
};
const DEFAULT_SPRINT = 25 * 60;
function remainingSec(p: Pomo | null, now: number): number {
  if (!p || p.phase === "idle" || !p.startedAt) return p?.durationSec ?? DEFAULT_SPRINT;
  if (p.paused) return p.pausedRemaining ?? p.durationSec;
  return Math.max(0, p.durationSec - Math.floor((now - p.startedAt) / 1000));
}
function fmt(sec: number): string {
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

// ── useRoomChannel — one "room:{id}" channel: presence + chat + pomodoro ───────
export function useRoomChannel(roomId: string, userId: string, userName: string) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [pomo, setPomo] = useState<Pomo | null>(null);
  const chRef = useRef<any>(null);
  const msgsRef = useRef<Msg[]>([]);
  useEffect(() => { msgsRef.current = messages; }, [messages]);

  useEffect(() => {
    let cancelled = false;

    // Persisted history + shared pomodoro, then live subscription.
    (async () => {
      try {
        const hist = await loadRecentMessages(userId, roomId);
        if (!cancelled && hist.length) setMessages(hist);
      } catch { /* RLS / network — start from an empty thread */ }
      try {
        const { data } = await supabase.from("study_rooms").select("pomodoro_state").eq("id", roomId).maybeSingle();
        if (!cancelled && data?.pomodoro_state) setPomo(data.pomodoro_state as Pomo);
      } catch { /* timer is optional */ }
    })();

    const ch = supabase.channel("room:" + roomId, {
      config: { presence: { key: userId }, broadcast: { self: false } },
    });
    ch.on("broadcast", { event: "chat_message" }, ({ payload }: any) => {
      setMessages(prev => prev.some(m => m.id === payload.id) ? prev : [...prev, payload as Msg]);
    });
    ch.on("broadcast", { event: "pomodoro" }, ({ payload }: any) => setPomo(payload as Pomo));
    ch.subscribe(async (status: string) => {
      if (status === "SUBSCRIBED") { try { await ch.track({ userId, name: userName, joinedAt: Date.now() }); } catch {} }
    });
    chRef.current = ch;

    return () => { cancelled = true; try { supabase.removeChannel(ch); } catch {} chRef.current = null; };
  }, [roomId, userId, userName]);

  const sendChat = useCallback(async (body: string) => {
    const text = body.trim();
    if (!text) return;
    const msg = await postRoomMessage(userId, roomId, userName || "Anonymous", text);
    setMessages(prev => prev.some(m => m.id === msg.id) ? prev : [...prev, msg]);
    chRef.current?.send({ type: "broadcast", event: "chat_message", payload: msg }).catch(() => {});
  }, [roomId, userId, userName]);

  // Ask the tutor: echo the question locally, then append the reply. Neither is
  // broadcast — it's the student's own tutor thread woven into the transcript.
  const askTutor = useCallback(async (question: string, courseLabel: string | null) => {
    const q = question.trim();
    if (!q) return;
    const iso = new Date().toISOString();
    setMessages(prev => [...prev, { id: `me-${uid()}`, user_id: userId, name: "You", body: q, created_at: iso }]);
    const reply = await tutorReply(q, msgsRef.current, courseLabel);
    setMessages(prev => [...prev, { id: `reggie-${uid()}`, user_id: TUTOR_ID, name: "Reggie", body: reply, created_at: new Date().toISOString(), tutor: true }]);
  }, [userId]);

  const setPomodoro = useCallback((next: Pomo) => {
    setPomo(next);
    chRef.current?.send({ type: "broadcast", event: "pomodoro", payload: next }).catch(() => {});
    // Best-effort persist so late joiners (and the web) see the same clock.
    supabase.from("study_rooms").update({ pomodoro_state: next }).eq("id", roomId).then(() => {}, () => {});
  }, [roomId]);

  return { messages, sendChat, askTutor, pomo, setPomodoro };
}

// ── FocusSprint — the shared focus timer as a full card (mirrors the web's
//    FocusSprintPanel): a big centred countdown, gold when running, with duration
//    pills to pick a length before starting. State is the same shared Pomo. ─────
const SPRINT_LENGTHS = [15, 25, 45, 60];

export function FocusSprint({ pomo, onChange, C }: { pomo: Pomo | null; onChange: (p: Pomo) => void; C: ThemeColors }) {
  const st = makeStyles(C);
  const [now, setNow] = useState(Date.now());
  const [pickMin, setPickMin] = useState(Math.round((pomo?.durationSec ?? DEFAULT_SPRINT) / 60));
  const running = !!pomo && pomo.phase !== "idle" && !pomo.paused && !!pomo.startedAt;
  const active = !!pomo && pomo.phase !== "idle";
  const paused = !!pomo?.paused && active;
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);
  const rem = remainingSec(pomo, now);

  const startNew = () => onChange({ phase: "focus", paused: false, startedAt: Date.now(), durationSec: pickMin * 60, pausedRemaining: null });
  const resume = () => {
    if (!pomo) return;
    const remaining = pomo.pausedRemaining ?? pomo.durationSec;
    onChange({ ...pomo, paused: false, startedAt: Date.now() - (pomo.durationSec - remaining) * 1000, pausedRemaining: null });
  };
  const pause = () => { if (pomo) onChange({ ...pomo, paused: true, pausedRemaining: rem }); };
  const end = () => onChange({ phase: "idle", paused: false, startedAt: null, durationSec: pickMin * 60, pausedRemaining: null });

  const timeColor = paused ? C.gold : running ? C.gold : C.textSecondary;

  return (
    <View style={[st.sprintCard, active && st.sprintCardActive]}>
      <View style={st.sprintHead}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <BookOpen size={15} color={active ? C.gold : C.textSecondary} strokeWidth={2} />
          <Text style={[st.sprintTitle, active && { color: C.gold }]}>Focus sprint</Text>
        </View>
        <Text style={st.sprintHint}>{active ? (paused ? "Paused" : "In progress — focus up") : "Choose a length"}</Text>
      </View>

      <Text style={[st.sprintTime, { color: timeColor, opacity: paused ? 0.55 : 1 }]}>{fmt(rem)}</Text>

      {!active ? (
        <>
          <View style={st.sprintPills}>
            {SPRINT_LENGTHS.map(m => {
              const on = pickMin === m;
              return (
                <TouchableOpacity key={m} onPress={() => setPickMin(m)} style={[st.sprintPill, on && st.sprintPillOn]} activeOpacity={0.8}>
                  <Text style={[st.sprintPillText, on && st.sprintPillTextOn]}>{m}m</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <TouchableOpacity onPress={startNew} style={st.sprintStart} activeOpacity={0.85}>
            <Text style={st.sprintStartText}>Start sprint</Text>
            <ChevronRight size={16} color={C.bg} strokeWidth={2.6} />
          </TouchableOpacity>
        </>
      ) : (
        <View style={st.sprintCtrls}>
          {paused ? (
            <TouchableOpacity onPress={resume} style={[st.sprintCtrl, st.sprintCtrlPrimary]} activeOpacity={0.85}>
              <Play size={13} color={C.bg} fill={C.bg} />
              <Text style={[st.sprintCtrlText, { color: "#231A07" }]}>Resume</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity onPress={pause} style={st.sprintCtrl} activeOpacity={0.85}>
              <Pause size={13} color={C.textPrimary} fill={C.textPrimary} />
              <Text style={st.sprintCtrlText}>Pause</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={end} style={st.sprintCtrl} activeOpacity={0.85}>
            <RotateCcw size={13} color={C.textSecondary} />
            <Text style={[st.sprintCtrlText, { color: C.textSecondary }]}>End</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

// ── Chat bubble ───────────────────────────────────────────────────────────────
function Bubble({ m, mine, C, st }: { m: Msg; mine: boolean; C: ThemeColors; st: any }) {
  const isImg = m.body.startsWith("[img]");
  const url = isImg ? m.body.slice(5) : null;

  if (m.tutor) {
    return (
      <View style={[st.bubbleWrap, { alignItems: "flex-start" }]}>
        <View style={[st.bubble, st.bubbleTutor]}>
          <View style={st.tutorHead}><Text style={st.tutorName}>Reggie</Text></View>
          <Text style={st.bubbleBody}>{m.body}</Text>
        </View>
      </View>
    );
  }
  return (
    <View style={[st.bubbleWrap, { alignItems: mine ? "flex-end" : "flex-start" }]}>
      {!mine && <Text style={st.bubbleName} numberOfLines={1}>{m.name}</Text>}
      <View style={[st.bubble, mine ? st.bubbleMine : st.bubbleOther]}>
        {url
          ? <Image source={{ uri: url }} style={st.bubbleImg} resizeMode="cover" />
          : <Text style={st.bubbleBody}>{m.body}</Text>}
      </View>
    </View>
  );
}

// ── RoomChat — transcript + input, with a distinct "ask the tutor" action.
//    `solo` (you're the only one in the room) turns the whole thread into a Reggie
//    chat: every message you send goes to the tutor, so a private focus room reads
//    like a 1:1 with Reggie rather than talking to an empty room. ────────────────
export function RoomChat({ messages, userId, onSendRoom, onAskTutor, solo, C }: {
  messages: Msg[]; userId: string;
  onSendRoom: (body: string) => Promise<void>;
  onAskTutor: (body: string) => Promise<void>;
  solo?: boolean;
  C: ThemeColors;
}) {
  const st = makeStyles(C);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [thinking, setThinking] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    const t = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 60);
    return () => clearTimeout(t);
  }, [messages.length, thinking]);

  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setText(""); setSending(true);
    try { await onSendRoom(body); } catch { setText(body); } finally { setSending(false); }
  };
  const ask = async () => {
    const body = text.trim();
    if (!body || thinking) return;
    setText(""); setThinking(true);
    try { await onAskTutor(body); } finally { setThinking(false); }
  };
  const canSend = !!text.trim();
  // Solo room → the primary send IS "ask Reggie".
  const primary = solo ? ask : send;
  const primaryBusy = solo ? thinking : sending;

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }} keyboardVerticalOffset={90}>
      <ScrollView ref={scrollRef} style={{ flex: 1 }} contentContainerStyle={st.chatScroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {messages.length === 0 && !thinking ? (
          <View style={st.chatEmpty}>
            <Text style={st.chatEmptyTitle}>{solo ? "Just you and Reggie" : "Quiet in here"}</Text>
            <Text style={st.chatEmptyText}>
              {solo
                ? "It's just you in here — every message goes straight to Reggie. Ask anything to get started."
                : "Message the room, or tap the spark to ask Reggie a question."}
            </Text>
          </View>
        ) : (
          messages.map(m => <Bubble key={m.id} m={m} mine={m.user_id === userId} C={C} st={st} />)
        )}
        {thinking && (
          <View style={[st.bubbleWrap, { alignItems: "flex-start" }]}>
            <View style={[st.bubble, st.bubbleTutor]}>
              <View style={st.tutorHead}><Text style={st.tutorName}>Reggie</Text></View>
              <Text style={[st.bubbleBody, { color: C.textDim }]}>thinking…</Text>
            </View>
          </View>
        )}
      </ScrollView>

      <View style={st.inputRow}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={solo ? "Message Reggie…" : "Message the room…"}
          placeholderTextColor={C.textDim}
          style={st.input}
          multiline
        />
        {/* The separate "ask Reggie" spark is only useful when there are others in
            the room; solo, the send button already goes to Reggie. */}
        {!solo && (
          <TouchableOpacity onPress={ask} disabled={!canSend || thinking} style={[st.inputBtn, st.tutorBtn, (!canSend || thinking) && { opacity: 0.4 }]} hitSlop={6}>
            {thinking ? <ActivityIndicator size="small" color={C.accent} /> : <Sparkles size={17} color={C.accent} strokeWidth={2} />}
          </TouchableOpacity>
        )}
        <TouchableOpacity onPress={primary} disabled={!canSend || primaryBusy} style={[st.inputBtn, st.sendBtn, (!canSend || primaryBusy) && { opacity: 0.5 }]} hitSlop={6}>
          {solo && primaryBusy ? <ActivityIndicator size="small" color={C.bg} /> : <Send size={16} color={C.bg} strokeWidth={2.2} />}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

// ── RoomBoard — view-only board digest, or an honest placeholder ──────────────
function flattenJson(j: any): string {
  if (!j) return "";
  try {
    const items = Array.isArray(j) ? j : Array.isArray(j?.items) ? j.items : [];
    return items.map((it: any) => it?.text ?? it?.label ?? "").filter(Boolean).join("\n");
  } catch { return ""; }
}

export function RoomBoard({ roomId, C }: { roomId: string; C: ThemeColors }) {
  const st = makeStyles(C);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase
          .from("whiteboard_snapshots")
          .select("extracted_text, extracted_json, revision")
          .eq("room_id", roomId)
          .order("revision", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (cancelled) return;
        const t = (data?.extracted_text as string) || flattenJson(data?.extracted_json);
        if (t && t.trim()) setText(t.trim());
      } catch { /* server-only table (RLS) — show the placeholder */ }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [roomId]);

  if (loading) {
    return <View style={st.boardCenter}><ActivityIndicator color={C.textDim} /></View>;
  }
  if (!text) {
    return (
      <ScrollView contentContainerStyle={st.boardScroll} showsVerticalScrollIndicator={false}>
        <View style={st.boardMock}>
          <View style={st.boardGlyph}><Pen size={18} color={C.accent} strokeWidth={2} /></View>
          <Text style={st.boardMockTitle}>The board runs on web</Text>
          <Text style={st.boardMockText}>
            Your tutor's shared whiteboard — diagrams, worked examples, quizzes — lives on the web
            app for now. When your room uses it, a readable summary shows up here.
          </Text>
        </View>
      </ScrollView>
    );
  }
  return (
    <ScrollView contentContainerStyle={st.boardScroll} showsVerticalScrollIndicator={false}>
      <Text style={st.boardLabel}>What's on the board</Text>
      <View style={st.boardCard}><Text style={st.boardText}>{text}</Text></View>
    </ScrollView>
  );
}

// ── Styles (theme-driven) ─────────────────────────────────────────────────────
const makeStyles = (C: ThemeColors) => StyleSheet.create({
  // Focus sprint card — compact so the whole card (incl. Start button) clears the
  // floating nav without scrolling.
  sprintCard:       { backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 18, paddingVertical: 14, paddingHorizontal: 18, alignItems: "center" },
  sprintCardActive: { borderColor: "rgba(196,154,60,0.4)", backgroundColor: "rgba(196,154,60,0.06)" },
  sprintHead:       { flexDirection: "row", alignItems: "center", justifyContent: "space-between", width: "100%" },
  sprintTitle:      { fontWeight: "600", fontSize: 13, color: C.textPrimary, letterSpacing: 0.2 },
  sprintHint:       { fontWeight: "400", fontSize: 12, color: C.textDim },
  sprintTime:       { fontWeight: "700", fontSize: 46, letterSpacing: -1.2, marginVertical: 6, fontVariant: ["tabular-nums"] },
  sprintPills:      { flexDirection: "row", gap: 8, marginBottom: 10 },
  sprintPill:       { paddingVertical: 7, paddingHorizontal: 14, borderRadius: 11, borderWidth: 1, borderColor: C.border, backgroundColor: C.surfaceTranslucent },
  sprintPillOn:     { borderColor: "rgba(196,154,60,0.5)", backgroundColor: "rgba(196,154,60,0.14)" },
  sprintPillText:   { fontWeight: "600", fontSize: 13, color: C.textSecondary },
  sprintPillTextOn: { color: C.gold },
  sprintStart:      { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, alignSelf: "stretch", height: 44, borderRadius: 13, backgroundColor: C.gold },
  sprintStartText:  { fontWeight: "700", fontSize: 15, color: "#231A07", letterSpacing: -0.2 },
  sprintCtrls:      { flexDirection: "row", gap: 10, alignSelf: "stretch" },
  sprintCtrl:       { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, height: 44, borderRadius: 12, borderWidth: 1, borderColor: C.border, backgroundColor: C.surfaceTranslucent },
  sprintCtrlPrimary:{ backgroundColor: C.gold, borderColor: C.gold },
  sprintCtrlText:   { fontWeight: "600", fontSize: 14, color: C.textPrimary },

  // Chat
  chatScroll:  { paddingVertical: 8, gap: 10, flexGrow: 1 },
  chatEmpty:   { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 60, gap: 6 },
  chatEmptyTitle: { fontWeight: "600", fontSize: 15, color: C.textSecondary },
  chatEmptyText:  { fontWeight: "400", fontSize: 13, color: C.textDim, textAlign: "center", lineHeight: 19, maxWidth: 260 },
  bubbleWrap:  { width: "100%" },
  bubbleName:  { fontWeight: "500", fontSize: 11, color: C.textDim, marginBottom: 3, marginLeft: 4 },
  bubble:      { maxWidth: "82%", borderRadius: 16, paddingVertical: 9, paddingHorizontal: 13, borderWidth: 1 },
  bubbleMine:  { backgroundColor: C.accentSoft, borderColor: C.accentLine, borderBottomRightRadius: 5 },
  bubbleOther: { backgroundColor: C.surface, borderColor: C.border, borderBottomLeftRadius: 5 },
  bubbleTutor: { backgroundColor: C.accentSoft, borderColor: C.accentLine, borderBottomLeftRadius: 5 },
  bubbleBody:  { fontWeight: "400", fontSize: 14, lineHeight: 20, color: C.textPrimary },
  bubbleImg:   { width: 200, height: 150, borderRadius: 10 },
  tutorHead:   { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 3 },
  tutorName:   { fontWeight: "700", fontSize: 11, color: C.accent, letterSpacing: 0.2 },

  inputRow:    { flexDirection: "row", alignItems: "flex-end", gap: 8, paddingTop: 10, paddingBottom: 6 },
  input:       { flex: 1, minHeight: 44, maxHeight: 120, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 22, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, fontSize: 15, color: C.textPrimary },
  inputBtn:    { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  tutorBtn:    { backgroundColor: C.accentSoft, borderWidth: 1, borderColor: C.accentLine },
  sendBtn:     { backgroundColor: C.accent },

  // Board
  boardCenter: { flex: 1, alignItems: "center", justifyContent: "center" },
  boardScroll: { paddingVertical: 8, gap: 12, flexGrow: 1 },
  boardLabel:  { fontWeight: "600", fontSize: 13, color: C.textSecondary, letterSpacing: 0.2 },
  boardCard:   { backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 16, padding: 16 },
  boardText:   { fontWeight: "400", fontSize: 14, lineHeight: 22, color: C.textPrimary },
  boardMock:   { alignItems: "center", justifyContent: "center", paddingVertical: 54, paddingHorizontal: 20, gap: 8 },
  boardGlyph:  { width: 44, height: 44, borderRadius: 13, backgroundColor: C.accentSoft, alignItems: "center", justifyContent: "center", marginBottom: 6 },
  boardMockTitle: { fontWeight: "600", fontSize: 16, color: C.textPrimary },
  boardMockText:  { fontWeight: "400", fontSize: 13, color: C.textSecondary, textAlign: "center", lineHeight: 20, maxWidth: 300 },
});

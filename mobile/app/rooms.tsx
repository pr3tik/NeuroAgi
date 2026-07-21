// rooms.tsx — Study Rooms, rebuilt.
//
// The old lobby was a flat list of glassy cards + a big gold "have a code?" box.
// This rebuild reframes the screen around the product thesis: proactive, not
// reactive. The first thing you see is your tutor offering to start a focused
// session (a private room where it's just you + the tutor). Below that is
// discovery — rooms of people studying similar things, filterable the way
// FocusTown filters its world: by subject, school, and city.
//
// Everything is theme-driven (useTheme colors) so it renders in light or dark.
// Live chat / whiteboard / voice / Pomodoro still run on the web app; the detail
// screen says so rather than faking it.

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  View, Text, ScrollView, TextInput, TouchableOpacity,
  StyleSheet, Modal, Platform, Animated, AccessibilityInfo,
} from "react-native";
import {
  School, Users, Link2, BookOpen, Check, KeyRound, Lock, Globe,
  MessageCircle, Pen, Mic, LogOut, Plus, SlidersHorizontal, X,
  Sparkles, MapPin, GraduationCap, ChevronRight, ArrowLeft,
} from "lucide-react-native";
import ScreenWrapper from "../components/ScreenWrapper";
import Glass, { isLightBg } from "../components/Glass";
import { Skeleton, EmptyState, ErrorState, useRefresh, ThemedRefreshControl } from "../components/States";
import { NAV_CLEARANCE } from "../components/BottomNav";
import { useRoomChannel, FocusSprint, RoomChat, RoomBoard } from "../components/RoomSession";
import StudyOrb from "../components/StudyOrb";
import NeuralRing from "../components/NeuralRing";
import { useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "../services/supabase";
import { useAuth, useUserId } from "../context/AuthContext";
import { useTheme, ThemeColors } from "../constants/appTheme";

const MONO = Platform.select({ ios: "Menlo", android: "monospace" });

// Semantic colors that aren't part of the base theme (private/danger). Both the
// dark and the periwinkle-light ground are DEEP grounds carrying light text, so the
// same warm salmon reads on both — the dark brick-red was tuned for a white ground,
// which this app no longer uses.
function semantics(_mode: "light" | "dark") {
  return { danger: "rgba(224,132,116,0.95)", dangerSoft: "rgba(224,132,116,0.10)", dangerLine: "rgba(224,132,116,0.26)" };
}

// Stable, muted avatar tints (work on both themes) — indexed by a hash of the id.
const AVATAR_TINTS = ["#6C8E7E", "#8A7BA6", "#B0885A", "#5F87A8", "#A57683", "#7F9A5E"];
function tintFor(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_TINTS[h % AVATAR_TINTS.length];
}
function initialsOf(name?: string | null) {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "·";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

// ── Types ─────────────────────────────────────────────────────────────────────
type AccessFilters = { university?: boolean; friends?: boolean; fof?: boolean; course?: boolean };

type Room = {
  id: string;
  created_by: string;
  name: string;
  course_id: number | null;
  room_type: "public" | "invite";
  join_code: string | null;
  is_active: boolean;
  access_filters?: AccessFilters | null;
};

// A room enriched with the host's school/city and its members — the attributes
// discovery filters on. Absent fields simply don't match a filter (honest: a room
// whose host never set a school won't appear under a school filter).
type EnrichedRoom = Room & {
  hostName?: string;
  school?: string;
  city?: string;
  subject?: string;      // course code, e.g. "CDS151" — the "studying similar" axis
  dept?: string;         // alpha prefix, e.g. "CDS" — the coarse subject facet
  members: { id: string; name: string }[];
};

type Course = { id: number | string; name: string | null; course_code: string | null };

const ACCESS_OPTIONS: { key: keyof AccessFilters; icon: any; label: string; desc: string; needsCourse?: boolean }[] = [
  { key: "university", icon: School,   label: "Same school",        desc: "Only students at your school" },
  { key: "friends",    icon: Users,    label: "Friends only",        desc: "Only your friends" },
  { key: "fof",        icon: Link2,    label: "Friends of friends",  desc: "Friends and their friends" },
  { key: "course",     icon: BookOpen, label: "Course-mates",        desc: "Students taking the linked course", needsCourse: true },
];
function activeFilterKeys(filters?: AccessFilters | null): (keyof AccessFilters)[] {
  if (!filters) return [];
  return ACCESS_OPTIONS.map(o => o.key).filter(k => filters[k]);
}

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function generateRoomCode() {
  let code = "";
  for (let i = 0; i < 6; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return code;
}
function deptOf(code?: string | null) {
  if (!code) return null;
  const m = code.trim().match(/^[A-Za-z]+/);
  return m ? m[0].toUpperCase() : null;
}

// ── Server RPC wrappers (mirrors src/api/rooms.ts) ────────────────────────────
async function rpcListRooms(userId: string): Promise<Room[]> {
  const { data, error } = await supabase.rpc("list_accessible_rooms", { p_user: userId });
  if (error) throw error;
  return (data ?? []) as Room[];
}
async function rpcJoinRoom(userId: string, roomId: string, code: string | null = null): Promise<string> {
  const { data, error } = await supabase.rpc("join_room", { p_user: userId, p_room: roomId, p_code: code });
  if (error) throw error;
  return (data ?? "denied") as string;
}
async function rpcLeaveRoom(userId: string, roomId: string) {
  const { error } = await supabase.rpc("leave_room", { p_user: userId, p_room: roomId });
  if (error) throw error;
}

// ── LiveDot — a small sage dot with a breathing halo (reduced-motion aware) ────
function LiveDot({ color, size = 8 }: { color: string; size?: number }) {
  const halo = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    let loop: Animated.CompositeAnimation | undefined;
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then(reduced => {
      if (!mounted || reduced) return;
      loop = Animated.loop(
        Animated.timing(halo, { toValue: 1, duration: 1800, useNativeDriver: true }),
      );
      loop.start();
    });
    return () => { mounted = false; loop?.stop(); };
  }, [halo]);
  const scale = halo.interpolate({ inputRange: [0, 1], outputRange: [1, 2.6] });
  const opacity = halo.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0] });
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <Animated.View
        style={{
          position: "absolute", width: size, height: size, borderRadius: size / 2,
          backgroundColor: color, transform: [{ scale }], opacity,
        }}
      />
      <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />
    </View>
  );
}

// ── AvatarStack — overlapping member initials, social proof ───────────────────
function AvatarStack({ members, st, C, extra = 0 }: {
  members: { id: string; name: string }[]; st: any; C: ThemeColors; extra?: number;
}) {
  const shown = members.slice(0, 3);
  const overflow = extra + Math.max(0, members.length - shown.length);
  if (!shown.length && overflow <= 0) return null;
  return (
    <View style={{ flexDirection: "row", alignItems: "center" }}>
      {shown.map((m, i) => (
        <View key={m.id} style={[st.avatar, { backgroundColor: tintFor(m.id), marginLeft: i === 0 ? 0 : -8, borderColor: C.surface }]}>
          <Text style={st.avatarText}>{initialsOf(m.name)}</Text>
        </View>
      ))}
      {overflow > 0 && (
        <View style={[st.avatar, st.avatarMore, { marginLeft: shown.length ? -8 : 0, borderColor: C.surface }]}>
          <Text style={[st.avatarText, { color: C.textSecondary }]}>+{overflow}</Text>
        </View>
      )}
    </View>
  );
}

// ── FocusHero — the proactive card: start a private session with your tutor ────
function FocusHero({ onStart, st, C }: { onStart: () => void; st: any; C: ThemeColors }) {
  return (
    <Glass colors={C} radius={20} style={st.hero}>
      <View style={{ marginBottom: 16 }}>
        <NeuralRing size={40} color={isLightBg(C) ? "50,70,105" : "255,255,255"} />
      </View>
      <Text style={st.heroKicker}>Reggie · your tutor</Text>
      <Text style={st.heroTitle}>Ready for a focused study block?</Text>
      <Text style={st.heroBody}>
        Start a private room — just you and Reggie, working through what you came
        to do. No one else unless you invite them.
      </Text>
      <TouchableOpacity onPress={onStart} activeOpacity={0.85} style={st.heroBtn}>
        <Text style={st.heroBtnText}>Start focus room</Text>
        <ChevronRight size={16} color={C.bg} strokeWidth={2.5} />
      </TouchableOpacity>
    </Glass>
  );
}

// ── RoomRow — a discovery result. Clean row, not a heavy card ─────────────────
function RoomRow({ room, liveCount, joining, pendingStatus, onJoin, st, C, sem }: {
  room: EnrichedRoom; liveCount: number; joining: boolean;
  pendingStatus: string | undefined; onJoin: () => void; st: any; C: ThemeColors; sem: any;
}) {
  const isPrivate = room.room_type === "invite";
  const joined = pendingStatus === "joined" || pendingStatus === "accepted";
  const btnLabel =
    joined                        ? "Open" :
    pendingStatus === "requested" ? "Requested" :
    joining                       ? "…" :
    isPrivate                     ? "Request" : "Join";
  const btnDisabled = joining || pendingStatus === "requested";

  // Meta line: subject · school · city — the demographic dimensions discovery sorts on.
  const meta = [room.subject, room.school, room.city].filter(Boolean) as string[];

  return (
    <Glass colors={C} radius={16} onPress={onJoin} disabled={btnDisabled} style={st.row}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={st.rowTitleLine}>
          {isPrivate && <Lock size={12} color={C.textTertiary} strokeWidth={2.2} />}
          <Text style={st.roomName} numberOfLines={1}>{room.name}</Text>
        </View>

        {meta.length > 0 && (
          <Text style={st.roomMeta} numberOfLines={1}>{meta.join("  ·  ")}</Text>
        )}

        <View style={st.rowFooter}>
          {liveCount > 0 ? (
            <View style={st.liveWrap}>
              <LiveDot color={C.accent} size={7} />
              <Text style={st.liveText}>{liveCount} focusing</Text>
            </View>
          ) : room.members.length > 0 ? (
            <Text style={st.quietText}>{room.members.length} {room.members.length === 1 ? "member" : "members"}</Text>
          ) : (
            <Text style={st.quietText}>Quiet — start it off</Text>
          )}
          {room.members.length > 0 && <AvatarStack members={room.members} st={st} C={C} />}
        </View>
      </View>

      <View style={[st.joinPill, joined && st.joinPillJoined, btnDisabled && { opacity: 0.5 }]}>
        <Text style={[st.joinPillText, joined && { color: C.accent }]}>{btnLabel}</Text>
      </View>
    </Glass>
  );
}

// ── FilterSheet — FocusTown-style: narrow by subject / school / city ──────────
type Facets = { subjects: string[]; schools: string[]; cities: string[] };
type FacetSel = { subject: string | null; school: string | null; city: string | null };

function FilterSheet({ facets, sel, onApply, onClose, st, C }: {
  facets: Facets; sel: FacetSel; onApply: (s: FacetSel) => void; onClose: () => void; st: any; C: ThemeColors;
}) {
  const [local, setLocal] = useState<FacetSel>(sel);
  const groups: { key: keyof FacetSel; label: string; icon: any; values: string[] }[] = [
    { key: "subject", label: "Subject", icon: BookOpen,      values: facets.subjects },
    { key: "school",  label: "School",  icon: GraduationCap, values: facets.schools },
    { key: "city",    label: "City",    icon: MapPin,        values: facets.cities },
  ];
  const anyActive = !!(local.subject || local.school || local.city);

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={st.sheetOverlay}>
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={onClose} />
        <Glass colors={C} radius={24} intensity={isLightBg(C) ? 60 : 45} style={st.sheet}>
          <View style={st.sheetHandle} />
          <View style={st.sheetHead}>
            <Text style={st.sheetTitle}>Browse rooms</Text>
            <TouchableOpacity onPress={onClose} hitSlop={10}><X size={20} color={C.textSecondary} /></TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 420 }}>
            {groups.map(g => {
              const Icon = g.icon;
              return (
                <View key={g.key} style={{ marginBottom: 20 }}>
                  <View style={st.sheetGroupHead}>
                    <Icon size={14} color={C.textSecondary} strokeWidth={2} />
                    <Text style={st.sheetGroupLabel}>{g.label}</Text>
                  </View>
                  {g.values.length === 0 ? (
                    <Text style={st.sheetEmpty}>No rooms carry a {g.label.toLowerCase()} yet.</Text>
                  ) : (
                    <View style={st.chipWrap}>
                      {g.values.map(v => {
                        const on = local[g.key] === v;
                        return (
                          <TouchableOpacity
                            key={v}
                            onPress={() => setLocal(s => ({ ...s, [g.key]: on ? null : v }))}
                            style={[st.facetChip, on && st.facetChipOn]}
                          >
                            <Text style={[st.facetChipText, on && st.facetChipTextOn]} numberOfLines={1}>{v}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  )}
                </View>
              );
            })}
          </ScrollView>

          <View style={st.sheetActions}>
            <TouchableOpacity
              onPress={() => { setLocal({ subject: null, school: null, city: null }); }}
              style={[st.sheetGhost, !anyActive && { opacity: 0.4 }]}
              disabled={!anyActive}
            >
              <Text style={st.sheetGhostText}>Clear</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => onApply(local)} style={st.sheetPrimary}>
              <Text style={st.sheetPrimaryText}>Show rooms</Text>
            </TouchableOpacity>
          </View>
        </Glass>
      </View>
    </Modal>
  );
}

// ── CreateRoomModal (restyled to the clean theme) ─────────────────────────────
function CreateRoomModal({ courses, preset, onCreate, onClose, st, C }: {
  courses: Course[];
  preset?: { name?: string; roomType?: "public" | "invite" };
  onCreate: (opts: { name: string; courseId: string; roomType: string; accessFilters: AccessFilters }) => Promise<void>;
  onClose: () => void; st: any; C: ThemeColors;
}) {
  const [name, setName]           = useState(preset?.name ?? "");
  const [courseId, setCourseId]   = useState("");
  const [roomType, setRoomType]   = useState<string>(preset?.roomType ?? "public");
  const [accessFilters, setAccessFilters] = useState<AccessFilters>({});
  const [saving, setSaving]       = useState(false);

  async function handleSubmit() {
    if (saving) return;
    setSaving(true);
    await onCreate({ name: name.trim() || "Focus session", courseId, roomType, accessFilters });
    setSaving(false);
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={st.sheetOverlay}>
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={onClose} />
        <Glass colors={C} radius={24} intensity={isLightBg(C) ? 60 : 45} style={st.sheet}>
          <View style={st.sheetHandle} />
          <ScrollView showsVerticalScrollIndicator={false}>
            <View style={st.sheetHead}>
              <Text style={st.sheetTitle}>New room</Text>
              <TouchableOpacity onPress={onClose} hitSlop={10}><X size={20} color={C.textSecondary} /></TouchableOpacity>
            </View>

            <Text style={st.fieldLabel}>Room name</Text>
            <TextInput
              autoFocus value={name} onChangeText={setName}
              placeholder="e.g. CDS151 problem set" placeholderTextColor={C.textDim}
              style={st.input}
            />

            <Text style={st.fieldLabel}>Course (optional)</Text>
            <View style={{ gap: 6, marginTop: 8, marginBottom: 18 }}>
              <TouchableOpacity onPress={() => setCourseId("")} style={[st.pickRow, courseId === "" && st.pickRowOn]}>
                <Text style={[st.pickRowText, courseId === "" && { color: C.accent }]}>No course — general focus</Text>
              </TouchableOpacity>
              {courses.map(c => {
                const on = String(c.id) === courseId;
                return (
                  <TouchableOpacity key={String(c.id)} onPress={() => setCourseId(on ? "" : String(c.id))} style={[st.pickRow, on && st.pickRowOn]}>
                    <Text style={[st.pickRowText, on && { color: C.accent }]} numberOfLines={1}>
                      {c.course_code ? `${c.course_code} — ${c.name}` : c.name}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={st.fieldLabel}>Visibility</Text>
            <View style={{ flexDirection: "row", gap: 8, marginTop: 8, marginBottom: 18 }}>
              {(["public", "invite"] as const).map(t => {
                const on = roomType === t;
                const Icon = t === "public" ? Globe : Lock;
                return (
                  <TouchableOpacity key={t} onPress={() => setRoomType(t)} style={[st.segment, on && st.segmentOn]}>
                    <Icon size={14} color={on ? C.accent : C.textDim} strokeWidth={2} />
                    <Text style={[st.segmentText, on && { color: C.accent }]}>{t === "public" ? "Public" : "Invite only"}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={st.fieldLabel}>Who can join</Text>
            <Text style={st.fieldHint}>Leave all off for anyone. Pick any — a student who matches one can join.</Text>
            <View style={{ gap: 8, marginTop: 8, marginBottom: 22 }}>
              {ACCESS_OPTIONS.map(opt => {
                const disabled = !!opt.needsCourse && !courseId;
                const on = !!accessFilters[opt.key] && !disabled;
                const Icon = opt.icon;
                return (
                  <TouchableOpacity
                    key={opt.key} disabled={disabled}
                    onPress={() => setAccessFilters(f => ({ ...f, [opt.key]: !on }))}
                    style={[st.accessRow, on && st.accessRowOn, disabled && { opacity: 0.4 }]}
                  >
                    <Icon size={17} color={on ? C.accent : C.textSecondary} strokeWidth={2} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={[st.accessLabel, { color: on ? C.accent : C.textPrimary }]}>{opt.label}</Text>
                      <Text style={st.accessDesc}>{disabled ? "Link a course first" : opt.desc}</Text>
                    </View>
                    <View style={[st.check, on && st.checkOn]}>{on && <Check size={12} color={C.bg} strokeWidth={3} />}</View>
                  </TouchableOpacity>
                );
              })}
            </View>

            <TouchableOpacity onPress={handleSubmit} disabled={saving} style={[st.sheetPrimary, saving && { opacity: 0.4 }]}>
              <Text style={st.sheetPrimaryText}>{saving ? "Creating…" : "Create room"}</Text>
            </TouchableOpacity>
          </ScrollView>
        </Glass>
      </View>
    </Modal>
  );
}

// ── RoomDetail (restyled; tutor shown as a first-class participant) ───────────
function RoomDetail({ room, courseLabel, userName, onlineIds, onBack, onLeft, st, C, sem }: {
  room: EnrichedRoom; courseLabel: string | null; userName: string; onlineIds: string[];
  onBack: () => void; onLeft: () => void; st: any; C: ThemeColors; sem: any;
}) {
  const userId = useUserId();
  const { messages, sendChat, askTutor, pomo, setPomodoro } = useRoomChannel(room.id, userId, userName);
  const [tab, setTab] = useState<"room" | "chat" | "board">("room");
  const [members, setMembers] = useState<{ id: string; name: string; role: string }[]>([]);
  const [leaving, setLeaving] = useState(false);
  const isPrivate = room.room_type === "invite";

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: rows } = await supabase
          .from("room_members").select("user_id, role")
          .eq("room_id", room.id).eq("status", "joined");
        const ids = (rows ?? []).map((r: any) => r.user_id);
        let names: Record<string, string> = {};
        if (ids.length) {
          const { data: users } = await supabase.from("users").select("id, name").in("id", ids);
          (users ?? []).forEach((u: any) => { names[u.id] = u.name; });
        }
        if (cancelled) return;
        setMembers((rows ?? []).map((r: any) => ({ id: r.user_id, name: names[r.user_id] ?? "Student", role: r.role })));
      } catch { /* RLS or network — show the room without members */ }
    })();
    return () => { cancelled = true; };
  }, [room.id]);

  async function handleLeave() {
    if (leaving) return;
    setLeaving(true);
    try { await rpcLeaveRoom(userId, room.id); } catch { /* non-fatal */ }
    setLeaving(false);
    onLeft();
  }

  const segs: { key: "room" | "chat" | "board"; label: string }[] = [
    { key: "room", label: "Room" }, { key: "chat", label: "Chat" }, { key: "board", label: "Board" },
  ];

  // The orb orbits everyone in the room; presence dots come from the global
  // "studying now" channel (onlineIds).
  const orbMembers = members.map(m => ({ userId: m.id, name: m.name }));
  const focusingCount = members.filter(m => onlineIds.includes(m.id)).length;
  const sprintActive = !!pomo && pomo.phase !== "idle";

  return (
    <View style={{ flex: 1 }}>
      <TouchableOpacity onPress={onBack} style={[st.backLink, { marginBottom: 12 }]} hitSlop={8}>
        <ArrowLeft size={16} color={C.textSecondary} strokeWidth={2} />
        <Text style={st.backLinkText}>Rooms</Text>
      </TouchableOpacity>

      <View style={st.rowTitleLine}>
        {isPrivate && <Lock size={14} color={C.textTertiary} strokeWidth={2.2} />}
        <Text style={st.detailTitle} numberOfLines={1}>{room.name}</Text>
      </View>
      <View style={st.detailStatus}>
        {isPrivate ? <Lock size={12} color={C.textTertiary} strokeWidth={2} /> : <Globe size={12} color={C.textTertiary} strokeWidth={2} />}
        <Text style={st.roomMeta}>{isPrivate ? "Invite only" : "Public"}</Text>
        {focusingCount > 0 && (
          <>
            <Text style={[st.roomMeta, { color: C.textTertiary }]}>·</Text>
            <Text style={[st.roomMeta, { color: C.accent }]}>{focusingCount} focusing now</Text>
          </>
        )}
        {courseLabel && (
          <>
            <Text style={[st.roomMeta, { color: C.textTertiary }]}>·</Text>
            <Text style={st.roomMeta} numberOfLines={1}>{courseLabel}</Text>
          </>
        )}
      </View>

      {/* Segmented control: the Room tab is the orb-centred "focus" view; Chat and
          Board get the full height so they stay usable on a phone. */}
      <View style={[st.seg, { marginTop: 14 }]}>
        {segs.map(s => {
          const on = tab === s.key;
          return (
            <TouchableOpacity key={s.key} onPress={() => setTab(s.key)} style={[st.segItem, on && st.segItemOn]} activeOpacity={0.8}>
              <Text style={[st.segText, on && st.segTextOn]}>{s.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={{ flex: 1 }}>
        {tab === "room" && (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingTop: 6, paddingBottom: 16 }}>
            {/* The living heart of the room */}
            <StudyOrb colors={C} active={sprintActive} members={orbMembers} size={150} />

            <FocusSprint pomo={pomo} onChange={setPomodoro} C={C} />

            {members.length > 1 && (
              <View style={st.pactStrip}>
                <Text style={st.pactText}>Focus pact · {members.length} studying together</Text>
                <Text style={st.pactTag}>Together</Text>
              </View>
            )}

            <View style={{ marginTop: 20 }}>
              <Text style={st.sectionLabel}>In this room</Text>
              <View style={{ gap: 8 }}>
                {/* The tutor is always present in a room — the product's whole premise. */}
                <Glass colors={C} radius={14} style={[st.memberRow, { borderColor: C.accentLine }]}>
                  <NeuralRing size={26} color={isLightBg(C) ? "50,70,105" : "255,255,255"} />
                  <Text style={[st.memberName, { color: C.accent }]}>Reggie</Text>
                  <Text style={st.memberStatus}>always here</Text>
                </Glass>
                {members.map(m => {
                  const online = onlineIds.includes(m.id);
                  return (
                    <Glass key={m.id} colors={C} radius={14} style={st.memberRow}>
                      <View style={[st.avatar, { backgroundColor: tintFor(m.id), borderWidth: 0 }]}>
                        <Text style={st.avatarText}>{initialsOf(m.name)}</Text>
                      </View>
                      <Text style={st.memberName} numberOfLines={1}>{m.id === userId ? `${m.name} (you)` : m.name}</Text>
                      {m.role === "host" && <Text style={st.hostTag}>Host</Text>}
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                        {online && <LiveDot color={C.accent} size={6} />}
                        <Text style={st.memberStatus}>{online ? "focusing" : "away"}</Text>
                      </View>
                    </Glass>
                  );
                })}
              </View>
            </View>

            {room.join_code && (
              <Glass colors={C} radius={14} style={[st.codeCard, { marginTop: 16 }]}>
                <Text style={st.codeLabel}>Share code</Text>
                <Text style={st.codeValue}>{room.join_code}</Text>
              </Glass>
            )}

            <TouchableOpacity onPress={handleLeave} disabled={leaving} style={[st.leaveBtn, { marginTop: 16, borderColor: sem.dangerLine, backgroundColor: sem.dangerSoft }]}>
              <LogOut size={14} color={sem.danger} strokeWidth={2} />
              <Text style={[st.leaveBtnText, { color: sem.danger }]}>{leaving ? "Leaving…" : "Leave room"}</Text>
            </TouchableOpacity>
          </ScrollView>
        )}

        {tab === "chat" && (
          <RoomChat
            messages={messages} userId={userId}
            onSendRoom={sendChat}
            onAskTutor={(b) => askTutor(b, courseLabel)}
            solo={members.length <= 1}
            C={C}
          />
        )}

        {tab === "board" && <RoomBoard roomId={room.id} C={C} />}
      </View>
    </View>
  );
}

// ── Scope filter (quick top-level) ────────────────────────────────────────────
type Scope = "all" | "live" | "school" | "subjects";
const SCOPES: { key: Scope; label: string }[] = [
  { key: "all",      label: "Everyone" },
  { key: "live",     label: "Live now" },
  { key: "school",   label: "My school" },
  { key: "subjects", label: "My subjects" },
];

// ── Main screen ───────────────────────────────────────────────────────────────
export default function RoomsScreen() {
  const userId = useUserId();
  const { profile } = useAuth();
  const { colors: C, mode } = useTheme();
  const insets = useSafeAreaInsets();
  const sem = useMemo(() => semantics(mode), [mode]);
  const st = useMemo(() => makeStyles(C), [C]);

  const mySchool = (profile?.school ?? "").trim().toLowerCase();

  const [rooms, setRooms]             = useState<EnrichedRoom[]>([]);
  const [loading, setLoading]         = useState(true);
  const [loadError, setLoadError]     = useState("");
  const [courses, setCourses]         = useState<Course[]>([]);
  const [myCourseIds, setMyCourseIds] = useState<Set<number>>(new Set());
  const [scope, setScope]             = useState<Scope>("all");
  const [facetSel, setFacetSel]       = useState<FacetSel>({ subject: null, school: null, city: null });
  const [showFilter, setShowFilter]   = useState(false);
  const [joiningId, setJoiningId]     = useState<string | null>(null);
  const [pendingReqs, setPendingReqs] = useState<Record<string, string>>({});
  const [joinError, setJoinError]     = useState("");
  const [showCreate, setShowCreate]   = useState(false);
  const [createPreset, setCreatePreset] = useState<{ name?: string; roomType?: "public" | "invite" } | undefined>();
  const [showCode, setShowCode]       = useState(false);
  const [codeInput, setCodeInput]     = useState("");
  const [codeError, setCodeError]     = useState("");
  const [codeLookingUp, setCodeLookingUp] = useState(false);
  const [activeRoom, setActiveRoom]   = useState<EnrichedRoom | null>(null);
  const [globalState, setGlobalState] = useState<Record<string, any>>({});
  const presenceRef = useRef<any>(null);

  // Live presence — read-only observation of the web's "global-studying" channel.
  useEffect(() => {
    let ch: any = null;
    try {
      ch = supabase.channel("global-studying", { config: { presence: { key: `mobile-${userId}` } } });
      ch.on("presence", { event: "sync" }, () => setGlobalState({ ...ch.presenceState() })).subscribe();
      presenceRef.current = ch;
    } catch { /* presence is best-effort */ }
    return () => { if (ch) { try { supabase.removeChannel(ch); } catch {} } presenceRef.current = null; };
  }, [userId]);

  const totalOnline = Object.keys(globalState).length;
  const roomCounts: Record<string, number> = {};
  for (const sessions of Object.values(globalState)) {
    const roomId = Array.isArray(sessions) ? sessions[0]?.roomId : null;
    if (roomId) roomCounts[roomId] = (roomCounts[roomId] || 0) + 1;
  }
  const onlineIds = Object.keys(globalState);

  useEffect(() => { fetchRooms(); fetchPendingRequests(); fetchCourses(); }, [userId]);

  // Pull-to-refresh re-runs the same three fetches the mount effect does.
  const reload = useCallback(async () => {
    await Promise.all([fetchRooms(), fetchPendingRequests(), fetchCourses()]);
  }, []); // fetch* are hoisted function declarations, stable across renders
  const { refreshing, onRefresh } = useRefresh(reload);

  // "Start room" from Home deep-links to /rooms?start=1 — open the focus-room sheet.
  const startParams = useLocalSearchParams<{ start?: string }>();
  const startedRef = useRef(false);
  useEffect(() => {
    if (startParams.start === "1" && !startedRef.current) { startedRef.current = true; openFocusRoom(); }
  }, [startParams.start]);
  useEffect(() => { if (!joinError) return; const t = setTimeout(() => setJoinError(""), 4000); return () => clearTimeout(t); }, [joinError]);

  // Fetch rooms, then enrich each with its host's school/city + members. Both
  // reads go through the open `users` / `room_members` policies (batched: 2 queries
  // total regardless of room count).
  async function fetchRooms() {
    setLoading(true); setLoadError("");
    let base: Room[] = [];
    try {
      base = await rpcListRooms(userId);
    } catch {
      try {
        const { data, error } = await supabase.from("study_rooms").select("*").eq("is_active", true).order("last_active", { ascending: false });
        if (error) throw error;
        base = (data ?? []) as Room[];
      } catch {
        setRooms([]); setLoadError("Couldn't load rooms. Pull to retry."); setLoading(false); return;
      }
    }

    const hostIds = Array.from(new Set(base.map(r => r.created_by)));
    const roomIds = base.map(r => r.id);
    let hostMeta: Record<string, { name?: string; school?: string; city?: string }> = {};
    let membersByRoom: Record<string, { id: string; name: string }[]> = {};

    try {
      const [{ data: mrows }, { data: hosts }] = await Promise.all([
        roomIds.length
          ? supabase.from("room_members").select("room_id, user_id").eq("status", "joined").in("room_id", roomIds)
          : Promise.resolve({ data: [] as any[] }),
        hostIds.length
          ? supabase.from("users").select("id, name, school, city, school_city").in("id", hostIds)
          : Promise.resolve({ data: [] as any[] }),
      ]);

      (hosts ?? []).forEach((u: any) => {
        hostMeta[u.id] = { name: u.name, school: u.school || undefined, city: u.city || u.school_city || undefined };
      });

      // Members need names too — batch the union of member ids not already fetched.
      const memberIds = Array.from(new Set((mrows ?? []).map((r: any) => r.user_id)));
      const missing = memberIds.filter(id => !hostMeta[id]);
      let memberNames: Record<string, string> = {};
      (hosts ?? []).forEach((u: any) => { memberNames[u.id] = u.name; });
      if (missing.length) {
        const { data: mu } = await supabase.from("users").select("id, name").in("id", missing);
        (mu ?? []).forEach((u: any) => { memberNames[u.id] = u.name; });
      }
      (mrows ?? []).forEach((r: any) => {
        (membersByRoom[r.room_id] ??= []).push({ id: r.user_id, name: memberNames[r.user_id] ?? "Student" });
      });
    } catch { /* enrichment is best-effort — rooms still render without meta */ }

    // course_id → code label, from the user's own course list.
    const enriched: EnrichedRoom[] = base.map(r => {
      const host = hostMeta[r.created_by] ?? {};
      const course = courses.find(c => Number(c.id) === Number(r.course_id));
      const subject = course?.course_code || (course?.name ?? undefined);
      return {
        ...r,
        hostName: host.name,
        school: host.school,
        city: host.city,
        subject: subject || undefined,
        dept: deptOf(course?.course_code) || undefined,
        members: membersByRoom[r.id] ?? [],
      };
    });

    setRooms(enriched);
    setLoading(false);
  }

  async function fetchPendingRequests() {
    try {
      const { data } = await supabase.from("room_members").select("room_id, status").eq("user_id", userId).in("status", ["requested", "joined"]);
      const map: Record<string, string> = {};
      (data ?? []).forEach((r: any) => { map[r.room_id] = r.status; });
      setPendingReqs(map);
    } catch { /* non-fatal */ }
  }

  async function fetchCourses() {
    try {
      const { data } = await supabase.from("courses").select("id, name, course_code").eq("user_id", userId);
      const list = (data ?? []) as Course[];
      setCourses(list);
      setMyCourseIds(new Set(list.map(c => Number(c.id))));
    } catch { /* course labels are optional */ }
  }

  // Re-enrich subjects when courses arrive after rooms (course labels are the user's own).
  useEffect(() => {
    if (!courses.length || !rooms.length) return;
    setRooms(prev => prev.map(r => {
      if (r.subject || r.course_id == null) return r;
      const course = courses.find(c => Number(c.id) === Number(r.course_id));
      if (!course) return r;
      return { ...r, subject: course.course_code || (course.name ?? undefined), dept: deptOf(course.course_code) || undefined };
    }));
  }, [courses]);

  async function handleJoin(room: EnrichedRoom) {
    if (pendingReqs[room.id] === "requested") return;
    if (pendingReqs[room.id] === "joined" || pendingReqs[room.id] === "accepted") { setActiveRoom(room); return; }
    setJoiningId(room.id); setJoinError("");
    try {
      const status = await rpcJoinRoom(userId, room.id);
      if (status === "joined") { setPendingReqs(p => ({ ...p, [room.id]: "joined" })); setActiveRoom(room); }
      else if (status === "requested") setPendingReqs(p => ({ ...p, [room.id]: "requested" }));
      else if (status === "denied") { setJoinError("You're not eligible to join this room."); setRooms(prev => prev.filter(r => r.id !== room.id)); }
    } catch { setJoinError("Couldn't join right now. Try again."); }
    setJoiningId(null);
  }

  async function handleJoinByCode() {
    const code = codeInput.trim().toUpperCase();
    if (code.length < 6 || codeLookingUp) return;
    setCodeLookingUp(true); setCodeError("");
    try {
      const { data: found } = await supabase.rpc("find_room_by_code", { p_code: code });
      const hit = Array.isArray(found) ? found[0] : found;
      if (!hit) { setCodeError("No active room with that code."); setCodeLookingUp(false); return; }
      const status = await rpcJoinRoom(userId, hit.id, code);
      if (status === "joined") {
        const { data: room } = await supabase.from("study_rooms").select("*").eq("id", hit.id).maybeSingle();
        setCodeInput(""); setShowCode(false);
        setPendingReqs(p => ({ ...p, [hit.id]: "joined" }));
        if (room) setActiveRoom({ ...(room as Room), members: [] });
      } else if (status === "rate_limited") setCodeError("Too many tries — wait a few minutes.");
      else setCodeError("Couldn't join this room.");
    } catch { setCodeError("Couldn't join this room."); }
    setCodeLookingUp(false);
  }

  async function handleCreate({ name, courseId, roomType, accessFilters }: {
    name: string; courseId: string; roomType: string; accessFilters: AccessFilters;
  }) {
    const filters: AccessFilters = { ...(accessFilters ?? {}) };
    if (!courseId) delete filters.course;

    let room: Room | null = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      const join_code = generateRoomCode();
      const { data, error } = await supabase.from("study_rooms").insert({
        created_by: userId, name: name.trim(), course_id: courseId ? Number(courseId) : null,
        room_type: roomType, join_code, access_filters: filters,
      }).select().single();
      if (!error) { room = data as Room; break; }
      if (!error.message?.includes("unique") && !error.message?.includes("join_code")) { setJoinError("Couldn't create the room."); return; }
    }
    if (!room) { setJoinError("Couldn't create the room."); return; }
    try { await rpcJoinRoom(userId, room.id); }
    catch { await supabase.from("study_rooms").update({ is_active: false }).eq("id", room.id); setJoinError("Couldn't create the room."); return; }

    setShowCreate(false); setCreatePreset(undefined);
    setPendingReqs(p => ({ ...p, [room!.id]: "joined" }));
    const enriched: EnrichedRoom = {
      ...room, members: [], hostName: profile?.name, school: profile?.school ?? undefined,
      subject: courses.find(c => Number(c.id) === Number(room!.course_id))?.course_code || undefined,
    };
    setRooms(prev => [enriched, ...prev]);
    setActiveRoom(enriched);
  }

  function openFocusRoom() {
    // No pre-filled name — the student names it (or it defaults to "Focus session"
    // on create). Auto-naming from an unselected course read as a mystery room.
    setCreatePreset({ roomType: "invite" });
    setShowCreate(true);
  }

  // ── Derived: facets + filtered list ──
  const facets: Facets = useMemo(() => {
    const subjects = new Set<string>(), schools = new Set<string>(), cities = new Set<string>();
    rooms.forEach(r => { if (r.subject) subjects.add(r.subject); if (r.school) schools.add(r.school); if (r.city) cities.add(r.city); });
    const sort = (s: Set<string>) => Array.from(s).sort((a, b) => a.localeCompare(b));
    return { subjects: sort(subjects), schools: sort(schools), cities: sort(cities) };
  }, [rooms]);

  const filtered = useMemo(() => rooms.filter(r => {
    if (scope === "live" && !(roomCounts[r.id] > 0)) return false;
    if (scope === "school" && (!r.school || r.school.trim().toLowerCase() !== mySchool || !mySchool)) return false;
    if (scope === "subjects" && !(r.course_id != null && myCourseIds.has(Number(r.course_id)))) return false;
    if (facetSel.subject && r.subject !== facetSel.subject) return false;
    if (facetSel.school && r.school !== facetSel.school) return false;
    if (facetSel.city && r.city !== facetSel.city) return false;
    return true;
  }), [rooms, scope, facetSel, roomCounts, mySchool, myCourseIds]);

  const activeFacetCount = (facetSel.subject ? 1 : 0) + (facetSel.school ? 1 : 0) + (facetSel.city ? 1 : 0);

  const courseLabelFor = (r: EnrichedRoom | null) => {
    if (!r || r.course_id == null) return null;
    const c = courses.find(c => Number(c.id) === Number(r.course_id));
    return c ? (c.course_code ? `${c.course_code} — ${c.name}` : (c.name ?? null)) : (r.subject ?? null);
  };

  // ── Room detail view ──
  if (activeRoom) {
    return (
      <ScreenWrapper page="rooms">
        <RoomDetail
          room={activeRoom} courseLabel={courseLabelFor(activeRoom)} userName={profile?.name ?? ""} onlineIds={onlineIds}
          onBack={() => setActiveRoom(null)}
          onLeft={() => { setPendingReqs(p => { const n = { ...p }; delete n[activeRoom.id]; return n; }); setActiveRoom(null); fetchRooms(); }}
          st={st} C={C} sem={sem}
        />
      </ScreenWrapper>
    );
  }

  // ── Lobby ──
  return (
    <ScreenWrapper page="rooms" edgeToEdge>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: NAV_CLEARANCE + insets.bottom + 12 }}
        refreshControl={<ThemedRefreshControl colors={C} refreshing={refreshing} onRefresh={onRefresh} />}
      >

        {/* Title + live pulse */}
        <View style={st.titleBlock}>
          <Text style={st.title}>Study rooms</Text>
          {totalOnline > 0 ? (
            <View style={st.studyingPill}>
              <LiveDot color={C.gold} size={7} />
              <Text style={st.studyingPillText}>{totalOnline} {totalOnline === 1 ? "student" : "students"} studying now</Text>
            </View>
          ) : (
            <Text style={st.subtitle}>Find focus and company — or start your own.</Text>
          )}
        </View>

        {/* Proactive hero */}
        <FocusHero onStart={openFocusRoom} st={st} C={C} />

        {/* Discovery header + controls */}
        <View style={st.discoverHead}>
          <Text style={st.sectionTitle}>Join others</Text>
          <TouchableOpacity onPress={() => { setCreatePreset(undefined); setShowCreate(true); }} style={st.newRoomBtn} hitSlop={6}>
            <Plus size={15} color={C.accent} strokeWidth={2.5} />
            <Text style={st.newRoomText}>New room</Text>
          </TouchableOpacity>
        </View>

        {/* Scope chips + filter */}
        <View style={st.controlRow}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={{ gap: 8, paddingRight: 8 }}>
            {SCOPES.map(s => {
              const on = scope === s.key;
              return (
                <TouchableOpacity key={s.key} onPress={() => setScope(s.key)} style={[st.scopeChip, on && st.scopeChipOn]}>
                  <Text style={[st.scopeText, on && st.scopeTextOn]}>{s.label}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          <TouchableOpacity onPress={() => setShowFilter(true)} style={[st.filterBtn, activeFacetCount > 0 && st.filterBtnOn]}>
            <SlidersHorizontal size={15} color={activeFacetCount > 0 ? C.accent : C.textSecondary} strokeWidth={2} />
            {activeFacetCount > 0 && <View style={st.filterBadge}><Text style={st.filterBadgeText}>{activeFacetCount}</Text></View>}
          </TouchableOpacity>
        </View>

        {/* Active facet summary */}
        {activeFacetCount > 0 && (
          <View style={st.facetSummary}>
            {[facetSel.subject, facetSel.school, facetSel.city].filter(Boolean).map((v, i) => (
              <View key={i} style={st.facetTag}>
                <Text style={st.facetTagText}>{v}</Text>
              </View>
            ))}
            <TouchableOpacity onPress={() => setFacetSel({ subject: null, school: null, city: null })} hitSlop={8}>
              <Text style={st.clearFacets}>Clear</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Error banner */}
        {!!joinError && (
          <View style={[st.errorBanner, { borderColor: sem.dangerLine, backgroundColor: sem.dangerSoft }]}>
            <Lock size={14} color={sem.danger} strokeWidth={2} />
            <Text style={[st.errorBannerText, { color: sem.danger }]}>{joinError}</Text>
          </View>
        )}

        {/* Room list */}
        <View style={{ marginTop: 14 }}>
          {loading ? (
            <View style={{ gap: 10 }}>
              {[0, 1, 2].map(i => <Skeleton key={i} colors={C} height={84} radius={18} />)}
            </View>
          ) : loadError ? (
            <ErrorState colors={C} title="Couldn't load rooms" onRetry={reload} />
          ) : filtered.length === 0 ? (
            <EmptyState
              colors={C}
              Icon={Users}
              title="No rooms here yet"
              message={activeFacetCount || scope !== "all"
                ? "Try a wider filter, or start a room of your own."
                : "Be the first — start a room and others studying the same thing can join."}
            />
          ) : (
            <View style={{ gap: 10 }}>
              {filtered.map(room => (
                <RoomRow
                  key={room.id} room={room} liveCount={roomCounts[room.id] || 0}
                  joining={joiningId === room.id} pendingStatus={pendingReqs[room.id]}
                  onJoin={() => handleJoin(room)} st={st} C={C} sem={sem}
                />
              ))}
            </View>
          )}
        </View>

        {/* Join by code — demoted to a quiet link */}
        <TouchableOpacity onPress={() => setShowCode(v => !v)} style={st.codeToggle} activeOpacity={0.7}>
          <KeyRound size={14} color={C.textSecondary} strokeWidth={2} />
          <Text style={st.codeToggleText}>Have a room code?</Text>
        </TouchableOpacity>
        {showCode && (
          <View style={st.codeRow}>
            <TextInput
              value={codeInput}
              onChangeText={t => { setCodeInput(t.toUpperCase().slice(0, 6)); setCodeError(""); }}
              onSubmitEditing={handleJoinByCode}
              placeholder="A3B2C1" placeholderTextColor={C.textDim}
              maxLength={6} autoCapitalize="characters" autoCorrect={false} autoFocus
              style={st.codeInput}
            />
            <TouchableOpacity onPress={handleJoinByCode} disabled={codeInput.length < 6 || codeLookingUp} style={[st.codeJoinBtn, { opacity: codeInput.length < 6 ? 0.4 : 1 }]}>
              <Text style={st.codeJoinText}>{codeLookingUp ? "…" : "Join"}</Text>
            </TouchableOpacity>
          </View>
        )}
        {!!codeError && <Text style={[st.codeError, { color: sem.danger }]}>{codeError}</Text>}

      </ScrollView>

      {showFilter && (
        <FilterSheet
          facets={facets} sel={facetSel}
          onApply={s => { setFacetSel(s); setShowFilter(false); }}
          onClose={() => setShowFilter(false)} st={st} C={C}
        />
      )}
      {showCreate && (
        <CreateRoomModal
          courses={courses} preset={createPreset} onCreate={handleCreate}
          onClose={() => { setShowCreate(false); setCreatePreset(undefined); }} st={st} C={C}
        />
      )}
    </ScreenWrapper>
  );
}

// ── Styles (theme-driven factory) ─────────────────────────────────────────────
const makeStyles = (C: ThemeColors) => StyleSheet.create({
  // Title
  titleBlock:   { marginBottom: 20 },
  title:        { fontWeight: "700", fontSize: 30, color: C.textPrimary, letterSpacing: -0.6 },
  livePulseRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 },
  studyingPill:     { flexDirection: "row", alignItems: "center", gap: 8, alignSelf: "flex-start", marginTop: 10, paddingVertical: 6, paddingHorizontal: 13, borderRadius: 20, borderWidth: 1, borderColor: "rgba(196,154,60,0.3)", backgroundColor: "rgba(196,154,60,0.12)" },
  studyingPillText: { fontWeight: "600", fontSize: 13, color: C.gold, letterSpacing: 0.1 },
  subtitle:     { fontWeight: "400", fontSize: 14, color: C.textSecondary, marginTop: 8, lineHeight: 20 },

  // Hero
  hero:         { borderRadius: 20, padding: 22, marginBottom: 30 },
  heroGlyph:    { width: 40, height: 40, borderRadius: 12, backgroundColor: C.accentSoft, alignItems: "center", justifyContent: "center", marginBottom: 16 },
  heroKicker:   { fontWeight: "600", fontSize: 13, color: C.accent, marginBottom: 6 },
  heroTitle:    { fontWeight: "700", fontSize: 20, color: C.textPrimary, letterSpacing: -0.3, lineHeight: 26 },
  heroBody:     { fontWeight: "400", fontSize: 14, color: C.textSecondary, lineHeight: 20, marginTop: 8, marginBottom: 18 },
  heroBtn:      { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, backgroundColor: C.accent, borderRadius: 13, paddingVertical: 13, alignSelf: "stretch" },
  heroBtnText:  { fontWeight: "600", fontSize: 15, color: C.bg },

  // Discovery header
  discoverHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
  sectionTitle: { fontWeight: "700", fontSize: 19, color: C.textPrimary, letterSpacing: -0.3 },
  newRoomBtn:   { flexDirection: "row", alignItems: "center", gap: 5 },
  newRoomText:  { fontWeight: "600", fontSize: 14, color: C.accent },

  // Controls
  controlRow:   { flexDirection: "row", alignItems: "center", gap: 8 },
  scopeChip:    { paddingVertical: 8, paddingHorizontal: 15, borderRadius: 20, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border },
  scopeChipOn:  { backgroundColor: C.accentSoft, borderColor: C.accentLine },
  scopeText:    { fontWeight: "500", fontSize: 13, color: C.textSecondary },
  scopeTextOn:  { fontWeight: "600", color: C.accent },
  filterBtn:    { width: 40, height: 38, borderRadius: 12, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  filterBtnOn:  { backgroundColor: C.accentSoft, borderColor: C.accentLine },
  filterBadge:  { position: "absolute", top: -5, right: -5, minWidth: 16, height: 16, borderRadius: 8, backgroundColor: C.accent, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  filterBadgeText: { fontWeight: "700", fontSize: 10, color: C.bg },

  // Active facet summary
  facetSummary: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8, marginTop: 12 },
  facetTag:     { backgroundColor: C.accentSoft, borderWidth: 1, borderColor: C.accentLine, borderRadius: 7, paddingVertical: 4, paddingHorizontal: 9 },
  facetTagText: { fontWeight: "600", fontSize: 12, color: C.accent },
  clearFacets:  { fontWeight: "500", fontSize: 13, color: C.textDim, paddingHorizontal: 4 },

  // Error
  errorBanner:     { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: 12, paddingVertical: 11, paddingHorizontal: 14, marginTop: 12 },
  errorBannerText: { fontWeight: "400", fontSize: 13, flex: 1 },

  // Room list
  loadingText:  { fontWeight: "400", fontSize: 14, color: C.textDim, textAlign: "center", paddingVertical: 44 },
  emptyState:   { borderRadius: 18, paddingVertical: 40, paddingHorizontal: 26, alignItems: "center" },
  emptyTitle:   { fontWeight: "600", fontSize: 16, color: C.textPrimary, marginBottom: 7 },
  emptySub:     { fontWeight: "400", fontSize: 13, color: C.textSecondary, textAlign: "center", lineHeight: 19 },

  row:          { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 16, paddingVertical: 16, paddingHorizontal: 18 },
  rowTitleLine: { flexDirection: "row", alignItems: "center", gap: 6 },
  roomName:     { fontWeight: "600", fontSize: 16, color: C.textPrimary, letterSpacing: -0.2, flexShrink: 1 },
  roomMeta:     { fontWeight: "400", fontSize: 12.5, color: C.textTertiary, marginTop: 4 },
  rowFooter:    { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 12 },
  liveWrap:     { flexDirection: "row", alignItems: "center", gap: 7 },
  liveText:     { fontWeight: "500", fontSize: 13, color: C.accent },
  quietText:    { fontWeight: "400", fontSize: 13, color: C.textDim },

  joinPill:     { paddingVertical: 8, paddingHorizontal: 16, borderRadius: 10, backgroundColor: C.accentSoft, borderWidth: 1, borderColor: C.accentLine, flexShrink: 0 },
  joinPillJoined:{ backgroundColor: "transparent", borderColor: C.accentLine },
  joinPillText: { fontWeight: "600", fontSize: 13, color: C.accent },

  // Avatars
  avatar:       { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center", borderWidth: 2 },
  avatarMore:   { backgroundColor: C.surfaceTranslucent },
  avatarText:   { fontWeight: "700", fontSize: 10.5, color: "#FFFFFF" },

  // Sheets (filter + create)
  sheetOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  // Cap the height so a tall sheet (or the keyboard on autofocus) never pushes its
  // header up under the status bar / Dynamic Island — the body scrolls instead.
  sheet:        { borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 22, paddingTop: 10, paddingBottom: 34, maxHeight: "85%" },
  sheetHandle:  { alignSelf: "center", width: 38, height: 4, borderRadius: 2, backgroundColor: C.borderStrong, marginBottom: 14 },
  sheetHead:    { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 20 },
  sheetTitle:   { fontWeight: "700", fontSize: 20, color: C.textPrimary, letterSpacing: -0.3 },
  sheetGroupHead: { flexDirection: "row", alignItems: "center", gap: 7, marginBottom: 10 },
  sheetGroupLabel:{ fontWeight: "600", fontSize: 14, color: C.textPrimary },
  sheetEmpty:   { fontWeight: "400", fontSize: 13, color: C.textDim },
  chipWrap:     { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  facetChip:    { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 10, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, maxWidth: 240 },
  facetChipOn:  { backgroundColor: C.accentSoft, borderColor: C.accentLine },
  facetChipText:{ fontWeight: "500", fontSize: 13, color: C.textSecondary },
  facetChipTextOn: { fontWeight: "600", color: C.accent },
  sheetActions: { flexDirection: "row", gap: 10, marginTop: 8 },
  sheetGhost:   { flex: 1, borderWidth: 1, borderColor: C.border, borderRadius: 13, paddingVertical: 14, alignItems: "center" },
  sheetGhostText:{ fontWeight: "500", fontSize: 15, color: C.textSecondary },
  sheetPrimary: { flex: 2, backgroundColor: C.accent, borderRadius: 13, paddingVertical: 14, alignItems: "center" },
  sheetPrimaryText: { fontWeight: "600", fontSize: 15, color: C.bg },

  // Create form fields
  fieldLabel:   { fontWeight: "600", fontSize: 13, color: C.textPrimary },
  fieldHint:    { fontWeight: "400", fontSize: 12, color: C.textDim, marginTop: 4, lineHeight: 17 },
  input:        { backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 12, paddingVertical: 13, paddingHorizontal: 14, color: C.textPrimary, fontWeight: "400", fontSize: 15, marginTop: 8, marginBottom: 18 },
  pickRow:      { backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 11, paddingVertical: 11, paddingHorizontal: 13 },
  pickRowOn:    { backgroundColor: C.accentSoft, borderColor: C.accentLine },
  pickRowText:  { fontWeight: "500", fontSize: 14, color: C.textSecondary },
  segment:      { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12, borderRadius: 11, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border },
  segmentOn:    { backgroundColor: C.accentSoft, borderColor: C.accentLine },
  segmentText:  { fontWeight: "500", fontSize: 14, color: C.textDim },
  accessRow:    { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, paddingHorizontal: 13, borderRadius: 12, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border },
  accessRowOn:  { backgroundColor: C.accentSoft, borderColor: C.accentLine },
  accessLabel:  { fontWeight: "600", fontSize: 14 },
  accessDesc:   { fontWeight: "400", fontSize: 12, color: C.textDim, marginTop: 1 },
  check:        { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: C.borderStrong, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  checkOn:      { borderColor: C.accent, backgroundColor: C.accent },

  // Join by code
  codeToggle:   { flexDirection: "row", alignItems: "center", gap: 8, alignSelf: "center", marginTop: 26, paddingVertical: 8 },
  codeToggleText:{ fontWeight: "500", fontSize: 14, color: C.textSecondary },
  codeRow:      { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 10, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 14, paddingVertical: 8, paddingLeft: 16, paddingRight: 8 },
  codeInput:    { flex: 1, minWidth: 0, fontFamily: MONO, fontSize: 18, letterSpacing: 6, color: C.textPrimary, padding: 0 },
  codeJoinBtn:  { backgroundColor: C.accent, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 18 },
  codeJoinText: { fontWeight: "600", fontSize: 14, color: C.bg },
  codeError:    { fontWeight: "400", fontSize: 12, marginTop: 8, textAlign: "center" },

  // Detail — segmented control (People / Chat / Board)
  seg:          { flexDirection: "row", gap: 6, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 4, marginTop: 14, marginBottom: 6 },
  segItem:      { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 9, borderRadius: 9, borderWidth: 1, borderColor: "transparent" },
  segItemOn:    { backgroundColor: C.accentSoft, borderColor: C.accentLine },
  segText:      { fontWeight: "500", fontSize: 13, color: C.textSecondary },
  segTextOn:    { fontWeight: "600", color: C.accent },

  // Detail
  backLink:     { flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start" },
  backLinkText: { fontWeight: "500", fontSize: 15, color: C.textSecondary },
  detailTitle:  { fontWeight: "700", fontSize: 24, color: C.textPrimary, letterSpacing: -0.4, flexShrink: 1 },
  detailStatus: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 5, flexWrap: "wrap" },
  pactStrip:    { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 14, paddingVertical: 11, paddingHorizontal: 15, borderRadius: 13, borderWidth: 1, borderColor: "rgba(196,154,60,0.3)", backgroundColor: "rgba(196,154,60,0.08)" },
  pactText:     { fontWeight: "500", fontSize: 13, color: C.textPrimary, flexShrink: 1 },
  pactTag:      { fontWeight: "700", fontSize: 12, color: C.gold, letterSpacing: 0.3 },
  sectionLabel: { fontWeight: "600", fontSize: 14, color: C.textPrimary, marginBottom: 12 },
  codeCard:     { borderRadius: 14, paddingVertical: 14, paddingHorizontal: 18, alignSelf: "flex-start" },
  codeLabel:    { fontWeight: "500", fontSize: 12, color: C.textDim },
  codeValue:    { fontWeight: "700", fontSize: 22, color: C.accent, letterSpacing: 4, marginTop: 3, fontFamily: MONO },
  memberRow:    { flexDirection: "row", alignItems: "center", gap: 11, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14 },
  tutorGlyph:   { width: 26, height: 26, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  memberName:   { fontWeight: "500", fontSize: 14, color: C.textPrimary, flex: 1, minWidth: 0 },
  hostTag:      { fontWeight: "600", fontSize: 11, color: C.accent, backgroundColor: C.accentSoft, borderWidth: 1, borderColor: C.accentLine, borderRadius: 6, paddingVertical: 2, paddingHorizontal: 7, overflow: "hidden" },
  memberStatus: { fontWeight: "400", fontSize: 12, color: C.textDim },
  webNotice:    { borderRadius: 16, padding: 18 },
  webNoticeTitle:{ fontWeight: "600", fontSize: 15, color: C.textPrimary, marginBottom: 5 },
  webNoticeText:{ fontWeight: "400", fontSize: 13, color: C.textSecondary, lineHeight: 19 },
  leaveBtn:     { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, borderWidth: 1, borderRadius: 12, paddingVertical: 13, alignSelf: "flex-start", paddingHorizontal: 18 },
  leaveBtnText: { fontWeight: "600", fontSize: 14 },
});

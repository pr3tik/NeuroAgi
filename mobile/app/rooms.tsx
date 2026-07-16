// rooms.tsx — Study Rooms lobby, ported from src/pages/StudyRooms.tsx (web).
// Scope: lobby (room list + live presence counts + join-by-code + create room +
// filter tabs) and a static room detail after joining. Live chat / whiteboard /
// voice are web-only for now — the detail screen says so instead of faking it.

import { useState, useEffect, useRef } from "react";
import {
  View, Text, ScrollView, TextInput, TouchableOpacity,
  StyleSheet, Modal, Platform,
} from "react-native";
import {
  School, Users, Link2, BookOpen, Check, KeyRound, Lock, Globe,
  MessageCircle, Pen, Mic, RefreshCw, LogOut, Plus,
} from "lucide-react-native";
import ScreenWrapper from "../components/ScreenWrapper";
import { supabase } from "../services/supabase";
import { useUserId } from "../context/AuthContext";

// ── Design tokens (from tokens.css — web resolves var(--color-accent) etc.) ──
const ACCENT       = "rgba(255,255,255,0.85)";  // --color-accent
const TEXT_PRIMARY = "#F5F5F5";                 // --text-primary
const TEXT_SECOND  = "rgba(255,255,255,0.45)";  // --text-secondary
const TEXT_DIM     = "rgba(255,255,255,0.35)";  // --text-dim
const SURFACE      = "rgba(255,255,255,0.05)";  // --color-surface
const BORDER       = "rgba(255,255,255,0.08)";  // --color-border
const MONO         = Platform.select({ ios: "Menlo", android: "monospace" });

// ── Types ─────────────────────────────────────────────────────────────────────
type AccessFilters = {
  university?: boolean; friends?: boolean; fof?: boolean; course?: boolean;
};

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

type Course = { id: number | string; name: string | null; course_code: string | null };

// ── Access filters (same vocabulary as the web lobby) ─────────────────────────
const ACCESS_OPTIONS: { key: keyof AccessFilters; icon: any; label: string; desc: string; needsCourse?: boolean }[] = [
  { key: "university", icon: School,   label: "Same university",   desc: "Only students at your school" },
  { key: "friends",    icon: Users,    label: "Friends only",       desc: "Only your friends" },
  { key: "fof",        icon: Link2,    label: "Friends of friends", desc: "Friends and their friends" },
  { key: "course",     icon: BookOpen, label: "Course-mates",       desc: "Students taking the linked course", needsCourse: true },
];

function activeFilterKeys(filters?: AccessFilters | null): (keyof AccessFilters)[] {
  if (!filters) return [];
  return ACCESS_OPTIONS.map(o => o.key).filter(k => filters[k]);
}

// ── Room code generator (unambiguous chars, matches web) ─────────────────────
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function generateRoomCode() {
  let code = "";
  for (let i = 0; i < 6; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return code;
}

// ── Server RPC wrappers (mirrors src/api/rooms.ts) ────────────────────────────
async function rpcListRooms(userId: string): Promise<Room[]> {
  const { data, error } = await supabase.rpc("list_accessible_rooms", { p_user: userId });
  if (error) throw error;
  return (data ?? []) as Room[];
}

async function rpcJoinRoom(userId: string, roomId: string, code: string | null = null): Promise<string> {
  const { data, error } = await supabase.rpc("join_room", {
    p_user: userId, p_room: roomId, p_code: code,
  });
  if (error) throw error;
  return (data ?? "denied") as string;
}

async function rpcLeaveRoom(userId: string, roomId: string) {
  const { error } = await supabase.rpc("leave_room", { p_user: userId, p_room: roomId });
  if (error) throw error;
}

function courseLabelFor(courses: Course[], courseId: number | null) {
  if (courseId == null) return null;
  const c = courses.find(c => Number(c.id) === Number(courseId));
  if (!c) return null;
  return c.course_code ? `${c.course_code} — ${c.name}` : (c.name ?? null);
}

// ── FilterBadges — gold chips describing who can join ────────────────────────
function FilterBadges({ filters }: { filters?: AccessFilters | null }) {
  const keys = activeFilterKeys(filters);
  if (!keys.length) return null;
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
      {keys.map(k => {
        const meta = ACCESS_OPTIONS.find(o => o.key === k)!;
        const Icon = meta.icon;
        return (
          <View key={k} style={styles.filterBadge}>
            <Icon size={12} color={ACCENT} />
            <Text style={styles.filterBadgeText}>{meta.label}</Text>
          </View>
        );
      })}
    </View>
  );
}

// ── Room type badge ───────────────────────────────────────────────────────────
function TypeBadge({ isPrivate }: { isPrivate: boolean }) {
  return (
    <View style={[styles.typeBadge, isPrivate ? styles.typeBadgePrivate : styles.typeBadgePublic]}>
      <Text style={[styles.typeBadgeText, { color: isPrivate ? "rgba(210,110,110,0.85)" : "rgba(110,185,120,0.85)" }]}>
        {isPrivate ? "PRIVATE" : "PUBLIC"}
      </Text>
    </View>
  );
}

// ── RoomCard — lobby tile (single-column on phone) ────────────────────────────
function RoomCard({ room, liveCount, joining, pendingStatus, courseLabel, onJoin }: {
  room: Room; liveCount: number; joining: boolean;
  pendingStatus: string | undefined; courseLabel: string | null; onJoin: () => void;
}) {
  const isPrivate = room.room_type === "invite";
  const btnLabel =
    pendingStatus === "accepted"  ? "Joining…" :
    pendingStatus === "joined"    ? "Re-enter" :
    pendingStatus === "requested" ? "Waiting…" :
    joining                       ? "Joining…" :
    isPrivate                     ? "Request" : "Join →";
  const btnDisabled = joining || pendingStatus === "requested" || pendingStatus === "accepted";
  const hasBadges = activeFilterKeys(room.access_filters).length > 0;

  return (
    <View style={styles.roomCard}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
        <Text style={styles.roomName}>{room.name}</Text>
        <TypeBadge isPrivate={isPrivate} />
      </View>

      {courseLabel && <Text style={styles.roomCourse}>{courseLabel}</Text>}

      {hasBadges && (
        <View style={{ marginBottom: 12 }}>
          <FilterBadges filters={room.access_filters} />
        </View>
      )}

      <View style={[styles.divider, { marginTop: courseLabel || hasBadges ? 0 : 8 }]} />

      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        {liveCount > 0 ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <View style={styles.liveDot} />
            <Text style={styles.liveText}>{liveCount} focusing</Text>
          </View>
        ) : (
          <Text style={styles.noOneText}>No one yet</Text>
        )}
        <TouchableOpacity
          onPress={onJoin}
          disabled={btnDisabled}
          activeOpacity={0.7}
          style={[styles.joinBtn, btnDisabled && styles.joinBtnDisabled,
            pendingStatus === "requested" && { opacity: 0.6 }]}
        >
          <Text style={[styles.joinBtnText, btnDisabled && { color: TEXT_DIM }]}>{btnLabel}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ── CreateRoomModal ───────────────────────────────────────────────────────────
function CreateRoomModal({ courses, onCreate, onClose }: {
  courses: Course[];
  onCreate: (opts: { name: string; courseId: string; roomType: string; accessFilters: AccessFilters }) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName]           = useState("");
  const [courseId, setCourseId]   = useState("");
  const [roomType, setRoomType]   = useState("public");
  const [accessFilters, setAccessFilters] = useState<AccessFilters>({});
  const [saving, setSaving]       = useState(false);

  async function handleSubmit() {
    if (!name.trim() || saving) return;
    setSaving(true);
    await onCreate({ name, courseId, roomType, accessFilters });
    setSaving(false);
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          <ScrollView showsVerticalScrollIndicator={false}>
            <Text style={styles.modalTitle}>Create a Room</Text>

            <Text style={styles.fieldLabel}>Room name</Text>
            <TextInput
              autoFocus
              value={name}
              onChangeText={setName}
              placeholder="e.g. CDS151 Study Session"
              placeholderTextColor={TEXT_DIM}
              style={styles.input}
            />

            <Text style={styles.fieldLabel}>Course (optional)</Text>
            <View style={{ gap: 6, marginTop: 6, marginBottom: 14 }}>
              <TouchableOpacity
                onPress={() => setCourseId("")}
                style={[styles.courseOption, courseId === "" && styles.courseOptionOn]}
              >
                <Text style={[styles.courseOptionText, courseId === "" && { color: ACCENT }]}>
                  No course / general
                </Text>
              </TouchableOpacity>
              {courses.map(c => {
                const on = String(c.id) === courseId;
                return (
                  <TouchableOpacity
                    key={String(c.id)}
                    onPress={() => setCourseId(on ? "" : String(c.id))}
                    style={[styles.courseOption, on && styles.courseOptionOn]}
                  >
                    <Text style={[styles.courseOptionText, on && { color: ACCENT }]} numberOfLines={1}>
                      {c.course_code ? `${c.course_code} — ${c.name}` : c.name}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={{ flexDirection: "row", gap: 8, marginBottom: 22 }}>
              {(["public", "invite"] as const).map(t => {
                const on = roomType === t;
                const Icon = t === "public" ? Globe : Lock;
                return (
                  <TouchableOpacity key={t} onPress={() => setRoomType(t)} style={[styles.typeToggle, on && styles.typeToggleOn]}>
                    <Icon size={13} color={on ? ACCENT : TEXT_DIM} />
                    <Text style={[styles.typeToggleText, on && { color: ACCENT }]}>
                      {t === "public" ? "Public" : "Invite only"}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={styles.fieldLabel}>Who can join</Text>
            <Text style={styles.fieldHint}>
              Leave all off for anyone. Pick one or more — a student who matches any of them can join.
            </Text>
            <View style={{ gap: 8, marginBottom: 22 }}>
              {ACCESS_OPTIONS.map(opt => {
                const disabled = !!opt.needsCourse && !courseId;
                const on = !!accessFilters[opt.key] && !disabled;
                const Icon = opt.icon;
                return (
                  <TouchableOpacity
                    key={opt.key}
                    disabled={disabled}
                    onPress={() => setAccessFilters(f => ({ ...f, [opt.key]: !on }))}
                    style={[styles.accessToggle, on && styles.accessToggleOn, disabled && { opacity: 0.4 }]}
                  >
                    <Icon size={17} color={on ? ACCENT : TEXT_SECOND} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={[styles.accessLabel, { color: on ? ACCENT : TEXT_PRIMARY }]}>{opt.label}</Text>
                      <Text style={styles.accessDesc}>{disabled ? "Link a course first" : opt.desc}</Text>
                    </View>
                    <View style={[styles.accessCheck, on && styles.accessCheckOn]}>
                      {on && <Check size={12} color="#111" strokeWidth={3} />}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={{ flexDirection: "row", gap: 10 }}>
              <TouchableOpacity onPress={onClose} style={styles.ghostBtnLarge}>
                <Text style={styles.ghostBtnLargeText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleSubmit}
                disabled={!name.trim() || saving}
                style={[styles.primaryBtnLarge, { opacity: !name.trim() || saving ? 0.4 : 1 }]}
              >
                <Text style={styles.primaryBtnText}>{saving ? "Creating…" : "Create Room →"}</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ── RoomDetail — static in-room view (live features are web-only) ─────────────
function RoomDetail({ room, courseLabel, onlineIds, onBack, onLeft }: {
  room: Room; courseLabel: string | null; onlineIds: string[];
  onBack: () => void; onLeft: () => void;
}) {
  const userId = useUserId();
  const [members, setMembers] = useState<{ id: string; name: string; role: string }[]>([]);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const { data: rows } = await supabase
          .from("room_members")
          .select("user_id, role")
          .eq("room_id", room.id)
          .eq("status", "joined");
        const ids = (rows ?? []).map((r: any) => r.user_id);
        let names: Record<string, string> = {};
        if (ids.length) {
          const { data: users } = await supabase.from("users").select("id, name").in("id", ids);
          (users ?? []).forEach((u: any) => { names[u.id] = u.name; });
        }
        if (cancelled) return;
        setMembers((rows ?? []).map((r: any) => ({
          id: r.user_id, name: names[r.user_id] ?? "Student", role: r.role,
        })));
      } catch { /* RLS or network — show the room without members */ }
    }
    load();
    return () => { cancelled = true; };
  }, [room.id]);

  async function handleLeave() {
    if (leaving) return;
    setLeaving(true);
    try { await rpcLeaveRoom(userId, room.id); } catch { /* non-fatal */ }
    setLeaving(false);
    onLeft();
  }

  const isPrivate = room.room_type === "invite";

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 16, paddingBottom: 8 }}>
      <TouchableOpacity onPress={onBack}>
        <Text style={styles.backLink}>←  Lobby</Text>
      </TouchableOpacity>

      <View>
        <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <Text style={[styles.pageTitle, { flex: 1 }]}>{room.name}</Text>
          <TypeBadge isPrivate={isPrivate} />
        </View>
        {courseLabel && <Text style={[styles.roomCourse, { marginTop: 6, marginBottom: 0 }]}>{courseLabel}</Text>}
      </View>

      {activeFilterKeys(room.access_filters).length > 0 && <FilterBadges filters={room.access_filters} />}

      {room.join_code && (
        <View style={styles.codeCard}>
          <Text style={styles.codeLabel}>ROOM CODE</Text>
          <Text style={styles.codeValue}>{room.join_code}</Text>
        </View>
      )}

      <View>
        <Text style={styles.sectionLabel}>MEMBERS{members.length ? ` (${members.length})` : ""}</Text>
        {members.length === 0 ? (
          <Text style={styles.noOneText}>No members visible yet.</Text>
        ) : (
          <View style={{ gap: 8 }}>
            {members.map(m => {
              const online = onlineIds.includes(m.id);
              return (
                <View key={m.id} style={styles.memberRow}>
                  <View style={[styles.memberDot, { backgroundColor: online ? ACCENT : "rgba(255,255,255,0.15)" }]} />
                  <Text style={styles.memberName} numberOfLines={1}>
                    {m.id === userId ? `${m.name} (you)` : m.name}
                  </Text>
                  {m.role === "host" && <Text style={styles.hostTag}>Host</Text>}
                  <Text style={styles.memberStatus}>{online ? "studying now" : "offline"}</Text>
                </View>
              );
            })}
          </View>
        )}
      </View>

      {/* Live features run on the web app — say so instead of faking it. */}
      <View style={styles.webNotice}>
        <View style={{ flexDirection: "row", gap: 14, marginBottom: 10 }}>
          <MessageCircle size={16} color={ACCENT} />
          <Pen size={16} color={ACCENT} />
          <Mic size={16} color={ACCENT} />
        </View>
        <Text style={styles.webNoticeTitle}>You're in this room</Text>
        <Text style={styles.webNoticeText}>
          Live chat, the shared whiteboard, voice, and the Pomodoro timer run on the
          web app for now. Open FSchoolAI on the web to join the session live.
        </Text>
      </View>

      <TouchableOpacity onPress={handleLeave} disabled={leaving} style={styles.leaveBtn}>
        <LogOut size={14} color="rgba(255,100,90,0.9)" />
        <Text style={styles.leaveBtnText}>{leaving ? "Leaving…" : "Leave room"}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────
const FILTERS = ["all", "public", "private", "friends"] as const;
const FILTER_LABELS: Record<string, string> = { all: "All", public: "Public", private: "Private", friends: "Friends" };
const EMPTY_MSG: Record<string, { title: string; sub: string }> = {
  all:     { title: "No active rooms",    sub: "Create one and start studying together!" },
  public:  { title: "No public rooms",    sub: "Create a public room — anyone can join." },
  private: { title: "No private rooms",   sub: "Create an invite-only room for your group." },
  friends: { title: "No friend rooms yet", sub: "Invite friends from Identity, then start a room together." },
};

export default function RoomsScreen() {
  const userId = useUserId();
  const [rooms, setRooms]             = useState<Room[]>([]);
  const [loading, setLoading]         = useState(true);
  const [loadError, setLoadError]     = useState("");
  const [courses, setCourses]         = useState<Course[]>([]);
  const [activeFilter, setActiveFilter] = useState<string>("all");
  const [joiningId, setJoiningId]     = useState<string | null>(null);
  const [pendingReqs, setPendingReqs] = useState<Record<string, string>>({});
  const [joinError, setJoinError]     = useState("");
  const [codeInput, setCodeInput]     = useState("");
  const [codeError, setCodeError]     = useState("");
  const [codeLookingUp, setCodeLookingUp] = useState(false);
  const [showCreate, setShowCreate]   = useState(false);
  const [activeRoom, setActiveRoom]   = useState<Room | null>(null);
  const [globalState, setGlobalState] = useState<Record<string, any>>({});
  const presenceRef = useRef<any>(null);

  // Live presence — observe the same "global-studying" channel the web uses.
  // We only read presenceState (no track): mobile can't join live sessions yet.
  useEffect(() => {
    let ch: any = null;
    try {
      ch = supabase.channel("global-studying", { config: { presence: { key: `mobile-${userId}` } } });
      ch.on("presence", { event: "sync" }, () => {
        setGlobalState({ ...ch.presenceState() });
      }).subscribe();
      presenceRef.current = ch;
    } catch { /* presence is best-effort */ }
    return () => {
      if (ch) { try { supabase.removeChannel(ch); } catch {} }
      presenceRef.current = null;
    };
  }, [userId]);

  const totalOnline = Object.keys(globalState).length;
  const roomCounts: Record<string, number> = {};
  for (const sessions of Object.values(globalState)) {
    const roomId = Array.isArray(sessions) ? sessions[0]?.roomId : null;
    if (roomId) roomCounts[roomId] = (roomCounts[roomId] || 0) + 1;
  }
  const onlineIds = Object.keys(globalState);

  useEffect(() => {
    fetchRooms();
    fetchPendingRequests();
    fetchCourses();
  }, [userId]);

  // Auto-clear the "not eligible" banner (matches web).
  useEffect(() => {
    if (!joinError) return;
    const t = setTimeout(() => setJoinError(""), 4000);
    return () => clearTimeout(t);
  }, [joinError]);

  async function fetchRooms() {
    setLoading(true);
    setLoadError("");
    try {
      // Server-filtered: only rooms this user is eligible to see.
      setRooms(await rpcListRooms(userId));
    } catch {
      // RPC missing/unreachable — fall back to a plain read of active rooms.
      try {
        const { data, error } = await supabase
          .from("study_rooms").select("*")
          .eq("is_active", true)
          .order("last_active", { ascending: false });
        if (error) throw error;
        setRooms((data ?? []) as Room[]);
      } catch {
        setRooms([]);
        setLoadError("Couldn't load rooms. Pull the refresh button to retry.");
      }
    }
    setLoading(false);
  }

  async function fetchPendingRequests() {
    try {
      const { data } = await supabase
        .from("room_members")
        .select("room_id, status")
        .eq("user_id", userId)
        .in("status", ["requested", "joined"]);
      const map: Record<string, string> = {};
      (data ?? []).forEach((r: any) => { map[r.room_id] = r.status; });
      setPendingReqs(map);
    } catch { /* non-fatal */ }
  }

  async function fetchCourses() {
    try {
      const { data } = await supabase
        .from("courses")
        .select("id, name, course_code")
        .eq("user_id", userId);
      setCourses((data ?? []) as Course[]);
    } catch { /* course labels are optional */ }
  }

  async function handleJoin(room: Room) {
    if (pendingReqs[room.id] === "requested") return;
    if (pendingReqs[room.id] === "joined" || pendingReqs[room.id] === "accepted") {
      setActiveRoom(room); return;
    }
    setJoiningId(room.id);
    setJoinError("");
    try {
      const status = await rpcJoinRoom(userId, room.id);
      if (status === "joined") {
        setPendingReqs(p => ({ ...p, [room.id]: "joined" }));
        setActiveRoom(room);
      } else if (status === "requested") {
        setPendingReqs(p => ({ ...p, [room.id]: "requested" }));
      } else if (status === "denied") {
        setJoinError("You're not eligible to join this room.");
        setRooms(prev => prev.filter(r => r.id !== room.id));
      }
    } catch {
      setJoinError("Couldn't join right now. Try again.");
    }
    setJoiningId(null);
  }

  async function handleJoinByCode() {
    const code = codeInput.trim().toUpperCase();
    if (code.length < 6 || codeLookingUp) return;
    setCodeLookingUp(true);
    setCodeError("");
    try {
      // RLS hides rooms you haven't joined — a direct study_rooms read returns nothing for
      // non-members, so the lookup goes through the rate-limited SECURITY DEFINER RPC.
      const { data: found } = await supabase.rpc("find_room_by_code", { p_code: code });
      const hit = Array.isArray(found) ? found[0] : found;
      if (!hit) { setCodeError("No active room found with that code."); setCodeLookingUp(false); return; }
      // A valid code bypasses room type + access filters (server-side re-verified).
      const status = await rpcJoinRoom(userId, hit.id, code);
      if (status === "joined") {
        // Now a member → the full row is visible.
        const { data: room } = await supabase.from("study_rooms").select("*").eq("id", hit.id).maybeSingle();
        setCodeInput("");
        setPendingReqs(p => ({ ...p, [hit.id]: "joined" }));
        if (room) setActiveRoom(room as Room);
      } else if (status === "rate_limited") {
        setCodeError("Too many attempts — try again in a few minutes.");
      } else {
        setCodeError("Couldn't join this room.");
      }
    } catch {
      setCodeError("Couldn't join this room.");
    }
    setCodeLookingUp(false);
  }

  async function handleCreate({ name, courseId, roomType, accessFilters }: {
    name: string; courseId: string; roomType: string; accessFilters: AccessFilters;
  }) {
    // Course-mates filter is meaningless without a linked course — drop it.
    const filters: AccessFilters = { ...(accessFilters ?? {}) };
    if (!courseId) delete filters.course;

    let room: Room | null = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      const join_code = generateRoomCode();
      const { data, error } = await supabase
        .from("study_rooms")
        .insert({
          created_by:     userId,
          name:           name.trim(),
          course_id:      courseId ? Number(courseId) : null,
          room_type:      roomType,
          join_code,
          access_filters: filters,
        })
        .select()
        .single();
      if (!error) { room = data as Room; break; }
      if (!error.message?.includes("unique") && !error.message?.includes("join_code")) {
        setJoinError("Couldn't create the room."); return;
      }
    }
    if (!room) { setJoinError("Couldn't create the room."); return; }
    // Host membership is written by the RPC (direct room_members writes are revoked).
    try {
      await rpcJoinRoom(userId, room.id);
    } catch {
      await supabase.from("study_rooms").update({ is_active: false }).eq("id", room.id);
      setJoinError("Couldn't create the room.");
      return;
    }
    setShowCreate(false);
    setPendingReqs(p => ({ ...p, [room!.id]: "joined" }));
    setRooms(prev => [room!, ...prev]);
    setActiveRoom(room);
  }

  const filteredRooms = rooms.filter(room => {
    if (activeFilter === "public")  return room.room_type === "public";
    if (activeFilter === "private") return room.room_type === "invite";
    if (activeFilter === "friends") return false;
    return true;
  });
  const emptyMsg = EMPTY_MSG[activeFilter];

  // ── Room detail view ──
  if (activeRoom) {
    return (
      <ScreenWrapper page="rooms">
        <RoomDetail
          room={activeRoom}
          courseLabel={courseLabelFor(courses, activeRoom.course_id)}
          onlineIds={onlineIds}
          onBack={() => setActiveRoom(null)}
          onLeft={() => {
            setPendingReqs(p => { const n = { ...p }; delete n[activeRoom.id]; return n; });
            setActiveRoom(null);
            fetchRooms();
          }}
        />
      </ScreenWrapper>
    );
  }

  // ── Lobby ──
  return (
    <ScreenWrapper page="rooms">
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 8 }}>

        {/* Header */}
        <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 22 }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.sectionLabel}>STUDY ROOMS</Text>
            <Text style={styles.pageTitle}>Study Together</Text>
            {totalOnline > 0 && (
              <View style={styles.onlinePill}>
                <View style={styles.onlineDot} />
                <Text style={styles.onlinePillText}>
                  {totalOnline} {totalOnline === 1 ? "student" : "students"} studying now
                </Text>
              </View>
            )}
          </View>
          <TouchableOpacity onPress={() => setShowCreate(true)} style={styles.primaryBtn}>
            <Plus size={14} color="#111" strokeWidth={2.5} />
            <Text style={styles.primaryBtnText}>Create Room</Text>
          </TouchableOpacity>
        </View>

        {/* Join with code */}
        <Text style={styles.codeSectionLabel}>HAVE A ROOM CODE?</Text>
        <View style={styles.codeInputRow}>
          <KeyRound size={18} color={ACCENT} />
          <TextInput
            value={codeInput}
            onChangeText={t => { setCodeInput(t.toUpperCase().slice(0, 6)); setCodeError(""); }}
            onSubmitEditing={handleJoinByCode}
            placeholder="A3B2C1"
            placeholderTextColor={TEXT_DIM}
            maxLength={6}
            autoCapitalize="characters"
            autoCorrect={false}
            style={styles.codeInput}
          />
          <TouchableOpacity
            onPress={handleJoinByCode}
            disabled={codeInput.length < 6 || codeLookingUp}
            style={[styles.primaryBtn, styles.codeJoinBtn, { opacity: codeInput.length < 6 ? 0.4 : 1 }]}
          >
            <Text style={[styles.primaryBtnText, { fontSize: 13 }]}>{codeLookingUp ? "…" : "Join Room"}</Text>
          </TouchableOpacity>
        </View>
        {!!codeError && <Text style={styles.codeError}>{codeError}</Text>}

        {/* Join / create error banner */}
        {!!joinError && (
          <View style={styles.errorBanner}>
            <Lock size={14} color="rgba(255,120,110,0.95)" />
            <Text style={styles.errorBannerText}>{joinError}</Text>
          </View>
        )}

        {/* Filter tabs + refresh */}
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 18, marginBottom: 14 }}>
          <View style={styles.filterTabs}>
            {FILTERS.map(f => {
              const on = activeFilter === f;
              return (
                <TouchableOpacity key={f} onPress={() => setActiveFilter(f)} style={[styles.filterTab, on && styles.filterTabOn]}>
                  <Text style={[on ? styles.filterTabTextOn : styles.filterTabText]}>{FILTER_LABELS[f]}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <TouchableOpacity onPress={fetchRooms} style={styles.refreshBtn}>
            <RefreshCw size={13} color={TEXT_DIM} />
          </TouchableOpacity>
        </View>

        {/* Room list */}
        {loading ? (
          <Text style={styles.loadingText}>Loading rooms…</Text>
        ) : filteredRooms.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>{loadError ? "Couldn't load rooms" : emptyMsg.title}</Text>
            <Text style={styles.emptySub}>{loadError || emptyMsg.sub}</Text>
          </View>
        ) : (
          <View style={{ gap: 14 }}>
            {filteredRooms.map(room => (
              <RoomCard
                key={room.id}
                room={room}
                liveCount={roomCounts[room.id] || 0}
                joining={joiningId === room.id}
                pendingStatus={pendingReqs[room.id]}
                courseLabel={courseLabelFor(courses, room.course_id)}
                onJoin={() => handleJoin(room)}
              />
            ))}
          </View>
        )}

      </ScrollView>

      {showCreate && (
        <CreateRoomModal
          courses={courses}
          onCreate={handleCreate}
          onClose={() => setShowCreate(false)}
        />
      )}
    </ScreenWrapper>
  );
}

// ── Styles — colors/sizes lifted from the web page's inline styles ────────────
const styles = StyleSheet.create({
  // Header
  sectionLabel:    { fontFamily: "Inter_500Medium", fontSize: 11, color: TEXT_DIM, letterSpacing: 2, marginBottom: 6 },
  pageTitle:       { fontFamily: "Fraunces_300Light_Italic", fontSize: 26, color: TEXT_PRIMARY, letterSpacing: -0.3 },
  onlinePill:      { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", marginTop: 8, backgroundColor: "rgba(196,154,60,0.08)", borderWidth: 1, borderColor: "rgba(196,154,60,0.2)", borderRadius: 20, paddingVertical: 4, paddingLeft: 8, paddingRight: 10 },
  onlineDot:       { width: 7, height: 7, borderRadius: 4, backgroundColor: ACCENT },
  onlinePillText:  { fontFamily: "Inter_700Bold", fontSize: 13, color: ACCENT },
  primaryBtn:      { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: ACCENT, borderRadius: 12, paddingVertical: 11, paddingHorizontal: 18, flexShrink: 0 },
  primaryBtnText:  { fontFamily: "Inter_600SemiBold", fontSize: 14, color: "#111" },

  // Join with code
  codeSectionLabel:{ fontFamily: "Inter_500Medium", fontSize: 11, color: TEXT_DIM, letterSpacing: 1.5, marginBottom: 8 },
  codeInputRow:    { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "rgba(196,154,60,0.04)", borderWidth: 1, borderColor: "rgba(196,154,60,0.18)", borderRadius: 14, paddingVertical: 12, paddingHorizontal: 16 },
  codeInput:       { flex: 1, minWidth: 0, fontFamily: MONO, fontSize: 18, letterSpacing: 6, color: TEXT_PRIMARY, padding: 0 },
  codeJoinBtn:     { paddingVertical: 9, paddingHorizontal: 14 },
  codeError:       { fontFamily: "Inter_400Regular", fontSize: 12, color: "rgba(255,100,90,0.8)", marginTop: 6, paddingLeft: 4 },
  errorBanner:     { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(255,59,48,0.07)", borderWidth: 1, borderColor: "rgba(255,59,48,0.2)", borderRadius: 12, paddingVertical: 11, paddingHorizontal: 16, marginTop: 10 },
  errorBannerText: { fontFamily: "Inter_400Regular", fontSize: 13, color: "rgba(255,120,110,0.95)", flex: 1 },

  // Filter tabs
  filterTabs:      { flexDirection: "row", gap: 2, backgroundColor: "rgba(255,255,255,0.04)", borderWidth: 1, borderColor: "rgba(255,255,255,0.07)", borderRadius: 20, padding: 3 },
  filterTab:       { paddingVertical: 5, paddingHorizontal: 14, borderRadius: 16, borderWidth: 1, borderColor: "transparent" },
  filterTabOn:     { backgroundColor: "rgba(196,154,60,0.15)", borderColor: "rgba(196,154,60,0.28)" },
  filterTabText:   { fontFamily: "Inter_500Medium", fontSize: 12, color: TEXT_SECOND },
  filterTabTextOn: { fontFamily: "Inter_600SemiBold", fontSize: 12, color: ACCENT },
  refreshBtn:      { borderWidth: 1, borderColor: "rgba(255,255,255,0.09)", borderRadius: 8, paddingVertical: 5, paddingHorizontal: 10 },

  // Room list / cards
  loadingText:     { fontFamily: "Inter_400Regular", fontSize: 14, color: TEXT_DIM, textAlign: "center", paddingVertical: 40 },
  emptyState:      { backgroundColor: SURFACE, borderWidth: 1, borderColor: BORDER, borderRadius: 16, paddingVertical: 40, paddingHorizontal: 24, alignItems: "center" },
  emptyTitle:      { fontFamily: "Inter_600SemiBold", fontSize: 15, color: TEXT_SECOND, marginBottom: 6 },
  emptySub:        { fontFamily: "Inter_400Regular", fontSize: 13, color: TEXT_DIM, textAlign: "center" },

  roomCard:        { backgroundColor: SURFACE, borderWidth: 1, borderColor: BORDER, borderRadius: 14, padding: 20 },
  roomName:        { fontFamily: "Fraunces_300Light_Italic", fontSize: 15, color: TEXT_PRIMARY, lineHeight: 20, flex: 1, minWidth: 0 },
  roomCourse:      { fontFamily: "Inter_400Regular", fontSize: 12, color: TEXT_DIM, lineHeight: 17, marginBottom: 12 },
  divider:         { height: 1, backgroundColor: "rgba(255,255,255,0.05)", marginBottom: 12 },
  liveDot:         { width: 7, height: 7, borderRadius: 4, backgroundColor: ACCENT },
  liveText:        { fontFamily: "Inter_400Regular", fontSize: 12, color: ACCENT },
  noOneText:       { fontFamily: "Inter_400Regular", fontSize: 12, color: TEXT_DIM },
  joinBtn:         { backgroundColor: "rgba(196,154,60,0.1)", borderWidth: 1, borderColor: "rgba(196,154,60,0.25)", borderRadius: 8, paddingVertical: 7, paddingHorizontal: 16, flexShrink: 0 },
  joinBtnDisabled: { backgroundColor: "rgba(255,255,255,0.04)", borderColor: "rgba(255,255,255,0.07)" },
  joinBtnText:     { fontFamily: "Inter_600SemiBold", fontSize: 12, color: ACCENT },

  typeBadge:        { paddingVertical: 3, paddingHorizontal: 8, borderRadius: 5, borderWidth: 1, flexShrink: 0 },
  typeBadgePrivate: { backgroundColor: "rgba(196,100,100,0.08)", borderColor: "rgba(196,100,100,0.15)" },
  typeBadgePublic:  { backgroundColor: "rgba(127,174,110,0.08)", borderColor: "rgba(127,174,110,0.15)" },
  typeBadgeText:    { fontFamily: "Inter_700Bold", fontSize: 10, letterSpacing: 0.6 },

  filterBadge:     { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(196,154,60,0.08)", borderWidth: 1, borderColor: "rgba(196,154,60,0.18)", borderRadius: 6, paddingVertical: 2, paddingHorizontal: 7 },
  filterBadgeText: { fontFamily: "Inter_600SemiBold", fontSize: 10, color: ACCENT },

  // Create modal
  modalOverlay:    { flex: 1, backgroundColor: "rgba(8,8,10,0.85)", alignItems: "center", justifyContent: "center", padding: 24 },
  modalCard:       { width: "100%", maxWidth: 400, maxHeight: "88%", backgroundColor: "#1A1A1C", borderWidth: 1, borderColor: BORDER, borderRadius: 20, paddingVertical: 28, paddingHorizontal: 24 },
  modalTitle:      { fontFamily: "Inter_700Bold", fontSize: 20, color: TEXT_PRIMARY, marginBottom: 22 },
  fieldLabel:      { fontFamily: "Inter_500Medium", fontSize: 12, color: TEXT_SECOND },
  fieldHint:       { fontFamily: "Inter_400Regular", fontSize: 11, color: TEXT_DIM, marginTop: 4, marginBottom: 10, lineHeight: 16 },
  input:           { backgroundColor: "rgba(255,255,255,0.05)", borderWidth: 1, borderColor: "rgba(255,255,255,0.1)", borderRadius: 10, paddingVertical: 11, paddingHorizontal: 14, color: TEXT_PRIMARY, fontFamily: "Inter_400Regular", fontSize: 14, marginTop: 6, marginBottom: 14 },
  courseOption:    { backgroundColor: "rgba(255,255,255,0.03)", borderWidth: 1, borderColor: "rgba(255,255,255,0.08)", borderRadius: 10, paddingVertical: 9, paddingHorizontal: 12 },
  courseOptionOn:  { backgroundColor: "rgba(196,154,60,0.12)", borderColor: "rgba(196,154,60,0.3)" },
  courseOptionText:{ fontFamily: "Inter_500Medium", fontSize: 13, color: TEXT_SECOND },
  typeToggle:      { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingVertical: 9, borderRadius: 9, backgroundColor: "rgba(255,255,255,0.04)", borderWidth: 1, borderColor: "rgba(255,255,255,0.08)" },
  typeToggleOn:    { backgroundColor: "rgba(196,154,60,0.14)", borderColor: "rgba(196,154,60,0.3)" },
  typeToggleText:  { fontFamily: "Inter_500Medium", fontSize: 13, color: TEXT_DIM },
  accessToggle:    { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.03)", borderWidth: 1, borderColor: "rgba(255,255,255,0.08)" },
  accessToggleOn:  { backgroundColor: "rgba(196,154,60,0.12)", borderColor: "rgba(196,154,60,0.3)" },
  accessLabel:     { fontFamily: "Inter_600SemiBold", fontSize: 13 },
  accessDesc:      { fontFamily: "Inter_400Regular", fontSize: 11, color: TEXT_DIM, marginTop: 1 },
  accessCheck:     { width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, borderColor: "rgba(255,255,255,0.2)", alignItems: "center", justifyContent: "center", flexShrink: 0 },
  accessCheckOn:   { borderColor: ACCENT, backgroundColor: ACCENT },
  ghostBtnLarge:   { flex: 1, borderWidth: 1, borderColor: "rgba(255,255,255,0.1)", borderRadius: 10, paddingVertical: 12, alignItems: "center" },
  ghostBtnLargeText:{ fontFamily: "Inter_400Regular", fontSize: 14, color: TEXT_DIM },
  primaryBtnLarge: { flex: 2, backgroundColor: ACCENT, borderRadius: 10, paddingVertical: 12, alignItems: "center" },

  // Room detail
  backLink:        { fontFamily: "Inter_500Medium", fontSize: 14, color: TEXT_SECOND },
  codeCard:        { backgroundColor: "rgba(255,255,255,0.03)", borderWidth: 1, borderColor: BORDER, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14 },
  codeLabel:       { fontFamily: "Inter_500Medium", fontSize: 10, color: TEXT_DIM, letterSpacing: 1.5 },
  codeValue:       { fontFamily: "Fraunces_300Light_Italic", fontSize: 18, color: ACCENT, letterSpacing: 3, marginTop: 2 },
  memberRow:       { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: SURFACE, borderWidth: 1, borderColor: BORDER, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 14, marginTop: 8 },
  memberDot:       { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
  memberName:      { fontFamily: "Inter_500Medium", fontSize: 13, color: TEXT_PRIMARY, flex: 1, minWidth: 0 },
  hostTag:         { fontFamily: "Inter_600SemiBold", fontSize: 10, color: ACCENT, backgroundColor: "rgba(196,154,60,0.08)", borderWidth: 1, borderColor: "rgba(196,154,60,0.18)", borderRadius: 6, paddingVertical: 2, paddingHorizontal: 7, overflow: "hidden" },
  memberStatus:    { fontFamily: "Inter_400Regular", fontSize: 11, color: TEXT_DIM },
  webNotice:       { backgroundColor: "rgba(196,154,60,0.06)", borderWidth: 1, borderColor: "rgba(196,154,60,0.2)", borderRadius: 14, padding: 18 },
  webNoticeTitle:  { fontFamily: "Inter_600SemiBold", fontSize: 15, color: TEXT_PRIMARY, marginBottom: 4 },
  webNoticeText:   { fontFamily: "Inter_400Regular", fontSize: 13, color: TEXT_SECOND, lineHeight: 19 },
  leaveBtn:        { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: "rgba(255,59,48,0.1)", borderWidth: 1, borderColor: "rgba(255,59,48,0.22)", borderRadius: 8, paddingVertical: 9, paddingHorizontal: 16, alignSelf: "flex-start" },
  leaveBtnText:    { fontFamily: "Inter_600SemiBold", fontSize: 13, color: "rgba(255,100,90,0.9)" },
});

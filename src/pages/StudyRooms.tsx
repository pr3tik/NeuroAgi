// StudyRooms.jsx — Phase 2A: Shared Pomodoro + Goals + Session Summary
// Architecture: root manages global-studying presence channel once; Lobby +
// RoomView receive counts as props. Keeps room core + friends layer modular.

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { useApp } from "../context/AppContext";
import { supabase } from "../api/supabase";
import { awardTokens } from "../api/tokens";
import { sendNudge } from "../api/nudge";
import {
  createRoom,
  listAccessibleRooms,
  joinRoom,
  respondRoomRequest,
  inviteToRoom,
  leaveRoom,
  setRoomAccess,
} from "../api/rooms";
import type { AccessFilters } from "../api/rooms";
import { loadRecentMessages, postRoomMessage, uploadChatImage } from "../api/chat";
import type { ChatMessage } from "../api/chat";
import type { Stroke, Point, PenStyle } from "../api/whiteboard";
import {
  startRoomSession,
  endRoomSession,
  getRoomSources,
  bindRoomSources,
} from "../api/roomSession";
import * as Y from "yjs";
import { SupabaseBroadcastProvider } from "../lib/yjsSupabaseProvider";
import { GOLD } from "../lib/theme";
import Whiteboard, { PEN_COLORS, PEN_WIDTHS, ERASER_SIZES, DEFAULT_BG } from "../components/Whiteboard";
import type { Tool } from "../components/Whiteboard";
import StudyOrb from "../components/StudyOrb";
import { startRoomVoice, type RoomVoice } from "../lib/roomVoice";
import { startScribeSession, isStreamingSTT, type ScribeSession } from "../lib/scribeStream";
import { RoomTranscript, type Utterance } from "../lib/roomTranscript";
import { electDriver, parseWakeWord, buildAiPrompt, detectConfusion, buildProactivePrompt, isProactiveSilent, isSolveDone, buildSolvePrompt, stripSolvedToken, hasSolvedToken } from "../lib/roomAiTrigger";
import { createSentenceChunker } from "../lib/ttsChunker";
import RoomGroundingChips from "../components/RoomGroundingChips";
import type { GroundingRef } from "../lib/roomGrounding";
import { MUSIC_PRESETS, stopAudio, cycleIndex } from "../lib/focusMusic";
import { interventionReason, shouldShowIntervention, type InterventionPayload } from "../lib/roomIntervention";
import SessionReview from "../components/SessionReview";
import {
  School, Users, Link2, BookOpen, Check, KeyRound, Lock, Globe, Mail,
  MessageCircle, Pen, Mic, MicOff, Settings, X, Plus, MoreHorizontal, Target, Flame,
  Timer, Coins, ThumbsUp, ThumbsDown, Image as ImageIcon, Hand, Zap, Hourglass,
  RefreshCw, LogOut, Sparkles, Video, Volume2, VolumeX, Music, Play, Pause, SkipForward,
} from "lucide-react";

// ── Access filters ────────────────────────────────────────────────────────────
// Which eligibility rules an owner can put on a room. Server enforces these via
// the join_room / list_accessible_rooms RPCs; this is just the UI vocabulary.
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

// Compact badge row describing the active filters on a room.
function FilterBadges({ filters, small = false }: { filters?: AccessFilters | null; small?: boolean }) {
  const keys = activeFilterKeys(filters);
  if (!keys.length) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
      {keys.map(k => {
        const meta = ACCESS_OPTIONS.find(o => o.key === k)!;
        return (
          <span key={k} style={{
            display: "inline-flex", alignItems: "center", gap: "4px",
            fontSize: small ? "10px" : "11px", fontWeight: 600,
            padding: small ? "2px 7px" : "3px 9px", borderRadius: "6px",
            background: "rgba(var(--gold-rgb), 0.08)", color: "var(--color-accent)",
            border: "1px solid rgba(var(--gold-rgb), 0.18)", whiteSpace: "nowrap",
          }}>
            <meta.icon size={small ? 12 : 13} /> {meta.label}
          </span>
        );
      })}
    </div>
  );
}

// Toggle grid reused by CreateRoomModal + the in-room access settings.
function AccessToggles({ value, onChange, hasCourse }: {
  value: AccessFilters; onChange: (next: AccessFilters) => void; hasCourse: boolean;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      {ACCESS_OPTIONS.map(opt => {
        const disabled = opt.needsCourse && !hasCourse;
        const on = !!value[opt.key] && !disabled;
        return (
          <button
            key={opt.key}
            type="button"
            disabled={disabled}
            onClick={() => onChange({ ...value, [opt.key]: !on })}
            style={{
              display: "flex", alignItems: "center", gap: "10px", textAlign: "left",
              padding: "10px 12px", borderRadius: "10px", cursor: disabled ? "not-allowed" : "pointer",
              fontFamily: "inherit", width: "100%",
              background: on ? "rgba(var(--gold-rgb), 0.12)" : "rgba(255,255,255,0.03)",
              border: `1px solid ${on ? "rgba(var(--gold-rgb), 0.3)" : "rgba(255,255,255,0.08)"}`,
              opacity: disabled ? 0.4 : 1, transition: "all 0.15s",
            }}
          >
            <span style={{ display: "flex", flexShrink: 0 }}><opt.icon size={17} /></span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", fontSize: "13px", fontWeight: 600, color: on ? "var(--color-accent)" : "var(--text-primary)" }}>
                {opt.label}
              </span>
              <span style={{ display: "block", fontSize: "11px", color: "var(--text-dim)", marginTop: "1px" }}>
                {disabled ? "Link a course first" : opt.desc}
              </span>
            </span>
            <span style={{
              width: 18, height: 18, borderRadius: "50%", flexShrink: 0,
              border: `1.5px solid ${on ? "var(--color-accent)" : "rgba(255,255,255,0.2)"}`,
              background: on ? "var(--color-accent)" : "transparent",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              {on && <Check size={12} color="#111" strokeWidth={3} />}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ── Room code generator ───────────────────────────────────────────────────────
// Unambiguous chars (no 0/O, 1/I/L). 6 chars = 32^6 = ~1B combinations.
/* const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function generateRoomCode() {
  let code = "";
  for (let i = 0; i < 6; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return code;
} */

// ── Pomodoro helpers ──────────────────────────────────────────────────────────
// pomo shape: { phase:'focus'|'break'|'idle', paused:bool,
//   startedAt:ms|null, durationSec:number, pausedRemaining:number|null }
function getRemaining(p) {
  if (!p || p.phase === "idle") return null;
  if (p.paused) return p.pausedRemaining ?? p.durationSec;
  const elapsed = (Date.now() - p.startedAt) / 1000;
  return Math.max(0, p.durationSec - elapsed);
}

function formatPomoTime(secs) {
  if (secs == null) return "--:--";
  const total = Math.ceil(secs);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// ── Friends adapter ───────────────────────────────────────────────────────────
// Wraps Siddharth's friends.js so the invite UI doesn't depend on its internals.
async function getFriendsForInvite(userId) {
  try {
    const { listFriends, getUserProfiles } = await import("../api/friends.js");
    const rows = await listFriends(userId);
    if (!rows?.length) return [];
    const ids      = rows.map(r => r.friend_id);
    const profiles = await getUserProfiles(ids);
    return rows.map(r => ({
      id:           r.friend_id,
      name:         profiles[r.friend_id]?.name  ?? "Unknown",
      email:        profiles[r.friend_id]?.email ?? "",
      friends_since: r.friends_since,
    }));
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Root — owns global-studying presence channel shared across Lobby ↔ RoomView
// ─────────────────────────────────────────────────────────────────────────────
export default function StudyRooms() {
  const { userId, userData, setActiveRoomId, setWhiteboardSnapshot } = useApp();
  const [view,        setView]        = useState("lobby");
  const [activeRoom,  setActiveRoom]  = useState(null);
  const [globalState, setGlobalState] = useState({});
  const [pendingInvites, setPendingInvites] = useState([]);
  const globalCh   = useRef(null);
  const personalCh = useRef(null);

  useEffect(() => {
    if (!userId) return;
    const ch = supabase.channel("global-studying", {
      config: { presence: { key: userId } },
    });
    ch.on("presence", { event: "sync" }, () => {
      setGlobalState({ ...ch.presenceState() });
    }).subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await ch.track({ userId, roomId: null });
      }
    });
    globalCh.current = ch;
    return () => {
      try { ch.untrack(); } catch {}
      supabase.removeChannel(ch);
      globalCh.current = null;
    };
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    const ch = supabase.channel(`user:${userId}`);
    ch.on("broadcast", { event: "nudge" }, ({ payload }) => {
      if (payload?.kind === "invite") {
        setPendingInvites(prev => [{
          id: payload.id ?? `${payload.fromUserId}-${Date.now()}`,
          from_user_id: payload.fromUserId,
          fromName:     payload.fromName ?? "Someone",
          room_id:      payload.roomId,
          roomName:     payload.roomName,
          created_at:   new Date().toISOString(),
        }, ...prev].slice(0, 5));
      }
    })
    .on("postgres_changes", {
      event: "INSERT", schema: "public", table: "nudges",
      filter: `to_user_id=eq.${userId}`,
    }, (payload) => {
      if (payload.new?.kind === "invite") {
        setPendingInvites(prev => [{ ...payload.new, fromName: null }, ...prev].slice(0, 5));
      }
    })
    .subscribe();
    personalCh.current = ch;
    return () => {
      supabase.removeChannel(ch);
      personalCh.current = null;
    };
  }, [userId]);

  async function trackGlobal(roomId = null) {
    if (globalCh.current) {
      try { await globalCh.current.track({ userId, roomId }); } catch {}
    }
  }

  const totalOnline = Object.keys(globalState).length;
  const roomCounts  = {};
  for (const sessions of Object.values(globalState)) {
    const roomId = sessions?.[0]?.roomId;
    if (roomId) roomCounts[roomId] = (roomCounts[roomId] || 0) + 1;
  }

  const handleJoin = useCallback(async (room) => {
    await trackGlobal(room.id);
    setActiveRoom(room);
    setView("room");
  }, [userId]); // eslint-disable-line

  const handleLeave = useCallback(async () => {
    await trackGlobal(null);
    setActiveRoom(null);
    setView("lobby");
    // This is the actual "no longer in a room" signal — unlike RoomView
    // unmounting from a page switch, this only fires when the student truly
    // leaves, so it's the right place to drop the Study Assistant bridge.
    setActiveRoomId(null);
    setWhiteboardSnapshot(null);
  }, [userId]); // eslint-disable-line

  const dismissInviteRoot = useCallback((id) => {
    setPendingInvites(prev => prev.filter(i => i.id !== id));
    supabase.from("nudges").update({ seen: true }).eq("id", id).then(() => {});
  }, []);

  if (view === "room" && activeRoom) {
    return <RoomView room={activeRoom} onLeave={handleLeave} roomCounts={roomCounts} onlineIds={Object.keys(globalState)} />;
  }
  return (
    <Lobby
      onJoin={handleJoin}
      totalOnline={totalOnline}
      roomCounts={roomCounts}
      globalState={globalState}
      pendingInvites={pendingInvites}
      onDismissInvite={dismissInviteRoot}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Lobby
// ─────────────────────────────────────────────────────────────────────────────
function Lobby({ onJoin, totalOnline, roomCounts, globalState = {}, pendingInvites = [], onDismissInvite }) {
  const { userId, userData, courses, studyConfig, setStudyConfig } = useApp();
  const [rooms,       setRooms]       = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [showCreate,  setShowCreate]  = useState(false);
  const [createInitCourse, setCreateInitCourse] = useState("");

  useEffect(() => {
    if (studyConfig?.action === "create") {
      setCreateInitCourse(studyConfig.course ?? "");
      setShowCreate(true);
      setStudyConfig(null);
    }
  }, []); // eslint-disable-line
  const [joiningId,    setJoiningId]    = useState(null);
  const [pendingReqs,  setPendingReqs]  = useState({});
  const [codeInput,    setCodeInput]    = useState("");
  const [codeError,    setCodeError]    = useState("");
  const [joinError,    setJoinError]    = useState("");
  const [codeLookingUp, setCodeLookingUp] = useState(false);
  const [activeFilter, setActiveFilter] = useState("all");
  const [friends,      setFriends]      = useState([]);
  const [nudged,       setNudged]       = useState({});  // friendId → "sending"|"sent"|"limited"
  const lobbyChannelRef = useRef(null);
  const onJoinRef       = useRef(onJoin);
  useEffect(() => { onJoinRef.current = onJoin; }, [onJoin]);

  useEffect(() => {
    fetchRooms();
    fetchPendingRequests();
    subscribeToLobby();
    return () => {
      if (lobbyChannelRef.current) supabase.removeChannel(lobbyChannelRef.current);
    };
  }, []); // eslint-disable-line

  // Friends-studying strip: load the user's friends; presence comes from globalState.
  useEffect(() => {
    getFriendsForInvite(userId).then(setFriends).catch(() => {});
  }, [userId]);

  // Map each friend → the room they're studying in right now (if any).
  const friendRoomMap = {};
  for (const f of friends) {
    const roomId = Array.isArray(globalState[f.id]) ? globalState[f.id][0]?.roomId : null;
    if (roomId) friendRoomMap[f.id] = roomId;
  }
  const studyingFriends = friends.filter(f => friendRoomMap[f.id]);
  const offlineFriends  = friends.filter(f => !friendRoomMap[f.id]);

  async function joinFriendRoom(roomId) {
    let room = rooms.find(r => r.id === roomId);
    if (!room) {
      const { data } = await supabase.from("study_rooms").select().eq("id", roomId).maybeSingle();
      room = data;
    }
    if (room) onJoin(room);
  }

  async function nudgeFriend(friend) {
    setNudged(n => ({ ...n, [friend.id]: "sending" }));
    // A friend is "online" if they have an active presence entry in the global-studying
    // channel — regardless of whether they're in a room or just in the lobby.
    // This prevents sending an email when the friend is right there in the app.
    const recipientOnline = Object.prototype.hasOwnProperty.call(globalState, friend.id);
    const result = await sendNudge({
      fromUserId: userId, toUserId: friend.id, roomId: null,
      fromName: userData?.name ?? "Someone", roomName: null, recipientOnline,
    });
    setNudged(n => ({ ...n, [friend.id]: result?.sent === false && result.reason === "rate_limited" ? "limited" : "sent" }));
  }

  async function fetchRooms() {
    setLoading(true);
    try {
      // Server-filtered: only rooms this user is eligible to see.
      const data = await listAccessibleRooms(userId);
      setRooms(data || []);
    } catch (err) {
      console.error("[rooms] list:", (err as any)?.message);
      setRooms([]);
    }
    setLoading(false);
  }

  // Auto-clear the "not eligible" banner.
  useEffect(() => {
    if (!joinError) return;
    const t = setTimeout(() => setJoinError(""), 4000);
    return () => clearTimeout(t);
  }, [joinError]);

  async function fetchPendingRequests() {
    const { data } = await supabase
      .from("room_members")
      .select("room_id, status")
      .eq("user_id", userId)
      .in("status", ["requested", "joined"]);
    const map = {};
    (data || []).forEach(r => { map[r.room_id] = r.status; });
    setPendingReqs(map);
  }

  function subscribeToLobby() {
    const ch = supabase.channel("lobby-watch-" + userId);
    let roomsRefetchTimer: any = null;
    ch.on("postgres_changes", {
      event: "INSERT", schema: "public", table: "study_rooms",
    }, () => {
      // A new room appeared — refetch through the access RPC so we never show a
      // room this user isn't eligible for (can't tell from the raw row alone).
      // Debounced: every lobby visitor holds this subscription, so a burst of room
      // creations used to stampede (lobby users × full RPC) — coalesce within 3s.
      if (roomsRefetchTimer) return;
      roomsRefetchTimer = setTimeout(() => { roomsRefetchTimer = null; fetchRooms(); }, 3000);
    });
    ch.on("postgres_changes", {
      event: "UPDATE", schema: "public", table: "room_members",
      filter: `user_id=eq.${userId}`,
    }, (payload) => {
      if (payload.new?.status === "joined" && pendingReqs[payload.new.room_id] === "requested") {
        setPendingReqs(p => ({ ...p, [payload.new.room_id]: "accepted" }));
        setRooms(prev => {
          const room = prev.find(r => r.id === payload.new.room_id);
          if (room) setTimeout(() => onJoinRef.current(room), 1200);
          return prev;
        });
      }
    });
    ch.subscribe();
    lobbyChannelRef.current = ch;
  }

  async function handleCreate({
    name,
    courseId,
    roomType,
    accessFilters,
    documentIds = [],
  }) {
    try {
      const room = await createRoom({
        name,
        courseId,
        roomType,
        accessFilters,
      });

      if (Array.isArray(documentIds) && documentIds.length > 0) {
        try {
          await bindRoomSources(room.id, documentIds);
        } catch (error) {
          console.error(
            "[rooms] failed to bind sources:",
            (error as Error)?.message
          );
        }
      }

      setShowCreate(false);
      onJoin(room);
    } catch (error) {
      console.error(
        "[rooms] create:",
        (error as Error)?.message
      );
    }
  }

  async function handleJoin(room) {
    if (pendingReqs[room.id] === "requested") return;
    if (pendingReqs[room.id] === "accepted" || pendingReqs[room.id] === "joined") {
      onJoin(room); return;
    }
    setJoiningId(room.id);
    setJoinError("");
    try {
      const status = await joinRoom(userId, room.id);
      if (status === "joined") { setJoiningId(null); onJoin(room); return; }
      if (status === "requested") {
        setPendingReqs(p => ({ ...p, [room.id]: "requested" }));
        // Ping the host so they see the request promptly.
        supabase.from("nudges").insert({
          from_user_id: userId, to_user_id: room.created_by,
          room_id: room.id, kind: "nudge",
        }).then(() => {});
        setJoiningId(null);
        return;
      }
      if (status === "denied") {
        setJoinError("You're not eligible to join this room.");
        setRooms(prev => prev.filter(r => r.id !== room.id)); // hide what we can't access
      }
      setJoiningId(null);
    } catch (err) {
      console.error("[rooms] join:", (err as any)?.message);
      setJoiningId(null);
    }
  }

  async function acceptInvite(invite) {
    onDismissInvite?.(invite.id);
    // An 'invited' row already exists → join_room flips it to joined.
    try { await joinRoom(userId, invite.room_id); } catch (err) { console.error("[rooms] accept invite:", (err as any)?.message); }
    const { data: room } = await supabase
      .from("study_rooms").select().eq("id", invite.room_id).single();
    if (room) onJoin(room);
  }

  async function handleJoinByCode() {
    const code = codeInput.trim().toUpperCase();
    if (code.length < 6) return;
    setCodeLookingUp(true);
    setCodeError("");
    // RLS hides rooms you haven't joined, so a direct study_rooms read finds nothing for
    // exactly the people join-by-code exists for. find_room_by_code is a SECURITY DEFINER
    // lookup (rate-limited server-side; empty result when over budget).
    const { data: found, error: lookupErr } = await supabase.rpc("find_room_by_code", { p_code: code });
    setCodeLookingUp(false);
    const hit = Array.isArray(found) ? found[0] : found;
    if (lookupErr || !hit) { setCodeError("No active room found with that code."); return; }
    // A valid code bypasses room type + access filters (server-side re-verified).
    try {
      const status = await joinRoom(userId, hit.id, code);
      if (status !== "joined") { setCodeError(status === "rate_limited" ? "Too many attempts — try again in a few minutes." : "Couldn't join this room."); return; }
      // Now a member → the room row is visible; fetch the full row for onJoin.
      const { data: room } = await supabase.from("study_rooms").select().eq("id", hit.id).maybeSingle();
      if (room) { setCodeInput(""); onJoin(room); }
      else { setCodeError("Joined — refresh to see the room."); }
    } catch (err) {
      console.error("[rooms] join by code:", (err as any)?.message);
      setCodeError("Couldn't join this room.");
    }
  }

  const S = styles;

  const FILTERS      = ["all", "public", "private", "friends"];
  const FILTER_LABELS: Record<string, string> = { all: "All", public: "Public", private: "Private", friends: "Friends" };

  const filteredRooms = rooms.filter(room => {
    if (activeFilter === "public")  return room.room_type === "public";
    if (activeFilter === "private") return room.room_type === "invite";
    if (activeFilter === "friends") return false;
    return true;
  });

  const emptyMsg = ({
    all:     { title: "No active rooms", sub: "Create one and start studying together!" },
    public:  { title: "No public rooms", sub: "Create a public room — anyone can join." },
    private: { title: "No private rooms", sub: "Create an invite-only room for your group." },
    friends: { title: "No friend rooms yet", sub: "Invite friends from Identity, then start a room together." },
  } as Record<string, { title: string; sub: string }>)[activeFilter];

  return (
    <div>
      {/* ── Header ─────────────────────────────────────────────── */}
      <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:"12px", marginBottom:"22px" }}>
        <div>
          <p style={S.sectionLabel}>Study Rooms</p>
          <h1 style={S.pageTitle}>Study Together</h1>
          {totalOnline > 0 && (
            <div style={{
              display:"inline-flex", alignItems:"center", gap:"6px", marginTop:"8px",
              background:"rgba(var(--gold-rgb), 0.08)", border:"1px solid rgba(var(--gold-rgb), 0.2)",
              borderRadius:"20px", padding:"4px 10px 4px 8px",
            }}>
              <span style={{ width:7, height:7, borderRadius:"50%", background:"var(--color-accent)", flexShrink:0,
                display:"inline-block", boxShadow:"0 0 0 2px rgba(var(--gold-rgb), 0.2)" }} />
              <span style={{ fontSize:"13px", fontWeight:"700", color:"var(--color-accent)" }}>
                {totalOnline} {totalOnline === 1 ? "student" : "students"} studying now
              </span>
            </div>
          )}
        </div>
        <button
          onClick={() => {
            console.log("Create Room clicked");
            setShowCreate(true);
          }}
          style={{ ...S.primaryBtn, whiteSpace: "nowrap", flexShrink: 0 }}
        >
          + Create Room
        </button>
      </div>

      {/* ── Join with code ─────────────────────────────────────── */}
      <div style={{ marginBottom:"6px" }}>
        <p style={{ fontSize:"11px", color:"var(--text-dim)", letterSpacing:"1.5px", textTransform:"uppercase", marginBottom:"8px" }}>Have a room code?</p>
        <div style={{
          display:"flex", gap:"10px", alignItems:"center",
          background:"rgba(var(--gold-rgb), 0.04)", border:"1px solid rgba(var(--gold-rgb), 0.18)",
          borderRadius:"14px", padding:"12px 16px", transition:"border-color 0.15s, box-shadow 0.15s",
        }}
          onFocusCapture={e => { (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(var(--gold-rgb), 0.45)"; (e.currentTarget as HTMLDivElement).style.boxShadow = "0 0 0 3px rgba(var(--gold-rgb), 0.08)"; }}
          onBlurCapture={e  => { (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(var(--gold-rgb), 0.18)"; (e.currentTarget as HTMLDivElement).style.boxShadow = "none"; }}
        >
          <span style={{ display:"flex", flexShrink:0, color:"var(--color-accent)" }}><KeyRound size={18} /></span>
          <input
            value={codeInput}
            onChange={e => { setCodeInput(e.target.value.toUpperCase().slice(0, 6)); setCodeError(""); }}
            onKeyDown={e => e.key === "Enter" && handleJoinByCode()}
            placeholder="A3B2C1"
            maxLength={6}
            style={{
              flex:1, minWidth:0, background:"transparent", border:"none",
              color:"var(--text-primary)", fontSize:"18px",
              outline:"none", fontFamily:"monospace", letterSpacing:"6px", fontWeight:"700",
            }}
          />
          <button
            onClick={handleJoinByCode}
            disabled={codeInput.length < 6 || codeLookingUp}
            style={{ ...S.primaryBtn, padding:"9px 14px", fontSize:"13px", opacity: codeInput.length < 6 ? 0.4 : 1, flexShrink:0 }}
          >
            {codeLookingUp ? "…" : "Join Room"}
          </button>
        </div>
      </div>
      {codeError && (
        <p style={{ fontSize:"12px", color:"rgba(255,100,90,0.8)", marginBottom:"10px", paddingLeft:"4px" }}>{codeError}</p>
      )}
      {joinError && (
        <div style={{
          background:"rgba(255,59,48,0.07)", border:"1px solid rgba(255,59,48,0.2)",
          borderRadius:"12px", padding:"11px 16px", margin:"4px 0 10px",
          fontSize:"13px", color:"rgba(255,120,110,0.95)",
        }}>
          <Lock size={14} style={{ verticalAlign:"-2px", marginRight:6 }} />{joinError}
        </div>
      )}

      {/* ── Pending invites ────────────────────────────────────── */}
      {pendingInvites.length > 0 && (
        <div style={{ display:"flex", flexDirection:"column", gap:"8px", margin:"14px 0" }}>
          {pendingInvites.map(inv => (
            <div key={inv.id} style={{
              background:"rgba(var(--gold-rgb), 0.06)", border:"1px solid rgba(var(--gold-rgb), 0.2)",
              borderRadius:"12px", padding:"11px 16px",
              display:"flex", alignItems:"center", justifyContent:"space-between", gap:"12px",
            }}>
              <p style={{ fontSize:"13px", color:"var(--text-secondary)", flex:1, minWidth:0 }}>
                <Mail size={14} style={{ verticalAlign:"-2px", marginRight:6 }} /><b style={{ color:"var(--text-primary)" }}>{inv.fromName || "Someone"}</b> invited you to their study room
              </p>
              <div style={{ display:"flex", gap:"8px", flexShrink:0 }}>
                <button onClick={() => acceptInvite(inv)} style={{ ...S.accentBtn, padding:"6px 14px", fontSize:"12px" }}>Join</button>
                <button onClick={() => onDismissInvite?.(inv.id)} style={{ ...S.ghostBtn, marginTop:0, padding:"6px 12px", fontSize:"12px" }}>Dismiss</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Friends strip — who's studying now (Join), plus nudge the rest */}
      {friends.length > 0 && (
        <div style={{ marginBottom:"18px" }}>
          <p style={{ ...S.sectionLabel, marginBottom:"10px" }}>Friends</p>
          <div style={{ display:"flex", flexDirection:"column", gap:"8px" }}>
            {studyingFriends.map(f => (
              <div key={f.id} style={{ display:"flex", alignItems:"center", gap:"10px", background:"var(--color-surface)", border:"1px solid var(--color-border)", borderRadius:"12px", padding:"10px 14px" }}>
                <span style={{ width:8, height:8, borderRadius:"50%", background:"var(--color-accent)", flexShrink:0 }} />
                <div style={{ flex:1, minWidth:0 }}>
                  <p style={{ fontSize:"13px", fontWeight:"500", color:"var(--text-primary)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{f.name}</p>
                  {f.email && <p style={{ fontSize:"11px", color:"var(--text-dim)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{f.email}</p>}
                  <p style={{ fontSize:"11px", color:"var(--color-accent)" }}>studying now</p>
                </div>
                <button onClick={() => joinFriendRoom(friendRoomMap[f.id])} style={{ ...S.accentBtn, padding:"6px 14px", fontSize:"12px" }}>Join</button>
              </div>
            ))}
            {offlineFriends.map(f => {
              const st = nudged[f.id];
              const nudgedDone = st === "sent";
              return (
                <div key={f.id} style={{ display:"flex", alignItems:"center", gap:"10px", background:"var(--color-surface)", border:"1px solid var(--color-border)", borderRadius:"12px", padding:"10px 14px" }}>
                  <span style={{ width:8, height:8, borderRadius:"50%", background:"rgba(255,255,255,0.15)", flexShrink:0 }} />
                  <div style={{ flex:1, minWidth:0 }}>
                    <p style={{ fontSize:"13px", fontWeight:"500", color:"var(--text-secondary)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{f.name}</p>
                    {f.email && <p style={{ fontSize:"11px", color:"var(--text-dim)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{f.email}</p>}
                    <p style={{ fontSize:"11px", color:"var(--text-dim)" }}>offline</p>
                  </div>
                  <button
                    onClick={() => { if (!st) nudgeFriend(f); }}
                    disabled={!!st}
                    style={{
                      ...S.ghostBtn, marginTop:0, padding:"6px 12px", fontSize:"12px",
                      cursor: st ? "default" : "pointer",
                      ...(nudgedDone ? { background:"rgba(74,222,128,0.1)", border:"1px solid rgba(74,222,128,0.3)", color:"#4ade80", opacity:1 } : { opacity: st ? 0.5 : 1 }),
                    }}
                  >
                    {st === "sent" ? <span style={{ display:"inline-flex", alignItems:"center", gap:4 }}>Nudged<Check size={13} /></span> : st === "limited" ? "Limit reached" : st === "sending" ? "…" : "Nudge"}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Filter tabs + refresh ───────────────────────────────── */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", margin:"18px 0 14px" }}>
        <div style={{ display:"flex", gap:"2px", background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:"20px", padding:"3px" }}>
          {FILTERS.map(f => (
            <button
              key={f}
              onClick={() => setActiveFilter(f)}
              style={{
                padding:"5px 14px", borderRadius:"16px",
                border: activeFilter === f ? "1px solid rgba(var(--gold-rgb), 0.28)" : "1px solid transparent",
                fontSize:"12px", fontWeight: activeFilter === f ? "600" : "500",
                cursor:"pointer", fontFamily:"inherit",
                background: activeFilter === f ? "rgba(var(--gold-rgb), 0.15)" : "transparent",
                color: activeFilter === f ? "var(--color-accent)" : "var(--text-secondary)",
                transition:"all 0.15s",
              }}
            >
              {FILTER_LABELS[f]}
            </button>
          ))}
        </div>
        <button onClick={fetchRooms} title="Refresh" style={{ ...S.ghostBtn, marginTop:0, padding:"5px 10px", fontSize:"13px", display:"inline-flex", alignItems:"center" }}><RefreshCw size={13} /></button>
      </div>

      {/* ── Room grid ───────────────────────────────────────────── */}
      {loading ? (
        <p style={{ color:"var(--text-dim)", fontSize:"14px", textAlign:"center", padding:"40px 0" }}>Loading rooms…</p>
      ) : filteredRooms.length === 0 ? (
        <div style={{ ...S.emptyState, padding:"40px 24px" }}>
          <p style={{ color:"var(--text-secondary)", fontSize:"15px", fontWeight:"600", marginBottom:"6px" }}>{emptyMsg.title}</p>
          <p style={{ color:"var(--text-dim)", fontSize:"13px" }}>{emptyMsg.sub}</p>
        </div>
      ) : (
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(260px, 1fr))", gap:"14px" }}>
          {filteredRooms.map(room => {
            const courseMatch = courses?.find(c => Number(c.dbId) === room.course_id);
            const courseLabel = courseMatch
              ? (courseMatch.courseCode ? `${courseMatch.courseCode} — ${courseMatch.name}` : courseMatch.name)
              : null;
            return (
              <RoomCard
                key={room.id}
                room={room}
                liveCount={roomCounts[room.id] || 0}
                joining={joiningId === room.id}
                pendingStatus={pendingReqs[room.id]}
                courseLabel={courseLabel}
                onJoin={() => handleJoin(room)}
              />
            );
          })}
        </div>
      )}

      {showCreate && (
        <CreateRoomModal
          courses={courses}
          onCreate={handleCreate}
          onClose={() => setShowCreate(false)}
          initialCourseId={createInitCourse}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// RoomCard — tile layout for the lobby grid
// ─────────────────────────────────────────────────────────────────────────────
function RoomCard({ room, liveCount, joining, pendingStatus, courseLabel, onJoin }: {
  room: any; liveCount: number; joining: boolean; pendingStatus: string | undefined;
  courseLabel: string | null; onJoin: () => void;
}) {
  const isPrivate = room.room_type === "invite";
  const btnLabel =
    pendingStatus === "accepted"  ? "Joining…" :
    pendingStatus === "joined"    ? "Re-enter" :
    pendingStatus === "requested" ? "Waiting…" :
    joining                       ? "Joining…" :
    isPrivate                     ? "Request" : "Join →";
  const btnDisabled = joining || pendingStatus === "requested" || pendingStatus === "accepted";

  return (
    <div
      style={{
        background: "var(--color-surface)",
        border: "1px solid var(--color-border)",
        borderRadius: "14px",
        padding: "20px",
        display: "flex", flexDirection: "column", gap: "0",
        boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
        transition: "border-color 0.18s ease, box-shadow 0.18s ease, transform 0.18s ease",
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(255,255,255,0.13)";
        (e.currentTarget as HTMLDivElement).style.boxShadow   = "0 4px 16px rgba(0,0,0,0.18)";
        (e.currentTarget as HTMLDivElement).style.transform   = "translateY(-1px)";
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLDivElement).style.borderColor = "var(--color-border)";
        (e.currentTarget as HTMLDivElement).style.boxShadow   = "0 1px 3px rgba(0,0,0,0.1)";
        (e.currentTarget as HTMLDivElement).style.transform   = "translateY(0)";
      }}
    >
      {/* Room name + type badge */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px", marginBottom: "8px" }}>
        <p style={{
          fontSize: "15px", fontWeight: "600", fontFamily: "var(--font-sans)",
          color: "var(--text-primary)", lineHeight: "1.3",
          flex: 1, minWidth: 0, wordBreak: "break-word", margin: 0,
        }}>
          {room.name}
        </p>
        <span style={{
          fontSize: "10px", fontWeight: "700", letterSpacing: "0.6px",
          textTransform: "uppercase",
          padding: "3px 8px", borderRadius: "5px", flexShrink: 0, whiteSpace: "nowrap",
          background: isPrivate ? "rgba(196,100,100,0.08)" : "rgba(127,174,110,0.08)",
          color: isPrivate ? "rgba(210,110,110,0.85)" : "rgba(110,185,120,0.85)",
          border: `1px solid ${isPrivate ? "rgba(196,100,100,0.15)" : "rgba(127,174,110,0.15)"}`,
        }}>
          {isPrivate ? "Private" : "Public"}
        </span>
      </div>

      {/* Course label */}
      {courseLabel && (
        <p style={{ fontSize: "12px", color: "var(--text-dim)", margin: "0 0 12px", lineHeight: "1.4" }}>
          {courseLabel}
        </p>
      )}

      {/* Access filter badges */}
      {activeFilterKeys(room.access_filters).length > 0 && (
        <div style={{ marginBottom: "12px" }}>
          <FilterBadges filters={room.access_filters} small />
        </div>
      )}

      {/* Divider */}
      <div style={{ height: "1px", background: "rgba(255,255,255,0.05)", margin: courseLabel ? "0 0 12px" : "8px 0 12px" }} />

      {/* Live count + action */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
        {liveCount > 0 ? (
          <span style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "var(--color-accent)" }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--color-accent)", display: "inline-block", flexShrink: 0 }}/>
            {liveCount} focusing
          </span>
        ) : (
          <span style={{ fontSize: "12px", color: "var(--text-dim)" }}>No one yet</span>
        )}
        <button
          onClick={onJoin}
          disabled={btnDisabled}
          style={{
            padding: "7px 16px", borderRadius: "8px",
            fontSize: "12px", fontWeight: "600",
            cursor: btnDisabled ? "default" : "pointer",
            fontFamily: "inherit", flexShrink: 0,
            background: btnDisabled ? "rgba(255,255,255,0.04)" : "rgba(var(--gold-rgb), 0.1)",
            color: btnDisabled ? "var(--text-dim)" : "var(--color-accent)",
            border: `1px solid ${btnDisabled ? "rgba(255,255,255,0.07)" : "rgba(var(--gold-rgb), 0.25)"}`,
            opacity: pendingStatus === "requested" ? 0.6 : 1,
            transition: "opacity 0.15s",
          }}
        >
          {btnLabel}
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CreateRoomModal
// ─────────────────────────────────────────────────────────────────────────────
function CreateRoomModal({ courses, onCreate, onClose, initialCourseId = "" }) {
  const [name,     setName]     = useState("");
  const [courseId, setCourseId] = useState(initialCourseId);
  const [roomType, setRoomType] = useState("public");
  const [accessFilters, setAccessFilters] = useState<AccessFilters>({});
  const [saving,   setSaving]   = useState(false);
  const S = styles;

  async function handleSubmit() {
    if (!name.trim() || saving) return;
    setSaving(true);
    await onCreate({ name, courseId, roomType, accessFilters });
    setSaving(false);
  }

  return createPortal(
    <div style={S.modalOverlay}>
      <div style={S.modalCard}>
        <h2 style={{ fontSize:"20px", fontWeight:"700", color:"var(--text-primary)", marginBottom:"16px" }}>
          Create a Room
        </h2>
        <label style={S.fieldLabel}>Room name</label>
        <input
          autoFocus
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === "Enter" && handleSubmit()}
          placeholder="e.g. CDS151 Study Session"
          style={S.input}
        />
        <label style={S.fieldLabel}>Course (optional)</label>
        <select value={courseId} onChange={e => setCourseId(e.target.value)} style={S.input}>
          <option value="">No course / general</option>
          {(courses || []).map(c => (
            <option key={c.dbId ?? c.id} value={c.dbId || ""} disabled={!c.dbId}>
              {c.courseCode ? `${c.courseCode} — ${c.name}` : c.name}{!c.dbId ? " (sync to link)" : ""}
            </option>
          ))}
        </select>
        <div style={{ display:"flex", gap:"8px", marginBottom:"16px" }}>
          {["public","invite"].map(t => (
            <button key={t} onClick={() => setRoomType(t)} style={{
              flex:1, padding:"9px 0", borderRadius:"9px",
              fontSize:"13px", fontWeight:"500", cursor:"pointer", fontFamily:"inherit",
              background: roomType===t ? "rgba(var(--gold-rgb), 0.14)" : "rgba(255,255,255,0.04)",
              color:      roomType===t ? "var(--color-accent)" : "var(--text-dim)",
              border: `1px solid ${roomType===t ? "rgba(var(--gold-rgb), 0.3)" : "rgba(255,255,255,0.08)"}`,
              transition:"all 0.15s",
            }}>
              {t==="public"
                ? <span style={{ display:"inline-flex", alignItems:"center", gap:5 }}><Globe size={13} />Public</span>
                : <span style={{ display:"inline-flex", alignItems:"center", gap:5 }}><Lock size={13} />Invite only</span>}
            </button>
          ))}
        </div>

        {/* Who can join — access filters (combined with OR) */}
        <label style={S.fieldLabel}>Who can join</label>
        <p style={{ fontSize:"11px", color:"var(--text-dim)", margin:"4px 0 10px" }}>
          Leave all off for anyone. Pick one or more — a student who matches <b>any</b> of them can join.
        </p>
        <div style={{ marginBottom:"22px" }}>
          <AccessToggles
            value={accessFilters}
            onChange={setAccessFilters}
            hasCourse={!!courseId}
          />
        </div>

        <div style={{ display:"flex", gap:"10px" }}>
          <button onClick={onClose} style={S.ghostBtnLarge}>Cancel</button>
          <button
            onClick={handleSubmit}
            disabled={!name.trim() || saving}
            style={{ ...S.primaryBtnLarge, opacity: !name.trim()||saving ? 0.4 : 1 }}
          >
            {saving ? "Creating…" : "Create Room →"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AccessSettingsModal — owner edits who can join an existing room
// ─────────────────────────────────────────────────────────────────────────────
function AccessSettingsModal({ initial, hasCourse, onSave, onClose }: {
  initial: AccessFilters; hasCourse: boolean;
  onSave: (f: AccessFilters) => void; onClose: () => void;
}) {
  const [filters, setFilters] = useState<AccessFilters>(initial || {});
  const S = styles;
  return createPortal(
    <div style={S.modalOverlay}>
      <div style={{ ...S.modalCard, maxWidth:"380px" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"6px" }}>
          <h2 style={{ fontSize:"18px", fontWeight:"700", color:"var(--text-primary)" }}>Who can join</h2>
          <button onClick={onClose} style={{ background:"none", border:"none", color:"var(--text-dim)", fontSize:"18px", cursor:"pointer", padding:"0 4px" }}>×</button>
        </div>
        <p style={{ fontSize:"12px", color:"var(--text-dim)", margin:"0 0 16px", lineHeight:1.5 }}>
          Leave all off for anyone. Pick one or more — a student who matches <b>any</b> of them can join. Already-joined members stay.
        </p>
        <div style={{ marginBottom:"22px" }}>
          <AccessToggles value={filters} onChange={setFilters} hasCourse={hasCourse} />
        </div>
        <div style={{ display:"flex", gap:"10px" }}>
          <button onClick={onClose} style={S.ghostBtnLarge}>Cancel</button>
          <button onClick={() => onSave(filters)} style={S.primaryBtnLarge}>Save</button>
        </div>
      </div>
    </div>,
    document.body
  );
}

const CURSOR_COLORS = ["#60a5fa","#f472b6","#34d399","#fbbf24","#a78bfa","#fb923c","#22d3ee","#e879f9"];
// Quiet period before the board is snapshotted for the AI (AI-06). Long enough that a
// normal writing burst produces one snapshot rather than one per stroke.
const WB_SNAPSHOT_QUIET_MS = 4000;

function cursorColor(uid: string) {
  let h = 0;
  for (let i = 0; i < uid.length; i++) h = (h * 31 + uid.charCodeAt(i)) >>> 0;
  return CURSOR_COLORS[h % CURSOR_COLORS.length];
}

// ─────────────────────────────────────────────────────────────────────────────
// RoomView — Phase 2A: + Pomodoro, Goal prompt, Session summary
// ─────────────────────────────────────────────────────────────────────────────
// ── Guided study session (proactive) — plan parsing, fallbacks, nudges, rich text ──
function parseGsPlan(text: string): { title: string; goal: string; estMin: number }[] {
  const steps: { title: string; goal: string; estMin: number }[] = [];
  for (const line of String(text || "").split("\n")) {
    const m = line.match(/STEP\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(\d+)/i);
    if (m) steps.push({ title: m[1].trim().replace(/\*\*/g, ""), goal: m[2].trim().replace(/\*\*/g, ""), estMin: Math.min(30, Math.max(1, parseInt(m[3], 10) || 5)) });
  }
  return steps.slice(0, 7);
}

// A live study-room session should feel doable in one sitting. The LLM's per-step
// minute guesses often sum to 80-90 min, which makes the "≈ N min left" chip read
// implausibly long and undercuts the "smart estimate" story. Scale the whole plan
// down proportionally so the total lands in a realistic ~35-min sprint, keeping each
// step at a 2-min floor so nothing rounds to zero.
const GS_SESSION_CAP_MIN = 35;
function normalizeStepMinutes(steps: { title: string; goal: string; estMin: number }[]) {
  const total = steps.reduce((s, x) => s + x.estMin, 0);
  if (total <= GS_SESSION_CAP_MIN || total === 0) return steps;
  const scale = GS_SESSION_CAP_MIN / total;
  return steps.map(x => ({ ...x, estMin: Math.max(2, Math.round(x.estMin * scale)) }));
}
function parseFcCards(text: string): { q: string; a: string }[] {
  const cards: { q: string; a: string }[] = [];
  for (const line of String(text || "").split("\n")) {
    const m = line.match(/Q:\s*(.+?)\s*\|\s*A:\s*(.+)/i);
    if (m) cards.push({ q: m[1].trim().replace(/\*\*/g, ""), a: m[2].trim().replace(/\*\*/g, "") });
  }
  return cards.slice(0, 12);
}
function defaultGsPlan(mode: string, topic: string) {
  if (mode === "assignment") return [
    { title: "Understand the task", goal: `Break down what "${topic}" is actually asking`, estMin: 5 },
    { title: "Gather what you need", goal: "Pull the relevant course material and notes", estMin: 6 },
    { title: "Outline your approach", goal: "Plan the structure before you start", estMin: 8 },
    { title: "Do the work", goal: "Complete it step by step, Reggie coaching you", estMin: 15 },
    { title: "Review & polish", goal: "Check it against the rubric", estMin: 6 },
  ];
  if (mode === "exam") return [
    { title: "Map the topics", goal: `List what "${topic}" will cover`, estMin: 4 },
    { title: "Core concepts", goal: "Re-learn the key ideas", estMin: 12 },
    { title: "Practice problems", goal: "Test yourself on the hard parts", estMin: 12 },
    { title: "Fix the gaps", goal: "Drill what you missed", estMin: 8 },
    { title: "Final review", goal: "Quick pass to lock it in", estMin: 5 },
  ];
  return [
    { title: "Warm up", goal: `Recall what you already know about ${topic}`, estMin: 3 },
    { title: "Core idea", goal: `Understand the main concept of ${topic}`, estMin: 8 },
    { title: "Work an example", goal: "Apply it to a concrete problem", estMin: 8 },
    { title: "Check yourself", goal: "Quiz to confirm you've got it", estMin: 5 },
  ];
}
const GS_NUDGES: Record<string, string[]> = {
  start:    ["You've got this — one step at a time. 💪", "Locked in. Let's make this click. ✨", "Let's do this — I'm right here with you. 🙌"],
  progress: ["Nice — one down. Keep the momentum. 🔥", "Great pace. On to the next. 🚀", "That's real progress — proud of you. 🌟"],
  stuck:    ["Totally normal to get stuck here — let's untangle it. 🧠", "Good — the hard parts are where learning happens. 💡", "No worries, let's slow it down together. 🤝"],
  done:     ["Session complete — you crushed it. 🎉", "Done! That was focused work. 🌟", "Nailed it. Come back anytime. 🎯"],
  focus:    ["🔥 Deep focus time — you've got this.", "⚡ Locking in. Let's make these minutes count.", "💪 Heads down — I'm rooting for you.", "🌟 One sprint at a time. Let's go."],
};
function pickGsNudge(kind: string) {
  const arr = GS_NUDGES[kind] || GS_NUDGES.start;
  return arr[Math.floor(Math.random() * arr.length)];
}
// Render inline markdown: **bold** then *italic* within the non-bold segments.
function gsInline(text: string): any[] {
  const out: any[] = [];
  String(text || "").split(/(\*\*[^*]+\*\*)/g).forEach((bp, bi) => {
    if (bp.startsWith("**") && bp.endsWith("**") && bp.length > 4) {
      out.push(<strong key={`b${bi}`} style={{ color: "var(--text-primary)", fontWeight: 600 }}>{bp.slice(2, -2)}</strong>);
      return;
    }
    bp.split(/(\*[^*\n]+\*)/g).forEach((ip, ii) => {
      if (ip.startsWith("*") && ip.endsWith("*") && ip.length > 2) out.push(<em key={`i${bi}-${ii}`} style={{ color: "var(--text-secondary)" }}>{ip.slice(1, -1)}</em>);
      else if (ip) out.push(<span key={`s${bi}-${ii}`}>{ip}</span>);
    });
  });
  return out;
}
function GsRichText({ text }: { text: string }) {
  const blocks = String(text || "").split(/\n{2,}/).filter(b => b.trim());
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
      {blocks.map((b, i) => {
        const trimmed = b.trim();
        if (/^([-*_=]){3,}$/.test(trimmed)) return <div key={i} style={{ height: 1, background: "rgba(255,255,255,0.08)", margin: "1px 0" }} />;
        const lines = b.split("\n").filter(l => l.trim());
        // Pipe tables (| a | b | / |---|---| / rows) — render a real table instead of
        // leaking raw pipe rows (team-reported in the Reggie bubble).
        const isTblRow = (l: string) => /^\s*\|.*\|\s*$/.test(l);
        const isTblSep = (l: string) => /^\s*\|[\s\-:|]+\|\s*$/.test(l);
        if (lines.length >= 2 && isTblRow(lines[0]) && isTblSep(lines[1])) {
          const cells = (l: string) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(c => c.trim());
          const header = cells(lines[0]);
          const rows = lines.slice(2).filter(l => isTblRow(l) && !isTblSep(l)).map(cells);
          const cellSt: React.CSSProperties = { padding: "5px 9px", border: "1px solid rgba(255,255,255,0.1)", textAlign: "left", fontSize: 12.5, color: "var(--text-secondary)" };
          return (
            <div key={i} style={{ overflowX: "auto" }}>
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <thead><tr>{header.map((c, ci) => <th key={ci} style={{ ...cellSt, fontWeight: 650, color: "var(--text-primary)" }}>{gsInline(c)}</th>)}</tr></thead>
                <tbody>{rows.map((r, ri) => <tr key={ri}>{r.map((c, ci) => <td key={ci} style={cellSt}>{gsInline(c)}</td>)}</tr>)}</tbody>
              </table>
            </div>
          );
        }
        // Line-level specials: bullets, "## headings", and "---" dividers can appear
        // MID-block (Reggie writes them with single newlines), so block-level checks
        // miss them and the raw "##"/"---" leaked into the UI. Render line-by-line
        // whenever any special line is present.
        const isBullet  = (l: string) => /^\s*[-•]\s+/.test(l) || /^\s*\*\s+/.test(l);
        const isHeading = (l: string) => /^\s*#{1,6}\s+/.test(l);
        const isDivider = (l: string) => /^\s*([-*_=]){3,}\s*$/.test(l);
        if (lines.some(l => isBullet(l) || isHeading(l) || isDivider(l))) {
          return (
            <div key={i} style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {lines.map((l, j) => {
                if (isDivider(l)) return <div key={j} style={{ height: 1, background: "rgba(255,255,255,0.08)", margin: "4px 0" }} />;
                if (isHeading(l)) return (
                  <p key={j} style={{ margin: "4px 0 1px", fontSize: 14, fontWeight: 700, lineHeight: 1.4, color: "var(--text-primary)" }}>
                    {gsInline(l.replace(/^\s*#{1,6}\s+/, ""))}
                  </p>
                );
                const isB = isBullet(l);
                return (
                  <p key={j} style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: "var(--text-secondary)", display: "flex", gap: 8 }}>
                    {isB && <span style={{ color: "rgb(var(--teal-rgb))", flexShrink: 0 }}>•</span>}
                    <span>{gsInline(l.replace(/^\s*[-•*]\s+/, ""))}</span>
                  </p>
                );
              })}
            </div>
          );
        }
        return (
          <p key={i} style={{ margin: 0, fontSize: 13.5, lineHeight: 1.62, color: "var(--text-secondary)", whiteSpace: "pre-wrap" }}>
            {gsInline(b.replace(/^#+\s*/, ""))}
          </p>
        );
      })}
    </div>
  );
}

// Shared WebAudio context for Reggie's voice. WebAudio (decode + BufferSource) plays
// reliably once the context is resumed inside a user gesture — unlike a fresh HTMLAudio
// element, which browsers block from programmatic play(). This is the same approach the
// floating orb uses, which is why the orb's TTS works and the old <audio> path didn't.
let _roomAudioCtx: AudioContext | null = null;
function roomAudioCtx(): AudioContext {
  if (!_roomAudioCtx) _roomAudioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  if (_roomAudioCtx.state === "suspended") _roomAudioCtx.resume();
  return _roomAudioCtx;
}

function RoomView({ room, onLeave, roomCounts, onlineIds = [] }) {
  const { userId, userData, setActiveRoomId, setWhiteboardSnapshot, assignments } = useApp();
  const [members,            setMembers]            = useState([]);
  const [workingOn,          setWorkingOn]          = useState("");
  const [requests,           setRequests]           = useState([]);
  const [showInvite,         setShowInvite]         = useState(false);
  const [showAccess,         setShowAccess]         = useState(false);
  const [accessFilters,      setAccessFilters]      = useState<AccessFilters>(room.access_filters || {});
  const [tick,               setTick]               = useState(0);
  const [pomo,               setPomo]               = useState(null);
  const [showGoalPrompt,     setShowGoalPrompt]     = useState(false);
  const [showSummary,        setShowSummary]        = useState(false);
  const [summaryDurationSecs,setSummaryDurationSecs]= useState(0);
  const [courseName,         setCourseName]         = useState("");
  // Active speaker name (derived from P2P voice below) — consumed by the guided-session
  // and member-list "who's talking" indicators.
  const [activeSpeakerName,  setActiveSpeakerName]  = useState<string | null>(null);
  // Focus Sprint — configurable duration, no break phase
  const [sprintDuration,     setSprintDuration]     = useState(25 * 60);
  const sprintDurationRef = useRef(25 * 60);
  // Raise hand
  const [raisedHands,        setRaisedHands]        = useState<Record<string, boolean>>({});
  const [myHandRaised,       setMyHandRaised]       = useState(false);
  const handTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Room header overflow menu (admin actions)
  const [showRoomMenu,       setShowRoomMenu]       = useState(false);
  const roomMenuRef = useRef<HTMLDivElement>(null);
  // Phase 2 — Chat
  const [showChat,           setShowChat]           = useState(false);   // focus-mode floating chat panel only
  const [leftBarOpen,        setLeftBarOpen]        = useState(false);   // chat is off by default in a voice room; the top-bar chat toggle reveals it
  const [chatMessages,       setChatMessages]       = useState<ChatMessage[]>([]);
  const [chatInput,          setChatInput]          = useState("");
  const [chatSending,        setChatSending]        = useState(false);
  const [imageUploading,     setImageUploading]     = useState(false);
  const chatLoadedRef = useRef(false);
  const leftChatEndRef = useRef<HTMLDivElement>(null);   // autoscroll anchor for the docked left chat
  // Peer-to-peer voice (WebRTC mesh; see src/lib/roomVoice.ts). Foundation for the
  // in-room voice agent — the STT layer will later consume roomVoiceRef's local stream.
  const [voiceLive,      setVoiceLive]      = useState(false);   // I've joined voice (mic acquired)
  const [micMuted,       setMicMuted]       = useState(false);   // my mic muted (still connected)
  const [speakerOn,      setSpeakerOn]      = useState(true);    // do I hear others (local playback)
  const [voiceError,     setVoiceError]     = useState<string | null>(null);
  const [remoteStreams,  setRemoteStreams]  = useState<Record<string, MediaStream>>({});
  const [voiceSpeaking,  setVoiceSpeaking]  = useState<Record<string, boolean>>({});  // userId → talking now
  const roomVoiceRef  = useRef<RoomVoice | null>(null);
  const voiceLiveRef  = useRef(false);
  const micMutedRef   = useRef(false);
  // Shared transcript — the single source of truth (see src/lib/roomTranscript.ts). Each
  // participant STTs their own mic and broadcasts committed segments; every client merges
  // them into this one store. This is what the AI layer will read.
  const transcriptRef = useRef<RoomTranscript | null>(null);
  if (!transcriptRef.current) transcriptRef.current = new RoomTranscript();
  const transcriptSeqRef = useRef(0);                    // my per-speaker monotonic counter
  const scribeRef = useRef<ScribeSession | null>(null);  // my own STT session (when unmuted)
  const [transcript, setTranscript] = useState<readonly Utterance[]>([]);
  const [livePartials, setLivePartials] = useState<Record<string, { name: string; text: string }>>({});
  const transcriptEndRef = useRef<HTMLDivElement>(null);   // autoscroll anchor for the transcript view
  // In-room AI ("Reggie") trigger. Exactly one client (the driver) runs the LLM + TTS
  // loop; anyone can summon it (wake word / @ai / button). See src/lib/roomAiTrigger.ts.
  const [aiThinking, setAiThinking] = useState(false);
  const amDriverRef   = useRef(true);
  const aiReqSeqRef   = useRef(0);
  const aiMsgSeqRef   = useRef(0);
  const aiHandledRef  = useRef<Set<string>>(new Set());   // request ids already answered (dedupe)
  const aiActiveRef   = useRef(false);                     // a Reggie turn is generating right now
  const aiGenRef      = useRef(0);                         // generation stamp — newest turn wins
  const aiAbortRef    = useRef<AbortController | null>(null);   // aborts the in-flight LLM stream
  const aiSourceRef   = useRef<AudioBufferSourceNode | null>(null);   // currently-playing AI clip
  const aiSpeakChainRef = useRef<Promise<void>>(Promise.resolve());   // serialize clip playback
  const currentAiTurnRef = useRef<string | null>(null);   // turnId of the AI turn being streamed
  const aiStreamTextRef  = useRef("");                    // accumulated text of that turn
  const aiBargedRef      = useRef(false);                 // a human spoke → stop this AI turn
  const aiSpeakingRef    = useRef(false);                 // an AI clip is actually playing right now
  const [streamingAi, setStreamingAi] = useState<{ turnId: string; text: string } | null>(null);
  // Push-to-talk "Ask Reggie" capture: speech after the click is collected as the question.
  const [captureMode,   setCaptureMode]   = useState(false);
  const [captureText,   setCaptureText]   = useState("");
  const [capturePartial, setCapturePartial] = useState("");
  const captureActiveRef = useRef(false);
  const captureTextRef   = useRef("");
  const captureScribeRef = useRef<ScribeSession | null>(null);   // temp mic when not already STT-ing
  const captureStreamRef = useRef<MediaStream | null>(null);
  // Proactive/ambient AI (R7): the driver may chime in on detected confusion. Opt-in,
  // off by default, throttled, and it stays quiet while anyone is mid-sentence.
  const [proactiveOn, setProactiveOn] = useState(false);
  const proactiveOnRef  = useRef(false);
  const lastAiTurnRef   = useRef(0);     // ms of the last spoken AI turn (interjection cooldown)
  const lastProactiveRef = useRef(0);    // ms of the last Stage-B attempt (LLM-call throttle)
  const proactiveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const livePartialsRef = useRef<Record<string, { name: string; text: string }>>({});
  // Query-solving loop: once a question is asked, Reggie stays in a back-and-forth until
  // it's resolved. Exactly one loop room-wide; the driver runs it, all clients show status.
  const [solving, setSolving] = useState(false);
  const solvingRef = useRef(false);
  const solveTurnsRef = useRef(0);
  const solveIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const solveFollowupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Phase 3 — Whiteboard
  const [showBoard,          setShowBoard]          = useState(true);   // the board IS the room's main stage
  const [strokes,            setStrokes]            = useState<Stroke[]>([]);
  const [wbTool,             setWbTool]             = useState<Tool>("move"); // hand-first: the board is a space you move through; pen is opt-in
  const [wbStyle,            setWbStyle]            = useState<PenStyle>("normal");
  const [wbColor,            setWbColor]            = useState(PEN_COLORS[2]);
  const [wbPenWidth,         setWbPenWidth]         = useState(PEN_WIDTHS[1]);
  const [wbEraserSize,       setWbEraserSize]       = useState(ERASER_SIZES[1]);
  const [wbBg,               setWbBg]               = useState(DEFAULT_BG);
  const [liveStrokes,        setLiveStrokes]        = useState<Record<string, { mode: "pen" | "erase"; style: PenStyle; color: string; width: number; points: Point[] }>>({});
  const [peerCursors,        setPeerCursors]        = useState<Record<string, { x: number; y: number; name: string; color: string }>>({});
  const [laserPositions,     setLaserPositions]     = useState<Record<string, { x: number; y: number; active: boolean }>>({});
  const lastCursorSentRef = useRef(0);
  const lastLaserSentRef  = useRef(0);
  // Undo/redo — track strokes drawn by the local user only.
  const wbUndoStack = useRef<Stroke[]>([]);
  const wbRedoStack = useRef<Stroke[]>([]);
  const [canUndo,            setCanUndo]            = useState(false);
  const [canRedo,            setCanRedo]            = useState(false);
  const lastLiveSentRef = useRef(0);
  const yjsDocRef       = useRef<Y.Doc | null>(null);
  const yjsProviderRef  = useRef<SupabaseBroadcastProvider | null>(null);
  const yjsStrokesRef   = useRef<Y.Array<any> | null>(null);
  const yjsMetaRef      = useRef<Y.Map<any> | null>(null);
  const yjsCardsRef     = useRef<Y.Array<any> | null>(null);
  const [boardCards,        setBoardCards]        = useState<any[]>([]);
  const wbSnapTimerRef    = useRef<any>(null);
  const wbSnapInFlightRef = useRef(false);

  const channelRef          = useRef(null);
  const reqChRef            = useRef(null);
  const wbChRef             = useRef(null);
  const sessionIdRef        = useRef(null);
  const joinedAtRef         = useRef(Date.now());
  const workingOnRef        = useRef("");
  const leftRef             = useRef(false);
  // Users who broadcast `member_left` but may still linger in presence until the server's
  // disconnect timeout. The presence sync filters these out until the server drops them.
  const leftUsersRef        = useRef<Set<string>>(new Set());
  const workingOnDebounce   = useRef(null);
  const pomoRef             = useRef(null);
  const pomoAutoAdvancedRef = useRef(null);
  const goalTextRef         = useRef("");
  const aiSessionIdRef = useRef<string | null>(null);

  const isHost = room.created_by === userId;

  // Let Study Assistant (a separate page) know which room this student is
  // currently in, so it can pull room chat / whiteboard context on request.
  // Deliberately NOT cleared on unmount: only one page mounts at a time (see
  // App.tsx), so navigating to Study Assistant unmounts this component too —
  // clearing here would wipe the bridge the instant the student left to go
  // ask about it. Actually leaving the room is handled by the root
  // StudyRooms component's handleLeave, which is the real "no longer in a
  // room" signal.
  useEffect(() => {
    setActiveRoomId(room.id);
  }, [room.id, setActiveRoomId]);

  // Close the ⋯ room menu when clicking outside
  useEffect(() => {
    if (!showRoomMenu) return;
    function handleClick(e: MouseEvent) {
      if (roomMenuRef.current && !roomMenuRef.current.contains(e.target as Node)) {
        setShowRoomMenu(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showRoomMenu]);

  // Main setup
  useEffect(() => {
    startSession();
    startRoomSession(room.id)
    .then(async (result) => {
      aiSessionIdRef.current = result.session.id;

      console.log(
        result.resumed
          ? "[room-session] resumed existing AI session"
          : "[room-session] started new AI session",
        result.session.id
      );

      try {
        const sourceResult = await getRoomSources(room.id);

        console.log(
          "[room-session] current room sources",
          sourceResult.sources
        );
      } catch (error) {
        console.error(
          "[room-session] failed to load sources:",
          error
        );
      }
    })
    .catch((error) => {
      console.error("[room-session] failed to start:", error);
    });
    subscribePresence();
    fetchPomodoroState();
    fetchCourseName();
    if (isHost) subscribeRequests();
    wbChRef.current = subscribeWhiteboard();
    const timer = setInterval(() => setTick(n => n + 1), 1000);
    // Liveness heartbeat: bump last_active every 5 min while inside, so the server's
    // stale-room sweep (room-triggers) never closes an occupied room — even one where
    // nobody joins or leaves for hours. Join-time bump alone can't cover marathons.
    const heartbeat = setInterval(() => {
      supabase.from("study_rooms")
        .update({ last_active: new Date().toISOString() }).eq("id", room.id).then(() => {});
    }, 5 * 60_000);
    const handleUnload = () => void endSession();
    window.addEventListener("beforeunload", handleUnload);
    return () => {
      clearInterval(timer);
      clearInterval(heartbeat);
      clearTimeout(workingOnDebounce.current);
      window.removeEventListener("beforeunload", handleUnload);
      yjsProviderRef.current?.destroy();
      yjsDocRef.current?.destroy();
      try { wbChRef.current?.unsubscribe(); } catch {}
      endSession();
    };
  }, []); // eslint-disable-line

  // Keep pomoRef in sync for use in effects without stale closure
  useEffect(() => { pomoRef.current = pomo; }, [pomo]);

  // Clear hand-raise timer on unmount to avoid state updates on an unmounted component.
  useEffect(() => () => { if (handTimerRef.current) clearTimeout(handTimerRef.current); }, []);

  // Show goal prompt 500ms after entering, only once
  useEffect(() => {
    const t = setTimeout(() => setShowGoalPrompt(true), 500);
    return () => clearTimeout(t);
  }, []);

  // Host: auto-advance timer phase when countdown hits zero
  useEffect(() => {
    if (!isHost) return;
    const p = pomoRef.current;
    if (!p || p.phase === "idle" || p.paused) return;
    const rem = getRemaining(p);
    if (rem !== null && rem <= 0 && pomoAutoAdvancedRef.current !== p.startedAt) {
      pomoAutoAdvancedRef.current = p.startedAt;
      const next = { phase: "idle", paused: false, startedAt: null, durationSec: sprintDurationRef.current, pausedRemaining: null };
      setPomo(next);
      pomoRef.current = next;
      if (channelRef.current) {
        channelRef.current.send({ type: "broadcast", event: "pomodoro", payload: next }).catch(() => {});
      }
      supabase.from("study_rooms").update({ pomodoro_state: next }).eq("id", room.id).then(() => {});
    }
  }, [tick]); // eslint-disable-line

  async function fetchPomodoroState() {
    const { data } = await supabase
      .from("study_rooms").select("pomodoro_state").eq("id", room.id).single();
    if (data?.pomodoro_state) {
      const p = data.pomodoro_state;
      const rem = getRemaining(p);
      // If the phase expired while the user was navigating in, treat as idle
      if (p.phase !== "idle" && !p.paused && rem !== null && rem <= 0) {
        setPomo({ phase: "idle", paused: false, startedAt: null, durationSec: sprintDurationRef.current, pausedRemaining: null });
      } else {
        setPomo(p);
      }
    }
  }

  function broadcastAndSavePomo(state) {
    setPomo(state);
    pomoRef.current = state;
    if (channelRef.current) {
      channelRef.current.send({ type: "broadcast", event: "pomodoro", payload: state }).catch(() => {});
    }
    supabase.from("study_rooms").update({ pomodoro_state: state }).eq("id", room.id).then(() => {});
  }

  function handlePomoStart() {
    broadcastAndSavePomo({ phase: "focus", paused: false, startedAt: Date.now(), durationSec: sprintDurationRef.current, pausedRemaining: null });
    setRoomToast(pickGsNudge("focus")); // Reggie cheers you into the sprint
  }
  function handlePomoPause() {
    const p = pomoRef.current;
    if (!p || p.phase === "idle" || p.paused) return;
    broadcastAndSavePomo({ ...p, paused: true, pausedRemaining: Math.max(0, getRemaining(p)) });
  }
  function handlePomoResume() {
    const p = pomoRef.current;
    if (!p || !p.paused) return;
    broadcastAndSavePomo({ phase: p.phase, paused: false, startedAt: Date.now(), durationSec: p.pausedRemaining ?? p.durationSec, pausedRemaining: null });
  }
  function handlePomoReset() {
    broadcastAndSavePomo({ phase: "idle", paused: false, startedAt: null, durationSec: sprintDurationRef.current, pausedRemaining: null });
  }
  function handlePomoSkip() {
    const p = pomoRef.current;
    if (!p || p.phase === "idle") return;
    broadcastAndSavePomo({ phase: "idle", paused: false, startedAt: null, durationSec: sprintDurationRef.current, pausedRemaining: null });
  }

  function handleSprintDurationChange(secs: number) {
    setSprintDuration(secs);
    sprintDurationRef.current = secs;
  }

  function handleToggleHand() {
    const raised = !myHandRaised;
    setMyHandRaised(raised);
    setRaisedHands(prev => raised ? { ...prev, [userId]: true } : (() => { const n = { ...prev }; delete n[userId]; return n; })());
    channelRef.current?.send({ type: "broadcast", event: "raise_hand", payload: { userId, raised } }).catch(() => {});
    if (raised) {
      if (handTimerRef.current) clearTimeout(handTimerRef.current);
      handTimerRef.current = setTimeout(() => {
        setMyHandRaised(false);
        setRaisedHands(prev => { const n = { ...prev }; delete n[userId]; return n; });
        channelRef.current?.send({ type: "broadcast", event: "raise_hand", payload: { userId, raised: false } }).catch(() => {});
      }, 90000);
    } else {
      if (handTimerRef.current) clearTimeout(handTimerRef.current);
    }
  }

  function handleMoveStroke(strokeId: string, dx: number, dy: number) {
    const arr = yjsStrokesRef.current;
    if (!arr) return;
    const list = arr.toArray() as any[];
    const idx = list.findIndex((s: any) => s.id === strokeId);
    if (idx === -1) return;
    const s = list[idx];
    const moved = s.mode === "image"
      ? { ...s, x: (s.x ?? 0) + dx, y: (s.y ?? 0) + dy }
      : { ...s, points: (s.points ?? []).map((p: Point) => ({ ...p, x: p.x + dx, y: p.y + dy })) };
    arr.doc?.transact(() => { arr.delete(idx, 1); arr.insert(idx, [moved]); });
  }

  function handleReplaceImageStroke(oldId: string, newData: { mode: "image"; url: string; x: number; y: number; w: number; h: number }) {
    const arr = yjsStrokesRef.current;
    if (!arr) return;
    const list = arr.toArray() as any[];
    const idx = list.findIndex((s: any) => s.id === oldId);
    if (idx === -1) return;
    const updated = { ...list[idx], x: newData.x, y: newData.y, w: newData.w, h: newData.h };
    arr.doc?.transact(() => { arr.delete(idx, 1); arr.insert(idx, [updated]); });
    setStrokes(prev => prev.map(s => s.id === oldId ? { ...s, x: newData.x, y: newData.y, w: newData.w, h: newData.h } : s));
  }

  async function startSession() {
    const { data } = await supabase
      .from("room_sessions")
      .insert({ room_id: room.id, user_id: userId, joined_at: new Date().toISOString() })
      .select("id").single();
    sessionIdRef.current = data?.id ?? null;
    // +2 for joining a study room (server caps at 3/day, deduped per session)
    if (sessionIdRef.current) {
      awardTokens("study_room_join", { sessionId: sessionIdRef.current, roomId: room.id }).catch(() => {});
    }
    supabase.from("study_rooms")
      .update({ last_active: new Date().toISOString() }).eq("id", room.id).then(() => {});
  }

  function presencePayload(wo = workingOnRef.current) {
    return {
      userId,
      name:      userData?.name ?? "Anonymous",
      initial:   (userData?.name?.[0] ?? "?").toUpperCase(),
      workingOn: wo,
      joinedAt:  joinedAtRef.current,
      // Voice presence — every client reads this off the roster to show who's in
      // voice and who's muted, and to know which peers to open a mesh connection to.
      voice:     { live: voiceLiveRef.current, muted: micMutedRef.current },
    };
  }

  // Re-broadcast my presence after a voice state change (join / mute) so peers update.
  function pushPresence() {
    channelRef.current?.track(presencePayload()).catch(() => {});
  }

  function subscribePresence() {
    const ch = supabase.channel("room:" + room.id, {
      config: { presence: { key: userId } },
    });
    ch.on("presence", { event: "sync" }, () => {
      const all = Object.values(ch.presenceState()).flat();
      // Collapse duplicate presences for the same user (a stale "ghost" presence
      // can linger under the same key after a re-track). Prefer the entry that has
      // a goal set; otherwise the most recently joined one.
      const byUser = new Map();
      for (const m of all as any[]) {
        const prev = byUser.get(m.userId);
        if (!prev) { byUser.set(m.userId, m); continue; }
        const better = (!!m.workingOn !== !!prev.workingOn)
          ? !!m.workingOn
          : (m.joinedAt ?? 0) >= (prev.joinedAt ?? 0);
        if (better) byUser.set(m.userId, m);
      }
      // Honor pending leaves: a member who announced `member_left` may still linger in
      // presence until the server's disconnect timeout — keep them hidden until then,
      // and stop suppressing once the server has actually dropped them.
      for (const id of Array.from(leftUsersRef.current)) {
        if (byUser.has(id)) byUser.delete(id);
        else leftUsersRef.current.delete(id);
      }
      const collapsed = Array.from(byUser.values());
      setMembers(collapsed);
      // Remove live strokes / cursors / lasers for users no longer present.
      const presentIds = new Set(byUser.keys());
      setLiveStrokes(prev => {
        const next = { ...prev };
        for (const id of Object.keys(next)) if (!presentIds.has(id)) delete next[id];
        return Object.keys(next).length === Object.keys(prev).length ? prev : next;
      });
      setPeerCursors(prev => {
        const next = { ...prev };
        for (const id of Object.keys(next)) if (!presentIds.has(id)) delete next[id];
        return Object.keys(next).length === Object.keys(prev).length ? prev : next;
      });
      setLaserPositions(prev => {
        const next = { ...prev };
        for (const id of Object.keys(next)) if (!presentIds.has(id)) delete next[id];
        return Object.keys(next).length === Object.keys(prev).length ? prev : next;
      });
      // Clear raised-hand state for members who have left the room.
      setRaisedHands(prev => {
        const next = { ...prev };
        let changed = false;
        for (const id of Object.keys(next)) { if (!presentIds.has(id)) { delete next[id]; changed = true; } }
        return changed ? next : prev;
      });
    })
    .on("broadcast", { event: "room_closed" }, () => {
      if (!leftRef.current) endSession().then(() => onLeave());
    })
    // A peer announced they're leaving — prune them now rather than waiting for the
    // presence timeout, and clear any per-user state keyed to them.
    .on("broadcast", { event: "member_left" }, ({ payload }) => {
      const id = payload?.userId;
      if (!id || id === userId) return;
      leftUsersRef.current.add(id);   // keep them pruned even if presence still lists them
      setMembers(prev => prev.filter((m: any) => m.userId !== id));
      setRaisedHands(prev => { if (!(id in prev)) return prev; const n = { ...prev }; delete n[id]; return n; });
      setRemoteStreams(prev => { if (!(id in prev)) return prev; const n = { ...prev }; delete n[id]; return n; });
      setVoiceSpeaking(prev => { if (!(id in prev)) return prev; const n = { ...prev }; delete n[id]; return n; });
      setLivePartials(prev => { if (!(id in prev)) return prev; const n = { ...prev }; delete n[id]; return n; });
      setLiveStrokes(prev => { if (!(id in prev)) return prev; const n = { ...prev }; delete n[id]; return n; });
      setPeerCursors(prev => { if (!(id in prev)) return prev; const n = { ...prev }; delete n[id]; return n; });
    })
    .on("broadcast", { event: "pomodoro" }, ({ payload }) => {
      setPomo(payload);
    })
    .on("broadcast", { event: "raise_hand" }, ({ payload }) => {
      setRaisedHands(prev => {
        if (payload.raised) return { ...prev, [payload.userId]: true };
        const next = { ...prev }; delete next[payload.userId]; return next;
      });
    })
    .on("broadcast", { event: "access_changed" }, ({ payload }) => {
      setAccessFilters(payload?.filters || {});
    })
    .on("broadcast", { event: "chat_message" }, ({ payload }) => {
      setChatMessages(prev => {
        if (prev.some(m => m.id === payload.id)) return prev;
        return [...prev, payload as ChatMessage];
      });
    })
    // WebRTC voice signaling — SDP offers/answers + ICE candidates, addressed peer to
    // peer. Only the target processes; the mesh itself carries the audio, not this.
    .on("broadcast", { event: "voice_signal" }, ({ payload }) => {
      if (payload?.to !== userId || !payload.from) return;
      roomVoiceRef.current?.handleSignal(payload.from, payload.data);
    })
    // A peer's committed transcript segment — merge into the shared store (deduped +
    // ordered there). Skip my own echo; I already added it locally.
    .on("broadcast", { event: "transcript" }, ({ payload }) => {
      if (!payload || payload.speakerId === userId) return;
      transcriptRef.current?.add(payload as Utterance);
      setLivePartials(prev => { if (!(payload.speakerId in prev)) return prev; const n = { ...prev }; delete n[payload.speakerId]; return n; });
      onHumanTurn(payload.text);   // a peer finished a thought — advance the loop or chime in
    })
    // A peer's live partial — captions only, never the source of truth.
    .on("broadcast", { event: "transcript_partial" }, ({ payload }) => {
      if (!payload || payload.speakerId === userId) return;
      setLivePartials(prev => ({ ...prev, [payload.speakerId]: { name: payload.name, text: payload.text } }));
    })
    // Someone summoned the AI — only the elected driver answers, and it starts the loop.
    .on("broadcast", { event: "ai_request" }, ({ payload }) => {
      if (!amDriverRef.current || !payload?.id || aiHandledRef.current.has(payload.id)) return;   // dedupe re-delivery
      aiHandledRef.current.add(payload.id);
      enterSolve();
      fireAiTurn("ask", { question: payload.text, askerName: payload.askerName });
    })
    // The AI's turn from the driver — non-streamed (proactive): record + speak.
    .on("broadcast", { event: "ai_message" }, ({ payload }) => {
      if (payload?.text) applyAiMessage(payload);
    })
    // Streamed AI turn: a finished sentence (speak now) and the turn-end marker.
    .on("broadcast", { event: "ai_chunk" }, ({ payload }) => {
      if (payload?.text) applyAiChunk(payload);
    })
    .on("broadcast", { event: "ai_done" }, ({ payload }) => {
      if (payload?.turnId) applyAiDone(payload);
    })
    // Shared "let Reggie chime in" toggle — keep every client in sync.
    .on("broadcast", { event: "proactive_set" }, ({ payload }) => {
      proactiveOnRef.current = !!payload?.on;
      setProactiveOn(!!payload?.on);
    })
    // Query-solving loop status — every client shows the "solving" banner.
    .on("broadcast", { event: "solve_state" }, ({ payload }) => {
      setSolving(!!payload?.active);
      if (!payload?.active) solvingRef.current = false;
    })
    // A client hit "Done" — the driver ends the loop and cuts off any in-flight answer.
    .on("broadcast", { event: "solve_end" }, () => {
      if (amDriverRef.current) { abortAiTurn(); endSolve(); }
    })
    // Whiteboard — a peer is actively drawing (live preview)
    .on("broadcast", { event: "wb_live" }, ({ payload }) => {
      if (payload.userId === userId) return;
      setLiveStrokes(prev => ({ ...prev, [payload.userId]: { mode: payload.mode, style: payload.style, color: payload.color, width: payload.width, points: payload.points } }));
    })
    // Whiteboard — peer cursor position
    .on("broadcast", { event: "wb_cursor" }, ({ payload }) => {
      if (payload.userId === userId) return;
      if (payload.x === null || payload.x == null) {
        setPeerCursors(prev => { const n = { ...prev }; delete n[payload.userId]; return n; });
      } else {
        setPeerCursors(prev => ({ ...prev, [payload.userId]: { x: payload.x, y: payload.y, name: payload.name ?? "?", color: cursorColor(payload.userId) } }));
      }
    })
    // Whiteboard — peer laser pointer
    .on("broadcast", { event: "wb_laser" }, ({ payload }) => {
      if (payload.userId === userId) return;
      setLaserPositions(prev => ({ ...prev, [payload.userId]: { x: payload.x, y: payload.y, active: payload.active } }));
      if (!payload.active) {
        setTimeout(() => setLaserPositions(prev => { const n = { ...prev }; delete n[payload.userId]; return n; }), 1200);
      }
    })
    // Proactive nudge from the trigger engine (server broadcasts on a SENT decision).
    .on("broadcast", { event: "intervention" }, ({ payload }) => {
      if (!shouldShowIntervention(payload as InterventionPayload, { paused: interventionsPausedRef.current, lastId: lastInterventionIdRef.current })) return;
      lastInterventionIdRef.current = (payload as any)?.messageId ?? null;
      setInterventionCard(payload as InterventionPayload);
    })
    .subscribe(async (status) => {
      if (status === "SUBSCRIBED") await ch.track(presencePayload());
    });
    channelRef.current = ch;
  }

  function subscribeRequests() {
    supabase.from("room_members")
      .select("user_id, joined_at")
      .eq("room_id", room.id)
      .eq("status", "requested")
      .then(({ data }) => { if (data?.length) enrichRequests(data); });
    const ch = supabase.channel("requests-" + room.id);
    ch.on("postgres_changes", {
      event: "*", schema: "public", table: "room_members",
      filter: `room_id=eq.${room.id}`,
    }, (payload: any) => {
      if (payload.new?.status === "requested") enrichRequests([payload.new]);
      if (payload.eventType === "DELETE" || payload.new?.status === "joined" || payload.new?.status === "declined") {
        setRequests(prev => prev.filter(r => r.userId !== (payload.new?.user_id || payload.old?.user_id)));
      }
    }).subscribe();
    reqChRef.current = ch;
  }

  function subscribeWhiteboard() {
    const ch = supabase.channel("wb-" + room.id);

    const doc = new Y.Doc();
    const yStrokes = doc.getArray<any>("strokes");
    const yMeta    = doc.getMap<any>("meta");
    const yCards   = doc.getArray<any>("cards");   // structured study cards (notes/quizzes)

    yjsDocRef.current      = doc;
    yjsStrokesRef.current  = yStrokes;
    yjsMetaRef.current     = yMeta;
    yjsCardsRef.current    = yCards;

    yCards.observe(() => { setBoardCards(yCards.toArray()); });

    // When the strokes array changes, update React state and clear the live
    // preview for any peer whose stroke just committed.
    let prevLength = 0;
    yStrokes.observe(() => {
      const arr = yStrokes.toArray() as Stroke[];
      setStrokes(arr);
      if (arr.length > prevLength) {
        const added = arr.slice(prevLength);
        setLiveStrokes(prev => {
          const next = { ...prev };
          added.forEach((s: any) => { if (s.user_id && s.user_id !== userId) delete next[s.user_id]; });
          return next;
        });
      }
      prevLength = arr.length;
    });

    // Background colour is stored in the Yjs meta map so it syncs like strokes.
    yMeta.observe(() => {
      const bg = yMeta.get("bg");
      if (bg) setWbBg(bg as string);
    });

    const provider = new SupabaseBroadcastProvider(doc, ch, room.id);
    yjsProviderRef.current = provider;

    ch.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        // Seed from persisted DB state, then ask live peers for any newer updates.
        await provider.loadPersistedState();
        provider.requestSync();
      }
    });

    return ch;
  }

  async function enrichRequests(rows) {
    const ids = rows.map(r => r.user_id);
    // users_public = safe-columns view (id, name, ...); keeps working once public.users RLS is strict
    const { data: users } = await supabase.from("users_public").select("id, name").in("id", ids);
    const nameMap = {};
    (users || []).forEach(u => { nameMap[u.id] = u.name; });
    setRequests(prev => {
      const existing = new Set(prev.map(r => r.userId));
      const fresh = rows
        .filter(r => !existing.has(r.user_id))
        .map(r => ({ userId: r.user_id, name: nameMap[r.user_id] || "Unknown", requestedAt: r.joined_at }));
      return [...prev, ...fresh];
    });
  }

  async function acceptRequest(requesterId) {
    try { await respondRoomRequest(userId, room.id, requesterId, true); }
    catch (err) { console.error("[rooms] accept:", (err as any)?.message); }
    setRequests(prev => prev.filter(r => r.userId !== requesterId));
  }

  async function declineRequest(requesterId) {
    try { await respondRoomRequest(userId, room.id, requesterId, false); }
    catch (err) { console.error("[rooms] decline:", (err as any)?.message); }
    setRequests(prev => prev.filter(r => r.userId !== requesterId));
  }

  async function endSession(goalMet = null) {
    if (leftRef.current) return;
    leftRef.current = true;
    roomVoiceRef.current?.stop();   // drop P2P mesh + release the mic before leaving
    roomVoiceRef.current = null;
    scribeRef.current?.stop();
    scribeRef.current = null;
    captureActiveRef.current = false;
    stopCaptureMic();
    if (proactiveTimerRef.current) clearTimeout(proactiveTimerRef.current);
    solvingRef.current = false;
    if (solveIdleTimerRef.current) clearTimeout(solveIdleTimerRef.current);
    if (solveFollowupTimerRef.current) clearTimeout(solveFollowupTimerRef.current);
    try { aiAbortRef.current?.abort(); } catch { /* none in flight */ }
    try { aiSourceRef.current?.stop(); } catch { /* nothing playing */ }
    if (channelRef.current) {
      // Session-only whiteboard: if I'm the last present member, wipe the board.
      // Read presence BEFORE untracking and clear BEFORE leaveRoom drops my
      // membership (the clear RPC requires me to still be a joined member).
      try {
        const present = Object.values(channelRef.current.presenceState()).flat() as any[];
        const othersOnline = new Set(present.map(p => p.userId).filter(id => id !== userId));
        if (othersOnline.size === 0) {
          // Last person leaving — wipe board so next session starts fresh.
          const arr = yjsStrokesRef.current;
          if (arr && arr.length > 0) arr.doc?.transact(() => { arr.delete(0, arr.length); });
          yjsMetaRef.current?.set("bg", DEFAULT_BG);
          await yjsProviderRef.current?.persistState().catch(() => {});
        } else {
          yjsProviderRef.current?.persistState().catch(() => {});
        }
      } catch {}
      // Tell everyone I'm leaving BEFORE untracking. On an ungraceful exit (tab close)
      // the async untrack often can't flush, so peers would keep my stale presence until
      // the server's disconnect timeout — this broadcast prunes me from their roster
      // immediately. The presence `sync` that follows the untrack then agrees, so there's
      // no flicker/reappear.
      try { await channelRef.current.send({ type: "broadcast", event: "member_left", payload: { userId } }); } catch {}
      try { await channelRef.current.untrack(); } catch {}
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
    if (reqChRef.current) {
      supabase.removeChannel(reqChRef.current);
      reqChRef.current = null;
    }
    if (sessionIdRef.current) {
      const sid = sessionIdRef.current;
      const durSecs = Math.round((Date.now() - joinedAtRef.current) / 1000);
      supabase.from("room_sessions").update({
        left_at:       new Date().toISOString(),
        duration_secs: durSecs,
        working_on:    workingOnRef.current || null,
        goal_text:     goalTextRef.current || workingOnRef.current || null,
        goal_met:      goalMet,
      }).eq("id", sid).then(() => {
        // +5 per completed 15-min block — server recomputes duration from joined_at
        awardTokens("study_session_15min", { sessionId: sid }).catch(() => {});
      });
    }
    // Owners keep their membership so they can re-enter without re-joining.
    // Only guests have their row cleaned up when they leave.
    if (!isHost) leaveRoom(userId, room.id).catch(() => {});
  }

  function handleWorkingOnChange(val) {
    setWorkingOn(val);
    workingOnRef.current = val;
    clearTimeout(workingOnDebounce.current);
    workingOnDebounce.current = setTimeout(async () => {
      if (channelRef.current) {
        try { await channelRef.current.track(presencePayload(val)); } catch {}
      }
    }, 500);
  }

  async function handleLeave() {
    setSummaryDurationSecs(Math.round((Date.now() - joinedAtRef.current) / 1000));
    setShowSummary(true);
  }

  async function confirmLeave(goalMet) {
    setShowSummary(false);
    await endSession(goalMet);
    onLeave();
  }

  async function fetchCourseName() {
    if (!room.course_id) return;
    const { data } = await supabase.from("courses").select("name, course_code").eq("id", room.course_id).maybeSingle();
    if (data) setCourseName(data.course_code ? `${data.course_code} — ${data.name}` : data.name);
  }

  async function handleCloseRoom() {
    await supabase.from("study_rooms").update({ is_active: false }).eq("id", room.id);
    if (channelRef.current) {
      try {
        await channelRef.current.send({ type: "broadcast", event: "room_closed", payload: {} });
      } catch {}
    }
      if (aiSessionIdRef.current) {
      try {
        const result = await endRoomSession(aiSessionIdRef.current);

        console.log(
          "[room-session] ended AI session",
          result.sessionId
        );

        aiSessionIdRef.current = null;
      } catch (error) {
        console.error(
          "[room-session] failed to end:",
          error
        );
      }
    }
    await endSession();
    onLeave();
  }

  // Owner-only: persist new access filters (server checks ownership) + tell the room.
  async function saveAccess(filters: AccessFilters) {
    const clean = { ...filters };
    if (!room.course_id) delete clean.course;
    setAccessFilters(clean);
    setShowAccess(false);
    try {
      await setRoomAccess(userId, room.id, clean);
      room.access_filters = clean; // keep the prop mirror in sync for re-renders
      channelRef.current?.send({ type: "broadcast", event: "access_changed", payload: { filters: clean } }).catch(() => {});
    } catch (err) {
      console.error("[rooms] set access:", (err as any)?.message);
    }
  }

  // Chat is always docked in the left bar now, so load history on room entry rather
  // than on a button click.
  useEffect(() => { loadChatOnce(); }, []);

  // Keep the docked left chat pinned to the newest message as it grows / when the bar opens.
  useEffect(() => {
    if (!leftBarOpen) return;
    leftChatEndRef.current?.scrollIntoView({ block: "end" });
  }, [chatMessages, leftBarOpen]);

  function loadChatOnce() {
    if (chatLoadedRef.current) return;
    chatLoadedRef.current = true;
    loadRecentMessages(userId, room.id).then(setChatMessages).catch(err => {
      console.error("[chat] load:", (err as any)?.message);
      chatLoadedRef.current = false; // allow retry on a later attempt if it failed
    });
  }

  function handleOpenChat() {
    setShowChat(true);   // focus-mode floating chat
    loadChatOnce();
  }

  // ── Peer-to-peer voice ─────────────────────────────────────────────────────────
  async function joinVoice() {
    primeAiAudio();   // unlock AI playback within this user gesture
    if (voiceLiveRef.current) return;
    setVoiceError(null);
    try {
      const rv = await startRoomVoice(userId, {
        sendSignal: (to, data) => {
          channelRef.current?.send({ type: "broadcast", event: "voice_signal", payload: { from: userId, to, data } }).catch(() => {});
        },
        onRemoteStream: (id, stream) => setRemoteStreams(prev => ({ ...prev, [id]: stream })),
        onRemoteGone: (id) => {
          setRemoteStreams(prev => { const n = { ...prev }; delete n[id]; return n; });
          setVoiceSpeaking(prev => { const n = { ...prev }; delete n[id]; return n; });
        },
        onSpeaking: (id, sp) => setVoiceSpeaking(prev => (prev[id] === sp ? prev : { ...prev, [id]: sp })),
        onError: (msg) => setVoiceError(msg),
      });
      roomVoiceRef.current = rv;
      // Join muted by default — you arrive listening, then choose to speak. Speaker
      // stays on (speakerOn defaults true) so you hear the room immediately.
      rv.setMuted(true);
      voiceLiveRef.current = true;
      micMutedRef.current = true;
      setVoiceLive(true);
      setMicMuted(true);
      pushPresence();   // tell the room I'm in voice; peers open connections to me
    } catch {
      // startRoomVoice already reported the mic error via onError.
      leaveVoice();
    }
  }

  function toggleMic() {
    if (!voiceLiveRef.current) { joinVoice(); return; }   // first tap joins
    const next = !micMutedRef.current;
    micMutedRef.current = next;
    setMicMuted(next);
    roomVoiceRef.current?.setMuted(next);
    pushPresence();
  }

  function toggleSpeaker() { primeAiAudio(); setSpeakerOn(s => !s); }   // local playback only — no signaling

  function leaveVoice() {
    roomVoiceRef.current?.stop();
    roomVoiceRef.current = null;
    voiceLiveRef.current = false;
    micMutedRef.current = false;
    setVoiceLive(false);
    setMicMuted(false);
    setRemoteStreams({});
    setVoiceSpeaking({});
    if (channelRef.current) pushPresence();   // clear my voice state for peers still here
  }

  // Reconcile the mesh whenever the roster of in-voice members changes. Connect only to
  // peers who are also live in voice (their presence carries voice.live).
  useEffect(() => {
    if (!voiceLive || !roomVoiceRef.current) return;
    const peerIds = members.filter((m: any) => m.userId !== userId && m.voice?.live).map((m: any) => m.userId);
    roomVoiceRef.current.setPeers(peerIds);
  }, [members, voiceLive]);

  // Surface a single "active speaker" name from the P2P speaking map for the guided
  // session / member-list indicators.
  useEffect(() => {
    const speaker = (members as any[]).find(m => voiceSpeaking[m.userId]);
    setActiveSpeakerName(speaker ? (speaker.userId === userId ? (userData?.name ?? "You") : speaker.name) : null);
  }, [voiceSpeaking, members]);

  // Stop voice if the component unmounts without a clean leave.
  useEffect(() => () => { roomVoiceRef.current?.stop(); }, []);

  // Mirror the shared transcript store into React state for rendering.
  useEffect(() => {
    const store = transcriptRef.current!;
    return store.subscribe(list => setTranscript([...list]));
  }, []);

  // Keep the transcript view pinned to the newest line.
  useEffect(() => { transcriptEndRef.current?.scrollIntoView({ block: "end" }); }, [transcript, livePartials, streamingAi]);

  // Elect the AI driver from the current roster (smallest userId; alone → me). Only the
  // driver runs the LLM + TTS loop, so the AI never answers twice or talks over itself.
  const driverId = electDriver((members.length ? members : [{ userId }]).map((m: any) => m.userId));
  useEffect(() => { amDriverRef.current = driverId === userId; }, [driverId]);
  // If I become the driver mid-loop but don't own that loop (the previous driver left),
  // end it cleanly so the "solving" banner can't get stuck for everyone.
  useEffect(() => {
    if (driverId === userId && solving && !solvingRef.current) endSolve();
  }, [driverId, solving]);
  const speakerOnRef = useRef(true);
  useEffect(() => { speakerOnRef.current = speakerOn; }, [speakerOn]);
  useEffect(() => { proactiveOnRef.current = proactiveOn; }, [proactiveOn]);
  useEffect(() => { livePartialsRef.current = livePartials; }, [livePartials]);
  // Barge-in: the moment I start talking (mic on + detected speaking), Reggie yields —
  // pause the current clip and skip the rest of this turn. Feels human, not a droning bot.
  useEffect(() => {
    // Only latch a barge while Reggie is actually speaking — otherwise the asker's own
    // trailing speech (right before the reply) would wrongly suppress the whole turn.
    if (voiceSpeaking[userId] && !micMutedRef.current && aiSpeakingRef.current) {
      aiBargedRef.current = true;
      try { aiSourceRef.current?.stop(); } catch { /* nothing playing */ }
    }
  }, [voiceSpeaking]);

  // ── In-room AI ("Reggie"): trigger → LLM → TTS ──────────────────────────────────
  // Anyone can summon; if I'm the driver I handle it, otherwise I hand it to the driver
  // over the channel (the driver won't hear its own broadcast, so it self-handles).
  function requestAi(question: string, askerName: string) {
    if (amDriverRef.current) { enterSolve(); fireAiTurn("ask", { question, askerName }); }   // explicit ask starts the loop
    else channelRef.current?.send({ type: "broadcast", event: "ai_request", payload: { id: `${userId}-${++aiReqSeqRef.current}`, askerId: userId, askerName, text: (question || "").trim() } }).catch(() => {});
  }

  // Stop whatever Reggie is currently saying/doing so a newer turn can take over cleanly.
  function abortAiTurn() {
    try { aiAbortRef.current?.abort(); } catch { /* none in flight */ }
    aiAbortRef.current = null;
    aiBargedRef.current = true;                       // pending clips in the old chain skip
    try { aiSourceRef.current?.stop(); } catch { /* nothing playing */ }
    aiSourceRef.current = null;
    aiSpeakingRef.current = false;
    aiSpeakChainRef.current = Promise.resolve();      // fresh playback chain for the new turn
  }

  /**
   * Run ONE Reggie turn (driver only), gen-stamped so the newest turn always wins. If a
   * turn is already in flight it's aborted first — this is the whole point of the solve
   * loop: the moment fresh speech settles, we cancel the stale answer and respond to the
   * latest. mode "ask"/"solve" stream + speak; "proactive" is a one-off SILENT-or-hint call.
   */
  async function fireAiTurn(mode: "ask" | "solve" | "proactive", opts: { question?: string; askerName?: string } = {}) {
    if (!amDriverRef.current) return;
    abortAiTurn();                                    // supersede any in-flight turn
    const gen = ++aiGenRef.current;
    const live = () => gen === aiGenRef.current;      // am I still the newest turn?
    const ac = new AbortController();
    aiAbortRef.current = ac;
    aiActiveRef.current = true;
    setAiThinking(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("no auth");
      await ensureRoomAiSession(token);
      if (!live()) return;
      const isProactive = mode === "proactive";
      const context = transcriptRef.current?.forPrompt({ limit: isProactive ? 10 : 24, maxChars: isProactive ? 1200 : 2200 }) ?? "";

      if (isProactive) {
        const r = await fetch("/api/room-ai?action=group", {
          method: "POST", signal: ac.signal,
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ roomId: room.id, message: buildProactivePrompt(context) }),
        });
        const d = await r.json().catch(() => ({}));
        const text = String(d?.message ?? "").trim();
        if (!live()) return;
        // If Reggie chimes in, it stays engaged — enter the solve loop so follow-ups answer.
        if (r.ok && text && !isProactiveSilent(text)) { broadcastAiMessage(text); enterSolve(); }
      } else {
        const prompt = mode === "solve" ? buildSolvePrompt(context) : buildAiPrompt(context, opts.askerName || "Someone", opts.question || "");
        const turnId = `reggie-${++aiMsgSeqRef.current}`;
        let full = "";
        const chunker = createSentenceChunker((sentence) => {
          if (!live()) return;                        // a newer turn superseded us mid-sentence
          const s = stripSolvedToken(sentence);
          if (!s) return;
          const chunk = { turnId, text: s };
          applyAiChunk(chunk);
          channelRef.current?.send({ type: "broadcast", event: "ai_chunk", payload: chunk }).catch(() => {});
        });
        await streamRoomAiTokens(token, prompt, (tok) => { if (live()) { full += tok; chunker.feed(tok); } }, ac.signal);
        if (!live()) return;                          // superseded during the stream — drop it
        chunker.flush();
        const done = { turnId, text: stripSolvedToken(full) };
        applyAiDone(done);
        channelRef.current?.send({ type: "broadcast", event: "ai_done", payload: done }).catch(() => {});
        // The model appends [SOLVED] once the room confirms; otherwise cap the turns.
        if (solvingRef.current) {
          solveTurnsRef.current++;
          if (hasSolvedToken(full) || solveTurnsRef.current >= SOLVE_MAX_TURNS) endSolve();
        }
      }
    } catch { /* aborted (superseded) or a transient error — the room keeps going */ }
    finally {
      if (live()) {
        aiActiveRef.current = false;
        setAiThinking(false);
        if (solvingRef.current) armSolveIdle();       // now awaiting the room's next reply
      }
    }
  }

  // Driver → everyone: the AI's turn. Applied locally too (no self-echo on broadcast).
  function broadcastAiMessage(text: string) {
    const msg = { id: `reggie-${++aiMsgSeqRef.current}`, text, ts: Date.now() };
    applyAiMessage(msg);
    channelRef.current?.send({ type: "broadcast", event: "ai_message", payload: msg }).catch(() => {});
  }

  // All clients: record the AI turn in the shared transcript and speak it (if sound is on).
  // Used by the non-streamed (proactive) path.
  function applyAiMessage(msg: { id: string; text: string; ts: number }) {
    aiBargedRef.current = false;          // fresh turn — clear any prior barge-in
    lastAiTurnRef.current = Date.now();   // start the proactive-interjection cooldown
    transcriptRef.current?.add({ id: `reggie:${msg.id}`, speakerId: "reggie", speakerName: "Reggie", text: msg.text, ts: msg.ts, seq: 0 });
    if (speakerOnRef.current) speakAi(msg.text);
  }

  // Consume the room-ai SSE stream (raw Anthropic format), calling onToken per text delta.
  async function streamRoomAiTokens(token: string, prompt: string, onToken: (t: string) => void, signal?: AbortSignal) {
    const r = await fetch("/api/room-ai?action=group", {
      method: "POST", signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ roomId: room.id, message: prompt, stream: true }),
    });
    if (!r.ok || !r.body) throw new Error(`stream ${r.status}`);
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const events = buf.split("\n\n");
      buf = events.pop() ?? "";
      for (const ev of events) {
        for (const line of ev.split("\n")) {
          const m = line.match(/^data: (.*)$/);
          if (!m || m[1] === "[DONE]") continue;
          try {
            const j = JSON.parse(m[1]);
            if (j.type === "content_block_delta" && j.delta?.type === "text_delta") onToken(j.delta.text ?? "");
          } catch { /* keep-alive / non-JSON frame */ }
        }
      }
    }
  }

  // Streaming AI turn — a finished sentence. Speak it now (chunked queue) and show it
  // building in the transcript. First chunk of a new turn resets barge-in + the live line.
  function applyAiChunk(chunk: { turnId: string; text: string }) {
    if (chunk.turnId !== currentAiTurnRef.current) {
      currentAiTurnRef.current = chunk.turnId;
      aiBargedRef.current = false;
      aiStreamTextRef.current = "";
    }
    aiStreamTextRef.current += (aiStreamTextRef.current ? " " : "") + chunk.text;
    setStreamingAi({ turnId: chunk.turnId, text: aiStreamTextRef.current });
    lastAiTurnRef.current = Date.now();
    if (speakerOnRef.current) speakAi(chunk.text);
  }

  // Streaming AI turn finished — commit the full text to the shared transcript (one line)
  // and clear the live streaming display.
  function applyAiDone(done: { turnId: string; text: string }) {
    transcriptRef.current?.add({ id: `reggie:${done.turnId}`, speakerId: "reggie", speakerName: "Reggie", text: done.text, ts: Date.now(), seq: 0 });
    lastAiTurnRef.current = Date.now();
    aiStreamTextRef.current = "";
    setStreamingAi(prev => (prev?.turnId === done.turnId ? null : prev));
  }

  // ── Proactive/ambient loop (driver only) ────────────────────────────────────────
  // Debounced a beat after the last human segment (interject at a pause, not mid-flow).
  const PROACTIVE_QUIET_MS = 2500;      // wait for a lull before considering a chime-in
  const PROACTIVE_COOLDOWN_MS = 45000;  // min gap after any AI turn
  const PROACTIVE_THROTTLE_MS = 20000;  // min gap between Stage-B (LLM) checks

  function scheduleProactiveCheck() {
    if (!amDriverRef.current || !proactiveOnRef.current) return;
    if (proactiveTimerRef.current) clearTimeout(proactiveTimerRef.current);
    proactiveTimerRef.current = setTimeout(maybeProactive, PROACTIVE_QUIET_MS);
  }

  function maybeProactive() {
    if (!amDriverRef.current || !proactiveOnRef.current || aiActiveRef.current) return;
    if (solvingRef.current) return;   // a query loop owns the floor — don't also chime in
    if (Object.keys(livePartialsRef.current).length) return;   // someone is mid-sentence — wait
    const now = Date.now();
    if (now - lastAiTurnRef.current < PROACTIVE_COOLDOWN_MS) return;
    if (now - lastProactiveRef.current < PROACTIVE_THROTTLE_MS) return;
    // Stage A (free): only spend an LLM call if the recent human talk shows confusion.
    const humans = (transcriptRef.current?.list() ?? []).filter(u => u.speakerId !== "reggie");
    const recent = humans.slice(-6).map(u => u.text).join(" ");
    if (!detectConfusion(recent)) return;
    lastProactiveRef.current = now;
    fireAiTurn("proactive");   // Stage B: the LLM decides + generates, or replies SILENT
  }

  function toggleProactive() {
    const next = !proactiveOnRef.current;
    proactiveOnRef.current = next;
    setProactiveOn(next);
    channelRef.current?.send({ type: "broadcast", event: "proactive_set", payload: { on: next } }).catch(() => {});
  }

  // ── Query-solving loop (driver only; one loop room-wide) ─────────────────────────
  const SOLVE_MAX_TURNS = 12;         // hard cap so a loop can never run away
  const SOLVE_IDLE_MS = 90000;        // genuinely long silence (reading/thinking is fine) → end
  const SOLVE_FOLLOWUP_QUIET_MS = 1500;   // wait for a short lull before the next Reggie turn

  function enterSolve() {
    if (solvingRef.current) return;   // already looping — the new ask just continues it
    solvingRef.current = true;
    solveTurnsRef.current = 0;
    setSolving(true);
    channelRef.current?.send({ type: "broadcast", event: "solve_state", payload: { active: true } }).catch(() => {});
  }

  function endSolve() {
    if (!solvingRef.current && !solving) { /* still clear timers below */ }
    solvingRef.current = false;
    solveTurnsRef.current = 0;
    if (solveIdleTimerRef.current) { clearTimeout(solveIdleTimerRef.current); solveIdleTimerRef.current = null; }
    if (solveFollowupTimerRef.current) { clearTimeout(solveFollowupTimerRef.current); solveFollowupTimerRef.current = null; }
    setSolving(false);
    setAiThinking(false);
    channelRef.current?.send({ type: "broadcast", event: "solve_state", payload: { active: false } }).catch(() => {});
  }

  // Any client can end the loop (the "Done" button); the driver tears it down and cuts off
  // any in-flight answer. (The SOLVED/idle paths call endSolve WITHOUT aborting, so Reggie's
  // closing line plays out.)
  function requestEndSolve() {
    if (amDriverRef.current) { abortAiTurn(); endSolve(); }
    else channelRef.current?.send({ type: "broadcast", event: "solve_end", payload: {} }).catch(() => {});
  }

  function armSolveIdle() {
    if (solveIdleTimerRef.current) clearTimeout(solveIdleTimerRef.current);
    solveIdleTimerRef.current = setTimeout(() => { if (solvingRef.current) endSolve(); }, SOLVE_IDLE_MS);
  }

  function scheduleSolveFollowup() {
    setAiThinking(true);   // your turn landed → show "Reggie is thinking" through the lull + LLM call
    if (solveFollowupTimerRef.current) clearTimeout(solveFollowupTimerRef.current);
    solveFollowupTimerRef.current = setTimeout(() => {
      if (!solvingRef.current || !amDriverRef.current) return;
      if (Object.keys(livePartialsRef.current).length) { scheduleSolveFollowup(); return; }   // still talking — wait for the lull
      // Fire on the latest transcript. If a turn is already generating, fireAiTurn aborts it
      // and responds to the newer input — exactly the interrupt-and-refire behaviour we want.
      fireAiTurn("solve");
    }, SOLVE_FOLLOWUP_QUIET_MS);
  }

  // Every committed human turn (mine or a peer's) routes here on the driver: advance the
  // solve loop if one is running, otherwise consider a proactive chime-in.
  function onHumanTurn(text: string) {
    if (!amDriverRef.current) return;
    if (solvingRef.current) {
      if (solveIdleTimerRef.current) { clearTimeout(solveIdleTimerRef.current); solveIdleTimerRef.current = null; }
      if (isSolveDone(text)) { endSolve(); return; }   // user's satisfied → stop
      scheduleSolveFollowup();
    } else {
      scheduleProactiveCheck();
    }
  }

  // ── Push-to-talk "Ask Reggie" ───────────────────────────────────────────────────
  // Start capturing: everything spoken until Submit becomes the question. If I'm already
  // STT-ing (unmuted in voice) we tap that stream; otherwise spin a temporary capture mic.
  async function startCapture() {
    primeAiAudio();   // unlock AI playback within this user gesture
    if (!isStreamingSTT()) { requestAi("", userData?.name ?? "Someone"); return; }   // no STT → generic ask
    captureTextRef.current = "";
    setCaptureText("");
    setCapturePartial("");
    setCaptureMode(true);
    captureActiveRef.current = true;
    if (!scribeRef.current) await startCaptureMic();
  }

  async function startCaptureMic() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      captureStreamRef.current = stream;
      captureScribeRef.current = await startScribeSession({
        stream,
        idleClose: false,
        onPartial: (t) => setCapturePartial(t.trim()),
        onSegment: (t) => {
          const s = t.trim();
          if (!s) return;
          captureTextRef.current += (captureTextRef.current ? " " : "") + s;
          setCaptureText(captureTextRef.current);
          setCapturePartial("");
        },
        onError: () => {},
      });
    } catch { /* mic denied — the user can still cancel out */ }
  }

  function stopCaptureMic() {
    try { captureScribeRef.current?.stop(); } catch { /* already closed */ }
    captureScribeRef.current = null;
    captureStreamRef.current?.getTracks().forEach(t => t.stop());
    captureStreamRef.current = null;
  }

  // Submit → fire the question at Reggie (context vs. query kept separate in the prompt).
  // Cancel → drop it. Either way, tear down capture.
  function stopCapture(commit: boolean) {
    primeAiAudio();   // Submit/Cancel is a gesture — keep AI playback unlocked
    captureActiveRef.current = false;
    stopCaptureMic();
    setCaptureMode(false);
    const q = captureTextRef.current.trim();
    captureTextRef.current = "";
    setCaptureText("");
    setCapturePartial("");
    if (commit && q) requestAi(q, userData?.name ?? "Someone");
  }

  // Unlock the WebAudio context inside a user gesture (join / ask / submit / speaker), so
  // Reggie's later programmatic playback is allowed.
  function primeAiAudio() {
    try { roomAudioCtx(); } catch { /* WebAudio unavailable */ }
  }

  // Serialized playback so consecutive AI clips never overlap; each clip synthesizes while
  // the previous plays, so streamed sentences are heard back-to-back. Plays through the
  // shared WebAudio context (reliable once resumed on a gesture). Skips/stops on barge-in.
  function speakAi(text: string) {
    aiSpeakChainRef.current = aiSpeakChainRef.current.then(() => new Promise<void>((resolve) => {
      if (aiBargedRef.current) { resolve(); return; }   // user started talking — yield the floor
      (async () => {
        try {
          // Use the base64-JSON path (same as the orb): the dev proxy returns { audio }
          // regardless of ?action, and decodeAudioData needs the decoded bytes anyway.
          const r = await fetch("/api/tts", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: gsStripForSpeech(text) }),
          });
          if (!r.ok) throw new Error("tts");
          const { audio } = await r.json();
          if (!audio) throw new Error("no audio");
          const bin = atob(audio);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          const ctx = roomAudioCtx();
          if (ctx.state === "suspended") { try { await ctx.resume(); } catch { /* stays suspended */ } }
          const audioBuffer = await ctx.decodeAudioData(bytes.buffer);
          if (aiBargedRef.current) { resolve(); return; }   // barged during fetch/decode
          const source = ctx.createBufferSource();
          source.buffer = audioBuffer;
          source.connect(ctx.destination);
          aiSourceRef.current = source;
          aiSpeakingRef.current = true;
          source.onended = () => {
            aiSpeakingRef.current = false;
            if (aiSourceRef.current === source) aiSourceRef.current = null;
            resolve();
          };
          source.start(0);
        } catch { aiSpeakingRef.current = false; resolve(); }
      })();
    }));
  }

  // Run my own STT while I'm unmuted in voice — one Scribe session over the mic stream
  // roomVoice already owns. Each committed segment becomes an utterance: added to the
  // shared store locally AND broadcast so every peer merges the same record. Partials feed
  // live captions only (not the source of truth). Gated by VITE_VOICE_STREAMING; when off,
  // voice still works and the transcript simply stays empty.
  useEffect(() => {
    const shouldRun = voiceLive && !micMuted && isStreamingSTT();
    if (!shouldRun) {
      scribeRef.current?.stop();
      scribeRef.current = null;
      setLivePartials(prev => { if (!(userId in prev)) return prev; const n = { ...prev }; delete n[userId]; return n; });
      return;
    }
    const stream = roomVoiceRef.current?.getLocalStream();
    if (!stream) return;
    const myName = userData?.name ?? "You";
    let cancelled = false;
    (async () => {
      try {
        const session = await startScribeSession({
          stream,
          idleClose: false,   // stay open across silences while unmuted
          onPartial: (text) => {
            const t = text.trim();
            if (captureActiveRef.current) setCapturePartial(t);   // Ask-Reggie capture in progress
            setLivePartials(prev => ({ ...prev, [userId]: { name: myName, text: t } }));
            channelRef.current?.send({ type: "broadcast", event: "transcript_partial", payload: { speakerId: userId, name: myName, text: t } }).catch(() => {});
          },
          onSegment: (text) => {
            const t = text.trim();
            if (!t) return;
            const seq = ++transcriptSeqRef.current;
            const u: Utterance = { id: `${userId}:${seq}`, speakerId: userId, speakerName: myName, text: t, ts: Date.now(), seq };
            transcriptRef.current?.add(u);
            setLivePartials(prev => { if (!(userId in prev)) return prev; const n = { ...prev }; delete n[userId]; return n; });
            channelRef.current?.send({ type: "broadcast", event: "transcript", payload: u }).catch(() => {});
            // Ask-Reggie capture: this segment is part of the question, not a room summon.
            if (captureActiveRef.current) {
              captureTextRef.current += (captureTextRef.current ? " " : "") + t;
              setCaptureText(captureTextRef.current);
              setCapturePartial("");
            } else {
              // Spoken summon: "hey Reggie, …" → ask the AI (the driver answers).
              const ask = parseWakeWord(t);
              if (ask !== null) requestAi(ask, myName);
              else onHumanTurn(t);   // advance a solve loop, or maybe chime in proactively
            }
          },
          onError: () => {},   // transcript just goes quiet; voice itself is unaffected
        });
        if (cancelled) session.stop();
        else scribeRef.current = session;
      } catch { /* token/mic issue — no transcript, voice keeps working */ }
    })();
    return () => { cancelled = true; scribeRef.current?.stop(); scribeRef.current = null; };
  }, [voiceLive, micMuted]);

  function handleOpenBoard() {
    setShowBoard(true);
    // Push a fake history entry so Android swipe-back closes the board
    // instead of navigating away from the room.
    history.pushState({ boardGuard: true }, '');
  }

  useEffect(() => {
    if (!showBoard) return;
    function onPop() { setShowBoard(false); }
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [showBoard]);

  // Snapshot bridge for Study Assistant: the whiteboard is session-only and
  // never persisted, and Study Assistant is a separate page (this component
  // unmounts on navigation) — so periodically capture the canvas into
  // AppContext while the Board panel is open, which is the only place that
  // survives the page switch. Captured on an interval (not per-stroke) to
  // avoid re-encoding a full PNG on every pointer move.
  useEffect(() => {
    if (!showBoard) return;
    function capture() {
      const canvas = document.querySelector("canvas[data-whiteboard-canvas]") as HTMLCanvasElement | null;
      if (!canvas) return;
      try {
        const dataUrl = canvas.toDataURL("image/png");
        setWhiteboardSnapshot({ dataUrl, capturedAt: Date.now(), roomId: room.id });
      } catch { /* tainted canvas or similar — skip this tick */ }
    }
    capture();
    const interval = setInterval(capture, 4000);
    return () => clearInterval(interval);
  }, [showBoard, room.id, setWhiteboardSnapshot]);

  // Ctrl/Cmd+Z → undo, Ctrl/Cmd+Shift+Z or Ctrl+Y → redo (whiteboard only).
  const undoHandlerRef = useRef(handleUndoStroke);
  const redoHandlerRef = useRef(handleRedoStroke);
  undoHandlerRef.current = handleUndoStroke;
  redoHandlerRef.current = handleRedoStroke;
  useEffect(() => {
    if (!showBoard) return;
    function onKey(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); undoHandlerRef.current(); }
      if ((e.key === 'z' && e.shiftKey) || e.key === 'y') { e.preventDefault(); redoHandlerRef.current(); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showBoard]);

  function handleStrokeComplete(stroke:
    | { mode: "pen" | "erase"; style: PenStyle; color: string; width: number; points: Point[] }
    | { mode: "image"; url: string; x: number; y: number; w: number; h: number }
  ) {
    const newStroke = {
      id: (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36)),
      room_id: room.id,
      user_id: userId,
      name: userData?.name ?? "Anonymous",
      created_at: new Date().toISOString(),
      ...stroke,
    } as Stroke;
    setStrokes(prev => [...prev, newStroke]);
    yjsStrokesRef.current?.push([newStroke]);
    // Track for undo; new stroke invalidates the redo history.
    wbUndoStack.current.push(newStroke);
    wbRedoStack.current = [];
    setCanUndo(true);
    setCanRedo(false);
  }

  // ── AI-06 / BE-07: push an AI-readable board snapshot once the board goes quiet ──────
  // The live board is a Yjs doc in browser memory and is never written to Postgres, so the
  // server cannot read it — the client holding the doc has to push. whiteboard_snapshots is
  // therefore the ONLY durable record of a board, and without this the room AI has no board
  // context to cite (api/_board.ts explains the model in full).
  //
  // Every member emits: the board has no leader to elect, and electing one would stop
  // snapshots dead the moment that member left. That is safe because the server dedupes on
  // a content digest — the first push of a given board state writes the row and the rest are
  // no-ops. `revision` is deliberately NOT sent: with concurrent editors no client can know
  // the current revision, so the server assigns it.
  useEffect(() => {
    if (!room?.id || !strokes.length) return;
    clearTimeout(wbSnapTimerRef.current);
    wbSnapTimerRef.current = setTimeout(async () => {
      if (wbSnapInFlightRef.current) return;   // never queue behind a slow push
      wbSnapInFlightRef.current = true;
      try {
        // Read from Yjs, not React state: the doc is the source of truth and may have
        // advanced since this effect was scheduled.
        const current = (yjsStrokesRef.current?.toArray() as Stroke[]) ?? strokes;
        if (!current.length) return;
        await fetch("/api/room-board?action=snapshot", {
          method: "POST",
          headers: { "Content-Type": "application/json" },   // JWT added by installApiAuth
          body: JSON.stringify({ roomId: room.id, strokes: current }),
        });
      } catch {
        // Non-fatal by design: a dropped snapshot costs nothing a later milestone cannot
        // recover, and a failed background push must never surface in a study session.
      } finally {
        wbSnapInFlightRef.current = false;
      }
    }, WB_SNAPSHOT_QUIET_MS);
    return () => clearTimeout(wbSnapTimerRef.current);
  }, [strokes, room?.id]);

  function handleEraseStroke(strokeId: string) {
    const arr = yjsStrokesRef.current;
    if (!arr) return;
    const idx = (arr.toArray() as any[]).findIndex(s => s.id === strokeId);
    if (idx !== -1) arr.delete(idx, 1);
    // Yjs observer fires → setStrokes() → canvas re-renders and peers sync.
  }

  function handleUndoStroke() {
    const stroke = wbUndoStack.current.pop();
    if (!stroke) return;
    wbRedoStack.current.push(stroke);
    setCanUndo(wbUndoStack.current.length > 0);
    setCanRedo(true);
    handleEraseStroke(stroke.id);
  }

  function handleRedoStroke() {
    const stroke = wbRedoStack.current.pop();
    if (!stroke) return;
    wbUndoStack.current.push(stroke);
    setCanUndo(true);
    setCanRedo(wbRedoStack.current.length > 0);
    yjsStrokesRef.current?.push([stroke]);
  }

  function handleBgChange(bg: string) {
    setWbBg(bg);
    yjsMetaRef.current?.set("bg", bg);
    // Yjs meta observer on peers fires → setWbBg(). Provider broadcasts the delta.
  }

  // Realtime bills every message SENT and every DELIVERY — broadcasting cursor/laser/
  // live-stroke traffic with nobody else in the room is pure billed waste. Presence
  // keys are per-member, so >1 means someone else can actually see the broadcast.
  function othersPresent(): boolean {
    try { return Object.keys(channelRef.current?.presenceState() ?? {}).length > 1; }
    catch { return false; }
  }

  function handleLiveStroke(draft: { mode: "pen" | "erase"; style: PenStyle; color: string; width: number; points: Point[] } | null) {
    if (!draft) return; // stroke finished — wb_stroke broadcast clears peers' live preview
    if (!othersPresent()) return;
    const now = Date.now();
    if (now - lastLiveSentRef.current < 70) return; // ~14/s — under the 30/s realtime budget
    lastLiveSentRef.current = now;
    channelRef.current?.send({ type: "broadcast", event: "wb_live", payload: { userId, ...draft } }).catch(() => {});
  }

  function handleCursorMove(x: number | null, y: number | null) {
    if (!othersPresent()) return;
    const now = Date.now();
    if (now - lastCursorSentRef.current < 100) return; // ~10/s — plenty for a cursor dot
    lastCursorSentRef.current = now;
    channelRef.current?.send({
      type: "broadcast", event: "wb_cursor",
      payload: { userId, name: userData?.name ?? "?", x, y },
    }).catch(() => {});
  }

  function handleLaserMove(pos: { x: number; y: number } | null) {
    if (!othersPresent()) return;
    // Laser-off (pos === null) must always send so peers clear the dot; MOVES are
    // throttled like live strokes — this used to fire completely unthrottled at
    // pointer-event rate (60-120 msg/s), the single largest realtime message source.
    if (pos !== null) {
      const now = Date.now();
      if (now - lastLaserSentRef.current < 70) return; // ~14/s
      lastLaserSentRef.current = now;
    }
    channelRef.current?.send({
      type: "broadcast", event: "wb_laser",
      payload: { userId, x: pos?.x ?? 0, y: pos?.y ?? 0, active: pos !== null },
    }).catch(() => {});
  }

  function handleClearBoard() {
    const arr = yjsStrokesRef.current;
    if (arr && arr.length > 0) arr.doc?.transact(() => { arr.delete(0, arr.length); });
    yjsMetaRef.current?.set("bg", DEFAULT_BG);
    setLiveStrokes({});
    wbUndoStack.current = [];
    wbRedoStack.current = [];
    setCanUndo(false);
    setCanRedo(false);
  }

  // ── Board cards — structured notes/quizzes on the shared whiteboard (Yjs "cards").
  //    Reggie materializes cards through the same array, so one write syncs everyone.
  function addBoardCards(cards: any[], createdBy = "Reggie") {
    const arr = yjsCardsRef.current;
    if (!arr || !cards.length) return;
    const stamped = cards.map((c, i) => ({
      ...c,
      id: `card-${Date.now()}-${Math.floor(Math.random() * 1e6)}-${i}`,
      createdBy, createdAt: Date.now(),
    }));
    arr.doc?.transact(() => { arr.push(stamped); });
    setShowBoard(true); setCenterTab("board"); // cards landing off-screen helps nobody
  }
  // Dev-only: lets local verification inject cards without an AI turn (the Reggie
  // path needs live API credits). import.meta.env.DEV in EXACT form — Vite statically
  // replaces it, so this whole effect is dead code in production builds.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as any).__fschoolAddCards = addBoardCards;
    console.log("[dev] __fschoolAddCards registered");
    return () => { delete (window as any).__fschoolAddCards; };
  }, []);
  const cardIndex = (id: string) => (yjsCardsRef.current?.toArray() ?? []).findIndex((c: any) => c?.id === id);
  function replaceBoardCard(id: string, patch: any) {
    const arr = yjsCardsRef.current;
    if (!arr) return;
    const i = cardIndex(id);
    if (i < 0) return;
    const cur = arr.get(i);
    arr.doc?.transact(() => { arr.delete(i, 1); arr.insert(i, [{ ...cur, ...patch }]); });
  }
  const handleCardMove   = (id: string, x: number, y: number) => replaceBoardCard(id, { x, y });
  const handleCardAnswer = (id: string, optionIndex: number) => replaceBoardCard(id, { answeredIndex: optionIndex, answeredBy: userData?.name ?? "Someone" });
  function handleCardDelete(id: string) {
    const arr = yjsCardsRef.current;
    const i = cardIndex(id);
    if (arr && i >= 0) arr.doc?.transact(() => { arr.delete(i, 1); });
  }

  // ── Text-to-Reggie (group, non-streamed) — the typed sibling of the voice ask.
  //    Uses allowCards so "put a quiz on the board" materializes cards for everyone.
  const [reggieTextInput, setReggieTextInput] = useState("");
  const [reggieTextBusy,  setReggieTextBusy]  = useState(false);
  async function askReggieText(question: string, opts: { silent?: boolean } = {}) {
    const q = question.trim();
    if (!q || reggieTextBusy) return;
    setReggieTextBusy(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("no auth");
      await ensureRoomAiSession(token);
      if (!opts.silent) {
        transcriptRef.current?.add({ id: `ask:${Date.now()}`, speakerId: userId, speakerName: userData?.name ?? "You", text: q, ts: Date.now(), seq: 0 });
      }
      const r = await fetch("/api/room-ai?action=group", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ roomId: room.id, message: q, allowCards: true }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d?.message) {
        broadcastAiMessage(String(d.message));
        if (Array.isArray(d.cards) && d.cards.length) addBoardCards(d.cards);
      } else if (!r.ok) {
        setRoomToast("Reggie couldn't answer that one — try again.");
      }
    } catch { setRoomToast("Reggie couldn't answer that one — try again."); }
    finally { setReggieTextBusy(false); }
  }

  // ── In-room private Reggie (B1) — your own 1-on-1 tutor inside the room. Scoped
  //    server-side to YOUR Brain + your own thread; the reply returns only in your HTTP
  //    response (never broadcast), so nothing leaks to the group. Group @Reggie is later.
  const [showReggie,  setShowReggie]  = useState(false);
  const [reggieMsgs,  setReggieMsgs]  = useState<{ role: "user" | "assistant"; content: string; grounded?: GroundingRef | null }[]>([]);
  const [reggieInput, setReggieInput] = useState("");
  const [reggieBusy,  setReggieBusy]  = useState(false);
  const reggieSessionRef = useRef(false); // ensured an active AI session for this room yet?
  const [focusMode, setFocusMode] = useState(false); // redesign: Focus Mode collapses the side panels
  const [roomToast, setRoomToast] = useState<string | null>(null); // toasts are real events only — no fake seeds
  useEffect(() => { if (!roomToast) return; const t = setTimeout(() => setRoomToast(null), 6000); return () => clearTimeout(t); }, [roomToast]);

  // ── Guided study session (proactive, Reggie-driven) — center-stage tutor flow ──
  const [centerTab,     setCenterTab]     = useState<"board" | "session" | "flashcards">("board"); // the infinite board leads; session/flashcards swap in
  const [gs,            setGs]            = useState<null | { mode: "learn" | "assignment" | "exam"; topic: string; steps: { title: string; goal: string; estMin: number }[]; currentIdx: number; status: "planning" | "active" | "done"; startedAt: number }>(null);
  const [gsBusy,        setGsBusy]        = useState(false);
  const [gsBusyLabel,   setGsBusyLabel]   = useState("");
  const [gsStepContent, setGsStepContent] = useState<Record<number, string>>({});
  const [gsExtra,       setGsExtra]       = useState<Record<number, string[]>>({});
  const [gsNudge,       setGsNudge]       = useState("");
  const [gsAsk,         setGsAsk]         = useState("");
  const [gsAskOpen,     setGsAskOpen]     = useState(false);
  const [gsLaunchMode,  setGsLaunchMode]  = useState<"learn" | "assignment" | "exam">("learn");
  const [gsTopic,       setGsTopic]       = useState("");
  // Assignment mode can pick a REAL Canvas assignment (now that file/assignment sync
  // actually populates it) instead of typing a title. "__custom" = fall back to free text.
  const [gsAssignmentId, setGsAssignmentId] = useState<string>("");
  // Student's assignments, upcoming-first, for the assignment-mode picker.
  const gsAssignmentOptions = useMemo(() => {
    const now = Date.now();
    return [...(assignments || [])]
      .filter((a: any) => a && a.name)
      .sort((a: any, b: any) => {
        const ad = a.dueAt ? new Date(a.dueAt).getTime() : null;
        const bd = b.dueAt ? new Date(b.dueAt).getTime() : null;
        const af = ad != null && ad >= now, bf = bd != null && bd >= now;
        if (af && bf) return ad! - bd!;          // both upcoming → soonest first
        if (af !== bf) return af ? -1 : 1;        // upcoming before everything else
        if (ad != null && bd != null) return bd - ad; // both past → most recent first
        if ((ad != null) !== (bd != null)) return ad != null ? -1 : 1;
        return 0;
      })
      .slice(0, 50);
  }, [assignments]);
  const gsStripHtml = (s: any) => String(s || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  function gsAssignmentContext(a: any): string {
    if (!a) return "";
    const parts: string[] = [];
    const desc = gsStripHtml(a.description);
    if (desc) parts.push(desc.slice(0, 1000));
    if (a.dueAt) { try { parts.push(`Due: ${new Date(a.dueAt).toLocaleString()}`); } catch {} }
    if (a.pointsPossible) parts.push(`Worth ${a.pointsPossible} points`);
    if (a.courseCode || a.courseName) parts.push(`Course: ${[a.courseCode, a.courseName].filter(Boolean).join(" — ")}`);
    return parts.join("\n");
  }
  // Launch assignment mode from the picker: seed the topic + pass the real details.
  function gsStartAssignment() {
    const a = gsAssignmentOptions.find((x: any) => String(x.id) === gsAssignmentId);
    if (a) beginGuidedSession("assignment", a.name, gsAssignmentContext(a));
    else beginGuidedSession("assignment", gsTopic);   // "__custom" / free-text path
  }
  // Voice teaching (TTS) — Reggie reads steps aloud; auto-on for exam prep.
  const gsAudioRef = useRef<HTMLAudioElement | null>(null);
  const [gsSpeaking, setGsSpeaking] = useState(false);
  const [gsVoiceOn,  setGsVoiceOn]  = useState(false);
  const gsCurContent = gs && gs.status === "active" ? gsStepContent[gs.currentIdx] : undefined;
  useEffect(() => { if (gsVoiceOn && gsCurContent) gsSpeak(gsCurContent); /* eslint-disable-next-line */ }, [gsCurContent, gsVoiceOn]);
  useEffect(() => () => { try { gsAudioRef.current?.pause(); } catch {} }, []);

  // ── Flashcards in room — Reggie builds a deck, you review it (flip + rate) ──
  const [fcCards,   setFcCards]   = useState<{ q: string; a: string }[]>([]);
  const [fcIdx,     setFcIdx]     = useState(0);
  const [fcFlipped, setFcFlipped] = useState(false);
  const [fcBusy,    setFcBusy]    = useState(false);
  const [fcTopic,   setFcTopic]   = useState("");
  const [fcDone,    setFcDone]    = useState(false);
  const [fcResults, setFcResults] = useState<{ got: number; missed: number }>({ got: 0, missed: 0 });

  // ── Focus music — iTunes 30s previews the tutor/you can play while studying ──
  const musicAudioRef = useRef<HTMLAudioElement | null>(null);
  const [musicTracks,  setMusicTracks]  = useState<{ title: string; artist: string; previewUrl: string; artwork: string }[]>([]);
  const [musicPreset,  setMusicPreset]  = useState(MUSIC_PRESETS[0].query);
  // Proactive intervention card (silence / time-milestone / uneven nudges from the trigger engine,
  // delivered over the room channel). Refs (not state) back the realtime handler so it reads live
  // values — the handler closes over its setup-time scope.
  const [interventionCard, setInterventionCard] = useState<InterventionPayload | null>(null);
  const interventionsPausedRef = useRef(false);
  const lastInterventionIdRef = useRef<string | null>(null);
  // Post-session recap (summary + quiz + brain proposals). sessionId is captured when the AI
  // session starts; the Recap toolbar button opens the review modal.
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewSessionId, setReviewSessionId] = useState<string | null>(null);
  const [musicIdx,     setMusicIdx]     = useState(0);
  const [musicPlaying, setMusicPlaying] = useState(false);
  const [musicOpen,    setMusicOpen]    = useState(false);
  const [musicLoading, setMusicLoading] = useState(false);
  useEffect(() => () => { try { musicAudioRef.current?.pause(); } catch {} }, []);

  // room-ai requires an active AI session for the room. Idempotent — resumes if one exists.
  async function ensureRoomAiSession(token: string) {
    if (reggieSessionRef.current) return;
    const r = await fetch("/api/room-session?action=start", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ roomId: room.id }),
    });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      throw new Error(e?.error || `Couldn't start Reggie's session (${r.status})`);
    }
    const started = await r.json().catch(() => ({} as any));
    if (started?.session?.id) setReviewSessionId(started.session.id);   // enables the Recap button
    reggieSessionRef.current = true;
  }

  async function askRoomReggie() {
    const q = reggieInput.trim();
    if (!q || reggieBusy) return;
    setReggieInput("");
    setReggieMsgs(m => [...m, { role: "user", content: q }]);
    setReggieBusy(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("Sign in to use Reggie.");
      await ensureRoomAiSession(token);
      const r = await fetch("/api/room-ai?action=private", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ roomId: room.id, message: q }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error || `Reggie couldn't respond (${r.status})`);
      setReggieMsgs(m => [...m, { role: "assistant", content: String(d?.message ?? "(no answer)"), grounded: d?.grounded ?? null }]);
    } catch (err) {
      setReggieMsgs(m => [...m, { role: "assistant", content: `⚠️ ${(err as Error)?.message || "Reggie is unavailable right now."}` }]);
    } finally {
      setReggieBusy(false);
    }
  }

  // ── Guided session engine — drives Reggie proactively through a step-by-step plan ──
  // Send a raw prompt to the in-room private Reggie and return the text (grounded server-side).
  async function reggieRaw(prompt: string): Promise<string> {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) throw new Error("Sign in to use Reggie.");
    await ensureRoomAiSession(token);
    const r = await fetch("/api/room-ai?action=private", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ roomId: room.id, message: prompt }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d?.error || `Reggie couldn't respond (${r.status})`);
    return String(d?.message ?? "");
  }

  // Ground the in-room tutor: bind the student's own indexed documents most relevant to
  // this topic into the room. The room AI grounds ONLY on room_sources, so without this
  // it teaches from general knowledge even when the student's whole course is indexed.
  // Best-effort — never blocks the session.
  async function bindRoomSources(topic: string) {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) return;
      await fetch("/api/room-session?action=autosources", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ roomId: room.id, topic }),
      });
    } catch { /* non-fatal — session still runs, just less grounded */ }
  }

  // Reggie teaches one step, proactively — fetched once and cached per step index.
  async function gsTeachStep(idx: number, ctx: { mode: string; topic: string; steps: { title: string; goal: string; estMin: number }[] }) {
    const step = ctx.steps[idx];
    if (!step) return;
    setGsBusy(true); setGsBusyLabel(`Reggie is preparing step ${idx + 1}…`);
    try {
      const teachPrompt = `We're in a guided ${ctx.mode} session on "${ctx.topic}". We are on step ${idx + 1} of ${ctx.steps.length}: "${step.title}" — ${step.goal}. Teach me THIS step now: proactive, warm, and clear, in 3 to 5 short paragraphs, grounded in my own course materials where relevant. ${ctx.mode === "assignment" ? "Coach me to do the work myself and give one concrete next action — do NOT write the final answer for me." : "End with a one-line check: what I should be able to do before we move on."} Do not greet me again — just continue the session.`;
      const content = await reggieRaw(teachPrompt);
      setGsStepContent(prev => ({ ...prev, [idx]: content || "Let's work through this step together — tell me where you'd like to start." }));
    } catch (err) {
      setGsStepContent(prev => ({ ...prev, [idx]: `⚠️ ${(err as Error)?.message || "Reggie couldn't load this step."}\n\nLet's keep going — what part of "${step.title}" would you like to tackle?` }));
    } finally {
      setGsBusy(false); setGsBusyLabel("");
    }
  }

  // Start a guided session: Reggie plans it, then proactively teaches step 1.
  async function beginGuidedSession(mode: "learn" | "assignment" | "exam", topic: string, extraContext = "") {
    const t = (topic || "").trim();
    if (!t || gsBusy) return;
    setCenterTab("session");
    setGsBusy(true); setGsBusyLabel("Reggie is planning your session…");
    setGsStepContent({}); setGsExtra({}); setGsNudge(""); setGsAskOpen(false);
    gsStopSpeak(); setGsVoiceOn(mode === "exam"); // exam prep is taught aloud by default
    setGs({ mode, topic: t, steps: [], currentIdx: 0, status: "planning", startedAt: Date.now() });
    try {
      // Bind the student's own course materials to the room BEFORE teaching, so the
      // in-room tutor's per-step retrieval has real lecture content to teach from.
      await bindRoomSources(t);
      const verb = mode === "assignment" ? `complete the assignment "${t}"`
                 : mode === "exam" ? `prepare for an exam on ${t}`
                 : `learn ${t}`;
      // When the student picked a real Canvas assignment, ground the plan in its actual
      // requirements/due date so the steps map to the real rubric, not a generic guess.
      const ctxBlock = extraContext.trim()
        ? ` Base the plan on the assignment's real details:\n"""${extraContext.trim().slice(0, 1200)}"""\n`
        : ` `;
      const planPrompt = `You are Reggie, my study tutor in a live study room. Build a focused, proactive plan to help me ${verb}.${ctxBlock}Return 4 to 6 steps. Output ONE line per step in EXACTLY this format and nothing else — no intro, no numbering:\nSTEP | <short step title> | <one-sentence goal> | <estimated minutes as a whole number>\n${mode === "assignment" ? "Guide me to do the work myself — never write the final answer for me." : ""}`;
      let steps = normalizeStepMinutes(parseGsPlan(await reggieRaw(planPrompt)));
      if (steps.length < 2) steps = normalizeStepMinutes(defaultGsPlan(mode, t));
      const active = { mode, topic: t, steps, currentIdx: 0, status: "active" as const, startedAt: Date.now() };
      setGs(active);
      setGsNudge(pickGsNudge("start"));
      // Opener — Reggie greets the room in the transcript (grounded in the topic) and
      // seeds the board with a goal card + warm-up quiz. Fire-and-forget: only the
      // session starter runs this, and the broadcast/Yjs writes reach everyone.
      askReggieText(
        `The group just started a ${mode} session on "${t}". In 2-3 sentences, welcome the room and say what matters most about this topic based on the course materials. Then put on the board: one note card titled "🎯 ${t}" summarizing the session goal, one roadmap note card splitting the session into 2-3 timed phases, and one warm-up quiz card on the topic's most fundamental concept.`,
        { silent: true },
      );
      // Auto-deck: pre-build topic flashcards so the Flashcards tab is loaded by the
      // time anyone opens it. Fire-and-forget — a failed deck never blocks the session.
      if (!fcCards.length) { setFcTopic(t); fcGenerate(t); }
      await gsTeachStep(0, active);
    } catch (err) {
      const steps = normalizeStepMinutes(defaultGsPlan(mode, t));
      setGs({ mode, topic: t, steps, currentIdx: 0, status: "active", startedAt: Date.now() });
      setGsStepContent({ 0: `⚠️ ${(err as Error)?.message || "Reggie had trouble planning."}\n\nWe can still work through it — tell me what you'd like to start with.` });
      setGsBusy(false); setGsBusyLabel("");
    }
  }

  // Advance to the next step (or finish). Marks progress + a motivational beat.
  function gsNext() {
    if (!gs || gsBusy) return;
    setGsAskOpen(false);
    if (gs.currentIdx >= gs.steps.length - 1) {
      setGs(g => g ? { ...g, status: "done" } : g);
      setGsNudge(pickGsNudge("done"));
      return;
    }
    const next = gs.currentIdx + 1;
    const ctx = { ...gs, currentIdx: next };
    setGs(g => g ? { ...g, currentIdx: next } : g);
    setGsNudge(pickGsNudge("progress"));
    if (!gsStepContent[next]) gsTeachStep(next, ctx);
  }

  // "I'm stuck" — Reggie re-explains the current step more simply, without moving on.
  async function gsStuck() {
    if (!gs || gsBusy) return;
    const idx = gs.currentIdx; const step = gs.steps[idx];
    setGsNudge(pickGsNudge("stuck"));
    setGsBusy(true); setGsBusyLabel("Reggie is breaking it down…");
    try {
      const p = `I'm stuck on step ${idx + 1} ("${step.title}") of our session on "${gs.topic}". Re-explain it more simply, with a small concrete example, in 2 to 3 short paragraphs. Don't move on yet.`;
      const extra = await reggieRaw(p);
      setGsExtra(prev => ({ ...prev, [idx]: [...(prev[idx] || []), `**You:** I'm stuck.`, extra] }));
    } catch (err) {
      setGsExtra(prev => ({ ...prev, [idx]: [...(prev[idx] || []), `⚠️ ${(err as Error)?.message || "Reggie couldn't respond."}`] }));
    } finally { setGsBusy(false); setGsBusyLabel(""); }
  }

  // Inline "ask a question" about the current step.
  async function gsAskSend() {
    const q = gsAsk.trim();
    if (!q || !gs || gsBusy) return;
    const idx = gs.currentIdx; setGsAsk("");
    setGsExtra(prev => ({ ...prev, [idx]: [...(prev[idx] || []), `**You:** ${q}`] }));
    setGsBusy(true); setGsBusyLabel("Reggie is answering…");
    try {
      const p = `While we're on step ${idx + 1} ("${gs.steps[idx].title}") of our ${gs.mode} session on "${gs.topic}", I have a question: ${q}. Answer briefly and tie it back to the step.`;
      const a = await reggieRaw(p);
      setGsExtra(prev => ({ ...prev, [idx]: [...(prev[idx] || []), a] }));
    } catch (err) {
      setGsExtra(prev => ({ ...prev, [idx]: [...(prev[idx] || []), `⚠️ ${(err as Error)?.message || "Reggie couldn't respond."}`] }));
    } finally { setGsBusy(false); setGsBusyLabel(""); }
  }

  function endGuidedSession() {
    gsStopSpeak(); setGsVoiceOn(false);
    setGs(null); setGsStepContent({}); setGsExtra({}); setGsNudge(""); setGsAsk(""); setGsAskOpen(false); setCenterTab("board");
  }

  // ── Voice teaching (TTS via ElevenLabs) — reads a step aloud; strips markdown/emoji first ──
  function gsStripForSpeech(text: string) {
    return String(text || "")
      .replace(/\*\*/g, "").replace(/\*/g, "").replace(/`+/g, "")
      .replace(/^#+\s*/gm, "").replace(/^\s*[-•]\s+/gm, "")
      .replace(/[✅✨🔥💪🚀🌟🎯🙌🧠💡🎉📚✍️🔊]/g, "")
      .replace(/\n{2,}/g, ". ").replace(/\s+/g, " ").trim().slice(0, 1800);
  }
  function gsStopSpeak() {
    const a = gsAudioRef.current;
    if (a) { try { a.pause(); a.currentTime = 0; } catch {} }
    setGsSpeaking(false);
  }
  async function gsSpeak(text: string) {
    const clean = gsStripForSpeech(text);
    if (!clean) return;
    gsStopSpeak();
    setGsSpeaking(true);
    try {
      const r = await fetch("/api/tts?action=stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: clean }),
      });
      if (!r.ok) throw new Error(`TTS ${r.status}`);
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      let a = gsAudioRef.current;
      if (!a) { a = new Audio(); gsAudioRef.current = a; }
      a.onended = () => { setGsSpeaking(false); URL.revokeObjectURL(url); };
      a.onerror = () => { setGsSpeaking(false); };
      a.src = url;
      await a.play();
    } catch {
      setGsSpeaking(false);
    }
  }

  // ── Flashcards engine ──
  async function fcGenerate(topic: string) {
    const t = (topic || "").trim();
    if (!t || fcBusy) return;
    setFcBusy(true);
    try {
      const p = `Create 8 study flashcards to help me review "${t}", grounded in my course materials where relevant. Output ONE card per line in EXACTLY this format and nothing else — no numbering, no intro:\nQ: <question> | A: <concise answer>`;
      let cards = parseFcCards(await reggieRaw(p));
      if (!cards.length) cards = [{ q: `What's one key idea in ${t}?`, a: "Reggie couldn't parse a deck — try generating again." }];
      setFcCards(cards); setFcIdx(0); setFcFlipped(false); setFcDone(false); setFcResults({ got: 0, missed: 0 });
    } catch (err) {
      setFcCards([{ q: "Reggie couldn't build the deck", a: String((err as Error)?.message || "Try again in a moment.") }]);
      setFcIdx(0); setFcFlipped(false); setFcDone(false);
    } finally { setFcBusy(false); }
  }
  async function fcLoadCourseDeck() {
    if (!room.course_id || fcBusy) return;
    setFcBusy(true);
    try {
      const r = await fetch("/api/flashcards", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "load", userId, courseId: room.course_id }) });
      const d = await r.json().catch(() => ({}));
      const cards = (d?.cards || []).map((c: any) => ({ q: c.question, a: c.answer })).filter((c: any) => c.q && c.a);
      if (cards.length) { setFcCards(cards); setFcIdx(0); setFcFlipped(false); setFcDone(false); setFcResults({ got: 0, missed: 0 }); }
      else setFcCards([{ q: "No saved cards for this course yet", a: "Generate a deck from a topic instead." }]);
    } catch { /* ignore */ } finally { setFcBusy(false); }
  }
  function fcRate(got: boolean) {
    setFcResults(r => ({ got: r.got + (got ? 1 : 0), missed: r.missed + (got ? 0 : 1) }));
    if (fcIdx >= fcCards.length - 1) { setFcDone(true); return; }
    setFcIdx(i => i + 1); setFcFlipped(false);
  }
  function fcReset() { setFcCards([]); setFcIdx(0); setFcFlipped(false); setFcDone(false); setFcResults({ got: 0, missed: 0 }); }

  // ── Focus music engine ──
  async function loadMusic(query = "lofi study beats") {
    setMusicLoading(true);
    try {
      const r = await fetch(`/api/music?term=${encodeURIComponent(query)}&limit=20`);
      const d = await r.json().catch(() => ({}));
      const tracks = (d?.tracks || []).filter((t: any) => t?.previewUrl);
      setMusicTracks(tracks);
      return tracks;
    } catch { return []; } finally { setMusicLoading(false); }
  }
  function playMusicIdx(idx: number, tracks = musicTracks) {
    const t = tracks[idx];
    if (!t) return;
    let a = musicAudioRef.current;
    if (!a) { a = new Audio(); a.volume = 0.4; musicAudioRef.current = a; }
    a.src = t.previewUrl;
    a.onended = () => nextMusic();
    setMusicIdx(idx);
    a.play().then(() => setMusicPlaying(true)).catch(() => setMusicPlaying(false));
  }
  function nextMusic() {
    if (!musicTracks.length) return;
    playMusicIdx(cycleIndex(musicIdx, musicTracks.length));
  }
  async function toggleMusic() {
    const a = musicAudioRef.current;
    if (musicPlaying && a) { a.pause(); setMusicPlaying(false); return; }
    if (a && a.src) { a.play().then(() => setMusicPlaying(true)).catch(() => {}); return; }
    let tracks = musicTracks;
    if (!tracks.length) tracks = await loadMusic(musicPreset);
    if (tracks.length) playMusicIdx(0, tracks);
  }
  // Fully stop + rewind so closing the player (or toggling music off from the toolbar) truly
  // silences audio — Close used to only hide the UI and leave playback running.
  function stopMusic() { setMusicPlaying(stopAudio(musicAudioRef.current)); }
  // Switch to a curated preset: stop the current track, load that genre, start from the top.
  async function selectMusicPreset(query: string) {
    setMusicPreset(query);
    stopMusic();
    const tracks = await loadMusic(query);
    if (tracks.length) playMusicIdx(0, tracks);
  }

  async function sendChatMessage() {
    const body = chatInput.trim();
    if (!body || chatSending) return;
    setChatInput("");
    setChatSending(true);
    try {
      const msg = await postRoomMessage(userId, room.id, userData?.name ?? "Anonymous", body);
      setChatMessages(prev => prev.some(m => m.id === msg.id) ? prev : [...prev, msg]);
      channelRef.current?.send({
        type: "broadcast", event: "chat_message", payload: msg,
      }).catch(() => {});
      // Typed summon: "@ai …" / "@reggie …" routes the question to the room AI.
      const at = body.match(/^@(?:ai|reggie)\b[\s,:]*/i);
      if (at) requestAi(body.slice(at[0].length).trim(), userData?.name ?? "Someone");
    } catch (err) {
      console.error("[chat] send:", (err as any)?.message);
      setChatInput(body);
    } finally {
      setChatSending(false);
    }
  }

  async function handleImageUpload(file: File) {
    if (imageUploading) return;
    const MAX_MB = 5;
    if (file.size > MAX_MB * 1024 * 1024) {
      alert(`Image must be under ${MAX_MB} MB.`);
      return;
    }
    setImageUploading(true);
    try {
      const url = await uploadChatImage(room.id, file);
      const body = `[img]${url}`;
      const msg = await postRoomMessage(userId, room.id, userData?.name ?? "Anonymous", body);
      setChatMessages(prev => prev.some(m => m.id === msg.id) ? prev : [...prev, msg]);
      channelRef.current?.send({
        type: "broadcast", event: "chat_message", payload: msg,
      }).catch(() => {});
    } catch (err) {
      console.error("[chat] image upload:", (err as any)?.message);
      alert("Image upload failed. Check that the Supabase media-uploads bucket allows uploads.");
    } finally {
      setImageUploading(false);
    }
  }

  const totalFocusMins = members.reduce((sum, m) => {
    return sum + Math.floor((Date.now() - m.joinedAt) / 60000);
  }, 0);

  const S = styles;
  const remaining = getRemaining(pomo);

  // Guided-session metrics (recomputed each tick via the 1s interval above).
  const gsElapsedSec = gs ? Math.max(0, Math.floor((Date.now() - gs.startedAt) / 1000)) : 0;
  const gsTotalMin   = gs ? gs.steps.reduce((s, x) => s + x.estMin, 0) : 0;
  const gsRemainMin  = gs ? gs.steps.slice(gs.status === "done" ? gs.steps.length : gs.currentIdx).reduce((s, x) => s + x.estMin, 0) : 0;
  const gsProgress   = gs && gs.steps.length ? (gs.status === "done" ? 1 : gs.currentIdx / gs.steps.length) : 0;
  // Launcher: show the real-assignment picker when in assignment mode and we have any.
  const gsUsingPicker = gsLaunchMode === "assignment" && gsAssignmentOptions.length > 0 && gsAssignmentId !== "__custom";
  const gsCanStart    = gsUsingPicker ? !!gsAssignmentId : !!gsTopic.trim();

  // Compact top-bar pill styles (used by the pomodoro controls).
  const topPill: React.CSSProperties = { background: "rgba(var(--teal-rgb),0.22)", border: "1px solid rgba(var(--teal-rgb),0.4)", borderRadius: 999, padding: "5px 12px", fontSize: 12, fontWeight: 600, color: "#DCE3FF", cursor: "pointer", fontFamily: "inherit" };
  const topPillGhost: React.CSSProperties = { background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 999, padding: "5px 12px", fontSize: 12, color: "var(--text-dim)", cursor: "pointer", fontFamily: "inherit" };

  return (
    // Fills the shell's viewport-locked column (App.tsx applies .page-locked when a room
    // is active), so the room fits ONE viewport exactly — no document scroll, no
    // hardcoded header math. paddingRight restores the breathing room .page-locked's
    // flush-right treatment removes.
    <div style={{ position: "relative", flex: 1, minHeight: 0, display: "flex", flexDirection: "column", paddingRight: 18 }}>
      {/* ══ Redesigned session room — sage liquid-glass ══════════════
          Wired real: timer, participant count, chat input/send, Chat/Board/Voice/
          Invite controls, whiteboard (Open board), participant tiles from presence,
          Call Reggie (B1), End session. Placeholders (backburnered): live transcript
          feed, real camera video, Focus Mode behavior, toasts, presenting badge. */}
      {/* Ambient purple glow removed — the room now sits on the app's warm-ink ground. */}

      <div style={{ position: "relative", zIndex: 1, flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {roomToast && !focusMode && (
          <div style={{ position: "fixed", top: 18, right: 18, zIndex: 90, display: "flex", alignItems: "center", gap: 8, background: "rgba(var(--teal-rgb),0.92)", color: "#fff", padding: "10px 15px", borderRadius: 12, fontSize: 13, fontWeight: 600, boxShadow: "0 10px 34px rgba(0,0,0,0.5)" }}>{roomToast}</div>
        )}
        <style>{`.gs-topic-input::placeholder { color: rgba(255,255,255,0.55); }`}</style>
      {/* No floating focus pill: the top bar's Focus Mode toggle stays visible in focus
            mode (the right panel that used to host it collapses), so one control both
            enters and exits — Harshil's #258 regroup, adapted to the v2 layout. */}
        {/* Top bar — room controls (left) · session timer (center) · presence (right).
            The control pills moved up here from the deleted left column, so the main
            work area gets the full width and there's exactly one home for room tools. */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexShrink: 0 }}>
          {/* LEFT — chat toggle + room identity (voice-first layout). The Chat pill from
              the old bar lives on this toggle; the Voice pill is gone on purpose — voice
              controls are always-on in the voice cluster (join-muted design). */}
          <button
            onClick={() => (focusMode ? (showChat ? setShowChat(false) : handleOpenChat()) : setLeftBarOpen(o => !o))}
            title={leftBarOpen ? "Hide chat" : "Show chat"}
            style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 34, height: 34, borderRadius: 10, cursor: "pointer", fontFamily: "inherit", flexShrink: 0,
              background: (focusMode ? showChat : leftBarOpen) ? "rgba(var(--teal-rgb),0.18)" : "rgba(255,255,255,0.05)",
              border: `1px solid ${(focusMode ? showChat : leftBarOpen) ? "rgba(var(--teal-rgb),0.4)" : "rgba(255,255,255,0.1)"}`,
              color: (focusMode ? showChat : leftBarOpen) ? "#DCE3FF" : "var(--text-dim)" }}>
            <MessageCircle size={16} />
          </button>
          <div style={{ minWidth: 0 }}>
            <div title={room.name} style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{room.name}</div>
            {courseName && <div style={{ fontSize: 11, color: "var(--text-dim)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{courseName}</div>}
          </div>

          {/* Room tool pills — Board / Music / Recap / Invite (from the pre-voice bar). */}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {[
              { label: "Board", icon: <Pen size={13} />, on: centerTab === "board" && showBoard, act: () => { if (centerTab === "board" && showBoard) { setShowBoard(false); } else { setCenterTab("board"); handleOpenBoard(); } } },
              { label: "Music", icon: <Music size={13} />, on: musicOpen, act: () => { if (musicOpen) stopMusic(); setMusicOpen(o => !o); } },
              { label: "Recap", icon: <BookOpen size={13} />, on: reviewOpen, act: () => { if (reviewSessionId) setReviewOpen(true); } },
              { label: "Invite", icon: <Plus size={13} />, on: false, act: () => setShowInvite(true) },
            ].map(b => (
              <button key={b.label} onClick={b.act} style={{ display: "inline-flex", alignItems: "center", gap: 5, background: b.on ? "rgba(var(--teal-rgb),0.18)" : "rgba(255,255,255,0.05)", border: `1px solid ${b.on ? "rgba(var(--teal-rgb),0.4)" : "rgba(255,255,255,0.1)"}`, borderRadius: 999, padding: "6px 11px", fontSize: 12, color: b.on ? "#DCE3FF" : "var(--text-secondary)", cursor: "pointer", fontFamily: "inherit" }}>{b.icon}{b.label}</button>
            ))}
          </div>

          {/* CENTER — focus sprint timer, pushed to the middle */}
          <div style={{ marginLeft: "auto", marginRight: "auto", display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
            <span style={{ fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums", fontSize: 22, fontWeight: 600, letterSpacing: 1, color: pomo && pomo.phase === "focus" && !pomo.paused ? "#DCE3FF" : "var(--text-dim)" }}>
              {pomo && pomo.phase === "focus" ? formatPomoTime(remaining) : "00:00"}
            </span>
            {(!pomo || pomo.phase !== "focus") ? (
              <button onClick={handlePomoStart} style={topPill}>▶ Focus sprint</button>
            ) : pomo.paused ? (<>
              <button onClick={handlePomoResume} style={topPill}>▶ Resume</button>
              <button onClick={handlePomoReset} style={topPillGhost}>Reset</button>
            </>) : (<>
              <button onClick={handlePomoPause} style={topPill}>⏸ Pause</button>
              <button onClick={handlePomoSkip} style={topPillGhost}>End</button>
            </>)}
          </div>

          {/* RIGHT — presence · Focus · overflow menu (the one home for room tools) */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 999, padding: "6px 12px", fontSize: 12, color: "var(--text-secondary)" }}>
              <Users size={13} /> {members.length}
            </div>
            <button onClick={() => setFocusMode(f => !f)} style={{ display: "inline-flex", alignItems: "center", gap: 5, background: focusMode ? "rgba(var(--teal-rgb),0.2)" : "rgba(255,255,255,0.05)", border: `1px solid ${focusMode ? "rgba(var(--teal-rgb),0.4)" : "rgba(255,255,255,0.1)"}`, borderRadius: 999, padding: "6px 11px", fontSize: 12, color: focusMode ? "#DCE3FF" : "var(--text-dim)", cursor: "pointer", fontFamily: "inherit" }}>Focus{focusMode ? " · ON" : ""}</button>
            <div ref={roomMenuRef} style={{ position: "relative" }}>
              <button onClick={() => setShowRoomMenu(o => !o)} title="Room menu" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", position: "relative", width: 34, height: 34, borderRadius: 10, background: showRoomMenu ? "rgba(var(--teal-rgb),0.18)" : "rgba(255,255,255,0.05)", border: `1px solid ${showRoomMenu ? "rgba(var(--teal-rgb),0.4)" : "rgba(255,255,255,0.1)"}`, color: "var(--text-secondary)", cursor: "pointer", fontFamily: "inherit" }}>
                <MoreHorizontal size={17} />
                {isHost && requests.length > 0 && (
                  <span style={{ position: "absolute", top: -4, right: -4, minWidth: 16, height: 16, padding: "0 4px", borderRadius: 999, background: "#f59e0b", color: "#1a1205", fontSize: 10, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{requests.length}</span>
                )}
              </button>
              {showRoomMenu && <RoomMenu
                room={room} isHost={isHost} requests={requests}
                onCopyCode={() => { navigator.clipboard?.writeText(room.join_code).catch(() => {}); }}
                onInvite={() => { setShowInvite(true); setShowRoomMenu(false); }}
                onAccess={() => { setShowAccess(true); setShowRoomMenu(false); }}
                onPrivateReggie={() => { setShowReggie(true); setShowRoomMenu(false); }}
                onMusic={() => { setMusicOpen(o => !o); setShowRoomMenu(false); }}
                onAccept={acceptRequest} onDecline={declineRequest}
                onLeave={() => { setShowRoomMenu(false); isHost ? handleCloseRoom() : handleLeave(); }}
              />}
            </div>
          </div>
        </div>

        {/* Two columns now: the WORK area owns the width; chat lives in the ChatPanel
            (one chat, opened from the Chat pill) — the fake "Live Transcript" and the
            duplicate inline chat input are gone. A real activity feed can take a left
            panel later, opt-in, per the UX audit. */}
        {/* Hidden audio sinks — one per peer's P2P stream. muted follows the speaker toggle. */}
        {Object.entries(remoteStreams).map(([id, stream]) => (
          <RemoteAudio key={id} stream={stream} muted={!speakerOn} />
        ))}

        {/* Ask-Reggie capture popup — makes it unmistakable that your voice is being taken
            as a question, with a live transcript and an explicit Submit. */}
        {captureMode && (
          <div style={{ position: "fixed", inset: 0, zIndex: 1400, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(6,8,14,0.55)", backdropFilter: "blur(3px)" }}>
            <div style={{ width: "min(440px, 92vw)", background: "rgba(18,20,28,0.98)", border: "1px solid rgba(169,182,255,0.35)", borderRadius: 18, padding: 22, boxShadow: "0 12px 48px rgba(0,0,0,0.6)" }}>
              <style>{`@keyframes rgMicPulse{0%,100%{box-shadow:0 0 0 0 rgba(169,182,255,0.5)}50%{box-shadow:0 0 0 14px rgba(169,182,255,0)}}`}</style>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
                <div style={{ width: 40, height: 40, borderRadius: "50%", background: "rgba(169,182,255,0.18)", border: "1px solid rgba(169,182,255,0.5)", display: "flex", alignItems: "center", justifyContent: "center", color: "#C7D0FF", animation: "rgMicPulse 1.6s ease-in-out infinite", flexShrink: 0 }}>
                  <Mic size={19} strokeWidth={2.3} />
                </div>
                <div>
                  <div style={{ fontSize: 14.5, fontWeight: 700, color: "var(--text-primary)" }}>Listening to your question…</div>
                  <div style={{ fontSize: 11.5, color: "var(--text-dim)" }}>Speak, then hit Submit. Reggie hears only this.</div>
                </div>
              </div>
              <div style={{ minHeight: 64, maxHeight: 160, overflowY: "auto", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.10)", borderRadius: 12, padding: "10px 12px", fontSize: 13.5, lineHeight: 1.5, color: "var(--text-primary)" }}>
                {captureText ? <span>{captureText} </span> : null}
                {capturePartial ? <span style={{ color: "var(--text-dim)", fontStyle: "italic" }}>{capturePartial}</span> : null}
                {!captureText && !capturePartial && <span style={{ color: "var(--text-dim)" }}>{isStreamingSTT() ? "Your words will appear here as you speak…" : "Voice capture needs streaming STT."}</span>}
              </div>
              <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
                <button onClick={() => stopCapture(false)} style={{ flex: 1, padding: "10px", borderRadius: 12, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.14)", color: "var(--text-secondary)" }}>Cancel</button>
                <button onClick={() => stopCapture(true)} disabled={!captureText.trim()} style={{ flex: 2, padding: "10px", borderRadius: 12, fontSize: 13, fontWeight: 700, cursor: captureText.trim() ? "pointer" : "default", fontFamily: "inherit", color: "#08131b", border: "1px solid rgba(127,224,160,0.55)", background: "linear-gradient(135deg, #7fe0a0, #A9B6FF)", opacity: captureText.trim() ? 1 : 0.5 }}>Submit to Reggie →</button>
              </div>
            </div>
          </div>
        )}
        <div style={{ display: "grid", gridTemplateColumns: focusMode ? "1fr" : (leftBarOpen ? "280px 1fr 320px" : "1fr 320px"), gap: 22, alignItems: "stretch", flex: 1, minHeight: 0 }}>

          {/* LEFT — room chat, always docked. The top-bar Chat button toggles this whole
              column (leftBarOpen); the floating ChatPanel still serves focus mode only. */}
          <div style={{ display: (focusMode || !leftBarOpen) ? "none" : "flex", flexDirection: "column", background: "rgba(255,255,255,0.10)", border: "1px solid rgba(255,255,255,0.22)", borderRadius: 18, backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)", padding: 16, minHeight: 0, overflow: "hidden" }}>
            <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-dim)", margin: "0 0 10px" }}>Room chat</p>
              <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2, paddingRight: 2 }}>
                {chatMessages.length === 0 && (
                  <span style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.5 }}>No messages yet. Say hi to the room below.</span>
                )}
                {chatMessages.map((m: any, i: number) => {
                  // Canonical ChatMessage shape: { id, user_id, name, body, created_at }.
                  // (The old code read m.message/m.text + m.user_name — none exist, so text
                  // was blank and every name fell back to "Member". Read the real fields.)
                  const isMe = m.user_id === userId;
                  const prev = chatMessages[i - 1];
                  const next = chatMessages[i + 1];
                  const startGroup = !prev || prev.user_id !== m.user_id;   // first of a run → show name
                  const endGroup = !next || next.user_id !== m.user_id;     // last of a run → show time
                  const isImg = typeof m.body === "string" && m.body.startsWith("[img]");
                  const imgUrl = isImg ? m.body.slice(5) : "";
                  const time = m.created_at
                    ? new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                    : "";
                  return (
                    <div key={m.id ?? i} style={{ display: "flex", flexDirection: "column", alignItems: isMe ? "flex-end" : "flex-start", marginTop: startGroup && i > 0 ? 9 : 0 }}>
                      {startGroup && (
                        <span style={{ fontSize: 10, fontWeight: 700, color: isMe ? "var(--text-dim)" : "rgb(var(--teal-rgb))", margin: isMe ? "0 3px 3px 0" : "0 0 3px 4px" }}>
                          {isMe ? "You" : (m.name || "Member")}
                        </span>
                      )}
                      <div style={{
                        maxWidth: "90%", padding: isImg ? 3 : "6px 10px", wordBreak: "break-word",
                        borderRadius: isMe ? "12px 12px 4px 12px" : "12px 12px 12px 4px",
                        background: isMe ? "rgba(var(--gold-rgb),0.16)" : "rgba(255,255,255,0.07)",
                        border: `1px solid ${isMe ? "rgba(var(--gold-rgb),0.24)" : "rgba(255,255,255,0.10)"}`,
                        fontSize: 12.5, lineHeight: 1.45, color: "var(--text-primary)", overflow: "hidden",
                      }}>
                        {isImg ? (
                          <a href={imgUrl} target="_blank" rel="noopener noreferrer">
                            <img src={imgUrl} alt="shared image" style={{ display: "block", maxWidth: "100%", maxHeight: 180, borderRadius: 8, cursor: "zoom-in" }}
                              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
                          </a>
                        ) : m.body}
                      </div>
                      {endGroup && time && (
                        <span style={{ fontSize: 9.5, color: "var(--text-dim)", margin: isMe ? "2px 3px 0 0" : "2px 0 0 4px" }}>{time}</span>
                      )}
                    </div>
                  );
                })}
                <div ref={leftChatEndRef} />
              </div>
              <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                <input value={chatInput} onChange={(e) => setChatInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && chatInput.trim()) sendChatMessage(); }} placeholder="Message the room…" style={{ flex: 1, minWidth: 0, background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.18)", borderRadius: 10, padding: "8px 11px", fontSize: 12.5, color: "var(--text-primary)", outline: "none", fontFamily: "inherit" }} />
                <button onClick={() => chatInput.trim() && sendChatMessage()} disabled={chatSending} style={{ background: "rgba(var(--teal-rgb),0.2)", border: "1px solid rgba(var(--teal-rgb),0.4)", borderRadius: 10, padding: "0 12px", color: "#DCE3FF", cursor: "pointer", fontFamily: "inherit", fontSize: 12.5 }}>→</button>
              </div>
          </div>

          {/* CENTER — Guided session (default) / Whiteboard / Flashcards */}
          <div style={{ display: "flex", flexDirection: "column", background: "rgba(255,255,255,0.10)", border: "1px solid rgba(255,255,255,0.22)", borderRadius: 18, backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)", padding: 16, overflow: "hidden" }}>
            {/* Center navigation — a segmented control over the three work modes. Each is a
                distinct thing to do, so they read as equal, full-width, icon-forward tabs. */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexShrink: 0 }}>
              <div style={{ display: "flex", flex: 1, gap: 4, padding: 4, borderRadius: 13, background: "rgba(0,0,0,0.22)", border: "1px solid rgba(255,255,255,0.08)" }}>
                {([
                  ["board", "Whiteboard", <Pen size={15} />, "Draw together", false],
                  ["session", "Guided session", <Sparkles size={15} />, "Reggie teaches", !!(gs && gs.status !== "done")],
                  ["flashcards", "Flashcards", <BookOpen size={15} />, "Review & recall", !!(fcCards.length > 0 && !fcDone)],
                ] as const).map(([key, label, icon, sub, dot]) => {
                  const active = centerTab === key;
                  return (
                    <button key={key} onClick={() => { setCenterTab(key as any); if (key === "board" && !showBoard) handleOpenBoard(); }} style={{
                      flex: 1, position: "relative", display: "inline-flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2,
                      padding: "9px 6px", borderRadius: 10, cursor: "pointer", fontFamily: "inherit", transition: "background 0.15s, color 0.15s",
                      background: active ? "linear-gradient(160deg, rgba(var(--teal-rgb),0.28), rgba(169,182,255,0.12))" : "transparent",
                      border: `1px solid ${active ? "rgba(var(--teal-rgb),0.5)" : "transparent"}`,
                      boxShadow: active ? "0 2px 12px rgba(var(--teal-rgb),0.18)" : "none",
                      color: active ? "#EAF0FF" : "var(--text-dim)",
                    }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 700 }}>
                        {icon}{label}
                        {dot && <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#7fe0a0", boxShadow: "0 0 6px #7fe0a0" }} />}
                      </span>
                      <span style={{ fontSize: 10.5, fontWeight: 500, color: active ? "rgba(234,240,255,0.7)" : "var(--text-dim)", opacity: active ? 1 : 0.7 }}>{sub}</span>
                    </button>
                  );
                })}
              </div>
              {centerTab === "session" && gs && (
                <button onClick={endGuidedSession} title="Ends this guided lesson — you stay in the room" style={{ flexShrink: 0, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 999, padding: "8px 13px", fontSize: 11.5, fontWeight: 600, color: "var(--text-secondary)", cursor: "pointer", fontFamily: "inherit" }}>End lesson</button>
              )}
            </div>
            <div style={{ flex: 1, minHeight: 0, overflow: "hidden", borderRadius: 14, ["--gold" as any]: "rgb(var(--teal-rgb))", ["--gold-rgb" as any]: "var(--teal-rgb)" }}>
              {centerTab === "board" ? (
                showBoard ? (
                <Whiteboard
                  strokes={strokes}
                  liveStrokes={liveStrokes}
                  tool={wbTool}
                  style={wbStyle}
                  color={wbColor}
                  penWidth={wbPenWidth}
                  eraserSize={wbEraserSize}
                  bg={wbBg}
                  onToolChange={setWbTool}
                  onStyleChange={setWbStyle}
                  onColorChange={setWbColor}
                  onPenWidthChange={setWbPenWidth}
                  onEraserSizeChange={setWbEraserSize}
                  onBgChange={handleBgChange}
                  onStrokeComplete={handleStrokeComplete}
                  onEraseStroke={handleEraseStroke}
                  onMoveStroke={handleMoveStroke}
                  onReplaceImageStroke={handleReplaceImageStroke}
                  onLiveStroke={handleLiveStroke}
                  onClear={handleClearBoard}
                  canUndo={canUndo}
                  canRedo={canRedo}
                  onUndo={handleUndoStroke}
                  onRedo={handleRedoStroke}
                  peerCursors={peerCursors}
                  laserPositions={laserPositions}
                  onCursorMove={handleCursorMove}
                  onLaserMove={handleLaserMove}
                  onClose={() => setShowBoard(false)}
                  activeSpeaker={activeSpeakerName}
                  roomId={room.id}
                  boardCards={boardCards}
                  onCardMove={handleCardMove}
                  onCardDelete={handleCardDelete}
                  onCardAnswer={handleCardAnswer}
                />
                ) : (
                  <div style={{ height: "100%", minHeight: 320, borderRadius: 14, background: "rgba(255,255,255,0.96)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <button onClick={() => setShowBoard(true)} style={{ background: "rgba(var(--teal-rgb),0.9)", color: "#fff", border: "none", borderRadius: 10, padding: "9px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>Open board</button>
                  </div>
                )
              ) : centerTab === "session" ? (
                /* ── Guided session stage — proactive, Reggie-driven ── */
                <div style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
                  {!gs ? (
                    /* Launcher */
                    <div style={{ height: "100%", overflowY: "auto", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", textAlign: "center", padding: "20px 18px" }}>
                      <div style={{ width: 56, height: 56, borderRadius: 16, background: "linear-gradient(150deg, rgba(var(--teal-rgb),0.35), rgba(var(--teal-rgb),0.18))", border: "1px solid rgba(var(--teal-rgb),0.4)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 16 }}><Sparkles size={26} color="#DCE3FF" /></div>
                      <h3 style={{ fontFamily: "var(--font-sans)", fontSize: 22, fontWeight: 600, color: "var(--text-primary)", margin: "0 0 6px" }}>Start a guided session</h3>
                      <p style={{ fontSize: 13, color: "var(--text-dim)", margin: "0 0 18px", maxWidth: 340, lineHeight: 1.5 }}>Reggie plans it, teaches you step by step, and tracks your progress — grounded in your own course materials.</p>
                      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", justifyContent: "center" }}>
                        {([["learn", "Learn a topic", "📚"], ["assignment", "Work an assignment", "✍️"], ["exam", "Prep for an exam", "🎯"]] as const).map(([m, label, ic]) => {
                          const active = gsLaunchMode === m;
                          return <button key={m} onClick={() => { setGsLaunchMode(m); setGsAssignmentId(""); }} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: active ? "rgba(var(--teal-rgb),0.2)" : "rgba(255,255,255,0.04)", border: `1px solid ${active ? "rgba(var(--teal-rgb),0.5)" : "rgba(255,255,255,0.1)"}`, borderRadius: 12, padding: "9px 13px", fontSize: 12.5, fontWeight: 600, color: active ? "#DCE3FF" : "var(--text-secondary)", cursor: "pointer", fontFamily: "inherit" }}><span>{ic}</span>{label}</button>;
                        })}
                      </div>
                      {gsUsingPicker ? (
                        <select value={gsAssignmentId}
                          onChange={e => { const v = e.target.value; setGsAssignmentId(v); const a = gsAssignmentOptions.find((x: any) => String(x.id) === v); setGsTopic(a ? a.name : ""); }}
                          style={{ width: "100%", maxWidth: 380, background: "rgba(255,255,255,0.10)", border: "1px solid rgba(255,255,255,0.25)", borderRadius: 12, padding: "12px 14px", color: "#fff", fontSize: 13.5, fontFamily: "inherit", outline: "none", textAlign: "center", marginBottom: 12, cursor: "pointer", colorScheme: "dark" as any }}>
                          <option value="" style={{ background: "#1E2450", color: "#EDF0FF" }}>Choose an assignment…</option>
                          {gsAssignmentOptions.map((a: any) => {
                            const due = a.dueAt ? ` · due ${new Date(a.dueAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : "";
                            const cc = a.courseCode ? ` · ${a.courseCode}` : "";
                            return <option key={a.id} value={String(a.id)} style={{ background: "#1E2450", color: "#EDF0FF" }}>{`${a.name}${cc}${due}`}</option>;
                          })}
                          <option value="__custom" style={{ background: "#1E2450", color: "#EDF0FF" }}>✏️ Type it instead…</option>
                        </select>
                      ) : (
                        <input value={gsTopic} onChange={e => setGsTopic(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && gsTopic.trim()) beginGuidedSession(gsLaunchMode, gsTopic); }}
                          className="gs-topic-input" placeholder={gsLaunchMode === "assignment" ? "Which assignment? e.g. Contracts essay #2" : gsLaunchMode === "exam" ? "Which exam? e.g. Land Reform midterm" : "What do you want to learn?"}
                          style={{ width: "100%", maxWidth: 380, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12, padding: "12px 14px", color: "var(--text-primary)", fontSize: 14, fontFamily: "inherit", outline: "none", textAlign: "center", marginBottom: 12 }} />
                      )}
                      {gsLaunchMode === "assignment" && gsAssignmentId === "__custom" && gsAssignmentOptions.length > 0 && (
                        <button onClick={() => { setGsAssignmentId(""); setGsTopic(""); }} style={{ background: "none", border: "none", color: "#a5b4fc", fontSize: 11.5, cursor: "pointer", fontFamily: "inherit", marginBottom: 10 }}>← Pick from my assignments</button>
                      )}
                      {courseName && !gsUsingPicker && gsLaunchMode !== "assignment" && (
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "center", alignItems: "center", marginBottom: 16 }}>
                          <span style={{ fontSize: 11, color: "var(--text-dim)" }}>Try:</span>
                          <button onClick={() => setGsTopic(courseName)} style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 999, padding: "5px 11px", fontSize: 11.5, color: "var(--text-secondary)", cursor: "pointer", fontFamily: "inherit" }}>{courseName}</button>
                        </div>
                      )}
                      <button onClick={() => { if (gsUsingPicker) gsStartAssignment(); else beginGuidedSession(gsLaunchMode, gsTopic); }} disabled={!gsCanStart || gsBusy} style={{ background: (!gsCanStart || gsBusy) ? "rgba(var(--teal-rgb),0.2)" : "linear-gradient(135deg, rgb(var(--teal-rgb)), #A9B6FF)", border: "none", borderRadius: 12, padding: "12px 26px", fontSize: 14, fontWeight: 600, color: "#fff", cursor: (!gsCanStart || gsBusy) ? "default" : "pointer", opacity: (!gsCanStart || gsBusy) ? 0.6 : 1, fontFamily: "inherit", boxShadow: "0 8px 24px rgba(var(--teal-rgb),0.35)" }}>{gsBusy ? "Reggie is planning…" : "Start session →"}</button>
                    </div>
                  ) : gs.status === "done" ? (
                    /* Completion */
                    <div style={{ height: "100%", overflowY: "auto", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", textAlign: "center", padding: "20px 18px" }}>
                      <div style={{ fontSize: 44, marginBottom: 8 }}>🎉</div>
                      <h3 style={{ fontFamily: "var(--font-sans)", fontSize: 22, fontWeight: 600, color: "var(--text-primary)", margin: "0 0 6px" }}>Session complete</h3>
                      <p style={{ fontSize: 13.5, color: "var(--text-secondary)", margin: "0 0 4px" }}>{gsNudge || "Great work — you finished every step."}</p>
                      <p style={{ fontSize: 12.5, color: "var(--text-dim)", margin: "0 0 20px" }}>{gs.steps.length} steps · {formatPomoTime(gsElapsedSec)} focused · {gs.topic}</p>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button onClick={() => { setGs(null); setGsTopic(""); setGsStepContent({}); setGsExtra({}); setGsNudge(""); }} style={{ background: "linear-gradient(135deg, rgb(var(--teal-rgb)), #A9B6FF)", border: "none", borderRadius: 12, padding: "11px 20px", fontSize: 13, fontWeight: 600, color: "#fff", cursor: "pointer", fontFamily: "inherit" }}>Start another</button>
                        <button onClick={() => setCenterTab("board")} style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12, padding: "11px 20px", fontSize: 13, fontWeight: 600, color: "var(--text-secondary)", cursor: "pointer", fontFamily: "inherit" }}>Back to whiteboard</button>
                      </div>
                    </div>
                  ) : (
                    /* Active session */
                    <div style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
                      {/* Progress header */}
                      <div style={{ flexShrink: 0, marginBottom: 12 }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, gap: 10 }}>
                          <div style={{ display: "inline-flex", alignItems: "baseline", gap: 7, minWidth: 0 }}>
                            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "#a5b4fc" }}>{gs.mode === "assignment" ? "Assignment" : gs.mode === "exam" ? "Exam prep" : "Learning"}</span>
                            <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{gs.topic}</span>
                          </div>
                          <div style={{ display: "inline-flex", alignItems: "center", gap: 10, flexShrink: 0, fontSize: 11.5, color: "var(--text-dim)" }}>
                            <button onClick={() => { const on = !gsVoiceOn; setGsVoiceOn(on); if (on) { const c = gsStepContent[gs.currentIdx]; if (c) gsSpeak(c); } else gsStopSpeak(); }} title={gsVoiceOn ? "Auto-read is on — Reggie reads each step aloud" : "Auto-read steps aloud"} style={{ display: "inline-flex", alignItems: "center", gap: 4, background: gsVoiceOn ? "rgba(var(--teal-rgb),0.16)" : "rgba(255,255,255,0.05)", border: `1px solid ${gsVoiceOn ? "rgba(var(--teal-rgb),0.4)" : "rgba(255,255,255,0.12)"}`, borderRadius: 999, padding: "3px 9px", fontSize: 11, fontWeight: 600, color: gsVoiceOn ? "#A9B6FF" : "var(--text-secondary)", cursor: "pointer", fontFamily: "inherit" }}>{gsVoiceOn ? <Volume2 size={12} /> : <VolumeX size={12} />}{gsVoiceOn ? "Auto-read" : "Voice"}</button>
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }} title="Time focused"><Timer size={12} />{formatPomoTime(gsElapsedSec)}</span>
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "#a5b4fc" }} title="Reggie's estimate">≈ {gsRemainMin} min left</span>
                          </div>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <div style={{ flex: 1, height: 7, borderRadius: 999, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
                            <div style={{ width: `${Math.round(gsProgress * 100)}%`, height: "100%", borderRadius: 999, background: "linear-gradient(90deg, rgb(var(--teal-rgb)), #A9B6FF)", transition: "width 0.4s ease" }} />
                          </div>
                          <span style={{ fontSize: 11.5, fontWeight: 600, color: "var(--text-secondary)", flexShrink: 0 }}>Step {Math.min(gs.currentIdx + 1, gs.steps.length)} of {gs.steps.length}</span>
                        </div>
                        <div style={{ display: "flex", gap: 5, marginTop: 9, flexWrap: "wrap" }}>
                          {gs.steps.map((s, i) => {
                            const state = i < gs.currentIdx ? "done" : i === gs.currentIdx ? "cur" : "todo";
                            return <span key={i} title={s.title} style={{ fontSize: 10.5, padding: "3px 8px", borderRadius: 999, background: state === "cur" ? "rgba(var(--teal-rgb),0.25)" : state === "done" ? "rgba(var(--teal-rgb),0.14)" : "rgba(255,255,255,0.04)", border: `1px solid ${state === "cur" ? "rgba(var(--teal-rgb),0.5)" : state === "done" ? "rgba(var(--teal-rgb),0.3)" : "rgba(255,255,255,0.08)"}`, color: state === "cur" ? "#DCE3FF" : state === "done" ? "#A9B6FF" : "var(--text-dim)", fontWeight: state === "todo" ? 400 : 600 }}>{state === "done" ? "✓ " : ""}{i + 1}</span>;
                          })}
                        </div>
                      </div>
                      {gsNudge && (
                        <div style={{ flexShrink: 0, marginBottom: 10, background: "rgba(var(--teal-rgb),0.09)", border: "1px solid rgba(var(--teal-rgb),0.22)", borderRadius: 10, padding: "8px 12px", fontSize: 12.5, color: "#7dd3c8", display: "flex", alignItems: "center", gap: 7 }}><Sparkles size={13} />{gsNudge}</div>
                      )}
                      {/* Teaching content — scrolls within the stage */}
                      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", paddingRight: 4 }}>
                        <div style={{ marginBottom: 10, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
                          <div style={{ minWidth: 0 }}>
                            <h4 style={{ fontFamily: "var(--font-sans)", fontSize: 18, fontWeight: 600, color: "var(--text-primary)", margin: "0 0 3px" }}>{gs.steps[gs.currentIdx]?.title}</h4>
                            <p style={{ fontSize: 12.5, color: "var(--text-dim)", margin: 0 }}>{gs.steps[gs.currentIdx]?.goal}</p>
                          </div>
                          <button onClick={() => (gsSpeaking ? gsStopSpeak() : gsSpeak(gsStepContent[gs.currentIdx] || ""))} disabled={!gsStepContent[gs.currentIdx]} title={gsSpeaking ? "Stop reading" : "Read this step aloud"} style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 5, background: gsSpeaking ? "rgba(var(--teal-rgb),0.16)" : "rgba(255,255,255,0.05)", border: `1px solid ${gsSpeaking ? "rgba(var(--teal-rgb),0.4)" : "rgba(255,255,255,0.12)"}`, borderRadius: 999, padding: "6px 11px", fontSize: 11.5, fontWeight: 600, color: gsSpeaking ? "#A9B6FF" : "var(--text-secondary)", cursor: gsStepContent[gs.currentIdx] ? "pointer" : "default", opacity: gsStepContent[gs.currentIdx] ? 1 : 0.5, fontFamily: "inherit" }}>{gsSpeaking ? <><VolumeX size={12} />Stop</> : <><Volume2 size={12} />Read aloud</>}</button>
                        </div>
                        <div style={{ display: "flex", gap: 10, alignItems: "flex-start", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 14, padding: 14 }}>
                          <div style={{ width: 30, height: 30, borderRadius: "50%", background: "rgba(var(--teal-rgb),0.2)", border: "1px solid rgba(var(--teal-rgb),0.35)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Sparkles size={15} color="#c4b5fd" /></div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            {gsStepContent[gs.currentIdx] ? <GsRichText text={gsStepContent[gs.currentIdx]} /> : <p style={{ margin: 0, fontSize: 13, color: "var(--text-dim)", fontStyle: "italic" }}>{gsBusyLabel || "Reggie is preparing this step…"}</p>}
                            {(gsExtra[gs.currentIdx] || []).map((t, i) => (
                              <div key={i} style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid rgba(255,255,255,0.06)" }}><GsRichText text={t} /></div>
                            ))}
                            {gsBusy && gsStepContent[gs.currentIdx] && <p style={{ fontSize: 12, color: "var(--text-dim)", margin: "10px 0 0", fontStyle: "italic" }}>{gsBusyLabel || "Reggie is thinking…"}</p>}
                          </div>
                        </div>
                      </div>
                      {gsAskOpen && (
                        <div style={{ flexShrink: 0, display: "flex", gap: 8, marginTop: 10 }}>
                          <input value={gsAsk} onChange={e => setGsAsk(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && gsAsk.trim()) gsAskSend(); }} placeholder="Ask Reggie about this step…" autoFocus style={{ flex: 1, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: "9px 12px", color: "var(--text-primary)", fontSize: 13, fontFamily: "inherit", outline: "none" }} />
                          <button onClick={gsAskSend} disabled={!gsAsk.trim() || gsBusy} style={{ background: "rgba(var(--teal-rgb),0.2)", border: "1px solid rgba(var(--teal-rgb),0.35)", borderRadius: 10, padding: "0 14px", color: "#c4b5fd", fontSize: 13, fontWeight: 600, cursor: (!gsAsk.trim() || gsBusy) ? "default" : "pointer", opacity: (!gsAsk.trim() || gsBusy) ? 0.5 : 1, fontFamily: "inherit" }}>Send</button>
                        </div>
                      )}
                      <div style={{ flexShrink: 0, display: "flex", gap: 8, marginTop: 12 }}>
                        <button onClick={gsStuck} disabled={gsBusy} style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: "10px 14px", fontSize: 12.5, fontWeight: 600, color: "var(--text-secondary)", cursor: gsBusy ? "default" : "pointer", opacity: gsBusy ? 0.6 : 1, fontFamily: "inherit" }}>I'm stuck</button>
                        <button onClick={() => setGsAskOpen(o => !o)} style={{ background: gsAskOpen ? "rgba(var(--teal-rgb),0.15)" : "rgba(255,255,255,0.05)", border: `1px solid ${gsAskOpen ? "rgba(var(--teal-rgb),0.35)" : "rgba(255,255,255,0.12)"}`, borderRadius: 10, padding: "10px 14px", fontSize: 12.5, fontWeight: 600, color: gsAskOpen ? "#c4b5fd" : "var(--text-secondary)", cursor: "pointer", fontFamily: "inherit" }}>Ask a question</button>
                        <button onClick={gsNext} disabled={gsBusy} style={{ marginLeft: "auto", background: gsBusy ? "rgba(var(--teal-rgb),0.25)" : "linear-gradient(135deg, rgb(var(--teal-rgb)), #A9B6FF)", border: "none", borderRadius: 10, padding: "10px 20px", fontSize: 13, fontWeight: 600, color: "#fff", cursor: gsBusy ? "default" : "pointer", opacity: gsBusy ? 0.7 : 1, fontFamily: "inherit", boxShadow: "0 6px 18px rgba(var(--teal-rgb),0.3)" }}>{gs.currentIdx >= gs.steps.length - 1 ? "Finish ✓" : "Continue →"}</button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                /* ── Flashcards stage ── */
                <div style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
                  {fcCards.length === 0 ? (
                    /* Launcher */
                    <div style={{ height: "100%", overflowY: "auto", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", textAlign: "center", padding: "20px 18px" }}>
                      <div style={{ width: 56, height: 56, borderRadius: 16, background: "linear-gradient(150deg, rgba(var(--teal-rgb),0.35), rgba(var(--teal-rgb),0.18))", border: "1px solid rgba(var(--teal-rgb),0.4)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 16 }}><BookOpen size={26} color="#DCE3FF" /></div>
                      <h3 style={{ fontFamily: "var(--font-sans)", fontSize: 22, fontWeight: 600, color: "var(--text-primary)", margin: "0 0 6px" }}>Flashcards</h3>
                      <p style={{ fontSize: 13, color: "var(--text-dim)", margin: "0 0 18px", maxWidth: 340, lineHeight: 1.5 }}>Reggie builds a deck on any topic — grounded in your course materials — and quizzes you.</p>
                      <input value={fcTopic} onChange={e => setFcTopic(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && fcTopic.trim()) fcGenerate(fcTopic); }} placeholder="Topic to make cards on…" style={{ width: "100%", maxWidth: 380, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12, padding: "12px 14px", color: "var(--text-primary)", fontSize: 14, fontFamily: "inherit", outline: "none", textAlign: "center", marginBottom: 12 }} />
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <button onClick={() => fcGenerate(fcTopic)} disabled={!fcTopic.trim() || fcBusy} style={{ background: (!fcTopic.trim() || fcBusy) ? "rgba(var(--teal-rgb),0.2)" : "linear-gradient(135deg, rgb(var(--teal-rgb)), #A9B6FF)", border: "none", borderRadius: 12, padding: "12px 24px", fontSize: 14, fontWeight: 600, color: "#fff", cursor: (!fcTopic.trim() || fcBusy) ? "default" : "pointer", opacity: (!fcTopic.trim() || fcBusy) ? 0.6 : 1, fontFamily: "inherit", boxShadow: "0 8px 24px rgba(var(--teal-rgb),0.35)" }}>{fcBusy ? "Building deck…" : "Generate deck →"}</button>
                        {room.course_id && <button onClick={fcLoadCourseDeck} disabled={fcBusy} style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12, padding: "12px 18px", fontSize: 13, fontWeight: 600, color: "var(--text-secondary)", cursor: fcBusy ? "default" : "pointer", fontFamily: "inherit" }}>Load my deck</button>}
                      </div>
                    </div>
                  ) : fcDone ? (
                    /* Summary */
                    <div style={{ height: "100%", overflowY: "auto", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", textAlign: "center", padding: "20px 18px" }}>
                      <div style={{ fontSize: 44, marginBottom: 8 }}>🎉</div>
                      <h3 style={{ fontFamily: "var(--font-sans)", fontSize: 22, fontWeight: 600, color: "var(--text-primary)", margin: "0 0 6px" }}>Deck complete</h3>
                      <p style={{ fontSize: 13.5, color: "var(--text-secondary)", margin: "0 0 4px" }}><span style={{ color: "#A9B6FF", fontWeight: 600 }}>{fcResults.got} got it</span> · <span style={{ color: "#fca5a5", fontWeight: 600 }}>{fcResults.missed} to review</span></p>
                      <p style={{ fontSize: 12.5, color: "var(--text-dim)", margin: "0 0 20px" }}>{fcCards.length} cards</p>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button onClick={() => { setFcIdx(0); setFcFlipped(false); setFcDone(false); setFcResults({ got: 0, missed: 0 }); }} style={{ background: "linear-gradient(135deg, rgb(var(--teal-rgb)), #A9B6FF)", border: "none", borderRadius: 12, padding: "11px 20px", fontSize: 13, fontWeight: 600, color: "#fff", cursor: "pointer", fontFamily: "inherit" }}>Study again</button>
                        <button onClick={fcReset} style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12, padding: "11px 20px", fontSize: 13, fontWeight: 600, color: "var(--text-secondary)", cursor: "pointer", fontFamily: "inherit" }}>New deck</button>
                      </div>
                    </div>
                  ) : (
                    /* Reviewer */
                    <div style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
                      <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                        <div style={{ flex: 1, height: 6, borderRadius: 999, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
                          <div style={{ width: `${Math.round((fcIdx / fcCards.length) * 100)}%`, height: "100%", background: "linear-gradient(90deg, rgb(var(--teal-rgb)), #A9B6FF)", transition: "width 0.3s ease" }} />
                        </div>
                        <span style={{ fontSize: 11.5, fontWeight: 600, color: "var(--text-secondary)", flexShrink: 0 }}>Card {fcIdx + 1} of {fcCards.length}</span>
                        <button onClick={fcReset} title="New deck" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 999, padding: "5px 10px", fontSize: 11, color: "var(--text-dim)", cursor: "pointer", fontFamily: "inherit" }}>Exit</button>
                      </div>
                      <button onClick={() => setFcFlipped(f => !f)} style={{ flex: 1, minHeight: 0, width: "100%", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", textAlign: "center", gap: 12, background: fcFlipped ? "rgba(var(--teal-rgb),0.06)" : "rgba(var(--teal-rgb),0.07)", border: `1px solid ${fcFlipped ? "rgba(var(--teal-rgb),0.25)" : "rgba(var(--teal-rgb),0.25)"}`, borderRadius: 16, padding: "24px", cursor: "pointer", fontFamily: "inherit", overflow: "auto" }}>
                        <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: fcFlipped ? "#A9B6FF" : "#a5b4fc" }}>{fcFlipped ? "Answer" : "Question"}</span>
                        <span style={{ fontSize: 18, fontWeight: 500, lineHeight: 1.45, color: "var(--text-primary)", maxWidth: 460 }}>{fcFlipped ? fcCards[fcIdx]?.a : fcCards[fcIdx]?.q}</span>
                        {!fcFlipped && <span style={{ fontSize: 11.5, color: "var(--text-dim)" }}>Tap to reveal</span>}
                      </button>
                      <div style={{ flexShrink: 0, display: "flex", gap: 8, marginTop: 12 }}>
                        {fcFlipped ? (<>
                          <button onClick={() => fcRate(false)} style={{ flex: 1, background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 12, padding: "11px", fontSize: 13, fontWeight: 600, color: "#fca5a5", cursor: "pointer", fontFamily: "inherit" }}>Missed</button>
                          <button onClick={() => fcRate(true)} style={{ flex: 1, background: "rgba(var(--teal-rgb),0.14)", border: "1px solid rgba(var(--teal-rgb),0.35)", borderRadius: 12, padding: "11px", fontSize: 13, fontWeight: 600, color: "#A9B6FF", cursor: "pointer", fontFamily: "inherit" }}>Got it</button>
                        </>) : (
                          <button onClick={() => setFcFlipped(true)} style={{ flex: 1, background: "linear-gradient(135deg, rgb(var(--teal-rgb)), #A9B6FF)", border: "none", borderRadius: 12, padding: "11px", fontSize: 13, fontWeight: 600, color: "#fff", cursor: "pointer", fontFamily: "inherit" }}>Reveal answer</button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* RIGHT — VOICE (the star): people strip · live transcript (the space) · one control bar */}
          <div style={{ display: focusMode ? "none" : "flex", flexDirection: "column", gap: 12, background: "rgba(255,255,255,0.10)", border: "1px solid rgba(255,255,255,0.22)", borderRadius: 18, backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(20px)", padding: 16, minHeight: 0, overflow: "hidden" }}>
            <style>{`@keyframes rvJoinPulse{0%,100%{box-shadow:0 0 0 0 rgba(var(--teal-rgb),0.45)}50%{box-shadow:0 0 0 6px rgba(var(--teal-rgb),0)}}@keyframes rvThink{0%,80%,100%{transform:translateY(0);opacity:.35}40%{transform:translateY(-3px);opacity:1}}`}</style>

            {/* ── People — compact avatar strip ─────────────────────────────── */}
            <div style={{ flexShrink: 0 }}>
              <p style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-dim)", margin: "0 0 8px" }}>In the room · {members.length || 1}</p>
              <div style={{ display: "flex", gap: 12, overflowX: "auto", paddingBottom: 2 }}>
                {(members.length ? members : [{ userId, name: userData?.name || "You", voice: null }]).map((m: any, i: number) => {
                  const isMe = m.userId === userId;
                  const speaking = !!voiceSpeaking[m.userId];
                  const initial = (m.name || "?").charAt(0).toUpperCase();
                  const inVoice = !!m.voice?.live;
                  const muted = !!m.voice?.muted;
                  const dot = !inVoice ? null : muted ? "#f87171" : speaking ? "#7fe0a0" : "rgb(var(--teal-rgb))";
                  return (
                    <div key={m.userId || i} title={isMe ? "You" : (m.name || "Guest")} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 5, width: 52, flexShrink: 0 }}>
                      <div style={{ position: "relative", width: 44, height: 44, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, fontWeight: 700, color: "#e6f4ea",
                        background: "linear-gradient(160deg, rgba(var(--teal-rgb),0.4), rgba(169,182,255,0.25))",
                        border: `2px solid ${speaking ? "rgb(var(--teal-rgb))" : "rgba(255,255,255,0.18)"}`,
                        boxShadow: speaking ? "0 0 0 3px rgba(var(--teal-rgb),0.25)" : "none", transition: "box-shadow 0.15s, border-color 0.15s" }}>
                        {initial}
                        {dot && (
                          <span style={{ position: "absolute", bottom: -2, right: -2, width: 17, height: 17, borderRadius: "50%", background: "#0d0f16", border: "2px solid #0d0f16", display: "flex", alignItems: "center", justifyContent: "center" }}>
                            {muted ? <MicOff size={10} style={{ color: dot }} /> : <Mic size={10} style={{ color: dot }} />}
                          </span>
                        )}
                      </div>
                      <span style={{ fontSize: 10.5, color: "var(--text-secondary)", maxWidth: 52, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{isMe ? "You" : (m.name || "Guest")}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ── Live transcript — the shared source of truth (gets the space) ── */}
            <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", borderTop: "1px solid rgba(255,255,255,0.10)", paddingTop: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "0 0 8px" }}>
                <p style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-dim)", margin: 0 }}>
                  Live transcript{aiThinking && !solving && <span style={{ color: "#A9B6FF", marginLeft: 6, textTransform: "none", letterSpacing: 0 }}>· Reggie is thinking…</span>}
                </p>
                {solving && (
                  <div style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 8 }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(169,182,255,0.16)", border: "1px solid rgba(169,182,255,0.4)", borderRadius: 999, padding: "3px 10px", fontSize: 11, fontWeight: 700, color: "#C7D0FF" }}>
                      <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#A9B6FF", boxShadow: "0 0 6px #A9B6FF", animation: "rvJoinPulse 1.4s ease-in-out infinite" }} />
                      Solving your question
                    </span>
                    <button onClick={requestEndSolve} title="End the Q&A loop" style={{ borderRadius: 999, padding: "3px 10px", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.14)", color: "var(--text-dim)" }}>Done</button>
                  </div>
                )}
              </div>
              <div style={{ flex: 1, minHeight: 60, overflowY: "auto", display: "flex", flexDirection: "column", gap: 5, fontSize: 12.5, lineHeight: 1.5, paddingRight: 2 }}>
                {transcript.length === 0 && Object.keys(livePartials).length === 0 && !streamingAi && (
                  <span style={{ color: "var(--text-dim)", fontSize: 11.5, lineHeight: 1.5 }}>
                    {isStreamingSTT() ? "Join voice and speak — the conversation appears here, and Reggie is listening." : "Streaming transcription is off (VITE_VOICE_STREAMING)."}
                  </span>
                )}
                {transcript.map(u => {
                  const isAi = u.speakerId === "reggie";
                  return (
                    <div key={u.id} style={isAi ? { background: "rgba(169,182,255,0.08)", borderRadius: 8, padding: "5px 9px" } : undefined}>
                      <span style={{ color: isAi ? "#A9B6FF" : (u.speakerId === userId ? "var(--gold)" : "rgb(var(--teal-rgb))"), fontWeight: 700 }}>
                        {isAi ? "Reggie" : (u.speakerId === userId ? "You" : u.speakerName)}
                      </span>{" "}
                      <span style={{ color: isAi ? "var(--text-primary)" : "var(--text-secondary)" }}>{u.text}</span>
                    </div>
                  );
                })}
                {Object.entries(livePartials).map(([id, p]) => (
                  <div key={"p_" + id} style={{ opacity: 0.6, fontStyle: "italic" }}>
                    <span style={{ color: id === userId ? "var(--gold)" : "rgb(var(--teal-rgb))", fontWeight: 600 }}>{id === userId ? "You" : p.name}</span>{" "}
                    <span style={{ color: "var(--text-dim)" }}>{p.text}…</span>
                  </div>
                ))}
                {streamingAi && (
                  <div style={{ background: "rgba(169,182,255,0.08)", borderRadius: 8, padding: "5px 9px" }}>
                    <span style={{ color: "#A9B6FF", fontWeight: 700 }}>Reggie</span>{" "}
                    <span style={{ color: "var(--text-primary)" }}>{streamingAi.text}</span>
                    <span style={{ color: "#A9B6FF", opacity: 0.6 }}>▍</span>
                  </div>
                )}
                {/* Reggie is working on your input — shown from when the transcript is sent
                    until the first sentence streams back, so the gap never feels dead. */}
                {aiThinking && !streamingAi && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, background: "rgba(169,182,255,0.08)", borderRadius: 8, padding: "6px 9px" }}>
                    <span style={{ color: "#A9B6FF", fontWeight: 700 }}>Reggie</span>
                    <span style={{ display: "inline-flex", gap: 3, alignItems: "flex-end" }}>
                      {[0, 1, 2].map(i => (
                        <span key={i} style={{ width: 5, height: 5, borderRadius: "50%", background: "#A9B6FF", animation: `rvThink 1s ease-in-out ${i * 0.16}s infinite` }} />
                      ))}
                    </span>
                    <span style={{ fontSize: 11, color: "var(--text-dim)" }}>thinking…</span>
                  </div>
                )}
                <div ref={transcriptEndRef} />
              </div>
            </div>

            {/* ── Text-to-Reggie — the typed sibling of the voice ask. Same room-ai
                turn, replies land in the transcript for everyone; "put a quiz on the
                board" materializes shared cards. ─────────────────────────────────── */}
            <form
              onSubmit={e => { e.preventDefault(); const q = reggieTextInput; setReggieTextInput(""); askReggieText(q); }}
              style={{ flexShrink: 0, display: "flex", gap: 7, marginBottom: 8 }}
            >
              <input
                value={reggieTextInput}
                onChange={e => setReggieTextInput(e.target.value)}
                placeholder={reggieTextBusy ? "Reggie is thinking…" : "Ask Reggie… (try: put a quiz on the board)"}
                disabled={reggieTextBusy}
                style={{
                  flex: 1, minWidth: 0, padding: "9px 12px", borderRadius: 11, fontSize: 12.5, fontFamily: "inherit",
                  background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.16)",
                  color: "var(--text-primary)", outline: "none",
                }}
                className="gs-topic-input"
              />
              <button
                type="submit"
                disabled={reggieTextBusy || !reggieTextInput.trim()}
                title="Ask Reggie"
                style={{
                  display: "inline-flex", alignItems: "center", justifyContent: "center", width: 38, borderRadius: 11,
                  cursor: reggieTextBusy || !reggieTextInput.trim() ? "default" : "pointer", fontFamily: "inherit",
                  background: reggieTextInput.trim() ? "rgba(var(--teal-rgb),0.22)" : "rgba(255,255,255,0.05)",
                  border: `1px solid ${reggieTextInput.trim() ? "rgba(var(--teal-rgb),0.5)" : "rgba(255,255,255,0.12)"}`,
                  color: reggieTextInput.trim() ? "#DCE3FF" : "var(--text-dim)",
                  opacity: reggieTextBusy ? 0.6 : 1,
                }}
              ><Sparkles size={15} /></button>
            </form>

            {/* ── Voice control bar — every voice control in one place ─────────── */}
            <div style={{ flexShrink: 0 }}>
              {!voiceLive ? (
                <button onClick={joinVoice} style={{
                  width: "100%", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 9,
                  padding: "12px", borderRadius: 12, fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
                  color: "#08131b", border: "1px solid rgba(var(--teal-rgb),0.55)",
                  background: "linear-gradient(135deg, rgb(var(--teal-rgb)), #A9B6FF)",
                  animation: "rvJoinPulse 2.2s ease-in-out infinite",
                }}><Mic size={17} strokeWidth={2.4} />Join voice chat</button>
              ) : (
                <div style={{ display: "flex", gap: 7, alignItems: "stretch" }}>
                  <button onClick={toggleMic} title={micMuted ? "Unmute your mic" : "Mute your mic"} style={{
                    display: "inline-flex", alignItems: "center", gap: 6, padding: "9px 13px", borderRadius: 11, fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
                    background: micMuted ? "rgba(239,68,68,0.16)" : "rgba(var(--teal-rgb),0.2)",
                    border: `1px solid ${micMuted ? "rgba(239,68,68,0.5)" : "rgba(var(--teal-rgb),0.55)"}`,
                    color: micMuted ? "#f87171" : "#DCE3FF" }}>
                    {micMuted ? <MicOff size={16} /> : <Mic size={16} />}{micMuted ? "Muted" : "Live"}
                  </button>
                  <button onClick={toggleSpeaker} title={speakerOn ? "Mute the room (stop hearing others)" : "Unmute the room"} style={{
                    display: "inline-flex", alignItems: "center", justifyContent: "center", width: 40, borderRadius: 11, cursor: "pointer", fontFamily: "inherit",
                    background: speakerOn ? "rgba(255,255,255,0.07)" : "rgba(239,68,68,0.16)",
                    border: `1px solid ${speakerOn ? "rgba(255,255,255,0.16)" : "rgba(239,68,68,0.5)"}`,
                    color: speakerOn ? "var(--text-primary)" : "#f87171" }}>
                    {speakerOn ? <Volume2 size={16} /> : <VolumeX size={16} />}
                  </button>
                  {captureMode ? (
                    <div style={{ display: "flex", gap: 7, flex: 1 }}>
                      <button onClick={() => stopCapture(false)} style={{ flex: 1, borderRadius: 11, fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.14)", color: "var(--text-dim)" }}>Cancel</button>
                      <button onClick={() => stopCapture(true)} style={{ flex: 1, borderRadius: 11, fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", background: "rgba(127,224,160,0.18)", border: "1px solid rgba(127,224,160,0.5)", color: "#7fe0a0" }}>Submit →</button>
                    </div>
                  ) : (
                    <>
                      <button onClick={startCapture} disabled={aiThinking} title="Ask Reggie a question — tap, speak, then submit" style={{
                        flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "9px 10px", borderRadius: 11, fontSize: 12.5, fontWeight: 700, cursor: aiThinking ? "default" : "pointer", fontFamily: "inherit",
                        background: "rgba(169,182,255,0.16)", border: "1px solid rgba(169,182,255,0.4)", color: "#C7D0FF", opacity: aiThinking ? 0.5 : 1 }}>
                        <Sparkles size={14} />Ask Reggie
                      </button>
                      <button onClick={toggleProactive} title={proactiveOn ? "Reggie chimes in when someone's stuck — click to turn off" : "Let Reggie chime in on its own when someone seems stuck"} style={{
                        display: "inline-flex", alignItems: "center", gap: 4, padding: "9px 11px", borderRadius: 11, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
                        background: proactiveOn ? "rgba(127,224,160,0.16)" : "rgba(255,255,255,0.05)",
                        border: `1px solid ${proactiveOn ? "rgba(127,224,160,0.45)" : "rgba(255,255,255,0.12)"}`,
                        color: proactiveOn ? "#7fe0a0" : "var(--text-dim)" }}>
                        <Zap size={13} />{proactiveOn ? "On" : "Auto"}
                      </button>
                    </>
                  )}
                </div>
              )}
              {voiceError && <p style={{ fontSize: 11, color: "#f87171", margin: "8px 0 0", lineHeight: 1.4 }}>{voiceError}</p>}
              {!voiceLive && members.length <= 1 && room.join_code && (
                <p style={{ fontSize: 11, color: "var(--text-dim)", margin: "8px 0 0", textAlign: "center" }}>You're the first one here — share code <b style={{ color: "#DCE3FF", letterSpacing: 1 }}>{room.join_code}</b> via the ⋯ menu.</p>
              )}
            </div>
          </div>
        </div>
      </div>


      {/* Chat panel — persisted, WhatsApp-style */}
      {showChat && focusMode && (
        <ChatPanel
          messages={chatMessages}
          myUserId={userId}
          input={chatInput}
          sending={chatSending}
          imageUploading={imageUploading}
          onInputChange={setChatInput}
          onSend={sendChatMessage}
          onImageUpload={handleImageUpload}
          onClose={() => setShowChat(false)}
        />
      )}

      {/* In-room private Reggie (B1) — your own 1-on-1 tutor; only you see this thread */}
      {showReggie && (
        <div style={{ position: "fixed", right: 20, bottom: 20, width: 360, maxWidth: "calc(100vw - 40px)", height: 460, maxHeight: "70vh", display: "flex", flexDirection: "column", background: "var(--card, #16151c)", border: "1px solid rgba(var(--teal-rgb),0.25)", borderRadius: 16, boxShadow: "0 12px 40px rgba(0,0,0,0.45)", zIndex: 60, overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 14px", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
            <Sparkles size={15} color="rgb(var(--teal-rgb))" />
            <span style={{ fontWeight: 600, fontSize: 14, color: "var(--text, #ECEBF0)" }}>Reggie</span>
            <span style={{ fontSize: 11, color: "var(--text-dim)", marginLeft: 2 }}>· private to you</span>
            <button onClick={() => setShowReggie(false)} aria-label="Close Reggie" style={{ marginLeft: "auto", background: "none", border: "none", color: "var(--text-dim)", cursor: "pointer", display: "inline-flex" }}><X size={16} /></button>
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
            {reggieMsgs.length === 0 && (
              <div style={{ color: "var(--text-dim)", fontSize: 13, lineHeight: 1.5, marginTop: 8 }}>
                Ask Reggie about your courses, an assignment, or what to study next — grounded in your own materials. Only you see this.
              </div>
            )}
            {reggieMsgs.map((m, i) => (
              <div key={i} style={{ alignSelf: m.role === "user" ? "flex-end" : "flex-start", maxWidth: "85%", display: "flex", flexDirection: "column", alignItems: m.role === "user" ? "flex-end" : "flex-start" }}>
                <div style={{ padding: "8px 11px", borderRadius: 12, fontSize: 13, lineHeight: 1.5, whiteSpace: m.role === "user" ? "pre-wrap" : "normal", background: m.role === "user" ? "rgba(var(--teal-rgb),0.16)" : "rgba(255,255,255,0.05)", color: "var(--text, #ECEBF0)" }}>
                  {/* Assistant replies are markdown-ish (##/---/bullets/**bold**) — render them,
                      don't leak raw syntax. User messages stay literal. */}
                  {m.role === "user" ? m.content : <GsRichText text={m.content} />}
                </div>
                {/* Grounding chips: what this answer drew on (real payload from room-ai). */}
                {m.role === "assistant" && <RoomGroundingChips grounded={m.grounded} />}
              </div>
            ))}
            {reggieBusy && <div style={{ alignSelf: "flex-start", color: "var(--text-dim)", fontSize: 13 }}>Reggie is thinking…</div>}
          </div>
          <div style={{ display: "flex", gap: 8, padding: 12, borderTop: "1px solid rgba(255,255,255,0.07)" }}>
            <input
              value={reggieInput}
              onChange={e => setReggieInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); askRoomReggie(); } }}
              placeholder="Ask Reggie…"
              disabled={reggieBusy}
              style={{ flex: 1, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, padding: "9px 11px", color: "var(--text, #ECEBF0)", fontSize: 13, fontFamily: "inherit", outline: "none" }}
            />
            <button onClick={askRoomReggie} disabled={reggieBusy || !reggieInput.trim()} style={{ background: "rgba(var(--teal-rgb),0.2)", border: "1px solid rgba(var(--teal-rgb),0.35)", borderRadius: 10, padding: "0 14px", color: "#c4b5fd", fontSize: 13, fontWeight: 600, cursor: (reggieBusy || !reggieInput.trim()) ? "default" : "pointer", opacity: (reggieBusy || !reggieInput.trim()) ? 0.5 : 1, fontFamily: "inherit" }}>Send</button>
          </div>
        </div>
      )}

      {/* Focus music — floating mini-player (iTunes 30s previews) */}
      {musicOpen && (
        <div style={{ position: "fixed", left: 20, bottom: 20, width: 300, maxWidth: "calc(100vw - 40px)", background: "var(--card, #16151c)", border: "1px solid rgba(var(--teal-rgb),0.25)", borderRadius: 16, boxShadow: "0 12px 40px rgba(0,0,0,0.45)", zIndex: 60, overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "11px 13px", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
            <Music size={15} color="rgb(var(--teal-rgb))" />
            <span style={{ fontWeight: 600, fontSize: 13.5, color: "var(--text-primary)" }}>Focus music</span>
            <button onClick={() => { stopMusic(); setMusicOpen(false); }} aria-label="Close music" style={{ marginLeft: "auto", background: "none", border: "none", color: "var(--text-dim)", cursor: "pointer", display: "inline-flex" }}><X size={15} /></button>
          </div>
          <div style={{ padding: 13 }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 11 }}>
              {MUSIC_PRESETS.map(p => (
                <button key={p.query} onClick={() => selectMusicPreset(p.query)} style={{ fontSize: 11, padding: "4px 9px", borderRadius: 999, cursor: "pointer", fontFamily: "inherit", background: musicPreset === p.query ? "rgba(var(--teal-rgb),0.22)" : "rgba(255,255,255,0.05)", border: musicPreset === p.query ? "1px solid rgba(var(--teal-rgb),0.45)" : "1px solid rgba(255,255,255,0.12)", color: musicPreset === p.query ? "#DCE3FF" : "var(--text-secondary)" }}>{p.label}</button>
              ))}
            </div>
            {musicTracks.length === 0 ? (
              <button onClick={() => toggleMusic()} disabled={musicLoading} style={{ width: "100%", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, background: "linear-gradient(135deg, rgb(var(--teal-rgb)), #A9B6FF)", border: "none", borderRadius: 10, padding: "11px", fontSize: 13, fontWeight: 600, color: "#fff", cursor: musicLoading ? "default" : "pointer", opacity: musicLoading ? 0.7 : 1, fontFamily: "inherit" }}>{musicLoading ? "Finding tracks…" : <><Play size={14} />Play focus music</>}</button>
            ) : (<>
              <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12 }}>
                {musicTracks[musicIdx]?.artwork
                  ? <img src={musicTracks[musicIdx].artwork} alt="" style={{ width: 46, height: 46, borderRadius: 8, flexShrink: 0, objectFit: "cover" }} />
                  : <div style={{ width: 46, height: 46, borderRadius: 8, background: "rgba(var(--teal-rgb),0.2)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Music size={20} color="rgb(var(--teal-rgb))" /></div>}
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{musicTracks[musicIdx]?.title}</div>
                  <div style={{ fontSize: 11.5, color: "var(--text-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{musicTracks[musicIdx]?.artist}</div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button onClick={() => toggleMusic()} style={{ flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, background: "rgba(var(--teal-rgb),0.18)", border: "1px solid rgba(var(--teal-rgb),0.4)", borderRadius: 10, padding: "9px", fontSize: 13, fontWeight: 600, color: "#DCE3FF", cursor: "pointer", fontFamily: "inherit" }}>{musicPlaying ? <><Pause size={14} />Pause</> : <><Play size={14} />Play</>}</button>
                <button onClick={nextMusic} title="Next track" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: "9px 12px", color: "var(--text-secondary)", cursor: "pointer", display: "inline-flex", alignItems: "center" }}><SkipForward size={14} /></button>
              </div>
              <p style={{ fontSize: 10.5, color: "var(--text-dim)", margin: "9px 0 0", textAlign: "center" }}>30-second previews · Apple Music</p>
            </>)}
          </div>
        </div>
      )}

      {/* Proactive intervention card — silence / time-milestone / uneven nudge from a REAL trigger
          event (server broadcast), with reason + dismiss + pause. */}
      {interventionCard && (
        <div role="status" style={{ position: "fixed", left: "50%", bottom: 24, transform: "translateX(-50%)", width: 380, maxWidth: "calc(100vw - 32px)", background: "var(--card, #16151c)", border: "1px solid rgba(var(--teal-rgb),0.4)", borderRadius: 14, boxShadow: "0 12px 40px rgba(0,0,0,0.45)", zIndex: 70, padding: "13px 15px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: 15 }} aria-hidden>💡</span>
            <span style={{ fontWeight: 700, fontSize: 13, color: "var(--text-primary)" }}>{interventionReason(interventionCard.rule, interventionCard.milestone)}</span>
            <button onClick={() => setInterventionCard(null)} aria-label="Dismiss" style={{ marginLeft: "auto", background: "none", border: "none", color: "var(--text-dim)", cursor: "pointer", display: "inline-flex" }}><X size={15} /></button>
          </div>
          <div style={{ fontSize: 13, lineHeight: 1.5, color: "var(--text, #ECEBF0)" }}><GsRichText text={interventionCard.message} /></div>
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button onClick={() => setInterventionCard(null)} style={{ flex: 1, background: "rgba(var(--teal-rgb),0.18)", border: "1px solid rgba(var(--teal-rgb),0.4)", borderRadius: 9, padding: "7px", fontSize: 12.5, fontWeight: 600, color: "#DCE3FF", cursor: "pointer", fontFamily: "inherit" }}>Got it</button>
            <button onClick={() => { interventionsPausedRef.current = true; setInterventionCard(null); }} style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 9, padding: "7px 12px", fontSize: 12.5, color: "var(--text-secondary)", cursor: "pointer", fontFamily: "inherit" }}>Pause nudges</button>
          </div>
        </div>
      )}

      {reviewOpen && reviewSessionId && (
        <SessionReview sessionId={reviewSessionId} onClose={() => setReviewOpen(false)} />
      )}

      {/* Whiteboard now renders inline in the center pane (Pass 2). */}

      {showInvite && (
        <InviteModal room={room} userId={userId} userData={userData} onlineIds={onlineIds} onClose={() => setShowInvite(false)} />
      )}

      {showAccess && (
        <AccessSettingsModal
          initial={accessFilters}
          hasCourse={!!room.course_id}
          onSave={saveAccess}
          onClose={() => setShowAccess(false)}
        />
      )}

      {/* Goal prompt on enter */}
      {showGoalPrompt && (
        <GoalPromptModal
          onSet={(goal) => {
            goalTextRef.current = goal;
            handleWorkingOnChange(goal);
            setShowGoalPrompt(false);
          }}
          onSkip={() => setShowGoalPrompt(false)}
        />
      )}

      {/* Session summary on leave */}
      {showSummary && (
        <SessionSummaryModal
          durationSecs={summaryDurationSecs}
          goal={goalTextRef.current || workingOn}
          onConfirm={confirmLeave}
          onBack={() => setShowSummary(false)}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FocusSprintPanel — no break phase, configurable 15/25/45/60 min sprints
// ─────────────────────────────────────────────────────────────────────────────
const SPRINT_DURATIONS = [
  { label: "15 min", secs: 15 * 60 },
  { label: "25 min", secs: 25 * 60 },
  { label: "45 min", secs: 45 * 60 },
  { label: "60 min", secs: 60 * 60 },
];

function sprintCtrlStyle(variant) {
  const v = {
    dim:    { bg:"rgba(255,255,255,0.05)", color:"var(--text-dim)",      border:"rgba(255,255,255,0.09)" },
    accent: { bg:"rgba(var(--gold-rgb), 0.12)", color:"var(--gold)",              border:"rgba(var(--gold-rgb), 0.3)"   },
    red:    { bg:"rgba(255,59,48,0.07)",  color:"rgba(255,100,90,0.7)", border:"rgba(255,59,48,0.18)"   },
  }[variant] || { bg:"rgba(255,255,255,0.05)", color:"var(--text-dim)", border:"rgba(255,255,255,0.09)" };
  return {
    background:v.bg, color:v.color, border:`1px solid ${v.border}`,
    borderRadius:"8px", padding:"8px 16px", fontSize:"12px", fontWeight:"500",
    cursor:"pointer", fontFamily:"inherit",
  };
}

function FocusSprintPanel({ pomo, remaining, isHost, sprintDuration, onDurationChange, onStart, onPause, onResume, onReset, onEnd }) {
  const isIdle    = !pomo || pomo.phase === "idle" || pomo.phase === "break";
  const isFocus   = pomo?.phase === "focus";
  const isPaused  = !!pomo?.paused;
  const isRunning = isFocus && !isPaused;
  const defaultDurLabel = SPRINT_DURATIONS.find(d => d.secs === sprintDuration)?.label ?? "25 min";

  return (
    <div style={{
      background: isFocus ? "rgba(var(--gold-rgb), 0.05)" : "rgba(255,255,255,0.02)",
      border: `1px solid ${isFocus ? "rgba(var(--gold-rgb), 0.18)" : "rgba(255,255,255,0.07)"}`,
      borderRadius:"14px", padding:"20px 20px 16px", marginBottom:"18px",
      transition:"background 0.4s, border-color 0.4s",
    }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:"10px" }}>
        <span style={{ fontSize:"11px", letterSpacing:"2px", textTransform:"uppercase", color: isFocus ? "var(--gold)" : "var(--text-dim)", fontWeight:"600" }}>
          <BookOpen size={12} style={{ verticalAlign:"-2px", marginRight:6 }} />Focus Sprint{isPaused ? " · Paused" : ""}
        </span>
        <span style={{ fontSize:"11px", color:"var(--text-dim)" }}>
          {isFocus ? "Study, discuss, or go mute — together" : "Choose your sprint length"}
        </span>
      </div>

      {/* Countdown */}
      <div style={{ textAlign:"center", margin:"4px 0 14px" }}>
        <span style={{
          fontSize:"56px", fontWeight:"700", letterSpacing:"-2px",
          fontVariantNumeric:"tabular-nums", display:"block", lineHeight:1,
          color: isIdle ? "rgba(255,255,255,0.15)" : "var(--gold)",
          opacity: isPaused ? 0.55 : 1,
          transition:"color 0.4s",
        }}>
          {isIdle ? formatPomoTime(sprintDuration) : formatPomoTime(remaining)}
        </span>
      </div>

      {/* Controls */}
      {isHost ? (
        <div style={{ display:"flex", gap:"8px", justifyContent:"center", flexWrap:"wrap", alignItems:"center" }}>
          {isIdle && (
            <>
              {/* Duration selector */}
              <div style={{ display:"flex", gap:"4px", marginRight:"8px" }}>
                {SPRINT_DURATIONS.map(d => (
                  <button key={d.secs} onClick={() => onDurationChange(d.secs)} style={{
                    background: sprintDuration === d.secs ? "rgba(var(--gold-rgb), 0.14)" : "rgba(255,255,255,0.04)",
                    color: sprintDuration === d.secs ? "var(--gold)" : "var(--text-dim)",
                    border: `1px solid ${sprintDuration === d.secs ? "rgba(var(--gold-rgb), 0.35)" : "rgba(255,255,255,0.09)"}`,
                    borderRadius:"7px", padding:"5px 10px", fontSize:"11px",
                    cursor:"pointer", fontFamily:"inherit",
                  }}>{d.label}</button>
                ))}
              </div>
              <button onClick={onStart} style={{
                background:"rgba(var(--gold-rgb), 0.14)", color:"var(--gold)",
                border:"1px solid rgba(var(--gold-rgb), 0.35)", borderRadius:"9px",
                padding:"9px 24px", fontSize:"13px", fontWeight:"600",
                cursor:"pointer", fontFamily:"inherit",
              }}>
                Start Sprint →
              </button>
            </>
          )}
          {isRunning && (
            <>
              <button onClick={onPause}  style={sprintCtrlStyle("dim")}>Pause</button>
              <button onClick={onEnd}    style={sprintCtrlStyle("dim")}>End sprint</button>
              <button onClick={onReset}  style={sprintCtrlStyle("red")}>Reset</button>
            </>
          )}
          {isPaused && (
            <>
              <button onClick={onResume} style={sprintCtrlStyle("accent")}>Resume</button>
              <button onClick={onReset}  style={sprintCtrlStyle("red")}>Reset</button>
            </>
          )}
        </div>
      ) : (
        <p style={{ textAlign:"center", fontSize:"12px", color:"var(--text-dim)", margin:0 }}>
          {isIdle ? `Waiting for host to start a ${defaultDurLabel} sprint…` :
           "Focus up — sprint in progress."}
        </p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// GoalPromptModal — appears ~500ms after joining, skippable
// ─────────────────────────────────────────────────────────────────────────────
function GoalPromptModal({ onSet, onSkip }) {
  const [goal, setGoal] = useState("");
  const S = styles;
  // Render into document.body so position:fixed centers against the true
  // viewport — not the transformed app-page-transition ancestor.
  return createPortal(
    <div style={S.modalOverlay}>
      <div style={{ ...S.modalCard, maxWidth:"360px" }}>
        <div style={{ textAlign:"center", marginBottom:"20px" }}>
          <p style={{ marginBottom:"10px", display:"flex", justifyContent:"center" }}><Target size={30} style={{ color:"var(--color-accent)" }} /></p>
          <h2 style={{ fontSize:"18px", fontWeight:"700", color:"var(--text-primary)", marginBottom:"6px" }}>
            Set your session goal
          </h2>
          <p style={{ fontSize:"13px", color:"var(--text-dim)", lineHeight:1.5 }}>
            What will you finish today? Everyone in the room will see this.
          </p>
        </div>
        <input
          autoFocus
          value={goal}
          onChange={e => setGoal(e.target.value)}
          onKeyDown={e => e.key === "Enter" && goal.trim() && onSet(goal.trim())}
          placeholder="e.g. Finish CDS151 lab question 3"
          maxLength={80}
          style={S.input}
          onFocus={e => (e.target.style.borderColor="rgba(255,255,255,0.22)")}
          onBlur={e  => (e.target.style.borderColor="rgba(255,255,255,0.1)")}
        />
        <div style={{ display:"flex", gap:"10px" }}>
          <button onClick={onSkip} style={S.ghostBtnLarge}>Skip</button>
          <button
            onClick={() => goal.trim() && onSet(goal.trim())}
            disabled={!goal.trim()}
            style={{ ...S.primaryBtnLarge, opacity: goal.trim() ? 1 : 0.4 }}
          >
            Let's go →
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SessionSummaryModal — leave flow with goal completion self-report
// ─────────────────────────────────────────────────────────────────────────────
function SessionSummaryModal({ durationSecs, goal, onConfirm, onBack }) {
  const hours   = Math.floor(durationSecs / 3600);
  const mins    = Math.floor((durationSecs % 3600) / 60);
  const secs    = durationSecs % 60;
  const timeStr = hours > 0 ? `${hours}h ${mins}m` : mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  // Mirror the server award formula (api/token-engine.ts): +2 for joining, +5 per
  // completed 15-min block. Display only — the server is authoritative.
  const tokensEarned = 2 + Math.floor(durationSecs / (15 * 60)) * 5;
  const S = styles;
  return createPortal(
    <div style={{ position:"fixed", top:0, left:0, width:"100vw", height:"100vh", zIndex:9999, background:"rgba(8,8,10,0.75)", backdropFilter:"blur(14px)", display:"flex", alignItems:"center", justifyContent:"center", padding:"24px" }}>
      <div style={{ ...S.modalCard, maxWidth:"340px", textAlign:"center", position:"relative" }}>
        <button
          onClick={onBack}
          title="Back to room"
          style={{ position:"absolute", top:"14px", right:"18px", background:"none", border:"none", color:"var(--text-dim)", cursor:"pointer", lineHeight:1, padding:"2px 4px", display:"flex" }}
        >
          <X size={20} />
        </button>

        <p style={{ marginBottom:"8px", display:"flex", justifyContent:"center" }}>
          {durationSecs >= 1200 ? <Flame size={34} style={{ color:"#f59e0b" }} /> : <Timer size={34} style={{ color:"var(--color-accent)" }} />}
        </p>
        <h2 style={{ fontSize:"19px", fontWeight:"700", color:"var(--text-primary)", marginBottom:"6px" }}>
          {durationSecs >= 1200 ? "Great session!" : "Session complete"}
        </h2>

        <div style={{
          background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.07)",
          borderRadius:"10px", padding:"14px 16px", margin:"16px 0", textAlign:"left",
        }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"10px" }}>
            <span style={{ fontSize:"12px", color:"var(--text-dim)" }}>Time focused</span>
            <span style={{ fontSize:"14px", fontWeight:"700", color:"var(--color-accent)" }}>{timeStr}</span>
          </div>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom: goal ? "10px" : 0 }}>
            <span style={{ fontSize:"12px", color:"var(--text-dim)" }}>Tokens earned</span>
            <span style={{ fontSize:"14px", fontWeight:"700", color:"var(--color-accent)", display:"inline-flex", alignItems:"center", gap:4 }}><Coins size={14} />{tokensEarned}</span>
          </div>
          {goal && (
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:"12px" }}>
              <span style={{ fontSize:"12px", color:"var(--text-dim)", flexShrink:0 }}>Goal</span>
              <span style={{ fontSize:"12px", color:"var(--text-secondary)", textAlign:"right" }}>{goal}</span>
            </div>
          )}
        </div>

        <p style={{ fontSize:"13px", color:"var(--text-secondary)", marginBottom:"14px" }}>
          Did you finish your goal?
        </p>

        <div style={{ display:"flex", gap:"10px" }}>
          <button
            onClick={() => onConfirm(false)}
            style={{
              flex:1, background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.09)",
              borderRadius:"10px", padding:"12px", fontSize:"14px",
              cursor:"pointer", fontFamily:"inherit", color:"var(--text-dim)",
            }}
          >
            <span style={{ display:"inline-flex", alignItems:"center", gap:6 }}><ThumbsDown size={15} />Not quite</span>
          </button>
          <button
            onClick={() => onConfirm(true)}
            style={{
              flex:1, background:"rgba(var(--gold-rgb), 0.12)", border:"1px solid rgba(var(--gold-rgb), 0.3)",
              borderRadius:"10px", padding:"12px", fontSize:"14px", fontWeight:"600",
              cursor:"pointer", fontFamily:"inherit", color:"var(--color-accent)",
            }}
          >
            <span style={{ display:"inline-flex", alignItems:"center", gap:6 }}><ThumbsUp size={15} />Got it!</span>
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// RoomMenu — the single overflow menu for all secondary room tools (top-bar ⋯).
// Consolidates room code, invite, who-can-join, private tutor, music, host join
// requests, and leave/close — so none of it clutters the main layout.
// ─────────────────────────────────────────────────────────────────────────────
function RoomMenu({ room, isHost, requests, onCopyCode, onInvite, onAccess, onPrivateReggie, onMusic, onAccept, onDecline, onLeave }: any) {
  const [copied, setCopied] = useState(false);
  const item: React.CSSProperties = { display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "9px 11px", borderRadius: 9, background: "none", border: "none", fontSize: 13, color: "var(--text-primary)", cursor: "pointer", fontFamily: "inherit", textAlign: "left" };
  return (
    <div style={{ position: "absolute", right: 0, top: "calc(100% + 8px)", width: 270, zIndex: 1300, background: "rgba(18,20,28,0.98)", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 14, padding: 8, boxShadow: "0 12px 40px rgba(0,0,0,0.55)", backdropFilter: "blur(20px)" }}>
      {/* Host: pending join requests */}
      {isHost && requests.length > 0 && (
        <div style={{ marginBottom: 6, paddingBottom: 6, borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#f59e0b", padding: "4px 11px 6px" }}>Wants to join · {requests.length}</div>
          {requests.map((r: any) => (
            <div key={r.userId} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 11px" }}>
              <span style={{ flex: 1, fontSize: 13, color: "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.name || "Someone"}</span>
              <button onClick={() => onDecline(r.userId)} style={{ padding: "4px 9px", borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)", color: "var(--text-dim)" }}>Deny</button>
              <button onClick={() => onAccept(r.userId)} style={{ padding: "4px 9px", borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", background: "rgba(127,224,160,0.18)", border: "1px solid rgba(127,224,160,0.5)", color: "#7fe0a0" }}>Admit</button>
            </div>
          ))}
        </div>
      )}

      {/* Room code + copy */}
      {room.join_code && (
        <button onClick={() => { onCopyCode(); setCopied(true); setTimeout(() => setCopied(false), 1500); }} style={item}>
          <KeyRound size={15} style={{ color: "var(--text-dim)" }} />
          <span style={{ flex: 1 }}>Room code</span>
          <span style={{ fontFamily: "var(--font-sans)", fontWeight: 700, letterSpacing: 2, color: "#DCE3FF" }}>{room.join_code}</span>
          <span style={{ fontSize: 11, color: copied ? "#7fe0a0" : "var(--text-dim)" }}>{copied ? "Copied" : "Copy"}</span>
        </button>
      )}
      <button onClick={onInvite} style={item}><Plus size={15} style={{ color: "var(--text-dim)" }} />Invite people</button>
      {isHost && <button onClick={onAccess} style={item}><Lock size={15} style={{ color: "var(--text-dim)" }} />Who can join</button>}
      <button onClick={onPrivateReggie} style={item}><Sparkles size={15} style={{ color: "rgb(var(--teal-rgb))" }} />Private tutor</button>
      <button onClick={onMusic} style={item}><Music size={15} style={{ color: "var(--text-dim)" }} />Focus music</button>

      <div style={{ height: 1, background: "rgba(255,255,255,0.08)", margin: "6px 4px" }} />
      <button onClick={onLeave} style={{ ...item, color: "#f87171" }}><LogOut size={15} />{isHost ? "Close room" : "Leave room"}</button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// RequestCard
// ─────────────────────────────────────────────────────────────────────────────
function RequestCard({ request, onAccept, onDecline }) {
  const COLORS = [
    { bg:"rgba(var(--gold-rgb), 0.15)",  fg:"var(--gold)" },
    { bg:"rgba(111,179,196,0.15)", fg:"#6fb3c4" },
    { bg:"rgba(127,174,110,0.15)", fg:"#7fae6e" },
    { bg:"rgba(196,100,100,0.15)", fg:"#d47878" },
    { bg:"rgba(160,110,196,0.15)", fg:"#b888e0" },
  ];
  const col = COLORS[(request.name?.[0]?.charCodeAt(0) ?? 0) % COLORS.length];
  const S = styles;
  return (
    <div style={{ ...S.card, padding:"12px 16px" }}>
      <div style={{
        width:34, height:34, borderRadius:"50%", flexShrink:0,
        background:col.bg, color:col.fg, fontWeight:"700", fontSize:"13px",
        display:"flex", alignItems:"center", justifyContent:"center",
      }}>
        {request.name?.[0]?.toUpperCase() ?? "?"}
      </div>
      <div style={{ flex:1, minWidth:0 }}>
        <p style={{ fontWeight:"600", fontSize:"14px", color:"var(--text-primary)" }}>{request.name}</p>
        <p style={{ fontSize:"11px", color:"var(--text-dim)", marginTop:"2px" }}>Wants to join</p>
      </div>
      <div style={{ display:"flex", gap:"8px", flexShrink:0 }}>
        <button onClick={onAccept}  style={{ ...S.accentBtn, padding:"6px 14px", fontSize:"12px" }}>Accept</button>
        <button onClick={onDecline} style={{ ...S.ghostBtn, marginTop:0, padding:"6px 12px", fontSize:"12px", color:"rgba(255,100,90,0.7)" }}>Decline</button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// InviteModal
// ─────────────────────────────────────────────────────────────────────────────
function InviteModal({ room, userId, userData, onlineIds = [], onClose }) {
  const [friends, setFriends] = useState(null);
  const [invited, setInvited] = useState({});
  const S = styles;

  useEffect(() => {
    getFriendsForInvite(userId).then(data => setFriends(data));
  }, [userId]);

  async function handleInvite(friend) {
    setInvited(i => ({ ...i, [friend.id]: "sending" }));
    try { await inviteToRoom(userId, room.id, friend.id); }
    catch (err) { console.error("[rooms] invite:", (err as any)?.message); }

    // Server enforces the 2/friend/24h rate limit, writes the nudge row, and
    // emails the friend if they're offline. onlineIds = who's present in rooms now.
    const online = onlineIds.includes(friend.id);
    const result = await sendNudge({
      fromUserId: userId, toUserId: friend.id, roomId: room.id,
      fromName: userData?.name ?? "Someone", roomName: room.name,
      recipientOnline: online,
    });

    if (result?.sent === false && result.reason === "rate_limited") {
      setInvited(i => ({ ...i, [friend.id]: "limited" }));
      return;
    }

    // Instant in-app ping for an online friend (also the local-dev path when the
    // serverless endpoint isn't running — best-effort, never throws). The channel is
    // removed after the send: it used to leak one live channel per invite for the
    // rest of the session.
    const pingCh = supabase.channel(`user:${friend.id}`);
    pingCh.send({
      type: "broadcast", event: "nudge",
      payload: {
        kind: "invite", id: `${userId}-${friend.id}-${Date.now()}`,
        fromUserId: userId, fromName: userData?.name ?? "Someone",
        roomId: room.id, roomName: room.name,
      },
    }).catch(() => {}).finally(() => { try { supabase.removeChannel(pingCh); } catch {} });
    setInvited(i => ({ ...i, [friend.id]: "sent" }));
  }

  return (
    <div style={S.modalOverlay}>
      <div style={{ ...S.modalCard, maxWidth:"360px" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"18px" }}>
          <h2 style={{ fontSize:"18px", fontWeight:"700", color:"var(--text-primary)" }}>Invite friends</h2>
          <button onClick={onClose} style={{ background:"none", border:"none", color:"var(--text-dim)", fontSize:"18px", cursor:"pointer", padding:"0 4px" }}>×</button>
        </div>
        {friends === null ? (
          <p style={{ color:"var(--text-dim)", fontSize:"13px", textAlign:"center", padding:"24px 0" }}>Loading friends…</p>
        ) : friends.length === 0 ? (
          <div style={{ textAlign:"center", padding:"24px 0" }}>
            <p style={{ color:"var(--text-secondary)", fontSize:"14px", marginBottom:"6px" }}>No friends yet</p>
            <p style={{ color:"var(--text-dim)", fontSize:"12px" }}>Add friends from your Identity page.</p>
          </div>
        ) : (
          <div style={{ display:"flex", flexDirection:"column", gap:"8px", maxHeight:"320px", overflowY:"auto" }}>
            {friends.map(f => {
              const status = invited[f.id];
              return (
                <div key={f.id} style={{ display:"flex", alignItems:"center", gap:"12px", padding:"10px 4px" }}>
                  <div style={{
                    width:34, height:34, borderRadius:"50%", flexShrink:0,
                    background:"rgba(var(--gold-rgb), 0.12)", color:"var(--color-accent)",
                    fontWeight:"700", fontSize:"13px",
                    display:"flex", alignItems:"center", justifyContent:"center",
                  }}>
                    {f.name?.[0]?.toUpperCase() ?? "?"}
                  </div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <p style={{ fontWeight:"500", fontSize:"14px", color:"var(--text-primary)" }}>{f.name}</p>
                    <p style={{ fontSize:"11px", color:"var(--text-dim)", marginTop:"2px" }}>{f.email}</p>
                  </div>
                  <button
                    onClick={() => handleInvite(f)}
                    disabled={!!status}
                    style={{ ...S.accentBtn, padding:"6px 14px", fontSize:"12px", opacity: status ? 0.5 : 1, cursor: status ? "default" : "pointer" }}
                  >
                    {status === "sent" ? <span style={{ display:"inline-flex", alignItems:"center", gap:4 }}>Invited<Check size={13} /></span> : status === "limited" ? "Limit reached" : status === "sending" ? "…" : "Invite"}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ChatPanel — persisted room chat, WhatsApp-style
// ─────────────────────────────────────────────────────────────────────────────
function ChatPanel({ messages, myUserId, input, sending, imageUploading, onInputChange, onSend, onImageUpload, onClose }: {
  messages: ChatMessage[]; myUserId: string;
  input: string; sending: boolean; imageUploading?: boolean;
  onInputChange: (v: string) => void; onSend: () => void;
  onImageUpload?: (file: File) => void; onClose: () => void;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  function isImageMsg(body: string) { return body.startsWith("[img]"); }
  function getImageUrl(body: string) { return body.slice(5); }

  return (
    <div style={{
      border: "1px solid rgba(127,174,110,0.2)",
      borderRadius: "14px",
      background: "rgba(127,174,110,0.03)",
      marginBottom: "20px",
      overflow: "hidden",
    }}>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "12px 16px",
        borderBottom: "1px solid rgba(127,174,110,0.12)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ display: "flex", color: "#7fae6e" }}><MessageCircle size={15} /></span>
          <span style={{ fontSize: "13px", fontWeight: "600", color: "#7fae6e" }}>Room Chat</span>
          <span style={{ fontSize: "11px", color: "var(--text-dim)", background: "rgba(255,255,255,0.05)", borderRadius: "6px", padding: "2px 7px" }}>
            persists across refresh
          </span>
        </div>
        <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-dim)", fontSize: "18px", cursor: "pointer", lineHeight: 1, padding: "0 2px" }}>×</button>
      </div>

      {/* Message list */}
      <div style={{ height: "320px", overflowY: "auto", padding: "12px 16px", display: "flex", flexDirection: "column", gap: "10px" }}>
        {messages.length === 0 ? (
          <div style={{ margin: "auto 0", textAlign: "center" }}>
            <p style={{ fontSize: "13px", color: "var(--text-dim)", lineHeight: 1.5 }}>
              No messages yet — say hello!<br />
              <span style={{ fontSize: "11px", opacity: 0.6 }}>History stays even after a refresh.</span>
            </p>
          </div>
        ) : (
          messages.map(msg => {
            const isMe = msg.user_id === myUserId;
            const isImg = isImageMsg(msg.body);
            return (
              <div key={msg.id} style={{ display: "flex", flexDirection: "column", alignItems: isMe ? "flex-end" : "flex-start" }}>
                {!isMe && (
                  <span style={{ fontSize: "10px", color: "var(--text-dim)", marginBottom: "3px", paddingLeft: "4px" }}>
                    {msg.name}
                  </span>
                )}
                <div style={{
                  maxWidth: "78%",
                  padding: isImg ? "4px" : "8px 12px",
                  wordBreak: "break-word",
                  borderRadius: isMe ? "12px 12px 3px 12px" : "12px 12px 12px 3px",
                  background: isMe ? "rgba(var(--gold-rgb), 0.14)" : "rgba(255,255,255,0.06)",
                  border: `1px solid ${isMe ? "rgba(var(--gold-rgb), 0.22)" : "rgba(255,255,255,0.09)"}`,
                  fontSize: "13px", color: "var(--text-primary)", lineHeight: 1.5,
                  overflow: "hidden",
                }}>
                  {isImg ? (
                    <a href={getImageUrl(msg.body)} target="_blank" rel="noopener noreferrer">
                      <img
                        src={getImageUrl(msg.body)}
                        alt="shared image"
                        style={{ display: "block", maxWidth: "100%", maxHeight: "240px", borderRadius: "8px", cursor: "zoom-in" }}
                        onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                      />
                    </a>
                  ) : msg.body}
                </div>
                <span style={{ fontSize: "10px", color: "var(--text-dim)", marginTop: "2px", paddingRight: isMe ? "2px" : 0, paddingLeft: isMe ? 0 : "4px" }}>
                  {new Date(msg.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
            );
          })
        )}
        <div ref={endRef} />
      </div>

      {/* Input */}
      <div style={{ borderTop: "1px solid rgba(127,174,110,0.12)", padding: "10px 12px", display: "flex", gap: "8px", alignItems: "center" }}>
        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={e => {
            const file = e.target.files?.[0];
            if (file) onImageUpload?.(file);
            e.target.value = "";
          }}
        />
        {/* Image upload button */}
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={imageUploading}
          title="Send image"
          style={{
            background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.09)",
            borderRadius: "9px", padding: "9px 11px", fontSize: "15px", lineHeight: 1,
            cursor: imageUploading ? "default" : "pointer", flexShrink: 0,
            opacity: imageUploading ? 0.5 : 0.8, transition: "opacity 0.15s",
          }}
        >
          {imageUploading ? <Hourglass size={15} /> : <ImageIcon size={15} />}
        </button>
        <input
          value={input}
          onChange={e => onInputChange(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSend(); } }}
          placeholder="Message the room…"
          maxLength={2000}
          style={{
            flex: 1, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.09)",
            borderRadius: "9px", padding: "9px 12px", fontSize: "13px",
            color: "var(--text-primary)", outline: "none", fontFamily: "inherit",
            transition: "border-color 0.15s",
          }}
          onFocus={e => (e.target.style.borderColor = "rgba(127,174,110,0.35)")}
          onBlur={e  => (e.target.style.borderColor = "rgba(255,255,255,0.09)")}
        />
        <button
          onClick={onSend}
          disabled={!input.trim() || sending}
          style={{
            background: "rgba(127,174,110,0.12)", color: "#7fae6e",
            border: "1px solid rgba(127,174,110,0.28)", borderRadius: "9px",
            padding: "9px 16px", fontSize: "13px", fontWeight: "600",
            cursor: (!input.trim() || sending) ? "default" : "pointer",
            fontFamily: "inherit", flexShrink: 0,
            opacity: (!input.trim() || sending) ? 0.4 : 1,
          }}
        >
          {sending ? "…" : "Send →"}
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// RemoteAudio — hidden <audio> sink for one peer's P2P voice stream. srcObject can't
// be set as a JSX prop, so it's assigned via ref; `muted` follows the speaker toggle.
// ─────────────────────────────────────────────────────────────────────────────
function RemoteAudio({ stream, muted }: { stream: MediaStream; muted: boolean }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el && el.srcObject !== stream) { el.srcObject = stream; el.play?.().catch(() => {}); }
  }, [stream]);
  useEffect(() => { if (ref.current) ref.current.muted = muted; }, [muted]);
  return <audio ref={ref} autoPlay playsInline style={{ display: "none" }} />;
}

// ─────────────────────────────────────────────────────────────────────────────
// MemberCard
// ─────────────────────────────────────────────────────────────────────────────
function MemberCard({ member, isMe, isSpeaking = false, handRaised = false }) {
  const elapsed = Math.max(0, Math.floor((Date.now() - member.joinedAt) / 1000));
  const h = Math.floor(elapsed / 3600);
  const m = Math.floor((elapsed % 3600) / 60);
  const s = elapsed % 60;
  const time = h > 0
    ? `${h}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`
    : `${m}:${String(s).padStart(2,"0")}`;

  const COLORS = [
    { bg:"rgba(var(--gold-rgb), 0.15)",  fg: GOLD },
    { bg:"rgba(111,179,196,0.15)", fg:"#6fb3c4" },
    { bg:"rgba(127,174,110,0.15)", fg:"#7fae6e" },
    { bg:"rgba(196,100,100,0.15)", fg:"#d47878" },
    { bg:"rgba(160,110,196,0.15)", fg:"#b888e0" },
  ];
  const col = COLORS[(member.initial?.charCodeAt(0) ?? 0) % COLORS.length];

  return (
    <div style={{
      background:"var(--color-surface)",
      border:`1px solid ${isMe ? "rgba(var(--gold-rgb), 0.22)" : "var(--color-border)"}`,
      borderRadius:"var(--radius-card)", boxShadow: isMe ? "var(--depth-line)" : "none",
      padding:"14px 16px", display:"flex", alignItems:"center", gap:"14px",
    }}>
      <div style={{
        width:40, height:40, borderRadius:"50%", flexShrink:0,
        background:col.bg, color: isSpeaking ? "#4ade80" : col.fg, fontWeight:"700", fontSize:"15px",
        display:"flex", alignItems:"center", justifyContent:"center",
        border: isSpeaking ? "1.5px solid rgba(74,222,128,0.8)" : `1.5px solid ${col.fg}30`,
        boxShadow: isSpeaking ? "0 0 0 3px rgba(74,222,128,0.2)" : "none",
        position:"relative",
        transition: "border-color 0.2s, box-shadow 0.2s",
      }}>
        {member.initial}
        <div style={{ position:"absolute", bottom:0, right:0, width:10, height:10, borderRadius:"50%", background:"#7fae6e", border:"2px solid var(--color-surface)" }}/>
      </div>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ display:"flex", alignItems:"center", gap:"8px" }}>
          <span style={{ fontWeight:"600", fontSize:"14px", color:"var(--text-primary)" }}>{member.name}</span>
          {isMe && <span style={{ fontSize:"10px", color:"var(--text-dim)", background:"rgba(255,255,255,0.06)", borderRadius:"8px", padding:"2px 7px" }}>you</span>}
          {isSpeaking && (
            <span style={{ display:"inline-flex", alignItems:"flex-end", gap:"2px", height:"14px", marginLeft:"2px" }}>
              <style>{`@keyframes mc-bar{from{transform:scaleY(0.25)}to{transform:scaleY(1)}}`}</style>
              {[0, 0.18, 0.09].map((delay, i) => (
                <span key={i} style={{
                  display:"block", width:"3px", height:"12px", background:"#4ade80", borderRadius:"2px",
                  transformOrigin:"bottom", animation:`mc-bar 0.55s ease-in-out ${delay}s infinite alternate`,
                }} />
              ))}
            </span>
          )}
          {handRaised && (
            <span title="Hand raised" style={{ display:"inline-flex", marginLeft:"2px" }}><Hand size={14} /></span>
          )}
        </div>
        <p style={{
          fontSize:"12px", marginTop:"3px",
          color: member.workingOn ? "var(--text-secondary)" : "var(--text-dim)",
          fontStyle: member.workingOn ? "normal" : "italic",
          overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
        }}>
          {member.workingOn || "not set"}
        </p>
      </div>
      <div style={{ textAlign:"right", flexShrink:0 }}>
        <p style={{ fontSize:"14px", fontWeight:"700", color: elapsed >= 3600 ? "#f59e0b" : elapsed >= 1800 ? "var(--gold)" : "var(--color-accent)", fontVariantNumeric:"tabular-nums" }}>{time}</p>
        <p style={{ fontSize:"10px", color:"var(--text-dim)", marginTop:"2px" }}>
          {elapsed >= 3600
            ? <span style={{ display:"inline-flex", alignItems:"center", gap:4 }}><Flame size={11} />focused</span>
            : elapsed >= 1800
            ? <span style={{ display:"inline-flex", alignItems:"center", gap:4 }}><Zap size={11} />focused</span>
            : "focused"}
        </p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared styles
// ─────────────────────────────────────────────────────────────────────────────
const styles: Record<string, React.CSSProperties> = {
  sectionLabel:   { fontSize:"11px", color:"var(--text-dim)", letterSpacing:"2px", textTransform:"uppercase", marginBottom:"6px" },
  pageTitle:      { fontSize:"26px", fontWeight:"600", color:"var(--text-primary)", letterSpacing:"-0.3px", fontFamily:"var(--font-sans)" },
  card:           { background:"var(--color-surface)", border:"1px solid var(--color-border)", borderRadius:"var(--radius-card)", boxShadow:"var(--depth-line)", padding:"16px 18px", display:"flex", alignItems:"center", gap:"14px" },
  emptyState:     { background:"var(--color-surface)", border:"1px solid var(--color-border)", borderRadius:"var(--radius-card)", padding:"32px 24px", textAlign:"center" },
  input:          { display:"block", width:"100%", background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:"10px", padding:"11px 14px", color:"var(--text-primary)", fontSize:"14px", outline:"none", fontFamily:"inherit", boxSizing:"border-box", marginTop:"6px", marginBottom:"14px", transition:"border-color 0.15s" },
  primaryBtn:     { background:"var(--color-accent)", color:"#111", border:"none", borderRadius:"var(--radius-btn)", padding:"11px 18px", fontSize:"14px", fontWeight:"600", cursor:"pointer", fontFamily:"inherit", flexShrink:0 },
  accentBtn:      { background:"rgba(var(--gold-rgb), 0.1)", color:"var(--color-accent)", border:"1px solid rgba(var(--gold-rgb), 0.28)", borderRadius:"8px", padding:"8px 18px", fontSize:"13px", fontWeight:"600", cursor:"pointer", fontFamily:"inherit", flexShrink:0 },
  ghostBtn:       { marginTop:"16px", background:"none", border:"1px solid rgba(255,255,255,0.09)", borderRadius:"8px", padding:"8px 16px", color:"var(--text-dim)", fontSize:"12px", cursor:"pointer", fontFamily:"inherit" },
  ghostBtnLarge:  { flex:1, background:"transparent", border:"1px solid rgba(255,255,255,0.1)", borderRadius:"10px", padding:"12px", color:"var(--text-dim)", fontSize:"14px", cursor:"pointer", fontFamily:"inherit" },
  primaryBtnLarge:{ flex:2, background:"var(--color-accent)", color:"#111", border:"none", borderRadius:"10px", padding:"12px", fontSize:"14px", fontWeight:"600", cursor:"pointer", fontFamily:"inherit" },
  leaveBtn:       { background:"rgba(255,59,48,0.1)", border:"1px solid rgba(255,59,48,0.22)", borderRadius:"8px", padding:"9px 16px", color:"rgba(255,100,90,0.9)", fontSize:"13px", fontWeight:"600", cursor:"pointer", fontFamily:"inherit", flexShrink:0 },
  modalOverlay:   { position:"fixed", top:0, left:0, right:0, bottom:0, zIndex:1000, background:"rgba(8,8,10,0.75)", backdropFilter:"blur(14px)", display:"flex", alignItems:"center", justifyContent:"center", padding:"24px" },
  modalCard:      { width:"100%", maxWidth:"400px", maxHeight:"calc(100dvh - 40px)", overflowY:"auto", background:"var(--color-surface)", border:"1px solid var(--color-border)", borderRadius:"20px", padding:"24px 22px", boxShadow:"0 32px 80px rgba(0,0,0,0.5)" },
  fieldLabel:     { fontSize:"12px", color:"var(--text-secondary)", fontWeight:"500" },
};

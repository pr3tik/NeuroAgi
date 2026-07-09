// NotificationPanel.tsx — iOS-quality notification dropdown.
// Framer Motion spring enter/exit, staggered items, solid ink surface.
// BUG FIX: accept/decline persists via data.actioned field in DB (survives reopen).
import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { UserPlus, Check, MessageCircle, DoorOpen, ClipboardList, Trophy, TrendingUp, Brain, Bell } from "lucide-react";
import {
  AppNotification,
  fetchNotifications,
  markNotificationsRead,
  markAllNotificationsRead,
  updateNotificationAction,
  markProactiveOpened,
  markProactiveActioned,
} from "../api/notifications";

// Effectiveness feedback (§3.5.4): proactive notifications carry data.queue_id.
const queueId = (n: AppNotification): string | undefined => n.data?.queue_id as string | undefined;

// ── Relative time (concise, iOS-style) ───────────────────────────────────────
function relativeTime(iso: string): string {
  const sec = (Date.now() - new Date(iso).getTime()) / 1000;
  if (sec < 60)    return "now";
  if (sec < 3600)  return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  return `${Math.floor(sec / 86400)}d`;
}

// ── Avatar color palette ──────────────────────────────────────────────────────
const AVATAR_PALETTE = [
  { bg: "rgba(196,154,60,0.18)",  fg: "#C49A3C" },
  { bg: "rgba(111,179,196,0.18)", fg: "#6fb3c4" },
  { bg: "rgba(127,174,110,0.18)", fg: "#7fae6e" },
  { bg: "rgba(196,100,100,0.18)", fg: "#d47878" },
  { bg: "rgba(160,110,196,0.18)", fg: "#b888e0" },
];
function avatarColor(key: string) {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return AVATAR_PALETTE[Math.abs(h) % AVATAR_PALETTE.length];
}

// ── Type config ───────────────────────────────────────────────────────────────
const TYPE_CFG: Record<string, { icon: any; defaultTitle: string; useAvatar: boolean }> = {
  friend_request:   { icon: UserPlus,       defaultTitle: "Friend request",     useAvatar: true  },
  request_accepted: { icon: Check,          defaultTitle: "Now connected",       useAvatar: true  },
  nudge:            { icon: MessageCircle,  defaultTitle: "Study nudge",         useAvatar: false },
  room_invite:      { icon: DoorOpen,       defaultTitle: "Room invite",         useAvatar: false },
  assignment_due:   { icon: ClipboardList,  defaultTitle: "Assignment due soon", useAvatar: false },
  milestone:        { icon: Trophy,         defaultTitle: "Milestone reached",   useAvatar: false },
  ranking:          { icon: TrendingUp,     defaultTitle: "Leaderboard update",  useAvatar: false },
  intervention:     { icon: Brain,          defaultTitle: "A nudge from Reggie",  useAvatar: false },
};

// ── Friends API adapter ───────────────────────────────────────────────────────
async function respondFriendRequest(userId: string, fromUserId: string, accept: boolean) {
  try {
    const { respondFriendRequest: fn } = await import("../api/friends.js");
    await fn(userId, fromUserId, accept);
  } catch {
    console.warn("[notifs] respondFriendRequest not available");
  }
}

// ── Section header ────────────────────────────────────────────────────────────
function SectionLabel({ label }: { label: string }) {
  return (
    <div style={{
      padding: "10px 16px 5px",
      fontSize: "10px",
      fontWeight: "700",
      letterSpacing: "0.7px",
      textTransform: "uppercase",
      color: "rgba(255,255,255,0.22)",
      userSelect: "none",
    }}>
      {label}
    </div>
  );
}

// ── NotificationItem ──────────────────────────────────────────────────────────
function NotificationItem({
  n,
  index,
  isLast,
  onAction,
  seenKey,
  onSeen,
}: {
  n: AppNotification;
  index: number;
  isLast: boolean;
  onAction: (action: string, n: AppNotification) => void;
  seenKey?: string;                       // notification_queue id, if this is a proactive notif
  onSeen?: (key: string) => void;         // called once the row is actually scrolled into view
}) {
  const reduced = useReducedMotion();
  const itemRef = useRef<HTMLDivElement>(null);
  const cfg = TYPE_CFG[n.type] ?? { icon: Bell, defaultTitle: "Notification", useAvatar: false };
  const title = n.title ?? cfg.defaultTitle;
  const isUnread = !n.read;
  const fromName = n.data?.from_name as string | undefined;
  const actioned = n.data?.actioned as string | undefined;
  const col = avatarColor(fromName ?? n.data?.from_user_id as string ?? n.id);
  const initial = (fromName?.[0] ?? "?").toUpperCase();

  // Effectiveness feedback: report a proactive notif as SEEN only once it actually
  // intersects the viewport — so items below the fold aren't counted as opened. Falls
  // back to an immediate report where IntersectionObserver is unavailable.
  useEffect(() => {
    if (!seenKey || !onSeen) return;
    const el = itemRef.current;
    if (!el || typeof IntersectionObserver === "undefined") { onSeen(seenKey); return; }
    const io = new IntersectionObserver(
      entries => { if (entries.some(e => e.isIntersecting)) { onSeen(seenKey); io.disconnect(); } },
      { threshold: 0.5 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [seenKey, onSeen]);

  return (
    <motion.div
      ref={itemRef}
      initial={{ opacity: 0, y: reduced ? 0 : 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reduced ? { duration: 0.01 } : { delay: index * 0.025, duration: 0.18, ease: [0, 0, 0.2, 1] }}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: "10px",
        padding: "11px 16px 11px 14px",
        borderBottom: isLast ? "none" : "1px solid rgba(255,255,255,0.04)",
      }}
    >
      {/* Leading unread dot — 6px, gold when unread, invisible when read */}
      <div style={{
        width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
        marginTop: 15,            // visually centers with 36px avatar
        background: isUnread ? "#C49A3C" : "transparent",
        transition: "background 0.2s",
      }} />

      {/* Avatar — ring reinforces unread status */}
      <div style={{
        width: 36, height: 36, borderRadius: "50%", flexShrink: 0,
        background: cfg.useAvatar ? col.bg : "rgba(255,255,255,0.07)",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: cfg.useAvatar ? "14px" : "16px",
        fontWeight: cfg.useAvatar ? "700" : "normal",
        color: cfg.useAvatar ? col.fg : "rgba(255,255,255,0.55)",
        boxShadow: isUnread ? `0 0 0 1.5px rgba(196,154,60,0.45)` : "none",
        transition: "box-shadow 0.2s",
      }}>
        {cfg.useAvatar && fromName ? initial : <cfg.icon size={17} />}
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Title + time row */}
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "8px" }}>
          <p style={{
            fontSize: "13px",
            fontWeight: isUnread ? "600" : "500",
            color: isUnread ? "#F5F5F5" : "rgba(255,255,255,0.65)",
            lineHeight: "1.35",
            flex: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            margin: 0,
          }}>
            {title}
          </p>
          <span style={{
            fontSize: "11px",
            color: "rgba(255,255,255,0.25)",
            flexShrink: 0,
            letterSpacing: "0.1px",
          }}>
            {relativeTime(n.created_at)}
          </span>
        </div>

        {/* Body */}
        {n.body && (
          <p style={{
            fontSize: "12px",
            color: "rgba(255,255,255,0.38)",
            lineHeight: "1.5",
            marginTop: "2px",
            marginBottom: 0,
          }}>
            {n.body}
          </p>
        )}

        {/* Action buttons — only when friend_request and not yet actioned */}
        {n.type === "friend_request" && n.data?.from_user_id && !actioned && (
          <div style={{ display: "flex", gap: "6px", marginTop: "8px" }}>
            <button
              onClick={() => onAction("accept_friend", n)}
              style={{
                fontSize: "11px", padding: "4px 12px", borderRadius: "6px",
                cursor: "pointer", fontFamily: "inherit", fontWeight: "600",
                background: "rgba(196,154,60,0.14)", color: "#C49A3C",
                border: "1px solid rgba(196,154,60,0.28)",
                transition: "background 0.12s",
              }}
              onMouseEnter={e => (e.currentTarget.style.background = "rgba(196,154,60,0.22)")}
              onMouseLeave={e => (e.currentTarget.style.background = "rgba(196,154,60,0.14)")}
            >
              Accept
            </button>
            <button
              onClick={() => onAction("decline_friend", n)}
              style={{
                fontSize: "11px", padding: "4px 10px", borderRadius: "6px",
                cursor: "pointer", fontFamily: "inherit",
                background: "none", color: "rgba(255,255,255,0.35)",
                border: "1px solid rgba(255,255,255,0.1)",
                transition: "background 0.12s",
              }}
              onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.06)")}
              onMouseLeave={e => (e.currentTarget.style.background = "none")}
            >
              Decline
            </button>
          </div>
        )}

        {/* Resolved states — shown after accept/decline, survive reopen via DB */}
        {n.type === "friend_request" && actioned === "accepted" && (
          <p style={{ marginTop: "6px", fontSize: "11px", color: "rgba(127,174,110,0.75)", fontWeight: "500", letterSpacing: "0.1px" }}>
            <Check size={12} style={{ verticalAlign:"-2px", marginRight:4 }} />Accepted
          </p>
        )}
        {n.type === "friend_request" && actioned === "declined" && (
          <p style={{ marginTop: "6px", fontSize: "11px", color: "rgba(255,255,255,0.22)" }}>
            Declined
          </p>
        )}

        {/* Join room — nudge / room invite */}
        {(n.type === "nudge" || n.type === "room_invite") && n.data?.room_id && (
          <button
            onClick={() => onAction("open_room", n)}
            style={{
              marginTop: "8px",
              fontSize: "11px", padding: "4px 10px", borderRadius: "6px",
              cursor: "pointer", fontFamily: "inherit",
              background: "rgba(196,154,60,0.08)", color: "#C49A3C",
              border: "1px solid rgba(196,154,60,0.18)",
              transition: "background 0.12s",
            }}
            onMouseEnter={e => (e.currentTarget.style.background = "rgba(196,154,60,0.15)")}
            onMouseLeave={e => (e.currentTarget.style.background = "rgba(196,154,60,0.08)")}
          >
            Join room →
          </button>
        )}

        {/* View assignment */}
        {n.type === "assignment_due" && (
          <button
            onClick={() => onAction("open_assignment", n)}
            style={{
              marginTop: "8px",
              fontSize: "11px", padding: "4px 10px", borderRadius: "6px",
              cursor: "pointer", fontFamily: "inherit",
              background: "none", color: "rgba(255,255,255,0.35)",
              border: "1px solid rgba(255,255,255,0.1)",
              transition: "background 0.12s",
            }}
            onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.06)")}
            onMouseLeave={e => (e.currentTarget.style.background = "none")}
          >
            View →
          </button>
        )}
      </div>
    </motion.div>
  );
}

// ── NotificationPanel ─────────────────────────────────────────────────────────
interface Props {
  userId: string;
  liveNotifs: AppNotification[];
  onClose: () => void;
  onNavigate: (page: string) => void;
  onUnreadChange: (count: number) => void;
}

export default function NotificationPanel({
  userId,
  liveNotifs,
  onClose,
  onNavigate,
  onUnreadChange,
}: Props) {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const panelRef = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  // Effectiveness feedback: stamp each proactive notification's opened_at exactly once,
  // when it scrolls into view (NotificationItem reports via onSeen). markNotificationsRead
  // (the bell badge) stays panel-open-based; only the "seen" signal is viewport-gated.
  const seen = useRef<Set<string>>(new Set());
  const markSeen = useCallback((q: string) => {
    if (seen.current.has(q)) return;
    seen.current.add(q);
    markProactiveOpened(q);
  }, []);

  // Load on open
  useEffect(() => {
    fetchNotifications(userId).then(data => {
      setItems(data);
      setLoading(false);
      const unread = data.filter(n => !n.read);
      // opened_at is now stamped per-item when each row scrolls into view (see
      // NotificationItem + markSeen); read-state below stays panel-open-based.
      if (unread.length) {
        markNotificationsRead(unread.map(n => n.id)).then(() => {
          onUnreadChange(0);
          setItems(prev => prev.map(n => ({ ...n, read: true })));
        });
      }
    });
  }, []); // eslint-disable-line

  // Merge live notifications (panel is open — mark read immediately)
  useEffect(() => {
    if (!liveNotifs.length) return;
    setItems(prev => {
      const existing = new Set(prev.map(n => n.id));
      const fresh = liveNotifs.filter(n => !existing.has(n.id));
      if (!fresh.length) return prev;
      markNotificationsRead(fresh.map(n => n.id));   // opened_at handled per-item on view
      return [...fresh.map(n => ({ ...n, read: true })), ...prev];
    });
  }, [liveNotifs]);

  // Close on click outside
  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [onClose]);

  async function handleMarkAllRead() {
    await markAllNotificationsRead(userId);
    setItems(prev => prev.map(n => ({ ...n, read: true })));
    onUnreadChange(0);
  }

  async function handleAction(action: string, n: AppNotification) {
    const q = queueId(n);
    if (q) markProactiveActioned(q);   // any tapped action = engagement (§3.5.4)
    if (action === "accept_friend" && n.data?.from_user_id) {
      // 1. Optimistic update — hides buttons immediately, prevents double-tap
      setItems(prev => prev.map(item =>
        item.id === n.id
          ? { ...item, read: true, data: { ...(item.data ?? {}), actioned: "accepted" } }
          : item
      ));
      // 2. Persist actioned state to DB (survives close+reopen)
      await updateNotificationAction(n.id, n.data, "accepted");
      // 3. Accept via friends API
      await respondFriendRequest(userId, n.data.from_user_id as string, true);

    } else if (action === "decline_friend" && n.data?.from_user_id) {
      // 1. Optimistic update
      setItems(prev => prev.map(item =>
        item.id === n.id
          ? { ...item, read: true, data: { ...(item.data ?? {}), actioned: "declined" } }
          : item
      ));
      // 2. Persist
      await updateNotificationAction(n.id, n.data, "declined");
      // 3. Decline via friends API
      await respondFriendRequest(userId, n.data.from_user_id as string, false);

    } else if (action === "open_room") {
      onNavigate("rooms");
      onClose();
    } else if (action === "open_assignment") {
      onNavigate("assignment");
      onClose();
    }
  }

  const hasUnread = items.some(n => !n.read);

  // Grouping: separate unread ("New") from read ("Earlier")
  const unread = items.filter(n => !n.read);
  const read   = items.filter(n => n.read);
  const showSections = unread.length > 0 && read.length > 0;

  return (
    <motion.div
      ref={panelRef as React.Ref<HTMLDivElement>}
      initial={{ opacity: 0, scale: reduced ? 1 : 0.96, y: reduced ? 0 : -8 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: reduced ? 1 : 0.97, y: reduced ? 0 : -5 }}
      transition={reduced ? { duration: 0.01 } : { type: "spring", stiffness: 420, damping: 30, mass: 0.8 }}
      style={{
        transformOrigin: "top right",
        position: "fixed",
        top: "82px",
        right: "16px",
        width: "min(calc(100vw - 32px), 380px)",
        maxHeight: "min(520px, calc(100dvh - 100px))",
        background: "#1a1a1d",
        border: "1px solid rgba(255,255,255,0.09)",
        borderRadius: "18px",
        boxShadow: [
          "inset 0 1px 0 rgba(255,255,255,0.06)",
          "0 4px 24px rgba(0,0,0,0.45)",
          "0 20px 60px rgba(0,0,0,0.38)",
        ].join(", "),
        zIndex: 9999,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* Panel header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "15px 16px 14px",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        flexShrink: 0,
      }}>
        <span style={{
          fontSize: "16px", fontWeight: "600",
          color: "#F5F5F5",
          fontFamily: "var(--font-sans)",
          letterSpacing: "-0.1px",
        }}>
          Notifications
        </span>
        {hasUnread && (
          <button
            onClick={handleMarkAllRead}
            style={{
              fontSize: "12px", color: "#C49A3C",
              background: "none", border: "none",
              cursor: "pointer", fontFamily: "inherit",
              padding: "2px 4px", opacity: 0.85,
              transition: "opacity 0.12s",
            }}
            onMouseEnter={e => (e.currentTarget.style.opacity = "1")}
            onMouseLeave={e => (e.currentTarget.style.opacity = "0.85")}
          >
            Mark all read
          </button>
        )}
      </div>

      {/* Scrollable list */}
      <div style={{ overflowY: "auto", flex: 1 }}>
        {loading ? (
          // Skeleton — three rows at varying widths
          <div style={{ padding: "6px 0" }}>
            {[0.72, 0.55, 0.64].map((w, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "11px 16px 11px 14px" }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: "rgba(255,255,255,0.04)", flexShrink: 0 }} />
                <div style={{ width: 36, height: 36, borderRadius: "50%", background: "rgba(255,255,255,0.06)", flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ height: 11, borderRadius: 6, background: "rgba(255,255,255,0.07)", marginBottom: 6, width: `${w * 100}%` }} />
                  <div style={{ height: 9, borderRadius: 5, background: "rgba(255,255,255,0.04)", width: "48%" }} />
                </div>
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          // Empty state
          <div style={{ padding: "52px 24px 44px", textAlign: "center" }}>
            <div style={{
              width: 44, height: 44, borderRadius: "50%",
              background: "rgba(255,255,255,0.05)",
              display: "flex", alignItems: "center", justifyContent: "center",
              margin: "0 auto 14px",
            }}>
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none"
                stroke="rgba(255,255,255,0.2)" strokeWidth="1.5"
                strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
              </svg>
            </div>
            <p style={{ fontSize: "14px", fontWeight: "500", color: "rgba(255,255,255,0.5)", marginBottom: "4px" }}>
              You're all caught up
            </p>
            <p style={{ fontSize: "12px", color: "rgba(255,255,255,0.22)", lineHeight: "1.55" }}>
              Notifications appear here when<br/>something needs your attention.
            </p>
          </div>
        ) : (
          <>
            {/* Unread group */}
            {showSections && unread.length > 0 && <SectionLabel label="New" />}
            {unread.map((n, i) => (
              <NotificationItem
                key={n.id}
                n={n}
                index={i}
                isLast={i === unread.length - 1 && !showSections}
                onAction={handleAction}
                seenKey={queueId(n)}
                onSeen={markSeen}
              />
            ))}

            {/* Read group */}
            {showSections && read.length > 0 && (
              <div style={{ borderTop: "1px solid rgba(255,255,255,0.05)", marginTop: "2px" }}>
                <SectionLabel label="Earlier" />
              </div>
            )}
            {read.map((n, i) => (
              <NotificationItem
                key={n.id}
                n={n}
                index={unread.length + i}
                isLast={i === read.length - 1}
                onAction={handleAction}
                seenKey={queueId(n)}
                onSeen={markSeen}
              />
            ))}
          </>
        )}
      </div>
    </motion.div>
  );
}

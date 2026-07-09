// TokenToast.jsx — Small bottom-centre toast for token awards.
// Queues awards and shows them 1 at a time, 2.5s each.
// prefers-reduced-motion: instant appear/hide, no slide.

import { useEffect, useRef, useState } from "react";
import { onTokenAwarded } from "../api/tokens";
import { Landmark, Zap, Brain } from "lucide-react";

const ACTION_LABELS = {
  daily_login:          "Daily login",
  canvas_sync:          "Canvas synced",
  flashcards_generated: "Flashcards generated",
  quiz_completed:       "Quiz completed",
  quiz_perfect:         "Perfect score",
  assignment_submitted: "Assignment done",
  discord_connected:    "Discord connected",
  streak_day:           "Streak extended",
  streak_milestone:     "Streak milestone",
};

const TIER_ICON = { Scholar: Landmark, Mastermind: Zap, "Brain Owner": Brain };

export default function TokenToast() {
  const [queue,   setQueue]   = useState([]);
  const [current, setCurrent] = useState(null);
  const [visible, setVisible] = useState(false);

  // Timer refs — stored in refs so queue changes don't cancel running timers
  const hideTimerRef  = useRef(null);
  const clearTimerRef = useRef(null);

  useEffect(() => {
    const unsub = onTokenAwarded(data => {
      setQueue(q => [...q, { ...data, _id: Date.now() + Math.random() }]);
    });
    return () => { unsub(); };
  }, []);

  // Dequeue: only fires when we have queue items and no active toast
  useEffect(() => {
    if (current || queue.length === 0) return;
    const [next, ...rest] = queue;
    setQueue(rest);
    setCurrent(next);
  }, [queue, current]);

  // Dismiss timer: only fires when `current` changes to a new value
  useEffect(() => {
    if (!current) {
      setVisible(false);
      return;
    }
    // Small delay before showing so CSS transition has a start point
    requestAnimationFrame(() => requestAnimationFrame(() => setVisible(true)));

    hideTimerRef.current  = setTimeout(() => setVisible(false), 2200);
    clearTimerRef.current = setTimeout(() => setCurrent(null),   2700);

    return () => {
      clearTimeout(hideTimerRef.current);
      clearTimeout(clearTimerRef.current);
    };
  }, [current]); // queue intentionally NOT in deps — timers must survive queue updates

  if (!current) return null;

  const label = current.tierUp
    ? `Tier up — ${current.tier}`
    : (ACTION_LABELS[current.action] ?? current.action);
  const TierIcon = current.tierUp ? TIER_ICON[current.tier] : null;

  return (
    <div
      aria-live="polite"
      style={{
        position:  "fixed",
        bottom:    "calc(env(safe-area-inset-bottom, 0px) + 88px)",
        left:      "50%",
        transform: `translateX(-50%) translateY(${visible ? "0" : "14px"})`,
        zIndex:    99999,
        background: "#1a1814",
        border:    "1px solid rgba(196,154,60,0.38)",
        borderRadius: "12px",
        padding:   "9px 16px",
        display:   "flex",
        alignItems: "center",
        gap:       "9px",
        boxShadow: "0 6px 28px rgba(0,0,0,0.5)",
        opacity:   visible ? 1 : 0,
        transition: "opacity 0.28s ease, transform 0.28s cubic-bezier(0.22,1,0.36,1)",
        pointerEvents: "none",
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ color: "#C49A3C", fontSize: "13px", fontWeight: "700", letterSpacing: "-0.2px" }}>
        +{current.tokens}
      </span>
      <span style={{ color: "rgba(246,242,233,0.72)", fontSize: "12px" }}>
        {label}
      </span>
      {TierIcon && <TierIcon size={13} style={{ color: "#C49A3C", flexShrink: 0 }} />}
      {current.milestone && (
        <span style={{ color: "rgba(196,154,60,0.55)", fontSize: "11px", marginLeft: "2px" }}>
          · {current.milestone}d
        </span>
      )}
    </div>
  );
}

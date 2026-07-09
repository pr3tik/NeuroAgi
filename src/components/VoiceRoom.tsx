import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import DailyIframe from "@daily-co/daily-js";
import { Mic, Headphones, Hand, Lightbulb, Circle, Square, Minus } from "lucide-react";

type Status = "loading" | "ready" | "unavailable" | "error";

const POPUP_W    = 440;
const POPUP_H    = 540;
const POPUP_W_SM = 220;
const POPUP_H_SM = 44;

function defaultPos(w: number, h: number) {
  return {
    left: Math.max(0, w - POPUP_W - 100),
    top:  Math.max(0, h - POPUP_H - 120),
  };
}

function clamp(left: number, top: number, popW: number, popH: number) {
  return {
    left: Math.max(0, Math.min(window.innerWidth  - popW, left)),
    top:  Math.max(0, Math.min(window.innerHeight - popH, top)),
  };
}

export default function VoiceRoom({ roomId, userName, onClose, onSpeakingChange, handRaised = false, onToggleHand, forceMinimized = false }: {
  roomId: string;
  userName?: string;
  onClose: () => void;
  onSpeakingChange?: (name: string | null) => void;
  handRaised?: boolean;
  onToggleHand?: () => void;
  /** When true the panel collapses to the slim bar regardless of internal minimized state.
   *  Used by the parent to keep voice alive but out of the way when the whiteboard is open. */
  forceMinimized?: boolean;
}) {
  const [status, setStatus]       = useState<Status>("loading");
  const [url, setUrl]             = useState<string | null>(null);
  const [minimized, setMinimized] = useState(false);
  const [retryKey, setRetryKey]   = useState(0);

  const [pos, setPos]             = useState(() =>
    defaultPos(window.innerWidth, window.innerHeight)
  );
  const [isMobile, setIsMobile]   = useState(window.innerWidth < 600);

  const [pttActive, setPttActive] = useState(false);
  const [ncEnabled, setNcEnabled] = useState(true);
  const ncEnabledRef = useRef(true);
  const [connectionQuality, setConnectionQuality] = useState<"good" | "fair" | "poor" | "unknown">("unknown");
  const [showPttHint, setShowPttHint]  = useState(false);
  const pttHintShownRef = useRef(false);
  const callFrameRef = useRef<any>(null);

  const dragging   = useRef(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const popupRef   = useRef<HTMLDivElement>(null);
  const iframeRef  = useRef<HTMLIFrameElement>(null);

  // Declared before effects so closures in the resize/drag effects can see it without TDZ errors.
  const isMinimized = forceMinimized || minimized;

  useEffect(() => {
    const ctrl = new AbortController();
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/daily-room", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ roomId, userName: userName || undefined }),
          signal:  ctrl.signal,
        });
        if (!alive) return;
        if (res.status === 503) { setStatus("unavailable"); return; }
        if (!res.ok)            { setStatus("error"); return; }
        const data = await res.json();
        if (!alive) return;
        if (data?.url) { setUrl(data.url); /* status stays "loading" until frame.join() resolves */ }
        else           { setStatus("error"); }
      } catch (err: any) {
        if (err?.name === "AbortError" || !alive) return;
        setStatus("error");
      }
    })();
    return () => { alive = false; ctrl.abort(); };
  }, [roomId, retryKey]);

  // Correct Daily.co SDK pattern: wrap an empty iframe (no src), then call join() which
  // navigates the iframe to the room URL AND puts the SDK into "joined" state so that
  // setLocalAudio() actually works. Setting src directly in JSX bypasses the SDK join
  // flow, so setLocalAudio() would silently do nothing.
  //
  // We do NOT await the join() promise for status — the Daily prebuilt UI shows a
  // pre-join screen first ("Are you ready to join?") and the promise only resolves
  // after the user clicks through it. We clear the overlay immediately so the user
  // can see and interact with the Daily.co UI.
  useEffect(() => {
    if (!url || !iframeRef.current) return;
    const frame = DailyIframe.wrap(iframeRef.current);
    frame.join({ url, startVideoOff: true, startAudioOff: true }).catch(() => {});
    frame.on("joined-meeting", () => {
      if (ncEnabledRef.current) {
        frame.updateInputSettings({ audio: { processor: { type: "noise-cancellation" } } }).catch(() => {});
      }
      if (!pttHintShownRef.current) {
        pttHintShownRef.current = true;
        setShowPttHint(true);
        setTimeout(() => setShowPttHint(false), 3500);
      }
    });
    frame.on("active-speaker-change", (e: any) => {
      const peerId = e?.activeSpeaker?.peerId;
      if (!peerId) { onSpeakingChange?.(null); return; }
      const speaker = frame.participants()[peerId];
      onSpeakingChange?.(speaker?.user_name ?? null);
    });
    callFrameRef.current = frame;
    setStatus("ready");
    return () => {
      onSpeakingChange?.(null);
      callFrameRef.current = null;
      frame.leave().catch(() => {}).finally(() => { try { frame.destroy(); } catch {} });
    };
  }, [url]);

  // Push-to-talk: hold spacebar to unmute, release to mute.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.code !== "Space" || e.repeat) return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if ((e.target as HTMLElement).isContentEditable) return;
      e.preventDefault();
      callFrameRef.current?.setLocalAudio(true);
      setPttActive(true);
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.code !== "Space") return;
      callFrameRef.current?.setLocalAudio(false);
      setPttActive(false);
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup",   onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup",   onKeyUp);
    };
  }, []);

  useEffect(() => {
    const conn = (navigator as any).connection;
    if (!conn) return;
    function update() {
      const type = conn.effectiveType;
      setConnectionQuality(type === "4g" ? "good" : type === "3g" ? "fair" : "poor");
    }
    update();
    conn.addEventListener("change", update);
    return () => conn.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    function onResize() {
      setIsMobile(window.innerWidth < 600);
      setPos(p => {
        const pw = isMinimized ? POPUP_W_SM : POPUP_W;
        const ph = isMinimized ? POPUP_H_SM : POPUP_H;
        return clamp(p.left, p.top, pw, ph);
      });
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [isMinimized]);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!dragging.current) return;
      const pw = popupRef.current?.offsetWidth  ?? (isMinimized ? POPUP_W_SM : POPUP_W);
      const ph = popupRef.current?.offsetHeight ?? (isMinimized ? POPUP_H_SM : POPUP_H);
      setPos(clamp(
        e.clientX - dragOffset.current.x,
        e.clientY - dragOffset.current.y,
        pw, ph,
      ));
    }
    function onUp() { dragging.current = false; }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup",   onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup",   onUp);
    };
  }, [isMinimized]);

  function startDrag(e: React.MouseEvent) {
    dragging.current   = true;
    dragOffset.current = { x: e.clientX - pos.left, y: e.clientY - pos.top };
    e.preventDefault();
  }

  function toggleNC() {
    const next = !ncEnabledRef.current;
    ncEnabledRef.current = next;
    setNcEnabled(next);
    callFrameRef.current?.updateInputSettings({
      audio: { processor: { type: next ? "noise-cancellation" : "none" } },
    }).catch(() => {});
  }

  const ACCENT = "#60a5fa";

  const mobileCollapsed = isMobile && isMinimized;

  // ── Full popup (desktop) or expanded bottom sheet (mobile) ───────────────
  const popup = (
    <div
      ref={popupRef}
      style={isMobile ? {
        position:             "fixed",
        bottom:               0,
        left:                 0,
        right:                0,
        width:                "100%",
        zIndex:               1200,
        borderRadius:         "20px 20px 0 0",
        border:               "1px solid rgba(96,165,250,0.25)",
        borderBottom:         "none",
        background:           "rgba(10,10,14,0.97)",
        backdropFilter:       "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        boxShadow:            "0 -4px 40px rgba(0,0,0,0.6)",
        overflow:             "hidden",
        userSelect:           "none",
      } : {
        position:             "fixed",
        top:                  pos.top,
        left:                 pos.left,
        width:                isMinimized ? POPUP_W_SM : POPUP_W,
        zIndex:               1200,
        borderRadius:         isMinimized ? "32px" : "16px",
        border:               "1px solid rgba(96,165,250,0.25)",
        background:           "rgba(10,10,14,0.97)",
        backdropFilter:       "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        boxShadow:            "0 8px 40px rgba(0,0,0,0.6)",
        overflow:             "hidden",
        transition:           "width 0.2s ease, border-radius 0.2s ease",
        userSelect:           "none",
      }}
    >
      {/* Header */}
      <div
        onMouseDown={!isMobile ? startDrag : undefined}
        style={{
          display:        "flex",
          alignItems:     "center",
          justifyContent: "space-between",
          padding:        "12px 16px",
          borderBottom:   "1px solid rgba(96,165,250,0.12)",
          cursor:         isMobile ? "default" : (dragging.current ? "grabbing" : "grab"),
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {/* Live pulse dot — always visible so minimized bar shows call is active */}
          {status === "ready" && (
            <span style={{
              display: "inline-block", width: "8px", height: "8px", borderRadius: "50%", flexShrink: 0,
              background: "#4ade80", boxShadow: "0 0 6px #4ade80",
              animation: "vcPulse 1.8s ease-in-out infinite",
            }} />
          )}
          <span style={{ display: "flex", pointerEvents: "none", color: ACCENT }}><Mic size={14} /></span>
          <span style={{ fontSize: "13px", fontWeight: 600, color: ACCENT, pointerEvents: "none" }}>
            {isMinimized ? "Voice" : "Voice Chat"}
          </span>
          {status === "ready" && !isMinimized && (
            <button
              onPointerDown={e => {
                e.preventDefault();
                e.stopPropagation(); // prevent header drag handler from firing
                e.currentTarget.setPointerCapture(e.pointerId); // pointerup always fires here even if mouse drifts off
                callFrameRef.current?.setLocalAudio(true);
                setPttActive(true);
              }}
              onPointerUp={() => {
                callFrameRef.current?.setLocalAudio(false);
                setPttActive(false);
              }}
              onPointerCancel={() => {
                callFrameRef.current?.setLocalAudio(false);
                setPttActive(false);
              }}
              title="Hold to talk"
              style={{
                background: pttActive ? "rgba(239,68,68,0.18)" : "rgba(255,255,255,0.06)",
                border: `1px solid ${pttActive ? "rgba(239,68,68,0.5)" : "rgba(255,255,255,0.12)"}`,
                borderRadius: "6px",
                color: pttActive ? "#f87171" : "var(--text-dim)",
                fontSize: "11px",
                fontWeight: 600,
                padding: "2px 8px",
                cursor: "pointer",
                userSelect: "none",
                transition: "all 0.08s",
                fontFamily: "inherit",
                lineHeight: "20px",
              }}
            >
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                {pttActive
                  ? <><Circle size={9} fill="currentColor" strokeWidth={0} />LIVE</>
                  : <><Mic size={12} />Hold to talk</>}
              </span>
            </button>
          )}
          {status === "ready" && !isMinimized && (
            <button
              onClick={toggleNC}
              title={ncEnabled ? "Noise cancellation on (click to disable)" : "Noise cancellation off (click to enable)"}
              style={{
                background: ncEnabled ? "rgba(74,222,128,0.12)" : "rgba(255,255,255,0.06)",
                border: `1px solid ${ncEnabled ? "rgba(74,222,128,0.4)" : "rgba(255,255,255,0.12)"}`,
                borderRadius: "6px",
                color: ncEnabled ? "#4ade80" : "var(--text-dim)",
                fontSize: "11px",
                fontWeight: 600,
                padding: "2px 8px",
                cursor: "pointer",
                userSelect: "none",
                transition: "all 0.08s",
                fontFamily: "inherit",
                lineHeight: "20px",
              }}
            >
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><Headphones size={12} />{ncEnabled ? "NC On" : "NC Off"}</span>
            </button>
          )}
          {status === "ready" && !isMinimized && (
            <button
              onClick={onToggleHand}
              title={handRaised ? "Lower hand" : "Raise hand"}
              style={{
                background: handRaised ? "rgba(196,154,60,0.18)" : "rgba(255,255,255,0.06)",
                border: `1px solid ${handRaised ? "rgba(196,154,60,0.5)" : "rgba(255,255,255,0.12)"}`,
                borderRadius: "6px",
                color: handRaised ? "#c49a3c" : "var(--text-dim)",
                fontSize: "11px",
                fontWeight: 600,
                padding: "2px 8px",
                cursor: "pointer",
                userSelect: "none",
                transition: "all 0.08s",
                fontFamily: "inherit",
                lineHeight: "20px",
              }}
            >
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><Hand size={12} />{handRaised ? "Raised" : "Raise"}</span>
            </button>
          )}
          {connectionQuality !== "unknown" && !isMinimized && (
            <span title={`Connection: ${connectionQuality}`} style={{
              display: "inline-flex", alignItems: "center", gap: "4px",
              fontSize: "11px", color: connectionQuality === "good" ? "#4ade80" : connectionQuality === "fair" ? "#f59e0b" : "#f87171",
              padding: "2px 6px",
            }}>
              <span style={{
                width: "8px", height: "8px", borderRadius: "50%",
                background: connectionQuality === "good" ? "#4ade80" : connectionQuality === "fair" ? "#f59e0b" : "#f87171",
                flexShrink: 0,
              }} />
              {connectionQuality}
            </span>
          )}
        </div>
        <div
          style={{ display: "flex", alignItems: "center", gap: "4px" }}
          onMouseDown={e => e.stopPropagation()}
        >
          {/* Collapse button — mobile only */}
          {isMobile && (
            <button
              onClick={() => setMinimized(true)}
              title="Collapse"
              style={{
                background: "none", border: "none", cursor: "pointer",
                color: "var(--text-dim)", fontSize: "15px", lineHeight: 1,
                padding: "2px 5px", borderRadius: "5px",
              }}
            >
              ─
            </button>
          )}
          {/* Desktop minimize */}
          {!isMobile && (
            <button
              onClick={() => setMinimized(m => !m)}
              title={isMinimized ? "Expand" : "Minimize"}
              style={{
                background: "none", border: "none", cursor: "pointer",
                color: "var(--text-dim)", fontSize: "15px", lineHeight: 1,
                padding: "2px 5px", borderRadius: "5px",
              }}
            >
              {isMinimized ? <Square size={13} /> : <Minus size={15} />}
            </button>
          )}
          <button
            onClick={onClose}
            title="Leave voice"
            style={{
              background: "none", border: "none", cursor: "pointer",
              color: "var(--text-dim)", fontSize: "18px", lineHeight: 1,
              padding: "0 2px", borderRadius: "5px",
            }}
          >
            ×
          </button>
        </div>
      </div>

      {/* Body */}
      <div style={{ height: (!isMobile && isMinimized) ? 0 : "auto", overflow: "hidden" }}>

        {/* iframe is mounted for both loading + ready so iframeRef is set when the
            wrap+join effect fires. A loading overlay covers it until join() resolves. */}
        {(status === "loading" || status === "ready") && (
          <div style={{ position: "relative" }}>
            <iframe
              ref={iframeRef}
              title="Voice chat"
              allow="microphone *; camera *; autoplay *; display-capture *; speaker *; fullscreen *"
              style={{ width: "100%", height: isMobile ? "50vh" : "460px", border: "none", display: "block" }}
            />
            {status === "loading" && (
              <div style={{
                position: "absolute", inset: 0,
                display: "flex", alignItems: "center", justifyContent: "center",
                background: "rgba(10,10,14,0.97)",
              }}>
                <p style={{ fontSize: "13px", color: "var(--text-dim)" }}>Connecting to voice…</p>
              </div>
            )}
            {pttActive && (
              <div style={{
                position: "absolute", bottom: "14px", left: "50%", transform: "translateX(-50%)",
                background: "rgba(239,68,68,0.92)", color: "#fff", fontSize: "13px", fontWeight: 700,
                padding: "7px 18px", borderRadius: "20px", zIndex: 10, pointerEvents: "none",
                boxShadow: "0 0 16px rgba(239,68,68,0.5)", letterSpacing: "0.04em",
              }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Mic size={13} />LIVE</span>
              </div>
            )}
            {showPttHint && !pttActive && (
              <div style={{
                position: "absolute", bottom: "54px", left: "50%", transform: "translateX(-50%)",
                background: "rgba(20,20,28,0.92)", color: "var(--text-primary)", fontSize: "12px",
                fontWeight: 500, padding: "8px 16px", borderRadius: "20px", zIndex: 10,
                pointerEvents: "none", border: "1px solid rgba(255,255,255,0.12)",
                boxShadow: "0 4px 16px rgba(0,0,0,0.5)", whiteSpace: "nowrap",
                animation: "vcPttHint 3.5s ease forwards",
              }}>
                <Lightbulb size={13} style={{ verticalAlign: "-2px", marginRight: 4 }} />Hold <kbd style={{ background: "rgba(255,255,255,0.12)", borderRadius: "4px", padding: "1px 6px", fontFamily: "inherit" }}>Space</kbd> to talk
              </div>
            )}
          </div>
        )}

        {status === "unavailable" && (
          <div style={{ padding: "28px 20px", textAlign: "center" }}>
            <p style={{ fontSize: "13px", color: "var(--text-primary)", marginBottom: "6px" }}>
              Voice chat isn't set up yet.
            </p>
            <p style={{ fontSize: "11px", color: "var(--text-dim)", lineHeight: 1.5 }}>
              An admin needs to add a{" "}
              <code style={{ background: "rgba(255,255,255,0.06)", padding: "1px 5px", borderRadius: "4px" }}>
                DAILY_API_KEY
              </code>{" "}
              to enable it.
            </p>
          </div>
        )}

        {status === "error" && (
          <div style={{ padding: "28px 20px", textAlign: "center" }}>
            <p style={{ fontSize: "13px", color: "var(--text-primary)", marginBottom: "6px" }}>
              Couldn't connect to voice.
            </p>
            <p style={{ fontSize: "11px", color: "var(--text-dim)", marginBottom: "16px" }}>
              Check your connection and try again.
            </p>
            <button
              onClick={() => { setStatus("loading"); setUrl(null); setRetryKey(k => k + 1); }}
              style={{
                background: "rgba(96,165,250,0.12)",
                border: "1px solid rgba(96,165,250,0.35)",
                borderRadius: "8px",
                color: ACCENT,
                fontSize: "13px",
                fontWeight: 600,
                padding: "8px 20px",
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              Try again
            </button>
          </div>
        )}
      </div>

      <style>{`@keyframes vcPulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.5;transform:scale(1.3)}}@keyframes vcPttHint{0%{opacity:0;transform:translateX(-50%) translateY(6px)}10%{opacity:1;transform:translateX(-50%) translateY(0)}80%{opacity:1}100%{opacity:0}}`}</style>
    </div>
  );

  return createPortal(
    <>
      {/* Collapsed bar — shown instead of sheet on mobile when minimized.
          The sheet (with iframe) stays in the DOM so the call doesn't drop. */}
      {mobileCollapsed && (
        <div
          onClick={() => setMinimized(false)}
          style={{
            position:             "fixed",
            bottom:               0,
            left:                 0,
            right:                0,
            height:               "56px",
            zIndex:               1201,
            display:              "flex",
            alignItems:           "center",
            justifyContent:       "space-between",
            padding:              "0 20px",
            background:           "rgba(10,10,14,0.97)",
            backdropFilter:       "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
            borderTop:            "1px solid rgba(96,165,250,0.2)",
            boxShadow:            "0 -4px 20px rgba(0,0,0,0.5)",
            cursor:               "pointer",
            userSelect:           "none",
          }}
        >
          {/* Left: live dot + label */}
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{
              display:      "inline-block",
              width:        "8px",
              height:       "8px",
              borderRadius: "50%",
              background:   status === "ready" ? "#4ade80" : "#facc15",
              boxShadow:    status === "ready" ? "0 0 8px #4ade80" : "0 0 8px #facc15",
              animation:    "vcPulse 1.8s ease-in-out infinite",
            }} />
            <span style={{ fontSize: "13px", fontWeight: 600, color: ACCENT }}>Voice</span>
          </div>

          {/* Right: leave */}
          <button
            onClick={e => { e.stopPropagation(); onClose(); }}
            style={{
              background:   "rgba(239,68,68,0.15)",
              border:       "1px solid rgba(239,68,68,0.3)",
              borderRadius: "8px",
              color:        "#f87171",
              fontSize:     "13px",
              fontWeight:   600,
              padding:      "0 14px",
              height:       "36px",
              cursor:       "pointer",
            }}
          >
            Leave
          </button>
        </div>
      )}

      {/* Main sheet — visually hidden when collapsed but kept in DOM so the
          Daily.co iframe (and the active call) is never unmounted. */}
      <div style={{ display: mobileCollapsed ? "none" : undefined }}>
        {popup}
      </div>
    </>,
    document.body,
  );
}

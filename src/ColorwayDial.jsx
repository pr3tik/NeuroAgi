// ColorwayDial — sunrise arc fan + dial picker (experimental).
// Colour switches use “tunnel” walls: cards exit one edge hidden, re-enter the other.
import { useState, useEffect, useRef, useCallback } from "react";
import { animate } from "framer-motion";

const CARD_SHADOW = "inset 1px 1px 2px 2px rgba(0,0,0,0.18)";
const CARD_BORDER = "1px solid rgba(255,255,255,0.4)";
// Keep drop shadow tight — a huge offset shadow was painting over neighbors and muddying colors
const CARD_DROP   = "0 14px 22px rgba(0,0,0,0.16)";

const N = 5;
const WHITE_INDEX = 0;
const SPACING     = 178;
const TILT_STEP   = 12;
const ARC_DROP    = 18;
const CENTER_LIFT = 24;
const WALL        = 2.72; // visible arc edge — beyond this cards pass through the wall
const HOVER_TRANSITION = "transform 0.45s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.4s ease";

function wrappedSlot(i, active, n = N) {
  let d = i - active;
  while (d > 2) d -= n;
  while (d < -2) d += n;
  return d;
}

function targetSlots(active) {
  return Array.from({ length: N }, (_, i) => wrappedSlot(i, active));
}

/** Only wrap when a linear slide would sweep from one far edge to the opposite through the fan. */
function needsTunnel(start, end) {
  if (Math.abs(end - start) < 0.01) return false;
  if (start * end >= 0) return false; // same side of center (incl. from/to center)
  return Math.abs(start) + Math.abs(end) > 2.5;
}

/**
 * Exit through one invisible wall (fade out), hold hidden, enter through the opposite wall.
 * Adjacent / same-side moves stay linear along the arc.
 */
function interpolateSlotWithTunnel(start, end, t) {
  const d = end - start;
  if (Math.abs(d) < 0.01) return { slot: end, vis: 1 };

  if (!needsTunnel(start, end)) {
    const slot = start + d * t;
    const over = Math.abs(slot) - WALL;
    const vis = over <= 0 ? 1 : Math.max(0, 1 - over * 2.5);
    return { slot, vis };
  }

  // Wrap behind the fan: leave through the wall on the start side, re-enter the opposite side.
  const exitWall  = start >= 0 ? WALL : -WALL;
  const enterWall = start >= 0 ? -WALL : WALL;
  const EXIT_END = 0.34;
  const ENTER_START = 0.54;

  if (t <= EXIT_END) {
    const u = t / EXIT_END;
    return { slot: start + (exitWall - start) * u, vis: 1 - u };
  }
  if (t < ENTER_START) {
    return { slot: enterWall, vis: 0 };
  }
  const u = (t - ENTER_START) / (1 - ENTER_START);
  return { slot: enterWall + (end - enterWall) * u, vis: u };
}

function smoothstep(t) {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

function computeExpandT(el) {
  const rect = el.getBoundingClientRect();
  const vh = window.innerHeight;
  // Track the card fan center (not container top) so full spread lands in viewport middle.
  const fanCenterY = rect.top + rect.height * 0.44;
  const startCenter = vh * 0.88; // stay stacked until fan is lower on screen
  const endCenter = vh * 0.5;    // fully fanned when fan center hits mid-screen
  return smoothstep((startCenter - fanCenterY) / (startCenter - endCenter));
}
function stackPose(i) {
  const isWhite = i === WHITE_INDEX;
  return {
    x: isWhite ? 0 : (i - 1) * 4,
    y: isWhite ? 0 : 5 + i * 3.5,
    rotate: isWhite ? 0 : (i - 1) * 4,
    scale: isWhite ? 0.96 : 0.84,
    opacity: 1,
    zIndex: 40 - i,
  };
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function lerpPose(a, b, t) {
  return {
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    rotate: lerp(a.rotate, b.rotate, t),
    scale: lerp(a.scale, b.scale, t),
    opacity: lerp(a.opacity, b.opacity, t),
    zIndex: t < 0.5 ? a.zIndex : b.zIndex,
  };
}

function sunrisePose(slot, { isHovered = false, vis = 1 } = {}) {
  const abs = Math.abs(slot);
  const centerBlend = Math.max(0, 1 - abs / 0.65);

  const x = slot * SPACING;
  const rotate = slot * TILT_STEP;
  const y = Math.pow(abs, 1.3) * ARC_DROP - centerBlend * CENTER_LIFT;
  let scale = 0.84 + centerBlend * 0.26;
  let lift = y;

  // Full opacity while on-stage — translucent cards over white (or each other)
  // wash out / invent muddy “new” colours. Only tunnel exit uses vis < 1.
  let opacity = vis >= 0.98 ? 1 : vis;

  if (isHovered && vis > 0.4) {
    lift -= 12;
    scale += 0.03;
  }

  return {
    x,
    y: lift,
    rotate,
    scale,
    opacity,
    // Fading tunnel cards go behind so they never blend with the fan
    zIndex:
      Math.round(36 - abs * 4.5) +
      Math.round(centerBlend * 6) +
      (vis < 0.98 ? -30 : 0),
  };
}

function DialCardFace({ id, width, images }) {
  const radius = Math.round(width * (20 / 214));
  const shadowW = width * 1.15;
  const shadowH = shadowW * 0.13;
  return (
    <div style={{ position: "relative", width, flexShrink: 0 }}>
      <div style={{ position: "relative", borderRadius: radius, overflow: "hidden" }}>
        <img src={images[id]} alt={id} style={{ width: "100%", height: "auto", display: "block" }} />
        <div style={{ position: "absolute", inset: 0, borderRadius: radius, boxShadow: CARD_SHADOW, pointerEvents: "none" }} />
        <div style={{ position: "absolute", inset: 0, borderRadius: radius, border: CARD_BORDER, boxShadow: CARD_DROP, pointerEvents: "none" }} />
      </div>
      <div style={{
        position: "absolute", left: "50%", bottom: -shadowH * 0.45, transform: "translateX(-50%)",
        width: shadowW, height: shadowH,
        background: "radial-gradient(ellipse at center, rgba(0,0,0,0.28) 0%, rgba(0,0,0,0) 72%)",
        filter: "blur(4px)", pointerEvents: "none",
      }} />
    </div>
  );
}

export default function ColorwayDial({
  colorways,
  activeColor,
  onSelect,
  images,
  cardWidth = 148,
}) {
  const containerRef = useRef(null);
  const slotsRef = useRef(colorways.map(() => 0));
  const spinCtrlRef = useRef(null);
  const prevActiveRef = useRef(activeColor);
  const expandTRef = useRef(0);
  const spinFromRef = useRef(null);
  const spinEndRef = useRef(null);
  const spinProgressRef = useRef(0);
  const isSpinningRef = useRef(false);
  const spinGenRef = useRef(0);

  const getCurrentSlots = useCallback(() => {
    const from = spinFromRef.current;
    const to = spinEndRef.current;
    if (isSpinningRef.current && from && to) {
      return from.map((s, i) =>
        interpolateSlotWithTunnel(s, to[i], spinProgressRef.current).slot
      );
    }
    return [...slotsRef.current];
  }, []);

  const [expandT, setExpandT] = useState(0);
  const [slots, setSlots] = useState(() => colorways.map(() => 0));
  const [hovered, setHovered] = useState(null);
  const [isSpinning, setIsSpinning] = useState(false);
  const [spinProgress, setSpinProgress] = useState(0);
  const [spinFrom, setSpinFrom] = useState(null);
  const [spinEnd, setSpinEnd] = useState(null);
  const [dialScale, setDialScale] = useState(1);
  const [, bump] = useState(0);
  const forceRender = useCallback(() => bump(n => n + 1), []);

  useEffect(() => { slotsRef.current = slots; }, [slots]);

  useEffect(() => {
    const update = () => {
      const w = window.innerWidth;
      setDialScale(w < 640 ? Math.min(1, (w - 32) / (SPACING * 4 + cardWidth)) : 1);
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [cardWidth]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let raf = 0;
    const update = () => {
      raf = 0;
      const t = computeExpandT(el);
      expandTRef.current = t;
      setExpandT(t);

      if (!isSpinningRef.current) {
        const end = targetSlots(activeColor);
        const next = end.map((s) => s * t);
        slotsRef.current = next;
        setSlots(next);
      }
    };

    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [activeColor]);

  const runSpin = useCallback((to, { notifyParent = true } = {}) => {
    if (expandTRef.current < 0.92) return;

    spinCtrlRef.current?.stop();

    const start = getCurrentSlots();
    const end = targetSlots(to);
    if (start.every((s, i) => Math.abs(s - end[i]) < 0.015)) {
      if (notifyParent) {
        prevActiveRef.current = to;
        onSelect(to);
      }
      return;
    }

    if (notifyParent) {
      prevActiveRef.current = to;
      onSelect(to);
    }

    const gen = ++spinGenRef.current;
    spinFromRef.current = start;
    spinEndRef.current = end;
    spinProgressRef.current = 0;
    isSpinningRef.current = true;

    setSpinFrom(start);
    setSpinEnd(end);
    setSpinProgress(0);
    setIsSpinning(true);

    spinCtrlRef.current = animate(0, 1, {
      duration: 0.82,
      ease: [0.25, 0.1, 0.25, 1],
      onUpdate: (t) => {
        if (gen !== spinGenRef.current) return;
        spinProgressRef.current = t;
        slotsRef.current = start.map((s, i) =>
          interpolateSlotWithTunnel(s, end[i], t).slot
        );
        setSpinProgress(t);
        forceRender();
      },
      onComplete: () => {
        if (gen !== spinGenRef.current) return;
        const t = expandTRef.current;
        const scaled = end.map((s) => s * Math.min(1, t));
        slotsRef.current = scaled;
        setSlots(scaled);
        spinFromRef.current = null;
        spinEndRef.current = null;
        spinProgressRef.current = 0;
        isSpinningRef.current = false;
        setSpinFrom(null);
        setSpinEnd(null);
        setSpinProgress(0);
        setIsSpinning(false);
        spinCtrlRef.current = null;
        forceRender();
      },
    });
  }, [onSelect, forceRender, getCurrentSlots]);

  const spinTo = useCallback((index) => {
    runSpin(index, { notifyParent: true });
  }, [runSpin]);

  useEffect(() => {
    if (activeColor === prevActiveRef.current) return;
    prevActiveRef.current = activeColor;
    if (expandTRef.current < 0.92) return;
    runSpin(activeColor, { notifyParent: false });
  }, [activeColor, runSpin]);

  function cardStyle(i) {
    if (isSpinning && spinFrom && spinEnd) {
      const { slot, vis } = interpolateSlotWithTunnel(spinFrom[i], spinEnd[i], spinProgress);
      const pose = sunrisePose(slot, { isHovered: false, vis });
      return {
        ...pose,
        pointerEvents: "none",
        transition: "none",
      };
    }

    const slot = slots[i] ?? 0;
    const spread = sunrisePose(slot, { isHovered: hovered === i && expandT > 0.85 });

    if (expandT < 0.995) {
      const stack = stackPose(i);
      const blend = expandT ** 0.85;
      const blended = lerpPose(stack, spread, blend);
      return {
        ...blended,
        pointerEvents: expandT > 0.85 && !isSpinning ? "auto" : "none",
        transition: "none",
      };
    }

    return {
      ...spread,
      zIndex: spread.zIndex + (hovered === i ? 8 : 0),
      pointerEvents: "auto",
      transition: HOVER_TRANSITION,
    };
  }

  return (
    <div style={{ position: "relative", width: "100%", overflow: "visible" }}>
      <div
        ref={containerRef}
        style={{
          position: "relative",
          minHeight: "clamp(420px, 55vw, 520px)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 48,
          overflow: "visible",
          touchAction: "pan-y",
          padding: "48px 0 32px",
        }}
      >
        <div style={{
          position: "relative",
          width: SPACING * 4 + cardWidth,
          maxWidth: "100%",
          height: cardWidth * 2.85,
          transform: `scale(${dialScale})`,
          transformOrigin: "center center",
          overflow: "visible",
          /* Soft clip only at the extreme edges — a wide mask washed cards to near-white */
          WebkitMaskImage: `linear-gradient(to right, transparent 0%, #000 2.5%, #000 97.5%, transparent 100%)`,
          maskImage: `linear-gradient(to right, transparent 0%, #000 2.5%, #000 97.5%, transparent 100%)`,
        }}>
          {colorways.map((c, i) => {
            const s = cardStyle(i);
            return (
              <div
                key={c.id}
                role="button"
                tabIndex={0}
                aria-label={`Select ${c.name} colorway`}
                aria-pressed={i === activeColor}
                onClick={() => spinTo(i)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); spinTo(i); } }}
                onMouseEnter={() => !isSpinning && setHovered(i)}
                onMouseLeave={() => setHovered(null)}
                style={{
                  position: "absolute",
                  left: "50%",
                  top: "62%",
                  marginLeft: -cardWidth / 2,
                  marginTop: -cardWidth * 1.15,
                  transform: `translate3d(${s.x}px, ${s.y}px, 0) rotate(${s.rotate}deg) scale(${s.scale})`,
                  opacity: s.opacity,
                  zIndex: s.zIndex,
                  cursor: isSpinning ? "default" : "pointer",
                  pointerEvents: s.pointerEvents,
                  willChange: "transform, opacity",
                  transition: s.transition,
                  transformOrigin: "center bottom",
                  backfaceVisibility: "hidden",
                }}
              >
                <DialCardFace id={c.id} width={cardWidth} images={images} />
              </div>
            );
          })}

        </div>
      </div>

      <div style={{
        display: "flex",
        justifyContent: "center",
        gap: 12,
        opacity: expandT,
        pointerEvents: expandT > 0.5 ? "auto" : "none",
        transition: "opacity 0.2s ease",
      }}>
        {colorways.map((c, i) => (
          <button
            key={c.id}
            type="button"
            aria-label={c.name}
            onClick={() => spinTo(i)}
            style={{
              width: 28, height: 28, borderRadius: "50%", background: c.dot,
              border: i === activeColor ? "2.5px solid #0071e3" : "2px solid rgba(0,0,0,0.12)",
              cursor: "pointer", padding: 0, outline: "none",
              boxShadow: i === activeColor ? "0 0 0 3px rgba(0,113,227,0.22)" : "none",
              transition: "box-shadow 0.2s ease, border-color 0.2s ease, transform 0.2s ease",
              transform: i === activeColor ? "scale(1.08)" : "scale(1)",
            }}
          />
        ))}
      </div>
    </div>
  );
}

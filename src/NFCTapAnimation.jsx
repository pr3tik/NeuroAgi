import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

// Assets live in /public/nfc-demo — see public/nfc-demo/
const imgHandIPhone = "/nfc-demo/hand-iphone.png";
const imgHandIPhoneZoom = "/nfc-demo/hand-iphone-zoom.png";
const imgCard = "/nfc-demo/card-demo.png";

// Reference canvas — tight crop around just the phone/card visual
// (the original Figma artboard was 3169×2700; this is just the inner
// "grey phone box" region, offset by -332/-326, so there's no dead
// whitespace when this is embedded as a page section instead of a
// full-viewport prototype).
const AW = 2505;
const AH = 2169;

const ANIM_S = 1.2;
const EASE = [0.42, 0, 0.58, 1];

const CARD_W = 379;
const CARD_H = 578;
// Card translation from resting → tapped position. Translation-invariant,
// so these deltas are unaffected by the coordinate-space shift above.
const CARD_DX = 827 + 617.224 / 2 - (688 + CARD_W / 2); // ≈ 258
const CARD_DY = 651 + 690.063 / 2 - (778 + CARD_H / 2); // ≈ -71

const HEADLINES = {
  1: "How to use our FSchoolAI Identity Cards",
  2: "Tap your FSchoolAI Identity card on top of your device to launch the app",
  3: "The pop-up of the app along with your card appears on your screen",
};

// Two staggered expanding rings, pulse only while frame === 2.
// Plain stroked circles rather than an icon glyph — cleaner "ping" with no
// internal banding to fight the staggered overlap.
function NFCRipple({ frame }) {
  const pulsing = frame === 2;
  const RING_SIZE = 190;
  return (
    <div
      style={{
        position: "absolute",
        left: 1062,
        top: 325,
        width: 255,
        height: 266,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        pointerEvents: "none",
      }}
    >
      <div style={{ position: "relative", width: RING_SIZE, height: RING_SIZE }}>
        {[0, 0.8].map((delay, i) => (
          <motion.div
            key={i}
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              width: RING_SIZE,
              height: RING_SIZE,
              marginLeft: -RING_SIZE / 2,
              marginTop: -RING_SIZE / 2,
              borderRadius: "50%",
              border: "5px solid rgba(20,20,25,0.6)",
              boxShadow: "0 0 12px 2px rgba(20,20,25,0.15)",
            }}
            animate={pulsing ? { scale: [0.15, 1], opacity: [0, 0.95, 0] } : { scale: 0.15, opacity: 0 }}
            transition={
              pulsing
                ? { duration: 1.6, delay, repeat: Infinity, times: [0, 0.3, 1], ease: "easeOut" }
                : { duration: 0.4, ease: "easeOut" }
            }
          />
        ))}
      </div>
    </div>
  );
}

// The identity card — rests flat in frame 1, taps onto the phone in frames 2 & 3.
function CardLayer({ frame }) {
  const target = frame === 1 ? { x: 0, y: 0, rotate: 0 } : { x: CARD_DX, y: CARD_DY, rotate: 30 };
  return (
    <motion.div
      style={{ position: "absolute", left: 356, top: 452, width: CARD_W, height: CARD_H, borderRadius: 20, pointerEvents: "none" }}
      animate={target}
      transition={{ duration: ANIM_S, ease: EASE }}
    >
      <div style={{ position: "absolute", inset: 0, overflow: "hidden", borderRadius: 20 }}>
        <img
          src={imgCard}
          alt="FSchoolAI Identity Card"
          style={{ position: "absolute", height: "108%", width: "107.9%", left: "-4.11%", top: "-3.89%", maxWidth: "none" }}
        />
      </div>
      <div style={{ position: "absolute", inset: 0, borderRadius: 20, boxShadow: "inset 1px 1px 2px 2px rgba(0,0,0,0.25)" }} />
      <div style={{ position: "absolute", inset: 0, borderRadius: 20, boxShadow: "-20px 10px 8px 5px rgba(0,0,0,0.21)", border: "1px solid white" }} />
    </motion.div>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────
// `t` = the page's theme tokens object (DARK/LIGHT), so the headline/dots
// follow whichever theme the rest of the page is in. The visual box itself
// stays a neutral light panel always, since the source photos have a fixed
// white studio background baked in — matching the page's dark mode would
// require re-shooting/re-exporting those assets.
export default function NFCTapAnimation({ t }) {
  const [frame, setFrame] = useState(1);
  const firstRender = useRef(true);
  const containerRef = useRef(null);
  const [width, setWidth] = useState(0);

  // Track the box's own rendered width — NOT window size — so this scales
  // correctly whether it's full-width on mobile or capped at maxWidth on desktop.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setWidth(el.offsetWidth);
    update();
    const obs = new ResizeObserver(update);
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // Auto-advance through the 3 frames; clicking a dot also resets this timer
  // since it's keyed on `frame`, which changes either way.
  useEffect(() => {
    const isFirst = firstRender.current;
    firstRender.current = false;
    const delay = frame === 3 ? (ANIM_S + 3) * 1000 : isFirst ? 800 : (ANIM_S + 0.8) * 1000;
    const timer = setTimeout(() => {
      setFrame((f) => (f === 3 ? 1 : f + 1));
    }, delay);
    return () => clearTimeout(timer);
  }, [frame]);

  const scale = width / AW;

  return (
    <div style={{ width: "100%" }}>
      {/* Headline — decoupled from the scaled artwork so it stays legible at any size */}
      <div style={{ minHeight: 90, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 20px", marginBottom: 36 }}>
        <AnimatePresence mode="wait">
          <motion.h3
            key={frame}
            style={{
              fontSize: "clamp(20px,3.2vw,38px)",
              fontWeight: 700,
              letterSpacing: "-0.02em",
              lineHeight: 1.25,
              textAlign: "center",
              color: t.text,
              margin: 0,
              maxWidth: 720,
            }}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -14 }}
            transition={{ duration: 0.48, ease: EASE }}
          >
            {HEADLINES[frame]}
          </motion.h3>
        </AnimatePresence>
      </div>

      {/* Visual box — scales freely with container width, no legibility concerns since it's pure imagery */}
      <div
        ref={containerRef}
        style={{
          position: "relative",
          width: "100%",
          maxWidth: 820,
          margin: "0 auto",
          aspectRatio: `${AW} / ${AH}`,
          borderRadius: 32,
          overflow: "hidden",
          background: "#f2f1ee",
          boxShadow: "0 24px 60px rgba(0,0,0,0.16), 0 2px 14px rgba(0,0,0,0.08)",
        }}
      >
        {width > 0 && (
          <div style={{ position: "absolute", left: 0, top: 0, width: AW, height: AH, transformOrigin: "top left", transform: `scale(${scale})` }}>
            {/* Hand + iPhone — frames 1 & 2 */}
            <motion.div
              style={{ position: "absolute", left: 130, top: 33, width: 2333, height: 2136, overflow: "hidden", pointerEvents: "none", transformOrigin: "center center" }}
              initial={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
              animate={frame === 3 ? { opacity: 0, scale: 1.08, filter: "blur(10px)" } : { opacity: 1, scale: 1, filter: "blur(0px)" }}
              transition={frame === 3 ? { duration: 0.7, ease: EASE } : { duration: 0.5, ease: EASE }}
            >
              <img src={imgHandIPhone} alt="" style={{ position: "absolute", height: "108.64%", width: "131.65%", left: "-15.82%", top: 0, maxWidth: "none" }} />
            </motion.div>

            {/* Hand + iPhone zoomed — frame 3 */}
            <motion.div
              style={{ position: "absolute", left: 474, top: 271, width: 2087, height: 1898, overflow: "hidden", pointerEvents: "none", transformOrigin: "center center" }}
              initial={{ opacity: 0, scale: 0.94, filter: "blur(10px)" }}
              animate={frame === 3 ? { opacity: 1, scale: 1, filter: "blur(0px)" } : { opacity: 0, scale: 0.94, filter: "blur(10px)" }}
              transition={frame === 3 ? { duration: 0.85, delay: 0.35, ease: EASE } : { duration: 0.4, ease: EASE }}
            >
              <img src={imgHandIPhoneZoom} alt="" style={{ position: "absolute", height: "123.96%", width: "150.4%", left: "-33.43%", top: "-11.81%", maxWidth: "none" }} />
            </motion.div>

            <NFCRipple frame={frame} />
            <CardLayer frame={frame} />
          </div>
        )}
      </div>

      {/* Progress dots — fixed size regardless of viewport, always tappable */}
      <div style={{ display: "flex", justifyContent: "center", gap: 6, marginTop: 28 }}>
        {[1, 2, 3].map((f) => (
          <button
            key={f}
            onClick={() => setFrame(f)}
            aria-label={`Show step ${f}`}
            style={{ background: "none", border: "none", padding: 8, cursor: "pointer", display: "flex", alignItems: "center" }}
          >
            <motion.span
              style={{ display: "block", height: 10, borderRadius: 5, background: f === frame ? t.text : t.textFaint }}
              animate={{ width: f === frame ? 36 : 10 }}
              transition={{ duration: 0.32, ease: EASE }}
            />
          </button>
        ))}
      </div>
    </div>
  );
}
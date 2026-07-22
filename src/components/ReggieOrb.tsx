// ReggieOrb — Reggie's canonical avatar.
//
// The same animated fibonacci-sphere the floating NeuralRing assistant draws, extracted
// as a standalone, self-animating canvas so every "Reggie" surface (StudyAssistant
// message/header avatars, the chat-window header) shows ONE identity instead of ad-hoc
// gradient circles. Idle-only: a gentle rotation, white nodes — no voice/thinking wiring
// (that stays internal to NeuralRing's live orb).
//
// Performance: the per-message avatar mounts once per Reggie reply, so this pauses its
// RAF loop whenever it scrolls out of view (IntersectionObserver) and honours
// prefers-reduced-motion by painting a single static frame.
import { useEffect, useRef } from "react";

const ORB_N = 28;
const ORB_EDGE_THRESHOLD = 0.72;

// Fibonacci sphere — evenly distributed points on a unit sphere (matches NeuralRing).
function orbSphere(n: number) {
  const pts: { x: number; y: number; z: number }[] = [];
  const phi = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const t = phi * i;
    pts.push({ x: r * Math.cos(t), y, z: r * Math.sin(t) });
  }
  return pts;
}
const ORB_NODES = orbSphere(ORB_N);

export default function ReggieOrb({ size = 30, glow = false, style }: {
  size?: number; glow?: boolean; style?: any;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef(0);
  const rotRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    ctx.scale(dpr, dpr);

    const R = size * 0.36;               // sphere radius (NeuralRing uses 24/68 ≈ 0.35)
    const cx = size / 2, cy = size / 2;
    // Node/line weights scale with size, but floored so tiny avatars (22px) don't render
    // as a faint sub-pixel dust cloud — below ~34px, dots stay a touch chunkier than pure
    // proportion would give.
    const dotScale = Math.max(0.5, size / 68);

    const drawFrame = () => {
      const rot = rotRef.current;
      ctx.clearRect(0, 0, size, size);

      const projected = ORB_NODES.map(({ x, y, z }) => {
        const rx = x * Math.cos(rot) + z * Math.sin(rot);
        const rz = -x * Math.sin(rot) + z * Math.cos(rot);
        return { sx: rx * R + cx, sy: y * R + cy, sz: rz, depth: (rz + 1) * 0.5 };
      });

      ctx.lineWidth = Math.max(0.5, 0.7 * dotScale);
      for (let i = 0; i < projected.length; i++) {
        for (let j = i + 1; j < projected.length; j++) {
          const ri = projected[i], rj = projected[j];
          const dx = ri.sx - rj.sx, dy = ri.sy - rj.sy, dz = ri.sz - rj.sz;
          const d3 = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (d3 < R * 2 * ORB_EDGE_THRESHOLD) {
            const alpha = 0.05 + (ri.depth + rj.depth) * 0.07;
            ctx.strokeStyle = `rgba(255,255,255,${alpha.toFixed(2)})`;
            ctx.beginPath(); ctx.moveTo(ri.sx, ri.sy); ctx.lineTo(rj.sx, rj.sy); ctx.stroke();
          }
        }
      }
      for (const { sx, sy, depth } of projected) {
        ctx.beginPath();
        ctx.arc(sx, sy, (0.9 + depth * 0.8) * dotScale, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${(0.5 + depth * 0.4).toFixed(2)})`;
        ctx.fill();
      }
    };

    // Reduced motion: paint one static frame, never start the loop.
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) { drawFrame(); return; }

    const tick = () => {
      rotRef.current += 0.004;
      drawFrame();
      rafRef.current = requestAnimationFrame(tick);
    };
    const start = () => { if (!rafRef.current) rafRef.current = requestAnimationFrame(tick); };
    const stop  = () => { cancelAnimationFrame(rafRef.current); rafRef.current = 0; };

    // Pause the loop while off-screen so a long chat of Reggie avatars stays cheap.
    let io: IntersectionObserver | null = null;
    if (typeof IntersectionObserver !== "undefined") {
      io = new IntersectionObserver(([e]) => (e.isIntersecting ? start() : stop()));
      io.observe(canvas);
    } else {
      start();
    }
    return () => { stop(); io?.disconnect(); };
  }, [size]);

  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      aria-hidden="true"
      style={{
        width: size, height: size, display: "block", flexShrink: 0,
        filter: glow ? `drop-shadow(0 0 ${Math.round(size * 0.14)}px rgba(var(--teal-rgb),0.45))` : undefined,
        ...style,
      }}
    />
  );
}

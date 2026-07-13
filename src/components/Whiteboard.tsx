// Whiteboard.tsx — Phase 3 collaborative whiteboard (v3).
//
// Coordinates live in a FIXED space (BOARD_W × BOARD_H) so every device renders the
// same picture; the <canvas> buffer is that size and CSS scales it to fit.
//
// RENDERING — one canvas, one pass (no offscreen layers, no destination-out):
//   Every render clears the canvas, fills the background, then draws every committed
//   stroke in order followed by every in-progress (live) stroke. Strokes simply
//   overlap — drawing always adds, never wipes. The area-eraser is just a stroke
//   painted in the *current* background colour (source-over), so it covers whatever
//   is beneath it and re-colours itself for free whenever the background changes.
//   Redrawing from the stroke list on every change makes multi-user state
//   impossible to desync, at the cost of a full redraw per frame (fine for the
//   modest stroke counts a study board sees).
//
// TOOLS: pen (5 styles) · stroke-eraser (tap a line to delete it) · area-eraser
// (background-coloured brush).

import { useEffect, useRef, useState } from "react";
import type { Point, Stroke, PenStyle } from "../api/whiteboard";
import { uploadWhiteboardImage } from "../api/chat";
import { Pen, Pencil, Highlighter, Feather, PenTool, Eraser, Circle, Crosshair, Type, Image as ImageIcon, Download, Trash2, MousePointer2, Square, Minus, MoveRight, Shapes, Undo2, Redo2, Grid3x3, X } from "lucide-react";

export const BOARD_W = 1000;
export const BOARD_H = 600;

export type Tool = "pen" | "stroke-erase" | "area-erase" | "laser" | "text" | "select" | "rect" | "circle" | "line" | "arrow";

const SHAPE_TOOLS: Tool[] = ["rect", "circle", "line", "arrow"];

// ── Palettes ──────────────────────────────────────────────────────────────────
export const BACKGROUNDS = [
  { label: "White", value: "#ffffff" },
  { label: "Black", value: "#1a1a1a" },
  { label: "Theme", value: "#14130f" }, // matches the site surface
  { label: "Cream", value: "#f4ecd8" },
  { label: "Beige", value: "#d9c9a3" },
];
export const DEFAULT_BG = BACKGROUNDS[0].value;

// Mix of dark + light inks so a colour is legible on any background.
export const PEN_COLORS = [
  "#1a1a1a", "#e8e4d8", "#c49a3c", "#d94f4f",
  "#4f86d9", "#5bbf72", "#b06fc4", "#e08a3c",
];

// Five thickness presets (base widths) for pens; eraser has its own sizes.
export const PEN_WIDTHS   = [2, 4, 7, 11, 16];
export const ERASER_SIZES = [16, 28, 44, 64, 90];

export const PEN_STYLES: { value: PenStyle; label: string; icon: any }[] = [
  { value: "normal",      label: "Pen",         icon: Pen },
  { value: "highlighter", label: "Highlighter", icon: Highlighter },
  { value: "pencil",      label: "Pencil",      icon: Pencil },
  { value: "ink",         label: "Ink",         icon: Feather },
  { value: "marker",      label: "Marker",      icon: PenTool },
];

// ── Stroke rendering ──────────────────────────────────────────────────────────
function dist(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

type PenOnlyStroke = { mode: "pen" | "erase"; style: PenStyle; color: string; width: number; points: Point[] };
function drawStroke(ctx: CanvasRenderingContext2D, s: PenOnlyStroke, bgColor: string) {
  const pts = s.points;
  if (!pts || pts.length === 0) return;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.globalCompositeOperation = "source-over";

  // Area eraser: paint over with the current background colour so it covers
  // whatever is underneath. No destination-out, so it can never punch through
  // to other users' strokes unexpectedly.
  if (s.mode === "erase") {
    ctx.globalAlpha = 1;
    ctx.strokeStyle = bgColor;
    ctx.fillStyle = bgColor;
    ctx.lineWidth = s.width;
    strokePath(ctx, pts, s.width);
    ctx.restore();
    return;
  }

  switch (s.style) {
    case "highlighter":
      ctx.globalAlpha = 0.32;
      ctx.lineCap = "butt";
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.width * 2.4;
      strokePath(ctx, pts, s.width * 2.4);
      break;

    case "pencil":
      ctx.globalAlpha = 0.8;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = Math.max(1, s.width * 0.8);
      strokePath(ctx, pts, ctx.lineWidth, true);
      break;

    case "marker":
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.width * 1.8;
      ctx.shadowBlur = s.width * 0.7;
      ctx.shadowColor = s.color;
      strokePath(ctx, pts, s.width * 1.8, true);
      break;

    case "ink": {
      // Calligraphy feel: width modulated by drawing speed (slow = thick).
      ctx.globalAlpha = 1;
      ctx.strokeStyle = s.color;
      const base = s.width * 1.4;
      if (pts.length === 1) { dot(ctx, pts[0], base / 2, s.color); break; }
      for (let i = 1; i < pts.length; i++) {
        const speed = dist(pts[i], pts[i - 1]);
        const w = Math.max(base * 0.35, base * (1.5 - speed / 22));
        ctx.lineWidth = w;
        ctx.beginPath();
        ctx.moveTo(pts[i - 1].x, pts[i - 1].y);
        ctx.lineTo(pts[i].x, pts[i].y);
        ctx.stroke();
      }
      break;
    }

    case "text": {
      const pt = pts[0] as any;
      if (!pt?.t) break;
      ctx.globalAlpha = 1;
      ctx.fillStyle = s.color;
      ctx.font = `bold ${s.width}px sans-serif`;
      ctx.textBaseline = "middle";
      ctx.fillText(pt.t, pt.x, pt.y);
      break;
    }

    case "rect": {
      if (pts.length < 2) break;
      ctx.globalAlpha = 1;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.width;
      const rx = Math.min(pts[0].x, pts[1].x), ry = Math.min(pts[0].y, pts[1].y);
      const rw = Math.abs(pts[1].x - pts[0].x), rh = Math.abs(pts[1].y - pts[0].y);
      ctx.strokeRect(rx, ry, rw, rh);
      break;
    }

    case "circle": {
      if (pts.length < 2) break;
      ctx.globalAlpha = 1;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.width;
      const ecx = (pts[0].x + pts[1].x) / 2, ecy = (pts[0].y + pts[1].y) / 2;
      const erx = Math.abs(pts[1].x - pts[0].x) / 2, ery = Math.abs(pts[1].y - pts[0].y) / 2;
      ctx.beginPath();
      ctx.ellipse(ecx, ecy, Math.max(erx, 1), Math.max(ery, 1), 0, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }

    case "line": {
      if (pts.length < 2) break;
      ctx.globalAlpha = 1;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.width;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      ctx.lineTo(pts[1].x, pts[1].y);
      ctx.stroke();
      break;
    }

    case "arrow": {
      if (pts.length < 2) break;
      ctx.globalAlpha = 1;
      ctx.strokeStyle = s.color;
      ctx.fillStyle = s.color;
      ctx.lineWidth = s.width;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      ctx.lineTo(pts[1].x, pts[1].y);
      ctx.stroke();
      const ang = Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x);
      const headLen = Math.max(12, s.width * 4);
      ctx.beginPath();
      ctx.moveTo(pts[1].x, pts[1].y);
      ctx.lineTo(pts[1].x - headLen * Math.cos(ang - Math.PI / 6), pts[1].y - headLen * Math.sin(ang - Math.PI / 6));
      ctx.lineTo(pts[1].x - headLen * Math.cos(ang + Math.PI / 6), pts[1].y - headLen * Math.sin(ang + Math.PI / 6));
      ctx.closePath();
      ctx.fill();
      break;
    }

    case "normal":
    default:
      ctx.globalAlpha = 1;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.width;
      strokePath(ctx, pts, s.width, true);
      break;
  }
  ctx.restore();
}

function strokePath(ctx: CanvasRenderingContext2D, pts: Point[], width: number, smooth = false) {
  if (pts.length === 1) {
    dot(ctx, pts[0], Math.max(0.5, width / 2), ctx.strokeStyle as string);
    return;
  }
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  if (smooth && pts.length > 2) {
    // Quadratic Bézier smoothing: use each sampled point as a control point and
    // the midpoint between consecutive samples as the curve endpoint. This produces
    // a smooth curve that passes approximately through all sampled points with zero
    // mathematical overhead compared to raw lineTo.
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i].x + pts[i + 1].x) / 2;
      const my = (pts[i].y + pts[i + 1].y) / 2;
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
    }
    // Close to the last point with a straight line segment.
    ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
  } else {
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  }
  ctx.stroke();
}

function dot(ctx: CanvasRenderingContext2D, p: Point, r: number, fill: string) {
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
}

// Distance from point p to segment a-b (board space) — for the stroke eraser.
function distToSeg(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return dist(p, a);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return dist(p, { x: a.x + t * dx, y: a.y + t * dy });
}

function hitStroke(p: Point, s: Stroke, tol: number): boolean {
  const r = tol + (s.width || 2) / 2;
  const pts = s.points;
  if (pts.length === 1) return dist(p, pts[0]) <= r;
  for (let i = 1; i < pts.length; i++) {
    if (distToSeg(p, pts[i - 1], pts[i]) <= r) return true;
  }
  return false;
}

const SHAPE_STYLES = ["rect", "circle", "line", "arrow"];

function strokeBounds(s: { style: PenStyle; points: Point[] }): { x1: number; y1: number; x2: number; y2: number } | null {
  if (!s.points || s.points.length === 0) return null;
  if (SHAPE_STYLES.includes(s.style) && s.points.length >= 2) {
    const [p0, p1] = s.points;
    return { x1: Math.min(p0.x, p1.x), y1: Math.min(p0.y, p1.y), x2: Math.max(p0.x, p1.x), y2: Math.max(p0.y, p1.y) };
  }
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const p of s.points) {
    if (p.x < x1) x1 = p.x; if (p.x > x2) x2 = p.x;
    if (p.y < y1) y1 = p.y; if (p.y > y2) y2 = p.y;
  }
  return x1 === Infinity ? null : { x1, y1, x2, y2 };
}

function hitForSelect(p: Point, s: Stroke): boolean {
  if (s.mode === "image") {
    const pad = 8;
    return p.x >= (s.x ?? 0) - pad && p.x <= (s.x ?? 0) + (s.w ?? 0) + pad &&
           p.y >= (s.y ?? 0) - pad && p.y <= (s.y ?? 0) + (s.h ?? 0) + pad;
  }
  if (SHAPE_STYLES.includes(s.style)) {
    const b = strokeBounds(s);
    if (!b) return false;
    const tol = Math.max(8, (s.width || 2) / 2 + 4);
    return p.x >= b.x1 - tol && p.x <= b.x2 + tol && p.y >= b.y1 - tol && p.y <= b.y2 + tol;
  }
  return hitStroke(p, s, 12);
}

const IMG_HANDLE_R = 10; // board-px hit radius for corner handles

function hitImageHandle(pt: Point, s: Stroke): "nw" | "ne" | "sw" | "se" | null {
  if (s.mode !== "image") return null;
  const x = s.x ?? 0, y = s.y ?? 0, w = s.w ?? 0, h = s.h ?? 0;
  const corners: Array<["nw" | "ne" | "sw" | "se", number, number]> = [
    ["nw", x, y], ["ne", x + w, y], ["sw", x, y + h], ["se", x + w, y + h],
  ];
  for (const [name, cx, cy] of corners) {
    if (Math.abs(pt.x - cx) <= IMG_HANDLE_R && Math.abs(pt.y - cy) <= IMG_HANDLE_R) return name;
  }
  return null;
}

type ImageStroke = { mode: "image"; url: string; x: number; y: number; w: number; h: number };
type PenStroke   = { mode: "pen" | "erase"; style: PenStyle; color: string; width: number; points: Point[] };

export default function Whiteboard({
  strokes, liveStrokes, tool, style, color, penWidth, eraserSize, bg,
  onToolChange, onStyleChange, onColorChange, onPenWidthChange, onEraserSizeChange, onBgChange,
  onStrokeComplete, onEraseStroke, onMoveStroke, onReplaceImageStroke, onLiveStroke, onClear,
  canUndo, canRedo, onUndo, onRedo,
  peerCursors, laserPositions, onCursorMove, onLaserMove,
  onClose, activeSpeaker, roomId,
}: {
  strokes: Stroke[];
  liveStrokes?: Record<string, { mode: "pen" | "erase"; style: PenStyle; color: string; width: number; points: Point[] }>;
  tool: Tool; style: PenStyle; color: string; penWidth: number; eraserSize: number; bg: string;
  onToolChange: (t: Tool) => void;
  onStyleChange: (s: PenStyle) => void;
  onColorChange: (c: string) => void;
  onPenWidthChange: (w: number) => void;
  onEraserSizeChange: (w: number) => void;
  onBgChange: (c: string) => void;
  onStrokeComplete: (s: PenStroke | ImageStroke) => void;
  onEraseStroke: (strokeId: string) => void;
  onMoveStroke?: (strokeId: string, dx: number, dy: number) => void;
  onReplaceImageStroke?: (oldId: string, newData: ImageStroke) => void;
  onLiveStroke?: (s: PenStroke | null) => void;
  onClear: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  peerCursors?: Record<string, { x: number; y: number; name: string; color: string }>;
  laserPositions?: Record<string, { x: number; y: number; active: boolean }>;
  onCursorMove?: (x: number | null, y: number | null) => void;
  onLaserMove?: (pos: { x: number; y: number } | null) => void;
  onClose: () => void;
  /** Name of the currently speaking voice participant — shown as a pill in the header. */
  activeSpeaker?: string | null;
  /** Room ID — required to upload images to the correct storage path. */
  roomId?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const currentRef = useRef<Point[]>([]);
  const [localLaser, setLocalLaser] = useState<{ x: number; y: number } | null>(null);
  const [textInput, setTextInput] = useState<{ x: number; y: number } | null>(null);
  const [showGrid, setShowGrid]     = useState(false);
  const [showHelp, setShowHelp]     = useState(false);
  const showGridRef = useRef(false);
  const [imgUploading, setImgUploading] = useState(false);
  const imageCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imgOffsetRef = useRef(0); // cycles 0→30→60→...→150→0 to stagger placements
  const erasedThisDragRef = useRef<Set<string>>(new Set());
  const selectedRef = useRef<string | null>(null);
  const selectDragStartRef = useRef<Point | null>(null);
  const selectDragDeltaRef = useRef<{ dx: number; dy: number }>({ dx: 0, dy: 0 });
  const resizeHandleRef = useRef<"nw" | "ne" | "sw" | "se" | null>(null);
  const resizeStartRef = useRef<{ bx: number; by: number; bw: number; bh: number; px: number; py: number } | null>(null);
  const resizeRectRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  // Snapshot of the canvas at the start of each stroke. Restored on every
  // pointermove before drawing the in-progress stroke so committed strokes
  // are preserved regardless of React render timing.
  const snapshotRef = useRef<ImageData | null>(null);

  // ── Zoom / pan state ───────────────────────────────────────────────────────
  // zoom: CSS scale applied to the canvas wrapper (1 = 100%, range 0.2–4).
  // pan: offset in CSS pixels applied via translate BEFORE scale (i.e. in
  //      screen space so the canvas centre is the zoom origin).
  const [zoom, setZoom]   = useState(1);
  const [pan,  setPan]    = useState({ x: 0, y: 0 });
  const zoomRef = useRef(1);
  const panRef  = useRef({ x: 0, y: 0 });
  // Keeps refs in sync so pointer-event callbacks never read stale state.
  zoomRef.current = zoom;
  panRef.current  = pan;

  // Track active pointers for pinch-to-zoom on mobile.
  const activePointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  // Distance between two fingers at the start of a pinch.
  const pinchStartDistRef  = useRef<number | null>(null);
  const pinchStartZoomRef  = useRef<number>(1);
  // Whether current multi-touch is a pan (two fingers moving together) or zoom.
  const panStartRef = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null);

  // Live values for pointer handlers (avoid stale closures / re-binding).
  const toolRef   = useRef(tool);       toolRef.current = tool;
  const styleRef  = useRef(style);      styleRef.current = style;
  const colorRef  = useRef(color);      colorRef.current = color;
  const penWRef   = useRef(penWidth);   penWRef.current = penWidth;
  const eraserRef = useRef(eraserSize); eraserRef.current = eraserSize;
  const strokesRef = useRef(strokes);   strokesRef.current = strokes;
  const liveStrokesRef = useRef(liveStrokes ?? {}); liveStrokesRef.current = liveStrokes ?? {};

  // Draw the whole board: background, every committed stroke in order, then every
  // in-progress stroke (the local one + remote peers'). One pass, always additive.
  function render() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, BOARD_W, BOARD_H);

    // Optional grid overlay — drawn after BG fill so it sits under all strokes.
    if (showGridRef.current) {
      const GRID = 50; // board-space pixels between grid lines
      ctx.save();
      ctx.globalAlpha = 0.12;
      ctx.strokeStyle = bg === "#ffffff" || bg === "#f4ecd8" || bg === "#d9c9a3" ? "#000" : "#fff";
      ctx.lineWidth = 0.5;
      ctx.setLineDash([2, 3]);
      for (let x = GRID; x < BOARD_W; x += GRID) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, BOARD_H); ctx.stroke();
      }
      for (let y = GRID; y < BOARD_H; y += GRID) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(BOARD_W, y); ctx.stroke();
      }
      ctx.restore();
    }

    const selId = selectedRef.current;
    const delta = selectDragDeltaRef.current;
    const hasDelta = delta.dx !== 0 || delta.dy !== 0;

    for (const s of strokesRef.current) {
      if (s.mode === "image") {
        // Ensure the image is loading; draw once it arrives.
        if (s.url && !imageCacheRef.current.has(s.url)) {
          const img = new window.Image();
          img.crossOrigin = "anonymous";
          img.onload = () => render();
          img.src = s.url;
          imageCacheRef.current.set(s.url, img);
        }
        const isSelected = selId === s.id && toolRef.current === "select";
        // Live resize rect takes priority; otherwise apply move delta.
        const liveRect = isSelected && resizeRectRef.current;
        const rx = liveRect ? liveRect.x : (s.x ?? 0);
        const ry = liveRect ? liveRect.y : (s.y ?? 0);
        const rw = liveRect ? liveRect.w : (s.w ?? 0);
        const rh = liveRect ? liveRect.h : (s.h ?? 0);
        const moveX = (isSelected && hasDelta && !resizeRectRef.current) ? delta.dx : 0;
        const moveY = (isSelected && hasDelta && !resizeRectRef.current) ? delta.dy : 0;

        const img = s.url ? imageCacheRef.current.get(s.url) : undefined;
        if (img && img.complete && img.naturalWidth > 0) {
          ctx.drawImage(img, rx + moveX, ry + moveY, rw, rh);
        } else {
          // Placeholder while loading.
          ctx.save();
          ctx.strokeStyle = "rgba(150,150,150,0.5)";
          ctx.lineWidth = 1;
          ctx.setLineDash([4, 4]);
          ctx.strokeRect(rx + moveX, ry + moveY, rw, rh);
          ctx.restore();
        }

        // Selection border + corner resize handles.
        if (isSelected) {
          ctx.save();
          ctx.strokeStyle = "#4f86d9";
          ctx.lineWidth = 1.5;
          ctx.setLineDash([5, 4]);
          ctx.globalAlpha = 0.9;
          ctx.strokeRect(rx + moveX, ry + moveY, rw, rh);
          ctx.setLineDash([]);
          ctx.fillStyle = "#ffffff";
          ctx.strokeStyle = "#4f86d9";
          ctx.lineWidth = 1.5;
          const H = 6;
          for (const [hx, hy] of [
            [rx + moveX, ry + moveY], [rx + moveX + rw, ry + moveY],
            [rx + moveX, ry + moveY + rh], [rx + moveX + rw, ry + moveY + rh],
          ]) {
            ctx.fillRect(hx - H, hy - H, H * 2, H * 2);
            ctx.strokeRect(hx - H, hy - H, H * 2, H * 2);
          }
          ctx.restore();
        }
      } else if (selId && s.id === selId && hasDelta) {
        const moved = { ...s, points: (s.points ?? []).map(p => ({ ...p, x: p.x + delta.dx, y: p.y + delta.dy })) };
        drawStroke(ctx, moved as PenOnlyStroke, bg);
      } else {
        drawStroke(ctx, s as PenOnlyStroke, bg);
      }
    }

    // Selection bounding box overlay (pen strokes only — images draw their own)
    if (selId && toolRef.current === "select") {
      const s = strokesRef.current.find(s => s.id === selId);
      if (s && s.mode !== "image") {
        const effPts = hasDelta ? (s.points ?? []).map(p => ({ ...p, x: p.x + delta.dx, y: p.y + delta.dy })) : (s.points ?? []);
        const b = strokeBounds({ style: s.style, points: effPts });
        if (b) {
          ctx.save();
          ctx.strokeStyle = "#4f86d9";
          ctx.lineWidth = 1.5;
          ctx.setLineDash([5, 4]);
          ctx.globalAlpha = 0.85;
          const pad = 6;
          ctx.strokeRect(b.x1 - pad, b.y1 - pad, b.x2 - b.x1 + pad * 2, b.y2 - b.y1 + pad * 2);
          ctx.restore();
        }
      }
    }

    // Remote peers' in-progress strokes.
    for (const draft of Object.values(liveStrokesRef.current)) {
      drawStroke(ctx, draft, bg);
    }

    // The local in-progress stroke, drawn last so it sits on top.
    const isShapeTool = SHAPE_TOOLS.includes(toolRef.current);
    if (drawingRef.current && currentRef.current.length &&
        toolRef.current !== "stroke-erase" && toolRef.current !== "laser" &&
        toolRef.current !== "text" && toolRef.current !== "select") {
      drawStroke(ctx, {
        mode: toolRef.current === "area-erase" ? "erase" : "pen",
        style: isShapeTool ? toolRef.current as PenStyle : styleRef.current,
        color: colorRef.current,
        width: toolRef.current === "area-erase" ? eraserRef.current : penWRef.current,
        points: currentRef.current,
      }, bg);
    }
  }

  useEffect(() => { render(); }, [strokes]);      // eslint-disable-line
  useEffect(() => {
    // Null the in-progress snapshot so the next pointer move re-renders from the
    // full stroke list using the new bg — prevents erase strokes baked at the old
    // bg colour from showing as visible blobs after a background change.
    snapshotRef.current = null;
    render();
  }, [bg]);           // eslint-disable-line
  useEffect(() => { render(); }, [liveStrokes]);  // eslint-disable-line
  useEffect(() => { showGridRef.current = showGrid; render(); }, [showGrid]); // eslint-disable-line

  // Keep a ref to finishStroke so the global listener always calls the latest version.
  const finishStrokeRef = useRef<() => void>(() => {});

  // Global pointerup/pointercancel — fires even when the finger is lifted outside
  // the canvas or when iOS Safari drops pointer capture mid-stroke.
  useEffect(() => {
    function globalUp() { if (drawingRef.current) finishStrokeRef.current(); }
    window.addEventListener("pointerup",     globalUp);
    window.addEventListener("pointercancel", globalUp);
    return () => {
      window.removeEventListener("pointerup",     globalUp);
      window.removeEventListener("pointercancel", globalUp);
    };
  }, []);

  // Keyboard shortcuts for tools + delete-to-erase for selected stroke.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if ((e.target as HTMLElement).isContentEditable) return;

      // Undo / Redo — delegate to parent handlers.
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === "z") { e.preventDefault(); onUndo?.(); return; }
      if ((e.ctrlKey || e.metaKey) && (e.shiftKey ? e.key === "Z" : e.key === "y")) { e.preventDefault(); onRedo?.(); return; }

      // Skip all other shortcuts when a modifier is held.
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      // Delete / Backspace → erase selected stroke.
      if ((e.key === "Delete" || e.key === "Backspace") && toolRef.current === "select") {
        if (selectedRef.current) { onEraseStroke(selectedRef.current); selectedRef.current = null; render(); }
        return;
      }

      // Tool hotkeys.
      const map: Record<string, Tool> = {
        p: "pen", e: "stroke-erase", a: "area-erase",
        l: "laser", t: "text", s: "select",
        r: "rect",
      };
      if (e.key in map) { e.preventDefault(); onToolChange(map[e.key]); return; }
      if (e.key === "Escape") { e.preventDefault(); onToolChange("pen"); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onToolChange, onUndo, onRedo, onEraseStroke]); // eslint-disable-line

  // Paste (Ctrl+V) and drag-and-drop image upload.
  useEffect(() => {
    if (!roomId) return;

    async function handleImageFile(file: File, boardX: number, boardY: number) {
      if (!file.type.startsWith("image/")) return;
      setImgUploading(true);
      try {
        const url = await uploadWhiteboardImage(roomId!, file);
        // Measure natural dimensions so we can preserve aspect ratio.
        const img = new window.Image();
        img.src = url;
        await new Promise(res => { img.onload = res; img.onerror = res; });
        const aspect = img.naturalWidth / (img.naturalHeight || 1);
        const maxW = 400, maxH = 300;
        let w = maxW, h = maxW / aspect;
        if (h > maxH) { h = maxH; w = maxH * aspect; }
        // Stagger so pasted images don't all stack at the exact same position.
        const off = imgOffsetRef.current;
        imgOffsetRef.current = (off + 40) % 200;
        const x = Math.max(0, Math.min(BOARD_W - Math.round(w), Math.round(boardX - w / 2) + off));
        const y = Math.max(0, Math.min(BOARD_H - Math.round(h), Math.round(boardY - h / 2) + off));
        onStrokeComplete({ mode: "image", url, x, y, w: Math.round(w), h: Math.round(h) });
      } catch (err: any) {
        alert("Image upload failed: " + (err?.message ?? "unknown error"));
      } finally {
        setImgUploading(false);
      }
    }

    async function onPaste(e: ClipboardEvent) {
      const item = Array.from(e.clipboardData?.items ?? []).find(i => i.type.startsWith("image/"));
      if (!item) return;
      e.preventDefault();
      const file = item.getAsFile();
      if (!file) return;
      // Place at centre of the visible board area.
      await handleImageFile(file, BOARD_W / 2, BOARD_H / 2);
    }

    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [roomId, onStrokeComplete]); // eslint-disable-line

  // Convert a pointer-event client position → board coordinate space (0–BOARD_W × 0–BOARD_H).
  // The canvas element is CSS-scaled via `zoom`, so we divide the CSS pixel offset by
  // (zoom × CSS canvas size / board size) to get board pixels.
  function toBoard(e: React.PointerEvent): Point {
    const r = canvasRef.current!.getBoundingClientRect();
    return {
      x: Math.round(((e.clientX - r.left) / r.width)  * BOARD_W),
      y: Math.round(((e.clientY - r.top)  / r.height) * BOARD_H),
    };
  }

  // ── Zoom helpers ───────────────────────────────────────────────────────────
  const MIN_ZOOM = 0.2;
  const MAX_ZOOM = 4.0;

  function applyZoom(nextZoom: number, focalClientX: number, focalClientY: number) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const r = canvas.getBoundingClientRect();
    // Focal point in board space BEFORE the zoom change.
    const focalBoardX = ((focalClientX - r.left) / r.width)  * BOARD_W;
    const focalBoardY = ((focalClientY - r.top)  / r.height) * BOARD_H;
    const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, nextZoom));
    setZoom(clamped);
    zoomRef.current = clamped;
    // Adjust pan so the focal point stays fixed on screen.
    // After the zoom, the focal board point maps to a different screen position;
    // we compensate with a pan delta so it looks like we zoomed around that point.
    // (The canvas uses transform-origin: 0 0, so scale grows from top-left of the wrapper.)
    const scale = clamped / zoomRef.current;
    setPan(p => {
      const nx = focalClientX - (focalClientX - p.x) * (clamped / zoom);
      const ny = focalClientY - (focalClientY - p.y) * (clamped / zoom);
      // Suppress lint: zoom is captured from component scope intentionally.
      void focalBoardX; void focalBoardY; void scale;
      return { x: nx, y: ny };
    });
  }

  function resetZoom() {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    zoomRef.current = 1;
    panRef.current = { x: 0, y: 0 };
  }

  // Ctrl+wheel zoom on desktop.
  useEffect(() => {
    const el = canvasRef.current?.parentElement;
    if (!el) return;
    function onWheel(e: WheelEvent) {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.1 : 0.9;
      const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoomRef.current * factor));
      const canvas = canvasRef.current;
      if (!canvas) return;
      const r = canvas.getBoundingClientRect();
      const focalBX = ((e.clientX - r.left) / r.width)  * BOARD_W;
      const focalBY = ((e.clientY - r.top)  / r.height) * BOARD_H;
      void focalBX; void focalBY;
      const ratio = nextZoom / zoomRef.current;
      zoomRef.current = nextZoom;
      setZoom(nextZoom);
      setPan(p => ({ x: e.clientX - (e.clientX - p.x) * ratio, y: e.clientY - (e.clientY - p.y) * ratio }));
    }
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Middle-mouse-button drag to pan on desktop.
  const mmPanRef = useRef<{ startX: number; startY: number; startPan: { x: number; y: number } } | null>(null);
  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (e.button !== 1) return;
      e.preventDefault();
      mmPanRef.current = { startX: e.clientX, startY: e.clientY, startPan: { ...panRef.current } };
    }
    function onMouseMove(e: MouseEvent) {
      if (!mmPanRef.current) return;
      const dx = e.clientX - mmPanRef.current.startX;
      const dy = e.clientY - mmPanRef.current.startY;
      const np = { x: mmPanRef.current.startPan.x + dx, y: mmPanRef.current.startPan.y + dy };
      panRef.current = np;
      setPan(np);
    }
    function onMouseUp(e: MouseEvent) {
      if (e.button !== 1) return;
      mmPanRef.current = null;
    }
    window.addEventListener("mousedown",  onMouseDown);
    window.addEventListener("mousemove",  onMouseMove);
    window.addEventListener("mouseup",    onMouseUp);
    return () => {
      window.removeEventListener("mousedown",  onMouseDown);
      window.removeEventListener("mousemove",  onMouseMove);
      window.removeEventListener("mouseup",    onMouseUp);
    };
  }, []);

  // Stroke eraser: delete the topmost stroke under the pointer (drag erases more).
  function eraseAt(p: Point) {
    const list = strokesRef.current;
    for (let i = list.length - 1; i >= 0; i--) {
      const s = list[i];
      if (erasedThisDragRef.current.has(s.id)) continue;
      const hit = s.mode === "image"
        ? p.x >= (s.x ?? 0) && p.x <= (s.x ?? 0) + (s.w ?? 0) && p.y >= (s.y ?? 0) && p.y <= (s.y ?? 0) + (s.h ?? 0)
        : hitStroke(p, s, 20);
      if (hit) {
        erasedThisDragRef.current.add(s.id);
        onEraseStroke(s.id);
        return; // one per move tick keeps it predictable
      }
    }
  }

  function onPointerDown(e: React.PointerEvent) {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);

    // Track all active pointers for pinch/pan detection.
    activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    // 2+ fingers → pinch-to-zoom or two-finger pan.  Stop any in-progress draw.
    if (activePointersRef.current.size >= 2) {
      if (drawingRef.current) finishStrokeRef.current();
      drawingRef.current = false;
      const pts = Array.from(activePointersRef.current.values());
      pinchStartDistRef.current = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      pinchStartZoomRef.current = zoomRef.current;
      const cx = (pts[0].x + pts[1].x) / 2;
      const cy = (pts[0].y + pts[1].y) / 2;
      panStartRef.current = { px: cx, py: cy, ox: panRef.current.x, oy: panRef.current.y };
      return;
    }

    const pt = toBoard(e);
    if (toolRef.current === "text") {
      setTextInput({ x: pt.x, y: pt.y });
      return;
    }
    if (toolRef.current === "select") {
      // Check if pointer lands on a resize handle of the currently selected image.
      const selStroke = strokesRef.current.find(s => s.id === selectedRef.current);
      if (selStroke?.mode === "image") {
        const handle = hitImageHandle(pt, selStroke);
        if (handle) {
          resizeHandleRef.current = handle;
          resizeStartRef.current = {
            bx: selStroke.x ?? 0, by: selStroke.y ?? 0,
            bw: selStroke.w ?? 0, bh: selStroke.h ?? 0,
            px: pt.x, py: pt.y,
          };
          resizeRectRef.current = { x: selStroke.x ?? 0, y: selStroke.y ?? 0, w: selStroke.w ?? 0, h: selStroke.h ?? 0 };
          drawingRef.current = true;
          return;
        }
      }
      const list = strokesRef.current;
      let found: Stroke | null = null;
      for (let i = list.length - 1; i >= 0; i--) {
        if (hitForSelect(pt, list[i])) { found = list[i]; break; }
      }
      selectedRef.current = found?.id ?? null;
      selectDragStartRef.current = found ? pt : null;
      selectDragDeltaRef.current = { dx: 0, dy: 0 };
      resizeHandleRef.current = null;
      resizeStartRef.current = null;
      resizeRectRef.current = null;
      if (found) drawingRef.current = true;
      render();
      return;
    }
    drawingRef.current = true;
    if (toolRef.current === "laser") {
      setLocalLaser(pt);
      onLaserMove?.({ x: pt.x, y: pt.y });
      return;
    }
    if (toolRef.current === "stroke-erase") {
      erasedThisDragRef.current = new Set();
      eraseAt(pt);
      return;
    }
    currentRef.current = [pt];
    // Snapshot the canvas now so onPointerMove can restore it before drawing
    // the in-progress stroke — preserves committed strokes with no React dependency.
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext("2d")!;
      snapshotRef.current = ctx.getImageData(0, 0, BOARD_W, BOARD_H);
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    // Update tracked position for this pointer.
    activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    // Pinch-to-zoom / two-finger pan.
    if (activePointersRef.current.size >= 2) {
      const pts = Array.from(activePointersRef.current.values());
      const cx = (pts[0].x + pts[1].x) / 2;
      const cy = (pts[0].y + pts[1].y) / 2;

      // Zoom: scale based on change in finger spread.
      if (pinchStartDistRef.current !== null) {
        const curDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
        const ratio   = curDist / pinchStartDistRef.current;
        const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, pinchStartZoomRef.current * ratio));
        zoomRef.current = nextZoom;
        setZoom(nextZoom);
      }

      // Pan: translate by how much the centroid has moved since pinch started.
      if (panStartRef.current) {
        const dx = cx - panStartRef.current.px;
        const dy = cy - panStartRef.current.py;
        const np = { x: panStartRef.current.ox + dx, y: panStartRef.current.oy + dy };
        panRef.current = np;
        setPan(np);
      }
      return;
    }

    const pt = toBoard(e);
    // Always broadcast cursor position for live-cursor feature (throttled in parent).
    onCursorMove?.(pt.x, pt.y);

    // Select tool: resize or move
    if (toolRef.current === "select") {
      if (drawingRef.current && selectedRef.current) {
        if (resizeHandleRef.current && resizeStartRef.current) {
          // Live resize: compute new rect from the dragged corner.
          const { bx, by, bw, bh, px, py } = resizeStartRef.current;
          const dx = pt.x - px, dy = pt.y - py;
          const MIN = 20;
          let nx = bx, ny = by, nw = bw, nh = bh;
          const h = resizeHandleRef.current;
          if (h === "se") {
            nw = Math.max(MIN, bw + dx); nh = Math.max(MIN, bh + dy);
          } else if (h === "ne") {
            nw = Math.max(MIN, bw + dx);
            nh = Math.max(MIN, bh - dy); ny = nh === MIN ? by + bh - MIN : by + dy;
          } else if (h === "sw") {
            nw = Math.max(MIN, bw - dx); nx = nw === MIN ? bx + bw - MIN : bx + dx;
            nh = Math.max(MIN, bh + dy);
          } else {
            nw = Math.max(MIN, bw - dx); nx = nw === MIN ? bx + bw - MIN : bx + dx;
            nh = Math.max(MIN, bh - dy); ny = nh === MIN ? by + bh - MIN : by + dy;
          }
          resizeRectRef.current = { x: Math.round(nx), y: Math.round(ny), w: Math.round(nw), h: Math.round(nh) };
          render();
        } else if (selectDragStartRef.current) {
          selectDragDeltaRef.current = { dx: pt.x - selectDragStartRef.current.x, dy: pt.y - selectDragStartRef.current.y };
          render();
        }
      }
      return;
    }

    if (!drawingRef.current) return;
    if (toolRef.current === "laser") {
      setLocalLaser(pt);
      onLaserMove?.({ x: pt.x, y: pt.y });
      return;
    }
    if (toolRef.current === "stroke-erase") { eraseAt(pt); return; }

    // Shape tools: keep only [start, currentPt] for preview.
    // Holding Shift constrains: rect → square, line/arrow → nearest 45°.
    if (SHAPE_TOOLS.includes(toolRef.current)) {
      let end = pt;
      const start = currentRef.current[0] ?? pt;
      if (e.shiftKey) {
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        if (toolRef.current === "rect") {
          const side = Math.max(Math.abs(dx), Math.abs(dy));
          end = { x: start.x + Math.sign(dx) * side, y: start.y + Math.sign(dy) * side };
        } else if (toolRef.current === "line" || toolRef.current === "arrow") {
          const angle = Math.atan2(dy, dx);
          const snap  = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
          const len   = Math.hypot(dx, dy);
          end = { x: Math.round(start.x + Math.cos(snap) * len), y: Math.round(start.y + Math.sin(snap) * len) };
        }
      }
      currentRef.current = [start, end];
      const canvas = canvasRef.current;
      if (canvas && snapshotRef.current) {
        const ctx = canvas.getContext("2d")!;
        ctx.putImageData(snapshotRef.current, 0, 0);
        drawStroke(ctx, {
          mode: "pen",
          style: toolRef.current as PenStyle,
          color: colorRef.current,
          width: penWRef.current,
          points: currentRef.current,
        }, bg);
      }
      onLiveStroke?.({ mode: "pen", style: toolRef.current as PenStyle, color: colorRef.current, width: penWRef.current, points: currentRef.current });
      return;
    }

    currentRef.current.push(pt);
    // Restore snapshot (committed strokes) then draw in-progress stroke on top.
    // This never touches the strokes React prop so stale closures can't wipe work.
    const canvas = canvasRef.current;
    if (canvas && snapshotRef.current) {
      const ctx = canvas.getContext("2d")!;
      ctx.putImageData(snapshotRef.current, 0, 0);
      if (currentRef.current.length && toolRef.current !== "area-erase") {
        drawStroke(ctx, {
          mode: "pen",
          style: styleRef.current,
          color: colorRef.current,
          width: penWRef.current,
          points: currentRef.current,
        }, bg);
      }
    }
    onLiveStroke?.({
      mode: toolRef.current === "area-erase" ? "erase" : "pen",
      style: styleRef.current,
      color: colorRef.current,
      width: toolRef.current === "area-erase" ? eraserRef.current : penWRef.current,
      points: currentRef.current,
    });
  }

  function finishStroke() {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    snapshotRef.current = null;
    if (toolRef.current === "select") {
      // Resize complete: replace the stroke with new dimensions.
      if (resizeHandleRef.current && resizeRectRef.current && selectedRef.current) {
        const oldId = selectedRef.current;
        const old = strokesRef.current.find(s => s.id === oldId);
        const newRect = resizeRectRef.current;
        if (old?.mode === "image" && old.url) {
          onReplaceImageStroke?.(oldId, { mode: "image", url: old.url, ...newRect });
        }
        resizeHandleRef.current = null;
        resizeStartRef.current = null;
        resizeRectRef.current = null;
        selectedRef.current = null;
        selectDragDeltaRef.current = { dx: 0, dy: 0 };
        render();
        return;
      }
      // Move complete.
      const delta = selectDragDeltaRef.current;
      if (selectedRef.current && (Math.abs(delta.dx) > 3 || Math.abs(delta.dy) > 3)) {
        onMoveStroke?.(selectedRef.current, delta.dx, delta.dy);
        selectedRef.current = null;
      }
      selectDragStartRef.current = null;
      selectDragDeltaRef.current = { dx: 0, dy: 0 };
      render();
      return;
    }
    if (toolRef.current === "laser") {
      setLocalLaser(null);
      onLaserMove?.(null);
      return;
    }
    if (toolRef.current === "stroke-erase") { erasedThisDragRef.current = new Set(); return; }
    const points = currentRef.current;
    currentRef.current = [];
    onLiveStroke?.(null);
    if (points.length === 0) return;
    if (SHAPE_TOOLS.includes(toolRef.current)) {
      if (points.length >= 2) {
        onStrokeComplete({
          mode: "pen",
          style: toolRef.current as PenStyle,
          color: colorRef.current,
          width: penWRef.current,
          points: [points[0], points[points.length - 1]],
        });
      }
      return;
    }
    const isErase = toolRef.current === "area-erase";
    const finished = {
      mode: (isErase ? "erase" : "pen") as "pen" | "erase",
      style: styleRef.current,
      color: colorRef.current,
      width: isErase ? eraserRef.current : penWRef.current,
      points,
    };
    onStrokeComplete(finished);
  }

  finishStrokeRef.current = finishStroke;

  function handlePointerUp(e: React.PointerEvent) {
    activePointersRef.current.delete(e.pointerId);
    if (activePointersRef.current.size < 2) {
      pinchStartDistRef.current = null;
      panStartRef.current = null;
    }
    finishStroke();
  }

  function handlePointerLeave() {
    finishStroke();
    onCursorMove?.(null, null);
  }

  function handleDragOver(e: React.DragEvent) {
    if (!roomId) return;
    if (Array.from(e.dataTransfer.items).some(i => i.type.startsWith("image/"))) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    }
  }

  async function handleDrop(e: React.DragEvent) {
    if (!roomId) return;
    const file = Array.from(e.dataTransfer.files).find(f => f.type.startsWith("image/"));
    if (!file) return;
    e.preventDefault();
    // Convert drop position to board coordinates.
    const canvas = canvasRef.current;
    const r = canvas?.getBoundingClientRect();
    const boardX = r ? Math.round(((e.clientX - r.left) / r.width)  * BOARD_W) : BOARD_W / 2;
    const boardY = r ? Math.round(((e.clientY - r.top)  / r.height) * BOARD_H) : BOARD_H / 2;
    setImgUploading(true);
    try {
      const url = await uploadWhiteboardImage(roomId, file);
      const img = new window.Image();
      img.src = url;
      await new Promise(res => { img.onload = res; img.onerror = res; });
      const aspect = img.naturalWidth / (img.naturalHeight || 1);
      const maxW = 400, maxH = 300;
      let w = maxW, h = maxW / aspect;
      if (h > maxH) { h = maxH; w = maxH * aspect; }
      const x = Math.round(boardX - w / 2);
      const y = Math.round(boardY - h / 2);
      onStrokeComplete({ mode: "image", url, x, y, w: Math.round(w), h: Math.round(h) });
    } catch (err: any) {
      alert("Image upload failed: " + (err?.message ?? "unknown error"));
    } finally {
      setImgUploading(false);
    }
  }

  async function handleFilePickerChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !roomId) return;
    e.target.value = "";
    setImgUploading(true);
    try {
      const url = await uploadWhiteboardImage(roomId, file);
      const img = new window.Image();
      img.crossOrigin = "anonymous";
      await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = rej; img.src = url; });
      const aspect = img.naturalWidth / (img.naturalHeight || 1);
      const w = Math.min(300, BOARD_W * 0.4);
      const h = Math.round(w / aspect);
      const off = imgOffsetRef.current;
      imgOffsetRef.current = (off + 40) % 200;
      const x = Math.max(0, Math.min(BOARD_W - w, Math.round((BOARD_W - w) / 2) + off));
      const y = Math.max(0, Math.min(BOARD_H - h, Math.round((BOARD_H - h) / 2) + off));
      imageCacheRef.current.set(url, img);
      onStrokeComplete({ mode: "image", url, x, y, w, h });
    } catch (err: any) {
      alert("Image upload failed: " + (err?.message ?? "unknown error"));
    } finally {
      setImgUploading(false);
    }
  }

  // ── Small UI helpers ────────────────────────────────────────────────────────
  const chip = (active: boolean, accent = "#c49a3c"): React.CSSProperties => ({
    padding: "6px 10px", fontSize: "12px", borderRadius: "8px", cursor: "pointer",
    fontFamily: "inherit", lineHeight: 1, whiteSpace: "nowrap",
    background: active ? "rgba(196,154,60,0.14)" : "rgba(255,255,255,0.05)",
    border: `1px solid ${active ? "rgba(196,154,60,0.35)" : "rgba(255,255,255,0.09)"}`,
    color: active ? accent : "var(--text-dim)",
  });

  const isPen = tool === "pen";
  const isText = tool === "text";
  const isShape = SHAPE_TOOLS.includes(tool);
  // Build a circular SVG cursor sized to the active tool's stroke radius.
  // r is in CSS pixels; hotspot is centred on the circle.
  function makeSizeCursor(r: number, strokeColor = "#333", fillColor = "none"): string {
    const safe = Math.max(2, Math.min(60, Math.round(r)));
    const size = (safe + 3) * 2;
    const c = safe + 3;
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}'>`
      + `<circle cx='${c}' cy='${c}' r='${safe}' fill='${fillColor}' stroke='${strokeColor}' stroke-width='1.5' opacity='0.85'/>`
      + (fillColor === "none" ? `<circle cx='${c}' cy='${c}' r='2' fill='${strokeColor}' opacity='0.85'/>` : "")
      + `</svg>`;
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${c} ${c}, crosshair`;
  }

  const cursor =
    tool === "pen"         ? makeSizeCursor(Math.max(2, Math.round(penWidth  / 2)))
    : tool === "area-erase" ? makeSizeCursor(Math.max(6, Math.round(eraserSize / 3)), "#888", "rgba(180,180,180,0.12)")
    : tool === "stroke-erase" ? "pointer"
    : tool === "laser"        ? "none"
    : tool === "text"         ? "text"
    : tool === "select"       ? "default"
    : "crosshair";
  const isCustomColor = !PEN_COLORS.includes(color);

  function handleTextCommit(text: string) {
    if (!text.trim() || !textInput) { setTextInput(null); return; }
    onStrokeComplete({
      mode: "pen",
      style: "text",
      color,
      width: penWidth * 3 + 6,
      points: [{ x: textInput.x, y: textInput.y, t: text.trim() }],
    });
    setTextInput(null);
  }

  function handleExport() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = "whiteboard.png";
    a.click();
  }

  return (
    <div style={{
      border: "1px solid rgba(196,154,60,0.2)", borderRadius: "14px",
      background: "rgba(196,154,60,0.03)", marginBottom: "20px", overflow: "hidden",
      touchAction: "none", overscrollBehavior: "none",
    }}>
      <style>{`@keyframes laserFade{to{opacity:0;transform:translate(-50%,-50%) scale(2.5)}}`}</style>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderBottom: "1px solid rgba(196,154,60,0.12)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
          <span style={{ display: "flex", color: "#c49a3c" }}><Pen size={15} /></span>
          <span style={{ fontSize: "13px", fontWeight: 600, color: "#c49a3c" }}>Whiteboard</span>
          <span style={{ fontSize: "11px", color: "var(--text-dim)", background: "rgba(255,255,255,0.05)", borderRadius: "6px", padding: "2px 7px" }}>
            clears when everyone leaves
          </span>
          {/* Active voice speaker pill — visible while voice is minimised behind the board */}
          {activeSpeaker && (
            <span style={{
              display: "inline-flex", alignItems: "center", gap: "5px",
              fontSize: "11px", fontWeight: 600,
              background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.3)",
              color: "#f87171", borderRadius: "20px", padding: "2px 9px",
            }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#f87171", flexShrink: 0 }} />
              {activeSpeaker.split(" ")[0]} speaking
            </span>
          )}
        </div>
        <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-dim)", cursor: "pointer", lineHeight: 1, padding: "0 2px", display: "flex" }}><X size={18} /></button>
      </div>

      {/* ── Primary tool rail ─────────────────────────────────────────────────
           8 core tools + Shapes group + Undo/Redo.
           Kept short so it never wraps even on a 320px mobile screen. */}
      <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap", padding: "10px 16px", borderBottom: "1px solid rgba(196,154,60,0.08)" }}>
        <button style={chip(tool === "pen")}          onClick={() => onToolChange("pen")}          title="Pen"><span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><Pencil size={14} />Pen</span></button>
        <button style={chip(tool === "stroke-erase")} onClick={() => onToolChange("stroke-erase")} title="Tap a line to delete the whole stroke"><span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><Eraser size={14} />Erase</span></button>
        <button style={chip(tool === "area-erase")}   onClick={() => onToolChange("area-erase")}   title="Drag to rub out an area"><span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><Circle size={14} />Area</span></button>
        <button style={chip(tool === "laser")}        onClick={() => onToolChange("laser")}        title="Laser pointer"><span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><Crosshair size={14} />Laser</span></button>
        <button style={chip(tool === "text")}         onClick={() => onToolChange("text")}         title="Place text on the board"><span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><Type size={14} />Text</span></button>
        <button style={chip(tool === "select", "#4f86d9")} onClick={() => onToolChange("select")} title="Select and move a stroke"><span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><MousePointer2 size={14} />Select</span></button>
        <button
          style={{ ...chip(false, "#7c9edc"), opacity: imgUploading ? 0.5 : 1 }}
          onClick={() => !imgUploading && fileInputRef.current?.click()}
          title="Upload image (or paste / drag-and-drop)"
          disabled={imgUploading || !roomId}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><ImageIcon size={14} />Image</span>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={handleFilePickerChange}
        />

        {/* Shapes — one button in the rail; sub-type picker appears in the contextual row below */}
        <button
          style={chip(isShape)}
          onClick={() => onToolChange(isShape ? tool : "rect")}
          title="Shape tools: rect, circle, line, arrow"
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            {tool === "rect"   ? <><Square size={14} />Rect</>
             : tool === "circle" ? <><Circle size={14} />Circle</>
             : tool === "line"   ? <><Minus size={14} />Line</>
             : tool === "arrow"  ? <><MoveRight size={14} />Arrow</>
             : <><Shapes size={14} />Shapes</>}
          </span>
        </button>

        <span style={{ width: "1px", height: "20px", background: "rgba(255,255,255,0.1)", margin: "0 2px" }} />

        <button
          style={{ ...chip(false), opacity: canUndo ? 1 : 0.35, cursor: canUndo ? "pointer" : "not-allowed" }}
          onClick={() => canUndo && onUndo?.()}
          title="Undo (Ctrl+Z)"
          disabled={!canUndo}
        ><Undo2 size={14} /></button>
        <button
          style={{ ...chip(false), opacity: canRedo ? 1 : 0.35, cursor: canRedo ? "pointer" : "not-allowed" }}
          onClick={() => canRedo && onRedo?.()}
          title="Redo (Ctrl+Shift+Z)"
          disabled={!canRedo}
        ><Redo2 size={14} /></button>
      </div>

      {/* ── Secondary controls row — backgrounds + export/clear (always visible) ── */}
      <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", padding: "8px 16px", borderBottom: "1px solid rgba(196,154,60,0.08)" }}>
        <span style={{ fontSize: "11px", color: "var(--text-dim)" }}>BG</span>
        {BACKGROUNDS.map(b => (
          <button
            key={b.value}
            onClick={() => onBgChange(b.value)}
            title={b.label}
            style={{
              width: "20px", height: "20px", borderRadius: "5px", cursor: "pointer", padding: 0,
              background: b.value,
              border: bg === b.value ? "2px solid #c49a3c" : "2px solid rgba(255,255,255,0.18)",
            }}
          />
        ))}
        <span style={{ flex: 1 }} />
        {zoom !== 1 && (
          <button
            style={{ ...chip(false), fontVariantNumeric: "tabular-nums", minWidth: "46px" }}
            onClick={resetZoom}
            title="Reset zoom to 100%"
          >{Math.round(zoom * 100)}%</button>
        )}
        <button
          style={{ ...chip(showGrid), opacity: 0.85 }}
          onClick={() => setShowGrid(g => !g)}
          title="Toggle grid overlay"
        ><span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><Grid3x3 size={14} />Grid</span></button>
        <button
          style={{ ...chip(showHelp), minWidth: "28px" }}
          onClick={() => setShowHelp(h => !h)}
          title="Keyboard shortcuts"
        >?</button>
        <button
          style={{ ...chip(false), color: "rgba(100,210,120,0.9)", borderColor: "rgba(80,190,100,0.18)", background: "rgba(80,190,100,0.06)" }}
          onClick={handleExport}
          title="Save board as PNG"
        ><span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><Download size={14} />Export</span></button>
        <button
          style={{ ...chip(false), color: "rgba(255,100,90,0.85)", borderColor: "rgba(255,59,48,0.18)", background: "rgba(255,59,48,0.06)" }}
          onClick={() => { if (window.confirm("Clear the whiteboard for everyone in the room?")) onClear(); }}
        ><span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><Trash2 size={14} />Clear</span></button>
      </div>

      {/* ── Contextual option rows — shown only for the active tool ───────────── */}

      {/* Pen: style + thickness + colour */}
      {isPen && (
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", padding: "10px 16px", borderBottom: "1px solid rgba(196,154,60,0.08)" }}>
          {PEN_STYLES.map(ps => (
            <button key={ps.value} style={chip(style === ps.value)} onClick={() => onStyleChange(ps.value)}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><ps.icon size={14} />{ps.label}</span>
            </button>
          ))}
          <span style={{ width: "1px", height: "20px", background: "rgba(255,255,255,0.1)", margin: "0 2px" }} />
          {PEN_WIDTHS.map((w, i) => (
            <button key={w} onClick={() => onPenWidthChange(w)} title={`Thickness ${i + 1}`}
              style={{ ...chip(penWidth === w), width: "30px", display: "flex", alignItems: "center", justifyContent: "center", padding: "6px 0" }}>
              <span style={{ display: "block", width: `${Math.min(18, w + 2)}px`, height: `${Math.max(2, Math.round(w / 2))}px`, borderRadius: "99px", background: penWidth === w ? "#c49a3c" : "var(--text-dim)" }} />
            </button>
          ))}
          <span style={{ width: "1px", height: "20px", background: "rgba(255,255,255,0.1)", margin: "0 2px" }} />
          {PEN_COLORS.map(c => (
            <button key={c} onClick={() => onColorChange(c)} title={c}
              style={{ width: "20px", height: "20px", borderRadius: "50%", cursor: "pointer", padding: 0, background: c,
                border: color === c ? "2px solid #fff" : "2px solid rgba(255,255,255,0.15)",
                outline: color === c ? "1px solid rgba(196,154,60,0.6)" : "none" }} />
          ))}
          <label title="Custom color" style={{ position: "relative", width: "20px", height: "20px", cursor: "pointer", flexShrink: 0 }}>
            <input type="color" value={isCustomColor ? color : "#000000"} onChange={e => onColorChange(e.target.value)}
              style={{ position: "absolute", inset: 0, opacity: 0, width: "100%", height: "100%", cursor: "pointer" }} />
            <div style={{ width: "20px", height: "20px", borderRadius: "50%",
              background: "conic-gradient(red, yellow, lime, cyan, blue, magenta, red)",
              border: isCustomColor ? "2px solid #fff" : "2px solid rgba(255,255,255,0.15)",
              outline: isCustomColor ? "1px solid rgba(196,154,60,0.6)" : "none", pointerEvents: "none" }} />
          </label>
        </div>
      )}

      {/* Text: size + colour + hint */}
      {isText && (
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", padding: "10px 16px", borderBottom: "1px solid rgba(196,154,60,0.08)" }}>
          <span style={{ fontSize: "11px", color: "var(--text-dim)" }}>Size</span>
          {PEN_WIDTHS.map((w, i) => (
            <button key={w} onClick={() => onPenWidthChange(w)} title={`Size ${i + 1}`}
              style={{ ...chip(penWidth === w), minWidth: "30px", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ fontSize: `${10 + i * 3}px`, lineHeight: 1, color: penWidth === w ? "#c49a3c" : "var(--text-dim)" }}>A</span>
            </button>
          ))}
          <span style={{ width: "1px", height: "20px", background: "rgba(255,255,255,0.1)", margin: "0 2px" }} />
          {PEN_COLORS.map(c => (
            <button key={c} onClick={() => onColorChange(c)} title={c}
              style={{ width: "20px", height: "20px", borderRadius: "50%", cursor: "pointer", padding: 0, background: c,
                border: color === c ? "2px solid #fff" : "2px solid rgba(255,255,255,0.15)",
                outline: color === c ? "1px solid rgba(196,154,60,0.6)" : "none" }} />
          ))}
          <label title="Custom color" style={{ position: "relative", width: "20px", height: "20px", cursor: "pointer", flexShrink: 0 }}>
            <input type="color" value={isCustomColor ? color : "#000000"} onChange={e => onColorChange(e.target.value)}
              style={{ position: "absolute", inset: 0, opacity: 0, width: "100%", height: "100%", cursor: "pointer" }} />
            <div style={{ width: "20px", height: "20px", borderRadius: "50%",
              background: "conic-gradient(red, yellow, lime, cyan, blue, magenta, red)",
              border: isCustomColor ? "2px solid #fff" : "2px solid rgba(255,255,255,0.15)",
              outline: isCustomColor ? "1px solid rgba(196,154,60,0.6)" : "none", pointerEvents: "none" }} />
          </label>
          <span style={{ fontSize: "11px", color: "var(--text-dim)", marginLeft: "4px" }}>Click canvas to place · Enter to commit · Esc to cancel</span>
        </div>
      )}

      {/* Shapes: sub-type picker + thickness + colour */}
      {isShape && (
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", padding: "10px 16px", borderBottom: "1px solid rgba(196,154,60,0.08)" }}>
          <button style={chip(tool === "rect")}   onClick={() => onToolChange("rect")}   title="Rectangle"><span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><Square size={14} />Rect</span></button>
          <button style={chip(tool === "circle")} onClick={() => onToolChange("circle")} title="Circle / Ellipse"><span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><Circle size={14} />Circle</span></button>
          <button style={chip(tool === "line")}   onClick={() => onToolChange("line")}   title="Straight line"><span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><Minus size={14} />Line</span></button>
          <button style={chip(tool === "arrow")}  onClick={() => onToolChange("arrow")}  title="Arrow"><span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><MoveRight size={14} />Arrow</span></button>
          <span style={{ width: "1px", height: "20px", background: "rgba(255,255,255,0.1)", margin: "0 2px" }} />
          <span style={{ fontSize: "11px", color: "var(--text-dim)" }}>Size</span>
          {PEN_WIDTHS.map((w, i) => (
            <button key={w} onClick={() => onPenWidthChange(w)} title={`Thickness ${i + 1}`}
              style={{ ...chip(penWidth === w), width: "30px", display: "flex", alignItems: "center", justifyContent: "center", padding: "6px 0" }}>
              <span style={{ display: "block", width: `${Math.min(18, w + 2)}px`, height: `${Math.max(2, Math.round(w / 2))}px`, borderRadius: "99px", background: penWidth === w ? "#c49a3c" : "var(--text-dim)" }} />
            </button>
          ))}
          <span style={{ width: "1px", height: "20px", background: "rgba(255,255,255,0.1)", margin: "0 2px" }} />
          {PEN_COLORS.map(c => (
            <button key={c} onClick={() => onColorChange(c)} title={c}
              style={{ width: "20px", height: "20px", borderRadius: "50%", cursor: "pointer", padding: 0, background: c,
                border: color === c ? "2px solid #fff" : "2px solid rgba(255,255,255,0.15)",
                outline: color === c ? "1px solid rgba(196,154,60,0.6)" : "none" }} />
          ))}
          <label title="Custom color" style={{ position: "relative", width: "20px", height: "20px", cursor: "pointer", flexShrink: 0 }}>
            <input type="color" value={isCustomColor ? color : "#000000"} onChange={e => onColorChange(e.target.value)}
              style={{ position: "absolute", inset: 0, opacity: 0, width: "100%", height: "100%", cursor: "pointer" }} />
            <div style={{ width: "20px", height: "20px", borderRadius: "50%",
              background: "conic-gradient(red, yellow, lime, cyan, blue, magenta, red)",
              border: isCustomColor ? "2px solid #fff" : "2px solid rgba(255,255,255,0.15)",
              outline: isCustomColor ? "1px solid rgba(196,154,60,0.6)" : "none", pointerEvents: "none" }} />
          </label>
        </div>
      )}

      {/* Area-eraser: size picker */}
      {tool === "area-erase" && (
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", padding: "10px 16px", borderBottom: "1px solid rgba(196,154,60,0.08)" }}>
          <span style={{ fontSize: "11px", color: "var(--text-dim)" }}>Eraser size</span>
          {ERASER_SIZES.map((w, i) => (
            <button key={w} onClick={() => onEraserSizeChange(w)} title={`Size ${i + 1}`}
              style={{ ...chip(eraserSize === w), width: "34px", display: "flex", alignItems: "center", justifyContent: "center", padding: "6px 0" }}>
              <span style={{ display: "block", width: `${Math.min(22, 8 + i * 4)}px`, height: `${Math.min(22, 8 + i * 4)}px`, borderRadius: "50%", border: `2px solid ${eraserSize === w ? "#c49a3c" : "var(--text-dim)"}` }} />
            </button>
          ))}
        </div>
      )}

      {/* Keyboard shortcut cheatsheet */}
      {showHelp && (
        <div style={{
          margin: "0 16px 8px", padding: "12px 16px", borderRadius: "10px",
          background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
          display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 24px",
        }}>
          {([
            ["P", "Pen"],       ["E", "Stroke erase"],
            ["A", "Area erase"],["L", "Laser pointer"],
            ["T", "Text"],      ["S", "Select / move"],
            ["R", "Shapes"],    ["Esc", "Back to pen"],
            ["Ctrl+Z", "Undo"], ["Ctrl+Shift+Z", "Redo"],
            ["Delete", "Erase selected"], ["Shift+draw", "Constrain shape"],
            ["Ctrl+scroll", "Zoom in/out"], ["Middle drag", "Pan"],
          ] as [string, string][]).map(([key, label]) => (
            <div key={key} style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "11px" }}>
              <kbd style={{
                background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.18)",
                borderRadius: "4px", padding: "1px 6px", fontFamily: "inherit",
                color: "var(--text-primary)", flexShrink: 0, whiteSpace: "nowrap",
              }}>{key}</kbd>
              <span style={{ color: "var(--text-dim)" }}>{label}</span>
            </div>
          ))}
        </div>
      )}

      {/* Canvas + overlay */}
      <div style={{ padding: "12px 16px", display: "flex", justifyContent: "center" }}>
        <div style={{ position: "relative", width: "100%", maxWidth: `${BOARD_W}px`, transformOrigin: "center center", transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
          <canvas
            ref={canvasRef}
            data-whiteboard-canvas="true"
            width={BOARD_W}
            height={BOARD_H}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onPointerLeave={handlePointerLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            style={{
              width: "100%", aspectRatio: `${BOARD_W} / ${BOARD_H}`,
              background: bg, borderRadius: "10px", border: "1px solid rgba(255,255,255,0.08)",
              touchAction: "none", cursor, display: "block",
            }}
          />
          {/* Image uploading overlay */}
          {imgUploading && (
            <div style={{
              position: "absolute", inset: 0, borderRadius: "10px",
              background: "rgba(0,0,0,0.45)", display: "flex",
              alignItems: "center", justifyContent: "center",
              zIndex: 20, pointerEvents: "none",
            }}>
              <span style={{ color: "#fff", fontSize: 15, fontWeight: 600, letterSpacing: 0.3 }}>
                Uploading image…
              </span>
            </div>
          )}
          {/* Text input overlay */}
          {textInput && (
            <input
              key={`${textInput.x},${textInput.y}`}
              autoFocus
              type="text"
              placeholder="Type text…"
              style={{
                position: "absolute",
                left: `${(textInput.x / BOARD_W) * 100}%`,
                top: `${(textInput.y / BOARD_H) * 100}%`,
                transform: "translateY(-50%)",
                zIndex: 10,
                background: "rgba(0,0,0,0.75)",
                color,
                border: `1px solid ${color}`,
                borderRadius: "4px",
                padding: "3px 8px",
                fontSize: "14px",
                fontFamily: "sans-serif",
                outline: "none",
                minWidth: "80px",
                maxWidth: "280px",
              }}
              onKeyDown={e => {
                e.stopPropagation();
                if (e.key === "Enter") { handleTextCommit(e.currentTarget.value); e.preventDefault(); }
                if (e.key === "Escape") { setTextInput(null); e.preventDefault(); }
              }}
              onBlur={e => {
                if (e.currentTarget.value.trim()) handleTextCommit(e.currentTarget.value);
                else setTextInput(null);
              }}
            />
          )}

          {/* Peer cursors + laser overlay */}
          <div style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden", borderRadius: "10px" }}>
            {/* Peer live cursors */}
            {Object.entries(peerCursors ?? {}).map(([uid, cur]) => (
              <div key={uid} style={{
                position: "absolute",
                left: `${(cur.x / BOARD_W) * 100}%`,
                top: `${(cur.y / BOARD_H) * 100}%`,
                transform: "translate(2px, 2px)",
                display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "2px",
              }}>
                <svg width="11" height="13" viewBox="0 0 11 13" style={{ display: "block", filter: "drop-shadow(0 1px 1px rgba(0,0,0,0.5))" }}>
                  <path d="M0 0 L0 11 L3 8 L5.5 12 L7 11 L4.5 7 L8 7 Z" fill={cur.color} />
                </svg>
                <span style={{
                  background: cur.color, color: "#fff", fontSize: "10px", fontWeight: 600,
                  padding: "1px 5px", borderRadius: "4px", whiteSpace: "nowrap",
                  maxWidth: "80px", overflow: "hidden", textOverflow: "ellipsis",
                }}>{cur.name.split(" ")[0]}</span>
              </div>
            ))}
            {/* Peer laser dots */}
            {Object.entries(laserPositions ?? {}).map(([uid, las]) => (
              <div key={uid} style={{
                position: "absolute",
                left: `${(las.x / BOARD_W) * 100}%`,
                top: `${(las.y / BOARD_H) * 100}%`,
                transform: "translate(-50%, -50%)",
                width: "14px", height: "14px", borderRadius: "50%",
                background: "rgba(239,68,68,0.9)",
                boxShadow: "0 0 0 4px rgba(239,68,68,0.3)",
                animation: las.active ? "none" : "laserFade 1.2s ease-out forwards",
              }} />
            ))}
            {/* Local laser dot */}
            {tool === "laser" && localLaser && (
              <div style={{
                position: "absolute",
                left: `${(localLaser.x / BOARD_W) * 100}%`,
                top: `${(localLaser.y / BOARD_H) * 100}%`,
                transform: "translate(-50%, -50%)",
                width: "14px", height: "14px", borderRadius: "50%",
                background: "rgba(239,68,68,0.9)",
                boxShadow: "0 0 0 4px rgba(239,68,68,0.3)",
              }} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

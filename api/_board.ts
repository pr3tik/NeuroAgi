// api/_board.ts — BE-07/AI-06: pure board extraction. No I/O — the DB half lives in
// api/room-board.ts, so this file stays unit-testable against fixture strokes.
//
// WHY THE CLIENT MUST PUSH (this is not a style choice):
// The live board is a **Yjs CRDT held in browser memory**, synced peer-to-peer over a
// Supabase broadcast channel (src/lib/yjsSupabaseProvider + StudyRooms.tsx). It is NEVER
// written to Postgres — `public.whiteboard_strokes` and the RPC wrappers in
// src/api/whiteboard.ts are dead code (only their TYPES are still imported). So the server
// has no way to read the board on its own: the client that holds the doc has to emit the
// snapshot. That also means whiteboard_snapshots is the ONLY durable record of a board —
// when the last tab closes, the in-memory doc is gone. STUDYROOM_ARCHITECTURE.md reaches
// the same conclusion independently: "the whiteboard keeps its Yjs-over-Broadcast engine
// (it already avoids per-stroke Postgres writes — the plan's assumption it needed
// replacing was wrong)."
//
// STROKE MODEL — as it actually is, not as the sprint plan describes it:
//   The plan's §0b says typed text is `mode: "text"`. It is NOT. `mode` is
//   "pen" | "erase" | "image"; typed text is a **style** on a pen stroke:
//       { mode: "pen", style: "text", points: [{ x, y, t: "the typed text" }] }
//   The text content lives in **points[0].t** (see the "text" case in Whiteboard.tsx's
//   renderer). Extracting on `mode === "text"` would silently find nothing — which is
//   exactly the bug AI-06 would have shipped.
//
// KNOWN INCONSISTENCY (flagged, not fixed here): the TS type allows `mode: "image"` but
// supabase-whiteboard-migration.sql constrains `CHECK (mode IN ('pen','erase'))`. Harmless
// today because nothing writes that table — but if anyone ever revives the RPC path,
// image strokes will be rejected by the constraint.

import { createHash } from "crypto";

/** A point on the board. For a `style: "text"` stroke, `t` carries the typed text. */
export type BoardPoint = { x: number; y: number; t?: string };

export type BoardPenStyle =
  | "normal" | "highlighter" | "pencil" | "ink" | "marker"
  | "text" | "rect" | "circle" | "line" | "arrow";

/** One stroke as it exists in the Yjs array. Mirrors src/api/whiteboard.ts `Stroke`. */
export type BoardStroke = {
  id: string;
  room_id: string;
  user_id: string;
  name: string;
  mode: "pen" | "erase" | "image";
  style: BoardPenStyle;
  color: string;
  width: number;
  points: BoardPoint[];
  // image-stroke fields (mode === "image" only)
  url?: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  created_at: string;
};

/**
 * THE HOOK. The client emits this at a revision milestone; the server persists it as a
 * whiteboard_snapshots row and derives `extracted_json`/`extracted_text`/`digest` from it.
 *
 * `revision` is a monotonically increasing integer PER ROOM, owned by the client. The DB
 * enforces `unique (room_id, revision)`, so a late or duplicate emit is rejected rather
 * than overwriting — a stale emit must never clobber a newer snapshot.
 */
export type BoardSnapshotEmit = {
  room_id: string;
  /** The room_ai_sessions row this board state belongs to, when a session is active. */
  session_id?: string | null;
  revision: number;
  strokes: BoardStroke[];
};

/** A single piece of typed text lifted off the board, with where it sits. */
export type ExtractedText = {
  stroke_id: string;
  text: string;
  x: number;
  y: number;
  author_name: string;
  author_id: string;
};

export type ExtractedImage = { stroke_id: string; url: string; x: number; y: number; w: number; h: number };

/**
 * `whiteboard_snapshots.extracted_json` — the AI-readable digest of a board revision.
 * This is what AI-06's `board_context` tool feeds the model, so it must stay small and
 * literal: no freehand ink semantics (the plan explicitly defers that).
 */
export type BoardExtract = {
  revision: number;
  texts: ExtractedText[];
  images: ExtractedImage[];
  /** Counts for the strokes we deliberately do NOT interpret, so the model can say so. */
  ink_stroke_count: number;
  shape_counts: Record<string, number>;
};

const SHAPE_STYLES = new Set(["rect", "circle", "line", "arrow"]);

/**
 * Pure extraction: Yjs strokes → the AI-readable digest. No I/O, so it unit-tests against
 * fixture strokes directly (the Day-2 "extraction unit-tested on fixture strokes" exit
 * criterion). Defensive about shape because these strokes arrive from a client.
 */
export function extractBoard(strokes: BoardStroke[], revision: number): BoardExtract {
  const texts: ExtractedText[] = [];
  const images: ExtractedImage[] = [];
  const shape_counts: Record<string, number> = {};
  let ink_stroke_count = 0;

  for (const s of Array.isArray(strokes) ? strokes : []) {
    if (!s || typeof s !== "object") continue;

    if (s.mode === "image") {
      if (s.url) {
        images.push({
          stroke_id: s.id, url: s.url,
          x: s.x ?? 0, y: s.y ?? 0, w: s.w ?? 0, h: s.h ?? 0,
        });
      }
      continue;
    }

    // Erase strokes are a rendering artifact (destination-out compositing), not content.
    if (s.mode === "erase") continue;

    if (s.style === "text") {
      const p = s.points?.[0];
      const t = typeof p?.t === "string" ? p.t.trim() : "";
      if (!t) continue;   // an empty text box carries no meaning for the model
      texts.push({
        stroke_id: s.id, text: t,
        x: p!.x, y: p!.y,
        author_name: s.name ?? "Anonymous",
        author_id: s.user_id,
      });
      continue;
    }

    if (SHAPE_STYLES.has(s.style)) {
      shape_counts[s.style] = (shape_counts[s.style] ?? 0) + 1;
      continue;
    }

    ink_stroke_count++;   // freehand: counted, never interpreted (semantic ink is deferred)
  }

  // Reading order: top-to-bottom, then left-to-right — so the model sees the board the way
  // a person would, instead of in stroke-creation order.
  texts.sort((a, b) => (a.y - b.y) || (a.x - b.x));

  return { revision, texts, images, ink_stroke_count, shape_counts };
}

/**
 * `whiteboard_snapshots.extracted_text` — the flat reading of the board, in reading order.
 * Derived from the same extract the model sees, so text and JSON can never disagree.
 */
export function toExtractedText(x: BoardExtract): string {
  return x.texts.map(t => t.text).join("\n");
}

/**
 * `whiteboard_snapshots.digest` — "content hash for change detection" (per the migration).
 *
 * Hashes the EXTRACT, not the raw strokes, deliberately: this table exists to hold what
 * the AI can read, so two boards that extract identically are the same snapshot even if
 * their raw stroke arrays differ (a shape nudged a pixel, strokes arriving in a different
 * Yjs order). `revision` is excluded for the same reason — otherwise every emit would
 * produce a fresh digest and change detection would never suppress anything.
 *
 * Freehand ink still moves the digest via ink_stroke_count, so "someone drew something"
 * is not silently dropped, even though the ink itself is never interpreted.
 */
export function boardDigest(x: BoardExtract): string {
  const canonical = JSON.stringify({
    texts: x.texts.map(t => [t.stroke_id, t.text, t.x, t.y, t.author_id]),
    images: x.images.map(i => [i.stroke_id, i.url, i.x, i.y, i.w, i.h]),
    ink: x.ink_stroke_count,
    shapes: Object.keys(x.shape_counts).sort().map(k => [k, x.shape_counts[k]]),
  });
  return createHash("sha256").update(canonical).digest("hex");
}

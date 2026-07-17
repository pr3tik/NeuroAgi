// api/room-board.ts — AI-06 / BE-07: the board snapshot pipeline.
//
// The live board is a Yjs CRDT in browser memory (see api/_board.ts for why). The server
// cannot read it, so the client that holds the doc POSTs a snapshot at revision
// milestones; this endpoint extracts the AI-readable digest and persists an immutable
// whiteboard_snapshots row. That table is the ONLY durable record of a board.
//
//   POST /api/room-board?action=snapshot  { roomId, sessionId?, revision, strokes[] }
//   GET  /api/room-board?action=context&roomId=…      → the latest snapshot's digest
//
// `latestBoardContext()` is also exported for direct import: the group/private AI
// endpoints (AI-04/AI-05) call it in-process as the `board_context` tool, so the model can
// cite "Board revision N". Same shape either way.
import { requireUser, requireUserOr401 } from "./_auth.js";
import { rateLimit } from "./_ratelimit.js";
import { extractBoard, toExtractedText, boardDigest } from "./_board.js";
import type { BoardExtract, BoardStroke } from "./_board.js";

export const config = { maxDuration: 30 };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// A board is a few hundred strokes in practice. This bounds a hostile client from
// posting an unbounded array that we would then extract and hash.
const MAX_STROKES = 20_000;

function db() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("Supabase env vars not configured");
  const headers: Record<string, string> = {
    apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json",
  };
  return {
    async select(path: string) {
      const r = await fetch(`${url}/rest/v1/${path}`, { headers });
      if (!r.ok) throw new Error(`select ${path.split("?")[0]} failed (${r.status})`);
      return (await r.json()) as any[];
    },
    async insert(table: string, body: any) {
      const r = await fetch(`${url}/rest/v1/${table}`, {
        method: "POST",
        headers: { ...headers, Prefer: "return=representation" },
        body: JSON.stringify(body),
      });
      // 23505 = unique (room_id, revision). Surfaced to the caller, not swallowed —
      // see the duplicate-revision handling in the snapshot action.
      if (!r.ok) {
        const text = (await r.text()).slice(0, 300);
        const err: any = new Error(`insert ${table} failed (${r.status}): ${text}`);
        err.status = r.status;
        err.duplicate = r.status === 409 || text.includes("23505");
        throw err;
      }
      return (await r.json()) as any[];
    },
  };
}

async function isJoinedMember(userId: string, roomId: string): Promise<boolean> {
  const rows = await db().select(
    `room_members?room_id=eq.${roomId}&user_id=eq.${encodeURIComponent(userId)}&status=eq.joined&select=user_id&limit=1`,
  );
  return rows.length > 0;
}

export interface BoardContext {
  revision: number;
  extract: BoardExtract;
  digest: string | null;
  render_path: string | null;
  created_at: string;
}

/**
 * The latest persisted board state for a room, or null if nothing has been snapshotted.
 *
 * PRECONDITION: the caller has verified room membership. This is the tool-facing
 * primitive — AI-04 calls it in-process after its own auth, exactly like
 * searchRoomSources() in api/_roomRetrieval.ts.
 */
export async function latestBoardContext(roomId: string): Promise<BoardContext | null> {
  const rows = await db().select(
    `whiteboard_snapshots?room_id=eq.${roomId}&select=revision,extracted_json,digest,render_path,created_at&order=revision.desc&limit=1`,
  );
  const row = rows[0];
  if (!row) return null;
  return {
    revision: row.revision,
    extract: row.extracted_json ?? { revision: row.revision, texts: [], images: [], ink_stroke_count: 0, shape_counts: {} },
    digest: row.digest ?? null,
    render_path: row.render_path ?? null,
    created_at: row.created_at,
  };
}

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();

  const action = req.query?.action;

  try {
    // ── snapshot ────────────────────────────────────────────────────────────
    if (action === "snapshot" && req.method === "POST") {
      const userId = await requireUserOr401(req, res);
      if (!userId) return;

      const { roomId, sessionId = null, revision = null, strokes } = req.body ?? {};
      if (!UUID_RE.test(String(roomId ?? ""))) return res.status(400).json({ error: "valid roomId required" });
      if (sessionId != null && !UUID_RE.test(String(sessionId))) return res.status(400).json({ error: "sessionId must be a uuid" });
      // `revision` is OPTIONAL and clients should omit it. A board has many concurrent
      // editors and no leader, so no client can reliably know the current revision — the
      // server assigns latest+1 below. It stays accepted for a caller that genuinely owns
      // an ordering (e.g. a replay/backfill), and is validated + staleness-checked if given.
      if (revision != null && (!Number.isInteger(revision) || revision < 0)) {
        return res.status(400).json({ error: "revision must be a non-negative integer" });
      }
      if (!Array.isArray(strokes)) return res.status(400).json({ error: "strokes[] required" });
      if (strokes.length > MAX_STROKES) return res.status(413).json({ error: `too many strokes (max ${MAX_STROKES})` });

      // Boards move fast; a milestone every few seconds per member is plenty. This also
      // caps the cost of a client looping on emit. Matches room-session's posture.
      if (!(await rateLimit(req, res, "room-board", { anonMax: 10, authMax: 60, windowSecs: 60 }))) return;

      // Only a joined member may write to a room's board history.
      if (!(await isJoinedMember(userId, String(roomId)))) {
        return res.status(403).json({ error: "Not a joined member of this room." });
      }

      // The digest is computed from content only (revision is excluded), so it is stable
      // before we know what revision this will become.
      const probe = extractBoard(strokes as BoardStroke[], 0);
      const digest = boardDigest(probe);

      // Change detection: if the newest snapshot already has this digest, the board's
      // AI-readable content is unchanged, so a new revision would add nothing. Report the
      // existing revision so the caller does not think it lost the write.
      const latest = await latestBoardContext(String(roomId));
      if (latest?.digest === digest) {
        return res.status(200).json({ ok: true, unchanged: true, revision: latest.revision, digest });
      }

      // A caller-supplied revision must move forward. Rejecting a stale emit here (as well
      // as via the unique index) keeps a late-arriving milestone from a lagging client out.
      if (revision != null && latest && revision <= latest.revision) {
        return res.status(409).json({ error: "stale revision", latestRevision: latest.revision });
      }

      const nextRevision = revision ?? (latest ? latest.revision + 1 : 1);
      const extract = extractBoard(strokes as BoardStroke[], nextRevision);

      try {
        const [row] = await db().insert("whiteboard_snapshots", {
          room_id: roomId,
          session_id: sessionId,
          revision: nextRevision,
          extracted_json: extract,
          extracted_text: toExtractedText(extract),
          digest,
        });
        return res.status(200).json({
          ok: true, unchanged: false,
          snapshot: { id: row.id, revision: row.revision, digest: row.digest },
          extracted: { texts: extract.texts.length, images: extract.images.length, ink: extract.ink_stroke_count },
        });
      } catch (err: any) {
        // Two clients raced on the same revision. Yjs converges, so the winner's content is
        // near-certainly equivalent, and the next milestone re-snapshots either way — not
        // an error worth surfacing to a student mid-session.
        if (err?.duplicate) return res.status(200).json({ ok: true, unchanged: true, revision: nextRevision, raced: true });
        throw err;
      }
    }

    // ── context ─────────────────────────────────────────────────────────────
    if (action === "context" && req.method === "GET") {
      const auth = await requireUser(req);
      if (!auth) return res.status(401).json({ error: "Authentication required." });

      const roomId = String(req.query?.roomId ?? "");
      if (!UUID_RE.test(roomId)) return res.status(400).json({ error: "valid roomId required" });
      if (!(await isJoinedMember(auth.userId, roomId))) {
        return res.status(403).json({ error: "Not a joined member of this room." });
      }

      const ctx = await latestBoardContext(roomId);
      return res.status(200).json({ ok: true, board: ctx });
    }

    return res.status(400).json({ error: "Unknown action. Use ?action=snapshot|context" });
  } catch (err: any) {
    console.error("[room-board] error:", err?.message ?? err);
    return res.status(502).json({ error: err?.message ?? "board error" });
  }
}

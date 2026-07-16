// api/_roomRetrieval.ts — AI-03: room-scoped source retrieval.
//
// Grounds a room answer ONLY in the documents explicitly shared into that room
// (room_sources, enabled ones). Built as an importable module rather than an HTTP action
// because its real caller is the `rag_search` tool inside the group/private AI endpoints
// (AI-04/AI-05); exposing it over HTTP too would be a second door onto the same data.
//
// AUTHORIZATION — read this before touching anything here:
//   STUDYROOM_ARCHITECTURE.md §2: "Resolve enabled ids from room_sources first; membership
//   check is the caller's job — the function trusts its input by design."
//   rag_room_search is SECURITY DEFINER and revoked from anon/authenticated: whatever
//   doc-id array it is handed, it searches. So the doc-id array IS the authorization
//   boundary, and `assertRoomMember` below is what earns the right to build one. Never
//   call searchRoomSources() with ids from a request body.
//
// It fails closed by SQL semantics: `document_id = any(p_document_ids)` matches nothing for
// an empty or null array, so a room with no sources retrieves nothing rather than
// everything. We also short-circuit before the RPC to avoid a pointless embed call.
import { embed } from "./rag.js";

const MAX_CONTEXT_CHARS = 6000;   // matches api/rag.ts — cap injected passage text per query
const MATCH_COUNT       = 12;

export interface RoomPassage {
  document_id: string;
  title: string;
  heading: string | null;
  loc: string | null;
  text: string;
}
/** Citation metadata without the body text — what the grounding chips render. */
export type RoomSourceRef = Omit<RoomPassage, "text">;

export interface RoomSearchResult {
  passages: RoomPassage[];
  source_refs: RoomSourceRef[];
  used: number;
  reason?: "no_room_sources" | "no_hits";
}

// PostgREST over fetch: room_sources is RLS-on deny-all, so every read here is service-key
// only. Mirrors api/room-session.ts and api/jobs.ts.
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
    async rpc(fn: string, args: any) {
      const r = await fetch(`${url}/rest/v1/rpc/${fn}`, {
        method: "POST", headers, body: JSON.stringify(args),
      });
      if (!r.ok) throw new Error(`rpc ${fn} failed (${r.status}): ${(await r.text()).slice(0, 200)}`);
      return (await r.json()) as any[];
    },
  };
}

/**
 * The authorization gate. Returns true only if `userId` is a JOINED member of `roomId`.
 * Callers must pass an identity resolved from the JWT (api/_auth.ts), never one from a
 * request body — a body-supplied id here would re-open the IDOR that PRs #196/#197/#199
 * closed.
 */
export async function assertRoomMember(userId: string, roomId: string): Promise<boolean> {
  if (!userId || !roomId) return false;
  const rows = await db().select(
    `room_members?room_id=eq.${roomId}&user_id=eq.${encodeURIComponent(userId)}&status=eq.joined&select=user_id&limit=1`,
  );
  return rows.length > 0;
}

/** The enabled doc-id set for a room. Disabled sources are excluded — that toggle is how a
 *  room un-shares a document without deleting the row, so honouring it is not optional. */
export async function enabledSourceIds(roomId: string): Promise<string[]> {
  const rows = await db().select(
    `room_sources?room_id=eq.${roomId}&enabled=is.true&select=document_id`,
  );
  return rows.map(r => r.document_id).filter(Boolean);
}

/**
 * Search a room's shared documents.
 *
 * PRECONDITION: the caller has already verified membership (see assertRoomMember).
 * This function does not re-check — it is the tool-facing primitive, and the identity it
 * would need is not available here by design.
 */
export async function searchRoomSources(
  roomId: string,
  query: string,
  { maxSections = 4 }: { maxSections?: number } = {},
): Promise<RoomSearchResult> {
  const d = db();

  const documentIds = await enabledSourceIds(roomId);
  // No sources shared → ground on nothing. The dangerous failure mode would be silently
  // widening to the asker's whole library, so this returns empty instead.
  if (!documentIds.length) return { passages: [], source_refs: [], used: 0, reason: "no_room_sources" };

  const qStr = String(query).slice(0, 2000);   // the gist is enough; unbounded queries are slow to embed
  const [queryEmbedding] = await embed([qStr]);

  const hits = await d.rpc("rag_room_search", {
    p_document_ids:    documentIds,
    p_query_embedding: queryEmbedding,
    p_query_text:      qStr,
    p_match_count:     MATCH_COUNT,
  });
  if (!hits?.length) return { passages: [], source_refs: [], used: 0, reason: "no_hits" };

  // Small-to-big: map the winning chunks up to their parent sections, best first, deduped.
  const sectionOrder: string[] = [];
  const seen = new Set<string>();
  for (const h of hits) {
    if (h.section_id && !seen.has(h.section_id)) { seen.add(h.section_id); sectionOrder.push(h.section_id); }
    if (sectionOrder.length >= maxSections) break;
  }

  const sections = await d.select(
    `rag_sections?id=in.(${sectionOrder.join(",")})&select=id,document_id,heading,loc_start,loc_end,full_text`,
  );
  const docIds = [...new Set(sections.map(s => s.document_id).filter(Boolean))];
  const docs = docIds.length
    ? await d.select(`rag_documents?id=in.(${docIds.join(",")})&select=id,title`)
    : [];
  const titleById = Object.fromEntries(docs.map(x => [x.id, x.title]));
  const byId = Object.fromEntries(sections.map(s => [s.id, s]));

  const passages: RoomPassage[] = [];
  let total = 0;
  for (const sid of sectionOrder) {
    const s = byId[sid];
    if (!s) continue;
    let text = s.full_text ?? "";
    if (total + text.length > MAX_CONTEXT_CHARS) text = text.slice(0, Math.max(0, MAX_CONTEXT_CHARS - total));
    if (!text) break;
    passages.push({
      document_id: s.document_id,
      title:   titleById[s.document_id] ?? "Document",
      heading: s.heading ?? null,
      loc:     s.loc_start != null
        ? `p.${s.loc_start}${s.loc_end && s.loc_end !== s.loc_start ? `-${s.loc_end}` : ""}`
        : null,
      text,
    });
    total += text.length;
    if (total >= MAX_CONTEXT_CHARS) break;
  }

  return {
    passages,
    source_refs: passages.map(({ text, ...ref }) => ref),
    used: passages.length,
  };
}

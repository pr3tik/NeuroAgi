// @vitest-environment node
// AI-03 room-scoped retrieval (api/_roomRetrieval.ts) against the LIVE rag_room_search RPC.
//
// Exit criterion from the sprint plan: "A query scoped to 2 of 7 fixture docs only ever
// cites those 2." rag_room_search is SECURITY DEFINER and searches whatever doc-id array
// it is given, so the array is the authorization boundary — these tests pin how it is built
// (enabled room_sources only) and that membership is what earns the right to build one.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// embed() would call OpenAI; the vector's contents are irrelevant to scoping.
vi.mock("../api/rag.ts", () => ({ embed: async (xs: string[]) => xs.map(() => new Array(1536).fill(0.01)) }));

function R(data: any, opts: { ok?: boolean; status?: number } = {}) {
  const { ok = true, status = 200 } = opts;
  return { ok, status, json: async () => data, text: async () => JSON.stringify(data) };
}

type Call = { url: string; method: string; body?: any };
function stubDb(route: (u: string, method: string, body: any) => any | undefined) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: any, init: any = {}) => {
    const u = String(url);
    const method = String(init.method ?? "GET").toUpperCase();
    const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ url: u, method, body });
    return route(u, method, body) ?? R([]);
  }));
  return calls;
}

const ROOM = "11111111-1111-4111-8111-111111111111";
const DOC_A = "aaaaaaaa-0000-4000-8000-000000000001";   // shared + enabled
const DOC_B = "bbbbbbbb-0000-4000-8000-000000000002";   // shared + enabled
const DOC_OFF = "dddddddd-0000-4000-8000-000000000004"; // shared but DISABLED
// The other fixture docs — ingested by members but never shared into this room.
const OTHER = [5, 6, 7, 8, 9].map(n => `cccccccc-0000-4000-8000-00000000000${n}`);

const hit = (section_id: string, document_id: string) => ({
  chunk_id: `c-${section_id}`, section_id, document_id, content: "x", score: 0.9,
});

/** Emulates PostgREST. `sources` are the rows room_sources returns for the enabled query. */
function routes({
  sources = [{ document_id: DOC_A }, { document_id: DOC_B }] as any[],
  hits = [] as any[],
  member = [{ user_id: "priya" }] as any[],
} = {}) {
  return stubDb((u, method) => {
    if (u.includes("room_members?")) return R(member);
    if (u.includes("room_sources?")) return R(sources);
    if (u.includes("/rpc/rag_room_search") && method === "POST") return R(hits);
    if (u.includes("rag_sections?")) return R([
      { id: "s1", document_id: DOC_A, heading: "7.3 Memoization", loc_start: 14, loc_end: 15, full_text: "memo vs tab" },
      { id: "s2", document_id: DOC_B, heading: "15.1 Greedy", loc_start: 412, loc_end: 412, full_text: "greedy optimal" },
    ]);
    if (u.includes("rag_documents?")) return R([
      { id: DOC_A, title: "Lecture 07.pdf" }, { id: DOC_B, title: "Textbook Ch15.pdf" },
    ]);
    return undefined;
  });
}

let mod: any;
beforeEach(async () => {
  process.env.SUPABASE_URL = "http://localhost";
  process.env.SUPABASE_SERVICE_KEY = "svc";
  vi.resetModules();
  mod = await import("../api/_roomRetrieval.ts");
});
afterEach(() => vi.unstubAllGlobals());

describe("searchRoomSources — scoping (the exit criterion)", () => {
  it("hands the RPC only the room's shared docs, never the other five", async () => {
    const calls = routes({ hits: [hit("s1", DOC_A), hit("s2", DOC_B)] });

    await mod.searchRoomSources(ROOM, "when is greedy optimal?");

    const rpc = calls.find(c => c.url.includes("/rpc/rag_room_search"))!;
    expect(rpc.body.p_document_ids).toEqual([DOC_A, DOC_B]);
    for (const d of OTHER) expect(rpc.body.p_document_ids).not.toContain(d);
  });

  it("cites only the scoped docs and puts document_id on every passage", async () => {
    routes({ hits: [hit("s1", DOC_A), hit("s2", DOC_B)] });

    const out = await mod.searchRoomSources(ROOM, "greedy vs dp");

    expect(new Set(out.passages.map((p: any) => p.document_id))).toEqual(new Set([DOC_A, DOC_B]));
    for (const p of out.passages) expect(p.document_id).toBeTruthy();
  });

  it("asks room_sources for ENABLED rows only — a disabled share is an un-share", async () => {
    const calls = routes({ hits: [hit("s1", DOC_A)] });

    await mod.searchRoomSources(ROOM, "q");

    const q = calls.find(c => c.url.includes("room_sources?"))!;
    expect(q.url).toContain("enabled=is.true");
    expect(q.url).toContain(`room_id=eq.${ROOM}`);
  });

  it("never searches a disabled document, even though it is a room source", async () => {
    // The DB filters it out; this pins that we don't reintroduce it client-side.
    const calls = routes({ sources: [{ document_id: DOC_A }], hits: [hit("s1", DOC_A)] });

    await mod.searchRoomSources(ROOM, "q");

    const rpc = calls.find(c => c.url.includes("/rpc/rag_room_search"))!;
    expect(rpc.body.p_document_ids).not.toContain(DOC_OFF);
  });

  it("grounds on nothing when no sources are shared — never widens to the asker's library", async () => {
    const calls = routes({ sources: [] });

    const out = await mod.searchRoomSources(ROOM, "anything");

    expect(out).toMatchObject({ passages: [], source_refs: [], used: 0, reason: "no_room_sources" });
    // Must not embed or search at all — no cost, no chance of an unscoped query.
    expect(calls.find(c => c.url.includes("/rpc/rag_room_search"))).toBeUndefined();
  });

  it("reports no_hits distinctly from no_room_sources", async () => {
    routes({ hits: [] });
    const out = await mod.searchRoomSources(ROOM, "unrelated");
    expect(out).toMatchObject({ used: 0, reason: "no_hits" });
  });

  it("returns source_refs as citations without the body text", async () => {
    routes({ hits: [hit("s1", DOC_A)] });

    const out = await mod.searchRoomSources(ROOM, "memoization");

    expect(out.source_refs).toHaveLength(out.passages.length);
    expect(out.source_refs[0]).toMatchObject({
      document_id: DOC_A, title: "Lecture 07.pdf", heading: "7.3 Memoization", loc: "p.14-15",
    });
    expect(out.source_refs[0].text).toBeUndefined();
  });

  it("renders a single-page locator without a redundant range", async () => {
    routes({ hits: [hit("s2", DOC_B)] });
    const out = await mod.searchRoomSources(ROOM, "greedy");
    expect(out.passages[0].loc).toBe("p.412");   // not "p.412-412"
  });

  it("caps how many sections it injects", async () => {
    routes({ hits: [hit("s1", DOC_A), hit("s2", DOC_B)] });
    const out = await mod.searchRoomSources(ROOM, "q", { maxSections: 1 });
    expect(out.passages).toHaveLength(1);
  });
});

describe("assertRoomMember — the authorization gate", () => {
  it("passes a joined member", async () => {
    routes({ member: [{ user_id: "priya" }] });
    expect(await mod.assertRoomMember("priya", ROOM)).toBe(true);
  });

  it("rejects a non-member", async () => {
    routes({ member: [] });
    expect(await mod.assertRoomMember("stranger", ROOM)).toBe(false);
  });

  it("checks joined status for the id it was given", async () => {
    const calls = routes({ member: [{ user_id: "priya" }] });

    await mod.assertRoomMember("priya", ROOM);

    const q = calls.find(c => c.url.includes("room_members?"))!;
    expect(q.url).toContain("user_id=eq.priya");
    expect(q.url).toContain("status=eq.joined");   // invited/requested must not count
  });

  it("rejects empty identities without hitting the DB", async () => {
    const calls = routes();
    expect(await mod.assertRoomMember("", ROOM)).toBe(false);
    expect(await mod.assertRoomMember("priya", "")).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

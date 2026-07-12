// @vitest-environment node
// Locks the RAG cost fixes: (1) ingest REPLACES same-title docs instead of duplicating
// (the loop that made 39% of rag_documents duplicates), (2) non-UUID course ids are
// coerced to null before the uuid RPC param (bigint courses.id used to 500 the search,
// which is what TRIGGERED the duplicate re-ingests), (3) backfill's steady-state pass
// no longer downloads the whole library's content_text.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { makeSupabaseMock } from "./helpers";

vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }));
import { createClient } from "@supabase/supabase-js";

async function loadRag(router: (ctx: any) => any) {
  const { client, calls } = makeSupabaseMock(router);
  vi.resetModules();
  (createClient as any).mockReturnValue(client);
  const rag = await import("../api/rag.ts");
  return { rag, client, calls };
}

const embedFetchMock = () => vi.fn(async () => ({
  ok: true,
  json: async () => ({ data: [{ index: 0, embedding: Array(1536).fill(0.01) }] }),
}));

beforeEach(() => {
  process.env.SUPABASE_URL = "http://localhost";
  process.env.SUPABASE_SERVICE_KEY = "test";
  process.env.OPENAI_API_KEY = "test-openai";
});
afterEach(() => vi.unstubAllGlobals());

describe("ingest replace-dedup", () => {
  it("deletes prior docs with the same (user, title) BEFORE inserting the new one", async () => {
    const { rag, calls } = await loadRag(() => ({ error: null }));
    const res = await rag.ingest({ userId: "u1", title: "Lecture 3", text: "cells divide by mitosis" });
    expect(res.status).toBe(200);

    const delIdx = calls.findIndex(c => c.table === "rag_documents" && c.op === "delete");
    const insIdx = calls.findIndex(c => c.table === "rag_documents" && c.op === "insert");
    expect(delIdx).toBeGreaterThanOrEqual(0);          // replace semantics: delete happens
    expect(delIdx).toBeLessThan(insIdx);               // ...and happens FIRST
    const del = calls[delIdx];
    expect(del.filters).toEqual(expect.arrayContaining([["eq", "user_id", "u1"], ["eq", "title", "Lecture 3"]]));
  });

  it("a failed dedup delete does NOT block indexing (best-effort)", async () => {
    const { rag } = await loadRag((ctx) =>
      ctx.table === "rag_documents" && ctx.op === "delete"
        ? { error: { message: "boom" } }
        : { error: null });
    const res = await rag.ingest({ userId: "u1", title: "T", text: "hello world content" });
    expect(res.status).toBe(200);
  });
});

describe("uuid coercion", () => {
  it("coerceUuid keeps uuids, nulls everything else", async () => {
    const { rag } = await loadRag(() => ({ error: null }));
    expect(rag.coerceUuid("6f9619ff-8b86-d011-b42d-00c04fc964ff")).toBe("6f9619ff-8b86-d011-b42d-00c04fc964ff");
    expect(rag.coerceUuid(5831)).toBeNull();           // live courses.id is BIGINT
    expect(rag.coerceUuid("4552")).toBeNull();         // LMS course number
    expect(rag.coerceUuid(null)).toBeNull();
  });

  it("ingest writes course_id null for a bigint course id (rows still index)", async () => {
    const { rag, calls } = await loadRag(() => ({ error: null }));
    const res = await rag.ingest({ userId: "u1", courseId: 5831, title: "T", text: "some text here" });
    expect(res.status).toBe(200);
    const doc = calls.find(c => c.table === "rag_documents" && c.op === "insert");
    expect(doc.payload.course_id).toBeNull();
  });
});

describe("query course-id guard (the re-ingest-loop root cause)", () => {
  it("passes p_course_id NULL to the uuid RPC when given a bigint id — no more 500", async () => {
    vi.stubGlobal("fetch", embedFetchMock());
    const { rag, calls } = await loadRag((ctx) => {
      if (ctx.table === "rpc:rag_hybrid_search") return { data: [], error: null };
      return { data: [], error: null };
    });
    // default export handler routes ?action=query — call through the handler
    const handler = (rag as any).default;
    const res: any = { statusCode: 0, setHeader: () => {}, status(c: number) { this.statusCode = c; return this; }, json(o: any) { this.body = o; return this; } };
    await handler({ method: "POST", query: { action: "query" }, body: { userId: "u1", courseId: 5831, query: "mitosis" } }, res);
    expect(res.statusCode).toBe(200);                  // used to be 500 (uuid cast)
    const rpc = calls.find(c => c.table === "rpc:rag_hybrid_search");
    expect(rpc.payload.p_course_id).toBeNull();
  });
});

describe("backfill light select", () => {
  it("steady state (everything indexed) never selects content_text", async () => {
    const { rag, calls } = await loadRag((ctx) => {
      if (ctx.table === "files")         return { data: [{ id: "f1", name: "Doc A", course_id: null, source_url: null }], error: null };
      if (ctx.table === "rag_documents") return { data: [{ title: "Doc A" }], error: null };
      if (ctx.table === "rag_chunks")    return { data: [], error: null };   // nothing pending to embed
      return { data: [], error: null };
    });
    const handler = (rag as any).default;
    const res: any = { statusCode: 0, setHeader: () => {}, status(c: number) { this.statusCode = c; return this; }, json(o: any) { this.body = o; return this; } };
    await handler({ method: "POST", query: { action: "backfill" }, body: { userId: "u1" } }, res);
    expect(res.body.done).toBe(true);
    for (const c of calls.filter(c => c.table === "files" && c.op === "select")) {
      expect(String(c.payload)).not.toContain("content_text");   // the whole point
    }
  });

  it("fetches content_text ONLY for the pending file when indexing is actually needed", async () => {
    vi.stubGlobal("fetch", embedFetchMock());
    let filesCalls = 0;
    const { rag, calls } = await loadRag((ctx) => {
      if (ctx.table === "files" && ctx.op === "select") {
        filesCalls++;
        // 1st call: metadata list; later calls: single-row content fetch
        return filesCalls === 1
          ? { data: [{ id: "f1", name: "Doc A", course_id: null, source_url: null }], error: null }
          : { data: [{ content_text: "real document text to index" }], error: null };
      }
      if (ctx.table === "rag_documents" && ctx.op === "select") return { data: [], error: null }; // nothing indexed yet
      if (ctx.table === "rag_chunks" && ctx.op === "select")    return { data: [], error: null };
      return { data: null, error: null };
    });
    const handler = (rag as any).default;
    const res: any = { statusCode: 0, setHeader: () => {}, status(c: number) { this.statusCode = c; return this; }, json(o: any) { this.body = o; return this; } };
    await handler({ method: "POST", query: { action: "backfill" }, body: { userId: "u1", limit: 3 } }, res);

    // The content fetch is per-id, and the doc actually got ingested.
    const contentFetch = calls.filter(c => c.table === "files" && String(c.payload) === "content_text");
    expect(contentFetch.length).toBe(1);
    expect(contentFetch[0].filters).toEqual(expect.arrayContaining([["eq", "id", "f1"]]));
    expect(calls.some(c => c.table === "rag_documents" && c.op === "insert")).toBe(true);
  });
});

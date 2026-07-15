import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../api/_auth.ts", () => ({
  requireUser: async (req) => { const id = req?.__internalUserId ?? req?.body?.userId ?? req?.body?.fromUserId ?? req?.query?.userId; return id ? { userId: String(id), authId: "test" } : null; },
  requireUserOr401: async (req, res) => { const id = req?.__internalUserId ?? req?.body?.userId ?? req?.body?.fromUserId ?? req?.query?.userId; if (!id) { res?.status?.(401)?.json?.({ error: "auth required" }); return null; } return String(id); },
}));

import { makeSupabaseMock, makeRes } from "./helpers";

vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }));
import { createClient } from "@supabase/supabase-js";

// transcribe.ts imports ingest/embedBatch from ./rag.js — they run against the same
// mocked Supabase, so a router that returns [] for pending chunks lets the embed loop
// finish immediately (no OpenAI call needed).
async function loadTranscribe(router: (ctx: any) => any) {
  const { client, calls } = makeSupabaseMock(router);
  vi.resetModules();
  (createClient as any).mockReturnValue(client);
  const mod = await import("../api/transcribe.ts");
  return { handler: mod.default, calls };
}

const post = (action: string, body: any) => ({ method: "POST", query: { action }, body });

beforeEach(() => {
  process.env.SUPABASE_URL = "http://localhost";
  process.env.SUPABASE_SERVICE_KEY = "test";
  process.env.ELEVENLABS_API_KEY = "test-eleven";
  process.env.OPENAI_API_KEY = "test-openai";
});
afterEach(() => vi.unstubAllGlobals());

describe("transcribe: sign", () => {
  it("returns a signed upload path + token", async () => {
    const { handler } = await loadTranscribe((ctx) =>
      ctx.op === "createSignedUploadUrl" ? { data: { path: ctx.payload, token: "up-token" }, error: null } : { error: null });
    const res = makeRes();
    await handler(post("sign", { userId: "u1", filename: "lecture.mp3" }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.token).toBe("up-token");
    expect(res.body.path).toContain("u1/");
  });

  it("401s without a session (auth is the first gate)", async () => {
    const { handler } = await loadTranscribe(() => ({ error: null }));
    const res = makeRes();
    await handler(post("sign", { filename: "x.mp3" }), res);
    expect(res.statusCode).toBe(401);
  });
});

describe("transcribe: start", () => {
  it("500s when the ElevenLabs key is missing", async () => {
    delete process.env.ELEVENLABS_API_KEY;
    const { handler } = await loadTranscribe(() => ({ error: null }));
    const res = makeRes();
    await handler(post("start", { userId: "u1", storagePath: "u1/a.mp3" }), res);
    expect(res.statusCode).toBe(500);
    expect(res.body.error).toContain("ELEVENLABS_API_KEY");
  });

  it("downloads the file, transcribes via Scribe, ingests, and reports done", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({ text: "hello from the lecture" }),
      text: async () => "",
    })));
    const { handler, calls } = await loadTranscribe((ctx) => {
      if (ctx.op === "download") return { data: new Blob(["audio-bytes"]), error: null };
      if (ctx.table === "rag_chunks" && ctx.op === "select") return { data: [], error: null }; // no pending → embed loop ends
      return { error: null };
    });
    const res = makeRes();
    await handler(post("start", { userId: "u1", storagePath: "u1/lecture.mp3", title: "Lecture 1", kind: "audio" }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe("done");
    expect(res.body.documentId).toBeTruthy();
    // Scribe was called with the right model + endpoint
    expect((globalThis.fetch as any)).toHaveBeenCalledWith("https://api.elevenlabs.io/v1/speech-to-text", expect.anything());
    // job moved transcribing → done
    const updates = calls.filter(c => c.table === "media_jobs" && c.op === "update").map(c => c.payload.status);
    expect(updates).toContain("done");
  });

  it("marks the job 'error' when Scribe returns non-200", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 401, text: async () => "invalid api key" })));
    const { handler, calls } = await loadTranscribe((ctx) =>
      ctx.op === "download" ? { data: new Blob(["x"]), error: null } : { error: null });
    const res = makeRes();
    await handler(post("start", { userId: "u1", storagePath: "u1/a.mp3" }), res);

    expect(res.body.status).toBe("error");
    expect(res.body.error).toContain("ElevenLabs STT 401");
    const updates = calls.filter(c => c.table === "media_jobs" && c.op === "update").map(c => c.payload.status);
    expect(updates).toContain("error");
  });
});

describe("transcribe: status", () => {
  it("returns the job row", async () => {
    const { handler } = await loadTranscribe((ctx) =>
      ctx.table === "media_jobs" ? { data: { id: "job1", status: "done", document_id: "d1", title: "L1" }, error: null } : { error: null });
    const res = makeRes();
    await handler(post("status", { jobId: "job1", userId: "u1" }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.job.status).toBe("done");
  });

  it("400s without jobId", async () => {
    const { handler } = await loadTranscribe(() => ({ error: null }));
    const res = makeRes();
    await handler(post("status", { userId: "u1" }), res);
    expect(res.statusCode).toBe(400);
  });
});

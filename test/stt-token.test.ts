// @vitest-environment node
// POST /api/stt?action=token — mints a single-use ElevenLabs Scribe credential so the
// browser can open the realtime WebSocket without ever holding ELEVENLABS_API_KEY.
// (VOICE-1, see VOICE-STREAMING-SPEC.md.)
//
// The key guarantees under test: the action is auth-gated (the batch path below it is
// not, historically), the upstream key never appears in the response, and the action is
// dispatched BEFORE the raw-body read that the audio path performs — bodyParser is off
// for this endpoint, so a fall-through would hang on a request that carries no body.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

let authedUser: string | null;
let rateLimitOk: boolean;
let fetchImpl: (url: string, init: any) => Promise<any>;
let rateLimitCalls: string[];

vi.mock("../api/_auth.js", () => ({
  requireUserOr401: async (_req: any, res: any) => {
    if (!authedUser) { res.status(401).json({ error: "Authorization required" }); return null; }
    return authedUser;
  },
}));

vi.mock("../api/_ratelimit.js", () => ({
  rateLimit: async (_req: any, res: any, bucket: string) => {
    rateLimitCalls.push(bucket);
    if (!rateLimitOk) { res.status(429).json({ error: "rate limited" }); return false; }
    return true;
  },
}));

function mockRes() {
  const out: any = { code: 0, body: null, headers: {} };
  out.setHeader = (k: string, v: string) => { out.headers[k] = v; };
  out.status = (c: number) => { out.code = c; return out; };
  out.json = (o: any) => { out.body = o; return out; };
  out.end = () => out;
  return out;
}

const tokenReq = () => ({ method: "POST", query: { action: "token" }, headers: {} });

beforeEach(() => {
  authedUser = "user-1";
  rateLimitOk = true;
  rateLimitCalls = [];
  process.env.ELEVENLABS_API_KEY = "sk_secret_key";
  fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ token: "tok_abc123" }) });
  vi.stubGlobal("fetch", (u: string, i: any) => fetchImpl(u, i));
});
afterEach(() => { vi.resetModules(); vi.unstubAllGlobals(); });

async function load() { return (await import("../api/stt.ts")).default; }

describe("POST /api/stt?action=token", () => {
  it("returns a token for a signed-in caller", async () => {
    const res = mockRes();
    await (await load())(tokenReq(), res);
    expect(res.code).toBe(200);
    expect(res.body).toEqual({ token: "tok_abc123" });
  });

  it("401s an anonymous caller", async () => {
    authedUser = null;
    const res = mockRes();
    await (await load())(tokenReq(), res);
    expect(res.code).toBe(401);
    expect(res.body?.token).toBeUndefined();
  });

  it("never leaks the upstream API key to the client", async () => {
    const res = mockRes();
    await (await load())(tokenReq(), res);
    expect(JSON.stringify(res.body)).not.toContain("sk_secret_key");
  });

  it("sends the key upstream as xi-api-key, not a bearer token", async () => {
    let seenUrl = "", seenHeaders: any = {};
    fetchImpl = async (url, init) => {
      seenUrl = url; seenHeaders = init.headers;
      return { ok: true, status: 200, json: async () => ({ token: "t" }) };
    };
    await (await load())(tokenReq(), mockRes());
    expect(seenUrl).toBe("https://api.elevenlabs.io/v1/single-use-token/realtime_scribe");
    expect(seenHeaders["xi-api-key"]).toBe("sk_secret_key");
  });

  it("503s when the key is unset rather than calling upstream", async () => {
    delete process.env.ELEVENLABS_API_KEY;
    let called = false;
    fetchImpl = async () => { called = true; return { ok: true, json: async () => ({}) }; };
    const res = mockRes();
    await (await load())(tokenReq(), res);
    expect(res.code).toBe(503);
    expect(res.body).toEqual({ error: "voice_not_configured" });
    expect(called).toBe(false);
  });

  it("502s when ElevenLabs rejects, without echoing upstream detail", async () => {
    fetchImpl = async () => ({ ok: false, status: 401, text: async () => "invalid api key" });
    const res = mockRes();
    await (await load())(tokenReq(), res);
    expect(res.code).toBe(502);
    expect(JSON.stringify(res.body)).not.toContain("invalid api key");
  });

  it("502s when the response omits the token", async () => {
    fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({}) });
    const res = mockRes();
    await (await load())(tokenReq(), res);
    expect(res.code).toBe(502);
  });

  it("honours the rate limit on its own bucket", async () => {
    rateLimitOk = false;
    const res = mockRes();
    await (await load())(tokenReq(), res);
    expect(res.code).toBe(429);
    expect(rateLimitCalls).toEqual(["stt-token"]);
  });

  it("rejects non-POST before touching auth", async () => {
    const res = mockRes();
    await (await load())({ method: "GET", query: { action: "token" }, headers: {} }, res);
    expect(res.code).toBe(405);
  });

  // Regression guard: bodyParser is disabled for this endpoint, so the batch path reads
  // the request stream directly. A token request carries no body and is not iterable —
  // if dispatch ever moves below that read, this test hangs or throws instead of passing.
  it("dispatches without reading the request stream", async () => {
    const req: any = tokenReq();
    Object.defineProperty(req, Symbol.asyncIterator, {
      get() { throw new Error("token path must not read the request stream"); },
    });
    const res = mockRes();
    await (await load())(req, res);
    expect(res.code).toBe(200);
  });
});

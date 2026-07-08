// @vitest-environment node
// Tests the client SSE consumer (src/lib/reggieStream.ts): normal completion, an HTTP
// error before the stream, and — the case the adversarial review caught — a stream that
// closes WITHOUT a done/error frame must still signal onError (not wedge "streaming").
import { describe, it, expect, vi, afterEach } from "vitest";
import { streamReggie } from "../src/lib/reggieStream";

afterEach(() => vi.unstubAllGlobals());

const frame = (ev: string, obj: any) => `event: ${ev}\ndata: ${JSON.stringify(obj)}\n\n`;
function fakeRes(chunks: string[]) {
  const enc = new TextEncoder();
  return {
    ok: true, status: 200,
    body: new ReadableStream<Uint8Array>({ start(c) { for (const ch of chunks) c.enqueue(enc.encode(ch)); c.close(); } }),
  };
}

describe("streamReggie (client SSE consumer)", () => {
  it("delivers tokens in order and resolves via the done frame", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => fakeRes([
      frame("route", { route: "tutor" }),
      frame("token", { text: "Hi " }),
      frame("token", { text: "there" }),
      frame("done", { ok: true, route: "tutor", output: "Hi there", toolCalls: [], steps: 1, budgetExhausted: false, brainContextUsed: true }),
    ])));
    const tokens: string[] = []; let done: any = null; let err: any = null; let route: any = null;
    await streamReggie({ userId: "u1", message: "hi" },
      { onRoute: (r) => (route = r), onToken: (d) => tokens.push(d), onDone: (r) => (done = r), onError: (m) => (err = m) });
    expect(route).toBe("tutor");
    expect(tokens.join("")).toBe("Hi there");
    expect(done?.output).toBe("Hi there");
    expect(done?.brainContextUsed).toBe(true);
    expect(err).toBeNull();
  });

  it("signals onError (keeping partial tokens) when the stream is cut off with no done frame", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => fakeRes([
      frame("token", { text: "partial answer" }),   // stream ends here — no done/error
    ])));
    const tokens: string[] = []; let done: any = null; let err: any = null;
    await streamReggie({ userId: "u1", message: "hi" },
      { onToken: (d) => tokens.push(d), onDone: (r) => (done = r), onError: (m) => (err = m) });
    expect(tokens.join("")).toBe("partial answer");   // partial tokens still delivered
    expect(done).toBeNull();
    expect(err).toMatch(/cut off/i);                   // and we DO signal completion
  });

  it("surfaces an HTTP error before the stream via onError", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 502, json: async () => ({ error: "boom" }) })));
    let err: any = null; let done: any = null;
    await streamReggie({ userId: "u1", message: "hi" }, { onError: (m) => (err = m), onDone: (r) => (done = r) });
    expect(err).toBe("boom");
    expect(done).toBeNull();
  });

  it("routes an `error` SSE frame to onError", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => fakeRes([frame("error", { error: "Reggie failed" })])));
    let err: any = null;
    await streamReggie({ userId: "u1", message: "hi" }, { onError: (m) => (err = m) });
    expect(err).toBe("Reggie failed");
  });
});

// @vitest-environment node
// scribeStream — realtime STT session against ElevenLabs Scribe v2 (VOICE-2/VOICE-3).
//
// The logic worth pinning is turn assembly. The provider's VAD commits per speech
// SEGMENT, not per turn, so a speaker who pauses mid-thought produces two
// committed_transcript frames. Dispatching on the first would cut them off — these tests
// hold that behaviour still. Also covered: the 5s idle close (ElevenLabs bills connected
// time) and that the API key is never required client-side.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

let sockets: FakeSocket[] = [];

class FakeSocket {
  static OPEN = 1;
  url: string;
  readyState = 1;
  sent: any[] = [];
  onopen: any; onmessage: any; onerror: any; onclose: any;
  closed = false;
  constructor(url: string) { this.url = url; sockets.push(this); }
  send(d: any) { this.sent.push(d); }
  close() { this.closed = true; this.readyState = 3; this.onclose?.(); }
  // test helpers
  open() { this.onopen?.(); }
  emit(obj: any) { this.onmessage?.({ data: JSON.stringify(obj) }); }
}

class FakeAudioContext {
  sampleRate: number;
  audioWorklet = { addModule: async () => {} };
  constructor(o: any) { this.sampleRate = o?.sampleRate; }
  createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
  close() {}
}

class FakeWorkletNode {
  port = { onmessage: null as any, close() {} };
  constructor() { (globalThis as any).__lastWorkletNode = this; }
  disconnect() {}
}

function setupGlobals(tokenStatus = 200) {
  vi.stubGlobal("WebSocket", FakeSocket as any);
  vi.stubGlobal("AudioContext", FakeAudioContext as any);
  vi.stubGlobal("AudioWorkletNode", FakeWorkletNode as any);
  vi.stubGlobal("URL", Object.assign(globalThis.URL, {
    createObjectURL: () => "blob:worklet",
    revokeObjectURL: () => {},
  }));
  vi.stubGlobal("Blob", class { constructor(_p: any, _o: any) {} } as any);
  vi.stubGlobal("fetch", async () => ({
    ok: tokenStatus === 200,
    status: tokenStatus,
    json: async () => ({ token: "tok_test" }),
  }));
}

const stream = { getTracks: () => [] } as any;

beforeEach(() => {
  sockets = [];
  vi.useFakeTimers();
  setupGlobals();
  (import.meta as any).env = { ...(import.meta as any).env, VITE_VOICE_STREAMING: "1" };
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetModules(); });

async function load() { return await import("../src/lib/scribeStream.ts"); }

describe("turn assembly", () => {
  it("coalesces two committed segments separated by a short pause into ONE turn", async () => {
    const { startScribeSession } = await load();
    const turns: string[] = [];
    await startScribeSession({ stream, onTurn: t => turns.push(t) });
    const ws = sockets[0];
    ws.open();

    ws.emit({ message_type: "committed_transcript", text: "Okay so" });
    vi.advanceTimersByTime(400);            // shorter than the turn gap
    ws.emit({ message_type: "committed_transcript", text: "what's my grade" });
    expect(turns).toEqual([]);              // nothing dispatched yet

    vi.advanceTimersByTime(1000);           // now past the gap
    expect(turns).toEqual(["Okay so what's my grade"]);
  });

  it("dispatches a single segment after the gap", async () => {
    const { startScribeSession } = await load();
    const turns: string[] = [];
    await startScribeSession({ stream, onTurn: t => turns.push(t) });
    const ws = sockets[0];
    ws.open();

    ws.emit({ message_type: "committed_transcript", text: "hello there" });
    vi.advanceTimersByTime(1000);
    expect(turns).toEqual(["hello there"]);
  });

  it("does not dispatch an empty turn when no text was committed", async () => {
    const { startScribeSession } = await load();
    const turns: string[] = [];
    await startScribeSession({ stream, onTurn: t => turns.push(t) });
    const ws = sockets[0];
    ws.open();
    vi.advanceTimersByTime(10000);
    expect(turns).toEqual([]);
  });

  it("surfaces partials without dispatching a turn", async () => {
    const { startScribeSession } = await load();
    const partials: string[] = [];
    const turns: string[] = [];
    await startScribeSession({ stream, onPartial: t => partials.push(t), onTurn: t => turns.push(t) });
    const ws = sockets[0];
    ws.open();

    ws.emit({ message_type: "partial_transcript", text: "what" });
    ws.emit({ message_type: "partial_transcript", text: "what's my" });
    expect(partials).toEqual(["what", "what's my"]);
    expect(turns).toEqual([]);
  });
});

describe("idle close", () => {
  it("closes the socket after 5s with no inbound transcripts", async () => {
    const { startScribeSession } = await load();
    const session = await startScribeSession({ stream, onTurn: () => {} });
    const ws = sockets[0];
    ws.open();

    vi.advanceTimersByTime(4900);
    expect(ws.closed).toBe(false);
    vi.advanceTimersByTime(200);
    expect(ws.closed).toBe(true);
    expect(session.isActive()).toBe(false);
  });

  it("a partial transcript resets the idle clock", async () => {
    const { startScribeSession } = await load();
    await startScribeSession({ stream, onTurn: () => {} });
    const ws = sockets[0];
    ws.open();

    vi.advanceTimersByTime(4000);
    ws.emit({ message_type: "partial_transcript", text: "still talking" });
    vi.advanceTimersByTime(4000);
    expect(ws.closed).toBe(false);   // would have closed at 5000 without the reset
  });

  it("flushes a pending turn before closing on idle", async () => {
    const { startScribeSession } = await load();
    const turns: string[] = [];
    await startScribeSession({ stream, onTurn: t => turns.push(t) });
    const ws = sockets[0];
    ws.open();

    ws.emit({ message_type: "committed_transcript", text: "buffered words" });
    vi.advanceTimersByTime(10000);
    expect(turns).toEqual(["buffered words"]);
  });
});

describe("connection", () => {
  it("requests VAD commit strategy and 16kHz PCM, and carries the minted token", async () => {
    const { startScribeSession } = await load();
    await startScribeSession({ stream, onTurn: () => {} });
    const url = new URL(sockets[0].url);
    expect(url.searchParams.get("model_id")).toBe("scribe_v2_realtime");
    expect(url.searchParams.get("commit_strategy")).toBe("vad");
    expect(url.searchParams.get("audio_format")).toBe("pcm_16000");
    expect(url.searchParams.get("token")).toBe("tok_test");
  });

  it("throws with auth_error when the token mint 401s", async () => {
    vi.unstubAllGlobals();
    setupGlobals(401);
    const { startScribeSession } = await load();
    const errors: string[] = [];
    await expect(
      startScribeSession({ stream, onTurn: () => {}, onError: k => errors.push(k) }),
    ).rejects.toThrow();
    expect(errors).toEqual(["auth_error"]);
    expect(sockets).toHaveLength(0);   // never opened a socket without a token
  });

  it("reports not_configured when the server has no ElevenLabs key", async () => {
    vi.unstubAllGlobals();
    setupGlobals(503);
    const { startScribeSession } = await load();
    const errors: string[] = [];
    await expect(
      startScribeSession({ stream, onTurn: () => {}, onError: k => errors.push(k) }),
    ).rejects.toThrow();
    expect(errors).toEqual(["not_configured"]);
  });

  it("terminal provider errors stop the session", async () => {
    const { startScribeSession } = await load();
    const errors: string[] = [];
    const session = await startScribeSession({ stream, onTurn: () => {}, onError: k => errors.push(k) });
    sockets[0].open();
    sockets[0].emit({ message_type: "quota_exceeded", message: "out of credits" });
    expect(errors).toEqual(["quota_exceeded"]);
    expect(session.isActive()).toBe(false);
  });

  it("transient pressure is reported but does NOT kill the session", async () => {
    const { startScribeSession } = await load();
    const errors: string[] = [];
    const session = await startScribeSession({ stream, onTurn: () => {}, onError: k => errors.push(k) });
    sockets[0].open();
    sockets[0].emit({ message_type: "rate_limited", message: "slow down" });
    expect(errors).toEqual(["rate_limited"]);
    expect(session.isActive()).toBe(true);
  });

  // Regression: the first implementation nested the fields under an "input_audio_chunk"
  // key and read inbound frames off msg.type. The socket accepted the connection, then
  // rejected every audio frame with
  //   {"message_type":"input_error","error":"Message must be a valid protocol message"}
  // while the mis-read inbound frames failed silently. Both halves are pinned here.
  it("sends audio frames flat, with message_type as the discriminator", async () => {
    const { startScribeSession } = await load();
    await startScribeSession({ stream, onTurn: () => {} });
    const ws = sockets[0];
    ws.open();

    // Drive one chunk through the worklet port the same way the capture graph does.
    const node = (globalThis as any).__lastWorkletNode;
    node.port.onmessage({ data: new Int16Array([1, -1, 300]) });

    const frame = JSON.parse(ws.sent[0]);
    expect(frame.message_type).toBe("input_audio_chunk");
    expect(frame.input_audio_chunk).toBeUndefined();   // must NOT be nested
    expect(frame.sample_rate).toBe(16000);
    expect(frame.commit).toBe(false);
    expect(typeof frame.audio_base_64).toBe("string");
  });

  it("ignores inbound frames that use the wrong discriminator", async () => {
    const { startScribeSession } = await load();
    const turns: string[] = [];
    await startScribeSession({ stream, onTurn: t => turns.push(t) });
    const ws = sockets[0];
    ws.open();
    ws.emit({ type: "committed_transcript", text: "should be ignored" });
    vi.advanceTimersByTime(2000);
    expect(turns).toEqual([]);
  });

  // The caller shows "connecting" until this fires and "listening" after. If it fired
  // early the orb would invite the user to speak into a socket that isn't open, and
  // those words would be dropped with no indication.
  it("onReady fires only once the socket is open, never before", async () => {
    const { startScribeSession } = await load();
    let ready = false;
    await startScribeSession({ stream, onTurn: () => {}, onReady: () => { ready = true; } });
    expect(ready).toBe(false);      // session constructed, socket not yet open
    sockets[0].open();
    expect(ready).toBe(true);
  });

  it("onReady never fires when the token mint fails", async () => {
    vi.unstubAllGlobals();
    setupGlobals(401);
    const { startScribeSession } = await load();
    let ready = false;
    await expect(
      startScribeSession({ stream, onTurn: () => {}, onReady: () => { ready = true; } }),
    ).rejects.toThrow();
    expect(ready).toBe(false);
  });

  it("stop() is idempotent", async () => {
    const { startScribeSession } = await load();
    let closes = 0;
    const session = await startScribeSession({ stream, onTurn: () => {}, onClose: () => closes++ });
    sockets[0].open();
    session.stop();
    session.stop();
    expect(closes).toBe(1);
  });
});

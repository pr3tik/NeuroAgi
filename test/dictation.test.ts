// @vitest-environment node
// Dictation engine tests (src/lib/dictation.ts): engine selection, Web Speech
// interim/final routing + error filtering, and the server-STT fallback (record →
// /api/stt → text or friendly failure). All browser APIs stubbed.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Engine selection reads VITE_VOICE_STREAMING. Pin it OFF by default so these tests
// describe the Web Speech / server engines deterministically — without this they'd
// silently change meaning depending on whether a developer has the flag in .env.local.
// The Scribe engine block below opts back in explicitly.
beforeEach(() => { vi.stubEnv("VITE_VOICE_STREAMING", "0"); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules(); });

async function lib() { return await import("../src/lib/dictation"); }

// ── Fake Web Speech API ─────────────────────────────────────────────────────
class FakeRecognition {
  static last: FakeRecognition | null = null;
  lang = ""; continuous = false; interimResults = false;
  onresult: any; onerror: any; onend: any;
  started = false; stopped = false;
  constructor() { FakeRecognition.last = this; }
  start() { this.started = true; }
  stop() { this.stopped = true; this.onend?.(); }
  emit(results: Array<{ text: string; final: boolean }>, resultIndex = 0) {
    this.onresult?.({
      resultIndex,
      results: results.map((r) => Object.assign([{ transcript: r.text }], { isFinal: r.final })),
    });
  }
}

describe("engine selection", () => {
  it("prefers Web Speech when present; falls back to server otherwise", async () => {
    vi.stubGlobal("SpeechRecognition", FakeRecognition);
    let d = (await lib()).createDictation({ onFinal: () => {} });
    expect(d.engine).toBe("webspeech");

    vi.unstubAllGlobals(); vi.resetModules();
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: vi.fn() }, language: "en-US" });
    d = (await lib()).createDictation({ onFinal: () => {} });
    expect(d.engine).toBe("server");
  });
});

describe("web speech engine", () => {
  it("routes interim → onInterim and finals → onFinal (appended per final)", async () => {
    vi.stubGlobal("SpeechRecognition", FakeRecognition);
    const finals: string[] = []; const interims: string[] = [];
    const d = (await lib()).createDictation({ onFinal: (t) => finals.push(t), onInterim: (t) => interims.push(t) });
    await d.start();
    const rec = FakeRecognition.last!;
    expect(rec.started).toBe(true);
    expect(rec.continuous).toBe(true);
    rec.emit([{ text: "what is the ", final: false }]);
    rec.emit([{ text: "what is the calvin cycle", final: true }]);
    // Real Web Speech sends the FULL cumulative results list; resultIndex points at the
    // first NEW entry — the engine must only process from there.
    rec.emit([{ text: "what is the calvin cycle", final: true }, { text: " and why", final: false }], 1);
    expect(interims).toEqual(["what is the", "and why"]);
    expect(finals).toEqual(["what is the calvin cycle"]);
  });

  it("filters lifecycle noise but surfaces permission errors; stop() fires onEnd", async () => {
    vi.stubGlobal("SpeechRecognition", FakeRecognition);
    const errors: string[] = []; let ended = false;
    const d = (await lib()).createDictation({ onFinal: () => {}, onError: (m) => errors.push(m), onEnd: () => (ended = true) });
    await d.start();
    const rec = FakeRecognition.last!;
    rec.onerror({ error: "no-speech" });     // normal — ignored
    rec.onerror({ error: "aborted" });       // normal — ignored
    rec.onerror({ error: "not-allowed" });   // real — friendly message
    expect(errors).toEqual(["Microphone permission denied."]);
    d.stop();
    expect(ended).toBe(true);
    expect(d.listening).toBe(false);
  });
});

describe("server fallback engine", () => {
  function stubRecordingWorld(sttResponse: any, ok = true) {
    class FakeMR {
      static isTypeSupported = () => true;
      state = "recording";
      ondataavailable: any; onstop: any;
      constructor(public stream: any, public opts: any) {}
      start() {}
      stop() { this.state = "inactive"; this.ondataavailable?.({ data: { size: 5 } }); this.onstop?.(); }
    }
    vi.stubGlobal("MediaRecorder", FakeMR);
    vi.stubGlobal("navigator", {
      mediaDevices: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: vi.fn() }] })) },
      language: "en-US",
    });
    vi.stubGlobal("Blob", class { size = 5; constructor(public parts: any, public opts: any) {} });
    vi.stubGlobal("FileReader", class {
      onload: any; onerror: any; result = "data:audio/webm;base64,QUJD";
      readAsDataURL() { setTimeout(() => this.onload?.(), 0); }
    });
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok, status: ok ? 200 : 502, json: async () => sttResponse })));
  }

  it("records, posts to /api/stt, and commits the transcript", async () => {
    stubRecordingWorld({ text: "  hello from whisper  " });
    const finals: string[] = []; let ended = false;
    const d = (await lib()).createDictation({ onFinal: (t) => finals.push(t), onEnd: () => (ended = true) });
    expect(d.engine).toBe("server");
    await d.start();
    expect(d.listening).toBe(true);
    d.stop();
    await new Promise((r) => setTimeout(r, 10));
    expect(finals).toEqual(["hello from whisper"]);
    expect(ended).toBe(true);
    const call = (globalThis.fetch as any).mock.calls[0];
    expect(String(call[0])).toBe("/api/stt");
    expect(JSON.parse(call[1].body).audio).toBe("QUJD");
  });

  it("treats Whisper's silence output ('.') as a friendly retry message, not a transcript", async () => {
    stubRecordingWorld({ text: "." });
    const finals: string[] = []; const errors: string[] = [];
    const d = (await lib()).createDictation({ onFinal: (t) => finals.push(t), onError: (m) => errors.push(m) });
    await d.start(); d.stop();
    await new Promise((r) => setTimeout(r, 10));
    expect(finals).toEqual([]);
    expect(errors[0]).toMatch(/Didn't catch that/);
  });

  it("surfaces a permission denial and still ends cleanly", async () => {
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: vi.fn(async () => { throw new Error("denied"); }) }, language: "en-US" });
    const errors: string[] = []; let ended = false;
    const d = (await lib()).createDictation({ onFinal: () => {}, onError: (m) => errors.push(m), onEnd: () => (ended = true) });
    await d.start();
    expect(errors).toEqual(["Microphone permission denied."]);
    expect(ended).toBe(true);
    expect(d.listening).toBe(false);
  });
});

// ── Engine 3: ElevenLabs Scribe ──────────────────────────────────────────────
describe("scribe engine", () => {
  let sessions: any[];

  beforeEach(() => {
    sessions = [];
    vi.stubEnv("VITE_VOICE_STREAMING", "1");
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [] }) } });
    vi.doMock("../src/lib/scribeStream", () => ({
      isStreamingSTT: () => true,
      startScribeSession: async (opts: any) => {
        const s = { opts, stopped: false, stop() { this.stopped = true; }, isActive: () => !s.stopped };
        sessions.push(s);
        return s;
      },
    }));
  });

  it("is selected over Web Speech when the switch is on", async () => {
    vi.stubGlobal("SpeechRecognition", class {});
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [] }) } });
    const d = (await lib()).createDictation({ onFinal: () => {} });
    expect(d.engine).toBe("scribe");
  });

  it("routes partials to onInterim and committed segments to onFinal", async () => {
    const finals: string[] = []; const interims: string[] = [];
    const d = (await lib()).createDictation({ onFinal: t => finals.push(t), onInterim: t => interims.push(t) });
    await d.start();
    const { onPartial, onSegment } = sessions[0].opts;
    onPartial("what is");
    onSegment("What is a heap?");
    expect(interims).toEqual(["what is"]);
    expect(finals).toEqual(["What is a heap?"]);
  });

  // The defining difference from the orb: dictation fills an input box and the USER
  // decides when the thought is done. Consuming assembled turns here would make the
  // mic button behave like a voice agent.
  it("uses onSegment and never subscribes to assembled turns", async () => {
    const d = (await lib()).createDictation({ onFinal: () => {} });
    await d.start();
    expect(sessions[0].opts.onSegment).toBeTypeOf("function");
    expect(sessions[0].opts.onTurn).toBeUndefined();
  });

  it("stop() closes the session and reports end exactly once", async () => {
    let ends = 0;
    const d = (await lib()).createDictation({ onFinal: () => {}, onEnd: () => ends++ });
    await d.start();
    d.stop();
    d.stop();
    expect(sessions[0].stopped).toBe(true);
    expect(ends).toBe(1);
    expect(d.listening).toBe(false);
  });

  it("surfaces a terminal provider error to the user", async () => {
    const errors: string[] = [];
    const d = (await lib()).createDictation({ onFinal: () => {}, onError: e => errors.push(e) });
    await d.start();
    sessions[0].opts.onError("quota_exceeded");
    expect(errors[0]).toMatch(/quota/i);
  });
});

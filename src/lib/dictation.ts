// src/lib/dictation.ts — mic dictation for the chat input: tap to talk, text lands in
// the input box (the user edits/sends — never auto-sent). Engine choice, in order:
//   1. ElevenLabs Scribe (when VITE_VOICE_STREAMING=1): streaming interim + committed
//      text over a WebSocket, same provider and same switch as the orb's voice loop.
//   2. Web Speech API (Chrome/Edge/Safari): instant interim results, no server
//      round-trip, no cost — but Chrome/Safari only, and it routes audio to Google.
//   3. Fallback (Firefox etc.): MediaRecorder → POST /api/stt (Groq Whisper) — one
//      final transcript when the user taps stop.
// Pure logic module (no React) so every engine is unit-testable.
//
// Note on cost: engine 1 opens a billed socket per dictation where engine 2 was free.
// Flipping VITE_VOICE_STREAMING off reverts BOTH this and the orb to the old behaviour.
import { startScribeSession, isStreamingSTT } from "./scribeStream";

export interface DictationHandlers {
  onInterim?: (text: string) => void;   // live partial text (Web Speech only)
  onFinal: (text: string) => void;      // committed text to append to the input
  onError?: (message: string) => void;
  onEnd?: () => void;                   // listening stopped (any reason)
}

export interface Dictation {
  start: () => Promise<void>;
  stop: () => void;                     // stops listening; fallback engine then transcribes
  readonly engine: "scribe" | "webspeech" | "server";
  readonly listening: boolean;
}

function speechRecognitionCtor(): any | null {
  const w = globalThis as any;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function dictationSupported(): boolean {
  return !!speechRecognitionCtor() || !!(globalThis.navigator?.mediaDevices?.getUserMedia);
}

export function createDictation(handlers: DictationHandlers, opts: { lang?: string } = {}): Dictation {
  // Scribe first when the switch is on, so dictation and the orb share one provider and
  // one rollback. Web Speech stays the free path when it isn't.
  if (isStreamingSTT() && globalThis.navigator?.mediaDevices?.getUserMedia) {
    return scribeDictation(handlers);
  }
  const Ctor = speechRecognitionCtor();
  return Ctor ? webSpeechDictation(Ctor, handlers, opts) : serverDictation(handlers);
}

// ── Engine 1: ElevenLabs Scribe (streaming) ───────────────────────────────────
// Uses onSegment, NOT onTurn: dictation appends words to an input box as they commit
// and must never infer that the user has finished a "turn" — the user decides that by
// tapping stop. Turn assembly is the orb's concern, not this one.
function scribeDictation(h: DictationHandlers): Dictation {
  let session: any = null;
  let stream: MediaStream | null = null;
  let listening = false;
  let ended = false;

  function cleanup() {
    if (ended) return;
    ended = true;
    listening = false;
    try { session?.stop(); } catch { /* already closed */ }
    session = null;
    stream?.getTracks().forEach(t => t.stop());
    stream = null;
    h.onEnd?.();
  }

  return {
    engine: "scribe",
    get listening() { return listening; },
    async start() {
      if (listening) return;
      ended = false;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
      } catch {
        h.onError?.("Microphone permission denied.");
        h.onEnd?.();
        return;
      }
      try {
        session = await startScribeSession({
          stream,
          onPartial: (t) => h.onInterim?.(t),
          onSegment: (t) => { const s = t.trim(); if (s) h.onFinal(s); },
          onError: (kind) => {
            h.onError?.(
              kind === "auth_error" ? "Dictation session expired — tap the mic again."
              : kind === "quota_exceeded" ? "Transcription quota reached."
              : kind === "not_configured" ? "Transcription isn't configured on the server."
              : "Dictation failed — tap the mic to retry.",
            );
          },
          onClose: cleanup,
        });
        listening = true;
      } catch {
        // Session never opened; surface it rather than leaving the button lit.
        h.onError?.("Couldn't start dictation — tap the mic to retry.");
        cleanup();
      }
    },
    stop() { cleanup(); },
  };
}

// ── Engine 1: Web Speech API ──────────────────────────────────────────────────
function webSpeechDictation(Ctor: any, h: DictationHandlers, opts: { lang?: string }): Dictation {
  let rec: any = null;
  let listening = false;
  let finalSoFar = "";

  return {
    engine: "webspeech",
    get listening() { return listening; },
    async start() {
      if (listening) return;
      rec = new Ctor();
      rec.lang = opts.lang ?? (globalThis.navigator?.language || "en-US");
      rec.continuous = true;
      rec.interimResults = true;
      finalSoFar = "";
      rec.onresult = (e: any) => {
        let interim = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) {
            const t = (r[0]?.transcript ?? "").trim();
            if (t) { finalSoFar += (finalSoFar ? " " : "") + t; h.onFinal(t); }
          } else {
            interim += r[0]?.transcript ?? "";
          }
        }
        if (interim) h.onInterim?.(interim.trim());
      };
      rec.onerror = (e: any) => {
        // "no-speech"/"aborted" are normal lifecycle noise, not user-facing errors.
        if (e?.error && e.error !== "no-speech" && e.error !== "aborted") {
          h.onError?.(e.error === "not-allowed" ? "Microphone permission denied." : `Dictation error: ${e.error}`);
        }
      };
      rec.onend = () => { listening = false; h.onEnd?.(); };
      rec.start();
      listening = true;
    },
    stop() {
      if (rec) { try { rec.stop(); } catch { /* already stopped */ } }
      listening = false;
    },
  };
}

// ── Engine 2: record → /api/stt (Groq Whisper) ───────────────────────────────
function serverDictation(h: DictationHandlers): Dictation {
  let mr: MediaRecorder | null = null;
  let stream: MediaStream | null = null;
  let chunks: Blob[] = [];
  let listening = false;

  async function transcribe(blob: Blob, mimeType: string) {
    try {
      const base64 = await new Promise<string>((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res((fr.result as string).split(",")[1] ?? "");
        fr.onerror = () => rej(new Error("could not read audio"));
        fr.readAsDataURL(blob);
      });
      const r = await fetch("/api/stt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audio: base64, mimeType }),
      });
      if (!r.ok) throw new Error(`STT ${r.status}`);
      const { text } = await r.json();
      const t = (text ?? "").trim();
      if (t && !/^[.,!?\s]*$/.test(t)) h.onFinal(t);   // Whisper returns "." for silence
      else h.onError?.("Didn't catch that — try again a bit louder.");
    } catch (e: any) {
      h.onError?.(e?.message ?? "Transcription failed.");
    } finally {
      h.onEnd?.();
    }
  }

  return {
    engine: "server",
    get listening() { return listening; },
    async start() {
      if (listening) return;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        h.onError?.("Microphone permission denied.");
        h.onEnd?.();
        return;
      }
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
      chunks = [];
      mr = new MediaRecorder(stream, { mimeType });
      mr.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
      mr.onstop = () => {
        stream?.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks, { type: mimeType });
        listening = false;
        if (blob.size > 0) transcribe(blob, mimeType);
        else h.onEnd?.();
      };
      mr.start();
      listening = true;
    },
    stop() {
      if (mr && mr.state !== "inactive") { try { mr.stop(); } catch { /* noop */ } }
      else { stream?.getTracks().forEach((t) => t.stop()); listening = false; h.onEnd?.(); }
    },
  };
}

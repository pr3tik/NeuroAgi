// scribeStream.ts — realtime speech-to-text over ElevenLabs Scribe v2.
//
// Replaces the orb's batch STT leg (record a whole utterance → blob → POST /api/stt).
// Audio streams to ElevenLabs over a WebSocket as it is spoken; the provider runs VAD
// and returns partial transcripts live plus committed ones when a speech segment ends.
//
// ┌─ ENABLING THIS ────────────────────────────────────────────────────────────────┐
// │ Gated behind VITE_VOICE_STREAMING. Unset/"0" → the caller keeps using the old   │
// │ MediaRecorder path. Set VITE_VOICE_STREAMING=1 in .env.local to turn it on.     │
// │ The switch exists so a bad turn in front of users is one env var from a         │
// │ rollback — the batch path is deliberately still wired up. See isStreamingSTT(). │
// └────────────────────────────────────────────────────────────────────────────────┘
//
// Three things here are load-bearing and easy to get wrong:
//
//  1. The socket takes raw PCM, not webm/opus. MediaRecorder cannot produce it, so
//     capture runs through an AudioWorklet instead.
//  2. Capture uses its OWN 16 kHz AudioContext. The playback singleton in NeuralRing
//     runs at the device's native rate and must NOT be reused here — they are two
//     contexts on purpose, not an oversight.
//  3. VAD commits per speech SEGMENT, not per turn. A speaker who pauses mid-thought
//     produces two committed_transcript frames. Dispatching on the first would cut
//     them off, so segments are accumulated and only flushed after TURN_GAP_MS of
//     quiet. See the turn-assembly block below.
//
// Protocol reference: https://elevenlabs.io/docs/api-reference/speech-to-text/v-1-speech-to-text-realtime

const WS_URL = "wss://api.elevenlabs.io/v1/speech-to-text/realtime";

// Silence after a committed segment before the turn is considered finished. Sits just
// above the provider's own vad_silence_threshold_secs (1.5s) so a natural mid-sentence
// pause coalesces into one turn instead of firing two LLM calls.
const TURN_GAP_MS = 900;

// Close the socket after this long with no inbound transcript frame of any kind.
// ElevenLabs bills connected time, and auto-listen re-arms after every turn — without
// this an idle armed mic bills continuously. Reconnect costs ~150ms on the next turn.
const IDLE_CLOSE_MS = 5000;

const SAMPLE_RATE = 16000;
const CHUNK_SAMPLES = 2048;   // ~128ms at 16kHz — inside the 4-8KB chunk guidance

/** Is the streaming path switched on? Everything else here is inert when false. */
export function isStreamingSTT(): boolean {
  return String(import.meta.env.VITE_VOICE_STREAMING ?? "") === "1";
}

// The worklet is defined as a source string and loaded from a Blob URL so it needs no
// separate build entry or public/ asset — one less thing to break on deploy.
const WORKLET_SRC = `
class PCMCapture extends AudioWorkletProcessor {
  constructor() { super(); this._buf = []; this._n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    // Float32 [-1,1] -> Int16. Clamp first: values can exceed 1 after resampling.
    const out = new Int16Array(ch.length);
    for (let i = 0; i < ch.length; i++) {
      const s = Math.max(-1, Math.min(1, ch[i]));
      out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    this._buf.push(out); this._n += out.length;
    if (this._n >= ${CHUNK_SAMPLES}) {
      const merged = new Int16Array(this._n);
      let off = 0;
      for (const b of this._buf) { merged.set(b, off); off += b.length; }
      this.port.postMessage(merged, [merged.buffer]);
      this._buf = []; this._n = 0;
    }
    return true;
  }
}
registerProcessor("pcm-capture", PCMCapture);
`;

function int16ToBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let bin = "";
  // Chunked so a long buffer can't blow the argument limit on String.fromCharCode.
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
  return btoa(bin);
}

export type ScribeSession = {
  /** Tear down socket, worklet, context and mic. Safe to call repeatedly. */
  stop: () => void;
  /** True until stop() runs or the socket closes. */
  isActive: () => boolean;
};

export type ScribeOptions = {
  /** Mic stream. Owned by the caller — this module does not stop its tracks. */
  stream: MediaStream;
  /**
   * Fires when the socket is genuinely open and accepting audio. Callers should not
   * show a "listening" state before this — the token mint plus WebSocket handshake is
   * a real round-trip, and claiming to listen through it drops whatever the user says.
   */
  onReady?: () => void;
  /** Fires on every partial_transcript. Provisional text; will change. */
  onPartial?: (text: string) => void;
  /**
   * Fires on each committed segment, before turn assembly. Dictation wants this — it
   * appends text to an input box as it lands and must never wait for, or act on, a
   * "turn". The conversational orb wants onTurn instead.
   */
  onSegment?: (text: string) => void;
  /** Fires once per assembled turn, after TURN_GAP_MS of quiet. */
  onTurn?: (text: string) => void;
  /** Terminal errors — auth, quota, socket failure. Session is dead after this. */
  onError?: (kind: string, detail?: string) => void;
  /** Socket closed for any reason, including the idle timeout. */
  onClose?: () => void;
};

/**
 * Open a realtime transcription session against the caller's mic stream.
 * Mints its own single-use token via /api/stt?action=token (auth required).
 */
export async function startScribeSession(opts: ScribeOptions): Promise<ScribeSession> {
  const { stream, onReady, onPartial, onSegment, onTurn, onError, onClose } = opts;

  let stopped = false;
  let ws: WebSocket | null = null;
  let ctx: AudioContext | null = null;
  let node: AudioWorkletNode | null = null;
  let src: MediaStreamAudioSourceNode | null = null;
  let turnTimer: ReturnType<typeof setTimeout> | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let segments: string[] = [];

  function cleanup() {
    if (stopped) return;
    stopped = true;
    if (turnTimer) clearTimeout(turnTimer);
    if (idleTimer) clearTimeout(idleTimer);
    try { node?.port.close(); node?.disconnect(); } catch { /* already torn down */ }
    try { src?.disconnect(); } catch { /* already torn down */ }
    try { ctx?.close(); } catch { /* already closed */ }
    try { if (ws && ws.readyState <= WebSocket.OPEN) ws.close(); } catch { /* already closing */ }
    ws = null; node = null; src = null; ctx = null;
  }

  function stop() { const wasActive = !stopped; cleanup(); if (wasActive) onClose?.(); }

  // Any inbound transcript resets the idle clock. Silence alone never does.
  function touchIdle() {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { flushTurn(); stop(); }, IDLE_CLOSE_MS);
  }

  function flushTurn() {
    if (turnTimer) { clearTimeout(turnTimer); turnTimer = null; }
    const text = segments.join(" ").replace(/\s+/g, " ").trim();
    segments = [];
    if (text) onTurn?.(text);
  }

  // ── Token ────────────────────────────────────────────────────────────────────
  // Single-use, 15-minute TTL, so one mint per connection. The API key stays server
  // side; see api/stt.ts ?action=token. The endpoint is auth-gated (requireUserOr401),
  // and this app attaches the Supabase JWT explicitly per call — a bare fetch 401s.
  const { supabase } = await import("../api/supabase");
  const { data: { session } } = await supabase.auth.getSession();
  const tokenRes = await fetch("/api/stt?action=token", {
    method: "POST",
    headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
  });
  if (!tokenRes.ok) {
    const kind = tokenRes.status === 401 ? "auth_error"
      : tokenRes.status === 503 ? "not_configured"
      : "token_error";
    onError?.(kind, `token mint ${tokenRes.status}`);
    throw new Error(`Scribe token mint failed (${tokenRes.status})`);
  }
  const { token } = await tokenRes.json();

  // ── Capture graph ────────────────────────────────────────────────────────────
  // Dedicated 16 kHz context — see the header note. The browser resamples the mic
  // into it, so no manual resampling is needed.
  ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
  const workletUrl = URL.createObjectURL(new Blob([WORKLET_SRC], { type: "application/javascript" }));
  try {
    await ctx.audioWorklet.addModule(workletUrl);
  } finally {
    URL.revokeObjectURL(workletUrl);
  }
  if (stopped) { cleanup(); throw new Error("session stopped during setup"); }

  src = ctx.createMediaStreamSource(stream);
  node = new AudioWorkletNode(ctx, "pcm-capture");
  src.connect(node);
  // Not connected to destination on purpose — routing capture to output would echo
  // the speaker's own voice back at them.

  // ── Socket ───────────────────────────────────────────────────────────────────
  const qs = new URLSearchParams({
    model_id: "scribe_v2_realtime",
    audio_format: `pcm_${SAMPLE_RATE}`,
    language_code: "en",
    commit_strategy: "vad",          // provider decides end-of-segment, not local RMS
    vad_silence_threshold_secs: "1.5",
    no_verbatim: "true",             // drop "um"/"uh" before they reach the model
    token,
  });
  ws = new WebSocket(`${WS_URL}?${qs}`);

  ws.onopen = () => {
    touchIdle();
    onReady?.();   // only now is audio actually going somewhere
    node!.port.onmessage = (e: MessageEvent) => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      // Flat shape with a message_type discriminator — NOT nested under an
      // "input_audio_chunk" key. Nesting is rejected with
      // {"message_type":"input_error","error":"Message must be a valid protocol message"}.
      ws.send(JSON.stringify({
        message_type: "input_audio_chunk",
        audio_base_64: int16ToBase64(e.data as Int16Array),
        commit: false,               // VAD strategy commits for us
        sample_rate: SAMPLE_RATE,
      }));
    };
  };

  ws.onmessage = (e: MessageEvent) => {
    let msg: any;
    try { msg = JSON.parse(e.data); } catch { return; }

    // The provider discriminates on message_type, not type — a `type` field does exist
    // on nested word objects, so reading the wrong one fails silently rather than loudly.
    switch (msg.message_type) {
      case "session_started":
        break;

      case "partial_transcript":
        touchIdle();
        if (msg.text) onPartial?.(msg.text);
        break;

      case "committed_transcript":
      case "committed_transcript_with_timestamps": {
        touchIdle();
        if (msg.text) { segments.push(msg.text); onSegment?.(msg.text); }
        // Turn assembly: wait for a further quiet gap before declaring the turn over,
        // so a mid-thought pause produces one LLM call rather than two. Skipped entirely
        // when no onTurn consumer exists (dictation takes onSegment instead).
        if (onTurn) {
          if (turnTimer) clearTimeout(turnTimer);
          turnTimer = setTimeout(flushTurn, TURN_GAP_MS);
        }
        break;
      }

      // Terminal — the session cannot continue.
      case "auth_error":
      case "quota_exceeded":
      case "session_time_limit_exceeded":
      case "transcriber_error":
        onError?.(msg.message_type, msg.error ?? msg.message);
        stop();
        break;

      // Transient service pressure. Kept distinct from terminal errors so the caller
      // can surface "try again" rather than dropping the user out of voice mode.
      case "rate_limited":
      case "commit_throttled":
      case "queue_overflow":
      case "resource_exhausted":
        onError?.(msg.message_type, msg.error ?? msg.message);
        break;

      case "error":
      case "input_error":
      case "chunk_size_exceeded":
        onError?.(msg.message_type, msg.error ?? msg.message);
        break;

      // insufficient_audio_activity is informational — the user simply hasn't spoken.
      default:
        break;
    }
  };

  ws.onerror = () => { onError?.("socket_error"); };
  ws.onclose  = () => { flushTurn(); stop(); };

  return { stop, isActive: () => !stopped };
}

// roomVoice.ts — peer-to-peer voice for study rooms.
//
// A full-mesh WebRTC controller: every participant holds one RTCPeerConnection to
// every other participant, so audio flows browser↔browser and never touches our
// servers (no SFU, no Daily, no per-minute cost). Signaling is transport-agnostic —
// the caller hands us a `sendSignal(to, data)` and feeds inbound frames to
// `handleSignal(from, data)`. In the room we ride the existing Supabase broadcast
// channel, so there is no new backend at all.
//
// It also does two things the future voice agent needs:
//   1. Exposes the local mic MediaStream (`getLocalStream`) — the room STT layer will
//      run ElevenLabs Scribe on exactly this stream (see scribeStream.ts).
//   2. Emits speaking/quiet events per participant (local + remote) via `onSpeaking`,
//      which drives the "who's talking" UI now and barge-in for the agent later.
//
// Glare (both peers offering at once) is resolved with the standard "perfect
// negotiation" pattern: for each pair, exactly one side is `polite` and yields.
//
// Not handled here (deliberately, phase 1): a TURN relay for symmetric NATs (STUN
// only for now), and mesh size — the caller caps participant count. See
// STUDY-ROOM-AI-PRESENCE-SPEC.md R1/R9.

const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:global.stun.twilio.com:3478" },
];

// Speaking detector thresholds (RMS of the time-domain waveform, 0..1). Hysteresis:
// cross UP to start "speaking", fall below DOWN to stop — stops a voice hovering at
// the threshold from flickering the indicator.
const SPEAK_ON = 0.045;
const SPEAK_OFF = 0.025;
const SPEAK_POLL_MS = 120;

export interface RoomVoiceCallbacks {
  /** Send a signaling frame to one peer. The caller chooses the transport. */
  sendSignal: (to: string, data: any) => void;
  /** A peer's audio stream arrived — attach it to an <audio> element to hear them. */
  onRemoteStream?: (peerId: string, stream: MediaStream) => void;
  /** A peer left the mesh — drop their <audio> element. */
  onRemoteGone?: (peerId: string) => void;
  /** Speaking state changed. peerId === selfId for the local user. */
  onSpeaking?: (peerId: string, speaking: boolean) => void;
  /** Fatal setup error (e.g. mic permission denied). */
  onError?: (message: string) => void;
}

export interface RoomVoice {
  /** Reconcile the mesh with the current roster of in-voice peers (excludes self). */
  setPeers: (ids: string[]) => void;
  /** Feed an inbound signaling frame from `from`. */
  handleSignal: (from: string, data: any) => void;
  /** Mute/unmute the local mic (disables the track — peers stop receiving audio). */
  setMuted: (muted: boolean) => void;
  isMuted: () => boolean;
  /** The local mic stream — the room STT/agent layer consumes this. */
  getLocalStream: () => MediaStream | null;
  /** Tear everything down: close peers, stop the mic, close the audio graph. */
  stop: () => void;
}

type Peer = {
  pc: RTCPeerConnection;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
};

/**
 * Acquire the mic and return a mesh controller. Rejects only if getUserMedia fails
 * (mic denied / no device); the caller surfaces that to the user.
 */
export async function startRoomVoice(selfId: string, cb: RoomVoiceCallbacks): Promise<RoomVoice> {
  let localStream: MediaStream;
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
  } catch (e: any) {
    cb.onError?.("Couldn't access your microphone — check the browser permission.");
    throw e;
  }

  let stopped = false;
  let muted = false;
  const peers = new Map<string, Peer>();

  // ── Speaking detection ───────────────────────────────────────────────────────
  // One AudioContext feeds an analyser per participant. The mic click is a user
  // gesture, so the context starts unsuspended.
  const AudioCtx: typeof AudioContext =
    (globalThis as any).AudioContext ?? (globalThis as any).webkitAudioContext;
  const audioCtx: AudioContext | null = AudioCtx ? new AudioCtx() : null;
  type Meter = { analyser: AnalyserNode; buf: Uint8Array; speaking: boolean; src: MediaStreamAudioSourceNode };
  const meters = new Map<string, Meter>();
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  function addMeter(id: string, stream: MediaStream) {
    if (!audioCtx) return;
    try {
      const src = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      src.connect(analyser);   // not connected to destination — playback is via <audio>
      meters.set(id, { analyser, buf: new Uint8Array(analyser.fftSize), speaking: false, src });
    } catch { /* stream may have no audio track yet */ }
  }
  function removeMeter(id: string) {
    const m = meters.get(id);
    if (!m) return;
    try { m.src.disconnect(); } catch { /* already gone */ }
    if (m.speaking) cb.onSpeaking?.(id, false);
    meters.delete(id);
  }
  function pollMeters() {
    for (const [id, m] of meters) {
      m.analyser.getByteTimeDomainData(m.buf as any);   // lib.dom generic mismatch across TS versions
      // RMS of the centered waveform (128 = silence midpoint for byte data).
      let sum = 0;
      for (let i = 0; i < m.buf.length; i++) { const v = (m.buf[i] - 128) / 128; sum += v * v; }
      const rms = Math.sqrt(sum / m.buf.length);
      // A muted local mic must never read as speaking, even on residual buffer.
      const gate = id === selfId && muted;
      const next = gate ? false : (m.speaking ? rms > SPEAK_OFF : rms > SPEAK_ON);
      if (next !== m.speaking) { m.speaking = next; cb.onSpeaking?.(id, next); }
    }
  }
  if (audioCtx) {
    addMeter(selfId, localStream);
    pollTimer = setInterval(pollMeters, SPEAK_POLL_MS);
  }

  // ── Peer connections ─────────────────────────────────────────────────────────
  function createPeer(peerId: string): Peer {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    // Deterministic role: the peer with the smaller id is polite. Both sides compute
    // the same pairing oppositely, so exactly one is polite.
    const peer: Peer = { pc, polite: selfId < peerId, makingOffer: false, ignoreOffer: false };

    localStream.getTracks().forEach(t => pc.addTrack(t, localStream));

    pc.onnegotiationneeded = async () => {
      try {
        peer.makingOffer = true;
        await pc.setLocalDescription();
        cb.sendSignal(peerId, { description: pc.localDescription });
      } catch { /* transient — the other side may renegotiate */ }
      finally { peer.makingOffer = false; }
    };
    pc.onicecandidate = (e) => { if (e.candidate) cb.sendSignal(peerId, { candidate: e.candidate }); };
    pc.ontrack = (e) => {
      const stream = e.streams[0];
      if (!stream) return;
      cb.onRemoteStream?.(peerId, stream);
      addMeter(peerId, stream);
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed") { try { pc.restartIce(); } catch { /* older browsers */ } }
    };

    peers.set(peerId, peer);
    return peer;
  }

  function dropPeer(peerId: string) {
    const peer = peers.get(peerId);
    if (!peer) return;
    try { peer.pc.close(); } catch { /* already closed */ }
    peers.delete(peerId);
    removeMeter(peerId);
    cb.onRemoteGone?.(peerId);
  }

  function setPeers(ids: string[]) {
    if (stopped) return;
    const want = new Set(ids.filter(id => id !== selfId));
    for (const id of want) if (!peers.has(id)) createPeer(id);       // both sides create → glare resolved
    for (const id of Array.from(peers.keys())) if (!want.has(id)) dropPeer(id);
  }

  async function handleSignal(from: string, data: any) {
    if (stopped || !data) return;
    // A signal can arrive from a peer we haven't created yet (their presence reached
    // them first). Create the connection so the offer has somewhere to land.
    const peer = peers.get(from) ?? createPeer(from);
    const pc = peer.pc;
    try {
      if (data.description) {
        const offerCollision =
          data.description.type === "offer" && (peer.makingOffer || pc.signalingState !== "stable");
        peer.ignoreOffer = !peer.polite && offerCollision;
        if (peer.ignoreOffer) return;   // impolite side keeps its own offer
        await pc.setRemoteDescription(data.description);
        if (data.description.type === "offer") {
          await pc.setLocalDescription();
          cb.sendSignal(from, { description: pc.localDescription });
        }
      } else if (data.candidate) {
        try { await pc.addIceCandidate(data.candidate); }
        catch (err) { if (!peer.ignoreOffer) throw err; }   // ignore candidates for a rejected offer
      }
    } catch { /* a dropped frame renegotiates on the next event; don't kill the session */ }
  }

  function setMuted(m: boolean) {
    muted = m;
    localStream.getAudioTracks().forEach(t => { t.enabled = !m; });
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    if (pollTimer) clearInterval(pollTimer);
    for (const id of Array.from(peers.keys())) dropPeer(id);
    for (const id of Array.from(meters.keys())) removeMeter(id);
    localStream.getTracks().forEach(t => t.stop());
    try { audioCtx?.close(); } catch { /* already closed */ }
  }

  return {
    setPeers,
    handleSignal,
    setMuted,
    isMuted: () => muted,
    getLocalStream: () => (stopped ? null : localStream),
    stop,
  };
}

// @vitest-environment node
// roomVoice — P2P WebRTC mesh for study rooms (STUDY-ROOM-AI-PRESENCE-SPEC R1).
//
// The parts worth pinning are the mesh bookkeeping and glare handling, not the browser
// media plumbing: setPeers must open/close exactly one connection per peer, mute must
// disable the local track, and perfect-negotiation must make the IMPOLITE side ignore a
// colliding offer while the POLITE side yields. AudioContext is left unstubbed (undefined
// in node) so the speaking-detector loop is inert here.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

class FakePC {
  static instances: FakePC[] = [];
  signalingState = "stable";
  connectionState = "new";
  localDescription: any = null;
  onnegotiationneeded: any; onicecandidate: any; ontrack: any; onconnectionstatechange: any;
  tracks: any[] = [];
  remoteDescs: any[] = [];
  ice: any[] = [];
  closed = false;
  constructor(public config: any) { FakePC.instances.push(this); }
  addTrack(t: any) { this.tracks.push(t); }
  async setLocalDescription(desc?: any) {
    this.localDescription = desc ?? { type: this.signalingState === "have-remote-offer" ? "answer" : "offer", sdp: "local" };
  }
  async setRemoteDescription(d: any) {
    this.remoteDescs.push(d);
    this.signalingState = d.type === "offer" ? "have-remote-offer" : "stable";
  }
  async addIceCandidate(c: any) { this.ice.push(c); }
  restartIce() {}
  close() { this.closed = true; }
}

function fakeTrack() { return { enabled: true, stop: vi.fn(), kind: "audio" }; }
function fakeStream() {
  const tracks = [fakeTrack()];
  return { getTracks: () => tracks, getAudioTracks: () => tracks } as any;
}

let getUserMedia: any;

beforeEach(() => {
  FakePC.instances = [];
  getUserMedia = vi.fn(async () => fakeStream());
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
  vi.stubGlobal("RTCPeerConnection", FakePC as any);
});
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

async function load() { return await import("../src/lib/roomVoice.ts"); }

describe("mic + local stream", () => {
  it("acquires the mic and exposes the stream (the STT/agent foundation)", async () => {
    const { startRoomVoice } = await load();
    const rv = await startRoomVoice("me", { sendSignal: () => {} });
    expect(getUserMedia).toHaveBeenCalledOnce();
    expect(rv.getLocalStream()).not.toBeNull();
  });

  it("setMuted disables/enables the local audio track", async () => {
    const { startRoomVoice } = await load();
    const rv = await startRoomVoice("me", { sendSignal: () => {} });
    const track = rv.getLocalStream()!.getAudioTracks()[0];
    expect(track.enabled).toBe(true);
    rv.setMuted(true);
    expect(track.enabled).toBe(false);
    expect(rv.isMuted()).toBe(true);
    rv.setMuted(false);
    expect(track.enabled).toBe(true);
  });

  it("surfaces a mic-permission failure via onError and rejects", async () => {
    getUserMedia.mockRejectedValueOnce(new Error("denied"));
    const { startRoomVoice } = await load();
    const errors: string[] = [];
    await expect(startRoomVoice("me", { sendSignal: () => {}, onError: (m) => errors.push(m) })).rejects.toThrow();
    expect(errors[0]).toMatch(/microphone/i);
  });
});

describe("mesh reconciliation", () => {
  it("opens one connection per new peer and closes ones that leave", async () => {
    const { startRoomVoice } = await load();
    const gone: string[] = [];
    const rv = await startRoomVoice("me", { sendSignal: () => {}, onRemoteGone: (id) => gone.push(id) });

    rv.setPeers(["a", "b"]);
    expect(FakePC.instances).toHaveLength(2);
    expect(FakePC.instances.every(pc => pc.tracks.length === 1)).toBe(true);   // local track added

    rv.setPeers(["a"]);                 // b left
    expect(FakePC.instances[1].closed).toBe(true);
    expect(gone).toEqual(["b"]);
  });

  it("never connects to itself and de-dupes existing peers", async () => {
    const { startRoomVoice } = await load();
    const rv = await startRoomVoice("me", { sendSignal: () => {} });
    rv.setPeers(["me", "a"]);
    expect(FakePC.instances).toHaveLength(1);   // self skipped
    rv.setPeers(["a"]);                          // already connected → no new pc
    expect(FakePC.instances).toHaveLength(1);
  });

  it("delivers a peer's stream to onRemoteStream when the track arrives", async () => {
    const { startRoomVoice } = await load();
    const got: string[] = [];
    const rv = await startRoomVoice("me", { sendSignal: () => {}, onRemoteStream: (id) => got.push(id) });
    rv.setPeers(["a"]);
    FakePC.instances[0].ontrack({ streams: [fakeStream()] });
    expect(got).toEqual(["a"]);
  });
});

describe("perfect negotiation (glare)", () => {
  it("IMPOLITE side ignores a colliding offer (keeps its own)", async () => {
    // self "z" > peer "a" → impolite toward "a".
    const { startRoomVoice } = await load();
    const rv = await startRoomVoice("z", { sendSignal: () => {} });
    rv.setPeers(["a"]);
    const pc = FakePC.instances[0];
    pc.signalingState = "have-local-offer";           // mid-offer → collision
    await rv.handleSignal("a", { description: { type: "offer", sdp: "theirs" } });
    expect(pc.remoteDescs).toHaveLength(0);            // offer was ignored
  });

  it("POLITE side accepts a colliding offer and answers", async () => {
    // self "a" < peer "z" → polite toward "z".
    const { startRoomVoice } = await load();
    const sent: any[] = [];
    const rv = await startRoomVoice("a", { sendSignal: (to, data) => sent.push({ to, data }) });
    rv.setPeers(["z"]);
    const pc = FakePC.instances[0];
    pc.signalingState = "have-local-offer";
    await rv.handleSignal("z", { description: { type: "offer", sdp: "theirs" } });
    expect(pc.remoteDescs).toHaveLength(1);            // yielded and applied their offer
    expect(sent.some(s => s.data.description?.type === "answer")).toBe(true);
  });

  it("applies an inbound ICE candidate", async () => {
    const { startRoomVoice } = await load();
    const rv = await startRoomVoice("me", { sendSignal: () => {} });
    rv.setPeers(["a"]);
    await rv.handleSignal("a", { candidate: { candidate: "cand" } });
    expect(FakePC.instances[0].ice).toHaveLength(1);
  });
});

describe("teardown", () => {
  it("stop() closes every peer and stops the mic", async () => {
    const { startRoomVoice } = await load();
    const rv = await startRoomVoice("me", { sendSignal: () => {} });
    const track = rv.getLocalStream()!.getAudioTracks()[0];
    rv.setPeers(["a", "b"]);
    rv.stop();
    expect(FakePC.instances.every(pc => pc.closed)).toBe(true);
    expect(track.stop).toHaveBeenCalled();
    expect(rv.getLocalStream()).toBeNull();
  });
});

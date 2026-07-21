# Study Room — Voice + AI Presence Spec (queued 2026-07-21)

**Context.** Study rooms today are presence + text chat + a shared whiteboard over Supabase
Realtime — **no audio at all**, and the room-native AI (`room-ai?action=group`) exists on the
server but is never called from the client. This spec designs a net-new capability: people in a
room **talk to each other** by voice, and an AI is **present in the conversation** — quietly
following along, answering when asked, and stepping in on its own when someone's stuck. It is a
separate PR from the orb streaming-STT work (`feat/voice-streaming-stt`).

**The load-bearing insight:** the AI never needs the room's *audio* — only its *transcript*.
Human voice stays peer-to-peer (private, cheap, low-latency); the AI listens to a text feed that
every client already produces. This is what lets the feature work on a stateless serverless
backend (a Vercel function can't hold a WebRTC peer or a long-lived socket).

**Priority legend:** `P1` foundation · `P2` core AI · `P3` proactive AI · `P4` scale/polish.
**Confidence** = odds of shipping the item at working quality in the estimated time.

---

## Architecture

Three independent layers. Each phase below builds one and is useful on its own.

```
Layer 1  HUMAN VOICE     WebRTC mesh, peer↔peer — audio never touches a server
Layer 2  AI's EARS       each client STT's its OWN mic → broadcasts transcript to the room
Layer 3  AI PRESENCE     one elected "driver" client watches the transcript, decides, speaks
```

**Data flow:**

```
Alice speaks ──┬─► WebRTC ─────────────────► Bob, Carol hear her (P2P, private)
               └─► her scribeStream ─► "transcript" broadcast ─► all clients + DRIVER
                                                                       │
                                       rolling transcript ────────────┤
                                       Stage A keyword gate ─► Stage B LLM classifier
                                       or explicit "hey Reggie" / @ai
                                                                       │ (fires)
                                       driver ─► POST /api/room-ai?action=group
                                                                       │ returns text
                                       driver ─► TTS once ─► broadcast "ai_message" + audio
                                                                       │
                             all clients render text + play the same voice, in order
```

**Why one "driver" client.** If every client independently decided when the AI speaks, they'd all
fire at once and the AI would talk over itself. Exactly one client per room runs the decision +
generation loop. Elected deterministically (joined member with the lowest `userId`, or the host);
re-elected when it leaves. Everyone else just renders what the driver broadcasts.

---

## Current baseline (what exists today)

All in `src/pages/StudyRooms.tsx` (`RoomView`) unless noted.

- **Room realtime** — `supabase.channel("room:"+room.id)` with presence keyed by `userId`
  (`:1353`, `:1355`). Ephemeral broadcast events already flow through it: `chat_message`,
  `pomodoro`, `raise_hand`, `access_changed`, `wb_live`/`wb_cursor`/`wb_laser` (`:1398–1434`).
  **New room events attach here — no new backend for signaling or transcripts.**
- **No audio transport** — grep confirms no `RTCPeerConnection`/`getUserMedia` anywhere in
  `StudyRooms.tsx`. Voice between participants is entirely new.
- **Room AI, server-side** — `api/room-ai.ts`. `?action=group` (handler `:180–305`) already
  produces a **shared, RAG-grounded, persona-shaped** room answer from the room's shared sources +
  board — **built but not wired to the client**. `?action=private` (`:1849–1938`, 1:1, non-broadcast)
  is the only path called today. Both are membership-gated (`isJoinedMember` `:71–76`) and
  rate-limited (30/min).
- **Room TTS** — `gsSpeak(text)` (`:2066–2089`): `POST /api/tts?action=stream {text}` → `audio/mpeg`
  → plays via an in-memory `new Audio()` (`gsAudioRef`). ElevenLabs, model `eleven_flash_v2_5`
  (`api/tts.ts`). **Plays only on the acting user's device — not broadcast.**
- **Streaming STT, ready to reuse** — `src/lib/scribeStream.ts`: `startScribeSession({ stream,
  onReady, onPartial, onSegment, onTurn, onError, onClose })`, gated by `isStreamingSTT()`
  (`VITE_VOICE_STREAMING`). Mints its own single-use token (`/api/stt?action=token`); the API key
  never reaches the client. Not yet imported by `StudyRooms.tsx`.
- **Identity** — a participant is `users.id` from the JWT (`requireUserOr401`); the presence key is
  the same `userId`. Membership = `room_members.status = 'joined'`.

---

## New room broadcast events

All ephemeral (broadcast only, never persisted) on the existing `room:<id>` channel:

| Event | Sender | Purpose |
|---|---|---|
| `webrtc_offer` / `webrtc_answer` / `webrtc_ice` | each peer | WebRTC signaling (Layer 1) |
| `transcript` | each client | `{ userId, name, text, ts }` — one committed STT segment (Layer 2) |
| `ai_request` | any client | explicit ask ("hey Reggie" / `@ai` / button) → driver handles |
| `ai_speaking` | driver | lock: AI has the floor; suppresses overlap |
| `ai_message` | driver | `{ text, audio }` — AI's turn, rendered + played by all clients |

Transcripts are **ephemeral by design** — no DB write, no new RLS surface, and the room
conversation is never stored. (Optional future: persist only a end-of-session summary.)

---

## P1 — Foundation: peer-to-peer voice + shared transcript

### R1. WebRTC mesh voice  `~1 day` · confidence Medium
- **Problem.** No audio transport exists; participants can only text-chat.
- **Design.** Full-mesh `RTCPeerConnection` between joined participants. **Signaling reuses the
  `room:<id>` channel** via the three `webrtc_*` broadcast events — no new backend. On join, a
  client offers to each existing peer; presence sync (`:1357`) is the peer roster. Per-participant
  mute; the mic `MediaStream` is created once and shared with Layer 2. STUN is free (Google STUN);
  a **TURN relay** is needed for strict/symmetric NATs — the one real infra cost (self-host coturn
  or a paid TURN provider).
- **Files.** New `src/lib/roomVoice.ts` (peer-connection manager, isolated + unit-testable);
  wire into `RoomView` mic controls; extend the channel handler (`:1398–1434`) with `webrtc_*`.
- **Acceptance.** Two accounts in one room hear each other; mute works; a third joiner is heard by
  both. No server audio.
- **Note.** Cap mesh at ~6 participants (see R9). Standalone-shippable without any AI.

### R2. Shared live transcript  `~0.5 day` · confidence High
- **Problem.** The AI needs to know what's being said, and a mesh can't be joined by a serverless
  function.
- **Design.** Each client runs `startScribeSession` on **its own** mic stream (the same stream from
  R1 — no second capture). On each `onSegment` (committed VAD segment), broadcast a `transcript`
  event `{ userId, name, text, ts }`. Every client accumulates a rolling, speaker-labelled
  transcript — which also renders as **live captions** (free bonus, useful with or without AI).
  Gated by `isStreamingSTT()`; when off, the room has voice (R1) but no AI ears.
- **Files.** `roomVoice.ts` (subscribe transcript to the shared stream); new transcript-store hook;
  captions UI in `RoomView`.
- **Acceptance.** Alice speaks → Bob and Carol see her words appear labelled "Alice" within ~1–2s.
- **Reuse.** `scribeStream.ts` as-is (`onSegment`, not `onTurn` — the room assembles its own
  cross-speaker view).

---

## P2 — Core AI: the AI answers when asked

### R3. Driver election  `~0.5 day` · confidence High
- **Problem.** Exactly one client must run the AI loop, or the AI double-speaks.
- **Design.** Deterministic election from the presence roster: the joined member with the lowest
  `userId` is the driver (tie-free, no negotiation round-trip). Recomputed on every presence sync,
  so a driver leaving hands off automatically. Only the driver runs R4/R6 and sends `ai_message`.
- **Files.** `src/lib/roomDriver.ts` (pure election from a roster → `isDriver` boolean);
  subscribe to presence in `RoomView`.
- **Acceptance.** In a 3-person room exactly one client logs "I am driver"; kill it → another takes
  over within one presence sync.

### R4. Explicit AI — "hey Reggie" / @ai / button  `~1 day` · confidence Medium-High
- **Problem.** A person should be able to ask the room AI a question and have everyone hear it.
- **Design.** Trigger three ways: (a) wake phrase detected client-side on the asker's own
  transcript, (b) `@ai` typed in room chat, (c) an "Ask Reggie" button. Any of these emits
  `ai_request { text, askerName }`. The **driver** picks it up, calls
  `POST /api/room-ai?action=group` with the question + recent transcript window as context, then
  broadcasts `ai_message`. All clients render the text in chat and play the voice (R5). Wire the
  **already-built `?action=group`** endpoint — the frontend gap noted in the baseline.
- **Files.** `room-ai.ts` (confirm `group` accepts a transcript-context field; extend if needed);
  `roomDriver.ts` (handle `ai_request`); `RoomView` (wake-phrase match, `@ai` parse, button).
- **Acceptance.** Alice says "hey Reggie, what's a hash map?" → within a few seconds everyone sees
  and hears one grounded answer, exactly once (no duplicate from other clients).

### R5. Synced AI voice  `~0.5 day` · confidence Medium-High
- **Problem.** If each client TTS's the AI text locally, that's N API calls and the audio desyncs.
- **Design.** The **driver generates TTS once** via `/api/tts?action=stream`, then broadcasts the
  audio with `ai_message` (base64 or a short-lived URL) so every client plays the *same* clip.
  Playback reuses the `gsSpeak` `new Audio()` mechanism (`:2066`); the join-room tap satisfies the
  iOS/Chrome autoplay-unlock gesture. One TTS call per AI turn.
- **Files.** `roomDriver.ts` (TTS + attach to `ai_message`); extract a small `playRoomAudio()` from
  `gsSpeak`; playback handler in `RoomView`.
- **Acceptance.** One AI turn → one `/api/tts` request in the network tab (from the driver only);
  all clients hear it within ~300ms of each other.

### R6. One-at-a-time floor control  `~0.5 day` · confidence Medium
- **Problem.** The AI must not talk over itself or over people.
- **Design.** The driver serializes AI output through a queue + an `ai_speaking` broadcast lock
  (same idea as the orb's `ttsChain`). While a human is mid-sentence (a recent non-final partial),
  the driver defers a *proactive* interjection; an *explicit* ask still answers but waits for the
  current AI clip to finish.
- **Files.** `roomDriver.ts` (queue + lock).
- **Acceptance.** Fire two asks in quick succession → answered sequentially, never overlapping
  audio.

---

## P3 — Proactive AI: the AI senses confusion and steps in

### R7. Two-stage confusion gate  `~1.5 day` · confidence Medium
- **Problem.** "Always there, waiting for someone to feel confused" — but calling an LLM every few
  seconds for every room is expensive and would make the AI naggy.
- **Design.** The driver runs a cheap two-stage gate on the rolling transcript:
  - **Stage A (free):** keyword/pattern match on recent turns — "I don't get", "confused", "stuck",
    "wait what", or an unanswered question followed by silence.
  - **Stage B (cheap LLM):** only when Stage A trips **and** a per-room cooldown has elapsed, ask a
    small classifier — *"Given the last N turns, is someone stuck and would a one-line hint help?
    yes/no + hint."* If yes → interject via the R4/R5 path with a short, low-friction nudge.
  - **Etiquette:** cooldown between proactive interjections; stay silent while humans are actively
    talking (defer via R6); an **opt-in room toggle** ("let Reggie chime in") — off by default.
- **Files.** `roomDriver.ts` (gate + cooldown); a small classifier prompt (new `api/room-ai.ts`
  sub-action or a lightweight model call); toggle in `RoomView`.
- **Acceptance.** Two accounts role-play being stuck on a concept → Reggie offers one relevant hint,
  unprompted, within a reasonable window and does **not** repeat within the cooldown; with the
  toggle off, it never interjects.

---

## P4 — Scale & robustness

### R8. Driver hand-off resilience  `~0.5 day` · confidence Medium
- **Problem.** A driver dropping mid-answer could lose an in-flight AI turn.
- **Design.** Treat AI turns as idempotent by an `ai_request` id; on re-election the new driver
  drops any request already answered (dedupe on broadcast id). Brief gap on hand-off is acceptable.
- **Acceptance.** Kill the driver mid-answer → no duplicate answer, at most one lost turn, room
  keeps working.

### R9. Mesh size cap + SFU path  `~0.5 day now, SFU later` · confidence High (cap) / Low (SFU)
- **Problem.** Full-mesh WebRTC is O(n²) connections — fine to ~6, degrades past that.
- **Design.** Cap room *voice* participants (text/whiteboard stay uncapped); show "voice full" past
  the cap. Document an SFU (e.g. LiveKit/mediasoup) as the future path for large rooms — **out of
  scope for this PR.**
- **Acceptance.** The 7th joiner gets a clear "voice is full" state, not a broken room.

### R10. Cost & privacy controls  `~0.5 day` · confidence High
- **Design / acceptance.**
  - Human audio never leaves the P2P mesh; transcripts are ephemeral broadcasts (no DB write).
  - STT tokens are server-minted, single-use (existing). The whole feature sits behind
    `VITE_VOICE_STREAMING` **plus** a `VITE_ROOM_VOICE` switch — one env flip disables it.
  - LLM spend is bounded: only the driver pays; Stage-A keyword gate precedes any classifier call;
    cooldown caps interjection frequency.
  - A visible "🔴 live transcript / AI is listening" indicator so participants know the room is
    being transcribed (consent/clarity).

---

## Open decisions (recommended picks)

| Decision | Options | Pick |
|---|---|---|
| AI decision loop | every client vs. one driver | **one elected driver** (no double-speak) |
| AI voice | each client TTS vs. driver TTS once + broadcast | **driver once + broadcast** (synced, cheap) |
| Transcripts | persist vs. ephemeral | **ephemeral** (privacy, no RLS work) |
| Proactive interjection | on by default vs. opt-in | **opt-in toggle**, off by default |
| Mesh size | uncapped vs. capped | **cap ~6**, SFU documented as future |
| Explicit-ask routing | asker calls `room-ai` directly vs. via driver | **via driver** (single ordered speaker) |

---

## Out of scope (this PR)
- SFU / large-room voice (documented in R9).
- Persisting room transcripts or AI turns (ephemeral only; summary persistence is a future item).
- Streaming the AI's *text* token-by-token in the room (R4 returns a full answer; the room path
  is non-streaming today — streaming is a later polish).
- Changing the orb / dictation STT (shipped separately in `feat/voice-streaming-stt`).

## Suggested build order
P1 (R1→R2) → P2 (R3→R4→R5→R6) → P3 (R7) → P4 (R8→R10). Each phase is independently demoable:
P1 alone gives a working voice room with live captions; P2 adds an AI you can ask; P3 makes it
proactive.

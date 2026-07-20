# Study Room — Voice AI Spec (queued for 2026-07-21)

**Context.** Voice teaching (founder feature #4) is built and merged into PR #256:
Reggie reads guided-session steps aloud via ElevenLabs. This spec is the hardening +
polish pass on the voice layer before the **July 23 investor demo**. Voice is the
"exam prep taught with voice" showpiece, so it needs to be reliable, not just present.

**Priority legend:** `P1` demo-critical · `P2` demo-polish · `P3` scale/robustness.
**Confidence** = odds of shipping at demo quality in the estimated time.

---

## Current implementation (baseline — what exists today)

All in `src/pages/StudyRooms.tsx` (`RoomView`) unless noted.

- **`gsSpeak(text)`** — strips markdown/emoji (`gsStripForSpeech`, caps 1800 chars),
  `POST /api/tts?action=stream {text}` → `audio/mpeg` blob → plays via an in-memory
  `new Audio()` (`gsAudioRef`). Sets `gsSpeaking`.
- **`gsStopSpeak()`** — `pause()` + `currentTime = 0` (a full stop, not a pause).
- **Auto-read** — `useEffect([gsCurContent, gsVoiceOn])` calls `gsSpeak` when a step's
  content arrives and voice is on. `gsVoiceOn` defaults to `true` for **exam** mode.
- **Controls** — header "Auto-read/Voice" toggle pill (`Volume2`/`VolumeX`) + a per-step
  "Read aloud / Stop" button on the step card.
- **Endpoint** — `api/tts.ts`: `?action=stream` caps text at **2000 chars**, model
  `eleven_flash_v2_5` (fast/cheap), default voice `ELEVENLABS_VOICE_ID` env or the
  hardcoded fallback `JBFqnCBsd6RMkjVDRZzb`; also supports `voiceId`, `speed`,
  `voiceSettings`. `?action=voices` returns the available voice list (`preview_url` each).
- **Helper available but unused here:** `src/lib/ttsChunker.ts` (chunks long text).
- **Verified:** TTS returned 200 (~2.1s) in `npm run dev`; manual "Read aloud" plays.
  Auto-read audibility under browser autoplay policy is **unconfirmed**.

---

## P1 — Demo-critical

### V1. Autoplay reliability  `~45 min` · confidence Medium-High
- **Problem.** Auto-read fires *programmatically* when a step loads, not from a click.
  Browsers (esp. Chrome/Safari) block audio without a recent user gesture, so exam-mode
  auto-read may be **silently muted** even though the TTS request succeeds. The manual
  "Read aloud" click always works because it's a direct gesture.
- **Fix.**
  1. **Prime audio on the first gesture** — on the "Start session" click (a real gesture),
     play a near-silent/zero-length buffer through `gsAudioRef` to unlock the audio
     context for that element, so subsequent programmatic `play()` calls are allowed.
  2. **Fallback** — if `audio.play()` rejects (NotAllowedError), set a
     `voiceBlocked` flag and render a one-tap "🔊 Tap to hear Reggie" prompt on the step
     card; the tap replays the current step.
- **Files.** `gsSpeak` (catch the rejected `play()`), `beginGuidedSession` (prime on the
  start click), active-session JSX (fallback prompt).
- **Acceptance.** Start an exam session in a fresh tab → Reggie is *audible* on step 1
  without any extra click, OR a clear tap-to-hear prompt appears and works.

### V2. ELEVENLABS_API_KEY in production env  `~10 min` · confidence High
- **Problem.** The key lives only in `.env.local`; a Vercel deploy never sees it, so voice
  (and Scribe transcription) return 500 in prod.
- **Fix.** Set `ELEVENLABS_API_KEY` (and optionally `ELEVENLABS_VOICE_ID`) in the Vercel
  dashboard env. Smoke-test `/api/tts?action=stream` on a preview deploy.
- **Acceptance.** Read-aloud works on a Vercel preview URL, not just localhost.
- **Note.** Only load-bearing if we demo on a deploy (see the deploy decision in
  `STUDY-ROOM-POLISH-SPEC.md`). On localhost dev it already works.

---

## P2 — Demo-polish

### V3. Latency masking + next-step prefetch  `~1 hr` · confidence High
- **Problem.** The stream returns the *full* clip before playback (~2.1s), so each step
  starts with a silent gap.
- **Fix.** (a) Show a clear "🔊 Reggie is preparing audio…" state while the fetch is in
  flight (distinct from the text "thinking" state). (b) **Prefetch** the next step's audio
  blob when the current step is teaching, so hitting Continue plays instantly. Cache blobs
  by step index; revoke object URLs on session end.
- **Acceptance.** Advancing to a prefetched step starts audio in < 300 ms.

### V4. Reggie's voice identity  `~30 min` · confidence High
- **Problem.** Uses the default ElevenLabs voice — generic, not a character.
- **Fix.** Choose a warm, tutor-appropriate voice from `?action=voices` and set it as
  `ELEVENLABS_VOICE_ID` (env) or pass a fixed `voiceId` from `gsSpeak`. Optionally tune
  `voiceSettings` (stability/similarity) for a calm teaching cadence. Keep one consistent
  voice so "Reggie" always sounds the same across orb / tutor page / room.
- **Acceptance.** Reggie has one recognizable voice; it matches across surfaces.
- **Cross-ref.** Align with `NeuralRing`'s voice usage so the app doesn't use two voices.

### V5. Speaking feedback (visual)  `~45 min` · confidence High
- **Problem.** While speaking, the only cue is the button flipping to "Stop."
- **Fix.** Add a subtle animated pulse/waveform on the Reggie avatar while `gsSpeaking`,
  and/or a "Speaking…" label. Stretch: highlight the paragraph being read (approximate by
  time, no per-word timing needed).
- **Acceptance.** A viewer can tell at a glance that Reggie is currently talking.

---

## P3 — Scale / robustness

### V6. Long-step chunking  `~1 hr`
Steps over ~1800 chars truncate mid-thought for speech. Use `src/lib/ttsChunker.ts` to
split into sentence-safe chunks and play them back-to-back (queue on the same `Audio`
element via `onended`). Keeps full teaching content spoken.

### V7. Stop speech on navigation  `~15 min`
`gsNext`/`gsStuck`/tab-switch don't stop in-flight audio when voice is *off*; only a new
auto-read (which calls `gsStopSpeak` first) or End session stops it. Call `gsStopSpeak()`
on step change and on `centerTab` change so audio never bleeds across steps/views.

### V8. Pause/resume  `~20 min`
`gsStopSpeak` resets `currentTime = 0`, so "Stop" then "Read aloud" restarts from the top.
Add a true pause (keep position) distinct from stop, if we want a Pause control.

### V9. Cost + model awareness  `~note`
Auto-reading every step of every session bills ElevenLabs per character. Currently on the
cheap `eleven_flash_v2_5` model — fine for the demo. At scale: cache generated clips by
(voice, text) hash, or gate auto-read behind an explicit toggle for non-exam modes.

### V10. Cross-browser / mobile check  `~30 min`
Verify the blob + in-memory `Audio` path on Safari and mobile (autoplay is stricter, and
`audio/mpeg` blob playback can differ). Demo is desktop web, so low priority.

---

## Suggested order for tomorrow
1. **V1 autoplay** (the one that can fail live) → 2. **V2 prod key** (if deploying) →
3. **V4 voice identity** (fast, high perceived quality) → 4. **V3 latency/prefetch** +
**V5 speaking feedback** (screenshot-iterate together) → 5. P3 as time allows.

## Open decisions (need founder / Vivek input)
- **Which voice** should Reggie be? (Pick from `/api/tts?action=voices` — want a sample
  shortlist?)
- **Auto-read scope:** exam-only (current default) or default-on for learn/assignment too?
- Demo on **localhost** or **deploy**? (Sets whether V2 is load-bearing.)

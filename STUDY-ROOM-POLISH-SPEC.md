# Study Room — Polish & Follow-up Spec (queued for 2026-07-21)

**Context.** The founder's 9-item study-room feature list is built and merged into
PR #256 on `fix/room-audit-tweaks` (proactive guided sessions, assignment mode w/
progress + AI ETA, exam voice, flashcards, focus music, motivation). All of it is
**dev-verified** (`npm run dev` + funded Anthropic/ElevenLabs keys). This spec is the
optimization/hardening pass before the **July 23 investor demo**.

Everything below lives in `src/pages/StudyRooms.tsx` unless noted. Keep each change
reversible and commit per item.

**Priority legend:** `P1` demo-critical · `P2` demo-polish · `P3` nice-to-have.
**Confidence** = odds of shipping at demo quality in the estimated time.

---

## P1 — Demo-critical

### 1. Realistic session ETA  `~30 min` · confidence High
- **Problem.** Reggie's per-step minute estimates sum to ~80–90 min for a 6-step
  session; the "≈ 90 min left" chip reads implausibly long and undercuts the "smart
  estimate" story.
- **Fix.** Cap/normalize estimates in `beginGuidedSession` after `parseGsPlan`:
  clamp per-step to `[2, 10]` and cap the session total to ~35 min (scale all steps
  down proportionally if the sum exceeds it). Show total on the launcher preview too.
- **Files.** `parseGsPlan` / `beginGuidedSession` (`StudyRooms.tsx`).
- **Acceptance.** A fresh 5–6 step session shows a total ETA in the 15–35 min range;
  the chip still counts down as steps complete.

### 2. Real Canvas assignments in assignment mode  `~1.5 hr` · confidence Medium
- **Problem.** Assignment mode takes a typed title; it should feel wired to the
  student's actual Canvas work.
- **Fix.** In the launcher's **assignment** mode, replace the free-text box with a
  picker populated from the student's assignments. Source: `useApp()` course/assignment
  data or the existing Canvas assignments query (see `AppContext` + `src/api/canvasSync`).
  Selecting one seeds `gsTopic` with the title AND passes the assignment description into
  the plan prompt so steps map to the real rubric. Keep free-text as a fallback.
- **Files.** `StudyRooms.tsx` launcher + `beginGuidedSession` prompt; read assignment
  shape from `AppContext`/Canvas tables (recon needed — assignments table is
  extension-written, RLS-off).
- **Acceptance.** Assignment mode lists ≥1 real assignment for the test account; picking
  it produces a plan that references the assignment's actual requirements.
- **Risk.** Assignment data availability per account; needs a 15-min recon first.

### 3. Production deploy readiness  `~45 min` · confidence Medium
- **Problem.** All features are dev-proxy-verified only. A deployed demo would break on:
  (a) missing Vercel env keys, (b) Vercel's ~12 serverless-function limit now that
  `api/music.ts` is a new routed function.
- **Fix.** (a) Set `ANTHROPIC_API_KEY` (funded) + `ELEVENLABS_API_KEY` in Vercel env.
  (b) Count `api/*.ts` routed handlers vs the plan's function limit; if over, fold
  `api/music.ts`'s iTunes proxy into an existing action-routed util endpoint instead of
  a standalone function. (c) Smoke-test `/api/music`, `/api/tts`, `/api/room-ai` on a
  preview deploy.
- **Files.** Vercel dashboard; possibly merge `api/music.ts` → an existing `?action=`
  endpoint.
- **Acceptance.** A Vercel preview deploy runs a guided session with voice + music.
- **Decision needed:** are we demoing on `npm run dev` (localhost) or a deploy? If
  localhost, this drops to P3.

---

## P2 — Demo-polish

### 4. Apple-UI / spacing pass on the guided + flashcard stages  `~1 hr` · High
- **Problem.** The new stages work but haven't had a dedicated spacing/typography pass.
- **Fix.** Screenshot-iterate: tighten vertical rhythm in the active-session header,
  align the step-title Read-aloud button, unify card radii/shadows with the rest of the
  room, verify the launcher centers well at narrow center-column widths.
- **Acceptance.** Side-by-side with the room redesign, the stages read as the same design
  language; no cramped/misaligned controls at 1280–1920px.

### 5. Focus-music polish  `~30 min` · High
- **Problem.** (a) Music keeps playing when the mini-player is closed (only Pause stops
  it). (b) Default query is a single "lofi study beats" search; artwork/titles vary.
- **Fix.** Close (X) and toggling the Music pill off should `pause()`. Optionally add 2–3
  curated query presets (Lofi / Classical / Ambient) as chips. Keep the mini-player state
  when switching center tabs.
- **Files.** music player block + `toggleMusic`/close handlers (`StudyRooms.tsx`).
- **Acceptance.** Closing the player stops audio; presets swap the playlist.

### 6. Live transcript — real or honest  `~1 hr` · Medium
- **Problem.** The left "Live Transcript" panel shows hardcoded sample lines.
- **Fix (demo-pragmatic).** Either (a) wire it to the room voice STT if a transcript
  stream exists (`api/transcribe` / VoiceRoom), or (b) drive it from the guided session —
  append Reggie's step titles + the student's asks as a real, honest activity feed.
  Option (b) is lower-risk and still looks live.
- **Acceptance.** The panel reflects real session activity, not fixed sample text.

### 7. Two-account friends/invite pass (#5)  `~30 min` · High
- **Problem.** Invite/room-code exist but weren't tested with a second live account.
- **Fix.** Run two sessions (test account + a second), invite via code + friends list,
  confirm presence tiles + join flow. Fix any rough edges in the invite copy/flow.
- **Acceptance.** A second account joins via code and appears in Group session tiles.

---

## P3 — Nice-to-have

### 8. Persist room-generated flashcards + SRS  `~45 min`
Save Reggie-generated room decks via `POST /api/flashcards {action:"save"}` (course-scoped)
and schedule with `src/lib/srs.ts` so "Missed" cards resurface. Skip silently when the
room has no linked course.

### 9. Group @Reggie (group study tutor)  `deferred by founder`
Shared guided session where the whole room follows one Reggie-led plan (broadcast turns
via `api/room-ai` group action). Explicitly later per the founder; spec only.

### 10. Assignment-mode integrity guardrail copy  `~15 min`
Add a one-line "Reggie coaches, won't write it for you" note in assignment mode so the
academic-integrity stance is visible to investors.

---

## Suggested order for tomorrow
1. **#1 ETA** (fast, high-visibility) → 2. **#3 deploy decision + env** (unblocks a
demoable URL) → 3. **#2 Canvas assignment picker** (biggest "it's real" win) →
4. **#4 UI pass** + **#5 music polish** (screenshot-iterate together) → 5. **#7 two-account
test** → 6. P3 as time allows.

## Open decisions (need founder/Vivek input)
- Demo on **localhost dev** or a **Vercel deploy**? (Sets whether #3 is P1.)
- Rotate the pasted/committed Anthropic key **before** any shared deploy.
- Is the group tutor (#9) in scope for the 23rd, or strictly post-demo?

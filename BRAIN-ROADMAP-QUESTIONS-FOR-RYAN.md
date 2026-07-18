# Brain / Room-AI — Questions to settle with Ryan

Short list to nail the decisions that gate the brain + room-AI work. Each has my recommendation +
the evidence, so it's a fast "confirm or redirect," not an open debate.

---

## 1. AI-system: one brain or two? (the big one)
**Question:** For the study room, do we run on Reggie's existing reasoning core, or build a separate
room agent?

**Recommendation: one brain — the "blend."** Keep Reggie (`api/agent-manager.ts` → `runReggie`) as the
single reasoning core, and give the room a thin *skin* (assemble room context → call the same core).
Do **not** build a separate room brain.

**Evidence (from the code, not opinion):** `agent-manager.ts` already takes `brainContext` as an
injected **string** parameter to `runReggie` — the core is decoupled from how context is assembled. So a
room skin can feed a different context and reuse the core cleanly. (See `BR-05-GROUNDING-FINDINGS.md`.)

## 2. Which room mode is the MVP?
**Question:** Is the launch room **co-working** (people study together, each with their **own private
Reggie**) or **facilitated group study** (a shared AI running the session)?

**Recommendation: co-working is the MVP; facilitated group is the fast-follow.** The room shell already
exists (`StudyRooms.tsx`: voice, whiteboard, chat, pomodoro, presence — no AI inside yet), co-working
has **zero cross-student leak surface**, and the private-Reggie grounding is already wired. Facilitated
group needs the two-tier grounding + trigger engine (bigger, and it's Siddharth's solo P0). Shipping
co-working first de-risks the timeline.

## 3. Do we standardize the room AI on `agent-manager` (Reggie)?
**Question:** The live tutor UI currently calls **both** `/api/tutor-context` + `/api/claude` directly
**and** `/api/agent-manager` in "Reggie-mode" (confirmed: `NeuralRing.tsx:1056/2053`,
`StudyAssistant.tsx:160/173`). `agent-manager` calls itself "the single product contract." Are we
standardizing the room (and eventually the tutor) on `agent-manager`, or keeping the direct path?

**Why it matters:** it decides where the room AI plugs in, and where BR-05's grounding/chips surface.
My BR-05 Gap 2 change returns `sources` from `tutor-context`, which reaches **both** paths — so it's
not blocked either way — but the room wiring should target one.

## 4. Define BR-04 / BR-07 / BR-08
**Question:** These BR numbers are referenced but **undefined in the local docs** I can see. What are
they? (BR-07 was mentioned as a trigger engine.) Which are launch-critical vs later?

**Why it matters:** I can't scope the remaining brain roadmap without them. Everything I *can* see
(BR-01/02/03/05/06) is either done or scoped; these are the unknowns.

## 5. Ownership boundary on the two brains
**Question:** Confirm the split: **Vivek owns the Course Brain** (`course_content`, BR-01/02/03/05/06);
**Ryan owns the Person Brain kernel** (`api/_brain/` — memory/decay/identity/traits). Where exactly is
the seam on **BR-05 grounding** (Course Brain → tutor), since that's where the two meet?

---

## Context I already resolved (so you don't have to ask)
- **Reggie takes injected context cleanly** → the blend is low-risk (Q1 evidence).
- **The grounding chain is already built + wired** (`agent-manager → tutor-context → course_content`) →
  the co-working MVP's brain is largely done (Q2).
- **The live tutor path** hits `tutor-context` directly *and* via `agent-manager` (Q3 data).
- Full detail: `BR-05-GROUNDING-FINDINGS.md`.

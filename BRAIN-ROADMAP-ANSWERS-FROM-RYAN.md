# Brain / Room-AI — Answers (Ryan)

Answers to `BRAIN-ROADMAP-QUESTIONS-FOR-RYAN.md`. Decisions are actionable as written; where I add a
constraint it's called out. Confirmed against the current code (not memory).

---

## 1. One brain or two? → **ONE brain — the blend. Confirmed.**
Keep Reggie (`api/agent-manager.ts` → `runReggie`) as the single reasoning core; the room is a thin
**skin** that assembles a room-flavored context and calls the same core. Do **not** build a separate
room agent.

Evidence (code, not opinion): `runReggie` takes `brainContext` as an injected **string**
(`agent-manager.ts:94-96`), so the core is already decoupled from how context is assembled — a room
skin feeds a different context (shared brain + room plan + group state) and reuses the core. This is
the "same engine, room-scoped skin" model: personal Reggie = `subject: person:<id>`; room facilitator
= `subject: room:<id>`. Same code, different scope + persona.

## 2. MVP room mode? → **Co-working is the MVP; facilitated group is the fast-follow. Confirmed.**
Launch = each student in the room has their **own private Reggie** (grounded in their own materials).
Rationale: **zero cross-student leak surface**, the private-Reggie grounding is already wired
(BR-05 is ~80% built), and facilitated group needs the two-tier grounding + trigger engine (bigger).
Co-working de-risks the **July 23 demo**. Facilitated group ships after.

## 3. Standardize the room AI on `agent-manager` (Reggie)? → **YES, standardize on `agent-manager`.**
- **Room:** wires to `agent-manager` **only** (it's already "the single product contract," and it's
  where BR-05 grounding + `sources` chips surface). Do not add a second room path.
- **Tutor:** the live tutor UI currently hits **both** `tutor-context`+`claude` directly **and**
  `agent-manager` (`NeuralRing.tsx`, `StudyAssistant.tsx`). Consolidate the tutor onto
  `agent-manager` too — but **after the demo**, as a deliberate migration, not a rushed pre-demo
  cutover. The direct `/api/claude` tutor path is legacy from that point.
- **Net:** one entry point (`agent-manager`) → one place grounding, sources, and future scopes plug in.

## 4. Define BR-04 / BR-07 / BR-08
| BR | Definition | Status | Launch-critical? |
|----|-----------|--------|------------------|
| **BR-04** | NeuroAGI linkage adapter (`api/_brain/adapter.ts`): `brainRead(personId)` / `brainWrite(personId, signal)` over the kernel; subject **fixed** to `person:<id>`, source **fixed** to `"fschoolai"`, one-way, 600ms hop budget, graceful-degrade. | **DONE (shipped)** | Yes — it's the person-brain↔room seam. |
| **BR-07** | **Proactive / trigger engine.** Room half = **already shipped** (AI-08 `room-triggers.ts` deterministic engine + 1-min cron, AI-07 participation aggregator). Person-brain half = hypothesis → arbiter/policy-gate → **gated delivery** (`api/arbiter.ts`, `proactive_signals`) — built but not delivering. | Room: done. Person delivery: **deferred** (outward-facing → needs explicit go-ahead). | Room triggers: yes (demo). Person-brain delivery: **no** (post-launch, gated). |
| **BR-08** | **Kernel convergence + shared-scope layer.** Reconcile the three brain homes (v1 Brain DB · product `neuro_*` · empty `neuroagi-v2`) onto ONE kernel (target: `neuroagi-v2`), and add the **sharing/membership/read-auth layer** (`space_member` / `memory_grant`) the course/room/prof shared brains need. | Not started (scoped). | **No** — post-launch, strategic (least-debt). |

## 5. Ownership seam → **Confirmed split; the seam is `tutor-context` + the BR-04 adapter.**
- **Vivek owns the Course Brain** — `course_content` (shared, entity-keyed, non-decaying facts),
  BR-01/02/03/05/06.
- **Ryan owns the Person Brain kernel** — `api/_brain/` (memory/decay/identity/traits/hypothesis +
  the BR-04 adapter).
- **The seam (the only place they meet):** `api/tutor-context.ts` reads **both** — the shared Course
  Brain (`course_content`, `is_private=false`, `university_id`-scoped) **and** the Person Brain
  (kernel recall + `context_window`) — and blends them into the single `brainContext` string. Course
  Brain → tutor is Vivek's read (BR-05 Gap 1/2); Person Brain → tutor is Ryan's (BR-04 `brainRead`).
- **It stays clean because the linkage is one-way and enforced on both sides:** person-brain writes
  are source-stamped `"fschoolai"` at a fixed `person:<id>` subject (BR-04 — cannot target a shared
  scope), and course-brain writes are proven to never carry person data (BR-06 guard). Neither store
  writes the other. The seam is a **read-time blend**, never a cross-write.

---

## BR-05 quick confirms (from `BR-05-GROUNDING-FINDINGS.md`)
- **Gap 1 (surface BR-03 types):** approved — ship it (it's the launch-critical grounding-quality
  win). Proposed boosts/labels are fine as defaults: `assessment` "Assessment Schedule" +4,
  `module` "Course Modules / Topics" +3, `file` "Posted Materials" +1. Extract to a pure helper so it
  gets a unit test. Tune post-demo if needed.
- **Gap 2/3 (structured `sources` + chips UI):** **fast-follow**, not MVP-blocking. Ship Gap 1's
  improved grounding for the demo; add chips right after.
- **Gap 4 (group two-tier grounding):** deferred with facilitated mode.

## Launch-critical (for July 23) vs later
- **Launch:** co-working room on `agent-manager` (Q1/Q2/Q3) · BR-05 Gap 1 grounding · room triggers
  (AI-08, done) · **F-5 Vercel key check/rotation** (security, Ryan).
- **Fast-follow:** grounding chips (BR-05 Gap 2/3) · tutor→`agent-manager` consolidation.
- **Post-launch / strategic:** BR-07 person-brain proactive delivery (gated) · BR-08 convergence +
  shared-scope layer · facilitated group mode (BR-05 Gap 4).

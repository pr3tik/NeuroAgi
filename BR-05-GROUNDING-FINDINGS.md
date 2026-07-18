# BR-05 Grounding — Findings & Design Notes (investigation, no code changed)

**Date:** 2026-07-18. **Author:** solo investigation while Vivek away. **Status:** research only —
no files modified. Purpose: de-risk + scope BR-05 so we can go straight to a spec/build when back.

---

## TL;DR

**BR-05's grounding is ~80% already built and wired — it was never a from-scratch job.** The shared
Course Brain is *already* read and injected into the 1:1 tutor today. What's actually left is (a) a
small backend gap-fill so BR-03's new artifact types get surfaced, (b) structured source metadata so
the UI can render "grounding chips," and (c) — later — the group/two-tier version for facilitated mode.

---

## How grounding works TODAY (the chain that already exists)

```
frontend tutor UI
   └─> api/agent-manager.ts (Reggie, "the single product contract")
         ├─ calls api/tutor-context.ts  →  assembles ONE context string:
         │     • Course Brain  : course_content (SHARED), is_private=false, institution-scoped (BR-02)
         │                       → scored, labeled snippets "[Course Syllabus]: …"
         │     • Person Brain  : context_window (stress/momentum/deadline/focus) + kernel recall
         │     • Strategy hint : this user's own teaching-strategy affinity (never cross-student)
         │     • Files         : the student's OWN synced files (person-scoped, signed links)
         └─ passes it as `brainContext` (a STRING) into runReggie({ …, brainContext })
```

Key file references:
- `api/agent-manager.ts:40-44` — calls `tutor-context`, gets `brainContext`.
- `api/agent-manager.ts:94-96` — injects `brainContext` into `runReggie`.
- `api/tutor-context.ts:155` — the shared-library query (`course_content`, `is_private=eq.false`,
  `university_id` scoped).
- `api/tutor-context.ts:~168-181` — relevance scoring + snippet labeling.

**Implication:** for the **co-working MVP** (private Reggie per person in the room), the course brain
already grounds the tutor. The room just needs to *call* `agent-manager` from the room UI — the
grounding comes for free. No new grounding pipeline required for the private path.

## The "blend" decision — answered by the code

The crux question was: *can Reggie accept injected room context cleanly, or is it hard-wired to one
student?* **Answer: it accepts injected context cleanly.** `brainContext` is a first-class **string
parameter** to `runReggie` (`agent-manager.ts:94-96`) — Reggie's reasoning core is decoupled from how
the context was assembled. A room "skin" can assemble a *different* context (shared brain + room plan
+ group state) and call the same core. **The blend is low-risk. Recommend it to Ryan with this
evidence.**

---

## What's actually LEFT for BR-05

### Gap 1 — Surface BR-03's new artifact types  ·  backend, small, SAFE  ·  **do first**
`tutor-context.ts` scoring/labeling only special-cases `syllabus`/`lecture`/`announcement`. BR-03 added
`assessment`, `module`, `file` — they're fetched (the `select` doesn't filter type) but:
- **Scoring** (`~172-176`): no type boost → they rank below the older types → often miss the top-3 cut.
- **Labeling** (`~176-181`): fall through to the raw `content_type` (e.g. `[assessment]:`), not a
  friendly source label.

**Fix (proposed):** extend the score map and the label map:
| content_type | proposed label | proposed score boost |
|---|---|---|
| assessment | "Assessment Schedule" | +4 |
| module | "Course Modules / Topics" | +3 |
| file | "Posted Materials" | +1 |

This completes BR-03 (its extraction is currently under-used by the tutor) and directly improves
grounding quality. Cleanly testable if we extract the label+score logic into a pure helper (like the
BR-03 formatters) — recommended, so it gets a unit test instead of being buried in the handler closure.

### Gap 2 — Structured source metadata for chips  ·  backend  ·  enables UI-08
Today the source labels are **embedded in the context string** fed to the LLM. The UI can't cleanly
list them. **Fix:** have `tutor-context` also return a structured `sources: [{ type, label, id }]`
array alongside `context`, and thread it through `agent-manager`'s response. Then the frontend renders
"grounded in: Syllabus · Lecture Wk5" chips. (The frontend chip render is the UI-08 half — Pratik/new
hire.)

### Gap 3 — When grounding fires  ·  tuning
The library fetch is gated on `isLibraryQuery` (a keyword-signal heuristic, `~131`). Worth revisiting
whether grounding should fire more broadly (e.g. always attempt for course-scoped questions). Low
priority; note for the spec.

### Gap 4 — Group / two-tier grounding  ·  LATER (facilitated mode only)
For the *group*-study mode, group turns must ground in shared/aggregate only (never an individual's
private brain) — the two-tier contract from the room-AI discussion. **Not needed for the co-working
MVP.** Defer until the room's group mode is scoped.

---

## Recommended sequencing (MVP-first)

1. **Gap 1** (surface BR-03 types) — small, safe, backend-only, unit-testable. Immediate grounding-quality win. *Ready to spec/build when Vivek's back.*
2. **Gap 2** (structured `sources`) — backend, unblocks the chips UI.
3. **Chips UI (UI-08)** — frontend, renders Gap 2's `sources`.
4. **Gap 4** (group tier) — deferred to facilitated-mode work.

Gaps 1–3 = "BR-05 for the co-working MVP." Gap 4 = the group fast-follow.

## Open questions to confirm (for the spec session)

1. **Live path:** does the current tutor UI (`StudyAssistant`/`NeuralRing`) actually call
   `agent-manager`, or a legacy tutor endpoint? If legacy, confirm the grounding chain reaches the
   live UI (or that agent-manager is the path we standardize on).
2. **Gap 1 scores/labels:** are the proposed boosts/labels right, or tune them?
3. **Chips scope for MVP:** do we ship chips (Gap 2+3) in the co-working MVP, or just the improved
   grounding (Gap 1) and add chips as a fast-follow?

---

## What this changes about the roadmap

- BR-05 is **no longer a big unknown** — it's ~80% built, with a small, safe first step (Gap 1) that
  needs neither the AI-system decision nor staging.
- Combined with the co-working-MVP framing, the **launch-critical brain work shrinks** to: Gap 1
  (+ optionally Gap 2/3 chips), F-5 (security, your Vercel check), and BR-06 Layer-3 (staging proof).
- Nothing here required the Ryan decision — but it gives you the evidence to *make* the blend call.

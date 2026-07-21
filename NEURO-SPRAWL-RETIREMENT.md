# Brain sprawl — reconciliation status + retirement runbook

Three "brain" homes exist; this documents how they're being collapsed onto ONE (the kernel), what's
already done (safe/additive), and the retirement steps that are **gated** (destructive / touch a live
parallel system) and need Ryan's explicit go.

## The three homes
1. **Kernel** — `neuro_memory` (+ `neuro_membership`, RPCs) in `neuroagi-v2` (product DB until the
   Vercel cutover). The v2-style single source of truth. Captures chat + session + **now Canvas** signals.
2. **Legacy "Brain DB"** (`neuroagibrain`, `BRAIN_SUPABASE_*`) — the duplicate: `fschool_courses`/
   `fschool_assignments` (from `brain-sync`), `brain.signals` + `brain.context_window` (from the
   `session-close` legacy block + `brain-scheduler`). Overlaps the kernel.
3. **`neuroagibrain` v1 `brain.*`** elaborate schema — deprecated, unused by current features.

## Done (safe, additive — merged)
- **Bridge**: `brain-sync` now records a compact `canvas_sync` kernel signal (courses / upcoming /
  missing), idempotent per day, **independent of the legacy path** — so the kernel no longer misses
  the Canvas facts that were legacy-only. Chat + session signals already land in the kernel. **The
  kernel is now a complete superset of what the legacy system captures.**

## Still writing legacy (to retire — GATED)
| Writer | Legacy target | Kernel equivalent (already live) |
|---|---|---|
| `session-close.ts` legacy block (~:235+) | `brain.signals`, `brain.context_window` | kernel academic signal + hypothesis/trait passes (block 4a) |
| `brain-scheduler.ts` (hourly cron) | `brain.context_window` (synthesis) | kernel recall + `renderStudentBrainState` (on-demand) |
| `brain-sync.ts` legacy block | `fschool_courses/_assignments` | kernel `canvas_sync` signal (the bridge) |
| `tutor-context.ts` legacy read | reads `brain.context_window` (fallback) | kernel recall (primary, already wired) |

## ⚠️ The legacy system is LOAD-BEARING (retirement ≠ a flip)
Correction after checking consumers: `brain.context_window` is read by LIVE features, so you can't
just stop writing it — those consumers must move onto the kernel FIRST, or they break:
| Live consumer | Reads | Status |
|---|---|---|
| `brain-intervention.ts` (*/30 cron, proactive nudges) | `context_window` | ✅ **MIGRATED (PR #305)** — now reads `synthesizeContext` (kernel); audit is a kernel `intervention` memory. No longer reads `context_window`. |
| `brain-scheduler-fast.ts` (*/5, real-time stress) | writes `context_window` for intervention | its only consumer (intervention) is migrated → now **dead-output**, safe to retire in the pass below |
| `tutor-context.ts` (fallback) | `context_window.recent_summary` | still reads it as a SECONDARY fallback (kernel recall is primary) — drop in the pass below |
| `brain-scheduler.ts` (hourly synth) | `brain.signals`, `fschool_*` → writes `context_window` | feeds only the tutor-context fallback now → retire once that's dropped |

The hard part — migrating the main consumer (intervention) onto the kernel — is **done**. What
remains is one **bake-gated retirement pass** (below), not a project. Doing it *this instant* would
rip out the legacy fallback the same hour the kernel-intervention went live (zero prod bake) — bad
sequencing. Correct order: **bake the intervention migration → then the single retirement pass.**

### The remaining retirement pass (one PR, after the bake)
Drop `tutor-context`'s `context_window` fallback read; remove the `session-close` legacy
`brain.signals`/`context_window` block; remove `brain-sync`'s `fschool_*` writes (the kernel
`canvas_sync` bridge replaces them); migrate `office-hours`' `brain.signals` write to a kernel
signal; retire the `brain-scheduler` + `brain-scheduler-fast` crons (vercel.json). Then DROP the
legacy tables (gated, cross-repo).

## ⚠️ Identity ambiguity to resolve FIRST
`users.brain_person_id` is written by BOTH `resolveFschoolPerson` (the **kernel** neuro_person id) and
consumed by `brain-sync`/`session-close` as the **legacy** `fschool_*`/`brain.signals` person id. The
two systems share one column with different meanings. Before dropping anything, confirm which id space
each legacy row actually used, or the retirement could orphan legacy rows mid-flight. (The kernel path
is unaffected — it resolves its own identity.)

## Retirement runbook (GATED — needs explicit OK)
1. **Stop the legacy writers** (code, reversible): remove the `session-close` legacy `brain.signals`/
   `context_window` block, the `brain-sync` `fschool_*` block, and drop the `tutor-context`
   `context_window` fallback read; retire the `brain-scheduler` cron (`vercel.json`). Deploy. The
   kernel already covers all of it. Watch for a bake period.
2. **DROP the legacy tables** (destructive, final): after the bake, in the `neuroagibrain` project,
   `drop table brain.signals, brain.context_window, public.fschool_courses, public.fschool_assignments`
   (one statement, quiet window). This closes the rollback — announce before running.

**Rollback** (before step 2): revert the step-1 commit; the legacy writers resume. **Not touched
autonomously**: retiring writers destabilizes a demo-critical live path and dropping tables is
irreversible — both wait on your go.

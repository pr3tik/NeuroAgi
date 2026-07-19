# Solo Session — Review & Test Guide

**Date:** 2026-07-18. Work done autonomously while you were away. **Branch:**
`br-05-06/guard-and-grounding` (local only — **NOT pushed**). Everything below is committed on that
branch. Verified green before every commit: **726 passed / 6 skipped, typecheck 0, build 0.**

> Start here, then dig into the linked docs. Nothing here is pushed or deployed; migrations are written
> but **not run**. Two things need *you* (⭐ below).

---

## The 6 commits on this branch (newest first)
```
ca7929b docs(security): F-5/F-6/F-7 findings, corrected F-4; brain roadmap questions
258b220 test: pin behavior of office-hours, session-close, library-agent endpoints
d14ba1e feat(br-05): return structured sources from tutor-context (Gap 2)
37f95e2 feat(br-05): surface BR-03 artifact types in tutor grounding (Gap 1)
a7e1912 feat(br-06): enforce course_content isolation guard at all write doors
b0f042a BR-03: broaden University Brain extraction   (pre-existing — the base)
```
Review the diff: `git log --oneline b0f042a..HEAD` then `git diff b0f042a..HEAD`.

---

## 1. Code to review + how to test it

**BR-06 — course_content isolation guard** (`a7e1912`)
- `api/course-fact-guard.ts` + wired into all 3 write doors (`university-brain`, `extension-content`,
  `extension-sync`). Already adversarially reviewed *this session* — it caught + fixed a **Critical**
  served-field bypass before commit. Design: `BR-06-ISOLATION-PROOF-SPEC.md`.
- **Test:** `npx vitest run test/course-fact-guard.test.ts` (should pass). Sanity: a `course_content`
  write carrying `"your grade: 18/20"` in any served field is rejected.

**BR-05 Gap 1 — grounding surfaces BR-03 types** (`37f95e2`)
- `api/course-source.ts` (`courseSourceBoost` + `courseSourceLabel`), wired into `tutor-context.ts`.
- **Review the numbers/labels** in `course-source.ts` (my proposal — assessment +4/"Assessment
  Schedule", module +3/"Course Topics", file +1/"Posted Materials"). Tweak if you want.

**BR-05 Gap 2 — structured `sources` for chips** (`d14ba1e`)
- `tutor-context.ts` now returns `sources: [{id,type,label}]` alongside `context`. Additive.
- **Test in the app:** hit `/api/tutor-context` with a library-ish question and confirm the response
  has a `sources` array. The frontend chip render (UI-08) is the next step (not built).

**Endpoint tests** (`258b220`, +`test/tutor-context.test.ts` in `d14ba1e`) — 23 new tests, all pinning
*current* behavior (no bugs fixed, per policy). `npm test` to run all.

---

## 2. Findings to action (all in `SECURITY-*.md`)

| # | Sev | What | Status |
|---|-----|------|--------|
| ⭐ **F-5** | 🔴 P0 | Brain write-key maybe shipped to browsers | **Needs YOU** — decode `VITE_BRAIN_SUPABASE_KEY` in Vercel |
| **F-7** | 🟠 P1 | `session-close.ts` has **no auth** — anyone can overwrite another student's brain | Found by the new test. Fix spec'd; **not applied** (sendBeacon caveat) |
| **F-6** | 🟡 P2 | Assignment description = stored XSS (`Assignment.tsx:263`, raw HTML) | Sanitizer fix spec'd; **not applied** (adds a dep) |
| **F-4** | 🟡 P2 | Canvas token on client — **corrected**: token is load-bearing, real fix is a server-side sync refactor | Corrected write-up; **not applied** |

F-6 + F-4 compound (XSS can steal the client token). F-7 is the most actionable new one — small fix,
but check the `sendBeacon` path first (see the doc).

---

## 3. Decisions for you + Ryan
`BRAIN-ROADMAP-QUESTIONS-FOR-RYAN.md` — 5 questions with my recommendation + code evidence for each:
one-brain-blend (yes), co-working MVP (yes), standardize on agent-manager?, define BR-04/07/08, brain
ownership boundary. Backed by `BR-05-GROUNDING-FINDINGS.md`.

---

## 4. What I deliberately did NOT do (and why)
- **No push, no PR** — plain commits on the branch, your call how to land them.
- **No migrations run** — F-4's SQL is described, not executed.
- **Did NOT auto-apply F-4, F-6, F-7 fixes** — each changes auth/render/deps on live surfaces and needs
  your review (F-7's auth gate can break the `sendBeacon` session-close path; F-6 adds DOMPurify;
  F-4 is a real refactor). Code/specs are in each doc, ready to drop in.
- **Testing = 4 endpoints, not all 41** — did the high-value security/brain ones well rather than many
  poorly. The rest is a ready backlog (same pattern; `ONBOARDING-TESTING-TASK.md` hands it to the new hire).

---

## 5. How to verify everything yourself
```
git checkout br-05-06/guard-and-grounding   # if not already on it
npm test          # expect 726 passed / 6 skipped, 0 failures
npm run typecheck # expect exit 0
npm run build     # expect success
```

## Bottom line
Brain MVP moved forward: **BR-05 Gap 1 + Gap 2 done** (grounding now surfaces BR-03 content + returns
chip sources), **BR-06 committed**, **4 endpoints tested** (which *found* F-7), and **4 security
findings** documented with fixes. The launch-critical brain list is now just: **F-5 (you), F-7, the
BR-05 chips UI, and BR-06's staging proof.** Nothing is pushed — review, test, and decide how to land it.

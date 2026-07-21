# Legal Considerations — Shared Course Material & Student Data

> **Status: FOR LATER REVIEW. Does NOT block the demo.** This is an internal engineering/founder
> risk memo, **not legal advice**. Have qualified counsel review before any **public launch** or
> before distributing past-exam material beyond a controlled demo. It exists to (a) record the two
> open questions the demo-readiness checklist flagged and (b) document the technical safeguards
> already in place so counsel starts from facts, not a blank page.

## The two open questions

1. **Sharing past-exam / course material** in the shared Course Brain (`course_content`).
2. **Handling student personal data** (the private Person Brain, chat, grades, Canvas data).

## PIPEDA (Canada — primary; our first users are UofT/Canvas-Toronto)

PIPEDA turns on *consent*, *purpose limitation*, *data minimization*, *safeguards*, and *access/erasure*.

- **What we collect & why** — Canvas courses/assignments/grades and tutor-chat drive the tutoring
  purpose the student signed up for. Document this purpose plainly in the TOS/privacy policy and
  obtain consent at Canvas-connect time (we already gate Canvas sync behind an explicit connect flow).
- **Data minimization** — the *shared* library (`course_content`) is scoped to
  professor-published, mechanical course facts (syllabus/grading policy/assessment schedule/module
  list/posted-file list). **No student PII is permitted in the shared store** — enforced in code by
  the `course-fact-guard` allowlist + person-data screen (rejects `user_id`/`score`/`grade`/
  `submission*`/first-person result language), and the Person Brain is one-way isolated from it.
- **Safeguards** — RLS-on/owner-scoped user tables; server-only service key; shared tables reached
  only through guarded, authenticated write paths (the unauthenticated scrape door was retired to 410).
- **Access & erasure** — confirm we can honor a student data-access/deletion request end-to-end
  (Person Brain memories, Canvas mirror, RAG chunks, notifications). *Open item: a documented
  erasure runbook.*
- **Cross-border** — data resides in Supabase (confirm region + include in the privacy policy;
  cross-border storage must be disclosed under PIPEDA).

## FERPA (US — relevant when we expand to US institutions)

FERPA protects "education records" and restricts disclosure of personally identifiable information
without consent.

- FschoolAI acts on **the student's own** records with the student's consent (student-initiated
  Canvas connection) — not as a school official pulling other students' records.
- **No cross-student disclosure**: a student's private brain/threads are never exposed to another
  student. This is enforced structurally (the Person→shared write path is *absent*, not merely
  guarded) and covered by the isolation test suite (`test/brain-isolation.test.ts`, `room-ai` privacy
  tests). The shared library holds course facts, never "Student X struggles with Y."
- If we ever contract *with an institution* (school as the customer), revisit the
  "school official / legitimate educational interest" and data-processing-agreement posture.

## Past-exam material — the sharpest question

Distinct from privacy: this is **copyright + academic integrity**.

- Past exams and answer keys are frequently owned by the **institution or professor**, and some
  schools' integrity policies restrict their redistribution.
- **Recommended posture for launch:** the shared library should carry only **professor-published /
  publicly-posted** artifacts and *facts about* assessments (dates, weights, topic coverage) — not
  scans of student-submitted exam papers or instructor answer keys, unless the professor made them
  public or the institution grants permission. The current extraction path already extracts *facts*
  (schedule/weights/topics), not exam contents, which keeps us on the safer side of this line.
- Add a copyright/DMCA takedown path and an institutional-permission process before broad launch.

## Technical safeguards already in place (facts for counsel)

- `api/course-fact-guard.ts` — allowlist rebuild + person-data screen on every shared-library write.
- `university_id` scoping — a school's facts never surface to another school's users (server-derived,
  tested cross-university in `brain-isolation`).
- One-way linkage — no code path writes Person-Brain data into any shared/course store.
- RLS-on user tables; unauthenticated shared-library write door retired (410).

## Open items for counsel / founder sign-off (pre-public-launch, non-blocking for demo)

- [ ] TOS + privacy policy: stated purpose, consent language, cross-border storage disclosure.
- [ ] Documented data access + erasure runbook (PIPEDA/FERPA request handling).
- [ ] Past-exam-material policy: publicly-posted-only, institutional-permission process, DMCA path.
- [ ] Age/COPPA check if any users may be under 13.
- [ ] If selling to institutions: data-processing agreement + FERPA "school official" posture.

**Bottom line:** the architecture is built to be defensible (no student PII in shared stores,
structural isolation, institution scoping), but the TOS/consent/erasure paperwork and the past-exam
copyright policy are genuine pre-launch legal work — acknowledged here, not resolved.

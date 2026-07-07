# Study Room AI + NeuralRing — Plan of Action

**Scope note:** written for the investor-preview milestone, not general-availability launch.
Recommendations are sorted into "worth doing before the demo" vs "roadmap talking point" —
this is not a request to harden everything to public-launch standard.

Findings below are verified directly against the current code (`RoomPrivateAssistant.tsx`,
`api/tutor-context.ts`, `api/session-close.ts`, `api/rag.ts`, `supabase-teaching-strategies-migration.sql`,
`NeuralRing.tsx`, `Landing.tsx`), not assumed from the feature description.

---

## 1. Privacy of the Study Room private assistant

**Verdict: the core mechanism is sound.** `RoomPrivateAssistant.tsx` has no code path that sends
its messages anywhere except the model call itself — no room broadcast, no persisted transcript
table. The pattern-recognition harvest (`session-close.ts`) is fail-closed by design: if the
de-identification pass can't produce a confident generic rewrite, it's dropped, not stored. The
`teaching_strategies` table has no `user_id` column at all (schema-level guarantee), and
`strategy_provenance` — the one table that *does* link a strategy back to a student — is never
joined on the read path. Verified directly in the SQL: `find_teaching_strategy_hint()` only ever
looks up the *requesting* student's own affinity row.

**Refinements worth making (not urgent, cheap when you get to them):**

- **De-identification is single-layer.** Right now one Haiku call either produces a clean
  generic summary or returns `DROP`. There's no second, mechanical check (e.g. a name/number/proper-noun
  scrubber) behind it. Worth adding as a belt-and-suspenders pass before this scales past a
  handful of pilot users — not because the current approach is unsafe, but because a single LLM
  judgment call is a thinner margin than most privacy-sensitive systems settle for long-term.
- **No user-facing "delete my contributions" action yet.** `strategy_provenance` exists
  specifically to support this, but there's no UI path that calls it. Fine for an investor demo;
  worth having on the roadmap so "we support erasure" is backed by a real button, not just a schema.
- **Be explicit in the product narrative that "private" means private from other students/staff,
  not private from the AI vendor.** Session content still goes to Anthropic (chat) and OpenAI
  (embeddings) as part of the normal pipeline — same as every other AI feature in the app, not a
  new exposure, but worth stating precisely if this comes up in investor due diligence.
- **No periodic audit sampling.** Consider a lightweight background job that spot-checks a
  sample of harvested `teaching_strategies` rows for anything that slipped past de-identification.
  Cheap insurance, good talking point ("we monitor this, not just trust one model call").

---

## 2. Scoping the AI to the student's own university + curriculum

**Verdict: confirmed gap.** This is not handled today, and it's a real gap, not a hypothetical
one — traced to a specific field.

**What's already safe:** the student's own uploaded materials (RAG — `rag_documents`/`rag_chunks`)
are always filtered by `user_id` first (verified in `api/rag.ts`); a student can only ever retrieve
their own ingested files. No cross-student leak is possible there.

**What's not scoped:** the *shared* course library (`course_content` — lecture notes, syllabi,
rubrics contributed across students, looked up by `api/tutor-context.ts`'s library search) is
filtered only by `course_id`. The table has a `university_id` column, populated at write time
(`api/extension-content.ts`), but grepping the entire `api/` directory shows **no endpoint ever
filters a read by `university_id`.** Because `course_id`/course codes are free-text-ish and not
guaranteed unique across institutions (two schools can both have a "CS 101"), a student could in
principle be served lecture notes or rubric text from a *different school's* version of a
same-named course. This is a correctness/trust problem more than a breach — the practical risk is
a confidently-wrong answer sourced from the wrong institution's material, which is a bad look for
an "academically accurate" pitch.

**Plan of action:**

- Add a `university_id` (or equivalent) filter to the `course_content` lookup in
  `api/tutor-context.ts`'s library search, keyed off the student's own `users.school` /
  `school_city` / `school_country` (these columns already exist as of the recent onboarding fix).
- Use the just-built canonical school dataset (`schoolSearch.ts` / `universities.json`) as the
  normalization layer — it already solves "match free-text school names to a canonical identity,"
  which is exactly what's needed to reconcile `users.school` against `course_content.university_id`.
  This is a smaller lift than it looks because that groundwork already exists.
- Backfill check needed first: confirm how many existing `course_content` rows actually have a
  real (non-`'unknown'`) `university_id`. If most rows predate reliable tagging, a strict filter
  would silently empty out the library for everyone — decide whether to backfill, soft-filter
  (prefer same-university, fall back to unscoped), or gate this behind a flag until the data is
  clean.
- Separately, add an explicit **curriculum boundary in the system prompt** — both
  `RoomPrivateAssistant.tsx` and `NeuralRing.tsx` should state plainly that the assistant only
  helps with the student's enrolled courses/university curriculum and should decline or redirect
  clearly off-topic, non-academic requests. This is a same-day prompt change, not an infrastructure
  change, and is worth doing regardless of the data-scoping timeline above.
- Longer-term (roadmap, not demo-blocking): once there's real multi-university data in
  `course_content`, revisit whether "shared across students in the same nominal course" should
  require an explicit course-catalog match rather than a string/course_id match at all.

---

## 3. The 7-technique "shared wisdom" system

**Clarifying what's actually built**, since the framing of "7 student learning types" doesn't
quite match the implementation (worth knowing precisely for how you describe this to investors):
this is **not** a system that buckets *students* into 7 fixed types (that would be a "learning
styles" model — deliberately avoided here, and for good reason: styles-matching has no real
research support). What's actually built is 7 **teaching technique categories** (retrieval
practice, elaborative interrogation, self-explanation, concrete example, dual coding, interleaving,
spaced callback — an evidence-based taxonomy), stored per-*concept*, with a **separate, per-student
empirical track record** of which techniques have actually worked for that specific student. That's
a meaningfully stronger and more defensible design than "learning styles," and worth stating that
way explicitly in any investor materials — it's a better story than the literal phrase "7 learning
types" implies.

**Verdict: well-designed. Real scope to improve, as you suspected:**

- **Cold-start problem.** The strategy pool only grows from real resolved tutoring sessions. For
  a pilot with limited usage so far, the hint pool is likely close to empty — meaning the
  personalization feature may have nothing to visibly show in a demo. **Suggested fix before any
  investor demo that wants to show this off:** seed `teaching_strategies` with a curated set of
  hand-written, high-quality technique cards for common intro-level concepts (a few per subject
  area), so the retrieval mechanism has something real to demonstrate rather than relying on
  organic accumulation that hasn't had time to happen yet.
- **No visible attribution to the student.** The hint is folded silently into the system prompt —
  the student never sees a signal like "this approach has worked well for you before." Purely a
  UX/storytelling opportunity: a small, subtle "personalized based on what's worked for you" marker
  would make the feature demonstrable and legible in a demo, not just a backend improvement.
  Currently only the single best hint is even fetched (`p_limit: 1`) even though the underlying
  function supports returning several.
- **Fixed distance thresholds** (`0.15` for harvesting, `0.45` for retrieval) are reasoned
  estimates documented in the migration, not yet validated against real usage volume. Fine for now;
  flag as something to revisit once there's enough real traffic to tune against.
- **No retirement/expansion path for the 7 categories yet** — not a problem now, just note it as
  future work if you ever want to add an 8th technique or phase one out.

---

## 4. Feature parity — routing NeuralRing's student context into the Study Room assistant

**Verdict: confirmed gap, and a precise one.** Traced exactly where the Study Room assistant
(`RoomPrivateAssistant.tsx`) diverges from NeuralRing in what it knows about the student:

- **The "living mind" (`tutor_mind` + `tutor_impressions`) is write-only for Study Rooms, not
  read.** `NeuralRing.tsx` loads both tables on mount and feeds them into its system prompt as
  `impressions` / `lastSession` (this is the persistent, cross-session model of the student).
  `RoomPrivateAssistant.tsx`'s `buildSystem()` never reads either table — it only builds from
  room/course name, GPA, upcoming assignments, and reactive context. Meanwhile, Study Room sessions
  *do* feed into `tutor_mind` via `session-close.ts` on close. So today the flow is one-directional:
  Study Rooms contribute to the student's long-term profile but never benefit from it.
- **`brain_person_id` is never passed.** `NeuralRing.tsx` explicitly sends
  `brainPersonId: userData?.brain_person_id` to `/api/tutor-context` (confirmed at two call sites).
  `RoomPrivateAssistant.tsx`'s request body omits this field entirely — and `tutor-context.ts`'s
  Brain DB fetch is gated on that field being present, so it silently never runs for the Study Room
  assistant. This means stress/momentum/deadline/do-not-mention context from the Brain DB reaches
  NeuralRing but never reaches the Study Room assistant, even though `userData.brain_person_id` is
  already available in `AppContext` and would just need to be threaded through.
- **Proactive profile richness is thinner.** NeuralRing bakes the full course list, flashcard map,
  and syllabus into its prompt upfront. The Study Room assistant only gets these reactively (via
  `tutor-context.ts`'s query classifier, when it detects a grades/flashcard/file-type question) —
  which works for direct questions but means the assistant doesn't proactively "know" the student's
  broader picture the way NeuralRing does from the first message.

**Plan of action (this is a small, mechanical fix, not a redesign):**

- Pass `brainPersonId` through from `RoomPrivateAssistant.tsx`'s `/api/tutor-context` call — this
  alone closes the biggest gap (Brain DB context) with essentially no new code, just threading an
  existing value through.
- Load `tutor_mind` + recent `tutor_impressions` on mount in `RoomPrivateAssistant.tsx` (same
  pattern NeuralRing already uses) and fold them into `buildSystem()`. This is the change that
  actually delivers on "the Study Room assistant should know what NeuralRing knows."
- Decide deliberately whether to also proactively inject full course list / flashcard map /
  syllabus, or leave those reactive (current behavior). Given the Study Room assistant is scoped to
  one room/course already, the reactive approach may be intentionally lighter-weight and fine to
  keep — this is a product call, not a bug, so flagging it as a decision rather than prescribing an
  answer.

---

## 5. What to do with NeuralRing — a site helpline + landing page presence

**Recommendation: don't repurpose or reduce NeuralRing — add a distinct, lightweight sibling for
the helpline/wayfinding use case, and keep NeuralRing as the in-app personal tutor.**

Reasoning: NeuralRing is deeply embedded as the app's primary tutor surface (rendered globally in
the logged-in shell, carries voice mode, artifact rendering, quiz parsing, and — per section 4 — is
the richer of the two student-facing assistants). It's also the component the "AI Tutor" brand name
is already attached to in marketing copy. Turning it into a general helpdesk widget would blur that
positioning and throw away the personalization work above. A second, purpose-built,
lightweight assistant is a cleaner fit for the navigation/FAQ job:

**Plan of action:**

- **Build a new, minimal "helpline" widget** — reuse NeuralRing's visual identity (the orb
  look-and-feel) for brand consistency, but *not* its logic bundle. It should not touch Supabase
  student tables, RAG, or the Brain DB at all — just a scoped system prompt (product FAQ, feature
  explanations, sign-up guidance, "where do I find X") routed through `/api/claude` or `/api/groq`
  directly. Keeping it data-free is what makes it safe to expose to logged-out visitors.
- **Add it to `Landing.tsx`**, which currently has zero AI/chat presence (confirmed — it's a pure
  marketing scroll page today). This is genuinely new surface area, not a hookup to something
  half-built.
- **Give it a distinct name from "AI Tutor.**" Since that name is already the established brand
  for NeuralRing (used in `Landing.tsx` copy, `Card.tsx` pricing page, `DocChat.tsx`), reusing it
  for a wayfinding bot would create two things investors see called the same name doing different
  jobs. Something like "Ask FSchool" or "Site Guide" keeps the two clearly distinct.
- **For logged-in users, extend NeuralRing's existing nav-command handling rather than rebuilding
  it.** NeuralRing already parses commands like "take me to the toolkit" via a regex-based intent
  matcher — the foundation for "helpline"-style wayfinding is already there. The incremental step
  is adding FAQ/how-do-I knowledge to its system prompt (e.g. "how do I invite a friend to a study
  room," "where do I upload my syllabus") rather than building a second navigation system.
- **Keep scope tight for the investor-preview milestone**: a handful of FAQ topics + sign-up
  guidance on the landing widget is enough to demonstrate the idea; it doesn't need full parity
  with the in-app tutor before a demo.

---

## Suggested sequencing for the investor-preview milestone

**Do before the demo (cheap, high narrative payoff):**
1. Thread `brainPersonId` through `RoomPrivateAssistant.tsx` (section 4) — small change, makes the
   "our AI remembers you everywhere" story true.
2. Add the curriculum-boundary line to both assistants' system prompts (section 2) — same-day,
   no infra.
3. Seed a starter set of `teaching_strategies` cards so the personalization hint has something to
   show (section 3).
4. Load `tutor_mind`/`tutor_impressions` into `RoomPrivateAssistant.tsx` (section 4).

**Worth starting, can finish after the demo:**
5. University-scoped `course_content` filtering (section 2) — real fix, but needs a data-quality
   check first (backfill question above) so it doesn't regress the library feature.
6. The landing-page helpline widget (section 5) — net-new build, valuable for the pitch but
   self-contained and can slot in whenever it's ready.

**Roadmap / mention as future work, not needed now:**
7. Second-layer de-identification check, audit sampling, and a user-facing erasure action
   (section 1).
8. Visible "personalized hint" attribution UI, threshold tuning against real usage (section 3).

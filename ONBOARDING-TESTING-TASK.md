# Onboarding Task — Endpoint Test Coverage

**Owner:** you (new hire) · **Reviewer:** Vivek · **Est:** first ticket ~1–2 days, then self-serve

Welcome aboard 👋 Your first job gets you into the codebase without blocking anyone,
and it directly de-risks our launch: **most of our backend endpoints have no automated
tests.** You're going to fix that, starting with the ones that matter most.

---

## The big picture (why this matters)

Our backend is a set of serverless endpoints in `api/*.ts`. Right now **~41 of 58 have
zero tests.** That means a future change can silently break a paying-student flow and
nobody notices until it's live. Tests are our seatbelt before the ~Aug 1 launch.

You don't need to understand the whole product to do this well. You need to understand
**one endpoint at a time**, write tests that pin down what it *currently does*, and move on.

---

## Setup

```bash
# from the repo root
npm install
npm test            # runs the whole suite once (vitest) — should be green before you start
npm run test:watch  # re-runs on save while you work
```

Run a single test file while iterating:

```bash
npx vitest run test/office-hours.test.ts
```

If `npm test` is **not** green on a fresh clone, stop and tell Vivek — don't build on a
broken baseline.

---

## The pattern (copy this — don't invent your own)

There's a finished, reviewed example to model everything on:

### 👉 `test/university-brain.test.ts`

Open it. It shows the three moves you'll repeat for every endpoint:

1. **Mock the LLM gateway** so tests never hit the network / cost money:
   ```ts
   vi.mock("../api/_gateway", () => ({ callModel: vi.fn(async () => ({ ok: true, content: "..." })) }));
   ```
   (Some endpoints call Anthropic directly via `fetch` instead — for those, stub `fetch`, see below.)

2. **Stub `fetch`** so DB reads/writes and API calls return fixture data you control:
   ```ts
   vi.stubGlobal("fetch", vi.fn(async (url, opts = {}) => {
     // inspect url + opts.method, return the shape the code expects
     return { ok: true, json: async () => ([...]) , text: async () => "" };
   }));
   // ...assert...
   vi.unstubAllGlobals();
   ```

3. **Assert on the real output** — the JSON the endpoint returns, or the exact DB write
   it makes (method, url, body). See the `upsertSnapshot` tests for how to assert on the
   *request the code sent*, not just its return value.

---

## Your first ticket: `api/office-hours.ts`

This endpoint generates prep questions before a student meets a professor, and captures
notes after. It's action-routed:

- `POST /api/office-hours?action=prep`    → `{ questions, context_used }`
- `POST /api/office-hours?action=capture` → `{ ok }`

**Write tests that cover, at minimum:**

- [ ] `action=prep` with a valid body returns a `questions` array (mock the LLM call so
      it returns a known payload; assert the endpoint parses/returns it).
- [ ] `action=capture` with valid notes returns `{ ok: true }` and makes the DB write
      you'd expect (assert the POST/PATCH the code sends).
- [ ] A missing/invalid `action` is rejected cleanly (whatever the code does today —
      pin that behavior).
- [ ] A missing required field (e.g. no `userId`) is handled the way the code handles it
      today — **don't change the behavior, just document it in a test.**

Read the top-of-file comment in `api/office-hours.ts` — it documents the contract for you.

---

## 🚨 The one rule that matters most

**Test the behavior that exists today. Do NOT fix bugs you find.**

If a test surfaces something that looks wrong (a crash, a weird response, a missing
check) — that's a **win**. Write it up in a one-line note to Vivek and keep going. Do
**not** "fix it while you're in there." A test PR that also changes behavior is a PR we
can't merge quickly, and it defeats the point (a test should capture what's real so we
*notice* when it changes).

Filed bug > silent fix. Every time.

---

## Definition of done (first ticket)

- [ ] New file `test/office-hours.test.ts` covering the cases above.
- [ ] `npm test` is green (your new tests pass, nothing else broke).
- [ ] `npm run typecheck` is clean.
- [ ] PR opened against `frontend/dev`, description says what you covered + any bugs you
      filed (not fixed).

---

## After that — the self-serve backlog

Once the first PR lands, you don't need to wait for tickets. Pick the next untested
endpoint in this priority order and repeat the pattern:

1. `api/tutor-context.ts`   — feeds the AI tutor its grounding (high value)
2. `api/session-close.ts`   — end-of-session pipeline
3. `api/library-agent.ts`   — course material handling
4. `api/tutor-impression.ts`
5. …then breadth-first through the rest of `api/*.ts` that have no `test/*.test.ts`.

To find what's still untested: list `api/*.ts`, list `test/*.test.ts`, and cover the gaps.

---

## When you're stuck

- **Blocked > 30 min on setup or a mock that won't behave** → ping Vivek. Don't burn a day.
- **Not sure what an endpoint is *supposed* to do** → read its top-of-file comment first,
  then ask. Your test should match reality, so when in doubt, pin what the code does.
- Claude Code is your friend for writing the boilerplate — but read what it writes and
  make sure the assertions actually mean something. A test that can't fail is worse than
  no test.

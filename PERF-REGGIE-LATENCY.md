# Reggie chat latency — what was slow and what changed

Scope: `POST /api/agent-manager` (the tutor's front door — NeuralRing streams through it by
default). No product behavior changes; every fix is on the latency path.

## The shape of a slow turn (before)

A turn was a chain of round trips where almost nothing overlapped:

```
auth (GoTrue getUser + users SELECT)          ~150-400ms   every single turn
  └─ tutor-context
       users SELECT (brain_person_id)         ~80-150ms    awaited before anything else started
       Haiku classify                         ~500-900ms
       users SELECT (university_id)           ~80-150ms    same row, second read
       DB fetch for the classified type       ~150ms
  └─ classifyIntent (a SECOND Haiku call)     ~400-800ms
  └─ first model turn: system + ~5-8k tokens
     of tool specs, re-sent uncached          ~700-1500ms to first token
       └─ pre-tool preamble generated, then THROWN AWAY (`reset`)
       └─ tools executed ONE AT A TIME
       └─ next model turn … up to 6 steps, unbounded in wall-clock time
```

Two independent Haiku classifications, two reads of the same users row, a full tool catalog
re-prefilled on every step, and serial tool execution — all in series.

## Changes

| # | Change | Where | Effect |
|---|---|---|---|
| 1 | Brain context ‖ routing run concurrently | `api/agent-manager.ts` | preflight = max(a,b), was a+b |
| 2 | SSE headers + `open` frame flushed **before** the preflight | `api/agent-manager.ts` | connection live immediately; no proxy buffering |
| 3 | Verified-JWT cache (hashed key, bounded by the token's own `exp`) | `api/_auth.ts` | removes 2 round trips from every turn after the first |
| 4 | `cache_control` on the tool block + system prefix | `api/_gateway.ts`, `_reggie/loop.ts` | tool catalog is byte-identical across users → cross-user cache hit; most of the prefill leaves TTFT, and cached input bills at 0.1× |
| 5 | Tools in one step run **concurrently** | `_reggie/loop.ts` | multi-tool step = max(tools), was sum(tools) |
| 6 | Model told not to preamble, and to batch tools into one turn | `_reggie/loop.ts` | kills discarded pre-tool tokens and saves whole extra round trips |
| 7 | Classifier fast path — skip the Haiku call when the message names none of the student's own records | `api/tutor-context.ts` | removes ~700ms from the most common message shape |
| 8 | One users-row read shared by brain + kernel + library scoping | `api/tutor-context.ts` | two SELECTs → one, and it no longer blocks the handler |
| 9 | Wall-clock budgets: 20s per tool, 45s per turn, 3s on the intent classifier | `_reggie/loop.ts`, `_reggie/router.ts` | a slow dependency degrades the answer instead of hanging it |
| 10 | Client sends only the last 10 turns (server caps there anyway) | `src/components/NeuralRing.tsx` | request body stops growing with session length |

## Measuring it

Every turn now logs one structured line:

```
[reggie] turn {"route":"planner","streamed":true,"ok":true,"steps":2,"tools":3,
                "auth_ms":2,"preflight_ms":610,"ttft_ms":980,"total_ms":4120}
```

Grep `[reggie] turn` in the function logs. `preflight_ms` and `ttft_ms` are the two numbers
to watch — a regression in either points at a specific change above rather than "chat feels
slow". Prompt-cache effectiveness is visible per model call in `prompt_runs.cache_read` /
`cache_write` (the gateway's existing trace sink).

## Knobs

- `AUTH_CACHE_TTL_MS` — verified-token cache lifetime, default 300000. Set `0` to disable.
  Tradeoff: on a warm instance a sign-out is honoured up to this late.
- `ANTHROPIC_MODEL_VOICE` / `ANTHROPIC_MODEL_CHEAP` / `ANTHROPIC_MODEL` — existing gateway
  route overrides; voice turns already route to Haiku for time-to-first-token.

## Not done (needs infra facts we don't have here)

- **Function region.** `vercel.json` sets no `regions`, so functions run in Vercel's default
  region. If Supabase lives elsewhere, every DB read in a turn pays a cross-region RTT —
  and a turn makes many. Worth checking the Supabase project region and pinning `regions`
  to match; likely the single largest remaining win if they differ.
- **Cold starts.** `agent-manager` statically pulls in the whole tool catalog, which pulls in
  ~13 handler modules. Lazy-importing a tool's handler at first invoke would cut cold-start
  work, at the cost of some complexity in `_reggie/tools.ts`.
- **`maxDuration`.** Not set for `api/agent-manager.ts`. The 45s turn budget assumes the
  platform allows ~60s; confirm against the plan before relying on it.

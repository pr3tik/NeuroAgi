# FschoolAI — Project Guide

AI-powered student learning platform: a Canvas/LMS-aware tutor, RAG over the student's own
course materials, flashcards + adaptive spaced repetition, study rooms, a collaborative
whiteboard, notifications, and a token/gamification layer.

> This file is auto-loaded by Claude Code. The **Architecture / Conventions** sections are
> durable; the **Current State** section near the bottom is a dated snapshot and may be stale —
> verify against `git log` and the live DB before trusting it.

## Commands

```bash
npm run dev          # Vite dev server on :5173 (api/ runs via dev-proxy plugins — see below)
npm run build        # vite build (use this to catch import/resolve errors)
npm run typecheck    # tsc --noEmit
npm test             # vitest run (tests live in test/)
npm run test:watch   # vitest watch
```

After any non-trivial change, run **typecheck + build + test** before claiming it's done.

## Stack & layout

- **Frontend:** React 18 + Vite SPA, **TypeScript** (migrated from JSX; `allowJs` still on).
  - `src/pages/` — top-level screens (Study, Canvas, Leaderboard, …)
  - `src/components/` — UI (NeuralRing = tutor chat, DocUpload, NotificationPanel, …)
  - `src/context/AppContext.tsx` — global state (user, courses, navMode, study config)
  - `src/api/` — client-side API wrappers (e.g. `canvasSync.ts`); `src/lib/` — pure logic (e.g. `srs.ts`, `chatMessages.ts`)
- **Backend:** Vercel serverless functions in **`api/*.ts`** (one file per endpoint). Several are
  action-routed (`?action=…`) to stay under Vercel's function count limit — e.g. `rag.ts`
  (`ingest|embed|query`), `transcribe.ts` (`sign|start|status`).
- **Data:** Supabase — Postgres + **pgvector** + Storage. Auth is mostly **not** Supabase Auth;
  most tables have **RLS disabled** and are accessed with the anon key (client) / service key (server).

### Dev-proxy pattern (important)

There is **no `vercel dev`**. Instead `vite.config.js` defines a plugin per endpoint
(`ragProxyPlugin`, `transcribeProxyPlugin`, `extractProxyPlugin`, `claudeProxyPlugin`, …) that:
1. injects the needed secret into `process.env` from `.env.local`/`.env` via `loadEnvKey()`, then
2. dynamically `import()`s the real `api/<name>.js` handler.

So when you add an `api/` endpoint that needs a secret in local dev, you must add a matching proxy
plugin (and register it in the `plugins: [...]` array). Env injection must happen **before** the
dynamic import (module-load caveat).

### RAG pipeline

Small-to-big (parent-document) retrieval + hybrid search (pgvector cosine + Postgres full-text)
fused with **Reciprocal Rank Fusion**. Embeddings: **OpenAI `text-embedding-3-small` (1536-d)**
(decided for v1 — see the memory note). `api/extract.ts` does structure-preserving extraction
(PDF/docx/pptx/images/audio/video/YouTube, with OCR fallback for scanned PDFs); `api/rag.ts`
ingests → chunks → embeds (batched) → queries. Large media goes through `api/transcribe.ts`.

**PDF OCR model** (`api/lms-ingest.ts`): Scanned PDFs trigger Claude native OCR via `ANTHROPIC_MODEL_OCR`.
Current default: **Haiku** (`claude-haiku-4-5-20251001`) — fast, cheap (~$0.01/PDF), good for typed/printed docs.
Alternative options (set via env var):
- `claude-sonnet-4-6` — better accuracy on handwriting/sketches/smudged scans (~$0.15/PDF, 3x cost)
- `claude-opus-4-8` — best OCR accuracy (~$15/M tokens, use only for difficult documents)

To change globally: set `ANTHROPIC_MODEL_OCR` in `.env.local` (dev) or Vercel env (prod).
To test a specific model locally: `ANTHROPIC_MODEL_OCR=claude-sonnet-4-6 npm run dev`.

## Conventions & gotchas

- **api/ imports use `.js` extensions** even from `.ts` files (e.g. `import { ingest } from "./rag.js"`)
  — ESM resolution on Vercel/Node. Keep this style.
- **Lenient tsconfig** (`strict: false`, `noImplicitAny: false`). `: any` params are common and fine.
- **RLS-off + key split:** new tables follow the same pattern — `alter table … disable row level
  security;` and rely on the service key server-side. Don't add RLS policies unless asked.
- **PostgREST schema cache:** after a migration adds a table/column, if you hit `PGRST204/PGRST205`,
  run `notify pgrst, 'reload schema';`.
- **`claudeTutor()` returns a `string`** (`data.content ?? ""`), not an object — call sites use the
  return value directly. (This was a real bug source: `(await claudeTutor())?.content` → undefined.)
- **`sanitizeApiMessages()`** (`src/lib/chatMessages.ts`) must wrap message arrays sent to Claude —
  empty/duplicate-role turns poison history.
- **Don't commit or push unless asked.** Branch model: `main` (default), `frontend/dev` (integration),
  feature branches (current: `refactorts`).

## Database migrations

SQL files live at the repo root (`supabase-*.sql`). **You cannot run them from here** — there's no
psql/Supabase CLI or DB connection string, and the REST keys can't run DDL. Run them in the Supabase
dashboard **SQL Editor**. Run `supabase-rag-migration.sql` **before** `supabase-brain-graph-migration.sql`
(the graph references `rag_sections`).

## Env vars

Client (bundled, `VITE_` prefix): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
Server (never `VITE_`): `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `ANTHROPIC_API_KEY` (+ optional
`ANTHROPIC_MODEL`), `GROQ_KEY` (chat + Whisper STT), `OPENAI_API_KEY` (RAG embeddings + OCR),
`ELEVENLABS_API_KEY` (TTS + Scribe transcription), `RESEND_API_KEY` (email/nudges).

---

## Current state — snapshot 2026-06-19 (verify before trusting)

Branch **`refactorts`** was just **rebased onto `origin/frontend/dev` (`2727b04`)**. Build +
typecheck + 27 tests pass. Outstanding:

- **Force-push needed:** history was rewritten (`ahead 31, behind 5` vs `origin/refactorts`) →
  `git push --force-with-lease origin refactorts`.
- **`package-lock.json` is uncommitted** (from `npm install` of `framer-motion`, which frontend/dev
  added) — commit it so fresh checkouts build.
- **Migrations to run** (SQL editor): `supabase-courses-columns-migration.sql`,
  `supabase-srs-migration.sql`, `supabase-transcription-migration.sql`.

### Recent work (this branch, on top of frontend/dev)
- **Transcription switched AssemblyAI → ElevenLabs Scribe** (`api/transcribe.ts`): browser uploads
  to Storage (`media-uploads` bucket) via signed URL; server downloads + transcribes synchronously
  (`scribe_v1`) → ingests into RAG. Sync, so bounded by the function timeout (`maxDuration: 300`) —
  multi-hour files would need Scribe's webhook/async path (poll fallback + `status` action left in place).
- **Adaptive spaced repetition** (`src/lib/srs.ts` SM-2 + `test/srs.test.ts`; `srs_reviews` table):
  Study page shows a "Review N due" session; got-it→good / missed→again reschedules each card.
- **Ingest support** for docx/pptx/images/audio/video/YouTube + auto-OCR for scanned PDFs
  (`api/extract.ts`). YouTube uses the InnerTube ANDROID player (watch-page caption URLs are pot-gated).
- **Manual/past courses** fixes in `src/context/AppContext.tsx` + `src/api/canvasSync.ts`
  (the "+ Add manually" button was removed as broken).

### Known follow-ups
- Manual **assignments** likely have the same `syncCanvasData` overwrite issue manual courses had.
- Brain graph layer (`supabase-brain-graph-migration.sql`) is schema-only — no active feature writes
  to it yet.

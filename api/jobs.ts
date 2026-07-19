// api/jobs.ts — BE-08: the background jobs WORKER.
//
// Scope, per STUDYROOM_ARCHITECTURE.md §2: `claim_job()` and the `jobs` table are already
// LIVE (supabase-studyroom-sprint-migration.sql) and `room-session?action=end` already
// ENQUEUES. Nothing drains the queue — that is this file. There is deliberately no
// `enqueue` action here: end-session owns enqueueing, and a second writer would be a
// second source of idempotency-key truth.
//
// CONTRACT (from the architecture doc):
//   claim_job(array['generate_session_summary',…], 120) → do work
//     → success: status='done',   output_ref = <uuid of the row the job produced>
//     → failure: status='failed', last_error = <msg>, run_after bumped for backoff
//   Quizzes: validateQuizSet() before persisting; exactly five.
//
// DELIVERY GUARANTEE: **at-least-once**. A worker can die after a handler's side effect
// but before the row is settled; the lease expires and the job is re-claimed. Therefore
//
//   >>> EVERY HANDLER MUST BE IDEMPOTENT. <<<
//
// Handlers achieve that by writing through a natural key (upsert on
// session_summaries(session_id,scope,user_id) / quiz_sets(session_id,user_id)), not by
// relying on the job row. `idempotency_key` prevents duplicate ENQUEUE, never duplicate RUN.
//
// The worker only ever claims types it has a handler for (claim_job takes the type array),
// so an unregistered type is never picked up and stranded in 'running'.
import { requireUserOr401 } from "./_auth.js";

const LEASE_SECS   = 120;   // must exceed the slowest handler; an expired lease = crash recovery
const MAX_ATTEMPTS = 3;     // 'dead' on the 3rd failed attempt — claim_job only retries queued|failed
const BATCH        = 5;     // max jobs drained per cron tick (each claim_job call takes one)

// PostgREST over fetch, matching api/room-session.ts. Deliberately NOT supabase-js: these
// tables are RLS-on deny-all, every access is service-key only, and this keeps the worker
// import-safe (no WebSocket at module load on Node 20).
function db() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("Supabase env vars not configured");
  const headers: Record<string, string> = {
    apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json",
  };
  return {
    async rpc(fn: string, args: any) {
      const r = await fetch(`${url}/rest/v1/rpc/${fn}`, {
        method: "POST", headers, body: JSON.stringify(args),
      });
      if (!r.ok) throw new Error(`rpc ${fn} failed (${r.status}): ${(await r.text()).slice(0, 200)}`);
      return (await r.json()) as any[];
    },
    async patch(table: string, query: string, body: any) {
      const r = await fetch(`${url}/rest/v1/${table}?${query}`, {
        method: "PATCH", headers, body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(`patch ${table} failed (${r.status}): ${(await r.text()).slice(0, 200)}`);
    },
  };
}

// ── Handler registry ─────────────────────────────────────────────────────────
// AI-10 (generate_session_summary), AI-11 (generate_quiz) and AI-12
// (propose_brain_update) register here. A handler returns the UUID of the row it
// produced — that becomes jobs.output_ref (a uuid column, not a blob).
export type JobHandler = (payload: any, job: any) => Promise<string | null>;

const HANDLERS: Record<string, JobHandler> = Object.create(null);

export function registerHandler(type: string, fn: JobHandler) { HANDLERS[type] = fn; }
export function registeredTypes(): string[] { return Object.keys(HANDLERS); }
/** Test seam — the registry is module state, so tests must be able to reset it. */
export function _clearHandlers() { for (const k of Object.keys(HANDLERS)) delete HANDLERS[k]; }

/** Exponential backoff before the next attempt: 30s, 60s, 120s. */
export function backoffSecs(attempts: number): number {
  return 30 * Math.pow(2, Math.max(0, attempts - 1));
}

// ── Settle ───────────────────────────────────────────────────────────────────
async function markDone(d: ReturnType<typeof db>, job: any, outputRef: string | null) {
  await d.patch("jobs", `id=eq.${job.id}`, {
    status: "done",
    output_ref: outputRef,          // uuid of the produced row, or null
    last_error: null,
    lease_until: null,
    updated_at: new Date().toISOString(),
  });
}

async function markFailed(d: ReturnType<typeof db>, job: any, err: any, opts: { permanent?: boolean } = {}) {
  const msg = String(err?.message ?? err ?? "unknown error").slice(0, 2000);
  // attempts was already incremented by claim_job, so it reflects THIS attempt.
  const dead = opts.permanent || job.attempts >= MAX_ATTEMPTS;

  await d.patch("jobs", `id=eq.${job.id}`, {
    // 'dead' is terminal; 'failed' is retryable — claim_job picks up status in (queued,failed).
    status: dead ? "dead" : "failed",
    last_error: msg,
    lease_until: null,
    ...(dead ? {} : { run_after: new Date(Date.now() + backoffSecs(job.attempts) * 1000).toISOString() }),
    updated_at: new Date().toISOString(),
  });

  return dead;
}

// ── Run ──────────────────────────────────────────────────────────────────────
/**
 * Drain up to `limit` jobs. claim_job returns ONE job per call, so we loop until it
 * returns nothing or we hit the cap — that keeps a single tick bounded while still
 * making progress on a backlog.
 */
export async function runJobs(limit = BATCH) {
  const types = registeredTypes();
  // No handlers → claim nothing. Prevents picking up work we cannot do and stranding it.
  if (!types.length) return { claimed: 0, results: [] as any[] };

  const d = db();
  const results: any[] = [];

  for (let i = 0; i < limit; i++) {
    const rows = await d.rpc("claim_job", { p_types: types, p_lease_secs: LEASE_SECS });
    const job = rows?.[0];
    if (!job) break;   // queue drained

    const fn = HANDLERS[job.type];
    if (!fn) {
      // Defensive: claim_job was asked only for registered types, so this means the
      // registry changed under us. Permanent — retrying cannot make a handler appear.
      await markFailed(d, job, `no handler registered for type "${job.type}"`, { permanent: true });
      results.push({ id: job.id, type: job.type, outcome: "dead", reason: "no_handler" });
      continue;
    }

    try {
      const outputRef = await fn(job.payload, job);
      await markDone(d, job, outputRef ?? null);
      results.push({ id: job.id, type: job.type, outcome: "done", output_ref: outputRef ?? null });
    } catch (err: any) {
      const dead = await markFailed(d, job, err);
      results.push({
        id: job.id, type: job.type,
        outcome: dead ? "dead" : "failed",
        attempts: job.attempts,
        error: String(err?.message ?? err).slice(0, 200),
      });
    }
  }

  return { claimed: results.length, results };
}

// ── Handler ──────────────────────────────────────────────────────────────────
// Fail closed, matching api/brain-scheduler.ts: this drains handlers that call Claude
// (real money), so an unset CRON_SECRET must never mean "open to the internet".
function cronAuthed(req: any): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers?.authorization ?? req.headers?.["x-cron-secret"];
  return auth === `Bearer ${secret}` || auth === secret;
}

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-cron-secret");
  if (req.method === "OPTIONS") return res.status(204).end();

  const action = req.query?.action;

  try {
    if (action === "run") {
      if (!cronAuthed(req)) return res.status(401).json({ error: "Unauthorized" });
      // Register the session-end handlers before draining. Dynamic import breaks the
      // import cycle (_roomJobs imports registerHandler from here) and keeps this file
      // import-safe. registerRoomJobHandlers() is idempotent, so calling it per tick is fine.
      const { registerRoomJobHandlers } = await import("./_roomJobs.js");
      registerRoomJobHandlers();
      const out = await runJobs(Number(req.query?.limit) || BATCH);
      return res.status(200).json({ ok: true, ...out });
    }

    // Operator visibility: which types can this worker actually drain? Auth'd because it
    // discloses internal job wiring. Cheap — no DB, no model calls.
    if (action === "types") {
      const userId = await requireUserOr401(req, res);
      if (!userId) return;
      return res.status(200).json({ ok: true, types: registeredTypes() });
    }

    return res.status(400).json({ error: "Unknown action. Use ?action=run|types" });
  } catch (err: any) {
    console.error("[jobs] error:", err?.message ?? err);
    return res.status(502).json({ error: err?.message ?? "jobs error" });
  }
}

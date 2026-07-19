// api/_brain/adapter.ts — BR-04 NeuroAGI linkage adapter (one person, one brain, ONE-WAY).
//
// The ONLY two operations room grounding needs against a person's brain (PRD §18.4):
//   brainRead(personId)          → person context, folded for a prompt   [ recall(subject=person_id) ]
//   brainWrite(personId, signal) → derived signal, source-stamped back    [ remember({kind:"signal", source:"fschoolai"}) ]
//
// ── ONE-WAY LINKAGE (BR-01 / §5.4) ─────────────────────────────────────────────
// Person context flows INTO room grounding; derived signals flow back source-stamped "fschoolai".
// There is deliberately NO function in this module that writes person-brain data into course_content
// or any shared space — the ABSENCE is the guarantee (BR-06 asserts it at the service boundary).
// brainWrite ALWAYS targets subject `person:<id>` and ALWAYS stamps source "fschoolai"; neither the
// subject prefix nor the source is caller-overridable, so this module cannot be used to cross the line.
//
// ── TRANSPORT (transitional, injectable, degrading) ────────────────────────────
// Default transport is the LIVE product-DB kernel (public.neuro_memory via recall/remember) — this is
// the path A1 verified and that STUDYROOM_ARCHITECTURE.md §9.5 confirms producers migrated onto. That
// is a deliberate reconciliation of the BR-04 spec, which (pre-A1) named the SEPARATE Brain-DB direct
// schema reads (neuro.persons / brain.signals / brain.context_window) as the transport. The transport
// is INJECTABLE (pass `store`) so Ryan Lin can point it at the live Brain-DB schemas on 20 Jul WITHOUT
// touching any caller. Per spec we do NOT migrate to the v2 REST surface this sprint.
// When the transport is unconfigured or unreachable within the cross-project hop budget, brainRead
// returns EMPTY context and brainWrite no-ops — grounding continues on course material alone
// (graceful degradation; the C1 latency budget is never spent waiting on a down brain).
import {
  recall, remember, renderStudentBrainState, postgrestStore, type Store, type Memory,
} from "./kernel.js";

// Cross-project hop budget (PRD): a brain read/write must not stall a room turn past this.
export const BRAIN_HOP_BUDGET_MS = 600;

export type BrainSignal = {
  /** the signal payload — any JSON. Required. */
  body: any;
  /** memory kind; defaults to "signal" per §18.4. */
  kind?: string;
  /** base importance 0..1; behavioral chatter low, academic events higher. */
  salience?: number;
};

export type BrainContext = {
  personId: string;
  memories: Memory[];
  /** folded "STUDENT BRAIN STATE" block ready to inject into a prompt, or null when empty. */
  brainState: string | null;
  /** true when we could not read a live brain and fell back to empty (grounding must still proceed). */
  degraded: boolean;
};

export type BrainWriteResult = { ok: boolean; degraded: boolean; id?: string };

/**
 * Resolve the default (live) transport from env. Returns null when the product DB is unconfigured —
 * callers then degrade to flat-mock. `undefined` (env unresolved) is distinct from `null` (explicitly
 * no transport) at the call sites so tests can force degradation with `store: null`.
 */
export function resolveBrainStore(): Store | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return postgrestStore(url, key);
}

// Resolve `p` but never wait longer than `ms`; on timeout OR rejection, resolve to `fallback()`.
// The underlying promise may keep running (fine: writes are fire-and-forget, reads are just dropped).
function withBudget<T>(p: Promise<T>, ms: number, fallback: () => T): Promise<T> {
  return new Promise<T>((resolve) => {
    let settled = false;
    const finish = (v: T) => { if (!settled) { settled = true; clearTimeout(timer); resolve(v); } };
    const timer = setTimeout(() => finish(fallback()), ms);
    p.then(finish, () => finish(fallback()));
  });
}

type ReadOpts = { store?: Store | null; limit?: number; hopBudgetMs?: number; kind?: string | string[] };

/**
 * brain.read → recall(subject=`person:<id>`). Read-only for grounding: does NOT reinforce (a room
 * turn / warm pass should not mutate salience). Degrades to empty context on missing transport,
 * timeout, or error — NEVER throws, so a down brain cannot break a room turn.
 */
export async function brainRead(personId: string, opts: ReadOpts = {}): Promise<BrainContext> {
  const empty: BrainContext = { personId, memories: [], brainState: null, degraded: true };
  if (!personId) return empty;
  const store = opts.store !== undefined ? opts.store : resolveBrainStore();
  if (!store) return empty;
  const subject = `person:${personId}`;
  const budget = opts.hopBudgetMs ?? BRAIN_HOP_BUDGET_MS;
  const mems = await withBudget<Memory[] | null>(
    recall(store, [subject], { limit: opts.limit ?? 12, kind: opts.kind, reinforce: false }).catch(() => null),
    budget,
    () => null,
  );
  if (mems == null) return empty;
  return { personId, memories: mems, brainState: renderStudentBrainState(mems), degraded: false };
}

type WriteOpts = { store?: Store | null; hopBudgetMs?: number };

/**
 * brain.write → remember({subject:`person:<id>`, kind:"signal", source:"fschoolai"}). The subject
 * prefix and the source stamp are FIXED here — the one-way linkage audit depends on every derived
 * write being attributable to "fschoolai" and scoped to the person, and on there being no way to
 * redirect it at a shared subject. Degrades to a no-op on missing transport, timeout, or error.
 */
export async function brainWrite(personId: string, signal: BrainSignal, opts: WriteOpts = {}): Promise<BrainWriteResult> {
  const degraded: BrainWriteResult = { ok: false, degraded: true };
  if (!personId || !signal || typeof signal.body === "undefined") return degraded;
  const store = opts.store !== undefined ? opts.store : resolveBrainStore();
  if (!store) return degraded;
  const subject = `person:${personId}`;
  const budget = opts.hopBudgetMs ?? BRAIN_HOP_BUDGET_MS;
  return withBudget<BrainWriteResult>(
    remember(store, {
      subject,
      kind: signal.kind ?? "signal",
      body: signal.body,
      salience: signal.salience ?? 0.4,
      source: "fschoolai", // FIXED — non-overridable source stamp (§5.4)
    }).then((m) => ({ ok: true, degraded: false, id: m.id }), () => degraded),
    budget,
    () => degraded,
  );
}

// api/_brain/kernel.ts
// NeuroAGI kernel — the product-agnostic PARENT brain.
//
// Three ideas, nothing more (the v2 kernel model):
//   1. an append-only `memory` log (one store; every "sub-brain" is just a `subject`),
//   2. deterministic decay — recall reinforces, unused memories fade (no LLM in the loop),
//   3. subject scoping — 'person:<id>' | 'course:<id>' | 'prof:<id>' | 'room:<id>'.
//
// Storage-agnostic via the Store interface: PostgrestStore in prod (raw fetch → PostgREST, so
// this module builds NO supabase-js client at import — safe in the Node-20 test runner, see
// [[ci-node20-supabase-import]]), InMemoryStore in tests. This file has no local imports, so no
// .js-extension caveat applies here.

export const HALF_LIFE_DAYS = 14;
export const DECAY_LAMBDA = Math.LN2 / HALF_LIFE_DAYS; // per-day decay constant
export const FORGET_THRESHOLD = 0.05;                  // effective salience below this → forgotten

export type Memory = {
  id: string;
  subject: string;
  kind: string;
  body: any;
  salience: number;
  audience: string[];
  source: string | null;
  happened_at: string;
  last_seen_at: string;
  forgotten_at: string | null;
  created_at: string;
};

export type NewMemory = {
  subject: string;
  kind: string;
  body?: any;
  salience?: number;
  audience?: string[];
  source?: string | null;
  happened_at?: string;
};

export interface Store {
  insert(row: NewMemory & { now: string }): Promise<Memory>;
  /** live (non-forgotten) memories whose subject ∈ subjects, optionally filtered by kind */
  bySubjects(subjects: string[], kinds?: string[], limit?: number): Promise<Memory[]>;
  touch(ids: string[], now: string): Promise<void>;   // reinforce: bump last_seen_at
  forget(ids: string[], now: string): Promise<void>;  // soft-forget
  reinforce(id: string, now: string, boost?: number): Promise<void>;
}

function clamp01(n: number) { return Math.max(0, Math.min(1, Number.isFinite(n) ? n : 1)); }

// Identifiers safe to interpolate into a PostgREST in.() quoted list (subjects, kinds, ids).
// Anything outside this set (a quote, comma, paren, backslash, whitespace) is REJECTED rather than
// silently stripped — stripping made a '"'-bearing subject match a different, quote-free subject
// (a cross-subject collision). Our subjects (person:/course:/prof:/room: + uuid/code ids), kinds,
// and uuids all satisfy this.
const IDENT_RE = /^[A-Za-z0-9:._-]+$/;
export function isValidSubject(s: unknown): boolean { return typeof s === "string" && IDENT_RE.test(s); }
function assertIdent(s: string, what: string): string {
  if (!isValidSubject(s)) throw new Error(`neuro: invalid ${what} ${JSON.stringify(s)} (allowed chars: A-Za-z0-9:._-)`);
  return s;
}

/**
 * Fold recalled memories into a compact "STUDENT BRAIN STATE" block for a prompt. Pure function
 * over recall output (a derived layer) — returns null when there's nothing worth injecting.
 */
export function renderStudentBrainState(mems: Memory[]): string | null {
  if (!mems?.length) return null;
  const digest = mems.find((m) => m.kind === "digest");
  const traits = mems.filter((m) => m.kind === "trait" || m.kind === "focus");
  const signals = mems.filter((m) => m.kind === "signal");
  const lines: string[] = [];
  if (digest?.body?.summary) lines.push(`Living mind: ${String(digest.body.summary).slice(0, 500)}`);
  for (const t of traits) {
    const v = t.body?.text ?? t.body?.value ?? t.body?.label;
    if (v) lines.push(`${t.kind}: ${v}`);
  }
  const tones = signals.map((s) => s.body?.emotional_tone).filter(Boolean);
  const events = signals.map((s) => s.body?.event).filter(Boolean);
  if (tones.length) lines.push(`recent tone: ${[...new Set(tones)].slice(0, 3).join(", ")}`);
  if (events.length) lines.push(`recent: ${[...new Set(events)].slice(0, 3).join(", ")}`);
  return lines.length ? `STUDENT BRAIN STATE (NeuroAGI):\n${lines.join(" | ")}` : null;
}

/** Deterministic forgetting: effective(m,t) = salience × exp(-λ · days since last recall). */
export function effective(m: Pick<Memory, "salience" | "last_seen_at">, nowMs: number): number {
  const days = Math.max(0, (nowMs - Date.parse(m.last_seen_at)) / 86_400_000);
  return m.salience * Math.exp(-DECAY_LAMBDA * days);
}

export type RecallOpts = {
  kind?: string | string[];
  limit?: number;
  now?: number;
  threshold?: number;
  reinforce?: boolean; // default true — recall strengthens what it returns
};

/**
 * Read back what's still "alive" for these scopes, strongest first. Recall reinforces
 * (use-it-or-lose-it): returned memories get last_seen_at bumped unless reinforce:false.
 */
export async function recall(store: Store, scopes: string[], opts: RecallOpts = {}): Promise<Memory[]> {
  const nowMs = opts.now ?? Date.now();
  const threshold = opts.threshold ?? FORGET_THRESHOLD;
  const kinds = opts.kind == null ? undefined : Array.isArray(opts.kind) ? opts.kind : [opts.kind];
  scopes.forEach((s) => assertIdent(s, "subject"));
  // Fetch at least the requested limit (floor 2000) so the top-N slice below — and the ownership
  // set built in api/brain.ts via recall({limit:N}) — reflect the full owned set, not a 2000 cap.
  const rows = await store.bySubjects(scopes, kinds, Math.max(opts.limit ?? 0, 2000));
  const scored = rows
    .map((m) => ({ m, e: effective(m, nowMs) }))
    .filter((x) => x.e >= threshold)
    .sort((a, b) => b.e - a.e);
  const limited = opts.limit ? scored.slice(0, opts.limit) : scored;
  if (opts.reinforce !== false && limited.length) {
    await store.touch(limited.map((x) => x.m.id), new Date(nowMs).toISOString());
  }
  return limited.map((x) => x.m);
}

/** Store any information as one memory. */
export async function remember(store: Store, m: NewMemory, nowMs = Date.now()): Promise<Memory> {
  assertIdent(m.subject, "subject");
  return store.insert({
    subject: m.subject,
    kind: m.kind,
    body: m.body ?? {},
    salience: clamp01(m.salience ?? 1),
    audience: m.audience ?? [],
    source: m.source ?? null,
    happened_at: m.happened_at,
    now: new Date(nowMs).toISOString(),
  });
}

export async function forget(store: Store, ids: string[], nowMs = Date.now()): Promise<void> {
  if (ids.length) await store.forget(ids, new Date(nowMs).toISOString());
}

export async function reinforce(store: Store, id: string, nowMs = Date.now(), boost = 0): Promise<void> {
  await store.reinforce(id, new Date(nowMs).toISOString(), boost);
}

/**
 * Decay sweep for the given scopes: soft-forget everything whose effective salience has fallen
 * below the threshold. Returns the forgotten ids. Fine at personal scale (fetch + score in app);
 * a set-based SQL sweep can replace this for large shared scopes later.
 */
export async function tickDecay(store: Store, scopes: string[], nowMs = Date.now()): Promise<string[]> {
  scopes.forEach((s) => assertIdent(s, "subject"));
  const rows = await store.bySubjects(scopes);
  const dead = rows.filter((m) => effective(m, nowMs) < FORGET_THRESHOLD).map((m) => m.id);
  if (dead.length) await store.forget(dead, new Date(nowMs).toISOString());
  return dead;
}

// ─────────────────────────────────────────────────────────────────────────────
// InMemoryStore — zero-dependency store for tests and quick local runs.
// ─────────────────────────────────────────────────────────────────────────────
export class InMemoryStore implements Store {
  rows: Memory[] = [];
  private seq = 0;

  async insert(r: NewMemory & { now: string }): Promise<Memory> {
    const m: Memory = {
      id: `m${++this.seq}`,
      subject: r.subject,
      kind: r.kind,
      body: r.body ?? {},
      salience: r.salience ?? 1,
      audience: r.audience ?? [],
      source: r.source ?? null,
      happened_at: r.happened_at ?? r.now,
      last_seen_at: r.now,
      forgotten_at: null,
      created_at: r.now,
    };
    this.rows.push(m);
    return { ...m };
  }
  async bySubjects(subjects: string[], kinds?: string[], _limit?: number): Promise<Memory[]> {
    const s = new Set(subjects);
    return this.rows
      .filter((m) => !m.forgotten_at && s.has(m.subject) && (!kinds || kinds.includes(m.kind)))
      .map((m) => ({ ...m }));
  }
  async touch(ids: string[], now: string): Promise<void> {
    const s = new Set(ids);
    for (const m of this.rows) if (s.has(m.id)) m.last_seen_at = now;
  }
  async forget(ids: string[], now: string): Promise<void> {
    const s = new Set(ids);
    for (const m of this.rows) if (s.has(m.id)) m.forgotten_at = now;
  }
  async reinforce(id: string, now: string, boost = 0): Promise<void> {
    const m = this.rows.find((x) => x.id === id);
    if (m) { m.last_seen_at = now; m.salience = clamp01(m.salience + boost); }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PostgrestStore — the production store. Raw fetch to PostgREST with the service key
// (bypasses RLS); no supabase-js client is constructed, so importing this file never
// crashes the Node-20 test runner.
// ─────────────────────────────────────────────────────────────────────────────
export function postgrestStore(url: string, key: string): Store {
  const base = `${url.replace(/\/+$/, "")}/rest/v1/neuro_memory`;
  const headers = (extra?: Record<string, string>) => ({
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    ...(extra || {}),
  });
  // PostgREST in.() list of quoted values. Each value is VALIDATED (not stripped): a stray quote
  // used to be removed, which made a '"'-bearing subject match a different quote-free subject
  // (a cross-subject collision). assertIdent rejects unsafe identifiers loudly instead.
  const inList = (vals: string[]) => encodeURIComponent(vals.map((v) => `"${assertIdent(String(v), "identifier")}"`).join(","));

  async function patchIds(ids: string[], patch: Record<string, any>): Promise<void> {
    if (!ids.length) return;
    const res = await fetch(`${base}?id=in.(${inList(ids)})`, {
      method: "PATCH",
      headers: headers({ Prefer: "return=minimal" }),
      body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error(`neuro patch ${res.status}: ${await res.text().catch(() => "")}`);
  }

  return {
    async insert(r) {
      const res = await fetch(base, {
        method: "POST",
        headers: headers({ Prefer: "return=representation" }),
        body: JSON.stringify({
          subject: r.subject,
          kind: r.kind,
          body: r.body ?? {},
          salience: r.salience ?? 1,
          audience: r.audience ?? [],
          source: r.source ?? null,
          happened_at: r.happened_at ?? r.now,
          last_seen_at: r.now,
          created_at: r.now,
        }),
      });
      if (!res.ok) throw new Error(`neuro insert ${res.status}: ${await res.text().catch(() => "")}`);
      const rows = await res.json();
      return Array.isArray(rows) ? rows[0] : rows;
    },
    async bySubjects(subjects, kinds, limit) {
      if (!subjects.length) return [];
      let q = `${base}?forgotten_at=is.null&subject=in.(${inList(subjects)})&select=*&limit=${Math.max(1, limit ?? 2000)}`;
      if (kinds && kinds.length) q += `&kind=in.(${inList(kinds)})`;
      const res = await fetch(q, { headers: headers() });
      if (!res.ok) throw new Error(`neuro recall ${res.status}: ${await res.text().catch(() => "")}`);
      return await res.json();
    },
    async touch(ids, now) { await patchIds(ids, { last_seen_at: now }); },
    async forget(ids, now) { await patchIds(ids, { forgotten_at: now }); },
    async reinforce(id, now, boost = 0) {
      if (!boost) { await patchIds([id], { last_seen_at: now }); return; }
      // Read-modify-write the salience so re-observed hypotheses/traits actually STRENGTHEN in prod
      // (InMemoryStore applies the boost directly; this keeps the real store in parity). Not fully
      // atomic under concurrent boosts of the same id — acceptable for the per-person reflection
      // passes that call it; a SQL RPC can make it atomic if that ever changes.
      const res = await fetch(`${base}?id=in.(${inList([id])})&select=salience`, { headers: headers() });
      if (!res.ok) throw new Error(`neuro reinforce read ${res.status}: ${await res.text().catch(() => "")}`);
      const rows = await res.json();
      const cur = Array.isArray(rows) && rows[0] ? Number(rows[0].salience) : 1;
      await patchIds([id], { last_seen_at: now, salience: clamp01(cur + boost) });
    },
  };
}

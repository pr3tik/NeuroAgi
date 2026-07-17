// api/_brain/bus.ts — the NeuroAGI capability bus.
//
// Bidirectional by design:
//   invoke  (brain -> agent) — the brain calls a registered capability to DO something,
//   ingest  (agent -> brain) — an agent feeds a memory back (sugar over remember()).
// Capabilities live in neuro_capability: 'local' handlers run in-process; 'http' capabilities
// expose POST {endpoint}/invoke {action,args}; 'mcp' is reserved. Raw fetch, no supabase-js at load.

import { remember, type Store } from "./kernel.js";

export type LocalHandler = (action: string, args: any) => Promise<any> | any;
const localHandlers = new Map<string, LocalHandler>();

/** Register an in-process capability (survives only for the current runtime). */
export function registerLocal(name: string, handler: LocalHandler): void {
  localHandlers.set(name, handler);
}
/** Test/reset hook. */
export function _clearLocal(): void { localHandlers.clear(); }

type Conn = { url: string; key: string };
const h = (key: string, extra?: Record<string, string>) => ({ apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(extra || {}) });
const rest = (url: string) => url.replace(/\/+$/, "") + "/rest/v1";

/** Persist (or update) an http/mcp capability in the registry. Idempotent by name. */
export async function registerCapability(
  { url, key }: Conn,
  cap: { name: string; kind?: string; endpoint?: string | null; manifest?: any; enabled?: boolean },
): Promise<void> {
  const res = await fetch(`${rest(url)}/neuro_capability`, {
    method: "POST",
    headers: h(key, { Prefer: "resolution=merge-duplicates,return=minimal" }),
    body: JSON.stringify({
      name: cap.name,
      kind: cap.kind ?? "http",
      endpoint: cap.endpoint ?? null,
      manifest: cap.manifest ?? {},
      enabled: cap.enabled ?? true,
      updated_at: new Date().toISOString(),
    }),
  });
  if (!res.ok) throw new Error(`registerCapability ${res.status}: ${await res.text().catch(() => "")}`);
}

export async function getCapability({ url, key }: Conn, name: string): Promise<any | null> {
  const r = await fetch(`${rest(url)}/neuro_capability?name=eq.${encodeURIComponent(name)}&enabled=eq.true&select=*&limit=1`, { headers: h(key) });
  if (!r.ok) return null;
  const rows = await r.json();
  return rows?.[0] ?? null;
}

export async function listCapabilities({ url, key }: Conn): Promise<any[]> {
  const r = await fetch(`${rest(url)}/neuro_capability?enabled=eq.true&select=name,kind,manifest`, { headers: h(key) });
  return r.ok ? await r.json() : [];
}

/**
 * Brain -> agent. Local handlers run in-process (checked first, no DB hit). Otherwise the named
 * http capability is loaded from the registry and called at POST {endpoint}/invoke {action,args},
 * forwarding an optional caller token. Throws on an unknown/unsupported capability.
 */
export async function invoke(conn: Conn, name: string, action: string, args: any = {}, opts: { authToken?: string } = {}): Promise<any> {
  const local = localHandlers.get(name);
  if (local) return local(action, args);

  const cap = await getCapability(conn, name);
  if (!cap) throw new Error(`unknown capability: ${name}`);
  if (cap.kind === "http") {
    if (!cap.endpoint) throw new Error(`capability ${name} has no endpoint`);
    const res = await fetch(`${String(cap.endpoint).replace(/\/+$/, "")}/invoke`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(opts.authToken ? { Authorization: `Bearer ${opts.authToken}` } : {}) },
      body: JSON.stringify({ action, args }),
    });
    if (!res.ok) throw new Error(`invoke ${name} ${res.status}`);
    return res.json().catch(() => ({}));
  }
  throw new Error(`unsupported capability kind: ${cap.kind}`);
}

/** Agent -> brain. Sugar over remember() so an agent can feed a memory back onto a subject. */
export async function ingest(store: Store, subject: string, kind: string, body: any, opts: { salience?: number; source?: string } = {}) {
  return remember(store, { subject, kind, body, salience: opts.salience, source: opts.source ?? "agent" });
}

// scripts/rls-verify-studyroom.mjs — QA-02: prove the 17 Study Room sprint tables are
// server-only for CLIENT keys. Every new table is RLS-ON with zero client policies AND has
// its privileges REVOKED from anon/authenticated (see supabase-studyroom-sprint-migration.sql
// section 11), so the ANON key must not be able to read or write any of them, and the two
// server-only functions (rag_room_search, claim_job) must be unreachable with the anon key.
//
// Read-only + deliberately-failing probes — safe to run against prod.
//   node scripts/rls-verify-studyroom.mjs
// Exit code 0 iff every check passes. Secrets are never printed.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// ── env ────────────────────────────────────────────────────────────────────────────────
const ENV_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "../.env.local");
function loadEnv(path) {
  const out = {};
  let text = "";
  try { text = readFileSync(path, "utf8"); } catch { return out; }
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}
const ENV = loadEnv(ENV_PATH);
const SUPABASE_URL = ENV.SUPABASE_URL || ENV.VITE_SUPABASE_URL;
const ANON_KEY = ENV.VITE_SUPABASE_ANON_KEY || ENV.SUPABASE_ANON_KEY;
if (!SUPABASE_URL || !ANON_KEY) {
  console.error(`Missing SUPABASE_URL / VITE_SUPABASE_ANON_KEY in ${ENV_PATH}`);
  process.exit(1);
}
const REST = `${SUPABASE_URL.replace(/\/$/, "")}/rest/v1`;

// ANON-only headers (this is the browser/client identity — the untrusted side).
const anonHeaders = (extra = {}) => ({
  apikey: ANON_KEY,
  Authorization: `Bearer ${ANON_KEY}`,
  ...extra,
});

async function req(method, pathAndQuery, { body = null, prefer = "" } = {}) {
  const headers = anonHeaders({ "Content-Type": "application/json" });
  if (prefer) headers.Prefer = prefer;
  try {
    const res = await fetch(`${REST}/${pathAndQuery}`, {
      method, headers, body: body != null ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
    return { status: res.status, json, text };
  } catch (e) {
    // A network/DNS failure is not a proof of denial — surface it as a non-pass.
    return { status: -1, json: null, text: String(e?.message || e) };
  }
}

const TABLES = [
  "room_configs", "room_sources", "room_ai_sessions", "whiteboard_snapshots",
  "private_threads", "private_messages",
  "student_brains", "brain_versions", "brain_update_proposals", "room_brain_snapshots",
  "activity_events", "participant_metrics", "intervention_events",
  "session_summaries", "quiz_sets", "jobs", "prompt_runs",
];

// A table is locked down iff, with the anon key:
//   (a) SELECT is refused (>= 400), OR
//   (b) SELECT returns 200 [] (policy-suppressed) AND a probe INSERT is also refused (>= 400).
// Case (b) guards against a table that *reads* empty but would still accept anon writes.
async function checkTable(t) {
  const get = await req("GET", `${t}?select=*&limit=1`);
  if (get.status >= 400) {
    return { name: t, ok: true, detail: `GET ${get.status} (denied)` };
  }
  if (get.status === 200 && Array.isArray(get.json) && get.json.length === 0) {
    const ins = await req("POST", t, { body: {}, prefer: "return=minimal" });
    if (ins.status >= 400) {
      return { name: t, ok: true, detail: `GET 200 [] + INSERT ${ins.status} (denied)` };
    }
    return { name: t, ok: false, detail: `GET 200 [] but INSERT ${ins.status} — WRITABLE by anon!` };
  }
  const rows = Array.isArray(get.json) ? get.json.length : "?";
  return { name: t, ok: false, detail: `GET ${get.status} rows=${rows} — READABLE by anon!` };
}

// Server-only RPCs must be unreachable with the anon key (execute REVOKEd from anon).
async function checkRpc(fn, args) {
  const r = await req("POST", `rpc/${fn}`, { body: args });
  if (r.status >= 400) return { name: `rpc/${fn}`, ok: true, detail: `POST ${r.status} (denied)` };
  return { name: `rpc/${fn}`, ok: false, detail: `POST ${r.status} — CALLABLE by anon!` };
}

(async () => {
  const results = [];
  for (const t of TABLES) results.push(await checkTable(t));
  results.push(await checkRpc("rag_room_search", {
    p_document_ids: ["1f1cd0c0-0000-4000-8000-000000000001"],
    p_query_embedding: null, p_query_text: "zfix", p_match_count: 1,
  }));
  results.push(await checkRpc("claim_job", { p_types: ["zfix_never"], p_lease_secs: 1 }));

  const nameWidth = Math.max(...results.map(r => r.name.length));
  console.log("\nStudy Room RLS lockdown check (ANON key) — expecting every probe to be DENIED\n");
  for (const r of results) {
    console.log(`  ${r.ok ? "✓" : "✗"}  ${r.name.padEnd(nameWidth)}  ${r.detail}`);
  }
  const failed = results.filter(r => !r.ok);
  console.log(`\n${failed.length === 0 ? "✓ ALL PASS" : `✗ ${failed.length} FAILED`} — ${results.length} probes total\n`);
  process.exit(failed.length === 0 ? 0 : 1);
})().catch(err => {
  console.error("VERIFY ERROR:", err?.message || err);
  process.exit(1);
});

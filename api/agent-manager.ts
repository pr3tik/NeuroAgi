// api/agent-manager.ts — Reggie's front door (the single product contract), matching the
// FschoolAI_v2 `POST /api/agent-manager` shape so this is swap-compatible with the Python
// backend later. Reggie is ONE router + tool-use loop (PRD §19.9): classify the message
// into a scoped specialist (prompt + tool subset), then run the tool-use loop over the
// real api/* tools, grounded in the student's live brain context (§18 / tutor-context).
//
// Blocking by default: returns the final answer + a tool-call trace. (Streaming SSE via
// {stream:true} is a follow-up — loop.ts already emits events for it; the dev-proxy res
// shim can't stream today, so it's wired at the HTTP edge later.)
import { classifyIntent, hintToRoute } from "./_reggie/router.js";
import { SPECIALISTS, ROUTES } from "./_reggie/specialists.js";
import { runReggie, runReggieStream } from "./_reggie/loop.js";
import tutorContext from "./tutor-context.js";
import { callApi } from "./_reggie/callApi.js";
import { requireUserOr401 } from "./_auth.js";
import { randomUUID } from "crypto";
import { createClient } from "@supabase/supabase-js";
import type { ToolCallTrace } from "./_reggie/loop.js";

// ── Turn observability ("search tag") ─────────────────────────────────────────
// Every Reggie turn gets a traceId; the tools it called + the documents its answers
// drew from are (a) returned to the client as `sources` for display, and (b) persisted
// to prompt_runs — task "reggie_turn" — so any answer can be looked up later by its
// traceId (GET ?traceId=…). Per the tracesink threat model, NO prompt/response/passage
// TEXT is persisted: tool names, source titles/locators, and counters only.
let _obsClient: any = null;
function obs() {
  if (_obsClient !== null) return _obsClient || null;
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) { _obsClient = false; return null; }
  try { _obsClient = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }); }
  catch { _obsClient = false; return null; }
  return _obsClient || null;
}

function deriveSources(trace: ToolCallTrace[]) {
  const seen = new Set<string>();
  const out: { title: string; heading?: string | null; loc?: string | null }[] = [];
  for (const t of trace) {
    for (const s of t.sources ?? []) {
      const k = `${s.title}|${s.loc ?? ""}`;
      if (!seen.has(k)) { seen.add(k); out.push(s); }
      if (out.length >= 8) return out;
    }
  }
  return out;
}

/** Fire-and-forget turn log. Must never throw or block the response. */
function logReggieTurn(row: {
  traceId: string; userId: string; route: string; status: "ok" | "error";
  latencyMs: number; steps?: number; budgetExhausted?: boolean;
  trace?: ToolCallTrace[]; sources?: any[]; error?: string;
}) {
  try {
    const c = obs(); if (!c) return;
    c.from("prompt_runs").insert({
      trace_id: row.traceId, task: "reggie_turn", scope: "tutor",
      user_id: row.userId.slice(0, 128), status: row.status,
      latency_ms: Math.round(row.latencyMs),
      error: row.error?.slice(0, 300) ?? null,
      metadata: {
        route: row.route, steps: row.steps ?? null, budget_exhausted: row.budgetExhausted ?? null,
        tools: (row.trace ?? []).map(t => ({ name: t.name, ok: t.ok })),
        sources: row.sources ?? [],
      },
    }).then(() => {}, (e: any) => console.error("[agent-manager] turn log failed:", e?.message));
  } catch { /* observability must never break a turn */ }
}

export default async function handler(req: any, res: any) {
  res.setHeader?.("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();

  // ── Trace lookup (debug): GET ?traceId=… → that turn's persisted log. Caller must be
  //    authed and may only read their OWN traces.
  if (req.method === "GET") {
    const traceId = String(req.query?.traceId ?? "").trim();
    if (!traceId) return res.status(400).json({ error: "traceId is required" });
    const uid = await requireUserOr401(req, res); if (!uid) return;
    const c = obs(); if (!c) return res.status(503).json({ error: "trace store unavailable" });
    const { data, error } = await c.from("prompt_runs")
      .select("trace_id, ts, task, scope, status, latency_ms, error, metadata")
      .eq("trace_id", traceId).eq("user_id", uid)
      .order("ts", { ascending: true }).limit(20);
    if (error) return res.status(502).json({ error: error.message });
    if (!data?.length) return res.status(404).json({ error: "no trace found (wrong id, or not your turn)" });
    return res.status(200).json({ ok: true, runs: data });
  }

  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  let {
    action = "ask", userId, message,
    courseId = null, assignmentId = null, brainPersonId = null, hint = null,
    history = [], voiceMode = false,
  } = req.body ?? {};
  const wantStream = !!(req.body?.stream || req.query?.stream);

  if (!message || !String(message).trim()) return res.status(400).json({ error: "message is required" });
  // Verify the caller's session and use the verified profile id — never trust body.userId (it
  // drove Reggie's tools + brain reads/writes for that user with the service key). The verified
  // id then flows to every in-process tool call as the trusted internal identity.
  const _authed = await requireUserOr401(req, res); if (!_authed) return;
  userId = _authed;

  const traceId = randomUUID();       // this turn's identity — returned to the client + persisted
  const turnStart = Date.now();

  // 1. Brain context — best-effort; never blocks the turn (tutor-context returns
  //    {context:null} when the brain env / person link is absent).
  let brainContext: string | null = null;
  try {
    const { body } = await callApi(tutorContext, {
      body: { userId, userMessage: message, brainPersonId, activeCourseId: courseId },
      internalUserId: userId,
    });
    brainContext = body?.context ?? null;
  } catch { /* brain is optional */ }

  // 2. Route — an explicit product action maps straight to a specialist; free-form
  //    "ask" is classified.
  let route: string;
  if (action && action !== "ask") route = hintToRoute(action) ?? "tutor";
  else route = await classifyIntent(message, ROUTES, hint);
  const specialist = SPECIALISTS[route] ?? SPECIALISTS.tutor;

  const hist = Array.isArray(history) ? history : [];

  // Public origin of THIS request — forwarded to tools whose handlers self-call other
  // endpoints via the host header (writing-tracker -> /api/claude). Falls back to prod.
  const oHost = String(req.headers?.["x-forwarded-host"] || req.headers?.host || "fschoolai.com");
  const oProto = String(req.headers?.["x-forwarded-proto"] || (/^(localhost|127\.)/i.test(oHost) ? "http" : "https"));
  const origin = { host: oHost, proto: oProto };

  // 3a. Streaming (SSE): stream tokens + tool-call progress as the loop runs.
  if (wantStream) {
    res.statusCode = 200;
    res.setHeader?.("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader?.("Cache-Control", "no-cache, no-transform");
    res.setHeader?.("Connection", "keep-alive");
    res.setHeader?.("X-Accel-Buffering", "no");        // disable proxy buffering (nginx/vercel)
    res.flushHeaders?.();
    const send = (event: string, data: any) => {
      try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch { /* client gone */ }
    };
    try {
      const result = await runReggieStream({
        specialist, userMessage: message, brainContext, history: hist, voiceMode: !!voiceMode,
        ctx: { userId, courseId, assignmentId, origin },
        emit: (e) => { if (e.type !== "final") send(e.type, e); },   // `final` is superseded by `done`
      });
      const sources = deriveSources(result.trace);
      send("done", {
        ok: true, route: result.route, output: result.output, toolCalls: result.trace,
        widgets: result.widgets ?? [],
        steps: result.steps, budgetExhausted: result.budgetExhausted, brainContextUsed: !!brainContext,
        traceId, sources,
      });
      logReggieTurn({ traceId, userId, route: result.route, status: "ok", latencyMs: Date.now() - turnStart,
        steps: result.steps, budgetExhausted: result.budgetExhausted, trace: result.trace, sources });
    } catch (e: any) {
      send("error", { error: e?.message ?? "Reggie failed", traceId });
      logReggieTurn({ traceId, userId, route: route ?? "unknown", status: "error", latencyMs: Date.now() - turnStart, error: e?.message });
    } finally {
      try { res.end(); } catch { /* already closed */ }
    }
    return;
  }

  // 3b. Blocking: return the final answer + tool-call trace as one JSON body.
  try {
    const result = await runReggie({
      specialist, userMessage: message, brainContext, history: hist, voiceMode: !!voiceMode,
      ctx: { userId, courseId, assignmentId, origin },
    });
    const sources = deriveSources(result.trace);
    logReggieTurn({ traceId, userId, route: result.route, status: "ok", latencyMs: Date.now() - turnStart,
      steps: result.steps, budgetExhausted: result.budgetExhausted, trace: result.trace, sources });
    return res.status(200).json({
      ok: true,
      route: result.route,
      output: result.output,
      toolCalls: result.trace,
      widgets: result.widgets ?? [],
      steps: result.steps,
      budgetExhausted: result.budgetExhausted,
      brainContextUsed: !!brainContext,
      traceId, sources,
    });
  } catch (e: any) {
    logReggieTurn({ traceId, userId, route: route ?? "unknown", status: "error", latencyMs: Date.now() - turnStart, error: e?.message });
    return res.status(502).json({ error: e?.message ?? "Reggie failed", traceId });
  }
}

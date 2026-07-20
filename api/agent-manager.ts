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

// One structured line per turn, breaking the wall clock into the segments that actually
// move: auth, preflight (brain context ‖ routing), time-to-first-token, and the tail. This
// is how a latency regression gets attributed instead of guessed at — grep `[reggie] turn`
// in the function logs, or aggregate ttft_ms by route.
function logTurn(fields: Record<string, any>) {
  try { console.log("[reggie] turn", JSON.stringify(fields)); } catch { /* never break a turn */ }
}

export default async function handler(req: any, res: any) {
  const t0 = Date.now();
  res.setHeader?.("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();
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
  const tAuth = Date.now();

  const hist = Array.isArray(history) ? history : [];

  // ── Open the SSE response BEFORE the preflight. Auth has passed, so nothing after this
  // point needs to answer with a JSON status code, and the client's first read (plus the
  // proxy's decision not to buffer) no longer waits on brain context + routing. The `open`
  // frame is a no-op for the client dispatcher — its job is to push bytes through any
  // intermediary immediately so the connection is live while the preflight runs.
  let send: ((event: string, data: any) => void) | null = null;
  if (wantStream) {
    res.statusCode = 200;
    res.setHeader?.("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader?.("Cache-Control", "no-cache, no-transform");
    res.setHeader?.("Connection", "keep-alive");
    res.setHeader?.("X-Accel-Buffering", "no");        // disable proxy buffering (nginx/vercel)
    res.flushHeaders?.();
    send = (event: string, data: any) => {
      try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch { /* client gone */ }
    };
    send("open", { ok: true });
  }

  // ── Preflight: brain context and routing are INDEPENDENT, so they run concurrently.
  // Both were awaited in series before, and each is a network round trip (tutor-context
  // does a Haiku classify + DB reads; classifyIntent may do a Haiku classify) — serially
  // that is a full second of dead air before the model is even asked to start. Neither
  // needs the other's result, so the preflight now costs max(a, b) instead of a + b.

  // 1. Brain context — best-effort; never blocks the turn (tutor-context returns
  //    {context:null} when the brain env / person link is absent).
  const brainContextP: Promise<string | null> = callApi(tutorContext, {
    body: { userId, userMessage: message, brainPersonId, activeCourseId: courseId },
    internalUserId: userId,
  }).then((r) => r.body?.context ?? null).catch(() => null);   // brain is optional

  // 2. Route — an explicit product action maps straight to a specialist; free-form
  //    "ask" is classified. An explicit action resolves synchronously (no model call).
  const routeP: Promise<string> = (action && action !== "ask")
    ? Promise.resolve(hintToRoute(action) ?? "tutor")
    : classifyIntent(message, ROUTES, hint).catch(() => "tutor");

  const [brainContext, route] = await Promise.all([brainContextP, routeP]);
  const specialist = SPECIALISTS[route] ?? SPECIALISTS.tutor;
  const tPreflight = Date.now();

  // Public origin of THIS request — forwarded to tools whose handlers self-call other
  // endpoints via the host header (writing-tracker -> /api/claude). Falls back to prod.
  const oHost = String(req.headers?.["x-forwarded-host"] || req.headers?.host || "fschoolai.com");
  const oProto = String(req.headers?.["x-forwarded-proto"] || (/^(localhost|127\.)/i.test(oHost) ? "http" : "https"));
  const origin = { host: oHost, proto: oProto };

  // 3a. Streaming (SSE): stream tokens + tool-call progress as the loop runs. Headers are
  // already flushed (above) — this just drives the loop over the open connection.
  if (send) {
    const sse = send;   // captured non-null binding for the closures below
    let tFirstToken = 0;
    try {
      const result = await runReggieStream({
        specialist, userMessage: message, brainContext, history: hist, voiceMode: !!voiceMode,
        ctx: { userId, courseId, assignmentId, origin },
        emit: (e) => {
          if (e.type === "token" && !tFirstToken) tFirstToken = Date.now();
          if (e.type !== "final") sse(e.type, e);   // `final` is superseded by `done`
        },
      });
      sse("done", {
        ok: true, route: result.route, output: result.output, toolCalls: result.trace,
        widgets: result.widgets ?? [],
        steps: result.steps, budgetExhausted: result.budgetExhausted, brainContextUsed: !!brainContext,
      });
      logTurn({
        route: result.route, streamed: true, ok: true, steps: result.steps, tools: result.trace.length,
        auth_ms: tAuth - t0, preflight_ms: tPreflight - tAuth,
        ttft_ms: tFirstToken ? tFirstToken - t0 : null, total_ms: Date.now() - t0,
        budget_exhausted: result.budgetExhausted,
      });
    } catch (e: any) {
      sse("error", { error: e?.message ?? "Reggie failed" });
      logTurn({ route, streamed: true, ok: false, auth_ms: tAuth - t0, preflight_ms: tPreflight - tAuth, total_ms: Date.now() - t0, error: e?.message });
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
    logTurn({
      route: result.route, streamed: false, ok: true, steps: result.steps, tools: result.trace.length,
      auth_ms: tAuth - t0, preflight_ms: tPreflight - tAuth, ttft_ms: null, total_ms: Date.now() - t0,
      budget_exhausted: result.budgetExhausted,
    });
    return res.status(200).json({
      ok: true,
      route: result.route,
      output: result.output,
      toolCalls: result.trace,
      widgets: result.widgets ?? [],
      steps: result.steps,
      budgetExhausted: result.budgetExhausted,
      brainContextUsed: !!brainContext,
    });
  } catch (e: any) {
    logTurn({ route, streamed: false, ok: false, auth_ms: tAuth - t0, preflight_ms: tPreflight - tAuth, total_ms: Date.now() - t0, error: e?.message });
    return res.status(502).json({ error: e?.message ?? "Reggie failed" });
  }
}

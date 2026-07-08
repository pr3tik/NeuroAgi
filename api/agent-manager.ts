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

export default async function handler(req: any, res: any) {
  res.setHeader?.("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const {
    action = "ask", userId, message,
    courseId = null, assignmentId = null, brainPersonId = null, hint = null,
    history = [],
  } = req.body ?? {};
  const wantStream = !!(req.body?.stream || req.query?.stream);

  if (!userId) return res.status(400).json({ error: "userId is required" });
  if (!message || !String(message).trim()) return res.status(400).json({ error: "message is required" });

  // 1. Brain context — best-effort; never blocks the turn (tutor-context returns
  //    {context:null} when the brain env / person link is absent).
  let brainContext: string | null = null;
  try {
    const { body } = await callApi(tutorContext, {
      body: { userId, userMessage: message, brainPersonId, activeCourseId: courseId },
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
        specialist, userMessage: message, brainContext, history: hist,
        ctx: { userId, courseId, assignmentId },
        emit: (e) => { if (e.type !== "final") send(e.type, e); },   // `final` is superseded by `done`
      });
      send("done", {
        ok: true, route: result.route, output: result.output, toolCalls: result.trace,
        steps: result.steps, budgetExhausted: result.budgetExhausted, brainContextUsed: !!brainContext,
      });
    } catch (e: any) {
      send("error", { error: e?.message ?? "Reggie failed" });
    } finally {
      try { res.end(); } catch { /* already closed */ }
    }
    return;
  }

  // 3b. Blocking: return the final answer + tool-call trace as one JSON body.
  try {
    const result = await runReggie({
      specialist, userMessage: message, brainContext, history: hist,
      ctx: { userId, courseId, assignmentId },
    });
    return res.status(200).json({
      ok: true,
      route: result.route,
      output: result.output,
      toolCalls: result.trace,
      steps: result.steps,
      budgetExhausted: result.budgetExhausted,
      brainContextUsed: !!brainContext,
    });
  } catch (e: any) {
    return res.status(502).json({ error: e?.message ?? "Reggie failed" });
  }
}

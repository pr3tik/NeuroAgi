// api/claude.ts — Anthropic Claude proxy. Thin HTTP adapter over the LLM gateway
// (api/_gateway.ts): it owns routing, retry/fallback, cost, and tracing. This file
// only does HTTP plumbing (CORS, method gating, request/response shape, SSE piping).
//
// Response shape is unchanged for existing callers: { content, contentBlocks,
// stop_reason, usage }. We additionally surface { model, provider } (additive).
// Body may carry an optional `task` ("tutor" | "summarize" | "deep" | …) to pick the
// route; absent → "default" (the tutor/Sonnet route), preserving prior behavior.
import { callModel, openStream } from "./_gateway.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { messages, system, max_tokens, tools, stream, task, model, cache, thinking } = req.body ?? {};
  if (!messages || !Array.isArray(messages))
    return res.status(400).json({ error: "messages array required" });

  // Let the task route naturally (default → Anthropic Sonnet). We intentionally do NOT
  // force provider:"anthropic" here — that would mismatch a Groq-routed task (e.g.
  // task:"cheap") onto the Anthropic endpoint. Callers wanting Groq use /api/groq.
  const gwReq = { task, model, messages, system, max_tokens, tools, cache, thinking };

  // ── Streaming path — forward SSE straight to the client ──────────────────────
  if (stream) {
    const out = await openStream({ ...gwReq, task: task ?? "default" });
    if (!out.ok || !out.stream) {
      return res.status(502).json({ error: out.error ?? "stream open failed", detail: out.detail });
    }
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    const reader = out.stream.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
    } finally {
      res.end();
    }
    return;
  }

  // ── Non-streaming path ───────────────────────────────────────────────────────
  const r = await callModel(gwReq);
  if (!r.ok) {
    console.error(`[claude] gateway error ${r.status}:`, r.error);
    return res.status(r.status >= 500 ? 502 : r.status).json({ error: r.error, detail: r.detail });
  }
  return res.status(200).json({
    content: r.content,
    contentBlocks: r.contentBlocks,
    stop_reason: r.stop_reason,
    usage: r.usage,
    model: r.model,
    provider: r.provider,
  });
}

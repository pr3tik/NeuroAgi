// api/groq.ts — Groq (OpenAI-compatible) proxy. Thin HTTP adapter over the LLM
// gateway (api/_gateway.ts), which owns the retry-on-429 backoff, cost, and tracing.
// Response shape unchanged for callers: { content }.
import { callModel } from "./_gateway.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { messages, system, max_tokens } = req.body ?? {};
  if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: "messages array required" });

  const r = await callModel({
    task: "cheap",            // routes to Groq (llama) — the cheap/fast tier
    provider: "groq",
    messages,
    system,
    max_tokens: max_tokens ?? 1024,
  });

  if (!r.ok) {
    return res.status(r.status === 429 ? 429 : 502).json({ error: r.error });
  }
  return res.status(200).json({ content: r.content });
}

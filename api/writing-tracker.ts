// api/writing-tracker.js — Writing Evolution Tracker agent.
//
// Analyzes a piece of the student's writing into a quantitative profile (readability,
// vocabulary diversity, sentence complexity, citations), compares it to their last
// submission to show growth, adds a brief LLM coaching note, persists a snapshot for the
// timeline, and fires an additive 'writing_metrics' brain signal. The metric math is pure
// (src/lib/writingMetrics.ts, unit-tested); the LLM note + brain signal degrade gracefully.
//
// POST { userId, text, title? } → { metrics, delta, assessment, tip, saved }

import { createClient } from "@supabase/supabase-js";
import { analyzeWriting, compareMetrics } from "../src/lib/writingMetrics.js";

function baseUrl(req) {
  const host  = (req.headers["x-forwarded-host"] ?? req.headers.host ?? "localhost") as string;
  const proto = (req.headers["x-forwarded-proto"] as string) ?? (host.includes("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

function parseFeedback(raw: string): { assessment: string; tip: string } {
  if (!raw) return { assessment: "", tip: "" };
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const c = fenced ?? raw;
  const s = c.indexOf("{"), e = c.lastIndexOf("}");
  if (s === -1 || e <= s) return { assessment: raw.trim().slice(0, 400), tip: "" };
  try {
    const o = JSON.parse(c.slice(s, e + 1));
    return { assessment: String(o.assessment ?? "").trim(), tip: String(o.tip ?? "").trim() };
  } catch {
    return { assessment: raw.trim().slice(0, 400), tip: "" };
  }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { userId, text, title } = req.body ?? {};
  if (!userId) return res.status(400).json({ error: "userId required" });
  if (!text || String(text).trim().length < 40) {
    return res.status(400).json({ error: "Paste at least a paragraph of writing to analyze." });
  }

  const base = baseUrl(req);
  const content = String(text);
  const metrics = analyzeWriting(content);

  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
  const supabase = (supabaseUrl && key) ? createClient(supabaseUrl, key) : null;

  // ── Delta vs the student's most recent submission ──────────────────────────
  let delta: any[] = [];
  if (supabase) {
    try {
      const { data: last } = await supabase
        .from("writing_snapshots")
        .select("metrics")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1);
      if (last?.[0]?.metrics) delta = compareMetrics(last[0].metrics, metrics);
    } catch { /* first submission, or table not created yet */ }
  }

  // ── Optional LLM coaching note ─────────────────────────────────────────────
  let assessment = "", tip = "";
  try {
    const system =
      "You are a supportive but honest writing coach. Given a student's writing, give a brief " +
      "assessment of its clarity, structure, and argument, then ONE specific, actionable tip to " +
      'improve. Respond with ONLY JSON: {"assessment": string, "tip": string}. One or two sentences each.';
    const user = `Student writing${title ? ` (titled "${title}")` : ""}:\n\n${content.slice(0, 4000)}`;
    const llm = await fetch(`${base}/api/claude`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: user }], system, max_tokens: 400 }),
    }).then(r => r.ok ? r.json() : null).catch(() => null);
    ({ assessment, tip } = parseFeedback(llm?.content ?? ""));
  } catch { /* metrics stand on their own without the note */ }

  // ── Persist the snapshot (the timeline) ────────────────────────────────────
  let saved = false;
  if (supabase) {
    try {
      await supabase.from("writing_snapshots").insert({
        user_id:    userId,
        title:      title ?? null,
        word_count: metrics.words,
        metrics,
        assessment: assessment || null,
        tip:        tip || null,
      });
      saved = true;
    } catch { /* table may not exist yet — analysis still returned inline */ }
  }

  // ── Best-effort brain signal (additive 'writing_metrics' type, AWAITED) ────
  try {
    const link = await fetch(`${base}/api/brain-person-link`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    }).then(r => r.ok ? r.json() : null).catch(() => null);
    const brainPersonId = link?.brain_person_id;
    if (brainPersonId) {
      await fetch(`${base}/api/brain-signal`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brainPersonId, signalType: "academic", source: "writing_tracker",
          payload: { type: "writing_metrics", title: title ?? null, metrics },
        }),
      }).catch(() => {});
    }
  } catch { /* signal is best-effort; never blocks the response */ }

  return res.status(200).json({ metrics, delta, assessment, tip, saved });
}

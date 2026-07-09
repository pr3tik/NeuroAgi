// api/content-connector.js — Content Connector agent.
//
// Links external content a student shares (article URL, YouTube link, or pasted text) to
// the concepts/courses in their OWN materials, then surfaces + persists the connection and
// fires a brain signal. Reuses the existing capability endpoints (extract / rag / claude /
// brain) over internal calls, and every external step degrades gracefully so the agent
// always returns a result.
//
// POST { userId, url?, text?, title? } → { sourceTitle, summary, connections[], saved }

import { createClient } from "@supabase/supabase-js";
import {
  detectSourceType, htmlToText, buildPrompt, parseConnections,
} from "../src/lib/contentConnector.js";

function baseUrl(req) {
  const host  = (req.headers["x-forwarded-host"] ?? req.headers.host ?? "localhost") as string;
  const proto = (req.headers["x-forwarded-proto"] as string) ?? (host.includes("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

// Fetch a web page with a timeout + size cap, then reduce it to title + readable text.
async function fetchPage(url: string): Promise<{ title: string; text: string }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "Mozilla/5.0 (FschoolAI ContentConnector)" } });
    if (!r.ok) return { title: "", text: "" };
    const html = (await r.text()).slice(0, 400_000);
    return htmlToText(html);
  } catch {
    return { title: "", text: "" };
  } finally {
    clearTimeout(t);
  }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { userId, url, text, title } = req.body ?? {};
  if (!userId) return res.status(400).json({ error: "userId required" });
  if (!url && !text) return res.status(400).json({ error: "url or text required" });

  const base = baseUrl(req);

  // ── 1. Resolve the external content to text + a title ──────────────────────
  let content = "", srcTitle = title ?? "", sourceUrl = url ?? null;
  try {
    if (text) {
      content = String(text);
    } else {
      const kind = detectSourceType(url);
      if (kind === "youtube") {
        // Reuse the YouTube transcript path in api/extract.
        const ex = await fetch(`${base}/api/extract`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ youtubeUrl: url, userId }),
        }).then(r => r.ok ? r.json() : null).catch(() => null);
        content = ex?.text ?? "";
        srcTitle = srcTitle || ex?.title || "";
      } else {
        const page = await fetchPage(url);
        content = page.text;
        srcTitle = srcTitle || page.title;
      }
    }
  } catch { /* fall through with whatever we have */ }

  content = (content ?? "").trim().slice(0, 6000);
  if (!content) return res.status(200).json({ sourceTitle: srcTitle, summary: "", connections: [], saved: false, reason: "couldn't read that content" });

  // ── 2. Ground in the student's own course materials (RAG) ──────────────────
  let passages: any[] = [];
  try {
    const ragQuery = `${srcTitle} ${content.slice(0, 500)}`.trim();
    const rag = await fetch(`${base}/api/rag?action=query`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, query: ragQuery, maxSections: 5, rerank: false }),
    }).then(r => r.ok ? r.json() : null).catch(() => null);
    passages = (rag?.passages ?? []).map((p: any) => ({ title: p.title, heading: p.heading, text: (p.text ?? "").slice(0, 800) }));
  } catch { /* no grounding — the prompt handles the empty case */ }

  // ── 3. Ask the model for the connections ───────────────────────────────────
  let result = { summary: "", connections: [] as any[] };
  try {
    const { system, user } = buildPrompt(content, srcTitle, passages);
    const llm = await fetch(`${base}/api/claude`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: user }], system, max_tokens: 700 }),
    }).then(r => r.ok ? r.json() : null).catch(() => null);
    result = parseConnections(llm?.content ?? "");
  } catch { /* return an empty connection set rather than failing */ }

  // ── 4. Persist the connection (the feed) ───────────────────────────────────
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
  let saved = false;
  if (supabaseUrl && key && result.connections.length) {
    try {
      const supabase = createClient(supabaseUrl, key);
      await supabase.from("content_connections").insert({
        user_id:         userId,
        source_url:      sourceUrl,
        source_title:    srcTitle || null,
        content_summary: result.summary || null,
        connections:     result.connections,
      });
      saved = true;
    } catch { /* table may not exist yet — connection still returned inline */ }
  }

  // ── 5. Best-effort brain signal (additive 'content_connection' type) ───────
  // AWAITED, not fire-and-forget: post-response work is killed on serverless. It's still
  // best-effort (every hop is guarded + brain-signal self-degrades if the brain DB isn't
  // configured), so it never fails the user's response.
  if (result.connections.length) {
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
            brainPersonId, signalType: "academic", source: "content_connector",
            payload: { type: "content_connection", source_url: sourceUrl, source_title: srcTitle, connections: result.connections },
          }),
        }).catch(() => {});
      }
    } catch { /* signal is best-effort; never blocks the response */ }
  }

  return res.status(200).json({
    sourceTitle: srcTitle,
    summary:     result.summary,
    connections: result.connections,
    saved,
  });
}

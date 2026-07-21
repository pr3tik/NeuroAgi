// api/stt.js — Speech-to-text.
//
// POST ?action=token  → mint a single-use ElevenLabs token for realtime Scribe (VOICE-1)
// POST (no action)    → batch transcription via Groq Whisper
//   Body option A: { audio: "<base64>", mimeType: "audio/webm" } (JSON)
//   Body option B: raw audio bytes with matching Content-Type header
//   Returns: { text }.  Cap: 25 MB / ~60 s. Returns { text: "" } for silent audio.
//
// The batch path stays for the chat-input mic button (src/lib/dictation.ts), which has
// its own Web Speech fast path and does not stream. The orb's voice loop uses the token
// action instead — see VOICE-STREAMING-SPEC.md.

export const config = { api: { bodyParser: false } };

import { rateLimit } from "./_ratelimit.js";
import { requireUserOr401 } from "./_auth.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { action } = req.query ?? {};

  // ── POST ?action=token — single-use realtime Scribe credential ──────────────
  // The browser cannot hold ELEVENLABS_API_KEY, so it opens the Scribe WebSocket with
  // a short-lived token minted here instead. Tokens are single-use and expire after
  // 15 minutes, so one is minted per socket connection.
  //
  // Unlike the batch path below, this is auth-gated: a token spends real STT quota, so
  // it must be attributable to a signed-in user. Handled before the raw-body read —
  // bodyParser is off for the audio path and this action carries no body.
  if (action === "token") {
    const userId = await requireUserOr401(req, res);
    if (!userId) return;
    if (!(await rateLimit(req, res, "stt-token", { anonMax: 0, authMax: 60 }))) return;

    const elevenKey = process.env.ELEVENLABS_API_KEY;
    if (!elevenKey) return res.status(503).json({ error: "voice_not_configured" });

    const tokenRes = await fetch(
      "https://api.elevenlabs.io/v1/single-use-token/realtime_scribe",
      { method: "POST", headers: { "xi-api-key": elevenKey } },
    );

    if (!tokenRes.ok) {
      const detail = await tokenRes.text().catch(() => "");
      console.error("[stt/token] ElevenLabs error", tokenRes.status, detail.slice(0, 200));
      return res.status(502).json({ error: `Scribe token ${tokenRes.status}` });
    }

    const { token } = await tokenRes.json();
    if (!token) return res.status(502).json({ error: "Scribe token missing from response" });
    return res.status(200).json({ token });
  }

  if (!(await rateLimit(req, res, "stt", { anonMax: 30, authMax: 120 }))) return;

  const groqKey = process.env.GROQ_KEY;
  if (!groqKey) return res.status(500).json({ error: "GROQ_KEY not configured" });

  // Read raw body
  const chunks = [];
  for await (const chunk of req)
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  const rawBody = Buffer.concat(chunks);

  if (rawBody.length === 0)           return res.status(400).json({ error: "Empty body" });
  if (rawBody.length > 25 * 1024 * 1024) return res.status(400).json({ error: "Audio too large (max 25 MB)" });

  let audioBuffer, mimeType;
  const ct = req.headers["content-type"] ?? "";

  if (ct.includes("application/json")) {
    let json;
    try   { json = JSON.parse(rawBody.toString("utf8")); }
    catch { return res.status(400).json({ error: "Invalid JSON" }); }
    if (!json.audio) return res.status(400).json({ error: "audio field required" });
    audioBuffer = Buffer.from(json.audio, "base64");
    mimeType    = json.mimeType ?? "audio/webm";
  } else {
    // Raw binary audio body
    audioBuffer = rawBody;
    mimeType    = ct || "audio/webm";
  }

  if (!audioBuffer || audioBuffer.length === 0)
    return res.status(400).json({ error: "No audio data" });

  // Extension from mime
  const ext = mimeType.includes("mp4") || mimeType.includes("m4a") ? "m4a"
    : mimeType.includes("mp3")  ? "mp3"
    : mimeType.includes("ogg")  ? "ogg"
    : mimeType.includes("wav")  ? "wav"
    : "webm";

  // Build multipart/form-data for Groq
  const boundary   = "----GroqSTT" + Date.now().toString(36);
  const fieldParts = [
    `--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-large-v3-turbo`,
    `--${boundary}\r\nContent-Disposition: form-data; name="response_format"\r\n\r\njson`,
    `--${boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\nen`,
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.${ext}"\r\nContent-Type: ${mimeType}\r\n`,
  ].join("\r\n");

  const formBody = Buffer.concat([
    Buffer.from(fieldParts + "\r\n"),
    audioBuffer,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);

  const groqRes = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method:  "POST",
    headers: {
      Authorization:  `Bearer ${groqKey}`,
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
    },
    body: formBody,
  });

  if (!groqRes.ok) {
    const detail = await groqRes.text().catch(() => "");
    console.error("[stt] Groq error", groqRes.status, detail.slice(0, 200));
    return res.status(502).json({ error: `Groq STT ${groqRes.status}`, detail: detail.slice(0, 200) });
  }

  const data = await groqRes.json();
  return res.status(200).json({ text: (data.text ?? "").trim() });
}

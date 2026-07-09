// api/tts.js — ElevenLabs TTS proxy
// GET  ?action=voices  → cached list of available voices
// POST ?action=stream  → pipe audio stream (Content-Type: audio/mpeg)
// POST (no action)     → return base64 JSON (legacy path, used by NeuralRing)

const DEFAULT_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || "JBFqnCBsd6RMkjVDRZzb";

// In-memory voice cache (1h TTL — voices rarely change)
let _voiceCache = null;
let _voiceCacheAt = 0;
const VOICE_CACHE_TTL = 60 * 60 * 1000;

async function fetchVoiceList(apiKey) {
  if (_voiceCache && Date.now() - _voiceCacheAt < VOICE_CACHE_TTL) return _voiceCache;
  const res = await fetch("https://api.elevenlabs.io/v1/voices", {
    headers: { "xi-api-key": apiKey },
  });
  if (!res.ok) throw new Error(`ElevenLabs voices ${res.status}`);
  const data = await res.json();
  _voiceCache = (data.voices ?? []).slice(0, 20).map(v => ({
    voice_id:    v.voice_id,
    name:        v.name,
    labels:      v.labels ?? {},
    preview_url: v.preview_url ?? null,
  }));
  _voiceCacheAt = Date.now();
  return _voiceCache;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "ELEVENLABS_API_KEY not configured" });

  const { action } = req.query;

  // ── GET ?action=voices ────────────────────────────────────────────────────
  if (req.method === "GET" && action === "voices") {
    try {
      const voices = await fetchVoiceList(apiKey);
      return res.status(200).json(voices);
    } catch (err) {
      console.error("[tts/voices]", err.message);
      return res.status(502).json({ error: err.message });
    }
  }

  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { text, voiceId, speed, voiceSettings } = req.body ?? {};
  if (!text || typeof text !== "string") return res.status(400).json({ error: "text is required" });

  const voice    = voiceId || DEFAULT_VOICE_ID;
  const safeText = text.slice(0, action === "stream" ? 2000 : 500);
  // speed: 0.7-1.3; pass to ElevenLabs where supported; client uses audio.playbackRate as fallback
  const spd = (typeof speed === "number" && speed >= 0.7 && speed <= 1.3) ? speed : 1.0;
  // voiceSettings: caller can override (e.g. TONE_PRESETS); fall back to sensible defaults
  const vs = voiceSettings ?? { stability: 0.42, similarity_boost: 0.82, style: 0.18, use_speaker_boost: true };

  const elevenRes = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voice}${action === "stream" ? "/stream" : ""}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        text: safeText,
        // turbo_v2_5: noticeably more natural than flash_v2_5 at near-identical latency.
        // For max quality (slightly higher latency) swap to "eleven_multilingual_v2".
        model_id: "eleven_turbo_v2_5",
        voice_settings: { ...vs, use_speaker_boost: true },
        // speed param — honoured by eleven_turbo_v2_5+ if supported; ignored otherwise
        ...(spd !== 1.0 ? { speed: spd } : {}),
      }),
    }
  );

  if (!elevenRes.ok) {
    const errText = await elevenRes.text();
    console.error(`[tts] ElevenLabs ${elevenRes.status}:`, errText);
    return res.status(502).json({ error: `ElevenLabs ${elevenRes.status}`, detail: errText });
  }

  // ── POST ?action=stream — pipe raw audio ─────────────────────────────────
  if (action === "stream") {
    res.setHeader("Content-Type", "audio/mpeg");
    const buffer = await elevenRes.arrayBuffer();
    return res.status(200).send(Buffer.from(buffer));
  }

  // ── POST (legacy) — return base64 JSON ───────────────────────────────────
  const buffer = await elevenRes.arrayBuffer();
  const base64 = Buffer.from(buffer).toString("base64");
  return res.status(200).json({ audio: base64, mimeType: "audio/mpeg" });
}

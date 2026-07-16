// api/daily-room.ts — Voice chat room provisioning (Daily.co).
// POST { roomId, userName? }  →  { url }
//
// One Daily room per study room, named "fschool-<roomId>". Audio-first
// (video/screenshare/chat off). Rooms auto-expire after 24h.
//
// When userName is provided a meeting token is generated server-side so the
// student's identity is locked to their app name — no manual name entry.
//
// DAILY_API_KEY is read server-side only and never reaches the client.
// Missing key → 503 { error: "voice_not_configured" } → friendly UI message.

const DAILY_API = "https://api.daily.co/v1";

function safeRoomName(roomId: string): string | null {
  if (typeof roomId !== "string") return null;
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(roomId)) return null;
  return `fschool-${roomId}`;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST")    return res.status(405).json({ error: "Method not allowed" });

  const apiKey = process.env.DAILY_API_KEY;
  if (!apiKey) return res.status(503).json({ error: "voice_not_configured" });

  const { roomId, userName } = req.body ?? {};
  const name = safeRoomName(roomId);
  if (!name) return res.status(400).json({ error: "valid roomId required" });

  const auth = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
  const exp  = Math.floor(Date.now() / 1000) + 24 * 60 * 60;

  try {
    // Create the room (idempotent: falls back to GET if it already exists).
    const createRes = await fetch(`${DAILY_API}/rooms`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        name,
        privacy: "public",
        properties: {
          start_video_off:      true,
          start_audio_off:      true,
          enable_screenshare:   false,
          enable_chat:          false,
          enable_people_ui:     true,
          // Skip Daily's own pre-join lobby — users already confirmed intent in the
          // study room UI, and their display name is locked via the meeting token.
          "prejoin-ui-enabled": false,
          exp,
          eject_at_room_exp:    true,
        },
      }),
    });

    let roomUrl: string;
    if (createRes.ok) {
      roomUrl = (await createRes.json()).url;
    } else {
      const getRes = await fetch(`${DAILY_API}/rooms/${name}`, { headers: auth });
      if (!getRes.ok) {
        const detail = await createRes.text().catch(() => "");
        console.error("[daily-room] create+get failed:", createRes.status, detail.slice(0, 300));
        return res.status(502).json({ error: "daily_provision_failed" });
      }
      roomUrl = (await getRes.json()).url;
    }

    // Generate a meeting token to lock the display name to the student's identity.
    const safeName = typeof userName === "string" ? userName.trim().slice(0, 80) : "";
    if (safeName) {
      try {
        const tokenRes = await fetch(`${DAILY_API}/meeting-tokens`, {
          method: "POST",
          headers: auth,
          body: JSON.stringify({
            properties: {
              room_name:       name,
              user_name:       safeName,
              is_owner:        false,
              start_audio_off: true,
              exp,
            },
          }),
        });
        if (tokenRes.ok) {
          const { token } = await tokenRes.json();
          if (token) roomUrl = `${roomUrl}?t=${token}`;
        }
      } catch {
        // Token generation failed — return plain URL, name entry will still work manually.
      }
    }

    return res.status(200).json({ url: roomUrl });
  } catch (err: any) {
    console.error("[daily-room] exception:", err?.message);
    return res.status(502).json({ error: "daily_provision_failed" });
  }
}

// api/daily-room.ts — Voice chat room provisioning (Daily.co).
// POST { roomId, userName? }  →  { url }
//
// One Daily room per study room, named "fschool-<roomId>". Audio-first
// (video/screenshare/chat off). Rooms auto-expire after 24h.
//
// AUTH (study-room sprint hardening): requires a signed-in caller who is a JOINED
// member of the study room — previously anyone could mint rooms/tokens on the org's
// Daily account with any display name. Rooms are now created privacy:"private", so a
// server-minted meeting token (locked to the member's verified app name) is the only
// way in. installApiAuth.ts already attaches the JWT client-side — no UI change.
//
// DAILY_API_KEY is read server-side only and never reaches the client.
// Missing key → 503 { error: "voice_not_configured" } → friendly UI message.
import { requireUserOr401 } from "./_auth.js";
import { rateLimit } from "./_ratelimit.js";

const DAILY_API = "https://api.daily.co/v1";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function safeRoomName(roomId: string): string | null {
  if (typeof roomId !== "string") return null;
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(roomId)) return null;
  return `fschool-${roomId}`;
}

async function fetchRows(path: string): Promise<any[]> {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return [];
  const r = await fetch(`${url}/rest/v1/${path}`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  return r.ok ? ((await r.json()) as any[]) : [];
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST")    return res.status(405).json({ error: "Method not allowed" });

  const userId = await requireUserOr401(req, res);
  if (!userId) return;
  if (!(await rateLimit(req, res, "daily-room", { anonMax: 5, authMax: 20, windowSecs: 60 }))) return;

  const apiKey = process.env.DAILY_API_KEY;
  if (!apiKey) return res.status(503).json({ error: "voice_not_configured" });

  const { roomId } = req.body ?? {};
  const name = safeRoomName(roomId);
  if (!name || !UUID_RE.test(String(roomId))) return res.status(400).json({ error: "valid roomId required" });

  // Only JOINED members of the study room may provision/enter its voice room.
  const member = await fetchRows(`room_members?room_id=eq.${roomId}&user_id=eq.${encodeURIComponent(userId)}&status=eq.joined&select=user_id`);
  if (!member.length) return res.status(403).json({ error: "not a member of this room" });

  // Display name comes from the VERIFIED profile, never from the request body.
  const profile = await fetchRows(`users?id=eq.${encodeURIComponent(userId)}&select=name`);
  const userName = profile[0]?.name || "Student";

  const auth = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
  const exp  = Math.floor(Date.now() / 1000) + 24 * 60 * 60;

  try {
    // Create the room (idempotent: falls back to GET if it already exists).
    const createRes = await fetch(`${DAILY_API}/rooms`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        name,
        privacy: "private",
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
      // A pre-hardening room may still be privacy:"public" — flip it so the token gate holds.
      await fetch(`${DAILY_API}/rooms/${name}`, {
        method: "POST", headers: auth, body: JSON.stringify({ privacy: "private" }),
      }).catch(() => { /* best-effort; room expires within 24h regardless */ });
    }

    // Meeting token: with privacy:"private" this is the ONLY way in, and it locks the
    // display name to the member's verified profile name.
    const safeName = String(userName).trim().slice(0, 80) || "Student";
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
    if (!tokenRes.ok) {
      console.error("[daily-room] token mint failed:", tokenRes.status);
      return res.status(502).json({ error: "daily_provision_failed" });
    }
    const { token } = await tokenRes.json();
    if (!token) return res.status(502).json({ error: "daily_provision_failed" });

    return res.status(200).json({ url: `${roomUrl}?t=${token}` });
  } catch (err: any) {
    console.error("[daily-room] exception:", err?.message);
    return res.status(502).json({ error: "daily_provision_failed" });
  }
}

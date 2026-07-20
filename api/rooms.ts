// api/rooms.ts — protected Study Room creation and joining

import { requireUserOr401 } from "./_auth.js";
import { rateLimit } from "./_ratelimit.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateRoomCode(): string {
  let code = "";

  for (let i = 0; i < 6; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }

  return code;
}

function getBearerToken(req: any): string | null {
  const header =
    req?.headers?.authorization ??
    req?.headers?.Authorization ??
    "";

  const match = String(header).match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL;

  const key =
    process.env.SUPABASE_ANON_KEY ??
    process.env.VITE_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error("Supabase environment variables are not configured");
  }

  return { url, key };
}

/**
 * Calls Supabase using the signed-in user's JWT.
 * This keeps RLS and auth.uid() active.
 */
async function supabaseRequest(
  path: string,
  token: string,
  options: RequestInit = {},
) {
  const { url, key } = getSupabaseConfig();

  return fetch(`${url}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: key,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });
}

async function deactivateRoom(roomId: string, token: string) {
  try {
    await supabaseRequest(
      `study_rooms?id=eq.${encodeURIComponent(roomId)}`,
      token,
      {
        method: "PATCH",
        headers: {
          Prefer: "return=minimal",
        },
        body: JSON.stringify({
          is_active: false,
        }),
      },
    );
  } catch {
    // Best effort cleanup only.
  }
}

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization",
  );
  res.setHeader(
    "Access-Control-Allow-Methods",
    "POST, OPTIONS",
  );

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed",
    });
  }

  try {
    const userId = await requireUserOr401(req, res);

    if (!userId) {
      return;
    }

    const token = getBearerToken(req);

    if (!token) {
      return res.status(401).json({
        error: "Authentication required.",
      });
    }

    const allowed = await rateLimit(req, res, "rooms", {
      anonMax: 10,
      authMax: 60,
      windowSecs: 60,
    });

    if (!allowed) {
      return;
    }

    const action = String(req.query?.action ?? "");

    // ── Create room ─────────────────────────────────────────────
    if (action === "create") {
      const {
        name,
        courseId,
        roomType,
        accessFilters,
      } = req.body ?? {};

      const trimmedName =
        typeof name === "string" ? name.trim() : "";

      if (!trimmedName || trimmedName.length > 120) {
        return res.status(400).json({
          error: "Room name must be between 1 and 120 characters.",
        });
      }

      if (!["public", "invite"].includes(roomType)) {
        return res.status(400).json({
          error: "roomType must be public or invite.",
        });
      }

      let parsedCourseId: number | null = null;

      if (
        courseId !== null &&
        courseId !== undefined &&
        courseId !== ""
      ) {
        parsedCourseId = Number(courseId);

        if (
          !Number.isInteger(parsedCourseId) ||
          parsedCourseId <= 0
        ) {
          return res.status(400).json({
            error: "courseId must be a valid integer.",
          });
        }
      }

      const incomingFilters =
        accessFilters &&
        typeof accessFilters === "object" &&
        !Array.isArray(accessFilters)
          ? accessFilters
          : {};

      const filters: Record<string, boolean> = {};

      for (const key of [
        "university",
        "friends",
        "fof",
        "course",
      ]) {
        if (incomingFilters[key] === true) {
          filters[key] = true;
        }
      }

      if (!parsedCourseId) {
        delete filters.course;
      }

      let room: any = null;

      for (let attempt = 0; attempt < 5; attempt++) {
        const joinCode = generateRoomCode();

        const createResponse = await supabaseRequest(
          "study_rooms?select=*",
          token,
          {
            method: "POST",
            headers: {
              Prefer: "return=representation",
            },
            body: JSON.stringify({
              created_by: userId,
              name: trimmedName,
              course_id: parsedCourseId,
              room_type: roomType,
              join_code: joinCode,
              access_filters: filters,
            }),
          },
        );

        if (createResponse.ok) {
          const rows = await createResponse.json();
          room = rows?.[0] ?? null;
          break;
        }

        const errorText = await createResponse.text();

        const duplicateCode =
          createResponse.status === 409 ||
          errorText.toLowerCase().includes("join_code") ||
          errorText.toLowerCase().includes("unique");

        if (duplicateCode) {
          continue;
        }

        console.error(
          "[rooms] create failed:",
          createResponse.status,
          errorText.slice(0, 300),
        );

        return res.status(createResponse.status).json({
          error: "Could not create the room.",
        });
      }

      if (!room) {
        return res.status(500).json({
          error: "Could not generate a unique room code.",
        });
      }

      // Automatically join the creator as the host/member.
      const joinResponse = await supabaseRequest(
        "rpc/join_room",
        token,
        {
          method: "POST",
          body: JSON.stringify({
            p_user: userId,
            p_room: room.id,
            p_code: null,
          }),
        },
      );

      if (!joinResponse.ok) {
        const errorText = await joinResponse.text();

        console.error(
          "[rooms] host join failed:",
          joinResponse.status,
          errorText.slice(0, 300),
        );

        await deactivateRoom(room.id, token);

        return res.status(502).json({
          error: "Room was created, but the host could not join.",
        });
      }

      const joinStatus = await joinResponse.json();

      if (joinStatus !== "joined") {
        await deactivateRoom(room.id, token);

        return res.status(409).json({
          error: "Room was created, but the host could not join.",
          status: joinStatus,
        });
      }

      return res.status(201).json({
        ok: true,
        room,
        status: joinStatus,
      });
    }

    // ── Join room ───────────────────────────────────────────────
    if (action === "join") {
      const { roomId, code = null } = req.body ?? {};

      if (!UUID_RE.test(String(roomId))) {
        return res.status(400).json({
          error: "A valid roomId is required.",
        });
      }

      let normalizedCode: string | null = null;

      if (code !== null && code !== undefined && code !== "") {
        normalizedCode = String(code).trim().toUpperCase();

        if (
          normalizedCode.length !== 6 ||
          !/^[A-Z2-9]+$/.test(normalizedCode)
        ) {
          return res.status(400).json({
            error: "The room code is invalid.",
          });
        }
      }

      const joinResponse = await supabaseRequest(
        "rpc/join_room",
        token,
        {
          method: "POST",
          body: JSON.stringify({
            p_user: userId,
            p_room: roomId,
            p_code: normalizedCode,
          }),
        },
      );

      if (!joinResponse.ok) {
        const errorText = await joinResponse.text();

        console.error(
          "[rooms] join failed:",
          joinResponse.status,
          errorText.slice(0, 300),
        );

        return res.status(joinResponse.status).json({
          error: "Could not join the room.",
        });
      }

      const status = await joinResponse.json();

      return res.status(200).json({
        ok: true,
        status,
      });
    }

    return res.status(400).json({
      error: "Unknown action. Use create or join.",
    });
  } catch (error: any) {
    console.error("[rooms]", error?.message);

    return res.status(500).json({
      error: error?.message ?? "Room request failed.",
    });
  }
}
import { supabase } from "./supabase";

async function roomSessionRequest<T>(
  action: string,
  options: RequestInit = {},
  query: Record<string, string> = {}
): Promise<T> {
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();

  if (sessionError) {
    throw sessionError;
  }

  if (!session?.access_token) {
    throw new Error("You must be signed in to use Study Rooms.");
  }

  const searchParams = new URLSearchParams({
    action,
    ...query,
  });

  const response = await fetch(`/api/room-session?${searchParams.toString()}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
      ...options.headers,
    },
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      data?.error || `Room session request failed (${response.status})`
    );
  }

  return data as T;
}
export type StartRoomSessionResponse = {
  ok: boolean;
  resumed: boolean;
  session: {
    id: string;
    roomId: string;
    state: "active";
    startedAt: string;
    configVersion: number;
  };
  config: {
    persona: string;
    intensity: string;
    durationMinutes: number | null;
  };
  roomPlan: {
    participant_count: number;
    group_preferences: string[];
    version: number;
  };
};

export async function startRoomSession(
  roomId: string
): Promise<StartRoomSessionResponse> {
  return roomSessionRequest<StartRoomSessionResponse>("start", {
    method: "POST",
    body: JSON.stringify({ roomId }),
  });
}
export type EndRoomSessionResponse = {
  ok: boolean;
  sessionId: string;
  state: "ended";
  jobs: Array<{
    type: string;
    id: string;
  }>;
};

export async function endRoomSession(
  sessionId: string
): Promise<EndRoomSessionResponse> {
  return roomSessionRequest<EndRoomSessionResponse>("end", {
    method: "POST",
    body: JSON.stringify({ sessionId }),
  });
}

export type RoomSource = {
  id: string;
  documentId: string;
  title?: string;
  addedBy?: string;
};

export type GetRoomSourcesResponse = {
  ok: boolean;
  sources: RoomSource[];
};

export async function getRoomSources(
  roomId: string
): Promise<GetRoomSourcesResponse> {
  return roomSessionRequest<GetRoomSourcesResponse>(
    "sources",
    {
      method: "GET",
    },
    {
      roomId,
    }
  );
}

export type BindRoomSourcesResponse = {
  ok: boolean;
  sources: RoomSource[];
};

export async function bindRoomSources(
  roomId: string,
  documentIds: string[]
): Promise<BindRoomSourcesResponse> {
  return roomSessionRequest<BindRoomSourcesResponse>("sources", {
    method: "POST",
    body: JSON.stringify({
      roomId,
      documentIds,
    }),
  });
}
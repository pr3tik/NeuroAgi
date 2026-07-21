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

export type QuizQuestion = {
  question: string;
  options: string[];
  correctIndex: number;
  rationale: string;
  evidence?: string;
};

export type BrainProposal = {
  id: string;
  patch: any;
  evidence?: string;
  confidence?: number;
  status: string;
};

export type ReviewResponse = {
  ok: boolean;
  session: { id: string; roomId: string; startedAt: string; endedAt: string | null; state: string };
  groupSummary: any | null;   // { objectives[], concepts[{name,explanation}], examples[{title,detail}], unresolved[], citations[] }
  mySummary: any | null;
  myQuiz: QuizQuestion[] | null;
  myProposals: BrainProposal[];
  jobs: Record<string, string>;
};

/** The caller's session recap: group + own summary, own 5-question quiz, own brain proposals, and
 *  the async-job status map to poll on. Membership-checked + caller-scoped server-side. */
export async function reviewSession(sessionId: string): Promise<ReviewResponse> {
  return roomSessionRequest<ReviewResponse>("review", { method: "GET" }, { sessionId });
}

export type ProposalDecision = "accept" | "edit" | "reject";

/** Owner-gated accept/edit/reject of one brain-update proposal (edit carries the revised patch). */
export async function decideProposal(
  proposalId: string,
  decision: ProposalDecision,
  patch?: any
): Promise<{ ok: boolean }> {
  return roomSessionRequest<{ ok: boolean }>("proposal", {
    method: "POST",
    body: JSON.stringify({ proposalId, decision, ...(patch ? { patch } : {}) }),
  });
}
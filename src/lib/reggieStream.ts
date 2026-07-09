// src/lib/reggieStream.ts — client consumer for Reggie's SSE stream
// (POST /api/agent-manager with stream:true). Reads the event stream and dispatches
// typed callbacks: route → token(deltas) → tool_call/tool_result progress → done.
// `reset` fires when a streamed pre-tool preamble should be cleared. Shared by the
// tutor (NeuralRing) and the beta test panel so both behave identically.

export interface ReggieWidget { type: string; data: any; }
export interface ReggieDone {
  ok: boolean;
  route: string;
  output: string;
  toolCalls: Array<{ name: string; input?: any; ok: boolean; preview: string }>;
  widgets?: ReggieWidget[];
  steps: number;
  budgetExhausted: boolean;
  brainContextUsed: boolean;
}

export interface ReggieStreamHandlers {
  onRoute?: (route: string) => void;
  onToken?: (delta: string) => void;
  onReset?: () => void;
  onToolCall?: (name: string, input: any) => void;
  onToolResult?: (name: string, ok: boolean) => void;
  onDone?: (result: ReggieDone) => void;
  onError?: (message: string) => void;
}

export interface ReggieStreamBody {
  userId: string;
  message: string;
  history?: Array<{ role: string; content: string }>;
  courseId?: any;
  hint?: string | null;
  /** Client is in voice mode — the loop teaches the model the voice-tag protocol. */
  voiceMode?: boolean;
}

export async function streamReggie(
  body: ReggieStreamBody,
  handlers: ReggieStreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch("/api/agent-manager", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, stream: true }),
    signal,
  });

  // If the server couldn't stream (or errored before headers), surface a clean error.
  if (!res.ok || !res.body) {
    let msg = `Reggie ${res.status}`;
    try { msg = (await res.json())?.error || msg; } catch { /* not json */ }
    handlers.onError?.(msg);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let event = "message";
  let terminal = false;               // did we see an explicit done/error frame?

  const dispatch = (evt: string, data: any) => {
    switch (evt) {
      case "route":       handlers.onRoute?.(data.route); break;
      case "token":       handlers.onToken?.(data.text ?? ""); break;
      case "reset":       handlers.onReset?.(); break;
      case "tool_call":   handlers.onToolCall?.(data.name, data.input); break;
      case "tool_result": handlers.onToolResult?.(data.name, !!data.ok); break;
      case "done":        terminal = true; handlers.onDone?.(data as ReggieDone); break;
      case "error":       terminal = true; handlers.onError?.(data.error || "Reggie failed"); break;
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (line.startsWith("event:")) { event = line.slice(6).trim(); continue; }
        if (line.startsWith("data:")) {
          const payload = line.slice(5).trim();
          if (!payload) continue;
          try { dispatch(event, JSON.parse(payload)); } catch { /* skip malformed frame */ }
          event = "message";
        }
      }
    }
  } finally {
    try { reader.releaseLock(); } catch { /* reader may be errored/aborted */ }
  }

  // Stream closed with no done/error frame (Vercel maxDuration, proxy drop, network cut).
  // Signal completion so the client isn't wedged "streaming" and can keep any partial text.
  if (!terminal) handlers.onError?.("The response was cut off before it finished.");
}

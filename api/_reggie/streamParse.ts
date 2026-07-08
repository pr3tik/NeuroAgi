// api/_reggie/streamParse.ts — parse an Anthropic Messages streaming SSE body into a
// reconstructed turn: the full content-block array (text + tool_use with parsed input)
// and the stop_reason, while emitting text deltas live via onText. This lets Reggie's
// loop stream tokens to the client AND still drive the tool-use cycle from the same
// response. Anthropic-only (the tutor/classify routes never fall back to Groq, whose
// SSE shape differs); callers use the non-streaming path if this can't run.

export interface StreamedTurn {
  contentBlocks: any[];        // [{type:"text",text} | {type:"tool_use",id,name,input}]
  stop_reason: string | null;
  text: string;                // concatenated assistant text
}

export async function parseAnthropicSSE(
  stream: ReadableStream<Uint8Array>,
  onText?: (delta: string) => void,
): Promise<StreamedTurn> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const blocks: any[] = [];
  const partialJson: Record<number, string> = {};
  let stop_reason: string | null = null;
  let text = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";                       // keep the last (possibly partial) line
      for (const line of lines) {
        const l = line.trim();
        if (!l.startsWith("data:")) continue;         // ignore `event:` lines — type is in the JSON
        const payload = l.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        let evt: any;
        try { evt = JSON.parse(payload); } catch { continue; }

        switch (evt.type) {
          case "content_block_start": {
            const cb = evt.content_block ?? {};
            if (cb.type === "tool_use") blocks[evt.index] = { type: "tool_use", id: cb.id, name: cb.name, input: {} };
            else if (cb.type === "text") blocks[evt.index] = { type: "text", text: "" };
            else blocks[evt.index] = { ...cb };
            partialJson[evt.index] = "";
            break;
          }
          case "content_block_delta": {
            const d = evt.delta ?? {};
            if (d.type === "text_delta") {
              const t = d.text ?? "";
              text += t;
              if (blocks[evt.index]) blocks[evt.index].text = (blocks[evt.index].text ?? "") + t;
              if (t) onText?.(t);
            } else if (d.type === "input_json_delta") {
              partialJson[evt.index] = (partialJson[evt.index] ?? "") + (d.partial_json ?? "");
            }
            break;
          }
          case "content_block_stop": {
            const b = blocks[evt.index];
            if (b?.type === "tool_use") {
              try { b.input = partialJson[evt.index] ? JSON.parse(partialJson[evt.index]) : {}; }
              catch { b.input = {}; }
            }
            break;
          }
          case "message_delta": {
            if (evt.delta?.stop_reason) stop_reason = evt.delta.stop_reason;
            break;
          }
          // message_start / message_stop / ping — nothing to accumulate
        }
      }
    }
  } finally {
    try { reader.releaseLock(); } catch { /* noop */ }
  }

  return { contentBlocks: blocks.filter(Boolean), stop_reason, text };
}

// @vitest-environment node
// Unit tests for the Anthropic-SSE → turn reconstructor: text deltas, tool_use block
// with streamed input JSON, and stop_reason — the piece that lets Reggie stream tokens
// while still driving the tool loop.
import { describe, it, expect } from "vitest";
import { parseAnthropicSSE } from "../api/_reggie/streamParse";

// Build a ReadableStream<Uint8Array> from SSE frame strings (optionally split mid-line
// to prove the buffering across chunk boundaries works).
function sseStream(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
}
const frame = (obj: any) => `event: ${obj.type}\ndata: ${JSON.stringify(obj)}\n\n`;

describe("parseAnthropicSSE", () => {
  it("reconstructs text and emits deltas in order", async () => {
    const stream = sseStream([
      frame({ type: "message_start", message: {} }),
      frame({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
      frame({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello " } }),
      frame({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "world" } }),
      frame({ type: "content_block_stop", index: 0 }),
      frame({ type: "message_delta", delta: { stop_reason: "end_turn" } }),
      frame({ type: "message_stop" }),
    ]);
    const deltas: string[] = [];
    const turn = await parseAnthropicSSE(stream, (d) => deltas.push(d));
    expect(deltas).toEqual(["Hello ", "world"]);
    expect(turn.text).toBe("Hello world");
    expect(turn.stop_reason).toBe("end_turn");
    expect(turn.contentBlocks).toEqual([{ type: "text", text: "Hello world" }]);
  });

  it("reconstructs a tool_use block from streamed input_json_delta", async () => {
    const stream = sseStream([
      frame({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "tu1", name: "what_if_plan" } }),
      frame({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"course":' } }),
      frame({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '"BIO 101"}' } }),
      frame({ type: "content_block_stop", index: 0 }),
      frame({ type: "message_delta", delta: { stop_reason: "tool_use" } }),
      frame({ type: "message_stop" }),
    ]);
    const turn = await parseAnthropicSSE(stream);
    expect(turn.stop_reason).toBe("tool_use");
    expect(turn.contentBlocks).toHaveLength(1);
    expect(turn.contentBlocks[0]).toMatchObject({ type: "tool_use", id: "tu1", name: "what_if_plan", input: { course: "BIO 101" } });
    expect(turn.text).toBe("");
  });

  it("handles a text preamble followed by a tool_use in the same turn", async () => {
    const stream = sseStream([
      frame({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
      frame({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Let me check." } }),
      frame({ type: "content_block_stop", index: 0 }),
      frame({ type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "tu9", name: "canvas_get_grades" } }),
      frame({ type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: "{}" } }),
      frame({ type: "content_block_stop", index: 1 }),
      frame({ type: "message_delta", delta: { stop_reason: "tool_use" } }),
    ]);
    const turn = await parseAnthropicSSE(stream);
    expect(turn.text).toBe("Let me check.");
    expect(turn.stop_reason).toBe("tool_use");
    expect(turn.contentBlocks.map((b: any) => b.type)).toEqual(["text", "tool_use"]);
    expect(turn.contentBlocks[1].input).toEqual({});
  });

  it("survives a frame split across chunk boundaries", async () => {
    const f = frame({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "chunked" } });
    const mid = Math.floor(f.length / 2);
    const stream = sseStream([
      frame({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
      f.slice(0, mid), f.slice(mid),                        // one frame delivered in two chunks
      frame({ type: "message_delta", delta: { stop_reason: "end_turn" } }),
    ]);
    const turn = await parseAnthropicSSE(stream);
    expect(turn.text).toBe("chunked");
  });
});

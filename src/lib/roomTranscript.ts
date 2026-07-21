// roomTranscript.ts — the single source of truth for what was said in a study room.
//
// Every participant transcribes their OWN mic (see scribeStream.ts) and broadcasts each
// committed segment. Each client feeds every segment — its own and everyone else's — into
// one RoomTranscript. The store dedupes by a stable id and keeps utterances in a
// deterministic order, so every client (and, later, the AI "driver") converges on the
// exact same ordered transcript. That convergence is the whole point: it is what lets the
// AI reason about "who said what, in what order" from a single, shared record.
//
// Ordering key: (timestamp, speakerId, per-speaker seq). Timestamp gives the natural
// chronological order across speakers; seq keeps one speaker's own segments in the order
// they were spoken even when timestamps tie. Because every client sorts by the same key
// over the same set of utterances, they all produce byte-identical output regardless of
// the order broadcasts happen to arrive in.
//
// Caveat (documented, not yet handled): timestamps are each speaker's own wall clock, so
// clock skew between participants can misorder utterances that were spoken within a second
// of each other. Humans in a voice call mostly talk in turns, so this is acceptable for v1;
// a logical/synchronized clock is the follow-up if interleaving becomes a problem.

export interface Utterance {
  /** Stable dedupe key, `${speakerId}:${seq}`. */
  id: string;
  speakerId: string;
  speakerName: string;
  text: string;
  /** Speaker's wall-clock time (ms epoch) when the segment committed. */
  ts: number;
  /** Per-speaker monotonic counter — orders one speaker's segments under equal ts. */
  seq: number;
}

function cmp(a: Utterance, b: Utterance): number {
  if (a.ts !== b.ts) return a.ts - b.ts;
  if (a.speakerId !== b.speakerId) return a.speakerId < b.speakerId ? -1 : 1;
  return a.seq - b.seq;
}

export class RoomTranscript {
  private byId = new Map<string, Utterance>();
  private ordered: Utterance[] = [];
  private listeners = new Set<(list: readonly Utterance[]) => void>();

  /** Ingest an utterance (local or remote). Returns true if it was new. Idempotent. */
  add(u: Utterance): boolean {
    if (!u || typeof u.id !== "string" || !u.text) return false;
    if (this.byId.has(u.id)) return false;
    this.byId.set(u.id, u);
    // Utterances usually arrive in roughly chronological order, so scan back from the end
    // to find the insertion point — near-O(1) for in-order arrivals, correct for any order.
    let i = this.ordered.length;
    while (i > 0 && cmp(this.ordered[i - 1], u) > 0) i--;
    this.ordered.splice(i, 0, u);
    this.emit();
    return true;
  }

  /** The full ordered transcript (do not mutate). */
  list(): readonly Utterance[] { return this.ordered; }
  size(): number { return this.ordered.length; }

  /** The last `n` utterances, in order. */
  recent(n: number): Utterance[] {
    return this.ordered.slice(Math.max(0, this.ordered.length - n));
  }

  /** Utterances at or after `ts`. */
  since(ts: number): Utterance[] {
    return this.ordered.filter(u => u.ts >= ts);
  }

  /**
   * Render for an LLM prompt: one "Name: text" line per utterance, in order. `limit` caps
   * to the most recent N utterances; `maxChars` trims from the FRONT so the newest context
   * survives.
   */
  forPrompt(opts: { limit?: number; maxChars?: number } = {}): string {
    const items = opts.limit ? this.recent(opts.limit) : this.ordered;
    let out = items.map(u => `${u.speakerName}: ${u.text}`).join("\n");
    if (opts.maxChars && out.length > opts.maxChars) out = out.slice(out.length - opts.maxChars);
    return out;
  }

  /** Subscribe to changes; returns an unsubscribe. Fires with the current ordered list. */
  subscribe(fn: (list: readonly Utterance[]) => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  clear(): void {
    this.byId.clear();
    this.ordered = [];
    this.emit();
  }

  private emit(): void {
    for (const fn of this.listeners) fn(this.ordered);
  }
}

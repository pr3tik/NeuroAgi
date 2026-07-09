// src/lib/ttsChunker.ts — sentence chunker for streamed TTS. Feed it token deltas as
// they stream; it emits complete sentences the moment they close so audio can start
// before the model finishes (the classic tutor does this inline over /api/claude SSE;
// Reggie mode uses this shared, tested implementation over its own token stream).

export interface SentenceChunker {
  /** Feed a streamed text delta. Emits zero or more complete sentences via the callback. */
  feed(delta: string): void;
  /** Flush whatever is buffered (end of stream) as a final sentence, if non-empty. */
  flush(): void;
  /** Drop the buffer without emitting (e.g. the stream reset before a tool round). */
  reset(): void;
}

// A sentence closes at . ! or ? followed by whitespace/newline. Decimals ("3.5") don't
// match because the terminator must be followed by whitespace. Bare numbered-list
// markers ("1.", "2)") DO hit the boundary — they're filtered below so TTS never speaks
// "one." as its own chunk. Emission also waits while a voice-UI tag ("[VOICE:Dr. Smith]")
// is still open, so a boundary inside a tag argument can't split the tag across chunks.
const BOUNDARY = /[.!?][)"'”’]?[ \n\t]/;
const MIN_CHARS = 2;
const LIST_MARKER = /^\d{1,3}[.)]$/;

export function createSentenceChunker(onSentence: (sentence: string) => void): SentenceChunker {
  let buf = "";
  return {
    feed(delta: string) {
      if (!delta) return;
      buf += delta;
      // Emit every complete sentence currently in the buffer.
      let searchFrom = 0;
      for (;;) {
        const m = BOUNDARY.exec(buf.slice(searchFrom));
        if (!m) break;
        const end = searchFrom + m.index + m[0].length - 1;   // keep the terminator (+ closing quote), not the space
        const candidate = buf.slice(0, end);
        // A boundary INSIDE an unclosed [TAG… argument ("[VOICE:Dr. Smith]") is not a
        // sentence end — skip past it and keep scanning; parseVoiceTags can only strip
        // whole tags, and a half tag would be spoken aloud.
        if (candidate.lastIndexOf("[") > candidate.lastIndexOf("]")) { searchFrom = end + 1; continue; }
        const sentence = candidate.trim();
        buf = buf.slice(end).replace(/^\s+/, "");
        searchFrom = 0;
        if (sentence.length >= MIN_CHARS && !LIST_MARKER.test(sentence)) onSentence(sentence);
      }
    },
    flush() {
      const rest = buf.trim();
      buf = "";
      if (rest.length >= MIN_CHARS) onSentence(rest);
    },
    reset() { buf = ""; },
  };
}

// src/lib/ragQuery.ts — decide what (if anything) to retrieve for a chat turn.
// Retrieval embeds the query string and full-text-searches it, so sending the WHOLE
// message is doubly wrong for big prompts: it's slow (embedding + tsquery over a huge
// string) AND the embedding is muddy (one vector averaged over thousands of tokens
// retrieves poorly). Two rules:
//   • A very large prompt is self-contained context the user pasted — skip retrieval
//     entirely; grounding it in their notes adds latency and tokens for ~no value.
//   • A medium prompt is capped to head+tail — the framing question is almost always at
//     the start or end of a paste, and the gist is all retrieval needs.
// Small prompts (the common case) are unchanged.

export const RAG_SKIP_CHARS = 4000;   // >~1000 words: treat as its own context, don't retrieve
export const RAG_QUERY_CAP  = 1200;   // cap the retrieval query to the gist

export function buildRetrievalQuery(text: string): { skip: boolean; query: string } {
  const t = (text ?? "").trim();
  if (t.length > RAG_SKIP_CHARS) return { skip: true, query: "" };
  if (t.length <= RAG_QUERY_CAP) return { skip: false, query: t };
  const half = Math.floor(RAG_QUERY_CAP / 2);
  return { skip: false, query: `${t.slice(0, half)} … ${t.slice(-half)}` };
}

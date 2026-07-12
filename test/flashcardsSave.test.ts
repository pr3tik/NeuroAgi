// @vitest-environment node
// replaceFlashcardDeck must write per-row to flashcards_v2 (the table the app READS),
// replacing the course's prior deck — the bug it fixes: three client writers were
// upserting into the retired single-row `flashcards` table that nothing reads.
import { describe, it, expect, vi } from "vitest";
import { replaceFlashcardDeck } from "../src/lib/flashcardsSave";

// Chainable fake supabase client that records every op.
function fakeSb() {
  const ops: any[] = [];
  const sb = {
    ops,
    from(table: string) {
      const ctx: any = { table };
      const chain: any = {
        delete() { ctx.op = "delete"; return chain; },
        eq(k: string, v: any) { (ctx.eq ??= {})[k] = v; return chain; },
        is(k: string, v: any) { (ctx.is ??= {})[k] = v; ops.push({ ...ctx }); return Promise.resolve({ error: null }); },
        insert(rows: any) { ctx.op = "insert"; ctx.rows = rows; ops.push({ ...ctx }); return Promise.resolve({ error: null }); },
        then(res: any) { ops.push({ ...ctx }); res({ error: null }); },   // await of the .eq()-terminated delete
      };
      return chain;
    },
  };
  return sb;
}

describe("replaceFlashcardDeck", () => {
  it("targets flashcards_v2 (never the retired `flashcards` table) and writes per-row", async () => {
    const sb = fakeSb();
    const r = await replaceFlashcardDeck(sb, "u1", "c1", [{ question: "Q1", answer: "A1" }, { q: "Q2", a: "A2" }]);
    expect(r.saved).toBe(2);
    expect(sb.ops.every((o) => o.table === "flashcards_v2")).toBe(true);   // never "flashcards"
    const del = sb.ops.find((o) => o.op === "delete");
    expect(del.eq).toMatchObject({ user_id: "u1", course_id: "c1" });      // scoped delete first
    const ins = sb.ops.find((o) => o.op === "insert");
    expect(ins.rows).toEqual([
      { user_id: "u1", course_id: "c1", question: "Q1", answer: "A1" },
      { user_id: "u1", course_id: "c1", question: "Q2", answer: "A2" },     // {q,a} normalized
    ]);
  });

  it("uses .is(null) for a null course (eq-null never matches in PostgREST)", async () => {
    const sb = fakeSb();
    await replaceFlashcardDeck(sb, "u1", null, [{ question: "Q", answer: "A" }]);
    const del = sb.ops.find((o) => o.op === "delete");
    expect(del.is).toEqual({ course_id: null });
    expect(del.eq).toEqual({ user_id: "u1" });
  });

  it("no cards → no delete, no insert (never clobbers an existing deck with nothing)", async () => {
    const sb = fakeSb();
    const r = await replaceFlashcardDeck(sb, "u1", "c1", [{ question: "", answer: "" }]);
    expect(r.saved).toBe(0);
    expect(sb.ops).toHaveLength(0);
  });
});

// @vitest-environment node
// LIVE verification — drives the REAL modules against the REAL services (Supabase + Anthropic +
// OpenAI). Gated behind LIVE=1 so it never runs in the normal offline suite (it costs money and
// hits the network). Run with:  LIVE=1 npx vitest run test/live-verify.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { extractFacts } from "../api/university-brain.ts";
import { embed } from "../api/rag.ts";
import { callModel } from "../api/_gateway.ts";
import { postgrestStore, recall } from "../api/_brain/kernel.ts";

// Load .env.local into process.env (the modules read env at call time). This MUST override values
// preset by test/setup.ts (which sets SUPABASE_URL="http://localhost" as a dummy so importing api/*
// doesn't throw) — otherwise the live DB calls would hit localhost. .env.local wins here by design.
(function loadEnv() {
  try {
    const t = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
    for (const line of t.split(/\r?\n/)) {
      if (line.trim().startsWith("#")) continue;
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && m[2]) process.env[m[1]] = m[2];
    }
  } catch {}
})();

const HAS = !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY && process.env.ANTHROPIC_API_KEY && process.env.OPENAI_API_KEY);
const rest = () => process.env.SUPABASE_URL!.replace(/\/+$/, "") + "/rest/v1";
const H = () => ({ apikey: process.env.SUPABASE_SERVICE_KEY!, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`, "Content-Type": "application/json" });
const get = (p: string) => fetch(`${rest()}/${p}`, { headers: H() }).then(r => r.json());
const rpc = (fn: string, args: any) => fetch(`${rest()}/rpc/${fn}`, { method: "POST", headers: H(), body: JSON.stringify(args) }).then(r => r.json());

const SAMPLE_SYLLABUS = `
GGRC25H3 — Land Reform and Development. Instructor: Prof. Thembela Kepe. Office hours: Tuesdays 2–4pm, room MW340, or by appointment via Quercus message.
Grading breakdown: Participation 10%, Reading responses 20%, Midterm exam 30%, Final paper 40%.
The midterm exam is in class on Thursday, October 24, and covers weeks 1–6. The final paper (2500 words) is due December 6 at 11:59pm, submitted as a PDF through the Quercus assignment page — email submissions are not accepted.
Late policy: 5% deducted per day, no submissions accepted more than 5 days late without a Verification of Illness form.
Weekly schedule: Week 1 introduction to land reform; Week 2 colonial land dispossession; Week 3 property rights; Week 4 redistribution models; Week 5 gender and land; Week 6 case studies in Southern Africa.
Group work: the reading responses are individual; the final paper is individual. Required text: readings posted weekly on Quercus.
`.trim();

describe.skipIf(!process.env.LIVE || !HAS)("LIVE verification", () => {
  it("A1: a real linked user resolves to their brain person (bridge holds live)", async () => {
    const link = (await get("neuro_person_link?product=eq.fschoolai&select=local_id,person_id&limit=1"))[0];
    expect(link?.person_id).toBeTruthy();
    const user = (await get(`users?id=eq.${encodeURIComponent(link.local_id)}&select=id,brain_person_id`))[0];
    expect(user.brain_person_id).toBe(link.person_id); // users.brain_person_id == the linked person
    const person = (await get(`neuro_person?id=eq.${link.person_id}&select=id`))[0];
    expect(person?.id).toBe(link.person_id);
  }, 20000);

  it("A2: course_content and its readers share the same university_id format (scoping matches)", async () => {
    const cc = await get("course_content?select=university_id&limit=20");
    const users = await get("users?university_id=not.is.null&select=university_id&limit=20");
    const ccVals = new Set(cc.map((r: any) => r.university_id));
    const userVals = new Set(users.map((r: any) => r.university_id));
    // Every course_content university_id is a bare host (matches userUniversityId's sanitize output),
    // and at least one real school is shared between the two tables → the read filter will match.
    for (const v of ccVals) expect(String(v)).toMatch(/^[a-z0-9.-]+\.[a-z]{2,}$/i);
    const overlap = [...ccVals].filter(v => userVals.has(v));
    expect(overlap.length).toBeGreaterThan(0); // e.g. q.utoronto.ca present in both
  }, 20000);

  it("A3: extractFacts broadens over a real syllabus via the live gateway", async () => {
    const out = await extractFacts(SAMPLE_SYLLABUS);
    expect(out.summary).toBeTruthy();
    expect(Array.isArray(out.concepts)).toBe(true);
    expect((out.concepts ?? []).length).toBeGreaterThan(3);
    console.error("[A3 live] summary:", out.summary);
    console.error("[A3 live] facts:", JSON.stringify(out.concepts, null, 1));
    const joined = (out.concepts ?? []).join(" || ").toLowerCase();
    // The broadened categories should surface: an exam date, submission mechanics, and a schedule/topic.
    expect(joined).toMatch(/october|oct|december|dec|midterm|final/); // exam dates/format
    expect(joined).toMatch(/quercus|pdf|submit|submission/);          // submission mechanics
    // And the guardrail holds: no student-opinion / difficulty language fabricated.
    expect(joined).not.toMatch(/students find|difficult professor|bad grader/);
  }, 40000);

  it("A7: rag_room_search is document-scoped over the live corpus (no cross-doc leak)", async () => {
    const chunk = (await get("rag_chunks?embedding=not.is.null&select=document_id,content&limit=1"))[0];
    expect(chunk?.document_id).toBeTruthy();
    const docId = chunk.document_id;
    const q = (String(chunk.content).split(/[.!?\n]/)[0] || "summary").slice(0, 120);
    const [emb] = await embed([q]);
    const hits = await rpc("rag_room_search", { p_document_ids: [docId], p_query_embedding: emb, p_query_text: q, p_match_count: 8 });
    expect(Array.isArray(hits)).toBe(true);
    expect(hits.length).toBeGreaterThan(0);
    // The doc-set filter is the isolation boundary: EVERY hit must come from the requested doc.
    expect(hits.every((h: any) => h.document_id === docId)).toBe(true);
    console.error(`[A7 live] query=${JSON.stringify(q)} docId=${docId} hits=${hits.length} topScore=${hits[0]?.score?.toFixed?.(4)}`);
    (globalThis as any).__liveHits = { hits, q };
  }, 40000);

  it("A7: empty doc set retrieves nothing → drives the explicit 'General knowledge' label", async () => {
    const [emb] = await embed(["anything at all"]);
    const hits = await rpc("rag_room_search", { p_document_ids: [], p_query_embedding: emb, p_query_text: "anything at all", p_match_count: 8 });
    expect(hits).toEqual([]); // used===0 → room-ai sets generalKnowledge=true
  }, 30000);

  it("A7: an answer grounded ONLY in retrieved passages is produced (end-to-end via the gateway)", async () => {
    const carried = (globalThis as any).__liveHits;
    const hits = carried?.hits ?? (await (async () => {
      const chunk = (await get("rag_chunks?embedding=not.is.null&select=document_id,content&limit=1"))[0];
      const q = String(chunk.content).slice(0, 100);
      const [emb] = await embed([q]);
      return rpc("rag_room_search", { p_document_ids: [chunk.document_id], p_query_embedding: emb, p_query_text: q, p_match_count: 8 });
    })());
    const passages = hits.slice(0, 4).map((h: any, i: number) => `[${i + 1}] ${h.content}`).join("\n\n");
    const result = await callModel({
      task: "tutor",
      system: "Answer the question using ONLY the numbered passages provided. If they do not contain the answer, reply exactly 'General knowledge'. Cite passage numbers you used.",
      messages: [{ role: "user", content: `Passages:\n${passages}\n\nQuestion: Summarize what these passages are about in one sentence.` }],
      max_tokens: 200,
    });
    expect(result.ok).toBe(true);
    expect((result.content ?? "").length).toBeGreaterThan(10);
    console.error("[A7 live] grounded answer:", (result.content ?? "").slice(0, 300));
  }, 40000);

  it("A5: recall reads a person's live neuro_memory (warm read path is consistent)", async () => {
    const mem = (await get("neuro_memory?forgotten_at=is.null&select=subject&limit=1"))[0];
    expect(mem?.subject).toMatch(/^(person|course|room|prof):/);
    const store = postgrestStore(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
    const mems = await recall(store, [mem.subject], { reinforce: false }); // reinforce:false → read-only, no prod write
    expect(Array.isArray(mems)).toBe(true);
    expect(mems.every(m => m.subject === mem.subject)).toBe(true);
  }, 20000);
});

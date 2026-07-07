// Seeds the "shared wisdom" teaching_strategies pool with a curated starter set
// so the pattern-recognition hint (find_teaching_strategy_hint) has something
// real to surface before organic session-close harvesting has had time to build
// up a pool on its own. Safe to re-run: harvest_teaching_strategy finds-and-
// reinforces an existing similar card rather than duplicating it (see
// supabase-teaching-strategies-migration.sql, cosine distance < 0.15).
//
// Usage: node scripts/seed-teaching-strategies.mjs
// Requires .env.local with SUPABASE_URL, SUPABASE_SERVICE_KEY, OPENAI_API_KEY.

import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";

const env = readFileSync(".env.local", "utf8");
const get = (k) => (env.match(new RegExp(`^${k}=(.+)$`, "m"))?.[1] || "").trim().replace(/^["']|["']$/g, "");

const SUPABASE_URL = get("SUPABASE_URL") || get("VITE_SUPABASE_URL");
const SERVICE_KEY  = get("SUPABASE_SERVICE_KEY");
const OPENAI_KEY   = get("OPENAI_API_KEY");

if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("Missing SUPABASE_URL / SUPABASE_SERVICE_KEY in .env.local");
if (!OPENAI_KEY) throw new Error("Missing OPENAI_API_KEY in .env.local");

const sb = createClient(SUPABASE_URL, SERVICE_KEY);

async function embed(text) {
  const r = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({ model: "text-embedding-3-small", input: text }),
  });
  if (!r.ok) throw new Error(`OpenAI embed failed: ${r.status} ${await r.text()}`);
  const data = await r.json();
  return data.data[0].embedding;
}

// Curated starter set — intro CS / data structures / SQL / stats concepts, the
// kind of material an early-semester CS/Data Science student actually asks
// about. Spans all 7 strategy_kind values so retrieval has real diversity to
// draw from, not just one technique repeated.
const SEED = [
  { concept: "linked list traversal and pointers", kind: "concrete_example", summary: "Walked through a step-by-step diagram tracing each node's pointer to the next, using boxes-and-arrows rather than describing it abstractly." },
  { concept: "linked list traversal and pointers", kind: "dual_coding", summary: "Paired a verbal explanation with a hand-drawn node diagram so the visual and verbal descriptions reinforced each other." },
  { concept: "recursion and base cases", kind: "concrete_example", summary: "Traced a concrete small input (like factorial of 3) step by step instead of explaining the general pattern first." },
  { concept: "recursion and base cases", kind: "self_explanation", summary: "Asked the student to explain in their own words why the base case stops the recursion before moving to a new example." },
  { concept: "binary search tree operations", kind: "concrete_example", summary: "Walked through inserting and searching a few numbers into a small tree, drawing the tree at each step." },
  { concept: "binary search tree operations", kind: "elaborative_interrogation", summary: "Asked why the tree stays ordered after each insertion, prompting the student to reason about the invariant rather than just being told." },
  { concept: "big-O time complexity", kind: "concrete_example", summary: "Compared runtime growth using small concrete input sizes rather than only abstract notation." },
  { concept: "big-O time complexity", kind: "interleaving", summary: "Mixed examples of different complexity classes back to back so the student had to distinguish them rather than drilling one at a time." },
  { concept: "SQL joins", kind: "concrete_example", summary: "Used a small two-table example with a handful of rows each so the student could trace exactly which rows matched." },
  { concept: "SQL joins", kind: "self_explanation", summary: "Had the student predict the join result before running the query, then compared it to what actually happened." },
  { concept: "hash tables and collisions", kind: "concrete_example", summary: "Walked through inserting a few keys into a small hash table and hitting a collision, rather than describing collision resolution abstractly." },
  { concept: "hash tables and collisions", kind: "dual_coding", summary: "Drew the hash table as buckets alongside the verbal explanation of the hashing function." },
  { concept: "arrays vs linked lists tradeoffs", kind: "retrieval_practice", summary: "Asked the student to recall the tradeoffs from memory first, then filled in gaps, rather than presenting the comparison table upfront." },
  { concept: "arrays vs linked lists tradeoffs", kind: "interleaving", summary: "Alternated questions between array and linked-list scenarios so the student had to actively distinguish which structure fit each case." },
  { concept: "gradient descent and basic optimization", kind: "concrete_example", summary: "Traced a few numeric steps of gradient descent on a simple one-variable function before discussing the general update rule." },
  { concept: "gradient descent and basic optimization", kind: "spaced_callback", summary: "Revisited the concept briefly in a later session to check retention before building on it." },
  { concept: "normalization in relational databases", kind: "concrete_example", summary: "Walked through denormalized vs normalized versions of the same small table to make the tradeoff concrete." },
  { concept: "probability distributions in intro statistics", kind: "concrete_example", summary: "Used a simple dice-roll example to ground the abstract distribution concept before generalizing." },
  { concept: "probability distributions in intro statistics", kind: "elaborative_interrogation", summary: "Asked why the distribution looked the way it did rather than just stating its properties." },
  { concept: "amortized time analysis", kind: "spaced_callback", summary: "Checked back on amortized analysis understanding in a follow-up session after first introducing it." },
];

console.log(`Seeding ${SEED.length} teaching-strategy cards...\n`);
let ok = 0, fail = 0;
for (const row of SEED) {
  try {
    const embedding = await embed(row.concept);
    const { data: strategyId, error } = await sb.rpc("harvest_teaching_strategy", {
      p_concept: row.concept,
      p_concept_embedding: embedding,
      p_strategy_kind: row.kind,
      p_strategy_summary: row.summary,
    });
    if (error) throw error;
    console.log(`  ok  [${row.kind}] ${row.concept} -> ${strategyId}`);
    ok++;
  } catch (err) {
    console.error(`  FAIL [${row.kind}] ${row.concept}:`, err.message || err);
    fail++;
  }
}
console.log(`\nDone: ${ok} seeded, ${fail} failed.`);
process.exit(fail ? 1 : 0);

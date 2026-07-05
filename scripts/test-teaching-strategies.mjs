// Deep integration test for the pattern-recognition "shared wisdom" layer:
// harvest → de-identify → store → retrieve → personalize → feedback loop.
// Requires supabase-teaching-strategies-migration.sql to have been run first.
import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";

const env = readFileSync(".env.local", "utf8");
const get = (k) => (env.match(new RegExp(`^${k}=(.+)$`, "m"))?.[1] || "").trim().replace(/^["']|["']$/g, "");
const SUPA_URL = get("VITE_SUPABASE_URL") || get("SUPABASE_URL");
const ANON = get("VITE_SUPABASE_ANON_KEY");
const DEV = "http://localhost:5173";
const userA = "fixture-test-user";
const userB = "fixture-test-user-teaching-b";
const sb = createClient(SUPA_URL, ANON);

let pass = 0, fail = 0;
const check = (name, cond, detail = "") => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}  ${String(detail).slice(0, 300)}`); }
};
const post = async (path, body) => {
  const res = await fetch(`${DEV}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  let json = null; try { json = await res.json(); } catch {}
  return { status: res.status, json };
};

console.log("\n═══ SEED ═══");
await sb.from("users").upsert({ id: userA, name: "Fixture A" }, { onConflict: "id" });
await sb.from("users").upsert({ id: userB, name: "Fixture B" }, { onConflict: "id" });

const TEST_CONCEPT = "photosynthesis light-dependent reactions (test fixture)";
await sb.from("teaching_strategies").delete().eq("concept", TEST_CONCEPT);
await sb.from("student_strategy_affinity").delete().in("user_id", [userA, userB]);

console.log("\n═══ SCHEMA-LEVEL PRIVACY: no user_id column exists at all ═══");
// Not "wasn't selected" — genuinely doesn't exist in the table, same technique
// that caught the schools/users column bugs earlier: ask for it, expect PostgREST
// to reject it with "column does not exist."
const { error: colErr } = await sb.from("teaching_strategies").select("user_id").limit(1);
check("teaching_strategies has NO user_id column at all", !!colErr && /column .*user_id.* does not exist/i.test(colErr.message), colErr?.message);

console.log("\n═══ RPC-LEVEL: harvest_teaching_strategy (deterministic) ═══");
// The RPC only does vector math — a synthetic embedding exercises the matching
// logic exactly as well as a real OpenAI one for this purpose.
const fakeEmbedding = Array.from({ length: 1536 }, (_, i) => Math.sin(i) * 0.01);

const { data: firstId, error: e1 } = await sb.rpc("harvest_teaching_strategy", {
  p_concept: TEST_CONCEPT,
  p_concept_embedding: fakeEmbedding,
  p_strategy_kind: "concrete_example",
  p_strategy_summary: "walked through a step-by-step worked example rather than an abstract description",
});
check("harvest inserts a new card", !e1 && !!firstId, e1?.message);

const { data: card1 } = await sb.from("teaching_strategies")
  .select("success_count,attempt_count,strategy_kind").eq("strategy_id", firstId).maybeSingle();
check("  ↳ new card starts at success=1, attempt=1", card1?.success_count === 1 && card1?.attempt_count === 1, JSON.stringify(card1));

// Reinforce: same concept + same kind → should strengthen the SAME row, not duplicate it
const { data: secondId, error: e2 } = await sb.rpc("harvest_teaching_strategy", {
  p_concept: TEST_CONCEPT,
  p_concept_embedding: fakeEmbedding,
  p_strategy_kind: "concrete_example",
  p_strategy_summary: "a slightly different phrasing of the same worked-example approach",
});
check("harvest reinforces the existing card (same id, not a duplicate)", !e2 && secondId === firstId, `first=${firstId} second=${secondId}`);

const { data: card2 } = await sb.from("teaching_strategies")
  .select("success_count,attempt_count").eq("strategy_id", firstId).maybeSingle();
check("  ↳ counts incremented, not reset (2/2, not 1/1 again)", card2?.success_count === 2 && card2?.attempt_count === 2, JSON.stringify(card2));

console.log("\n═══ RPC-LEVEL: bump_student_strategy_affinity (atomic increment, not overwrite) ═══");
await sb.rpc("bump_student_strategy_affinity", { p_user_id: userA, p_strategy_kind: "concrete_example", p_success: true });
await sb.rpc("bump_student_strategy_affinity", { p_user_id: userA, p_strategy_kind: "concrete_example", p_success: true });
await sb.rpc("bump_student_strategy_affinity", { p_user_id: userA, p_strategy_kind: "concrete_example", p_success: false });
const { data: affinity } = await sb.from("student_strategy_affinity")
  .select("success_count,attempt_count").eq("user_id", userA).eq("strategy_kind", "concrete_example").maybeSingle();
check("affinity accumulates correctly across calls (2 success, 3 attempts)", affinity?.success_count === 2 && affinity?.attempt_count === 3, JSON.stringify(affinity));

console.log("\n═══ RPC-LEVEL: find_teaching_strategy_hint (personalization + privacy) ═══");
// User B has no affinity history yet — should still get a hint via the card's global rate.
const { data: hintForB, error: e3 } = await sb.rpc("find_teaching_strategy_hint", {
  p_concept_embedding: fakeEmbedding, p_user_id: userB, p_limit: 3,
});
check("cold-start (no personal history) still returns a hint via the global rate", !e3 && hintForB?.length > 0, e3?.message);
check("  ↳ hint carries no identifying info — just kind + summary + rates", hintForB?.[0] && !("user_id" in hintForB[0]) && !("room_id" in hintForB[0]), JSON.stringify(hintForB?.[0]));
check("  ↳ personal_rate is null for a student with no history (not 0, not guessed)", hintForB?.[0]?.personal_rate === null, JSON.stringify(hintForB?.[0]));

// User A now has personal history with this kind — ranking should reflect it.
const { data: hintForA } = await sb.rpc("find_teaching_strategy_hint", {
  p_concept_embedding: fakeEmbedding, p_user_id: userA, p_limit: 3,
});
check("  ↳ personal_rate reflects this specific student's own history (2/3)", Math.abs((hintForA?.[0]?.personal_rate ?? -1) - (2 / 3)) < 0.01, JSON.stringify(hintForA?.[0]));

console.log("\n═══ END-TO-END: real session-close harvest through the live API ═══");
const scriptedTranscript = [
  { role: "user", content: "I really don't understand recursion at all, it just confuses me completely." },
  { role: "assistant", content: "Think of it like Russian nesting dolls — each function call opens a smaller doll inside, until you hit the smallest one (the base case), then they close back up one by one. Want to trace through an example?" },
  { role: "user", content: "Yes please, walk me through factorial(3)." },
  { role: "assistant", content: "factorial(3) calls factorial(2) calls factorial(1) calls factorial(0), which returns 1. Then it multiplies back up: 1×1=1, ×2=2, ×3=6." },
  { role: "user", content: "Oh wow, that actually makes total sense now! The nesting dolls thing really clicked for me. I finally get recursion." },
];
const closeRes = await post("/api/session-close", { userId: userA, sessionMessages: scriptedTranscript });
check("session-close accepts the transcript", closeRes.status === 200, JSON.stringify(closeRes));

// The harvest chain isn't awaited by the HTTP response (fire-and-forget past the
// classification step) — poll briefly rather than assume it lands instantly.
let harvested = null;
for (let i = 0; i < 12 && !harvested; i++) {
  await new Promise(r => setTimeout(r, 1500));
  const { data } = await sb.from("teaching_strategies")
    .select("strategy_id,concept,strategy_kind,strategy_summary")
    .ilike("concept", "%recursion%").order("created_at", { ascending: false }).limit(1);
  harvested = data?.[0] ?? null;
}
check("a real session produced a harvested card (LLM-classified — may occasionally miss on a given run)", !!harvested, "no card found after 18s — the classifier may not have detected resolution this run");

if (harvested) {
  check("  ↳ strategy_summary contains no verbatim personal phrasing from the transcript", !/factorial\(3\)|nesting dolls/i.test(harvested.strategy_summary || ""), harvested.strategy_summary);

  const { data: provRows } = await sb.from("strategy_provenance").select("user_id").eq("strategy_id", harvested.strategy_id);
  check("  ↳ provenance correctly attributes this card to user A (erasure-only table)", provRows?.some(r => r.user_id === userA), JSON.stringify(provRows));
}

console.log("\n═══ CLEANUP ═══");
await sb.from("teaching_strategies").delete().eq("concept", TEST_CONCEPT);
if (harvested) {
  await sb.from("strategy_provenance").delete().eq("strategy_id", harvested.strategy_id);
  await sb.from("teaching_strategies").delete().eq("strategy_id", harvested.strategy_id);
}
await sb.from("student_strategy_affinity").delete().in("user_id", [userA, userB]);
console.log("  cleaned");

console.log(`\n═══ RESULT: ${pass} passed, ${fail} failed ═══`);
process.exit(fail ? 1 : 0);

// scripts/seed-studyroom-fixture.mjs — QA-01 fixture for the Study Room sprint.
//
// Seeds a DETERMINISTIC, IDEMPOTENT, self-tagged scenario:
//   "three students, two Brains, one course, seven documents, known board state".
// Every row it writes carries the marker "zfix" (user ids zfix-stu-1|2|3, names
// "ZFix Alpha/Beta/Gamma", room "ZFIX Study Room", rag titles prefixed "ZFIX ") so
// the whole fixture is trivially findable and removable (`--clean`).
//
// All ids are HARDCODED literal uuids so re-runs upsert onto the same rows.
//
//   node scripts/seed-studyroom-fixture.mjs           # upsert the fixture
//   node scripts/seed-studyroom-fixture.mjs --clean    # delete all zfix rows (dependency order)
//
// Writes go through PostgREST with the SERVICE key (RLS bypass). Secrets are never printed.
//
// ── Live-schema realities this seeder adapts to (verified against the prod DB) ──────────
//  • courses.id is GENERATED ALWAYS AS IDENTITY (bigint) and study_rooms.course_id has a
//    REAL FK -> courses(id). So the synthetic id 999900777 is NOT usable (identity columns
//    reject explicit values, and the FK would fail with no matching row). Per the task's
//    "if an FK exists, pick any approach that works" — we insert a zfix-owned course, let
//    identity assign its id, and point the room at that id (idempotent via the
//    (user_id, canvas_course_id) unique key).
//  • rag_chunks.tsv is a GENERATED ALWAYS column — we must NOT insert it; FTS works purely
//    from `content` (embedding is left null on purpose, per the task).
//  • users.learning_style / users.help_seeking carry CHECK constraints with a FIXED
//    vocabulary. The requested conceptual values (visual/example/discussion and
//    asks_early/waits/never_asks) are NOT in that vocabulary and would violate the checks,
//    so we map them to the nearest allowed enum on the column AND preserve the full
//    conceptual intent in each Brain profile (teaching_preferences + invite_style), which
//    is what the room composer actually consumes. Mapping is documented at USERS below.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import * as Y from "yjs";

// ── env ────────────────────────────────────────────────────────────────────────────────
const ENV_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "../.env.local");
function loadEnv(path) {
  const out = {};
  let text = "";
  try { text = readFileSync(path, "utf8"); } catch { return out; }
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}
const ENV = loadEnv(ENV_PATH);
const SUPABASE_URL = ENV.SUPABASE_URL || ENV.VITE_SUPABASE_URL;
const SERVICE_KEY = ENV.SUPABASE_SERVICE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error(`Missing SUPABASE_URL / SUPABASE_SERVICE_KEY in ${ENV_PATH}`);
  process.exit(1);
}
const REST = `${SUPABASE_URL.replace(/\/$/, "")}/rest/v1`;

// ── PostgREST helper (service key) ────────────────────────────────────────────────────
async function pg(method, table, { query = "", body = null, prefer = "" } = {}) {
  const headers = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
  };
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(`${REST}/${table}${query}`, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON (e.g. empty) */ }
  if (!res.ok) {
    throw new Error(`${method} ${table} -> ${res.status}: ${text.slice(0, 400)}`);
  }
  return json;
}
// upsert = POST with merge-duplicates on a conflict target, returning the rows.
const upsert = (table, rows, onConflict) =>
  pg("POST", table, {
    query: `?on_conflict=${onConflict}`,
    body: rows,
    prefer: "resolution=merge-duplicates,return=representation",
  });
// delete rows matching a PostgREST filter, returning what was removed (for counts).
const del = (table, filter) =>
  pg("DELETE", table, { query: `?${filter}`, prefer: "return=representation" });

// ── Fixed literal identifiers (all hex-valid uuids; re-runs upsert onto these) ─────────
const USER_IDS = ["zfix-stu-1", "zfix-stu-2", "zfix-stu-3"];
const ROOM_ID = "1f1c9007-0000-4000-8000-000000000001";
const DOC_IDS = [
  "1f1cd0c0-0000-4000-8000-000000000001",
  "1f1cd0c0-0000-4000-8000-000000000002",
  "1f1cd0c0-0000-4000-8000-000000000003",
  "1f1cd0c0-0000-4000-8000-000000000004",
  "1f1cd0c0-0000-4000-8000-000000000005",
  "1f1cd0c0-0000-4000-8000-000000000006",
  "1f1cd0c0-0000-4000-8000-000000000007",
];
const SECTION_IDS = [
  "1f1c5ec0-0000-4000-8000-000000000001",
  "1f1c5ec0-0000-4000-8000-000000000002",
  "1f1c5ec0-0000-4000-8000-000000000003",
  "1f1c5ec0-0000-4000-8000-000000000004",
  "1f1c5ec0-0000-4000-8000-000000000005",
  "1f1c5ec0-0000-4000-8000-000000000006",
  "1f1c5ec0-0000-4000-8000-000000000007",
];
// two chunks per document (indices 0..13)
const CHUNK_IDS = [
  "1f1cc8b0-0000-4000-8000-000000000001", "1f1cc8b0-0000-4000-8000-000000000002",
  "1f1cc8b0-0000-4000-8000-000000000003", "1f1cc8b0-0000-4000-8000-000000000004",
  "1f1cc8b0-0000-4000-8000-000000000005", "1f1cc8b0-0000-4000-8000-000000000006",
  "1f1cc8b0-0000-4000-8000-000000000007", "1f1cc8b0-0000-4000-8000-000000000008",
  "1f1cc8b0-0000-4000-8000-000000000009", "1f1cc8b0-0000-4000-8000-00000000000a",
  "1f1cc8b0-0000-4000-8000-00000000000b", "1f1cc8b0-0000-4000-8000-00000000000c",
  "1f1cc8b0-0000-4000-8000-00000000000d", "1f1cc8b0-0000-4000-8000-00000000000e",
];
const BRAIN_VERSION_IDS = {
  "zfix-stu-1": "1f1cb9a0-0000-4000-8000-000000000001",
  "zfix-stu-2": "1f1cb9a0-0000-4000-8000-000000000002",
};
const COURSE_CONFLICT = { user_id: "zfix-stu-1", canvas_course_id: "zfix-course-1" };

// ── Users (learning_style/help_seeking mapped to the live CHECK vocabulary) ────────────
// requested (conceptual)          -> live enum       (intent preserved in the Brain profile)
//  stu-1 visual      / asks_early  -> diagram / explain
//  stu-2 example     / waits       -> problem / notes
//  stu-3 discussion  / never_asks  -> talk    / grind
const USERS = [
  { id: "zfix-stu-1", name: "ZFix Alpha", email: "zfix-1@fixture.invalid", learning_style: "diagram", help_seeking: "explain" },
  { id: "zfix-stu-2", name: "ZFix Beta",  email: "zfix-2@fixture.invalid", learning_style: "problem", help_seeking: "notes"   },
  { id: "zfix-stu-3", name: "ZFix Gamma", email: "zfix-3@fixture.invalid", learning_style: "talk",    help_seeking: "grind"   },
];

// ── Seven documents owned by zfix-stu-1 (content chosen so FTS lexemes are meaningful) ──
const DOC_SPECS = [
  { title: "ZFIX Glycolysis Notes",           chunks: ["Glycolysis breaks one glucose molecule into two pyruvate molecules in the cytoplasm and yields a net of two ATP and two NADH. It is the first stage of cellular respiration and does not require oxygen.", "The glycolysis pathway has an energy-investment phase and an energy-payoff phase; hexokinase and phosphofructokinase are key regulated enzymes."] },
  { title: "ZFIX Electron Transport Chain",   chunks: ["The electron transport chain (ETC) is embedded in the inner mitochondrial membrane and passes electrons from NADH and FADH2 through a series of complexes to oxygen.", "As electrons move through the ETC, protons are pumped into the intermembrane space, building the gradient that ATP synthase uses to make ATP via chemiosmosis."] },
  { title: "ZFIX Krebs Cycle Overview",       chunks: ["The Krebs cycle (citric acid cycle) oxidizes acetyl-CoA in the mitochondrial matrix, releasing carbon dioxide and reducing NAD+ and FAD to NADH and FADH2.", "Each turn of the Krebs cycle produces one GTP (or ATP) by substrate-level phosphorylation, and two turns process the pyruvate from one glucose."] },
  { title: "ZFIX Photosynthesis Primer",      chunks: ["Photosynthesis captures light energy in the chloroplast, splitting water and producing oxygen during the light-dependent reactions.", "The Calvin cycle uses ATP and NADPH to fix carbon dioxide into glucose in the stroma; it is light-independent but depends on the products of the light reactions."] },
  { title: "ZFIX Cell Membrane Transport",    chunks: ["The cell membrane is a phospholipid bilayer; small nonpolar molecules diffuse freely while ions and large molecules require transport proteins.", "Active transport such as the sodium-potassium pump moves ions against their gradient using ATP, whereas facilitated diffusion needs no energy."] },
  { title: "ZFIX Enzyme Kinetics",            chunks: ["Enzymes lower activation energy and are described by Michaelis-Menten kinetics, where Km reflects substrate affinity and Vmax the maximum rate.", "Competitive inhibitors raise the apparent Km while non-competitive inhibitors lower Vmax; temperature and pH shift enzyme activity."] },
  { title: "ZFIX Genetics Primer",            chunks: ["Mendelian genetics describes how alleles segregate; a Punnett square predicts genotype and phenotype ratios for a monohybrid cross.", "DNA is transcribed into messenger RNA and translated into protein at the ribosome; mutations can be silent, missense, or nonsense."] },
];

// ── Brain profiles (shape copied manually from api/_contracts.ts so validateBrainProfile
//    passes). stu-1 has strength "glycolysis" 0.9; stu-2 has gap "glycolysis" 0.8 so the
//    room composer pairs them (explainer stu-1 / listener stu-2). ─────────────────────────
const BRAIN_PROFILES = {
  "zfix-stu-1": {
    identity: { display_name: "ZFix Alpha" },
    strengths: [
      { topic: "glycolysis", confidence: 0.9, evidence: [{ kind: "quiz", ref: "zfix-quiz-glycolysis", note: "aced all glycolysis items" }] },
      { topic: "cellular respiration overview", confidence: 0.7 },
    ],
    gaps: [{ topic: "electron transport chain", confidence: 0.4 }],
    teaching_preferences: ["visual", "diagram_first", "stepwise"],
    known_examples: ["assembly-line analogy for glycolysis"],
    mastery_evidence: [{ kind: "quiz", ref: "zfix-quiz-glycolysis", note: "5/5" }],
    interaction_preferences: { invite_style: "gentle_direct", private_first: false },
    accessibility: [],
    do_not_use: [],
  },
  "zfix-stu-2": {
    identity: { display_name: "ZFix Beta" },
    strengths: [{ topic: "krebs cycle", confidence: 0.6 }],
    gaps: [{ topic: "glycolysis", confidence: 0.8, evidence: [{ kind: "session", ref: "zfix-sess-1", note: "confused about net ATP yield" }] }],
    teaching_preferences: ["worked_example", "example_first"],
    known_examples: [],
    mastery_evidence: [],
    interaction_preferences: { invite_style: "open_invite", private_first: true },
    accessibility: [],
    do_not_use: [],
  },
};

// ── Known board state: a Yjs doc with 2 text strokes + a meta map, base64-encoded ──────
function buildYjsBoardBase64() {
  const doc = new Y.Doc();
  const strokes = doc.getArray("strokes");
  const meta = doc.getMap("meta");
  strokes.push([
    { id: "zfix-stroke-1", mode: "draw", style: "text", color: "#111827", width: 2, points: [{ x: 120, y: 80, t: "ZFIX ETC diagram" }] },
    { id: "zfix-stroke-2", mode: "draw", style: "text", color: "#2563eb", width: 2, points: [{ x: 240, y: 160, t: "ZFIX glycolysis steps" }] },
  ]);
  meta.set("title", "ZFIX board");
  meta.set("revision", 1);
  const update = Y.encodeStateAsUpdate(doc);
  return Buffer.from(update).toString("base64");
}

// ── Row builders ───────────────────────────────────────────────────────────────────────
function buildDocuments() {
  const docs = [], sections = [], chunks = [];
  DOC_SPECS.forEach((spec, i) => {
    docs.push({ id: DOC_IDS[i], user_id: "zfix-stu-1", course_id: null, title: spec.title, kind: "text", source_url: null });
    sections.push({
      id: SECTION_IDS[i], document_id: DOC_IDS[i], user_id: "zfix-stu-1", course_id: null,
      heading: spec.title, ordinal: 0, loc_start: 0, loc_end: spec.chunks.join("\n\n").length,
      full_text: spec.chunks.join("\n\n"),
    });
    spec.chunks.forEach((content, j) => {
      chunks.push({
        id: CHUNK_IDS[i * 2 + j], section_id: SECTION_IDS[i], document_id: DOC_IDS[i],
        user_id: "zfix-stu-1", course_id: null, content, // tsv is GENERATED — never set it; embedding stays null
      });
    });
  });
  return { docs, sections, chunks };
}

// ── Seed ──────────────────────────────────────────────────────────────────────────────
async function seed() {
  const counts = {};

  // 1. users
  counts.users = (await upsert("users", USERS, "id")).length;

  // 2. course (identity-assigned id; idempotent via (user_id, canvas_course_id))
  const courseRows = await upsert("courses", [{
    ...COURSE_CONFLICT, name: "ZFIX Biology 101", course_code: "ZFIX-BIO",
    source: "manual", color: "#7c3aed", semester: "ZFIX",
  }], "user_id,canvas_course_id");
  const courseId = courseRows[0]?.id;
  counts.courses = courseRows.length;

  // 3. study_room (course_id -> the zfix course; known board state in yjs_doc)
  counts.study_rooms = (await upsert("study_rooms", [{
    id: ROOM_ID, created_by: "zfix-stu-1", name: "ZFIX Study Room",
    course_id: courseId ?? null, room_type: "public", join_code: "ZFIX01",
    topic: "ZFIX cellular respiration", ai_mode: "facilitator",
    yjs_doc: buildYjsBoardBase64(),
  }], "id")).length;

  // 4. room_members — all three joined; stu-1 is host
  counts.room_members = (await upsert("room_members", [
    { room_id: ROOM_ID, user_id: "zfix-stu-1", role: "host",   status: "joined" },
    { room_id: ROOM_ID, user_id: "zfix-stu-2", role: "member", status: "joined" },
    { room_id: ROOM_ID, user_id: "zfix-stu-3", role: "member", status: "joined" },
  ], "room_id,user_id")).length;

  // 5. rag documents / sections / chunks (7 docs, 1 section + 2 chunks each)
  const { docs, sections, chunks } = buildDocuments();
  counts.rag_documents = (await upsert("rag_documents", docs, "id")).length;
  counts.rag_sections = (await upsert("rag_sections", sections, "id")).length;
  counts.rag_chunks = (await upsert("rag_chunks", chunks, "id")).length;

  // 6. Brains — one immutable brain_versions row per student, student_brains points at it
  const versions = USER_IDS.filter(u => BRAIN_PROFILES[u]).map(u => ({
    id: BRAIN_VERSION_IDS[u], user_id: u, schema_version: 1,
    profile: BRAIN_PROFILES[u], markdown: null, source: "init",
  }));
  counts.brain_versions = (await upsert("brain_versions", versions, "id")).length;
  counts.student_brains = (await upsert("student_brains", versions.map(v => ({
    user_id: v.user_id, active_version_id: v.id,
    consent_room_pedagogy: true, consent_updates: true,
  })), "user_id")).length;

  return counts;
}

// ── Clean (child -> parent so no FK ever blocks a delete) ──────────────────────────────
async function clean() {
  const counts = {};
  const inUsers = `in.(${USER_IDS.join(",")})`;
  const inDocs = `in.(${DOC_IDS.join(",")})`;
  counts.student_brains = (await del("student_brains", `user_id=${inUsers}`)).length;
  counts.brain_versions = (await del("brain_versions", `user_id=${inUsers}`)).length;
  counts.rag_chunks = (await del("rag_chunks", `document_id=${inDocs}`)).length;
  counts.rag_sections = (await del("rag_sections", `document_id=${inDocs}`)).length;
  counts.rag_documents = (await del("rag_documents", `id=${inDocs}`)).length;
  counts.room_members = (await del("room_members", `room_id=eq.${ROOM_ID}`)).length;
  counts.study_rooms = (await del("study_rooms", `id=eq.${ROOM_ID}`)).length;
  counts.courses = (await del("courses", `user_id=eq.${COURSE_CONFLICT.user_id}&canvas_course_id=eq.${COURSE_CONFLICT.canvas_course_id}`)).length;
  counts.users = (await del("users", `id=${inUsers}`)).length;
  return counts;
}

// ── main ──────────────────────────────────────────────────────────────────────────────
const CLEAN = process.argv.includes("--clean");
(async () => {
  const label = CLEAN ? "deleted" : "upserted";
  const counts = CLEAN ? await clean() : await seed();
  console.log(`\nZFIX study-room fixture — ${CLEAN ? "CLEAN" : "SEED"} (${label} row counts):`);
  for (const [table, n] of Object.entries(counts)) {
    console.log(`  ${table.padEnd(16)} ${n}`);
  }
  console.log("");
})().catch(err => {
  console.error("FIXTURE ERROR:", err?.message || err);
  process.exit(1);
});

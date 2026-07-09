// One-off manual test for the Digest Lecture pipeline against the running dev server.
// node scripts/test-digest.mjs
import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";

const env = readFileSync(".env.local", "utf8");
const get = (k) => (env.match(new RegExp(`^${k}=(.+)$`, "m"))?.[1] || "").trim().replace(/^["']|["']$/g, "");
const SUPA_URL = get("VITE_SUPABASE_URL") || get("SUPABASE_URL");
const ANON = get("VITE_SUPABASE_ANON_KEY");
const DEV = process.env.DEV_URL || "http://localhost:5173";
const userId = "fixture-test-user";
const sb = createClient(SUPA_URL, ANON);

const buf = readFileSync("test-lecture.wav");

console.log("1) signing upload...");
const sres = await fetch(`${DEV}/api/digest-lecture?action=sign`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ userId, filename: "test-lecture.wav" }),
});
const sdata = await sres.json();
if (!sres.ok) { console.error("sign failed:", sdata); process.exit(1); }
console.log("   path:", sdata.path);

console.log("2) uploading to storage...");
const up = await sb.storage.from(sdata.bucket || "media-uploads").uploadToSignedUrl(sdata.path, sdata.token, buf, { contentType: "audio/wav" });
if (up.error) { console.error("upload failed:", up.error); process.exit(1); }
console.log("   uploaded OK");

console.log("3) starting pipeline (transcribe -> emphasis -> digest)...");
const t0 = Date.now();
const startRes = await fetch(`${DEV}/api/digest-lecture?action=start`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ userId, storagePath: sdata.path, title: "Test Lecture — Cellular Respiration" }),
});
const startData = await startRes.json();
console.log(`   done in ${((Date.now() - t0) / 1000).toFixed(1)}s, status ${startRes.status}`);
console.log(JSON.stringify(startData, null, 2));

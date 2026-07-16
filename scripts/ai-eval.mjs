#!/usr/bin/env node
// scripts/ai-eval.mjs — AI-13 eval runner. Thin cross-platform wrapper that runs the
// offline eval harness (test/eval-harness.test.ts) with EVAL_REPORT=1 so it writes
// eval-report.md at the repo root, then prints where the report landed.
//
//   node scripts/ai-eval.mjs
//
// The harness itself is plain vitest — `npx vitest run test/eval-harness.test.ts`
// runs the same checks without writing the report.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const report = resolve(root, "eval-report.md");

const r = spawnSync("npx", ["vitest", "run", "test/eval-harness.test.ts"], {
  cwd: root,
  env: { ...process.env, EVAL_REPORT: "1" },
  stdio: "inherit",
  shell: process.platform === "win32", // npx is npx.cmd on Windows
});

if (r.error) {
  console.error(`[ai-eval] failed to launch vitest: ${r.error.message}`);
  process.exit(1);
}
const code = r.status ?? 1;
if (existsSync(report)) {
  console.log(`\n[ai-eval] ${code === 0 ? "PASS" : "FAIL"} — report written to ${report}`);
} else {
  console.log(`\n[ai-eval] ${code === 0 ? "PASS" : "FAIL"} — no report file was written (harness may have crashed before afterAll)`);
}
process.exit(code);

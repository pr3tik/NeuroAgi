// @vitest-environment node
// Guard: on Vercel/Node ESM, relative dynamic imports in api/ MUST carry a .js extension
// or they throw ERR_MODULE_NOT_FOUND at runtime (silently, if wrapped in try/catch).
// Regression: api/extract.ts did `import("./rag")` (no .js) → uploaded files silently
// never got RAG-ingested on prod, so the tutor couldn't use uploaded materials.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";

describe("api/ ESM dynamic imports", () => {
  it("every relative dynamic import uses a .js extension", () => {
    const apiDir = join(process.cwd(), "api");
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(ts|js|mjs)$/.test(e.name)) {
          const src = readFileSync(p, "utf8");
          for (const m of src.matchAll(/import\((['"])(\.\.?\/[^'"]*)\1\)/g)) {
            if (!/\.(js|mjs|json)$/.test(m[2])) offenders.push(`${e.name}: import("${m[2]}")`);
          }
        }
      }
    };
    walk(apiDir);
    expect(offenders, `extensionless relative dynamic import(s) in api/:\n${offenders.join("\n")}`).toEqual([]);
  });
});

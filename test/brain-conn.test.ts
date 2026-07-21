// @vitest-environment node
// brainConn(): the memory-store connection selector. NEURO_SUPABASE_* (both) → NeuroAGI project;
// else the product DB; half-config throws loudly. brainConn reads process.env at call time.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { brainConn, productConn } from "../api/_brain/conn.ts";

const saved = { ...process.env };
beforeEach(() => {
  delete process.env.NEURO_SUPABASE_URL;
  delete process.env.NEURO_SUPABASE_SERVICE_KEY;
  process.env.SUPABASE_URL = "http://prod";
  process.env.SUPABASE_SERVICE_KEY = "prod-key";
});
afterEach(() => { process.env = { ...saved }; });

describe("brainConn", () => {
  it("falls back to the product DB when NEURO_* is unset (prod unchanged)", () => {
    expect(brainConn()).toEqual({ url: "http://prod", key: "prod-key" });
    expect(productConn()).toEqual({ url: "http://prod", key: "prod-key" });
  });
  it("uses NEURO_SUPABASE_* when both are set", () => {
    process.env.NEURO_SUPABASE_URL = "http://v2";
    process.env.NEURO_SUPABASE_SERVICE_KEY = "v2-key";
    expect(brainConn()).toEqual({ url: "http://v2", key: "v2-key" });
  });
  it("throws on a half-configured NEURO_* (loud misconfig, never a silent product fallback)", () => {
    process.env.NEURO_SUPABASE_URL = "http://v2"; // key missing
    expect(() => brainConn()).toThrow(/half-configured/);
  });
  it("returns null only when neither NEURO_* nor product is configured", () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_KEY;
    expect(brainConn()).toBeNull();
  });
});

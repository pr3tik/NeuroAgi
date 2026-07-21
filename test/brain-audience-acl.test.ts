// @vitest-environment node
// Regression for the BR-06 §9.4 audience-ACL gap: /api/brain must not let a caller grant read
// (audience) to a scope they don't belong to. Otherwise a memory written to the caller's OWN
// subject with audience:['*'] or ['person:<victim>'] would surface in the victim's recall (and
// thence their tutor prompt), because audience-aware recall matches rows whose audience overlaps
// the reader's scopes. We back the endpoint with a real in-memory kernel so the check is exercised
// end-to-end, not mocked away.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeRes } from "./helpers";

vi.mock("../api/_auth.ts", () => ({ requireUserOr401: vi.fn(async () => "u1") }));
vi.mock("../api/_brain/identity.ts", () => ({ resolveFschoolPerson: vi.fn(async () => "p1") }));
vi.mock("../api/_brain/conn.ts", () => ({ brainConn: () => null }));
vi.mock("../api/_brain/kernel.ts", async (orig) => {
  const actual: any = await orig();
  const store = new actual.InMemoryStore();     // one shared in-memory store for the whole test file
  return { ...actual, postgrestStore: () => store };
});

import brain from "../api/brain.ts";

const post = (body: any) => ({ method: "POST", query: { action: "remember" }, headers: {}, body });

beforeEach(() => {
  process.env.SUPABASE_URL = "http://localhost";
  process.env.SUPABASE_SERVICE_KEY = "test";
});

describe("/api/brain remember — audience is an ACL (BR-06 §9.4 leak closed)", () => {
  it("rejects a public '*' audience supplied from the body (403)", async () => {
    const res = makeRes();
    await brain(post({ kind: "signal", body: { x: 1 }, audience: ["*"] }), res);
    expect(res.statusCode).toBe(403);
  });

  it("rejects a directed audience to a scope the caller doesn't belong to (403)", async () => {
    const res = makeRes();
    await brain(post({ kind: "signal", body: { x: 1 }, audience: ["person:victim"] }), res);
    expect(res.statusCode).toBe(403);
  });

  it("rejects a non-array audience (400)", async () => {
    const res = makeRes();
    await brain(post({ kind: "signal", body: { x: 1 }, audience: "person:p1" }), res);
    expect(res.statusCode).toBe(400);
  });

  it("allows a normal write with no audience (200)", async () => {
    const res = makeRes();
    await brain(post({ kind: "signal", body: { x: 1 } }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("allows audience limited to the caller's OWN subject (a no-op, but legal) (200)", async () => {
    const res = makeRes();
    await brain(post({ kind: "signal", body: { x: 1 }, audience: ["person:p1"] }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

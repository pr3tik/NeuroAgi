// @vitest-environment node
// A6 / BR-06 — the isolation proof at the SERVICE BOUNDARY (not RLS — RLS proves nothing across a
// second Supabase project, nor does it adjudicate `subject`/`university_id` strings inside one table).
// Four adversarial invariants, each exercising a path actually built in A3 (course extraction) and
// A4 (person-brain adapter):
//   (a) no person-brain data reaches a GROUP thread
//   (b) no person-brain data reaches ANOTHER participant's PRIVATE thread
//   (c) no person-brain data can be written into course_content / any shared space (the path must not exist)
//   (d) no course_content row crosses university_id (A2 read scoping)
// Pure + mock-first (InMemoryStore / stubbed fetch) — runs in CI with no env, and is included in the
// ai-eval gate (scripts/ai-eval.mjs).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { makeRes } from "./helpers";
import { brainRead, brainWrite } from "../api/_brain/adapter.ts";
import * as adapterModule from "../api/_brain/adapter.ts";
import { InMemoryStore, remember } from "../api/_brain/kernel.ts";
import { buildRoomSystemPrompt } from "../api/_personas.ts";

const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const MARK_A = "PERSONBRAIN-MARKER-ALPHA";
const MARK_B = "PERSONBRAIN-MARKER-BETA";

async function brainOf(id: string, marker: string) {
  const s = new InMemoryStore();
  await remember(s, { subject: `person:${id}`, kind: "trait", body: { text: marker }, salience: 0.9 });
  return s;
}

function roomPrompt(overrides: any): string {
  return buildRoomSystemPrompt({
    intensity: "balanced",
    plan: overrides.scope === "group"
      ? { version: 1, participants: [
          { user_id: A, display_name: "Ava", invite_style: "open_invite", strengths: [], topic_gaps: [], teaching_preferences: ["visual"] },
          { user_id: B, display_name: "Ben", invite_style: "open_invite", strengths: [], topic_gaps: [], teaching_preferences: ["stepwise"] },
        ], group_strategy: { default_explanation: "visual_then_stepwise", peer_teaching_pairs: [], avoid: [] } }
      : null,
    studentProfileMarkdown: null,
    sources: [{ title: "Notes", excerpt: "Integration by parts." }],
    boardText: "u = ln x",
    boardRevision: 1,
    timer: { remainingMinutes: 20, blockGoal: "worksheet" },
    ...overrides,
  });
}

describe("BR-06 (a) — person-brain data never reaches a GROUP thread", () => {
  it("a person brain-state routed onto a group turn is dropped by the prompt boundary", async () => {
    const ctx = await brainRead(A, { store: await brainOf(A, MARK_A) });
    expect(ctx.brainState).toContain(MARK_A); // sanity: the marker IS in the read brain-state
    // Even if a caller mistakenly hands person-brain to a GROUP turn, the boundary must not render it.
    const prompt = roomPrompt({ scope: "group", persona: "facilitator", studentProfileMarkdown: ctx.brainState });
    expect(prompt).not.toContain(MARK_A);
    expect(prompt).not.toContain("STUDENT LEARNING PROFILE");
  });
});

describe("BR-06 (b) — person-brain data never reaches ANOTHER participant's PRIVATE thread", () => {
  it("B's private prompt carries B's brain and never A's", async () => {
    // brainRead is per-subject: B's turn reads person:B only; A's store is never consulted for B.
    const ctxB = await brainRead(B, { store: await brainOf(B, MARK_B) });
    const prompt = roomPrompt({ scope: "private", persona: "facilitator", studentProfileMarkdown: ctxB.brainState });
    expect(prompt).toContain(MARK_B);   // B sees B
    expect(prompt).not.toContain(MARK_A); // B never sees A
  });
});

describe("BR-06 (c) — no person-brain data can be written into course_content / any shared space", () => {
  it("brainWrite only ever targets a person: subject (never course:/room:/shared)", async () => {
    const store = new InMemoryStore();
    await brainWrite(A, { body: { event: "asked_hint", note: "sensitive person data" } }, { store });
    await brainWrite(B, { body: { event: "solved" } }, { store });
    expect(store.rows.length).toBe(2);
    expect(store.rows.every((m) => m.subject.startsWith("person:"))).toBe(true);
    expect(store.rows.some((m) => /^(course|room|cohort|prof):/.test(m.subject))).toBe(false);
    expect(store.rows.every((m) => m.source === "fschoolai")).toBe(true); // source-stamped for the one-way audit
  });

  it("the adapter exposes NO function that writes a shared space (the path does not exist)", () => {
    // The guarantee is the ABSENCE of a shared-space writer. The adapter's entire surface is the
    // person-scoped read/write pair + transport resolver — nothing that names course/content/shared.
    const surface = Object.keys(adapterModule);
    expect(surface.some((k) => /course|content|shared|university|room|cohort/i.test(k))).toBe(false);
    expect(surface.sort()).toEqual(["BRAIN_HOP_BUDGET_MS", "brainRead", "brainWrite", "resolveBrainStore"].sort());
  });
});

// ── (d) cross-university_id isolation through the REAL university-brain profile() read ──
const authState = vi.hoisted(() => ({ userId: "reader-at-X" as string | null }));
vi.mock("../api/_auth.ts", () => ({
  requireUserOr401: async (_req: any, res: any) => {
    if (!authState.userId) { res.status(401).json({ error: "auth" }); return null; }
    return authState.userId;
  },
}));
vi.mock("../api/_gateway.ts", () => ({ callModel: async () => ({ ok: false, content: "" }) }));

function R(data: any) { return { ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) }; }

describe("BR-06 (d) — no course_content row crosses university_id", () => {
  const X = "canvas.x.edu";
  const xRow = { content_type: "syllabus", professor_name: "Dr Smith", summary: "X-ONLY FACT", concepts: ["x-fact"], seen_by_count: 3, last_seen_at: "2026-07-10T00:00:00Z", course_id: "CSX", canvas_course_id: "900" };
  const yRow = { content_type: "syllabus", professor_name: "Dr Smith", summary: "Y-LEAK FACT", concepts: ["y-fact"], seen_by_count: 9, last_seen_at: "2026-07-11T00:00:00Z", course_id: "CSY", canvas_course_id: "900" };

  beforeEach(() => {
    process.env.SUPABASE_URL = "http://localhost";
    process.env.SUPABASE_SERVICE_KEY = "svc";
    authState.userId = "reader-at-X";
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

  it("a reader at university X sees X's professor facts and never university Y's", async () => {
    const seen: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: any) => {
      const u = String(url);
      seen.push(u);
      if (u.includes("/users?") && u.includes("select=university_id")) return R([{ university_id: X, canvas_base_url: null }]);
      if (u.includes("course_content?")) {
        // The DB honors the scope: a query filtered to X returns only X; an UNSCOPED query would leak both.
        if (u.includes(`university_id=eq.${encodeURIComponent(X)}`)) return R([xRow]);
        return R([xRow, yRow]);
      }
      return R([]);
    }));

    const handler = (await import("../api/university-brain.ts")).default;
    const res = makeRes();
    await handler({ method: "POST", query: { action: "profile" }, body: { professor: "Dr Smith" } }, res);

    expect(res.statusCode).toBe(200);
    const wire = JSON.stringify(res.body);
    expect(wire).toContain("x-fact");      // X's fact surfaces
    expect(wire).not.toContain("y-fact");  // Y's fact is scoped out
    expect(wire).not.toContain("Y-LEAK FACT");
    // and the scope was actually applied at the query (not merely absent from the stub data)
    expect(seen.some((u) => u.includes("course_content?") && u.includes(`university_id=eq.${encodeURIComponent(X)}`))).toBe(true);
  });
});

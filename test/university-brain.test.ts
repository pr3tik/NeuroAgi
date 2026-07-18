import { describe, it, expect, vi, beforeEach } from "vitest";

// university-brain imports _gateway/_auth/canvasLive; none build a client at load, but mock the
// LLM gateway defensively so importing never reaches network code.
vi.mock("../api/_gateway", () => ({ callModel: vi.fn(async () => ({ ok: false, content: "" })) }));

import {
  fmtDate, formatAssessmentSchedule, formatTopicSequence, formatPostedMaterials, upsertSnapshot,
} from "../api/university-brain";

describe("fmtDate", () => {
  it("formats an ISO timestamp to 'Mon D' (UTC, deterministic)", () => {
    expect(fmtDate("2026-10-03T23:59:00Z")).toBe("Oct 3");
    expect(fmtDate("2026-01-09")).toBe("Jan 9");
  });
  it("returns '' for null/invalid", () => {
    expect(fmtDate(null)).toBe("");
    expect(fmtDate("not a date")).toBe("");
  });
});

describe("formatAssessmentSchedule", () => {
  it("merges + sorts by due date and includes points", () => {
    const out = formatAssessmentSchedule("BIO130", [
      { title: "Final", dueAt: "2026-12-12", points: 200 },
      { title: "Quiz 1", dueAt: "2026-10-03", points: 20 },
    ]);
    expect(out).toBe("BIO130 assessment schedule: Quiz 1 (Oct 3, 20 pts); Final (Dec 12, 200 pts).");
  });
  it("returns null when there are no items", () => {
    expect(formatAssessmentSchedule("BIO130", [])).toBe(null);
  });
  it("BR-01: never emits any field other than title/date/points (a leaked question stays out)", () => {
    const out = formatAssessmentSchedule("BIO130", [
      { title: "Quiz 1", dueAt: "2026-10-03", points: 20, question: "What is ATP?", answer: "energy" } as any,
    ]);
    expect(out).not.toContain("ATP");
    expect(out).not.toContain("energy");
  });
});

describe("formatTopicSequence", () => {
  it("numbers module names and returns them as concepts", () => {
    const out = formatTopicSequence("BIO130", [{ name: "Cell structure" }, { name: "Membranes" }]);
    expect(out).toEqual({
      text: "BIO130 topic sequence: 1. Cell structure · 2. Membranes.",
      concepts: ["Cell structure", "Membranes"],
    });
  });
  it("returns null when there are no modules", () => {
    expect(formatTopicSequence("BIO130", [])).toBe(null);
  });
});

describe("formatPostedMaterials", () => {
  it("joins deduped file names", () => {
    expect(formatPostedMaterials("BIO130", [{ name: "L1.pdf" }, { name: "L1.pdf" }, { name: "Lab.pdf" }]))
      .toBe("BIO130 posted materials: L1.pdf, Lab.pdf.");
  });
  it("returns null when there are no files", () => {
    expect(formatPostedMaterials("BIO130", [])).toBe(null);
  });
});

describe("upsertSnapshot", () => {
  const row = {
    university_id: "q.utoronto.ca", course_id: "BIO130", canvas_course_id: "123",
    content_type: "assessment", text: "sched v1", professor_name: "Prof X", summary: "sched v1", concepts: null,
  };
  beforeEach(() => {
    process.env.SUPABASE_URL = "http://localhost";
    process.env.SUPABASE_SERVICE_KEY = "test";
  });

  it("INSERTs when this endpoint has no existing row for the tuple", async () => {
    const calls: { method: string; url: string; body?: any }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, opts: any = {}) => {
      calls.push({ method: opts.method ?? "GET", url: String(url), body: opts.body && JSON.parse(opts.body) });
      if ((opts.method ?? "GET") === "GET") return { ok: true, json: async () => [] };          // select → none
      return { ok: true, json: async () => [{ id: "new-1" }], text: async () => "" };            // insert
    }));
    const out = await upsertSnapshot(row);
    expect(out).toEqual({ id: "new-1", replaced: false });
    const insert = calls.find((c) => c.method === "POST");
    expect(insert?.body.source_url).toBe("university-brain");   // ownership sentinel
    vi.unstubAllGlobals();
  });

  it("PATCHes the existing owned row (never a 2nd row) on re-contribute", async () => {
    const calls: { method: string }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, opts: any = {}) => {
      calls.push({ method: opts.method ?? "GET" });
      if ((opts.method ?? "GET") === "GET") return { ok: true, json: async () => [{ id: "row-9" }] }; // select → hit
      return { ok: true, json: async () => [], text: async () => "" };                                // patch
    }));
    const out = await upsertSnapshot({ ...row, text: "sched v2" });
    expect(out).toEqual({ id: "row-9", replaced: true });
    expect(calls.some((c) => c.method === "PATCH")).toBe(true);
    expect(calls.some((c) => c.method === "POST")).toBe(false);  // no insert → no duplicate
    vi.unstubAllGlobals();
  });
});

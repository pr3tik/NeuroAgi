import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { makeSupabaseMock, makeRes } from "./helpers";

vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }));
import { createClient } from "@supabase/supabase-js";

beforeEach(() => {
  process.env.SUPABASE_URL = "http://localhost";
  process.env.SUPABASE_SERVICE_KEY = "test";
});
afterEach(() => vi.unstubAllGlobals());

async function loadHandler(router: (ctx: any) => any) {
  const { client, calls } = makeSupabaseMock(router);
  vi.resetModules();
  (createClient as any).mockReturnValue(client);
  const mod = await import("../api/extension-sync.ts");
  return { handler: mod.default, calls };
}

// Auth user row carries a Canvas host so university_id derives server-side (BR-02 §4c).
const withCanvas = (ctx: any) =>
  ctx.table === "users" && ctx.op === "select"
    ? { data: { id: "u1", email: "a@b.c", university_id: null, canvas_base_url: "https://q.utoronto.ca" }, error: null }
    : { data: null, error: null };

describe("extension-sync upsert_course_content — BR-06 guard + BR-02 §4c scoping", () => {
  it("drops person-tainted rows, upserts only clean ones", async () => {
    const { handler, calls } = await loadHandler(withCanvas);
    const res = makeRes();
    await handler({ method: "POST", body: {
      userId: "u1", action: "upsert_course_content",
      rows: [
        { course_id: "BIO130", canvas_course_id: "1", content_type: "syllabus", content_hash: "h1", text: "Grading: midterm 40%, final 60%." },
        { course_id: "BIO130", canvas_course_id: "1", content_type: "syllabus", content_hash: "h2", text: "Your grade: 18/20", user_id: "someone" },
      ],
    } }, res);
    expect(res.body.ok).toBe(true);
    expect(res.body.count).toBe(1);
    expect(res.body.dropped).toBe(1);
    const upserts = calls.filter(c => c.table === "course_content" && c.op === "upsert");
    expect(upserts.length).toBe(1);
    expect(upserts[0].payload).toHaveLength(1);
    expect(upserts[0].payload[0]).not.toHaveProperty("user_id");
  });

  it("stamps the SERVER-derived university_id, overriding a spoofed client value", async () => {
    const { handler, calls } = await loadHandler(withCanvas);
    const res = makeRes();
    await handler({ method: "POST", body: {
      userId: "u1", action: "upsert_course_content",
      rows: [
        { university_id: "harvard.edu", course_id: "BIO130", canvas_course_id: "1", content_type: "syllabus", content_hash: "h9", text: "Course reading schedule and weekly topics for the term." },
      ],
    } }, res);
    expect(res.body.ok).toBe(true);
    const upsert = calls.find(c => c.table === "course_content" && c.op === "upsert");
    expect(upsert?.payload[0].university_id).toBe("q.utoronto.ca"); // NOT the spoofed harvard.edu
  });

  it("refuses the shared-library write when the caller has no Canvas connection", async () => {
    const noCanvas = (ctx: any) =>
      ctx.table === "users" && ctx.op === "select"
        ? { data: { id: "u1", email: "a@b.c", university_id: null, canvas_base_url: null }, error: null }
        : { data: null, error: null };
    const { handler, calls } = await loadHandler(noCanvas);
    const res = makeRes();
    await handler({ method: "POST", body: {
      userId: "u1", action: "upsert_course_content",
      rows: [{ course_id: "BIO130", canvas_course_id: "1", content_type: "syllabus", content_hash: "h1", text: "Weekly topics and readings." }],
    } }, res);
    expect(res.statusCode).toBe(400);
    expect(calls.some(c => c.table === "course_content" && c.op === "upsert")).toBe(false);
  });
});

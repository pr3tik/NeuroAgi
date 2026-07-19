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

// Router: auth (users select) passes; course_content upsert echoes success.
const router = (ctx: any) => {
  if (ctx.table === "users" && ctx.op === "select") return { data: { id: "u1", email: "a@b.c" }, error: null };
  return { data: null, error: null };
};

describe("extension-sync upsert_course_content — BR-06 guard", () => {
  it("drops person-tainted rows, upserts only clean ones", async () => {
    const { handler, calls } = await loadHandler(router);
    const res = makeRes();
    await handler({ method: "POST", body: {
      userId: "u1", action: "upsert_course_content",
      rows: [
        { university_id: "q.utoronto.ca", course_id: "BIO130", canvas_course_id: "1", content_type: "syllabus", content_hash: "h1", text: "Grading: midterm 40%, final 60%." },
        { university_id: "q.utoronto.ca", course_id: "BIO130", canvas_course_id: "1", content_type: "syllabus", content_hash: "h2", text: "Your grade: 18/20", user_id: "someone" },
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
});

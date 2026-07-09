// @vitest-environment node
// Exercises the REAL markProactiveOpened / markProactiveActioned DB writers (not mocks)
// against the chainable supabase mock — pins the table, columns, target filter, and the
// idempotency guard so a typo or dropped clause fails a test. NotificationPanel.test.tsx
// proves the panel CALLS these; this proves the writes themselves are correct.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeSupabaseMock } from "./helpers";

// notifications.ts does `import { supabase } from "./supabase"`. Route that to our mock.
const H = vi.hoisted(() => ({ client: null as any }));
vi.mock("../src/api/supabase", () => ({ supabase: { from: (...a: any[]) => H.client.from(...a) } }));

import { markProactiveOpened, markProactiveActioned } from "../src/api/notifications";

let calls: any[];
beforeEach(() => {
  const m = makeSupabaseMock();          // default router → { data: null, error: null }
  H.client = m.client;
  calls = m.calls;
});

const update = () => calls.find(c => c.table === "notification_queue" && c.op === "update");

describe("markProactiveOpened", () => {
  it("stamps opened_at on the right row, guarded for idempotency", async () => {
    await markProactiveOpened("q1");
    const c = update();
    expect(c, "expected a notification_queue update").toBeTruthy();
    expect(c.payload).toHaveProperty("opened_at");                 // correct column
    expect(typeof c.payload.opened_at).toBe("string");
    expect(c.filters).toContainEqual(["eq", "id", "q1"]);          // targets the row
    expect(c.filters).toContainEqual(["is", "opened_at", null]);   // idempotency guard (stamp once)
  });
});

describe("markProactiveActioned", () => {
  it("sets action_taken=true on the right row", async () => {
    await markProactiveActioned("q2");
    const c = update();
    expect(c).toBeTruthy();
    expect(c.payload).toEqual({ action_taken: true });             // correct column + value
    expect(c.filters).toContainEqual(["eq", "id", "q2"]);
  });
});

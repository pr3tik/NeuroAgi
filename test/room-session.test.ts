// @vitest-environment node
// Handler tests for api/room-session.ts (Study Room AI-session lifecycle).
// Covers: auth gate (401), membership gate (403 + no writes), start (fresh + resumed,
// with the CLIENT-PLAN PRIVACY contract: strengths/topic_gaps/participant_summaries are
// server-only), end (job fan-out + idempotency-key swallow), review (caller-only data),
// proposal decisions (ownership 403, non-pending 409, accept → immutable brain_version,
// invalid patch 422), and sources binding (ownership 403 / owned upsert).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { makeRes } from "./helpers";
import { JOB_TYPES, validateBrainProfile } from "../api/_contracts.ts";

// Configurable auth: tests flip authState.userId (null → the endpoint must 401).
const authState = vi.hoisted(() => ({ userId: "stu-1" as string | null }));
vi.mock("../api/_auth.ts", () => ({
  requireUser: async () => (authState.userId ? { userId: authState.userId, authId: "test" } : null),
  requireUserOr401: async (_req: any, res: any) => {
    if (!authState.userId) { res.status(401).json({ error: "Authentication required." }); return null; }
    return authState.userId;
  },
}));
vi.mock("../api/_ratelimit.ts", () => ({ rateLimit: async () => true }));   // always allow

function R(data: any, opts: { ok?: boolean; status?: number } = {}) {
  const { ok = true, status = 200 } = opts;
  return { ok, status, json: async () => data, text: async () => JSON.stringify(data) };
}

type Call = { url: string; method: string; body?: any };
/** Stub global fetch as a per-URL PostgREST emulator; records every call. */
function stubDb(route: (u: string, method: string, body: any) => any | undefined) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: any, init: any = {}) => {
    const u = String(url);
    const method = String(init.method ?? "GET").toUpperCase();
    const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ url: u, method, body });
    return route(u, method, body) ?? R([]);
  }));
  return calls;
}
const posts = (calls: Call[], frag: string) => calls.filter(c => c.method === "POST" && c.url.includes(frag));
const patches = (calls: Call[], frag: string) => calls.filter(c => c.method === "PATCH" && c.url.includes(frag));

const ROOM = "11111111-1111-4111-8111-111111111111";
const SESSION = "22222222-2222-4222-8222-222222222222";
const PROPOSAL = "33333333-3333-4333-8333-333333333333";
const VERSION_ID = "44444444-4444-4444-8444-444444444444";
const DOC1 = "55555555-5555-4555-8555-555555555555";
const DOC2 = "66666666-6666-4666-8666-666666666666";

const isMemberLookup = (u: string) => u.includes("room_members?") && u.includes("user_id=eq.");
const isMemberList = (u: string) => u.includes("room_members?") && !u.includes("user_id=eq.");
const member = [{ user_id: "stu-1", role: "member" }];

beforeEach(() => {
  process.env.SUPABASE_URL = "http://localhost";
  process.env.SUPABASE_SERVICE_KEY = "svc";
  authState.userId = "stu-1";
});
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

async function load() { return (await import("../api/room-session.ts")).default; }

// ── auth gate ────────────────────────────────────────────────────────────────
describe("room-session auth", () => {
  it("401 on every action when the caller has no valid session; no DB traffic", async () => {
    authState.userId = null;
    const calls = stubDb(() => undefined);
    const h = await load();
    const reqs = [
      { method: "POST", query: { action: "start" }, body: { roomId: ROOM } },
      { method: "POST", query: { action: "end" }, body: { sessionId: SESSION } },
      { method: "GET", query: { action: "review", sessionId: SESSION } },
      { method: "POST", query: { action: "proposal" }, body: { proposalId: PROPOSAL, decision: "accept" } },
      { method: "POST", query: { action: "sources" }, body: { roomId: ROOM, documentIds: [DOC1] } },
    ];
    for (const req of reqs) {
      const res = makeRes();
      await h(req, res);
      expect(res.statusCode).toBe(401);
    }
    expect(calls).toHaveLength(0);
  });
});

// ── start ────────────────────────────────────────────────────────────────────
describe("room-session start", () => {
  it("400 on a non-uuid roomId", async () => {
    stubDb(() => undefined);
    const h = await load(); const res = makeRes();
    await h({ method: "POST", query: { action: "start" }, body: { roomId: "not-a-uuid" } }, res);
    expect(res.statusCode).toBe(400);
  });

  it("403 for a non-member, and NO inserts happened", async () => {
    const calls = stubDb((u) => {
      if (isMemberLookup(u)) return R([]);                       // not joined
      return undefined;
    });
    const h = await load(); const res = makeRes();
    await h({ method: "POST", query: { action: "start" }, body: { roomId: ROOM } }, res);
    expect(res.statusCode).toBe(403);
    expect(calls.every(c => c.method === "GET")).toBe(true);     // nothing written
  });

  it("member + no active session → freezes config v1, creates session + SERVER-ONLY snapshot; response leaks no plan internals", async () => {
    const calls = stubDb((u, m) => {
      if (m === "GET") {
        if (isMemberLookup(u)) return R(member);
        if (u.includes("room_ai_sessions?") && u.includes("state=eq.active")) return R([]);   // fresh start
        if (u.includes("study_rooms?")) return R([{ id: ROOM, course_id: 123 }]);
        if (u.includes("room_configs?")) return R([]);                                        // no prior version
        if (isMemberList(u)) return R([{ user_id: "stu-1" }, { user_id: "stu-2" }]);
        if (u.includes("users?")) return R([
          { id: "stu-1", name: "Ryan Lin", learning_style: "visual", help_seeking: "asks_early" },
          { id: "stu-2", name: "Ana B", learning_style: "practice", help_seeking: "waits" },
        ]);
        if (u.includes("student_brains?")) return R([]);                                      // nobody has a Brain yet
        if (u.includes("deck_profiles?")) return R([
          { user_id: "stu-2", topics: { topics: [{ topic: "integrals", confidence: 0.9 }, { topic: "limits", confidence: 0.2 }] } },
        ]);
      }
      if (m === "POST" && u.includes("room_ai_sessions")) return R([{ id: SESSION, started_at: "2026-07-16T00:00:00Z" }]);
      return undefined;
    });
    const h = await load(); const res = makeRes();
    await h({ method: "POST", query: { action: "start" }, body: { roomId: ROOM } }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, resumed: false });
    expect(res.body.session).toMatchObject({ id: SESSION, roomId: ROOM, state: "active", configVersion: 1 });
    expect(res.body.roomPlan).toMatchObject({ participant_count: 2, version: 1 });
    expect(res.body.roomPlan.group_preferences).toContain("visual");

    // the three inserts happened, with the right shapes
    const cfg = posts(calls, "/rest/v1/room_configs");
    expect(cfg).toHaveLength(1);
    expect(cfg[0].body).toMatchObject({ room_id: ROOM, version: 1, persona: "facilitator", intervention_intensity: "balanced", created_by: "stu-1" });
    expect(posts(calls, "/rest/v1/room_ai_sessions")).toHaveLength(1);
    const snap = posts(calls, "/rest/v1/room_brain_snapshots");
    expect(snap).toHaveLength(1);
    expect(snap[0].body.session_id).toBe(SESSION);
    expect(snap[0].body.participant_summaries).toHaveLength(2);
    // the full plan (with gaps) IS in the snapshot…
    expect(JSON.stringify(snap[0].body)).toContain("limits");

    // …but the CLIENT response must never carry the plan internals
    const wire = JSON.stringify(res.body);
    expect(wire).not.toContain("topic_gaps");
    expect(wire).not.toContain("strengths");
    expect(wire).not.toContain("participant_summaries");
  });

  it("A5: fresh start enqueues a warm_brain_context job per participant (fire-and-forget)", async () => {
    const calls = stubDb((u, m) => {
      if (m === "GET") {
        if (isMemberLookup(u)) return R(member);
        if (u.includes("room_ai_sessions?") && u.includes("state=eq.active")) return R([]);
        if (u.includes("study_rooms?")) return R([{ id: ROOM, course_id: 123 }]);
        if (u.includes("room_configs?")) return R([]);
        if (isMemberList(u)) return R([{ user_id: "stu-1" }, { user_id: "stu-2" }]);
        if (u.includes("users?")) return R([
          { id: "stu-1", name: "Ryan Lin", learning_style: "visual", help_seeking: "asks_early" },
          { id: "stu-2", name: "Ana B", learning_style: "practice", help_seeking: "waits" },
        ]);
        if (u.includes("student_brains?")) return R([]);
        if (u.includes("deck_profiles?")) return R([]);
      }
      if (m === "POST" && u.includes("room_ai_sessions")) return R([{ id: SESSION, started_at: "2026-07-16T00:00:00Z" }]);
      return undefined;
    });
    const h = await load(); const res = makeRes();
    await h({ method: "POST", query: { action: "start" }, body: { roomId: ROOM } }, res);
    expect(res.statusCode).toBe(200);

    const warm = posts(calls, "/rest/v1/jobs");
    expect(warm).toHaveLength(2); // one per joined participant
    expect(warm.every(w => w.body.type === JOB_TYPES.warmBrain)).toBe(true);
    expect(warm.map(w => w.body.payload.userId).sort()).toEqual(["stu-1", "stu-2"]);
    // idempotency key is (type:room:user:bucket) — dedups a burst of starts within the window
    expect(warm[0].body.idempotency_key).toMatch(new RegExp(`^${JOB_TYPES.warmBrain}:${ROOM}:stu-\\d:\\d+$`));
    // the warm never blocks the response contract
    expect(res.body).toMatchObject({ ok: true, resumed: false });
  });

  it("an active session is resumed — no new room_ai_sessions insert, still no plan leakage", async () => {
    const calls = stubDb((u, m) => {
      if (m !== "GET") return undefined;
      if (isMemberLookup(u)) return R(member);
      if (u.includes("room_ai_sessions?") && u.includes("state=eq.active")) {
        return R([{ id: SESSION, started_at: "2026-07-16T00:00:00Z", config_version: 3 }]);
      }
      if (u.includes("room_configs?")) return R([{ persona: "clarifier", intervention_intensity: "low", duration_minutes: 45 }]);
      if (u.includes("room_brain_snapshots?")) return R([{
        participant_summaries: [
          { user_id: "stu-1", display_name: "Ryan", invite_style: "gentle_direct", strengths: [], topic_gaps: ["limits"], teaching_preferences: ["visual"] },
          { user_id: "stu-2", display_name: "Ana", invite_style: "open_invite", strengths: ["integrals"], topic_gaps: [], teaching_preferences: ["practice_problems"] },
        ],
        group_strategy: { default_explanation: "visual_then_stepwise", peer_teaching_pairs: [], avoid: [] },
      }]);
      return undefined;
    });
    const h = await load(); const res = makeRes();
    await h({ method: "POST", query: { action: "start" }, body: { roomId: ROOM } }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, resumed: true });
    expect(res.body.session).toMatchObject({ id: SESSION, configVersion: 3 });
    expect(res.body.config).toMatchObject({ persona: "clarifier", intensity: "low", durationMinutes: 45 });
    expect(res.body.roomPlan.participant_count).toBe(2);
    expect(calls.every(c => c.method === "GET")).toBe(true);     // resume writes nothing

    const wire = JSON.stringify(res.body);
    expect(wire).not.toContain("topic_gaps");
    expect(wire).not.toContain("strengths");
    expect(wire).not.toContain("participant_summaries");
  });

  it("concurrent start losing the one-active race → resumes the winner's session, never 502", async () => {
    let activeReads = 0;
    const calls = stubDb((u, m) => {
      if (m === "GET") {
        if (isMemberLookup(u)) return R(member);
        if (u.includes("room_ai_sessions?") && u.includes("state=eq.active")) {
          // first read: no active session (both racers pass the check);
          // second read (after the conflicted insert): the winner's session exists
          activeReads++;
          return activeReads === 1
            ? R([])
            : R([{ id: SESSION, started_at: "2026-07-16T00:00:00Z", config_version: 7 }]);
        }
        if (u.includes("study_rooms?")) return R([{ id: ROOM, course_id: 123 }]);
        if (u.includes("room_configs?") && u.includes("version=eq.7")) return R([{ persona: "timekeeper", intervention_intensity: "active", duration_minutes: 60 }]);
        if (u.includes("room_configs?")) return R([]);
        if (isMemberList(u)) return R([{ user_id: "stu-1" }]);
        if (u.includes("users?")) return R([{ id: "stu-1", name: "Ryan Lin", learning_style: "visual", help_seeking: "asks_early" }]);
        if (u.includes("student_brains?")) return R([]);
        if (u.includes("deck_profiles?")) return R([]);
      }
      // the partial unique index rejects the loser's session insert
      if (m === "POST" && u.includes("room_ai_sessions")) return R({ message: "duplicate key value violates unique constraint" }, { ok: false, status: 409 });
      return undefined;
    });
    const h = await load(); const res = makeRes();
    await h({ method: "POST", query: { action: "start" }, body: { roomId: ROOM } }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, resumed: true });
    expect(res.body.session).toMatchObject({ id: SESSION, configVersion: 7 });
    expect(res.body.config).toMatchObject({ persona: "timekeeper", intensity: "active" });
    expect(posts(calls, "/rest/v1/room_brain_snapshots")).toHaveLength(0);   // loser stores no snapshot
    const wire = JSON.stringify(res.body);
    expect(wire).not.toContain("participant_summaries");
  });
});

// ── end ──────────────────────────────────────────────────────────────────────
describe("room-session end", () => {
  it("flips state via PATCH on state=eq.active, enqueues 1 summary + 2 per member, swallows a duplicate 409", async () => {
    let jobPosts = 0;
    const calls = stubDb((u, m) => {
      if (m === "GET") {
        if (u.includes("room_ai_sessions?")) return R([{ id: SESSION, room_id: ROOM, state: "active" }]);
        if (isMemberLookup(u)) return R(member);
        if (isMemberList(u)) return R([{ user_id: "stu-1" }, { user_id: "stu-2" }]);
      }
      if (m === "PATCH" && u.includes("room_ai_sessions?")) return R([{ id: SESSION, state: "ended" }]);
      if (m === "POST" && u.includes("/rest/v1/jobs")) {
        jobPosts++;
        if (jobPosts === 2) return R({ message: "duplicate key value violates unique constraint" }, { ok: false, status: 409 });
        return R([{ id: `job-${jobPosts}` }]);
      }
      return undefined;
    });
    const h = await load(); const res = makeRes();
    await h({ method: "POST", query: { action: "end" }, body: { sessionId: SESSION } }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, sessionId: SESSION, state: "ended" });

    const flip = patches(calls, "room_ai_sessions?");
    expect(flip).toHaveLength(1);
    expect(flip[0].url).toContain(`id=eq.${SESSION}`);
    expect(flip[0].url).toContain("state=eq.active");            // guarded flip, not a blind PATCH
    expect(flip[0].body.state).toBe("ended");

    // 1 summary + (quiz + brain-proposal) × 2 members = 5 attempts, all keyed on the sessionId
    const jobs = posts(calls, "/rest/v1/jobs");
    expect(jobs).toHaveLength(5);
    expect(jobs.every(j => j.body.idempotency_key.includes(SESSION))).toBe(true);
    const types = jobs.map(j => j.body.type);
    expect(types.filter(t => t === JOB_TYPES.summary)).toHaveLength(1);
    expect(types.filter(t => t === JOB_TYPES.quiz)).toHaveLength(2);
    expect(types.filter(t => t === JOB_TYPES.brainProposal)).toHaveLength(2);
    expect(jobs.map(j => j.body.idempotency_key)).toContain(`${JOB_TYPES.quiz}:${SESSION}:stu-2`);

    // the duplicate-key 409 was swallowed: 4 of 5 reported created, action still ok
    expect(res.body.jobs).toHaveLength(4);
  });
});

// ── review ───────────────────────────────────────────────────────────────────
describe("room-session review", () => {
  it("returns the group summary + ONLY the caller's summary/quiz/proposals", async () => {
    const quizRows = [
      { user_id: "stu-1", questions: [{ question: "q-for-stu1" }], version: 1 },
      { user_id: "stu-2", questions: [{ question: "q-for-stu2" }], version: 1 },
    ];
    const proposalRows = [
      { user_id: "stu-1", id: PROPOSAL, patch: { teaching_preferences: ["visual"] }, evidence: null, confidence: 0.5, status: "pending" },
      { user_id: "stu-2", id: "99999999-9999-4999-8999-999999999999", patch: { known_examples: ["stu2-proposal-marker"] }, evidence: null, confidence: 0.9, status: "pending" },
    ];
    // If the endpoint drops its user_id=eq.<caller> filter, the mock returns EVERY
    // user's rows (a real PostgREST leak) and the privacy assertions below fail.
    const byCallerFilter = (u: string, rows: any[]) => {
      const m = u.match(/user_id=eq\.([^&]+)/);
      return R(m ? rows.filter(r => r.user_id === decodeURIComponent(m[1])) : rows);
    };
    stubDb((u, m) => {
      if (m !== "GET") return undefined;
      if (u.includes("room_ai_sessions?")) return R([{ id: SESSION, room_id: ROOM, started_at: "2026-07-16T00:00:00Z", ended_at: "2026-07-16T01:00:00Z", state: "ended" }]);
      if (isMemberLookup(u)) return R(member);
      if (u.includes("session_summaries?")) return R([                       // endpoint filters scope/user in JS
        { scope: "group", user_id: null, summary: { headline: "group covered chain rule" }, status: "ready" },
        { scope: "individual", user_id: "stu-1", summary: { note: "stu1-private-note" }, status: "ready" },
        { scope: "individual", user_id: "stu-2", summary: { note: "stu2-private-note" }, status: "ready" },
      ]);
      if (u.includes("quiz_sets?")) return byCallerFilter(u, quizRows);
      if (u.includes("brain_update_proposals?")) return byCallerFilter(u, proposalRows);
      if (u.includes("jobs?")) return R([
        { type: JOB_TYPES.summary, status: "done", idempotency_key: `${JOB_TYPES.summary}:${SESSION}` },
        { type: JOB_TYPES.quiz, status: "done", idempotency_key: `${JOB_TYPES.quiz}:${SESSION}:stu-1` },
        { type: JOB_TYPES.quiz, status: "queued", idempotency_key: `${JOB_TYPES.quiz}:${SESSION}:stu-2` },
      ]);
      return undefined;
    });
    const h = await load(); const res = makeRes();
    await h({ method: "GET", query: { action: "review", sessionId: SESSION } }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.groupSummary).toEqual({ headline: "group covered chain rule" });
    expect(res.body.mySummary).toEqual({ note: "stu1-private-note" });
    expect(res.body.myQuiz).toEqual([{ question: "q-for-stu1" }]);
    expect(res.body.myProposals).toHaveLength(1);
    expect(res.body.myProposals[0]).toMatchObject({ id: PROPOSAL, status: "pending" });
    expect(res.body.jobs[JOB_TYPES.summary]).toBe("done");
    expect(res.body.jobs[JOB_TYPES.quiz]).toBe("done");          // stu-2's queued row never overwrote it

    // the other student's data must be nowhere in the response body
    const wire = JSON.stringify(res.body);
    expect(wire).not.toContain("stu2-private-note");
    expect(wire).not.toContain("q-for-stu2");
    expect(wire).not.toContain("stu2-proposal-marker");
  });
});

// ── proposal ─────────────────────────────────────────────────────────────────
describe("room-session proposal", () => {
  const pendingProposal = (over: any = {}) => ({
    id: PROPOSAL, user_id: "stu-1", status: "pending",
    patch: { strengths: [{ topic: "derivatives", confidence: 0.8 }], teaching_preferences: ["visual"] },
    ...over,
  });

  it("403 deciding someone else's proposal", async () => {
    const calls = stubDb((u, m) => {
      if (m === "GET" && u.includes("brain_update_proposals?")) return R([pendingProposal({ user_id: "stu-2" })]);
      return undefined;
    });
    const h = await load(); const res = makeRes();
    await h({ method: "POST", query: { action: "proposal" }, body: { proposalId: PROPOSAL, decision: "accept" } }, res);
    expect(res.statusCode).toBe(403);
    expect(calls.every(c => c.method === "GET")).toBe(true);
  });

  it("409 deciding a non-pending proposal", async () => {
    const calls = stubDb((u, m) => {
      if (m === "GET" && u.includes("brain_update_proposals?")) return R([pendingProposal({ status: "accepted" })]);
      return undefined;
    });
    const h = await load(); const res = makeRes();
    await h({ method: "POST", query: { action: "proposal" }, body: { proposalId: PROPOSAL, decision: "accept" } }, res);
    expect(res.statusCode).toBe(409);
    expect(calls.every(c => c.method === "GET")).toBe(true);
  });

  it("accept: creates an immutable brain_version (valid profile + markdown), points student_brains at it, flips only a pending row", async () => {
    const calls = stubDb((u, m) => {
      if (m === "GET") {
        if (u.includes("brain_update_proposals?")) return R([pendingProposal()]);
        if (u.includes("student_brains?")) return R([]);                        // first Brain ever
        if (u.includes("users?")) return R([{ name: "Ryan Lin" }]);
      }
      if (m === "POST" && u.includes("/rest/v1/brain_versions")) return R([{ id: VERSION_ID }]);
      if (m === "POST" && u.includes("student_brains?on_conflict=user_id")) return R([{ user_id: "stu-1", active_version_id: VERSION_ID }]);
      if (m === "PATCH" && u.includes("brain_update_proposals?")) return R([{ id: PROPOSAL }]);
      return undefined;
    });
    const h = await load(); const res = makeRes();
    await h({ method: "POST", query: { action: "proposal" }, body: { proposalId: PROPOSAL, decision: "accept" } }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, status: "accepted", versionId: VERSION_ID });

    // the new version carries a VALID canonical profile + its markdown projection
    const ver = posts(calls, "/rest/v1/brain_versions");
    expect(ver).toHaveLength(1);
    expect(validateBrainProfile(ver[0].body.profile)).toEqual([]);
    expect(ver[0].body.profile.identity.display_name).toBe("Ryan");             // first name from users row
    expect(ver[0].body.profile.strengths).toEqual([{ topic: "derivatives", confidence: 0.8 }]);
    expect(ver[0].body.profile.teaching_preferences).toContain("visual");
    expect(ver[0].body.markdown).toContain("derivatives");
    expect(ver[0].body).toMatchObject({ user_id: "stu-1", schema_version: 1, source: "proposal" });

    // student_brains now points at the new version
    const up = posts(calls, "student_brains?on_conflict=user_id");
    expect(up).toHaveLength(1);
    expect(up[0].body).toMatchObject({ user_id: "stu-1", active_version_id: VERSION_ID });

    // decision flip is guarded on status=eq.pending (no double-decide race)
    const flip = patches(calls, "brain_update_proposals?");
    expect(flip).toHaveLength(1);
    expect(flip[0].url).toContain(`id=eq.${PROPOSAL}`);
    expect(flip[0].url).toContain("status=eq.pending");
    expect(flip[0].body.status).toBe("accepted");
  });

  it("accept whose patch produces an invalid profile → 422 and NO brain_versions insert", async () => {
    const calls = stubDb((u, m) => {
      if (m === "GET") {
        if (u.includes("brain_update_proposals?")) return R([pendingProposal({ patch: { gaps: [{ topic: "limits", confidence: 7 }] } })]);
        if (u.includes("student_brains?")) return R([]);
        if (u.includes("users?")) return R([{ name: "Ryan Lin" }]);
      }
      return undefined;
    });
    const h = await load(); const res = makeRes();
    await h({ method: "POST", query: { action: "proposal" }, body: { proposalId: PROPOSAL, decision: "accept" } }, res);

    expect(res.statusCode).toBe(422);
    expect(res.body.problems.join(" ")).toMatch(/confidence must be 0\.\.1/);
    expect(posts(calls, "brain_versions")).toHaveLength(0);      // nothing persisted
    expect(calls.filter(c => c.method === "PATCH")).toHaveLength(0);
  });

  it("accept that LOSES the pending-flip race → 409 and nothing written (no version, no repoint)", async () => {
    const calls = stubDb((u, m) => {
      if (m === "GET") {
        if (u.includes("brain_update_proposals?")) return R([pendingProposal()]);   // still looks pending on read
        if (u.includes("student_brains?")) return R([]);
        if (u.includes("users?")) return R([{ name: "Ryan Lin" }]);
      }
      if (m === "PATCH" && u.includes("brain_update_proposals?")) return R([]);     // another request flipped it first
      return undefined;
    });
    const h = await load(); const res = makeRes();
    await h({ method: "POST", query: { action: "proposal" }, body: { proposalId: PROPOSAL, decision: "accept" } }, res);

    expect(res.statusCode).toBe(409);
    // the loser must write NOTHING — the flip is claimed BEFORE any version write
    expect(posts(calls, "brain_versions")).toHaveLength(0);
    expect(posts(calls, "student_brains?on_conflict=user_id")).toHaveLength(0);
  });

  it("reject: flips only a pending row, never touches brain_versions", async () => {
    const calls = stubDb((u, m) => {
      if (m === "GET" && u.includes("brain_update_proposals?")) return R([pendingProposal()]);
      if (m === "PATCH" && u.includes("brain_update_proposals?")) return R([{ id: PROPOSAL }]);
      return undefined;
    });
    const h = await load(); const res = makeRes();
    await h({ method: "POST", query: { action: "proposal" }, body: { proposalId: PROPOSAL, decision: "reject" } }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, status: "rejected" });
    const flip = patches(calls, "brain_update_proposals?");
    expect(flip).toHaveLength(1);
    expect(flip[0].url).toContain("status=eq.pending");
    expect(posts(calls, "brain_versions")).toHaveLength(0);
  });
});

// ── sources ──────────────────────────────────────────────────────────────────
describe("room-session sources", () => {
  it("POST: 403 when a document is not the caller's own; no upsert", async () => {
    const calls = stubDb((u, m) => {
      if (m === "GET") {
        if (isMemberLookup(u)) return R(member);
        if (u.includes("rag_documents?")) return R([{ id: DOC1, title: "Mine" }]);   // DOC2 not owned → fewer rows
      }
      return undefined;
    });
    const h = await load(); const res = makeRes();
    await h({ method: "POST", query: { action: "sources" }, body: { roomId: ROOM, documentIds: [DOC1, DOC2] } }, res);
    expect(res.statusCode).toBe(403);
    expect(posts(calls, "room_sources")).toHaveLength(0);
  });

  it("POST: owned documents are upserted with room_id + document_id", async () => {
    const calls = stubDb((u, m) => {
      if (m === "GET") {
        if (isMemberLookup(u)) return R(member);
        if (u.includes("rag_documents?")) {
          expect(u).toContain("user_id=eq.stu-1");               // ownership is checked against the CALLER
          return R([{ id: DOC1, title: "Lecture 1" }, { id: DOC2, title: "Notes" }]);
        }
      }
      if (m === "POST" && u.includes("room_sources")) return R([{ id: "rs1", document_id: DOC1 }, { id: "rs2", document_id: DOC2 }]);
      return undefined;
    });
    const h = await load(); const res = makeRes();
    await h({ method: "POST", query: { action: "sources" }, body: { roomId: ROOM, documentIds: [DOC1, DOC2] } }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.sources).toEqual([{ id: "rs1", documentId: DOC1 }, { id: "rs2", documentId: DOC2 }]);
    const up = posts(calls, "room_sources");
    expect(up).toHaveLength(1);
    expect(up[0].url).toContain("on_conflict=room_id,document_id");
    expect(up[0].body).toEqual([
      { room_id: ROOM, document_id: DOC1, added_by: "stu-1", enabled: true },
      { room_id: ROOM, document_id: DOC2, added_by: "stu-1", enabled: true },
    ]);
  });
});

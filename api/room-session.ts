// api/room-session.ts — Study Room AI-session lifecycle (action-routed, one function).
//   POST ?action=start     { roomId, persona?, intensity?, durationMinutes? }
//     → creates the room-wide AI session (idempotent: returns the active one), freezes a
//       config version, and composes the ROOM TEACHING PLAN from what the platform already
//       knows (intake preferences + deck_profiles mastery + strategy affinity). The full
//       plan is stored SERVER-ONLY in room_brain_snapshots; clients get a benign summary.
//   POST ?action=end       { sessionId }
//     → freezes the session and enqueues summary/quiz/brain-proposal jobs (idempotent keys).
//   GET  ?action=review    &sessionId=…
//     → group summary + the CALLER'S individual summary/quiz/proposals only.
//   POST ?action=proposal  { proposalId, decision: accept|edit|reject, patch? }
//     → student decision on a Brain update; accept/edit creates an immutable brain_version.
//   POST ?action=sources   { roomId, documentIds: string[] }
//     → binds the caller's OWN ingested documents to the room (explicit share for room AI).
//   GET  ?action=sources   &roomId=…  → current bindings.
//
// Auth: requireUser on every action; membership checked against room_members. All table
// access is server-side with the service key (tables are RLS-deny for client keys).
import { requireUserOr401 } from "./_auth.js";
import { rateLimit } from "./_ratelimit.js";
import { embed, coerceUuid } from "./rag.js";
import {
  BRAIN_SCHEMA_VERSION, JOB_TYPES, PERSONA_IDS,
  applyBrainPatch, brainToMarkdown, emptyBrainProfile, validateBrainProfile,
} from "./_contracts.js";
import type {
  BrainProfile, GroupStrategy, InterventionIntensity, ParticipantSummary,
  PersonaId, RoomTeachingPlan,
} from "./_contracts.js";

export const config = { maxDuration: 60 };

function sb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("Supabase env vars not configured");
  const headers: Record<string, string> = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  return {
    async select(path: string) {
      const r = await fetch(`${url}/rest/v1/${path}`, { headers });
      if (!r.ok) throw new Error(`select ${path.split("?")[0]} failed (${r.status})`);
      return (await r.json()) as any[];
    },
    async rpc(fn: string, args: any) {
      const r = await fetch(`${url}/rest/v1/rpc/${fn}`, { method: "POST", headers, body: JSON.stringify(args) });
      if (!r.ok) throw new Error(`rpc ${fn} failed (${r.status})`);
      return (await r.json()) as any[];
    },
    async insert(table: string, body: any, returning = true) {
      const r = await fetch(`${url}/rest/v1/${table}`, {
        method: "POST",
        headers: returning ? { ...headers, Prefer: "return=representation" } : headers,
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(`insert ${table} failed (${r.status}): ${(await r.text()).slice(0, 200)}`);
      return returning ? ((await r.json()) as any[]) : [];
    },
    async upsert(table: string, body: any, onConflict: string) {
      const r = await fetch(`${url}/rest/v1/${table}?on_conflict=${onConflict}`, {
        method: "POST",
        headers: { ...headers, Prefer: "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(`upsert ${table} failed (${r.status}): ${(await r.text()).slice(0, 200)}`);
      return (await r.json()) as any[];
    },
    async update(pathWithFilter: string, body: any) {
      const r = await fetch(`${url}/rest/v1/${pathWithFilter}`, {
        method: "PATCH", headers: { ...headers, Prefer: "return=representation" }, body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(`update ${pathWithFilter.split("?")[0]} failed (${r.status})`);
      return (await r.json()) as any[];
    },
    async del(pathWithFilter: string) {
      const r = await fetch(`${url}/rest/v1/${pathWithFilter}`, { method: "DELETE", headers });
      if (!r.ok) throw new Error(`delete failed (${r.status})`);
    },
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function memberOf(db: ReturnType<typeof sb>, roomId: string, userId: string) {
  const rows = await db.select(`room_members?room_id=eq.${roomId}&user_id=eq.${encodeURIComponent(userId)}&status=eq.joined&select=user_id,role`);
  return rows[0] ?? null;
}

// A5 — enqueue one fire-and-forget warm_brain_context job per participant. The idempotency key is
// bucketed to a 5-minute window per (room,user) so a burst of starts warms at most once per window,
// and the `jobs.idempotency_key` UNIQUE constraint dedups the rest. Never throws: a failed enqueue
// must not fail room start (the warm is an optimization, not a correctness requirement).
const WARM_BUCKET_MS = 5 * 60 * 1000;
async function enqueueWarmJobs(db: ReturnType<typeof sb>, roomId: string, userIds: string[], now = Date.now()) {
  const bucket = Math.floor(now / WARM_BUCKET_MS);
  for (const uid of [...new Set(userIds)].filter(Boolean)) {
    try {
      await db.insert("jobs", {
        type: JOB_TYPES.warmBrain,
        idempotency_key: `${JOB_TYPES.warmBrain}:${roomId}:${uid}:${bucket}`,
        payload: { userId: uid, roomId },
      }, false);
    } catch { /* duplicate key within the window → already warming */ }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Room teaching plan composer (v1 — deterministic, no LLM call; AI-02 contract).
// Sources, in priority order, ALL of which already exist in production:
//   users intake columns → declared teaching/interaction preferences
//   deck_profiles.topics → evidence-backed strengths (conf ≥ 0.7) and gaps (conf ≤ 0.4)
//   brain_versions       → overrides when the student has an explicit Brain profile
// Privacy: only pedagogy fields enter the plan; consent_room_pedagogy=false students
// contribute display name + declared preferences only (no strengths/gaps).
// ─────────────────────────────────────────────────────────────────────────────
const STYLE_TO_PREF: Record<string, string[]> = {
  visual: ["visual", "diagram_first"],
  example: ["worked_example", "examples_before_definitions"],
  practice: ["practice_problems", "active_recall"],
  discussion: ["talk_it_through", "peer_explanation"],
  reading: ["structured_notes", "definitions_first"],
};
const HELP_TO_INVITE: Record<string, ParticipantSummary["invite_style"]> = {
  asks_early: "gentle_direct",
  waits: "open_invite",
  never_asks: "no_cold_call",
};

async function composeRoomPlan(db: ReturnType<typeof sb>, roomId: string, courseId: string | null): Promise<{ plan: RoomTeachingPlan; sourceVersionIds: string[] }> {
  const members = await db.select(`room_members?room_id=eq.${roomId}&status=eq.joined&select=user_id`);
  const ids = members.map((m: any) => m.user_id);
  if (ids.length === 0) throw new Error("room has no joined members");
  const inList = `in.(${ids.map((i: string) => `"${i.replace(/"/g, "")}"`).join(",")})`;

  const [users, brains, decks] = await Promise.all([
    db.select(`users?id=${inList}&select=id,name,learning_style,help_seeking,explanation_style`),
    db.select(`student_brains?user_id=${inList}&select=user_id,active_version_id,consent_room_pedagogy`),
    courseId ? db.select(`deck_profiles?user_id=${inList}&course_id=eq.${encodeURIComponent(courseId)}&select=user_id,topics`) : Promise.resolve([]),
  ]);
  const brainByUser = new Map(brains.map((b: any) => [b.user_id, b]));
  const versionIds = brains.map((b: any) => b.active_version_id).filter(Boolean);
  const versions = versionIds.length
    ? await db.select(`brain_versions?id=in.(${versionIds.join(",")})&select=id,user_id,profile`)
    : [];
  const versionByUser = new Map(versions.map((v: any) => [v.user_id, v]));
  const deckByUser = new Map(decks.map((d: any) => [d.user_id, d]));

  const participants: ParticipantSummary[] = users.map((u: any) => {
    const brain = brainByUser.get(u.id);
    const consent = brain ? brain.consent_room_pedagogy !== false : true;
    const profile: BrainProfile | null = versionByUser.get(u.id)?.profile ?? null;

    let strengths: string[] = [];
    let gaps: string[] = [];
    if (consent) {
      if (profile) {
        strengths = profile.strengths.filter(t => t.confidence >= 0.6).map(t => t.topic).slice(0, 3);
        gaps = profile.gaps.filter(t => t.confidence >= 0.4).map(t => t.topic).slice(0, 3);
      } else {
        const topics: any[] = deckByUser.get(u.id)?.topics?.topics ?? deckByUser.get(u.id)?.topics ?? [];
        if (Array.isArray(topics)) {
          strengths = topics.filter((t: any) => (t?.confidence ?? 0) >= 0.7).map((t: any) => t.topic).filter(Boolean).slice(0, 3);
          gaps = topics.filter((t: any) => (t?.confidence ?? 1) <= 0.4).map((t: any) => t.topic).filter(Boolean).slice(0, 3);
        }
      }
    }
    const prefs = profile?.teaching_preferences?.length
      ? profile.teaching_preferences.slice(0, 4)
      : (STYLE_TO_PREF[u.learning_style] ?? []);
    const invite = profile?.interaction_preferences?.invite_style
      ?? HELP_TO_INVITE[u.help_seeking] ?? "open_invite";
    return { user_id: u.id, display_name: (u.name || "Student").split(/\s+/)[0], invite_style: invite, strengths, topic_gaps: gaps, teaching_preferences: prefs };
  });

  // Group strategy: majority preference wins; peer-teaching pairs match one student's
  // strength to another's gap (never surfaced as "X is weak at Y" — persona layer enforces).
  const prefCounts = new Map<string, number>();
  for (const p of participants) for (const pref of p.teaching_preferences) prefCounts.set(pref, (prefCounts.get(pref) ?? 0) + 1);
  const topPref = [...prefCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "worked_example";
  const pairs: GroupStrategy["peer_teaching_pairs"] = [];
  for (const a of participants) {
    for (const b of participants) {
      if (a.user_id === b.user_id || pairs.length >= 3) continue;
      const overlap = a.strengths.find(s => b.topic_gaps.some(g => g.toLowerCase() === s.toLowerCase()));
      if (overlap && !pairs.some(x => x.explainer === a.display_name && x.listener === b.display_name)) {
        pairs.push({ explainer: a.display_name, listener: b.display_name });
      }
    }
  }
  const plan: RoomTeachingPlan = {
    version: 1,
    participants,
    group_strategy: {
      default_explanation: `${topPref}_then_stepwise`,
      peer_teaching_pairs: pairs,
      avoid: ["public_ranking", "rapid_cold_calling", "naming_a_student_with_a_gap"],
    },
  };
  return { plan, sourceVersionIds: versionIds };
}

// ─────────────────────────────────────────────────────────────────────────────
export default async function handler(req: any, res: any) {
  res.setHeader?.("Access-Control-Allow-Origin", "*");
  res.setHeader?.("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader?.("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  const action = String(req.query?.action ?? "");

  try {
    const userId = await requireUserOr401(req, res);
    if (!userId) return;
    // Authenticated per-user budget; ipOnly is wrong here (campus NATs share IPs).
    if (!(await rateLimit(req, res, "room-session", { anonMax: 10, authMax: 60, windowSecs: 60 }))) return;
    const db = sb();

    // ── start ───────────────────────────────────────────────────────────────
    if (action === "start" && req.method === "POST") {
      const { roomId } = req.body ?? {};
      if (!UUID_RE.test(String(roomId))) return res.status(400).json({ error: "valid roomId required" });
      const member = await memberOf(db, roomId, userId);
      if (!member) return res.status(403).json({ error: "not a member of this room" });

      // Idempotent: an active session is resumed, not duplicated.
      const active = await db.select(`room_ai_sessions?room_id=eq.${roomId}&state=eq.active&select=*&limit=1`);
      if (active[0]) {
        const cfg = (await db.select(`room_configs?room_id=eq.${roomId}&version=eq.${active[0].config_version}&select=*&limit=1`))[0];
        const snap = (await db.select(`room_brain_snapshots?session_id=eq.${active[0].id}&select=participant_summaries,group_strategy&order=created_at.desc&limit=1`))[0];
        const prefs = snap ? [...new Set((snap.participant_summaries as any[]).flatMap((p: any) => p.teaching_preferences ?? []))].slice(0, 6) : [];
        return res.status(200).json({
          ok: true, resumed: true,
          session: { id: active[0].id, roomId, state: "active", startedAt: active[0].started_at, configVersion: active[0].config_version },
          config: { persona: cfg?.persona ?? "facilitator", intensity: cfg?.intervention_intensity ?? "balanced", durationMinutes: cfg?.duration_minutes ?? null },
          roomPlan: { participant_count: snap ? (snap.participant_summaries as any[]).length : 0, group_preferences: prefs, version: 1 },
        });
      }

      const persona: PersonaId = PERSONA_IDS.includes(req.body?.persona) ? req.body.persona : "facilitator";
      const intensity: InterventionIntensity = ["low", "balanced", "active"].includes(req.body?.intensity) ? req.body.intensity : "balanced";
      const durationMinutes = Number.isFinite(+req.body?.durationMinutes) ? Math.min(Math.max(+req.body.durationMinutes, 15), 180) : null;

      const room = (await db.select(`study_rooms?id=eq.${roomId}&select=id,course_id&limit=1`))[0];
      if (!room) return res.status(404).json({ error: "room not found" });

      // Compose FIRST (read-only) — nothing is written until composition succeeds, so a
      // compose failure can never orphan a config row.
      const { plan, sourceVersionIds } = await composeRoomPlan(db, roomId, room.course_id != null ? String(room.course_id) : null);

      // Freeze a config version (monotonic per room; one retry absorbs a concurrent bump).
      let version = 0;
      for (let attempt = 0; attempt < 2; attempt++) {
        const prev = await db.select(`room_configs?room_id=eq.${roomId}&select=version&order=version.desc&limit=1`);
        version = (prev[0]?.version ?? 0) + 1;
        try {
          await db.insert("room_configs", {
            room_id: roomId, version, persona, intervention_intensity: intensity,
            duration_minutes: durationMinutes, created_by: userId,
          }, false);
          break;
        } catch (e) {
          if (attempt === 1) throw e;               // second collision → surface it
        }
      }

      let session: any;
      try {
        [session] = await db.insert("room_ai_sessions", {
          room_id: roomId, config_version: version, started_by: userId,
        });
      } catch {
        // Lost the one-active-per-room race to a concurrent start → resume the winner's
        // session instead of failing (idempotency must hold under concurrency, not just
        // sequential retries).
        const winner = (await db.select(`room_ai_sessions?room_id=eq.${roomId}&state=eq.active&select=*&limit=1`))[0];
        if (!winner) throw new Error("session start conflicted and no active session found — retry");
        const cfg = (await db.select(`room_configs?room_id=eq.${roomId}&version=eq.${winner.config_version}&select=*&limit=1`))[0];
        const prefs = [...new Set(plan.participants.flatMap(p => p.teaching_preferences))].slice(0, 6);
        return res.status(200).json({
          ok: true, resumed: true,
          session: { id: winner.id, roomId, state: "active", startedAt: winner.started_at, configVersion: winner.config_version },
          config: { persona: cfg?.persona ?? "facilitator", intensity: cfg?.intervention_intensity ?? "balanced", durationMinutes: cfg?.duration_minutes ?? null },
          roomPlan: { participant_count: plan.participants.length, group_preferences: prefs, version: plan.version },
        });
      }
      await db.insert("room_brain_snapshots", {
        session_id: session.id,
        source_version_ids: sourceVersionIds,
        participant_summaries: plan.participants,
        group_strategy: plan.group_strategy,
        content_hash: String(Math.abs([...JSON.stringify(plan)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0))),
      }, false);
      await db.insert("activity_events", {
        session_id: session.id, room_id: roomId, user_id: userId, type: "session_started",
      }, false).catch(() => {});

      // A5: warm each participant's brain context_window (fire-and-forget). Only on a FRESH start —
      // this is the join/compose event; resume deliberately writes nothing. The heavy warm runs in
      // the jobs worker; enqueue must never fail the start, so errors are swallowed per row.
      await enqueueWarmJobs(db, roomId, plan.participants.map(p => p.user_id));

      const prefs = [...new Set(plan.participants.flatMap(p => p.teaching_preferences))].slice(0, 6);
      return res.status(200).json({
        ok: true, resumed: false,
        session: { id: session.id, roomId, state: "active", startedAt: session.started_at, configVersion: version },
        config: { persona, intensity, durationMinutes },
        roomPlan: { participant_count: plan.participants.length, group_preferences: prefs, version: plan.version },
      });
    }

    // ── end ─────────────────────────────────────────────────────────────────
    if (action === "end" && req.method === "POST") {
      const { sessionId } = req.body ?? {};
      if (!UUID_RE.test(String(sessionId))) return res.status(400).json({ error: "valid sessionId required" });
      const session = (await db.select(`room_ai_sessions?id=eq.${sessionId}&select=*&limit=1`))[0];
      if (!session) return res.status(404).json({ error: "session not found" });
      if (!(await memberOf(db, session.room_id, userId))) return res.status(403).json({ error: "not a member of this room" });

      if (session.state === "active") {
        await db.update(`room_ai_sessions?id=eq.${sessionId}&state=eq.active`, { state: "ended", ended_at: new Date().toISOString() });
        await db.insert("activity_events", {
          session_id: sessionId, room_id: session.room_id, user_id: userId, type: "session_ended",
        }, false).catch(() => {});
      }

      // Enqueue output jobs — idempotency keys make repeat calls harmless. The worker
      // (BE-08/AI-10/11/12) drains these via claim_job().
      const members = await db.select(`room_members?room_id=eq.${session.room_id}&status=eq.joined&select=user_id`);
      const jobs = [
        { type: JOB_TYPES.summary, idempotency_key: `${JOB_TYPES.summary}:${sessionId}`, payload: { sessionId, roomId: session.room_id } },
        ...members.flatMap((m: any) => [
          { type: JOB_TYPES.quiz, idempotency_key: `${JOB_TYPES.quiz}:${sessionId}:${m.user_id}`, payload: { sessionId, userId: m.user_id } },
          { type: JOB_TYPES.brainProposal, idempotency_key: `${JOB_TYPES.brainProposal}:${sessionId}:${m.user_id}`, payload: { sessionId, userId: m.user_id } },
        ]),
      ];
      const created: { type: string; id: string }[] = [];
      for (const j of jobs) {
        try {
          const [row] = await db.insert("jobs", j);
          created.push({ type: j.type, id: row.id });
        } catch { /* duplicate idempotency key → already enqueued */ }
      }
      return res.status(200).json({ ok: true, sessionId, state: "ended", jobs: created });
    }

    // ── review ──────────────────────────────────────────────────────────────
    if (action === "review" && req.method === "GET") {
      const sessionId = String(req.query?.sessionId ?? "");
      if (!UUID_RE.test(sessionId)) return res.status(400).json({ error: "valid sessionId required" });
      const session = (await db.select(`room_ai_sessions?id=eq.${sessionId}&select=*&limit=1`))[0];
      if (!session) return res.status(404).json({ error: "session not found" });
      if (!(await memberOf(db, session.room_id, userId))) return res.status(403).json({ error: "not a member of this room" });

      const uid = encodeURIComponent(userId);
      const [summaries, quizzes, proposals, jobRows] = await Promise.all([
        db.select(`session_summaries?session_id=eq.${sessionId}&select=scope,user_id,summary,status`),
        db.select(`quiz_sets?session_id=eq.${sessionId}&user_id=eq.${uid}&select=questions,version`),
        db.select(`brain_update_proposals?session_id=eq.${sessionId}&user_id=eq.${uid}&select=id,patch,evidence,confidence,status`),
        db.select(`jobs?idempotency_key=like.*${sessionId}*&select=type,status,idempotency_key`),
      ]);
      const group = summaries.find((s: any) => s.scope === "group") ?? null;
      const mine = summaries.find((s: any) => s.scope === "individual" && s.user_id === userId) ?? null;
      const jobStatus: Record<string, string> = {};
      for (const j of jobRows) {
        // caller sees their own quiz/proposal job state + the group summary state
        if (j.idempotency_key.endsWith(`:${sessionId}`) || j.idempotency_key.endsWith(`:${userId}`)) {
          jobStatus[j.type] = j.status;
        }
      }
      return res.status(200).json({
        ok: true,
        session: { id: session.id, roomId: session.room_id, startedAt: session.started_at, endedAt: session.ended_at, state: session.state },
        groupSummary: group?.summary ?? null,
        mySummary: mine?.summary ?? null,
        myQuiz: quizzes[0]?.questions ?? null,
        myProposals: proposals,
        jobs: jobStatus,
      });
    }

    // ── proposal (accept | edit | reject) ───────────────────────────────────
    if (action === "proposal" && req.method === "POST") {
      const { proposalId, decision, patch } = req.body ?? {};
      if (!UUID_RE.test(String(proposalId))) return res.status(400).json({ error: "valid proposalId required" });
      if (!["accept", "edit", "reject"].includes(decision)) return res.status(400).json({ error: "decision must be accept|edit|reject" });

      const proposal = (await db.select(`brain_update_proposals?id=eq.${proposalId}&select=*&limit=1`))[0];
      if (!proposal) return res.status(404).json({ error: "proposal not found" });
      // Ownership is the security boundary: only the student decides their own Brain.
      if (proposal.user_id !== userId) return res.status(403).json({ error: "not your proposal" });
      if (proposal.status !== "pending") return res.status(409).json({ error: `already ${proposal.status}` });

      if (decision === "reject") {
        await db.update(`brain_update_proposals?id=eq.${proposalId}&status=eq.pending`, { status: "rejected", decided_at: new Date().toISOString() });
        return res.status(200).json({ ok: true, status: "rejected" });
      }

      // accept/edit → merge into a NEW immutable version. Validation is pure, so it runs
      // BEFORE the flip; but the guarded flip must WIN before anything is written —
      // otherwise a double-submit could mint duplicate versions and repoint the brain
      // to the loser's version.
      const effectivePatch = decision === "edit" ? (patch ?? {}) : proposal.patch;
      const brain = (await db.select(`student_brains?user_id=eq.${encodeURIComponent(userId)}&select=*&limit=1`))[0];
      let baseProfile: BrainProfile;
      if (brain?.active_version_id) {
        const v = (await db.select(`brain_versions?id=eq.${brain.active_version_id}&select=profile&limit=1`))[0];
        baseProfile = v?.profile ?? emptyBrainProfile(userId);
      } else {
        const u = (await db.select(`users?id=eq.${encodeURIComponent(userId)}&select=name&limit=1`))[0];
        baseProfile = emptyBrainProfile((u?.name || "Student").split(/\s+/)[0]);
      }
      const nextProfile = applyBrainPatch(baseProfile, effectivePatch);
      const problems = validateBrainProfile(nextProfile);
      if (problems.length) return res.status(422).json({ error: "patch produces an invalid profile", problems });

      // Claim the decision atomically: only the request whose PATCH flips pending→decided
      // gets to write. The loser sees zero rows and stops with 409, having written nothing.
      const flipped = await db.update(`brain_update_proposals?id=eq.${proposalId}&status=eq.pending`, {
        status: decision === "edit" ? "edited" : "accepted", decided_at: new Date().toISOString(),
      });
      if (!flipped.length) return res.status(409).json({ error: "proposal was decided concurrently" });

      try {
        const [ver] = await db.insert("brain_versions", {
          user_id: userId, schema_version: BRAIN_SCHEMA_VERSION,
          profile: nextProfile, markdown: brainToMarkdown(nextProfile), source: "proposal",
        });
        await db.upsert("student_brains", { user_id: userId, active_version_id: ver.id, updated_at: new Date().toISOString() }, "user_id");
        return res.status(200).json({ ok: true, status: decision === "edit" ? "edited" : "accepted", versionId: ver.id });
      } catch (e) {
        // Version write failed after the claim — put the proposal back so the student can retry.
        await db.update(`brain_update_proposals?id=eq.${proposalId}`, { status: "pending", decided_at: null }).catch(() => {});
        throw e;
      }
    }

    // ── sources (bind the caller's OWN documents to the room) ───────────────
    if (action === "sources" && req.method === "POST") {
      const { roomId, documentIds } = req.body ?? {};
      if (!UUID_RE.test(String(roomId))) return res.status(400).json({ error: "valid roomId required" });
      if (!Array.isArray(documentIds) || documentIds.length === 0 || documentIds.length > 12 || !documentIds.every((d: any) => UUID_RE.test(String(d)))) {
        return res.status(400).json({ error: "documentIds: 1–12 uuids required" });
      }
      if (!(await memberOf(db, roomId, userId))) return res.status(403).json({ error: "not a member of this room" });
      // Ownership check: you can only share documents YOU ingested.
      const owned = await db.select(`rag_documents?id=in.(${documentIds.join(",")})&user_id=eq.${encodeURIComponent(userId)}&select=id,title`);
      if (owned.length !== documentIds.length) return res.status(403).json({ error: "one or more documents are not yours" });
      const rows = await db.upsert("room_sources",
        owned.map((d: any) => ({ room_id: roomId, document_id: d.id, added_by: userId, enabled: true })),
        "room_id,document_id");
      return res.status(200).json({ ok: true, sources: rows.map((r: any) => ({ id: r.id, documentId: r.document_id })) });
    }
    if (action === "sources" && req.method === "GET") {
      const roomId = String(req.query?.roomId ?? "");
      if (!UUID_RE.test(roomId)) return res.status(400).json({ error: "valid roomId required" });
      if (!(await memberOf(db, roomId, userId))) return res.status(403).json({ error: "not a member of this room" });
      const rows = await db.select(`room_sources?room_id=eq.${roomId}&enabled=is.true&select=id,document_id,added_by,created_at`);
      const docIds = rows.map((r: any) => r.document_id);
      const titles = docIds.length ? await db.select(`rag_documents?id=in.(${docIds.join(",")})&select=id,title`) : [];
      const titleById = new Map(titles.map((t: any) => [t.id, t.title]));
      return res.status(200).json({ ok: true, sources: rows.map((r: any) => ({ id: r.id, documentId: r.document_id, title: titleById.get(r.document_id) ?? "Document", addedBy: r.added_by })) });
    }

    // ── autosources: auto-bind the caller's OWN most-relevant docs to the room ──
    // The room tutor grounds ONLY on room_sources, and nothing ever populated it — so
    // guided sessions taught from general knowledge even when the student had their whole
    // course indexed. On session start the client calls this with the session topic; we
    // pick the caller's documents most relevant to that topic (their own corpus only —
    // same ownership boundary as ?action=sources) and bind up to the 12-doc cap so the
    // in-room retrieval has real course material to teach from.
    if (action === "autosources" && req.method === "POST") {
      const { roomId, topic } = req.body ?? {};
      if (!UUID_RE.test(String(roomId))) return res.status(400).json({ error: "valid roomId required" });
      if (!(await memberOf(db, roomId, userId))) return res.status(403).json({ error: "not a member of this room" });

      const t = String(topic ?? "").trim().slice(0, 2000);
      const uid = encodeURIComponent(userId);
      let docIds: string[] = [];

      // Relevance-first: hybrid search over the caller's own corpus for the session topic.
      if (t) {
        try {
          const [vec] = await embed([t]);
          const hits = await db.rpc("rag_hybrid_search", {
            p_user_id: userId, p_query_embedding: vec, p_query_text: t,
            p_course_id: null, p_match_count: 30,
          });
          const seen = new Set<string>();
          for (const h of hits ?? []) {
            const d = String(h.document_id ?? "");
            if (d && !seen.has(d)) { seen.add(d); docIds.push(d); }
            if (docIds.length >= 12) break;
          }
        } catch { /* fall through to recency */ }
      }
      // Fallback: the caller's most-recent documents (e.g. no topic, or embedding failed).
      if (docIds.length === 0) {
        const docs = await db.select(`rag_documents?user_id=eq.${uid}&select=id&order=created_at.desc&limit=12`);
        docIds = docs.map((d: any) => String(d.id));
      }
      if (docIds.length === 0) return res.status(200).json({ ok: true, bound: 0, reason: "no documents" });

      const rows = await db.upsert("room_sources",
        docIds.map((id) => ({ room_id: roomId, document_id: id, added_by: userId, enabled: true })),
        "room_id,document_id");
      return res.status(200).json({ ok: true, bound: rows.length });
    }

    return res.status(400).json({ error: "Unknown action. Use start, end, review, proposal, sources, or autosources." });
  } catch (e: any) {
    console.error("[room-session]", e?.message);
    return res.status(502).json({ error: e?.message ?? "room-session failed" });
  }
}

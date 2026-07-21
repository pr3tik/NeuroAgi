// @vitest-environment node
// The Home "Today" panel's ranking — deriveNextActions merges every proactive source
// (Canvas deadlines, exam-plan sessions, SRS) into ONE ranked top-3. Pins the ranking
// contract: priority order, one-row-per-source diversity, fold counts, and the
// today's-plan-session-beats-tomorrow's-deadline rule.
import { describe, it, expect } from "vitest";
import { deriveNextActions } from "../src/lib/nextActions";

const NOW = new Date("2026-07-20T15:00:00");
const iso = (d: string, h = 23) => new Date(`${d}T${String(h).padStart(2, "0")}:59:00`).toISOString();

const asg = (name: string, dueAt: string, submitted = false, course = "CHEM 101") => ({
  id: name, name, courseCode: course, dueAt,
  submission: submitted ? { submittedAt: dueAt } : undefined,
});

const plan = (examDate: string, sessions: any[]) => ({ exam_date: examDate, sessions });

describe("deriveNextActions", () => {
  it("ranks overdue > due-today > today's plan session > due-tomorrow > srs, capped at 3", () => {
    const out = deriveNextActions({
      now: NOW,
      assignments: [
        asg("Late lab", iso("2026-07-18")),
        asg("Due today essay", iso("2026-07-20")),
        asg("Tomorrow quiz prep", iso("2026-07-21")),
      ],
      plan: plan("2026-07-24", [{ date: "2026-07-20", topic: "The Mole", estimatedMinutes: 60 }]),
      srsDue: 12,
    });
    expect(out).toHaveLength(3);
    expect(out.map(a => a.kind)).toEqual(["overdue", "due_today", "plan_session"]);
  });

  it("one row per source with the remainder folded into detail", () => {
    const out = deriveNextActions({
      now: NOW,
      assignments: [
        asg("Old lab 1", iso("2026-07-10")),
        asg("Old lab 2", iso("2026-07-15")),
        asg("Old lab 3", iso("2026-07-18")),
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe("Old lab 3");            // most recently missed leads
    expect(out[0].detail).toContain("+2 more overdue");
  });

  it("today's plan session outranks tomorrow's deadline; a future session does not", () => {
    const base = {
      now: NOW,
      assignments: [asg("Tomorrow essay", iso("2026-07-21"))],
    };
    const today = deriveNextActions({ ...base, plan: plan("2026-07-24", [{ date: "2026-07-20", topic: "Kinetics" }]) });
    expect(today.map(a => a.kind)).toEqual(["plan_session", "due_tomorrow"]);

    const future = deriveNextActions({ ...base, plan: plan("2026-07-24", [{ date: "2026-07-22", topic: "Kinetics" }]) });
    expect(future.map(a => a.kind)).toEqual(["due_tomorrow", "plan_session"]);
  });

  it("submitted assignments and past exams contribute nothing", () => {
    const out = deriveNextActions({
      now: NOW,
      assignments: [asg("Done already", iso("2026-07-18"), true)],
      plan: plan("2026-07-19", [{ date: "2026-07-18", topic: "Old" }]),   // exam already passed
      srsDue: 0,
    });
    expect(out).toEqual([]);
  });

  it("srs alone produces one actionable row with a bounded time estimate", () => {
    const out = deriveNextActions({ now: NOW, srsDue: 100 });
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("srs");
    expect(out[0].page).toBe("study");
    expect(out[0].minutes).toBeLessThanOrEqual(15);
  });
});

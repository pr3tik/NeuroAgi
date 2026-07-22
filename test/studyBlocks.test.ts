// @vitest-environment node
// studyBlocks.test.ts — the deterministic suggestion rules, pinned.
// Pure function, injectable `now` — no mocks, no timers.

import { describe, it, expect } from "vitest";
import { suggestStudyBlocks } from "../src/lib/studyBlocks";

// Fixed reference point: Tue 2026-07-21, 09:00 local.
const NOW = new Date(2026, 6, 21, 9, 0, 0);
// Local-day helper mirroring the lib's key format.
const key = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
// An assignment due N days from NOW at 23:59 local.
const dueIn = (days: number, name: string, extra: any = {}) => ({
  id: name,
  name,
  dueAt: new Date(2026, 6, 21 + days, 23, 59, 0).toISOString(),
  ...extra,
});

describe("suggestStudyBlocks", () => {
  it("puts the prep block the day BEFORE due; due-tomorrow lands today", () => {
    const blocks = suggestStudyBlocks({
      assignments: [dueIn(1, "Reflection 7"), dueIn(3, "Problem Set 4")],
      plan: null,
      now: NOW,
    });
    expect(blocks).toEqual([
      { date: key(2026, 7, 21), title: "Prep: Reflection 7", minutes: 45, kind: "suggested" },
      { date: key(2026, 7, 23), title: "Prep: Problem Set 4", minutes: 45, kind: "suggested" },
    ]);
  });

  it("skips days the committed plan already owns", () => {
    const blocks = suggestStudyBlocks({
      assignments: [dueIn(3, "Essay draft")], // prep day = Jul 23
      plan: { sessions: [{ date: "2026-07-23", topic: "Ch. 5 review" }] },
      now: NOW,
    });
    expect(blocks).toEqual([]); // dropped, not rescheduled — the plan owns Jul 23
  });

  it("caps at 2 suggestions per day, soonest-due first", () => {
    const blocks = suggestStudyBlocks({
      assignments: [
        // All three due Jul 24 → all want Jul 23. Due times stagger so "soonest" is testable.
        { id: "a", name: "Quiz A", dueAt: new Date(2026, 6, 24, 9, 0).toISOString() },
        { id: "c", name: "Lab C", dueAt: new Date(2026, 6, 24, 23, 0).toISOString() },
        { id: "b", name: "Memo B", dueAt: new Date(2026, 6, 24, 12, 0).toISOString() },
      ],
      plan: null,
      now: NOW,
    });
    expect(blocks).toHaveLength(2);
    expect(blocks.map(b => b.title)).toEqual(["Prep: Quiz A", "Prep: Memo B"]); // Lab C lost the slots
    expect(blocks.every(b => b.date === key(2026, 7, 23))).toBe(true);
  });

  it("excludes submitted assignments, out-of-window dues, and dedups by assignment", () => {
    const blocks = suggestStudyBlocks({
      assignments: [
        dueIn(2, "Submitted one", { submission: { submittedAt: "2026-07-20T10:00:00Z" } }),
        dueIn(0, "Due today"),        // not 1–7 days out
        dueIn(-1, "Overdue"),         // past
        dueIn(9, "Far future"),       // beyond the window
        dueIn(4, "Real work"),
        dueIn(4, "Real work"),        // duplicate id → one block
        { id: "x", name: "No due date" },
      ],
      plan: null,
      now: NOW,
    });
    expect(blocks).toEqual([
      { date: key(2026, 7, 24), title: "Prep: Real work", minutes: 45, kind: "suggested" },
    ]);
  });

  it("never throws on empty/absent inputs", () => {
    expect(suggestStudyBlocks({ now: NOW })).toEqual([]);
    expect(suggestStudyBlocks({ assignments: [], plan: { sessions: [] }, now: NOW })).toEqual([]);
  });
});

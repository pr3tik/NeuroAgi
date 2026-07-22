// @vitest-environment node
// studyBlocks.test.ts — the deterministic suggestion rules, pinned.
// Pure functions, injectable `now` — no mocks, no timers.

import { describe, it, expect } from "vitest";
import { suggestStudyBlocks, applyCalendarEdits, SuggestedBlock } from "../src/lib/studyBlocks";

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
// Evening slots (rule 5): first block of a day 6:00 PM, second 7:15 PM.
const SLOT1 = 18 * 60;       // 1080
const SLOT2 = 19 * 60 + 15;  // 1155

describe("suggestStudyBlocks", () => {
  it("puts the prep block the day BEFORE due; due-tomorrow lands today", () => {
    const blocks = suggestStudyBlocks({
      assignments: [dueIn(1, "Reflection 7"), dueIn(3, "Problem Set 4")],
      plan: null,
      now: NOW,
    });
    expect(blocks).toEqual([
      { id: "sb:Reflection 7", date: key(2026, 7, 21), title: "Prep: Reflection 7", minutes: 45, startMin: SLOT1, kind: "suggested" },
      { id: "sb:Problem Set 4", date: key(2026, 7, 23), title: "Prep: Problem Set 4", minutes: 45, startMin: SLOT1, kind: "suggested" },
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

  it("staggers evening start times: first block 18:00 (1080), second 19:15 (1155), per day", () => {
    const blocks = suggestStudyBlocks({
      assignments: [
        // Two prepping on Jul 23 (due Jul 24), one alone on Jul 24 (due Jul 25).
        { id: "a", name: "Quiz A", dueAt: new Date(2026, 6, 24, 9, 0).toISOString() },
        { id: "b", name: "Memo B", dueAt: new Date(2026, 6, 24, 12, 0).toISOString() },
        { id: "d", name: "Essay D", dueAt: new Date(2026, 6, 25, 12, 0).toISOString() },
      ],
      plan: null,
      now: NOW,
    });
    expect(blocks.map(b => [b.date, b.startMin])).toEqual([
      [key(2026, 7, 23), 1080],   // first slot of Jul 23 — 6:00 PM
      [key(2026, 7, 23), 1155],   // second slot of Jul 23 — 7:15 PM
      [key(2026, 7, 24), 1080],   // the stagger resets per day
    ]);
  });

  it("gives every block a stable id derived from the assignment", () => {
    const run = () => suggestStudyBlocks({ assignments: [dueIn(4, "Real work")], plan: null, now: NOW });
    expect(run().map(b => b.id)).toEqual(["sb:Real work"]);
    expect(run()).toEqual(run()); // same inputs → identical ids (localStorage keys depend on this)
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
      { id: "sb:Real work", date: key(2026, 7, 24), title: "Prep: Real work", minutes: 45, startMin: SLOT1, kind: "suggested" },
    ]);
  });

  it("never throws on empty/absent inputs", () => {
    expect(suggestStudyBlocks({ now: NOW })).toEqual([]);
    expect(suggestStudyBlocks({ assignments: [], plan: { sessions: [] }, now: NOW })).toEqual([]);
  });
});

describe("applyCalendarEdits", () => {
  const sug = (id: string, date: string, startMin = SLOT1): SuggestedBlock =>
    ({ id, date, title: `Prep: ${id}`, minutes: 45, startMin, kind: "suggested" });

  it("passes suggestions through untouched when there are no edits", () => {
    const s = [sug("sb:A", "2026-07-23"), sug("sb:B", "2026-07-24")];
    expect(applyCalendarEdits(s, null)).toEqual(s);
    expect(applyCalendarEdits(s, {})).toEqual(s);
  });

  it("an override moves a block to its new day/time", () => {
    const out = applyCalendarEdits(
      [sug("sb:A", "2026-07-23"), sug("sb:B", "2026-07-24")],
      { overrides: { "sb:A": { date: "2026-07-25", startMin: 9 * 60 } } },
    );
    expect(out.map(b => [b.id, b.date, b.startMin])).toEqual([
      ["sb:B", "2026-07-24", SLOT1],
      ["sb:A", "2026-07-25", 540],   // moved — and re-sorted into chronological order
    ]);
    expect(out[1].title).toBe("Prep: sb:A"); // only the placement changed
  });

  it("a partial override (startMin only) keeps the original day", () => {
    const out = applyCalendarEdits([sug("sb:A", "2026-07-23")], { overrides: { "sb:A": { startMin: 600 } } });
    expect(out).toEqual([{ ...sug("sb:A", "2026-07-23"), startMin: 600 }]);
  });

  it("dismissed removes a suggested block", () => {
    const out = applyCalendarEdits(
      [sug("sb:A", "2026-07-23"), sug("sb:B", "2026-07-24")],
      { dismissed: ["sb:A"] },
    );
    expect(out.map(b => b.id)).toEqual(["sb:B"]);
  });

  it("created blocks append with kind 'created' and honor overrides too", () => {
    const out = applyCalendarEdits(
      [sug("sb:A", "2026-07-24")],
      {
        created: [
          { id: "u-1", date: "2026-07-23", startMin: 600, minutes: 45, title: "Study session" },
          { id: "u-2", date: "2026-07-25", startMin: 900, minutes: 30, title: "Study session" },
        ],
        overrides: { "u-2": { startMin: 480 } },
      },
    );
    expect(out.map(b => [b.id, b.kind, b.date, b.startMin, b.minutes])).toEqual([
      ["u-1", "created", "2026-07-23", 600, 45],
      ["sb:A", "suggested", "2026-07-24", SLOT1, 45],
      ["u-2", "created", "2026-07-25", 480, 30],
    ]);
  });

  it("survives malformed stored data without throwing", () => {
    const s = [sug("sb:A", "2026-07-23")];
    expect(applyCalendarEdits(s, { created: [{ id: "", date: "" } as any, null as any] })).toEqual(s);
    expect(applyCalendarEdits(s, { created: [{ id: "u-1", date: "2026-07-24", startMin: NaN, minutes: -5, title: "" } as any] }))
      .toEqual([...s, { id: "u-1", date: "2026-07-24", startMin: SLOT1, minutes: 45, title: "Study session", kind: "created" }]);
    expect(applyCalendarEdits(undefined as any, undefined as any)).toEqual([]);
  });
});

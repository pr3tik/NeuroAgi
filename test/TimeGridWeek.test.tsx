// TimeGridWeek.test.tsx — render smoke tests for the editable time grid.
// The drag math lives in pointer handlers (hard to unit-test without a layout
// engine), but the render path, the localStorage merge, and crash-safety on
// empty inputs are all checkable in jsdom.

import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import TimeGridWeek from "../src/components/TimeGridWeek";
import { SuggestedBlock } from "../src/lib/studyBlocks";

// Fixed reference point: Tue 2026-07-21, 09:00 local (mid-grid → now-line shows).
const NOW = new Date(2026, 6, 21, 9, 0, 0);
const KEY = "fschool_cal_test";

const SUGGESTED: SuggestedBlock[] = [
  { id: "sb:PS4", date: "2026-07-23", title: "Prep: Problem Set 4", minutes: 45, startMin: 1080, kind: "suggested" },
];

beforeEach(() => localStorage.clear());

describe("TimeGridWeek", () => {
  it("renders hour labels, day headers, and a suggested block at its slot", () => {
    render(<TimeGridWeek assignments={[]} plan={null} suggested={SUGGESTED} now={NOW} storageKey={KEY} />);
    expect(screen.getByText("7:00")).toBeInTheDocument();     // gutter top
    expect(screen.getByText("23:00")).toBeInTheDocument();    // gutter bottom
    expect(screen.getByText("Jul 19 – Jul 25, 2026")).toBeInTheDocument(); // range label
    expect(screen.getByText("Prep: Problem Set 4")).toBeInTheDocument();
    expect(screen.getByText("6:00 – 6:45 PM")).toBeInTheDocument(); // 1080 + 45
  });

  it("survives empty/absent inputs", () => {
    const { container } = render(
      <TimeGridWeek assignments={[]} plan={null} suggested={[]} now={NOW} storageKey={KEY} />,
    );
    expect(container.firstChild).toBeTruthy();
  });

  it("places a due marker at the assignment's real time and pins overdue/reviews chips on today", () => {
    const assignments = [
      { id: 1, name: "Reflection 7", dueAt: new Date(2026, 6, 22, 23, 59).toISOString() },      // in week
      { id: 2, name: "Old thing", dueAt: new Date(2026, 6, 19, 23, 59).toISOString() },         // unsubmitted past-due
    ];
    render(
      <TimeGridWeek
        assignments={assignments}
        plan={{ exam_date: "2026-07-24", sessions: [{ date: "2026-07-22", topic: "Ch. 5 review" }] }}
        suggested={[]}
        srsDue={3}
        now={NOW}
        storageKey={KEY}
      />,
    );
    expect(screen.getByText(/Reflection 7 · 11:59 PM/)).toBeInTheDocument();
    expect(screen.getByText("1 overdue")).toBeInTheDocument();  // folded onto today, not painted on Jul 19
    expect(screen.queryByText(/Old thing/)).not.toBeInTheDocument();
    expect(screen.getByText("EXAM")).toBeInTheDocument();
    expect(screen.getByText("Ch. 5 review")).toBeInTheDocument();
    expect(screen.getByText("3 reviews")).toBeInTheDocument();
  });

  it("applies localStorage edits: override moves the block, dismissal hides it, created blocks render", () => {
    localStorage.setItem(KEY, JSON.stringify({
      overrides: { "sb:PS4": { date: "2026-07-24", startMin: 600 } },
      created: [{ id: "u-1", date: "2026-07-21", startMin: 780, minutes: 45, title: "Study session" }],
      dismissed: [],
    }));
    render(<TimeGridWeek assignments={[]} plan={null} suggested={SUGGESTED} now={NOW} storageKey={KEY} />);
    expect(screen.getByText("10:00 – 10:45 AM")).toBeInTheDocument(); // moved to 600
    expect(screen.getByText("Study session")).toBeInTheDocument();    // created block
    expect(screen.getByText("1:00 – 1:45 PM")).toBeInTheDocument();   // at 780
  });

  it("hides a dismissed suggestion", () => {
    localStorage.setItem(KEY, JSON.stringify({ overrides: {}, created: [], dismissed: ["sb:PS4"] }));
    render(<TimeGridWeek assignments={[]} plan={null} suggested={SUGGESTED} now={NOW} storageKey={KEY} />);
    expect(screen.queryByText("Prep: Problem Set 4")).not.toBeInTheDocument();
  });

  it("survives garbage in localStorage", () => {
    localStorage.setItem(KEY, "{not json");
    render(<TimeGridWeek assignments={[]} plan={null} suggested={SUGGESTED} now={NOW} storageKey={KEY} />);
    expect(screen.getByText("Prep: Problem Set 4")).toBeInTheDocument(); // falls back to raw suggestions
  });
});

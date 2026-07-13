import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import BottomNav from "../src/components/BottomNav";

// Force the wide (≥768px) breakpoint → BottomNav renders its sidebar layout.
beforeEach(() => {
  window.matchMedia = ((q: string) => ({
    matches: true, media: q, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return false; },
  })) as any;
});

// Tabs is now the ONLY nav mode (swipe removed), so BottomNav is the sole way to reach
// every page — this list is the reachability guarantee the deleted nav.test.ts used to
// give the swipe graph. Kept as an explicit list of the 12 routable pages (NOT derived
// from LABEL, which carries a dead "courses" key with no route/tab).
const ALL_PAGE_LABELS = [
  "Work", "Canvas", "Study", "Leaderboard", "Identity",   // primary
  "Assignment", "Toolkit", "Files", "Rooms", "Spaces", "Reggie", "Connections", // secondary
];

describe("BottomNav (web sidebar)", () => {
  it("shows EVERY routable page (primary + secondary) and no mobile 'More' sheet", () => {
    render(<BottomNav currentPage="work" onNavigate={vi.fn()} />);
    for (const label of ALL_PAGE_LABELS)
      expect(screen.getByText(label), `sidebar missing "${label}"`).toBeInTheDocument();
    expect(screen.queryByText("More")).not.toBeInTheDocument();
  });

  it("routes on click", () => {
    const onNav = vi.fn();
    render(<BottomNav currentPage="work" onNavigate={onNav} />);
    fireEvent.click(screen.getByText("Files"));
    expect(onNav).toHaveBeenCalledWith("files");
  });

  it("fires onToggleCollapse from the collapse control", () => {
    const onToggle = vi.fn();
    render(<BottomNav currentPage="work" onNavigate={vi.fn()} collapsed={false} onToggleCollapse={onToggle} />);
    fireEvent.click(screen.getByTitle("Collapse sidebar"));
    expect(onToggle).toHaveBeenCalled();
  });

  it("collapses to icon-only (labels hidden, expand affordance shown)", () => {
    render(<BottomNav currentPage="work" onNavigate={vi.fn()} collapsed={true} onToggleCollapse={vi.fn()} />);
    expect(screen.queryByText("Work")).not.toBeInTheDocument(); // labels hidden when collapsed
    expect(screen.getByTitle("Expand sidebar")).toBeInTheDocument();
  });
});

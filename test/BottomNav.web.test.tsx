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

// The demo nav is the DEFAULT (VITE_DEMO_NAV unset → on): six destinations chaptered
// by student intent (UI/UX spec v2). Other pages stay routable by key — they're just
// not nav doors in the demo build (set VITE_DEMO_NAV=0 to restore the full nav).
const DEMO_LABELS  = ["Today", "Reggie", "Study", "Canvas", "Files", "Rooms"];
const GROUP_LABELS = ["Learn", "My courses", "Together"];

describe("BottomNav (web sidebar)", () => {
  it("shows the six demo destinations chaptered by intent group", () => {
    render(<BottomNav currentPage="work" onNavigate={vi.fn()} />);
    for (const label of [...DEMO_LABELS, ...GROUP_LABELS])
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

  it("collapses to icon-only and expands on hover (labels return + pin affordance)", () => {
    const { container } = render(<BottomNav currentPage="work" onNavigate={vi.fn()} collapsed={true} onToggleCollapse={vi.fn()} />);
    expect(screen.queryByText("Today")).not.toBeInTheDocument(); // labels hidden when collapsed
    fireEvent.mouseEnter(container.querySelector("aside")!);      // hover-expand overlay
    expect(screen.getByText("Today")).toBeInTheDocument();
    expect(screen.getByTitle("Keep sidebar open")).toBeInTheDocument(); // pin-open control
  });
});

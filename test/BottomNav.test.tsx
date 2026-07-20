import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import BottomNav from "../src/components/BottomNav";

// matchMedia is mocked to matches:false in test/setup.ts → mobile bottom-bar layout.
// The demo nav is the DEFAULT (VITE_DEMO_NAV unset → on): six destinations, no
// secondary pages, so the mobile bar has no "More" sheet.
describe("BottomNav (mobile bar)", () => {
  it("renders the demo tabs and routes on tap", () => {
    const onNav = vi.fn();
    render(<BottomNav currentPage="work" onNavigate={onNav} />);
    expect(screen.getByText("Today")).toBeInTheDocument();
    expect(screen.getByText("Canvas")).toBeInTheDocument();
    expect(screen.getByText("Reggie")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Canvas"));
    expect(onNav).toHaveBeenCalledWith("canvas");
  });

  it("hides the More sheet when there are no secondary pages", () => {
    render(<BottomNav currentPage="work" onNavigate={vi.fn()} />);
    expect(screen.queryByText("More")).not.toBeInTheDocument();
  });
});

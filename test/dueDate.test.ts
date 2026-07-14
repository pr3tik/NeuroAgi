import { describe, it, expect, afterEach, vi } from "vitest";
import { calendarDaysUntil } from "../src/lib/dueDate";

// These lock in the fix for the relative due-label off-by-one: the day count must reflect
// LOCAL calendar days ("is it due today / tomorrow"), not the raw hours between two instants.
// Pin the clock to a known local moment so the boundaries are deterministic.
function at(y: number, mo: number, d: number, h: number, mi = 0) {
  return new Date(y, mo - 1, d, h, mi); // local-time constructor
}

describe("calendarDaysUntil", () => {
  afterEach(() => vi.useRealTimers());

  it("returns null for empty / invalid input", () => {
    expect(calendarDaysUntil(null)).toBe(null);
    expect(calendarDaysUntil(undefined)).toBe(null);
    expect(calendarDaysUntil("")).toBe(null);
    expect(calendarDaysUntil("not a date")).toBe(null);
  });

  it("counts an assignment due LATER TODAY as 0, regardless of viewing time", () => {
    vi.useFakeTimers();
    vi.setSystemTime(at(2026, 7, 20, 8, 0)); // 8am
    expect(calendarDaysUntil(at(2026, 7, 20, 23, 59).toISOString())).toBe(0); // due 11:59pm today
    vi.setSystemTime(at(2026, 7, 20, 20, 0)); // 8pm — the old ceil() bug flipped this to "Tomorrow"
    expect(calendarDaysUntil(at(2026, 7, 20, 21, 0).toISOString())).toBe(0); // due 9pm today
  });

  it("counts TOMORROW as 1 whether it is due in the morning or evening", () => {
    vi.useFakeTimers();
    vi.setSystemTime(at(2026, 7, 20, 8, 0));
    expect(calendarDaysUntil(at(2026, 7, 21, 9, 0).toISOString())).toBe(1);  // early tomorrow
    expect(calendarDaysUntil(at(2026, 7, 21, 23, 30).toISOString())).toBe(1); // late tomorrow
  });

  it("counts something overdue since yesterday as negative (not 'due today')", () => {
    vi.useFakeTimers();
    vi.setSystemTime(at(2026, 7, 20, 20, 0));
    // old ceil() reported this as 0 → "Due today", hiding that it was already late
    expect(calendarDaysUntil(at(2026, 7, 19, 23, 59).toISOString())).toBe(-1);
  });

  it("gives the same answer on both pages (round vs ceil no longer diverge)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(at(2026, 7, 20, 14, 0)); // 2pm
    const dueTonight = at(2026, 7, 20, 23, 0).toISOString();
    // one primitive → dashboard and assignment list cannot disagree
    expect(calendarDaysUntil(dueTonight)).toBe(0);
  });

  it("counts a full week out as 7", () => {
    vi.useFakeTimers();
    vi.setSystemTime(at(2026, 7, 20, 10, 0));
    expect(calendarDaysUntil(at(2026, 7, 27, 10, 0).toISOString())).toBe(7);
  });
});

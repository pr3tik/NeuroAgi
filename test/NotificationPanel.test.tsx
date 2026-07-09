// Renders the actual NotificationPanel and drives it like a user would — proving the
// effectiveness-feedback UI wiring: opening stamps opened_at, tapping an action stamps
// action_taken, and actions still navigate / resolve as before.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../src/api/notifications", () => ({
  fetchNotifications:       vi.fn(),
  markNotificationsRead:    vi.fn(async () => {}),
  markAllNotificationsRead: vi.fn(async () => {}),
  updateNotificationAction: vi.fn(async () => {}),
  markProactiveOpened:      vi.fn(async () => {}),
  markProactiveActioned:    vi.fn(async () => {}),
}));
vi.mock("../src/api/friends.js", () => ({ respondFriendRequest: vi.fn(async () => {}) }));

import NotificationPanel from "../src/components/NotificationPanel";
import * as notifs from "../src/api/notifications";

const notif = (over: any) => ({
  id: "n1", user_id: "u1", type: "intervention", title: null, body: null,
  read: false, created_at: new Date().toISOString(), data: null, ...over,
});

function renderPanel(extra: any = {}) {
  const props = {
    userId: "u1", liveNotifs: [], onClose: vi.fn(), onNavigate: vi.fn(), onUnreadChange: vi.fn(), ...extra,
  };
  render(<NotificationPanel {...(props as any)} />);
  return props;
}

beforeEach(() => vi.clearAllMocks());

describe("NotificationPanel — effectiveness feedback wiring", () => {
  it("stamps opened_at for a proactive notification when the panel opens", async () => {
    (notifs.fetchNotifications as any).mockResolvedValue([
      notif({ id: "n1", type: "intervention", title: "A nudge", body: "Review stereochem", read: false, data: { queue_id: "q1" } }),
    ]);
    renderPanel();

    await waitFor(() => expect(notifs.markProactiveOpened).toHaveBeenCalledWith("q1"));
    expect(await screen.findByText("A nudge")).toBeInTheDocument();
  });

  it("stamps action_taken and navigates when the student taps 'Join room'", async () => {
    (notifs.fetchNotifications as any).mockResolvedValue([
      notif({ id: "n2", type: "room_invite", title: "Room invite", body: 'Join "Thermo"', read: true,
              data: { queue_id: "q2", room_id: "r1" } }),
    ]);
    const props = renderPanel();

    fireEvent.click(await screen.findByText("Join room →"));
    expect(notifs.markProactiveActioned).toHaveBeenCalledWith("q2");
    expect(props.onNavigate).toHaveBeenCalledWith("rooms");
  });

  it("stamps action_taken when the student accepts a friend request", async () => {
    (notifs.fetchNotifications as any).mockResolvedValue([
      notif({ id: "n3", type: "friend_request", title: "Friend request", read: true,
              data: { from_user_id: "f1", from_name: "Alex", queue_id: "q3" } }),
    ]);
    renderPanel();

    fireEvent.click(await screen.findByText("Accept"));
    expect(notifs.markProactiveActioned).toHaveBeenCalledWith("q3");
    await waitFor(() => expect(notifs.updateNotificationAction).toHaveBeenCalled());
  });

  it("does not stamp opened_at for plain notifications with no queue_id", async () => {
    (notifs.fetchNotifications as any).mockResolvedValue([
      notif({ id: "n4", type: "friend_request", title: "Friend request", read: false, data: { from_user_id: "f1" } }),
    ]);
    renderPanel();

    await waitFor(() => expect(notifs.markNotificationsRead).toHaveBeenCalled());
    expect(notifs.markProactiveOpened).not.toHaveBeenCalled();
  });

  it("does NOT stamp opened_at for a proactive notif that never scrolls into view", async () => {
    // Simulate an off-screen item: an IntersectionObserver that never reports intersecting.
    const realIO = (globalThis as any).IntersectionObserver;
    (globalThis as any).IntersectionObserver = class {
      observe() {} unobserve() {} disconnect() {} takeRecords() { return []; }
    };
    try {
      (notifs.fetchNotifications as any).mockResolvedValue([
        notif({ id: "n5", type: "intervention", title: "Hidden nudge", read: false, data: { queue_id: "q5" } }),
      ]);
      renderPanel();
      await waitFor(() => expect(notifs.markNotificationsRead).toHaveBeenCalled());  // panel loaded
      expect(notifs.markProactiveOpened).not.toHaveBeenCalled();                     // never seen → not stamped
    } finally {
      (globalThis as any).IntersectionObserver = realIO;
    }
  });
});

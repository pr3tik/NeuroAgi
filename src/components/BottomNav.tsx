// BottomNav.jsx — Tab navigation (the 'tabs' alternative to swipe mode).
// Responsive: a left sidebar on web (≥768px, all pages visible) and a bottom
// tab row on mobile (5 primary + a "More" sheet for the rest). The web breakpoint
// here must match the 768px rule in App.jsx's SHELL_STYLES (and the 232px rail
// width must match the 254px content offset there = 232 + 22 gutter).

import { useState, useEffect } from "react";

const ACCENT   = "rgba(0,210,190,0.95)";
const INACTIVE = "rgba(255,255,255,0.42)";
const RAIL_W   = 232;

// label = full (sidebar), short = compact (bottom bar, falls back to label).
const ITEMS = {
  work:        { label: "Work" },
  canvas:      { label: "Canvas" },
  study:       { label: "Study" },
  leaderboard: { label: "Leaderboard", short: "Ranks" },
  identity:    { label: "Identity",    short: "You" },
  assignment:  { label: "Assignment" },
  toolkit:     { label: "Toolkit" },
  files:       { label: "Files" },
  rooms:       { label: "Rooms" },
  spaces:      { label: "Spaces" },
  studyAssistant: { label: "Study Assistant", short: "Assistant" },
  connections: { label: "Connections", short: "Connect" },
};

const PRIMARY   = ["work", "canvas", "study", "leaderboard", "identity"];
const SECONDARY = ["assignment", "toolkit", "files", "rooms", "spaces", "studyAssistant", "connections"];
const SECONDARY_SET = new Set(SECONDARY);

// Re-render when crossing the web/mobile breakpoint.
function useIsWide(bp = 768) {
  const query = `(min-width:${bp}px)`;
  const [wide, setWide] = useState(() =>
    typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = e => setWide(e.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, [query]);
  return wide;
}

// Minimal 24×24 line icons — stroke inherits `currentColor` from the button.
function Icon({ name }) {
  const common: React.SVGProps<SVGSVGElement> = { width: 22, height: 22, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round" };
  switch (name) {
    case "work":        return <svg {...common}><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V20h14V9.5" /></svg>;
    case "canvas":      return <svg {...common}><path d="M12 3 21 8l-9 5-9-5 9-5Z" /><path d="M3 12l9 5 9-5" /></svg>;
    case "study":       return <svg {...common}><rect x="3" y="6" width="13" height="12" rx="2" /><path d="M8 4h11a2 2 0 0 1 2 2v9" /></svg>;
    case "leaderboard": return <svg {...common}><path d="M6 20V11" /><path d="M12 20V5" /><path d="M18 20v-6" /></svg>;
    case "identity":    return <svg {...common}><circle cx="12" cy="8" r="3.5" /><path d="M5 20a7 7 0 0 1 14 0" /></svg>;
    case "more":        return <svg {...common}><circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none" /></svg>;
    case "assignment":  return <svg {...common}><path d="M7 3h7l4 4v14H7z" /><path d="M14 3v4h4" /><path d="M10 13h5M10 16h3" /></svg>;
    case "toolkit":     return <svg {...common}><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /></svg>;
    case "files":       return <svg {...common}><path d="M4 7h6l2 2h8v9a1 1 0 0 1-1 1H4z" /></svg>;
    case "rooms":       return <svg {...common}><circle cx="9" cy="9" r="2.6" /><path d="M3.5 19a5.5 5.5 0 0 1 11 0" /><path d="M16 7.5a2.6 2.6 0 0 1 0 5" /><path d="M17 14.5a5.5 5.5 0 0 1 3.5 4.5" /></svg>;
    case "spaces":      return <svg {...common}><path d="M12 3l7 4v5c0 4-3 7-7 9-4-2-7-5-7-9V7l7-4z" /></svg>;
    case "studyAssistant": return <svg {...common}><path d="M4 19V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v13" /><path d="M4 19h16" /><path d="M9 4v9l3-2 3 2V4" /></svg>;
    case "connections": return <svg {...common}><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" /><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" /></svg>;
    default:            return null;
  }
}

// Vertical row for the sidebar (icon-only when collapsed).
function SideItem({ pageKey, active, collapsed, onClick }) {
  return (
    <button
      onClick={onClick}
      title={collapsed ? ITEMS[pageKey].label : undefined}
      style={{
        display: "flex", alignItems: "center", gap: collapsed ? 0 : "12px",
        justifyContent: collapsed ? "center" : "flex-start",
        width: "100%", textAlign: "left", cursor: "pointer", fontFamily: "inherit",
        background: active ? "rgba(0,210,190,0.1)" : "transparent",
        border: "1px solid " + (active ? "rgba(0,210,190,0.28)" : "transparent"),
        borderRadius: "12px", padding: collapsed ? "11px 0" : "11px 13px",
        color: active ? ACCENT : INACTIVE,
        transition: "background 0.15s, color 0.15s, border-color 0.15s",
      }}
    >
      <Icon name={pageKey} />
      {!collapsed && (
        <span style={{ fontSize: "14px", fontWeight: active ? 600 : 500 }}>
          {ITEMS[pageKey].label}
        </span>
      )}
    </button>
  );
}

// Compact cell for the bottom bar / More sheet.
function BarItem({ pageKey, iconName, label, active, onClick }: any) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: "3px",
        background: "none", border: "none", cursor: "pointer", fontFamily: "inherit",
        padding: "2px 0", color: active ? ACCENT : INACTIVE, transition: "color 0.15s",
      }}
    >
      <Icon name={iconName ?? pageKey} />
      <span style={{ fontSize: "10px", fontWeight: active ? 600 : 500, letterSpacing: "0.1px" }}>
        {label ?? ITEMS[pageKey].short ?? ITEMS[pageKey].label}
      </span>
    </button>
  );
}

export default function BottomNav({ currentPage, onNavigate, collapsed = false, onToggleCollapse }) {
  const isWide = useIsWide();
  const [moreOpen, setMoreOpen] = useState(false);
  const go = (key) => { setMoreOpen(false); onNavigate(key); };

  // ── Web: collapsible left sidebar with every page ──────────────────────────
  if (isWide) {
    const railW = collapsed ? 64 : RAIL_W;
    return (
      <aside style={{
        position: "fixed", top: 0, left: 0, bottom: 0, zIndex: 90, width: `${railW}px`,
        boxSizing: "border-box", padding: collapsed ? "24px 8px" : "24px 14px",
        display: "flex", flexDirection: "column", gap: "4px",
        background: "rgba(12,13,16,0.86)",
        borderRight: "1px solid var(--color-border)",
        backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)",
        overflowY: "auto", overflowX: "hidden",
        transition: "width 0.2s var(--ease-apple), padding 0.2s var(--ease-apple)",
      }}>
        {/* Brand + collapse toggle */}
        <div style={{
          display: "flex", alignItems: "center",
          justifyContent: collapsed ? "center" : "space-between",
          padding: collapsed ? "0 0 16px" : "4px 9px 16px",
        }}>
          {!collapsed && (
            <span style={{ fontSize: "13px", fontWeight: 700, letterSpacing: "0.4px", color: "var(--text-primary)" }}>
              FschoolAI
            </span>
          )}
          <button
            onClick={onToggleCollapse}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: 30, height: 30, flexShrink: 0, borderRadius: "8px",
              background: "rgba(255,255,255,0.05)", border: "1px solid var(--color-border)",
              cursor: "pointer", outline: "none",
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              style={{ transform: collapsed ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
        </div>
        {PRIMARY.map(key => (
          <SideItem key={key} pageKey={key} active={currentPage === key} collapsed={collapsed} onClick={() => go(key)} />
        ))}
        <div style={{ height: "1px", background: "var(--color-border)", margin: collapsed ? "8px 6px" : "8px 13px" }} />
        {SECONDARY.map(key => (
          <SideItem key={key} pageKey={key} active={currentPage === key} collapsed={collapsed} onClick={() => go(key)} />
        ))}
      </aside>
    );
  }

  // ── Mobile: bottom bar + More sheet ────────────────────────────────────────
  const moreActive = SECONDARY_SET.has(currentPage);
  return (
    <>
      {moreOpen && (
        <div
          onClick={() => setMoreOpen(false)}
          style={{ position: "fixed", inset: 0, zIndex: 89, background: "rgba(0,0,0,0.4)", backdropFilter: "blur(2px)" }}
        />
      )}
      {moreOpen && (
        <div style={{
          position: "fixed", left: 0, right: 0, zIndex: 91,
          bottom: "calc(64px + env(safe-area-inset-bottom, 0px))",
          margin: "0 12px", padding: "10px",
          background: "rgba(18,19,23,0.96)",
          border: "1px solid var(--color-border)",
          borderRadius: "18px",
          boxShadow: "0 20px 50px rgba(0,0,0,0.5)",
          backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)",
          display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "4px",
          animation: "bnSheetUp 0.22s cubic-bezier(0.34,1.4,0.64,1) both",
        }}>
          <style>{`@keyframes bnSheetUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}`}</style>
          {SECONDARY.map(key => (
            <BarItem key={key} pageKey={key} label={ITEMS[key].label} active={currentPage === key} onClick={() => go(key)} />
          ))}
        </div>
      )}

      <nav style={{
        position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 90,
        display: "flex", alignItems: "center",
        padding: "8px 6px",
        paddingBottom: "calc(8px + env(safe-area-inset-bottom, 0px))",
        background: "rgba(12,13,16,0.82)",
        borderTop: "1px solid var(--color-border)",
        backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)",
      }}>
        {PRIMARY.map(key => (
          <BarItem key={key} pageKey={key} active={currentPage === key} onClick={() => go(key)} />
        ))}
        <BarItem
          pageKey="more" iconName="more" label="More"
          active={moreOpen || moreActive}
          onClick={() => setMoreOpen(v => !v)}
        />
      </nav>
    </>
  );
}

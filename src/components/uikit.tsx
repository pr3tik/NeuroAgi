// uikit.tsx — Phase-1 organization kit (UI/UX spec v2, verified against the Uxcel
// reference sweep). Small presentational primitives that make screens scan:
//
//   <SectionLabel>   uppercase eyebrow — card TYPE labels, nav groups, content chunks
//   <SectionHeader>  title + one-line gray desc + right-aligned inline action (the
//                    reference's single most repeated device — screens 284/316/356)
//   <MetaLine>       dot-separated metadata ("Due Jul 27 · 20 pts · MDSB21")
//   <ObjectCard>     compact horizontal object card: icon → TYPE → title → meta
//
// All colors ride the shared design tokens so warm-ink (or any future theme) styles
// these for free. Keep these dumb: layout + type only, no data fetching.
import React from "react";

export function SectionLabel({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <p style={{
      fontFamily: "Inter, sans-serif", fontSize: 11, fontWeight: 600,
      letterSpacing: "0.08em", textTransform: "uppercase",
      color: "var(--text-dim)", margin: 0, ...style,
    }}>{children}</p>
  );
}

export function SectionHeader({ title, desc, action, onAction }: {
  title: string; desc?: string; action?: string; onAction?: () => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
      <div style={{ minWidth: 0 }}>
        <p style={{ fontFamily: "Inter, sans-serif", fontWeight: 600, fontSize: 16.5, letterSpacing: "-0.18px", color: "var(--text-primary)", margin: 0 }}>{title}</p>
        {desc && <p style={{ fontFamily: "Inter, sans-serif", fontSize: 12.5, color: "var(--text-dim)", margin: "3px 0 0" }}>{desc}</p>}
      </div>
      {action && (
        <button onClick={onAction} style={{
          fontFamily: "Inter, sans-serif", fontSize: 13, fontWeight: 500, whiteSpace: "nowrap",
          color: "rgb(var(--teal-rgb))", background: "none", border: "none", cursor: "pointer", padding: 0,
        }}>{action}</button>
      )}
    </div>
  );
}

export function MetaLine({ parts, style }: { parts: (string | number | null | undefined)[]; style?: React.CSSProperties }) {
  const clean = parts.filter(p => p !== null && p !== undefined && p !== "");
  if (!clean.length) return null;
  return (
    <p style={{
      fontFamily: "Inter, sans-serif", fontSize: 12, color: "var(--text-dim)",
      fontVariantNumeric: "tabular-nums", margin: 0, ...style,
    }}>{clean.join(" · ")}</p>
  );
}

export function ObjectCard({ icon, typeLabel, title, meta, onClick, style }: {
  icon?: React.ReactNode; typeLabel?: string; title: string;
  meta?: (string | number | null | undefined)[]; onClick?: () => void; style?: React.CSSProperties;
}) {
  return (
    <button onClick={onClick} style={{
      display: "flex", alignItems: "center", gap: 13, textAlign: "left",
      background: "rgba(255,255,255,0.045)", border: "1px solid rgba(255,255,255,0.08)",
      borderRadius: 14, padding: "13px 15px", cursor: onClick ? "pointer" : "default",
      fontFamily: "inherit", width: "100%", boxSizing: "border-box", transition: "border-color 0.15s, background 0.15s",
      ...style,
    }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.18)"; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.08)"; }}
    >
      {icon && (
        <div style={{
          width: 40, height: 40, borderRadius: 11, flexShrink: 0,
          background: "rgba(var(--teal-rgb),0.12)", border: "1px solid rgba(var(--teal-rgb),0.25)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>{icon}</div>
      )}
      <div style={{ minWidth: 0, flex: 1 }}>
        {typeLabel && <SectionLabel style={{ fontSize: 10, marginBottom: 3 }}>{typeLabel}</SectionLabel>}
        <p style={{
          fontFamily: "Inter, sans-serif", fontWeight: 600, fontSize: 14, color: "var(--text-primary)",
          margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>{title}</p>
        {meta && <MetaLine parts={meta} style={{ marginTop: 3 }} />}
      </div>
    </button>
  );
}

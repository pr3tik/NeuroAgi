// StudyOrb.tsx — the living focus orb at the heart of a study room.
// Pure SVG + CSS (no WebGL, no `three` dependency). It breathes, glows, drifts
// particles, and orbits the room's members around a warm/cool core. During an
// active focus sprint everything intensifies and speeds up.
//
// Props:
//   active      — true while a focus sprint is running (brighter + faster)
//   members     — presence array [{ userId, name, initial }] to orbit
//   size        — px diameter of the orb stage (default 200)

import { useMemo } from "react";

type OrbMember = { userId?: string; name?: string; initial?: string };
type StudyOrbProps = { active?: boolean; members?: OrbMember[]; size?: number; speakingNames?: string[] };

const ORB_CSS = `
@keyframes so-breathe { 0%,100%{transform:scale(1)}    50%{transform:scale(1.055)} }
@keyframes so-glow    { 0%,100%{opacity:.45}           50%{opacity:.85} }
@keyframes so-spin    { to { transform:rotate(360deg) } }
@keyframes so-spinrev { to { transform:rotate(-360deg) } }
@keyframes so-twinkle { 0%,100%{opacity:.25}           50%{opacity:.95} }
@keyframes so-speak   { 0%,100%{box-shadow:0 0 0 0 rgba(74,222,128,0.7),0 0 10px rgba(196,154,60,0.28)} 60%{box-shadow:0 0 0 7px rgba(74,222,128,0),0 0 10px rgba(196,154,60,0.28)} }
.so-g    { transform-box:view-box; transform-origin:100px 100px; }
.so-core { transform-box:view-box; transform-origin:100px 100px; animation:so-breathe 4.6s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce){
  .so-g, .so-core, .so-orbit, .so-orbit > span { animation:none !important; }
}
`;

export default function StudyOrb({ active = false, members = [], size = 200, speakingNames = [] }: StudyOrbProps) {
  const orbiters = members.slice(0, 8);
  const speakingSet = new Set(speakingNames);
  const pulse    = active ? 1 : 0.68;

  // Pre-computed particle ring (stable across renders so they don't jump).
  const particles = useMemo(
    () => Array.from({ length: 7 }, (_, i) => ({
      a: (i / 7) * Math.PI * 2,
      r: 60 + (i % 3) * 9,
      s: 1.3 + (i % 4) * 0.5,
      d: i * 0.45,
    })),
    []
  );

  const memberSpin = active ? 42 : 66;

  return (
    <div style={{ width: "100%", display: "flex", justifyContent: "center", margin: "2px 0 22px" }}>
      <style>{ORB_CSS}</style>
      <div style={{ position: "relative", width: size, height: size }}>
        {/* Soft warm/cool glow behind everything */}
        <div style={{
          position: "absolute", inset: "-14%", borderRadius: "50%",
          background: `radial-gradient(circle at 50% 44%, rgba(196,154,60,${0.32 * pulse}) 0%, rgba(118,148,210,${0.14 * pulse}) 40%, transparent 70%)`,
          filter: "blur(6px)", animation: "so-glow 5s ease-in-out infinite",
        }} />

        <svg viewBox="0 0 200 200" width={size} height={size} style={{ position: "relative", display: "block" }}>
          <defs>
            <radialGradient id="so-core-grad" cx="50%" cy="42%" r="62%">
              <stop offset="0%"   stopColor="#FBEBC8" stopOpacity="0.95" />
              <stop offset="34%"  stopColor="#C49A3C" stopOpacity="0.85" />
              <stop offset="74%"  stopColor="#6E5FA8" stopOpacity="0.32" />
              <stop offset="100%" stopColor="#3A4A78" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="so-rim" cx="50%" cy="50%" r="50%">
              <stop offset="76%"  stopColor="transparent" />
              <stop offset="92%"  stopColor="rgba(196,154,60,0.45)" />
              <stop offset="100%" stopColor="transparent" />
            </radialGradient>
          </defs>

          {/* Rotating dashed orbits */}
          <g className="so-g" style={{ animation: `so-spin ${active ? 30 : 48}s linear infinite` }}>
            <circle cx="100" cy="100" r="80" fill="none" stroke="rgba(118,148,210,0.22)" strokeWidth="1" strokeDasharray="2 8" />
          </g>
          <g className="so-g" style={{ animation: `so-spinrev ${active ? 36 : 62}s linear infinite` }}>
            <circle cx="100" cy="100" r="66" fill="none" stroke="rgba(196,154,60,0.26)" strokeWidth="1" strokeDasharray="1 9" />
          </g>

          {/* Breathing core */}
          <g className="so-core">
            <circle cx="100" cy="100" r="94" fill="url(#so-rim)" />
            <circle cx="100" cy="100" r="55" fill="url(#so-core-grad)" />
            <circle cx="100" cy="100" r="55" fill="none" stroke="rgba(251,235,200,0.35)" strokeWidth="0.75" />
          </g>

          {/* Drifting particles */}
          <g className="so-g" style={{ animation: `so-spin ${active ? 18 : 30}s linear infinite` }}>
            {particles.map((p, i) => (
              <circle
                key={i}
                cx={100 + Math.cos(p.a) * p.r}
                cy={100 + Math.sin(p.a) * p.r}
                r={p.s}
                fill={i % 2 ? "rgba(196,154,60,0.9)" : "rgba(150,180,230,0.85)"}
                style={{ animation: `so-twinkle ${2 + p.d}s ease-in-out ${p.d}s infinite` }}
              />
            ))}
          </g>
        </svg>

        {/* Members orbiting the core */}
        {orbiters.length > 0 && (
          <div
            className="so-orbit"
            style={{
              position: "absolute", inset: 0,
              transformBox: "border-box", transformOrigin: "center",
              animation: `so-spin ${memberSpin}s linear infinite`,
              pointerEvents: "none",
            }}
          >
            {orbiters.map((m, i) => {
              const ang = (i / orbiters.length) * Math.PI * 2 - Math.PI / 2;
              const R = size * 0.43;
              const x = size / 2 + Math.cos(ang) * R;
              const y = size / 2 + Math.sin(ang) * R;
              const isSpeaking = speakingSet.has(m.name || "");
              return (
                <div
                  key={m.userId || i}
                  title={m.name || ""}
                  style={{
                    position: "absolute", left: x, top: y, width: 26, height: 26,
                    marginLeft: -13, marginTop: -13, borderRadius: "50%",
                    background: "rgba(18,18,24,0.92)",
                    border: isSpeaking ? "1.5px solid rgba(74,222,128,0.85)" : "1px solid rgba(196,154,60,0.5)",
                    color: isSpeaking ? "#4ade80" : "var(--color-accent)", fontSize: "11px", fontWeight: 700,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    animation: isSpeaking ? "so-speak 0.9s ease-out infinite" : undefined,
                  }}
                >
                  {/* counter-rotate so the initial stays upright */}
                  <span style={{ display: "block", animation: `so-spinrev ${memberSpin}s linear infinite`, transformOrigin: "center" }}>
                    {(m.name?.[0] || m.initial || "?").toUpperCase()}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

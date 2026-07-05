// Non-blocking nudge for logged-in users who never set a school during
// onboarding (e.g. they hit "Skip for now"). Renders nothing once a school
// is set or the user dismisses it. Reuses the same local search as Onboarding.
import { useState, useRef, useEffect } from "react";
import { X } from "lucide-react";
import { useApp } from "../context/AppContext";
import { searchSchools } from "../lib/schoolSearch";

const dismissKey = (uid: string) => `fschool_school_prompt_dismissed_${uid}`;

export default function SchoolPrompt() {
  const { userData, userId, updateUserField } = useApp();
  const [dismissed, setDismissed] = useState(() => {
    try { return userId ? localStorage.getItem(dismissKey(userId)) === "1" : true; } catch { return true; }
  });
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const searchTimer = useRef<any>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  if (dismissed || !userData || userData.school) return null;

  function handleQuery(q: string) {
    setQuery(q);
    setOpen(true);
    clearTimeout(searchTimer.current);
    if (!q.trim()) { setResults([]); return; }
    searchTimer.current = setTimeout(async () => {
      setResults(await searchSchools(q));
    }, 250);
  }

  function selectSchool(school: any) {
    updateUserField({
      school:          school.name,
      school_city:     school.city || "",
      school_country:  school.country || "",
    });
    setOpen(false);
    setQuery("");
  }

  function dismiss() {
    setDismissed(true);
    try { if (userId) localStorage.setItem(dismissKey(userId), "1"); } catch {}
  }

  return (
    <div
      ref={boxRef}
      style={{
        position: "relative",
        display: "flex", alignItems: "center", gap: "12px",
        padding: "12px 16px",
        borderRadius: "12px",
        background: "rgba(255,255,255,0.05)",
        border: "1px solid rgba(255,255,255,0.08)",
        marginBottom: "20px",
      }}
    >
      <span style={{ fontSize: "13px", color: "rgba(255,255,255,0.55)", flexShrink: 0 }}>
        Add your school for a more personalized experience
      </span>
      <input
        value={query}
        onChange={e => handleQuery(e.target.value)}
        onFocus={() => query && setOpen(true)}
        placeholder="Search your university…"
        style={{
          flex: 1, minWidth: 0,
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: "8px",
          padding: "7px 10px",
          fontSize: "13px",
          color: "#E3E2E2",
          outline: "none",
        }}
      />
      <button
        onClick={dismiss}
        aria-label="Dismiss"
        style={{
          background: "none", border: "none", cursor: "pointer",
          color: "rgba(255,255,255,0.3)", padding: "4px", flexShrink: 0,
          display: "flex", alignItems: "center",
        }}
      >
        <X size={16} />
      </button>

      {open && results.length > 0 && (
        <div style={{
          position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0,
          background: "rgba(16,16,18,0.98)",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: "12px",
          overflow: "hidden",
          boxShadow: "0 20px 50px rgba(0,0,0,0.65)",
          zIndex: 50,
        }}>
          {results.map((s, i) => (
            <button
              key={i}
              onClick={() => selectSchool(s)}
              style={{
                display: "block", width: "100%", textAlign: "left",
                padding: "11px 16px",
                background: "none", border: "none",
                borderBottom: i < results.length - 1 ? "1px solid rgba(255,255,255,0.05)" : "none",
                cursor: "pointer", fontFamily: "inherit",
              }}
            >
              <div style={{ color: "#F5F5F5", fontSize: "13px", fontWeight: 500, marginBottom: "2px" }}>
                {s.name}
              </div>
              <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.28)" }}>
                {[s.city, s.country].filter(Boolean).join(" · ")}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

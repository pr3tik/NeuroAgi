import { useState, useEffect, useRef } from "react";
import { Check } from "lucide-react";
import { searchSchools } from "../lib/schoolSearch";

/* ─── Canvas fetch ─────────────────────────────────────────────────────────── */

async function fetchCanvasCourses(baseUrl, token) {
  const clean = baseUrl.replace(/\/+$/, "");
  let courses = [];
  let path = "/api/v1/courses?enrollment_state=active&include[]=total_scores";
  let usedFallback = false;
  let pages = 0;

  while (path && pages < 20 && courses.length < 12) {
    const url = `/api/canvas?base=${encodeURIComponent(clean)}&path=${encodeURIComponent(path)}&token=${encodeURIComponent(token)}`;
    let res;
    try { res = await fetch(url); } catch { break; }
    if (!res.ok) {
      if (!usedFallback) {
        path = "/api/v1/courses?include[]=total_scores";
        usedFallback = true;
        continue;
      }
      break;
    }
    const data = await res.json().catch(() => []);
    if (Array.isArray(data)) courses = [...courses, ...data];
    const link = res.headers.get("Link");
    const m = link?.match(/<([^>]+)>;\s*rel="next"/);
    if (m) {
      try {
        const next = new URL(m[1]);
        path = next.pathname + next.search;
      } catch { path = null; }
    } else {
      path = null;
    }
    pages++;
  }
  return courses.slice(0, 12);
}

/* ─── Goals ────────────────────────────────────────────────────────────────── */

const GOALS = [
  { id: "next_steps",         label: "Know what to do next" },
  { id: "deadlines",          label: "Keep up with every deadline" },
  { id: "assignment_support", label: "Get assignment support" },
  { id: "study_effectively",  label: "Study more effectively" },
  { id: "improve_results",    label: "Improve my results" },
  { id: "graduate_track",     label: "Stay on track to graduate" },
];

/* ─── Status helpers ───────────────────────────────────────────────────────── */

function statusColor(s) {
  if (s === "supported") return "rgba(52,199,89,0.9)";
  if (s === "needsApplication") return "rgba(255,196,0,0.9)";
  return "rgba(255,255,255,0.28)";
}

function statusBg(s) {
  if (s === "supported") return "rgba(52,199,89,0.1)";
  if (s === "needsApplication") return "rgba(255,196,0,0.1)";
  return "rgba(255,255,255,0.06)";
}

function statusLabel(s) {
  if (s === "supported")         return "Supported";
  if (s === "needsApplication")  return "Apply first";
  if (s === "comingSoon")        return "Coming soon";
  if (s === "needsVerification") return "Unverified";
  return "";
}

function safeHostname(url) {
  try { return new URL(url).hostname; } catch { return url; }
}

/* ─── Default draft ────────────────────────────────────────────────────────── */

function defaultDraft(email, initName) {
  return {
    email: email || "",
    preferredName: initName || "",
    schoolName: "",
    schoolSearchQuery: "",
    schoolStatus: "",
    schoolLoginUrl: "",
    schoolTokenFlow: "",
    schoolCity: "",
    schoolCountry: "",
    schoolContinent: "",
    manualCanvasUrl: "",
    token: "",
    isCustomSchool: false,
    goals: [],
    navMode: "swipe",
    onboardingComplete: false,
  };
}

/* ─── Shared input style ───────────────────────────────────────────────────── */

const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  background: "rgba(255,255,255,0.05)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: "14px",
  padding: "16px 18px",
  color: "#F5F5F5",
  fontSize: "15px",
  outline: "none",
  fontFamily: "inherit",
};

/* ─── Main component ───────────────────────────────────────────────────────── */

export default function Onboarding({ email, preferredName: initName, onComplete }) {
  const [step, setStep] = useState<number | string>(0); // 0 | 1 | 2 | 3 | "gen" | "discord"
  const [completionPayload, setCompletionPayload] = useState(null);
  const [draft, setDraft] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("sa_onboarding_draft") || "{}");
      if (saved.email === email) return { ...defaultDraft(email, initName), ...saved };
    } catch {}
    return defaultDraft(email, initName);
  });

  const [schoolResults, setSchoolResults] = useState([]);
  const [showDropdown, setShowDropdown]   = useState(false);
  const [toast, setToast]                 = useState("");
  const [genLines, setGenLines]           = useState([]);

  const toastTimer   = useRef(null);
  const searchTimer  = useRef(null);
  const dropdownRef  = useRef(null);

  // Persist draft
  useEffect(() => {
    try { localStorage.setItem("sa_onboarding_draft", JSON.stringify(draft)); } catch {}
  }, [draft]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  /* ── Toast ──────────────────────────────────────────────────────────────── */
  function showToast(msg) {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 3000);
  }

  const [schoolLoading, setSchoolLoading] = useState(false);

  /* ── School search ──────────────────────────────────────────────────────── */
  function handleSchoolQuery(q) {
    setDraft(d => ({
      ...d,
      schoolSearchQuery: q,
      schoolName: "",
      schoolStatus: "",
      schoolLoginUrl: "",
      schoolTokenFlow: "",
      schoolCity: "",
      schoolCountry: "",
      schoolContinent: "",
      isCustomSchool: false,
    }));
    setShowDropdown(true);
    clearTimeout(searchTimer.current);
    if (!q.trim()) { setSchoolResults([]); return; }
    setSchoolLoading(true);
    searchTimer.current = setTimeout(async () => {
      const results = await searchSchools(q);
      setSchoolResults(results);
      setSchoolLoading(false);
    }, 250);
  }

  function selectSchool(school) {
    setDraft(d => ({
      ...d,
      schoolName:        school.name,
      schoolSearchQuery: school.name,
      schoolStatus:      school.status || "needsVerification",
      schoolLoginUrl:    school.loginUrl || "",
      schoolTokenFlow:   school.tokenFlow || "",
      schoolCity:        school.city || "",
      schoolCountry:     school.country || "",
      schoolContinent:   school.continent || "",
      isCustomSchool:    !!school.isCustom,
      // Auto-fill Canvas URL from the school's known loginUrl so the user
      // doesn't have to type it manually — covers supported + needsApplication schools
      manualCanvasUrl:   school.loginUrl || d.manualCanvasUrl || "",
    }));
    setShowDropdown(false);
  }

  /* ── Conditional field logic ────────────────────────────────────────────── */
  const needsManualUrl = () =>
    draft.isCustomSchool || ["needsVerification", "comingSoon"].includes(draft.schoolStatus);

  const needsToken = () =>
    ["selfServe", "needsApplication"].includes(draft.schoolTokenFlow);

  /* ── Navigation ─────────────────────────────────────────────────────────── */
  function handleNext() {
    if (step === 0) {
      if (!draft.preferredName.trim()) { showToast("Tell me your name first"); return; }
      setStep(1);
      return;
    }
    if (step === 1) {
      if (!draft.schoolName && !draft.manualCanvasUrl.trim()) {
        showToast("Select a school result or add a manual Canvas URL first");
        return;
      }
      if (needsManualUrl() && !draft.manualCanvasUrl.trim()) {
        showToast("Add your Canvas URL to continue");
        return;
      }
      if (needsToken() && !draft.token.trim()) {
        showToast("Add your Canvas token to continue");
        return;
      }
      setStep(2);
      return;
    }
    if (step === 2) {
      setStep(3);
      return;
    }
    if (step === 3) {
      setStep("gen");
      runGeneration();
    }
  }

  function handleBack() {
    if (step === 1) setStep(0);
    else if (step === 2) setStep(1);
    else if (step === 3) setStep(2);
  }

  function skipToStep2() {
    setStep(2);
  }

  /* ── Generation ─────────────────────────────────────────────────────────── */
  async function runGeneration() {
    const base  = draft.manualCanvasUrl || draft.schoolLoginUrl;
    const token = draft.token;

    let courses = [];
    if (base && token) {
      try { courses = await fetchCanvasCourses(base, token); } catch {}
    }

    const schoolDisplay = draft.schoolName || draft.manualCanvasUrl || "";
    const seq = [
      "Connecting to Canvas...",
      ...(schoolDisplay ? [schoolDisplay] : []),
      ...(courses.length > 0
        ? [
            `${courses.length} course${courses.length !== 1 ? "s" : ""} synced`,
            ...courses.slice(0, 8).map(c => `  · ${c.name || c.course_code || "Course"}`),
          ]
        : []),
      `Welcome, ${draft.preferredName}!`,
    ];

    for (let i = 0; i < seq.length; i++) {
      await new Promise(r => setTimeout(r, i === 0 ? 300 : 420));
      setGenLines(prev => [...prev, seq[i]]);
    }

    await new Promise(r => setTimeout(r, 700));

    // Persist completion
    try {
      localStorage.setItem("sa_onboarding_draft", JSON.stringify({ ...draft, onboardingComplete: true }));
      if (draft.schoolName) localStorage.setItem("sa_school_name", draft.schoolName);
      if (draft.schoolCity)      localStorage.setItem("sa_school_city",      draft.schoolCity);
      if (draft.schoolCountry)   localStorage.setItem("sa_school_country",   draft.schoolCountry);
      if (draft.schoolContinent) localStorage.setItem("sa_school_continent", draft.schoolContinent);
      if (base && token) {
        localStorage.setItem("sa_token", token);
        localStorage.setItem("sa_base", base);
      }
    } catch {}

    const payload = {
      preferredName: draft.preferredName,
      schoolName:    draft.schoolName,
      schoolCity:    draft.schoolCity,
      schoolCountry: draft.schoolCountry,
      schoolContinent: draft.schoolContinent,
      token,
      baseUrl:       base,
      goals:         draft.goals,
      navMode:       draft.navMode,
    };
    setCompletionPayload(payload);
    setStep("discord");
  }

  // Finish onboarding without Discord
  function finishOnboarding() {
    if (completionPayload) onComplete(completionPayload);
  }

  // Save onboarding data, then send the user to Discord OAuth. We await the
  // save so the account is fully persisted (and logged in) before the full-page
  // redirect; on return the app lands logged-in with ?discord=connected.
  async function connectDiscord() {
    const uid = localStorage.getItem("fschool_uid") || "";
    try { if (completionPayload) await onComplete(completionPayload); } catch {}
    window.location.href = `/api/discord?action=login&uid=${encodeURIComponent(uid)}`;
  }

  /* ── Progress ───────────────────────────────────────────────────────────── */
  const progress = (step === "gen" || step === "discord") ? 100 : ((Number(step) + 1) / 4) * 100;

  /* ── Discord reward step ─────────────────────────────────────────────────── */
  if (step === "discord") {
    return (
      <div style={{
        minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center",
        padding: "24px", background: "var(--color-bg, #0b0b0d)",
        fontFamily: "var(--font-sans, -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif)",
      }}>
        <style>{`@keyframes obUp{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:none}} .ob-disc-primary:active{transform:scale(.985)}`}</style>
        <div style={{ width: "100%", maxWidth: "380px", textAlign: "center", animation: "obUp .5s cubic-bezier(.34,1.56,.64,1) both" }}>
          <div style={{
            width: "60px", height: "60px", margin: "0 auto 22px", borderRadius: "18px",
            background: "rgba(88,101,242,0.12)", border: "1px solid rgba(88,101,242,0.28)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <svg width="30" height="30" viewBox="0 0 24 24" fill="#5865F2">
              <path d="M20.3 4.4A19.8 19.8 0 0 0 15.4 3l-.25.5a18.3 18.3 0 0 1 4.3 1.4 16.7 16.7 0 0 0-13-.05A18 18 0 0 1 10.78 3.5L10.5 3A19.7 19.7 0 0 0 5.6 4.4 20.6 20.6 0 0 0 2 18.3a19.9 19.9 0 0 0 6 3 14.6 14.6 0 0 0 1.27-2.07 12.9 12.9 0 0 1-2-.96l.5-.36a14.2 14.2 0 0 0 12.2 0l.5.36c-.63.38-1.3.7-2 .96A14.5 14.5 0 0 0 16 21.3a19.8 19.8 0 0 0 6-3 20.5 20.5 0 0 0-1.7-13.9ZM8.7 15.3c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2Zm6.6 0c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2Z"/>
            </svg>
          </div>

          <h1 style={{ fontSize: "24px", fontWeight: "700", color: "var(--text-primary, #f5f5f5)", letterSpacing: "-0.4px", marginBottom: "10px" }}>
            You're in{draft.preferredName ? `, ${draft.preferredName}` : ""}.
          </h1>
          <p style={{ fontSize: "14px", color: "var(--text-dim, rgba(255,255,255,0.45))", lineHeight: 1.65, marginBottom: "28px" }}>
            Join the beta community on Discord — get your free-month perks, drop feedback with <strong style={{ color: "#a6b0ff", fontWeight: 600 }}>/feedback</strong> to earn points, and help shape what we build next.
          </p>

          <button
            className="ob-disc-primary"
            onClick={connectDiscord}
            style={{
              width: "100%", padding: "15px", marginBottom: "12px",
              background: "#5865F2", color: "#fff", border: "none",
              borderRadius: "13px", fontSize: "15px", fontWeight: "650",
              cursor: "pointer", fontFamily: "inherit", transition: "transform .1s ease",
              display: "flex", alignItems: "center", justifyContent: "center", gap: "9px",
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="#fff">
              <path d="M20.3 4.4A19.8 19.8 0 0 0 15.4 3l-.25.5a18.3 18.3 0 0 1 4.3 1.4 16.7 16.7 0 0 0-13-.05A18 18 0 0 1 10.78 3.5L10.5 3A19.7 19.7 0 0 0 5.6 4.4 20.6 20.6 0 0 0 2 18.3a19.9 19.9 0 0 0 6 3 14.6 14.6 0 0 0 1.27-2.07 12.9 12.9 0 0 1-2-.96l.5-.36a14.2 14.2 0 0 0 12.2 0l.5.36c-.63.38-1.3.7-2 .96A14.5 14.5 0 0 0 16 21.3a19.8 19.8 0 0 0 6-3 20.5 20.5 0 0 0-1.7-13.9ZM8.7 15.3c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2Zm6.6 0c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2Z"/>
            </svg>
            Join the community
          </button>

          <button
            onClick={finishOnboarding}
            style={{
              width: "100%", padding: "12px", background: "transparent", border: "none",
              color: "var(--text-dim, rgba(255,255,255,0.4))", fontSize: "14px", fontWeight: "500",
              cursor: "pointer", fontFamily: "inherit",
            }}
          >
            Maybe later
          </button>
        </div>
      </div>
    );
  }

  /* ── Render ─────────────────────────────────────────────────────────────── */
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 500,
      background: "#111",
      display: "flex", flexDirection: "column",
      fontFamily: "var(--font-sans, -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif)",
      overflowY: step === "gen" ? "hidden" : "auto",
    }}>
      <style>{`
        @keyframes obFadeIn  { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
        @keyframes obBlink   { 0%,100%{ opacity:0.25; } 50%{ opacity:0.65; } }
        @keyframes obToastUp { from { opacity:0; transform:translateX(-50%) translateY(6px); } to { opacity:1; transform:translateX(-50%) translateY(0); } }
        .ob-back:hover  { color: rgba(255,255,255,0.6) !important; }
        .ob-skip:hover  { color: rgba(255,255,255,0.35) !important; }
        .ob-pill:hover  { transform: translateY(-1px); }
        .ob-cont:hover  { background: #fff !important; transform: translateY(-1px); }
        .ob-cont:active { transform: translateY(0); }
        .ob-result:hover{ background: rgba(255,255,255,0.05) !important; }
      `}</style>

      {/* Progress bar */}
      {step !== "gen" && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, height: "2px", background: "rgba(255,255,255,0.06)", zIndex: 20 }}>
          <div style={{
            height: "100%",
            background: "rgba(255,255,255,0.5)",
            width: `${progress}%`,
            transition: "width 0.4s cubic-bezier(0.25,0.46,0.45,0.94)",
          }} />
        </div>
      )}

      {/* Content area */}
      <div style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        padding: "72px 28px 36px",
        maxWidth: "540px",
        margin: "0 auto",
        width: "100%",
        boxSizing: "border-box",
      }}>

        {/* ── Generation screen ─────────────────────────────────────────── */}
        {step === "gen" && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {genLines.map((line, i) => (
                <div key={i} style={{
                  color: line.startsWith("Welcome")
                    ? "#F5F5F5"
                    : line.startsWith("  ·")
                      ? "rgba(255,255,255,0.3)"
                      : "rgba(255,255,255,0.55)",
                  fontSize: line.startsWith("Welcome") ? "26px" : line.startsWith("  ·") ? "13px" : "15px",
                  fontWeight: line.startsWith("Welcome") ? "700" : "400",
                  fontFamily: line.startsWith("Welcome")
                    ? "var(--font-sans, sans-serif)"
                    : "'SF Mono', 'Fira Mono', monospace",
                  letterSpacing: line.startsWith("Welcome") ? "-0.6px" : "0",
                  lineHeight: "1.5",
                  animation: "obFadeIn 0.3s ease",
                }}>
                  {line}
                </div>
              ))}
              <span style={{
                width: "8px", height: "16px",
                background: "rgba(255,255,255,0.35)",
                display: "inline-block",
                marginTop: "4px",
                animation: "obBlink 1s ease-in-out infinite",
              }} />
            </div>
          </div>
        )}

        {/* ── Step screens ──────────────────────────────────────────────── */}
        {step !== "gen" && (
          <>
            {/* Back button */}
            {(step === 1 || step === 2 || step === 3) && (
              <button
                className="ob-back"
                onClick={handleBack}
                style={{
                  background: "none", border: "none",
                  color: "rgba(255,255,255,0.28)",
                  fontSize: "14px", cursor: "pointer",
                  fontFamily: "inherit", padding: "0",
                  marginBottom: "28px", alignSelf: "flex-start",
                  transition: "color 0.15s",
                }}
              >
                ← Back
              </button>
            )}

            {/* ── Step 0: Name ─────────────────────────────────────────── */}
            {step === 0 && (
              <div style={{ animation: "obFadeIn 0.3s ease", flex: 1 }}>
                <p style={{ fontSize: "11px", color: "rgba(255,255,255,0.22)", letterSpacing: "3px", textTransform: "uppercase", marginBottom: "18px" }}>
                  1 of 4
                </p>
                <h1 style={{ color: "#F5F5F5", fontSize: "34px", fontWeight: "700", letterSpacing: "-1px", lineHeight: "1.1", marginBottom: "10px" }}>
                  What should I call you?
                </h1>
                <p style={{ color: "rgba(255,255,255,0.32)", fontSize: "15px", marginBottom: "36px", lineHeight: "1.65" }}>
                  Your agent will use this every day.
                </p>
                <input
                  id="preferredNameInput"
                  autoFocus
                  placeholder="Preferred name"
                  value={draft.preferredName}
                  onChange={e => setDraft(d => ({ ...d, preferredName: e.target.value }))}
                  onKeyDown={e => e.key === "Enter" && handleNext()}
                  style={inputStyle}
                />
              </div>
            )}

            {/* ── Step 1: University ───────────────────────────────────── */}
            {step === 1 && (
              <div style={{ animation: "obFadeIn 0.3s ease", flex: 1 }}>
                <p style={{ fontSize: "11px", color: "rgba(255,255,255,0.22)", letterSpacing: "3px", textTransform: "uppercase", marginBottom: "18px" }}>
                  2 of 4
                </p>
                <h1 style={{ color: "#F5F5F5", fontSize: "34px", fontWeight: "700", letterSpacing: "-1px", lineHeight: "1.1", marginBottom: "10px" }}>
                  Where do you study?
                </h1>
                <p style={{ color: "rgba(255,255,255,0.32)", fontSize: "15px", marginBottom: "28px", lineHeight: "1.65" }}>
                  Search your university to link Canvas courses and deadlines.
                </p>

                {/* School search */}
                <div ref={dropdownRef} style={{ position: "relative", marginBottom: "12px" }}>
                  <input
                    autoFocus
                    placeholder="Search your university..."
                    value={draft.schoolSearchQuery}
                    onChange={e => handleSchoolQuery(e.target.value)}
                    onFocus={() => draft.schoolSearchQuery && setShowDropdown(true)}
                    style={{
                      ...inputStyle,
                      border: `1px solid ${draft.schoolName ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.1)"}`,
                    }}
                  />
                  {showDropdown && schoolLoading && (
                    <div style={{
                      position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0,
                      background: "rgba(16,16,18,0.98)",
                      border: "1px solid rgba(255,255,255,0.1)",
                      borderRadius: "14px",
                      padding: "14px 18px",
                      color: "rgba(255,255,255,0.3)",
                      fontSize: "13px",
                      zIndex: 200,
                    }}>
                      Searching...
                    </div>
                  )}
                  {showDropdown && !schoolLoading && schoolResults.length > 0 && (
                    <div style={{
                      position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0,
                      background: "rgba(16,16,18,0.98)",
                      border: "1px solid rgba(255,255,255,0.1)",
                      borderRadius: "14px",
                      overflow: "hidden",
                      boxShadow: "0 20px 50px rgba(0,0,0,0.65)",
                      zIndex: 200,
                    }}>
                      {schoolResults.map((s, i) => (
                        <button
                          key={i}
                          className="ob-result"
                          onClick={() => selectSchool(s)}
                          style={{
                            display: "block", width: "100%", textAlign: "left",
                            padding: "13px 18px",
                            background: "none", border: "none",
                            borderBottom: i < schoolResults.length - 1 ? "1px solid rgba(255,255,255,0.05)" : "none",
                            cursor: "pointer", fontFamily: "inherit",
                            transition: "background 0.1s",
                          }}
                        >
                          <div style={{ color: "#F5F5F5", fontSize: "14px", fontWeight: "500", marginBottom: "3px" }}>
                            {s.name}
                          </div>
                          <div style={{ fontSize: "11px", color: statusColor(s.status) }}>
                            {[statusLabel(s.status), s.city, s.country].filter(Boolean).join(" · ")}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                  {showDropdown && !schoolLoading && schoolResults.length === 0 && draft.schoolSearchQuery.trim().length >= 2 && (
                    <div style={{
                      position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0,
                      background: "rgba(16,16,18,0.98)",
                      border: "1px solid rgba(255,255,255,0.1)",
                      borderRadius: "14px",
                      overflow: "hidden",
                      boxShadow: "0 20px 50px rgba(0,0,0,0.65)",
                      zIndex: 200,
                    }}>
                      <button
                        className="ob-result"
                        onClick={() => selectSchool({ name: draft.schoolSearchQuery.trim(), isCustom: true, status: "needsVerification" })}
                        style={{
                          display: "block", width: "100%", textAlign: "left",
                          padding: "13px 18px",
                          background: "none", border: "none",
                          cursor: "pointer", fontFamily: "inherit",
                          transition: "background 0.1s",
                        }}
                      >
                        <div style={{ color: "#F5F5F5", fontSize: "14px", fontWeight: "500", marginBottom: "3px" }}>
                          Use "{draft.schoolSearchQuery.trim()}"
                        </div>
                        <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.28)" }}>
                          Not listed — add it and enter your Canvas URL
                        </div>
                      </button>
                    </div>
                  )}
                </div>

                {/* Selected school badge */}
                {draft.schoolName && !showDropdown && (
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "16px", paddingLeft: "2px" }}>
                    <span style={{
                      fontSize: "11px", padding: "3px 10px", borderRadius: "20px",
                      background: statusBg(draft.schoolStatus),
                      color: statusColor(draft.schoolStatus),
                    }}>
                      {statusLabel(draft.schoolStatus)}
                    </span>
                    {draft.schoolLoginUrl && (
                      <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.2)" }}>
                        {safeHostname(draft.schoolLoginUrl)}
                      </span>
                    )}
                  </div>
                )}

                {/* Manual Canvas URL — shown for custom/unverified schools OR as read-only hint for auto-filled ones */}
                {needsManualUrl() && (
                  <input
                    placeholder="Canvas URL — e.g. canvas.youruni.edu"
                    value={draft.manualCanvasUrl}
                    onChange={e => setDraft(d => ({ ...d, manualCanvasUrl: e.target.value }))}
                    style={{ ...inputStyle, marginBottom: "12px" }}
                  />
                )}
                {!needsManualUrl() && draft.manualCanvasUrl && (
                  <div style={{
                    ...inputStyle,
                    marginBottom: "12px",
                    color: "rgba(255,255,255,0.35)",
                    fontSize: "13px",
                    cursor: "default",
                    userSelect: "none",
                  }}>
                    {draft.manualCanvasUrl}
                  </div>
                )}

                {/* Canvas token */}
                {(needsToken() || needsManualUrl()) && (
                  <div>
                    <input
                      placeholder="Canvas access token"
                      type="password"
                      value={draft.token}
                      onChange={e => setDraft(d => ({ ...d, token: e.target.value }))}
                      style={inputStyle}
                    />
                    <p style={{ fontSize: "11px", color: "rgba(255,255,255,0.18)", marginTop: "8px", paddingLeft: "2px" }}>
                      {draft.schoolLoginUrl
                        ? `${safeHostname(draft.schoolLoginUrl)}/profile/settings → New Access Token`
                        : "Canvas → Account → Settings → New Access Token"}
                    </p>
                  </div>
                )}

                <button
                  className="ob-skip"
                  onClick={skipToStep2}
                  style={{
                    background: "none", border: "none",
                    color: "rgba(255,255,255,0.18)",
                    fontSize: "13px", cursor: "pointer",
                    fontFamily: "inherit", marginTop: "22px",
                    display: "block", padding: "0",
                    transition: "color 0.15s",
                  }}
                >
                  Skip for now →
                </button>
              </div>
            )}

            {/* ── Step 2: Goals ────────────────────────────────────────── */}
            {step === 2 && (
              <div style={{ animation: "obFadeIn 0.3s ease", flex: 1 }}>
                <p style={{ fontSize: "11px", color: "rgba(255,255,255,0.22)", letterSpacing: "3px", textTransform: "uppercase", marginBottom: "18px" }}>
                  3 of 4
                </p>
                <h1 style={{ color: "#F5F5F5", fontSize: "34px", fontWeight: "700", letterSpacing: "-1px", lineHeight: "1.1", marginBottom: "10px" }}>
                  What brings you here?
                </h1>
                <p style={{ color: "rgba(255,255,255,0.32)", fontSize: "15px", marginBottom: "28px", lineHeight: "1.65" }}>
                  Select everything that applies.
                </p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
                  {GOALS.map(g => {
                    const on = draft.goals.includes(g.id);
                    return (
                      <button
                        key={g.id}
                        className="ob-pill"
                        onClick={() => setDraft(d => ({
                          ...d,
                          goals: on
                            ? d.goals.filter(x => x !== g.id)
                            : [...d.goals, g.id],
                        }))}
                        style={{
                          background: on ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.04)",
                          border: `1px solid ${on ? "rgba(255,255,255,0.22)" : "rgba(255,255,255,0.08)"}`,
                          borderRadius: "100px",
                          padding: "9px 16px",
                          color: on ? "#F5F5F5" : "rgba(255,255,255,0.42)",
                          fontSize: "14px",
                          cursor: "pointer",
                          fontFamily: "inherit",
                          transition: "all 0.15s",
                        }}
                      >
                        {g.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── Step 3: Navigation mode ──────────────────────────────── */}
            {step === 3 && (
              <div style={{ animation: "obFadeIn 0.3s ease", flex: 1 }}>
                <p style={{ fontSize: "11px", color: "rgba(255,255,255,0.22)", letterSpacing: "3px", textTransform: "uppercase", marginBottom: "18px" }}>
                  4 of 4
                </p>
                <h1 style={{ color: "#F5F5F5", fontSize: "34px", fontWeight: "700", letterSpacing: "-1px", lineHeight: "1.1", marginBottom: "10px" }}>
                  How do you want to move around?
                </h1>
                <p style={{ color: "rgba(255,255,255,0.32)", fontSize: "15px", marginBottom: "28px", lineHeight: "1.65" }}>
                  You can change this anytime in your profile.
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  {[
                    { mode: "swipe", title: "Swipe",   desc: "Glide between pages with gestures — the original feel." },
                    { mode: "tabs",  title: "Tab bar", desc: "Tap a bar at the bottom — familiar and direct." },
                  ].map(opt => {
                    const on = draft.navMode === opt.mode;
                    return (
                      <button
                        key={opt.mode}
                        onClick={() => setDraft(d => ({ ...d, navMode: opt.mode }))}
                        style={{
                          textAlign: "left", cursor: "pointer", fontFamily: "inherit",
                          background: on ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.04)",
                          border: `1px solid ${on ? "rgba(255,255,255,0.28)" : "rgba(255,255,255,0.08)"}`,
                          borderRadius: "16px", padding: "18px 20px",
                          transition: "all 0.15s",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
                          <span style={{ fontSize: "17px", fontWeight: 650, color: on ? "#F5F5F5" : "rgba(255,255,255,0.6)" }}>
                            {opt.title}
                          </span>
                          {on && <Check size={15} style={{ color: "#F5F5F5" }} />}
                        </div>
                        <span style={{ fontSize: "13px", color: "rgba(255,255,255,0.4)", lineHeight: 1.5 }}>{opt.desc}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Continue button */}
            <button
              className="ob-cont"
              onClick={handleNext}
              style={{
                width: "100%",
                marginTop: "32px",
                background: "rgba(255,255,255,0.92)",
                color: "#111",
                border: "none",
                borderRadius: "14px",
                padding: "16px",
                fontSize: "16px",
                fontWeight: "600",
                cursor: "pointer",
                fontFamily: "inherit",
                transition: "background 0.15s, transform 0.15s",
              }}
            >
              {step === 3 ? "Finish →" : "Continue →"}
            </button>
          </>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div style={{
          position: "fixed",
          bottom: 48,
          left: "50%",
          transform: "translateX(-50%)",
          background: "rgba(22,22,26,0.97)",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: "12px",
          padding: "10px 18px",
          color: "#F5F5F5",
          fontSize: "14px",
          zIndex: 1000,
          whiteSpace: "nowrap",
          animation: "obToastUp 0.2s ease",
        }}>
          {toast}
        </div>
      )}
    </div>
  );
}

// rebuild

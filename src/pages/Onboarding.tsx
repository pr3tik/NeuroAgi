import { useState, useEffect, useRef } from "react";
import { Check, Pencil } from "lucide-react";
// Merge resolution (onboarding-v2 × frontend/dev #89): keep the v2 onboarding UX,
// but use #89's bundled-local school search instead of the old live-Supabase-table
// query — the live-table path was tied to the silent school-selection data-loss bug.
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

/* ─── Intake questions (PRD §5.1 — exact copy, asked during the sync wait) ───
   Scenario-based because students can't self-report "learning style".
   Every answer must be visibly consumed: `echo` prints into the sync feed the
   moment it's tapped, `card` becomes a line on the mirror-back brain card.
   A skip is logged as a signal, never treated as an error.                    */

const INTAKE_QUESTIONS = [
  {
    key: "learning_style",
    q: "When a new topic just isn't clicking, what actually helps?",
    options: [
      { id: "diagram", label: "A diagram",           echo: "Got it — diagrams first.",                  card: "Learns best with diagrams" },
      { id: "talk",    label: "Talk me through it",  echo: "Noted — I'll talk you through things.",     card: "Likes being talked through it" },
      { id: "read",    label: "Read at my own pace", echo: "Got it — written out, at your pace.",       card: "Reads at their own pace" },
      { id: "problem", label: "Try a problem",       echo: "Learn by doing — got it.",                  card: "Learns by trying problems" },
      { id: "mix",     label: "Honestly, a mix",     echo: "Fair — I'll mix it up and watch what lands.", card: "Learns from a mix of formats" },
    ],
  },
  {
    key: "help_seeking",
    q: "It's 11pm and you're stuck on a problem. What's your move?",
    options: [
      { id: "rewatch", label: "Rewatch the lecture",       echo: "Rewatcher — noted.",                            card: "At 11pm: rewatches the lecture" },
      { id: "explain", label: "Get someone to explain it", echo: "You like a second voice. That's me now.",       card: "At 11pm: asks for an explanation" },
      { id: "notes",   label: "Back through my notes",     echo: "Notes person — noted.",                         card: "At 11pm: goes back through notes" },
      { id: "grind",   label: "Grind practice problems",   echo: "Grinder — respect.",                            card: "At 11pm: grinds practice problems" },
      { id: "close",   label: "Close the laptop",          echo: "Honest. I'll make stuck feel less stuck.",      card: "At 11pm: closes the laptop" },
    ],
  },
  {
    key: "explanation_style",
    q: "How do you want me to explain things?",
    options: [
      { id: "quick",  label: "Quick answer first",         echo: "Answer first, details after — got it.", card: "Wants the quick answer first" },
      { id: "steps",  label: "Step-by-step from basics",   echo: "From the ground up — got it.",          card: "Step-by-step from basics" },
      { id: "why",    label: "Why before how",             echo: "Why before how — noted.",               card: "Wants why before how" },
      { id: "worked", label: "A worked example",           echo: "Worked examples — got it.",             card: "Learns from worked examples" },
    ],
  },
  {
    key: "prep_style",
    q: "Exam in a week. What's your prep style?",
    options: [
      { id: "mindmaps",   label: "Mind-maps",                          echo: "Mind-maps — got it.",                        card: "Preps with mind-maps" },
      { id: "aloud",      label: "Explain out loud",                   echo: "Teaching it back — the good stuff.",         card: "Preps by explaining out loud" },
      { id: "rewrite",    label: "Rewrite my notes",                   echo: "Rewriter — noted.",                          card: "Preps by rewriting notes" },
      { id: "pastpapers", label: "Past papers on repeat",              echo: "Past papers — got it.",                      card: "Preps with past papers" },
      { id: "cram",       label: "Cram the night before — no judgment", echo: "No judgment. We'll make the cram count.",   card: "Crams the night before" },
    ],
  },
  {
    key: "study_window",
    q: "When do you actually study? Be honest.",
    options: [
      { id: "weeknights", label: "Weeknights",                        echo: "Weeknights — noted.",                              card: "Studies weeknights" },
      { id: "latenight",  label: "Late night, 10pm+",                 echo: "Night owl — noted.",                               card: "Studies late — 10pm+" },
      { id: "mornings",   label: "Mornings",                          echo: "Morning person — noted.",                          card: "Studies mornings" },
      { id: "weekends",   label: "Weekends",                          echo: "Weekends — noted.",                                card: "Studies weekends" },
      { id: "deadline",   label: "Whenever the deadline scares me",   echo: "Deadline-powered. I'll get ahead of them for you.", card: "Studies when deadlines loom" },
    ],
  },
];

const INTAKE_KEYS = INTAKE_QUESTIONS.map(q => q.key);

function intakeOption(key, id) {
  const q = INTAKE_QUESTIONS.find(x => x.key === key);
  return q?.options.find(o => o.id === id) ?? null;
}

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
    intake: {},          // { [questionKey]: optionId | "skipped" }
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

const chipStyle = (on = false): React.CSSProperties => ({
  background: on ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.05)",
  border: `1px solid ${on ? "rgba(255,255,255,0.3)" : "rgba(255,255,255,0.12)"}`,
  borderRadius: "100px",
  padding: "10px 18px",
  color: on ? "#F5F5F5" : "rgba(255,255,255,0.72)",
  fontSize: "14px",
  cursor: "pointer",
  fontFamily: "inherit",
  transition: "all 0.15s",
});

/* ─── Brain graphic — one node lights up per answered question ─────────────── */

const BRAIN_NODES = [
  { x: 26, y: 16 }, { x: 76, y: 12 }, { x: 90, y: 54 }, { x: 62, y: 86 }, { x: 14, y: 60 },
];

function BrainGraph({ count }: { count: number }) {
  return (
    <svg viewBox="0 0 100 100" style={{ width: "96px", height: "96px", overflow: "visible" }}>
      {BRAIN_NODES.map((n, i) => i < count && (
        <g key={i} style={{ animation: "obNodeIn 0.5s ease both" }}>
          <line x1="50" y1="50" x2={n.x} y2={n.y} stroke="rgba(255,255,255,0.18)" strokeWidth="0.8" />
          <circle cx={n.x} cy={n.y} r="3.2" fill="rgba(255,255,255,0.75)" />
        </g>
      ))}
      <circle cx="50" cy="50" r={4.5 + count * 0.7} fill="rgba(255,255,255,0.9)" style={{ transition: "r 0.4s ease" }} />
    </svg>
  );
}

/* ─── Main component ───────────────────────────────────────────────────────── */

export default function Onboarding({ email, preferredName: initName, onComplete }) {
  // Steps: 0 (name) → 1 (connect classes) → "gen" (sync narration + intake
  // questions in the same wait) → "brain" (mirror-back card) → done.
  const [step, setStep] = useState<number | string>(0);
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

  // Gen-screen state
  const [genLines, setGenLines]     = useState([]);
  const [syncDone, setSyncDone]     = useState(false);
  const [syncedCourses, setSyncedCourses] = useState([]);
  const [qIndex, setQIndex]         = useState(0);   // next unanswered intake question
  const [saving, setSaving]         = useState(false);

  // Brain-card state: which line is open for correction
  const [fixing, setFixing]         = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);

  const toastTimer   = useRef(null);
  const searchTimer  = useRef(null);
  const dropdownRef  = useRef(null);
  const genStarted   = useRef(false);

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
      startGen();
    }
  }

  function handleBack() {
    if (step === 1) setStep(0);
  }

  // "Skip for now" on the connect step — the sync wait (and its questions)
  // still runs; the narration just has no classes to print.
  function skipConnect() {
    startGen();
  }

  /* ── Gen: real sync narration + intake questions in the same wait ───────── */
  function startGen() {
    if (genStarted.current) { setStep("gen"); return; }
    genStarted.current = true;
    setStep("gen");
    runGeneration();
  }

  async function runGeneration() {
    const base  = draft.manualCanvasUrl || draft.schoolLoginUrl;
    const token = draft.token;

    let courses = [];
    if (base && token) {
      try { courses = await fetchCanvasCourses(base, token); } catch {}
    }
    setSyncedCourses(courses);

    const schoolDisplay = draft.schoolName || draft.manualCanvasUrl || "";
    const seq = base && token
      ? [
          "Connecting to Canvas...",
          ...(schoolDisplay ? [schoolDisplay] : []),
          ...(courses.length > 0
            ? [
                `${courses.length} course${courses.length !== 1 ? "s" : ""} synced`,
                ...courses.slice(0, 8).map(c => `  · ${c.name || c.course_code || "Course"}`),
              ]
            : ["No active courses found — you can re-sync anytime"]),
        ]
      : [
          "No classes connected yet.",
          "You can link Canvas anytime from Connections.",
        ];
    seq.push("Building your brain...");

    for (let i = 0; i < seq.length; i++) {
      await new Promise(r => setTimeout(r, i === 0 ? 300 : 420));
      setGenLines(prev => [...prev, seq[i]]);
    }
    setSyncDone(true);
  }

  const answeredCount = INTAKE_KEYS.filter(k => draft.intake?.[k]).length;

  // Advance to the brain card when the narration is done AND all five
  // questions are answered or skipped.
  useEffect(() => {
    if (step !== "gen" || !syncDone || qIndex < INTAKE_QUESTIONS.length) return;
    const t = setTimeout(() => setStep("brain"), 900);
    return () => clearTimeout(t);
  }, [step, syncDone, qIndex]);

  function answerQuestion(key, optionId) {
    const opt = intakeOption(key, optionId);
    setDraft(d => ({ ...d, intake: { ...(d.intake ?? {}), [key]: optionId } }));
    if (opt?.echo) setGenLines(prev => [...prev, `  ✓ ${opt.echo}`]);
    setQIndex(i => i + 1);
  }

  // The skip itself is a signal — logged, never an error.
  function skipQuestion(key) {
    setDraft(d => ({ ...d, intake: { ...(d.intake ?? {}), [key]: "skipped" } }));
    setQIndex(i => i + 1);
  }

  /* ── Brain card: corrections + completion ───────────────────────────────── */

  // Corrections on the card are the highest-confidence declared data — a tap
  // simply overwrites the intake answer in place.
  function fixAnswer(key, optionId) {
    setDraft(d => ({ ...d, intake: { ...(d.intake ?? {}), [key]: optionId } }));
    setFixing(null);
  }

  async function finishOnboarding() {
    if (saving) return;
    setSaving(true);

    const base  = draft.manualCanvasUrl || draft.schoolLoginUrl;
    const token = draft.token;

    try {
      localStorage.setItem("sa_onboarding_draft", JSON.stringify({ ...draft, onboardingComplete: true }));
      if (draft.schoolName)      localStorage.setItem("sa_school_name",      draft.schoolName);
      if (draft.schoolCity)      localStorage.setItem("sa_school_city",      draft.schoolCity);
      if (draft.schoolCountry)   localStorage.setItem("sa_school_country",   draft.schoolCountry);
      if (draft.schoolContinent) localStorage.setItem("sa_school_continent", draft.schoolContinent);
      if (base && token) {
        localStorage.setItem("sa_token", token);
        localStorage.setItem("sa_base", base);
      }
    } catch {}

    const intake = {};
    const skipped = [];
    for (const k of INTAKE_KEYS) {
      const v = draft.intake?.[k];
      if (v && v !== "skipped") intake[k] = v;
      else skipped.push(k);
    }

    try {
      await onComplete({
        preferredName: draft.preferredName,
        schoolName:    draft.schoolName,
        schoolCity:    draft.schoolCity,
        schoolCountry: draft.schoolCountry,
        schoolContinent: draft.schoolContinent,
        token,
        baseUrl:       base,
        intake,
        intakeSkipped: skipped,
      });
    } finally {
      setSaving(false);
    }
  }

  /* ── Progress ───────────────────────────────────────────────────────────── */
  const progress = (step === "gen" || step === "brain") ? 100 : ((Number(step) + 1) / 2) * 100;

  const currentQuestion = qIndex < INTAKE_QUESTIONS.length ? INTAKE_QUESTIONS[qIndex] : null;

  /* ── Brain-card lines ───────────────────────────────────────────────────── */
  const cardIntakeLines = INTAKE_KEYS.map(key => {
    const v = draft.intake?.[key];
    const opt = v && v !== "skipped" ? intakeOption(key, v) : null;
    return { key, text: opt ? opt.card : "Skipped — tap to answer", skipped: !opt };
  });

  /* ── Render ─────────────────────────────────────────────────────────────── */
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 500,
      background: "#111",
      display: "flex", flexDirection: "column",
      fontFamily: "var(--font-sans, -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif)",
      overflowY: "auto",
    }}>
      <style>{`
        @keyframes obFadeIn  { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
        @keyframes obBlink   { 0%,100%{ opacity:0.25; } 50%{ opacity:0.65; } }
        @keyframes obToastUp { from { opacity:0; transform:translateX(-50%) translateY(6px); } to { opacity:1; transform:translateX(-50%) translateY(0); } }
        @keyframes obNodeIn  { from { opacity:0; } to { opacity:1; } }
        @keyframes obUp      { from { opacity:0; transform:translateY(18px); } to { opacity:1; transform:none; } }
        .ob-back:hover  { color: rgba(255,255,255,0.6) !important; }
        .ob-skip:hover  { color: rgba(255,255,255,0.35) !important; }
        .ob-pill:hover  { transform: translateY(-1px); background: rgba(255,255,255,0.1) !important; }
        .ob-cont:hover  { background: #fff !important; transform: translateY(-1px); }
        .ob-cont:active { transform: translateY(0); }
        .ob-result:hover{ background: rgba(255,255,255,0.05) !important; }
        .ob-line:hover  { border-color: rgba(255,255,255,0.28) !important; }
      `}</style>

      {/* Progress bar */}
      {step !== "gen" && step !== "brain" && (
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

        {/* ── Gen: sync narration + intake questions in the same wait ────── */}
        {step === "gen" && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: "36px" }}>

            {/* Narration feed */}
            <div style={{ display: "flex", flexDirection: "column", gap: "10px", minHeight: "120px" }}>
              {genLines.map((line, i) => (
                <div key={i} style={{
                  color: line.startsWith("  ✓")
                    ? "rgba(255,255,255,0.72)"
                    : line.startsWith("  ·")
                      ? "rgba(255,255,255,0.3)"
                      : "rgba(255,255,255,0.55)",
                  fontSize: line.startsWith("  ·") ? "13px" : "14px",
                  fontFamily: "'SF Mono', 'Fira Mono', monospace",
                  lineHeight: "1.5",
                  animation: "obFadeIn 0.3s ease",
                }}>
                  {line}
                </div>
              ))}
              {!(syncDone && qIndex >= INTAKE_QUESTIONS.length) && (
                <span style={{
                  width: "8px", height: "16px",
                  background: "rgba(255,255,255,0.35)",
                  display: "inline-block",
                  marginTop: "4px",
                  animation: "obBlink 1s ease-in-out infinite",
                }} />
              )}
            </div>

            {/* Question card — the wait pays for the quiz */}
            {currentQuestion && (
              <div key={currentQuestion.key} style={{ animation: "obFadeIn 0.35s ease" }}>
                {qIndex === 0 && (
                  <p style={{ fontSize: "12px", color: "rgba(255,255,255,0.3)", marginBottom: "10px" }}>
                    While that syncs — quick question.
                  </p>
                )}
                <h2 style={{ color: "#F5F5F5", fontSize: "21px", fontWeight: "650", letterSpacing: "-0.4px", lineHeight: "1.3", marginBottom: "18px" }}>
                  {currentQuestion.q}
                </h2>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
                  {currentQuestion.options.map(opt => (
                    <button
                      key={opt.id}
                      className="ob-pill"
                      onClick={() => answerQuestion(currentQuestion.key, opt.id)}
                      style={chipStyle()}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                <button
                  className="ob-skip"
                  onClick={() => skipQuestion(currentQuestion.key)}
                  style={{
                    background: "none", border: "none",
                    color: "rgba(255,255,255,0.18)",
                    fontSize: "12px", cursor: "pointer",
                    fontFamily: "inherit", marginTop: "16px",
                    display: "block", padding: "0",
                    transition: "color 0.15s",
                  }}
                >
                  not sure / skip →
                </button>
              </div>
            )}

            {/* Brain graphic + progress dots */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", gap: "7px" }}>
                {INTAKE_QUESTIONS.map((q, i) => (
                  <span key={q.key} style={{
                    width: "6px", height: "6px", borderRadius: "50%",
                    background: i < qIndex ? "rgba(255,255,255,0.75)" : "rgba(255,255,255,0.14)",
                    transition: "background 0.3s",
                  }} />
                ))}
              </div>
              <BrainGraph count={answeredCount} />
            </div>
          </div>
        )}

        {/* ── Brain card: the mirror-back payoff ──────────────────────────── */}
        {step === "brain" && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", animation: "obUp 0.5s cubic-bezier(.34,1.56,.64,1) both" }}>
            <p style={{ fontSize: "11px", color: "rgba(255,255,255,0.22)", letterSpacing: "3px", textTransform: "uppercase", marginBottom: "18px" }}>
              Your brain so far
            </p>
            <h1 style={{ color: "#F5F5F5", fontSize: "30px", fontWeight: "700", letterSpacing: "-0.8px", lineHeight: "1.15", marginBottom: "8px" }}>
              Here's what I know{draft.preferredName ? `, ${draft.preferredName.split(" ")[0]}` : ""}.
            </h1>
            <p style={{ color: "rgba(255,255,255,0.32)", fontSize: "14px", marginBottom: "26px", lineHeight: "1.6" }}>
              Did I get anything wrong? Tap a line to fix it.
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "28px" }}>

              {/* Name — tap to edit inline */}
              <div
                className="ob-line"
                onClick={() => !editingName && setEditingName(true)}
                style={{
                  display: "flex", alignItems: "center", gap: "12px",
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.09)",
                  borderRadius: "14px", padding: "14px 16px",
                  cursor: "pointer", transition: "border-color 0.15s",
                }}
              >
                {editingName ? (
                  <input
                    autoFocus
                    value={draft.preferredName}
                    onChange={e => setDraft(d => ({ ...d, preferredName: e.target.value }))}
                    onBlur={() => setEditingName(false)}
                    onKeyDown={e => e.key === "Enter" && setEditingName(false)}
                    style={{ ...inputStyle, padding: "4px 8px", borderRadius: "8px", fontSize: "14px" }}
                  />
                ) : (
                  <>
                    <span style={{ color: "#F5F5F5", fontSize: "14px", fontWeight: "550", flex: 1 }}>
                      {draft.preferredName || "Your name"}
                    </span>
                    <Pencil size={13} style={{ color: "rgba(255,255,255,0.22)", flexShrink: 0 }} />
                  </>
                )}
              </div>

              {/* School + courses — from the sync, display-only */}
              {(draft.schoolName || syncedCourses.length > 0) && (
                <div style={{
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.09)",
                  borderRadius: "14px", padding: "14px 16px",
                }}>
                  {draft.schoolName && (
                    <span style={{ color: "rgba(255,255,255,0.72)", fontSize: "14px", display: "block" }}>
                      {draft.schoolName}
                    </span>
                  )}
                  <span style={{ color: "rgba(255,255,255,0.38)", fontSize: "13px" }}>
                    {syncedCourses.length > 0
                      ? `${syncedCourses.length} course${syncedCourses.length !== 1 ? "s" : ""} synced`
                      : "No classes connected yet"}
                  </span>
                </div>
              )}

              {/* Intake lines — tap to correct */}
              {cardIntakeLines.map(line => {
                const q = INTAKE_QUESTIONS.find(x => x.key === line.key);
                const open = fixing === line.key;
                return (
                  <div key={line.key}>
                    <div
                      className="ob-line"
                      onClick={() => setFixing(open ? null : line.key)}
                      style={{
                        display: "flex", alignItems: "center", gap: "12px",
                        background: open ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.04)",
                        border: `1px solid ${open ? "rgba(255,255,255,0.28)" : "rgba(255,255,255,0.09)"}`,
                        borderRadius: "14px", padding: "14px 16px",
                        cursor: "pointer", transition: "border-color 0.15s",
                      }}
                    >
                      <span style={{
                        color: line.skipped ? "rgba(255,255,255,0.3)" : "rgba(255,255,255,0.78)",
                        fontSize: "14px", flex: 1,
                        fontStyle: line.skipped ? "italic" : "normal",
                      }}>
                        {line.text}
                      </span>
                      <Pencil size={13} style={{ color: "rgba(255,255,255,0.22)", flexShrink: 0 }} />
                    </div>
                    {open && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", padding: "12px 4px 4px", animation: "obFadeIn 0.25s ease" }}>
                        {q.options.map(opt => {
                          const on = draft.intake?.[line.key] === opt.id;
                          return (
                            <button
                              key={opt.id}
                              className="ob-pill"
                              onClick={() => fixAnswer(line.key, opt.id)}
                              style={{ ...chipStyle(on), padding: "8px 14px", fontSize: "13px" }}
                            >
                              {on && <Check size={12} style={{ marginRight: "5px", verticalAlign: "-1px" }} />}
                              {opt.label}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <button
              className="ob-cont"
              onClick={finishOnboarding}
              disabled={saving}
              style={{
                width: "100%",
                background: "rgba(255,255,255,0.92)",
                color: "#111",
                border: "none",
                borderRadius: "14px",
                padding: "16px",
                fontSize: "16px",
                fontWeight: "600",
                cursor: saving ? "wait" : "pointer",
                fontFamily: "inherit",
                opacity: saving ? 0.7 : 1,
                transition: "background 0.15s, transform 0.15s",
              }}
            >
              {saving ? "Saving..." : "Looks right →"}
            </button>
          </div>
        )}

        {/* ── Step screens ──────────────────────────────────────────────── */}
        {step !== "gen" && step !== "brain" && (
          <>
            {/* Back button */}
            {step === 1 && (
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
                  1 of 2
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
                  2 of 2
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
                  onClick={skipConnect}
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
              {step === 1 ? "Connect →" : "Continue →"}
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

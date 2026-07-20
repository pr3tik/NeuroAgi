// App.jsx — Navigation state + page transition only.
// Does not know about page content — all page logic lives in pages/.
// Adding a page: create pages/NewPage.jsx, import it here, add to PAGES.
// PLACE IN: /src/App.jsx (replaces existing file)

import { useState, useCallback, useRef, useEffect, lazy, Suspense } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check } from "lucide-react";
import { LABEL }            from "./navigation/navConfig";
import NeuralRing           from "./components/NeuralRing";
import ReggieTester         from "./components/ReggieTester";
import UniBrainTester       from "./components/UniBrainTester";
import SiteGuide            from "./components/SiteGuide";
import BottomNav            from "./components/BottomNav";
import Landing              from "./pages/Landing"; // eager — logged-out entry, shown on first paint
import PreSignupDemo from "./pages/PreSignupDemo"; // S0-S2 pre-signup demo — now OPT-IN via a Landing CTA, never a forced interstitial
import { useApp }           from "./context/AppContext";
import { supabase }         from "./api/supabase";
import { signIn, signUp, adoptIdentity, completeOAuthLogin } from "./api/auth";
import { usePageTracking }  from "./hooks/usePageTracking";
import { awardTokens }      from "./api/tokens";
import TokenToast           from "./components/TokenToast";
import NotificationPanel    from "./components/NotificationPanel";
import { fetchUnreadCount, AppNotification } from "./api/notifications";

// Pages are code-split: each loads as its own chunk only when first navigated to, so
// the initial bundle stays small and a page's JS isn't downloaded until it's used.
// (Only one page is mounted at a time — PAGES[currentPage] — so nothing offscreen renders.)
const Work        = lazy(() => import("./pages/Work"));
const Canvas      = lazy(() => import("./pages/Canvas"));
const Assignment  = lazy(() => import("./pages/Assignment"));
const Study       = lazy(() => import("./pages/Study"));
const Toolkit     = lazy(() => import("./pages/Toolkit"));
const Identity    = lazy(() => import("./pages/Identity"));
const Leaderboard = lazy(() => import("./pages/Leaderboard"));
const Files       = lazy(() => import("./pages/Files"));
const StudyRooms  = lazy(() => import("./pages/StudyRooms"));
const Onboarding   = lazy(() => import("./pages/Onboarding"));
const Spaces       = lazy(() => import("./pages/Spaces"));
const Connections  = lazy(() => import("./pages/Connections"));
const StudyAssistant = lazy(() => import("./pages/StudyAssistant"));

const PAGES = {
  work:        Work,
  canvas:      Canvas,
  assignment:  Assignment,
  study:       Study,
  toolkit:     Toolkit,
  identity:    Identity,
  leaderboard: Leaderboard,
  files:       Files,
  rooms:       StudyRooms,
  spaces:      Spaces,
  connections: Connections,
  studyAssistant: StudyAssistant,
};

const LOGGED_IN_KEY = "fschool_logged_in";

const SHELL_STYLES = `
  .app-shell {
    background:  var(--color-bg);
    font-family: var(--font-sans);
    color:       var(--text-primary);
    min-height:  100dvh;
    position:    relative;
    overflow-x:  clip;
    transition:  background 0.4s var(--ease-apple), color 0.4s var(--ease-apple);
  }
  .app-page-transition {
    min-height: 100dvh;
    transition: opacity 0.18s var(--ease-apple), transform 0.18s var(--ease-apple);
  }
  .app-header {
    display:         flex;
    align-items:     center;
    justify-content: space-between;
    padding:         52px 22px 0;
    transition:      color 0.4s var(--ease-apple);
  }
  .app-page-label {
    font-size:      11px;
    color:          var(--text-dim);
    letter-spacing: 2px;
    text-transform: uppercase;
    font-weight:    500;
    transition:     color 0.4s var(--ease-apple);
  }
  .app-main {
    padding: 20px 22px 100px;
  }
  /* On web (≥768px): BottomNav becomes a fixed left sidebar, so push the page
     content over to make room (232px rail / 64px collapsed — must match RAIL_W in
     BottomNav.tsx). The shell always carries .nav-tabs (tabs is the only nav mode).

     Content is also capped at a readable width and CENTERED in the leftover space —
     on wide monitors, full-bleed pages stretched sections absurdly far apart. The
     max() keeps the sidebar offset as the floor, so content never slides under the
     rail on medium screens; on wide screens both margins equalize → centered. */
  @media (min-width: 768px) {
    .nav-tabs .app-page-transition {
      max-width: 1240px;
      margin-left: max(232px, calc((100% - 1240px) / 2));
      margin-right: max(0px, calc((100% - 1240px) / 2));
      transition: margin-left 0.2s var(--ease-apple);
    }
    .nav-tabs.nav-collapsed .app-page-transition {
      margin-left: max(64px, calc((100% - 1240px) / 2));
    }
    /* Deliberate outlier: the study room is a workspace (board + session + presence),
       not a reading page — it earns the full width. */
    .nav-tabs.page-wide .app-page-transition {
      max-width: none;
      margin-left: 232px;
      margin-right: 24px;
    }
    .nav-tabs.page-wide.nav-collapsed .app-page-transition {
      margin-left: 64px;
    }
  }
`;

if (!document.getElementById("app-shell-styles")) {
  const tag = document.createElement("style");
  tag.id = "app-shell-styles";
  tag.textContent = SHELL_STYLES;
  document.head.appendChild(tag);
}

// Shown briefly while a lazily-loaded page chunk downloads.
function PageLoader() {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "72px 0" }}>
      <style>{`@keyframes appSpin{to{transform:rotate(360deg)}}`}</style>
      <span style={{
        width: 20, height: 20, borderRadius: "50%", display: "inline-block",
        border: "2px solid rgba(255,255,255,0.14)", borderTopColor: "rgba(255,255,255,0.55)",
        animation: "appSpin 0.7s linear infinite",
      }} />
    </div>
  );
}

export default function App() {
  const { userId, setUserId, refreshUser, userData, saveCanvasCredentials, updateUserField, pendingNav, setPendingNav, tokenSummary } = useApp();

  const [isLoggedIn, setIsLoggedIn] = useState(
    () => Boolean(localStorage.getItem(LOGGED_IN_KEY))
  );
  // ReggieTester / UniBrainTester are dev-only diagnostic sandboxes (see their own
  // console.log("...look bottom-left...") debug messages) — genuinely useful for
  // exercising the new Reggie backend directly, but they shouldn't render for every
  // real session. Always on under `npm run dev`; on prod, opt in via:
  // localStorage.setItem("fschool_devtools", "1") + refresh.
  const showDevTools = () => {
    if ((import.meta as any)?.env?.DEV) return true;
    try { return localStorage.getItem("fschool_devtools") === "1"; } catch { return false; }
  };
  // The pre-signup demo is OPT-IN: fschoolai.com always shows Landing first for a
  // logged-out visitor, and the demo opens only when they click its CTA on Landing.
  // (It used to auto-gate Landing whenever `fschool_demo_seen` was unset, so anyone who
  // left mid-demo — or arrived in a fresh/incognito browser — got the demo "instead of
  // the landing page" on the next visit. That forced interstitial is removed.)
  const [showPreSignupDemo, setShowPreSignupDemo] = useState(false);
  const [showOnboarding,      setShowOnboarding]     = useState(false);
  const [onboardingEmail,     setOnboardingEmail]    = useState("");
  const [onboardingInitName,  setOnboardingInitName] = useState("");
  const [currentPage,         setCurrentPage]        = useState("work");
  const [visible,             setVisible]            = useState(true);
  const [navCollapsed,        setNavCollapsed]       = useState(true); // collapsed by default; expands on hover (or pin-open via the toggle)

  // ── Notification bell state ────────────────────────────────────────────────
  const [unreadCount,   setUnreadCount]   = useState(0);
  const [showBell,      setShowBell]      = useState(false);
  const [liveNotifs,    setLiveNotifs]    = useState<AppNotification[]>([]);
  const [bellRing,      setBellRing]      = useState(false);
  const prevUnreadRef = useRef(0);

  // Fetch initial unread count on login
  useEffect(() => {
    if (!userId) return;
    fetchUnreadCount(userId).then(c => { setUnreadCount(c); prevUnreadRef.current = c; });
  }, [userId]);

  // Subscribe to new notifications via postgres_changes (clean, no WS needed server-side)
  useEffect(() => {
    if (!userId) return;
    const ch = supabase.channel(`notifs:${userId}`);
    ch.on("postgres_changes", {
      event: "INSERT", schema: "public", table: "notifications",
      filter: `user_id=eq.${userId}`,
    }, (payload) => {
      const n = payload.new as AppNotification;
      setLiveNotifs(prev => [n, ...prev]);
      if (!showBell) setUnreadCount(c => c + 1); // panel is closed → increment badge
    }).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [userId]); // eslint-disable-line

  // Bell wobble: fires once when a new notification arrives while panel is closed
  useEffect(() => {
    if (unreadCount > prevUnreadRef.current && !showBell) {
      setBellRing(true);
      const t = setTimeout(() => setBellRing(false), 600);
      prevUnreadRef.current = unreadCount;
      return () => clearTimeout(t);
    }
    prevUnreadRef.current = unreadCount;
  }, [unreadCount, showBell]); // eslint-disable-line

  // ── Verify banner state ────────────────────────────────────────────────────
  const [verifyBanner, setVerifyBanner] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("verify") || null;
  });

  // ── Discord connect banner state ───────────────────────────────────────────
  const [discordBanner, setDiscordBanner] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("discord") || null;
  });

  // ── LMS connect banner state (Google / Microsoft OAuth callback) ───────────
  const [lmsBanner, setLmsBanner] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("lms") || null;
  });

  // ── Password reset state ────────────────────────────────────────────────────
  const [resetMode, setResetMode] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("reset") === "confirm" ? {
      token:  params.get("token"),
      userId: params.get("userId"),
    } : null;
  });
  const [resetPw,      setResetPw]      = useState("");
  const [resetConfirm, setResetConfirm] = useState("");
  const [resetLoading, setResetLoading] = useState(false);
  const [resetError,   setResetError]   = useState("");
  const [resetDone,    setResetDone]    = useState(false);
  // A clicked reset link that failed server-side ("error" = invalid/replaced token,
  // "expired" = >1h old). These used to be silently ignored — the user landed on the
  // app with no explanation, which reads as "reset password doesn't work".
  const [resetFailed,  setResetFailed]  = useState<string | null>(() => {
    const r = new URLSearchParams(window.location.search).get("reset");
    return r === "error" || r === "expired" ? r : null;
  });
  const [resetEmail,     setResetEmail]     = useState("");
  const [resetLinkState, setResetLinkState] = useState<"idle" | "sending" | "sent">("idle");
  const [resendSent,   setResendSent]   = useState(false);
  // Email-verification gate feedback: null | "checking" | a message to show the user.
  const [verifyMsg,    setVerifyMsg]    = useState<string | null>(null);
  const [oauthError,   setOauthError]   = useState<string | null>(null);

  // ── Google sign-in return (/?auth=google) ──────────────────────────────────
  // A first-time Google user has a GoTrue session but no public.users row, so we
  // provision one (server-side) then route: new users → the onboarding wizard
  // (Google gives name + email only; they still pick school/Canvas/goals),
  // returning users → straight into the app. detectSessionInUrl exchanges the PKCE
  // code during client init, so wait for the SIGNED_IN event before reading it.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("auth") !== "google") return;
    let running = false, settled = false;
    const finish = async () => {
      if (settled || running) return;
      running = true;
      try {
        const r = await completeOAuthLogin();
        if (!r) { running = false; return; }        // no session yet — wait for the event
        settled = true;
        window.history.replaceState({}, "", "/");   // strip ?auth=google&code=
        if (r.isNew) {
          setUserId(r.userId);
          setOnboardingInitName(r.name || "");
          setShowOnboarding(true);
        } else {
          window.location.reload();                 // returning user → boot into the app
        }
      } catch (e: any) {
        settled = true;
        window.history.replaceState({}, "", "/");
        setOauthError(e?.message || "Google sign-in failed. Please try again.");
      } finally {
        running = false;
      }
    };
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "INITIAL_SESSION") finish();
    });
    finish();  // fast path if the session was already restored
    return () => sub.subscription.unsubscribe();
  }, [setUserId]);

  // While the verification gate is up, poll every 5s so the app unblocks ITSELF the
  // moment the link is clicked (usually on the user's phone) — a user report showed the
  // old flow stuck on "Check your email" with the DB already verified, because nothing
  // ever re-checked and the continue button gave no feedback.
  const needsEmailVerify = !!userData && userData.email_verified === false;
  useEffect(() => {
    if (!needsEmailVerify) return;
    // Poll gently: skip hidden tabs (an abandoned tab used to fire ~17k queries/day) and
    // back off 5s → 30s after the first minute. The focus/visibility listener in
    // AppContext already re-checks immediately when the user comes back.
    let ticks = 0;
    let timer: any;
    const tick = () => {
      ticks++;
      if (document.visibilityState === "visible") refreshUser();
      timer = setTimeout(tick, ticks < 12 ? 5000 : 30000);
    };
    timer = setTimeout(tick, 5000);
    return () => clearTimeout(timer);
  }, [needsEmailVerify, refreshUser]);

  async function checkVerified() {
    setVerifyMsg("checking");
    const fresh = await refreshUser();   // if verified, userData updates and the gate unmounts
    if (!fresh) setVerifyMsg("Couldn't check just now — give it a second and try again.");
    else if (fresh.email_verified === false) setVerifyMsg("Not verified yet — open the link in the email first (check your junk/spam folder), then tap this again.");
    else setVerifyMsg(null);
  }

  // From the failed-reset-link card: request a fresh reset email.
  async function requestNewResetLink() {
    const email = resetEmail.trim();
    if (!email || resetLinkState !== "idle") return;
    setResetLinkState("sending");
    try {
      await fetch("/api/email?action=reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
    } catch { /* anti-enumeration: same confirmation either way */ }
    setResetLinkState("sent");
  }

  function dismissResetFailed() {
    setResetFailed(null);
    const url = new URL(window.location.href);
    url.searchParams.delete("reset");
    window.history.replaceState({}, "", url.pathname + url.search);
  }

  async function resendVerification() {
    if (!userData?.email) return;
    try {
      await fetch("/api/email?action=send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, email: userData.email, name: userData.name || "" }),
      });
    } catch {}
    setResendSent(true);
    setTimeout(() => setResendSent(false), 30000); // allow resend again after 30s
  }

  async function handleResetSubmit() {
    if (!resetPw || resetPw !== resetConfirm) { setResetError("Passwords don't match."); return; }
    if (resetPw.length < 6) { setResetError("Password must be at least 6 characters."); return; }
    setResetLoading(true);
    setResetError("");
    try {
      // Reset via Supabase Auth (GoTrue), not the legacy password_hash. The endpoint
      // validates the one-time token, sets the GoTrue password (creating + linking the
      // auth user if this account never migrated), and burns the token server-side.
      const res = await fetch("/api/auth-migrate?action=reset", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: resetMode.userId, token: resetMode.token, password: resetPw }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to reset password. Try again.");
      setResetDone(true);
      setTimeout(() => { setResetMode(null); setResetDone(false); }, 3000);
      const url = new URL(window.location.href);
      url.searchParams.delete("reset");
      url.searchParams.delete("token");
      url.searchParams.delete("userId");
      window.history.replaceState({}, "", url.toString());
    } catch (err) {
      setResetError(err?.message || "Failed to reset password. Try again.");
    }
    setResetLoading(false);
  }

  // Clear ?verify= param from URL after reading it + listen for cross-tab verify
  useEffect(() => {
    if (!verifyBanner) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("verify");
    url.searchParams.delete("reason");
    window.history.replaceState({}, "", url.toString());
    const t = setTimeout(() => setVerifyBanner(null), 6000);
    return () => clearTimeout(t);
  }, [verifyBanner]);

  // Clear ?discord= param after reading it + auto-dismiss the banner
  useEffect(() => {
    if (!discordBanner) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("discord");
    window.history.replaceState({}, "", url.toString());
    const t = setTimeout(() => setDiscordBanner(null), 6000);
    return () => clearTimeout(t);
  }, [discordBanner]);

  // Clear ?lms= param + navigate to connections page on successful OAuth
  useEffect(() => {
    if (!lmsBanner) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("lms");
    url.searchParams.delete("reason");
    window.history.replaceState({}, "", url.toString());
    if (lmsBanner === "google_connected" || lmsBanner === "microsoft_connected") {
      setTimeout(() => navigate("connections"), 400);
    }
    const t = setTimeout(() => setLmsBanner(null), 6000);
    return () => clearTimeout(t);
  }, [lmsBanner]); // eslint-disable-line

  // If user verifies email in another tab, show banner in this tab too
  useEffect(() => {
    function onStorage(e) {
      if (e.key === "fschool_verified" && e.newValue === "1") {
        setVerifyBanner("success");
        localStorage.removeItem("fschool_verified");
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // (Removed) Chrome extension sign-in handshake (/?ext=signin&extId=...): it pushed the
  // web's possibly-stale fschool_uid into the extension, overwriting the extension's
  // correctly-resolved canonical id. The extension has its own GoTrue popup login now.

  const fadingRef = useRef(false);

  // ── Page tracking ──────────────────────────────────────────────────────────
  usePageTracking(isLoggedIn ? currentPage : null, userId);

  // ── Daily token awards — fire once per session when user is logged in ───────
  useEffect(() => {
    if (!userId || !isLoggedIn) return;
    awardTokens("daily_login").catch(() => {});
    awardTokens("streak_day").catch(() => {});
  }, [userId, isLoggedIn]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Navigation ─────────────────────────────────────────────────────────────
  const navigate = useCallback((pageKey) => {
    if (fadingRef.current || !PAGES[pageKey]) return;
    try { navigator.vibrate?.(8); } catch (_) {}
    fadingRef.current = true;
    setVisible(false);
    setTimeout(() => {
      setCurrentPage(pageKey);
      setVisible(true);
      fadingRef.current = false;
    }, 180);
  }, []);

  // Pages render without props, so in-page actions (e.g. the Home resume cards)
  // navigate by dispatching `fschool:navigate` with { detail: pageKey }.
  useEffect(() => {
    const onNav = (e: any) => { if (e?.detail) navigate(String(e.detail)); };
    window.addEventListener("fschool:navigate", onNav);
    return () => window.removeEventListener("fschool:navigate", onNav);
  }, [navigate]);

  useEffect(() => {
    if (!pendingNav) return;
    navigate(pendingNav.page ?? pendingNav);
    setPendingNav(null);
  }, [pendingNav, navigate, setPendingNav]);

  // ── Auth ───────────────────────────────────────────────────────────────────
  const handleEnter = useCallback(async (creds: {
    mode?: string; email?: string; password?: string; name?: string;
  } = {}) => {
    const email = (creds.email || "").toLowerCase().trim();

    // ── Login — Supabase Auth (lazily migrates legacy SHA-256 accounts) ──────────
    if (creds.mode === "login") {
      const prevUid = localStorage.getItem("fschool_uid");
      const profile = await signIn(email, creds.password); // establishes a GoTrue session
      // Merge this browser's previous uid's data into the canonical profile BEFORE
      // discarding it (failure → fschool_merge_pending, retried at next boot).
      if (prevUid && prevUid !== profile.id) await adoptIdentity(prevUid);
      localStorage.setItem("fschool_uid", profile.id);
      localStorage.setItem(LOGGED_IN_KEY, "1");
      if (profile.name) localStorage.setItem("fschool_name", profile.name);
      window.location.reload();
      return;
    }

    // ── Signup — creates the GoTrue user + a fresh profile, then signs in ─────────
    // (The server mints a brand-new profile id, so signing up on a device already
    // logged into another account can't clobber it — the old "merge" bug. Claiming the
    // browser's guest data goes through ?action=adopt, which refuses ids owned by a
    // different auth account, so that guarantee still holds.)
    const prevGuestUid = localStorage.getItem("fschool_uid");
    localStorage.setItem("fschool_name", creds.name);
    const profile = await signUp({ name: creds.name, email, password: creds.password });
    if (prevGuestUid && prevGuestUid !== profile.id) await adoptIdentity(prevGuestUid);
    localStorage.setItem("fschool_uid", profile.id);

    // Verification email — non-blocking, won't fail signup if email fails.
    fetch("/api/email?action=send", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ userId: profile.id, email, name: creds.name }),
    }).catch(() => {});

    // Point app state at the new account so onboarding + page-tracking write to it.
    setUserId(profile.id);
    setOnboardingEmail(creds.email);
    setOnboardingInitName(creds.name);
    setShowOnboarding(true);
  }, [setUserId]);

  // ── Onboarding complete ────────────────────────────────────────────────────
  const handleOnboardingComplete = useCallback(async ({
    preferredName, schoolName, schoolCity, schoolCountry, schoolContinent, token, baseUrl,
    intake, intakeSkipped,
  }: {
    preferredName?: string; schoolName?: string; schoolCity?: string; schoolCountry?: string;
    schoolContinent?: string; token?: string; baseUrl?: string;
    intake?: Record<string, string>; intakeSkipped?: string[];
  }) => {
    if (preferredName) localStorage.setItem("fschool_name", preferredName);
    try {
      const patch: {
        id: string; name?: string; school?: string;
        school_city?: string; school_country?: string; school_continent?: string;
      } = { id: userId };
      if (preferredName)   patch.name            = preferredName;
      if (schoolName)      patch.school          = schoolName;
      if (schoolCity)      patch.school_city     = schoolCity;
      if (schoolCountry)   patch.school_country  = schoolCountry;
      if (schoolContinent) patch.school_continent = schoolContinent;
      await updateUserField(patch);
    } catch {}
    // Intake answers go in a SEPARATE upsert: until the intake-columns
    // migration runs, unknown columns fail the whole patch (PGRST204) and
    // would take name/school down with them. localStorage draft still holds
    // the answers either way.
    if ((intake && Object.keys(intake).length > 0) || intakeSkipped?.length) {
      const meta = { version: "onboarding-v2.1", skipped: intakeSkipped ?? [], completed_at: new Date().toISOString() };
      try {
        // intake values are comma-joined multi-selects. The users_*_check constraints must
        // allow multi-values (supabase-onboarding-multiselect-migration.sql). If that
        // migration hasn't run, the single-value CHECK rejects the comma string (400) —
        // supabase-js returns the error rather than throwing, so fall back to persisting
        // the FIRST pick per question so intake isn't lost in the meantime.
        const res = await updateUserField({ ...intake, intake_meta: meta });
        if (res?.error) {
          const firsts: Record<string, string> = {};
          for (const [k, v] of Object.entries(intake)) firsts[k] = String(v).split(",")[0];
          await updateUserField({ ...firsts, intake_meta: meta });
        }
      } catch { /* columns may be absent until the migration runs */ }
    }
    if (token && baseUrl) {
      try { await saveCanvasCredentials(token, baseUrl); } catch {}
    }
    localStorage.setItem(LOGGED_IN_KEY, "1");
    setShowOnboarding(false);
    setIsLoggedIn(true);
  }, [userId, updateUserField, saveCanvasCredentials]);

  // ── Overlays (render in BOTH logged-in and logged-out states so a reset
  // link works even when the user isn't signed in on this device) ───────────
  const overlays = (
    <>
      <style>{`
        @keyframes fsBannerIn { from{opacity:0;transform:translateX(-50%) translateY(-12px) scale(.96)} to{opacity:1;transform:translateX(-50%) translateY(0) scale(1)} }
        @keyframes fsPulseRing { 0%{transform:scale(1);opacity:.6} 100%{transform:scale(1.9);opacity:0} }
        @keyframes fsCardUp { from{opacity:0;transform:translateY(20px) scale(.97)} to{opacity:1;transform:none} }
        @keyframes fsRing { 0%{transform:scale(1);opacity:.55} 100%{transform:scale(2.3);opacity:0} }
        @keyframes fsSpin { to{transform:rotate(360deg)} }
        .fs-reset-input:focus { border-color: rgba(48,209,88,.5) !important; background: rgba(255,255,255,.07) !important; }
        .fs-reset-btn:active { transform: scale(.985); }
      `}</style>

      {/* Email verify banner */}
      {verifyBanner && (
        <div style={{
          position:"fixed", top:"env(safe-area-inset-top, 0px)", left:"50%",
          transform:"translateX(-50%)", zIndex:999, marginTop:"16px",
          width:"calc(100% - 40px)", maxWidth:"420px", padding:"14px 18px",
          borderRadius:"16px", display:"flex", alignItems:"center", gap:"12px",
          background: verifyBanner === "error" ? "rgba(30,10,10,0.88)" : "rgba(10,24,16,0.88)",
          border: verifyBanner === "error" ? "1px solid rgba(255,80,70,0.25)" : "1px solid rgba(52,199,89,0.22)",
          backdropFilter:"blur(20px)", WebkitBackdropFilter:"blur(20px)",
          boxShadow: verifyBanner === "error"
            ? "0 8px 32px rgba(255,59,48,0.18), 0 0 0 1px rgba(255,80,70,0.1)"
            : "0 8px 32px rgba(52,199,89,0.18), 0 0 0 1px rgba(52,199,89,0.1)",
          animation:"fsBannerIn 0.4s cubic-bezier(0.34,1.56,0.64,1) both",
        }}>
          <div style={{ position:"relative", flexShrink:0, width:"10px", height:"10px" }}>
            <div style={{ position:"absolute", inset:0, borderRadius:"50%", background: verifyBanner === "error" ? "#ff453a" : "#30d158", animation:"fsPulseRing 1.4s ease-out infinite" }}/>
            <div style={{ position:"absolute", inset:0, borderRadius:"50%", background: verifyBanner === "error" ? "#ff453a" : "#30d158" }}/>
          </div>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:"13px", fontWeight:"600", color: verifyBanner === "error" ? "#ff6961" : "#30d158", letterSpacing:"-0.1px", marginBottom:"2px" }}>
              {verifyBanner === "success"      && "Email verified"}
              {verifyBanner === "already_done" && "Already verified"}
              {verifyBanner === "error"        && "Verification failed"}
            </div>
            <div style={{ fontSize:"12px", color:"rgba(255,255,255,0.4)" }}>
              {verifyBanner === "success"      && "Your 1-month free subscription is now active."}
              {verifyBanner === "already_done" && "Your email is already verified."}
              {verifyBanner === "error"        && "Link is invalid or expired \u2014 check your inbox."}
            </div>
          </div>
        </div>
      )}

      {/* Discord connect banner */}
      {discordBanner && (
        <div style={{
          position:"fixed", top:"env(safe-area-inset-top, 0px)", left:"50%",
          transform:"translateX(-50%)", zIndex:999, marginTop:"16px",
          width:"calc(100% - 40px)", maxWidth:"420px", padding:"14px 18px",
          borderRadius:"16px", display:"flex", alignItems:"center", gap:"12px",
          background: discordBanner === "error" ? "rgba(30,10,10,0.88)" : "rgba(15,16,30,0.9)",
          border: discordBanner === "error" ? "1px solid rgba(255,80,70,0.25)" : "1px solid rgba(88,101,242,0.35)",
          backdropFilter:"blur(20px)", WebkitBackdropFilter:"blur(20px)",
          boxShadow: discordBanner === "error"
            ? "0 8px 32px rgba(255,59,48,0.18)"
            : "0 8px 32px rgba(88,101,242,0.28), 0 0 0 1px rgba(88,101,242,0.12)",
          animation:"fsBannerIn 0.4s cubic-bezier(0.34,1.56,0.64,1) both",
        }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill={discordBanner === "error" ? "#ff6961" : "#5865F2"} style={{ flexShrink:0 }}>
            <path d="M20.3 4.4A19.8 19.8 0 0 0 15.4 3l-.25.5a18.3 18.3 0 0 1 4.3 1.4 16.7 16.7 0 0 0-13-.05A18 18 0 0 1 10.78 3.5L10.5 3A19.7 19.7 0 0 0 5.6 4.4 20.6 20.6 0 0 0 2 18.3a19.9 19.9 0 0 0 6 3 14.6 14.6 0 0 0 1.27-2.07 12.9 12.9 0 0 1-2-.96l.5-.36a14.2 14.2 0 0 0 12.2 0l.5.36c-.63.38-1.3.7-2 .96A14.5 14.5 0 0 0 16 21.3a19.8 19.8 0 0 0 6-3 20.5 20.5 0 0 0-1.7-13.9ZM8.7 15.3c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2Zm6.6 0c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2Z"/>
          </svg>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:"13px", fontWeight:"600", color: discordBanner === "error" ? "#ff6961" : "#a6b0ff", letterSpacing:"-0.1px", marginBottom:"2px" }}>
              {(discordBanner === "connected" || discordBanner === "connected_nojoin") && "Discord connected"}
              {discordBanner === "error" && "Couldn't connect Discord"}
            </div>
            <div style={{ fontSize:"12px", color:"rgba(255,255,255,0.45)" }}>
              {discordBanner === "connected"       && "Welcome to the beta community \u2014 +5 points. Use /feedback in Discord any time."}
              {discordBanner === "connected_nojoin" && "Linked! We couldn't auto-add you to the server \u2014 join it manually from the invite."}
              {discordBanner === "error"           && "Something went wrong \u2014 you can try again from your profile."}
            </div>
          </div>
        </div>
      )}

      {/* LMS OAuth banner (Google / Microsoft connected or error) */}
      {lmsBanner && (
        <div style={{
          position:"fixed", top:"env(safe-area-inset-top, 0px)", left:"50%",
          transform:"translateX(-50%)", zIndex:999, marginTop:"16px",
          width:"calc(100% - 40px)", maxWidth:"420px", padding:"14px 18px",
          borderRadius:"16px", display:"flex", alignItems:"center", gap:"12px",
          background: lmsBanner?.includes("error") ? "rgba(30,10,10,0.88)" : "rgba(10,24,16,0.88)",
          border: lmsBanner?.includes("error") ? "1px solid rgba(255,80,70,0.25)" : "1px solid rgba(52,199,89,0.22)",
          backdropFilter:"blur(20px)", WebkitBackdropFilter:"blur(20px)",
          boxShadow: lmsBanner?.includes("error")
            ? "0 8px 32px rgba(255,59,48,0.18), 0 0 0 1px rgba(255,80,70,0.1)"
            : "0 8px 32px rgba(52,199,89,0.18), 0 0 0 1px rgba(52,199,89,0.1)",
          animation:"fsBannerIn 0.4s cubic-bezier(0.34,1.56,0.64,1) both",
        }}>
          <div style={{ position:"relative", flexShrink:0, width:"10px", height:"10px" }}>
            <div style={{ position:"absolute", inset:0, borderRadius:"50%", background: lmsBanner?.includes("error") ? "#ff453a" : "#30d158", animation:"fsPulseRing 1.4s ease-out infinite" }}/>
            <div style={{ position:"absolute", inset:0, borderRadius:"50%", background: lmsBanner?.includes("error") ? "#ff453a" : "#30d158" }}/>
          </div>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:"13px", fontWeight:"600", color: lmsBanner?.includes("error") ? "#ff6961" : "#30d158", letterSpacing:"-0.1px", marginBottom:"2px" }}>
              {lmsBanner === "google_connected"    && "Google connected"}
              {lmsBanner === "microsoft_connected" && "Microsoft connected"}
              {lmsBanner?.includes("error")        && "Connection failed"}
            </div>
            <div style={{ fontSize:"12px", color:"rgba(255,255,255,0.4)" }}>
              {lmsBanner === "google_connected"    && "Your Classroom files are ready to import."}
              {lmsBanner === "microsoft_connected" && "Your Teams files are ready to import."}
              {lmsBanner?.includes("error")        && "Something went wrong — try connecting again."}
            </div>
          </div>
        </div>
      )}

      {/* Premium password-reset card */}
      {(resetMode || resetDone || resetFailed) && (
        <div style={{
          position:"fixed", inset:0, zIndex:1000,
          background:"rgba(8,8,10,0.72)", backdropFilter:"blur(14px)", WebkitBackdropFilter:"blur(14px)",
          display:"flex", alignItems:"center", justifyContent:"center", padding:"24px",
        }}>
          <div style={{
            width:"100%", maxWidth:"380px",
            background:"linear-gradient(180deg, rgba(24,24,27,0.98), rgba(16,16,18,0.98))",
            border:"1px solid rgba(255,255,255,0.08)", borderRadius:"24px", padding:"36px 28px",
            boxShadow:"0 30px 80px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.03), inset 0 1px 0 rgba(255,255,255,0.05)",
            animation:"fsCardUp .5s cubic-bezier(.34,1.56,.64,1) both", textAlign:"center",
          }}>
            {resetFailed ? (
              <>
                <div style={{ width:"52px", height:"52px", margin:"0 auto 22px", borderRadius:"16px", background:"rgba(255,159,10,0.1)", border:"1px solid rgba(255,159,10,0.25)", display:"flex", alignItems:"center", justifyContent:"center" }}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="9" stroke="#ff9f0a" strokeWidth="1.8"/>
                    <path d="M12 7.5v5" stroke="#ff9f0a" strokeWidth="1.8" strokeLinecap="round"/>
                    <circle cx="12" cy="16" r="1" fill="#ff9f0a"/>
                  </svg>
                </div>
                <h2 style={{ color:"#F5F5F5", fontSize:"21px", fontWeight:"700", letterSpacing:"-0.4px", marginBottom:"8px" }}>
                  {resetFailed === "expired" ? "That link has expired" : "That link isn't valid anymore"}
                </h2>
                {resetLinkState !== "sent" ? (
                  <>
                    <p style={{ color:"rgba(255,255,255,0.4)", fontSize:"13.5px", lineHeight:1.6, marginBottom:"24px" }}>
                      {resetFailed === "expired"
                        ? "Reset links only work for 1 hour. Enter your email and we'll send you a fresh one."
                        : "It may have been replaced by a newer email, or already used. Enter your email and we'll send a fresh link."}
                    </p>
                    <input className="fs-reset-input" type="email" placeholder="Your account email" value={resetEmail}
                      onChange={e => setResetEmail(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") requestNewResetLink(); }}
                      style={{ width:"100%", boxSizing:"border-box", background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:"12px", padding:"13px 15px", color:"#F5F5F5", fontSize:"14px", outline:"none", fontFamily:"inherit", transition:"all .2s ease", marginBottom:"12px", textAlign:"left" }}/>
                    <button className="fs-reset-btn" onClick={requestNewResetLink} disabled={resetLinkState !== "idle" || !resetEmail.trim()}
                      style={{ width:"100%", background: resetLinkState !== "idle" || !resetEmail.trim() ? "rgba(255,255,255,0.55)" : "#fff", color:"#111", border:"none", borderRadius:"13px", padding:"14px", fontSize:"15px", fontWeight:"650", cursor: resetLinkState !== "idle" || !resetEmail.trim() ? "default" : "pointer", fontFamily:"inherit", transition:"transform .1s ease, background .2s ease", marginBottom:"10px" }}>
                      {resetLinkState === "sending" ? "Sending…" : "Email me a new link →"}
                    </button>
                  </>
                ) : (
                  <p style={{ color:"rgba(48,209,88,0.85)", fontSize:"13.5px", lineHeight:1.65, marginBottom:"18px" }}>
                    Done — if that email has an account, a fresh reset link is on its way. Check your junk/spam folder too.
                  </p>
                )}
                <button onClick={dismissResetFailed}
                  style={{ background:"none", border:"none", color:"rgba(255,255,255,0.35)", fontSize:"13px", cursor:"pointer", fontFamily:"inherit", textDecoration:"underline" }}>
                  Back to FSchoolAI
                </button>
              </>
            ) : !resetDone ? (
              <>
                <div style={{ width:"52px", height:"52px", margin:"0 auto 22px", borderRadius:"16px", background:"rgba(48,209,88,0.12)", border:"1px solid rgba(48,209,88,0.22)", display:"flex", alignItems:"center", justifyContent:"center" }}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                    <rect x="5" y="11" width="14" height="9" rx="2" stroke="#30d158" strokeWidth="1.8"/>
                    <path d="M8 11V8a4 4 0 0 1 8 0v3" stroke="#30d158" strokeWidth="1.8" strokeLinecap="round"/>
                  </svg>
                </div>
                <h2 style={{ color:"#F5F5F5", fontSize:"21px", fontWeight:"700", letterSpacing:"-0.4px", marginBottom:"8px" }}>Set a new password</h2>
                <p style={{ color:"rgba(255,255,255,0.4)", fontSize:"13.5px", lineHeight:1.6, marginBottom:"26px" }}>Choose a strong password to secure your FSchoolAI account.</p>
                <div style={{ display:"flex", flexDirection:"column", gap:"10px", marginBottom:"14px", textAlign:"left" }}>
                  <input className="fs-reset-input" type="password" placeholder="New password" value={resetPw}
                    onChange={e => { setResetPw(e.target.value); if (resetError) setResetError(""); }}
                    style={{ background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:"12px", padding:"13px 15px", color:"#F5F5F5", fontSize:"14px", outline:"none", fontFamily:"inherit", transition:"all .2s ease" }}/>
                  <input className="fs-reset-input" type="password" placeholder="Confirm new password" value={resetConfirm}
                    onChange={e => { setResetConfirm(e.target.value); if (resetError) setResetError(""); }}
                    onKeyDown={e => { if (e.key === "Enter") handleResetSubmit(); }}
                    style={{ background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:"12px", padding:"13px 15px", color:"#F5F5F5", fontSize:"14px", outline:"none", fontFamily:"inherit", transition:"all .2s ease" }}/>
                </div>
                {resetError && <p style={{ color:"#ff6961", fontSize:"12.5px", marginBottom:"14px", textAlign:"left" }}>{resetError}</p>}
                <button className="fs-reset-btn" onClick={handleResetSubmit} disabled={resetLoading}
                  style={{ width:"100%", background: resetLoading ? "rgba(255,255,255,0.55)" : "#fff", color:"#111", border:"none", borderRadius:"13px", padding:"14px", fontSize:"15px", fontWeight:"650", cursor: resetLoading ? "default" : "pointer", fontFamily:"inherit", transition:"transform .1s ease, background .2s ease", display:"flex", alignItems:"center", justifyContent:"center", gap:"8px" }}>
                  {resetLoading
                    ? <><span style={{ width:"15px", height:"15px", border:"2px solid rgba(17,17,17,0.25)", borderTopColor:"#111", borderRadius:"50%", display:"inline-block", animation:"fsSpin .6s linear infinite" }}/>Saving\u2026</>
                    : "Save new password \u2192"}
                </button>
              </>
            ) : (
              <>
                <div style={{ position:"relative", width:"56px", height:"56px", margin:"0 auto 24px" }}>
                  <div style={{ position:"absolute", inset:0, borderRadius:"50%", background:"#30d158", animation:"fsRing 1.6s ease-out infinite" }}/>
                  <div style={{ position:"absolute", inset:"6px", borderRadius:"50%", background:"#30d158", display:"flex", alignItems:"center", justifyContent:"center" }}>
                    <svg width="20" height="20" viewBox="0 0 18 18" fill="none"><path d="M3.5 9l4 4 7-7" stroke="#0a1a0f" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  </div>
                </div>
                <div style={{ display:"inline-flex", alignItems:"center", gap:"6px", background:"rgba(48,209,88,0.1)", border:"1px solid rgba(48,209,88,0.2)", borderRadius:"20px", padding:"6px 14px", fontSize:"11.5px", color:"rgba(48,209,88,0.9)", fontWeight:"600", marginBottom:"18px", letterSpacing:"0.2px" }}>
                  <span style={{ width:"6px", height:"6px", borderRadius:"50%", background:"#30d158" }}/>Password updated
                </div>
                <h2 style={{ color:"#F5F5F5", fontSize:"21px", fontWeight:"700", letterSpacing:"-0.4px", marginBottom:"8px" }}>You're all set.</h2>
                <p style={{ color:"rgba(255,255,255,0.4)", fontSize:"13.5px", lineHeight:1.6 }}>Sign in with your new password to continue.</p>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );

  // ── Render ─────────────────────────────────────────────────────────────────
  if (showOnboarding) {
    return (
      <Suspense fallback={<PageLoader />}>
        <Onboarding
          email={onboardingEmail}
          preferredName={onboardingInitName}
          onComplete={handleOnboardingComplete}
        />
      </Suspense>
    );
  }

  // Fixed toast for a failed Google sign-in (e.g. email already has a password account).
  const oauthToast = oauthError ? (
    <div onClick={() => setOauthError(null)}
      style={{ position: "fixed", top: 16, left: "50%", transform: "translateX(-50%)", zIndex: 2000,
        maxWidth: "min(92vw, 420px)", background: "rgba(20,20,24,0.97)", color: "#F5F5F5",
        border: "1px solid rgba(255,100,90,0.4)", borderRadius: "12px", padding: "12px 16px",
        fontSize: "13px", lineHeight: "1.5", cursor: "pointer", fontFamily: "inherit",
        boxShadow: "0 8px 30px rgba(0,0,0,0.45)" }}>
      {oauthError}
    </div>
  ) : null;

  if (!isLoggedIn && showPreSignupDemo) {
    return (<>{overlays}{oauthToast}<PreSignupDemo onEnter={handleEnter} /></>);
  }

  if (!isLoggedIn) {
    return (<>{overlays}{oauthToast}<Landing onEnter={handleEnter} onTryDemo={() => setShowPreSignupDemo(true)} /><SiteGuide /></>);
  }

  // ── Email verification gate ───────────────────────────────────────────────
  // Block access until the user verifies their email. Only gates accounts
  // where email_verified is explicitly false (null = legacy user, let through).
  if (userData && userData.email_verified === false) {
    return (
      <>
        {overlays}
        <div style={{ minHeight:"100dvh", background:"#0b0c0f", display:"flex", alignItems:"center", justifyContent:"center", padding:"24px", fontFamily:"var(--font-sans,-apple-system,BlinkMacSystemFont,'SF Pro Text',sans-serif)" }}>
          <div style={{ width:"100%", maxWidth:"360px", textAlign:"center" }}>
            <div style={{ width:"58px", height:"58px", margin:"0 auto 24px", borderRadius:"16px", background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.09)", display:"flex", alignItems:"center", justifyContent:"center" }}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
                <rect x="2" y="4" width="20" height="16" rx="3" stroke="rgba(255,255,255,0.55)" strokeWidth="1.6"/>
                <path d="M2 7l10 7 10-7" stroke="rgba(255,255,255,0.55)" strokeWidth="1.6" strokeLinecap="round"/>
              </svg>
            </div>
            <div style={{ fontSize:"22px", fontWeight:"700", color:"#F5F5F5", letterSpacing:"-0.4px", marginBottom:"10px" }}>Check your email</div>
            <p style={{ fontSize:"14px", color:"rgba(255,255,255,0.42)", lineHeight:1.65, marginBottom:"4px" }}>We sent a verification link to</p>
            <p style={{ fontSize:"14px", fontWeight:"600", color:"rgba(255,255,255,0.72)", marginBottom:"8px" }}>{userData.email}</p>
            <p style={{ fontSize:"12px", color:"rgba(255,255,255,0.3)", marginBottom:"26px" }}>Not seeing it? Check your junk/spam folder — this page moves on automatically once you click the link.</p>
            <button
              onClick={checkVerified}
              disabled={verifyMsg === "checking"}
              style={{ width:"100%", background:"#F5F5F5", color:"#111", border:"none", borderRadius:"13px", padding:"14px", fontSize:"15px", fontWeight:"650", cursor: verifyMsg === "checking" ? "default" : "pointer", fontFamily:"inherit", marginBottom:"10px", transition:"opacity .15s", opacity: verifyMsg === "checking" ? 0.6 : 1 }}
            >
              {verifyMsg === "checking" ? "Checking…" : <>I&apos;ve verified — continue &rarr;</>}
            </button>
            {verifyMsg && verifyMsg !== "checking" && (
              <p style={{ fontSize:"12.5px", color:"rgba(255,180,90,0.85)", lineHeight:1.55, margin:"0 0 10px" }}>{verifyMsg}</p>
            )}
            <button
              onClick={resendVerification}
              disabled={resendSent}
              style={{ width:"100%", background:"transparent", color: resendSent ? "rgba(48,209,88,0.75)" : "rgba(255,255,255,0.4)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:"13px", padding:"13px", fontSize:"14px", fontWeight:"500", cursor: resendSent ? "default" : "pointer", fontFamily:"inherit", transition:"color .2s" }}
            >
              {resendSent ? <span style={{ display:"inline-flex", alignItems:"center", gap:5 }}>Verification email sent<Check size={14} /></span> : "Resend verification email"}
            </button>
            <p style={{ marginTop:"22px", fontSize:"12px", color:"rgba(255,255,255,0.22)" }}>
              Wrong account?{" "}
              <button onClick={() => { localStorage.clear(); window.location.reload(); }} style={{ background:"none", border:"none", color:"rgba(255,255,255,0.32)", fontSize:"12px", cursor:"pointer", padding:0, textDecoration:"underline" }}>
                Sign out
              </button>
            </p>
          </div>
        </div>
      </>
    );
  }

  const PageComponent = PAGES[currentPage];

  return (
    <div className={`app-shell nav-tabs${navCollapsed ? " nav-collapsed" : ""}${currentPage === "rooms" ? " page-wide" : ""}`}>
      {overlays}
      <TokenToast />

      <div
        className="app-page-transition"
        style={{
          opacity:   visible ? 1 : 0,
          transform: visible ? "scale(1)" : "scale(0.98)",
        }}
      >
        <header className="app-header">
          <span className="app-page-label">
            {LABEL[currentPage]}
          </span>
          {/* ── Header cluster: token status + notification bell ───────────── */}
          {/* Single intentional unit — consistent height (32px), same border
              treatment, token pill + hairline divider + bell circle. */}
          <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
            <div style={{
              display: "flex", alignItems: "center",
              height: "32px",
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.09)",
              borderRadius: "16px",
              overflow: "visible",  // badge overflows the pill boundary
            }}>
              {/* Token status — tappable, navigates to leaderboard */}
              {tokenSummary && (
                <>
                  <button
                    onClick={() => navigate("leaderboard")}
                    style={{
                      display: "flex", alignItems: "center", gap: "5px",
                      padding: "0 8px 0 11px", height: "100%",
                      background: "none", border: "none",
                      cursor: "pointer", fontFamily: "inherit", outline: "none",
                      borderRadius: "16px 0 0 16px",
                      transition: "opacity 0.15s",
                    }}
                    onMouseEnter={e => (e.currentTarget.style.opacity = "0.72")}
                    onMouseLeave={e => (e.currentTarget.style.opacity = "1")}
                  >
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--gold)", display: "inline-block", flexShrink: 0 }} />
                    <span style={{ color: "var(--gold)", fontSize: "11px", fontWeight: "600", letterSpacing: "-0.1px" }}>
                      {tokenSummary.points}
                    </span>
                    <span style={{ color: "rgba(var(--gold-rgb), 0.45)", fontSize: "10px", margin: "0 1px" }}>·</span>
                    <span style={{ color: "rgba(255,255,255,0.3)", fontSize: "10px", letterSpacing: "0.3px" }}>
                      {tokenSummary.tier}
                    </span>
                  </button>
                  {/* Hairline divider between token and bell */}
                  <div style={{ width: 1, height: 16, background: "rgba(255,255,255,0.09)", flexShrink: 0 }} />
                </>
              )}

              {/* Bell — circle sits flush inside the pill */}
              <motion.button
                onClick={() => { setShowBell(v => !v); if (!showBell) setUnreadCount(0); }}
                animate={bellRing ? { rotate: [0, -14, 11, -8, 5, -3, 1, 0] } : { rotate: 0 }}
                transition={{ duration: 0.52, ease: "easeOut" }}
                style={{
                  width: 32, height: 32, flexShrink: 0,
                  borderRadius: tokenSummary ? "0 15px 15px 0" : "15px",
                  border: "none",
                  background: showBell ? "rgba(255,255,255,0.08)" : "transparent",
                  cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                  color: unreadCount > 0 ? "var(--gold)" : "rgba(255,255,255,0.38)",
                  position: "relative",
                  transition: "background 0.15s, color 0.15s",
                }}
                aria-label="Notifications"
              >
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                  <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
                </svg>
                {/* Unread badge — spring pops in, re-mounts on count change */}
                <AnimatePresence>
                  {unreadCount > 0 && (
                    <motion.span
                      key={unreadCount}
                      initial={{ scale: 0, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0, opacity: 0 }}
                      transition={{ type: "spring", stiffness: 520, damping: 22 }}
                      style={{
                        position: "absolute", top: "3px", right: "3px",
                        minWidth: "15px", height: "15px",
                        background: "var(--gold)", color: "#111",
                        borderRadius: "8px", fontSize: "9px", fontWeight: "700",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        padding: "0 3px", lineHeight: 1,
                        boxShadow: "0 0 0 2px var(--color-bg)",
                      }}
                    >
                      {unreadCount > 99 ? "99+" : unreadCount}
                    </motion.span>
                  )}
                </AnimatePresence>
              </motion.button>
            </div>

            {/* Panel — position:fixed, so parent stacking context doesn't matter */}
            <AnimatePresence>
              {showBell && (
                <NotificationPanel
                  key="notif-panel"
                  userId={userId}
                  liveNotifs={liveNotifs}
                  onClose={() => setShowBell(false)}
                  onNavigate={navigate}
                  onUnreadChange={setUnreadCount}
                />
              )}
            </AnimatePresence>
          </div>
        </header>

        <main className="app-main">
          <Suspense fallback={<PageLoader />}>
            {PageComponent && <PageComponent />}
          </Suspense>
        </main>
      </div>

      <NeuralRing currentPage={currentPage} />
      {showDevTools() && <ReggieTester />}
      {showDevTools() && <UniBrainTester />}
      <BottomNav
        currentPage={currentPage}
        onNavigate={navigate}
        collapsed={navCollapsed}
        onToggleCollapse={() => setNavCollapsed(v => !v)}
      />
    </div>
  );
}

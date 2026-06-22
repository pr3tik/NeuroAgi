// App.jsx — Navigation state + page transition only.
// Does not know about page content — all page logic lives in pages/.
// Adding a page: create pages/NewPage.jsx, import it here, add to PAGES.
// PLACE IN: /src/App.jsx (replaces existing file)

import { useState, useCallback, useRef, useEffect, lazy, Suspense } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { NAV, LABEL }       from "./navigation/navConfig";
import { useSwipe }         from "./navigation/useSwipe";
import PageDots             from "./components/PageDots";
import NeuralRing           from "./components/NeuralRing";
import BottomNav            from "./components/BottomNav";
import Landing              from "./pages/Landing"; // eager — logged-out entry, shown on first paint
import { useApp }           from "./context/AppContext";
import { supabase }         from "./api/supabase";
import { signIn, signUp }   from "./api/auth";
import { usePageTracking }  from "./hooks/usePageTracking";
import { awardTokens }      from "./api/tokens";
import TokenToast           from "./components/TokenToast";
import NotificationPanel    from "./components/NotificationPanel";
import { fetchUnreadCount, AppNotification } from "./api/notifications";

// Pages are code-split: each loads as its own chunk only when first navigated to, so
// the initial bundle stays small and a page's JS isn't downloaded until it's used.
// (Only one page is mounted at a time — PAGES[currentPage] — so nothing offscreen renders.)
const Card        = lazy(() => import("./pages/Card"));
const Work        = lazy(() => import("./pages/Work"));
const Canvas      = lazy(() => import("./pages/Canvas"));
const Assignment  = lazy(() => import("./pages/Assignment"));
const Study       = lazy(() => import("./pages/Study"));
const Toolkit     = lazy(() => import("./pages/Toolkit"));
const Identity    = lazy(() => import("./pages/Identity"));
const Leaderboard = lazy(() => import("./pages/Leaderboard"));
const Files       = lazy(() => import("./pages/Files"));
const StudyRooms  = lazy(() => import("./pages/StudyRooms"));
const Onboarding  = lazy(() => import("./pages/Onboarding"));
const Spaces      = lazy(() => import("./pages/Spaces"));

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
  /* Tabs mode on web (≥768px): BottomNav becomes a fixed left sidebar, so push
     the page content over to make room (232px rail / 64px collapsed — must match
     RAIL_W in BottomNav.tsx). Only applies in tabs mode (.nav-tabs). */
  @media (min-width: 768px) {
    .nav-tabs .app-page-transition {
      margin-left: 232px;
      transition: margin-left 0.2s var(--ease-apple);
    }
    .nav-tabs.nav-collapsed .app-page-transition {
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
  // ── /card route — standalone page, no auth required ─────────────────────
  if (window.location.pathname === "/card") {
    return <Suspense fallback={<PageLoader />}><Card /></Suspense>;
  }
  const { userId, setUserId, refreshUser, userData, saveCanvasCredentials, updateUserField, pendingNav, setPendingNav, tokenSummary, navMode } = useApp();

  const [isLoggedIn, setIsLoggedIn] = useState(
    () => Boolean(localStorage.getItem(LOGGED_IN_KEY))
  );
  const [showOnboarding,      setShowOnboarding]     = useState(false);
  const [onboardingEmail,     setOnboardingEmail]    = useState("");
  const [onboardingInitName,  setOnboardingInitName] = useState("");
  const [currentPage,         setCurrentPage]        = useState("work");
  const [visible,             setVisible]            = useState(true);
  const [navCollapsed,        setNavCollapsed]       = useState(false);

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
  const [resendSent,   setResendSent]   = useState(false);

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

  const swipeNavigate = useCallback((dir) => {
    const next = NAV[currentPage]?.[dir];
    if (next) navigate(next);
  }, [currentPage, navigate]);

  useEffect(() => {
    if (!pendingNav) return;
    navigate(pendingNav.page ?? pendingNav);
    setPendingNav(null);
  }, [pendingNav, navigate, setPendingNav]);

  const { onTouchStart, onTouchEnd } = useSwipe(swipeNavigate);

  // ── Auth ───────────────────────────────────────────────────────────────────
  const handleEnter = useCallback(async (creds: {
    mode?: string; email?: string; password?: string; name?: string;
  } = {}) => {
    const email = (creds.email || "").toLowerCase().trim();

    // ── Login — Supabase Auth (lazily migrates legacy SHA-256 accounts) ──────────
    if (creds.mode === "login") {
      const profile = await signIn(email, creds.password); // establishes a GoTrue session
      localStorage.setItem("fschool_uid", profile.id);
      localStorage.setItem(LOGGED_IN_KEY, "1");
      if (profile.name) localStorage.setItem("fschool_name", profile.name);
      window.location.reload();
      return;
    }

    // ── Signup — creates the GoTrue user + a fresh profile, then signs in ─────────
    // (The server mints a brand-new profile id, so signing up on a device already
    // logged into another account can't clobber it — the old "merge" bug.)
    localStorage.setItem("fschool_name", creds.name);
    const profile = await signUp({ name: creds.name, email, password: creds.password });
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

      {/* Premium password-reset card */}
      {(resetMode || resetDone) && (
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
            {!resetDone ? (
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

  if (!isLoggedIn) {
    return (<>{overlays}<Landing onEnter={handleEnter} /></>);
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
            <p style={{ fontSize:"14px", fontWeight:"600", color:"rgba(255,255,255,0.72)", marginBottom:"30px" }}>{userData.email}</p>
            <button
              onClick={() => refreshUser()}
              style={{ width:"100%", background:"#F5F5F5", color:"#111", border:"none", borderRadius:"13px", padding:"14px", fontSize:"15px", fontWeight:"650", cursor:"pointer", fontFamily:"inherit", marginBottom:"10px", transition:"opacity .15s" }}
            >
              I&apos;ve verified — continue &rarr;
            </button>
            <button
              onClick={resendVerification}
              disabled={resendSent}
              style={{ width:"100%", background:"transparent", color: resendSent ? "rgba(48,209,88,0.75)" : "rgba(255,255,255,0.4)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:"13px", padding:"13px", fontSize:"14px", fontWeight:"500", cursor: resendSent ? "default" : "pointer", fontFamily:"inherit", transition:"color .2s" }}
            >
              {resendSent ? "Verification email sent ✓" : "Resend verification email"}
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
    <div
      className={`app-shell${navMode === "tabs" ? " nav-tabs" : ""}${navCollapsed ? " nav-collapsed" : ""}`}
      onTouchStart={navMode === "tabs" ? undefined : onTouchStart}
      onTouchEnd={navMode === "tabs" ? undefined : onTouchEnd}
    >
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
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#C49A3C", display: "inline-block", flexShrink: 0 }} />
                    <span style={{ color: "#C49A3C", fontSize: "11px", fontWeight: "600", letterSpacing: "-0.1px" }}>
                      {tokenSummary.points}
                    </span>
                    <span style={{ color: "rgba(196,154,60,0.45)", fontSize: "10px", margin: "0 1px" }}>·</span>
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
                  color: unreadCount > 0 ? "#C49A3C" : "rgba(255,255,255,0.38)",
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
                        background: "#C49A3C", color: "#111",
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
          {navMode !== "tabs" && <PageDots currentPage={currentPage} />}
        </header>

        <main className="app-main">
          <Suspense fallback={<PageLoader />}>
            {PageComponent && <PageComponent />}
          </Suspense>
        </main>
      </div>

      <NeuralRing />
      {navMode === "tabs" && (
        <BottomNav
          currentPage={currentPage}
          onNavigate={navigate}
          collapsed={navCollapsed}
          onToggleCollapse={() => setNavCollapsed(v => !v)}
        />
      )}
    </div>
  );
}

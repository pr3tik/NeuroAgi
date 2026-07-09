// popup.js — NeuroAgi extension popup
// Handles auth and triggers page capture via background service worker.

const SUPABASE_URL  = "https://wqgxpouhbwhwpzudrptp.supabase.co";
const SUPABASE_ANON = "sb_publishable_e-3KMudaL-iXf5GGsuiQaA_VW21ZZFA";
const APP_ORIGIN    = "https://fschoolai.com"; // where /api/auth-migrate is deployed

// Write to the isolated `neuroagi` schema — the SAME schema the app reads from
// (src/supabase.js + every api/* route set schema = 'neuroagi'). Both sides MUST
// match or synced data (and login, which reads the users table) is invisible to
// the app. NOT public.* — that's Vincent's.
const SB_PROFILE = { "Accept-Profile": "public", "Content-Profile": "public" };

// ── Helpers ───────────────────────────────────────────────────────────────────
async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function sbFetch(path, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      "apikey": SUPABASE_ANON,
      "Authorization": `Bearer ${SUPABASE_ANON}`,
      "Content-Type": "application/json",
      "Prefer": "return=representation",
      ...SB_PROFILE,
      ...(opts.headers ?? {}),
    },
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(json?.message ?? json?.error ?? `Supabase ${res.status}`);
  return json;
}

function randomUUID() {
  return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
    (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
  );
}

// ── Screen helpers ────────────────────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  document.getElementById(id).classList.add("active");
}
function showError(id, msg) {
  const el = document.getElementById(id);
  el.textContent = msg; el.classList.add("visible");
}
function clearError(id) { document.getElementById(id).classList.remove("visible"); }

// ── Auth (Supabase Auth / GoTrue) ──────────────────────────────────────────────
// GoTrue password grant → { access_token, refresh_token, user }.
async function authToken(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method:  "POST",
    headers: { "apikey": SUPABASE_ANON, "Content-Type": "application/json" },
    body:    JSON.stringify({ email: email.toLowerCase().trim(), password }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) { const e = new Error(json?.error_description ?? json?.msg ?? "auth failed"); e.status = res.status; throw e; }
  return json;
}

async function login(email, password) {
  let tok;
  try {
    tok = await authToken(email, password);
  } catch {
    // Pre-Auth account → lazy-migrate its SHA-256 hash via the web endpoint, then retry.
    const res = await fetch(`${APP_ORIGIN}/api/auth-migrate?action=migrate`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ email: email.toLowerCase().trim(), password }),
    });
    if (!res.ok) throw new Error("Incorrect email or password");
    tok = await authToken(email, password);
  }
  // Resolve the profile (text id) by auth_id, authenticated with the user's JWT.
  const rows = await sbFetch(
    `users?auth_id=eq.${tok.user.id}&select=id,name,email`,
    { method: "GET", headers: { Authorization: `Bearer ${tok.access_token}` } }
  );
  if (!rows?.length) throw new Error("Incorrect email or password");
  return { ...rows[0], access_token: tok.access_token, refresh_token: tok.refresh_token };
}

async function signup(name, email, password) {
  // Server creates the GoTrue user (bcrypt) + public.users profile, returns its id.
  const res = await fetch(`${APP_ORIGIN}/api/auth-migrate?action=signup`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ name, email: email.toLowerCase().trim(), password }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "Could not create your account");
  const tok = await authToken(email, password);
  return { id: body.userId, name, email, access_token: tok.access_token, refresh_token: tok.refresh_token };
}

async function saveSession(user) { await chrome.storage.local.set({ neuroagi_user: user }); }
async function getSession()      { const { neuroagi_user } = await chrome.storage.local.get("neuroagi_user"); return neuroagi_user ?? null; }
async function clearSession()    { await chrome.storage.local.remove(["neuroagi_user", "neuroagi_captures", "neuroagi_stats", "neuroagi_captured_urls"]); }
// Switching accounts: wipe the previous user's captures/stats/dedupe map so they
// never bleed into (or get attributed to) the newly logged-in user.
async function switchToUser(user) {
  const prior = await getSession();
  if (prior && prior.id !== user.id) await clearSession();
  await saveSession(user);
}

// ── Capture screen state ──────────────────────────────────────────────────────
const STEPS = ["courses", "assignments", "grades"];

async function loadCaptureScreen(user) {
  showScreen("screen-capture");
  document.getElementById("user-initial").textContent   = (user.name?.[0] ?? "?").toUpperCase();
  document.getElementById("user-name-display").textContent  = user.name ?? "";
  document.getElementById("user-email-display").textContent = user.email ?? "";

  const { neuroagi_captures = [], neuroagi_stats = {} } = await chrome.storage.local.get(["neuroagi_captures","neuroagi_stats"]);
  renderSteps(neuroagi_captures);
  renderStats(neuroagi_stats);
}

function renderSteps(captures) {
  // Mark a step "done" only when a capture for THAT step actually exists — so we
  // never green-light a step whose data never synced (honest progress).
  const doneSteps = new Set(captures.map(c => c.step));
  STEPS.forEach((name, i) => {
    const el = document.getElementById(`step-${i}`);
    el.className = "step";
    if (doneSteps.has(name)) el.classList.add("done");
  });
  const firstPending = STEPS.findIndex(n => !doneSteps.has(n));
  if (firstPending >= 0) document.getElementById(`step-${firstPending}`).classList.add("active");

  const allDone = STEPS.every(n => doneSteps.has(n));
  document.getElementById("reset-btn").style.display = allDone ? "block" : "none";
  setStatus(
    allDone ? "All pages captured — data synced to NeuroAgi ✓" : "Navigate to the highlighted page on your portal, then click Capture",
    allDone
  );
}

function renderStats(stats) {
  document.getElementById("stat-courses").textContent     = stats.courses     ?? "—";
  document.getElementById("stat-assignments").textContent = stats.assignments ?? "—";
  document.getElementById("stat-grades").textContent      = stats.grades      ?? "—";
  const filesEl = document.getElementById("stat-files");
  if (filesEl) filesEl.textContent = stats.files ?? "—";
}

function setProcessing(visible, label = "Reading page…") {
  const row = document.getElementById("processing-row");
  row.classList.toggle("visible", visible);
  document.getElementById("processing-label").textContent = label;
  document.getElementById("capture-btn").disabled = visible;
  if (visible) document.getElementById("status-msg").classList.remove("success");
}

function setStatus(msg, success = false) {
  const el = document.getElementById("status-msg");
  el.textContent = msg;
  el.classList.toggle("success", success);
}

// ── Capture flow ──────────────────────────────────────────────────────────────
async function captureCurrentPage(user) {
  setProcessing(true, "Connecting to your portal…");
  try {
    // 1. Get current tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("No active tab");

    // ── PRIMARY: call the LMS's own API via the logged-in session ─────────────
    // Runs in the page's MAIN world so it can read window.ENV / M.cfg / D2L and
    // fetch with the session cookie. Complete + accurate + fast (no Claude, no
    // hidden tabs). Returns { lms:null } on Blackboard/unknown → we scrape instead.
    let api = null;
    try {
      const [inj] = await chrome.scripting.executeScript({
        target: { tabId: tab.id }, world: "MAIN", func: lmsApiSync,
      });
      api = inj?.result ?? null;
    } catch { /* injection blocked → fall through to scrape */ }

    if (api?.lms && (api.courses?.length || api.assignments?.length)) {
      const nCourses = api.courses?.length || 0;
      const nAssign  = api.assignments?.length || 0;
      const nGraded  = (api.courses || []).filter(c => c.current_score != null).length;
      console.log(`[NeuroAgi] ${api.lms} API → ${nCourses} courses, ${nAssign} assignments, ${nGraded} graded courses`);

      setProcessing(true, `Syncing ${nCourses} courses via ${api.lms}…`);
      const res = await chrome.runtime.sendMessage({ type: "NEUROAGI_API_INGEST", userId: user.id, data: api });
      if (!res?.ok) throw new Error(res?.error ?? "Sync failed");

      // Honest gating: only green-light a step that actually returned data.
      const caps = [{ step: "courses", auto: true, timestamp: Date.now() }];
      if (nAssign) caps.push({ step: "assignments", auto: true, timestamp: Date.now() });
      if (nGraded) caps.push({ step: "grades",      auto: true, timestamp: Date.now() });
      await chrome.storage.local.set({ neuroagi_captures: caps, neuroagi_stats: res.stats });
      renderSteps(caps);
      renderStats(res.stats);

      const missing = [];
      if (!nAssign) missing.push("assignments");
      if (!nGraded) missing.push("grades");
      setStatus(
        missing.length
          ? `${api.lms.toUpperCase()}: ${res.counts.courses} courses synced, but no ${missing.join(" or ")} found — open the page's console (F12) and send the logs.`
          : `Synced ✓ — ${res.counts.courses} courses, ${res.counts.assignments} assignments, ${res.counts.grades} grades (${api.lms} API)`,
        !missing.length
      );
      return;
    }

    // ── FALLBACK: scrape the page + Claude (works on any portal) ───────────────
    setProcessing(true, "Reading page content…");
    const [{ result: pageContent }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractPageContent,
    });

    if (!pageContent?.text) throw new Error("Could not read page content");

    setProcessing(true, "Extracting academic data…");

    // 3. Send to background — Claude parses it
    const { neuroagi_captures = [] } = await chrome.storage.local.get("neuroagi_captures");
    const stepIndex = Math.min(neuroagi_captures.length, STEPS.length - 1);
    const stepHint  = STEPS[stepIndex]; // "courses" | "assignments" | "grades"

    const result = await chrome.runtime.sendMessage({
      type:     "NEUROAGI_EXTRACT",
      userId:   user.id,
      pageContent,
      stepHint,
    });

    if (!result?.ok) throw new Error(result?.error ?? "Extraction failed");

    // 4. Save capture record and update stats
    const updatedCaptures = [...neuroagi_captures, { step: stepHint, url: tab.url, timestamp: Date.now() }];
    let stats = result.stats;
    await chrome.storage.local.set({ neuroagi_captures: updatedCaptures, neuroagi_stats: stats });

    renderSteps(updatedCaptures);
    renderStats(stats);
    setStatus(result.message ?? "Captured ✓", true);

    // 5. Auto-crawl: the background worker DISCOVERS each course's assignments +
    //    grades pages from the page's real links (works on any portal) and learns
    //    the pattern per domain. Runs after any "courses" capture.
    if (stepHint === "courses") {
      setProcessing(true, `Discovering your courses & syncing grades…`);
      setStatus("Auto-syncing your courses — this may take a minute…");

      const crawl = await chrome.runtime.sendMessage({
        type:        "NEUROAGI_AUTOCRAWL",
        userId:      user.id,
        pageContent,  // includes links → worker discovers + learns the portal layout
        originTabId: tab.id,
      });

      if (crawl?.ok) {
        const allCaptures = [
          ...updatedCaptures,
          { step: "assignments", auto: true, timestamp: Date.now() },
          { step: "grades",      auto: true, timestamp: Date.now() },
        ];
        const finalStats = await chrome.runtime.sendMessage({
          type: "NEUROAGI_STATS", userId: user.id,
        }).then(r => r?.stats ?? stats).catch(() => stats);

        await chrome.storage.local.set({ neuroagi_captures: allCaptures, neuroagi_stats: finalStats });
        renderSteps(allCaptures);
        renderStats(finalStats);
        setStatus(`All done ✓ — ${crawl.totalAssignments ?? 0} assignments, ${crawl.totalGrades ?? 0} grades synced`, true);
      } else {
        setStatus("Courses synced. Visit a grades/assignments page and click Capture to add more.", true);
      }
    }

  } catch (err) {
    setStatus(`Error: ${err.message}`);
  } finally {
    setProcessing(false);
  }
}

// lmsApiSync() and extractPageContent() are defined in ../shared-sync.js
// (loaded before this script in popup.html), shared with the background worker.
// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  // Stamp the version (pulled from manifest) on every screen so a reload is verifiable.
  const ver = `v${chrome.runtime.getManifest().version}`;
  ["app-version-login", "app-version-signup", "app-version-capture"]
    .forEach(id => { const el = document.getElementById(id); if (el) el.textContent = ver; });

  const user = await getSession();
  user ? await loadCaptureScreen(user) : showScreen("screen-login");

  // Navigation
  document.getElementById("go-signup").addEventListener("click", () => { clearError("signup-error"); showScreen("screen-signup"); });
  document.getElementById("go-login").addEventListener("click",  () => { clearError("login-error");  showScreen("screen-login");  });

  // Login
  document.getElementById("login-btn").addEventListener("click", async () => {
    clearError("login-error");
    const email = document.getElementById("login-email").value.trim();
    const pass  = document.getElementById("login-password").value;
    if (!email || !pass) return showError("login-error", "Please fill in all fields");
    const btn = document.getElementById("login-btn");
    btn.disabled = true; btn.textContent = "Logging in…";
    try {
      const user = await login(email, pass);
      await switchToUser(user);
      await loadCaptureScreen(user);
    } catch (err) {
      showError("login-error", err.message);
    } finally { btn.disabled = false; btn.textContent = "Log In"; }
  });

  // Signup
  document.getElementById("signup-btn").addEventListener("click", async () => {
    clearError("signup-error");
    const name  = document.getElementById("signup-name").value.trim();
    const email = document.getElementById("signup-email").value.trim();
    const pass  = document.getElementById("signup-password").value;
    if (!name || !email || !pass) return showError("signup-error", "Please fill in all fields");
    if (pass.length < 6) return showError("signup-error", "Password must be at least 6 characters");
    const btn = document.getElementById("signup-btn");
    btn.disabled = true; btn.textContent = "Creating account…";
    try {
      const user = await signup(name, email, pass);
      await switchToUser(user);
      await loadCaptureScreen(user);
    } catch (err) {
      showError("signup-error", err.message.includes("duplicate") ? "Email already registered" : err.message);
    } finally { btn.disabled = false; btn.textContent = "Create Account"; }
  });

  // Capture
  document.getElementById("capture-btn").addEventListener("click", async () => {
    const user = await getSession();
    if (user) captureCurrentPage(user);
  });

  // Reset
  document.getElementById("reset-btn").addEventListener("click", async () => {
    await chrome.storage.local.remove(["neuroagi_captures","neuroagi_stats"]);
    const user = await getSession();
    if (user) await loadCaptureScreen(user);
  });

  // Logout
  document.getElementById("logout-btn").addEventListener("click", async () => {
    await clearSession(); showScreen("screen-login");
  });

  // Enter key
  document.getElementById("login-password").addEventListener("keydown",  e => { if (e.key==="Enter") document.getElementById("login-btn").click(); });
  document.getElementById("signup-password").addEventListener("keydown", e => { if (e.key==="Enter") document.getElementById("signup-btn").click(); });
}

init();

// Live-update the popup whenever storage changes (auto-capture from content script)
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.neuroagi_captures || changes.neuroagi_stats) {
    const captures = changes.neuroagi_captures?.newValue ?? [];
    const stats    = changes.neuroagi_stats?.newValue    ?? {};
    renderSteps(captures);
    renderStats(stats);
    // Show a brief "auto-synced" message
    if (changes.neuroagi_captures?.newValue?.length > (changes.neuroagi_captures?.oldValue?.length ?? 0)) {
      setStatus("Auto-captured ✓ — browse to the next page", true);
    }
  }
});

// popup.js — FschoolAI extension popup controller
//
// Self-contained email/password login (no dependency on being logged into the web
// app). Authenticates against Supabase GoTrue, resolves the caller's public.users.id
// (the userId the ingest pipeline keys on), and stores { userId, token, expiresAt }
// via the background worker. Falls back to /api/auth-migrate for pre-Auth accounts.

// Dev vs prod: change to "http://localhost:5173" for local testing
const FSCHOOLAI_URL = "https://fschoolai.com";
const APP_ORIGIN    = FSCHOOLAI_URL;                              // /api/auth-migrate lives here
const SUPABASE_URL  = "https://wqgxpouhbwhwpzudrptp.supabase.co";
const SUPABASE_ANON = "sb_publishable_e-3KMudaL-iXf5GGsuiQaA_VW21ZZFA";
const SB_PROFILE    = { "Accept-Profile": "public", "Content-Profile": "public" };
const SESSION_MS    = 30 * 24 * 60 * 60 * 1000;                  // extension-side session length

const $ = id => document.getElementById(id);

let inFlight = false;   // guards submit() against double-fire (Enter + click, key auto-repeat)

// Live-activity view state (kept so a settings toggle can re-render the idle label
// without another round-trip, and storage.onChanged can patch either half).
let currentAutoCapture = true;
let lastLive  = null;
let lastStats = {};
let signedIn  = false;   // gates the live storage.onChanged listener (signed-in UI only)

// ── Auth ──────────────────────────────────────────────────────────────────────
// GoTrue password grant → { access_token, refresh_token, user }.
async function authToken(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method:  "POST",
    headers: { apikey: SUPABASE_ANON, "Content-Type": "application/json" },
    body:    JSON.stringify({ email: email.toLowerCase().trim(), password }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const e = new Error(json?.error_description ?? json?.msg ?? "auth failed");
    e.status = res.status;
    throw e;
  }
  return json;
}

// Resolve the public.users row for this GoTrue session (via auth_id). Uses the real
// session JWT as the bearer, so it works even with RLS on and returns only the caller's row.
async function profileForToken(tok) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/users?auth_id=eq.${tok.user.id}&select=id,name,email`,
    { headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${tok.access_token}`, ...SB_PROFILE } },
  );
  const rows = await res.json().catch(() => []);
  if (!res.ok || !rows?.length) throw new Error("Signed in, but no matching FschoolAI profile");
  return rows[0];
}

async function login(email, password) {
  let tok;
  try {
    tok = await authToken(email, password);
  } catch (e) {
    // Only a real credential rejection (GoTrue 400) means "maybe a pre-Auth account → migrate".
    // Rate-limits / server errors / network failures must NOT be shown as "wrong password".
    if (e && e.status && e.status !== 400)
      throw new Error(e.status === 429 ? "Too many attempts. Wait a moment and try again." : "Something went wrong. Please try again.");
    if (e && !e.status) throw new Error("Network error. Check your connection and try again.");
    // Pre-Auth account → lazy-migrate its SHA-256 hash via the web endpoint, then retry.
    const res = await fetch(`${APP_ORIGIN}/api/auth-migrate?action=migrate`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ email: email.toLowerCase().trim(), password }),
    });
    if (!res.ok) throw new Error("Incorrect email or password");
    tok = await authToken(email, password);
  }
  const profile = await profileForToken(tok);
  return { userId: profile.id, token: tok.access_token, expiresAt: Date.now() + SESSION_MS };
}

async function signup(name, email, password) {
  const res = await fetch(`${APP_ORIGIN}/api/auth-migrate?action=signup`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ name, email: email.toLowerCase().trim(), password }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error ?? "Sign-up failed");
  // The account IS created now. Grab a token if we can, but userId is what the pipeline
  // needs (token is presence-only), so don't fail a successful signup on a flaky token grant.
  let userId = body.userId ?? null;
  let token = "ext-session";
  try {
    const tok = await authToken(email, password);
    token = tok.access_token;
    userId = userId ?? (await profileForToken(tok)).id;
  } catch { /* account exists; keep the presence-marker token */ }
  if (!userId) throw new Error("Account created — please log in.");
  return { userId, token, expiresAt: Date.now() + SESSION_MS };
}

// Hand the session to the background worker (writes chrome.storage.local).
function storeSession({ userId, token, expiresAt }) {
  return new Promise(resolve =>
    chrome.runtime.sendMessage({ type: "SIGN_IN", payload: { userId, token, expiresAt } }, resolve));
}

function showError(msg) {
  const el = $("auth-error");
  if (!el) return;
  el.textContent = msg || "";
  el.style.display = msg ? "block" : "none";
}

// ── UI ──────────────────────────────────────────────────────────────────────
function getAuth() {
  return new Promise(resolve => chrome.runtime.sendMessage({ type: "GET_AUTH_STATUS" }, resolve));
}

// Stamp the running version so it's obvious whether a reload actually took effect.
try {
  const v = chrome.runtime.getManifest?.().version;
  const hs = $("header-sub");
  if (hs && v) hs.textContent = `LMS File Importer · v${v}`;
} catch {}

async function init() {
  const auth = await getAuth();
  signedIn = !!auth?.signedIn;
  $("status-section").style.display     = signedIn ? "block" : "none";
  $("signed-out-section").style.display = signedIn ? "none"  : "block";
  if (signedIn) {
    $("uid-label").textContent = `User: ${auth.userId?.slice(0, 20)}…`;
    renderPending();
    // One round-trip: live activity + settings + all-time stats. This also wakes
    // the SW so a stale "scanning" mirror self-heals to the true (idle) state.
    chrome.runtime.sendMessage({ type: "GET_STATUS" }, (res) => {
      if (chrome.runtime.lastError || !res) return;
      currentAutoCapture = !!res.settings?.autoCapture;
      const ac = $("toggle-auto-capture"), ad = $("toggle-auto-downloads");
      if (ac) ac.checked = !!res.settings?.autoCapture;
      if (ad) ad.checked = !!res.settings?.autoImportDownloads;
      lastLive = res; lastStats = res.stats ?? {};
      renderLive(lastLive, lastStats);
      // Reflect a background sync's state/result even if the popup was closed during it.
      const sm = $("sync-msg");
      if (sm) {
        if (res.fullSync) sm.textContent = "Syncing your courses in the background… (keep the LMS tab open)";
        else chrome.storage.local.get(["lastSyncMsg"], ({ lastSyncMsg }) => {
          if (lastSyncMsg?.text && !res.fullSync) sm.textContent = lastSyncMsg.text;
        });
      }
    });
  }
}

// ── Live activity rendering ────────────────────────────────────────────────
const ACT_ICON = { done: "✓", skipped: "↷", failed: "✗" };

function renderRecent(items) {
  const box = $("live-recent");
  if (!box) return;
  box.innerHTML = "";
  (items ?? []).slice(0, 6).forEach((it) => {
    const row = document.createElement("div");
    row.className = "live-item " + (it.status || "done");
    const ic = document.createElement("span");
    ic.className = "ic";
    ic.textContent = ACT_ICON[it.status] ?? "•";
    const nm = document.createElement("span");
    nm.className = "nm";
    nm.textContent = it.name || "file";
    nm.title = it.error ? `${it.name}\n${it.error}` : (it.name || "");
    row.append(ic, nm);
    // Show WHY a file failed, so problems are diagnosable without the console.
    if (it.status === "failed" && it.error) {
      const err = document.createElement("span");
      err.className = "err";
      err.textContent = String(it.error);
      err.title = String(it.error);
      row.appendChild(err);
    }
    box.appendChild(row);
  });
}

function renderLive(live, stats) {
  if (!live) return;
  const scanning = !!live.scanning;
  const busy = scanning || !!live.fullSync;   // full course sync also = "working"
  const dot = $("live-dot"), title = $("live-title"), spin = $("live-spinner");
  if (dot)  dot.className = "live-dot " + (busy ? "scanning" : "idle");
  if (spin) spin.style.display = busy ? "inline-block" : "none";
  if (title) {
    title.textContent = live.fullSync
      ? (live.activeFile ? `Syncing courses — ${live.activeFile}…` : "Syncing all your courses…")
      : scanning
      ? (live.activeFile ? `Importing ${live.activeFile}…`
         : live.queueDepth > 1 ? `Importing ${live.queueDepth} files…`
         : "Scanning…")
      : (currentAutoCapture ? "Watching for course files" : "Auto-capture is off");
  }
  if ($("live-session")) $("live-session").textContent = String(live.sessionImported ?? 0);
  const total = stats?.autoImported ?? 0;
  if ($("live-total")) $("live-total").textContent = total ? `${total} all-time` : "";
  renderRecent(live.recent);
}

function refreshLive() { if (lastLive) renderLive(lastLive, lastStats); }

$("toggle-auto-capture")?.addEventListener("change", (e) => {
  currentAutoCapture = e.target.checked;
  chrome.runtime.sendMessage({ type: "SET_SETTINGS", payload: { autoCapture: e.target.checked } });
  refreshLive();   // idle label reflects the toggle immediately
});
$("toggle-auto-downloads")?.addEventListener("change", (e) => {
  chrome.runtime.sendMessage({ type: "SET_SETTINGS", payload: { autoImportDownloads: e.target.checked } });
});

function renderPending() {
  chrome.storage.local.get(["pendingDownloads"], ({ pendingDownloads = [] }) => {
    const sec = $("pending-section");
    if (!pendingDownloads.length) { if (sec) sec.style.display = "none"; return; }
    if (sec) sec.style.display = "block";
    const list = $("pending-list");
    list.innerHTML = "";
    pendingDownloads.forEach(d => {
      const name = d.filename?.split(/[/\\]/).pop() ?? "file";
      const item = document.createElement("div");
      item.className = "pending-item";
      const span = document.createElement("span");
      span.className = "pending-name";
      span.title = name;
      span.textContent = name;
      const btn = document.createElement("button");
      btn.className = "pending-btn";
      btn.textContent = "Import";
      btn.addEventListener("click", async () => {
        btn.textContent = "…"; btn.disabled = true;
        // fetchUrl → the background re-downloads the file itself (with session
        // cookies); the popup never has the bytes for a completed download.
        const res = await chrome.runtime.sendMessage({
          type: "IMPORT_FILE",
          payload: { url: d.url, fetchUrl: d.url, filename: name, pageUrl: d.referrer ?? d.url, platform: "download" },
        });
        btn.textContent = res?.ok ? "✓" : "Err";
        btn.title = res?.error ?? "";
      });
      item.append(span, btn);
      list.appendChild(item);
    });
  });
}

async function submit(kind) {
  if (inFlight) return;
  showError("");
  const btnId = kind === "login" ? "btn-login" : "btn-signup";
  const btn = $(btnId);
  const original = btn.textContent;
  inFlight = true;
  try {
    let session;
    if (kind === "login") {
      const email = $("login-email").value.trim();
      const password = $("login-password").value;
      if (!email || !password) return showError("Enter your email and password.");
      btn.disabled = true; btn.textContent = "Logging in…";
      session = await login(email, password);
    } else {
      const name = $("signup-name").value.trim();
      const email = $("signup-email").value.trim();
      const password = $("signup-password").value;
      if (!name || !email || !password) return showError("Fill in every field.");
      if (password.length < 6) return showError("Password must be at least 6 characters.");
      btn.disabled = true; btn.textContent = "Creating…";
      session = await signup(name, email, password);
    }
    await storeSession(session);
    await init();
  } catch (e) {
    showError(e?.message ?? (kind === "login" ? "Login failed" : "Sign-up failed"));
  } finally {
    inFlight = false;
    btn.disabled = false; btn.textContent = original;
  }
}

// ── Wiring ────────────────────────────────────────────────────────────────────
$("show-signup")?.addEventListener("click", () => { showError(""); $("login-form").style.display = "none"; $("signup-form").style.display = "block"; });
$("show-login") ?.addEventListener("click", () => { showError(""); $("signup-form").style.display = "none"; $("login-form").style.display = "block"; });

$("btn-login") ?.addEventListener("click", () => submit("login"));
$("btn-signup")?.addEventListener("click", () => submit("signup"));

// Enter-to-submit
$("login-password") ?.addEventListener("keydown", e => { if (e.key === "Enter") submit("login"); });
$("signup-password")?.addEventListener("keydown", e => { if (e.key === "Enter") submit("signup"); });

$("btn-sync-now")?.addEventListener("click", () => {
  const btn = $("btn-sync-now"), orig = btn.textContent, msg = $("sync-msg");
  btn.disabled = true; btn.textContent = "Syncing…";
  // The sync runs in the background worker — the popup can close and it keeps going.
  if (msg) msg.textContent = "Syncing… you can close this and keep browsing (just leave the LMS tab open).";
  chrome.runtime.sendMessage({ type: "FORCE_SYNC" }, (res) => {
    btn.disabled = false; btn.textContent = orig;
    // Only overwrite the message if the popup is still open to receive the result.
    if (msg && !chrome.runtime.lastError && res?.message) msg.textContent = res.message;
  });
});

$("btn-open-app")?.addEventListener("click", () => { chrome.tabs.create({ url: FSCHOOLAI_URL }); window.close(); });
$("btn-sign-out")?.addEventListener("click", async () => {
  await new Promise(resolve => chrome.runtime.sendMessage({ type: "SIGN_OUT" }, resolve));
  init();
});

$("btn-clear-pending")?.addEventListener("click", () => {
  // Background clears both the list and the badge (chrome.action isn't reliably
  // available in the popup context).
  chrome.runtime.sendMessage({ type: "CLEAR_PENDING" }, () => {
    if ($("pending-section")) $("pending-section").style.display = "none";
  });
});

// Live updates while the popup is open: the SW mirrors its queue/activity into
// storage.liveState and its running totals into storage.stats — patch whichever
// changed. pendingDownloads updates as downloads are captured/imported.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  // The pending panel + live card are signed-in-only UI (the pending list is a
  // body-level sibling of the login form, so a download completing while signed
  // out would otherwise surface it under the login screen).
  if (!signedIn) return;
  if (changes.liveState?.newValue) { lastLive  = changes.liveState.newValue; renderLive(lastLive, lastStats); }
  if (changes.stats?.newValue)     { lastStats = changes.stats.newValue;     renderLive(lastLive, lastStats); }
  if (changes.pendingDownloads)    renderPending();
});

init();

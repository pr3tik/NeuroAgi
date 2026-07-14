// content.js — Injected into every page to detect file links and inject "Import" buttons.
// Regular files: fetched here using live session cookies (credentials: "include").
// Cloud storage public links (Google Drive/Docs, Dropbox, OneDrive, SharePoint, Box):
// routed to background.js (bypasses CORS restriction).

(function () {
  "use strict";

  // Frame/protocol guards: only http(s) documents with a real host (all_frames
  // injects into iframes — LMS render file lists inside them — but never
  // about:blank, srcdoc, or extension pages).
  if (!/^https?:$/.test(location.protocol) || !location.hostname) return;

  // Never inject on search engines, social media, or the cloud providers' own pages.
  // drive.google.com, docs.google.com, dropbox.com, 1drv.ms, onedrive.live.com, box.com are
  // excluded here only as a page-to-inject-on check — we still catch links TO them from other
  // pages. sharepoint.com is NOT skipped: it's often used as the LMS/course portal itself.
  const SKIP_DOMAINS = /^(www\.)?(search\.brave\.com|google\.com|drive\.google\.com|docs\.google\.com|dropbox\.com|1drv\.ms|onedrive\.live\.com|app\.box\.com|bing\.com|duckduckgo\.com|yahoo\.com|search\.yahoo\.com|yandex\.(com|ru)|baidu\.com|reddit\.com|twitter\.com|x\.com|facebook\.com|instagram\.com|tiktok\.com|youtube\.com|linkedin\.com|github\.com|stackoverflow\.com|amazon\.com|wikipedia\.org|news\.ycombinator\.com)$/i;
  if (SKIP_DOMAINS.test(location.hostname)) return;

  // File extensions we can import
  const IMPORTABLE_EXT = /\.(pdf|docx?|pptx?|xlsx?|txt|csv|mp4|mp3|wav|ogg|m4a|jpg|jpeg|png|gif|webp)(\?|#|$)/i;

  // Cloud storage public/shared link patterns — these must be fetched from the background
  // worker (CORS bypass), not here. Covers Google Drive/Docs, Dropbox, OneDrive, SharePoint, Box.
  const CLOUD_STORAGE_RE = /drive\.google\.com\/(file\/d\/|open\?|uc\?)|docs\.google\.com\/(document|presentation|spreadsheets)\/d\/|dropbox\.com\/s\/|dropbox\.com\/scl\/fi\/|1drv\.ms\/|onedrive\.live\.com\/|[\w-]+\.sharepoint\.com\/|app\.box\.com\/s\//i;

  // Platform tag for metadata only
  function detectPlatform(hostname) {
    if (/chaoxing\.com/.test(hostname))      return "chaoxing";
    if (/zhihuishu\.com/.test(hostname))     return "zhihuishu";
    if (/pronote\.net/.test(hostname))       return "pronote";
    if (/brightspace\.com/.test(hostname))   return "brightspace";
    if (/blackboard\.com/.test(hostname))    return "blackboard";
    if (/instructure\.com/.test(hostname))   return "canvas";
    if (/desire2learn\.com/.test(hostname))  return "d2l";
    if (/moodle/.test(hostname))             return "moodle";
    if (/google\.com/.test(hostname))        return "google";
    if (/microsoft\.com|sharepoint\.com|teams\.microsoft\.com/.test(hostname)) return "microsoft";
    return "web";
  }

  const platform = detectPlatform(location.hostname);

  // ── LMS detection (gates auto-capture — buttons appear everywhere) ─────────
  // Universities often self-host (canvas.uoft.ca has no "instructure" in it), so a
  // hostname match alone misses the most common case. Combine: known platform,
  // LMS-ish URL paths, and LMS-specific DOM markers.
  function looksLikeLms() {
    if (platform !== "web" && platform !== "google" && platform !== "microsoft") return true;
    const path = location.pathname.toLowerCase();
    if (/\/(courses?|course)\/\d+|\/mod\/|\/d2l\/|\/webapps\/|\/ultra\/|\/pluginfile\.php|\/portal\/|\/learn\//.test(path)) return true;
    if (/^(canvas|lms|moodle|elearning|learn|bb|brightspace|classes|courseware)\./i.test(location.hostname)) return true;
    try {
      if (document.querySelector("#application.ic-app, .ic-app, [class*='d2l-'], body[class*='moodle'], #page-mymoodle, meta[name='generator'][content*='Moodle'], #globalNavBar, .bb-offcanvas-panel")) return true;
    } catch { /* DOM not ready */ }
    return false;
  }

  // Google Classroom is excluded from the GENERIC auto-capture/full-sync paths
  // (its DOM has no file hrefs those paths could use) — it has its own dedicated
  // route-based capture below (scheduleClassroomCapture), which covers schools
  // whose admin blocks the Classroom API for the server-side OAuth sync.
  const AUTO_EXCLUDED_HOSTS = /classroom\.google\.com$/i;

  // Auto-capture imports DOCUMENT types only (media is large + often not study
  // material); the manual button still covers everything.
  const AUTO_EXT = /\.(pdf|docx?|pptx?|xlsx?|txt|csv)(\?|#|$)/i;
  const AUTO_URL_HINTS = /\/files\/download|[?&]download=1|\/pluginfile\.php\//i;
  // Per SPA route (reset on URL change — Canvas/D2L navigate without reloads, and a
  // fixed per-page-load budget would starve the second course you open). A course
  // page with more files than this gets the rest on the next visit (dedup is cheap).
  const AUTO_BUDGET = window === window.top ? 25 : 8;
  let autoSent = 0;
  let autoRouteHref = location.href;
  const autoSeen = new Set();

  function resetAutoBudgetOnRouteChange() {
    if (location.href === autoRouteHref) return;
    autoRouteHref = location.href;
    autoSent = 0;                      // new route, fresh budget (autoSeen still dedups)
  }

  // ── Viewer/launcher link rules (research-backed, per-platform) ─────────────
  // Many LMSs never link the file itself: they link a VIEWER page with no
  // extension (D2L "viewContent/{id}/View", Canvas "/files/{id}?wrap=1", Moodle
  // "mod/resource/view.php?id="). Each rule recognises one such shape and either
  // rewrites it to the platform's direct-download URL or tags it with a
  // resolveHint so the background can follow redirects / parse the wrapper.
  // Most shapes are unique enough to self-gate; Canvas "/files/{id}" is generic,
  // so it's gated on a Canvas DOM marker. Non-file matches (a D2L Link topic, a
  // Canvas Page item) resolve to HTML and are rejected server-side — the
  // failure backoff stops eternal retries.
  // NOT handled here (verified js-only — files are minted by XHR, no anchor
  // hrefs exist): Blackboard Ultra, Google Classroom, Teams/SharePoint file
  // grids, new Google Sites, Chaoxing, Zhihuishu, Pronote, Docebo, TalentLMS,
  // Absorb, Frog. Those are covered only by the download interceptor.

  // Memoized (5s): viewerRuleFor runs per anchor per scan — a querySelector per
  // call would mean thousands of DOM queries per tick on big pages.
  let canvasCheck = { t: 0, v: false };
  function isCanvasPage() {
    if (platform === "canvas") return true;
    const now = Date.now();
    if (now - canvasCheck.t < 5000) return canvasCheck.v;
    let v = false;
    try {
      v = !!document.querySelector("body.ic-app, #application.ic-app, #wrapper.ic-Layout-wrapper");
    } catch { /* DOM not ready */ }
    canvasCheck = { t: now, v };
    return v;
  }

  // Returns { url, hint } (url = canonical fetch/dedup URL) or null.
  function viewerRuleFor(href) {
    let m;

    // ── D2L Brightspace ──────────────────────────────────────────────────
    // Direct file-topic download (some skins emit it directly).
    if (/\/d2l\/le\/content\/\d+\/topics\/files\/download\/\d+\/DirectFileTopicDownload/i.test(href))
      return { url: href, hint: null };
    // Topic viewer → deterministic rewrite to DirectFileTopicDownload.
    // Non-file topics (Link/HTML/SCORM) return HTML there and get rejected.
    m = href.match(/^(https?:\/\/[^/]+)\/d2l\/le\/content\/(\d+)\/viewContent\/(\d+)\/View(?:$|[?#])/i);
    if (m) return { url: `${m[1]}/d2l/le/content/${m[2]}/topics/files/download/${m[3]}/DirectFileTopicDownload`, hint: null };

    // ── Canvas (gated: "/files/{id}" alone is too generic) ───────────────
    if (isCanvasPage()) {
      // File link (course-, user-, group-scoped or bare, ± /preview|/download).
      // download_frd=1 forces raw bytes instead of the HTML preview page.
      m = href.match(/^(https?:\/\/[^/]+)(?:\/(?:courses|users|groups)\/\d+)?\/files\/(\d+)(?:\/(?:preview|download))?(?:$|[?#])/);
      if (m) return { url: `${m[1]}/files/${m[2]}/download?download_frd=1`, hint: null };
      // Module item — File/Page/Quiz/... not distinguishable from the URL; the
      // background follows the redirect and only proceeds if it lands on /files/.
      // Auto-capture only (no button): most module items are not files.
      m = href.match(/^https?:\/\/[^/]+\/courses\/\d+\/modules\/items\/\d+(?:$|[?#])/);
      if (m) return { url: href, hint: "canvas-module-item" };
    }

    // ── Moodle family (Moodle / Open LMS / MoodleCloud / Totara) ─────────
    // Resource launcher 302s to /pluginfile.php in the common display modes;
    // embed-mode returns HTML wrapping the pluginfile link (background parses).
    // /mod/url|page|forum|book|folder/ don't match — inherently excluded.
    if (/\/mod\/resource\/view\.php\?(?:[^#]*&)?id=\d+/i.test(href))
      return { url: href, hint: "moodle-resource" };

    // ── Blackboard Original ──────────────────────────────────────────────
    // WebDAV file (dt-content-rid marks a real file; bare /bbcswebdav/ dirs don't match).
    if (/\/bbcswebdav\/pid-\d+-dt-content-rid-[\w.%-]+/i.test(href))
      return { url: href, hint: null };
    // Content-file launcher — 302s to the bbcswebdav file with session cookies.
    if (/\/webapps\/blackboard\/execute\/content\/file\?[^#]*\bcontent_id=_\d+_\d+/i.test(href))
      return { url: href, hint: null };

    // ── Sakai — the access servlet streams the file directly ─────────────
    if (/\/access\/content\/(?:group|user|public|attachment)\/[^?#]+\.[a-z0-9]{2,8}(?:$|\?)/i.test(href))
      return { url: href, hint: null };

    // ── itslearning — fs_folderfile streams bytes (may 302 to a CDN) ─────
    if (/\/File\/fs_folderfile\.aspx\?FolderFileID=\d+/i.test(href))
      return { url: href, hint: null };

    // ── Firefly (hostname-gated: resource.aspx?id= is a generic shape) ───
    if (/\.fireflycloud\.net$/i.test(location.hostname) && /\/resource\.aspx\?id=\d+/i.test(href))
      return { url: href, hint: null };

    return null;
  }

  // Shadow-DOM-aware anchor collection. Modern D2L renders content lists inside
  // open d2l-* web components where document.querySelectorAll can't see them.
  // The full-tree walk is gated to pages that actually need it.
  // Memoized: sticky once detected (a D2L page doesn't stop being one); while
  // false, re-probed at most every 30s so ordinary websites pay ~nothing.
  let shadowWalkCheck = { t: 0, v: false };
  function needsShadowWalk() {
    if (shadowWalkCheck.v) return true;
    const now = Date.now();
    if (now - shadowWalkCheck.t < 30_000) return false;
    let v = false;
    try {
      v = /\/d2l\//.test(location.pathname) || !!document.querySelector("[class*='d2l-'],d2l-navigation");
    } catch { /* DOM not ready */ }
    shadowWalkCheck = { t: now, v };
    return v;
  }

  // One tree walk serves a whole scan cycle (button pass at t=0, auto-collect at
  // t+2.5s) — the 3s TTL covers both without walking twice.
  let anchorCache = { t: 0, anchors: null };
  function collectAllAnchors() {
    const now = Date.now();
    if (anchorCache.anchors && now - anchorCache.t < 3000) return anchorCache.anchors;
    const out = [];
    document.querySelectorAll("a[href]").forEach((a) => out.push(a));
    if (needsShadowWalk()) {
      const walk = (root) => {
        root.querySelectorAll("a[href]").forEach((a) => out.push(a));
        root.querySelectorAll("*").forEach((el) => { if (el.shadowRoot) walk(el.shadowRoot); });
      };
      try {
        document.querySelectorAll("*").forEach((el) => { if (el.shadowRoot) walk(el.shadowRoot); });
      } catch { /* never break the host page */ }
    }
    anchorCache = { t: now, anchors: out };
    return out;
  }

  // Collect up to `limit` candidates. Anchors are only marked seen when actually
  // RETURNED — marking beyond-budget matches would silently drop them for the
  // rest of the session (the next scan/route retries them instead).
  function collectAutoCandidates(limit) {
    const out = [];
    if (limit <= 0) return out;
    const anchors = collectAllAnchors();
    // Pass A: direct file links (extension in URL / download hints) — certain, cheap.
    for (const a of anchors) {
      if (out.length >= limit) return out;
      const href = a.href;
      if (!href || autoSeen.has(href)) continue;
      if (!(AUTO_EXT.test(href) || (AUTO_URL_HINTS.test(href) && !/logout|login/i.test(href)))) continue;
      autoSeen.add(href);
      out.push({ url: href, filename: guessFilename(href, a.textContent) });
    }
    // Pass B: platform viewer/launcher links — need background resolution.
    for (const a of anchors) {
      if (out.length >= limit) return out;
      const href = a.href;
      if (!href || autoSeen.has(href)) continue;
      const rule = viewerRuleFor(href);
      if (!rule) continue;
      autoSeen.add(href);
      out.push({ url: rule.url, filename: guessFilename(href, a.textContent), resolveHint: rule.hint ?? undefined });
    }
    return out;
  }

  // ── LMS context for the service worker ─────────────────────────────────────
  // The SW does ALL authenticated fetching (enumerate + download): its
  // credentials:"include" fetch sends the LMS session cookies AND can read the
  // cross-origin inst-fs CDN that Canvas redirects to — a content-script/page
  // fetch can do neither (CORS-blocked on that CDN hop). The page's only job is
  // to hand the SW the two things it cannot read for itself: which LMS this is,
  // and the page-scoped tokens (D2L's XSRF token in localStorage, Moodle's
  // sesskey in the DOM). Canvas needs no token — the cookie authorizes.
  function getLmsContext() {
    let xsrf = "";
    try { xsrf = localStorage.getItem("XSRF.Token") || ""; } catch { /* storage blocked */ }
    let sesskey = "";
    try {
      const a = document.querySelector('a[href*="sesskey="]');
      if (a) { try { sesskey = new URL(a.href).searchParams.get("sesskey") || ""; } catch {} }
      if (!sesskey) { const inp = document.querySelector('input[name="sesskey"]'); if (inp) sesskey = inp.value || ""; }
    } catch { /* DOM not ready */ }
    let lms = null;
    try {
      if (document.querySelector("body.ic-app, #application.ic-app, #wrapper.ic-Layout-wrapper")) lms = "canvas";
      else if (location.pathname.startsWith("/d2l/") || document.querySelector("d2l-navigation, #d2l_body") || (xsrf && /(^|\.)(brightspace|desire2learn)\.com$/i.test(location.hostname))) lms = "d2l";
      else if (sesskey || document.querySelector("body[class*='moodle'], #page-mymoodle, meta[name='generator'][content*='Moodle']")) lms = "moodle";
      // Server-rendered / unknown LMS (Blackboard Original, Sakai, itslearning,
      // self-hosted portals, …): no platform API, so the SW runs a bounded same-
      // origin GET crawl seeded from this page. Gated on looksLikeLms() so a
      // random consented site isn't crawled; Drive-owned Classroom stays excluded.
      else if (looksLikeLms() && !AUTO_EXCLUDED_HOSTS.test(location.hostname)) {
        // Don't let the generic crawler CLAIM a host that is really one of the three
        // adapter LMSs whose markers/tokens just haven't rendered yet — that would run
        // + throttle the generic sync and starve the real adapter for the TTL. Return
        // null so a later scan gets the proper adapter. Blackboard/Sakai/etc. (no
        // adapter) still fall through to generic.
        const fam = detectPlatform(location.hostname);
        lms = (fam === "canvas" || fam === "d2l" || fam === "brightspace" || fam === "moodle") ? null : "generic";
      }
    } catch { /* DOM not ready */ }
    // `url` seeds the generic crawler (harmless/ignored for the API-based adapters).
    return { lms, xsrf, sesskey, url: location.href };
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type === "GET_LMS_CONTEXT") {
      sendResponse(window !== window.top ? { lms: null } : getLmsContext());   // top frame only
      return;   // synchronous
    }
    // other message types: ignore
  });

  // Per-site consent: heuristics alone must never grant a random website the power
  // to silently push documents into the student's knowledge base (RAG poisoning).
  // First qualifying visit → one small prompt; the answer is remembered per host.
  // Resolves "yes" | "no" | null. null = ignored/timed out → we DON'T persist a
  // decision (so it re-asks next visit instead of locking the site off forever).
  function askSiteConsent() {
    return new Promise((resolve) => {
      if (window !== window.top) return resolve(null);   // iframes never prompt
      if (document.getElementById("fschoolai-consent")) return resolve(null);
      const bar = document.createElement("div");
      bar.id = "fschoolai-consent";
      bar.style.cssText = "position:fixed;bottom:16px;right:16px;z-index:2147483647;background:#111;color:#eee;padding:12px 14px;border-radius:12px;font:13px -apple-system,BlinkMacSystemFont,sans-serif;box-shadow:0 4px 24px rgba(0,0,0,0.4);max-width:300px";
      const text = document.createElement("div");
      // Honest scope: on a supported LMS this triggers a full course-library sync
      // via the LMS API (all your courses), and re-syncs on later visits — not just
      // the files on this one page.
      text.textContent = "FschoolAI: import all your course files from this LMS, and keep them synced?";
      text.style.marginBottom = "8px";
      const yes = document.createElement("button");
      yes.textContent = "Yes, sync my courses";
      yes.style.cssText = "background:#4285F4;color:#fff;border:none;border-radius:8px;padding:6px 12px;margin-right:8px;cursor:pointer;font:inherit";
      const no = document.createElement("button");
      no.textContent = "No";
      no.style.cssText = "background:rgba(255,255,255,0.1);color:#ccc;border:none;border-radius:8px;padding:6px 12px;cursor:pointer;font:inherit";
      let settled = false;
      // Always settle exactly once — even if the host page re-renders and removes
      // our bar before the timeout, so ensureSiteConsent's finally always releases
      // consentBusy (a stuck promise would lock consent for the whole page-load).
      const done = (v) => { if (settled) return; settled = true; try { bar.remove(); } catch {} resolve(v); };
      yes.addEventListener("click", () => done("yes"));
      no.addEventListener("click", () => done("no"));
      bar.append(text, yes, no);
      document.body.appendChild(bar);
      setTimeout(() => done(null), 30_000);  // ignored → re-ask next time
    });
  }

  function getSiteMode() {
    return new Promise((r) =>
      chrome.runtime.sendMessage({ type: "GET_SITE_MODE", payload: { host: location.hostname } },
        (res) => r(chrome.runtime.lastError ? "off" : (res?.mode ?? "off"))));
  }
  function isAuthed() {
    return new Promise((r) =>
      chrome.runtime.sendMessage({ type: "GET_AUTH_STATUS" },
        (res) => r(!chrome.runtime.lastError && !!res?.signedIn)));
  }

  // Single per-host consent gate for BOTH full-course sync and DOM auto-capture,
  // so they never double-prompt. Returns the effective mode ("on"/"off").
  let consentBusy = false;
  async function ensureSiteConsent() {
    const mode = await getSiteMode();
    if (mode !== "unknown") return mode;
    if (window !== window.top) return "off";        // only the top frame prompts
    if (!(await isAuthed())) return "off";           // never prompt signed-out users
    if (consentBusy) return "off";
    consentBusy = true;
    try {
      const ans = await askSiteConsent();            // "yes" | "no" | null(ignored)
      if (ans === null) return "off";                // ignored → don't persist; re-ask next visit
      const decided = ans === "yes" ? "on" : "off";
      await new Promise((r) =>
        chrome.runtime.sendMessage({ type: "SET_SITE_MODE", payload: { host: location.hostname, mode: decided } },
          () => { void chrome.runtime.lastError; r(); }));
      return decided;
    } finally { consentBusy = false; }
  }

  // Strong "this really is a supported (API-syncable) LMS with a live session"
  // signal — used to offer the full-course sync even on pages with NO visible file
  // links (dashboards, D2L home). Canvas/Moodle session globals live in the page's
  // MAIN world (invisible to this isolated content script), so we detect via
  // reliable DOM markers; D2L also exposes its session token in localStorage.
  function isSupportedLmsPage() {
    try {
      if (location.pathname.startsWith("/d2l/")) return true;                  // strongest D2L signal
      // Bare XSRF.Token is a weak signal (other apps use that key) — require a D2L host.
      if (localStorage.getItem("XSRF.Token") && /(^|\.)(brightspace\.com|desire2learn\.com)$/i.test(location.hostname)) return true;
    } catch { /* storage blocked */ }
    try {
      return !!document.querySelector(
        "body.ic-app, #application.ic-app, #wrapper.ic-Layout-wrapper,"        // Canvas
        + "d2l-navigation, d2l-navigation-main-header, #d2l_body,"             // D2L (specific custom elements, not [class*=d2l-])
        + "body[class*='moodle'], #page-mymoodle, meta[name='generator'][content*='Moodle']");  // Moodle
    } catch { return false; }
  }

  // Engage the full-course API sync: on a supported LMS, get consent (prompt once)
  // and nudge the background to sync THIS tab's whole library — independent of any
  // file links on the page, so it works from a dashboard/home. This is the fix for
  // "signed in, opened my LMS, and nothing happened".
  let engagedForHost = "";
  async function maybeEngageLms() {
    try {
      if (!chrome?.runtime?.sendMessage) return;      // orphaned script
      if (window !== window.top) return;              // top frame only
      if (AUTO_EXCLUDED_HOSTS.test(location.hostname)) return;
      // Engage on the three API-based LMSs (strict markers) OR any LMS-looking page
      // (server-rendered / unknown → the SW's generic crawl). Consent still gates
      // whether we actually sync, so a looksLikeLms false-positive just prompts once.
      if (!isSupportedLmsPage() && !looksLikeLms()) return;
      if (engagedForHost === location.hostname) return;   // once per host per page-load
      // Latch BEFORE the auth check so a signed-out user doesn't re-send
      // GET_AUTH_STATUS (waking the SW) on every scan. Signing in resets this
      // latch via the storage.onChanged(userId) listener below, which re-invokes us.
      engagedForHost = location.hostname;
      if (!(await isAuthed())) return;                    // wait until signed in
      const mode = await ensureSiteConsent();
      if (mode !== "on") return;   // declined/ignored: re-asked on next page load
      // Consent just turned on → re-run the DOM scan so auto-capturable files on
      // THIS page import now that we're allowed (structured files come via the nudge).
      scheduleScan();
      // Grant fires the sync in the background (SET_SITE_MODE force). This nudge
      // also covers the already-consented case with no tab reload (e.g. signed
      // into the extension while already sitting on the LMS). Throttled/guarded
      // in the background, so a redundant nudge is a cheap no-op.
      chrome.runtime.sendMessage({ type: "FULL_SYNC_NUDGE" }, () => void chrome.runtime.lastError);
    } catch { /* never break the host page */ }
  }

  let autoTimer = null;
  function scheduleAutoCapture() {
    if (autoTimer) return;
    autoTimer = setTimeout(async () => {
      autoTimer = null;
      try {
        if (!chrome?.runtime?.sendMessage) return;             // orphaned script
        if (AUTO_EXCLUDED_HOSTS.test(location.hostname)) return;
        if (!looksLikeLms()) return;
        // On Canvas/D2L/Moodle the full-course API sync (maybeEngageLms → runFullSync)
        // owns file import and fetches in-page (same-origin cookie). DOM auto-capture
        // here would only duplicate that work AND fail with cross-site 403s in the
        // background — so defer to full-sync on supported LMSs.
        if (isSupportedLmsPage()) return;
        // Consent FIRST — before collectAutoCandidates marks any hrefs into
        // autoSeen. If a full-sync prompt is mid-flight (consentBusy), this
        // returns "off" and we retry on the next scan, without permanently
        // burning this page's file links out of the auto-capture budget.
        if (await ensureSiteConsent() !== "on") return;
        resetAutoBudgetOnRouteChange();
        if (autoSent >= AUTO_BUDGET) return;
        const items = collectAutoCandidates(AUTO_BUDGET - autoSent);
        if (!items.length) return;

        autoSent += items.length;
        // Background gates on signed-in + the autoCapture setting, dedups against
        // its captured-URL memory + failure backoff, and serializes the downloads.
        chrome.runtime.sendMessage({
          type: "AUTO_IMPORT",
          payload: { items, pageUrl: location.href, platform },
        }, (res) => {
          if (chrome.runtime.lastError) return;
          // Refund budget for items the background never worked on (already
          // captured / failure-blocked / signed-out) — otherwise revisiting a
          // mostly-captured page exhausts the budget on no-ops and any NEW
          // file on it never gets a slot. (autoSeen still stops re-sending.)
          if (res?.ok) autoSent -= Math.max(0, items.length - (res.considered ?? items.length));
          else         autoSent -= items.length;
          if (autoSent < 0) autoSent = 0;
        });
      } catch { /* never break the host page */ }
    }, 2500);   // let SPA content settle; batches instead of per-link spam
  }

  // ── Google Classroom capture (SPA — Google's Wiz framework) ────────────────
  // Classroom's DOM is obfuscated (class names rotate between builds) and its
  // files are minted by XHR, so the generic anchor/auto-capture model finds
  // nothing there. But its ROUTES and Drive-attachment hrefs are stable:
  //   /u/{n}/h                        → course cards (name + web id)
  //   /u/{n}/w/{cid}/t/all            → classwork tab (assignment links)
  //   /u/{n}/c/{cid}/a/{iid}/details  → assignment detail (attachments, due date)
  // The web ids are base64 of the numeric Classroom API ids; the background
  // decodes them to the same gc_<id> keys the server-side OAuth sync
  // (api/drive-auth.ts) writes, so both paths upsert the SAME rows. This is the
  // fallback for schools whose admin blocks third-party Classroom API access —
  // the student's own browser session still renders everything.
  // Selectors: href routes + aria-labels/text only, never CSS classes.
  const IS_CLASSROOM = /(^|\.)classroom\.google\.com$/i.test(location.hostname);
  const CR_B64 = "[A-Za-z0-9_=-]{8,}";
  const CR_COURSE_LINK_RE = new RegExp(`^/(?:u/\\d+/)?[cw]/(${CR_B64})$`);
  const CR_ITEM_LINK_RE   = new RegExp(`^/(?:u/\\d+/)?c/(${CR_B64})/(a|m|sa|mc|qa)/(${CR_B64})(?:/details)?$`);
  const crSent = new Set();     // session-level capture dedup (courses/items/files)

  function crPageCourseId() {
    const m = location.pathname.match(new RegExp(`/(?:c|w)/(${CR_B64})`));
    return m ? m[1] : null;
  }

  function crLabel(el) {
    return (el.getAttribute("aria-label") || el.textContent || "").trim().replace(/\s+/g, " ");
  }

  // Scrape a "Due <date>" string from a scope — used on the item DETAILS page, where the due
  // date isn't in a list row. Best-effort: a wrong/absent match just yields null (parseable
  // due dates fail safe to due_at:null in the background).
  function crScrapeDue(scope) {
    const t = ((scope || document.body).innerText || "").match(/\bdue\b[^\n]{0,60}/i);
    return t ? t[0].slice(0, 80) : null;
  }

  // The course name shown in the course-page header (classwork/stream/people), for when the
  // student opens a course directly and no dashboard course card is present to name it.
  function crPageCourseName() {
    const h = document.querySelector('[role="heading"][aria-level="1"], h1');
    let name = h ? (h.textContent || "").trim().replace(/\s+/g, " ") : "";
    if (!name) name = document.title.replace(/\s*[-–]\s*Google Classroom.*$/i, "")
      .replace(/\s*[-–]\s*(Classwork|Stream|People|Grades|To-?do)\s*$/i, "").trim();
    return name && name.length >= 2 && !/^(stream|classwork|people|grades|to-?do|open)$/i.test(name)
      ? name.slice(0, 200) : null;
  }

  function collectClassroom() {
    const courses = [], items = [], attachments = [];
    const pageCid = crPageCourseId();

    // The details page itself identifies one classwork item even when no list
    // anchors are rendered (the user navigated straight to it).
    const self = location.pathname.match(CR_ITEM_LINK_RE);
    if (self && !crSent.has("i:" + self[3])) {
      crSent.add("i:" + self[3]);
      const title = document.title.replace(/\s*[-–]\s*Google Classroom.*$/i, "").trim();
      // Scrape the due date off the details DOM — session dedup (crSent) means the list row
      // can't backfill it later, so if we don't grab it here it's lost for the whole visit.
      items.push({ courseWebId: self[1], kind: self[2], itemWebId: self[3], title: title || "Untitled", dueText: crScrapeDue() });
    }

    for (const a of document.querySelectorAll("a[href]")) {
      let u; try { u = new URL(a.href); } catch { continue; }

      // Drive/Docs attachment cards (assignment details, stream posts, classwork).
      if (/(^|\.)(drive|docs)\.google\.com$/i.test(u.hostname) && CLOUD_STORAGE_RE.test(a.href)) {
        const key = "f:" + a.href;
        if (crSent.has(key)) continue;
        crSent.add(key);
        const label = crLabel(a);
        attachments.push({ href: a.href, filename: label.slice(0, 120) || null, courseWebId: pageCid });
        continue;
      }

      if (u.hostname !== location.hostname) continue;

      // Course cards (/c/{cid} with the course name as the link label). Nav/tab
      // links match the same route shape but carry generic labels — skip those;
      // the background only creates courses it has a real name for.
      let m = u.pathname.match(CR_COURSE_LINK_RE);
      if (m) {
        const key = "c:" + m[1];
        if (crSent.has(key)) continue;
        const label = crLabel(a);
        if (label && label.length >= 2 && !/^(stream|classwork|people|grades|to-?do|open)$/i.test(label)) {
          crSent.add(key);
          courses.push({ webId: m[1], name: label.slice(0, 200) });
        }
        continue;
      }

      // Classwork item links (a = assignment, sa/qa = question, m/mc = material).
      m = u.pathname.match(CR_ITEM_LINK_RE);
      if (m) {
        const key = "i:" + m[3];
        if (crSent.has(key)) continue;
        crSent.add(key);
        const title = crLabel(a).slice(0, 300);
        // The due date is text in the surrounding list row, not on the anchor.
        let dueText = null;
        let el = a;
        for (let i = 0; i < 4 && el; i++, el = el.parentElement) {
          const t = (el.innerText || "").match(/\bdue\b[^\n]{0,60}/i);
          if (t) { dueText = t[0].slice(0, 80); break; }
        }
        items.push({ courseWebId: m[1], kind: m[2], itemWebId: m[3], title: title || "Untitled", dueText });
      }
    }

    // Classwork LIST rows are NOT <a href> links in the current Classroom UI — they are
    // expandable <li>s carrying the numeric stream-item id + type in data-* attributes. Scrape
    // those so the ENTIRE classwork list is captured from one visit, without the student opening
    // each item (the anchor loop above only ever fires on an item's own details page).
    if (pageCid) {
      for (const row of document.querySelectorAll("[data-stream-item-id]")) {
        const sid = row.getAttribute("data-stream-item-id");
        if (!/^\d{6,20}$/.test(sid || "") || crSent.has("i:" + sid)) continue;
        crSent.add("i:" + sid);
        const type = row.getAttribute("data-stream-item-type");   // "1" assignment, "5" material
        const txt = (row.innerText || "").replace(/\s+/g, " ").trim();
        // "No due date" must be handled BEFORE the generic due-strip, otherwise stripping
        // " due date…" leaves the leading "No" glued to the title (e.g. "…Practice No").
        const noDue = /\bno\s+due\s+date\b/i.test(txt);
        const dueM = noDue ? null : txt.match(/\bdue\b[^]*?(?=\s+more_vert|$)/i);
        const dueText = dueM ? dueM[0].slice(0, 80) : null;
        const title = (txt
          .replace(/^(completed\s+|turned in\s+|assigned\s+|missing\s+|done\s+late\s+)?(assignment|material|question|quiz)\s+\S+\s+/i, "")
          .replace(/\s+no\s+due\s+date\b.*$/i, "")
          .replace(/\s+(due|posted|edited|assigned)\b.*$/i, "")
          .replace(/\s*more_vert.*$/i, "").trim()) || "Untitled";
        // type 5 = material (filtered out of assignments downstream); everything else = gradable work.
        items.push({ courseWebId: pageCid, kind: type === "5" ? "m" : "a", itemWebId: sid, numericId: sid, title: title.slice(0, 300), dueText });
      }
    }

    // On a course page (classwork/stream) with no dashboard course card captured, emit the
    // current course from the URL id + a scraped header name so its assignments link to a real
    // course row instead of orphaning with course_id:null (background upserts courses first).
    if (pageCid && !crSent.has("c:" + pageCid)) {
      const nm = crPageCourseName();
      if (nm) { crSent.add("c:" + pageCid); courses.push({ webId: pageCid, name: nm }); }
    }
    return { courses, items, attachments };
  }

  async function runClassroomCapture() {
    try {
      if (!chrome?.runtime?.sendMessage) return;               // orphaned script
      if (window !== window.top) return;                       // top frame only
      // Same consent gate as every other capture path — one prompt per host.
      if (await ensureSiteConsent() !== "on") return;
      const { courses, items, attachments } = collectClassroom();
      if (!courses.length && !items.length && !attachments.length) return;
      chrome.runtime.sendMessage({
        type: "CLASSROOM_CAPTURE",
        payload: { courses, items, attachments, pageUrl: location.href },
      }, () => void chrome.runtime.lastError);
    } catch { /* never break the host page */ }
  }

  let crTimer = null;
  function scheduleClassroomCapture() {
    if (crTimer) return;
    crTimer = setTimeout(() => {
      crTimer = null;
      // The Classwork list lazy-renders well after document_idle, and a single capture can fire
      // before its rows exist (→ nothing captured, no retrigger). Capture at several offsets so
      // slow-rendering lists are still picked up; crSent dedups, so later passes only emit the
      // newly-appeared courses/items/attachments.
      runClassroomCapture();
      setTimeout(runClassroomCapture, 3500);
      setTimeout(runClassroomCapture, 8000);
    }, 2500);   // let the SPA settle; batches instead of per-mutation spam
  }

  // Universal selector — catches file links on any website.
  const SELECTOR = [
    "a[download]",
    "a[href$='.pdf']",  "a[href*='.pdf?']",  "a[href*='.pdf#']",
    "a[href$='.docx']", "a[href*='.docx?']",
    "a[href$='.doc']",  "a[href*='.doc?']",
    "a[href$='.pptx']", "a[href*='.pptx?']",
    "a[href$='.ppt']",  "a[href*='.ppt?']",
    "a[href$='.xlsx']", "a[href*='.xlsx?']",
    "a[href$='.xls']",
    "a[href$='.txt']",  "a[href$='.csv']",
    "a[href$='.mp4']",  "a[href$='.mp3']",
    "a[href*='/download']",
    "a[href*='download=1']",
    "a[href*='/files/download']",
    // Google Drive / Docs public share links
    "a[href*='drive.google.com/file/d/']",
    "a[href*='drive.google.com/open']",
    "a[href*='docs.google.com/document/d/']",
    "a[href*='docs.google.com/presentation/d/']",
    "a[href*='docs.google.com/spreadsheets/d/']",
    // Dropbox public share links
    "a[href*='dropbox.com/s/']",
    "a[href*='dropbox.com/scl/fi/']",
    // OneDrive personal short links + long links
    "a[href*='1drv.ms/']",
    "a[href*='onedrive.live.com/']",
    // SharePoint / OneDrive for Business
    "a[href*='.sharepoint.com/']",
    // Box public share links
    "a[href*='app.box.com/s/']",
  ].join(", ");

  // Text heuristic: links whose visible label mentions a file type
  const TEXT_FILE_RE = /\b(pdf|docx?|pptx?|xlsx?|csv)\b/i;

  const ATTR = "data-fschoolai-btn";
  const ruleChecked = new WeakSet();   // anchors already tested against viewerRuleFor

  function guessFilename(href, linkText) {
    try {
      const u   = new URL(href, location.href);
      const seg = u.pathname.split("/").filter(Boolean).pop() ?? "";
      if (seg && /\.\w{2,5}$/.test(seg)) return decodeURIComponent(seg);
    } catch {}
    // No real filename in the URL: use the link text WITHOUT inventing an extension —
    // the background reconciles the name against the fetched mimeType (a fabricated
    // ".pdf" would mislead the server's extension-first type detection).
    const clean = (linkText ?? "file").replace(/[^\w\s.-]/g, "").trim().slice(0, 80);
    return clean || "file";
  }

  // ArrayBuffer → base64 in chunks to avoid stack overflow on large files
  function bufferToBase64(buffer) {
    const uint8 = new Uint8Array(buffer);
    const CHUNK = 8192;
    let binary = "";
    for (let i = 0; i < uint8.length; i += CHUNK) {
      binary += String.fromCharCode.apply(null, uint8.subarray(i, i + CHUNK));
    }
    return btoa(binary);
  }

  function makeButton(href, filename, rule) {
    const btn = document.createElement("button");
    btn.textContent   = "⬆ Import to FschoolAI";
    btn.style.cssText = `
      display:        inline-flex;
      align-items:    center;
      gap:            5px;
      margin-left:    8px;
      padding:        3px 10px;
      border-radius:  8px;
      border:         none;
      background:     #4285F4;
      color:          #fff;
      font-size:      12px;
      font-weight:    600;
      cursor:         pointer;
      font-family:    -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif;
      vertical-align: middle;
      transition:     opacity 0.15s;
      white-space:    nowrap;
      z-index:        999999;
    `;

    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();

      // Any sendMessage can reject ("message port closed") if the SW restarts —
      // never leave the button stuck on "Importing…".
      const send = async (message) => {
        try { return await chrome.runtime.sendMessage(message); }
        catch (err) { return { error: err?.message ?? "Extension restarted — try again" }; }
      };

      // Step 1 — check auth first
      const authStatus = await send({ type: "GET_AUTH_STATUS" });
      if (!authStatus?.signedIn) {
        btn.textContent      = "Sign in first ↗";
        btn.style.background = "#ff9500";
        setTimeout(() => { btn.textContent = "⬆ Import to FschoolAI"; btn.style.background = "#4285F4"; }, 3000);
        return;
      }

      btn.textContent   = "Downloading…";
      btn.disabled      = true;
      btn.style.opacity = "0.7";

      // Step 2a — viewer/launcher links (D2L topics, Canvas files, Moodle resources…):
      // the href itself carries no bytes. The background resolves it — rewritten
      // direct URL, redirect-following, wrapper parsing — and verifies it's a real file.
      if (rule) {
        btn.textContent = "Importing…";
        const result = await send({
          type:    "IMPORT_FILE",
          payload: { url: rule.url, fetchUrl: rule.url, filename, pageUrl: location.href, courseId: null, platform, resolveHint: rule.hint ?? undefined },
        });
        if (result?.ok) {
          btn.textContent      = result.skipped ? "Already indexed ✓" : "Indexed ✓";
          btn.style.background = "#30d158";
          btn.style.opacity    = "1";
        } else {
          btn.textContent      = result?.error?.slice(0, 40) ?? "Failed";
          btn.style.background = "#ff453a";
          btn.style.opacity    = "1";
          btn.disabled         = false;
          setTimeout(() => { btn.textContent = "⬆ Import to FschoolAI"; btn.style.background = "#4285F4"; }, 3000);
        }
        return;
      }

      // Step 2 — cloud storage links must be fetched from the background service worker
      // because CORS blocks cross-origin fetches from content scripts even with credentials.
      // Background workers with host_permissions bypass CORS entirely.
      if (CLOUD_STORAGE_RE.test(href)) {
        btn.textContent = "Importing…";
        const result = await send({
          type:    "IMPORT_CLOUD_FILE",
          payload: { href, filename, pageUrl: location.href, platform },
        });

        if (result?.ok) {
          btn.textContent      = result.skipped ? "Already indexed ✓" : "Indexed ✓";
          btn.style.background = "#30d158";
          btn.style.opacity    = "1";
        } else {
          btn.textContent      = result?.error?.slice(0, 40) ?? "Failed";
          btn.style.background = "#ff453a";
          btn.style.opacity    = "1";
          btn.disabled         = false;
          setTimeout(() => { btn.textContent = "⬆ Import to FschoolAI"; btn.style.background = "#4285F4"; }, 3000);
        }
        return;
      }

      // Step 2b — regular file: fetch here using live session cookies
      let bytes, mimeType;
      try {
        const fileRes = await fetch(href, { credentials: "include" });
        if (!fileRes.ok) throw new Error(`HTTP ${fileRes.status}`);
        mimeType = fileRes.headers.get("content-type")?.split(";")[0]?.trim() ?? "application/octet-stream";
        const buffer = await fileRes.arrayBuffer();
        if (buffer.byteLength > 100 * 1024 * 1024) throw new Error("File too large (max 100 MB)");

        // Validate we got an actual PDF and not an HTML redirect/login page.
        if (mimeType === "application/pdf" || href.match(/\.pdf/i)) {
          const magic = new Uint8Array(buffer.slice(0, 5));
          const isPdf = magic[0] === 0x25 && magic[1] === 0x50 && magic[2] === 0x44 && magic[3] === 0x46 && magic[4] === 0x2D;
          if (!isPdf) throw new Error("Server returned HTML instead of PDF (login wall or redirect)");
        }

        // Big files: don't base64 + copy through sendMessage (message-size + memory
        // limits) — let the background re-fetch and take the storage-upload path.
        if (buffer.byteLength > 2_500_000) throw new Error("__delegate_to_background__");

        bytes = bufferToBase64(buffer);
      } catch (err) {
        // Cross-origin file host (CDN, storage domain) → the content script's fetch is
        // CORS-blocked. The background service worker has host permissions and can
        // fetch it with the same session cookies.
        btn.textContent = "Importing…";
        const bgResult = await send({
          type:    "IMPORT_FILE",
          payload: { url: href, fetchUrl: href, filename, pageUrl: location.href, courseId: null, platform },
        });
        if (bgResult?.ok) {
          btn.textContent      = bgResult.skipped ? "Already indexed ✓" : "Indexed ✓";
          btn.style.background = "#30d158";
          btn.style.opacity    = "1";
        } else {
          btn.textContent      = bgResult?.error?.slice(0, 40) ?? "Download failed";
          btn.style.background = "#ff453a";
          btn.style.opacity    = "1";
          btn.disabled         = false;
          setTimeout(() => { btn.textContent = "⬆ Import to FschoolAI"; btn.style.background = "#4285F4"; }, 3000);
        }
        return;
      }

      // Step 3 — hand bytes to background → lms-ingest
      btn.textContent = "Importing…";

      const result = await send({
        type:    "IMPORT_FILE",
        payload: { url: href, filename, pageUrl: location.href, courseId: null, bytes, mimeType, platform },
      });

      if (result?.ok) {
        btn.textContent      = result.skipped ? "Already indexed ✓" : "Indexed ✓";
        btn.style.background = "#30d158";
        btn.style.opacity    = "1";
      } else {
        btn.textContent      = result?.error?.slice(0, 40) ?? "Failed";
        btn.style.background = "#ff453a";
        btn.style.opacity    = "1";
        btn.disabled         = false;
        setTimeout(() => { btn.textContent = "⬆ Import to FschoolAI"; btn.style.background = "#4285F4"; }, 3000);
      }
    });

    return btn;
  }

  function tryInject(a, rule) {
    if (a.getAttribute(ATTR)) return;
    const href = a.href;
    if (!href || href.startsWith("javascript") || href === location.href) return;
    a.setAttribute(ATTR, "1");
    const btn = makeButton(href, guessFilename(href, a.textContent), rule);
    a.parentNode?.insertBefore(btn, a.nextSibling);
  }

  function injectButtons() {
    // Pass 1: href-based (extension in URL or known cloud storage pattern)
    document.querySelectorAll(SELECTOR).forEach((a) => {
      if (a.getAttribute(ATTR)) return;
      if (IMPORTABLE_EXT.test(a.href) || CLOUD_STORAGE_RE.test(a.href)) tryInject(a);
    });

    // Pass 2: platform viewer/launcher links (D2L topics, Canvas files, Blackboard
    // content, Moodle resources, …) — shadow-DOM-aware so modern D2L lists work.
    // MUST run before the text heuristic: a viewer link whose text says "PDF"
    // would otherwise get a rule-less button whose direct fetch can't succeed.
    // Canvas module items are excluded: most are Pages/Quizzes, and a button on
    // every one would be noise (auto-capture still resolves the File ones).
    // ruleChecked converges the pass: non-matching anchors are regex-tested once,
    // not on every 4s tick. (SPA frameworks replace elements rather than mutate
    // hrefs in place — and href-attribute mutations never trigger a re-scan
    // anyway, since the observer watches childList only.)
    collectAllAnchors().forEach((a) => {
      if (ruleChecked.has(a) || a.getAttribute(ATTR)) return;
      if (!a.href || a.href.startsWith("javascript")) return;
      ruleChecked.add(a);
      const rule = viewerRuleFor(a.href);
      if (!rule || rule.hint === "canvas-module-item") return;
      tryInject(a, rule);
    });

    // Pass 3: text-based (e.g. links that say "(PDF - 1.1 MB)" but href is a redirect)
    document.querySelectorAll("a[href]").forEach((a) => {
      if (a.getAttribute(ATTR)) return;
      const text = a.textContent?.trim() ?? "";
      if (TEXT_FILE_RE.test(text) && a.href && !a.href.startsWith("javascript")) {
        tryInject(a);
      }
    });
  }

  function scan() {
    injectButtons();
    if (IS_CLASSROOM) {
      // Classroom has its own route-based capture; the generic auto-capture and
      // full-sync paths stay excluded (AUTO_EXCLUDED_HOSTS) — they'd find nothing.
      scheduleClassroomCapture();
      return;
    }
    scheduleAutoCapture();
    maybeEngageLms();     // offer/trigger full-course sync even with no file links on the page
  }

  // If the user signs into the extension while ALREADY sitting on their LMS, no
  // tab reload fires — re-engage the moment auth appears so the consent prompt /
  // full sync starts immediately instead of waiting for a navigation.
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes.userId && changes.userId.newValue) {
        engagedForHost = "";
        maybeEngageLms();
      }
    });
  } catch { /* storage unavailable in this context */ }

  // Debounced: MutationObserver fires on every DOM batch, and injectButtons runs two
  // document-wide querySelectorAll passes — unthrottled it would burn CPU on busy
  // SPAs (and now runs in every iframe via all_frames).
  let scanTimer = null;
  function scheduleScan() {
    if (scanTimer) return;
    scanTimer = setTimeout(() => { scanTimer = null; scan(); }, 400);
  }

  if (document.body) scan();
  else window.addEventListener("DOMContentLoaded", scan);

  // Re-scan when the DOM changes (SPA navigation, lazy-loaded content). SPA URL
  // changes always mutate the DOM, so the observer covers them too — a pushState
  // monkey-patch would be dead code in MV3's isolated world anyway.
  // Track real DOM activity (observer/navigation, NOT our own interval ticks)
  // so the shadow re-scan can back off when the page has gone quiet.
  let lastDomActivity = Date.now();
  if (document.body) {
    const observer = new MutationObserver(() => { lastDomActivity = Date.now(); scheduleScan(); });
    observer.observe(document.body, { childList: true, subtree: true });
  }
  window.addEventListener("popstate", () => { lastDomActivity = Date.now(); scheduleScan(); });

  // The body observer can't see mutations INSIDE shadow roots (D2L renders its
  // content lists in d2l-* web components). A slow tick guarantees those pages
  // are eventually re-scanned; scheduleScan debounces, and non-matching anchors
  // are cheap Set lookups on re-scan. Gated to pages that actually use shadow
  // DOM, and backed off 4x (~16s) once the page has been idle for a minute.
  let shadowTick = 0;
  setInterval(() => {
    if (!needsShadowWalk() || !looksLikeLms()) return;
    shadowTick++;
    if (Date.now() - lastDomActivity > 60_000 && shadowTick % 4 !== 0) return;
    scheduleScan();
  }, 4000);
})();

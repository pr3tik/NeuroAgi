// Connections.tsx — LMS OAuth connect + Chrome extension setup
// Handles ?lms=google_connected | microsoft_connected | google_error | microsoft_error
// from OAuth redirect landing.

import { useState, useEffect, useCallback } from "react";
import { useApp } from "../context/AppContext";
import FileImporter from "../components/FileImporter";

// ── Helpers ────────────────────────────────────────────────────────────────

function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const d = Date.now() - new Date(iso).getTime();
  const m = Math.floor(d / 60_000);
  if (m < 1)   return "just now";
  if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ── Inline styles ──────────────────────────────────────────────────────────

const card = (accent: string) => ({
  background:   "rgba(255,255,255,0.03)",
  border:       `1px solid ${accent}`,
  borderRadius: "18px",
  overflow:     "hidden" as const,
  marginBottom: "16px",
});

const cardHeader = {
  display:        "flex" as const,
  alignItems:     "center" as const,
  gap:            "14px",
  padding:        "20px",
};

const pill = (connected: boolean) => ({
  display:      "flex",
  alignItems:   "center",
  gap:          "5px",
  padding:      "3px 10px",
  borderRadius: "20px",
  fontSize:     "11px",
  fontWeight:   "600" as const,
  background:   connected ? "rgba(48,209,88,0.12)" : "rgba(255,255,255,0.06)",
  color:        connected ? "#30d158" : "rgba(255,255,255,0.35)",
  border:       connected ? "1px solid rgba(48,209,88,0.25)" : "1px solid rgba(255,255,255,0.08)",
});

const connectBtn = (color: string, disabled = false) => ({
  padding:      "10px 20px",
  borderRadius: "12px",
  border:       "none",
  background:   disabled ? "rgba(255,255,255,0.06)" : color,
  color:        disabled ? "rgba(255,255,255,0.3)" : "#fff",
  fontSize:     "13px",
  fontWeight:   "600" as const,
  cursor:       disabled ? "default" : "pointer",
  fontFamily:   "inherit",
  transition:   "opacity 0.15s",
  flexShrink:   0 as const,
});

const dangerBtn = {
  padding:    "8px 14px",
  borderRadius: "10px",
  border:     "none",
  background: "rgba(255,69,58,0.12)",
  color:      "#ff6961",
  fontSize:   "12px",
  cursor:     "pointer",
  fontFamily: "inherit",
  transition: "opacity 0.15s",
};

// ── Provider icon SVGs ─────────────────────────────────────────────────────

function GoogleIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  );
}

function MicrosoftIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24">
      <rect x="1"  y="1"  width="10.5" height="10.5" fill="#F25022"/>
      <rect x="12.5" y="1"  width="10.5" height="10.5" fill="#7FBA00"/>
      <rect x="1"  y="12.5" width="10.5" height="10.5" fill="#00A4EF"/>
      <rect x="12.5" y="12.5" width="10.5" height="10.5" fill="#FFB900"/>
    </svg>
  );
}

function ExtensionIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/>
      <path d="M8 12h8M12 8v8"/>
    </svg>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export default function Connections() {
  const { userId } = useApp();

  // OAuth banner from redirect
  const [banner, setBanner] = useState<string | null>(() => {
    const p = new URLSearchParams(window.location.search);
    return p.get("lms") ?? null;
  });

  // Provider connection state
  const [googleStatus,    setGoogleStatus]    = useState<{ connected: boolean; connectedAt: string | null } | null>(null);
  const [microsoftStatus, setMicrosoftStatus] = useState<{ connected: boolean; connectedAt: string | null } | null>(null);

  // Which importer is expanded
  const [openImporter, setOpenImporter] = useState<"google" | "microsoft" | null>(null);

  const [importToast, setImportToast] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncingMs, setSyncingMs] = useState(false);

  // Clear ?lms= from URL after reading
  useEffect(() => {
    if (!banner) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("lms");
    url.searchParams.delete("reason");
    window.history.replaceState({}, "", url.toString());
    const t = setTimeout(() => setBanner(null), 5000);
    return () => clearTimeout(t);
  }, [banner]);

  const loadStatuses = useCallback(async () => {
    if (!userId) return;
    const [gRes, mRes] = await Promise.all([
      fetch(`/api/drive-auth?action=status&userId=${encodeURIComponent(userId)}`).then(r => r.json()).catch(() => null),
      fetch(`/api/lms-microsoft?action=status&userId=${encodeURIComponent(userId)}`).then(r => r.json()).catch(() => null),
    ]);
    if (gRes) setGoogleStatus(gRes);
    if (mRes) setMicrosoftStatus(mRes);
  }, [userId]);

  useEffect(() => { loadStatuses(); }, [loadStatuses]);

  // Auto-open importer when just connected
  useEffect(() => {
    if (banner === "google_connected" && googleStatus?.connected) setOpenImporter("google");
    if (banner === "microsoft_connected" && microsoftStatus?.connected) setOpenImporter("microsoft");
  }, [banner, googleStatus, microsoftStatus]);

  async function connectGoogle() {
    if (!userId) return;
    window.location.href = `/api/drive-auth?action=auth&userId=${encodeURIComponent(userId)}`;
  }

  // Full Classroom sync: courses + assignments (with due dates) + auto-ingest all files.
  async function syncGoogle() {
    if (!userId || syncing) return;
    setSyncing(true);
    setImportToast("Syncing Classroom courses, assignments & files…");
    try {
      const r = await fetch("/api/drive-auth?action=sync", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ userId }),
      });
      const s = await r.json().catch(() => ({}));
      if (!r.ok) {
        setImportToast(s.error ? `Sync failed: ${s.error}` : "Sync failed");
      } else {
        const more = (s.errors?.length ? ` · ${s.errors.length} issue(s)` : "");
        setImportToast(`Synced ${s.courses ?? 0} courses, ${s.assignments ?? 0} assignments, ${s.ingested ?? 0} files${s.skipped ? ` (${s.skipped} already had)` : ""}${more}`);
      }
    } catch (e: any) {
      setImportToast(`Sync failed: ${e?.message ?? "network error"}`);
    } finally {
      setSyncing(false);
    }
  }

  async function connectMicrosoft() {
    if (!userId) return;
    window.location.href = `/api/lms-microsoft?action=auth&userId=${encodeURIComponent(userId)}`;
  }

  // Full Teams-for-Education sync: classes + assignments (with due dates) + auto-ingest files.
  async function syncMicrosoft() {
    if (!userId || syncingMs) return;
    setSyncingMs(true);
    setImportToast("Syncing Teams classes, assignments & files…");
    try {
      const r = await fetch("/api/lms-microsoft?action=sync", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ userId }),
      });
      const s = await r.json().catch(() => ({}));
      if (!r.ok) {
        setImportToast(s.error ? `Sync failed: ${s.error}` : "Sync failed");
      } else if (s.note) {
        setImportToast(s.note);
      } else {
        const more = (s.errors?.length ? ` · ${s.errors.length} issue(s)` : "");
        setImportToast(`Synced ${s.courses ?? 0} classes, ${s.assignments ?? 0} assignments, ${s.ingested ?? 0} files${s.skipped ? ` (${s.skipped} already had)` : ""}${more}`);
      }
    } catch (e: any) {
      setImportToast(`Sync failed: ${e?.message ?? "network error"}`);
    } finally {
      setSyncingMs(false);
    }
  }

  async function disconnectGoogle() {
    if (!userId) return;
    await fetch("/api/drive-auth?action=disconnect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    setGoogleStatus({ connected: false, connectedAt: null });
    setOpenImporter(p => p === "google" ? null : p);
  }

  async function disconnectMicrosoft() {
    if (!userId) return;
    await fetch("/api/lms-microsoft?action=disconnect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    setMicrosoftStatus({ connected: false, connectedAt: null });
    setOpenImporter(p => p === "microsoft" ? null : p);
  }

  function handleImported(name: string) {
    setImportToast(name);
    setTimeout(() => setImportToast(null), 3500);
  }

  const gConnected = googleStatus?.connected ?? false;
  const mConnected = microsoftStatus?.connected ?? false;

  const bannerIsError = banner?.includes("error");

  return (
    <div style={{ maxWidth: "540px", margin: "0 auto" }}>
      <style>{`
        @keyframes connBannerIn{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:none}}
        @keyframes connToastIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
      `}</style>

      {/* OAuth redirect banner */}
      {banner && (
        <div style={{
          marginBottom:  "20px",
          padding:       "14px 16px",
          borderRadius:  "14px",
          background:    bannerIsError ? "rgba(30,10,10,0.9)" : "rgba(10,24,16,0.9)",
          border:        bannerIsError ? "1px solid rgba(255,80,70,0.25)" : "1px solid rgba(52,199,89,0.22)",
          display:       "flex",
          alignItems:    "center",
          gap:           "10px",
          animation:     "connBannerIn 0.3s ease both",
        }}>
          <div style={{
            width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
            background: bannerIsError ? "#ff453a" : "#30d158",
          }} />
          <span style={{ fontSize: "13px", color: bannerIsError ? "#ff6961" : "#30d158", fontWeight: "600" }}>
            {banner === "google_connected"    && "Google connected — browse your Classroom files below"}
            {banner === "microsoft_connected" && "Microsoft connected — browse your Teams files below"}
            {banner === "google_error"        && "Google connection failed. Try again."}
            {banner === "microsoft_error"     && "Microsoft connection failed. Try again."}
          </span>
        </div>
      )}

      <p style={{ fontSize: "13px", color: "rgba(255,255,255,0.4)", marginBottom: "24px", lineHeight: 1.6 }}>
        Connect your learning platforms so FschoolAI can index your course files for RAG-powered tutoring.
      </p>

      {/* ── Google ──────────────────────────────────────────────────────── */}
      <div style={card(gConnected ? "rgba(52,199,89,0.18)" : "rgba(255,255,255,0.07)")}>
        <div style={cardHeader}>
          <div style={{
            width: 42, height: 42, borderRadius: "12px",
            background: "rgba(255,255,255,0.06)",
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          }}>
            <GoogleIcon />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: "15px", fontWeight: "700", color: "rgba(255,255,255,0.88)", marginBottom: "3px" }}>
              Google Classroom
            </div>
            <div style={{ fontSize: "12px", color: "rgba(255,255,255,0.36)" }}>
              {gConnected
                ? `Connected${googleStatus?.connectedAt ? ` · ${timeAgo(googleStatus.connectedAt)}` : ""}`
                : "Google Drive · Classroom · Canvas (Drive-linked)"}
            </div>
          </div>
          <div style={pill(gConnected)}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: gConnected ? "#30d158" : "rgba(255,255,255,0.2)", display: "inline-block" }} />
            {gConnected ? "Connected" : "Not connected"}
          </div>
        </div>

        <div style={{ padding: "0 20px 18px", display: "flex", gap: "10px", alignItems: "center" }}>
          {gConnected ? (
            <>
              <button
                onClick={() => setOpenImporter(p => p === "google" ? null : "google")}
                style={connectBtn("rgba(100,180,255,0.18)")}
              >
                {openImporter === "google" ? "Hide files" : "Browse files"}
              </button>
              <button onClick={syncGoogle} disabled={syncing} style={connectBtn("rgba(48,209,88,0.18)")}>
                {syncing ? "Syncing…" : "Sync all"}
              </button>
              <button onClick={disconnectGoogle} style={dangerBtn}>Disconnect</button>
            </>
          ) : (
            <button onClick={connectGoogle} style={connectBtn("#4285F4")}>
              Connect Google
            </button>
          )}
        </div>

        {openImporter === "google" && gConnected && (
          <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
            <FileImporter provider="google" userId={userId ?? ""} onImported={handleImported} />
          </div>
        )}
      </div>

      {/* ── Microsoft ───────────────────────────────────────────────────── */}
      <div style={card(mConnected ? "rgba(52,199,89,0.18)" : "rgba(255,255,255,0.07)")}>
        <div style={cardHeader}>
          <div style={{
            width: 42, height: 42, borderRadius: "12px",
            background: "rgba(255,255,255,0.06)",
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          }}>
            <MicrosoftIcon />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: "15px", fontWeight: "700", color: "rgba(255,255,255,0.88)", marginBottom: "3px" }}>
              Microsoft Teams
            </div>
            <div style={{ fontSize: "12px", color: "rgba(255,255,255,0.36)" }}>
              {mConnected
                ? `Connected${microsoftStatus?.connectedAt ? ` · ${timeAgo(microsoftStatus.connectedAt)}` : ""}`
                : "Teams · OneDrive · Blackboard (if synced)"}
            </div>
          </div>
          <div style={pill(mConnected)}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: mConnected ? "#30d158" : "rgba(255,255,255,0.2)", display: "inline-block" }} />
            {mConnected ? "Connected" : "Not connected"}
          </div>
        </div>

        <div style={{ padding: "0 20px 18px", display: "flex", gap: "10px", alignItems: "center" }}>
          {mConnected ? (
            <>
              <button
                onClick={() => setOpenImporter(p => p === "microsoft" ? null : "microsoft")}
                style={connectBtn("rgba(127,186,0,0.18)")}
              >
                {openImporter === "microsoft" ? "Hide files" : "Browse files"}
              </button>
              <button onClick={syncMicrosoft} disabled={syncingMs} style={connectBtn("rgba(48,209,88,0.18)")}>
                {syncingMs ? "Syncing…" : "Sync all"}
              </button>
              <button onClick={disconnectMicrosoft} style={dangerBtn}>Disconnect</button>
            </>
          ) : (
            <button onClick={connectMicrosoft} style={connectBtn("#00A4EF")}>
              Connect Microsoft
            </button>
          )}
        </div>

        {openImporter === "microsoft" && mConnected && (
          <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
            <FileImporter provider="microsoft" userId={userId ?? ""} onImported={handleImported} />
          </div>
        )}
      </div>

      {/* ── Chrome Extension ─────────────────────────────────────────────── */}
      <div style={card("rgba(255,255,255,0.07)")}>
        <div style={cardHeader}>
          <div style={{
            width: 42, height: 42, borderRadius: "12px",
            background: "rgba(255,255,255,0.06)",
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          }}>
            <ExtensionIcon />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: "15px", fontWeight: "700", color: "rgba(255,255,255,0.88)", marginBottom: "3px" }}>
              Chrome Extension
            </div>
            <div style={{ fontSize: "12px", color: "rgba(255,255,255,0.36)" }}>
              Chaoxing · Pronote · Moodle · Brightspace · any LMS
            </div>
          </div>
        </div>

        <div style={{ padding: "0 20px 18px" }}>
          <div style={{
            background:   "rgba(255,255,255,0.03)",
            borderRadius: "12px",
            padding:      "14px",
            border:       "1px solid rgba(255,255,255,0.06)",
          }}>
            <ol style={{ margin: 0, padding: "0 0 0 18px", color: "rgba(255,255,255,0.55)", fontSize: "13px", lineHeight: 1.8 }}>
              <li>Install the FschoolAI Chrome extension from the Chrome Web Store</li>
              <li>Click the extension icon → sign in with your FschoolAI account</li>
              <li>Navigate to any file on your LMS platform</li>
              <li>Click <strong style={{ color: "rgba(255,255,255,0.8)" }}>"Import to FschoolAI"</strong> next to any file</li>
            </ol>
            <div style={{ marginTop: "12px", fontSize: "12px", color: "rgba(255,255,255,0.3)" }}>
              Supported: Chaoxing (超星), Pronote, Zhihuishu (智汇树), Moodle, Brightspace, Blackboard
            </div>
          </div>
        </div>
      </div>

      {/* Import success toast */}
      {importToast && (
        <div style={{
          position:     "fixed",
          bottom:       "90px",
          left:         "50%",
          transform:    "translateX(-50%)",
          zIndex:       999,
          padding:      "12px 20px",
          borderRadius: "14px",
          background:   "rgba(10,24,16,0.95)",
          border:       "1px solid rgba(52,199,89,0.25)",
          color:        "#30d158",
          fontSize:     "13px",
          fontWeight:   "600",
          whiteSpace:   "nowrap",
          animation:    "connToastIn 0.3s ease both",
          backdropFilter: "blur(12px)",
          boxShadow:    "0 8px 24px rgba(0,0,0,0.4)",
        }}>
          ✓ Indexed: {importToast.length > 40 ? importToast.slice(0, 37) + "…" : importToast}
        </div>
      )}
    </div>
  );
}

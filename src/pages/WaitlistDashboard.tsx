// WaitlistDashboard.tsx — internal admin dashboard for the launch waitlist.
// Served at https://waitlist.fschoolai.com (routed by hostname in src/index.tsx) and, for
// testing, at /waitlist-dashboard on the main domain.
//
// Data: GET /api/waitlist?action=admin (aggregated server-side with the service key).
// Auth: enter the password once → server mints a signed 30-day token (action=admin-login),
// stored in localStorage and reused until it expires. Auto-refreshes every 30s (silently).
import { useState, useEffect, useCallback, useRef } from "react";
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  Tooltip, CartesianGrid,
} from "recharts";

const TOKEN_STORAGE = "wl_admin_token";  // 30-day session token (localStorage → persists across restarts)
const REFRESH_MS = 30_000;
const FONT = "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', sans-serif";

// ── Apple-light palette (matches the landing) ─────────────────────────────────
const BLUE = "#0071e3";
const INK = "#1d1d1f";
const SUB = "#6e6e73";
const DIM = "#a1a1a6";
const LINE = "#e6e6eb";
const BG = "#f5f5f7";
const CARD = "#ffffff";

type DailyPoint = { date: string; count: number; cumulative: number };
type AdminData = {
  total: number; invited: number; pending: number; referred: number;
  last24h: number; last7d: number; last30d: number;
  bySource: { source: string; count: number }[];
  daily: DailyPoint[];
  recent: { email: string; name: string | null; source: string | null; referred_by: string | null; created_at: string | null; invited: boolean }[];
  generatedAt: string;
};

const fmtDate = (iso: string) => {
  const d = new Date(iso + (iso.length === 10 ? "T00:00:00Z" : ""));
  return isNaN(+d) ? iso : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};
const fmtTime = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(+d) ? "—" : d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
};
const fmtDateTime = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(+d) ? "—" : d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
};

export default function WaitlistDashboard() {
  const [token, setToken] = useState<string>(() => { try { return localStorage.getItem(TOKEN_STORAGE) || ""; } catch { return ""; } });
  const [pwInput, setPwInput] = useState("");
  const [authing, setAuthing] = useState(false);
  const [data, setData] = useState<AdminData | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "error" | "unauthorized">("idle");
  const [errMsg, setErrMsg] = useState("");
  const tokenRef = useRef(token);
  tokenRef.current = token;

  // Load dashboard data with the 30-day token. `silent` = background auto-refresh: keep the
  // current view (no loading flash), tolerate transient errors, only react to a hard 401.
  const load = useCallback(async (tok: string, silent = false) => {
    if (!tok) return;
    if (!silent) { setStatus("loading"); setErrMsg(""); }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    try {
      const res = await fetch("/api/waitlist?action=admin", {
        headers: { Authorization: `Bearer ${tok}` }, signal: ctrl.signal,
      });
      if (res.status === 401) {
        try { localStorage.removeItem(TOKEN_STORAGE); } catch {}
        setToken(""); setStatus("unauthorized"); setErrMsg("Your session expired — enter the password again.");
        return;
      }
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { if (!silent) { setStatus("error"); setErrMsg(body.error || `Request failed (HTTP ${res.status})`); } return; }
      setData(body as AdminData); setStatus("ok");
    } catch (e: any) {
      if (!silent) { setStatus("error"); setErrMsg(e?.name === "AbortError" ? "Timed out — the database may be down. Try again." : (e?.message || "Couldn't reach the server.")); }
    } finally { clearTimeout(timer); }
  }, []);

  useEffect(() => { if (token) load(token); }, [token, load]);

  // Auto-refresh every 30s while signed in and the tab is visible.
  useEffect(() => {
    if (status !== "ok" || !token) return;
    const id = setInterval(() => { if (!document.hidden) load(tokenRef.current, true); }, REFRESH_MS);
    return () => clearInterval(id);
  }, [status, token, load]);

  async function submitPassword() {
    const pw = pwInput.trim();
    if (!pw || authing) return;
    setAuthing(true); setErrMsg("");
    try {
      const res = await fetch("/api/waitlist?action=admin-login", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: pw }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.token) { setStatus("unauthorized"); setErrMsg(body.error || "Wrong password."); return; }
      try { localStorage.setItem(TOKEN_STORAGE, body.token); } catch {}
      setPwInput(""); setStatus("loading"); setToken(body.token);
    } catch {
      setStatus("unauthorized"); setErrMsg("Couldn't reach the server. Try again.");
    } finally { setAuthing(false); }
  }

  function logout() {
    try { localStorage.removeItem(TOKEN_STORAGE); } catch {}
    setToken(""); setData(null); setStatus("unauthorized"); setErrMsg("");
  }

  // ── Access gate ─────────────────────────────────────────────────────────────
  if (!token || status === "unauthorized") {
    return (
      <Shell>
        <div style={{ maxWidth: 360, margin: "16vh auto 0", textAlign: "center", animation: "wlUp .5s ease both" }}>
          <div style={{ width: 46, height: 46, borderRadius: 13, background: BLUE, margin: "0 auto 20px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, fontWeight: 700, color: "#fff", boxShadow: "0 6px 20px rgba(0,113,227,0.30)" }}>W</div>
          <h1 style={{ fontSize: 24, fontWeight: 600, letterSpacing: "-0.02em", margin: "0 0 6px", color: INK }}>Waitlist dashboard</h1>
          <p style={{ fontSize: 14, color: SUB, margin: "0 0 24px", lineHeight: 1.5 }}>Enter the password to continue.</p>
          <input
            type="password" value={pwInput} autoFocus
            onChange={e => setPwInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && submitPassword()}
            placeholder="Password"
            style={{ width: "100%", boxSizing: "border-box", background: CARD, border: `1px solid ${LINE}`, borderRadius: 12, padding: "13px 16px", color: INK, fontSize: 15, fontFamily: FONT, outline: "none", marginBottom: 12, transition: "border-color .15s, box-shadow .15s" }}
            onFocus={e => { e.currentTarget.style.borderColor = BLUE; e.currentTarget.style.boxShadow = "0 0 0 4px rgba(0,113,227,0.10)"; }}
            onBlur={e => { e.currentTarget.style.borderColor = LINE; e.currentTarget.style.boxShadow = "none"; }}
          />
          <button onClick={submitPassword} disabled={authing} style={{ width: "100%", background: BLUE, color: "#fff", border: "none", borderRadius: 12, padding: "13px", fontSize: 15, fontWeight: 500, cursor: authing ? "default" : "pointer", opacity: authing ? 0.6 : 1, fontFamily: FONT }}>{authing ? "Checking…" : "Open dashboard"}</button>
          <p style={{ fontSize: 12, color: DIM, marginTop: 14 }}>Stays signed in on this device for 30 days.</p>
          {status === "unauthorized" && errMsg && <p style={{ color: "#e5484d", fontSize: 13, marginTop: 8 }}>{errMsg}</p>}
        </div>
      </Shell>
    );
  }

  if (status === "loading" || status === "idle") return <Shell><Centered>Loading waitlist…</Centered></Shell>;
  if (status === "error") {
    return <Shell><Centered>
      <p style={{ color: "#e5484d", marginBottom: 14 }}>{errMsg}</p>
      <button onClick={() => load(token)} style={btnGhost}>Retry</button>
    </Centered></Shell>;
  }
  if (!data) return <Shell><Centered>No data.</Centered></Shell>;

  const maxSource = Math.max(1, ...data.bySource.map(s => s.count));

  return (
    <Shell>
      <div style={{ maxWidth: 1120, margin: "0 auto", padding: "28px 20px 80px", animation: "wlUp .5s ease both" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 28 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 34, height: 34, borderRadius: 9, background: BLUE, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, fontWeight: 700, color: "#fff" }}>W</div>
            <div>
              <h1 style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.02em", margin: 0, color: INK }}>Waitlist</h1>
              <p style={{ fontSize: 12, color: DIM, margin: "2px 0 0", display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#34c759", animation: "wlPulse 2s ease-in-out infinite" }} />
                Live · updated {fmtTime(data.generatedAt)}
              </p>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => load(token)} style={btnGhost}>↻ Refresh</button>
            <button onClick={logout} style={btnGhost}>Sign out</button>
          </div>
        </div>

        {/* Stat cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 22 }}>
          <Stat label="Total signups" value={data.total} accent />
          <Stat label="Last 24 hours" value={data.last24h} delta />
          <Stat label="Last 7 days" value={data.last7d} delta />
          <Stat label="Pending" value={data.pending} />
          <Stat label="Invited" value={data.invited} />
          <Stat label="Referred" value={data.referred} />
        </div>

        {data.total === 0 ? (
          <Card><Centered small>No signups yet. This fills in as people join the waitlist.</Centered></Card>
        ) : (
          <>
            <Card title="Cumulative signups">
              <div style={{ height: 260 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data.daily} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                    <defs>
                      <linearGradient id="wlFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={BLUE} stopOpacity={0.22} />
                        <stop offset="100%" stopColor={BLUE} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke={LINE} vertical={false} />
                    <XAxis dataKey="date" tickFormatter={fmtDate} tick={axisTick} stroke={LINE} minTickGap={28} />
                    <YAxis allowDecimals={false} tick={axisTick} stroke={LINE} width={44} />
                    <Tooltip {...tooltipProps} labelFormatter={(l) => fmtDate(String(l))} />
                    <Area type="monotone" dataKey="cumulative" name="Total" stroke={BLUE} strokeWidth={2} fill="url(#wlFill)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card title="Signups per day">
              <div style={{ height: 220 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.daily} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                    <CartesianGrid stroke={LINE} vertical={false} />
                    <XAxis dataKey="date" tickFormatter={fmtDate} tick={axisTick} stroke={LINE} minTickGap={28} />
                    <YAxis allowDecimals={false} tick={axisTick} stroke={LINE} width={44} />
                    <Tooltip {...tooltipProps} cursor={{ fill: "rgba(0,113,227,0.05)" }} labelFormatter={(l) => fmtDate(String(l))} />
                    <Bar dataKey="count" name="Signups" fill={BLUE} radius={[3, 3, 0, 0]} maxBarSize={40} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card title="By source">
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {data.bySource.map(s => (
                  <div key={s.source} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span style={{ width: 130, flexShrink: 0, fontSize: 13, color: SUB, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.source}</span>
                    <div style={{ flex: 1, height: 8, background: "#ececed", borderRadius: 20, overflow: "hidden" }}>
                      <div style={{ width: `${(s.count / maxSource) * 100}%`, height: "100%", background: BLUE, borderRadius: 20 }} />
                    </div>
                    <span style={{ width: 44, textAlign: "right", fontSize: 13, fontWeight: 600, color: INK, fontVariantNumeric: "tabular-nums" }}>{s.count}</span>
                  </div>
                ))}
              </div>
            </Card>

            <Card title="Recent signups">
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ color: DIM, textAlign: "left" }}>
                      {["Email", "Name", "Source", "Joined", "Status"].map(h => (
                        <th key={h} style={{ padding: "8px 12px", fontWeight: 500, borderBottom: `1px solid ${LINE}`, whiteSpace: "nowrap" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.recent.map((r, i) => (
                      <tr key={i} style={{ color: INK }}>
                        <td style={{ padding: "9px 12px", borderBottom: `1px solid ${LINE}`, whiteSpace: "nowrap" }}>{r.email}</td>
                        <td style={{ padding: "9px 12px", borderBottom: `1px solid ${LINE}`, color: SUB }}>{r.name || "—"}</td>
                        <td style={{ padding: "9px 12px", borderBottom: `1px solid ${LINE}`, color: SUB }}>{r.source || "—"}</td>
                        <td style={{ padding: "9px 12px", borderBottom: `1px solid ${LINE}`, color: SUB, whiteSpace: "nowrap" }}>{fmtDateTime(r.created_at)}</td>
                        <td style={{ padding: "9px 12px", borderBottom: `1px solid ${LINE}` }}>
                          <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 20, background: r.invited ? "rgba(52,199,89,0.12)" : "#f0f0f2", color: r.invited ? "#248a3d" : SUB }}>{r.invited ? "invited" : "pending"}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        )}
      </div>
    </Shell>
  );
}

// ── Presentational helpers ────────────────────────────────────────────────────
const axisTick = { fill: DIM, fontSize: 11 };
const tooltipProps = {
  contentStyle: { background: CARD, border: `1px solid ${LINE}`, borderRadius: 10, fontSize: 12, color: INK, boxShadow: "0 4px 16px rgba(0,0,0,0.08)" },
  labelStyle: { color: SUB },
  cursor: { stroke: LINE },
};
const btnGhost: React.CSSProperties = {
  background: CARD, border: `1px solid ${LINE}`, color: INK,
  borderRadius: 10, padding: "8px 16px", fontSize: 13, fontWeight: 500, cursor: "pointer", fontFamily: FONT,
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100dvh", background: BG, color: INK, fontFamily: FONT, WebkitFontSmoothing: "antialiased" as any }}>
      <style>{`
        @keyframes wlUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
        @keyframes wlPulse{0%,100%{opacity:1}50%{opacity:0.35}}
      `}</style>
      {children}
    </div>
  );
}
function Centered({ children, small }: { children: React.ReactNode; small?: boolean }) {
  return <div style={{ minHeight: small ? 160 : "60vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: SUB, fontSize: 14, textAlign: "center", padding: 24 }}>{children}</div>;
}
function Card({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div style={{ background: CARD, border: `1px solid ${LINE}`, borderRadius: 16, padding: "18px 20px", marginBottom: 16, boxShadow: "0 1px 2px rgba(0,0,0,0.03), 0 1px 3px rgba(0,0,0,0.04)" }}>
      {title && <h2 style={{ fontSize: 14, fontWeight: 600, color: INK, margin: "0 0 16px", letterSpacing: "-0.01em" }}>{title}</h2>}
      {children}
    </div>
  );
}
function Stat({ label, value, accent, delta }: { label: string; value: number; accent?: boolean; delta?: boolean }) {
  return (
    <div style={{ background: accent ? "rgba(0,113,227,0.06)" : CARD, border: `1px solid ${accent ? "rgba(0,113,227,0.22)" : LINE}`, borderRadius: 14, padding: "16px 18px", boxShadow: accent ? "none" : "0 1px 2px rgba(0,0,0,0.03)" }}>
      <p style={{ fontSize: 12, color: SUB, margin: "0 0 8px", letterSpacing: "0.01em" }}>{label}</p>
      <p style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-0.03em", margin: 0, color: accent ? BLUE : INK, fontVariantNumeric: "tabular-nums" }}>
        {delta && value > 0 ? "+" : ""}{value.toLocaleString()}
      </p>
    </div>
  );
}

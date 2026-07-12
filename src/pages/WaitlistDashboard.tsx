// WaitlistDashboard.tsx — internal admin dashboard for the launch waitlist.
// Served at https://waitlist.fschoolai.com (routed by hostname in src/index.tsx) and, for
// testing before DNS, at /waitlist-dashboard on the main domain.
//
// Data comes from GET /api/waitlist?action=admin, which aggregates server-side with the
// service key and is gated by Bearer CRON_SECRET — so this page prompts for that key once
// (kept in sessionStorage) and never touches the DB directly. Emails are shown here because
// this surface is behind the admin key.
import { useState, useEffect, useCallback } from "react";
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  Tooltip, CartesianGrid,
} from "recharts";

const KEY_STORAGE = "wl_admin_key";
const GOLD = "#C49A3C";
const FONT = "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', sans-serif";

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
const fmtDateTime = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(+d) ? "—" : d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
};

export default function WaitlistDashboard() {
  const [key, setKey] = useState<string>(() => { try { return sessionStorage.getItem(KEY_STORAGE) || ""; } catch { return ""; } });
  const [keyInput, setKeyInput] = useState("");
  const [data, setData] = useState<AdminData | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "error" | "unauthorized">("idle");
  const [errMsg, setErrMsg] = useState("");

  const load = useCallback(async (k: string) => {
    if (!k) return;
    setStatus("loading"); setErrMsg("");
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    try {
      const res = await fetch("/api/waitlist?action=admin", {
        headers: { Authorization: `Bearer ${k}` }, signal: ctrl.signal,
      });
      if (res.status === 401) {
        setStatus("unauthorized"); setErrMsg("That access key was rejected.");
        try { sessionStorage.removeItem(KEY_STORAGE); } catch {}
        setKey("");
        return;
      }
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setStatus("error"); setErrMsg(body.error || `Request failed (HTTP ${res.status})`); return; }
      setData(body as AdminData); setStatus("ok");
    } catch (e: any) {
      setStatus("error");
      setErrMsg(e?.name === "AbortError" ? "Timed out — the database may be down. Try again." : (e?.message || "Couldn't reach the server."));
    } finally { clearTimeout(timer); }
  }, []);

  useEffect(() => { if (key) load(key); }, [key, load]);

  function submitKey() {
    const k = keyInput.trim();
    if (!k) return;
    try { sessionStorage.setItem(KEY_STORAGE, k); } catch {}
    setKey(k);
  }

  // ── Access gate ─────────────────────────────────────────────────────────────
  if (!key || status === "unauthorized") {
    return (
      <Shell>
        <div style={{ maxWidth: 380, margin: "18vh auto 0", textAlign: "center", animation: "wlUp .5s ease both" }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, background: GOLD, margin: "0 auto 20px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, fontWeight: 700, color: "#111" }}>W</div>
          <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em", margin: "0 0 6px", color: "#f5f5f7" }}>Waitlist dashboard</h1>
          <p style={{ fontSize: 14, color: "rgba(255,255,255,0.45)", margin: "0 0 22px", lineHeight: 1.5 }}>Enter the admin access key to continue.</p>
          <input
            type="password" value={keyInput} autoFocus
            onChange={e => setKeyInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && submitKey()}
            placeholder="Access key"
            style={{ width: "100%", boxSizing: "border-box", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12, padding: "13px 16px", color: "#f5f5f7", fontSize: 15, fontFamily: FONT, outline: "none", marginBottom: 12 }}
          />
          <button onClick={submitKey} style={{ width: "100%", background: GOLD, color: "#111", border: "none", borderRadius: 12, padding: "13px", fontSize: 15, fontWeight: 600, cursor: "pointer", fontFamily: FONT }}>Open dashboard</button>
          {status === "unauthorized" && <p style={{ color: "#ff6b60", fontSize: 13, marginTop: 14 }}>{errMsg}</p>}
        </div>
      </Shell>
    );
  }

  if (status === "loading" || status === "idle") {
    return <Shell><Centered>Loading waitlist…</Centered></Shell>;
  }
  if (status === "error") {
    return <Shell><Centered>
      <p style={{ color: "#ff6b60", marginBottom: 14 }}>{errMsg}</p>
      <button onClick={() => load(key)} style={btnGhost}>Retry</button>
    </Centered></Shell>;
  }
  if (!data) return <Shell><Centered>No data.</Centered></Shell>;

  const growth = data.daily.length
    ? Math.round(((data.last7d) / Math.max(1, data.total - data.last7d)) * 100)
    : 0;
  const maxSource = Math.max(1, ...data.bySource.map(s => s.count));

  return (
    <Shell>
      <div style={{ maxWidth: 1120, margin: "0 auto", padding: "28px 20px 80px", animation: "wlUp .5s ease both" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 28 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 34, height: 34, borderRadius: 9, background: GOLD, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, fontWeight: 700, color: "#111" }}>W</div>
            <div>
              <h1 style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.02em", margin: 0, color: "#f5f5f7" }}>Waitlist</h1>
              <p style={{ fontSize: 12, color: "rgba(255,255,255,0.38)", margin: "2px 0 0" }}>Updated {fmtDateTime(data.generatedAt)}</p>
            </div>
          </div>
          <button onClick={() => load(key)} style={btnGhost}>↻ Refresh</button>
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
            {/* Cumulative growth */}
            <Card title="Cumulative signups">
              <div style={{ height: 260 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data.daily} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                    <defs>
                      <linearGradient id="wlFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={GOLD} stopOpacity={0.35} />
                        <stop offset="100%" stopColor={GOLD} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                    <XAxis dataKey="date" tickFormatter={fmtDate} tick={axisTick} stroke="rgba(255,255,255,0.15)" minTickGap={28} />
                    <YAxis allowDecimals={false} tick={axisTick} stroke="rgba(255,255,255,0.15)" width={44} />
                    <Tooltip {...tooltipProps} labelFormatter={(l) => fmtDate(String(l))} />
                    <Area type="monotone" dataKey="cumulative" name="Total" stroke={GOLD} strokeWidth={2} fill="url(#wlFill)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Card>

            {/* Daily signups */}
            <Card title="Signups per day">
              <div style={{ height: 220 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.daily} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                    <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                    <XAxis dataKey="date" tickFormatter={fmtDate} tick={axisTick} stroke="rgba(255,255,255,0.15)" minTickGap={28} />
                    <YAxis allowDecimals={false} tick={axisTick} stroke="rgba(255,255,255,0.15)" width={44} />
                    <Tooltip {...tooltipProps} cursor={{ fill: "rgba(255,255,255,0.04)" }} labelFormatter={(l) => fmtDate(String(l))} />
                    <Bar dataKey="count" name="Signups" fill={GOLD} radius={[3, 3, 0, 0]} maxBarSize={40} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>

            {/* Source breakdown */}
            <Card title="By source">
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {data.bySource.map(s => (
                  <div key={s.source} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span style={{ width: 130, flexShrink: 0, fontSize: 13, color: "rgba(255,255,255,0.7)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.source}</span>
                    <div style={{ flex: 1, height: 8, background: "rgba(255,255,255,0.05)", borderRadius: 20, overflow: "hidden" }}>
                      <div style={{ width: `${(s.count / maxSource) * 100}%`, height: "100%", background: GOLD, borderRadius: 20 }} />
                    </div>
                    <span style={{ width: 44, textAlign: "right", fontSize: 13, fontWeight: 600, color: "#f5f5f7", fontVariantNumeric: "tabular-nums" }}>{s.count}</span>
                  </div>
                ))}
              </div>
            </Card>

            {/* Recent signups */}
            <Card title="Recent signups">
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ color: "rgba(255,255,255,0.4)", textAlign: "left" }}>
                      {["Email", "Name", "Source", "Joined", "Status"].map(h => (
                        <th key={h} style={{ padding: "8px 12px", fontWeight: 500, borderBottom: "1px solid rgba(255,255,255,0.08)", whiteSpace: "nowrap" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.recent.map((r, i) => (
                      <tr key={i} style={{ color: "rgba(255,255,255,0.82)" }}>
                        <td style={{ padding: "9px 12px", borderBottom: "1px solid rgba(255,255,255,0.05)", whiteSpace: "nowrap" }}>{r.email}</td>
                        <td style={{ padding: "9px 12px", borderBottom: "1px solid rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.5)" }}>{r.name || "—"}</td>
                        <td style={{ padding: "9px 12px", borderBottom: "1px solid rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.5)" }}>{r.source || "—"}</td>
                        <td style={{ padding: "9px 12px", borderBottom: "1px solid rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.5)", whiteSpace: "nowrap" }}>{fmtDateTime(r.created_at)}</td>
                        <td style={{ padding: "9px 12px", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                          <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 20, background: r.invited ? "rgba(52,199,89,0.14)" : "rgba(255,255,255,0.06)", color: r.invited ? "#4ade80" : "rgba(255,255,255,0.45)" }}>{r.invited ? "invited" : "pending"}</span>
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

// ── Small presentational helpers ──────────────────────────────────────────────
const axisTick = { fill: "rgba(255,255,255,0.4)", fontSize: 11 };
const tooltipProps = {
  contentStyle: { background: "rgba(20,20,24,0.96)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, fontSize: 12, color: "#f5f5f7" },
  labelStyle: { color: "rgba(255,255,255,0.5)" },
  cursor: { stroke: "rgba(255,255,255,0.12)" },
};
const btnGhost: React.CSSProperties = {
  background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", color: "#f5f5f7",
  borderRadius: 10, padding: "8px 16px", fontSize: 13, fontWeight: 500, cursor: "pointer", fontFamily: FONT,
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100dvh", background: "#0b0b0d", color: "#f5f5f7", fontFamily: FONT }}>
      <style>{`@keyframes wlUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}`}</style>
      {children}
    </div>
  );
}
function Centered({ children, small }: { children: React.ReactNode; small?: boolean }) {
  return <div style={{ minHeight: small ? 160 : "60vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "rgba(255,255,255,0.45)", fontSize: 14, textAlign: "center", padding: 24 }}>{children}</div>;
}
function Card({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16, padding: "18px 20px", marginBottom: 16 }}>
      {title && <h2 style={{ fontSize: 14, fontWeight: 600, color: "rgba(255,255,255,0.85)", margin: "0 0 16px", letterSpacing: "-0.01em" }}>{title}</h2>}
      {children}
    </div>
  );
}
function Stat({ label, value, accent, delta }: { label: string; value: number; accent?: boolean; delta?: boolean }) {
  return (
    <div style={{ background: accent ? "rgba(196,154,60,0.10)" : "rgba(255,255,255,0.03)", border: `1px solid ${accent ? "rgba(196,154,60,0.28)" : "rgba(255,255,255,0.08)"}`, borderRadius: 14, padding: "16px 18px" }}>
      <p style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", margin: "0 0 8px", letterSpacing: "0.01em" }}>{label}</p>
      <p style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-0.03em", margin: 0, color: accent ? GOLD : "#f5f5f7", fontVariantNumeric: "tabular-nums" }}>
        {delta && value > 0 ? "+" : ""}{value.toLocaleString()}
      </p>
    </div>
  );
}

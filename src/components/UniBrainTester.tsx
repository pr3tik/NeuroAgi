// UniBrainTester — isolated test panel for the University Brain prototype.
// Hits POST /api/university-brain directly (no Reggie in the middle) so you can verify
// the raw contract: contribute published course artifacts from one account, then read
// them back from a DIFFERENT account ("act as" switcher) — the cross-account property
// the whole feature exists to prove. Temporary dev surface; re-gate before launch,
// same as ReggieTester.
import { useState } from "react";
import { useApp } from "../context/AppContext";

const TEST_ACCOUNT = "8c59869c-4448-4a36-80cc-66543b215a43"; // "Curl Contract Tester" — shared test account

interface LogEntry { label: string; ok: boolean; body: any; at: string; }

export default function UniBrainTester() {
  const { userId } = useApp();
  const [open, setOpen] = useState(false);
  const [actAs, setActAs] = useState<string>("");            // empty = the logged-in user
  const [course, setCourse] = useState("");
  const [professor, setProfessor] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);

  const effectiveUser = actAs.trim() || userId || "";

  async function callBrain(action: "contribute" | "profile", body: Record<string, any>, label: string) {
    if (!effectiveUser) { setLog((l) => [{ label, ok: false, body: { error: "No userId — log in or fill 'act as'." }, at: now() }, ...l]); return; }
    setBusy(label);
    try {
      const res = await fetch(`/api/university-brain?action=${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: effectiveUser, ...body }),
      });
      const json = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      setLog((l) => [{ label, ok: res.ok && json?.error == null, body: json, at: now() }, ...l].slice(0, 12));
    } catch (e: any) {
      setLog((l) => [{ label, ok: false, body: { error: e?.message ?? "request failed" }, at: now() }, ...l]);
    } finally {
      setBusy(null);
    }
  }

  const now = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  const C = {
    bg: "#0f1115", panel: "#171a21", border: "1px solid rgba(255,255,255,0.1)", text: "#e8e8ea",
    dim: "rgba(255,255,255,0.5)", accent: "#e8b34b", ok: "#30d158", err: "#ff6b5a",
  };
  const inputStyle: any = { flex: 1, background: C.panel, border: C.border, borderRadius: 8, padding: "8px 10px", color: C.text, fontSize: 12.5, outline: "none", fontFamily: "inherit", minWidth: 0 };
  const btnStyle = (disabled: boolean): any => ({ background: disabled ? "rgba(232,179,75,0.35)" : C.accent, color: "#151004", border: "none", borderRadius: 8, padding: "8px 12px", fontSize: 12.5, fontWeight: 700, cursor: disabled ? "default" : "pointer", fontFamily: "inherit", whiteSpace: "nowrap" });

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} title="Test the University Brain (isolated — no Reggie)"
        style={{ position: "fixed", left: 16, bottom: 68, zIndex: 99998, background: C.panel, color: C.text, border: C.border, borderRadius: 999, padding: "10px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer", boxShadow: "0 6px 24px rgba(0,0,0,0.4)", fontFamily: "inherit" }}>
        🎓 UniBrain
      </button>
    );
  }

  return (
    <div style={{ position: "fixed", left: 16, bottom: 16, zIndex: 99999, width: 430, maxWidth: "94vw", maxHeight: "80vh", background: C.bg, border: C.border, borderRadius: 14, display: "flex", flexDirection: "column", boxShadow: "0 12px 48px rgba(0,0,0,0.5)", fontFamily: "inherit", color: C.text }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", borderBottom: C.border }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>🎓 University Brain <span style={{ color: C.dim, fontWeight: 500 }}>· /api/university-brain (isolated)</span></div>
        <div>
          <button onClick={() => setLog([])} style={{ background: "none", border: "none", color: C.dim, cursor: "pointer", fontSize: 12, marginRight: 8 }}>clear</button>
          <button onClick={() => setOpen(false)} style={{ background: "none", border: "none", color: C.dim, cursor: "pointer", fontSize: 18, lineHeight: 1 }}>×</button>
        </div>
      </div>

      <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 10, overflowY: "auto" }}>
        {/* Act-as switcher — THE cross-account test control */}
        <div>
          <div style={{ fontSize: 10.5, color: C.dim, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 4 }}>Acting as</div>
          <div style={{ display: "flex", gap: 6 }}>
            <input value={actAs} onChange={(e) => setActAs(e.target.value)} placeholder={userId ? `${userId.slice(0, 8)}… (you)` : "paste a users.id uuid"} style={inputStyle} />
            <button onClick={() => setActAs("")} title="Use the logged-in account" style={{ ...btnStyle(false), background: "rgba(255,255,255,0.08)", color: C.text, fontWeight: 500 }}>me</button>
            <button onClick={() => setActAs(TEST_ACCOUNT)} title="Use the shared test account (never contributed, no Canvas)" style={{ ...btnStyle(false), background: "rgba(255,255,255,0.08)", color: C.text, fontWeight: 500 }}>test acct</button>
          </div>
          <div style={{ fontSize: 11, color: C.dim, marginTop: 4 }}>
            The point of the demo: <b>contribute as "me"</b>, then switch to <b>"test acct"</b> and read the same data back — a completely different account.
          </div>
        </div>

        {/* Contribute */}
        <div style={{ background: "rgba(255,255,255,0.03)", border: C.border, borderRadius: 10, padding: 10 }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 6 }}>1 · Contribute <span style={{ color: C.dim, fontWeight: 400 }}>(needs Canvas on the acting account — pulls syllabus, teachers, grading weights)</span></div>
          <div style={{ display: "flex", gap: 6 }}>
            <input value={course} onChange={(e) => setCourse(e.target.value)} placeholder="course name, code, or Canvas id — e.g. 423038" style={inputStyle}
              onKeyDown={(e) => { if (e.key === "Enter" && course.trim()) callBrain("contribute", { course: course.trim() }, `contribute ${course.trim()}`); }} />
            <button disabled={!!busy || !course.trim()} onClick={() => callBrain("contribute", { course: course.trim() }, `contribute ${course.trim()}`)} style={btnStyle(!!busy || !course.trim())}>
              {busy?.startsWith("contribute") ? "…" : "Contribute"}
            </button>
          </div>
        </div>

        {/* Profile */}
        <div style={{ background: "rgba(255,255,255,0.03)", border: C.border, borderRadius: 10, padding: 10 }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 6 }}>2 · Read the global profile <span style={{ color: C.dim, fontWeight: 400 }}>(works for ANY account — by course or professor)</span></div>
          <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
            <input value={course} onChange={(e) => setCourse(e.target.value)} placeholder="course (uses the same box as above)" style={inputStyle} />
            <button disabled={!!busy || !course.trim()} onClick={() => callBrain("profile", { course: course.trim() }, `profile course ${course.trim()}`)} style={btnStyle(!!busy || !course.trim())}>
              By course
            </button>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <input value={professor} onChange={(e) => setProfessor(e.target.value)} placeholder="professor name — e.g. Kepe" style={inputStyle}
              onKeyDown={(e) => { if (e.key === "Enter" && professor.trim()) callBrain("profile", { professor: professor.trim() }, `profile prof ${professor.trim()}`); }} />
            <button disabled={!!busy || !professor.trim()} onClick={() => callBrain("profile", { professor: professor.trim() }, `profile prof ${professor.trim()}`)} style={btnStyle(!!busy || !professor.trim())}>
              By professor
            </button>
          </div>
        </div>

        {/* Results log */}
        {log.length === 0 && <div style={{ color: C.dim, fontSize: 12, lineHeight: 1.5 }}>No calls yet. Try: contribute <b>423038</b> as yourself, then read it back as the test account.</div>}
        {log.map((e, i) => (
          <div key={i} style={{ border: C.border, borderRadius: 10, padding: 9, background: e.ok ? "rgba(48,209,88,0.05)" : "rgba(255,107,90,0.06)" }}>
            <div style={{ fontSize: 11, marginBottom: 5 }}>
              <span style={{ color: e.ok ? C.ok : C.err, fontWeight: 700 }}>{e.ok ? "✓" : "✗"}</span>{" "}
              <span style={{ fontWeight: 600 }}>{e.label}</span>
              <span style={{ color: C.dim }}> · as {effectiveUser === TEST_ACCOUNT ? "test acct" : (actAs ? actAs.slice(0, 8) + "…" : "me")} · {e.at}</span>
            </div>
            {/* Friendly summary for profile hits */}
            {e.body?.found && (
              <div style={{ fontSize: 12, lineHeight: 1.55, marginBottom: 5 }}>
                {e.body.professors?.length > 0 && <div>👤 <b>{e.body.professors.join(", ")}</b></div>}
                {(e.body.facts ?? []).slice(0, 5).map((f: string, j: number) => <div key={j}>• {f}</div>)}
                {(e.body.summaries ?? []).slice(0, 2).map((s: string, j: number) => <div key={j} style={{ color: C.dim }}>“{s.slice(0, 140)}”</div>)}
                {e.body.crowd && <div style={{ color: C.dim }}>📊 {e.body.crowd.artifactCount} artifact(s) · seen by up to {e.body.crowd.maxSeenBy} student(s)</div>}
              </div>
            )}
            {e.body?.contributed && (
              <div style={{ fontSize: 12, lineHeight: 1.55, marginBottom: 5 }}>
                {e.body.professor && <div>👤 professor detected: <b>{e.body.professor}</b></div>}
                {e.body.contributed.length === 0
                  ? <div style={{ color: C.dim }}>{e.body.note ?? "nothing to contribute"}</div>
                  : e.body.contributed.map((c: any, j: number) => <div key={j}>• {c.type} — {c.deduped ? "already known (crowd +1)" : "NEW contribution"}</div>)}
              </div>
            )}
            <details>
              <summary style={{ fontSize: 10.5, color: C.dim, cursor: "pointer" }}>raw JSON</summary>
              <pre style={{ fontSize: 10, fontFamily: "ui-monospace, monospace", whiteSpace: "pre-wrap", wordBreak: "break-word", background: "rgba(255,255,255,0.04)", borderRadius: 6, padding: 6, margin: "4px 0 0", maxHeight: 180, overflowY: "auto" }}>{JSON.stringify(e.body, null, 1)}</pre>
            </details>
          </div>
        ))}
      </div>
    </div>
  );
}

// LectureUpload.tsx — Upload a lecture recording and run it through the Digest
// Lecture pipeline (api/digest-lecture.ts): sign → upload straight to Storage →
// start (transcribe → detect emphasis → generate digest). Mirrors DocUpload.tsx's
// sign/uploadToSignedUrl pattern (see api/transcribe.ts).

import { useRef, useState } from "react";
import { supabase } from "../api/supabase";
import { Upload, Loader2 } from "lucide-react";

const ACCEPT = ".mp3,.wav,.m4a,.mp4,.mov,.webm,.aac";
const STAGES: Record<string, string> = {
  uploading:   "Uploading…",
  transcribing:"Transcribing…",
  emphasizing: "Detecting emphasis…",
  digesting:   "Generating digest…",
};

interface Props {
  userId: string;
  courseId: string | null;
  onDone: (digest: any) => void;
}

export default function LectureUpload({ userId, courseId, onDone }: Props) {
  const [stage, setStage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setError(null);
    setStage("uploading");
    try {
      const sres = await fetch("/api/digest-lecture?action=sign", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, filename: file.name }),
      });
      const sdata = await sres.json().catch(() => ({}));
      if (!sres.ok || !sdata.path || !sdata.token) throw new Error(sdata.error || "Couldn't start the upload.");

      const up = await supabase.storage.from("media-uploads").uploadToSignedUrl(sdata.path, sdata.token, file);
      if (up.error) throw new Error(up.error.message);

      // Scribe + Haiku + Sonnet run synchronously server-side; this can take a while
      // for long lectures, so the stage label just tells the student what's likely
      // happening — the real signal is the response, not incremental progress events.
      setStage("transcribing");
      const t1 = setTimeout(() => setStage("emphasizing"), 15000);
      const t2 = setTimeout(() => setStage("digesting"), 30000);

      const stres = await fetch("/api/digest-lecture?action=start", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, storagePath: sdata.path, title: file.name, courseId: courseId || null }),
      });
      clearTimeout(t1); clearTimeout(t2);
      const stdata = await stres.json().catch(() => ({}));
      if (!stres.ok || !stdata.jobId) throw new Error(stdata.error || "Couldn't start the digest.");
      if (stdata.status === "error") throw new Error(stdata.error || "Digest generation failed.");

      setStage(null);
      onDone({ id: stdata.jobId, title: file.name, ...stdata.digest, status: "done" });
    } catch (e: any) {
      setError(e?.message || String(e));
      setStage(null);
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const busy = stage !== null;

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        style={{ display: "none" }}
        onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
      />
      <button
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        style={{
          width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
          background: busy ? "rgba(0,210,190,0.06)" : "rgba(0,210,190,0.1)",
          border: "1px solid rgba(0,210,190,0.2)", borderRadius: "10px",
          padding: "14px", color: "rgba(0,210,190,0.85)", fontSize: "13px", fontWeight: 500,
          cursor: busy ? "default" : "pointer", fontFamily: "inherit",
        }}
      >
        {busy
          ? <><Loader2 size={15} style={{ animation: "spin 0.7s linear infinite" }} />{STAGES[stage!] ?? "Working…"}</>
          : <><Upload size={15} />Upload lecture recording</>}
      </button>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      {error && <p style={{ color: "#ff6961", fontSize: "12px", marginTop: "8px" }}>{error}</p>}
    </div>
  );
}

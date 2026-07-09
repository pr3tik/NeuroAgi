// api/drive-auth.ts — Google OAuth + Classroom/Drive file access
// (route renamed from /api/lms-google to /api/drive-auth per team convention: <service>-auth)
//
// GET  ?action=auth&userId=...          → 302 to Google OAuth consent
// GET  ?action=callback&code=...&state= → exchange code, store refresh_token, 302 to /?lms=google_connected
// GET  ?action=status&userId=...        → { connected: bool, connectedAt }
// GET  ?action=list&userId=...          → { courses: [{ courseId, courseName, files: [...] }] }
// POST ?action=fetch                    → { userId, driveFileId, name, mimeType?, courseId? } → { ok, documentId }
// POST ?action=disconnect               → { userId } → revoke + delete

import { createClient } from "@supabase/supabase-js";
import { ingestLmsFile } from "./lms-ingest.js";

let _sb: any = null;
function sb() {
  if (_sb) return _sb;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase env vars not configured");
  _sb = createClient(url, key);
  return _sb;
}

// Classroom sync ingests files inline (download → extract → embed), which is slow.
export const config = { maxDuration: 300 };

const clientId     = () => process.env.GOOGLE_CLIENT_ID ?? "";
const clientSecret = () => process.env.GOOGLE_CLIENT_SECRET ?? "";
// The redirect URI must be THIS endpoint's callback and identical on both OAuth legs
// (consent URL + token exchange). Never reuse GOOGLE_REDIRECT_URI — that belongs to
// calendar-auth, and pointing Google there silently swallowed every Drive connect.
// Derive from the request host (works on fschoolai.com, *.vercel.app, and localhost);
// GOOGLE_DRIVE_REDIRECT_URI overrides if ever needed.
function redirectUri(req: any): string {
  if (process.env.GOOGLE_DRIVE_REDIRECT_URI) return process.env.GOOGLE_DRIVE_REDIRECT_URI;
  const host  = String(req?.headers?.["x-forwarded-host"] ?? req?.headers?.host ?? "fschoolai.com");
  const proto = String(req?.headers?.["x-forwarded-proto"] ?? (host.startsWith("localhost") ? "http" : "https"));
  return `${proto}://${host}/api/drive-auth?action=callback`;
}

const SCOPES = [
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/classroom.courses.readonly",
  "https://www.googleapis.com/auth/classroom.coursework.me.readonly",
  "https://www.googleapis.com/auth/classroom.courseworkmaterials.readonly",
].join(" ");

// Map Google native MIME types to exportable Office formats
const GOOGLE_EXPORT_MAP: Record<string, { mime: string }> = {
  "application/vnd.google-apps.document":     { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
  "application/vnd.google-apps.presentation": { mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation" },
  "application/vnd.google-apps.spreadsheet":  { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
  "application/vnd.google-apps.drawing":      { mime: "application/pdf" },
};

async function getAccessToken(userId: string): Promise<string> {
  const { data, error } = await sb()
    .from("user_oauth")
    .select("refresh_token")
    .eq("user_id", userId)
    .eq("provider", "google")
    .maybeSingle();
  if (error || !data) throw new Error("Google account not connected");

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body:    new URLSearchParams({
      client_id:     clientId(),
      client_secret: clientSecret(),
      refresh_token: data.refresh_token,
      grant_type:    "refresh_token",
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Token refresh failed (${res.status}): ${detail.slice(0, 100)}`);
  }
  const json = await res.json();
  if (!json.access_token) throw new Error("No access_token in Google refresh response");
  return json.access_token;
}

function selfBase(): string {
  return process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:5173";
}

// Importable document types for the "My Drive" listing.
const DRIVE_LIST_MIMES = [
  "application/pdf",
  "application/vnd.google-apps.document",
  "application/vnd.google-apps.presentation",
  "application/vnd.google-apps.spreadsheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
];

// Lists the user's own Drive documents (most-recent first). Works for anyone with
// a Drive — unlike Classroom, it doesn't require being enrolled in a course.
async function listDriveFiles(accessToken: string): Promise<any[]> {
  const q = `trashed = false and (${DRIVE_LIST_MIMES.map(m => `mimeType = '${m}'`).join(" or ")})`;
  const url = new URL("https://www.googleapis.com/drive/v3/files");
  url.searchParams.set("q", q);
  url.searchParams.set("orderBy", "modifiedTime desc");
  url.searchParams.set("pageSize", "100");
  url.searchParams.set("fields", "files(id,name,mimeType)");
  url.searchParams.set("spaces", "drive");

  const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Drive (${res.status})${detail.includes("disabled") ? " — Drive API not enabled" : ""}`);
  }
  const { files = [] } = await res.json();
  return files.map((f: any) => ({
    driveFileId: f.id,
    name:        f.name,
    mimeType:    f.mimeType ?? null,
    source:      "drive",
  }));
}

// ── Shared Drive byte-fetch + ingest (used by ?action=fetch and ?action=sync) ─
function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

// Download a Drive file's bytes, exporting Google-native docs to Office formats.
async function fetchDriveBytes(accessToken: string, driveFileId: string, mimeType?: string | null) {
  let resolvedMime = mimeType ?? undefined;
  if (!resolvedMime) {
    const metaRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${driveFileId}?fields=id,name,mimeType`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    resolvedMime = metaRes.ok ? ((await metaRes.json()).mimeType ?? "application/octet-stream") : "application/octet-stream";
  }
  let downloadUrl: string;
  let finalMime = resolvedMime as string;
  if (resolvedMime && GOOGLE_EXPORT_MAP[resolvedMime]) {
    finalMime   = GOOGLE_EXPORT_MAP[resolvedMime].mime;
    downloadUrl = `https://www.googleapis.com/drive/v3/files/${driveFileId}/export?mimeType=${encodeURIComponent(finalMime)}`;
  } else {
    downloadUrl = `https://www.googleapis.com/drive/v3/files/${driveFileId}?alt=media`;
  }
  const fileRes = await fetch(downloadUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!fileRes.ok) throw new Error(`Drive download failed (${fileRes.status})`);
  const bytes = Buffer.from(await fileRes.arrayBuffer());
  if (bytes.length > 50 * 1024 * 1024) throw new Error("File too large (max 50 MB)");
  return { bytes, finalMime, sourceUrl: `https://drive.google.com/file/d/${driveFileId}` };
}

// Push bytes through the unified ingest pipeline — DIRECT call (no internal HTTP hop,
// so Vercel's 4.5MB body limit never applies to server-fetched Drive files).
async function ingestBytes(userId: string, courseId: string | null, name: string, mimeType: string, bytes: Buffer, sourceUrl: string) {
  const result = await ingestLmsFile({
    userId, courseId: courseId ?? null,
    file: { name, mimeType, bytes, sourceUrl, provider: "google" },
  });
  if (result.status !== 200) throw new Error(result.json?.error ?? "lms-ingest failed");
  return result.json;
}

// Build a due_at ISO string from Classroom's split {dueDate,dueTime}. Classroom omits
// dueTime for all-day due dates → default to end-of-day so it isn't treated as midnight-past.
function classroomDueAt(cw: any): string | null {
  if (!cw?.dueDate?.year) return null;
  const d = cw.dueDate, t = cw.dueTime ?? {};
  return new Date(Date.UTC(d.year, (d.month ?? 1) - 1, d.day ?? 1, t.hours ?? 23, t.minutes ?? 59)).toISOString();
}

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();

  const action = req.query?.action;

  // ── auth ─────────────────────────────────────────────────────────────────
  if (action === "auth") {
    if (!clientId()) return res.status(500).json({ error: "GOOGLE_CLIENT_ID not configured" });
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: "userId required" });

    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id",     clientId());
    url.searchParams.set("redirect_uri",  redirectUri(req));
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope",         SCOPES);
    url.searchParams.set("access_type",   "offline");
    url.searchParams.set("prompt",        "consent"); // always re-prompt to get a refresh_token
    url.searchParams.set("state",         userId);

    res.statusCode = 302;
    res.setHeader("Location", url.toString());
    return res.end();
  }

  // ── callback ──────────────────────────────────────────────────────────────
  if (action === "callback") {
    const { code, state: userId, error: oauthErr } = req.query;
    if (oauthErr || !code || !userId) {
      res.statusCode = 302;
      res.setHeader("Location", "/?lms=google_error");
      return res.end();
    }

    let tokens: any;
    try {
      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method:  "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body:    new URLSearchParams({
          code,
          client_id:     clientId(),
          client_secret: clientSecret(),
          redirect_uri:  redirectUri(req),
          grant_type:    "authorization_code",
        }),
      });
      tokens = await tokenRes.json().catch(() => ({}));
      if (!tokenRes.ok) {
        // Google rejected the code/credentials — surface the REAL reason (e.g.
        // invalid_grant = expired/reused code, invalid_client = bad secret).
        console.error("[drive-auth] token exchange failed", tokenRes.status, tokens?.error, tokens?.error_description);
        res.statusCode = 302;
        res.setHeader("Location", `/?lms=google_error&reason=${encodeURIComponent(tokens?.error ?? "token_exchange_failed")}`);
        return res.end();
      }
    } catch (e: any) {
      console.error("[drive-auth] token exchange threw", e?.message);
      res.statusCode = 302;
      res.setHeader("Location", "/?lms=google_error&reason=network");
      return res.end();
    }

    if (!tokens.refresh_token) {
      // With prompt=consent Google should always return a refresh_token; guard anyway.
      console.error("[drive-auth] no refresh_token in token response:", JSON.stringify(tokens).slice(0, 200));
      res.statusCode = 302;
      res.setHeader("Location", "/?lms=google_error&reason=no_refresh_token");
      return res.end();
    }

    const { error: upsertErr } = await sb().from("user_oauth").upsert({
      user_id:       userId,
      provider:      "google",
      refresh_token: tokens.refresh_token,
      scopes:        SCOPES.split(" "),
      connected_at:  new Date().toISOString(),
    }, { onConflict: "user_id,provider" });

    if (upsertErr) {
      // Don't pretend it worked — a failed save means no token is stored.
      console.error("[drive-auth] upsert error", upsertErr.message);
      res.statusCode = 302;
      res.setHeader("Location", "/?lms=google_error&reason=save_failed");
      return res.end();
    }

    res.statusCode = 302;
    res.setHeader("Location", "/?lms=google_connected");
    return res.end();
  }

  // ── status ────────────────────────────────────────────────────────────────
  if (action === "status") {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: "userId required" });
    const { data } = await sb()
      .from("user_oauth")
      .select("connected_at")
      .eq("user_id", userId)
      .eq("provider", "google")
      .maybeSingle();
    return res.status(200).json({ connected: !!data, connectedAt: data?.connected_at ?? null });
  }

  // ── list ──────────────────────────────────────────────────────────────────
  if (action === "list") {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: "userId required" });

    let accessToken: string;
    try { accessToken = await getAccessToken(userId); }
    catch (e: any) { return res.status(401).json({ error: e.message }); }

    const result: any[] = [];
    const errors: string[] = [];

    // ── My Drive — the user's own documents. Works for everyone (developers +
    //    students who keep notes in Drive rather than Classroom). ─────────────────
    try {
      const driveFiles = await listDriveFiles(accessToken);
      if (driveFiles.length) result.push({ courseName: "My Drive", files: driveFiles });
    } catch (e: any) {
      console.error("[drive-auth]", e.message);
      errors.push(e.message);
    }

    // ── Google Classroom materials — non-fatal (API may be disabled, or the user
    //    may not be enrolled in any active course). ───────────────────────────────
    try {
      const coursesRes = await fetch(
        "https://classroom.googleapis.com/v1/courses?courseStates=ACTIVE&pageSize=30",
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      if (!coursesRes.ok) {
        const detail = await coursesRes.text().catch(() => "");
        console.error("[drive-auth] classroom courses failed", coursesRes.status, detail.slice(0, 400));
        errors.push(`Classroom (${coursesRes.status})${detail.includes("disabled") ? " — Classroom API not enabled" : ""}`);
      } else {
        const { courses: rawCourses = [] } = await coursesRes.json();

        for (const course of rawCourses.slice(0, 20)) {
          const files: any[] = [];

          // courseWork materials
          const cwRes = await fetch(
            `https://classroom.googleapis.com/v1/courses/${course.id}/courseWork?courseWorkStates=PUBLISHED&pageSize=50`,
            { headers: { Authorization: `Bearer ${accessToken}` } },
          ).catch(() => null);

          if (cwRes?.ok) {
            const { courseWork = [] } = await cwRes.json();
            for (const cw of courseWork) {
              for (const m of (cw.materials ?? [])) {
                if (m.driveFile?.driveFile?.id) {
                  const df = m.driveFile.driveFile;
                  files.push({
                    driveFileId: df.id,
                    name:        df.title ?? "Untitled",
                    mimeType:    df.mimeType ?? null,
                    source:      "courseWork",
                  });
                }
              }
            }
          }

          // courseWorkMaterials (teacher-posted reference materials)
          const matRes = await fetch(
            `https://classroom.googleapis.com/v1/courses/${course.id}/courseWorkMaterials?courseWorkMaterialStates=PUBLISHED&pageSize=50`,
            { headers: { Authorization: `Bearer ${accessToken}` } },
          ).catch(() => null);

          if (matRes?.ok) {
            const { courseWorkMaterial = [] } = await matRes.json();
            for (const mat of courseWorkMaterial) {
              for (const m of (mat.materials ?? [])) {
                if (m.driveFile?.driveFile?.id) {
                  const df = m.driveFile.driveFile;
                  // Dedup by driveFileId
                  if (!files.some(f => f.driveFileId === df.id)) {
                    files.push({
                      driveFileId: df.id,
                      name:        df.title ?? "Untitled",
                      mimeType:    df.mimeType ?? null,
                      source:      "material",
                    });
                  }
                }
              }
            }
          }

          if (files.length) {
            result.push({ courseId: course.id, courseName: course.name, files });
          }
        }
      }
    } catch (e: any) {
      console.error("[drive-auth] classroom threw", e.message);
      errors.push("Classroom");
    }

    // Show whatever loaded. Only error out if BOTH sources failed to produce anything.
    if (result.length === 0 && errors.length) {
      return res.status(502).json({ error: `Couldn't load files — ${errors.join("; ")}` });
    }

    return res.status(200).json({ courses: result });
  }

  // ── sync ──────────────────────────────────────────────────────────────────
  // Full Google Classroom sync: persists courses + assignments (with due dates)
  // and auto-ingests every attached file. This is the PRD-shaped sync; ?action=list
  // + ?action=fetch remain as the manual file picker.
  if (action === "sync" && req.method === "POST") {
    const { userId } = req.body ?? {};
    if (!userId) return res.status(400).json({ error: "userId required" });

    let accessToken: string;
    try { accessToken = await getAccessToken(userId); }
    catch (e: any) { return res.status(401).json({ error: e.message }); }

    const summary = { courses: 0, assignments: 0, filesFound: 0, ingested: 0, skipped: 0, errors: [] as string[] };
    const FILE_BUDGET = 40; // cap inline ingests/call so we stay under maxDuration; re-run to continue

    const coursesRes = await fetch(
      "https://classroom.googleapis.com/v1/courses?courseStates=ACTIVE&pageSize=50",
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!coursesRes.ok) {
      const detail = await coursesRes.text().catch(() => "");
      return res.status(502).json({ error: `Classroom (${coursesRes.status})${detail.includes("disabled") ? " — Classroom API not enabled" : ""}` });
    }
    const { courses: rawCourses = [] } = await coursesRes.json();

    for (const course of rawCourses) {
      // 1. Upsert the course (gc_ prefix keeps Classroom ids from colliding with numeric Canvas ids).
      let courseId: string | null = null;
      try {
        const { data: cRow } = await sb().from("courses").upsert({
          user_id:          userId,
          canvas_course_id: `gc_${course.id}`,
          name:             course.name ?? "Untitled course",
          course_code:      course.section ?? course.name ?? null,
          source:           "google_classroom",
        }, { onConflict: "user_id,canvas_course_id" }).select("id").maybeSingle();
        courseId = cRow?.id ?? null;
        summary.courses++;
      } catch (e: any) { summary.errors.push(`course ${course.name}: ${e.message}`); }

      const driveFiles: any[] = [];
      const linkRows: any[] = [];
      const seenDrive = new Set<string>();
      const collect = (materials: any[]) => {
        for (const m of (materials ?? [])) {
          if (m.driveFile?.driveFile?.id) {
            const df = m.driveFile.driveFile;
            if (!seenDrive.has(df.id)) { seenDrive.add(df.id); driveFiles.push({ id: df.id, name: df.title ?? "Untitled", mimeType: df.mimeType ?? null }); }
          } else if (m.link?.url) {
            linkRows.push({ url: m.link.url, title: m.link.title ?? m.link.url, yt: false });
          } else if (m.youtubeVideo?.id) {
            linkRows.push({ url: `https://youtu.be/${m.youtubeVideo.id}`, title: m.youtubeVideo.title ?? "YouTube video", yt: true });
          }
        }
      };

      // 2. courseWork = assignments. Upsert each; collect its attachments.
      const cwRes = await fetch(
        `https://classroom.googleapis.com/v1/courses/${course.id}/courseWork?courseWorkStates=PUBLISHED&pageSize=100`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      ).catch(() => null);
      if (cwRes?.ok) {
        const { courseWork = [] } = await cwRes.json();
        for (const cw of courseWork) {
          try {
            await sb().from("assignments").upsert({
              user_id:              userId,
              course_id:            courseId,
              canvas_assignment_id: `gc_${cw.id}`,
              title:                cw.title ?? "Untitled",
              description:          cw.description ?? null,
              due_at:               classroomDueAt(cw),
              points_possible:      cw.maxPoints ?? null,
              source:               "google_classroom",
            }, { onConflict: "user_id,canvas_assignment_id" });
            summary.assignments++;
          } catch (e: any) { summary.errors.push(`assignment ${cw.title}: ${e.message}`); }
          collect(cw.materials);
        }
      }

      // 3. courseWorkMaterials = teacher reference materials (no assignment).
      const matRes = await fetch(
        `https://classroom.googleapis.com/v1/courses/${course.id}/courseWorkMaterials?courseWorkMaterialStates=PUBLISHED&pageSize=100`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      ).catch(() => null);
      if (matRes?.ok) {
        const { courseWorkMaterial = [] } = await matRes.json();
        for (const mat of courseWorkMaterial) collect(mat.materials);
      }

      summary.filesFound += driveFiles.length + linkRows.length;

      // 4. Record link/YouTube attachments as file rows (can't extract, but they show up + connect).
      for (const l of linkRows) {
        try {
          await sb().from("files").upsert({
            user_id:     userId,
            course_id:   courseId,
            lms_file_id: "gc_link_" + Math.abs(hashStr(l.url)).toString(36),
            name:        l.title,
            file_type:   l.yt ? "youtube" : "link",
            source_url:  l.url,
            provider:    "google",
          }, { onConflict: "user_id,lms_file_id" });
        } catch { /* non-fatal */ }
      }

      // 5. Auto-ingest Drive files (download → export → extract → embed), budgeted.
      for (const df of driveFiles) {
        if (summary.ingested + summary.skipped >= FILE_BUDGET) {
          summary.errors.push("file budget reached — run sync again to ingest the rest");
          break;
        }
        try {
          const { bytes, finalMime, sourceUrl } = await fetchDriveBytes(accessToken, df.id, df.mimeType);
          const r = await ingestBytes(userId, courseId, df.name, finalMime, bytes, sourceUrl);
          if (r.skipped) summary.skipped++; else summary.ingested++;
        } catch (e: any) { summary.errors.push(`${df.name}: ${e.message}`); }
      }
    }

    return res.status(200).json(summary);
  }

  // ── fetch ─────────────────────────────────────────────────────────────────
  if (action === "fetch" && req.method === "POST") {
    const { userId, driveFileId, name, mimeType, courseId } = req.body ?? {};
    if (!userId || !driveFileId) {
      return res.status(400).json({ error: "userId and driveFileId required" });
    }

    let accessToken: string;
    try { accessToken = await getAccessToken(userId); }
    catch (e: any) { return res.status(401).json({ error: e.message }); }

    // Resolve mimeType via Drive metadata if not provided
    let resolvedMime = mimeType;
    if (!resolvedMime) {
      const metaRes = await fetch(
        `https://www.googleapis.com/drive/v3/files/${driveFileId}?fields=id,name,mimeType`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      if (metaRes.ok) {
        const meta = await metaRes.json();
        resolvedMime = meta.mimeType ?? "application/octet-stream";
      } else {
        resolvedMime = "application/octet-stream";
      }
    }

    // For Google native docs, export to Office format; for binary files, download directly
    let downloadUrl: string;
    let finalMime = resolvedMime;

    if (resolvedMime && GOOGLE_EXPORT_MAP[resolvedMime]) {
      const target = GOOGLE_EXPORT_MAP[resolvedMime];
      downloadUrl = `https://www.googleapis.com/drive/v3/files/${driveFileId}/export?mimeType=${encodeURIComponent(target.mime)}`;
      finalMime   = target.mime;
    } else {
      downloadUrl = `https://www.googleapis.com/drive/v3/files/${driveFileId}?alt=media`;
    }

    const fileRes = await fetch(downloadUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!fileRes.ok) {
      return res.status(502).json({ error: `Drive download failed (${fileRes.status})` });
    }

    const bytes = Buffer.from(await fileRes.arrayBuffer());
    if (bytes.length > 50 * 1024 * 1024) {
      return res.status(413).json({ error: "File too large (max 50 MB)" });
    }

    const sourceUrl = `https://drive.google.com/file/d/${driveFileId}`;

    const result = await ingestLmsFile({
      userId,
      courseId: courseId ?? null,
      file: {
        name:      name ?? `drive-${driveFileId}`,
        mimeType:  finalMime,
        bytes,
        sourceUrl,
        provider:  "google",
      },
    });
    if (result.status !== 200) {
      return res.status(502).json({ error: result.json?.error ?? "lms-ingest failed" });
    }
    return res.status(200).json(result.json);
  }

  // ── disconnect ────────────────────────────────────────────────────────────
  if (action === "disconnect" && req.method === "POST") {
    const { userId } = req.body ?? {};
    if (!userId) return res.status(400).json({ error: "userId required" });

    const { data } = await sb()
      .from("user_oauth")
      .select("refresh_token")
      .eq("user_id", userId)
      .eq("provider", "google")
      .maybeSingle();

    if (data?.refresh_token) {
      // Best-effort revoke; ignore errors
      fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(data.refresh_token)}`, {
        method: "POST",
      }).catch(() => {});
    }

    await sb().from("user_oauth").delete().eq("user_id", userId).eq("provider", "google");
    return res.status(200).json({ ok: true });
  }

  return res.status(400).json({ error: `Unknown action: ${action}` });
}

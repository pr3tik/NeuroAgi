// api/lms-microsoft.ts — Microsoft OAuth + Graph API (Teams/OneDrive) file access
//
// GET  ?action=auth&userId=...          → 302 to Microsoft OAuth consent
// GET  ?action=callback&code=...&state= → exchange code, store refresh_token, 302 to /?lms=microsoft_connected
// GET  ?action=status&userId=...        → { connected: bool, connectedAt }
// GET  ?action=list&userId=...          → { classes: [...], onedrive: [...] }
// POST ?action=fetch                    → { userId, downloadUrl, name, mimeType?, courseId? } → { ok, documentId }
// POST ?action=disconnect               → { userId } → revoke + delete

import { createClient } from "@supabase/supabase-js";
import { ingestLmsFile } from "./lms-ingest.js";

// Full-class sync ingests files inline (download → extract → embed), which is slow.
export const config = { maxDuration: 300 };

let _sb: any = null;
function sb() {
  if (_sb) return _sb;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase env vars not configured");
  _sb = createClient(url, key);
  return _sb;
}

const clientId     = () => process.env.MICROSOFT_CLIENT_ID ?? "";
const clientSecret = () => process.env.MICROSOFT_CLIENT_SECRET ?? "";
// Must be THIS endpoint's callback, identical on both OAuth legs (consent + token
// exchange), and include ?action=callback (the bare path hits "Unknown action").
// Derived from the request host so fschoolai.com / *.vercel.app / localhost all work;
// MICROSOFT_REDIRECT_URI overrides if ever needed.
function redirectUri(req: any): string {
  if (process.env.MICROSOFT_REDIRECT_URI) return process.env.MICROSOFT_REDIRECT_URI;
  const host  = String(req?.headers?.["x-forwarded-host"] ?? req?.headers?.host ?? "fschoolai.com");
  const proto = String(req?.headers?.["x-forwarded-proto"] ?? (host.startsWith("localhost") ? "http" : "https"));
  return `${proto}://${host}/api/lms-microsoft?action=callback`;
}
const tenantId     = () => process.env.MICROSOFT_TENANT_ID ?? "common";

const SCOPES = "Files.Read.All EduRoster.ReadBasic EduAssignments.ReadBasic offline_access"; // EduRoster.ReadBasic is REQUIRED for /education/me/classes

const TOKEN_URL = () =>
  `https://login.microsoftonline.com/${tenantId()}/oauth2/v2.0/token`;
const AUTH_URL = () =>
  `https://login.microsoftonline.com/${tenantId()}/oauth2/v2.0/authorize`;

async function getAccessToken(userId: string): Promise<string> {
  const { data, error } = await sb()
    .from("user_oauth")
    .select("refresh_token")
    .eq("user_id", userId)
    .eq("provider", "microsoft")
    .maybeSingle();
  if (error || !data) throw new Error("Microsoft account not connected");

  const res = await fetch(TOKEN_URL(), {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body:    new URLSearchParams({
      client_id:     clientId(),
      client_secret: clientSecret(),
      refresh_token: data.refresh_token,
      grant_type:    "refresh_token",
      scope:         SCOPES,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Microsoft token refresh failed (${res.status}): ${detail.slice(0, 100)}`);
  }
  const json = await res.json();
  if (!json.access_token) throw new Error("No access_token in Microsoft refresh response");

  // Rotate refresh token when Microsoft issues a new one
  if (json.refresh_token) {
    await sb().from("user_oauth").update({ refresh_token: json.refresh_token })
      .eq("user_id", userId).eq("provider", "microsoft");
  }

  return json.access_token;
}

function selfBase(): string {
  return process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:5173";
}

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();

  const action = req.query?.action;

  // ── auth ─────────────────────────────────────────────────────────────────
  if (action === "auth") {
    if (!clientId()) return res.status(500).json({ error: "MICROSOFT_CLIENT_ID not configured" });
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: "userId required" });

    const url = new URL(AUTH_URL());
    url.searchParams.set("client_id",     clientId());
    url.searchParams.set("redirect_uri",  redirectUri(req));
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope",         SCOPES);
    url.searchParams.set("response_mode", "query");
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
      res.setHeader("Location", "/?lms=microsoft_error");
      return res.end();
    }

    let tokens: any;
    try {
      const tokenRes = await fetch(TOKEN_URL(), {
        method:  "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body:    new URLSearchParams({
          code,
          client_id:     clientId(),
          client_secret: clientSecret(),
          redirect_uri:  redirectUri(req),
          grant_type:    "authorization_code",
          scope:         SCOPES,
        }),
      });
      tokens = await tokenRes.json();
    } catch {
      res.statusCode = 302;
      res.setHeader("Location", "/?lms=microsoft_error");
      return res.end();
    }

    if (!tokens.refresh_token) {
      res.statusCode = 302;
      res.setHeader("Location", "/?lms=microsoft_error&reason=no_refresh_token");
      return res.end();
    }

    await sb().from("user_oauth").upsert({
      user_id:       userId,
      provider:      "microsoft",
      refresh_token: tokens.refresh_token,
      scopes:        SCOPES.split(" "),
      connected_at:  new Date().toISOString(),
    }, { onConflict: "user_id,provider" });

    res.statusCode = 302;
    res.setHeader("Location", "/?lms=microsoft_connected");
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
      .eq("provider", "microsoft")
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

    const headers = { Authorization: `Bearer ${accessToken}` };
    const classes: any[] = [];
    const onedrive: any[] = [];

    // Education classes + assignments
    const classRes = await fetch(
      "https://graph.microsoft.com/v1.0/education/me/classes?$select=id,displayName",
      { headers },
    ).catch(() => null);

    if (classRes?.ok) {
      const { value: eduClasses = [] } = await classRes.json();

      for (const cls of eduClasses.slice(0, 20)) {
        const files: any[] = [];

        // Assignment file resources
        const asgRes = await fetch(
          `https://graph.microsoft.com/v1.0/education/classes/${cls.id}/assignments?$select=id,displayName&$expand=resources`,
          { headers },
        ).catch(() => null);

        if (asgRes?.ok) {
          const { value: assignments = [] } = await asgRes.json();
          for (const asg of assignments) {
            for (const r of (asg.resources ?? [])) {
              const fr = r.resource?.fileResource ?? r.fileResource;
              if (fr?.fileUrl || fr?.downloadUrl) {
                files.push({
                  downloadUrl: fr.downloadUrl ?? fr.fileUrl,
                  name:        fr.displayName ?? r.resource?.displayName ?? "File",
                  mimeType:    null,
                  source:      "assignment",
                });
              }
            }
          }
        }

        // Class team drive root
        const driveRes = await fetch(
          `https://graph.microsoft.com/v1.0/groups/${cls.id}/drive/root/children?$select=id,name,file,@microsoft.graph.downloadUrl`,
          { headers },
        ).catch(() => null);

        if (driveRes?.ok) {
          const { value: driveItems = [] } = await driveRes.json();
          for (const item of driveItems) {
            if (item.file) {
              files.push({
                downloadUrl: item["@microsoft.graph.downloadUrl"],
                name:        item.name,
                mimeType:    item.file?.mimeType ?? null,
                source:      "classDrive",
              });
            }
          }
        }

        if (files.length) classes.push({ classId: cls.id, className: cls.displayName, files });
      }
    }

    // Personal OneDrive root
    const odRes = await fetch(
      "https://graph.microsoft.com/v1.0/me/drive/root/children?$select=id,name,file,@microsoft.graph.downloadUrl&$top=50",
      { headers },
    ).catch(() => null);

    if (odRes?.ok) {
      const { value: odItems = [] } = await odRes.json();
      for (const item of odItems) {
        if (item.file) {
          onedrive.push({
            downloadUrl: item["@microsoft.graph.downloadUrl"],
            name:        item.name,
            mimeType:    item.file?.mimeType ?? null,
            source:      "onedrive",
          });
        }
      }
    }

    return res.status(200).json({ classes, onedrive });
  }

  // ── sync ──────────────────────────────────────────────────────────────────
  // Full Microsoft Teams-for-Education sync: persists classes as courses and
  // assignments (with due dates), and auto-ingests attached + class-drive files.
  // Mirrors drive-auth's Classroom ?action=sync. Personal (non-EDU) accounts have
  // no education/me/classes — they degrade gracefully to a OneDrive-only note.
  if (action === "sync" && req.method === "POST") {
    const { userId } = req.body ?? {};
    if (!userId) return res.status(400).json({ error: "userId required" });

    let accessToken: string;
    try { accessToken = await getAccessToken(userId); }
    catch (e: any) { return res.status(401).json({ error: e.message }); }
    const headers = { Authorization: `Bearer ${accessToken}` };

    const summary = { courses: 0, assignments: 0, filesFound: 0, ingested: 0, skipped: 0, errors: [] as string[] };
    const FILE_BUDGET = 40; // cap inline ingests per call; re-run sync to continue

    // Strip HTML from assignment instructions (Graph returns HTML content).
    const stripHtml = (s: string) => String(s ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() || null;

    // Download a Graph file: pre-authorized downloadUrl first, Bearer fallback.
    async function graphDownload(url: string): Promise<{ bytes: Buffer; mime: string } | null> {
      let r = await fetch(url).catch(() => null);
      if (!r?.ok) r = await fetch(url, { headers }).catch(() => null);
      if (!r?.ok) return null;
      const bytes = Buffer.from(await r.arrayBuffer());
      if (!bytes.length || bytes.length > 50 * 1024 * 1024) return null;
      return { bytes, mime: r.headers.get("content-type")?.split(";")[0]?.trim() ?? "application/octet-stream" };
    }

    // Resolve an educationFileResource's fileUrl (a Graph driveItem URL) to
    // { name, stable sourceUrl, temp downloadUrl }.
    async function resolveFileResource(fileUrl: string): Promise<{ name: string; sourceUrl: string; downloadUrl: string | null } | null> {
      const sep = fileUrl.includes("?") ? "&" : "?";
      const r = await fetch(`${fileUrl}${sep}$select=id,name,webUrl,file,@microsoft.graph.downloadUrl`, { headers }).catch(() => null);
      if (!r?.ok) return null;
      const item = await r.json().catch(() => null);
      if (!item?.id) return null;
      return {
        name:        item.name ?? "File",
        sourceUrl:   item.webUrl ?? `msgraph://drive-item/${item.id}`, // STABLE — downloadUrl rotates per request
        downloadUrl: item["@microsoft.graph.downloadUrl"] ?? null,
      };
    }

    async function ingestOne(courseId: string | null, name: string, sourceUrl: string, downloadUrl: string, mimeType: string | null) {
      if (summary.ingested + summary.skipped >= FILE_BUDGET) {
        if (!summary.errors.includes("file budget reached — run sync again to ingest the rest"))
          summary.errors.push("file budget reached — run sync again to ingest the rest");
        return;
      }
      try {
        const dl = await graphDownload(downloadUrl);
        if (!dl) throw new Error("download failed");
        const r = await ingestLmsFile({
          userId, courseId,
          file: { name, mimeType: mimeType ?? dl.mime, bytes: dl.bytes, sourceUrl, provider: "microsoft" },
        });
        if (r.status !== 200) throw new Error(r.json?.error ?? `ingest ${r.status}`);
        if (r.json?.skipped) summary.skipped++; else summary.ingested++;
      } catch (e: any) { summary.errors.push(`${name}: ${e.message}`); }
    }

    const classRes = await fetch(
      "https://graph.microsoft.com/v1.0/education/me/classes?$select=id,displayName,classCode",
      { headers },
    ).catch(() => null);

    if (!classRes?.ok) {
      // Personal / non-EDU tenant — nothing class-shaped to sync. Not an error.
      const status = classRes?.status ?? "network";
      return res.status(200).json({
        ...summary,
        note: `No Teams-for-Education classes available (${status}) — this account may not be a school account. Use Browse files for OneDrive imports.`,
      });
    }

    const { value: eduClasses = [] } = await classRes.json();

    for (const cls of eduClasses.slice(0, 20)) {
      // 1. Upsert the class as a course (ms_ prefix keeps Graph ids from colliding).
      let courseId: string | null = null;
      try {
        const { data: cRow } = await sb().from("courses").upsert({
          user_id:          userId,
          canvas_course_id: `ms_${cls.id}`,
          name:             cls.displayName ?? "Untitled class",
          course_code:      cls.classCode ?? cls.displayName ?? null,
          source:           "microsoft_teams",
        }, { onConflict: "user_id,canvas_course_id" }).select("id").maybeSingle();
        courseId = cRow?.id ?? null;
        summary.courses++;
      } catch (e: any) { summary.errors.push(`class ${cls.displayName}: ${e.message}`); }

      // 2. Assignments (with due dates) + their attached files.
      const asgRes = await fetch(
        `https://graph.microsoft.com/v1.0/education/classes/${cls.id}/assignments?$select=id,displayName,instructions,dueDateTime,grading&$expand=resources&$top=50`,
        { headers },
      ).catch(() => null);

      if (asgRes?.ok) {
        const { value: assignments = [] } = await asgRes.json();
        for (const asg of assignments) {
          try {
            await sb().from("assignments").upsert({
              user_id:              userId,
              course_id:            courseId,
              canvas_assignment_id: `ms_${asg.id}`,
              title:                asg.displayName ?? "Untitled",
              description:          stripHtml(asg.instructions?.content),
              due_at:               asg.dueDateTime ?? null,
              points_possible:      asg.grading?.maxPoints ?? null,
              source:               "microsoft_teams",
            }, { onConflict: "user_id,canvas_assignment_id" });
            summary.assignments++;
          } catch (e: any) { summary.errors.push(`assignment ${asg.displayName}: ${e.message}`); }

          for (const r of (asg.resources ?? [])) {
            // Shape (per Graph docs): wrapper { id, resource } where resource IS the
            // concrete subclass — fileUrl sits directly on it; links are identified by
            // @odata.type *LinkResource. TODO(no-MS-keys-yet): also descend class-drive
            // channel folders (root children are mostly folders) once testable.
            const rsrc    = r.resource ?? r;
            const otype   = String(rsrc?.["@odata.type"] ?? "");
            const fileUrl = typeof rsrc?.fileUrl === "string" ? rsrc.fileUrl : null;
            const link    = /linkResource/i.test(otype) ? (rsrc?.link ?? null) : null;
            if (fileUrl) {
              summary.filesFound++;
              const resolved = await resolveFileResource(fileUrl);
              if (resolved?.downloadUrl) await ingestOne(courseId, resolved.name, resolved.sourceUrl, resolved.downloadUrl, null);
              else summary.errors.push(`${rsrc?.displayName ?? "file"}: could not resolve`);
            } else if (link) {
              summary.filesFound++;
              try {
                let h = 0; const s = String(link);
                for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
                await sb().from("files").upsert({
                  user_id:     userId,
                  course_id:   courseId,
                  lms_file_id: "ms_link_" + (h >>> 0).toString(36),
                  name:        rsrc?.displayName ?? link,
                  file_type:   "link",
                  source_url:  link,
                  provider:    "microsoft",
                }, { onConflict: "user_id,lms_file_id" });
              } catch { /* non-fatal */ }
            }
          }
        }
      }

      // 3. Class team drive root files (lecture decks etc. shared with the class).
      const driveRes = await fetch(
        `https://graph.microsoft.com/v1.0/groups/${cls.id}/drive/root/children?$select=id,name,webUrl,file,@microsoft.graph.downloadUrl&$top=50`,
        { headers },
      ).catch(() => null);
      if (driveRes?.ok) {
        const { value: driveItems = [] } = await driveRes.json();
        for (const item of driveItems) {
          if (!item.file || !item["@microsoft.graph.downloadUrl"]) continue;
          summary.filesFound++;
          await ingestOne(
            courseId,
            item.name ?? "File",
            item.webUrl ?? `msgraph://drive-item/${item.id}`,
            item["@microsoft.graph.downloadUrl"],
            item.file?.mimeType ?? null,
          );
        }
      }
    }

    return res.status(200).json(summary);
  }

  // ── fetch ─────────────────────────────────────────────────────────────────
  if (action === "fetch" && req.method === "POST") {
    const { userId, downloadUrl, name, mimeType, courseId } = req.body ?? {};
    if (!userId || !downloadUrl) {
      return res.status(400).json({ error: "userId and downloadUrl required" });
    }

    let accessToken: string;
    try { accessToken = await getAccessToken(userId); }
    catch (e: any) { return res.status(401).json({ error: e.message }); }

    // @microsoft.graph.downloadUrl is pre-authorized — no auth header needed.
    // But some fileUrl values need Bearer auth, so we try both.
    let fileRes = await fetch(downloadUrl).catch(() => null);
    if (!fileRes?.ok) {
      fileRes = await fetch(downloadUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
      }).catch(() => null);
    }
    if (!fileRes?.ok) {
      return res.status(502).json({ error: `Microsoft file download failed` });
    }

    const bytes = Buffer.from(await fileRes.arrayBuffer());
    if (bytes.length > 50 * 1024 * 1024) {
      return res.status(413).json({ error: "File too large (max 50 MB)" });
    }

    // @microsoft.graph.downloadUrl carries a rotating tempauth query — strip it so the
    // sourceUrl is stable across syncs and dedup actually works.
    let stableUrl = downloadUrl;
    try { const u = new URL(downloadUrl); u.search = ""; stableUrl = u.toString(); } catch {}

    const result = await ingestLmsFile({
      userId,
      courseId: courseId ?? null,
      file: {
        name:      name ?? "microsoft-file",
        mimeType:  mimeType ?? fileRes.headers.get("content-type") ?? "application/octet-stream",
        bytes,
        sourceUrl: stableUrl,
        provider:  "microsoft",
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
    await sb().from("user_oauth").delete().eq("user_id", userId).eq("provider", "microsoft");
    return res.status(200).json({ ok: true });
  }

  return res.status(400).json({ error: `Unknown action: ${action}` });
}

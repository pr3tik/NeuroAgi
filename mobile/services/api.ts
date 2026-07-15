const BASE_URL = "https://neuro-agi-topaz.vercel.app";

export async function apiFetch(path: string, body: object) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
  return res.json();
}

export async function apiGet(path: string) {
  const res = await fetch(`${BASE_URL}${path}`);
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
  return res.json();
}

export type ApiResult = { ok: boolean; status: number; json: any };

/** Lower-level than apiFetch/apiGet: never throws on a non-2xx response — returns
 *  the status + parsed body so callers can branch on specific codes (e.g. auth.ts
 *  reading 409 "account_exists" from oauth-provision). Supports a Bearer token for
 *  the session-authenticated auth-migrate actions (adopt, oauth-provision). */
export async function apiRequest(
  path: string,
  opts: { method?: "GET" | "POST"; body?: object; token?: string } = {},
): Promise<ApiResult> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.token) headers["Authorization"] = `Bearer ${opts.token}`;

  const res = await fetch(`${BASE_URL}${path}`, {
    method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

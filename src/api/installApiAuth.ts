// src/api/installApiAuth.ts — attach the signed-in user's Supabase JWT to every same-origin
// /api/* request, from ONE place (the client makes ~86 such calls across many files with no
// wrapper). Stage 1 of the API authorization hardening: this is NON-BREAKING — endpoints simply
// ignore the header until they start enforcing it (via api/_auth.ts requireUser). It lets the
// server authenticate the caller instead of trusting a userId from the request body.
//
// Safety:
//  • Only touches same-origin /api/* URLs — Supabase's own GoTrue/PostgREST calls are
//    cross-origin, so they pass through untouched (and there's no fetch-recursion via refresh).
//  • Never overrides an Authorization header the caller already set (e.g. the waitlist admin
//    dashboard's CRON_SECRET bearer, or auth.ts's own calls).
import { supabase } from "./supabase";

if (typeof window !== "undefined" && !(window as any).__apiAuthPatched) {
  (window as any).__apiAuthPatched = true;
  const orig = window.fetch.bind(window);

  window.fetch = async function patchedFetch(input: any, init?: RequestInit): Promise<Response> {
    try {
      const url =
        typeof input === "string" ? input :
        input instanceof URL ? input.href :
        (input && typeof input.url === "string") ? input.url : "";
      const isApi = url.startsWith("/api/") || url.startsWith(window.location.origin + "/api/");
      if (isApi) {
        const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
        if (!headers.has("authorization")) {
          const { data } = await supabase.auth.getSession();
          const token = data.session?.access_token;
          if (token) {
            headers.set("authorization", `Bearer ${token}`);
            if (input instanceof Request) return orig(new Request(input, { headers }));
            return orig(input, { ...init, headers });
          }
        }
      }
    } catch { /* never break a request over auth injection */ }
    return orig(input, init);
  };
}

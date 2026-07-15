// api/_reggie/callApi.ts — invoke a Vercel-style (req,res) handler IN-PROCESS and
// capture its JSON response. Lets Reggie's tool loop call the real api/* handlers
// directly (same process, same env) instead of an HTTP round-trip — lower latency and
// no self-URL dependency. Mirrors the (req,res) contract the handlers rely on.
export interface ApiResult { status: number; body: any; }

export async function callApi(
  handler: (req: any, res: any) => any,
  opts: { method?: string; body?: any; query?: any; headers?: Record<string, string>; internalUserId?: string } = {},
): Promise<ApiResult> {
  const { method = "POST", body = {}, query = {}, headers = {}, internalUserId } = opts;
  return await new Promise<ApiResult>((resolve) => {
    let settled = false;
    const done = (status: number, b: any) => {
      if (settled) return;
      settled = true;
      resolve({ status, body: b });
    };
    const res: any = {
      statusCode: 200,
      setHeader() { return res; },
      status(code: number) { res.statusCode = code; return res; },
      json(obj: any) { done(res.statusCode, obj); return res; },
      end(chunk?: any) {
        let b: any = chunk;
        if (typeof chunk === "string") { try { b = JSON.parse(chunk); } catch { /* keep string */ } }
        done(res.statusCode, b);
        return res;
      },
    };
    // headers matter for handlers that derive a public base URL from host /
    // x-forwarded-* (e.g. writing-tracker's /api/claude self-call).
    const req: any = { method, body, query, headers };
    // Trusted in-process identity for endpoints that enforce requireUser — the caller
    // (agent-manager) already verified this id from the browser JWT. Unforgeable over HTTP.
    if (internalUserId) req.__internalUserId = internalUserId;
    try {
      Promise.resolve(handler(req, res)).catch((e: any) => done(500, { error: e?.message ?? "handler threw" }));
    } catch (e: any) {
      done(500, { error: e?.message ?? "handler threw synchronously" });
    }
  });
}

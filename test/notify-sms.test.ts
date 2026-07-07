// @vitest-environment node
// Tests for the deliverSMS() primitive added to api/_notify.ts (the notify.sms tool).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { deliverSMS } from "../api/_notify.ts";

beforeEach(() => {
  process.env.TWILIO_SID = "AC123";
  process.env.TWILIO_TOKEN = "tok";
  process.env.TWILIO_FROM = "+15550000000";
});
afterEach(() => vi.unstubAllGlobals());

describe("deliverSMS", () => {
  it("posts to the Twilio Messages API with Basic auth + form body, returns true on 2xx", async () => {
    const fn = vi.fn(async () => ({ ok: true, status: 201, json: async () => ({}), text: async () => "" }));
    vi.stubGlobal("fetch", fn);
    const ok = await deliverSMS("+14165551234", "Hi there");
    expect(ok).toBe(true);
    const [url, opts] = fn.mock.calls[0];
    expect(String(url)).toBe("https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json");
    expect(opts.method).toBe("POST");
    expect(opts.headers.Authorization).toBe("Basic " + Buffer.from("AC123:tok").toString("base64"));
    expect(opts.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    const body = new URLSearchParams(opts.body as string);
    expect(body.get("To")).toBe("+14165551234");
    expect(body.get("From")).toBe("+15550000000");
    expect(body.get("Body")).toBe("Hi there");
  });

  it("returns false (no fetch) when Twilio env is missing", async () => {
    delete process.env.TWILIO_SID;
    const fn = vi.fn();
    vi.stubGlobal("fetch", fn);
    expect(await deliverSMS("+1", "x")).toBe(false);
    expect(fn).not.toHaveBeenCalled();
  });

  it("returns false when to/body is empty", async () => {
    const fn = vi.fn();
    vi.stubGlobal("fetch", fn);
    expect(await deliverSMS("", "x")).toBe(false);
    expect(await deliverSMS("+1", "")).toBe(false);
    expect(fn).not.toHaveBeenCalled();
  });

  it("returns false on a non-2xx Twilio response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}), text: async () => "" })));
    expect(await deliverSMS("+1", "x")).toBe(false);
  });

  it("returns false (swallows) when fetch throws", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network"); }));
    expect(await deliverSMS("+1", "x")).toBe(false);
  });
});

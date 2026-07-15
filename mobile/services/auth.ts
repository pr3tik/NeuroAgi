// auth.ts — mobile port of src/api/auth.ts. Same Supabase Auth (GoTrue) model as web:
// establishes a real session (so `auth.uid()` is available for RLS) and returns the
// public.users profile. App identity stays the profile's text `id` (fschool_uid),
// mapped from the session via users.auth_id — NOT the GoTrue session id itself.
// Mobile is login-only (account creation happens on web) — no signup() here.
//
// • Login       → signInWithPassword. If it fails, the account may be a pre-Auth legacy row
//                  (password_hash, no auth_id): POST /api/auth-migrate?action=migrate verifies
//                  the old hash + creates the GoTrue user, then we retry.
// • Google      → signInWithOAuth (PKCE, skipBrowserRedirect) opened in an in-app browser
//                  session; the redirect lands on a custom-scheme deep link that we exchange
//                  for a session, then run the same oauth-provision step as web.
//
// Differences from web: AsyncStorage instead of localStorage, expo-linking instead of
// window.location, apiRequest() (services/api.ts) instead of bare fetch so we get status
// codes + Bearer auth support.

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { supabase } from "./supabase";
import { apiRequest } from "./api";

export type Profile = { id: string; name?: string; school?: string };

/** Reject if `p` doesn't settle within `ms` — same rationale as web: GoTrue's
 *  /token endpoint has measured spikes to ~17s on smaller Supabase tiers while
 *  REST/PostgREST stays <150ms. Turns a hang into a visible, localized error. */
const SIGNIN_TIMEOUT_MS = 25000;

function withTimeout<T>(label: string, p: PromiseLike<T>, ms = 12000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => {
      console.warn(`[auth] "${label}" exceeded ${ms}ms — treating it as a stall`);
      reject(new Error("That took too long. Check your connection and try again."));
    }, ms);
    Promise.resolve(p).then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

/** The public.users profile for the current GoTrue session (mapped via auth_id). */
export async function currentProfile(): Promise<Profile | null> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return null;
  const { data } = await supabase
    .from("users").select("id, name, school")
    .eq("auth_id", session.user.id).maybeSingle();
  return (data as Profile) ?? null;
}

/** Sign in via Supabase Auth, lazily migrating a pre-Auth account if needed. */
export async function signIn(email: string, password: string): Promise<Profile> {
  const e = (email || "").toLowerCase().trim();

  let { error } = await withTimeout("signInWithPassword", supabase.auth.signInWithPassword({ email: e, password }), SIGNIN_TIMEOUT_MS);

  if (error) {
    // Legacy account not yet in GoTrue → migrate (verifies the old SHA-256 hash
    // server-side), then retry. Wrong password makes migrate fail too → same error.
    const mig = await withTimeout("migrate", apiRequest("/api/auth-migrate?action=migrate", {
      method: "POST",
      body: { email: e, password },
    }));
    if (!mig.ok) throw new Error("Incorrect email or password.");
    ({ error } = await withTimeout("signInWithPassword(retry)", supabase.auth.signInWithPassword({ email: e, password }), SIGNIN_TIMEOUT_MS));
    if (error) throw new Error("Incorrect email or password.");
  }

  const profile = await withTimeout("currentProfile", currentProfile());
  if (!profile) throw new Error("Signed in, but no profile was found for this account.");
  return profile;
}

export async function signOut(): Promise<void> {
  // Race a short timeout so teardown always proceeds even if the network call or
  // supabase-js's internal auth lock hangs — same guard as web's signOut().
  try {
    await Promise.race([
      supabase.auth.signOut({ scope: "local" }),
      new Promise((resolve) => setTimeout(resolve, 1500)),
    ]);
  } catch { /* clear local state regardless */ }
  await AsyncStorage.multiRemove(["fschool_uid", "fschool_logged_in", "fschool_name", "fschool_merge_pending"]);
}

// ── Google sign-in ────────────────────────────────────────────────────────────
// Two halves, same shape as web: signInWithGoogle() kicks off the OAuth round-trip
// (in an in-app browser session rather than a full-page redirect), and
// completeOAuthLogin() turns the fresh GoTrue session into a usable app identity.
// A first-time Google user has NO public.users row, so we provision one server-side
// (oauth-provision) before setting the local flags the app gates on.

/** The custom scheme deep link Supabase redirects back to after the Google flow.
 *  Registered as app.json's "scheme" — must also be added as a Redirect URL in the
 *  Supabase Auth dashboard and as an authorized redirect URI in the Google Cloud
 *  OAuth client, or the provider will bounce the request. */
const OAUTH_REDIRECT_URL = Linking.createURL("auth/callback");

/** Opens Google sign-in in an in-app browser session and blocks until the user
 *  finishes (or cancels). Establishes the GoTrue session directly via PKCE code
 *  exchange — no separate "wait for SIGNED_IN event" step needed like web's
 *  full-page redirect (there's no page reload here to lose the in-memory state). */
export async function signInWithGoogle(): Promise<void> {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: OAUTH_REDIRECT_URL,
      skipBrowserRedirect: true,
      queryParams: { prompt: "select_account" },
    },
  });
  if (error) throw new Error(error.message);
  if (!data?.url) throw new Error("Could not start Google sign-in.");

  const result = await WebBrowser.openAuthSessionAsync(data.url, OAUTH_REDIRECT_URL);
  if (result.type !== "success" || !result.url) {
    if (result.type === "cancel" || result.type === "dismiss") return; // user backed out
    throw new Error("Google sign-in did not complete.");
  }

  const params = (Linking.parse(result.url).queryParams ?? {}) as Record<string, string>;
  if (params.error) throw new Error(params.error_description || "Google sign-in failed.");

  const code = params.code;
  if (!code) throw new Error("Google sign-in did not return an authorization code.");

  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError) throw new Error(exchangeError.message);
}

export type OAuthResult = { userId: string; isNew: boolean; name: string };

/** Provision/link the profile after a Google session is established, merge the
 *  guest id, and return the flags the app boots on. Call right after
 *  signInWithGoogle() resolves (the session already exists by then — unlike web
 *  there's no redirect-driven SIGNED_IN event to wait for separately). */
export async function completeOAuthLogin(): Promise<OAuthResult | null> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;

  const prevUid = await AsyncStorage.getItem("fschool_uid");
  const res = await apiRequest("/api/auth-migrate?action=oauth-provision", {
    method: "POST",
    token: session.access_token,
  });

  // Email already owned by a password account → don't silently take it over.
  if (res.status === 409 && res.json?.error === "account_exists") {
    await supabase.auth.signOut();
    throw new Error("You already have an account with this email — please sign in with your password.");
  }
  if (!res.ok) throw new Error(res.json?.error || "Sign-in failed. Please try again.");

  // Merge this device's guest data into the canonical profile before discarding it
  // (same guarantee as the password path; failure is retried at next boot).
  if (prevUid && prevUid !== res.json.userId) await adoptIdentity(prevUid);
  await AsyncStorage.setItem("fschool_uid", res.json.userId);
  await AsyncStorage.setItem("fschool_logged_in", "1");

  const name =
    (session.user?.user_metadata?.full_name as string | undefined) ||
    (session.user?.user_metadata?.name as string | undefined) || "";
  if (name) await AsyncStorage.setItem("fschool_name", name);

  return { userId: res.json.userId, isNew: !!res.json.isNew, name };
}

/** Uids whose merge failed and should be retried at next boot. Stored as a JSON
 *  list (a single-slot marker would drop the first uid when a second merge fails). */
const MERGE_PENDING_KEY = "fschool_merge_pending";
export async function pendingMerges(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(MERGE_PENDING_KEY);
    if (!raw) return [];
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter(Boolean) : [String(v)];
  } catch { return []; }
}
async function setPendingMerges(ids: string[]) {
  if (ids.length) await AsyncStorage.setItem(MERGE_PENDING_KEY, JSON.stringify([...new Set(ids)]));
  else await AsyncStorage.removeItem(MERGE_PENDING_KEY);
}

/** Merge data written under a stale/guest uid into the canonical profile (server-side).
 *  Never throws. Returns true when the old id was merged (or there was nothing to merge)
 *  and is therefore safe to discard. On failure it records the uid so boot can retry. */
export async function adoptIdentity(oldId: string): Promise<boolean> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session || !oldId) return false;
  try {
    const r = await apiRequest("/api/auth-migrate?action=adopt", {
      method: "POST",
      token: session.access_token,
      body: { oldId },
    });
    if (r.ok) { await setPendingMerges((await pendingMerges()).filter(id => id !== oldId)); return true; }
  } catch { /* network — retry at next boot */ }
  await setPendingMerges([...(await pendingMerges()), oldId]);
  return false;
}

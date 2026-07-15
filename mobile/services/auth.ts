// auth.ts — mobile port of src/api/auth.ts. Same Supabase Auth (GoTrue) model as web:
// establishes a real session (so `auth.uid()` is available for RLS) and returns the
// public.users profile. App identity stays the profile's text `id` (fschool_uid),
// mapped from the session via users.auth_id — NOT the GoTrue session id itself.
// Mobile is login-only (account creation happens on web) — no signup() here.
//
// Login → signInWithPassword. If it fails, the account may be a pre-Auth legacy row
// (password_hash, no auth_id): POST /api/auth-migrate?action=migrate verifies the old
// hash + creates the GoTrue user, then we retry.
//
// (No Google sign-in here — web never actually shipped a button for it despite having
// the backend plumbing, so there was no real "web parity" to build mobile support for.)
//
// Differences from web: AsyncStorage instead of localStorage, apiRequest()
// (services/api.ts) instead of bare fetch so we get status codes + Bearer auth support.

import AsyncStorage from "@react-native-async-storage/async-storage";
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

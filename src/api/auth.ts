// auth.ts — sign-in / sign-up via Supabase Auth (GoTrue), with lazy migration of legacy
// SHA-256 accounts. Establishes a real session (so `auth.uid()` is available for RLS) and
// returns the public.users profile. App identity stays the profile's text `id` (fschool_uid).
//
// • New signup  → POST /api/auth-migrate?action=signup  (creates GoTrue user + profile),
//                  then signInWithPassword to start the session.
// • Login       → signInWithPassword. If it fails, the account may be a pre-Auth legacy row
//                  (password_hash, no auth_id): POST /api/auth-migrate?action=migrate verifies
//                  the old hash + creates the GoTrue user, then we retry. A genuinely wrong
//                  password makes migrate fail too → same "incorrect" error (no user enumeration).

import { supabase } from './supabase';

export type Profile = { id: string; name?: string; school?: string };

/** Reject if `p` doesn't settle within `ms`. Turns a hung auth/network call into a
 *  visible, localized error instead of an infinite spinner — and the console.warn names
 *  the exact step that stalled (signInWithPassword vs migrate vs currentProfile), so a
 *  residual stall is diagnosable from the browser console without extra instrumentation. */
function withTimeout<T>(label: string, p: PromiseLike<T>, ms = 12000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => {
      console.warn(`[auth] "${label}" exceeded ${ms}ms — treating it as a stall`);
      reject(new Error('That took too long. Check your connection and try again.'));
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
    .from('users').select('id, name, school')
    .eq('auth_id', session.user.id).maybeSingle();
  return (data as Profile) ?? null;
}

/** Sign in via Supabase Auth, lazily migrating a pre-Auth account if needed. */
export async function signIn(email: string, password: string): Promise<Profile> {
  const e = (email || '').toLowerCase().trim();

  let { error } = await withTimeout('signInWithPassword', supabase.auth.signInWithPassword({ email: e, password }));

  if (error) {
    // Legacy account not yet in GoTrue → migrate (verifies the old SHA-256 hash
    // server-side), then retry. Wrong password makes migrate fail too → same error.
    const mig = await withTimeout('migrate', fetch('/api/auth-migrate?action=migrate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: e, password }),
    }));
    if (!mig.ok) throw new Error('Incorrect email or password.');
    ({ error } = await withTimeout('signInWithPassword(retry)', supabase.auth.signInWithPassword({ email: e, password })));
    if (error) throw new Error('Incorrect email or password.');
  }

  const profile = await withTimeout('currentProfile', currentProfile());
  if (!profile) throw new Error('Signed in, but no profile was found for this account.');
  return profile;
}

/** Create a Supabase Auth account + profile (server-side), then establish the session. */
export async function signUp({ name, email, password }: { name: string; email: string; password: string }): Promise<Profile> {
  const e = (email || '').toLowerCase().trim();

  const res = await withTimeout('signup', fetch('/api/auth-migrate?action=signup', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email: e, password }),
  }));
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Could not create your account.');

  const { error } = await withTimeout('signInWithPassword(signup)', supabase.auth.signInWithPassword({ email: e, password }));
  if (error) throw new Error('Account created — please sign in.');

  return { id: data.userId, name };
}

export async function signOut(): Promise<void> {
  // Sign out THIS browser only (scope:'local' — no network revoke round-trip). The
  // default 'global' scope needs a network call AND takes the supabase-js auth lock
  // (navigator.locks); either can hang, and since callers await this before clearing
  // local state, a hang left the user stuck ("nothing happens" on the button).
  // Race a short timeout so teardown always proceeds, then delete the persisted GoTrue
  // session ourselves so boot's identity-reconcile can't resurrect the login.
  try {
    await Promise.race([
      supabase.auth.signOut({ scope: 'local' }),
      new Promise((resolve) => setTimeout(resolve, 1500)),
    ]);
  } catch { /* clear local state regardless */ }
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith('sb-') && k.endsWith('-auth-token')) localStorage.removeItem(k);
    }
  } catch { /* localStorage unavailable — nothing to clear */ }
  localStorage.removeItem('fschool_uid');
  localStorage.removeItem('fschool_logged_in');
  localStorage.removeItem('fschool_name');
  localStorage.removeItem('sa_onboarding_draft');
}

// ── Google sign-in ────────────────────────────────────────────────────────────
// Two halves: signInWithGoogle() kicks off the redirect; completeOAuthLogin() runs
// when the browser lands back on /?auth=google and turns the fresh GoTrue session
// into a usable app identity. Unlike password signup, a first-time Google user has
// NO public.users row (the ?action=signup path is skipped), so we provision one
// server-side before setting the local flags the app gates on.

/** Redirect to Google. Nothing after this runs — the browser navigates away. */
export async function signInWithGoogle(): Promise<void> {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${window.location.origin}/?auth=google`,
      queryParams: { prompt: 'select_account' },
    },
  });
  if (error) throw new Error(error.message);
}

export type OAuthResult = { userId: string; isNew: boolean; name: string };

/** Complete the Google redirect: provision/link the profile, merge the guest id,
 *  and set the localStorage flags the app reads on boot. Returns null if there is
 *  no session yet (caller should wait for the SIGNED_IN event first). */
export async function completeOAuthLogin(): Promise<OAuthResult | null> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;

  const prevUid = localStorage.getItem('fschool_uid');
  const res = await fetch('/api/auth-migrate?action=oauth-provision', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
  });
  const data = await res.json().catch(() => ({}));

  // Email already owned by a password account → don't silently take it over.
  if (res.status === 409 && data.error === 'account_exists') {
    await supabase.auth.signOut();
    throw new Error('You already have an account with this email — please sign in with your password.');
  }
  if (!res.ok) throw new Error(data.error || 'Sign-in failed. Please try again.');

  // Merge this browser's guest data into the canonical profile before discarding it
  // (same guarantee as the password path; failure is retried at next boot).
  if (prevUid && prevUid !== data.userId) await adoptIdentity(prevUid);
  localStorage.setItem('fschool_uid', data.userId);
  localStorage.setItem('fschool_logged_in', '1');

  const name =
    (session.user?.user_metadata?.full_name as string | undefined) ||
    (session.user?.user_metadata?.name as string | undefined) || '';
  if (name) localStorage.setItem('fschool_name', name);

  return { userId: data.userId, isNew: !!data.isNew, name };
}

/** Uids whose merge failed and should be retried at next boot. Stored as a JSON
 *  list (a single-slot marker would drop the first uid when a second merge fails). */
const MERGE_PENDING_KEY = 'fschool_merge_pending';
export function pendingMerges(): string[] {
  try {
    const raw = localStorage.getItem(MERGE_PENDING_KEY);
    if (!raw) return [];
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter(Boolean) : [String(v)];
  } catch { const v = localStorage.getItem(MERGE_PENDING_KEY); return v ? [v] : []; }
}
function setPendingMerges(ids: string[]) {
  if (ids.length) localStorage.setItem(MERGE_PENDING_KEY, JSON.stringify([...new Set(ids)]));
  else localStorage.removeItem(MERGE_PENDING_KEY);
}

/** Merge data written under a stale/guest uid into the canonical profile (server-side).
 *  Never throws. Returns true when the old id was merged (or there was nothing to merge)
 *  and is therefore safe to discard. On failure it records the uid so boot can retry. */
export async function adoptIdentity(oldId: string): Promise<boolean> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session || !oldId) return false;
  try {
    const r = await fetch('/api/auth-migrate?action=adopt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ oldId }),
    });
    if (r.ok) { setPendingMerges(pendingMerges().filter(id => id !== oldId)); return true; }
  } catch { /* network — retry at next boot */ }
  setPendingMerges([...pendingMerges(), oldId]);
  return false;
}

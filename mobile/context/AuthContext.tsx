// AuthContext.tsx — mobile identity, mirroring the reconciliation effect in
// src/context/AppContext.tsx: app identity is public.users.id (the "fschool_uid"),
// not the GoTrue session id. A guest id exists from first launch (services/identity.ts);
// signing in maps that guest data onto the auth-linked canonical profile via adoptIdentity,
// exactly like web's App.tsx login handler.
//
// Mobile is login-only (MOB-01 acceptance is "login/logout/refresh", not signup —
// account creation happens on web).
//
// useUserId() is the drop-in replacement for the various hardcoded TEST_USER_ID
// constants across mobile/app/*.tsx and mobile/components/*.tsx.

import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from "react";
import { View, ActivityIndicator } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getOrCreateUserId } from "../services/identity";
import {
  currentProfile, pendingMerges, adoptIdentity,
  signIn as authSignIn, signOut as authSignOut,
  signInWithGoogle as authSignInWithGoogle, completeOAuthLogin,
  Profile,
} from "../services/auth";

type Status = "loading" | "guest" | "authed";

type AuthContextValue = {
  userId: string;
  profile: Profile | null;
  status: Status;
  signIn: (email: string, password: string) => Promise<Profile>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);
const BG = "#0f0f0f";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [userId, setUserIdState] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [status, setStatus] = useState<Status>("loading");

  // Boot: establish a guest id immediately so screens always have something to
  // query with, then reconcile against any existing GoTrue session — same shape
  // as src/context/AppContext.tsx's identity-reconciliation effect.
  useEffect(() => {
    (async () => {
      const guestId = await getOrCreateUserId();
      setUserIdState(guestId);
      try {
        const p = await currentProfile();
        if (!p?.id) { setStatus("guest"); return; } // no session → stay a guest, keep browsing

        for (const pending of await pendingMerges())
          if (pending !== p.id) await adoptIdentity(pending);

        if (p.id !== guestId) {
          const ok = await adoptIdentity(guestId);
          if (ok) {
            await AsyncStorage.setItem("fschool_uid", p.id);
            await AsyncStorage.setItem("fschool_logged_in", "1");
            setUserIdState(p.id);
          }
        }
        setProfile(p);
        setStatus("authed");
      } catch {
        setStatus("guest"); // keep current identity on any failure
      }
    })();
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const prevUid = userId;
    const p = await authSignIn(email, password);
    if (prevUid && prevUid !== p.id) await adoptIdentity(prevUid);
    await AsyncStorage.setItem("fschool_uid", p.id);
    await AsyncStorage.setItem("fschool_logged_in", "1");
    if (p.name) await AsyncStorage.setItem("fschool_name", p.name);
    setUserIdState(p.id);
    setProfile(p);
    setStatus("authed");
    return p;
  }, [userId]);

  const signInWithGoogle = useCallback(async () => {
    await authSignInWithGoogle();              // opens the in-app browser, exchanges the code
    const result = await completeOAuthLogin();  // provisions + merges + persists (mirrors web)
    if (!result) throw new Error("Sign-in did not complete.");
    setUserIdState(result.userId);
    setProfile({ id: result.userId, name: result.name });
    setStatus("authed");
  }, []);

  const signOut = useCallback(async () => {
    await authSignOut();
    const freshGuestId = await getOrCreateUserId(); // re-provision — see App.tsx's fschool_uid comment
    setUserIdState(freshGuestId);
    setProfile(null);
    setStatus("guest");
  }, []);

  if (!userId) {
    return (
      <View style={{ flex: 1, backgroundColor: BG, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color="rgba(255,255,255,0.4)" />
      </View>
    );
  }

  return (
    <AuthContext.Provider value={{ userId, profile, status, signIn, signInWithGoogle, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth() must be used within <AuthProvider>");
  return ctx;
}

/** The current app-identity user id (guest fschool_uid until a session exists,
 *  the canonical profile id after sign-in). Drop-in replacement for the various
 *  TEST_USER_ID constants across mobile/app/*.tsx and mobile/components/*.tsx. */
export function useUserId(): string {
  return useAuth().userId;
}

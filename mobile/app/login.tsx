// login.tsx — email/password + Google sign-in, gating the app for a signed-out
// (guest) identity. Login-only — account creation happens on web, not here (see
// context/AuthContext.tsx). Not part of the swipe-nav tab grid (navigation/navConfig.ts) —
// it's a standalone pre-auth screen, so it doesn't use ScreenWrapper/Header.

import { useState, useCallback } from "react";
import {
  Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView,
} from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";
import { useAuth } from "../context/AuthContext";

const BG = "#0f0f0f";

// Google's official "G" logo (per developers.google.com/identity/branding-guidelines) —
// used as-is so the button reads as a real Google sign-in control, not a generic one.
function GoogleLogo({ size = 18 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 18 18">
      <Path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" />
      <Path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z" />
      <Path fill="#FBBC05" d="M3.964 10.71c-.18-.54-.282-1.117-.282-1.71s.102-1.17.282-1.71V4.958H.957C.347 6.173 0 7.548 0 9s.348 2.827.957 4.042l3.007-2.332z" />
      <Path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.958L3.964 6.29C4.672 4.163 6.656 3.58 9 3.58z" />
    </Svg>
  );
}

// Keep in sync with app/identity.tsx's palette.
const C = {
  textPrimary:   "#F5F5F5",
  textSecondary: "rgba(255,255,255,0.45)",
  textTertiary:  "rgba(255,255,255,0.25)",
  surface:       "rgba(255,255,255,0.05)",
  border:        "rgba(255,255,255,0.08)",
  danger:        "rgba(255,105,100,0.9)",
  teal:          "rgba(0,210,190,0.95)",
};

export default function LoginScreen() {
  const router = useRouter();
  const { signIn, signInWithGoogle } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(async () => {
    setError(null);
    if (!email.trim() || !password) { setError("Enter an email and password."); return; }

    setBusy(true);
    try {
      await signIn(email, password);
      router.replace("/work");
    } catch (e: any) {
      setError(e?.message || "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }, [email, password, signIn, router]);

  const handleGoogle = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      await signInWithGoogle();
      router.replace("/work");
    } catch (e: any) {
      setError(e?.message || "Google sign-in failed.");
    } finally {
      setBusy(false);
    }
  }, [signInWithGoogle, router]);

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>FschoolAI</Text>
          <Text style={styles.subtitle}>Sign in to continue</Text>

          <TextInput
            style={styles.input}
            placeholder="Email"
            placeholderTextColor={C.textTertiary}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            editable={!busy}
          />
          <TextInput
            style={styles.input}
            placeholder="Password"
            placeholderTextColor={C.textTertiary}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            editable={!busy}
          />

          {error && <Text style={styles.error}>{error}</Text>}

          <TouchableOpacity
            style={[styles.primaryBtn, busy && styles.btnDisabled]}
            onPress={handleSubmit}
            disabled={busy}
            activeOpacity={0.85}
          >
            {busy ? (
              <ActivityIndicator color="#0f0f0f" />
            ) : (
              <Text style={styles.primaryBtnText}>Sign In</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.googleBtn, busy && styles.btnDisabled]}
            onPress={handleGoogle}
            disabled={busy}
            activeOpacity={0.85}
          >
            <GoogleLogo />
            <Text style={styles.googleBtnText}>Sign in with Google</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: BG },
  scroll: { flexGrow: 1, justifyContent: "center", padding: 24 },
  title: {
    fontFamily: "Fraunces_300Light_Italic", fontSize: 34, color: C.textPrimary,
    textAlign: "center", marginBottom: 6,
  },
  subtitle: {
    fontFamily: "Inter_400Regular", fontSize: 13, color: C.textSecondary,
    textAlign: "center", marginBottom: 32,
  },
  input: {
    fontFamily: "Inter_400Regular", fontSize: 15, color: C.textPrimary,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
    borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, marginBottom: 12,
  },
  error: {
    fontFamily: "Inter_400Regular", fontSize: 13, color: C.danger,
    marginBottom: 12, textAlign: "center",
  },
  primaryBtn: {
    backgroundColor: C.teal, borderRadius: 12, paddingVertical: 15,
    alignItems: "center", marginTop: 8,
  },
  primaryBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 15, color: "#0f0f0f" },
  // Matches Google's official light-theme button spec (white surface, #747775
  // outline, #1f1f1f text) so it reads as a real Google control, not a themed
  // knockoff — see developers.google.com/identity/branding-guidelines.
  googleBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10,
    backgroundColor: "#ffffff", borderWidth: 1, borderColor: "#747775",
    borderRadius: 12, paddingVertical: 14, marginTop: 10,
  },
  googleBtnText: { fontFamily: "Inter_500Medium", fontSize: 15, color: "#1f1f1f" },
  btnDisabled: { opacity: 0.6 },
});

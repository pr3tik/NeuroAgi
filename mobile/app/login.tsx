// login.tsx — email/password sign-in, gating the app for a signed-out (guest)
// identity. Login-only — account creation happens on web, not here (see
// context/AuthContext.tsx). Not part of the tab bar (navigation/navConfig.ts) —
// it's a standalone pre-auth screen, so it doesn't use ScreenWrapper/Header.
//
// Visual language mirrors web's AuthModal (src/pages/Landing.tsx) in dark mode:
// same "Welcome back" copy, DARK theme card tokens, and the white "Sign in →"
// button — so a student who signed up on web meets a familiar screen on mobile.

import { useState, useCallback } from "react";
import {
  Text, Image, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView,
} from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "../context/AuthContext";

// Pure black, not the app's usual #141216 — matches web's DARK.bg token
// (src/pages/Landing.tsx) AND the exact background the logo's transparency
// was extracted against, so the glyph's anti-aliased edge blends without
// even the faint tonal mismatch a lighter background would introduce.
const BG = "#000000";

// Mirrors src/pages/Landing.tsx's DARK theme tokens (the ones AuthModal uses).
const C = {
  text:        "#ffffff",
  textMuted:   "rgba(255,255,255,0.45)",
  textFaint:   "rgba(255,255,255,0.3)",
  cardInner:   "#1e1e1e",
  cardBorder:  "#2a2a2a",
  danger:      "rgba(255,59,48,0.85)",
};

export default function LoginScreen() {
  const router = useRouter();
  const { signIn } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = email.trim().length > 0 && password.length > 0;

  const handleSubmit = useCallback(async () => {
    setError(null);
    if (!canSubmit) { setError("Enter an email and password."); return; }

    setBusy(true);
    try {
      await signIn(email, password);
      router.replace("/work");
    } catch (e: any) {
      setError(e?.message || "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }, [canSubmit, email, password, signIn, router]);

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Image
            source={require("../assets/images/fschoolai-logo.png")}
            style={styles.logo}
            resizeMode="contain"
          />
          <Text style={styles.title}>Welcome back</Text>
          <Text style={styles.subtitle}>Enter your email and password to continue.</Text>

          <TextInput
            style={styles.input}
            placeholder="Email"
            placeholderTextColor={C.textFaint}
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
            placeholderTextColor={C.textFaint}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            editable={!busy}
            onSubmitEditing={handleSubmit}
            returnKeyType="go"
          />

          {error && <Text style={styles.error}>{error}</Text>}

          <TouchableOpacity
            style={[styles.primaryBtn, (!canSubmit || busy) && styles.btnDisabled]}
            onPress={handleSubmit}
            disabled={!canSubmit || busy}
            activeOpacity={0.85}
          >
            {busy ? (
              <ActivityIndicator color="#000" />
            ) : (
              <Text style={styles.primaryBtnText}>Sign in →</Text>
            )}
          </TouchableOpacity>

          <Text style={styles.footer}>Don&apos;t have an account? Sign up on the web.</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: BG },
  scroll: { flexGrow: 1, justifyContent: "center", padding: 28 },
  // Background removed (luma-matte extraction from the source JPEG's solid
  // black bg — see plans/ for how, if this ever needs redoing from a fresh
  // export) — the glyph sits directly on the screen with no container shape,
  // per cofounder feedback that a boxed logo + "FschoolAI" text read as too
  // packed. Logo alone carries the brand here.
  logo: {
    width: 96, height: 96, alignSelf: "center", marginBottom: 20,
  },
  // Matches web AuthModal's <h2>: 22px / 600 / -0.3 tracking.
  title: {
    fontWeight: "600", fontSize: 22, color: C.text,
    letterSpacing: -0.3, textAlign: "center", marginBottom: 6,
  },
  subtitle: {
    fontWeight: "400", fontSize: 14, color: C.textMuted,
    textAlign: "center", lineHeight: 22, marginBottom: 26,
  },
  // Matches web AuthModal's inputs: cardInner bg, cardBorder, radius 10.
  input: {
    fontWeight: "400", fontSize: 14, color: C.text,
    backgroundColor: C.cardInner, borderWidth: 1, borderColor: C.cardBorder,
    borderRadius: 10, paddingHorizontal: 14, paddingVertical: 13, marginBottom: 10,
  },
  error: {
    fontWeight: "400", fontSize: 12, color: C.danger,
    marginBottom: 10, textAlign: "center",
  },
  // Matches web AuthModal's submit: white fill, dark text, radius 12.
  primaryBtn: {
    backgroundColor: C.text, borderRadius: 12, paddingVertical: 15,
    alignItems: "center", marginTop: 8,
  },
  primaryBtnText: { fontWeight: "600", fontSize: 15, color: "#000" },
  btnDisabled: { opacity: 0.4 },
  footer: {
    fontWeight: "400", fontSize: 12, color: C.textFaint,
    textAlign: "center", marginTop: 12,
  },
});

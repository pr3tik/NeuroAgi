// login.tsx — email/password sign-in, gating the app for a signed-out (guest)
// identity. Login-only — account creation happens on web, not here (see
// context/AuthContext.tsx). Not part of the swipe-nav tab grid (navigation/navConfig.ts) —
// it's a standalone pre-auth screen, so it doesn't use ScreenWrapper/Header.

import { useState, useCallback } from "react";
import {
  Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView,
} from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "../context/AuthContext";

const BG = "#0f0f0f";

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
  const { signIn } = useAuth();

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
  btnDisabled: { opacity: 0.6 },
});

// Must be the very first import: Hermes (RN's JS engine) has no native Web
// Crypto API, so `crypto.getRandomValues` is undefined until this polyfills it.
// supabase-js's auth internals touch it during sign-in — without this, that
// throws "crypto.getRandomValues is not a function".
import "react-native-get-random-values";

import { registerGlobals } from "@livekit/react-native";
// Must run before any LiveKit/WebRTC API is touched — installs RTCPeerConnection
// and friends onto global. This file is the earliest app code Metro loads
// (package.json's "main" is expo-router/entry, which renders this layout first;
// App.tsx/index.ts are unused leftover scaffold from before expo-router was added).
registerGlobals();

import { useEffect } from "react";
import { View } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import * as SystemUI from "expo-system-ui";
import { useFonts } from "expo-font";
import { FunnelDisplay_300Light } from "@expo-google-fonts/funnel-display";
import { Fraunces_300Light_Italic } from "@expo-google-fonts/fraunces";
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from "@expo-google-fonts/inter";
import { DMSans_400Regular } from "@expo-google-fonts/dm-sans";
import { AuthProvider, useAuth } from "../context/AuthContext";

const BG = "#0f0f0f";

// Same font set as the web app's mobile view (src/pages/Work.tsx's Google
// Fonts <link>) — keeps typography identical across platforms.
export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    FunnelDisplay_300Light,
    Fraunces_300Light_Italic,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    DMSans_400Regular,
  });

  useEffect(() => {
    SystemUI.setBackgroundColorAsync(BG);
  }, []);

  if (!fontsLoaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: BG }}>
      <SafeAreaProvider style={{ backgroundColor: BG }}>
        <StatusBar style="light" backgroundColor={BG} />
        <AuthProvider>
          <RootNavigator />
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

// Split out from RootLayout so useAuth() runs inside <AuthProvider>. Gates
// every existing screen behind a real session — only /login is reachable
// while signed out. Stack.Protected (expo-router's auth primitive, not a
// hand-rolled redirect effect) auto-redirects the instant `guard` flips —
// e.g. straight out of the app to /login on sign-out.
function RootNavigator() {
  const { status } = useAuth();

  // Don't mount either Protected group until we know which one applies —
  // otherwise a cold launch briefly evaluates guard={false} against whatever
  // route status eventually resolves to and flash-redirects unnecessarily.
  if (status === "loading") {
    return <View style={{ flex: 1, backgroundColor: BG }} />;
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: BG },
        animation: "none",
        // Every nav call is router.replace() (swap, not push), so the
        // stack never has more than one screen — the native stack's
        // built-in edge swipe-to-go-back has nothing to pop back to and
        // was fighting our own Pan-based swipe nav. Disable it entirely.
        gestureEnabled: false,
      }}
    >
      <Stack.Protected guard={status === "authed"}>
        <Stack.Screen name="index" />
        <Stack.Screen name="work" />
        <Stack.Screen name="assignment" />
        <Stack.Screen name="canvas" />
        <Stack.Screen name="files" />
        <Stack.Screen name="identity" />
        <Stack.Screen name="leaderboard" />
        <Stack.Screen name="rooms" />
        <Stack.Screen name="spaces" />
        <Stack.Screen name="study" />
        <Stack.Screen name="toolkit" />
      </Stack.Protected>
      <Stack.Protected guard={status === "guest"}>
        <Stack.Screen name="login" />
      </Stack.Protected>
    </Stack>
  );
}

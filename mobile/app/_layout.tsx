// Must be the very first import: Hermes (RN's JS engine) has no native Web
// Crypto API, so `crypto.getRandomValues` is undefined until this polyfills it.
// supabase-js's auth internals touch it during sign-in — without this, that
// throws "crypto.getRandomValues is not a function".
import "react-native-get-random-values";

import { Platform } from "react-native";
// LiveKit's WebRTC layer is native-only. On web (`expo start --web`), react-native-web
// has no `requireNativeComponent`, so eagerly importing @livekit/react-native crashes
// every route to the error screen. Guard it with a runtime `require` (not a static
// import): Metro still bundles the module, but the factory only executes on native, so
// the native component is never instantiated on web.
// On native this still runs before any LiveKit/WebRTC API is touched — installs
// RTCPeerConnection and friends onto global. This file is the earliest app code Metro
// loads (package.json's "main" is expo-router/entry, which renders this layout first;
// App.tsx/index.ts are unused leftover scaffold from before expo-router was added).
if (Platform.OS !== "web") {
  const { registerGlobals } = require("@livekit/react-native");
  registerGlobals();
}

import { useEffect } from "react";
import { View } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import * as SystemUI from "expo-system-ui";
import { useFonts } from "expo-font";
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from "@expo-google-fonts/inter";
import { AuthProvider, useAuth } from "../context/AuthContext";
import { ThemeProvider } from "../constants/appTheme";

const BG = "#141216";

// Warm Ink: one type family. Inter carries the whole UI (SF Pro is the next
// step); the old FunnelDisplay/Fraunces/DM Sans faces were dropped to kill the
// four-font, serif-italic "AI" look.
export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    SystemUI.setBackgroundColorAsync(BG);
  }, []);

  if (!fontsLoaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: BG }}>
      <SafeAreaProvider style={{ backgroundColor: BG }}>
        <StatusBar style="light" backgroundColor={BG} />
        <ThemeProvider>
          <AuthProvider>
            <RootNavigator />
          </AuthProvider>
        </ThemeProvider>
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
        <Stack.Screen name="tutor" />
      </Stack.Protected>
      <Stack.Protected guard={status === "guest"}>
        <Stack.Screen name="login" />
      </Stack.Protected>
    </Stack>
  );
}

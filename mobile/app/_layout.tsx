import { useEffect } from "react";
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
        />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

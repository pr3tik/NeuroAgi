import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import { AppState, Platform } from "react-native";

// Expo Router's web target server-renders the initial page (no `window`),
// where AsyncStorage's web shim throws. Only touch storage client-side.
// (On native this is always true — RN's setUpGlobals aliases global.window
// to global before any app code runs — so this only ever guards the SSR pass.)
const isBrowser = typeof window !== "undefined";

// Same Supabase project as the web app — see src/api/supabase.ts.
export const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL!,
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
  {
    db: { schema: "public" },
    auth: {
      storage: isBrowser ? AsyncStorage : undefined,
      autoRefreshToken: isBrowser,
      persistSession: isBrowser,
      detectSessionInUrl: false,
    },
  }
);

// GoTrue's autoRefreshToken timer has no concept of the OS suspending a
// backgrounded app — left running, a refresh call can fire (and fail/retry)
// while iOS/Android has paused networking. Official Supabase + Expo pattern:
// pause the timer on background, force a refresh check on foreground.
if (Platform.OS !== "web") {
  AppState.addEventListener("change", (state) => {
    if (state === "active") supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}

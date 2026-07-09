import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";

// Expo Router's web target server-renders the initial page (no `window`),
// where AsyncStorage's web shim throws. Only touch storage client-side.
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

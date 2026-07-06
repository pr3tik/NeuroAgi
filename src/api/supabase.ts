import { createClient } from '@supabase/supabase-js';

// Always target the public schema — where all app data (users, courses, assignments,
// leaderboard, etc.) lives. Explicit prevents any default-schema drift.
//
// eventsPerSecond raises the realtime broadcast rate limit (default 10). The
// collaborative whiteboard streams live in-progress strokes while a user drags, so
// the default budget gets exhausted mid-stroke and drops the important events
// (completed strokes, clears). 30/s leaves comfortable headroom above the throttled
// live-stroke cadence (~14/s) plus presence and chat traffic.
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
  {
    db: { schema: 'public' },
    realtime: { params: { eventsPerSecond: 30 } },
    // Auth was implicit-default before Google sign-in. Made explicit here:
    //  • detectSessionInUrl — parse the ?code= on the OAuth redirect back to the app
    //  • flowType: pkce     — the recommended, more secure web OAuth flow
    // persistSession / autoRefreshToken keep their (default) true so the GoTrue
    // session survives reloads exactly as the password flow already relied on.
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: 'pkce',
    },
  }
);

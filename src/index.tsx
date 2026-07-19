// index.jsx — React entry point. Mounts App into #root.
// /card is a standalone public page — rendered without AppProvider/Supabase
//
// NOTE: StrictMode is intentionally NOT used. In dev it double-invokes effects,
// which double-subscribes the Supabase Realtime channels (global presence, the
// per-room presence channel, lobby, etc.). The room channel then crashes with
// "cannot add `presence` callbacks ... after subscribe()" because Supabase reuses
// the still-subscribed channel for that topic. Production never double-invokes, so
// rendering without StrictMode makes dev behave like prod.
import ReactDOM    from "react-dom/client";
import "./index.css";

const isWaitlistDash =
  window.location.hostname === "waitlist.fschoolai.com" ||
  window.location.pathname.startsWith("/waitlist-dashboard");

if (window.location.pathname === "/card") {
  // /card — white Founding Card page (CardHeroAnimation + NFCTapAnimation). Standalone —
  // rendered without AppProvider/Supabase.
  import("./pages/Card").then(({ default: Card }) => {
    ReactDOM.createRoot(document.getElementById("root")).render(<Card />);
  });
} else if (isWaitlistDash) {
  // Internal waitlist admin dashboard — served at the waitlist.* subdomain (routed here by
  // hostname) and at /waitlist-dashboard for testing before DNS. No AppProvider/Supabase
  // needed: it fetches its own admin-key-gated endpoint.
  import("./pages/WaitlistDashboard").then(({ default: WaitlistDashboard }) => {
    ReactDOM.createRoot(document.getElementById("root")).render(<WaitlistDashboard />);
  });
} else {
  Promise.all([
    import("./App"),
    import("./context/AppContext"),
    import("./api/installApiAuth"),   // side-effect: attach the session JWT to /api/* calls
  ]).then(([{ default: App }, { AppProvider }]) => {
    ReactDOM.createRoot(document.getElementById("root")).render(
      <AppProvider>
        <App />
      </AppProvider>
    );
  });
}
